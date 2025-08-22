// RecAPI is now used as the couting source to the Rec Crowd Index.
// Staff accounts are reduced.

const express = require("express");
const router = express.Router();
const coreModule = require("../modules/app_core");

router.get("/", async (req, res) => {
    try {
        const data = await coreModule.rec_start();
        res.json({
            timeStamp: data.timeStamp,
            patronCount: data.patrons,
        });
    } catch (error) {
        console.error("Error fetching data in recapi.js file: ", error);
        res.status(500).json({ error: "Internal Server Error. Check with Rec" });
    }
});

router.post("/", (req, res) => {
    res.redirect("/");
});

module.exports = router;
