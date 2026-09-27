# PHP Migration Plan

> **Status: done.** The migration described here has been carried out. The
> backend now lives in [`/api`](../api/README.md) (PHP + PDO + MySQL), the
> frontend talks to it through `src/lib/apiClient.ts`, and the Supabase and
> Lovable integration code has been moved out of `src/` to `_legacy-supabase/`.
> This document is kept as the rationale for the design; see
> [`/api/README.md`](../api/README.md) for setup and the endpoint list.

This document describes what changes when the backend moves from Supabase (Postgres + Auth) to PHP + MySQL/MariaDB (e.g. under XAMPP), and how the schema in [`/database`](../database/README.md) maps to the original Supabase schema.

## Why this isn't a pure lift-and-shift

Supabase gave this app three things for free that a PHP + MySQL stack must reimplement explicitly:

1. **Auth** (`auth.users`, JWT sessions, OAuth) — no equivalent exists in plain MySQL.
2. **Row-Level Security** — Postgres enforced `user_id` scoping at the database layer; MySQL has no RLS, so every query in the new PHP API must filter by the authenticated user itself.
3. **Auto-provisioning trigger** (`handle_new_user`) — straightforward to reproduce with a MySQL trigger or an application-level transaction.

## Schema mapping

| Supabase (Postgres) | PHP schema (MySQL) | Change |
|---|---|---|
| `auth.users` (Supabase-managed) | `users` (new) | New table: `id`, `email`, `password_hash`, `email_verified_at`, `remember_token`, timestamps. Replaces Supabase's managed auth table. |
| — | `password_reset_tokens` (new) | New table to support the existing `/forgot-password` → `/reset-password` flow without Supabase. |
| — | `sessions` (new) | New table for server-side session/token storage, replacing Supabase's JWT session handling. |
| `public.profiles` | `profiles` | Same shape. FK now points to the new `users.id` instead of `auth.users.id`. |
| `public.user_settings` | `user_settings` | Same shape, unchanged. Currently unused by the frontend — kept for parity; wiring up `/settings` to persist here is a good first PHP-era improvement. |
| `public.datasets` | `datasets` | Same shape, unchanged. `storage_path` is preserved but still optional — deciding whether to move dataset storage to real files (vs. `rows` JSON) is a product decision, not forced by the migration. |
| `public.predictions` | `predictions` | Same shape, unchanged. |
| `public.reports` | `reports` | Same shape; `body` becomes `LONGTEXT` (MySQL has no unbounded `text` the way Postgres does, though `LONGTEXT` is effectively unbounded in practice). |
| `public.conversations` | `conversations` | Same shape, unchanged. |
| `public.messages` | `messages` | Same shape, unchanged. |
| RLS policies (`auth.uid() = user_id`) | *(none — enforced in PHP)* | See "Authorization" below. |
| `gen_random_uuid()` defaults | *(none — app-generated)* | See "Primary keys" below. |
| `plpgsql` triggers for `updated_at` | native `ON UPDATE CURRENT_TIMESTAMP` | MySQL supports this natively; no trigger needed. |
| Storage bucket RLS policies (`datasets` bucket) | *(dropped)* | Not applicable — the app never used Supabase Storage in practice (see [DATA-MODEL.md](./DATA-MODEL.md)). If real file uploads are added later, handle authorization in the PHP upload endpoint instead. |

## Primary keys: why UUIDs are still app-generated

The MySQL schema keeps `CHAR(36)` UUID primary keys (matching the existing data shape) rather than switching to auto-increment integers, so that existing Supabase data can be exported/imported without renumbering foreign keys. MySQL does not reliably support non-deterministic functions like `UUID()` as a column `DEFAULT` across all supported versions, so **the PHP application must generate the UUID (v4) before every insert** (e.g. via `ramsey/uuid`, or `random_bytes`-based formatting) rather than relying on the database to generate it. This is called out in `database/schema.sql`.

## Authorization: the one non-negotiable change

Every current query in `src/lib/db.ts` and `src/lib/auth.ts` relies on Postgres RLS to scope rows to the current user — none of them add a `WHERE user_id = ...` clause themselves. When rebuilding this as a PHP API:

- **Every** `SELECT`/`UPDATE`/`DELETE` must include `WHERE user_id = :current_user_id` (or go through the `owning` conversation for `messages`).
- **Every** `INSERT` must set `user_id` from the authenticated session, never trust a client-supplied value.
- Centralize this in a single data-access layer (e.g. one repository class per table) rather than repeating the check in every endpoint, so it can't be accidentally omitted.

## Known product gaps to decide on during migration

These are pre-existing gaps between the schema and the frontend's actual behavior (documented in [ARCHITECTURE.md](./ARCHITECTURE.md) and [FEATURES.md](./FEATURES.md)). The SQL schema preserves them as-is for parity; each is a candidate to fix once real API endpoints are being written anyway:

1. `user_settings` exists but `/settings` only writes to `localStorage`.
2. `datasets.storage_path` exists but nothing ever populates it — data is stored inline as JSON.
3. The dataset "target column" choice on `/dataset` lives only in `localStorage` (`aurai_target_<id>`), not in `datasets`.
4. Predictions are a client-side heuristic, not a real model — if a PHP backend is meant to run real forecasting, that logic needs to move server-side (e.g. a PHP statistics library, or a call out to a Python/R service).
5. The Aurai chat assistant is a hardcoded responder — wiring it to a real LLM would be a server-side integration (the PHP backend would be a natural place to hold the API key instead of exposing it to the browser).

## Suggested PHP-side stack (not prescriptive)

- PDO with prepared statements (or a lightweight query builder) — avoid string-concatenated SQL given every query needs a `user_id` filter.
- `password_hash()` / `password_verify()` for credentials.
- A migration runner (Phinx, or a small custom script) applying the files in `database/migrations/` in order — see [`database/README.md`](../database/README.md).
- Session auth via PHP's native session handling for a server-rendered app, or a bearer-token (`sessions` table) approach if the React frontend is kept and just points at a new JSON API instead of Supabase.
