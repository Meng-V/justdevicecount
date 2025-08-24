// Staff accounts are reduced.

const express = require("express");
const { PrismaClient } = require('@prisma/client');
const { dateTime } = require("../modules/deviceUtils");
const router = express.Router();

const prisma = new PrismaClient();

router.get("/", async (req, res) => {
  try {
    console.log(`[${dateTime()}] Count by floor API called`);
    
    // Fetch all device data ordered by timestamp descending
    const countByFloorArray = await prisma.deviceData.findMany({
      orderBy: { timeStamp: 'desc' }
    });

    let floorMap = new Map();
    countByFloorArray.forEach((e) => {
      // Convert timestamp to NY timezone format for consistency
      const nyTimeString = e.timeStamp.toLocaleString("en-US", {
        timeZone: "America/New_York"
      });
      floorMap.set(nyTimeString, e.countByFloor);
    });
    
    const outputArray = Array.from(floorMap, ([time, countByFloor]) => ({ time, countByFloor }));

    res.json({
      floorMap: outputArray,
    });
  } catch (err) {
    console.error("Error in count_by_floor:", err.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
