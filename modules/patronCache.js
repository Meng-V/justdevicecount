const prisma = require("./prisma");
const { dateTime } = require("./deviceUtils");

// 30 days × 24 hours × 4 intervals/hour = 2 880 records maximum.
// Keeping only the most recent 30 days protects DB query performance and
// memory usage as the dataset grows.
const MAX_RECORDS = 30 * 24 * 4;

class PatronCache {
  constructor() {
    this.cachedData = {
      patrons:     0,
      timeMap:     [],   // [{ time: ISOString, total: number }]  — raw data, no HTML
      findMax:     null, // { time: ISOString, patrons: number }
      lastTen:     [],   // [{ time: ISOString, patrons: number, countByFloor: number[] }]
      lastUpdated: null,
    };
    this.isUpdating    = false;
    this.updateInterval = null;
  }

  // Start background refresh.  The interval is intentionally kept as a
  // safety net; the primary trigger is now DeviceDataService.collectData()
  // calling updateCache() immediately after each collection cycle (fix 2.3).
  startCacheUpdater() {
    this.updateCache();
    this.updateInterval = setInterval(() => this.updateCache(), 15 * 60 * 1000);
    console.log(`[${dateTime()}] Patron cache updater started`);
  }

  stopCacheUpdater() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log(`[${dateTime()}] Patron cache updater stopped`);
    }
  }

  // Return cached data plus how old the cache is.
  getCachedData() {
    return {
      ...this.cachedData,
      cacheAgeMs: this.cachedData.lastUpdated
        ? Date.now() - this.cachedData.lastUpdated
        : null,
    };
  }

  // Refresh cache — skips if an update is already in progress.
  async updateCache() {
    if (this.isUpdating) {
      console.log(`[${dateTime()}] Cache update already in progress, skipping`);
      return;
    }
    this.isUpdating = true;
    console.log(`[${dateTime()}] Updating patron cache...`);
    try {
      const data = await this._fetchFromDatabase();
      this.cachedData = { ...data, lastUpdated: Date.now() };
      console.log(`[${dateTime()}] Cache updated (${data.timeMap.length} data points)`);
    } catch (error) {
      console.error(`[${dateTime()}] Failed to update patron cache:`, error);
    } finally {
      this.isUpdating = false;
    }
  }

  async _fetchFromDatabase() {
    // Fetch only the columns actually needed — skip large JSON blobs
    // (uniqUserGround, uniqUserFirst, etc.) to keep queries fast.
    const records = await prisma.deviceData.findMany({
      orderBy: { timeStamp: "desc" },
      take:    MAX_RECORDS,
      select:  { timeStamp: true, patrons: true, countByFloor: true },
    });

    // Most recent patron count
    const patrons = records[0]?.patrons ?? 0;

    // Full time-series for charts (oldest → newest for chart rendering)
    const timeMap = records
      .slice()
      .reverse()
      .map((r) => ({ time: r.timeStamp.toISOString(), total: r.patrons }));

    // All-time peak (separate lightweight query)
    const peakRecord = await prisma.deviceData.findFirst({
      orderBy: { patrons: "desc" },
      select:  { timeStamp: true, patrons: true },
    });
    const findMax = peakRecord
      ? { time: peakRecord.timeStamp.toISOString(), patrons: peakRecord.patrons }
      : null;

    // Last 10 records for the recent-data table (raw objects, no HTML)
    const lastTen = records.slice(0, 10).map((r) => ({
      time:        r.timeStamp.toISOString(),
      patrons:     r.patrons,
      countByFloor: r.countByFloor ?? [],
    }));

    return { patrons, timeMap, findMax, lastTen };
  }

  // Force an immediate refresh (useful for manual triggers / health checks).
  async forceUpdate() {
    await this.updateCache();
    return this.getCachedData();
  }
}

// Singleton
const patronCache = new PatronCache();
module.exports = patronCache;
