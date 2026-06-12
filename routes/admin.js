// routes/admin.js
// Analytics dashboard at /crowdindex/admin
//
// Simple password gate: set ADMIN_PASSWORD in .env.
// If not set, the route is unprotected (useful in development).
// Access via:  GET /crowdindex/admin           → dashboard page
//              GET /crowdindex/admin/data       → raw big_summary.json (JSON API)
//              POST /crowdindex/admin/login     → submit password, sets session cookie
//              GET /crowdindex/admin/logout     → clears session cookie
//
// Session is cookie-only (signed HMAC), no extra session store needed.
// Requires ADMIN_PASSWORD and ADMIN_COOKIE_SECRET in .env for production.

const express  = require("express");
const path     = require("path");
const fs       = require("fs");
const crypto   = require("crypto");

const router   = express.Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD;          // falsy = open
const COOKIE_SECRET    = process.env.ADMIN_COOKIE_SECRET || "dev-secret-change-me";
const COOKIE_NAME      = "admsess";
const COOKIE_MAX_AGE   = 8 * 60 * 60 * 1000; // 8 hours

const SUMMARY_PATH = path.join(
  __dirname, "..", "stored_data", "analysis", "big_summary.json"
);

// ---------------------------------------------------------------------------
// Tiny signed-cookie helpers (no express-session dependency)
// ---------------------------------------------------------------------------
function sign(value) {
  const hmac = crypto.createHmac("sha256", COOKIE_SECRET);
  hmac.update(value);
  return value + "." + hmac.digest("base64url");
}

function verify(signed) {
  if (!signed || !signed.includes(".")) return null;
  const idx   = signed.lastIndexOf(".");
  const value = signed.slice(0, idx);
  return sign(value) === signed ? value : null;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next(); // password not configured → open

  const raw    = req.cookies?.[COOKIE_NAME];
  const payload = verify(raw || "");
  if (payload === "authenticated") return next();

  // Not authenticated — store redirect target and go to login
  res.redirect(req.baseUrl + "/login?next=" + encodeURIComponent(req.originalUrl));
}

// ---------------------------------------------------------------------------
// Load summary data (cached in memory, reloaded if file changes)
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
  } catch (e) {
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

// GET /admin/login  — login page
router.get("/login", (req, res) => {
  if (!ADMIN_PASSWORD) return res.redirect(req.baseUrl + "/");
  const next = req.query.next || req.baseUrl + "/";
  res.render("admin_login", {
    title: "Admin Login",
    next,
    error: null,
  });
});

// POST /admin/login  — authenticate
router.post("/login", express.urlencoded({ extended: false }), (req, res) => {
  const { password, next } = req.body;
  const redirectTo = next || req.baseUrl + "/";

  if (password === ADMIN_PASSWORD) {
    res.cookie(COOKIE_NAME, sign("authenticated"), {
      maxAge:   COOKIE_MAX_AGE,
      httpOnly: true,
      sameSite: "lax",
    });
    return res.redirect(redirectTo);
  }

  res.render("admin_login", {
    title: "Admin Login",
    next: redirectTo,
    error: "Incorrect password. Please try again.",
  });
});

// GET /admin/logout
router.get("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.redirect(req.baseUrl + "/login");
});

// GET /admin/data  — raw JSON API (also protected)
router.get("/data", requireAuth, (req, res) => {
  const doc = loadSummary();
  if (!doc) {
    return res.status(503).json({
      error: "big_summary.json not found. Run: python3 scripts/big_summary.py"
    });
  }
  res.json(doc);
});

// GET /admin  — main dashboard
router.get("/", requireAuth, (req, res) => {
  const doc = loadSummary();
  if (!doc) {
    return res.status(503).render("admin_error", {
      title:   "Analytics Dashboard",
      message: "Analysis data not found.",
      hint:    "Run <code>python3 scripts/big_summary.py</code> to generate it.",
    });
  }

  // Pre-process data server-side so the template stays clean
  const global   = doc.global;
  const months   = doc.months;
  const overview = global.overall_stats;

  // Build month labels map
  const monthLabels = {};
  Object.keys(months).forEach(mk => { monthLabels[mk] = monthLabel(mk); });

  res.render("admin", {
    title:        "Analytics Dashboard",
    generatedAt:  doc.generated_at,
    etOffset:     doc.et_offset_hours,
    overview,
    monthlyOverview:   global.monthly_overview,
    top10Days:         global.cross_month_top10_days,
    bottom10Days:      global.cross_month_low10_days,
    dowProfile:        global.day_of_week_profile,
    hourlyProfile:     global.hourly_profile,
    floorBreakdown:    global.floor_breakdown,
    months,
    monthKeys:         Object.keys(months).sort(),
    monthLabels,
    // Pass full doc as JSON for client-side Plotly rendering
    summaryJson:  JSON.stringify(doc),
  });
});

module.exports = router;
