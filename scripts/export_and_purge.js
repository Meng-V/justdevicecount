/**
 * Monthly export-and-purge script.
 *
 * Intended to run automatically on the 1st of every month (via node-cron in
 * app.js, or an external crontab entry).
 *
 * DATE LOGIC — why we keep the last TWO months:
 *   - The dashboard shows the most recent 30 days, so we must never delete
 *     last month's data.
 *   - The CRON fires on the 1st of each month.  On that date "last month" is
 *     still inside the 30-day window, so we can only safely delete the month
 *     BEFORE last month.
 *
 *   Example: job runs on 2026-06-01
 *     → current month = June 2026  (keep)
 *     → previous month = May 2026  (keep — inside 30-day window)
 *     → month before previous = April 2026 and older  (delete)
 *
 * Supports --dry-run flag: exports the file but does NOT delete any rows.
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Output directory resolution:
//   1. STORED_DATA_DIR env var   → use it (production: /home/qum/stored_data)
//   2. Fallback                  → <app_root>/stored_data  (local dev)
//
// On the server, set in .env:
//   STORED_DATA_DIR=/home/qum/stored_data
// ---------------------------------------------------------------------------
const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");

// Export + purge one table.  `model` is a Prisma delegate (prisma.deviceData /
// prisma.recData) and `prefix` becomes the output file name prefix.
async function exportAndPurge(model, prefix, cutoff, now, isDryRun) {
  const where = { timeStamp: { lt: cutoff } };

  const totalCount = await model.count({ where });
  if (totalCount === 0) {
    console.log(`[export_and_purge] ${prefix}: no rows eligible for export/purge.`);
    return;
  }

  console.log(`[export_and_purge] ${prefix}: rows to export: ${totalCount}`);

  // Output directory — use env-configured path (see top of file)
  const outDir = STORED_DATA_DIR;
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`[export_and_purge] Output directory: ${outDir}`);

  // File name encodes the cutoff date so it is unambiguous.
  const cutoffStamp = cutoff.toISOString().replace(/[:]/g, "-");
  const runStamp    = now.toISOString().replace(/[:]/g, "-");
  const filename    = `${prefix}_export_until_${cutoffStamp}_run_${runStamp}.json`;
  const outPath     = path.join(outDir, filename);
  const stream      = fs.createWriteStream(outPath, { encoding: "utf8" });

  // Stream-write JSON array in batches of 1 000 rows to avoid memory spikes.
  stream.write("[");
  let first         = true;
  const batchSize   = 1000;
  let lastId;
  let exportedCount = 0;

  while (true) {
    const batch = await model.findMany({
      where,
      orderBy: { id: "asc" },
      take:    batchSize,
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

  console.log(`[export_and_purge] ${prefix}: exported ${exportedCount} rows → ${outPath}`);

  if (exportedCount !== totalCount) {
    throw new Error(
      `Export mismatch: exported ${exportedCount} rows but DB count was ${totalCount}. ` +
      "Aborting delete to protect data integrity."
    );
  }

  if (isDryRun) {
    console.log(`[export_and_purge] ${prefix}: DRY RUN — skipping database delete.`);
    return;
  }

  const deleteResult = await model.deleteMany({ where });
  if (deleteResult.count !== totalCount) {
    throw new Error(
      `Delete mismatch: removed ${deleteResult.count} rows but expected ${totalCount}.`
    );
  }

  console.log(`[export_and_purge] ${prefix}: deleted ${deleteResult.count} rows from database.`);
}

async function run() {
  const isDryRun = process.argv.includes("--dry-run");

  // Cutoff = first day of the month BEFORE last month (UTC midnight).
  // Everything strictly before this date is eligible for deletion.
  const now = new Date();
  // "Two months ago" = first day of (current_month - 2)
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  console.log(`[export_and_purge] Cutoff date : ${cutoff.toISOString()}`);
  console.log(`[export_and_purge] Dry run     : ${isDryRun}`);

  // King Library, then Recreation Center.  Both tables follow the same policy;
  // the 15-minute history stays available through stored_data/*summaries/.
  await exportAndPurge(prisma.deviceData, "device_data", cutoff, now, isDryRun);
  await exportAndPurge(prisma.recData,    "rec_data",    cutoff, now, isDryRun);
}

run()
  .catch((e) => {
    console.error("[export_and_purge] FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
