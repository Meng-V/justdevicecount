# JustDeviceCount - Developer Guide

Complete technical guide for deploying and customizing JustDeviceCount at your institution.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Database Configuration](#database-configuration)
- [CMX API Configuration](#cmx-api-configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Environment Variables](#environment-variables)
- [Deployment Options](#deployment-options)
- [Customization](#customization)
- [Troubleshooting](#troubleshooting)
- [Production Best Practices](#production-best-practices)

## Prerequisites

### Required Software
- **Node.js**: v18.x or higher
- **npm**: v9.x or higher
- **PostgreSQL**: v14.x or higher
- **PM2**: v5.x or higher (for production)
- **Git**: For version control

### Required Access
- **Cisco CMX API**: Network credentials with read access
- **PostgreSQL Server**: Database credentials with CREATE/ALTER permissions
- **Server/VM**: Linux server with sudo access (or equivalent)

### System Requirements
- **RAM**: 512MB minimum, 1GB recommended
- **Disk**: 1GB minimum for application and logs
- **Network**: Outbound HTTPS access to CMX API
- **Ports**: 3012 (configurable) for application server

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/Meng-V/justdevicecount.git
cd justdevicecount
```

### 2. Install Dependencies

```bash
npm install
```

This installs all required packages including:
- Express.js (web framework)
- Prisma (database ORM)
- Axios (HTTP client)
- PM2 (process manager)
- Webpack (build system)

### 3. Verify Installation

```bash
npm test
```

This runs the comprehensive test suite to verify dependencies are correctly installed.

## Database Configuration

### 1. Create PostgreSQL Database

Connect to your PostgreSQL server:

```bash
psql -h your-database-host -U your-username
```

Create the database:

```sql
CREATE DATABASE crowd_index;
```

### 2. Configure Database Connection

Create a `.env` file in the project root:

```bash
# .env file
DATABASE_URL="postgresql://username:password@hostname:5432/crowd_index?schema=public"

# Example:
# DATABASE_URL="postgresql://dbuser:securepass@db.example.edu:5432/crowd_index?schema=public"
```

**Format Breakdown**:
- `username`: Your PostgreSQL username
- `password`: Your PostgreSQL password
- `hostname`: Database server hostname or IP
- `5432`: PostgreSQL port (default)
- `crowd_index`: Database name
- `schema=public`: PostgreSQL schema (usually public)

### 3. Initialize Database Schema

Run Prisma migrations to create tables:

```bash
# Push schema to database
npx prisma db push

# Generate Prisma Client
npx prisma generate
```

This creates two tables:

```
device_data                         (King Library)
├── id (String, Primary Key)
├── timeStamp (DateTime, indexed)
├── uniqUserTotal (String[])
├── uniqUserGround (JSON)           # { deviceId: [x, y] } per floor
├── uniqUserFirst (JSON)
├── uniqUserSecond (JSON)
├── uniqUserThird (JSON)
├── patrons (Int, indexed)          # unique devices, all floors
└── countByFloor (Int[])

rec_data                            (Recreation Center — totals only, no device lists)
├── timeStamp, patrons (raw device count), countByFloor [ground, first]
```

### 4. Verify Database Connection

```bash
node test_comprehensive.js
```

Look for "✅ Successfully connected to database!"

## CMX API Configuration

### 1. Obtain CMX Credentials

Contact your network team to get:
- CMX API base URL
- Username with API access
- Password or API token
- Building/floor map IDs

### 2. Configure CMX Settings

Copy `config/default.json.example` to `config/default.json` and fill in the CMX
host, one URL per floor, and `app.auth` (`"Basic <base64 of user:password>"`, or set
`CMX_AUTH` in `.env` instead):

```json
{
  "address": {
    "host": "https://your-cmx-server.institution.edu/",
    "ground-add": "api/location/v3/clients?floorId=YOUR_GROUND_FLOOR_ID",
    "first-add":  "api/location/v3/clients?floorId=YOUR_FIRST_FLOOR_ID",
    "second-add": "api/location/v3/clients?floorId=YOUR_SECOND_FLOOR_ID",
    "third-add":  "api/location/v3/clients?floorId=YOUR_THIRD_FLOOR_ID",
    "rec-first":  "api/location/v3/clients?floorId=YOUR_REC_FIRST_FLOOR_ID",
    "rec-ground": "api/location/v3/clients?floorId=YOUR_REC_GROUND_FLOOR_ID",
    ...
  },
  "app": { "auth": "Basic YOUR_BASE64_CREDENTIALS" },
  "rec": { ... },          // Rec formula tunables — see Customization
  "collection": { ... }    // overnight silent windows — see Customization
}
```

The floor IDs come from your network team or the CMX map hierarchy.

### 3. Test CMX Connection

Run the comprehensive test:

```bash
npm test
```

This verifies:
- CMX API connectivity
- Authentication
- Data retrieval
- Response parsing

## SSL/HTTPS Setup

### Option 1: Self-Signed Certificate (Development)

```bash
mkdir -p security
cd security

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout cert.key -out cert.pem -days 365 -nodes

cd ..
```

### Option 2: Institutional Certificate (Production)

Your institution's IT team provides the certificate files. Set the paths in `.env`:

```
PROD_CERT_PATH=/etc/pki/tls/certs/your-server.edu.crt
PROD_KEY_PATH=./certs/your-server.edu.key
```

The app reads these paths at startup. If either is missing, the process exits with an
error message telling you exactly which path it could not find.

### Option 3: Let's Encrypt

```bash
sudo certbot certonly --standalone -d your-domain.example.edu
```

Then set in `.env`:

```
PROD_CERT_PATH=/etc/letsencrypt/live/your-domain.example.edu/fullchain.pem
PROD_KEY_PATH=/etc/letsencrypt/live/your-domain.example.edu/privkey.pem
```

### Verify SSL Setup

The app uses `PROD_CERT_PATH` and `PROD_KEY_PATH` from `.env` — not a fixed directory.
For local development no SSL is needed; the app runs HTTP automatically when
`NODE_ENV=development`.

## Environment Variables

Complete `.env` file — copy `.env.example` and fill in real values:

```
DATABASE_URL=postgresql://user:pass@host:5432/crowd_index?schema=public&sslmode=require
NODE_ENV=production
PORT=3012
TZ=America/New_York
PRODUCTION_HOSTNAME=your-server.edu
PROD_CERT_PATH=/etc/pki/tls/certs/your-server.edu.crt
PROD_KEY_PATH=./certs/your-server.edu.key
CMX_AUTH=Basic <base64credentials>
ADMIN_TOKEN=<random-token>
STORED_DATA_DIR=/home/qum/stored_data
ALERT_EMAIL=someone@your-institution.edu
```

**Environment Variables Explained**:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `NODE_ENV` | yes | `development` (HTTP) or `production` (HTTPS) |
| `PORT` | yes | Server port (default `3012`) |
| `TZ` | yes | Timezone for all logging (`America/New_York`) |
| `PRODUCTION_HOSTNAME` | production | Public hostname; triggers HTTPS mode |
| `PROD_CERT_PATH` | production | Path to SSL certificate file |
| `PROD_KEY_PATH` | production | Path to SSL private key file |
| `CMX_AUTH` | either this or `app.auth` | Base64 `Basic` auth for Cisco CMX API; overrides `app.auth` in `config/default.json` |
| `CMX_TIMEOUT_MS` | optional | Per-request CMX timeout (default `30000`) |
| `ADMIN_TOKEN` | recommended | Token protecting `/crowdindex/admin` |
| `STORED_DATA_DIR` | production | Where monthly exports and analytics files live |
| `ALERT_EMAIL` | production | Recipient of the daily health-check alerts (defaults to the original maintainer) |
| `ALERT_FROM`, `ALERT_MIN_ROWS_24H`, `ALERT_MAX_STALE_MIN`, `ALERT_REC_CLOSED_MAX` | optional | Health-check tuning; see `.env.example` |
| `DASHBOARD_START_MONTH` | optional | Oldest month shown on analytics dashboard (`YYYY-MM`) |
| `DASHBOARD_END_MONTH` | optional | Newest month shown. Leave unset, or new months stay hidden |

## Deployment Options

### Local Development

For testing and development on your local machine:

```bash
# Direct node execution
npm start

# Or with PM2 for auto-restart during development
./start.sh start
```

**PM2 Configuration** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [{
    name: 'justdevicecount',
    script: './bin/www',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: true,  // Auto-reload on file changes
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'development',
      PORT: 3012
    }
  }]
};
```

### Server Production Deployment

**For production server deployment, see [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md)**

The production server uses systemd service management (not PM2):
- Service name: `crowdindex`
- Restart: `sudo service crowdindex restart`
- Logs: `sudo tail -f /var/log/crowdindex/crowdindex.log`
- Runs: `bin/www` directly

The SERVER_DEPLOYMENT.md guide covers:
- Complete deployment workflow
- Service management commands
- Troubleshooting production issues
- Differences from local development

### Local PM2 Management Commands

These commands are for **local development only**:

```bash
# Start application
./start.sh start

# Stop application
./start.sh stop

# Restart application
./start.sh restart

# View logs
./start.sh logs

# Check status
./start.sh status

# Monitor in real-time
npm run pm2:monit

# Remove from PM2
./start.sh delete
```

**Note**: For production server deployment, use systemd commands instead. See [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md).

## Customization

### Modify Building Configuration

**Floor Boundaries** (X/Y coordinates on the CMX map) are in `modules/app_core.js`:

```javascript
const KING_FLOOR_BOUNDS = {
  ground: { minX: 10,  maxX: 314, minY: 36, maxY: 190 },
  first:  { minX: 16,  maxX: 314, minY: 29, maxY: 190 },
  // second, third ...
};

const REC_FLOOR_BOUNDS = {
  ground: { minX: 10,  maxX: 300, minY: 20,  maxY: 214 },
  first:  { minX: 190, maxX: 425, minY: 25,  maxY: 270 },
};
```

Signal strength and last-seen checks are in `modules/deviceUtils.js`; dropping the
clients CMX keeps listing after people leave is in `modules/staleClientFilter.js`.

**Recreation Center formula** — `config/default.json` under `rec`, used by
`modules/recFormula.js`:

| Key | Default | Meaning |
|-----|---------|---------|
| `baselineDevices` | 10 | Always-on devices subtracted from the hourly mean (the Rec reads 8–15 while closed) |
| `devicesPerPatron` | 1.2 | Devices per person: `patrons = (hourlyMean − baseline) / devicesPerPatron` |
| `capacity` / `widgetMax` | 200 / 200 | `/recapi` scales its figure by `widgetMax / capacity` for the public widget, which hard-codes 200 |
| `groundFirstGate` | 1.0 | Ground/first ratio above which a reading is flagged as suspect |

**Overnight silent windows** — `config/default.json` under `collection.silentHours`
(defaults King 02:00–07:00, Rec 02:00–05:00). The collector keeps polling but does not
write; the health check uses the same windows.

**Building Names**:

Update route files in `routes/`:
- `routes/patronapi.js` - King Library endpoint
- `routes/recapi.js` - Recreation Center endpoint
- `routes/count_by_floor.js` - Multi-building endpoint

### Change Base Path

Edit `app.js`:

```javascript
const basePath = "/crowdindex"; // Change to your preferred path
```

### Update Interval

Collection is aligned to `:00/:15/:30/:45` by `DeviceDataService` in
`modules/app_core.js`. The 15-minute step is also assumed by the Rec's hourly mean
(4 samples, `modules/recFormula.js` and `recHourlyMean()` in `app_core.js`) and by the
health check's expected rows per day (`modules/collectionWindow.js`). Changing the
interval means changing all three.

### Customize Dashboard

Edit `views/index.ejs` to modify the web dashboard:
- Update building names
- Change styling/colors
- Add institutional branding
- Modify visualization

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed

**Error**: `P2021: The table 'device_data' does not exist`

**Solution**:
```bash
npx prisma db push
npx prisma generate
```

#### 2. CMX API Connection Failed

**Error**: `ECONNREFUSED` or `401 Unauthorized`

**Checks**:
- Verify CMX URL in `config/default.json`
- Check username/password
- Ensure network connectivity to CMX server
- Verify firewall rules allow outbound HTTPS

#### 3. SSL Certificate Error

**Error**: the app exits at startup naming a certificate or key path it cannot find

**Solution**: check `PROD_CERT_PATH` and `PROD_KEY_PATH` in `.env`. Locally, run with
`NODE_ENV=development` and no certificate is needed.

#### 3a. Every count is 0, or no new rows

The collector cannot get data from CMX. In July 2026 the CMX server's TLS certificate
expired and collection failed for three weeks. Look for `certificate has expired` or
`all retries exhausted` in the log: that is the CMX side, for the network team. Failed
cycles are no longer stored as 0, so an outage now shows as a gap, and the daily
health check e-mails about it.

#### 3b. Counts far too high, especially while a building is closed

CMX is listing clients that have left. From September 2026 it stopped expiring them;
`modules/staleClientFilter.js` drops a client 30 minutes after CMX marks it `INACTIVE`.
If CMX changes how it flags them, the filter stops working and the health check's
Rec closed-hours alert fires.

#### 4. Port Already in Use

**Error**: `EADDRINUSE: address already in use :::3012`

**Solution**:
```bash
# Find process using port 3012
lsof -i :3012

# Kill the process
kill -9 <PID>

# Or change port in .env file
echo "PORT=3013" >> .env
```

#### 5. PM2 Won't Start

**Checks**:
```bash
# Check PM2 status
pm2 status

# Check logs for errors
pm2 logs justdevicecount --lines 100

# Delete and restart
pm2 delete justdevicecount
pm2 start ecosystem.config.js
```

### Debugging Tools

#### Enable Verbose Logging

```bash
NODE_ENV=development npm start
```

#### Test Database Connection

```bash
node test_comprehensive.js
```

#### Check CMX API Response

Request one of the floor URLs from `config/default.json` (`address.host` +
`address.ground-add`) with the same `Authorization` header the app sends:

```bash
curl -H "Authorization: Basic <base64credentials>" \
  "https://your-cmx-server.institution.edu/api/location/v3/clients?floorId=YOUR_GROUND_FLOOR_ID" | jq length
```

#### Monitor Process

```bash
pm2 monit
```

## Production Best Practices

### Security

1. **Never Commit Secrets**
   - Keep `.env` out of version control
   - Use `.gitignore` for sensitive files
   - Rotate credentials regularly

2. **Use Strong Passwords**
   - Complex database passwords
   - Secure CMX credentials
   - Restrict database user permissions

3. **Enable SSL/TLS**
   - Use valid certificates
   - Keep certificates updated
   - Configure proper certificate paths

4. **Firewall Configuration**
   - Restrict database access to application server only
   - Limit inbound connections to necessary ports
   - Use VPN/SSH for administrative access

### Performance

1. **Database Optimization**
   ```sql
   -- Add indexes for common queries
   CREATE INDEX idx_timestamp ON device_data(timeStamp);
   CREATE INDEX idx_patrons ON device_data(patrons);
   ```

2. **Memory Management**
   - Monitor PM2 memory usage: `pm2 monit`
   - Set `max_memory_restart` in `ecosystem.config.js`
   - Clear old logs regularly: `pm2 flush`

3. **Log Rotation**
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 10M
   pm2 set pm2-logrotate:retain 7
   ```

### Monitoring

1. **Health Checks** — built in. `scripts/data_health_check.js` runs every day at
   07:00 ET (scheduled in `app.js`) and e-mails `ALERT_EMAIL` when data is missing,
   stale or all zero, when the Rec reads too high while closed, or when the dashboard
   files are stale. No extra cron entry is needed. Verify delivery with
   `node scripts/data_health_check.js --test`. See
   [SERVER_DEPLOYMENT.md → Alert e-mails](SERVER_DEPLOYMENT.md#alert-e-mails-and-what-to-do).

2. **PM2 Monitoring**
   ```bash
   # View real-time metrics
   pm2 monit

   # Check status
   pm2 status

   # View logs
   pm2 logs justdevicecount --lines 50
   ```

3. **Database Maintenance**
   ```sql
   -- Vacuum database monthly
   VACUUM ANALYZE device_data;

   -- Check database size
   SELECT pg_size_pretty(pg_database_size('crowd_index'));
   ```

### Backup Strategy

1. **Database Backups**
   ```bash
   # Daily backup script
   #!/bin/bash
   DATE=$(date +%Y%m%d)
   pg_dump -h hostname -U username crowd_index > /backups/crowd_index_$DATE.sql
   
   # Keep last 30 days
   find /backups -name "crowd_index_*.sql" -mtime +30 -delete
   ```

2. **Configuration Backups**
   ```bash
   # Backup config files (without secrets)
   tar -czf config-backup.tar.gz \
     ecosystem.config.js \
     webpack.config.js \
     prisma/schema.prisma \
     config/default.json.example
   ```

### Updating

1. **Application Updates** (local; production deploys with `deploy.sh`, see
   [SERVER_DEPLOYMENT.md](SERVER_DEPLOYMENT.md#deployment-workflow))
   ```bash
   # Pull latest changes
   git pull origin main

   # Install new dependencies
   npm install

   # Update database schema if changed
   npx prisma db push
   npx prisma generate

   # Restart application (local dev)
   pm2 restart justdevicecount
   
   # Or restart server (production)
   # See SERVER_DEPLOYMENT.md
   ```

2. **Dependency Updates**
   ```bash
   # Check for outdated packages
   npm outdated

   # Update packages
   npm update

   # Test after updates
   npm test
   ```

## Architecture Overview

### File Structure

```
justdevicecount/
├── bin/
│   └── www                         # Server entry point (HTTP dev / HTTPS prod)
├── modules/
│   ├── app_core.js                 # 15-min collection scheduler, floor bounds, both buildings
│   ├── staleClientFilter.js        # Drops clients CMX keeps listing after people leave
│   ├── collectionWindow.js         # Overnight silent windows (shared with the health check)
│   ├── recFormula.js               # Rec devices → patrons (shared by /recapi and admin)
│   ├── patronCache.js              # In-memory cache layer
│   ├── axiosApi.js                 # Cisco CMX API client with retry
│   ├── deviceUtils.js              # RSSI, last-seen and bounds checks
│   ├── logger.js                   # Winston rotating logger
│   └── prisma.js                   # Shared Prisma singleton
├── routes/
│   ├── index.js                    # Live dashboard
│   ├── patronapi.js                # King Library patron counts (JSON)
│   ├── recapi.js                   # Recreation Center counts (JSON)
│   ├── count_by_floor.js           # Per-floor historical data (JSON)
│   ├── health.js                   # Health check endpoint
│   └── admin.js                    # Analytics dashboard (token-gated)
├── scripts/
│   ├── refresh_summaries.js        # Hourly/nightly: rebuild dashboard summaries from the DB
│   ├── data_health_check.js        # Daily 07:00: e-mail alert on missing/bad data
│   ├── export_and_purge.js         # Monthly CRON: export + delete old data
│   ├── big_summary.py              # Build big_summary.json (run by refresh_summaries.js)
│   ├── ghost_history_diag.js       # One-off, read-only: measure Sep–Oct 2026 ghost inflation
│   ├── correct_ghost_history.js    # One-off: correct those rows (--apply / --restore)
│   ├── initial_export.js           # One-time historical export
│   ├── test_cron.js                # CRON readiness test (6 checks)
│   ├── extract_summary.py          # Legacy manual pipeline (replaced by refresh_summaries.js)
│   └── visualize_summary.py        # Legacy static dashboard HTML
├── views/
│   ├── index.ejs                   # Live dashboard template
│   ├── admin.ejs                   # Analytics dashboard template
│   └── admin_login.ejs             # Token prompt for /admin
├── prisma/
│   └── schema.prisma               # PostgreSQL schema (DeviceData, RecData)
├── config/
│   └── default.json                # CMX API URLs, Rec formula, silent windows — DO NOT commit auth
├── certs/                          # SSL private key — gitignored
├── .env                            # All secrets and config — DO NOT commit
├── .env.example                    # Template for .env
├── app.js                          # Express app, routes, CRON schedule
├── ecosystem.config.js             # PM2 config (local dev only)
├── start.sh                        # Local dev helper script
└── test_comprehensive.js           # Integration test suite
```

### Data Flow

```
CMX API → axiosApi.js → deviceUtils.js → app_core.js → Database (PostgreSQL)
                                              ↓
                                       patronCache.js
                                              ↓
                                    routes/*.js → Client
```

### Process Architecture

- **Main Process**: Express server (bin/www)
- **Background Job 1**: Collector for both buildings (15-minute interval) → `device_data`, `rec_data`
- **Background Job 2**: Cache updater (15-minute interval)
- **Scheduled jobs** (node-cron in `app.js`, each a forked script): hourly and 03:15
  summary refresh, 07:00 health check, monthly export-and-purge — see
  [SERVER_DEPLOYMENT.md → Scheduled Jobs](SERVER_DEPLOYMENT.md#scheduled-jobs)

## Support

### Getting Help

1. **Check logs first**
   ```bash
   # Local development
   pm2 logs justdevicecount --lines 100
   
   # Production server
   sudo tail -n 100 /var/log/crowdindex/crowdindex.log
   ```

2. **Run diagnostics**
   ```bash
   npm test
   ```

3. **Check GitHub Issues**
   - Search existing issues
   - Create new issue with logs

4. **Review this guide**
   - Troubleshooting section
   - Common issues

### Reporting Issues

Include in bug reports:
- Node.js version (`node --version`)
- npm version (`npm --version`)
- OS and version
- Error messages and logs
- Steps to reproduce
- Configuration (redact secrets)

---

**Last Updated**: 2026-10-30  
**Version**: 1.0.0  
**Maintainer**: Meng-V
