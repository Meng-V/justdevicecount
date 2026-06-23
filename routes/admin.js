// routes/admin.js
// Analytics dashboard at /crowdindex/admin
//
// Token-based access: set ADMIN_TOKEN in .env to a long random string.
// Share the URL with colleagues:
//   https://your-server/crowdindex/admin?t=<ADMIN_TOKEN>
//
// Once the token is validated, a short-lived cookie is set so they
// don't need the token in the URL on subsequent page loads/refreshes
// (e.g. navigating to /admin/data).
//
// If ADMIN_TOKEN is not set, the route is fully open (dev mode).
//
// Endpoints:
//   GET /crowdindex/admin?t=<token>   — dashboard (validates token, sets cookie)
//   GET /crowdindex/admin             — dashboard (cookie must already be set)
//   GET /crowdindex/admin/data        — raw big_summary.json (JSON API, same auth)

const express = require("express");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");

const router  = express.Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ADMIN_TOKEN  = process.env.ADMIN_TOKEN;   // falsy = open access
const COOKIE_NAME  = "admsess";
const COOKIE_TTL   = 12 * 60 * 60 * 1000;       // 12 hours

// ---------------------------------------------------------------------------
// Data file path
// Reads from STORED_DATA_DIR env var (production: /home/qum/stored_data)
// Falls back to <app_root>/stored_data for local development.
// ---------------------------------------------------------------------------
const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");

const SUMMARY_PATH = path.join(STORED_DATA_DIR, "analysis", "big_summary.json");

// ---------------------------------------------------------------------------
// Date-range filter (for the presentation)
// Set DASHBOARD_START_MONTH and DASHBOARD_END_MONTH in .env to restrict
// which months are shown on the dashboard.  Both are inclusive.
// Format: "YYYY-MM"  (e.g. "2025-10" or "2026-05")
// Leave either unset to use the full range available in big_summary.json.
//
// Example — lock to exactly what the boss sees now (Oct 2025 – May 2026):
//   DASHBOARD_START_MONTH=2025-10
//   DASHBOARD_END_MONTH=2026-05
//
// To include June 2026 after the July 1 CRON runs new data:
//   DASHBOARD_END_MONTH=2026-06
// ---------------------------------------------------------------------------
const DASHBOARD_START_MONTH = process.env.DASHBOARD_START_MONTH || null;
const DASHBOARD_END_MONTH   = process.env.DASHBOARD_END_MONTH   || null;

// Timezone used to map UTC timestamps to a calendar day for the day-detail view.
const TZ = process.env.TZ || "America/New_York";

// ---------------------------------------------------------------------------
// Auth middleware — token in URL query OR valid cookie
// ---------------------------------------------------------------------------
function requireToken(req, res, next) {
  if (!ADMIN_TOKEN) return next();  // no token configured → fully open

  // 1. Token supplied in query string → validate, set cookie, strip from URL
  const qToken = req.query.t;
  if (qToken) {
    // timingSafeEqual requires equal-length buffers — pad/truncate to avoid crashes on wrong-length input
    const a = Buffer.alloc(64); Buffer.from(ADMIN_TOKEN).copy(a);
    const b = Buffer.alloc(64); Buffer.from(qToken).copy(b);
    if (!crypto.timingSafeEqual(a, b)) {
      return res.status(403).send("Invalid access token.");
    }
    // Valid — set a cookie so subsequent requests (same browser) don't need the token
    res.cookie(COOKIE_NAME, "ok", {
      maxAge:   COOKIE_TTL,
      httpOnly: true,
      sameSite: "lax",
    });
    // Redirect to the clean URL (no ?t=) so the token doesn't stay in browser history
    return res.redirect(req.baseUrl + "/");
  }

  // 2. Cookie already set → let through
  if (req.cookies?.[COOKIE_NAME] === "ok") return next();

  // 3. Neither → 403
  return res.status(403).send(
    "Access denied. Use the full URL with the access token your administrator shared with you."
  );
}

// ---------------------------------------------------------------------------
// Load summary data (cached in memory, auto-reloaded when file changes)
// ---------------------------------------------------------------------------
let cachedSummary    = null;
let cachedSummaryMtm = 0;

function loadSummary() {
  try {
    const stat = fs.statSync(SUMMARY_PATH);
    if (stat.mtimeMs !== cachedSummaryMtm) {
      cachedSummary    = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf8"));
      cachedSummaryMtm = stat.mtimeMs;
    }
    return cachedSummary;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Apply DASHBOARD_START_MONTH / DASHBOARD_END_MONTH filter.
// Returns a deep-ish copy of the summary with only the requested months,
// and recomputes the global overview arrays to match the filtered set.
// The original cached object is never mutated.
// ---------------------------------------------------------------------------
function applyDateRangeFilter(doc) {
  if (!DASHBOARD_START_MONTH && !DASHBOARD_END_MONTH) return doc;

  const start = DASHBOARD_START_MONTH || "0000-00";
  const end   = DASHBOARD_END_MONTH   || "9999-99";

  // Filter the months map
  const filteredMonths = {};
  Object.entries(doc.months).forEach(([mk, val]) => {
    if (mk >= start && mk <= end) filteredMonths[mk] = val;
  });

  const filteredKeys = Object.keys(filteredMonths).sort();

  // Re-slice the global arrays that are month-indexed
  const filteredMonthlyOverview = (doc.global.monthly_overview || [])
    .filter(m => m.month >= start && m.month <= end);

  // Recompute overall_stats fields that depend on the month range
  const allPatrons = filteredKeys.flatMap(mk =>
    (filteredMonths[mk].all_days || []).map(d => d.avg)
  );
  const totalRecords = filteredKeys.reduce(
    (sum, mk) => sum + (filteredMonths[mk].total_records || 0), 0
  );

  return {
    ...doc,
    months: filteredMonths,
    global: {
      ...doc.global,
      monthly_overview:  filteredMonthlyOverview,
      overall_stats: {
        ...doc.global.overall_stats,
        months_covered:  filteredKeys,
        total_records:   totalRecords,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: month label  "2025-10" → "Oct 2025"
// ---------------------------------------------------------------------------
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun",
                    "Jul","Aug","Sep","Oct","Nov","Dec"];
function monthLabel(mk) {
  const [y, m] = mk.split("-");
  return `${MONTH_ABBR[parseInt(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Day-detail support
// Reads per-month summary files (STORED_DATA_DIR/summaries/YYYY-MM_summary.json)
// which hold raw 15-minute records: { timeStamp(UTC), patrons, countByFloor }.
// ---------------------------------------------------------------------------

// Per-month file cache (auto-reloads when the file's mtime changes).
const monthCache = {};   // "YYYY-MM" → { mtime, data }

function loadMonthSummary(mk) {
  const p = path.join(STORED_DATA_DIR, "summaries", `${mk}_summary.json`);
  try {
    const stat = fs.statSync(p);
    if (!monthCache[mk] || monthCache[mk].mtime !== stat.mtimeMs) {
      monthCache[mk] = { mtime: stat.mtimeMs, data: JSON.parse(fs.readFileSync(p, "utf8")) };
    }
    return monthCache[mk].data;
  } catch {
    return null;
  }
}

// Convert a UTC ISO string to its Eastern-Time calendar date + clock time.
function toEtParts(iso) {
  const d = new Date(iso);
  return {
    etDate: d.toLocaleDateString("en-CA", { timeZone: TZ }),  // "YYYY-MM-DD"
    etTime: d.toLocaleTimeString("en-GB", {
      timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit",
    }),                                                        // "HH:MM"
  };
}

// All 15-min records whose ET calendar day equals `dateStr` (YYYY-MM-DD).
// ET is behind UTC, so an ET evening can land in the *next* UTC month file —
// we therefore load the date's month and the following day's month.
function getDayRecords(dateStr) {
  const mks = new Set([dateStr.slice(0, 7)]);
  const next = new Date(dateStr + "T12:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  mks.add(next.toISOString().slice(0, 7));

  let recs = [];
  for (const mk of mks) {
    const data = loadMonthSummary(mk);
    if (Array.isArray(data)) recs = recs.concat(data);
  }

  return recs
    .map(r => ({ ...r, ...toEtParts(r.timeStamp) }))
    .filter(r => r.etDate === dateStr)
    .sort((a, b) => a.timeStamp.localeCompare(b.timeStamp));
}

// "YYYY-MM" → "YYYY-MM-DD" of the last day of that month.
function lastDayOfMonth(mk) {
  const [y, m] = mk.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mk}-${String(last).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /admin/data — raw JSON (protected, date-range filtered)
router.get("/data", requireToken, (req, res) => {
  const raw = loadSummary();
  if (!raw) {
    return res.status(503).json({
      error: "big_summary.json not found. Run: python3 scripts/big_summary.py",
    });
  }
  res.json(applyDateRangeFilter(raw));
});

// Shared: validate ?date=YYYY-MM-DD, returns the string or null.
function parseDateParam(req) {
  const date = String(req.query.date || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

// GET /admin/day — one day's 15-min records + summary stats (JSON, for the chart)
router.get("/day", requireToken, (req, res) => {
  const date = parseDateParam(req);
  if (!date) return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });

  const recs = getDayRecords(date);
  const records = recs.map(r => ({
    time:      r.etTime,
    timeStamp: r.timeStamp,
    patrons:   r.patrons,
    ground:    r.countByFloor[0] ?? 0,
    first:     r.countByFloor[1] ?? 0,
    second:    r.countByFloor[2] ?? 0,
    third:     r.countByFloor[3] ?? 0,
  }));

  let stats = { count: 0 };
  if (records.length) {
    const p       = records.map(r => r.patrons);
    const peak    = Math.max(...p);
    const low     = Math.min(...p);
    const sum     = p.reduce((a, b) => a + b, 0);
    stats = {
      count:    records.length,
      avg:      Math.round(sum / records.length),
      peak,
      peakTime: records[p.indexOf(peak)].time,
      low,
      lowTime:  records[p.indexOf(low)].time,
    };
  }

  res.json({ date, tz: TZ, stats, records });
});

// GET /admin/day.csv — one day's records as a downloadable CSV
router.get("/day.csv", requireToken, (req, res) => {
  const date = parseDateParam(req);
  if (!date) return res.status(400).send("Invalid date. Use YYYY-MM-DD.");

  const recs = getDayRecords(date);
  const header = "timeStamp_utc,time_et,patrons,ground,first,second,third\n";
  const body = recs.map(r => [
    r.timeStamp, r.etTime, r.patrons,
    r.countByFloor[0] ?? 0, r.countByFloor[1] ?? 0,
    r.countByFloor[2] ?? 0, r.countByFloor[3] ?? 0,
  ].join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="king_library_${date}.csv"`);
  res.send(header + body + (body ? "\n" : ""));
});

// GET /admin/day.json — one day's records as a downloadable JSON file
router.get("/day.json", requireToken, (req, res) => {
  const date = parseDateParam(req);
  if (!date) return res.status(400).json({ error: "Invalid date. Use YYYY-MM-DD." });

  const recs = getDayRecords(date).map(r => ({
    timeStamp:    r.timeStamp,
    time_et:      r.etTime,
    patrons:      r.patrons,
    countByFloor: r.countByFloor,
  }));

  res.setHeader("Content-Disposition", `attachment; filename="king_library_${date}.json"`);
  res.json(recs);
});

// GET /admin  — main dashboard
router.get("/", requireToken, (req, res) => {
  const raw = loadSummary();
  if (!raw) {
    return res.status(503).send(
      "<h2>Analytics data not found.</h2>" +
      "<p>Run <code>python3 scripts/big_summary.py</code> to generate it.</p>"
    );
  }

  const doc = applyDateRangeFilter(raw);

  const monthLabels = {};
  Object.keys(doc.months).forEach(mk => { monthLabels[mk] = monthLabel(mk); });

  // Pass active range info to the template for the header badge
  const sortedKeys = Object.keys(doc.months).sort();
  const rangeStart = DASHBOARD_START_MONTH || sortedKeys[0];
  const rangeEnd   = DASHBOARD_END_MONTH   || sortedKeys.at(-1);

  // Date-picker bounds for the day-detail section (constrained to displayed range)
  const dayMin = `${rangeStart}-01`;
  const dayMax = lastDayOfMonth(rangeEnd);

  res.render("admin", {
    title:           "Analytics Dashboard",
    generatedAt:     doc.generated_at,
    etOffset:        doc.et_offset_hours,
    overview:        doc.global.overall_stats,
    monthlyOverview: doc.global.monthly_overview,
    top10Days:       doc.global.cross_month_top10_days,
    bottom10Days:    doc.global.cross_month_low10_days,
    dowProfile:      doc.global.day_of_week_profile,
    hourlyProfile:   doc.global.hourly_profile,
    floorBreakdown:  doc.global.floor_breakdown,
    months:          doc.months,
    monthKeys:       Object.keys(doc.months).sort(),
    monthLabels,
    summaryJson:     JSON.stringify(doc),
    // Date range currently displayed — shown in the topbar subtitle
    rangeStart:      monthLabel(rangeStart),
    rangeEnd:        monthLabel(rangeEnd),
    rangeFiltered:   !!(DASHBOARD_START_MONTH || DASHBOARD_END_MONTH),
    // Day-detail date picker bounds + default selection
    dayMin,
    dayMax,
    dayDefault:      dayMax,
  });
});

module.exports = router;
