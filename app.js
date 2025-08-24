process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1;
// Set timezone to New York for consistent logging
process.env.TZ = 'America/New_York';

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const createError = require("http-errors");
const cors = require("cors");

const indexRouter = require("./routes/index");
const patronapiRouter = require("./routes/patronapi");
const recapiRouter = require("./routes/recapi");
const countByFloorRouter = require("./routes/count_by_floor");
const patronCache = require("./modules/patronCache");
const { deviceDataService } = require("./modules/app_core");

const app = express();

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(cors());
app.use(
  bodyParser.urlencoded({
    extended: false,
  })
);
app.use(
  bodyParser.json({
    strict: false,
  })
);
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/patronapi", patronapiRouter);
app.use("/recapi", recapiRouter);
app.use("/count_by_floor", countByFloorRouter);

// Start background services
patronCache.startCacheUpdater();
deviceDataService.start();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] SIGTERM received, shutting down gracefully`);
  patronCache.stopCacheUpdater();
  deviceDataService.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] SIGINT received, shutting down gracefully`);
  patronCache.stopCacheUpdater();
  deviceDataService.stop();
  process.exit(0);
});

// catch 404 and forward to error handler
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] 404 - Route not found: ${req.method} ${req.url}`);
  next(createError(404));
});

// error handler
app.use((err, req, res, next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.send("error");
});

module.exports = app;
