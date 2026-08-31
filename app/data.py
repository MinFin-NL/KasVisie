"""Dataopslag voor KasVisie: inladen, uploaden en demo-data genereren."""

from __future__ import annotations

import io
from datetime import date, timedelta
from pathlib import Path

import holidays
import numpy as np
import pandas as pd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEFAULT_CSV = DATA_DIR / "cashflow_data.csv"

NL_HOLIDAYS = holidays.country_holidays("NL", years=range(2020, 2035))


class DataStore:
    """Houdt de actuele reeks (date, cashflow) in het geheugen."""

    def __init__(self) -> None:
        self.df: pd.DataFrame | None = None
        self.source: str = "geen"
        # Loopt op bij elke dataset-wissel; gebruikt als cachesleutel voor prognoses.
        self.version: int = 0

    def load_default(self) -> None:
        if DEFAULT_CSV.exists():
            try:
                self.set_frame(parse_csv(DEFAULT_CSV.read_bytes()), source=DEFAULT_CSV.name)
                return
            except ValueError:
                pass
        self.load_demo()

    def load_demo(self) -> None:
        self.set_frame(generate_demo(), source="demo-data")

    def set_frame(self, df: pd.DataFrame, source: str) -> None:
        self.df = df
        self.source = source
        self.version += 1

    @property
    def ready(self) -> bool:
        return self.df is not None and len(self.df) >= 60

    def summary(self) -> dict:
        if self.df is None or self.df.empty:
            return {
                "rows": 0, "source": self.source, "start": None, "end": None,
                "ready": False, "today": date.today().isoformat(), "staleDays": None,
            }
        end = self.df["date"].max().date()
        return {
            "rows": int(len(self.df)),
            "source": self.source,
            "start": self.df["date"].min().date().isoformat(),
            "end": end.isoformat(),
            "ready": self.ready,
            # Echte kalenderdatum en de kloof daarmee, zodat de UI niet hoeft te
            # doen alsof de laatste meetdag "vandaag" is.
            "today": date.today().isoformat(),
            "staleDays": (date.today() - end).days,
        }


def parse_csv(raw: bytes) -> pd.DataFrame:
    """Accepteert een CSV met een datumkolom en een cashflow-kolom.

    De datum mag in een kolom 'date'/'datum' staan of in de (naamloze) eerste
    kolom; het bedrag in 'cashflow'/'bedrag'/'amount'.
    """
    df = pd.read_csv(io.BytesIO(raw))
    cols = {c.strip().lower(): c for c in df.columns}

    date_col = next((cols[k] for k in ("date", "datum") if k in cols), df.columns[0])
    value_col = next((cols[k] for k in ("cashflow", "bedrag", "amount", "value") if k in cols), None)
    if value_col is None:
        raise ValueError("Geen kolom 'cashflow' (of 'bedrag'/'amount') gevonden.")

    out = pd.DataFrame(
        {
            "date": pd.to_datetime(df[date_col], errors="coerce"),
            "cashflow": pd.to_numeric(df[value_col], errors="coerce"),
        }
    ).dropna()
    if out.empty:
        raise ValueError("Geen geldige rijen (datum + cashflow) in het bestand.")

    out["date"] = out["date"].dt.normalize()
    out = out.groupby("date", as_index=False)["cashflow"].sum()
    out = out.sort_values("date").reset_index(drop=True)
    # Vul ontbrekende kalenderdagen met 0 zodat de reeks aaneengesloten is.
    full = pd.DataFrame({"date": pd.date_range(out["date"].min(), out["date"].max(), freq="D")})
    out = full.merge(out, on="date", how="left").fillna({"cashflow": 0.0})
    return out


def generate_demo(months_back: int = 30, seed: int = 7) -> pd.DataFrame:
    """Synthetische dagelijkse ontvangsten t/m gisteren, incl. vorig jaar."""
    rng = np.random.default_rng(seed)
    end = date.today() - timedelta(days=1)
    start = (end.replace(day=1) - timedelta(days=months_back * 31)).replace(day=1)
    dates = pd.date_range(start, end, freq="D")

    t = np.arange(len(dates))
    growth = 1.0 + 0.10 * t / 365.0  # ~10% groei per jaar
    dow = dates.dayofweek.to_numpy()
    weekday_effect = np.array([1.0, 0.95, 0.9, 1.0, 1.15, 0.05, 0.02])[dow]
    is_holiday = np.array([d.date() in NL_HOLIDAYS for d in dates])
    holiday_effect = np.where(is_holiday, 0.03, 1.0)
    dom = dates.day.to_numpy()
    # Settlement-pieken rond de 25e t/m 29e van de maand.
    settlement = 1.0 + 4.5 * np.exp(-0.5 * ((dom - 27) / 1.6) ** 2)
    base = 950.0
    noise = rng.lognormal(mean=0.0, sigma=0.18, size=len(dates))
    cashflow = base * growth * weekday_effect * holiday_effect * settlement * noise
    cashflow = np.round(cashflow, 2)

    return pd.DataFrame({"date": dates, "cashflow": cashflow})


STORE = DataStore()
