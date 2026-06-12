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

const SUMMARY_PATH = path.join(
  __dirname, "..", "stored_data", "analysis", "big_summary.json"
);

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

// GET /admin/data — raw JSON (protected)
router.get("/data", requireToken, (req, res) => {
  const doc = loadSummary();
  if (!doc) {
    return res.status(503).json({
      error: "big_summary.json not found. Run: python3 scripts/big_summary.py",
    });
  }
  res.json(doc);
});

// GET /admin  — main dashboard
router.get("/", requireToken, (req, res) => {
  const doc = loadSummary();
  if (!doc) {
    return res.status(503).send(
      "<h2>Analytics data not found.</h2>" +
      "<p>Run <code>python3 scripts/big_summary.py</code> to generate it.</p>"
    );
  }

  const monthLabels = {};
  Object.keys(doc.months).forEach(mk => { monthLabels[mk] = monthLabel(mk); });

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
  });
});

module.exports = router;
