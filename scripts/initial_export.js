/**
 * One-time historical export script.
 *
 * Exports ALL data from the very beginning of the database through
 * April 30, 2026 (inclusive), organized into separate JSON files
 * per calendar month.  After a successful export it deletes the
 * exported rows from the database.
 *
 * Usage:
 *   node scripts/initial_export.js            # export + delete
 *   node scripts/initial_export.js --dry-run  # export only, no delete
 *
 * Output (in stored_data/):
 *   2024-01_device_data.json
 *   2024-02_device_data.json
 *   ...
 *   2026-04_device_data.json
 *
 * Each file is a JSON array of full DeviceData rows.
 *
 * Safety features:
 *   - The script verifies that the number of exported rows equals the DB
 *     count before deleting anything.
 *   - Individual month files are verified before any deletes run.
 *   - A summary is printed at the end.
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma   = new PrismaClient();
const isDryRun = process.argv.includes("--dry-run");

// ---- Configuration --------------------------------------------------------
// Export everything up to and including April 30, 2026 (UTC end-of-day).
const EXPORT_UNTIL = new Date(Date.UTC(2026, 3, 30, 23, 59, 59, 999)); // 2026-04-30T23:59:59.999Z
const OUT_DIR      = path.resolve(__dirname, "..", "stored_data");
const BATCH_SIZE   = 1000;
// ---------------------------------------------------------------------------

async function exportMonth(year, month) {
  // month is 0-based (JS convention)
  const from = new Date(Date.UTC(year, month, 1));
  const to   = new Date(Date.UTC(year, month + 1, 1)); // exclusive upper bound

  const where = { timeStamp: { gte: from, lt: to } };
  const total = await prisma.deviceData.count({ where });

  if (total === 0) {
    console.log(`  [${year}-${String(month+1).padStart(2,"0")}] No data — skipping.`);
    return { year, month, total: 0, outPath: null };
  }

  const label   = `${year}-${String(month + 1).padStart(2, "0")}`;
  const outPath = path.join(OUT_DIR, `${label}_device_data.json`);
  const stream  = fs.createWriteStream(outPath, { encoding: "utf8" });

  stream.write("[");
  let first         = true;
  let lastId;
  let exportedCount = 0;

  while (true) {
    const batch = await prisma.deviceData.findMany({
      where,
      orderBy: { id: "asc" },
      take:    BATCH_SIZE,
      ...(lastId ? { skip: 1, cursor: { id: lastId } } : {}),
    });

    if (batch.length === 0) break;

    for (const row of batch) {
      if (!first) stream.write(",\n");
      else first = false;
      stream.write(JSON.stringify(row));
    }

    exportedCount += batch.length;
    lastId         = batch[batch.length - 1].id;
  }

  stream.write("]\n");
  await new Promise((resolve, reject) => {
    stream.end(resolve);
    stream.on("error", reject);
  });

  if (exportedCount !== total) {
    throw new Error(
      `[${label}] Export mismatch: wrote ${exportedCount} rows but DB had ${total}. Aborting.`
    );
  }

  console.log(`  [${label}] Exported ${exportedCount} rows → ${outPath}`);
  return { year, month, total, outPath, where };
}

async function run() {
  console.log("=".repeat(60));
  console.log("  JustDeviceCount — Initial Historical Export");
  console.log("=".repeat(60));
  console.log(`  Exporting data from DB inception through ${EXPORT_UNTIL.toISOString()}`);
  console.log(`  Dry run: ${isDryRun}`);
  console.log("");

  // Determine the earliest record in the DB
  const earliest = await prisma.deviceData.findFirst({
    orderBy: { timeStamp: "asc" },
    select:  { timeStamp: true },
  });

  if (!earliest) {
    console.log("  No data found in database. Nothing to do.");
    return;
  }

  console.log(`  Earliest DB record : ${earliest.timeStamp.toISOString()}`);
  console.log(`  Export cutoff      : ${EXPORT_UNTIL.toISOString()}`);
  console.log("");

  // Build list of (year, month) pairs to process
  const startYear  = earliest.timeStamp.getUTCFullYear();
  const startMonth = earliest.timeStamp.getUTCMonth();
  const endYear    = EXPORT_UNTIL.getUTCFullYear();   // 2026
  const endMonth   = EXPORT_UNTIL.getUTCMonth();      // 3 (April, 0-based)

  const months = [];
  for (let y = startYear; y <= endYear; y++) {
    const mStart = (y === startYear) ? startMonth : 0;
    const mEnd   = (y === endYear)   ? endMonth   : 11;
    for (let m = mStart; m <= mEnd; m++) {
      months.push({ year: y, month: m });
    }
  }

  console.log(`  Processing ${months.length} calendar month(s)...`);
  console.log("");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const results = [];
  for (const { year, month } of months) {
    const result = await exportMonth(year, month);
    results.push(result);
  }

  // Verify all exports succeeded before any deletes
  const toDelete = results.filter(r => r.total > 0 && r.outPath);

  if (isDryRun) {
    console.log("\n  DRY RUN — skipping database deletes.");
  } else {
    console.log(`\n  All exports verified. Deleting ${toDelete.length} month(s) from database...`);

    for (const r of toDelete) {
      const label = `${r.year}-${String(r.month + 1).padStart(2, "0")}`;
      const del   = await prisma.deviceData.deleteMany({ where: r.where });
      if (del.count !== r.total) {
        throw new Error(`[${label}] Delete mismatch: removed ${del.count} but expected ${r.total}.`);
      }
      console.log(`  [${label}] Deleted ${del.count} rows.`);
    }
  }

  // Summary
  const totalExported = toDelete.reduce((sum, r) => sum + r.total, 0);
  console.log("\n" + "=".repeat(60));
  console.log(`  Done.`);
  console.log(`  Months processed : ${months.length}`);
  console.log(`  Rows exported    : ${totalExported}`);
  console.log(`  Output directory : ${OUT_DIR}`);
  if (isDryRun) console.log("  NOTE: Dry-run — no rows deleted.");
  console.log("=".repeat(60));
}

run()
  .catch((e) => {
    console.error("\n[initial_export] FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
