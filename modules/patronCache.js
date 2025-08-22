const { MongoClient } = require("mongodb");
const config = require("config");
const path = require("path");

class PatronCache {
  constructor() {
    this.cachedData = {
      patrons: 0,
      timeMap: [],
      findMax: [],
      lastTen: [],
      lastUpdated: null
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
    
    console.log("Patron cache updater started - will refresh every 15 minutes");
  }

  // Stop the background job
  stopCacheUpdater() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
      console.log("Patron cache updater stopped");
    }
  }

  // Get cached data
  getCachedData() {
    return {
      ...this.cachedData,
      cacheAge: this.cachedData.lastUpdated ? 
        Date.now() - this.cachedData.lastUpdated : null
    };
  }

  // Update cache by fetching from database
  async updateCache() {
    if (this.isUpdating) {
      console.log("Cache update already in progress, skipping...");
      return;
    }

    this.isUpdating = true;
    console.log("Updating patron cache...");

    try {
      const data = await this.fetchFromDatabase();
      this.cachedData = {
        ...data,
        lastUpdated: Date.now()
      };
      console.log(`Cache updated successfully at ${new Date().toISOString()}`);
    } catch (error) {
      console.error("Failed to update cache:", error);
    } finally {
      this.isUpdating = false;
    }
  }

  // Database connection and data fetching logic
  async fetchFromDatabase() {
    let inputArray = [];
    let outputArray = [];
    let findMaxArray = [];
    let lastTenOutput = [];
    let uri = "";
    let client = "";

    if (global.onServer) {
      uri = config.get("database.servr-connection");
      client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        sslValidate: true,
        sslCA: [
          path.join(__dirname, "..", "certs", "global-bundle.pem"),
        ],
      });
    } else {
      // LOCAL-TESTING
      uri = config.get("database.local-connection");
      client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        sslValidate: true,
        sslCA: [
          path.join(__dirname, "..", "certs", "global-bundle.pem"),
        ],
        rejectUnauthorized: false,
      });
    }

    let timeMap = new Map();
    const dbName = config.get("database.name");

    try {
      await client.connect();
      console.log("Cache updater connected to database");
      const db = client.db(dbName);
      const col = db.collection(config.get("database.collection"));

      const findQuery = {};

      // Fetch all data
      inputArray = await col
        .find(findQuery)
        .sort({ _id: -1 })
        .toArray();
      
      findMaxArray = await col.find().sort({ patrons: -1 }).limit(1).toArray();
      
      await col
        .find({})
        .sort({ _id: -1 })
        .limit(10)
        .forEach((e) => {
          lastTenOutput.push(
            "<li class='me-5'>" + e.timeStamp + "  " + e.patrons + "</li>"
          );
        });

      await inputArray.forEach((e) => {
        timeMap.set(e.timeStamp, e.patrons);
      });
      outputArray = Array.from(timeMap, ([time, total]) => ({ time, total }));

      return {
        patrons: inputArray[0]?.patrons || 0,
        timeMap: outputArray,
        findMax: findMaxArray[0] ? 
          [findMaxArray[0].timeStamp, "  ", findMaxArray[0].patrons] : [],
        lastTen: lastTenOutput,
      };

    } finally {
      await client.close();
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
