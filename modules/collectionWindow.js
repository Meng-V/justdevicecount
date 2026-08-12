// Collection windows — the single source of truth for WHEN the collector
// persists readings.  Shared by the collector (modules/app_core.js) and the
// health check (scripts/data_health_check.js) so the two can never disagree
// about what "missing data" means.
//
// A silent window is [start, end) in Eastern wall-clock hours: writes are
// SKIPPED while start <= hour < end.  The CMX polling itself still runs every
// 15 minutes; only the database write is suppressed.
//
//   King Library      02:00 -> 07:00   (resumes at 07:00)
//   Recreation Center 02:00 -> 05:00   (resumes at 05:00 — the Rec opens early)
//
// Override per building in config/default.json under collection.silentHours.

const config = require("config");

const APP_TZ = process.env.TZ || "America/New_York";

const DEFAULT_SILENT_HOURS = {
  king: { start: 2, end: 7 },
  rec:  { start: 2, end: 5 },
};

function silentWindow(kind) {
  const key = `collection.silentHours.${kind}`;
  if (config.has(key)) {
    const w = config.get(key);
    return { start: Number(w.start), end: Number(w.end) };
  }
  return DEFAULT_SILENT_HOURS[kind];
}

// Wall-clock hour/minute in APP_TZ, regardless of the server's own time zone.
function localParts(date = new Date()) {
  const d = new Date(date.toLocaleString("en-US", { timeZone: APP_TZ }));
  return { hour: d.getHours(), minute: d.getMinutes() };
}

// True while this building's writes are intentionally suppressed.
function isSilentHour(kind, date = new Date()) {
  const { start, end } = silentWindow(kind);
  const { hour } = localParts(date);

  // The second branch supports a window that wraps past midnight (e.g. 22 -> 5).
  return start <= end
    ? hour >= start && hour < end
    : hour >= start || hour < end;
}

// How many quarter-hour rows a healthy 24 h should hold for this building.
// King: (24-5)*4 = 76.  Rec: (24-3)*4 = 84.
function expectedRowsPer24h(kind) {
  const { start, end } = silentWindow(kind);
  const silentHours = start <= end ? end - start : 24 - start + end;
  return (24 - silentHours) * 4;
}

// Minutes elapsed since this building's silent window ended — i.e. how long the
// collector has actually had the chance to write.  Only meaningful outside the
// window; callers should check isSilentHour() first.
function minutesSinceResume(kind, date = new Date()) {
  const { end } = silentWindow(kind);
  const { hour, minute } = localParts(date);
  return ((hour - end + 24) % 24) * 60 + minute;
}

// "02:00-07:00 ET" — for log lines and e-mail copy.
function describeWindow(kind) {
  const { start, end } = silentWindow(kind);
  const pad = (h) => `${String(h).padStart(2, "0")}:00`;
  return `${pad(start)}-${pad(end)} ET`;
}

module.exports = {
  APP_TZ,
  silentWindow,
  isSilentHour,
  expectedRowsPer24h,
  minutesSinceResume,
  describeWindow,
  localParts,
};
