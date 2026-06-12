process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1;
// Set timezone to New York for consistent logging
process.env.TZ = 'America/New_York';

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
// Monthly export-and-purge CRON job
// Runs at 00:00 on the 1st of every month (Eastern Time).
// Exports data older than 2 months to stored_data/ and deletes it from the DB.
// See scripts/export_and_purge.js for full documentation of the date logic.
// ---------------------------------------------------------------------------
cron.schedule(
  "0 0 1 * *",
  () => {
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
      " Monthly export-and-purge job triggered"
    );
    // Fork a child process so the CRON job runs in isolation and cannot crash
    // the main Express server even on unexpected errors.
    const { fork } = require("child_process");
    const child = fork(
      require("path").join(__dirname, "scripts", "export_and_purge.js"),
      [],
      { env: { ...process.env } }
    );
    child.on("exit", (code) => {
      console.log(
        `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
        ` export_and_purge.js exited with code ${code}`
      );
    });
  },
  { timezone: "America/New_York" }
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
function shutdown(signal) {
  console.log(`[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}] ${signal} received, shutting down gracefully`);
  patronCache.stopCacheUpdater();
  deviceDataService.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

// 404 handler
app.use((req, res, next) => {
  console.log(
    `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
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
