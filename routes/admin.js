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
  const rangeStart = DASHBOARD_START_MONTH || Object.keys(doc.months).sort()[0];
  const rangeEnd   = DASHBOARD_END_MONTH   || Object.keys(doc.months).sort().at(-1);

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
  });
});

module.exports = router;
