// PatronAPI is now used as the couting source to the Crowd Index.
// Updated to use cached data instead of direct DB access

const express = require("express");
const router = express.Router();
const patronCache = require("../modules/patronCache");

router.get("/", async (req, res) => {
  try {
    // Get cached data instead of querying database
    const cachedData = patronCache.getCachedData();
    
    // Add cache metadata for debugging/monitoring
    const response = {
      ...cachedData,
      cached: true,
      cacheAgeMinutes: cachedData.cacheAge ? Math.floor(cachedData.cacheAge / (1000 * 60)) : null
    };
    
    // Remove internal cache metadata before sending to client
    delete response.lastUpdated;
    delete response.cacheAge;
    
    res.json(response);
  } catch (err) {
    console.error("Error serving cached patron data:", err);
    res.status(500).json({ error: "Failed to retrieve patron data" });
  }
});

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
