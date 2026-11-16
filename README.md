# rajasekar-work-site

`resume-data.json` is the single source of truth for the website and ATS resume.

After editing it, regenerate the checked-in HTML:

```bash
npm run build
```

Run the full acceptance suite before publishing:

```bash
npm run verify
```

The verification suite checks:

- generated website and printable HTML content
- conventional ATS section order
- required Data Engineer keywords
- one-page jsPDF output
- selectable PDF text and extraction order

Rendering paths:

- `build.js` generates `index.html` and `resume-source.html`
- `resume-pdf.js` generates the downloadable PDF
- `script.js` handles browser interactions, theme toggle, and GitHub activity calendar
- `admin/` provides the private Multi-Profile Resume Management Console

Vercel runs `npm run build` during deployment.

---

## Phase 2: Multi-Profile Resume System Architecture

### 1. Master Data & Profile Schema
- `resume-data.json` remains the master source of truth for all baseline resume content.
- `lib/resume-system.js` normalizes master data with deterministic stable IDs (`exp-*`, `skill-*`, `edu-*`).
- `data/profiles.json` manages custom profiles (e.g. Data Engineer, AI / Product Engineer, Database Developer, Custom Profiles) referencing master data without duplication.
- `data/applications.json` tracks targeted job applications linked to specific resume profiles.
- `schema/resume-system.schema.json` formalizes the JSON Schema specification.

### 2. Private Administrative Console (`/admin/`)
- Accessible at `/admin/` for profile drafting, previewing, and PDF generation.
- Supports creating, renaming, duplicating, and deleting profiles.
- Allows configuring section visibility, customizing professional summaries, and filtering experience or skills by stable ID.
- Provides a live preview and direct profile PDF export.

### 3. GitHub OAuth Authentication
Serverless GitHub OAuth endpoints are implemented under `/api/auth/`:
- `GET /api/auth/login`: Initiates OAuth authorization with signed CSRF state.
- `GET /api/auth/callback`: Exchanges authorization code, verifies identity against `ADMIN_GITHUB_USERNAME`, and sets an `HttpOnly` secure session cookie.
- `GET /api/auth/session`: Validates current session token.
- `GET /api/auth/logout`: Clears session cookie.

#### Required Environment Variables for Production
Configure these in Vercel or your `.env` file:
```bash
GITHUB_CLIENT_ID="your_github_oauth_app_client_id"
GITHUB_CLIENT_SECRET="your_github_oauth_app_client_secret"
ADMIN_GITHUB_USERNAME="innovinitylabs"
SESSION_SECRET="at_least_32_bytes_random_secret_string"
GITHUB_TOKEN="optional_pat_for_graphql_contribution_calendar"
```

### 4. GitHub Contribution Calendar
- `/api/github-contributions?username=innovinitylabs`: Fetches activity data via GitHub GraphQL (or public sync fallback) with 1-hour serverless caching.
- Statically embedded and client-hydrated on the portfolio with interactive tooltips, month/weekday labels, and light/dark theme support.

