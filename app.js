process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1;
// TZ is set in bin/www (the true entry point) before this module loads.
const APP_TZ = process.env.TZ || "America/New_York";

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const createError = require("http-errors");
const cors = require("cors");
const cron = require("node-cron");

const indexRouter = require("./routes/index");
const patronapiRouter = require("./routes/patronapi");
const recapiRouter = require("./routes/recapi");
const countByFloorRouter = require("./routes/count_by_floor");
const healthRouter = require("./routes/health");
const adminRouter = require("./routes/admin");
const patronCache = require("./modules/patronCache");
const { deviceDataService } = require("./modules/app_core");

const app = express();

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json({ strict: false }));

// Minimal cookie parser (no extra dependency — parses Cookie header into req.cookies)
app.use((req, _res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(";").forEach(pair => {
      const idx = pair.indexOf("=");
      if (idx < 0) return;
      const key = pair.slice(0, idx).trim();
      const val = decodeURIComponent(pair.slice(idx + 1).trim());
      req.cookies[key] = val;
    });
  }
  next();
});

// Base path for all routes
const basePath = "/crowdindex";

app.use(basePath, express.static(path.join(__dirname, "public")));
app.use(basePath + "/",             indexRouter);
app.use(basePath + "/patronapi",    patronapiRouter);
app.use(basePath + "/recapi",       recapiRouter);
app.use(basePath + "/count_by_floor", countByFloorRouter);
app.use(basePath + "/health",       healthRouter);
app.use(basePath + "/admin",        adminRouter);

// Start background services
patronCache.startCacheUpdater();
deviceDataService.start();

// ---------------------------------------------------------------------------
// Background maintenance CRON jobs
//
//   1. Nightly  (03:15 ET)          — scripts/refresh_summaries.js
//        Rebuilds stored_data/summaries + rec_summaries from the database and
//        regenerates analysis/big_summary.json, so /crowdindex/admin always
//        shows the most recent months instead of the last hand-built export.
//
//   2. Monthly  (00:00 on the 1st)  — refresh_summaries.js then export_and_purge.js
//        The refresh MUST run first: export_and_purge deletes rows older than
//        two months and the summary files are the only copy the dashboard reads.
//        Two months stay in the database on purpose, so the last ~30 days are
//        always queryable without hitting the archive.
//
//   3. Daily    (07:00 ET)          — scripts/data_health_check.js
//        E-mails ALERT_EMAIL if collection stopped, stalled, or is returning
//        nothing but zeros.  Added after a three-week CMX certificate outage
//        went unnoticed.
//        It runs as King's silent window ends, so King has not had a chance to
//        write yet and its staleness is deliberately not reported at this hour
//        (that was the daily false alarm).  A genuine King outage still shows up
//        through the 24 h row count; the Rec, whose window ended at 05:00, is
//        fully checked here.
//
// Each script is forked into its own process so a failure can never take the
// Express server down.
// ---------------------------------------------------------------------------
const { fork } = require("child_process");

function runScript(name, args = []) {
  return new Promise((resolve) => {
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}] Starting ${name}`
    );
    const child = fork(path.join(__dirname, "scripts", name), args, {
      env: { ...process.env },
    });
    child.on("exit", (code) => {
      console.log(
        `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
        ` ${name} exited with code ${code}`
      );
      resolve(code);
    });
  });
}

cron.schedule(
  "15 3 * * *",
  () => { runScript("refresh_summaries.js"); },
  { timezone: APP_TZ }
);

cron.schedule(
  "0 7 * * *",
  () => { runScript("data_health_check.js"); },
  { timezone: APP_TZ }
);

cron.schedule(
  "0 0 1 * *",
  async () => {
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
      " Monthly maintenance job triggered"
    );
    const code = await runScript("refresh_summaries.js");
    if (code !== 0) {
      console.error(
        "[cron] refresh_summaries.js failed — skipping export_and_purge.js to avoid" +
        " deleting rows that have not been summarised yet."
      );
      return;
    }
    await runScript("export_and_purge.js");
  },
  { timezone: APP_TZ }
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}] ${signal} received, shutting down gracefully`);
  patronCache.stopCacheUpdater();
  deviceDataService.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// 404 handler
app.use((req, res, next) => {
  console.log(
    `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
    ` 404 - Route not found: ${req.method} ${req.url}`
  );
  next(createError(404));
});

// Error handler
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error   = req.app.get("env") === "development" ? err : {};
  res.status(err.status || 500);
  res.send("error");
});

module.exports = app;
