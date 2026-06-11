const prisma = require("./prisma");
const axiosApi = require("./axiosApi");
const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require("./deviceUtils");

// ---------------------------------------------------------------------------
// Generic floor processing function.
// All Maps/Sets are created locally inside each king_start() call (fixes the
// module-level race condition — issue 1.2).
// ---------------------------------------------------------------------------
function processFloorData(body, userMap, bounds) {
  // If the CMX API returned null (all retries failed) skip this floor safely.
  if (!body || !Array.isArray(body)) return;

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

  await axiosApi.getGroundRequest((body) => {
    processFloorData(body, uniqUserGround, KING_FLOOR_BOUNDS.ground);
    uniqUserGround.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getFirstRequest((body) => {
    processFloorData(body, uniqUserFirst, KING_FLOOR_BOUNDS.first);
    uniqUserFirst.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getSecondRequest((body) => {
    processFloorData(body, uniqUserSecond, KING_FLOOR_BOUNDS.second);
    uniqUserSecond.forEach((_, key) => uniqKingAll.add(key));
  });

  await axiosApi.getThirdRequest((body) => {
    processFloorData(body, uniqUserThird, KING_FLOOR_BOUNDS.third);
    uniqUserThird.forEach((_, key) => uniqKingAll.add(key));
  });

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
      // Skip silent hours (2 AM – 6 AM Eastern) to avoid noise in overnight data.
      const currentHour = new Date(
        new Date().toLocaleString("en-US", { timeZone: "America/New_York" })
      ).getHours();

      if (currentHour < 2 || currentHour > 6) {
        await prisma.deviceData.create({ data: floorDocument });
        console.log(`[${dateTime()}] Saved to database (${uniqKingAll.size} patrons)`);
      } else {
        console.log(`[${dateTime()}] Skipping DB write during silent hours (${currentHour}:xx)`);
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

function processRecData(body, recSet) {
  // If the CMX API returned null skip this floor safely.
  if (!body || !Array.isArray(body)) return;

  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    if (
      isValidDevice(device) &&
      isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, recSet.bounds)
    ) {
      recSet.devices.add(device.deviceId);
    }
  }
}

async function rec_start() {
  const groundSet = { bounds: REC_FLOOR_BOUNDS.ground, devices: new Set() };
  const firstSet  = { bounds: REC_FLOOR_BOUNDS.first,  devices: new Set() };

  await axiosApi.getRecGroundRequest((body) => processRecData(body, groundSet));
  await axiosApi.getRecFirstRequest((body)  => processRecData(body, firstSet));

  // Merge unique device IDs across both floors
  const allRec = new Set([...groundSet.devices, ...firstSet.devices]);

  return {
    timeStamp: new Date(),
    patrons:   allRec.size,
  };
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
  timeStamp:   null,
  patrons:     0,
  lastUpdated: null,
};

async function rec_start_cached() {
  const data = await rec_start();
  recDataCache = {
    ...data,
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
  getRecData,
  restart,
  deviceDataService,
  king_start,
  processFloorData,
  processRecData,
};
