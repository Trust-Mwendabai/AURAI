# Architecture

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 7, a plain client-rendered SPA (no SSR) |
| Routing | react-router-dom, hash-based (`#/dashboard`) |
| UI | Tailwind CSS 4, shadcn/ui (Radix primitives), Framer Motion, Recharts |
| Data fetching | `@tanstack/react-query` 5 |
| API | PHP 8 + PDO, served by Apache from [`/api`](../api/README.md) |
| Database | MySQL / MariaDB (`database/schema.sql`) |
| Forecasting | Python: Flask + Prophet — a trainer on :7000 and a predictor on :7070 (`backend/Python/`) |
| Package manager | npm |
| Deploy target | XAMPP (Apache + MySQL) |

Routing is hash-based so the built app can be dropped into any `htdocs`
subfolder and deep links still resolve without Apache rewrite rules.

## Project layout

```
aurai-forecast-sim-main/
├── index.html                  # Vite entry point
├── src/
│   ├── main.tsx                # bootstrap: QueryClient, HashRouter, theme
│   ├── App.tsx                 # all route definitions
│   ├── routes/
│   │   ├── AppLayout.tsx       # authenticated layout: guards session, renders AppShell
│   │   ├── login.tsx, register.tsx, forgot-password.tsx, reset-password.tsx
│   │   ├── dashboard.tsx, dataset.tsx, predictions.tsx
│   │   ├── analytics.tsx       # segment comparison across a dataset
│   │   ├── aurai.tsx           # assistant — answers from the /assistant endpoint
│   │   ├── reports.tsx, settings.tsx, profile.tsx
│   │   └── not-found.tsx
│   ├── components/             # AppShell, GlassCard, ThemeToggle, ui/ (shadcn)
│   └── lib/
│       ├── apiClient.ts        # fetch wrapper: base URL + bearer token
│       ├── auth.ts             # register/login/logout/session/profile
│       ├── db.ts               # CRUD for datasets/predictions/reports/chat + stats
│       └── settings.ts         # preferences, persisted to the user_settings table
├── api/                        # PHP backend (see api/README.md)
├── database/                   # schema.sql + ordered migrations
└── dist/                       # build output — this is what Apache serves
```

## Request flow

1. A route component (e.g. `dataset.tsx`) calls a function from `src/lib/db.ts`,
   e.g. `listDatasets()`.
2. That function calls `api.get("/datasets")` in `src/lib/apiClient.ts`, which
   attaches `Authorization: Bearer <token>` from `localStorage`.
3. Apache routes the request through `api/.htaccess` to `api/index.php`, which
   resolves the token against the `sessions` table and dispatches to a handler.
4. The handler queries MySQL with a prepared statement that **always** filters
   by the authenticated `user_id`.
5. Rows return as snake_case; `db.ts` maps them to the camelCase shapes the UI
   expects.

Running a forecast takes a detour: `/forecast` loads the dataset from MySQL,
then either reuses an already-trained model (posting to the predictor on port
7070, which returns in well under a second) or fits a new one (the trainer on
port 7000, up to a minute). Only a change to the dataset, target column or
frequency forces a retrain — see [api/README.md](../api/README.md) for the
invalidation rule.

## What's real vs. simulated

- **Real, DB-backed**: auth, datasets, predictions history, reports,
  conversations/messages, profile.
- **Real forecasting**: `/predictions` trains an actual Prophet model
  server-side and returns its output with confidence bounds and an accuracy
  score. It requires the Python service to be running.
- **Real dashboard**: every figure on `/dashboard` comes from the `/stats`
  endpoint, which aggregates the user's own rows in SQL. There are no
  placeholder numbers left.
- **Real assistant**: `/aurai` posts to the `/assistant` endpoint, which answers
  from SQL over the user's own data. It recognizes a fixed set of intents
  (counts, accuracy, datasets, latest forecast, reports, summary) — it is
  deterministic, not a language model, and makes no external calls.
- **Real settings**: `/settings` reads and writes the `user_settings` table, and
  the values drive the sidebar name, the glass blur, and the Predictions
  wizard's defaults.
- **Still not wired**: `datasets.storage_path` — imports are parsed
  client-side into the `rows` JSON column rather than stored as files.

## Tests

`npm test` runs the API and browser suites in [`/tests`](../tests/README.md)
against the real backend and database. Each suite registers its own throwaway
account on the `@aurai.test` domain, so runs are isolated from real data and
from each other. The suites that train Prophet models are opt-in
(`npm run test:all`) because a fit takes about a minute.

## Build & environment

- Scripts: `dev`, `build`, `preview`, `lint`, `format`.
- `VITE_API_URL` overrides the API base URL. It is only needed for `npm run
  dev`, since the dev server is a different origin from Apache; the production
  build defaults to `../api`. See `.env.example`.
- Path alias: `@/*` → `./src/*` (`tsconfig.json` and `vite.config.ts`).
