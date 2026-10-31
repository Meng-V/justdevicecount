# JustDeviceCount

Real-time patron counting for King Library and the Recreation Center at Miami University,
built on top of the existing Cisco CMX WiFi infrastructure.

## What It Does

Polls the Cisco CMX API every 15 minutes, counts unique WiFi devices per floor, and stores
the results in a PostgreSQL database. A web dashboard and a set of JSON APIs make the data
available to staff, digital signage, and analytics tools.

## Project Status

Complete and running unattended in production since October 2026. Collection, dashboard
refreshes, the monthly archive and the daily health check all run on their own; a person
is only needed when an alert e-mail arrives. See
[SERVER_DEPLOYMENT.md → Alert e-mails](SERVER_DEPLOYMENT.md#alert-e-mails-and-what-to-do)
for what each alert means and who to contact.

## Routes

All routes are prefixed with `/crowdindex/`.

| Route | Description |
|-------|-------------|
| `GET /` | Live occupancy dashboard |
| `GET /patronapi` | King Library patron counts (JSON) |
| `GET /recapi` | Recreation Center patron count (JSON) |
| `GET /count_by_floor` | Per-floor breakdown for both buildings (JSON) |
| `GET /health` | Service health check (JSON) |
| `GET /admin` | Analytics dashboard (token-gated) |
| `GET /admin/data` | Raw analytics JSON (token-gated) |

## How It Works

1. `DeviceDataService` fires at `:00`, `:15`, `:30`, `:45` each hour (Eastern Time)
2. Fetches device lists from the CMX API for each floor
3. Deduplicates device IDs within coordinate bounds for each floor
   (`KING_FLOOR_BOUNDS` / `REC_FLOOR_BOUNDS` in `modules/app_core.js`)
4. Leaves out devices CMX keeps listing after people have left: a device CMX marks
   `INACTIVE` stops counting after 30 minutes (`modules/staleClientFilter.js`)
5. Saves patron counts + per-floor arrays to PostgreSQL via Prisma
   (`device_data` for King, `rec_data` for the Rec), except during each building's
   overnight silent window — King 02:00–07:00, Rec 02:00–05:00 (`modules/collectionWindow.js`)
6. A 15-minute in-memory cache keeps API responses fast
7. `/recapi` turns the Rec's device count into people:
   `(hourly mean of devices − 10) / 1.2` (`modules/recFormula.js`, tunable under `rec` in
   `config/default.json`). `/patronapi` publishes King's device count as is.

Scheduled jobs, all built into the app (node-cron, Eastern Time — no OS crontab):

| When | Job |
|------|-----|
| Every hour at `:05` | Refresh the admin dashboard's summary files (`refresh_summaries.js --no-analysis`) |
| Daily 03:15 | Full summary refresh, including `big_summary.json` |
| Daily 07:00 | Health check; e-mails `ALERT_EMAIL` if data is missing, stale, all zero, or the Rec reads too high while closed (`data_health_check.js`) |
| 1st of the month, 00:00 | Refresh summaries, then export and delete rows older than the two previous months (`export_and_purge.js`) |

## Tech Stack

- **Runtime**: Node.js + Express
- **Database**: PostgreSQL via Prisma ORM
- **Data source**: Cisco CMX WiFi Analytics API
- **Process management**: systemd (production) / PM2 (local dev)
- **Analytics**: `refresh_summaries.js` rebuilds the dashboard's summary files from the
  database and runs `big_summary.py` (needs `python3`)

## Key Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` (HTTP) or `production` (HTTPS) |
| `PORT` | Server port (default `3012`) |
| `TZ` | Timezone for all logging (`America/New_York`) |
| `PRODUCTION_HOSTNAME` | Public hostname for HTTPS server |
| `PROD_CERT_PATH` | Path to SSL certificate (production) |
| `PROD_KEY_PATH` | Path to SSL private key (production) |
| `CMX_AUTH` | Base64-encoded Cisco CMX credentials (overrides `app.auth` in `config/default.json`) |
| `CMX_TIMEOUT_MS` | Per-request CMX timeout (default `30000`) |
| `ADMIN_TOKEN` | Token for `/admin` dashboard access |
| `STORED_DATA_DIR` | Where monthly exports and analytics files live |
| `ALERT_EMAIL` | Who gets the health-check e-mails — set this when the project changes hands |
| `ALERT_FROM`, `ALERT_MIN_ROWS_24H`, `ALERT_MAX_STALE_MIN`, `ALERT_REC_CLOSED_MAX` | Optional health-check tuning (see `.env.example`) |
| `DASHBOARD_START_MONTH` / `DASHBOARD_END_MONTH` | Optional month range for the analytics dashboard (`YYYY-MM`). Leave unset so new months appear automatically |

See `.env.example` for a complete template.

## Known Limitations

- **CMX stops expiring departed clients from time to time.** It happened from about
  21 Oct to 10 Nov 2025, 25 Feb to 20 Mar 2026, 30 Mar to 20 Apr 2026 and 5 Sep to
  29 Oct 2026, with smaller build-ups in between. The collector now works around it
  (step 4 above); the cause on the CMX side was never found. The stored history was
  corrected afterwards: King device by device, the Rec (Sep–Oct 2026) estimated from
  its closed-hours readings (see SERVER_DEPLOYMENT.md →
  [Ghost history correction](SERVER_DEPLOYMENT.md#ghost-history-correction-sepoct-2026) and
  [Ghost correction of archived months](SERVER_DEPLOYMENT.md#ghost-correction-of-archived-months-oct-2025may-2026)).
- **King's occupancy percentage is uncalibrated.** The public widget on the library
  website (not in this repo) shows `devices × 0.8 / 1050`; that factor was never checked
  against a head count.
- **The Rec's capacity of 200 is an assumption** until the Rec supplies a real figure
  (`rec.capacity` in `config/default.json`).
- `npm audit` reports open advisories in dependencies; none have been addressed.

## Documentation

- **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** — local development setup
- **[SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)** — production deployment, scheduled jobs, alerts

## Privacy

Only anonymized device IDs are tracked — no personal information, no names, no identities.
The system counts devices, not people.

---

**Author**: Meng Qu (Web Design Librarian, Miami University Libraries)
**License**: ISC
