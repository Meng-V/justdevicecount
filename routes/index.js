// Dashboard home page — renders index.ejs with the latest data from the DB.
// Uses the shared Prisma singleton and requests only the columns it needs.

const express = require("express");
const prisma  = require("../modules/prisma");
const router  = express.Router();

router.get("/", async (req, res) => {
  // CAS auth not implemented in this build — use env vars for the user badge.
  const casUid         = process.env.TEST_USER_ID   || "staff";
  const cas_displayName = process.env.TEST_USER_NAME || "Staff";

  try {
    // Latest record for the live counters
    const latestData = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: "desc" },
      select:  { timeStamp: true, patrons: true, countByFloor: true },
    });

    // Last 10 records for the recent-data table
    const recentData = await prisma.deviceData.findMany({
      orderBy: { timeStamp: "desc" },
      take:    10,
      select:  { timeStamp: true, patrons: true, countByFloor: true },
    });

    // All-time peak
    const maxPatronsData = await prisma.deviceData.findFirst({
      orderBy: { patrons: "desc" },
      select:  { timeStamp: true, patrons: true },
    });

    res.render("index", {
      title:                "Crowd Index",
      cas_uid:              casUid,
      cas_displayName,
      currentPatrons:       latestData?.patrons        ?? 0,
      currentTimestamp:     latestData?.timeStamp      ?? null,
      currentCountByFloor:  latestData?.countByFloor   ?? [0, 0, 0, 0],
      recentData:           recentData,
      maxPatrons:           maxPatronsData?.patrons     ?? 0,
      maxPatronsTimestamp:  maxPatronsData?.timeStamp   ?? null,
    });
  } catch (error) {
    console.error("Error fetching data for dashboard:", error);
    res.render("index", {
      title:                "Crowd Index",
      cas_uid:              casUid,
      cas_displayName,
      currentPatrons:       0,
      currentTimestamp:     null,
      currentCountByFloor:  [0, 0, 0, 0],
      recentData:           [],
      maxPatrons:           0,
      maxPatronsTimestamp:  null,
      error:                "Unable to fetch data from database",
    });
  }
});

router.post("/", (req, res) => res.redirect("/"));

module.exports = router;
