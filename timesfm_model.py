"""
Cashflow forecasting with TimesFM 2.5 (Google Research).

Uses the XReg (covariate) API so that settlement multipliers, holidays,
and the intra-month trend are passed as exogenous variables — mirroring
the same business logic as the ARIMA model in model.py.

Install:
    uv add "timesfm[torch,xreg]>=2.5.0"
    # or: pip install "timesfm[torch,xreg]>=2.5.0"

Model card: https://huggingface.co/google/timesfm-2.5-200m-pytorch
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from pandas.tseries.holiday import USFederalHolidayCalendar
import timesfm

FORECAST_DAYS = 30
HUGGINGFACE_REPO = "google/timesfm-2.5-200m-pytorch"


def build_features(index: pd.DatetimeIndex, cal: USFederalHolidayCalendar) -> pd.DataFrame:
    """Compute settlement_mult, month_trend, and is_holiday for any date range."""
    holidays = cal.holidays(start=index.min(), end=index.max())
    feat = pd.DataFrame(index=index)
    feat['day_of_month'] = index.day
    feat['month_trend'] = np.exp(index.day / 10)
    feat['settlement_mult'] = 1.0
    feat.loc[index.dayofweek == 0, 'settlement_mult'] = 3.0
    feat.loc[index.dayofweek >= 5, 'settlement_mult'] = 0.0
    feat['is_holiday'] = index.isin(holidays).astype(float)
    return feat


def load_data() -> pd.DataFrame:
    df = pd.read_csv("cashflow_data.csv", index_col=0, parse_dates=True)
    cal = USFederalHolidayCalendar()
    feat = build_features(df.index, cal)
    df['month_trend'] = feat['month_trend']
    df['is_holiday'] = feat['is_holiday']
    return df, cal


def build_horizon_features(
    last_date: pd.Timestamp,
    n_days: int,
    cal: USFederalHolidayCalendar,
) -> pd.DataFrame:
    horizon_dates = pd.date_range(
        start=last_date + pd.Timedelta(days=1),
        periods=n_days,
        freq='D',
    )
    return build_features(horizon_dates, cal)


def run_forecast(df: pd.DataFrame, cal: USFederalHolidayCalendar) -> dict:
    horizon_feat = build_horizon_features(df.index[-1], FORECAST_DAYS, cal)

    # TimesFM XReg requires covariate arrays of length context + horizon.
    # We stack context and horizon covariates together.
    settlement_full = np.concatenate([
        df['settlement_mult'].values,
        horizon_feat['settlement_mult'].values,
    ]).astype(np.float32)

    month_trend_full = np.concatenate([
        df['month_trend'].values,
        horizon_feat['month_trend'].values,
    ]).astype(np.float32)

    is_holiday_full = np.concatenate([
        df['is_holiday'].values,
        horizon_feat['is_holiday'].values,
    ]).astype(np.float32)

    cashflow_context = df['cashflow'].values.astype(np.float32)

    print("Loading TimesFM 2.5 checkpoint from Hugging Face...")
    hparams = timesfm.TimesFmHparams(
        backend="cpu",
        per_core_batch_size=32,
        horizon_len=FORECAST_DAYS,
    )
    ckpt = timesfm.TimesFmCheckpoint(huggingface_repo_id=HUGGINGFACE_REPO)
    model = timesfm.TimesFm(hparams=hparams, checkpoint=ckpt)

    print(f"Forecasting {FORECAST_DAYS} days with XReg covariates...")
    point_fc, quantile_fc = model.forecast_with_covariates(
        inputs=[cashflow_context],
        dynamic_numerical_covariates={
            "settlement_mult": [settlement_full],
            "month_trend": [month_trend_full],
        },
        dynamic_categorical_covariates={
            "is_holiday": [is_holiday_full],
        },
        xreg_mode="xreg + timesfm",
        normalize_xreg_target_per_input=True,
    )

    horizon_dates = pd.date_range(
        start=df.index[-1] + pd.Timedelta(days=1),
        periods=FORECAST_DAYS,
        freq='D',
    )

    return {
        "point": pd.Series(point_fc[0], index=horizon_dates),
        "q10": pd.Series(quantile_fc[0, :, 0], index=horizon_dates),
        "q90": pd.Series(quantile_fc[0, :, -1], index=horizon_dates),
    }


def plot_results(df: pd.DataFrame, forecast: dict) -> None:
    fig, ax = plt.subplots(figsize=(16, 7))

    context_tail = df['cashflow'].iloc[-60:]
    ax.plot(context_tail.index, context_tail.values,
            color='steelblue', lw=1.8, label='Historical cashflow (last 60 days)')

    ax.plot(forecast['point'].index, forecast['point'].values,
            color='darkorange', lw=2.5, marker='o', ms=4, label='TimesFM point forecast')

    ax.fill_between(
        forecast['q10'].index,
        forecast['q10'].values,
        forecast['q90'].values,
        color='darkorange', alpha=0.18, label='10–90th percentile band',
    )

    ax.axvline(df.index[-1], color='grey', lw=1, ls='--', alpha=0.6)
    ax.text(df.index[-1], ax.get_ylim()[1] * 0.97, '  forecast start',
            fontsize=8, color='grey', va='top')

    ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %d'))
    ax.xaxis.set_major_locator(mdates.WeekdayLocator(interval=1))
    plt.xticks(rotation=35, ha='right')

    ax.set_xlabel('Date', fontsize=12)
    ax.set_ylabel('Cashflow Volume', fontsize=12)
    ax.set_title(
        f'Cashflow Forecast — TimesFM 2.5 + XReg ({FORECAST_DAYS}-day horizon)',
        fontsize=14, fontweight='bold',
    )
    ax.legend(fontsize=10)
    ax.grid(True, alpha=0.25)

    plt.tight_layout()
    output_path = "timesfm_forecast.png"
    plt.savefig(output_path, dpi=150)
    plt.show()
    print(f"\nSaved plot: {output_path}")


def main() -> None:
    print("Loading cashflow data...")
    df, cal = load_data()
    print(f"  Context: {df.index[0].date()} to {df.index[-1].date()} ({len(df)} days)")

    forecast = run_forecast(df, cal)

    print("\nForecast summary:")
    summary = pd.DataFrame({
        'point': forecast['point'],
        'q10': forecast['q10'],
        'q90': forecast['q90'],
    })
    print(summary.to_string())

    plot_results(df, forecast)


if __name__ == "__main__":
    main()
