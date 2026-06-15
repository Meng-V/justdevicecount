# Server Deployment Guide

This guide covers deploying JustDeviceCount on the production server using systemd.

## Overview

- **Production**: systemd service, HTTPS, runs as `devicecount` user
- **Local dev**: PM2 via `./start.sh` (HTTP only)

The server uses systemd to manage the process — not PM2, not dist builds.

---

## Server Information

- **App path**: `/opt/devicecount/current`
- **Data path**: `/home/qum/stored_data` (persists across deployments)
- **Service user**: `devicecount`
- **Service name**: `crowd-index`
- **Port**: 3012
- **Process manager**: systemd

---

## Prerequisites

1. SSH access to the server
2. Access to the `devicecount` user account
3. Sudo access to run `sudo service crowd-index restart`

---

## Deployment Workflow

### 1. Pull the latest code

```bash
sudo su - devicecount
cd /opt/devicecount/current
git pull
```

### 2. Install dependencies (only if package.json changed)

```bash
npm install --production
```

### 3. Update database schema (only if prisma/schema.prisma changed)

```bash
npx prisma generate
npx prisma db push
```

### 4. Restart the service

Exit back to your own user first, then restart:

```bash
exit
sudo service crowd-index restart
```

### 5. Verify

```bash
sudo service crowd-index status
sudo journalctl -u crowd-index -n 30
```

---

## Service Management Commands

| Command | Description |
|---------|-------------|
| `sudo service crowd-index start` | Start the service |
| `sudo service crowd-index stop` | Stop the service |
| `sudo service crowd-index restart` | Restart the service |
| `sudo service crowd-index status` | Check service status |
| `sudo journalctl -u crowd-index -f` | Stream live logs |
| `sudo journalctl -u crowd-index -n 50` | Last 50 log lines |

---

## How It Works

The systemd service runs `node bin/www` directly inside `/opt/devicecount/current`:

1. **Service file**: `/etc/systemd/system/crowd-index.service` (managed by IT)
2. **Startup**: `node bin/www`
3. **User**: `devicecount`
4. **Auto-restart**: systemd restarts on crash
5. **Boot**: starts automatically on server boot

---

## Required Files on Server

```
/opt/devicecount/current/
├── .env                    # all secrets and config — DO NOT commit
├── config/default.json     # CMX API URLs and auth — DO NOT commit
└── certs/
    └── <hostname>.key      # SSL private key

/home/qum/stored_data/      # persists across deployments
├── device_data_export_until_*.json
├── summaries/
│   └── YYYY-MM_summary.json
└── analysis/
    ├── big_summary.json
    └── dashboard.html
```

### Complete .env for production

```
DATABASE_URL="postgresql://user:pass@host:5432/crowd_index?schema=public&sslmode=require"
NODE_ENV=production
PORT=3012
TZ=America/New_York
PRODUCTION_HOSTNAME=app.lib.miamioh.edu
PROD_CERT_PATH=/etc/pki/tls/certs/<hostname>.crt
PROD_KEY_PATH=./certs/<hostname>.key
CMX_AUTH=Basic <base64credentials>
ADMIN_TOKEN=<random-token>
STORED_DATA_DIR=/home/qum/stored_data
DASHBOARD_START_MONTH=2025-10
DASHBOARD_END_MONTH=2026-05
```

---

## Troubleshooting

### Service will not start

```bash
sudo journalctl -u crowd-index -n 50
```

Common causes:
- Missing `.env` file or required variable
- SSL certificate path wrong or file missing
- Port 3012 already in use
- Database unreachable

### Database connection errors

```bash
sudo su - devicecount
cd /opt/devicecount/current
npx prisma db pull
```

### Permission issues

```bash
sudo chown -R devicecount:devicecount /opt/devicecount/current
```

### Check the live app URL

```
https://app.lib.miamioh.edu/crowdindex/
https://app.lib.miamioh.edu/crowdindex/health
```

---

## Local vs Production Differences

| Aspect | Local dev | Production |
|--------|-----------|------------|
| Location | your machine | `/opt/devicecount/current` |
| Run as | your user | `devicecount` |
| Process manager | PM2 | systemd |
| Protocol | HTTP | HTTPS |
| Start | `./start.sh start` | `sudo service crowd-index restart` |
| Logs | `pm2 logs` | `sudo journalctl -u crowd-index -f` |

---

## Security Notes

1. Never commit `.env` or `config/default.json`
2. SSL certificates are required — the app exits if paths are missing
3. `ADMIN_TOKEN` gates the analytics dashboard; generate with:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
4. Service runs as `devicecount`, not root

---

## Quick Reference

```bash
sudo su - devicecount
cd /opt/devicecount/current
git pull
exit
sudo service crowd-index restart
sudo service crowd-index status
sudo journalctl -u crowd-index -f
```

---

## Monthly CRON Job (export-and-purge)

The CRON job is built into the app via **node-cron** — no OS crontab needed.
It fires automatically at **00:00 ET on the 1st of every month** while the
`crowd-index` service is running.

### What it does

| Step | Action |
|------|--------|
| 1 | Cutoff = first day of 2 months ago (keeps last 2 months in DB) |
| 2 | Exports all rows older than cutoff to a JSON file in `STORED_DATA_DIR` |
| 3 | Verifies exported row count matches DB count |
| 4 | Deletes the exported rows from the database |

### STORED_DATA_DIR must be set in .env

```
STORED_DATA_DIR=/home/qum/stored_data
```

This directory is **outside** `/opt/devicecount/current` so data survives
every deployment.

### Test the CRON job after every deployment

```bash
cd /opt/devicecount/current
node scripts/test_cron.js
```

Expected output: `All 6/6 checks passed. CRON job is ready to deploy.`

Dry-run the export at any time (no DB changes):

```bash
cd /opt/devicecount/current
node scripts/export_and_purge.js --dry-run
```

### Check CRON logs

```bash
sudo journalctl -u crowd-index -n 100
```

Look for:
- `Monthly export-and-purge job triggered`
- `export_and_purge.js exited with code 0` — success
- `export_and_purge.js exited with code 1` — failure

### Manual trigger (if app was down on the 1st)

```bash
cd /opt/devicecount/current
node scripts/export_and_purge.js --dry-run
node scripts/export_and_purge.js
```

### Extend the dashboard date range after each CRON run

After the CRON runs and you have regenerated `big_summary.json`, bump the end date:

```bash
# 1. Pull new data into monthly summary files
STORED_DATA_DIR=/home/qum/stored_data python3 scripts/extract_summary.py

# 2. Rebuild big_summary.json
STORED_DATA_DIR=/home/qum/stored_data python3 scripts/big_summary.py

# 3. Edit .env — change DASHBOARD_END_MONTH to include the new month
#    e.g. DASHBOARD_END_MONTH=2026-06

# 4. Restart
sudo service crowd-index restart
```

---

## Getting Help

- **Service issues**: Contact IT support for systemd configuration
- **App issues**: Check `sudo journalctl -u crowd-index -n 100`
- **DB issues**: Verify `DATABASE_URL` in `.env`
- **CRON issues**: Confirm `STORED_DATA_DIR` is set and writable; run `node scripts/test_cron.js`

---

**Last updated**: 2026-06-15
**Maintained by**: Meng Qu (Web Design Librarian)
