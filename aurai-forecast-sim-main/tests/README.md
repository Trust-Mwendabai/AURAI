# Tests

Automated checks for the API and the running app. They exercise the real
backend against the real database — nothing is mocked — so a passing run means
the stack actually works, not that a stub was configured correctly.

## Running them

```sh
npm test              # API + browser suites (~2 minutes)
npm run test:api      # API only — fast, no browser needed
npm run test:browser  # browser only
npm run test:all      # also trains real Prophet models (slow, ~2 minutes more)
```

Apache and MySQL must be running. `npm run build` should have been run at least
once, since the browser suites drive `dist/`. `test:all` additionally needs the
two Python services (see [backend/Python](../../backend/Python)).

A non-zero exit code means something failed, so these work in CI as-is.

## How test data is isolated

Every suite registers its own throwaway account on the `@aurai.test` domain and
touches only that account's rows. Nothing reads or writes a real account, and
the API bootstrap deletes `%@aurai.test` accounts when a run finishes.

This matters: the tests run against the same database the app uses. Scoping
them this way is what keeps a test run from destroying real work.

## What's covered

### API (`tests/api/`, PHP)

| Suite | Covers |
|---|---|
| `crud.php` | Every resource's create/read/update/delete, and **per-user isolation** — that a second account cannot read, modify or delete the first's rows. MySQL has no row-level security, so this is the only thing standing between users. |
| `workspace.php` | `/stats`, `/settings` and `/assistant`: that dashboard figures are aggregated in SQL, settings round-trip, and the assistant reports real rows without leaking across accounts. |
| `security.php` | Login throttling (lockout after repeated failures, per email *and* IP), expired-session pruning, rejection of bogus reset tokens, and that the dataset list omits row payloads. |
| `analytics.php` | Segment measures over a dataset — totals, share, growth direction, volatility, concentration and the date-column detection. |
| `assistant.php` | How a question is routed: weighted intent scoring, matching the user's own dataset and column names, conversation follow-ups, and that follow-up history is scoped to its owner. |
| `forecast.php` | Real Prophet training and the model-reuse cache — what reuses a saved model, what forces a retrain. Slow; opt in with `--with-forecast`. |

### Browser (`tests/browser/`, Playwright)

| Suite | Covers |
|---|---|
| `app.mjs` | Sign-up and sign-in, the password reveal toggle, the route guard, the dashboard showing real rows rather than placeholders, settings persistence, the assistant, the conversations overlay, and the report editor's save semantics. |
| `dataset.mjs` | CSV and Excel import (including Excel date conversion and multi-sheet handling), the per-column profile and its quality warnings, the preview column pickers, and the confirm/undo flow around cleaning. |
| `predictions.mjs` | The forecast comparison view: selection, the four-run cap, that lines are actually drawn (asserted on path geometry, not a screenshot), and that the change column matches each run's shape. |
| `injection.mjs` | That user-supplied text never executes where HTML is rendered — the profile PDF export and the report list excerpt. Both have been real defects. |
| `exports.mjs` | CSV and JSON downloads — BOM, RFC 4180 escaping, provenance header, filename sanitising. |

## Adding a suite

API suites `require _bootstrap.php`, which provides `api()`, `check()`,
`test_account()`, `suite()` and `finish()`. Browser suites import
`_helpers.mjs`, which provides `signedInPage()`, `createRun()`, `apiAs()` and
`statTile()`. Register the new file in the table in `run.mjs`.

Two things worth knowing, both learned the hard way:

- Playwright's `:has-text()` is a **substring** match. `button:has-text("CSV")`
  also matches a dataset button named `sales.csv`. Use `:text-is()` for exact
  text.
- Navigating to the hash route already showing is a **no-op**, so the route
  never remounts and stale data stays on screen. Reload instead — the `go()`
  helper in `app.mjs` does this.
