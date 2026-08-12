// RecAPI — returns live recreation-center patron count.
// The live count is served from an in-memory cache; the raw counts are also
// persisted every collection cycle to the rec_data table (see app_core.js).
// An offset of 15 (Wi-Fi baseline / staff devices) is subtracted, configured
// in config/default.json under rec.staffOffset.

const express = require("express");
const config  = require("config");
const router  = express.Router();
const { getRecData } = require("../modules/app_core");

// Staff / baseline offset — devices that are always connected and should not
// be counted as patrons.  Configured in config/default.json: rec.staffOffset
const STAFF_OFFSET = config.has("rec.staffOffset") ? config.get("rec.staffOffset") : 15;

router.get("/", (req, res) => {
  try {
    const data = getRecData();

    const BASELINE = config.has("rec.baselineDevices") ? config.get("rec.baselineDevices") : 10;
    const SCALE = config.has("rec.devicesToPatrons") ? config.get("rec.devicesToPatrons") : 1.2; 
    const GF_GATE  = config.has("rec.groundFirstGate") ? config.get("rec.groundFirstGate") : 1.0;  // 1.0  — ground/first sanity limit
    
    // hourlyMean = mean of the last four 15-minute patrons_raw samples
    const adjustedPatrons = Math.max(0, Math.round(SCALE * (hourlyMean - BASELINE)));

    // Quality gate: on 4 of 5 observed days ground/first is 0.58-0.73; on 2026-08-10 it was
    // 1.71 and the formula over-counted by +9 on average.  Do not silently serve those hours.
    const groundFirstRatio = ground / Math.max(first, 1);
    const degraded = groundFirstRatio > GF_GATE;

    res.json({
      success: true,
      data: {
        timeStamp:    data.timeStamp,
        patrons:      adjustedPatrons,
        countByFloor: data.countByFloor ?? [0, 0],  // [ground, first], raw (no offset)
      },
      metadata: {
        cached:          true,
        lastUpdated:     data.lastUpdated,
        source:          "Recreation Center Memory Cache",
        refreshInterval: "15 minutes",
        staffOffset:     STAFF_OFFSET,
        note:            "Live count served from memory; raw counts are also persisted to the rec_data table",
      },
    });
  } catch (error) {
    console.error("Error fetching recreation data:", error);
    res.status(500).json({
      success: false,
      error:   "Failed to retrieve recreation data",
      message: error.message,
    });
  }
});

router.post("/", (req, res) => res.redirect("/"));

module.exports = router;
