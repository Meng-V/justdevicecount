// PatronAPI is now used as the counting source to the Crowd Index.
// Returns cached King Library data from database in JSON format

const express = require("express");
const router = express.Router();
const patronCache = require("../modules/patronCache");

router.get("/", async (req, res) => {
  try {
    // Get cached data from patron cache (King Library data from DB)
    const cachedData = patronCache.getCachedData();
    
    // Format response for API consumers
    const response = {
      success: true,
      data: {
        patrons: cachedData.patrons,
        timeMap: cachedData.timeMap,
        findMax: cachedData.findMax,
        lastTen: cachedData.lastTen
      },
      metadata: {
        cached: true,
        cacheAgeMinutes: cachedData.cacheAge ? Math.floor(cachedData.cacheAge / (1000 * 60)) : null,
        source: "King Library Database",
        refreshInterval: "15 minutes"
      }
    };
    
    res.json(response);
  } catch (err) {
    console.error("Error serving cached patron data:", err);
    res.status(500).json({ 
      success: false,
      error: "Failed to retrieve patron data",
      message: err.message 
    });
  }
});

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
