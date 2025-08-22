const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
    // LOCAL-TESTING: When developing in local, command the following line.
    var casUid = "qum";
    var cas_displayName = "Meng Qu the developer";

    res.render("index", {
      title: "Crowd Index",
      cas_uid: casUid,
      cas_displayName,      
    });
}); 

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
