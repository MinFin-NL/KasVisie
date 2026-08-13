"""KasVisie - kasprognose-dashboard (FastAPI + statische frontend)."""

from __future__ import annotations

from datetime import date as _date
from pathlib import Path

import pandas as pd
from fastapi import Body, FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import export, modelcard, models
from .data import NL_HOLIDAYS, STORE, parse_csv

STATIC_DIR = Path(__file__).resolve().parent / "static"

# De modellen zijn deterministisch (random_state=0), dus een prognose hoeft per
# (dataset, model) maar één keer berekend te worden. Scheelt ~600 ms per klik.
_FORECAST_CACHE: dict[tuple[int, str], dict] = {}

app = FastAPI(title="KasVisie", version="0.2.0")
STORE.load_default()


@app.get("/api/status")
def status() -> dict:
    return {
        **STORE.summary(),
        "models": [
            {"key": k, "label": v, "description": models.MODEL_DESCRIPTIONS.get(k, "")}
            for k, v in models.MODELS.items()
        ],
    }


@app.post("/api/upload")
async def upload(file: UploadFile) -> dict:
    raw = await file.read()
    try:
        df = parse_csv(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    STORE.set_frame(df, source=file.filename or "upload.csv")
    _FORECAST_CACHE.clear()
    return STORE.summary()


@app.post("/api/demo")
def demo() -> dict:
    STORE.load_demo()
    _FORECAST_CACHE.clear()
    return STORE.summary()


@app.get("/api/data")
def data() -> dict:
    if STORE.df is None:
        raise HTTPException(status_code=404, detail="Nog geen data geladen.")
    df = STORE.df
    return {
        **STORE.summary(),
        "records": [
            {
                "date": d.date().isoformat(),
                "cashflow": round(float(v), 2),
                "weekend": d.weekday() >= 5,
                "holiday": NL_HOLIDAYS.get(d.date()),
            }
            for d, v in zip(df["date"], df["cashflow"])
        ],
    }


@app.get("/api/forecast")
def forecast(model: str = "gbr") -> dict:
    if model not in models.MODELS:
        raise HTTPException(status_code=400, detail=f"Onbekend model '{model}'.")
    if not STORE.ready:
        raise HTTPException(status_code=409, detail="Te weinig data voor een prognose (minimaal 60 dagen).")

    key = (STORE.version, model)
    if key not in _FORECAST_CACHE:
        _FORECAST_CACHE[key] = _compute_forecast(model)
    return _FORECAST_CACHE[key]


def _compute_forecast(model: str) -> dict:
    df = STORE.df
    last_obs = df["date"].max()
    forecast_start = last_obs + pd.Timedelta(days=1)  # eerste dag zonder realisatie
    month_start = forecast_start.replace(day=1)
    next_month_end = (month_start + pd.offsets.MonthEnd(2)).normalize()

    horizon = pd.date_range(forecast_start, next_month_end, freq="D")
    fc = models.forecast(model, df, horizon)
    metrics = models.backtest(model, pd.DatetimeIndex(df["date"]), df["cashflow"].to_numpy(dtype=float))

    actuals = df.set_index("date")["cashflow"]
    fc = fc.set_index("date")

    def day_row(d: pd.Timestamp) -> dict:
        ly = d - pd.DateOffset(years=1)
        ly_val = actuals.get(ly)
        row = {
            "date": d.date().isoformat(),
            "weekend": d.weekday() >= 5,
            "holiday": NL_HOLIDAYS.get(d.date()),
            "actual": round(float(actuals[d]), 2) if d in actuals.index else None,
            "lastYearActual": round(float(ly_val), 2) if ly_val is not None and not pd.isna(ly_val) else None,
        }
        if d in fc.index:
            row |= {k: round(float(fc.loc[d, k]), 2) for k in ("pred", "lo", "hi")}
        return row

    all_days = pd.date_range(month_start, next_month_end, freq="D")
    days = [day_row(d) for d in all_days]

    def month_total(rows: list[dict], key: str) -> float | None:
        vals = [r["actual"] if r["actual"] is not None else r.get(key) for r in rows]
        if any(v is None for v in vals):
            return None
        return round(sum(vals), 2)

    this_rows = [r for r in days if r["date"][:7] == f"{month_start:%Y-%m}"]
    next_rows = [r for r in days if r["date"][:7] != f"{month_start:%Y-%m}"]

    def ly_total(rows: list[dict]) -> float | None:
        vals = [r["lastYearActual"] for r in rows]
        vals = [v for v in vals if v is not None]
        return round(sum(vals), 2) if vals else None

    # Ondergrens waaronder een dag structureel gesloten is (weekend/feestdag).
    # Schaalvrij, zodat de guard ook klopt bij bedragen in miljoenen.
    positive = [r["pred"] for r in days if r.get("pred") is not None and r["pred"] > 0]
    drag_floor = round(0.02 * float(pd.Series(positive).median()), 6) if positive else 0.0

    real_today = _date.today()
    return {
        "model": model,
        "modelLabel": models.MODELS[model],
        # De eerste dag zonder realisatie. Dit is nadrukkelijk niet "vandaag":
        # bij verouderde data liggen die dagen ver uit elkaar.
        "forecastStart": forecast_start.date().isoformat(),
        "lastObservation": last_obs.date().isoformat(),
        "today": real_today.isoformat(),
        "staleDays": (real_today - last_obs.date()).days,
        "currency": "EUR",
        "dragFloor": drag_floor,
        # Modelversie plus vingerafdruk van de trainingsset: samen maken die
        # een prognose achteraf herleidbaar.
        "modelVersion": modelcard.version(model),
        "dataFingerprint": modelcard.data_fingerprint(df),
        "thisMonth": f"{month_start:%Y-%m}",
        "days": days,
        "totals": {
            "thisMonth": month_total(this_rows, "pred"),
            "nextMonth": month_total(next_rows, "pred"),
            "thisMonthLastYear": ly_total(this_rows),
            "nextMonthLastYear": ly_total(next_rows),
        },
        "metrics": {**metrics, "coverage_target": round(100 * (models.Q_HI - models.Q_LO))},
    }


@app.get("/api/modelcard")
def model_card(model: str = "gbr") -> dict:
    known = {**models.MODELS, **models.FUTURE_MODELS}
    if model not in known:
        raise HTTPException(status_code=400, detail=f"Onbekend model '{model}'.")
    # Metrieken alleen als er genoeg data is; de kaart zelf staat los daarvan.
    metrics = None
    if model in models.MODELS and STORE.ready:
        metrics = forecast(model)["metrics"]
    return modelcard.build(model, STORE, metrics)


CONTENT_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@app.post("/api/export")
def export_forecast(payload: dict = Body(...)) -> Response:
    """Exporteert de prognosehorizon plus één kolom per scenario."""
    fmt = str(payload.get("format", "csv")).lower()
    if fmt not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Onbekend formaat '{fmt}'.")

    model = str(payload.get("model", "gbr"))
    fc = forecast(model)  # hergebruikt de cache en de modelvalidatie

    valid_dates = {d["date"] for d in fc["days"]}
    try:
        scenarios = export.clean_scenarios(payload.get("scenarios"), valid_dates)
    except export.ExportError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    table = export.build_table(fc, scenarios)
    body = export.to_csv(table) if fmt == "csv" else export.to_xlsx(table, fc, scenarios)
    name = export.filename(fc, fmt)
    return Response(
        content=body,
        media_type=CONTENT_TYPES[fmt],
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
