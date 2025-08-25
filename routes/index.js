const express = require("express");
const { PrismaClient } = require('@prisma/client');
const router = express.Router();

const prisma = new PrismaClient();

router.get("/", async (req, res) => {
    // LOCAL-TESTING: When developing in local, use test credentials
    var casUid = process.env.TEST_USER_ID || "testuser";
    var cas_displayName = process.env.TEST_USER_NAME || "Test Developer";

    try {
        // Fetch latest device data from database
        const latestData = await prisma.deviceData.findFirst({
            orderBy: { timeStamp: 'desc' }
        });

        // Fetch recent records for display (last 10)
        const recentData = await prisma.deviceData.findMany({
            orderBy: { timeStamp: 'desc' },
            take: 10,
            select: {
                timeStamp: true,
                patrons: true,
                countByFloor: true
            }
        });

        // Fetch max patrons record
        const maxPatronsData = await prisma.deviceData.findFirst({
            orderBy: { patrons: 'desc' },
            select: {
                timeStamp: true,
                patrons: true
            }
        });

        res.render("index", {
            title: "Crowd Index",
            cas_uid: casUid,
            cas_displayName,
            currentPatrons: latestData?.patrons || 0,
            currentTimestamp: latestData?.timeStamp || null,
            currentCountByFloor: latestData?.countByFloor || [0, 0, 0, 0],
            recentData: recentData,
            maxPatrons: maxPatronsData?.patrons || 0,
            maxPatronsTimestamp: maxPatronsData?.timeStamp || null
        });
    } catch (error) {
        console.error("Error fetching data from database:", error);
        res.render("index", {
            title: "Crowd Index",
            cas_uid: casUid,
            cas_displayName,
            currentPatrons: 0,
            currentTimestamp: null,
            currentCountByFloor: [0, 0, 0, 0],
            recentData: [],
            maxPatrons: 0,
            maxPatronsTimestamp: null,
            error: "Unable to fetch data from database"
        });
    }
}); 

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
