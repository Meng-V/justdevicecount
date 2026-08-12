/**
 * data_health_check.js — detect silent data-collection failures and e-mail an alert.
 *
 * WHY THIS EXISTS
 *   In July 2026 the CMX API certificate expired.  Every request failed for
 *   three weeks and nobody noticed, because the collector kept writing rows —
 *   just with patrons = 0.  The collector no longer stores those fake readings
 *   (see modules/app_core.js), which means a CMX outage now shows up as a HOLE
 *   in the data instead of a flat zero line.  A hole is just as invisible, so
 *   this script actively looks for one and shouts.
 *
 * WHAT IT CHECKS (per table: device_data, rec_data)
 *   1. Row count over the last 24 h, against what that building's own collection
 *      window should produce — King ~76 rows, Rec ~84 (the Rec starts at 05:00).
 *   2. Staleness — how long ago the newest row was written, measured from the
 *      moment collection resumed rather than from the row itself, so the
 *      overnight silent window is never reported as a fault.
 *   3. All-zero readings, in case a future change reintroduces the old bug.
 *   Plus: freshness of analysis/big_summary.json, the file the dashboard reads.
 *
 *   Collection windows are defined once in modules/collectionWindow.js and
 *   shared with the collector, so the two can never disagree.
 *
 * OUTPUT
 *   Healthy  → one log line, exit 0.
 *   Problems → e-mail to ALERT_EMAIL via /usr/sbin/sendmail, exit 0.
 *   The exit code stays 0 so a failing check never marks the CRON job as broken;
 *   the e-mail is the signal.
 *
 * CONFIG (all optional, read from .env)
 *   ALERT_EMAIL          recipient            default qum@miamioh.edu
 *   ALERT_FROM           envelope sender      default crowdindex@<hostname>
 *   ALERT_MIN_ROWS_24H   row-count floor      default: 80% of each building's own expected rows
 *   ALERT_MAX_STALE_MIN  staleness limit      default 45
 *
 * USAGE
 *   node scripts/data_health_check.js
 *   node scripts/data_health_check.js --test    # always send, to verify delivery
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const { spawnSync } = require("child_process");
const {
  isSilentHour,
  expectedRowsPer24h,
  minutesSinceResume,
  describeWindow,
} = require("../modules/collectionWindow");

const prisma = new PrismaClient();

const APP_TZ = process.env.TZ || "America/New_York";

const ALERT_EMAIL         = process.env.ALERT_EMAIL         || "qum@miamioh.edu";
const ALERT_FROM          = process.env.ALERT_FROM          || `crowdindex@${os.hostname()}`;
// Unset = derive the floor from each building's own collection window (80% of
// the rows a healthy day should hold).  Set it to pin both buildings to a
// fixed number instead.
const MIN_ROWS_OVERRIDE   = Number(process.env.ALERT_MIN_ROWS_24H)  || null;
const MAX_STALE_MINUTES   = Number(process.env.ALERT_MAX_STALE_MIN) || 45;

const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");

const FORCE_TEST = process.argv.includes("--test");

const fmt = (d) =>
  d ? d.toLocaleString("en-US", { timeZone: APP_TZ }) : "never";

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function checkTable(model, label, kind) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows24h = await model.count({ where: { timeStamp: { gte: since } } });
  const newest  = await model.findFirst({
    orderBy: { timeStamp: "desc" },
    select:  { timeStamp: true, patrons: true },
  });

  const peak = await model.aggregate({
    where: { timeStamp: { gte: since } },
    _max:  { patrons: true },
  });
  const peak24h = peak._max.patrons ?? 0;

  const staleMin = newest
    ? Math.round((Date.now() - newest.timeStamp.getTime()) / 60000)
    : Infinity;

  // The collector does not write during this building's silent window, so the
  // newest row being hours old overnight is by design, not a fault.  Measure
  // staleness from whichever is later: the last row, or the moment collection
  // resumed.  Without this the 07:00 health check flagged King every single
  // morning, because its window had only just ended and the newest row was
  // still the 01:45 one.
  const inSilentWindow = isSilentHour(kind);
  const effectiveStale = inSilentWindow
    ? 0
    : Math.min(staleMin, minutesSinceResume(kind));

  const expectedRows = expectedRowsPer24h(kind);
  const minRows      = MIN_ROWS_OVERRIDE ?? Math.floor(expectedRows * 0.8);

  const problems = [];
  if (!newest) {
    problems.push(`${label}: the table is EMPTY.`);
  } else {
    if (effectiveStale > MAX_STALE_MINUTES) {
      problems.push(
        `${label}: no new rows for ${staleMin} minutes ` +
        `(limit ${MAX_STALE_MINUTES}). Newest row: ${fmt(newest.timeStamp)} ET.`
      );
    }
    if (rows24h < minRows) {
      problems.push(
        `${label}: only ${rows24h} rows in the last 24h (expected ~${expectedRows}, ` +
        `alert below ${minRows}). Collection is failing or intermittent.`
      );
    }
    if (rows24h > 0 && peak24h === 0) {
      problems.push(
        `${label}: ${rows24h} rows in the last 24h but every reading is 0. ` +
        "This is the signature of a broken CMX connection."
      );
    }
  }

  return {
    label, rows24h, peak24h, staleMin, expectedRows, minRows,
    silentWindow: describeWindow(kind),
    inSilentWindow,
    newest: newest ? newest.timeStamp : null,
    problems,
  };
}

function checkSummaryFreshness() {
  const p = path.join(STORED_DATA_DIR, "analysis", "big_summary.json");
  try {
    const ageH = (Date.now() - fs.statSync(p).mtimeMs) / 3600000;
    if (ageH > 48) {
      return {
        ageH: Math.round(ageH),
        problems: [
          `Dashboard analysis file is ${Math.round(ageH)}h old ` +
          "(scripts/refresh_summaries.js runs nightly at 03:15 ET — check it).",
        ],
      };
    }
    return { ageH: Math.round(ageH), problems: [] };
  } catch {
    return {
      ageH: null,
      problems: [`Dashboard analysis file is missing: ${p}`],
    };
  }
}

// ---------------------------------------------------------------------------
// E-mail via the local MTA (postfix). No npm dependency needed.
// ---------------------------------------------------------------------------

function sendMail(subject, body) {
  const message =
    `From: Crowd Index Monitor <${ALERT_FROM}>\n` +
    `To: ${ALERT_EMAIL}\n` +
    `Subject: ${subject}\n` +
    "Content-Type: text/plain; charset=utf-8\n" +
    "\n" +
    body;

  const res = spawnSync("/usr/sbin/sendmail", ["-t", "-oi"], { input: message });
  if (res.error) {
    console.error(`[health_check] sendmail failed: ${res.error.message}`);
    return false;
  }
  if (res.status !== 0) {
    console.error(`[health_check] sendmail exited ${res.status}: ${res.stderr}`);
    return false;
  }
  console.log(`[health_check] Alert e-mail sent to ${ALERT_EMAIL}`);
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const king    = await checkTable(prisma.deviceData, "King Library (device_data)", "king");
  const rec     = await checkTable(prisma.recData,    "Recreation Center (rec_data)", "rec");
  const summary = checkSummaryFreshness();

  const problems = [...king.problems, ...rec.problems, ...summary.problems];

  const status = (t) =>
    `  ${t.label}\n` +
    `    rows in last 24h : ${t.rows24h}   (healthy ~${t.expectedRows}, alert below ${t.minRows})\n` +
    `    peak patrons 24h : ${t.peak24h}\n` +
    `    newest row       : ${fmt(t.newest)} ET  (${t.staleMin === Infinity ? "n/a" : t.staleMin + " min ago"})\n` +
    `    silent window    : ${t.silentWindow}${t.inSilentWindow ? "  <- in it now, staleness not checked" : ""}\n`;

  const report =
    `Crowd Index data health report\n` +
    `Host    : ${os.hostname()}\n` +
    `Checked : ${fmt(new Date())} ET\n` +
    "\n" +
    status(king) +
    "\n" +
    status(rec) +
    "\n" +
    `  Dashboard analysis file: ${summary.ageH === null ? "MISSING" : summary.ageH + "h old"}\n`;

  if (problems.length === 0 && !FORCE_TEST) {
    console.log(`[health_check] OK — King ${king.rows24h} rows / Rec ${rec.rows24h} rows in 24h`);
    return;
  }

  const subject = problems.length
    ? `[Crowd Index] Data collection problem on ${os.hostname()}`
    : `[Crowd Index] Test alert — everything looks healthy`;

  const body = problems.length
    ? "The following problems were detected:\n\n" +
      problems.map((p, i) => `  ${i + 1}. ${p}`).join("\n\n") +
      "\n\n" + "-".repeat(70) + "\n\n" + report +
      "\nWhat to check first:\n" +
      "  1. tail -50 /var/log/crowdindex/crowdindex.log\n" +
      "     A repeated 'certificate has expired' or 'all retries exhausted'\n" +
      "     means the CMX API side is broken, not this app.\n" +
      "  2. systemctl status crowdindex.service\n" +
      `  3. The collector deliberately skips writes overnight — King ${describeWindow("king")},\n` +
      `     Rec ${describeWindow("rec")}.  Staleness is measured from the moment collection\n` +
      "     resumes, so those gaps are not reported as faults.\n"
    : "This is a test message, no problems were detected.\n\n" + report;

  console.log(`[health_check] ${problems.length} problem(s) detected`);
  problems.forEach((p) => console.error(`[health_check] ${p}`));
  sendMail(subject, body);
}

run()
  .catch((e) => {
    console.error("[health_check] FATAL:", e);
    sendMail(
      `[Crowd Index] Health check itself failed on ${os.hostname()}`,
      `scripts/data_health_check.js crashed:\n\n${e && e.stack ? e.stack : e}\n`
    );
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
