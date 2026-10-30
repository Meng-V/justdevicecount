/**
 * correct_ghost_history.js — take the CMX "ghost" clients back out of the rows
 * stored between 5 Sep and 29 Oct 2026.
 *
 * WHAT WENT WRONG
 *   From 5 Sep 2026 CMX kept listing clients for hours or days after they had
 *   left, and the collector counted them until modules/staleClientFilter.js went
 *   live at 22:58 ET on 29 Oct.  scripts/ghost_history_diag.js measured it:
 *   King read 100-200 devices too many, the Rec 150-340.
 *
 * HOW EACH BUILDING IS CORRECTED — differently, because they store different data
 *
 *   King (device_data): device by device.
 *     Each row lists every counted device with its position.  A ghost's position
 *     never changes, so a device frozen in place for 45+ min is one the live
 *     filter would have dropped.  Some devices that really are there also sit
 *     unmoved that long (idle laptops, always-on equipment).  On the healthy days
 *     of 1-4 Sep their number per floor was  a + b × (devices still moving),  and
 *     the same formula predicts them after the deploy within ±3.  So each floor
 *     loses  frozen − (a + b × moving),  never less than 0.  The device lists are
 *     left as they are, so the original counts stay recoverable from them.
 *
 *   Rec (rec_data): estimated — these rows keep only per-floor totals.
 *     While the Rec is closed (00:30-01:45 and 05:00-05:45) every device above the
 *     healthy closed-hours level is a ghost.  In between, the ghost count is
 *     interpolated linearly from one closed reading to the next.  The same method
 *     run on King's totals, where the true ghost count is known, stayed within
 *     -5 % .. +9 % of the true count in every hour of the day.  A collection gap of
 *     5 h or more (the nightly pause is 3¼ h) means CMX restarted and dropped all
 *     its ghosts (seen on 9 Sep and 20 Oct): the count holds up to the gap and
 *     grows from 0 after it.
 *
 * SAFETY
 *   - Dry run by default: per-day before/after plus checks; writes nothing.
 *   - --apply first saves the original value of every row in the period to
 *     STORED_DATA_DIR/ghost_correction_backup.json, then rewrites patrons and
 *     countByFloor.  Every later run computes from that backup, so running it
 *     again (or with adjusted constants) never corrects a row twice.
 *   - --restore writes the backed-up originals back.
 *   - Rows from the deploy onwards are never touched.
 *
 * AFTERWARDS
 *   node scripts/refresh_summaries.js     (the dashboard reads the summary files)
 *
 * USAGE (on the server, as devicecount, from /opt/devicecount/current)
 *   node scripts/correct_ghost_history.js             # dry run
 *   node scripts/correct_ghost_history.js --apply
 *   node scripts/correct_ghost_history.js --restore
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma = new PrismaClient();

const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");
const BACKUP = path.join(STORED_DATA_DIR, "ghost_correction_backup.json");

const APPLY   = process.argv.includes("--apply");
const RESTORE = process.argv.includes("--restore");

const MIN    = 60 * 1000;
const ONSET  = new Date("2026-09-05T09:30:00Z");   // 05:30 ET 5 Sep: last healthy Rec reading
const DEPLOY = new Date("2026-10-30T02:58:00Z");   // 22:58 ET 29 Oct: staleClientFilter live
const WARMUP = 12 * 60 * MIN;                      // read this much before ONSET to age positions
const FROZEN_MIN = 45;                             // = the live filter's 30 min, on 15-min samples
const KING_RESET_GAP  = 8 * 60 * MIN;              // longer than the silent window: an outage
const CMX_RESTART_GAP = 5 * 60 * MIN;              // Rec: CMX restarted, ghost list emptied

// King frozen-but-real devices per floor = a + b × devices still moving (fitted on 1-4 Sep).
const KING_REAL_FROZEN = [[2.19, 0.122], [7.88, 0.100], [10.23, 0.195], [5.70, 0.094]];
const KING_FLOORS = ["uniqUserGround", "uniqUserFirst", "uniqUserSecond", "uniqUserThird"];
// Rec devices per floor [ground, first] while closed, CMX healthy (median, 1-5 Sep).
const REC_CLOSED = [5, 7];

const TZ = "America/New_York";
const etDay  = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const etHHMM = (d) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const sum    = (a) => a.reduce((x, y) => x + y, 0);

function recClosedWindow(t) {
  const hm = etHHMM(t);
  if (hm >= "00:30" && hm <= "01:45") return "night";
  if (hm >= "05:00" && hm <= "05:45") return "dawn";
  return null;
}

// Rows in time order, a day at a time so the JSON columns never pile up in memory.
async function* rowsInOrder(model, from, to, select) {
  const DAY = 24 * 60 * MIN;
  for (let start = from.getTime(); start < to.getTime(); start += DAY) {
    yield* await model.findMany({
      where:   { timeStamp: { gte: new Date(start), lt: new Date(Math.min(start + DAY, to.getTime())) } },
      orderBy: { timeStamp: "asc" },
      select,
    });
  }
}

function readBackup() {
  if (!fs.existsSync(BACKUP)) return null;
  return JSON.parse(fs.readFileSync(BACKUP, "utf8"));
}

// ---------------------------------------------------------------------------
// King
// ---------------------------------------------------------------------------
async function king(backup) {
  const state = new Map();   // deviceId -> { sig, since }
  const rows = [];           // ghost period: { id, t, orig, next, current }
  const after = [];          // since the deploy: { t, raw, frozen, predicted }
  let prevT = null;

  for await (const row of rowsInOrder(prisma.deviceData, new Date(ONSET.getTime() - WARMUP), new Date(), {
    id: true, timeStamp: true, patrons: true, countByFloor: true,
    uniqUserGround: true, uniqUserFirst: true, uniqUserSecond: true, uniqUserThird: true,
  })) {
    const t = row.timeStamp.getTime();
    if (prevT !== null && t - prevT > KING_RESET_GAP) state.clear();
    prevT = t;

    // Each device's positions across the floors it was seen on.
    const now = new Map();
    const raw = KING_FLOORS.map((f, i) => {
      const map = row[f] && typeof row[f] === "object" ? row[f] : {};
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
      if ((t - state.get(id).since) / MIN >= FROZEN_MIN) for (const f of d.floors) frozen[f]++;
    }
    for (const id of state.keys()) if (!now.has(id)) state.delete(id);

    const realFrozen = raw.map((n, f) => KING_REAL_FROZEN[f][0] + KING_REAL_FROZEN[f][1] * (n - frozen[f]));

    if (row.timeStamp >= DEPLOY) {
      after.push({ t: row.timeStamp, raw: row.patrons, frozen: sum(frozen), predicted: sum(realFrozen) });
      continue;
    }
    if (row.timeStamp < ONSET) continue;

    const orig = (backup && backup.king[row.id]) || { patrons: row.patrons, countByFloor: row.countByFloor };
    const removed = raw.map((n, f) => Math.max(0, Math.round(frozen[f] - realFrozen[f])));
    const floors = raw.map((n, f) => n - removed[f]);
    rows.push({
      id: row.id, t: row.timeStamp, orig,
      current: { patrons: row.patrons, countByFloor: row.countByFloor },
      next: { patrons: Math.max(Math.max(...floors), orig.patrons - sum(removed)), countByFloor: floors },
    });
  }
  return { rows, after };
}

// ---------------------------------------------------------------------------
// Rec
// ---------------------------------------------------------------------------
async function rec(backup) {
  const all = [];
  for await (const row of rowsInOrder(prisma.recData, new Date(ONSET.getTime() - WARMUP), new Date(), {
    id: true, timeStamp: true, patrons: true, countByFloor: true,
  })) {
    const orig = (row.timeStamp < DEPLOY && backup && backup.rec[row.id]) || { patrons: row.patrons, countByFloor: row.countByFloor };
    all.push({ id: row.id, t: row.timeStamp, orig, current: { patrons: row.patrons, countByFloor: row.countByFloor } });
  }
  const before = all.filter((r) => r.t < DEPLOY);
  const after  = all.filter((r) => r.t >= DEPLOY);

  // Split at collection gaps long enough to mean CMX restarted.
  const segments = [[]];
  before.forEach((r, i) => {
    if (i > 0 && r.t - before[i - 1].t >= CMX_RESTART_GAP) segments.push([]);
    segments[segments.length - 1].push(r);
  });

  for (const [s, seg] of segments.entries()) {
    // Ghosts per floor at each closed-hours reading.
    const windows = new Map();
    for (const r of seg) {
      const w = recClosedWindow(r.t);
      if (!w) continue;
      const key = `${etDay(r.t)} ${w}`;
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push(r);
    }
    const anchors = [];
    for (const rs of windows.values()) {
      if (rs.length < 2) continue;
      anchors.push({
        t: sum(rs.map((r) => r.t.getTime())) / rs.length,
        g: [0, 1].map((f) => Math.max(0, median(rs.map((r) => r.orig.countByFloor[f] || 0)) - REC_CLOSED[f])),
      });
    }
    if (s > 0) anchors.unshift({ t: seg[0].t.getTime(), g: [0, 0] });   // CMX just restarted
    anchors.sort((a, b) => a.t - b.t);

    const ghostsAt = (t) => {
      if (!anchors.length) return [0, 0];
      if (t <= anchors[0].t) return anchors[0].g;
      for (let i = 1; i < anchors.length; i++) {
        const a = anchors[i - 1], b = anchors[i];
        if (t <= b.t) return [0, 1].map((f) => a.g[f] + (b.g[f] - a.g[f]) * (t - a.t) / (b.t - a.t));
      }
      return anchors[anchors.length - 1].g;   // hold up to the end of the segment
    };

    for (const r of seg) {
      const g = ghostsAt(r.t.getTime());
      const raw = [0, 1].map((f) => r.orig.countByFloor[f] || 0);
      const floors = raw.map((n, f) => Math.max(Math.min(n, REC_CLOSED[f]), n - Math.round(g[f])));
      r.next = { patrons: Math.max(0, r.orig.patrons - (sum(raw) - sum(floors))), countByFloor: floors };
    }
  }
  return { rows: before.filter((r) => r.t >= ONSET), after };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const fmt = (v, w) => String(v == null ? "-" : v).padStart(w);
const pair = (a, b, w = 4) => (a == null ? fmt("-", w * 2 + 3) : `${fmt(a, w)} → ${fmt(b, w)}`);

function report(K, R) {
  const days = new Map();
  const day = (t) => {
    const d = etDay(t);
    if (!days.has(d)) days.set(d, { k: [], kn: [], r: [], rn: [] });
    return days.get(d);
  };
  for (const r of K.rows) {
    const d = day(r.t);
    d.k.push(r);
    const hm = etHHMM(r.t);
    if (hm >= "01:15" && hm <= "01:45") d.kn.push(r);
  }
  for (const r of R.rows) {
    const d = day(r.t);
    d.r.push(r);
    if (recClosedWindow(r.t) === "night") d.rn.push(r);
  }
  const peak = (rs, k) => (rs.length ? Math.max(...rs.map((r) => r[k].patrons)) : null);
  const med  = (rs, k) => (rs.length ? median(rs.map((r) => r[k].patrons)) : null);

  console.log("\nDevices before → after (Rec: raw devices; the API turns them into people)");
  console.log("date        King peak      King 01:30      Rec peak       Rec 00:30-01:45");
  for (const [d, v] of [...days].sort()) {
    console.log(`${d}  ${pair(peak(v.k, "orig"), peak(v.k, "next"))}   ${pair(med(v.kn, "orig"), med(v.kn, "next"))}   ` +
                `${pair(peak(v.r, "orig"), peak(v.r, "next"))}   ${pair(med(v.rn, "orig"), med(v.rn, "next"))}`);
  }

  console.log("\nCheck 1 — King frozen-but-real formula on rows the live filter produced:");
  if (K.after.length) {
    const err = K.after.map((r) => r.frozen - r.predicted);
    console.log(`  ${K.after.length} rows since the deploy: actual − predicted = ${(sum(err) / err.length).toFixed(1)} on average, ` +
                `worst ${Math.max(...err.map(Math.abs)).toFixed(1)} devices`);
  } else console.log("  no rows since the deploy yet");

  console.log("\nCheck 2 — the deploy seam (corrected before, live filter after):");
  const seam = (rows, after, label) => {
    const b = rows.slice(-3).map((r) => `${etHHMM(r.t)} ${r.next.patrons}`);
    const a = after.slice(0, 3).map((r) => `${etHHMM(r.t)} ${r.raw != null ? r.raw : r.current.patrons}`);
    console.log(`  ${label}: ${b.join(", ")}  |  ${a.join(", ")}`);
  };
  seam(K.rows, K.after, "King");
  seam(R.rows, R.after, "Rec ");

  console.log("\nCheck 3 — Rec closed-hours level the corrected history is pulled down to, vs the live filter:");
  const live = R.after.filter((r) => recClosedWindow(r.t));
  console.log(`  assumed ${sum(REC_CLOSED)} devices (${REC_CLOSED.join(" + ")});  live filter: ` +
              (live.length ? `${median(live.map((r) => r.current.patrons))} devices over ${live.length} readings` : "no closed-hours readings yet"));

  const changed = (rs) => rs.filter((r) => r.next.patrons !== r.current.patrons ||
    r.next.countByFloor.join() !== (r.current.countByFloor || []).join()).length;
  console.log(`\nRows to rewrite: King ${changed(K.rows)} of ${K.rows.length}, Rec ${changed(R.rows)} of ${R.rows.length}`);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------
async function write(model, rows, valuesOf) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    await prisma.$transaction(batch.map((r) => model.update({ where: { id: r.id }, data: valuesOf(r) })));
    n += batch.length;
  }
  return n;
}

async function apply(K, R, backup) {
  if (!backup) {
    const originals = (rows) => Object.fromEntries(rows.map((r) => [r.id, r.orig]));
    const tmp = `${BACKUP}.tmp`;
    fs.mkdirSync(STORED_DATA_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({
      createdAt: new Date().toISOString(), onset: ONSET.toISOString(), deploy: DEPLOY.toISOString(),
      king: originals(K.rows), rec: originals(R.rows),
    }));
    fs.renameSync(tmp, BACKUP);
    fs.chmodSync(BACKUP, 0o644);
    console.log(`\nOriginals saved to ${BACKUP}`);
  } else {
    console.log(`\nOriginals already saved in ${BACKUP} (from ${backup.createdAt}); computing from those`);
  }
  const todo = (rs) => rs.filter((r) => r.next.patrons !== r.current.patrons ||
    r.next.countByFloor.join() !== (r.current.countByFloor || []).join());
  const k = await write(prisma.deviceData, todo(K.rows), (r) => r.next);
  const r = await write(prisma.recData,    todo(R.rows), (r) => r.next);
  console.log(`Rewrote ${k} King rows and ${r} Rec rows.  Now run: node scripts/refresh_summaries.js`);
}

async function restore() {
  const backup = readBackup();
  if (!backup) throw new Error(`no backup at ${BACKUP} — nothing to restore`);
  const rows = (m) => Object.entries(m).map(([id, orig]) => ({ id, orig }));
  const k = await write(prisma.deviceData, rows(backup.king), (r) => r.orig);
  const r = await write(prisma.recData,    rows(backup.rec),  (r) => r.orig);
  const kept = BACKUP.replace(/\.json$/, `.restored-${Date.now()}.json`);
  fs.renameSync(BACKUP, kept);
  console.log(`Restored ${k} King rows and ${r} Rec rows.  Backup moved to ${kept}`);
  console.log("Now run: node scripts/refresh_summaries.js");
}

async function run() {
  if (RESTORE) return restore();
  const backup = readBackup();
  console.log(`[correct_ghost] ${APPLY ? "APPLY" : "dry run"} — ${ONSET.toISOString()} .. ${DEPLOY.toISOString()}` +
              (backup ? `  (using originals from ${BACKUP})` : ""));
  const K = await king(backup);
  const R = await rec(backup);
  report(K, R);
  if (APPLY) await apply(K, R, backup);
  else console.log("\nDry run — nothing written.  Re-run with --apply to rewrite these rows.");
}

run()
  .catch((e) => { console.error("[correct_ghost] FATAL:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
