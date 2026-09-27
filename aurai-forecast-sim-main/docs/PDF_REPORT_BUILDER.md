# Executive PDF Report Builder

## Overview

The PDF Report Builder packages your forecasts into professional, stakeholder-ready PDF reports. With a single click, export a polished document containing your forecast chart, AI-generated business insights, key accuracy metrics, and data summaries.

## Why It Matters

Analysts rarely consume forecasts alone—they present them to managers, board members, and stakeholders. The PDF Report Builder bridges that gap by:

- **Saving hours** on manual report compilation
- **Ensuring consistency** with professional formatting
- **Capturing context** — business insights and metrics in one file
- **Enabling quick sharing** via email or Slack without screenshots

## Using the Report Builder

### From the Predictions Page

1. Navigate to **Predictions**
2. Find a forecast in your history
3. Click the **PDF icon** (📄) in the forecast's action buttons
4. A dialog appears confirming report contents
5. Click **Generate PDF**
6. Your browser automatically downloads the report

### From the Business Insights Page

1. Navigate to **Business Insights** and view a forecast's commentary
2. Click the **Download icon** (⬇️) in the top-right corner
3. Select **Generate Executive Report**
4. Review what will be included
5. Click **Generate PDF**
6. Download starts automatically

## What's Included

### 1. Title Page
- Report title (forecast name)
- Generation date and timestamp
- Professional header with Aurai branding

### 2. Key Metrics Section
A formatted table with:
- **Target Column** — what you're forecasting
- **Algorithm** — Prophet (or other model)
- **Forecast Horizon** — periods ahead (e.g., "12 months")
- **Accuracy** — backtest score (or "Not scored")
- **Confidence Band** — width of uncertainty range (e.g., ±15%)
- **Volatility** — historical variability of the target

### 3. Forecast Chart
- High-resolution chart image embedded in the PDF
- Historical data (solid line) flowing into forecast (dashed line)
- Confidence interval band (shaded area)
- Clear axis labels and legend

### 4. AI Assistant Commentary
- **"The Adviser's Read"** — business-focused interpretation of the forecast
- **Root Cause Analysis** — what's driving the trend up or down
- **Business Impact** — what this means for your operations
- **Risk Scenarios** — outcomes if the forecast overshoots or undershoots
- **Recommended Actions** — 3 concrete next steps

### 5. Data Summary Footer
- Dataset name and source
- Report generation timestamp
- Aurai branding and version

## Report Quality & Formatting

### Professional Design
- Clean, minimal corporate styling
- High-contrast text for readability
- Proper spacing and margins (15mm on all sides)
- Single-column layout optimized for printing

### Print-Ready
- Embedded fonts work on all PDF readers
- High-resolution chart rendering (2x scale)
- Optimized for both color and black-and-white printing
- Standard A4 paper size

### Mobile-Friendly Download
- Single-click download to your device
- Automatic filename based on forecast name
- Works on phones, tablets, and desktops

## Technical Details

### Chart Embedding
The PDF captures your interactive chart as a high-resolution image:
- Canvas to PNG conversion (2x scale for clarity)
- Preserves colors and styling
- Handles large datasets gracefully

### Text Wrapping & Pagination
- Long insights text automatically wraps and continues on new pages
- Metrics table stays on one page
- Chart positioned optimally to minimize blank space

### Fallback Handling
- If chart capture fails, report still generates without the chart
- Error message appears so you know what's missing
- Insights and metrics remain complete

## API & Implementation

### Frontend Components

**ReportBuilder.tsx** — Dialog component for report generation

```tsx
<ReportBuilder
  prediction={prediction}        // Forecast object
  chartRef={chartRef}            // Reference to chart DOM
  insights={insightsData}        // AI commentary & metrics
  isOpen={showDialog}            // Show/hide dialog
  onClose={handleClose}          // Close callback
/>
```

### Report Generator Utility

**reportGenerator.ts** — PDF generation logic

```ts
import { generateReportFromPrediction } from '@/lib/reportGenerator';

// Generate and download a report
await generateReportFromPrediction(
  prediction,    // Forecast object
  chartElement,  // HTML chart reference
  insights       // AI insights object
);
```

### Data Structure

Reports expect:
```typescript
interface ReportData {
  forecastName: string;       // e.g., "Sales 2025"
  targetColumn: string;       // e.g., "revenue"
  algorithm: string;          // e.g., "Prophet"
  horizon: number;            // e.g., 12
  period: string;             // e.g., "month"
  accuracy: number | null;    // e.g., 87.5
  advice: string;             // AI commentary
  metrics: {
    swing: number;            // Peak-to-trough %
    volatility: number;       // Std dev %
    uncertainty: number;      // End range %
    bandWidth: number;        // Confidence band %
  };
  forecastData: Array<{       // Forecast points
    label: string;
    value: number;
    low: number;              // Lower confidence bound
    high: number;             // Upper confidence bound
  }>;
}
```

## Workflow Examples

### Sales Manager
1. Run forecast for Q1-Q4 revenue
2. Visit Business Insights to read AI commentary
3. Click "Generate PDF" to create stakeholder report
4. Attach to email with quarter outlook
5. Share with executive team

### Finance Analyst
1. Compare 2-3 forecast runs on Predictions page
2. Select the most accurate run
3. Click PDF icon to generate report
4. Embed in board materials
5. Archive for audit trail

### Operations Director
1. Forecast staffing needs based on revenue trend
2. Generate PDF with AI-recommended hiring timeline
3. Share with HR and CFO
4. Use as basis for budget request

## Best Practices

1. **Generate after insights** — Read the AI commentary first to understand the forecast before sharing
2. **Review for accuracy** — Check that the report reflects your business logic before sending
3. **Add context** — In covering emails, explain your assumptions (e.g., "assumes Q2 marketing spend of $50K")
4. **Archive reports** — Keep PDFs in your records for audit and comparison over time
5. **Regenerate if needed** — If you re-run the forecast, generate a fresh report rather than sharing the old one

## Troubleshooting

### Chart doesn't appear in PDF
- Ensure the chart is visible in the browser before generating
- Try refreshing the page and regenerating
- The report will still include text and metrics even if chart capture fails

### PDF has incorrect metrics
- Verify the accuracy score appears in the Predictions list
- Check that Business Insights loaded before generating
- Regenerate the report after waiting for full page load

### Filename looks odd
- Special characters in forecast names are replaced with hyphens
- Example: "Q1 Sales (Updated)" becomes "q1-sales-updated.pdf"

### File doesn't download
- Check browser download settings (may auto-block PDFs)
- Try a different browser
- Ensure popup blocker isn't active

## Next Steps

**Planned enhancements:**
- Scenario comparison tables in reports (if multiple scenarios exist)
- Anomaly summary (flagged deviations from confidence intervals)
- Custom branding/logo injection
- Email delivery (send PDF directly via API)
- Report scheduling (auto-generate weekly reports)
- Template customization (choose report sections)

## Integration

The PDF Report Builder is used in:
- **Predictions page** — Export historical forecasts
- **Business Insights page** — Export current analysis
- **Shareable links** (future) — Generate pre-filled PDF reports for team members

See [ANOMALY_DETECTION_AND_SCENARIOS.md](ANOMALY_DETECTION_AND_SCENARIOS.md) for exporting scenarios alongside forecasts.
