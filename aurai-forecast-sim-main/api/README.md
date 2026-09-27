# Aurai Forecast — PHP + MySQL API

This is the backend that replaces Supabase (Postgres + Auth + RLS). It is a
small, dependency-free PHP API served by XAMPP's Apache, backed by the MySQL
schema in [`/database`](../database/README.md).

## Setup

1. **Start MySQL and Apache** from the XAMPP control panel.

2. **Create the database:**

   ```sh
   C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
   ```

   (or run the files in `database/migrations/` in numeric order).

3. **Check credentials** in [`config.php`](config.php) — it defaults to XAMPP's
   `root` with an empty password. Change `DB_USER`/`DB_PASS` if yours differ.

4. **Nothing to point at the API.** The production build calls `../api`
   relative to itself, and `npm run dev` proxies `/api` to Apache (see
   `vite.config.ts`). Both assume Apache serves the project from
   `http://localhost/Aurai/aurai-forecast-sim-main/`; see `.env.example` if
   yours differs.

5. **Optional — enable AI reasoning.** Copy `config.local.example.php` to
   `config.local.php` and paste in a [Gemini API key](https://aistudio.google.com/apikey):

   ```php
   return [
       'gemini_api_key' => 'your-key-here',
       'gemini_model'   => 'gemini-3.6-flash',
   ];
   ```

   `GEMINI_API_KEY` in the environment overrides the file, so a deployment
   needs no edit. Skip this step entirely and the app still works — see
   [AI reasoning](#ai-reasoning).

> **The key is server-side only.** `config.local.php` is gitignored, and every
> Gemini call is made from PHP. Never put the key in `.env` or in any `VITE_*`
> variable: Vite inlines `VITE_*` values into the built JavaScript, where
> anyone who opens the app can read them.

## Authorization model

Postgres RLS enforced `auth.uid() = user_id` at the database layer. MySQL has no
equivalent, so **every** query here filters by the authenticated user explicitly:

- `require_auth()` resolves the `Authorization: Bearer <token>` header against
  the `sessions` table and returns the user id.
- Every `SELECT`/`UPDATE`/`DELETE` carries `WHERE ... AND user_id = :uid`.
- Every `INSERT` takes `user_id` from the session, never from the request body.
- `messages` are scoped through a join on their owning `conversations` row.

All SQL uses PDO prepared statements.

## Endpoints

All paths are relative to the API base. All except the `auth` routes below
require a bearer token.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | — | Create account, returns `{token, user}` |
| POST | `/auth/login` | — | Sign in, returns `{token, user}` |
| POST | `/auth/logout` | yes | Delete the current session row |
| GET | `/auth/me` | yes | Current user + profile |
| PATCH | `/auth/profile` | yes | Update name/avatar/plan/preferences/email/password |
| POST | `/auth/forgot-password` | — | Issue a reset token (see caveat below) |
| POST | `/auth/reset-password` | — | Consume token, set new password |
| GET | `/stats` | yes | Dashboard aggregates: counts, average accuracy, per-month activity, latest forecast |
| GET | `/settings` | yes | This user's saved preferences |
| PUT | `/settings` | yes | Replace this user's preferences |
| POST | `/analytics` | yes | Segment totals, share, growth, volatility and concentration for a dataset |
| POST | `/assistant` | yes | Answer a question about this user's workspace, or give business advice on their latest forecast |
| POST | `/forecast` | yes | Train a Prophet model on a dataset and return its forecast |
| GET | `/datasets` | yes | List (newest first) — metadata plus `row_count`, **without** `rows` |
| GET | `/datasets/{id}` | yes | Single dataset, including its `rows` |
| POST | `/datasets` | yes | Create, returns `{id}` |
| PATCH | `/datasets/{id}` | yes | Update name/rows/meta |
| DELETE | `/datasets/{id}` | yes | Delete |
| GET | `/predictions` | yes | List (newest first) |
| POST | `/predictions` | yes | Create, returns `{id}` |
| DELETE | `/predictions/{id}` | yes | Delete |
| GET | `/conversations` | yes | List (recently updated first) |
| POST | `/conversations` | yes | Create, returns `{id}` |
| PATCH | `/conversations/{id}` | yes | Rename |
| DELETE | `/conversations/{id}` | yes | Delete (cascades to messages) |
| GET | `/conversations/{id}/messages` | yes | Messages in insertion order |
| POST | `/messages` | yes | Append a message, touches the conversation |
| POST | `/model-arena` | yes | Compare Prophet, ARIMA, Holt-Winters, XGBoost, LightGBM and an ensemble on one dataset/target, fitted in parallel |
| POST | `/forecast/tune` | yes | Grid-search Prophet's changepoint/seasonality hyperparameters against the default and return whichever backtests better |
| POST | `/anomalies/detect` | yes | Compare a prediction's forecast periods against dataset rows that have since arrived for the same dates, recording any outside the low/high band |
| GET | `/anomalies` | yes | List, filterable by `prediction_id`, date range, `only_unacknowledged` |
| POST | `/anomalies` | yes | Create manually (normally created by `/anomalies/detect`) |
| PATCH \| DELETE | `/anomalies/{id}` | yes | Acknowledge / delete |
| GET | `/scenarios` | yes | List for a `prediction_id` (What-If scenarios) |
| POST | `/scenarios` | yes | Create — `{prediction_id, name, adjustments, results}` |
| PATCH \| DELETE | `/scenarios/{id}` | yes | Update / delete |
| POST | `/scenarios/compare` | yes | Compare several scenario ids at once |
| GET \| POST | `/workspaces` | yes | List workspaces the user belongs to / create one (creator becomes `owner`) |
| GET \| PATCH \| DELETE | `/workspaces/{id}` | yes | Detail / update (owner) / delete (owner) |
| GET \| POST | `/workspaces/{id}/members` | yes | List members / invite by email |
| PATCH \| DELETE | `/workspaces/{id}/members/{memberId}` | yes | Change role / remove (owner) |
| GET | `/workspaces/{id}/audit` | yes | Audit log of invites, role changes, deletions |
| GET | `/saved-reports` | yes | **This is the live Reports feature** — list auto-generated reports, filterable by `workspace_id`/`pinned` |
| POST | `/saved-reports` | yes | Create (used internally by `/auto-reports/generate`) |
| GET \| PATCH \| DELETE | `/saved-reports/{id}` | yes | Detail / rename or edit / delete |
| POST | `/auto-reports/generate` | yes | Build (or rebuild) a report for a prediction — AI narrative when Gemini is configured, template-only otherwise — and upsert it into `saved_reports` |
| GET \| POST | `/schedules` | yes | List / create a Scheduled Refresh (re-run a forecast on a daily/weekly/monthly cadence) |
| PATCH \| DELETE | `/schedules/{id}` | yes | Update (rename, change cadence, enable/disable) / delete |
| POST | `/schedules/{id}/run` | yes | Run it right now, regardless of `next_run_at` |
| GET \| POST \| DELETE | `/forecast-bookmarks` | yes | Star a forecast for quick access from elsewhere in the app |
| GET | `/export/forecast/{id}/csv` | yes | Recorded history + forecast values with bounds, as CSV |
| GET | `/export/dataset/{id}/csv` | yes | A dataset's raw rows, as CSV |

> **`/reports` (singular) still exists in `resources.php` but is legacy and unused** —
> nothing in the UI writes to the `reports` table any more. Every report a user
> actually sees on the Reports page lives in `saved_reports`, created via
> `/auto-reports/generate` and listed through `/saved-reports`. Don't build new
> features against `/reports`; it's kept only because `reports_save`/`_get`/`_delete`
> haven't been deleted yet.

The frontend never calls these directly — it goes through
[`src/lib/apiClient.ts`](../src/lib/apiClient.ts), with
[`src/lib/db.ts`](../src/lib/db.ts) and [`src/lib/auth.ts`](../src/lib/auth.ts)
keeping the same exported function signatures they had under Supabase.

### The `/forecast` endpoint

`POST /forecast` takes `{datasetId, target, dateColumn?, horizon, period}`. It
loads the dataset from MySQL, picks the date column (auto-detecting the one whose
values most consistently parse as dates when `dateColumn` is omitted), and posts
the series to the Flask + Prophet service on port 7000. It returns forecast
points as `{i, label, value, low, high}` plus `accuracy`, `mape` and
`model_name`.

**How accuracy is measured.** The model is scored by backtesting: Prophet is
fitted on the earlier part of the series, asked to predict the held-back tail,
and the error of *those* predictions becomes the score (`accuracy = 100 −
MAPE`, floored at 0). A flat-line forecast is scored on the same holdout and
returned as `baselineMape`, so the caller can tell whether the model beat doing
nothing — on unpredictable data it often does not. A series shorter than 10
rows is not scored at all, and `accuracyNote` says why.

This replaced a calculation that compared a flat line against the actuals and
reported that as the model's accuracy; Prophet's own predictions were never
involved, so the old figure described the data's volatility rather than the
model's skill.

**Model reuse.** Fitting a Prophet model can take a minute, so a previously
trained model is reused when it is still valid. A saved model can project any
horizon, so only a change to the **dataset**, the **target column** or the
**frequency** forces a retrain — changing just the horizon does not. A dataset
edit invalidates the model by comparing `datasets.updated_at` against the
prediction's `created_at`. The response carries `cached: true` when a saved
model answered it. Cached runs return in well under a second.

Models are named `timeseries_<hash of dataset+target+frequency>`, so forecasting
a different column of the same dataset gets its own model instead of
overwriting the first.

Three Python services back this: the trainer, the predictor, and Model Arena.

```sh
cd backend/Python
python precision_ai.py   # :7000 — fits/saves Prophet models, and /tune for hyperparameter search
python predict.py        # :7070 — forecasts from a saved Prophet model
python model_arena.py    # :7080 — /compare (all models) and /run (single non-Prophet model)
```

If the predictor is down or a model file is missing, `/forecast` falls back to
a fresh fit rather than failing. `algorithm` other than `prophet` on `/forecast`
(and all of `/model-arena`) is dispatched to `model_arena.py` instead — it must
be running for ARIMA, Holt-Winters, XGBoost, LightGBM or Ensemble forecasts to
work. All three bind to localhost only.

### The `/assistant` endpoint

`POST /assistant` takes `{question}` and returns `{answer}` as Markdown-ish text
(only `**bold**` is used, and the client renders it as React nodes rather than
HTML, since answers contain user-supplied dataset names).

Beyond lookups — accuracy, datasets, forecasts, reports, a workspace summary —
it produces **business insights**: growth against recent actuals, where the peak
and trough fall, the historical volatility of the series, and how much the
model's accuracy justifies acting on the result. All of it is computed from the
user's own rows; nothing is invented and no external service is called.

**How a question is routed.** Every intent is scored against a weighted phrase
list and the highest wins, rather than the first check that happens to match.
Multi-word phrases outrank single words, so *"how many forecasts"* reaches the
forecast history instead of being captured by a stray `forecast`. Input is
normalized first, so casing and punctuation don't matter.

Two fallbacks catch what phrasing alone misses:

1. **The user's own vocabulary.** If a question names one of their datasets or
   target columns — *"show me July sales"*, *"my weather data"* — it routes on
   that. This also overrides a weak keyword match, which is why *"status of my
   weather data"* returns the dataset rather than a workspace summary.
2. **Conversation context.** Pass `conversationId` and a short follow-up
   (*"why?"*, *"tell me more"*) resumes the intent of the last substantive
   question in that thread. History is read scoped to the signed-in user, so a
   conversation id belonging to someone else resolves to nothing.

An unrecognized question never returns empty: it gets a list of what the
assistant can answer, adjusted to whether the user actually has data loaded.

## AI reasoning

With a key configured, `/assistant` answers through Gemini instead of the intent
router. [`lib/workspace_context.php`](lib/workspace_context.php) assembles a
factual snapshot of the signed-in user's datasets, forecasts and reports — plus
the last few turns of the conversation — and the model answers from that alone.
Responses carry `"reasoned": true`.

The prompt draws one line: **facts are given, judgement is expected.** Figures,
names and dates must come from the snapshot, but the interpretation and the
advice are the model's to give. An earlier version forbade going beyond the data
at all, and it answered *"what should I focus on next quarter"* by reporting that
the workspace contained no strategic recommendations — accurate, and useless.

**It degrades rather than breaks.** [`lib/gemini.php`](lib/gemini.php) returns
`null` on every failure — no key, an unreachable network, a safety block, an
exhausted quota, or a reply truncated by the token limit — and the deterministic
handlers answer instead. A user without a key loses the reasoning, not the
feature.

**The free tier meters requests per model**, at 20 a day each, so a spent quota
on one model says nothing about the next. Rather than give up on reasoning, the
client works down a chain of models (`GEMINI_FALLBACK_MODELS`) whenever one
answers 429, 404 or a 503 that survived its retry — all three are properties of
that model, not of the request. Only when every model in the chain is
unavailable does the built-in analysis take over. A deployment that wants one
specific model sets `gemini_models` in `config.local.php`, which replaces the
chain outright.

`POST /insights` goes through the same path: `business_insights()` tries the
model and falls back to the built-in analysis, so the endpoint and the
assistant's "what should I do" intent can never drift apart.

Three details worth knowing before changing the client:

- **`maxOutputTokens` caps thinking *and* prose from one budget**, and thinking
  runs first. Asked for 900 tokens, the model spent 620 reasoning and returned
  half a sentence. The caller's figure is now treated as the answer length, with
  `GEMINI_THINKING_HEADROOM` added on top.
- **Join every `part` of the reply, not just `parts[0]`.** A thinking model
  splits its answer across parts, and reading only the first returned the
  opening paragraph as though it were the whole thing — a truncation the API
  never reports, because as far as it is concerned the reply finished. Parts
  flagged `thought` are reasoning and are skipped.
- **`{"reasoning": false}`** in the request body forces the deterministic path.
  The routing tests use it: a model rewords itself between identical calls, so
  routing asserted through its prose would pass or fail at random, and the
  fallback that serves every user during an outage would go untested.

### Login throttling

Failed sign-ins are counted per email **and** client IP in `login_attempts`, so
an attacker cannot lock a victim out of their own account from a different
address. After 8 failures the endpoint returns 429 for 15 minutes; a successful
sign-in clears the counter. Rows are keyed by a hash, so no email or IP is
stored in the clear.

Logging in also prunes expired `sessions` and `password_reset_tokens`, which is
rare enough to be a sensible moment for the cleanup.

## Known gaps

- **Password reset emails are not sent.** `/auth/forgot-password` stores a
  hashed token in `password_reset_tokens` but there is no SMTP configured, so
  nothing delivers the link. Either wire up `mail()`/PHPMailer, or read the
  token out of the database during development. The reset page expects
  `/reset-password?email=...&token=...`.
- **Google OAuth is gone.** It was provided by Lovable Cloud on top of Supabase
  and has no equivalent here, so the "Continue with Google" buttons were
  removed rather than left as dead controls.
- **Dataset rows are stored inline as JSON.** `datasets.rows` holds the whole
  parsed file, so a very large import is a very large row. The list endpoint
  avoids shipping it, but a real file-upload flow (`storage_path`) would scale
  better.
- **Scheduled Refreshes has no real cron.** It re-runs a forecast on a cadence
  (daily/weekly/monthly), but a due schedule only actually executes the next
  time `run_due_schedules()` gets called from `stats_get()` — i.e. the next
  time anyone on the account loads the dashboard. A schedule with nobody
  visiting the app simply waits. See `api/schedules.php`'s file header.
