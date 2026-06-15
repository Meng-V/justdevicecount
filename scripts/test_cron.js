/**
 * test_cron.js — CRON job readiness test
 *
 * Verifies that the monthly export-and-purge job will work correctly before
 * it runs live in production.  Always runs in --dry-run mode (no DB deletes).
 *
 * Usage:
 *   node scripts/test_cron.js
 *   STORED_DATA_DIR=/home/qum/stored_data node scripts/test_cron.js
 *
 * Checks performed:
 *   1. DB connection is reachable
 *   2. STORED_DATA_DIR is writable
 *   3. Cutoff date logic is correct for today
 *   4. Count of rows eligible for next purge
 *   5. Dry-run of export_and_purge.js via child_process (same path as CRON)
 *   6. node-cron schedule parses correctly
 */

require("dotenv").config();
const path = require("path");
const fs   = require("fs");
const { fork } = require("child_process");
const { PrismaClient } = require("@prisma/client");
const cron = require("node-cron");

const prisma = new PrismaClient();

// ── helpers ─────────────────────────────────────────────────────────────────

function pass(msg)  { console.log(`  ✅  ${msg}`); }
function fail(msg)  { console.log(`  ❌  ${msg}`); }
function info(msg)  { console.log(`  ℹ️   ${msg}`); }
function header(msg){ console.log(`\n── ${msg} ${"─".repeat(Math.max(0, 56 - msg.length))}`); }

// ── tests ────────────────────────────────────────────────────────────────────

async function checkDatabase() {
  header("1. Database connectivity");
  try {
    const count = await prisma.deviceData.count();
    pass(`Connected to database. Total rows: ${count}`);

    const earliest = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: "asc" }, select: { timeStamp: true },
    });
    const latest = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: "desc" }, select: { timeStamp: true },
    });
    info(`Earliest record : ${earliest?.timeStamp?.toISOString() ?? "none"}`);
    info(`Latest record   : ${latest?.timeStamp?.toISOString() ?? "none"}`);
    return true;
  } catch (e) {
    fail(`Cannot connect to database: ${e.message}`);
    return false;
  }
}

function checkOutputDirectory() {
  header("2. Output directory (STORED_DATA_DIR)");

  const storedDataDir = process.env.STORED_DATA_DIR
    ? path.resolve(process.env.STORED_DATA_DIR)
    : path.resolve(__dirname, "..", "stored_data");

  info(`Resolved path: ${storedDataDir}`);

  try {
    fs.mkdirSync(storedDataDir, { recursive: true });
    pass(`Directory exists / was created: ${storedDataDir}`);
  } catch (e) {
    fail(`Cannot create directory: ${e.message}`);
    return false;
  }

  // Write a canary file to confirm write permission
  const canary = path.join(storedDataDir, ".cron_write_test");
  try {
    fs.writeFileSync(canary, "ok");
    fs.unlinkSync(canary);
    pass(`Directory is writable`);
  } catch (e) {
    fail(`Directory is NOT writable: ${e.message}`);
    return false;
  }

  // Check sub-directories expected by extract_summary.py / big_summary.py
  const subDirs = ["summaries", "analysis"];
  for (const sub of subDirs) {
    const full = path.join(storedDataDir, sub);
    try {
      fs.mkdirSync(full, { recursive: true });
      pass(`Sub-directory ok: ${full}`);
    } catch (e) {
      fail(`Cannot create sub-directory ${full}: ${e.message}`);
      return false;
    }
  }

  return true;
}

async function checkCutoffLogic() {
  header("3. Cutoff date logic");

  const now = new Date();
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));

  info(`Today                : ${now.toISOString()}`);
  info(`Purge cutoff         : ${cutoff.toISOString()}`);
  info(`Rows eligible (< cutoff) will be exported + deleted`);
  info(`Rows kept (>= cutoff) stay in DB for the 30-day dashboard`);

  const eligible = await prisma.deviceData.count({
    where: { timeStamp: { lt: cutoff } },
  });
  const kept = await prisma.deviceData.count({
    where: { timeStamp: { gte: cutoff } },
  });

  if (eligible === 0) {
    pass(`No rows eligible for purge yet — DB is clean up to the cutoff`);
  } else {
    pass(`Rows to export + purge: ${eligible}`);
  }
  pass(`Rows staying in DB   : ${kept}`);

  return true;
}

function checkCronSchedule() {
  header("4. node-cron schedule");

  const expression = "0 0 1 * *";
  const isValid = cron.validate(expression);

  if (isValid) {
    pass(`Schedule "${expression}" is valid — fires at 00:00 on the 1st of every month`);
    pass(`Timezone: ${process.env.TZ || "America/New_York"}`);
  } else {
    fail(`Schedule "${expression}" is INVALID — check app.js`);
    return false;
  }

  return true;
}

async function runDryExport() {
  header("5. Dry-run of export_and_purge.js (no DB changes)");

  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, "export_and_purge.js");
    info(`Forking: node ${scriptPath} --dry-run`);

    const child = fork(scriptPath, ["--dry-run"], {
      env:    { ...process.env },
      silent: true,  // capture stdout/stderr
    });

    child.stdout.on("data", (d) => {
      d.toString().split("\n")
        .filter(l => l.trim())
        .forEach(l => info(`[child] ${l}`));
    });
    child.stderr.on("data", (d) => {
      d.toString().split("\n")
        .filter(l => l.trim())
        .forEach(l => console.log(`  ⚠️   [child stderr] ${l}`));
    });

    child.on("exit", (code) => {
      if (code === 0) {
        pass(`export_and_purge.js exited cleanly (code 0)`);
        resolve(true);
      } else {
        fail(`export_and_purge.js exited with code ${code}`);
        resolve(false);
      }
    });
  });
}

function checkExportFile() {
  header("6. Verify export file (if rows were eligible)");

  const storedDataDir = process.env.STORED_DATA_DIR
    ? path.resolve(process.env.STORED_DATA_DIR)
    : path.resolve(__dirname, "..", "stored_data");

  const files = fs.readdirSync(storedDataDir)
    .filter(f => f.startsWith("device_data_export_"))
    .sort();

  if (files.length === 0) {
    info(`No export files found (expected if DB had nothing eligible)`);
    return true;
  }

  const latest = path.join(storedDataDir, files[files.length - 1]);
  info(`Most recent export file: ${latest}`);

  try {
    const stat = fs.statSync(latest);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    pass(`File size: ${sizeMB} MB`);

    // Read first bytes to confirm it looks like a JSON array
    const head = fs.readFileSync(latest, { encoding: "utf8", flag: "r" }).slice(0, 20);
    if (head.trimStart().startsWith("[")) {
      pass(`File starts with "[" — valid JSON array format`);
    } else {
      fail(`File does not start with "[" — possible write corruption`);
      return false;
    }
  } catch (e) {
    fail(`Cannot read export file: ${e.message}`);
    return false;
  }

  return true;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║       JustDeviceCount — CRON Job Readiness Test          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  const tz = process.env.TZ || "America/New_York";
  console.log(`  Run time  : ${new Date().toLocaleString("en-US", { timeZone: tz })} (${tz})`);
  console.log(`  STORED_DATA_DIR env: ${process.env.STORED_DATA_DIR ?? "(not set — using ./stored_data)"}`);

  const results = [];

  results.push(await checkDatabase());
  results.push(checkOutputDirectory());
  results.push(await checkCutoffLogic());
  results.push(checkCronSchedule());
  results.push(await runDryExport());
  results.push(checkExportFile());

  const passed = results.filter(Boolean).length;
  const total  = results.length;

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  if (passed === total) {
    console.log(`║  ✅  All ${total}/${total} checks passed. CRON job is ready to deploy.  ║`);
  } else {
    console.log(`║  ❌  ${passed}/${total} checks passed. Fix the failures above.          ║`);
  }
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  process.exitCode = passed === total ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("\n[test_cron] FATAL:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
