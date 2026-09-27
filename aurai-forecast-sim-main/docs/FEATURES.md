# Features

Page-by-page walkthrough. All pages below live under the authenticated layout (`src/routes/AppLayout.tsx`), which redirects to `/login` when there is no valid session token.

## `/dashboard`
Overview screen: four stat tiles (forecasts run, datasets, average accuracy, reports), a chart of the most recent forecast with its confidence band, a "Recent forecasts" list, and a per-month activity bar chart.

- Every figure comes from the `/stats` endpoint, which aggregates this user's own rows in SQL: forecasts run, datasets (and their total row count), average accuracy, and reports. The headline chart plots the most recent forecast, and the bar chart counts forecasts per month over the last year. With an empty workspace the page shows a prompt to import a dataset rather than placeholder numbers.

## `/dataset`
Dataset import and preparation.

- **Import**: drag-and-drop Excel (`.xlsx`, `.xls`, `.xlsm`), CSV or JSON. Spreadsheets are parsed in the browser with SheetJS, loaded lazily so the parser is only fetched when a workbook is opened. Excel date cells are converted to ISO dates so the forecaster can read them, and only the first sheet is imported — a workbook with more sheets says so on import.
- **Preview**: line/bar/area/pie charts plus a paginated, sortable table of the parsed rows. The plotted value and label columns are selectable, rather than always defaulting to the first numeric column.
- **Columns**: a per-column profile — type, missing count and share, distinct values, and for numeric columns min, max, mean, median, standard deviation and how many values sit beyond three standard deviations. Quality problems are called out in plain language above the table: a column that is largely empty, one that never varies (no signal), one whose values are all unique (an identifier, not something to forecast), and outliers. It is far cheaper to spot these here than after a minute of training.
- **Cleaning**: remove nulls, replace nulls with 0, remove duplicates, trim whitespace. Each one previews its effect first ("will remove 3 of 120 rows") and waits for confirmation, then offers a one-click undo that restores the exact prior rows. A cleaning step that would change nothing says so instead of writing.
- **Target selection**: choosing which column to forecast is stored only in `localStorage` (`aurai_target_<datasetId>`), not in the database. It only becomes durable once a prediction is actually run (`predictions.target`).

## `/predictions`
A 4-step wizard: select dataset → select target column → set horizon/period → run. Each step opens with a short instruction, the selected dataset is marked with a coloured border, tick and label (not just a glow, which is invisible on a light background), and the Next button says what is missing rather than sitting dead.

- "Run" posts to the PHP `/forecast` endpoint, which sends the dataset to the Flask + Prophet services in `backend/Python/`. Prophet fits a model, saves it to `backend/Python/models/`, and returns forecast points with real confidence bounds plus an accuracy/MAPE score.
- Alongside accuracy, the result reports how **wide the confidence band** is — Tight, Moderate or Wide. Accuracy says how well the model did on history; the band says how sure it is about the future, and a model can score well while still returning a range too wide to plan against.
- Accuracy is measured by backtesting — fitting on the earlier part of the series and scoring the predictions against a held-back tail. A flat-line baseline is scored alongside, and the page warns when the model failed to beat it. Series under 10 rows are not scored, with the reason shown.
- A first fit takes up to a minute; re-running the same forecast reuses the saved model and returns in well under a second. Changing only the horizon still reuses it — editing the dataset, target column or frequency retrains.
- Results are persisted via `addPrediction`.
- Below the wizard, a searchable "Prediction History" list is backed by real `predictions` rows. Tick two or more (up to four) to **overlay them on one chart**, aligned by step so runs covering different dates can still be compared on shape, with a table giving each run's accuracy, span and overall change. Each run exports as **CSV** (with a provenance header — target, model, horizon, accuracy — and a UTF-8 BOM so Excel opens it correctly) or as JSON for the full record.

## `/analytics`
Segment comparison over a dataset — the idea carried over from the original app's Retail Analytics screen, but computed from real rows rather than the hardcoded arrays that version displayed.

- Pick a dataset, a column to **group by** (product, region, store, channel) and a numeric column to **measure**. The group-by default picks the categorical column with the fewest distinct values, since grouping by a date column would give one "segment" per row.
- For each segment: total, share of the whole, average, **growth** (later half of its history against the earlier half), **volatility** (how far it swings around its own average) and its peak month.
- Headline tiles call out the leader, the fastest grower and the **concentration** — how many segments make up 80% of the total, which is the standard read on whether losing one would hurt.
- A plain-language summary interprets all of it, and a monthly timeline shows the combined total over time.
- Everything is derived server-side by `/analytics` from the stored rows; nothing is simulated.

## `/aurai`
A chat-style assistant.

- Backed by real `conversations`/`messages` tables (threads persist, can be renamed/deleted).
- Replies come from the PHP `/assistant` endpoint, which answers from SQL over this user's own data. It is deterministic rather than a language model, and makes no external calls.
- Answers explain rather than just report: an accuracy figure comes with a verdict on whether that's good, a forecast comes with its direction, magnitude and how wide the confidence band is.
- **Business insights** (*"what should I do about this?"*) reads the latest forecast together with the history behind it and gives planning advice: growth against recent actuals, where the peak and trough land, how volatile the series has been, and how much the model's accuracy justifies acting on it. Every figure is derived from the user's own rows.
- Questions are routed by scoring weighted phrases rather than first-match-wins, and the matcher also recognises the user's own dataset names and column headers — so *"show me July sales"* finds the forecast for their `sales` column. Casing and punctuation are ignored.
- Short follow-ups (*"why?"*, *"tell me more"*) resume the previous question's topic by reading that conversation's history, scoped to the signed-in user. Anything unrecognised returns a list of what the assistant can answer, never an empty reply.
- The conversation list is a collapsible overlay rather than a fixed column, so the thread gets full width. Threads are auto-titled from their first message.
- Conversations and messages are stored in the database.


## `/reports`
A rich-text report editor (`contentEditable` + `document.execCommand`).

- Backed by the `reports` table (`title`, `body` as HTML).
- Autosaves every 4 seconds, but only when something has actually changed, and flushes pending edits when you leave the editor. A status indicator shows saved / unsaved state, and closing the tab with unsaved work warns first.
- **Insert a forecast** from the toolbar: the chart is embedded as inline SVG (sharp in PDF, and a fraction of the size of a rasterised image) with an optional block of written business advice for the same run. Writing up a forecast no longer needs a screenshot.
- Export to PDF (via `window.print()`), JSON, or plain text. The report list shows a plain-text excerpt built server-side — the stored HTML is never rendered outside the editor.

## `/settings`
UI/forecast preferences: system name, company name, "glass" intensity, default algorithm, forecast horizon, AI model choice, business type.

- Persisted to the `user_settings` table through `/settings`, with a `localStorage` copy used only to paint the first frame before the fetch resolves. Saves are debounced, so editing a field costs one write rather than one per keystroke.
- The values actually drive behavior: workspace/company name appear in the sidebar, glass blur feeds the `--glass-blur` CSS variable, and the default horizon and period pre-fill the Predictions wizard.

## `/profile`
Account details: name, email, password, plan.

- Backed by the `profiles` table via `updateProfile`.
- Shows aggregate counts of the user's datasets/predictions/reports.
- Export the whole workspace as JSON or PDF.

## Auth pages
`/login`, `/register`, `/forgot-password`, `/reset-password` — Supabase email/password, plus Google OAuth via the Lovable Cloud broker (`@lovable.dev/cloud-auth-js`), which resolves to a Supabase session (`supabase.auth.setSession(...)`).

## `/` (index)
Checks for an active session and redirects to `/dashboard` (if signed in) or `/login` (if not). No content of its own.

## Summary: real vs. simulated

| Feature | Persisted in DB? | Computation |
|---|---|---|
| Auth / sessions | Yes (Supabase Auth) | Real |
| Datasets | Yes (`jsonb`, not files) | Real (client-side parsing) |
| Dataset target column | No (`localStorage` only) | — |
| Predictions | Yes | Real — Prophet model trained server-side |
| Reports | Yes | Real |
| Conversations / messages | Yes | Replies are real SQL answers about your data (not an LLM) |
| User settings | Yes (`user_settings`) | Drives sidebar, blur, and forecast defaults |
| Dashboard KPIs | Yes | Aggregated server-side by `/stats` |
| Segment analytics | Yes | Computed by `/analytics` from stored rows |
| Global search | Yes | Searches your datasets, forecasts and reports |
