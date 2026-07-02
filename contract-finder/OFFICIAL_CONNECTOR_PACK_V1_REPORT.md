# Skyproz Official Connector Pack v1 Deployment Report

Generated: 2026-07-02

## Verification Commands

- `npm install`: passed
- `npm run migrate`: passed
- `npm run seed`: passed
- `npm test`: passed, 10/10 tests

## Summary

- Priority connectors configured: 20
- Working connectors: 4
- Requires API key: 1
- Requires configuration: 15
- Failed connectors: 0
- Contracts imported during verification: 54

## Working Connectors

| Connector | Official interface | Imported | Scheduler | Health | Quality |
| --- | --- | ---: | --- | ---: | ---: |
| World Bank Procurement Notices | `https://search.worldbank.org/api/v2/procnotices?format=json&rows=10` | 10 | scheduled | 100 | 88 |
| TED Europe | `https://api.ted.europa.eu/v3/notices/search` | 20 | scheduled | 100 | 96 |
| CanadaBuys | `https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv` | 10 | scheduled | 100 | 88 |
| UK Find a Tender | `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10` | 14 | scheduled | 100 | 88 |

## Requires API Key

| Connector | Required key | Official documentation |
| --- | --- | --- |
| SAM.gov Opportunities | `SAM_API_KEY` | `https://open.gsa.gov/api/get-opportunities-public-api/` |

## Requires Configuration

These connectors are present in the official pack but are intentionally not marked working because no successful live import was completed using an official public API/feed in this environment.

| Connector | Reason |
| --- | --- |
| GeM India | No official public machine feed configured. |
| CPPP India | No official public machine feed configured. |
| UNGM | Public portal verified; no official public feed/API configured. |
| UNDP | `robots.txt` disallows automated access to the procurement notices site. |
| UNICEF | No official public machine feed verified. |
| UNOPS | eSourcing requires authenticated access. |
| Asian Development Bank | No verified official machine endpoint configured. |
| African Development Bank | No verified official machine endpoint configured. |
| European Investment Bank | No verified official machine endpoint configured. |
| Inter-American Development Bank | Public source was not live-verifiable from this environment. |
| AusTender | No verified official machine endpoint configured; direct feed candidates returned access errors. |
| GETS New Zealand | Public portal verified; no official public machine endpoint configured. |
| GeBIZ Singapore | Public portal verified; no official public machine endpoint configured. |
| Qatar Government Procurement | No verified official machine endpoint configured. |
| UAE Government Procurement | No verified official machine endpoint configured. |

## Compliance

- No unofficial mirrors were used.
- No authenticated portals were scraped.
- No endpoints were fabricated.
- Connectors are only marked working after successful live Verify Source and Import Now runs.
