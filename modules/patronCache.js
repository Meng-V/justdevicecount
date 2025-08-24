const { PrismaClient } = require("@prisma/client");
const config = require("config");
const { dateTime } = require("./deviceUtils");

const prisma = new PrismaClient();

class PatronCache {
  constructor() {
    this.cachedData = {
      patrons: 0,
      timeMap: [],
      findMax: [],
      lastTen: [],
      lastUpdated: null,
    };
    this.isUpdating = false;
    this.updateInterval = null;
  }

  // Start the background job to update cache every 15 minutes
  startCacheUpdater() {
    // Initial fetch
    this.updateCache();

    // Set interval for every 15 minutes (900,000 milliseconds)
    this.updateInterval = setInterval(() => {
      this.updateCache();
    }, 15 * 60 * 1000);

    console.log(`[${dateTime()}] Patron cache updater started - will refresh every 15 minutes`);
  }

  // Stop the background job
  stopCacheUpdater() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log(`[${dateTime()}] Patron cache updater stopped`);
    }
  }

  // Get cached data
  getCachedData() {
    return {
      ...this.cachedData,
      cacheAge: this.cachedData.lastUpdated
        ? Date.now() - this.cachedData.lastUpdated
        : null,
    };
  }

  // Update cache by fetching from database
  async updateCache() {
    if (this.isUpdating) {
      console.log(`[${dateTime()}] Cache update already in progress, skipping...`);
      return;
    }

    this.isUpdating = true;
    console.log(`[${dateTime()}] Updating patron cache...`);

    try {
      const data = await this.fetchFromDatabase();
      this.cachedData = {
        ...data,
        lastUpdated: Date.now(),
      };
      console.log(`[${dateTime()}] Cache updated successfully`);
    } catch (error) {
      console.error(`[${dateTime()}] Failed to update cache:`, error);
    } finally {
      this.isUpdating = false;
    }
  }

  // Database connection and data fetching logic
  async fetchFromDatabase() {
    let outputArray = [];
    let lastTenOutput = [];

    try {
      console.log(`[${dateTime()}] Cache updater connected to database`);

      // Fetch all data ordered by timestamp descending
      const inputArray = await prisma.deviceData.findMany({
        orderBy: { timeStamp: "desc" },
      });

      // Find max patrons record
      const findMaxArray = await prisma.deviceData.findMany({
        orderBy: { patrons: "desc" },
        take: 1,
      });

      // Get last 10 records
      const lastTenRecords = await prisma.deviceData.findMany({
        orderBy: { timeStamp: "desc" },
        take: 10,
      });

      lastTenRecords.forEach((e) => {
        lastTenOutput.push(
          "<li class='me-5'>" +
            e.timeStamp.toISOString() +
            "  " +
            e.patrons +
            "</li>"
        );
      });

      let timeMap = new Map();
      inputArray.forEach((e) => {
        timeMap.set(e.timeStamp.toISOString(), e.patrons);
      });
      outputArray = Array.from(timeMap, ([time, total]) => ({ time, total }));

      return {
        patrons: inputArray[0]?.patrons || 0,
        timeMap: outputArray,
        findMax: findMaxArray[0]
          ? [
              findMaxArray[0].timeStamp.toISOString(),
              "  ",
              findMaxArray[0].patrons,
            ]
          : [],
        lastTen: lastTenOutput,
      };
    } catch (error) {
      console.error("Database fetch error:", error);
      throw error;
    }
  }

  // Force an immediate cache update (useful for manual refresh)
  async forceUpdate() {
    await this.updateCache();
    return this.getCachedData();
  }
}

// Create singleton instance
const patronCache = new PatronCache();

module.exports = patronCache;
