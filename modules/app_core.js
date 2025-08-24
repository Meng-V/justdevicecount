const config = require("config");
const { PrismaClient } = require('@prisma/client');
const axiosApi = require("./axiosApi");
const { dateTime, validRssi, validTime, isValidDevice, isWithinBounds } = require("./deviceUtils");

const prisma = new PrismaClient();


// Generic floor processing function
function processFloorData(body, userMap, bounds) {
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

let uniqUserGround = new Map();
let uniqUserFirst = new Map();
let uniqUserSecond = new Map();
let uniqUserThird = new Map();

let uniqKingAll = new Set();
let rec_uniqRecAll = new Set();

function king_resetALLarray() {
  uniqUserGround = new Map();
  uniqUserFirst = new Map();
  uniqUserSecond = new Map();
  uniqUserThird = new Map();
  uniqKingAll = new Set();
}

async function king_start() {
  king_resetALLarray();

  // Define floor boundaries
  const floorBounds = {
    ground: { minX: 10, maxX: 314, minY: 36, maxY: 190 },
    first: { minX: 16, maxX: 314, minY: 29, maxY: 190 },
    second: { minX: 10, maxX: 314, minY: 36, maxY: 190 },
    third: { minX: 10, maxX: 314, minY: 36, maxY: 190 }
  };

  // Process each floor
  await axiosApi.getGroundRequest((body) => {
    processFloorData(body, uniqUserGround, floorBounds.ground);
    uniqUserGround.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getFirstRequest((body) => {
    processFloorData(body, uniqUserFirst, floorBounds.first);
    uniqUserFirst.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getSecondRequest((body) => {
    processFloorData(body, uniqUserSecond, floorBounds.second);
    uniqUserSecond.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getThirdRequest((body) => {
    processFloorData(body, uniqUserThird, floorBounds.third);
    uniqUserThird.forEach((value, key) => uniqKingAll.add(key));
  });

  await saveToDatabase();
}

// Helper: Database connection and save logic
async function saveToDatabase() {
  const isServer = global.onServer;
  console.log(`[${dateTime()}] global on server? ${isServer}`);

  try {
    console.log(`[${dateTime()}] App Core connected to database`);

    const floorDocument = {
      timeStamp: dateTime(),
      uniqUserTotal: Array.from(uniqKingAll),
      uniqUserGround: Object.fromEntries(uniqUserGround),
      uniqUserFirst: Object.fromEntries(uniqUserFirst),
      uniqUserSecond: Object.fromEntries(uniqUserSecond),
      uniqUserThird: Object.fromEntries(uniqUserThird),
      patrons: uniqKingAll.size,
      countByFloor: [
        uniqUserGround.size,
        uniqUserFirst.size,
        uniqUserSecond.size,
        uniqUserThird.size,
      ],
    };

    // Avoid time entry redundancy caused by Chrome
    const checkDBTime = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: 'desc' }
    });
    
    if (!checkDBTime) {
      await prisma.deviceData.create({ data: floorDocument });
    } else {
      const timeDiff = Date.parse(floorDocument.timeStamp) - Date.parse(checkDBTime.timeStamp);
      console.log(`[${dateTime()}] time diff: ${timeDiff}`);
      
      if (timeDiff > 30000) {
        // Get current hour in NY timezone
        const nyTime = new Date().toLocaleString("en-US", {
          timeZone: "America/New_York"
        });
        const currentHour = new Date(nyTime).getHours();
        if ((currentHour < 2 || currentHour > 6) && isServer) {
          await prisma.deviceData.create({ data: floorDocument });
        }
      }
    }
  } catch (err) {
    console.log(`[${dateTime()}] Error: ${err.stack}`);
  }
}

// Helper: Process recreation center data
function rec_resetALLarray() {
  rec_uniqRecAll = new Set();
}

function processRecData(body, bounds) {
  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    const deviceId = device.deviceId;
    
    if (isValidDevice(device) && 
        isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, bounds)) {
      rec_uniqRecAll.add(deviceId);
    }
  }
}

async function rec_start() {
  rec_resetALLarray();

  // Define recreation center boundaries
  const recBounds = {
    ground: { minX: 10, maxX: 300, minY: 20, maxY: 214 },
    first: { minX: 190, maxX: 425, minY: 25, maxY: 270 }
  };

  // Process recreation center floors
  await axiosApi.getRecGroundRequest((body) => {
    processRecData(body, recBounds.ground);
  });

  await axiosApi.getRecFirstRequest((body) => {
    processRecData(body, recBounds.first);
  });

  return {
    timeStamp: dateTime(),
    patrons: rec_uniqRecAll.size,
  };
}

// Service class for managing device data collection
class DeviceDataService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
  }

  // Start the service with proper Express app lifecycle integration
  start() {
    if (this.isRunning) {
      console.log(`[${dateTime()}] Device data service already running`);
      return;
    }

    console.log(`[${dateTime()}] Starting device data collection service...`);
    this.isRunning = true;

    // Run initial collection
    this.collectData();

    // Schedule to run every 15 minutes aligned to :00, :15, :30, :45
    this.scheduleNextRun();
  }

  // Stop the service gracefully
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log(`[${dateTime()}] Device data service stopped`);
  }

  // Schedule next run aligned to 15-minute intervals (:00, :15, :30, :45)
  scheduleNextRun() {
    // Clear any existing interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Use NY timezone for scheduling
    const nyTimeString = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York"
    });
    const now = new Date(nyTimeString);
    const currentMinutes = now.getMinutes();
    
    // Find next valid minute mark (:00, :15, :30, :45)
    const validMinutes = [0, 15, 30, 45];
    let nextValidMinute = validMinutes.find(minute => minute > currentMinutes);
    
    // If no valid minute found in current hour, use :00 of next hour
    if (!nextValidMinute) {
      nextValidMinute = 0;
    }
    
    // Calculate milliseconds until next valid time
    let msUntilNext;
    if (nextValidMinute === 0 && currentMinutes >= 45) {
      // Next hour at :00
      msUntilNext = (60 - currentMinutes) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
    } else {
      // Same hour at next valid minute
      msUntilNext = (nextValidMinute - currentMinutes) * 60 * 1000 - now.getSeconds() * 1000 - now.getMilliseconds();
    }

    console.log(`Next data collection in ${Math.round(msUntilNext / 1000)} seconds (at :${nextValidMinute.toString().padStart(2, '0')})`);

    setTimeout(() => {
      this.collectDataWithValidation();
      // Schedule the next run recursively to maintain alignment
      this.scheduleNextRun();
    }, msUntilNext);
  }

  // Enhanced collectData with minute validation
  async collectDataWithValidation() {
    // Double-check that we're at a valid minute mark in NY timezone
    const nyTimeString = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York"
    });
    const now = new Date(nyTimeString);
    const currentMinute = now.getMinutes();
    
    // Only proceed if we're at :00, :15, :30, or :45
    if (![0, 15, 30, 45].includes(currentMinute)) {
      console.log(`[${dateTime()}] Skipping API call - current minute is :${currentMinute.toString().padStart(2, '0')}, not at valid interval`);
      return;
    }

    console.log(`[${dateTime()}] Collecting device data at valid minute mark :${currentMinute.toString().padStart(2, '0')}`);
    await this.collectData();
  }

  // Collect data from both king and recreation center
  async collectData() {
    try {
      console.log("Collecting device data...");
      await Promise.all([
        king_start(),        // Saves to database via Prisma
        rec_start_cached()   // Caches in memory only
      ]);
      console.log("Device data collection completed");
    } catch (error) {
      console.error("Error during data collection:", error);
    }
  }

  // Get current status
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastCollection: dateTime()
    };
  }
}

// Create singleton instance
const deviceDataService = new DeviceDataService();

// Cache for recreation data (in-memory only, not saved to DB)
let recDataCache = {
  timeStamp: null,
  patrons: 0,
  lastUpdated: null
};

// Enhanced rec_start to cache data in memory
async function rec_start_cached() {
  const data = await rec_start();
  recDataCache = {
    ...data,
    lastUpdated: dateTime()
  };
  return recDataCache;
}

// Get cached recreation data
function getRecData() {
  return recDataCache;
}

// Legacy function for backward compatibility
function restart() {
  deviceDataService.start();
}

module.exports = {
  rec_start,
  rec_start_cached,
  getRecData,
  restart,
  deviceDataService,
  // Export individual functions for API use
  king_start,
  processFloorData,
  processRecData
};
