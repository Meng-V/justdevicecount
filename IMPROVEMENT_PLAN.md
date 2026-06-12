# JustDeviceCount — Improvement Plan

Generated from comprehensive code review. Items are ordered by priority (Critical → High → Medium → Low).

---

## Critical Issues

### [1.1] `axiosApi.js` — Error object passed as `body` to floor callbacks
- **File:** `modules/axiosApi.js`
- **Problem:** On Axios request failure, `cb(error)` is called with an `Error` object. In `app_core.js`, `processFloorData(body, ...)` immediately accesses `body[i].deviceId`, causing a silent crash and zero data being saved.
- **Fix:** Return early in each callback if `body` is an `Error`, and change `makeFloorRequest` to resolve/reject cleanly.
- **Status:** [x] Done

### [1.3] `export_and_purge.js` — Wrong data range: deletes current-month data
- **File:** `scripts/export_and_purge.js`
- **Problem:** Sets `cutoff = latest.timeStamp` (now), exporting and deleting ALL rows including the current month. Since the CRON job runs on the 1st of each month, it should clean the **month before the previous month** (i.e., keep the last ~60 days intact so the dashboard's 30-day view is never broken).
- **Fix:** Set `cutoff = first day of the month before last` so data from the previous month and current month are preserved.
- **Status:** [x] Done

### [4.1] CMX credentials committed to `config/default.json`
- **File:** `config/default.json`
- **Problem:** The Base64-encoded CMX API credentials are hard-coded in a git-tracked file and can be trivially decoded.
- **Fix:** Move `auth` to `.env` as `CMX_AUTH=Basic ...`, reference via `process.env.CMX_AUTH`, update `.gitignore` to block real `config/default.json`.
- **Status:** [x] Done

### [2.2] No CRON wiring for monthly export
- **Problem:** `scripts/export_and_purge.js` exists but is never scheduled. Nothing runs automatically on the 1st of each month.
- **Fix:** Add `node-cron` inside the app that fires `0 0 1 * *` (midnight, 1st of month).
- **Status:** [x] Done

---

## High Issues

### [1.2] `app_core.js` — Race condition on module-level shared Maps/Sets
- **File:** `modules/app_core.js`
- **Problem:** `uniqUserGround`, `uniqUserFirst`, etc. are module-level globals. If `king_start()` is ever called concurrently, both executions corrupt the same state.
- **Fix:** Move all Maps/Sets into local variables inside `king_start()` and pass them as parameters.
- **Status:** [x] Done

### [1.7] `patronCache.js` — Unbounded DB query on every cache refresh
- **File:** `modules/patronCache.js`
- **Problem:** `findMany` with no `take` limit fetches every row (grows unbounded). Each row contains large JSON blobs that are not needed by the dashboard.
- **Fix:** Limit to 30 days × 96 intervals = `take: 2880`, `select` only `timeStamp` and `patrons`.
- **Status:** [x] Done

### [2.1] Four separate `PrismaClient` instances
- **Files:** `modules/app_core.js`, `modules/patronCache.js`, `routes/index.js`, `routes/count_by_floor.js`
- **Problem:** Each creates its own connection pool, wasting PostgreSQL connections.
- **Fix:** Create `modules/prisma.js` singleton and import it everywhere.
- **Status:** [x] Done

### [4.2] `NODE_TLS_REJECT_UNAUTHORIZED=0` in PM2 ecosystem configs
- **Files:** `ecosystem.config.js`, `ecosystem.dist.config.js`
- **Problem:** Overrides the secure `=1` set in `app.js`, disabling TLS verification even in production-like environments.
- **Fix:** Remove from both ecosystem files.
- **Status:** [x] Done

### [6.1] No retry logic on Cisco CMX API calls
- **File:** `modules/axiosApi.js`
- **Problem:** A single transient CMX failure silently skips an entire 15-minute collection slot.
- **Fix:** Add `axios-retry` with 3 retries and exponential back-off.
- **Status:** [x] Done

### [4.4] Production DB credentials accessible in repo `.env`
- **Note:** `.env` is gitignored, but confirm the file has never been accidentally committed. Rotate credentials if in doubt.
- **Status:** [x] Reviewed (intentional)

---

## Medium Issues

### [1.5] `app_core.js` — Fragile duplicate-check using `Date.parse` on string
- **File:** `modules/app_core.js`
- **Problem:** `timeDiff > 30000` (30 sec) is too tight; a scheduler firing 1 second late causes data to be skipped. Logic uses `Date.parse()` on `Date.toString()` output.
- **Fix:** Use `.getTime()` directly and widen the minimum gap to `60000` ms.
- **Status:** [x] Done

### [1.6] `recapi.js` — Magic `-150` constant (changed to `-15` per requirements)
- **File:** `routes/recapi.js`
- **Problem:** Hard-coded baseline offset with no documentation. `Math.abs` hides negative values.
- **Fix:** Set baseline to `15` (Wi-Fi baseline), keep `Math.abs`, move constant to `config/default.json` as `rec.staffOffset`.
- **Status:** [x] Done

### [2.3] `patronCache` not time-aligned to 15-min collection cycle
- **Problem:** Uses a fixed `setInterval(15 min)` from startup time, so the cache is always stale relative to new DB writes.
- **Fix:** Trigger cache refresh from inside `collectData()` after `king_start()` completes, or apply the same `scheduleNextRun()` alignment.
- **Status:** [x] Done

### [3.1–3.4] Dashboard improvements
- **3.1** Add Chart.js line chart showing last 30 days from `/patronapi`
- **3.2** Replace full-page reload with `fetch`-based partial DOM update
- **3.3** Add per-floor trend view using `/count_by_floor` data
- **3.4** Fix timestamp rendering to use Eastern time consistently
- **Status:** [x] Done

### [6.2] No health check endpoint
- **Fix:** Add `GET /crowdindex/health` returning `{ status, dbConnected, lastCollection }`.
- **Status:** [x] Done

### [6.3] No log rotation
- **Fix:** Add `winston` with `winston-daily-rotate-file`.
- **Status:** [x] Done

---

## Low Issues

### [1.4] Off-by-one in scheduler falsy check (`!nextValidMinute` when value is `0`)
- **Fix:** Use `=== undefined` instead of falsy check.
- **Status:** [x] Done

### [2.4] Rec center data not persisted to DB
- **Note:** Intentional — Rec center requested live-only data, no DB storage.
- **Status:** [x] Reviewed (intentional)

### [2.5] Dead `global.onServer` code path in `saveToDatabase()`
- **Fix:** Remove dead branch or document intent.
- **Status:** [x] Done

### [5.1] Test 7 asserts `dateTime()` returns a string (it returns a `Date`)
- **Fix:** Correct the assertion.
- **Status:** [x] Done

### [5.2] Test suite uses `https://localhost` but dev server runs HTTP
- **Fix:** Make `baseUrl` conditional on `NODE_ENV`.
- **Status:** [x] Done

### [5.5] `patronCache.js` builds HTML strings in backend
- **Fix:** Return raw data objects; render HTML client-side.
- **Status:** [x] Done

### [6.4] Export directory named `"stored data"` (contains a space)
- **Fix:** Rename to `stored_data`.
- **Status:** [x] Done

---

## One-Time Helper Script

### `scripts/initial_export.js`
Export all historical data from the beginning of the database through **April 30, 2026**, organized by calendar month into separate files, then delete the exported rows from the DB.

- Output: `stored_data/YYYY-MM_device_data.json` per month
- Supports `--dry-run` flag (export only, no delete)
- **Status:** [x] Done

---

## Implementation Order

1. `modules/prisma.js` — shared client (unblocks all other fixes)
2. `modules/axiosApi.js` — error handling + retry
3. `modules/app_core.js` — race condition + scheduler fix + duplicate-check fix + remove dead code
4. `modules/patronCache.js` — bounded query + time alignment + raw data only
5. `scripts/export_and_purge.js` — correct date range (keep last 2 months)
6. `config/default.json` + `.env` — move credentials
7. `ecosystem.config.js` + `ecosystem.dist.config.js` — remove TLS override
8. `routes/recapi.js` — fix offset constant
9. `routes/count_by_floor.js` — use shared Prisma + bounded select
10. `routes/index.js` — use shared Prisma
11. CRON wiring via `node-cron` in `app.js`
12. Health endpoint
13. Dashboard overhaul (Chart.js, live update, timezone)
14. Winston logging
15. `scripts/initial_export.js` — one-time historical export
16. `test_comprehensive.js` — fix broken assertions
