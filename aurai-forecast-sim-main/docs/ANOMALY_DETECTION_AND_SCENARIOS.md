# Anomaly Detection & Scenario Modeling Guide

## Automated Anomaly Detection

### Overview

Anomaly Detection automatically monitors incoming actual data and flags when it deviates significantly from forecasted values. This helps you:

- **Detect forecast errors early** — Know immediately when reality diverges from predictions
- **Identify business anomalies** — Spot unusual events (warehouse strikes, product launches, market shifts)
- **Track model performance** — Monitor how often forecasts miss their confidence intervals
- **Build institutional knowledge** — Document why anomalies occurred for future reference

### How It Works

When actual data is recorded, Aurai compares it against your forecast confidence interval:

```
Upper Bound: 6,500
Forecast:   6,000  ← Expected value
Actual:     5,200  ← Your recorded data
Lower Bound: 5,500

Status: ANOMALY DETECTED
Reason: Actual fell 800 units below forecast
Impact: 1.6 sigma deviation (unusual but not extreme)
```

### Confidence Intervals

Aurai uses the Prophet model's uncertainty estimates to define bounds:

| Confidence Level | Meaning |
|---|---|
| 95% | 95% of time, actual falls within these bounds |
| Rare Miss | 5% of the time, actual exceeds these bounds (normal) |
| Extreme Miss | >3 sigma deviation — something significant happened |

### Viewing Anomalies

**On the Predictions page:**
1. Click "View Anomalies" after a forecast completes
2. Anomalies appear as red or blue highlights on the chart
3. Each anomaly shows:
   - Date and actual value
   - Forecast and bounds
   - Deviation magnitude (in sigmas)
   - Your notes (if documented)

**On the Analytics page:**
1. Dashboard shows anomaly count for each active forecast
2. Filter by date range to track patterns
3. Export anomaly log for analysis

### Documenting Anomalies

Add context to every anomaly you notice:

```
Date: 2025-03-15
Actual: 4,200
Forecast: 5,500
Reason: "Warehouse strike reduced shipments by 40%"
Expected Duration: "3 weeks"
Impact: "Delayed revenue recovery"
```

This builds a historical record of *why* forecasts missed, which informs future model improvements.

### Anomaly Severity

Aurai categorizes anomalies by deviation magnitude:

| Sigma | Severity | Frequency | Action |
|---|---|---|---|
| <1 | Within normal | ~68% of data | None |
| 1-2 | Expected variance | ~27% of data | Monitor |
| 2-3 | Unusual | ~4% of data | Investigate |
| >3 | Extreme | <0.3% of data | **Document immediately** |

---

## Scenario Modeling (What-If Analysis)

### Overview

Scenario Modeling lets you explore alternative futures by adjusting forecast points. Ask questions like:

- "What if we increase marketing spend by 15%?"
- "What if the competitor cuts prices by 10%?"
- "What if we launch in Q3 instead of Q2?"
- "What if demand grows 20% instead of 5%?"

### How It Works

1. **Start with baseline** — Use your original forecast as-is
2. **Create scenarios** — Adjust specific periods (e.g., "Q2 revenue +20%")
3. **Calculate impacts** — Aurai recalculates totals and trends for the scenario
4. **Compare outcomes** — See side-by-side metrics, charts, and cumulative impact
5. **Share analysis** — Export scenarios in reports for stakeholders

### Creating a Scenario

**Example: Marketing Investment**

```
Baseline Forecast:
Q1: $5,000 | Q2: $5,200 | Q3: $5,400 | Q4: $5,600

Scenario: "Aggressive Marketing"
- Q2: +$500 (increase marketing spend, expect +10% revenue)
- Q3: +$700 (continue campaign, stronger impact)
- Q4: +$600 (sustained momentum)

Result:
Q1: $5,000 | Q2: $5,700 | Q3: $6,100 | Q4: $6,200
Annual Impact: +$1,800 (+8.2% vs baseline)
```

### Scenario Types

| Scenario | Use Case | Example |
|---|---|---|
| **Upside** | Best case / aggressive growth | "Accelerated expansion" |
| **Downside** | Worst case / recession | "Market contraction" |
| **Conservative** | Cautious assumption | "Flat growth" |
| **Optimistic** | Ideal conditions | "Viral marketing success" |
| **Custom** | Specific business event | "New product launch" |

### Calculated Metrics

For each scenario, Aurai shows:

- **Period totals** — Revenue/units for each month/quarter
- **Cumulative impact** — How much better/worse than baseline
- **Growth rate** — Trend compared to baseline
- **Peak/trough** — Highest and lowest points
- **Standard deviation** — Volatility of the scenario

### Comparing Scenarios

View multiple scenarios side-by-side:

```
Metric             | Baseline | Conservative | Optimistic | Difference
Annual Revenue     | $62,500  | $60,200      | $68,900    | +$8,400
Peak Month         | $5,600   | $5,200       | $6,100     | +$900
Average Monthly    | $5,208   | $5,017       | $5,742     | +$725
Growth vs Q1       | 12%      | 4%           | 22%        | +18pp
```

### Cascading Effects

When you adjust a forecast period, Aurai can model cascading impacts:

- **Inventory effects** — Adjusted sales impact stock levels
- **Staffing needs** — Adjusted revenue drives headcount planning
- **Cash flow** — Time-shifted revenue impacts payment cycles
- **Trend extrapolation** — Adjusted points influence downstream forecast

Example: Increase Q2 sales by 20% → inventory model adjusts Q3-Q4 planning → staffing model adds headcount → cash flow model reflects higher working capital needs.

### Best Practices

1. **Start with baseline** — Keep the original forecast for comparison
2. **One variable at a time** — Adjust marketing, OR price, but not both initially
3. **Document your assumptions** — "This assumes competitor doesn't respond"
4. **Test extreme scenarios** — 50% upside and downside to stress-test plans
5. **Share early** — Get stakeholder feedback before finalizing assumptions
6. **Track actuals** — Use anomaly detection to validate scenario assumptions over time

### Exporting Scenarios

Include scenarios in reports to stakeholders:

- **Chart comparison** — Visual side-by-side of 2-4 scenarios
- **Metric table** — Key numbers for each scenario
- **Narrative summary** — "This assumes X; if Y happens, expect Z"
- **Confidence levels** — How certain you are of each assumption

---

## API Reference

### Anomaly Detection Endpoints

**List Anomalies (GET /anomalies)**
```json
{
  "prediction_id": "pred_123",
  "start_date": "2025-01-01",
  "end_date": "2025-03-31",
  "only_unacknowledged": false
}

Response:
[
  {
    "id": "anom_456",
    "date": "2025-03-15",
    "actual_value": 4200,
    "forecasted_value": 5500,
    "lower_bound": 5100,
    "upper_bound": 5900,
    "deviation_sigma": 1.8,
    "anomaly_type": "below_lower",
    "note": "Warehouse strike",
    "acknowledged": true
  }
]
```

**Add Anomaly Note (POST /anomalies/:id)**
```json
{
  "note": "Warehouse strike reduced shipments by 40%",
  "acknowledged": true
}
```

### Scenario Modeling Endpoints

**Create Scenario (POST /scenarios)**
```json
{
  "prediction_id": "pred_123",
  "name": "Aggressive Marketing",
  "description": "20% increase in Q2-Q4 revenue due to marketing campaign",
  "adjustments": [
    {"period": 2, "value": 5700, "reason": "Q2 marketing launch", "original": 5200},
    {"period": 3, "value": 6100, "reason": "Campaign continues", "original": 5400},
    {"period": 4, "value": 6200, "reason": "Sustained momentum", "original": 5600}
  ],
  "is_baseline": false
}

Response:
{
  "id": "scen_789",
  "results": {
    "total": 62600,
    "vs_baseline": 2100,
    "percent_change": 3.5,
    "average_monthly": 5217
  }
}
```

**Compare Scenarios (POST /scenarios/compare)**
```json
{
  "scenario_ids": ["scen_baseline", "scen_optimistic", "scen_conservative"]
}

Response:
{
  "comparison_id": "comp_101",
  "scenarios": [
    {"id": "scen_baseline", "name": "Baseline", "total": 60500, ...},
    {"id": "scen_optimistic", "name": "Optimistic", "total": 68900, ...},
    {"id": "scen_conservative", "name": "Conservative", "total": 59200, ...}
  ]
}
```

**List Scenarios (GET /scenarios?prediction_id=...)**
```json
Response:
[
  {"id": "scen_baseline", "name": "Baseline Forecast", "is_baseline": true, ...},
  {"id": "scen_aggressive", "name": "Aggressive Marketing", "is_baseline": false, ...}
]
```

---

## Integration Examples

### Sales Team Workflow

1. Forecast predicts $500K quarterly revenue
2. Q1 actuals come in: mostly on track, one $50K anomaly in March
3. Document: "Customer XYZ accelerated purchase ahead of regulation change"
4. Create scenarios: "What if this pattern repeats in Q2?" → forecast impact
5. Adjust sales plan accordingly

### Finance Planning

1. Start with baseline revenue forecast
2. Create 3 scenarios: Conservative (-10%), Baseline, Optimistic (+15%)
3. Model staffing needs for each: headcount, payroll, hiring timeline
4. Board review: "If upside hits, we hire 15 people. If downside, we pause hiring."
5. Build contingency plans for each scenario

### Product Development

1. Forecast demand for existing product: 10,000 units/month
2. Create scenario: "New feature launch in Q3" → assume +25% demand
3. Engineering calculates: "Need 3 more developers starting May for Q3 readiness"
4. Product calculates: "ROI is +$500K if feature launches on time"
5. Greenlight project based on scenario analysis

---

## Next Steps

After implementing anomaly detection and scenarios:

- **Alerting**: Automatic Slack/email when >2-sigma anomalies occur
- **Root cause analysis**: AI-powered suggestions for why anomalies happened
- **Sensitivity analysis**: Auto-generate "What if this variable changes by X?" scenarios
- **Scenario forecasting**: Project which scenario becomes most likely based on early actuals
- **Executive dashboard**: Real-time anomaly heat map and scenario probability tracker
