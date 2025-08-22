process.env.NODE_TLS_REJECT_UNAUTHORIZED = 1;

const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const createError = require("http-errors");
const cors = require("cors");

const indexRouter = require("./routes/index");
const patronapiRouter = require("./routes/patronapi");
const recapiRouter = require("./routes/recapi");
const patronCache = require("./modules/patronCache");

const app = express();

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

// Start the patron cache background updater
patronCache.startCacheUpdater();

// catch 404 and forward to error handler
app.use((req, res, next) => {
  next(createError(404));
});

// error handler
app.use((err, req, res) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.send("error");
});

module.exports = app;
