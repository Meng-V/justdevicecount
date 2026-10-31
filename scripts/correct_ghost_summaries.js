/**
 * correct_ghost_summaries.js — take the CMX "ghost" clients back out of King's
 * summary files for months that are no longer in the database.
 *
 * WHAT WENT WRONG
 *   The CMX fault that correct_ghost_history.js fixed for Sep-Oct 2026 had
 *   happened before.  Ghosts piled up to 300-600 devices from about 21 Oct to
 *   10 Nov 2025, 25 Feb to 20 Mar 2026 and 30 Mar to 20 Apr 2026, with smaller
 *   build-ups (20-60 devices) in most other term weeks.  Those rows were purged
 *   from device_data long ago.  The dashboard reads them from
 *   STORED_DATA_DIR/summaries/YYYY-MM_summary.json, and the monthly exports
 *   written by initial_export.js still hold every device with its position.
 *
 * HOW IT IS CORRECTED
 *   Exactly the King method of correct_ghost_history.js, with the same
 *   constants: a device frozen in place for 45+ min is a ghost, minus the
 *   frozen-but-real devices  a + b × (devices still moving)  per floor.  It runs
 *   over every row, not only the bad weeks: on healthy days the frozen devices
 *   are the ones the formula expects, so almost nothing is removed and no dates
 *   have to be picked by hand.  Rec is not affected (no Rec data before Jul 2026).
 *
 * TWO STEPS, because the exports and the summary files live on different machines
 *   1. Where the exports are (YYYY-MM_device_data.json):
 *        node scripts/correct_ghost_summaries.js --exports stored_data/raw_data
 *      prints before → after per day and writes
 *      STORED_DATA_DIR/ghost_summary_corrections.json — timestamps and counts
 *      only, no device IDs.
 *   2. On the server, as devicecount, from /opt/devicecount/current, with that
 *      file copied into STORED_DATA_DIR:
 *        node scripts/correct_ghost_summaries.js             # dry run
 *        node scripts/correct_ghost_summaries.js --apply
 *        node scripts/refresh_summaries.js                   # rebuilds big_summary.json
 *
 * SAFETY
 *   - --apply copies every summary file it changes to
 *     STORED_DATA_DIR/ghost_summary_backup/ first (once — later runs keep that
 *     first copy), and only rewrites a record whose current value is the
 *     uncorrected one in the corrections file.  Running it twice changes nothing.
 *   - --restore copies the backed-up files back.
 *   - refresh_summaries.js --include-exports would merge the uncorrected export
 *     values back in; don't use it for these months.
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");

const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");
const SUMMARY_DIR = path.join(STORED_DATA_DIR, "summaries");
const CORRECTIONS = path.join(STORED_DATA_DIR, "ghost_summary_corrections.json");
const BACKUP_DIR  = path.join(STORED_DATA_DIR, "ghost_summary_backup");

const argExports = process.argv.indexOf("--exports");
const EXPORTS = argExports > 0 ? path.resolve(process.argv[argExports + 1]) : null;
const APPLY   = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");

// Same as correct_ghost_history.js — see there for where these come from.
const MIN = 60 * 1000;
const FROZEN_MIN = 45;
const KING_RESET_GAP = 8 * 60 * MIN;
const KING_REAL_FROZEN = [[2.19, 0.122], [7.88, 0.100], [10.23, 0.195], [5.70, 0.094]];
const KING_FLOORS = ["uniqUserGround", "uniqUserFirst", "uniqUserSecond", "uniqUserThird"];

const TZ = "America/New_York";
const etDay  = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const etHHMM = (d) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum    = (a) => a.reduce((x, y) => x + y, 0);
// Summary files key records by timeStamp with the milliseconds zeroed (refresh_summaries.js).
const isoMs  = (d) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
const same   = (a, b) => a.patrons === b.patrons && (a.countByFloor || []).join() === (b.countByFloor || []).join();

const fmt  = (v, w) => String(v == null ? "-" : v).padStart(w);
const pair = (a, b, w = 4) => (a == null ? fmt("-", w * 2 + 3) : `${fmt(a, w)} → ${fmt(b, w)}`);

// ---------------------------------------------------------------------------
// Step 1 — compute the corrections from the exports
// ---------------------------------------------------------------------------
function compute() {
  const files = fs.readdirSync(EXPORTS).filter((f) => /^\d{4}-\d{2}_device_data\.json$/.test(f)).sort();
  if (!files.length) throw new Error(`no YYYY-MM_device_data.json files in ${EXPORTS}`);
  console.log(`[correct_ghost_summaries] reading ${files.join(", ")} from ${EXPORTS}`);

  const state = new Map();   // deviceId -> { sig, since }
  const rows = [];           // { t, orig, next }
  let prevT = null;

  // One month at a time; the frozen-position state carries across the month boundary.
  for (const f of files) {
    const month = JSON.parse(fs.readFileSync(path.join(EXPORTS, f), "utf8"))
      .map((row) => ({ ...row, t: new Date(row.timeStamp) }))
      .sort((a, b) => a.t - b.t);

    for (const row of month) {
      const t = row.t.getTime();
      if (prevT !== null && t - prevT > KING_RESET_GAP) state.clear();
      prevT = t;

      // Each device's positions across the floors it was seen on.
      const now = new Map();
      const raw = KING_FLOORS.map((fl, i) => {
        const map = row[fl] && typeof row[fl] === "object" ? row[fl] : {};
        for (const [id, xy] of Object.entries(map)) {
          if (!now.has(id)) now.set(id, { sig: [], floors: [] });
          now.get(id).sig.push(`${i}:${Array.isArray(xy) ? xy.join(",") : xy}`);
          now.get(id).floors.push(i);
        }
        return Object.keys(map).length;
      });

      const frozen = [0, 0, 0, 0];
      for (const [id, d] of now) {
        const sig = d.sig.sort().join("|");
        const s = state.get(id);
        if (!s || s.sig !== sig) state.set(id, { sig, since: t });
        if ((t - state.get(id).since) / MIN >= FROZEN_MIN) for (const fl of d.floors) frozen[fl]++;
      }
      for (const id of state.keys()) if (!now.has(id)) state.delete(id);

      const realFrozen = raw.map((n, fl) => KING_REAL_FROZEN[fl][0] + KING_REAL_FROZEN[fl][1] * (n - frozen[fl]));
      const removed = raw.map((n, fl) => Math.max(0, Math.round(frozen[fl] - realFrozen[fl])));
      const floors = raw.map((n, fl) => n - removed[fl]);
      const orig = { patrons: row.patrons, countByFloor: row.countByFloor };
      rows.push({
        t: row.t, orig,
        next: { patrons: Math.max(Math.max(...floors), orig.patrons - sum(removed)), countByFloor: floors },
      });
    }
  }

  // Report: per day, then per month.
  const days = new Map();
  for (const r of rows) {
    const d = etDay(r.t);
    if (!days.has(d)) days.set(d, { all: [], night: [] });
    days.get(d).all.push(r);
    const hm = etHHMM(r.t);
    if (hm >= "01:15" && hm <= "01:45") days.get(d).night.push(r);
  }
  const peak = (rs, k) => (rs.length ? Math.max(...rs.map((r) => r[k].patrons)) : null);
  const med  = (rs, k) => (rs.length ? median(rs.map((r) => r[k].patrons)) : null);
  const avg  = (rs, k) => Math.round(sum(rs.map((r) => r[k].patrons)) / rs.length);

  console.log("\nKing devices before → after");
  console.log("date        peak           01:30");
  for (const [d, v] of [...days].sort()) {
    console.log(`${d}  ${pair(peak(v.all, "orig"), peak(v.all, "next"))}   ${pair(med(v.night, "orig"), med(v.night, "next"))}`);
  }

  const months = new Map();
  for (const r of rows) {
    const mk = isoMs(r.t).slice(0, 7);   // summary files are bucketed by UTC month
    if (!months.has(mk)) months.set(mk, []);
    months.get(mk).push(r);
  }
  console.log("\nmonth       avg            peak           rows changed");
  for (const [mk, rs] of [...months].sort()) {
    const n = rs.filter((r) => !same(r.orig, r.next)).length;
    console.log(`${mk}     ${pair(avg(rs, "orig"), avg(rs, "next"))}   ${pair(peak(rs, "orig"), peak(rs, "next"))}   ${n} of ${rs.length}`);
  }

  const changed = rows.filter((r) => !same(r.orig, r.next));
  fs.mkdirSync(STORED_DATA_DIR, { recursive: true });
  fs.writeFileSync(CORRECTIONS, JSON.stringify({
    createdAt: new Date().toISOString(),
    exports: files,
    rows: changed.map((r) => ({ timeStamp: isoMs(r.t), orig: r.orig, next: r.next })),
  }));
  fs.chmodSync(CORRECTIONS, 0o644);
  console.log(`\n${changed.length} corrections (timestamps and counts only) written to ${CORRECTIONS}`);
  console.log("Copy that file into STORED_DATA_DIR on the server, then run this script there without --exports.");
}

// ---------------------------------------------------------------------------
// Step 2 — apply them to the summary files
// ---------------------------------------------------------------------------
function apply() {
  if (!fs.existsSync(CORRECTIONS)) {
    throw new Error(`${CORRECTIONS} not found — run step 1 (--exports) where the exports are and copy the file here`);
  }
  const corr = JSON.parse(fs.readFileSync(CORRECTIONS, "utf8"));
  console.log(`[correct_ghost_summaries] ${APPLY ? "APPLY" : "dry run"} — ${corr.rows.length} corrections ` +
              `from ${corr.exports.join(", ")} (computed ${corr.createdAt})`);

  const byMonth = new Map();
  for (const c of corr.rows) {
    const mk = c.timeStamp.slice(0, 7);
    if (!byMonth.has(mk)) byMonth.set(mk, []);
    byMonth.get(mk).push(c);
  }

  const peak = (rs) => Math.max(...rs.map((r) => r.patrons));
  const avg  = (rs) => Math.round(sum(rs.map((r) => r.patrons)) / rs.length);

  console.log("\nmonth       avg            peak           rewrite  already  not found  changed since");
  let total = 0;
  for (const [mk, cs] of [...byMonth].sort()) {
    const file = path.join(SUMMARY_DIR, `${mk}_summary.json`);
    if (!fs.existsSync(file)) {
      console.log(`${mk}     no summary file — skipped`);
      continue;
    }
    const records = JSON.parse(fs.readFileSync(file, "utf8"));
    const byTs = new Map(records.map((r) => [r.timeStamp, r]));
    const before = records.map((r) => ({ patrons: r.patrons }));

    const todo = [];
    let already = 0, missing = 0, differs = 0;
    for (const c of cs) {
      const r = byTs.get(c.timeStamp);
      if (!r) missing++;
      else if (same(r, c.next)) already++;
      else if (same(r, c.orig)) todo.push([r, c.next]);
      else differs++;
    }
    for (const [r, next] of todo) { r.patrons = next.patrons; r.countByFloor = next.countByFloor; }

    console.log(`${mk}     ${pair(avg(before), avg(records))}   ${pair(peak(before), peak(records))}   ` +
                `${fmt(todo.length, 7)}  ${fmt(already, 7)}  ${fmt(missing, 9)}  ${fmt(differs, 13)}`);
    total += todo.length;

    if (APPLY && todo.length) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const backup = path.join(BACKUP_DIR, path.basename(file));
      if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
      fs.writeFileSync(file, JSON.stringify(records, null, 2), "utf8");
    }
  }

  if (APPLY) {
    console.log(`\nRewrote ${total} records; originals in ${BACKUP_DIR}.  Now run: node scripts/refresh_summaries.js`);
  } else {
    console.log(`\nDry run — nothing written.  Re-run with --apply to rewrite ${total} records.`);
  }
}

function restore() {
  if (!fs.existsSync(BACKUP_DIR)) throw new Error(`no backup at ${BACKUP_DIR} — nothing to restore`);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith("_summary.json"));
  for (const f of files) fs.copyFileSync(path.join(BACKUP_DIR, f), path.join(SUMMARY_DIR, f));
  const kept = `${BACKUP_DIR}.restored-${Date.now()}`;
  fs.renameSync(BACKUP_DIR, kept);
  console.log(`Restored ${files.join(", ")}.  Backup moved to ${kept}`);
  console.log("Now run: node scripts/refresh_summaries.js");
}

try {
  if (RESTORE) restore();
  else if (EXPORTS) compute();
  else apply();
} catch (e) {
  console.error("[correct_ghost_summaries] FATAL:", e.message);
  process.exitCode = 1;
}
