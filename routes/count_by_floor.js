// count_by_floor — returns per-floor patron counts for all stored records.
// Uses the shared Prisma singleton and selects only the columns needed.

const express = require("express");
const prisma  = require("../modules/prisma");
const { dateTime } = require("../modules/deviceUtils");
const router  = express.Router();

// Match the dashboard window: return at most 30 days of 15-minute intervals.
const MAX_RECORDS = 30 * 24 * 4;

router.get("/", async (req, res) => {
  try {
    console.log(`[${dateTime()}] Count-by-floor API called`);

    const records = await prisma.deviceData.findMany({
      orderBy: { timeStamp: "desc" },
      take:    MAX_RECORDS,
      select:  { timeStamp: true, countByFloor: true },
    });

    // Return oldest-first so clients can render a chronological chart.
    const floorMap = records
      .slice()
      .reverse()
      .map((r) => ({
        time:        r.timeStamp.toLocaleString("en-US", { timeZone: "America/New_York" }),
        countByFloor: r.countByFloor,
      }));

    res.json({ floorMap });
  } catch (err) {
    console.error("Error in count_by_floor:", err.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", (req, res) => res.redirect("/"));

module.exports = router;
