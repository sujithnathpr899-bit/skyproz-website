# Skyproz Contract Finder

A self-contained contract and tender discovery module for the Skyproz website. It uses Node.js 24 and SQLite with no third-party runtime dependencies.

## Included

- Contract/source/category database with full-text search and indexed filters
- Country, industry, budget, deadline, buyer type and work-mode filters
- Authentication, sessions, free/premium plans and administrator roles
- Favorites, deadline tracking, watchlists, saved searches and alerts
- Premium WhatsApp notifications and AI-assisted summaries, requirements, checklists, deadlines and proposal outlines
- Admin source/contract/subscriber management, verification, deduplication and analytics APIs
- Daily source imports, status cleanup and alert delivery jobs
- SEO-friendly contract URLs, structured data and a dynamic module sitemap
- Responsive frontend pages matching the Skyproz visual design

## Current Website Integration

The existing Skyproz site is static and has no authentication or user database. This module therefore includes a self-contained authentication adapter and database without changing existing website behavior. A future external identity provider can replace `src/auth.mjs` while leaving the rest of the module untouched.

SQLite requires persistent storage and cannot run as a plain Netlify static deployment. Deploy this service to a persistent Node host (for example a VPS or a container host with a mounted disk), then proxy `/contract-finder/*` and `/api/contract-finder/*` from the main domain or map `contracts.skyproz.in` to it.

## Local Setup

Use Node.js 24 or newer:

```powershell
Copy-Item .env.example .env
node scripts/migrate.mjs
node scripts/seed.mjs
node src/server.mjs
```

Open `http://127.0.0.1:8787/contract-finder/`.

This project reads environment variables from the host. The `.env` file is a configuration reference; load it with your hosting platform or shell.

## Development Accounts

Seed data creates these local-only accounts:

- Admin: `admin@skyproz.in` / `ChangeMe-Admin-2026!`
- Premium: `premium@example.com` / `ChangeMe-Premium-2026!`
- Free: `user@example.com` / `ChangeMe-Free-2026!`

Change or remove all demo passwords before public deployment.

## Scheduled Jobs

Run daily from the host scheduler:

```powershell
node scripts/run-jobs.mjs
```

Alternatively call `POST /api/contract-finder/cron/daily` with `Authorization: Bearer <CRON_SECRET>`.

## Contract Imports

Administrators can create sources through the admin API. JSON sources use `parser_config`:

```json
{
  "items_path": "results",
  "field_map": {
    "external_id": "id",
    "title": "title",
    "description": "description",
    "source_url": "url",
    "country": "country",
    "industry": "industry",
    "contract_type": "type",
    "budget_value": "budget",
    "currency": "currency",
    "deadline": "deadline",
    "posted_date": "published",
    "tags": "tags"
  }
}
```

Each procurement source has different terms and API formats. Only import sources whose terms permit automated retrieval.

## Production Checklist

1. Set a strong `SESSION_SECRET` and `CRON_SECRET`.
2. Set `COOKIE_SECURE=true` and `APP_ORIGIN` to the public HTTPS address.
3. Mount persistent storage at `/app/data` or configure `DATABASE_PATH`.
4. Configure backups for the SQLite database.
5. Configure Resend, WhatsApp Cloud API and an AI provider only if those features are enabled.
6. Remove demo contracts and rotate/delete seeded accounts.
7. Put the service behind HTTPS and a reverse proxy.
8. Schedule `node scripts/run-jobs.mjs` daily.

## API Root

All JSON APIs are namespaced under `/api/contract-finder`. Health check: `/api/contract-finder/health`.
