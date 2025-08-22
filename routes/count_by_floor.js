// Staff accounts are reduced.

const express = require("express");
const config = require("config");
const path = require("path");
const router = express.Router();

const { MongoClient } = require("mongodb");

router.get("/", async (req, res) => {
  let countByFloorArray = [];
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

    let floorMap = new Map();
    const dbName = config.get("database.name");
    try {

      await client.connect();
      console.log("Patronapi connected to server");
      const db = client.db(dbName);
      const col = db.collection(config.get("database.collection"));

      countByFloorArray = await col.find({}).sort({_id:-1}).toArray();

      await countByFloorArray.forEach((e) => {
        floorMap.set(e.timeStamp, e.countByFloor);
      });
      outputArray = Array.from(floorMap, ([time, countByFloor]) => ({ time, countByFloor }));
      // console.log(timeMap.entries());
    } catch (err) {
      console.log(err.stack);
    } finally {
      await client.close();

      res.json({
        floorMap: outputArray,
      });
    }
  }
  connect();
});

router.post("/", (req, res) => {
  res.redirect("/");
});

module.exports = router;
