# Skyproz Contract Finder

A self-contained contract and tender discovery module for the Skyproz website. It uses Node.js 24 and SQLite with no third-party runtime dependencies.

## Included

- Contract/source/category database with full-text search and indexed filters
- Country, industry, budget, deadline, buyer type and work-mode filters
- Authentication, sessions, free/premium plans and administrator roles
- Favorites, deadline tracking, watchlists, saved searches and alerts
- Premium WhatsApp notifications and AI-assisted summaries, requirements, checklists, deadlines and proposal outlines
- Admin source/contract/subscriber management, verification, deduplication and analytics APIs
- Hourly AI procurement bot, daily/weekly/monthly jobs, status cleanup and alert delivery
- Configurable procurement keywords, AI match scoring, language detection, urgency, country risk and recommended actions
- Admin dashboard notifications, connector health, bot run history and import monitoring
- SEO-friendly contract URLs, structured data and a dynamic module sitemap
- Responsive frontend pages matching the Skyproz visual design

## Current Website Integration

The existing Skyproz site is static and has no authentication or user database. This module therefore includes a self-contained authentication adapter and database without changing existing website behavior. A future external identity provider can replace `src/auth.mjs` while leaving the rest of the module untouched.

SQLite requires persistent storage and cannot run as a plain static deployment. The included root `render.yaml` and `Dockerfile.render` deploy the company website and this module together as one Render Docker Web Service, so `/` serves the Skyproz site and `/contract-finder/` serves this platform.

For Render, connect the repository as a Blueprint, mount the persistent disk at `/app/data`, and set `APP_ORIGIN=https://skyproz.in` after the custom domain is connected. The Docker startup runs migrations automatically.

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

Run the hourly AI procurement bot from the host scheduler:

```powershell
node scripts/run-jobs.mjs hourly
```

Alternatively call `POST /api/contract-finder/cron/hourly` with `Authorization: Bearer <CRON_SECRET>`.

On Render, `BOT_SCHEDULER_ENABLED=true` starts the in-process hourly bot loop. The interval is controlled by `BOT_SCHEDULER_INTERVAL_MINUTES`.

## AI Procurement Bot

The bot runs through enabled admin-configured sources, imports new opportunities, removes duplicates and enriches contracts with:

- Match score, matched services and suggested business unit
- Estimated opportunity value, submission urgency and country risk
- Recommended action and AI priority
- Language and translated-description placeholder for non-English notices

Administrators can manage matching keywords from the admin dashboard. Public visitors cannot access connector management, imports, logs, keywords, bot runs or analytics.

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
8. Enable `BOT_SCHEDULER_ENABLED=true` or schedule `node scripts/run-jobs.mjs hourly`.

## API Root

All JSON APIs are namespaced under `/api/contract-finder`. Health check: `/api/contract-finder/health`.
