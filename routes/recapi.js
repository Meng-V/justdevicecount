// RecAPI — returns live recreation-center patron count.
// The count is kept in memory only (not persisted to the database).
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

    // Subtract the baseline offset; Math.abs prevents negative counts from
    // surfacing when the building is nearly empty.
    const adjustedPatrons = Math.abs(data.patrons - STAFF_OFFSET);

    res.json({
      success: true,
      data: {
        timeStamp: data.timeStamp,
        patrons:   adjustedPatrons,
      },
      metadata: {
        cached:          true,
        lastUpdated:     data.lastUpdated,
        source:          "Recreation Center Memory Cache",
        refreshInterval: "15 minutes",
        staffOffset:     STAFF_OFFSET,
        note:            "This data is not stored in the database",
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
