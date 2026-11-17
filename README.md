# rajasekar-work-site

Portfolio site (`rajasekar.work`) plus a private resume-management console (`/admin/`).

## Where data lives (read this first)

| Data | Authoritative store | Notes |
| --- | --- | --- |
| Master resume (experience, projects, skills, education) | **PostgreSQL** table `master_resume` (+ `master_resume_history`) | One row, versioned. |
| Resume profiles | **PostgreSQL** table `profiles` | Reference master data by id. |
| Job applications | **PostgreSQL** table `applications` | |
| Revoked sessions (logout) | **PostgreSQL** table `revoked_sessions` | |
| Colour theme | browser `localStorage` | Convenience only. Nothing else is cached in the browser. |

`resume-data.json`, `lib/seed-profiles.js` and `lib/seed-applications.js` are **only the one-time seed** for a
brand-new empty database. After the first initialisation they are never read at runtime and never written.
Edit content through the admin console (or restore from a backup), not by editing the seed files.

Why not JSON files? A Vercel function's filesystem is read-only (apart from an ephemeral, per-instance `/tmp`), and every
deploy replaces the repo. A JSON file written by a function disappears on the next cold start or deploy, and two
instances would never see each other's writes. PostgreSQL is shared by all instances, durable, transactional and backed up.

### Concurrency model

Every mutable row has an integer `version`. A write must say which version it was based on
(`UPDATE … WHERE id=$1 AND version=$2`, inside a transaction with `FOR UPDATE`). If someone else saved first the API answers
`409 VERSION_CONFLICT` with the current row, and the admin console tells you to reload instead of overwriting.
Constraints (single default profile, status/layout enums, hex colours, FK from applications to profiles) are enforced by the
database, not just by the API.

## Setup

### 1. Create a PostgreSQL database
Recommended: **Neon** (free tier, serverless-friendly pooled connections, point-in-time restore) via the Vercel Marketplace
integration. Vercel Postgres is Neon underneath; Supabase Postgres also works. Any PostgreSQL ≥ 13 works.

Use the **pooled** connection string in production (Neon: the host containing `-pooler`).

### 2. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string (`POSTGRES_URL` is also accepted). |
| `SESSION_SECRET` | yes | ≥ 32 random characters (`openssl rand -base64 48`). **No default exists: without it the admin API refuses every request (503).** |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | yes | GitHub OAuth app. Callback URL: `https://<your-domain>/api/auth/callback`. |
| `ADMIN_GITHUB_USERNAME` | no | Defaults to `innovinitylabs`. |
| `ADMIN_GITHUB_ID` | recommended | Numeric GitHub account id (`gh api user --jq .id`). Pins admin access to the immutable id, not just the renameable username. |
| `SITE_URL` | recommended | e.g. `https://www.rajasekar.work`. Used to build the OAuth redirect URI instead of trusting the Host header. |
| `VERCEL_DEPLOY_HOOK_URL` | optional | When set, saving the master resume or the default profile triggers a rebuild so the public site follows. |
| `GITHUB_TOKEN` | optional | GraphQL contribution calendar. |

### 3. Create the tables
Tables are created automatically on the first admin request and on every build (idempotent, advisory-locked). To do it explicitly:

```bash
DATABASE_URL=postgres://… npm run db:migrate
```

On first run the database is seeded once from `resume-data.json` and the seed profiles.
The one pre-existing application record (`ScaleData Systems`, from the old `data/applications.json`) is seeded too, so
nothing is dropped; it looks like sample data, so delete it in the admin console if it is not real.

### 4. Backups and restore
* In the admin console: **Backup & Storage → Download backup (JSON)** (`GET /api/export`, a consistent snapshot).
* From a terminal: `DATABASE_URL=… npm run db:backup -- backups/resume.json`.
* The provider's own point-in-time restore (Neon) covers the database; keep an off-provider copy of the JSON export too.
* Every master-resume save is also kept in `master_resume_history`.
* **Restore:** `DATABASE_URL=… npm run db:restore -- backups/resume.json --yes` replaces the master, profiles and applications
  from a backup in one transaction (validated first: an invalid file changes nothing; the master gets a new version, the old one stays in history).

### Project links
Each project has a `links` array: `{ label, url, type, primary, visible }` (`type`: website, app, generator, github, documentation, demo, other).
At most one link is primary and it must be visible. Edit them in **Master Resume → Projects → Project links**. The public portfolio shows the primary
link prominently and the other visible links in a compact list, using labels. Schema change 003 (`lib/migrations.js`) upgrades existing records in place
and replaces bare `*.vercel.app` URLs only with verified custom domains (the deployment URL is kept as a hidden link).

### GitHub activity graph
`/api/github-contributions` returns daily data from 2025-01-01 through today (queried one calendar year at a time with a token, or via the public proxy without one).
The browser builds the calendar from real dates (`contrib-calendar.js`); month labels are placed on the week column that contains the month's first day.

## Local development

```bash
createdb resume_dev
export DATABASE_URL=postgres://localhost/resume_dev
export SESSION_SECRET="$(openssl rand -base64 48)"
export GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=…     # GitHub OAuth app with callback http://localhost:3000/api/auth/callback
npm run dev                                          # static site + /api on http://127.0.0.1:3000
```
There is intentionally no authentication bypass; sign in with GitHub as the configured admin.

## Build & test

```bash
npm run build     # reads the master + default profile from PostgreSQL when DATABASE_URL is set (fails loudly if unreachable),
                  # otherwise from resume-data.json + seed profiles
npm test          # unit + auth tests; persistence tests are skipped unless TEST_DATABASE_URL is set
TEST_DATABASE_URL=postgres://localhost/resume_test npm test   # also runs the real-PostgreSQL persistence suite
```
The database name must contain `test`: the persistence suite wipes the schema.

Build outputs (committed, regenerated on every deploy):
`index.html` (public portfolio: whole master, public projects), `resume-source.html` (printable ATS resume of the default profile),
`resume-default.json` (resolved default profile used by the "Download Resume" button).

## Architecture

* `resume-resolve.js` pure master+profile → resume logic, shared by build, API and the browser admin preview (one code path).
* `resume-pdf.js` jsPDF renderer (single column, standard headings, selectable text, linked contact details).
* `lib/store.js` the only persistence layer. `lib/db.js` pool, migrations runner, error mapping. `lib/migrations.js` schema.
* `lib/validate.js` server-side validation for master, profiles and applications.
* `lib/auth.js` + `api/auth/*` GitHub OAuth, signed sessions. `lib/http.js` shared admin-endpoint guard (auth, CSRF, JSON, errors).
* `api/profiles.js`, `api/applications.js`, `api/master.js`, `api/export.js` admin API. `api/github-contributions.js` public activity graph.
* `admin/` console. `tools/` migrate/backup/dev server.

## Security model

* GitHub OAuth with a signed, expiring, one-time `state` that must also match an HttpOnly cookie (CSRF on login).
* Session = HMAC-SHA256-signed token (12 h) with a unique id; cookie is `HttpOnly; Secure; SameSite=Lax`.
* Every protected endpoint re-validates the session server-side: 401 invalid/expired/revoked, 403 non-admin, 503 if auth is not configured (fails closed).
* Logout (`POST /api/auth/logout`) clears the cookie **and** revokes the session id in PostgreSQL.
* Writes require `Content-Type: application/json` and a same-origin `Origin` (if sent) on top of SameSite cookies.
* Secrets live only in environment variables; the browser never receives them.
* Static hosting note: Vercel serves the repository root, so nothing sensitive may be committed. `.vercelignore` drops `test/`, `schema/`, `tools/`.
