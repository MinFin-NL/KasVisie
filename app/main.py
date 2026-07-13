"""KasVisie - kasprognose-dashboard (FastAPI + statische frontend)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import models
from .data import NL_HOLIDAYS, STORE, parse_csv

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="KasVisie", version="0.2.0")
STORE.load_default()


@app.get("/api/status")
def status() -> dict:
    return {**STORE.summary(), "models": [{"key": k, "label": v} for k, v in models.MODELS.items()]}


@app.post("/api/upload")
async def upload(file: UploadFile) -> dict:
    raw = await file.read()
    try:
        df = parse_csv(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    STORE.set_frame(df, source=file.filename or "upload.csv")
    return STORE.summary()


@app.post("/api/demo")
def demo() -> dict:
    STORE.load_demo()
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

    df = STORE.df
    last_obs = df["date"].max()
    today = last_obs + pd.Timedelta(days=1)  # eerste dag zonder realisatie
    month_start = today.replace(day=1)
    next_month_end = (month_start + pd.offsets.MonthEnd(2)).normalize()

    horizon = pd.date_range(today, next_month_end, freq="D")
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

    return {
        "model": model,
        "modelLabel": models.MODELS[model],
        "today": today.date().isoformat(),
        "thisMonth": f"{month_start:%Y-%m}",
        "days": days,
        "totals": {
            "thisMonth": month_total(this_rows, "pred"),
            "nextMonth": month_total(next_rows, "pred"),
            "thisMonthLastYear": ly_total(this_rows),
            "nextMonthLastYear": ly_total(next_rows),
        },
        "metrics": metrics,
    }


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
