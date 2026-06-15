# JustDeviceCount

Real-time patron counting for King Library and the Recreation Center at Miami University,
built on top of the existing Cisco CMX WiFi infrastructure.

## What It Does

Polls the Cisco CMX API every 15 minutes, counts unique WiFi devices per floor, and stores
the results in a PostgreSQL database. A web dashboard and a set of JSON APIs make the data
available to staff, digital signage, and analytics tools.

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
4. Saves patron counts + per-floor arrays to PostgreSQL via Prisma
5. A 15-minute in-memory cache keeps API responses fast
6. On the 1st of every month at midnight ET, old data is exported to
   `STORED_DATA_DIR` and purged from the database automatically

## Tech Stack

- **Runtime**: Node.js + Express
- **Database**: PostgreSQL via Prisma ORM
- **Data source**: Cisco CMX WiFi Analytics API
- **Process management**: systemd (production) / PM2 (local dev)
- **Analytics**: Python scripts (`extract_summary.py`, `big_summary.py`, `visualize_summary.py`)

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
| `CMX_AUTH` | Base64-encoded Cisco CMX credentials |
| `ADMIN_TOKEN` | Token for `/admin` dashboard access |
| `STORED_DATA_DIR` | Where monthly exports and analytics files live |
| `DASHBOARD_START_MONTH` | Oldest month shown in analytics dashboard (`YYYY-MM`) |
| `DASHBOARD_END_MONTH` | Newest month shown in analytics dashboard (`YYYY-MM`) |

See `.env.example` for a complete template.

## Documentation

- **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** — local development setup
- **[SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)** — production deployment with systemd

## Privacy

Only anonymized device IDs are tracked — no personal information, no names, no identities.
The system counts devices, not people.

---

**Author**: Meng Qu (Web Design Librarian, Miami University Libraries)
**License**: ISC
