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
- **Service name**: `crowdindex`
- **Port**: 3012
- **Process manager**: systemd

---

## Prerequisites

1. SSH access to the server
2. Sudo access from your own account (the deploy script runs as root and drops
   to `devicecount` where it needs to)

---

## Deployment Workflow

Deploy with the Puppet-generated script, from your own account (not as `devicecount`):

```bash
sudo bash /opt/devicecount/deploy.sh          # deploys main
sudo bash /opt/devicecount/deploy.sh <branch> # or another branch
```

It never touches the running build. Each run:

1. Clones the branch fresh into `/opt/devicecount/builds/<timestamp>` (`--depth 1`)
2. Replaces `.env`, `config/` and `certs/` in the new build with symlinks into
   `/opt/devicecount/shared/` — the real secrets live only there
3. Runs `npm install` as `devicecount`
4. Points the `current` symlink at the new build
5. Restarts `crowdindex.service`
6. Deletes all but the 5 newest builds

The script stops at the first failing step (`set -euo pipefail`). Anything that
fails before step 4 leaves the old version running untouched.

> **Do not `git pull` inside `current`.** `current/config` is a symlink, so git
> sees `config/default.json` as deleted and refuses any pull that touches it.
> `git stash`, `git checkout -- config` or `git reset --hard` "fix" that by
> replacing the symlink with the repo's placeholder config — after the next
> restart CMX rejects the placeholder credentials and every count reads 0.

### Before deploying: note the current build

```bash
readlink /opt/devicecount/current
```

### Verify

```bash
readlink /opt/devicecount/current          # the new builds/<timestamp>
sudo -u devicecount git -C /opt/devicecount/current log --oneline -1
ls -ld /opt/devicecount/current/config      # -> /opt/devicecount/shared/config
systemctl status crowdindex --no-pager | head -5
sudo tail -n 30 /var/log/crowdindex/crowdindex.log
```

### Roll back

Point `current` at the build you noted and restart:

```bash
sudo -u devicecount ln -sfn /opt/devicecount/builds/<previous-timestamp> /opt/devicecount/current
sudo systemctl restart crowdindex
```

### Database schema changes (only if prisma/schema.prisma changed)

`deploy.sh` does not touch the database. After deploying, as `devicecount` in
`/opt/devicecount/current`, use the **local** Prisma binary, NOT `npx prisma` —
`npx` can silently resolve a newer major version (e.g. Prisma 7) and break the build:

```bash
./node_modules/.bin/prisma generate
./node_modules/.bin/prisma db push
```

`db push` is **additive** for new models — it creates the `rec_data` table
without touching the existing `device_data` table or its rows. Restart the
service afterwards.

---

## Service Management Commands

| Command | Description |
|---------|-------------|
| `sudo service crowdindex start` | Start the service |
| `sudo service crowdindex stop` | Stop the service |
| `sudo service crowdindex restart` | Restart the service |
| `sudo service crowdindex status` | Check service status |
| `sudo tail -f /var/log/crowdindex/crowdindex.log` | Stream live logs |
| `sudo tail -n 50 /var/log/crowdindex/crowdindex.log` | Last 50 log lines |

### Where the logs actually are

The unit sends stdout/stderr to files, **not** to journald, so
`journalctl -u crowdindex` returns nothing at all:

```
StandardOutput=append:/var/log/crowdindex/crowdindex.log
StandardError=append:/var/log/crowdindex/crowdindex.error.log
```

- The files rotate daily around 03:xx. Older days are `crowdindex.log.1`,
  then `crowdindex.log.2.gz`, `.3.gz`, … — read those with `sudo zgrep` / `sudo zcat`.
- Two timestamp formats appear in the same file. The collector writes
  `[Thu Oct 15 2026 12:45:00 GMT-0400 ...]`; CMX request lines and cron jobs write
  `[10/15/2026, 12:45:03 PM]`. Grep for both when you are looking for a time window.
- A healthy collection cycle logs `Collecting device data...`, then
  `Devices connected in ...` per floor, then `Saved to database` and
  `Device data collection completed`. A cycle that logs only the first line and
  nothing else means the CMX requests are hanging.

---

## How It Works

The systemd service runs `node bin/www` directly inside `/opt/devicecount/current`:

1. **Service file**: `/etc/systemd/system/crowdindex.service` (managed by IT)
2. **Startup**: `node bin/www`
3. **User**: `devicecount`
4. **Auto-restart**: systemd restarts on crash
5. **Boot**: starts automatically on server boot

---

## Required Files on Server

```
/opt/devicecount/shared/    # the real files; each build links to them
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

### Where the .env and config actually live (IMPORTANT)

The deployment uses a symlinked release layout (built by `deploy.sh`):

```
/opt/devicecount/
├── deploy.sh                           # Puppet-generated deploy script
├── current  ->  builds/<timestamp>     # symlink, swapped on each deploy
├── shared/
│   ├── .env                            # the REAL .env (root-owned)
│   ├── config/default.json             # the REAL CMX config (with auth)
│   └── certs/
└── builds/<timestamp>/                 # one fresh clone per deploy, 5 kept
    ├── .env    ->  /opt/devicecount/shared/.env
    ├── config  ->  /opt/devicecount/shared/config
    └── certs   ->  /opt/devicecount/shared/certs
```

- The app's `dotenv` loads `.env` from its working dir (`current/`), which is a
  **symlink to `/opt/devicecount/shared/.env`**. Edit the shared file, never the build.
- Likewise `config/` is a symlink: edit `/opt/devicecount/shared/config/default.json`.
  The repo's `config/default.json` only carries a placeholder for `app.auth`.
  Every key the code added later (e.g. `rec.capacity`) has a default in the code,
  so the shared file does not need them.
- The base systemd unit (`/etc/systemd/system/crowdindex.service`) is generated by
  **Puppet** — do not edit it directly; Puppet will overwrite it.

### Complete .env for production (`/opt/devicecount/shared/.env`)

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
# Optional — see .env.example
# ALERT_EMAIL=<who gets the health-check e-mails>
# DASHBOARD_START_MONTH=2025-10
```

Leave `DASHBOARD_END_MONTH` unset. If it is set, every month after it stays hidden on
the admin dashboard until someone edits it. Check with
`sudo grep DASHBOARD /opt/devicecount/shared/.env`.

### systemd environment override

`STORED_DATA_DIR` is also pinned via a systemd drop-in so the running process
always has it regardless of dotenv resolution:

`/etc/systemd/system/crowdindex.service.d/override.conf`
```
[Service]
Environment="STORED_DATA_DIR=/home/qum/stored_data"
```

This drop-in is **not in git and not managed by Puppet** — recreate it on a fresh
server with `sudo systemctl edit crowdindex.service`, then
`sudo systemctl daemon-reload && sudo service crowdindex restart`.

---

## Data Directory Permissions (CRITICAL)

The app runs as the **`devicecount`** service user — NOT your personal account.
Anything it reads or writes (the data directory, exports, the dashboard source)
must be readable/writable by `devicecount`.

The data lives in `/home/qum/stored_data`, but `/home/qum` is mode `700`, so by
default `devicecount` cannot even traverse into it. Access is granted with ACLs:

```bash
# Let devicecount traverse into the home dir (execute only — cannot list it)
sudo setfacl -m u:devicecount:--x /home/qum

# Grant devicecount read/write on the data folder and everything in it
sudo setfacl -R -m u:devicecount:rwX /home/qum/stored_data

# Make NEW files inherit access (so monthly CRON exports are reachable)
sudo setfacl -R -d -m u:devicecount:rwX /home/qum/stored_data

# So qum can also read files the CRON job creates as devicecount
sudo setfacl -R -d -m u:qum:rwX /home/qum/stored_data
```

**Verify access exactly as the app sees it:**
```bash
sudo -u devicecount cat /home/qum/stored_data/analysis/big_summary.json | head -c 50
```
JSON output = good. `Permission denied` = ACLs missing or lost.

ACLs survive deploys, but can be lost on remount, restore-from-backup, or if the
folder is recreated. Re-check with `getfacl /home/qum/stored_data`.

> If `setfacl` returns "Operation not supported", the filesystem lacks ACL support —
> ask the administrator to grant the **`devicecount`** account access to the path.

---

## Post-Deploy Checklist

Run through this after every deployment:

1. **Service is up**
   `sudo service crowdindex status` → `active (running)`
2. **Process has STORED_DATA_DIR**
   `sudo cat /proc/$(pgrep -f "node.*bin/www")/environ | tr '\0' '\n' | grep STORED`
3. **devicecount can read the data**
   `sudo -u devicecount cat /home/qum/stored_data/analysis/big_summary.json | head -c 50`
4. **Health endpoint is green**
   open `https://app.lib.miamioh.edu/crowdindex/health` → `"status":"ok"`
5. **Admin dashboard loads**
   open `/crowdindex/admin?t=<ADMIN_TOKEN>`
6. **CRON readiness** (see CRON section below)
   `node scripts/test_cron.js` → all 6 checks pass

---

## Troubleshooting

### Service will not start

```bash
sudo tail -n 50 /var/log/crowdindex/crowdindex.log
```

Common causes:
- Missing `.env` file or required variable
- SSL certificate path wrong or file missing
- Port 3012 already in use
- Database unreachable

### Database connection errors

Test the connection without changing anything:

```bash
sudo su - devicecount
cd /opt/devicecount/current
node -e 'require("dotenv").config(); const { PrismaClient } = require("@prisma/client"); const p = new PrismaClient(); p.$queryRaw`SELECT 1`.then(() => console.log("DB OK")).catch((e) => console.error(e.message)).finally(() => p.$disconnect())'
```

Do not use `prisma db pull` to test: it overwrites `prisma/schema.prisma`, and `npx`
may fetch a newer major Prisma version.

### Permission issues

The app writes only to `STORED_DATA_DIR` and `/var/log/crowdindex/`. A permission
error almost always means the ACLs on `/home/qum/stored_data` were lost; see
[Data Directory Permissions](#data-directory-permissions-critical). Do not `chown`
`current` (it is a symlink, so that changes nothing) or `shared/` (root-owned on purpose).

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
| Start | `./start.sh start` | `sudo service crowdindex restart` |
| Logs | `pm2 logs` | `sudo tail -f /var/log/crowdindex/crowdindex.log` |

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
readlink /opt/devicecount/current          # note it, for rollback
sudo bash /opt/devicecount/deploy.sh
systemctl status crowdindex --no-pager | head -5
sudo tail -f /var/log/crowdindex/crowdindex.log
```

---

## Scheduled Jobs

All jobs are built into the app via **node-cron** — no OS crontab needed. They run
in Eastern Time while the `crowdindex` service is running, and each logs
`<script> exited with code N` to `/var/log/crowdindex/crowdindex.log`.

| When | Script | What it does |
|------|--------|--------------|
| Every hour at `:05` | `refresh_summaries.js --no-analysis` | Merges new DB rows into `summaries/` and `rec_summaries/` (skipped while the monthly job runs) |
| Daily 03:15 | `refresh_summaries.js` | Same, then rebuilds `analysis/big_summary.json` via `big_summary.py` |
| Daily 07:00 | `data_health_check.js` | E-mails `ALERT_EMAIL` if something is wrong; see [Alert e-mails](#alert-e-mails-and-what-to-do) |
| 1st of the month, 00:00 | `refresh_summaries.js`, then `export_and_purge.js` | See below |

Nothing here needs a person. The dashboard picks up new months by itself, as long as
`DASHBOARD_END_MONTH` is unset.

## Monthly CRON Job (export-and-purge)

Fires at **00:00 ET on the 1st of every month**.

### What it does

| Step | Action |
|------|--------|
| 1 | Runs `refresh_summaries.js`, so every row is in the summary files before any is deleted. If it fails, the purge is skipped |
| 2 | Cutoff = first day of the month before last (on 1 Nov: rows before 1 Sep go; September and October stay) |
| 3 | Exports all `device_data` and `rec_data` rows older than the cutoff to JSON files in `STORED_DATA_DIR` |
| 4 | Verifies exported row count matches DB count |
| 5 | Deletes the exported rows from the database |

Purged months stay on the dashboard: it reads the summary files, which keep every
record already merged into them.

### STORED_DATA_DIR must be set in .env

```
STORED_DATA_DIR=/home/qum/stored_data
```

This directory is **outside** `/opt/devicecount/current` so data survives
every deployment.

### Test the CRON job safely (no DB changes, easy cleanup)

`test_cron.js` runs all 6 checks and performs a **dry-run** of the export.
The dry-run **never deletes DB rows**, but it DOES write a real export file.
To keep test files out of the live data folder, point `STORED_DATA_DIR` at a
throwaway directory so cleanup is a single `rm -rf`:

```bash
cd /opt/devicecount/current

# 1. Run the full readiness test into a temp dir (no DB deletes, no live files)
STORED_DATA_DIR=/tmp/cron_test node scripts/test_cron.js

# 2. Inspect what it generated
ls -la /tmp/cron_test

# 3. Delete everything the test created
rm -rf /tmp/cron_test
```

Expected output: `All 6/6 checks passed. CRON job is ready to deploy.`

To test as the real service user (`devicecount`) — the most faithful check:

```bash
sudo -u devicecount env STORED_DATA_DIR=/tmp/cron_test_dc \
  node /opt/devicecount/current/scripts/export_and_purge.js --dry-run
rm -rf /tmp/cron_test_dc
```

> Why a temp dir: a dry-run against the live `STORED_DATA_DIR` would leave a
> `device_data_export_until_*_run_<timestamp>.json` file in `/home/qum/stored_data`.
> It is harmless but clutters the real data folder. If you do run it against the
> live dir, clean up only files with today's run-stamp:
> `rm /home/qum/stored_data/device_data_export_until_*_run_$(date +%Y-%m-%d)*.json`

### Check CRON logs

```bash
sudo tail -n 100 /var/log/crowdindex/crowdindex.log
```

Look for:
- `Monthly maintenance job triggered`
- `refresh_summaries.js exited with code 0`, then `export_and_purge.js exited with code 0` — success
- any `exited with code 1` — failure

### Manual trigger (if app was down on the 1st)

As `devicecount`, in `/opt/devicecount/current`:

```bash
node scripts/refresh_summaries.js
node scripts/export_and_purge.js --dry-run
node scripts/export_and_purge.js
```

### Refresh the dashboard by hand

Never needed in normal operation. After changing rows in the database (for example
after a correction), run as `devicecount` in `/opt/devicecount/current`:

```bash
node scripts/refresh_summaries.js            # merge DB rows over the summary files
node scripts/refresh_summaries.js --rebuild  # after DELETING rows: replace instead of merge
```

The old manual pipeline (`extract_summary.py`, then `big_summary.py`, then bumping
`DASHBOARD_END_MONTH`) is retired.

---

## Alert e-mails and what to do

`data_health_check.js` runs at 07:00 ET and e-mails `ALERT_EMAIL` only when something
is wrong. A healthy day sends nothing. To confirm delivery still works:
`node scripts/data_health_check.js --test`.

Every alert has the subject `[Crowd Index] Data collection problem on <host>`; the
body lists the problems:

| The e-mail says | Usually means | Do this |
|-----------------|---------------|---------|
| `no new rows for N minutes`, `only N rows in the last 24h`, or `the table is EMPTY` | The collector cannot get data from CMX: CMX is down, or its TLS certificate expired (July 2026: three weeks unnoticed) | `sudo tail -n 50 /var/log/crowdindex/crowdindex.log`. Repeated `certificate has expired` or `all retries exhausted` means CMX itself is broken: contact the network team, nothing to change in this app. No collection lines at all: `systemctl status crowdindex` |
| `every reading is 0` | Same as above, or a code change brought back storing failed cycles as 0 | As above |
| `Recreation Center: N devices counted while the building was closed` | CMX now flags departed clients in a way `staleClientFilter.js` does not catch, so every count is inflated again. Normal is about 10 | Needs a developer: compare what CMX sends for those clients (`networkStatus`, `currentlyTracked`) with `modules/staleClientFilter.js` |
| `Dashboard analysis file is Nh old` or `missing` | The 03:15 summary refresh failed | `sudo grep refresh_summaries /var/log/crowdindex/crowdindex.log \| tail`, then run it by hand (above) |

When CMX comes back after an outage, collection resumes by itself; the missing hours
stay missing.

---

## Ghost history correction (Sep–Oct 2026)

From about 5 Sep 2026 CMX stopped expiring departed clients, and every stored reading
until `staleClientFilter.js` went live (22:58 ET, 29 Oct 2026) was inflated: King by
100–200 devices, the Rec by 150–340. `scripts/correct_ghost_history.js` rewrites
those rows once:

- **King** — device by device: a device frozen in place for 45+ minutes is removed,
  minus the idle-but-real devices each floor normally has.
- **Rec** — estimated, because its rows keep only per-floor totals: the excess over a
  healthy closed-hours reading, interpolated between nights.

`scripts/ghost_history_diag.js` is the read-only measurement behind it.

The originals of every row in the period are saved in
`/home/qum/stored_data/ghost_correction_backup.json`. To undo, as `devicecount` in
`/opt/devicecount/current`:

```bash
node scripts/correct_ghost_history.js --restore
node scripts/refresh_summaries.js
```

`--restore` only reaches rows still in the database: September until the 1 Dec
purge, October until 1 Jan.

**Status**: scheduled for 30 Oct 2026.

---

## Getting Help

- **Service issues**: Contact IT support for systemd configuration
- **App issues**: Check `sudo tail -n 100 /var/log/crowdindex/crowdindex.log`
- **DB issues**: Verify `DATABASE_URL` in `.env`
- **CRON issues**: Confirm `STORED_DATA_DIR` is set and writable; run `node scripts/test_cron.js`
- **Alert e-mails**: see [Alert e-mails and what to do](#alert-e-mails-and-what-to-do)

---

**Last updated**: 2026-10-30
**Maintained by**: Meng Qu (Web Design Librarian)
