# Aurai Forecast — Documentation

Aurai Forecast is a time-series sales forecasting workspace. Users upload a
dataset, pick a target column, run a forecast, review it on a dashboard, write
it up in a report, and chat with a bundled assistant about it.

## Current stack

- **Frontend** — React + Vite, a plain client-rendered SPA (`index.html` +
  `src/main.tsx`), routed with react-router-dom.
- **Backend** — PHP + MySQL, in [`/api`](../api/README.md). Bearer-token auth,
  PDO prepared statements, per-user filtering on every query.
- **Forecasting** — Flask + Prophet, in `backend/Python/`, called by the PHP
  `/forecast` endpoint.

Setup instructions live in the [project README](../../README.md), and the full
local + cPanel deployment walkthrough is in [DEPLOYMENT.md](./DEPLOYMENT.md).

## Contents

- [DEPLOYMENT.md](./DEPLOYMENT.md) — running it locally, and deploying to cPanel
- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack, layout, and request flow
- [DATA-MODEL.md](./DATA-MODEL.md) — tables, columns, and relationships
- [FEATURES.md](./FEATURES.md) — page-by-page walkthrough, real vs. simulated
- [AUTHENTICATION.md](./AUTHENTICATION.md) — sign-up, login, and sessions
- [PHP-MIGRATION.md](./PHP-MIGRATION.md) — why the Supabase→PHP move was done
  the way it was (historical rationale; the migration is complete)
