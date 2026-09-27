# Authentication

Auth is handled by the PHP API in [`/api`](../api/README.md). There is no
third-party auth provider.

## How it works

- **Sign up / sign in**: `src/lib/auth.ts` posts to `/auth/register` and
  `/auth/login`. The API verifies credentials with `password_verify()` against
  the `password_hash` column and returns an opaque bearer token.
- **Token storage**: the token is kept in `localStorage` under `aurai_token`
  by `src/lib/apiClient.ts`, which attaches it as an `Authorization: Bearer`
  header on every request.
- **Sessions**: each login inserts a row into `sessions` holding a SHA-256
  hash of the token (never the token itself), plus IP, user agent, and an
  expiry 30 days out. `require_auth()` resolves the header against that table
  on every request; logout deletes the row.
- **Route guard**: `src/routes/AppLayout.tsx` calls `refreshSession()` on
  mount and redirects to `/login` if the token is missing or rejected. This is
  a client-side convenience only — the real enforcement is that the API
  returns 401 without a valid token.
- **New-user provisioning**: an `AFTER INSERT` trigger on `users` creates the
  matching `profiles` and `user_settings` rows (see `database/schema.sql`).
- **Password reset**: `/auth/forgot-password` stores a hashed, one-hour token
  in `password_reset_tokens` and always responds OK so it can't be used to
  probe which emails have accounts. `/auth/reset-password` verifies the token
  with `hash_equals`, sets the new password, and deletes the token so it
  cannot be reused.

## Authorization

Postgres row-level security used to enforce `auth.uid() = user_id` at the
database layer. MySQL has no equivalent, so **every query filters by the
authenticated user in PHP**: each `SELECT`/`UPDATE`/`DELETE` carries
`AND user_id = :uid`, every `INSERT` takes `user_id` from the session rather
than the request body, and `messages` are scoped through a join on their
owning `conversations` row. There is no database-level safety net — this is
why the filtering lives in one place per table in `api/resources.php`.

## Known gaps

- **Reset emails are not sent.** No SMTP is configured, so the token never
  reaches the user. Read it from the database during development, or wire up
  `mail()`/PHPMailer.
- **Google OAuth was removed.** It came from the Lovable Cloud broker, which
  no longer exists in this stack. Re-adding it means implementing Google's
  OAuth flow directly in PHP.
- **Expired sessions are never pruned.** They're rejected at auth time but the
  rows accumulate; a scheduled `DELETE FROM sessions WHERE expires_at < NOW()`
  would fix that.
