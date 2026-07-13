"""Voorspelmodellen voor de kasprognose.

Elk model levert per dag een puntvoorspelling plus een 80%-onzekerheidsband
(q10/q90). De kwaliteit wordt bepaald via een backtest op de laatste 28 dagen:
gemiddelde pinball-loss (q10+q90) en dekking ("binnen%") van de band.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge

from .data import NL_HOLIDAYS

MODELS = {
    "gbr": "Gradient Boosting",
    "rf": "Random Forest",
    "ridge": "Ridge-regressie",
    "seasonal": "Seizoensgemiddelde",
}

BACKTEST_DAYS = 28
Q_LO, Q_HI = 0.1, 0.9


def make_features(dates: pd.DatetimeIndex) -> pd.DataFrame:
    dom = dates.day
    return pd.DataFrame(
        {
            "dow": dates.dayofweek,
            "dom": dom,
            "month": dates.month,
            "is_weekend": (dates.dayofweek >= 5).astype(int),
            "is_holiday": [int(d.date() in NL_HOLIDAYS) for d in dates],
            "settlement_window": ((dom >= 24) & (dom <= 29)).astype(int),
            "days_to_eom": dates.days_in_month - dom,
            "t": (dates - dates[0]).days / 365.0,
        },
        index=dates,
    )


def _closed_days(features: pd.DataFrame) -> np.ndarray:
    return (features["is_weekend"] + features["is_holiday"]).to_numpy() > 0


class _SeasonalMean:
    """Gemiddelde per (weekdag, dag-van-maand-bucket) over de laatste 16 weken."""

    def fit(self, dates: pd.DatetimeIndex, y: np.ndarray) -> "_SeasonalMean":
        recent = dates >= dates.max() - pd.Timedelta(weeks=16)
        df = pd.DataFrame(
            {"dow": dates.dayofweek[recent], "bucket": np.minimum(dates.day[recent] // 5, 5), "y": y[recent]}
        )
        self.table = df.groupby(["dow", "bucket"])["y"].mean()
        self.fallback = float(df["y"].mean())
        return self

    def predict(self, dates: pd.DatetimeIndex) -> np.ndarray:
        keys = zip(dates.dayofweek, np.minimum(dates.day // 5, 5))
        return np.array([float(self.table.get(k, self.fallback)) for k in keys])


def _fit_predict(model_key: str, train_dates, y_train, pred_dates):
    """Retourneert (pred, lo, hi) voor pred_dates."""
    x_train = make_features(train_dates)
    x_pred = make_features(pred_dates)
    # De trend-feature moet vanaf hetzelfde nulpunt tellen als de trainingsset.
    x_pred["t"] = (pred_dates - train_dates[0]).days / 365.0

    if model_key == "gbr":
        preds = {}
        for name, alpha in (("mid", 0.5), ("lo", Q_LO), ("hi", Q_HI)):
            m = GradientBoostingRegressor(loss="quantile", alpha=alpha, n_estimators=200, max_depth=3, random_state=0)
            m.fit(x_train, y_train)
            preds[name] = m.predict(x_pred)
        pred, lo, hi = preds["mid"], preds["lo"], preds["hi"]
    else:
        if model_key == "rf":
            m = RandomForestRegressor(n_estimators=200, min_samples_leaf=2, random_state=0)
            m.fit(x_train, y_train)
            pred = m.predict(x_pred)
            resid = y_train - m.predict(x_train)
        elif model_key == "ridge":
            x_tr = pd.get_dummies(x_train.astype({"dow": "category", "month": "category"}))
            x_pr = pd.get_dummies(x_pred.astype({"dow": "category", "month": "category"}))
            x_pr = x_pr.reindex(columns=x_tr.columns, fill_value=0)
            m = Ridge(alpha=1.0)
            m.fit(x_tr, y_train)
            pred = m.predict(x_pr)
            resid = y_train - m.predict(x_tr)
        elif model_key == "seasonal":
            m = _SeasonalMean().fit(train_dates, y_train)
            pred = m.predict(pred_dates)
            resid = y_train - m.predict(train_dates)
        else:
            raise KeyError(f"Onbekend model: {model_key}")
        lo = pred + np.quantile(resid, Q_LO)
        hi = pred + np.quantile(resid, Q_HI)

    # Op weekend-/feestdagen zijn de ontvangsten vrijwel nul; knijp de band dicht.
    closed = _closed_days(x_pred)
    closed_level = float(np.median(y_train[_closed_days(x_train)])) if _closed_days(x_train).any() else 0.0
    pred = np.where(closed, np.minimum(pred, closed_level), pred)
    hi = np.where(closed, np.minimum(hi, closed_level * 2 + 1), hi)

    pred = np.clip(pred, 0, None)
    lo = np.clip(np.minimum(lo, pred), 0, None)
    hi = np.maximum(hi, pred)
    return pred, lo, hi


def _pinball(y: np.ndarray, q: np.ndarray, alpha: float) -> float:
    diff = y - q
    return float(np.mean(np.maximum(alpha * diff, (alpha - 1) * diff)))


def backtest(model_key: str, dates: pd.DatetimeIndex, y: np.ndarray) -> dict:
    split = len(dates) - BACKTEST_DAYS
    pred, lo, hi = _fit_predict(model_key, dates[:split], y[:split], dates[split:])
    y_test = y[split:]
    pinball = 0.5 * (_pinball(y_test, lo, Q_LO) + _pinball(y_test, hi, Q_HI))
    coverage = float(np.mean((y_test >= lo) & (y_test <= hi)))
    return {"pinball": round(pinball, 1), "coverage_pct": round(100 * coverage)}


def forecast(model_key: str, df: pd.DataFrame, horizon: pd.DatetimeIndex) -> pd.DataFrame:
    dates = pd.DatetimeIndex(df["date"])
    y = df["cashflow"].to_numpy(dtype=float)
    pred, lo, hi = _fit_predict(model_key, dates, y, horizon)
    return pd.DataFrame({"date": horizon, "pred": pred, "lo": lo, "hi": hi})
