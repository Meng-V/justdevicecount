// Cisco CMX API client.
// Uses axios-retry for automatic retries on transient failures (3 attempts,
// exponential back-off: 2s → 4s → 8s).  On permanent failure the callback
// receives null so callers can skip that floor gracefully.

const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const config = require("config");

// Credentials: prefer environment variable, fall back to config file value.
// Set CMX_AUTH in .env as: CMX_AUTH="Basic <base64credentials>"
const auth = process.env.CMX_AUTH || config.get("app.auth");
const host = config.get("address.host");

// Attach retry behaviour to the shared axios instance used for all CMX calls.
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    const delay = axiosRetry.exponentialDelay(retryCount); // 2s, 4s, 8s
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
      ` CMX API retry ${retryCount} in ${Math.round(delay / 1000)}s`
    );
    return delay;
  },
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error) ||
    (error.response && error.response.status >= 500),
});

// Floor configuration mapping
const floorConfig = {
  Ground: {
    url: host + config.get("address.ground-add"),
    displayName: "Ground Floor"
  },
  First: {
    url: host + config.get("address.first-add"),
    displayName: "First Floor"
  },
  Second: {
    url: host + config.get("address.second-add"),
    displayName: "Second Floor"
  },
  Third: {
    url: host + config.get("address.third-add"),
    displayName: "Third Floor"
  },
  RecFirst: {
    url: host + config.get("address.rec-first"),
    displayName: "Rec First Floor"
  },
  RecGround: {
    url: host + config.get("address.rec-ground"),
    displayName: "Rec Ground Floor"
  },
  KingAll: {
    url: host + config.get("address.king-all"),
    displayName: "King All"
  },
  All: {
    url: host + config.get("address.all"),
    displayName: "All Floors"
  }
};

// Generic function to handle all floor requests.
// Invokes cb(data) on success or cb(null) on permanent failure so callers can
// safely skip a floor without crashing the whole collection cycle.
async function makeFloorRequest(floorKey, cb) {
  const floorInfo = floorConfig[floorKey];

  if (!floorInfo) {
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
      ` Error in makeFloorRequest: Invalid floor key: ${floorKey}`
    );
    return cb(null);
  }

  try {
    const response = await axios.get(floorInfo.url, {
      headers: { Authorization: auth },
    });

    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
      ` Devices connected in ${floorInfo.displayName}: ${response.data.length}`
    );
    cb(response.data);
  } catch (error) {
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}]` +
      ` Error fetching ${floorKey} (all retries exhausted): ${error.message}`
    );
    // Invoke callback with null so callers can gracefully skip this floor.
    cb(null);
  }
}

// Individual floor request functions using the generic function
async function getGroundRequest(cb) {
  return makeFloorRequest("Ground", cb);
}

async function getFirstRequest(cb) {
  return makeFloorRequest("First", cb);
}

async function getSecondRequest(cb) {
  return makeFloorRequest("Second", cb);
}

async function getThirdRequest(cb) {
  return makeFloorRequest("Third", cb);
}

async function getRecFirstRequest(cb) {
  return makeFloorRequest("RecFirst", cb);
}

async function getRecGroundRequest(cb) {
  return makeFloorRequest("RecGround", cb);
}

module.exports = {
  getGroundRequest,
  getFirstRequest,
  getSecondRequest,
  getThirdRequest,
  getRecFirstRequest,
  getRecGroundRequest,
  makeFloorRequest,
};
