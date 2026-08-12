const prisma   = require("./prisma");
const axiosApi = require("./axiosApi");
const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require("./deviceUtils");
const { isSilentHour, describeWindow, localParts } = require("./collectionWindow");

const APP_TZ = process.env.TZ || "America/New_York";

// ---------------------------------------------------------------------------
// Generic floor processing function.
// All Maps/Sets are created locally inside each king_start() call (fixes the
// module-level race condition — issue 1.2).
// ---------------------------------------------------------------------------
// Returns true when the CMX API actually answered for this floor, false when
// the request failed.  Callers use that to tell "building is empty" apart from
// "we could not reach CMX" — writing the latter as 0 patrons corrupts history.
function processFloorData(body, userMap, bounds) {
  // If the CMX API returned null (all retries failed) skip this floor safely.
  if (!body || !Array.isArray(body)) return false;

  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    const deviceId = device.deviceId;

    if (!isValidDevice(device)) continue;

    if (isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, bounds)) {
      if (!userMap.has(deviceId)) {
        userMap.set(deviceId, [
          device.locationCoordinate.x,
          device.locationCoordinate.y,
        ]);
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// King Library — data collection
// All state is local to this invocation; no module-level mutable globals.
// ---------------------------------------------------------------------------

// Floor boundary boxes (coordinate units from the CMX map)
const KING_FLOOR_BOUNDS = {
  ground: { minX: 10,  maxX: 314, minY: 36, maxY: 190 },
  first:  { minX: 16,  maxX: 314, minY: 29, maxY: 190 },
  second: { minX: 10,  maxX: 314, minY: 36, maxY: 190 },
  third:  { minX: 10,  maxX: 314, minY: 36, maxY: 190 },
};

async function king_start() {
  // Local state per invocation — no shared mutation, no race condition.
  const uniqUserGround = new Map();
  const uniqUserFirst  = new Map();
  const uniqUserSecond = new Map();
  const uniqUserThird  = new Map();
  const uniqKingAll    = new Set();
  let anyFloorOk       = false;

  await axiosApi.getGroundRequest((body) => {
    if (processFloorData(body, uniqUserGround, KING_FLOOR_BOUNDS.ground)) anyFloorOk = true;
    uniqUserGround.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getFirstRequest((body) => {
    if (processFloorData(body, uniqUserFirst, KING_FLOOR_BOUNDS.first)) anyFloorOk = true;
    uniqUserFirst.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getSecondRequest((body) => {
    if (processFloorData(body, uniqUserSecond, KING_FLOOR_BOUNDS.second)) anyFloorOk = true;
    uniqUserSecond.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getThirdRequest((body) => {
    if (processFloorData(body, uniqUserThird, KING_FLOOR_BOUNDS.third)) anyFloorOk = true;
    uniqUserThird.forEach((_, key) => uniqKingAll.add(key));
  });

  if (!anyFloorOk) {
    console.error(
      `[${dateTime()}] All King CMX requests failed — skipping DB write ` +
      "(refusing to store a fake 0-patron reading)"
    );
    return;
  }

  await saveToDatabase({ uniqUserGround, uniqUserFirst, uniqUserSecond, uniqUserThird, uniqKingAll });
}

// ---------------------------------------------------------------------------
// Save collected King Library data to PostgreSQL
// ---------------------------------------------------------------------------
async function saveToDatabase({ uniqUserGround, uniqUserFirst, uniqUserSecond, uniqUserThird, uniqKingAll }) {
  try {
    const now = new Date();

    const floorDocument = {
      timeStamp:      now,
      uniqUserTotal:  Array.from(uniqKingAll),
      uniqUserGround: Object.fromEntries(uniqUserGround),
      uniqUserFirst:  Object.fromEntries(uniqUserFirst),
      uniqUserSecond: Object.fromEntries(uniqUserSecond),
      uniqUserThird:  Object.fromEntries(uniqUserThird),
      patrons:        uniqKingAll.size,
      countByFloor: [
        uniqUserGround.size,
        uniqUserFirst.size,
        uniqUserSecond.size,
        uniqUserThird.size,
      ],
    };

    // Avoid duplicate entries: only write if the most recent DB record is
    // older than 60 seconds (guards against duplicate triggers / late fires).
    const checkDBTime = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: "desc" },
      select:  { timeStamp: true },
    });

    if (!checkDBTime) {
      await prisma.deviceData.create({ data: floorDocument });
      console.log(`[${dateTime()}] Saved first record to database (${uniqKingAll.size} patrons)`);
      return;
    }

    // Use .getTime() directly — no string parsing (fixes issue 1.5).
    const timeDiffMs = now.getTime() - checkDBTime.timeStamp.getTime();
    console.log(`[${dateTime()}] Time since last DB write: ${Math.round(timeDiffMs / 1000)}s`);

    if (timeDiffMs > 60000) {
      // Skip the overnight silent window (modules/collectionWindow.js).
      if (!isSilentHour("king")) {
        await prisma.deviceData.create({ data: floorDocument });
        console.log(`[${dateTime()}] Saved to database (${uniqKingAll.size} patrons)`);
      } else {
        console.log(
          `[${dateTime()}] Skipping King DB write during silent hours ` +
          `(${localParts().hour}:xx, window ${describeWindow("king")})`
        );
      }
    } else {
      console.log(`[${dateTime()}] Skipping duplicate write (last write was ${Math.round(timeDiffMs / 1000)}s ago)`);
    }
  } catch (err) {
    console.error(`[${dateTime()}] saveToDatabase error: ${err.stack}`);
  }
}

// ---------------------------------------------------------------------------
// Recreation Center — data collection
// ---------------------------------------------------------------------------

const REC_FLOOR_BOUNDS = {
  ground: { minX: 10,  maxX: 300, minY: 20,  maxY: 214 },
  first:  { minX: 190, maxX: 425, minY: 25,  maxY: 270 },
};

// Returns true when CMX answered for this floor (see processFloorData above).
function processRecData(body, recSet) {
  // If the CMX API returned null skip this floor safely.
  if (!body || !Array.isArray(body)) return false;

  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    if (
      isValidDevice(device) &&
      isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, recSet.bounds)
    ) {
      recSet.devices.add(device.deviceId);
    }
  }

  return true;
}

async function rec_start() {
  const groundSet = { bounds: REC_FLOOR_BOUNDS.ground, devices: new Set() };
  const firstSet  = { bounds: REC_FLOOR_BOUNDS.first,  devices: new Set() };

  let anyFloorOk = false;
  await axiosApi.getRecGroundRequest((body) => {
    if (processRecData(body, groundSet)) anyFloorOk = true;
  });
  await axiosApi.getRecFirstRequest((body) => {
    if (processRecData(body, firstSet)) anyFloorOk = true;
  });

  // Merge unique device IDs across both floors
  const allRec = new Set([...groundSet.devices, ...firstSet.devices]);

  return {
    timeStamp:    new Date(),
    patrons:      allRec.size,   // deduped total (a device on both floors counts once)
    countByFloor: [groundSet.devices.size, firstSet.devices.size],
    ok:           anyFloorOk,    // false = CMX unreachable, do not persist
  };
}

// ---------------------------------------------------------------------------
// Save collected Recreation Center data to PostgreSQL (rec_data table).
// Mirrors saveToDatabase(): 60-second dedup guard + silent-hours skip.
// Stores the RAW patron count; the staff offset is applied at read time.
// ---------------------------------------------------------------------------
async function saveRecToDatabase({ patrons, countByFloor }) {
  try {
    const now = new Date();
    const recDocument = { timeStamp: now, patrons, countByFloor };

    const last = await prisma.recData.findFirst({
      orderBy: { timeStamp: "desc" },
      select:  { timeStamp: true },
    });

    if (!last) {
      await prisma.recData.create({ data: recDocument });
      console.log(`[${dateTime()}] Saved first Rec record to database (${patrons} patrons)`);
      return;
    }

    const timeDiffMs = now.getTime() - last.timeStamp.getTime();

    if (timeDiffMs > 60000) {
      // The Rec opens earlier than King, so its silent window ends at 05:00.
      if (!isSilentHour("rec")) {
        await prisma.recData.create({ data: recDocument });
        console.log(`[${dateTime()}] Saved Rec to database (${patrons} patrons)`);
      } else {
        console.log(
          `[${dateTime()}] Skipping Rec DB write during silent hours ` +
          `(${localParts().hour}:xx, window ${describeWindow("rec")})`
        );
      }
    } else {
      console.log(`[${dateTime()}] Skipping duplicate Rec write (last write was ${Math.round(timeDiffMs / 1000)}s ago)`);
    }
  } catch (err) {
    console.error(`[${dateTime()}] saveRecToDatabase error: ${err.stack}`);
  }
}

// ---------------------------------------------------------------------------
// hourlyMean — the mean of the last four 15-minute RAW rec samples (one hour).
// routes/recapi.js turns this into the published figure; smoothing over an hour
// stops one noisy 15-minute sample from swinging the number the dashboard shows.
//
// Computed here, once per collection cycle, rather than in the route: rec_data
// is authoritative and survives restarts, and doing it here keeps /recapi a
// synchronous memory read instead of a database query on every page view.
//
// Averages over whatever the last hour actually holds (1-4 rows).  Falls back to
// the live sample when there is nothing recent — a fresh database, or the first
// cycle after the silent window, where the previous row is hours old and would
// drag the mean down.
// ---------------------------------------------------------------------------
async function recHourlyMean(fallbackRaw) {
  try {
    const rows = await prisma.recData.findMany({
      where:   { timeStamp: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
      orderBy: { timeStamp: "desc" },
      take:    4,
      select:  { patrons: true },
    });

    if (rows.length === 0) return fallbackRaw;

    return rows.reduce((sum, r) => sum + r.patrons, 0) / rows.length;
  } catch (err) {
    console.error(`[${dateTime()}] recHourlyMean error: ${err.stack}`);
    return fallbackRaw;
  }
}

// ---------------------------------------------------------------------------
// DeviceDataService — 15-minute aligned scheduler
// ---------------------------------------------------------------------------
class DeviceDataService {
  constructor() {
    this.isRunning = false;
    this._timeoutId = null;
  }

  start() {
    if (this.isRunning) {
      console.log(`[${dateTime()}] Device data service already running`);
      return;
    }
    console.log(`[${dateTime()}] Starting device data collection service...`);
    this.isRunning = true;
    this.collectData();        // immediate first run
    this._scheduleNextRun();
  }

  stop() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
    this.isRunning = false;
    console.log(`[${dateTime()}] Device data service stopped`);
  }

  // Schedule the next run aligned to :00, :15, :30, :45 Eastern time.
  _scheduleNextRun() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    const now = new Date();
    const currentMinutes  = now.getMinutes();
    const currentSeconds  = now.getSeconds();
    const currentMs       = now.getMilliseconds();

    const validMinutes    = [0, 15, 30, 45];
    // Fix 1.4: use === undefined instead of falsy check (0 is a valid minute mark)
    let nextValidMinute   = validMinutes.find((m) => m > currentMinutes);
    if (nextValidMinute === undefined) nextValidMinute = 0;  // top of next hour

    let msUntilNext;
    if (nextValidMinute === 0 && currentMinutes >= 45) {
      // Roll over to :00 of the next hour
      msUntilNext =
        (60 - currentMinutes) * 60 * 1000 -
        currentSeconds * 1000 -
        currentMs;
    } else {
      msUntilNext =
        (nextValidMinute - currentMinutes) * 60 * 1000 -
        currentSeconds * 1000 -
        currentMs;
    }

    console.log(
      `[${dateTime()}] Next data collection in ${Math.round(msUntilNext / 1000)}s` +
      ` (at :${String(nextValidMinute).padStart(2, "0")})`
    );

    this._timeoutId = setTimeout(() => {
      this._collectDataWithValidation();
      this._scheduleNextRun();
    }, msUntilNext);
  }

  // Double-check we're at a valid minute mark before firing.
  async _collectDataWithValidation() {
    const currentMinute = new Date().getMinutes();
    if (![0, 15, 30, 45].includes(currentMinute)) {
      console.log(
        `[${dateTime()}] Skipping API call — current minute :${String(currentMinute).padStart(2, "0")} ` +
        `is not a valid interval`
      );
      return;
    }
    console.log(
      `[${dateTime()}] Collecting device data at :${String(currentMinute).padStart(2, "0")}`
    );
    await this.collectData();
  }

  // Collect data from both buildings then refresh the patron cache.
  async collectData() {
    try {
      console.log(`[${dateTime()}] Collecting device data...`);
      await Promise.all([
        king_start(),          // Saves to DB
        rec_start_cached(),    // Caches in memory only
      ]);
      console.log(`[${dateTime()}] Device data collection completed`);

      // Fix 2.3: trigger patron cache refresh immediately after collection
      // so the dashboard reflects the latest counts without waiting for the
      // cache's own timer.
      const patronCache = require("./patronCache");
      patronCache.updateCache();
    } catch (error) {
      console.error(`[${dateTime()}] Error during data collection:`, error);
    }
  }

  getStatus() {
    return {
      isRunning:     this.isRunning,
      lastCollection: dateTime(),
    };
  }
}

// ---------------------------------------------------------------------------
// Recreation center in-memory cache (not persisted to DB — intentional)
// ---------------------------------------------------------------------------
let recDataCache = {
  timeStamp:    null,
  patrons:      0,
  countByFloor: [0, 0],
  hourlyMean:   0,
  lastUpdated:  null,
};

async function rec_start_cached() {
  const data = await rec_start();

  // CMX unreachable (e.g. expired certificate): keep the last known value and
  // do NOT persist, otherwise the table fills up with fake 0-patron readings.
  if (!data.ok) {
    console.error(
      `[${dateTime()}] All Rec CMX requests failed — skipping cache update and DB write`
    );
    return recDataCache;
  }

  // Persist the raw counts to the rec_data table (errors are caught inside
  // saveRecToDatabase).  This runs BEFORE the mean is computed so the sample
  // just taken is part of the hour it averages over.
  await saveRecToDatabase(data);

  recDataCache = {
    ...data,
    hourlyMean:  await recHourlyMean(data.patrons),
    lastUpdated: new Date(),
  };
  return recDataCache;
}

function getRecData() {
  return recDataCache;
}

// Singleton service instance
const deviceDataService = new DeviceDataService();

// Legacy shim for backward compatibility
function restart() {
  deviceDataService.start();
}

module.exports = {
  rec_start,
  rec_start_cached,
  recHourlyMean,
  saveRecToDatabase,
  getRecData,
  restart,
  deviceDataService,
  king_start,
  processFloorData,
  processRecData,
};
