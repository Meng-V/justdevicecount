/**
 * ghost_history_diag.js — measure how many CMX "ghost" clients the stored
 * history contains, before we correct it.  READ-ONLY: it never writes the DB.
 *
 * WHY THIS EXISTS
 *   From early September 2026 until the 29 Oct deploy of
 *   modules/staleClientFilter.js, CMX kept listing clients long after they had
 *   left, and the collector counted them.  Every row stored in that period is
 *   inflated.  Before rewriting any of them we need to know, from the data
 *   itself, when it started, how long a ghost lingers, and how far off each
 *   building is.
 *
 * HOW A GHOST IS RECOGNISED (King only — Rec rows keep no per-device data)
 *   King rows store every counted device with its [x, y] position.  CMX stops
 *   locating a client once it goes INACTIVE, so a ghost's position never moves
 *   again; a device that is really there gets re-located and its position
 *   changes.  For each device we track how long its position has been exactly
 *   unchanged ("frozen age").  The live filter drops a client 30 min after it
 *   went INACTIVE, which on 15-minute samples is a frozen age of 45 min.
 *   The script also reports 30 and 60 min so the threshold's effect is visible.
 *
 *   Ways to check that rule against the data:
 *     - days before the problem began: frozen devices should be rare;
 *     - the deploy itself: raw minus frozen just before 22:58 on 29 Oct
 *       should land on what the filter counted just after.
 *
 * OUTPUT
 *   A short daily table on stdout, and every sample as counts only (no device
 *   IDs) in STORED_DATA_DIR/ghost_diag.json for offline analysis.
 *
 * USAGE (on the server, as devicecount, from /opt/devicecount/current)
 *   node scripts/ghost_history_diag.js
 *   node scripts/ghost_history_diag.js --from 2026-09-01
 */

require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const fs   = require("fs");
const path = require("path");

const prisma = new PrismaClient();

const STORED_DATA_DIR = process.env.STORED_DATA_DIR
  ? path.resolve(process.env.STORED_DATA_DIR)
  : path.resolve(__dirname, "..", "stored_data");

const TZ = "America/New_York";
const MIN = 60 * 1000;
const THRESHOLDS = [30, 45, 60];          // frozen-age cut-offs, minutes
const RESET_GAP = 8 * 60 * MIN;           // longer than the silent window: an outage
const FLOORS = ["uniqUserGround", "uniqUserFirst", "uniqUserSecond", "uniqUserThird"];

// When the filter went live (first post-restart King row was 22:58:35 ET).
const DEPLOY = new Date("2026-10-30T02:58:00Z");

const argFrom = process.argv.indexOf("--from");
const FROM = new Date(argFrom > 0 ? `${process.argv[argFrom + 1]}T04:00:00Z` : "2026-09-01T04:00:00Z");

const etDay  = (d) => d.toLocaleDateString("en-CA", { timeZone: TZ });        // 2026-10-29
const etHHMM = (d) => d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

// Rows in time order, a day at a time so the JSON columns never pile up in memory.
async function* rowsInOrder(model, select) {
  const DAY = 24 * 60 * MIN;
  for (let start = FROM.getTime(); start < Date.now(); start += DAY) {
    const rows = await model.findMany({
      where:   { timeStamp: { gte: new Date(start), lt: new Date(start + DAY) } },
      orderBy: { timeStamp: "asc" },
      select,
    });
    yield* rows;
  }
}

// One device's positions across the floors it was seen on, as a comparable string.
function positionsOf(row) {
  const byDevice = new Map();
  FLOORS.forEach((f, i) => {
    const map = row[f] && typeof row[f] === "object" ? row[f] : {};
    for (const [id, xy] of Object.entries(map)) {
      if (!byDevice.has(id)) byDevice.set(id, { sig: [], floors: [] });
      const d = byDevice.get(id);
      d.sig.push(`${i}:${Array.isArray(xy) ? xy.join(",") : xy}`);
      d.floors.push(i);
    }
  });
  return byDevice;
}

const HIST_EDGES = [45, 60, 120, 240, 480, 960, 1440, 2880];   // minutes
const histLabel = (i) => i < HIST_EDGES.length - 1
  ? `${HIST_EDGES[i]}-${HIST_EDGES[i + 1]}m` : `>${HIST_EDGES[HIST_EDGES.length - 1]}m`;

async function king() {
  const state = new Map();   // deviceId -> { sig, since, last }
  const samples = [];
  const runs = { gone: new Array(HIST_EDGES.length).fill(0), moved: new Array(HIST_EDGES.length).fill(0), openAtDeploy: 0 };
  let prevT = null;

  const endRun = (s, how, t) => {
    if (t > DEPLOY) return;                       // the filter, not CMX, removed it
    const mins = (s.last - s.since) / MIN;
    if (mins < 45) return;
    let b = 0;
    while (b < HIST_EDGES.length - 1 && mins >= HIST_EDGES[b + 1]) b++;
    runs[how][b]++;
  };

  for await (const row of rowsInOrder(prisma.deviceData, {
    timeStamp: true, patrons: true, countByFloor: true,
    uniqUserGround: true, uniqUserFirst: true, uniqUserSecond: true, uniqUserThird: true,
  })) {
    const t = row.timeStamp.getTime();
    if (prevT !== null && t - prevT > RESET_GAP) state.clear();
    if (prevT !== null && prevT <= DEPLOY.getTime() && t > DEPLOY.getTime()) {
      for (const s of state.values()) if ((s.last - s.since) / MIN >= 45) runs.openAtDeploy++;
    }
    prevT = t;

    const now = positionsOf(row);
    const frozen = THRESHOLDS.map(() => 0);
    const frozenFloors45 = [0, 0, 0, 0];
    let became45 = 0;

    for (const [id, d] of now) {
      const sig = d.sig.sort().join("|");
      const s = state.get(id);
      if (s && s.sig === sig) {
        if ((s.last - s.since) / MIN < 45 && (t - s.since) / MIN >= 45) became45++;
        s.last = t;
      } else {
        if (s) endRun(s, "moved", t);
        state.set(id, { sig, since: t, last: t });
      }
      const age = (t - state.get(id).since) / MIN;
      THRESHOLDS.forEach((th, k) => { if (age >= th) frozen[k]++; });
      if (age >= 45) for (const f of d.floors) frozenFloors45[f]++;
    }

    let goneGhosts = 0;
    for (const [id, s] of state) {
      if (!now.has(id)) {
        if ((s.last - s.since) / MIN >= 45 && t <= DEPLOY.getTime()) goneGhosts++;
        endRun(s, "gone", t);
        state.delete(id);
      }
    }

    samples.push([
      row.timeStamp.toISOString(), row.patrons, now.size, ...frozen,
      row.countByFloor, frozenFloors45, became45, goneGhosts,
    ]);
  }
  return { samples, runs };
}

async function rec() {
  const samples = [];
  for await (const row of rowsInOrder(prisma.recData, { timeStamp: true, patrons: true, countByFloor: true })) {
    samples.push([row.timeStamp.toISOString(), row.patrons, row.countByFloor]);
  }
  return { samples };
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const fmt = (v, w = 5) => String(v == null ? "-" : v).padStart(w);

async function run() {
  console.log(`[ghost_diag] reading from ${FROM.toISOString()} …`);
  const K = await king();
  const R = await rec();

  // Daily table: busiest reading, and readings while each building is closed.
  // King closed 01:15-01:45 (shuts at 01:00); Rec closed 00:30-01:45 and 05:00-05:45.
  const days = new Map();
  const day = (d) => {
    if (!days.has(d)) days.set(d, { kMax: [], kMaxC: [], kNight: [], kNightC: [], rNight: [], rDawn: [] });
    return days.get(d);
  };
  for (const [iso, raw, , , f45] of K.samples) {
    const t = new Date(iso), hm = etHHMM(t), d = day(etDay(t));
    d.kMax.push(raw); d.kMaxC.push(raw - f45);
    if (hm >= "01:15" && hm <= "01:45") { d.kNight.push(raw); d.kNightC.push(raw - f45); }
  }
  for (const [iso, raw] of R.samples) {
    const t = new Date(iso), hm = etHHMM(t), d = day(etDay(t));
    if (hm >= "00:30" && hm <= "01:45") d.rNight.push(raw);
    if (hm >= "05:00" && hm <= "05:45") d.rDawn.push(raw);
  }

  console.log("\n            ---------------- King ----------------   ----- Rec -----");
  console.log("date        peak  peak-ghosts  01:30  01:30-ghosts   00:30-01:45  05:00");
  for (const [d, v] of [...days].sort()) {
    console.log(`${d}  ${fmt(v.kMax.length ? Math.max(...v.kMax) : null)}  ${fmt(v.kMaxC.length ? Math.max(...v.kMaxC) : null, 11)}` +
                `  ${fmt(median(v.kNight))}  ${fmt(median(v.kNightC), 12)}   ${fmt(median(v.rNight), 11)}  ${fmt(median(v.rDawn))}`);
  }

  console.log("\nKing around the deploy (ghosts = position frozen >= 45 min):");
  console.log("time   raw  ghosts  raw-ghosts");
  const i0 = K.samples.findIndex(([iso]) => new Date(iso) > DEPLOY);
  for (const [iso, raw, , , f45] of K.samples.slice(Math.max(0, i0 - 4), i0 >= 0 ? i0 + 3 : 0)) {
    console.log(`${etHHMM(new Date(iso))} ${fmt(raw, 4)} ${fmt(f45, 7)} ${fmt(raw - f45, 11)}`);
  }

  console.log("\nHow long a ghost stays listed before CMX drops it (King, frozen >= 45 min):");
  console.log(HIST_EDGES.map((_, i) => `${histLabel(i)} ${K.runs.gone[i]}`).join("   "));
  console.log(`came back to life (position moved again): ${K.runs.moved.reduce((a, b) => a + b, 0)}` +
              `   still listed when the filter went live: ${K.runs.openAtDeploy}`);

  fs.mkdirSync(STORED_DATA_DIR, { recursive: true });
  const out = path.join(STORED_DATA_DIR, "ghost_diag.json");
  fs.writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    from: FROM.toISOString(),
    deploy: DEPLOY.toISOString(),
    thresholds: THRESHOLDS,
    histEdgesMin: HIST_EDGES,
    kingColumns: ["time", "patrons", "devices", ...THRESHOLDS.map((m) => `frozen${m}`),
                  "countByFloor", "frozen45ByFloor", "became45", "ghostsGone"],
    king: K.samples,
    kingRuns: K.runs,
    recColumns: ["time", "patrons", "countByFloor"],
    rec: R.samples,
  }));
  fs.chmodSync(out, 0o644);
  console.log(`\nCounts only (no device IDs) written to ${out}`);
}

run()
  .catch((e) => { console.error("[ghost_diag] FATAL:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
