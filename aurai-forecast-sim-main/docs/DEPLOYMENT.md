# Running Aurai locally, and deploying it to cPanel

Aurai has four moving parts. Knowing what they are makes both setups obvious:

| Part | What it is | Needed for |
|---|---|---|
| **The SPA** | A React app built by Vite into `dist/` — plain static files | Everything |
| **The API** | Dependency-free PHP 8 in `api/`, served by Apache | Everything |
| **MySQL** | Schema in `database/` | Everything |
| **Prophet** | Two Python/Flask services in `backend/Python/` | Forecasting only |

Only the first three are required. Without Python the app runs, but the
Predictions page cannot fit a model — everything else works.

---

## Part 1 — Running locally (XAMPP)

### Prerequisites

- **XAMPP** with PHP 8.2+ and MariaDB/MySQL. The API needs `pdo_mysql`, `curl`,
  `mbstring` and `json`; all four ship with XAMPP by default.
- **Node.js 20+** — to build the frontend.
- **Python 3.10+** — only if you want forecasting.

The project must live under `htdocs`. These instructions assume
`C:\xampp\htdocs\Aurai\aurai-forecast-sim-main`, which Apache serves at
`http://localhost/Aurai/aurai-forecast-sim-main/`.

### 1. Start Apache and MySQL

From the XAMPP control panel, start **Apache** and **MySQL**. Check both:

- `http://localhost/` should load the XAMPP welcome page.
- `http://localhost/phpmyadmin/` should load phpMyAdmin.

### 2. Create the database

```sh
C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
```

That creates the `aurai_forecast` database and every table. Alternatively, run
the files in `database/migrations/` in numeric order, or import `schema.sql`
through phpMyAdmin.

If your MySQL root password is not blank, edit `api/config.php` to match —
`DB_USER` and `DB_PASS` are at the top of the file.

### 3. Build the frontend

```sh
npm install
npm run build
```

This writes `dist/`. Open **`http://localhost/Aurai/aurai-forecast-sim-main/dist/`**
and register an account.

For day-to-day development use `npm run dev` instead, on
`http://localhost:5173`. It proxies `/api` to Apache automatically, so no `.env`
file is needed. You still need Apache and MySQL running behind it.

### 4. Start the Prophet services (optional)

Two separate Flask apps, each in its own terminal, from the **repository root**
(`C:\xampp\htdocs\Aurai`, one level above this folder):

```sh
cd backend/Python
python precision_ai.py    # :7000 — fits and saves models
python predict.py         # :7070 — forecasts from a saved model
```

Both bind to `127.0.0.1` only, so nothing outside your machine can reach them.
First run needs `pip install flask prophet pandas joblib scikit-learn`.
Installing Prophet compiles a Stan backend and is slow — several minutes is
normal.

If the predictor on `:7070` is down, `/forecast` falls back to a fresh fit
rather than failing. If the trainer on `:7000` is down, forecasting returns an
error.

### 5. Enable AI reasoning (optional)

```sh
cp api/config.local.example.php api/config.local.php
```

Paste a [Gemini API key](https://aistudio.google.com/apikey) into
`gemini_api_key`. Skip this and the assistant, business insights and report
generation all still work — they fall back to their built-in analysis, which
reads the same figures but writes them up from fixed templates.

> **The key is server-side only.** `api/config.local.php` is gitignored, and
> every Gemini call is made from PHP. Never put the key in `.env` or in any
> `VITE_*` variable: Vite inlines `VITE_*` values into the built JavaScript,
> where anyone who opens the app can read them.

**Free-tier quotas are small** — 20 requests per day, per model. The client
works down a chain of models when one is exhausted, and falls back to the
built-in analysis when they all are, so the app never breaks. But on a free key
most users will see the built-in version most of the time. See
[`api/README.md`](../api/README.md#ai-reasoning).

### 6. Verify

```sh
npm test                  # API + browser suites
npm run test:all          # ...including the slow Prophet suite
```

Everything should pass. The tests create and delete their own throwaway
accounts on `@aurai.test` — they never touch yours.

---

## Part 2 — Deploying to cPanel

### Read this before you start

**Prophet will probably not run on shared cPanel hosting.** It needs to compile
a Stan backend and hold a long-lived process, and shared plans usually forbid
both. Your realistic options:

1. **Deploy without forecasting.** Everything else — datasets, analytics,
   reports, the assistant, business insights — works. The Predictions page will
   error when asked to fit a model.
2. **Run Prophet elsewhere** on a small VPS or a container host, and point the
   API at it (step 7). This is the option that actually gives you a complete
   deployment.
3. **Try cPanel's Setup Python App** (Passenger). It works on some hosts. Budget
   time for it to fail on Prophet's build step.

**If you host Prophet remotely, read step 7 first — the services have no
authentication of their own.**

### 1. Check the PHP version

In cPanel, open **Select PHP Version** (or **MultiPHP Manager**) and set PHP to
**8.2 or newer**. In the extensions list, confirm `pdo_mysql`, `curl`,
`mbstring` and `json` are ticked.

### 2. Create the database

In **MySQL® Databases**:

1. Create a database — cPanel prefixes it with your account name, giving
   something like `myacct_aurai`.
2. Create a user, give it a strong password, and **Add User To Database** with
   **ALL PRIVILEGES**.

Then open **phpMyAdmin**, select the new database, and import
`database/schema.sql`.

> **Delete the `CREATE DATABASE` and `USE` statements first** (near the top of
> `schema.sql`, currently lines 31–34). On cPanel the database already exists
> under its prefixed name, and your user has no privilege to create another —
> leaving them in makes the whole import fail with *access denied*.

### 3. Build locally and upload

Shared hosting rarely has Node, so **build on your own machine**:

```sh
npm install
npm run build
```

Upload so that `dist` and `api` stay **siblings**, because the built app calls
`../api` relative to itself:

```
public_html/
  aurai/
    dist/          ← the built SPA (upload the contents of dist/)
    api/           ← the whole api/ folder
    database/      ← optional; only needed to import the schema
```

The app is then at `https://yourdomain.com/aurai/dist/`.

**To serve it at `https://yourdomain.com/aurai/` instead** — without `/dist/` in
the URL — move the *contents* of `dist/` up into `aurai/`, and move `api/` up
one level too, so the layout becomes:

```
public_html/
  api/           ← moved up
  aurai/         ← index.html and assets/ from dist/
```

Assets need no rebuild — `vite.config.ts` sets `base: "./"`, so every asset path
is relative. But **`../api` is resolved against the page URL**, so it points at
`/api` once the page is served from `/aurai/`, not at `/aurai/api`. Moving the
API folder is what keeps that pointing somewhere real.

If you would rather keep `api/` inside `aurai/`, build with an explicit URL
instead:

```sh
VITE_API_URL=https://yourdomain.com/aurai/api npm run build
```

That is a plain endpoint URL, not a secret — unlike an API key, it is safe in a
`VITE_*` variable.

The router uses hash URLs (`/#/dashboard`), so **no SPA rewrite rule is
needed** — the server only ever has to serve `index.html`.

### 4. Point the API at the cPanel database

Edit `api/config.php` on the server:

```php
const DB_HOST = 'localhost';
const DB_NAME = 'myacct_aurai';
const DB_USER = 'myacct_auraiuser';
const DB_PASS = 'the-password-you-set';
```

Use the **prefixed** names exactly as cPanel shows them.

### 5. Confirm `.htaccess` survived the upload

`api/.htaccess` must be present. It does two things the API cannot work
without, plus one hardening rule:

- rewrites every request to `index.php`, which is the front controller;
- forwards the `Authorization` header to PHP — Apache strips it by default,
  which would make **every logged-in request look unauthenticated**;
- denies web access to `config.local.php`.

FTP clients routinely skip dotfiles. If logins succeed but every other request
returns 401, this file is missing.

Check it with:

```sh
curl -i https://yourdomain.com/aurai/api/stats
```

`{"error":"Not authenticated"}` with status 401 is the **correct** response — it
means routing works. A 404 or an Apache error page means `.htaccess` is missing
or `AllowOverride` is off.

### 6. Add the Gemini key (optional)

Create `api/config.local.php` on the server from the example file and paste your
key in. Set its permissions to **600** in File Manager.

Confirm it is not readable over the web:

```sh
curl -i https://yourdomain.com/aurai/api/config.local.php
```

This must return **403**. The bundled `.htaccess` denies it; if you get a 200
with PHP source in the body, stop and fix that before going live.

### 7. Point the API at a remote Prophet service (optional)

If you are running Prophet elsewhere, override the two URLs in
`api/config.local.php`:

```php
'prophet_train_url'   => 'https://prophet.example.com/api',
'prophet_predict_url' => 'https://prophet.example.com/predict',
```

The environment variables `PROPHET_TRAIN_URL` and `PROPHET_PREDICT_URL` take
precedence, if your host lets you set them.

> **The Flask services have no authentication.** Locally that is fine — they
> bind to `127.0.0.1` and nothing else can reach them. Exposed to the internet,
> anyone who finds the URL can submit training jobs and read back results. If
> you host them remotely, put them behind something: an IP allowlist for your
> cPanel server, HTTP basic auth at a reverse proxy, or a private network.
> Do not simply open the ports.

### 8. Enable HTTPS

Turn on **AutoSSL** (or install your own certificate) and force HTTPS. Bearer
tokens are sent on every request; over plain HTTP they are readable in transit.

A root `.htaccess` that redirects:

```apache
RewriteEngine On
RewriteCond %{HTTPS} off
RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
```

### 9. Smoke-test the deployment

1. Load the app and **register** an account.
2. **Reload** — you should stay signed in. (If not, see step 5.)
3. **Import** a CSV or Excel file on the Dataset page.
4. Open **Analytics** and confirm the figures render.
5. Ask **Aurai** a question.
6. If Prophet is wired up, run a **forecast**.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every request after login returns **401** | `api/.htaccess` missing, or `AllowOverride None`. The `Authorization` header is being stripped. |
| **500** on every API call | Wrong DB credentials in `api/config.php`, or PHP below 8.0. Check cPanel's error log. |
| App loads but is **blank** | `dist/` and `api/` are not siblings, so `../api` resolves nowhere. Check the browser console. |
| Assets **404** | You uploaded the `dist` folder where its *contents* were expected, or vice versa. |
| Forecasts **time out** | Fitting a model takes about a minute. Raise `max_execution_time` in Select PHP Version, and make sure both Python services are up. |
| AI answers look **templated** | Expected without a key, and expected on a free key whose 20-a-day quota is spent. Check the error log for `Gemini ... unavailable`. |
| **Access denied** importing the schema | Remove the `CREATE DATABASE` / `USE` lines from `schema.sql`. |

## See also

- [`api/README.md`](../api/README.md) — endpoints, the authorization model, AI reasoning
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — how the pieces fit together
- [`database/README.md`](../database/README.md) — the schema
