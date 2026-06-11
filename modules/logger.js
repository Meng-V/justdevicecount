// Centralized Winston logger with daily log rotation.
// Logs rotate at midnight, are kept for 30 days, and are compressed (gzip).
//
// Usage:
//   const logger = require('./modules/logger');
//   logger.info('message');
//   logger.error('message', err);
//
// Files written to ./logs/ :
//   combined-YYYY-MM-DD.log  — all levels
//   error-YYYY-MM-DD.log     — errors only

const { createLogger, format, transports } = require("winston");
require("winston-daily-rotate-file");
const path = require("path");

const LOG_DIR = path.join(__dirname, "..", "logs");
const TZ      = "America/New_York";

// Custom timestamp formatted in Eastern time
const nyTimestamp = format((info) => {
  info.timestamp = new Date().toLocaleString("en-US", { timeZone: TZ });
  return info;
});

const logFormat = format.combine(
  nyTimestamp(),
  format.errors({ stack: true }),
  format.printf(({ timestamp, level, message, stack }) =>
    stack
      ? `[${timestamp}] [${level.toUpperCase()}] ${message}\n${stack}`
      : `[${timestamp}] [${level.toUpperCase()}] ${message}`
  )
);

const combinedTransport = new transports.DailyRotateFile({
  dirname:     LOG_DIR,
  filename:    "combined-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles:    "30d",   // keep 30 days of history
  level:       "info",
});

const errorTransport = new transports.DailyRotateFile({
  dirname:     LOG_DIR,
  filename:    "error-%DATE%.log",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxFiles:    "90d",   // keep errors longer for post-mortem debugging
  level:       "error",
});

const consoleTransport = new transports.Console({
  level:  process.env.NODE_ENV === "production" ? "info" : "debug",
  format: logFormat,
});

const logger = createLogger({
  level:      "info",
  format:     logFormat,
  transports: [consoleTransport, combinedTransport, errorTransport],
  // Don't crash on uncaught exceptions — log them instead.
  exceptionHandlers: [
    new transports.DailyRotateFile({
      dirname:     LOG_DIR,
      filename:    "exceptions-%DATE%.log",
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxFiles:    "30d",
    }),
  ],
  exitOnError: false,
});

module.exports = logger;
