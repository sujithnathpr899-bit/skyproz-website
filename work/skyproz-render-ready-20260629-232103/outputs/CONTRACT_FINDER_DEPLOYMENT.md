# Contract Finder Deployment on Render

The recommended Render setup is one Docker Web Service. It serves the Skyproz company website at `/` and the Contract Finder platform at `/contract-finder/` with APIs under `/api/contract-finder/`. This avoids a broken menu link and keeps the public domain simple.

## Deliverables

- `render.yaml`: Render Blueprint for the combined Skyproz Web Service.
- `Dockerfile.render`: Render Docker image that includes the company website and Contract Finder.
- `skyproz-website.zip`: static company website package, kept for backup/manual static hosting.
- `contract-finder-platform.zip`: Contract Finder source package, kept for backup/manual backend hosting.

## Safe Publishing Order

1. Push this project to a private GitHub repository connected to Render.
2. In Render, create a new Blueprint from the repository and select `render.yaml`.
3. Confirm the persistent disk is mounted at `/app/data`.
4. Keep `APP_ORIGIN=https://skyproz.in` after the custom domain is connected.
5. Set optional keys for AI, email, and WhatsApp only when those features are ready.
6. Deploy and verify the temporary Render URL first.
7. Open `/api/contract-finder/health` and confirm it returns `ok: true`.
8. Add the custom domain `skyproz.in` to the Render service, then update GoDaddy DNS using Render's shown records.
9. After the domain works, verify `https://skyproz.in/` and `https://skyproz.in/contract-finder/`.

Do not run the seed script on production unless you want demo accounts/contracts. The Docker startup runs the database migration automatically.

## Daily Automation

Render should trigger the daily job through the web service endpoint:

`POST https://skyproz.in/api/contract-finder/cron/daily`

Use this header:

`Authorization: Bearer <CRON_SECRET>`

This keeps the job working with the same persistent SQLite database used by the web service.

## Optional Services

- Email alerts require a Resend API key.
- WhatsApp premium alerts require Meta WhatsApp Cloud API credentials.
- Provider-generated AI analysis requires an AI endpoint, API key, and model name. Without these, the module returns clearly labelled local fallback guidance.

See the included `README.md` for commands, demo credentials, source mapping, security settings, and API details.
