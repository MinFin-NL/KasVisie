import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.tsa.stattools import ccf
from pandas.tseries.holiday import USFederalHolidayCalendar

df = pd.read_csv("cashflow_data.csv", index_col=0, parse_dates=True)

cal = USFederalHolidayCalendar()
holidays = cal.holidays(start=df.index.min(), end=df.index.max())
df['is_holiday'] = df.index.isin(holidays).astype(int)

cross_corr = ccf(df['cashflow'], df['is_holiday'])

for i in range(-3, 4):
    corr = df['cashflow'].corr(df['is_holiday'].shift(i))
    print(f"Correlation at Lag {i}: {corr:.3f}")

df['h_lead'] = df['is_holiday'].shift(-1).fillna(0)
df['h_lag'] = df['is_holiday'].shift(1).fillna(0)

exog = df[['settlement_mult', 'h_lead', 'h_lag', 'month_trend']]
model = sm.tsa.ARIMA(df['cashflow'], exog=exog, order=(1, 1, 1))
results = model.fit()

print(results.summary())
