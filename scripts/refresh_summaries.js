/**
 * refresh_summaries.js — rebuild the monthly summary files that power the
 * analytics dashboard (/crowdindex/admin) straight from the database.
 *
 * WHY THIS EXISTS
 *   The dashboard never reads the database directly: it reads
 *     STORED_DATA_DIR/summaries/YYYY-MM_summary.json      (King Library)
 *     STORED_DATA_DIR/rec_summaries/YYYY-MM_summary.json  (Recreation Center)
 *     STORED_DATA_DIR/analysis/big_summary.json           (aggregated analysis)
 *   Those files used to be produced by hand (extract_summary.py + big_summary.py),
 *   so any month collected after the last manual run stayed invisible on the
 *   dashboard even though the rows were sitting in the database.
 *
 * WHAT IT DOES
 *   1. Reads every month present in device_data / rec_data and writes (or
 *      updates) the matching YYYY-MM_summary.json file.  Records already in a
 *      file are kept and merged by timeStamp, so months that were purged from
 *      the database are never lost.
 *   2. Optionally (--include-exports) also folds in the raw export files left
 *      behind by export_and_purge.js — useful for a one-off backfill.
 *   3. Runs scripts/big_summary.py so analysis/big_summary.json is regenerated.
 *
 * USAGE
 *   node scripts/refresh_summaries.js
 *   node scripts/refresh_summaries.js --include-exports   # also parse export JSON
 *   node scripts/refresh_summaries.js --no-analysis       # skip big_summary.py
 *   node scripts/refresh_summaries.js --rebuild           # see below
 *
 * --rebuild replaces (instead of merges) the summary file of every month that
 * is still present in the database.  Use it after deleting bad rows, so the
 * deletion propagates to the dashboard.  Months that no longer exist in the
 * database are never touched, with or without the flag.
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs            = require("fs");
const path          = require("path");
const { spawnSync } = require("child_process");

const prisma = new PrismaClient();

const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");

const KING_DIR = path.join(STORED_DATA_DIR, "summaries");
const REC_DIR  = path.join(STORED_DATA_DIR, "rec_summaries");

const INCLUDE_EXPORTS = process.argv.includes("--include-exports");
const SKIP_ANALYSIS   = process.argv.includes("--no-analysis");
const REBUILD         = process.argv.includes("--rebuild");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Summary files are bucketed by UTC month, matching extract_summary.py.
const isoMs = (date) => date.toISOString().replace(/\.\d{3}Z$/, ".000Z");

function normaliseFloors(arr, size) {
  const out = Array.isArray(arr) ? arr.map((n) => Number(n) || 0) : [];
  while (out.length < size) out.push(0);
  return out.slice(0, size);
}

function toRecord(row, floors) {
  const ts = row.timeStamp instanceof Date ? row.timeStamp : new Date(row.timeStamp);
  if (Number.isNaN(ts.getTime())) return null;
  return {
    timeStamp:    isoMs(ts),
    patrons:      Number(row.patrons) || 0,
    countByFloor: normaliseFloors(row.countByFloor, floors),
  };
}

function readSummaryFile(dir, mk) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, `${mk}_summary.json`), "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// Merge new records into the file for that month, de-duplicated by timeStamp.
// With --rebuild the existing file is discarded first, so records that were
// deleted from the database also disappear from the summary.
function writeMonth(dir, mk, records) {
  fs.mkdirSync(dir, { recursive: true });
  const byTs = new Map();
  if (!REBUILD) {
    for (const r of readSummaryFile(dir, mk)) byTs.set(r.timeStamp, r);
  }
  for (const r of records) byTs.set(r.timeStamp, r);

  const merged = [...byTs.values()].sort((a, b) => a.timeStamp.localeCompare(b.timeStamp));
  fs.writeFileSync(
    path.join(dir, `${mk}_summary.json`),
    JSON.stringify(merged, null, 2),
    "utf8"
  );
  return merged.length;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

// Pull every row of a table in id-ordered batches and bucket it by UTC month.
async function bucketsFromDb(model, floors, label) {
  const buckets = new Map();   // "YYYY-MM" → record[]
  const batchSize = 2000;
  let lastId;
  let total = 0;

  while (true) {
    const batch = await model.findMany({
      orderBy: { id: "asc" },
      take:    batchSize,
      ...(lastId ? { skip: 1, cursor: { id: lastId } } : {}),
      select:  { id: true, timeStamp: true, patrons: true, countByFloor: true },
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      const rec = toRecord(row, floors);
      if (!rec) continue;
      const mk = rec.timeStamp.slice(0, 7);
      if (!buckets.has(mk)) buckets.set(mk, []);
      buckets.get(mk).push(rec);
      total += 1;
    }

    lastId = batch[batch.length - 1].id;
  }

  console.log(`[refresh_summaries] ${label}: ${total} rows from DB across ${buckets.size} month(s)`);
  return buckets;
}

// Fold the raw export files written by export_and_purge.js into the buckets.
function addExportFiles(buckets, pattern, floors, label) {
  let files;
  try {
    files = fs.readdirSync(STORED_DATA_DIR).filter((f) => pattern.test(f)).sort();
  } catch {
    return;
  }
  if (!files.length) return;

  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(fs.readFileSync(path.join(STORED_DATA_DIR, f), "utf8"));
    } catch (err) {
      console.warn(`[refresh_summaries] ${label}: cannot read ${f} (${err.message})`);
      continue;
    }
    if (!Array.isArray(rows)) continue;

    let added = 0;
    for (const row of rows) {
      const rec = toRecord(row, floors);
      if (!rec) continue;
      const mk = rec.timeStamp.slice(0, 7);
      if (!buckets.has(mk)) buckets.set(mk, []);
      buckets.get(mk).push(rec);
      added += 1;
    }
    console.log(`[refresh_summaries] ${label}: ${added} rows from export file ${f}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  console.log(`[refresh_summaries] Stored data dir : ${STORED_DATA_DIR}`);
  console.log(`[refresh_summaries] Include exports : ${INCLUDE_EXPORTS}`);
  console.log(`[refresh_summaries] Rebuild months  : ${REBUILD}`);

  // --- King Library (4 floors) ---------------------------------------------
  const kingBuckets = await bucketsFromDb(prisma.deviceData, 4, "device_data");
  if (INCLUDE_EXPORTS) {
    addExportFiles(kingBuckets, /^device_data_export.*\.json$/, 4, "device_data");
    addExportFiles(kingBuckets, /_device_data\.json$/,          4, "device_data");
  }
  for (const mk of [...kingBuckets.keys()].sort()) {
    const n = writeMonth(KING_DIR, mk, kingBuckets.get(mk));
    console.log(`[refresh_summaries] summaries/${mk}_summary.json → ${n} records`);
  }

  // --- Recreation Center (2 floors) ----------------------------------------
  const recBuckets = await bucketsFromDb(prisma.recData, 2, "rec_data");
  if (INCLUDE_EXPORTS) {
    addExportFiles(recBuckets, /^rec_data_export.*\.json$/, 2, "rec_data");
  }
  for (const mk of [...recBuckets.keys()].sort()) {
    const n = writeMonth(REC_DIR, mk, recBuckets.get(mk));
    console.log(`[refresh_summaries] rec_summaries/${mk}_summary.json → ${n} records`);
  }

  // --- Aggregated analysis for the King Library dashboard ------------------
  if (SKIP_ANALYSIS) {
    console.log("[refresh_summaries] --no-analysis given, skipping big_summary.py");
    return;
  }

  // ET offset: -4 during daylight saving time, -5 otherwise.
  const now = new Date();
  const jan = new Date(now.getFullYear(), 0, 1);
  const jul = new Date(now.getFullYear(), 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const etOffset  = now.getTimezoneOffset() < stdOffset ? "-4" : "-5";

  const res = spawnSync("python3", [path.join(__dirname, "big_summary.py"),
                                    "--et-offset", etOffset], {
    stdio: "inherit",
    env:   { ...process.env, STORED_DATA_DIR },
  });
  if (res.error) throw new Error(`Failed to run big_summary.py: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`big_summary.py exited with code ${res.status}`);
}

run()
  .catch((e) => {
    console.error("[refresh_summaries] FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
