// PatronAPI — returns cached King Library patron data in JSON format.
// The cache is updated immediately after each 15-minute collection cycle and
// also refreshed on a 15-minute background interval as a safety net.

const express = require("express");
const router  = express.Router();
const patronCache = require("../modules/patronCache");

router.get("/", (req, res) => {
  try {
    const cached = patronCache.getCachedData();

    res.json({
      success: true,
      data: {
        patrons:  cached.patrons,
        timeMap:  cached.timeMap,   // [{ time: ISOString, total: number }] — oldest first
        findMax:  cached.findMax,   // { time: ISOString, patrons: number } | null
        lastTen:  cached.lastTen,   // [{ time, patrons, countByFloor }]
      },
      metadata: {
        cached:          true,
        cacheAgeMinutes: cached.cacheAgeMs != null
          ? Math.floor(cached.cacheAgeMs / (1000 * 60))
          : null,
        source:          "King Library Database",
        refreshInterval: "15 minutes",
      },
    });
  } catch (err) {
    console.error("Error serving cached patron data:", err);
    res.status(500).json({
      success: false,
      error:   "Failed to retrieve patron data",
      message: err.message,
    });
  }
});

router.post("/", (req, res) => res.redirect("/"));

module.exports = router;
