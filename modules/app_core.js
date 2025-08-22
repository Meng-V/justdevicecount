const config = require("config");
const path = require("path");
const { MongoClient } = require("mongodb");
const axiosApi = require("./axiosApi");

// Helper: Time to local time zone
function dateTime() {
  const today = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  return today;
}

// Helper method: To get rid of weak rssi devices
function validRssi(parseRssi) {
  var rssiValue = parseInt(parseRssi);
  if (rssiValue !== NaN) {
    if (rssiValue >= -70 && rssiValue < -1) {
      return true;
    }
  }
}

// Helper method: remove devices last seen longer than 30 minutes
function validTime(serverTime, lastSeenTime) {
  const serverT = new Date(serverTime);
  const lastSeenT = new Date(lastSeenTime);
  const timeDifferenceMs = serverT - lastSeenT;
  return timeDifferenceMs < 30 * 60 * 1000;
}

// Helper: Validate device data
function isValidDevice(device) {
  const uName = device.username.toLowerCase();
  return (
    validRssi(device.maxDetectedRssi.rssi) &&
    validTime(device.statistics.currentServerTime, device.lastSeen) &&
    !device.guestUser &&
    !device.ssid.toLowerCase().includes("visitor") &&
    !device.ssid.toLowerCase().includes("gaming")
  );
}

// Helper: Check if coordinates are within bounds
function isWithinBounds(x, y, bounds) {
  return (
    x >= bounds.minX &&
    x <= bounds.maxX &&
    y >= bounds.minY &&
    y <= bounds.maxY
  );
}

// Generic floor processing function
function processFloorData(body, userMap, bounds) {
  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    const uName = device.username.toLowerCase();
    
    if (!isValidDevice(device)) continue;
    
    if (isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, bounds)) {
      if (!userMap.has(uName)) {
        userMap.set(uName, [
          device.locationCoordinate.x,
          device.locationCoordinate.y,
        ]);
      }
    }
  }
}

let uniqUserGround = new Map();
let uniqUserFirst = new Map();
let uniqUserSecond = new Map();
let uniqUserThird = new Map();

let uniqKingAll = new Set();

function king_resetALLarray() {
  uniqUserGround = new Map();
  uniqUserFirst = new Map();
  uniqUserSecond = new Map();
  uniqUserThird = new Map();
  uniqKingAll = new Set();
}

function rec_resetALLarray() {
  rec_uniqRecAll = new Set();
}

async function king_start() {
  king_resetALLarray();

  // Define floor boundaries
  const floorBounds = {
    ground: { minX: 10, maxX: 314, minY: 36, maxY: 190 },
    first: { minX: 16, maxX: 314, minY: 29, maxY: 190 },
    second: { minX: 10, maxX: 314, minY: 36, maxY: 190 },
    third: { minX: 10, maxX: 314, minY: 36, maxY: 190 }
  };

  // Process each floor
  await axiosApi.getGroundRequest((body) => {
    processFloorData(body, uniqUserGround, floorBounds.ground);
    uniqUserGround.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getFirstRequest((body) => {
    processFloorData(body, uniqUserFirst, floorBounds.first);
    uniqUserFirst.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getSecondRequest((body) => {
    processFloorData(body, uniqUserSecond, floorBounds.second);
    uniqUserSecond.forEach((value, key) => uniqKingAll.add(key));
  });

  await axiosApi.getThirdRequest((body) => {
    processFloorData(body, uniqUserThird, floorBounds.third);
    uniqUserThird.forEach((value, key) => uniqKingAll.add(key));
  });

  await saveToDatabase();
}

// Helper: Database connection and save logic
async function saveToDatabase() {
  const isServer = global.onServer;
  console.log("global on server? " + isServer);
  
  const uri = isServer 
    ? config.get("database.servr-connection")
    : config.get("database.mongo-atlas");
    
  const clientOptions = {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    ...(isServer 
      ? { 
          sslValidate: true,
          sslCA: [path.join(__dirname, "..", "certs", "global-bundle.pem")]
        }
      : { rejectUnauthorized: false }
    )
  };

  const client = new MongoClient(uri, clientOptions);
  const dbName = config.get("database.name");

  try {
    await client.connect();
    console.log("App Core connected to server");
    const db = client.db(dbName);
    const col = db.collection(config.get("database.collection"));

    const floorDocument = {
      timeStamp: dateTime(),
      uniqUserTotal: Array.from(uniqKingAll).sort(),
      uniqUserGround: new Map([...uniqUserGround.entries()].sort()),
      uniqUserFirst: new Map([...uniqUserFirst.entries()].sort()),
      uniqUserSecond: new Map([...uniqUserSecond.entries()].sort()),
      uniqUserThird: new Map([...uniqUserThird.entries()].sort()),
      patrons: uniqKingAll.size,
      countByFloor: [
        uniqUserGround.size,
        uniqUserFirst.size,
        uniqUserSecond.size,
        uniqUserThird.size,
      ],
    };

    // Avoid time entry redundancy caused by Chrome
    const checkDBTime = await col.find({}).sort({ _id: -1 }).limit(1).toArray();
    
    if (checkDBTime.length === 0) {
      await col.insertOne(floorDocument);
    } else {
      const timeDiff = Date.parse(floorDocument.timeStamp) - Date.parse(checkDBTime[0].timeStamp);
      console.log("time diff: " + timeDiff);
      
      if (timeDiff > 30000) {
        const currentDate = new Date();
        const currentHour = currentDate.getHours();
        if ((currentHour < 2 || currentHour > 6) && isServer) {
          await col.insertOne(floorDocument);
        }
      }
    }
  } catch (err) {
    console.log(err.stack);
  } finally {
    await client.close();
  }
}

// Helper: Process recreation center data
function processRecData(body, bounds) {
  for (let i = 0; i < body.length; i++) {
    const device = body[i];
    const uName = device.username.toLowerCase();
    
    if (isValidDevice(device) && 
        isWithinBounds(device.locationCoordinate.x, device.locationCoordinate.y, bounds)) {
      rec_uniqRecAll.add(uName);
    }
  }
}

async function rec_start() {
  rec_resetALLarray();

  // Define recreation center boundaries
  const recBounds = {
    ground: { minX: 10, maxX: 300, minY: 20, maxY: 214 },
    first: { minX: 190, maxX: 425, minY: 25, maxY: 270 }
  };

  // Process recreation center floors
  await axiosApi.getRecGroundRequest((body) => {
    processRecData(body, recBounds.ground);
  });

  await axiosApi.getRecFirstRequest((body) => {
    processRecData(body, recBounds.first);
  });

  return {
    timeStamp: dateTime(),
    patrons: rec_uniqRecAll.size,
  };
}

// To restart the "start" function every 15 minutes.
// And to keep the minutes as much as possible close to 00, 15, 30, 45.
function restart() {
  console.log("---------------I'm in the restart function--------------");
  const d = new Date();
  let minutes = d.getMinutes();
  var remainder = minutes % 15;
  console.log(
    "--------------- Will restart in: " +
      (15 - remainder) +
      " minutes--------------"
  );
  if (remainder == 0) {
    king_start();
    rec_start();
    console.log("---------------I'm in start function--------------");
    setInterval(function () {
      king_start();
      rec_start();
    }, 900000);
  } else {
    setTimeout(function () {
      restart();
    }, (15 - remainder) * 60000);
  }
}

module.exports.rec_start = rec_start;
module.exports.restart = restart;
