// PatronAPI is now used as the couting source to the Crowd Index.
// Staff accounts are reduced.

const express = require("express");
const config = require("config");
const path = require("path");
const router = express.Router();

const { MongoClient } = require("mongodb");

router.get("/", async (req, res) => {
  let inputArray = [];
  let outputArray = [];
  let findMaxArray = [];
  let lastTenOutput = [];

  async function connect() {
    let uri = "";
    let client = "";

    if (global.onServer) {
      console.log("global onServer true? " + global.onServer);
      uri = config.get("database.servr-connection");
      // uri = config.get("database.mongo-atlas");
      client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        sslValidate: true,
        sslCA: [
          path.join(__dirname, "..", "certs", "global-bundle.pem"),
        ],
      });
    } else {
      // LOCAL-TESTING
      uri = config.get("database.local-connection");
      client = new MongoClient(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        sslValidate: true,
        sslCA: [
          path.join(__dirname, "..", "certs", "global-bundle.pem"),
        ],
        rejectUnauthorized: false,
      });
    }

    let timeMap = new Map();
    const dbName = config.get("database.name");
    try {
      let lastTenArray = [];

      await client.connect();
      console.log("Patronapi connected to server");
      const db = client.db(dbName);
      const col = db.collection(config.get("database.collection"));

      const findQuery = {
        // 'timeStamp': {$regex: "9/15/2021"}
        // 'patrons' : {$gt: 300}
      };

      //  To avoid the time entry redudancy caused by Chrome
      inputArray = await col
        .find(findQuery || {})
        .sort({ _id: -1 })
        .toArray();
      findMaxArray = await col.find().sort({ patrons: -1 }).limit(1).toArray(); // for max
      lastTenArray = await col
        .find({})
        .sort({ _id: -1 })
        .limit(10)
        .forEach((e) => {
          lastTenOutput.push(
            "<li class='me-5'>" + e.timeStamp + "  " + e.patrons + "</li>"
          );
        }); // To display the last ten docs
      // fetchPatronCount = fetchArray[0].patrons;
      // console.log(fetchPatronCount);

      await inputArray.forEach((e) => {
        timeMap.set(e.timeStamp, e.patrons);
      });
      outputArray = Array.from(timeMap, ([time, total]) => ({ time, total }));
      // console.log(timeMap.entries());
    } catch (err) {
      console.log(err.stack);
    } finally {
      await client.close();

      res.json({
        patrons: inputArray[0].patrons,
        timeMap: outputArray,
        findMax: [findMaxArray[0].timeStamp, "  ", findMaxArray[0].patrons],
        lastTen: lastTenOutput,
      });
    }
  }
  connect();
});

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
