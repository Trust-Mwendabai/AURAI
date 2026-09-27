# Aurai Forecast

AI-powered time series forecasting on XAMPP: a React dashboard, a PHP + MySQL
API, and a Python (Prophet) forecasting service.

```
Aurai/
├─ aurai-forecast-sim-main/   the app
│  ├─ src/                    React frontend (Vite SPA)
│  ├─ api/                    PHP + MySQL REST API  → api/README.md
│  ├─ database/               MySQL schema + migrations
│  ├─ docs/                   architecture & feature notes
│  └─ dist/                   built frontend (what Apache serves)
├─ backend/Python/            Flask + Prophet forecasting service
└─ _old-app/                  superseded first version — safe to delete
```

## Setup

**1. Start MySQL and Apache** from the XAMPP control panel.

**2. Create the database** (once):

```sh
C:\xampp\mysql\bin\mysql.exe -u root < aurai-forecast-sim-main/database/schema.sql
```

**3. Start the forecasting services** (needed for the Predictions page):

```sh
cd backend/Python
pip install flask prophet pandas joblib scikit-learn   # once
python precision_ai.py    # :7000 — trains models
python predict.py         # :7070 — reuses saved models (much faster)
```

**4. Build the frontend:**

```sh
cd aurai-forecast-sim-main
npm install
npm run build
```

**5. Open** http://localhost/Aurai/aurai-forecast-sim-main/dist/

Register an account and you're in. No configuration files to edit — the built
app finds the API at `../api` automatically.

Optional extras — a Gemini key for AI reasoning, and the full walkthrough for
**deploying to cPanel** — are in
[aurai-forecast-sim-main/docs/DEPLOYMENT.md](aurai-forecast-sim-main/docs/DEPLOYMENT.md).

## Development

`npm run dev` starts Vite with hot reload on port 5173. It proxies `/api` to
Apache automatically, so no `.env` is needed — but Apache and MySQL still have
to be running. See `.env.example` if your XAMPP serves the project from a
different host or path.

## Signing in

There is one seeded account:

| Email | Password |
|---|---|
| `admin@aurai.local` | `aurai1234` |

It comes with a 36-month revenue dataset, a trained Prophet forecast, and a
report, so the dashboard has real data in it. Change the password from the
Profile page, or register your own account and delete this one.

## Tests

```sh
cd aurai-forecast-sim-main
npm test              # API + browser suites
npm run test:all      # also trains real Prophet models (slower)
```

They run against the real backend and database — nothing is mocked — but each
suite works inside its own throwaway account, so a test run never touches real
data. See [tests/README.md](aurai-forecast-sim-main/tests/README.md).

## Notes on the interface

**Mobile & Progressive Web App**
- **Mobile-first design**: Fully responsive—optimized for phones first, scales to tablet and desktop
- **Bottom navigation (mobile)**: Native app-style tab bar at bottom with Dashboard, Dataset, Predictions, Analytics, Business Insights
- **App installation**: Install on iOS, Android, or desktop as a native app with icon and app shortcuts  
- **Offline support**: Service worker caches essential pages; app works without internet using cached data
- **Push notifications**: Alerts when forecasts complete or insights are ready (opt-in permission on first load)
- **App shortcuts**: Quick-launch Dashboard, Predictions, or Business Insights from home screen icon menu

**Sidebar (Desktop) & Navigation**
- **Collapsible sidebar**: Click chevron (◀/▶) to toggle between full-width and icon-only views
- **Smart tooltips**: Hover over collapsed icons to see labels with smooth entrance animation
- **Hover effects**: Icons scale (1.25x) and backgrounds highlight on hover for clear visual feedback
- **Hover scrollbar**: Navigation shows scrollbar only on hover—minimal, clean interface
- **Section headers**: "Core" features (Dashboard, Dataset, Predictions, etc.) and "Utilities" (Settings, Profile)
- **Smooth animations**: Collapse/expand uses spring physics for polished motion

**Header & Global Controls**
- **Search bar**: Live search through datasets, forecasts, and reports with ⌘K / Ctrl+K shortcut
- **User profile (far right)**: Avatar, name, theme toggle, and logout button positioned at header end
- **Responsive header**: Mobile shows hamburger menu; desktop shows full search and profile

**Predictions Page**
- **Four-step wizard**: Dataset → Target → Settings → Run with clear step indicator and progress bar
- **Dataset cards**: Selection highlighted with border, checkmark badge, and shadow; hover effects show focus
- **Smart validation**: Missing inputs are flagged; "Next" button disabled until requirements met
- **Forecast comparison**: Select 2+ runs and compare overlaid on one chart; floating "Compare" action bar when selected
- **Export options**: Download as CSV (Excel-ready), JSON, or PDF reports with one click
- **Clear feedback**: Each step has intro text explaining what it does and why it matters

**Workspaces & Team Collaboration**
- **RBAC**: Four roles with granular permissions — Owner (full control), Editor (create/edit), Commenter (view/comment), Viewer (read-only)
- **Invite team members**: Share workspaces with colleagues, assign roles, control access to datasets, forecasts, and reports
- **Audit trail**: Track all workspace activity — who accessed what, when changes were made, full edit history
- **Guest access**: Share specific forecasts with external partners via time-limited invite links (planned)
- **Workspace templates**: Quick setup for common team structures (planned)

**Business Insights — Core Feature**
- **"Why" analysis**: Every forecast explains *why* metrics go up/down, not just the numbers
- **Root cause detection**: Identifies sustained trends, seasonality, momentum shifts in your data
- **Business drivers**: Explains what causes growth (new customers, higher usage, price increases) or decline (competition, market saturation, churn)
- **Business impact**: Specific implications for revenue, capacity needs, headcount, and cash flow
- **Risk scenarios**: Shows outcomes if forecast overshoots/undershoots by 10-20%; highlights uncertainty
- **3 concrete actions**: Next steps tied to specific forecast figures and risks
- **Multiple tones**: Regenerate advice as Balanced, Executive Summary, Detailed Analysis, or Risk-Focused
- **Export & copy**: Download insights as text or copy commentary to clipboard for sharing
- **Visual risk metrics**: Swing, volatility, and uncertainty shown as animated progress bars

**Notifications**
- **In-app toasts**: Smooth animated alerts for forecasts, data updates, and actions
- **Toast positioning**: Above bottom nav on mobile; bottom-left on desktop
- **Desktop notifications**: Browser alerts work when app is minimized or backgrounded  
- **One-time permission**: Asked once on first load; can enable later from settings
- **Auto-dismiss**: Disappear after 4 seconds or close manually with X button
- **Action buttons**: Toasts can include clickable actions for next steps

**Additional UX Improvements**
- **Two-column settings**: Responsive grid layout; Settings and Profile moved to sidebar footer
- **Better contrast**: Metric card icons use higher-contrast backgrounds and borders
- **Progress indicators**: Visual bars for variability, swing, and uncertainty metrics
- **Smooth transitions**: Framer Motion animations throughout for polished feel
- **Responsive spacing**: Mobile padding reduces to 3px; desktop uses 4px for optimal sizing

## How the pieces fit

- The frontend never talks to MySQL directly. Everything goes through
  `src/lib/apiClient.ts` → the PHP API.
- The PHP API owns authentication (bearer tokens in the `sessions` table) and
  scopes every query to the logged-in user, since MySQL has no row-level
  security.
- Running a prediction sends the dataset from MySQL to the Prophet service,
  which fits a model, saves it to `backend/Python/models/`, and returns the
  forecast. A first fit takes up to a minute.
- Accuracy comes from backtesting: the model is fitted on the earlier part of
  your data and scored on a held-back tail, against a flat-line baseline. If it
  fails to beat that baseline, the app says so rather than showing a number you
  might act on.
- Re-running the same forecast reuses the saved model and returns in well under
  a second. Only a change to the dataset, target column or frequency triggers a
  retrain — changing the horizon does not.
- The dashboard, the settings page and the Aurai assistant all read real rows
  from the database — there are no placeholder numbers in the app.
- Dataset cleaning previews what it will change and asks before writing, with
  an undo afterwards — it rewrites stored data, so it never does so silently.
- Forecasts export as CSV (Excel-ready) as well as JSON, and several runs can be
  overlaid on one chart to compare them.
- The Dataset page profiles every column — missing values, spread, outliers —
  so data quality is visible before you spend a minute training on it.
- The Analytics page compares segments within a dataset — which store, product
  or region leads, which is growing, which is erratic, and how concentrated the
  total is. All of it derived from your rows.
- Datasets import from Excel (.xlsx, .xls, .xlsm), CSV and JSON. Excel is parsed
  in the browser; date cells are converted to real dates so the forecaster can
  read them. Only the first sheet of a workbook is imported.
- **Exogenous variables (regressors)** can be incorporated into forecasts — marketing
  spend, holidays, temperature, or any external factor that drives your target metric.
  Prophet learns historical relationships and projects them forward.
- **Automated anomaly detection** flags when actual data deviates significantly
  (beyond the 95% confidence interval) from what was forecasted. Every anomaly can
  be documented with context (e.g., "warehouse strike caused 40% shipment delay").
- **Scenario modeling (what-if analysis)** lets you explore alternative futures by
  adjusting forecast points. Ask "what if we increase marketing by 15%?" and instantly
  see cascading impacts on quarterly and annual totals. Compare multiple scenarios
  side-by-side in charts and tables.
- **Executive PDF Report Builder** packages forecasts into professional, stakeholder-ready
  PDFs with one click. Each report includes the forecast chart, AI business commentary,
  accuracy metrics, and data summary—ready to email or present to executives.
- The assistant does more than look things up: ask it *what should I do about
  this* and it turns your latest forecast into business advice — growth against
  recent actuals, where the peak and trough fall, how volatile the series is,
  and how much weight the model's accuracy justifies putting on any of it.
  It understands your own vocabulary too (asking about "July sales" finds your
  `sales` column), and short follow-ups like *why?* continue the thread.

## Notes

- **Password reset emails aren't sent** — no SMTP is configured. The token is
  stored in `password_reset_tokens`; read it from the database in development.
- `_old-app/` is the previous version, kept only for reference. Nothing in the
  current app reads from it.
