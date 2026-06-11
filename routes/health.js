// Health check endpoint — GET /crowdindex/health
// Returns application and database status.  Used by systemd, load balancers,
// and monitoring scripts to verify the service is alive and connected.

const express = require("express");
const prisma  = require("../modules/prisma");
const router  = express.Router();

router.get("/", async (req, res) => {
  let dbConnected    = false;
  let dbLatencyMs    = null;
  let dbError        = null;
  let lastCollection = null;

  // DB ping
  try {
    const t0 = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs  = Date.now() - t0;
    dbConnected  = true;

    // Fetch timestamp of the most recent record as a proxy for collection health
    const latest = await prisma.deviceData.findFirst({
      orderBy: { timeStamp: "desc" },
      select:  { timeStamp: true },
    });
    lastCollection = latest?.timeStamp ?? null;
  } catch (err) {
    dbError = err.message;
  }

  const { deviceDataService } = require("../modules/app_core");
  const serviceStatus = deviceDataService.getStatus();

  const status  = dbConnected ? "ok" : "degraded";
  const httpCode = dbConnected ? 200  : 503;

  res.status(httpCode).json({
    status,
    timestamp:      new Date().toISOString(),
    database: {
      connected:  dbConnected,
      latencyMs:  dbLatencyMs,
      error:      dbError,
    },
    collectionService: {
      isRunning:     serviceStatus.isRunning,
      lastCollection: lastCollection,
    },
  });
});

module.exports = router;
