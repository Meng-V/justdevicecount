// RecAPI is now used as the counting source to the Recreation Center Crowd Index.
// Returns cached recreation data (in-memory only, not from database)

const express = require("express");
const router = express.Router();
const { getRecData } = require("../modules/app_core");

router.get("/", async (req, res) => {
    try {
        // Get cached recreation data (not from database)
        const data = getRecData();
        
        // Format response for API consumers
        const response = {
            success: true,
            data: {
                timeStamp: data.timeStamp,
                patrons: data.patrons
            },
            metadata: {
                cached: true,
                lastUpdated: data.lastUpdated,
                source: "Recreation Center Memory Cache",
                refreshInterval: "15 minutes",
                note: "This data is not stored in database"
            }
        };
        
        res.json(response);
    } catch (error) {
        console.error("Error fetching recreation data:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to retrieve recreation data",
            message: error.message 
        });
    }
});

router.post("/", (req, res) => {
    res.redirect("/");
});

module.exports = router;
