# Exogenous Variables (Regressors) Guide

## Overview

Exogenous variables (also called regressors) allow Prophet models to incorporate external factors that influence your target metric. These might include:

- **Marketing spend** — advertising investment and its impact on sales
- **Promotional days** — holiday flags (0/1) or promotional event indicators  
- **Temperature** — for demand forecasting in climate-sensitive businesses
- **Website traffic** — leading indicator for e-commerce sales
- **Competitor pricing** — external market conditions
- **Economic indices** — inflation, unemployment rate, consumer confidence

By including these factors in your forecast, you can:
- **Improve accuracy** — capture the influence of external drivers on your target
- **Understand causation** — quantify how much each factor matters
- **Build scenario models** — project outcomes under different external conditions

## How It Works

### 1. Prepare Your Dataset

Your dataset must include columns for both your target variable and the external factors:

| Date | Revenue | Marketing_Spend | Is_Holiday |
|------|---------|-----------------|-----------|
| 2024-01-01 | 5000 | 500 | 1 |
| 2024-01-02 | 4800 | 450 | 0 |
| 2024-01-03 | 6200 | 800 | 0 |

### 2. Select Regressors in Predictions Wizard

When running a forecast:
1. Go to **Predictions** → run the wizard
2. Select your **Dataset** (e.g., "Sales with Marketing")
3. Select your **Target** (e.g., "Revenue")
4. Choose **Regressors** (e.g., "Marketing_Spend", "Is_Holiday")
5. Set **Horizon** and **Period** as usual
6. Click **Run Prediction**

The model will automatically incorporate these external factors to improve the forecast.

### 3. How Regressors Improve Forecasts

Prophet uses each regressor's historical relationship with your target to:
- Learn the strength of correlation
- Detect non-linear effects
- Build out-of-sample predictions that account for these drivers

For example, if historical data shows that 1000 in marketing spend = 500 increase in revenue, Prophet will project similar effects into the future.

## Database Schema

Regressors are stored in the `predictions` table as JSON:

```json
[
  {
    "name": "marketing_spend",
    "column": "marketing",
    "description": "Advertising spend in dollars",
    "include_future": true
  },
  {
    "name": "is_holiday",
    "column": "holiday_flag",
    "description": "Holiday indicator (0/1)",
    "include_future": false
  }
]
```

## Python Implementation

### Training (precision_ai.py)

```python
# Add regressors from the dataset
for regressor in regressors:
    name = regressor['name']
    if name in df.columns:
        model.add_regressor(name)

model.fit(df)
```

### Prediction (predict.py)

```python
# Provide future regressor values for forecasting
for regressor in regressors:
    name = regressor['name']
    future_values = regressor['future_values']
    if len(future_values) == periods:
        future[name] = pd.to_numeric(future_values, errors='coerce')

forecast = model.predict(future)
```

## API Reference

### Training Endpoint (POST /api)

```json
{
  "system": "aurai",
  "dataset": [5000, 4800, 6200, ...],
  "date_values": ["2024-01-01", "2024-01-02", ...],
  "project_id": "project_123",
  "freq": "MS",
  "regressors": [
    {
      "name": "marketing_spend",
      "values": [500, 450, 800, ...],
      "future_values": [600, 700, 800, ...]
    }
  ]
}
```

### Prediction Endpoint (POST /predict)

```json
{
  "model_name": "timeseries_xyz",
  "interval": 12,
  "freq": "MS",
  "regressors": [
    {
      "name": "marketing_spend",
      "future_values": [600, 700, 800, ...]
    }
  ]
}
```

## Best Practices

1. **Use stationary data**: If a regressor has a strong trend, difference it before use
2. **Scale your variables**: Normalize large differences in magnitude between regressors
3. **Avoid multicollinearity**: Don't use highly correlated regressors together
4. **Validate relationships**: Use Business Insights to confirm regressor effects make sense
5. **Provide future values**: For forecasting, you must know/estimate future regressor values
6. **Start simple**: Add regressors one at a time and check accuracy improvements

## Example: Marketing Spend Forecast

**Scenario**: E-commerce business forecasting revenue based on marketing spend.

**Data**: 24 months of historical revenue and marketing spend.

**Forecast**: Project 6 months of revenue assuming $700/month marketing budget.

**Result**: Model learns that each $1 in marketing correlates to ~$7 in revenue, and applies this relationship to the forecast.

**Business Impact**: If the model says revenue will be $50K next month with $700 spend, doubling spend to $1400 might project $57K instead of $50K.

## Limitations

- Regressors must have values for all historical periods
- Future regressor values must be provided for forecasting
- Prophet assumes linear relationships (without interaction terms)
- Seasonal patterns are still learned from historical data regardless of regressors

## Next Steps

After implementing regressors, consider:
- **Automated variable selection**: Use correlation analysis to suggest regressors
- **Interaction terms**: Combine multiple regressors for complex effects
- **Regressor lags**: Use past values (e.g., marketing spend from 2 weeks ago)
- **Scenario analysis**: Run multiple forecasts with different assumed future regressor values
