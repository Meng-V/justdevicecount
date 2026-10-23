// Cisco CMX API client.
// Uses axios-retry for automatic retries on transient failures (3 attempts,
// exponential back-off: 2s → 4s → 8s).  On permanent failure the callback
// receives null so callers can skip that floor gracefully.

const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const config = require("config");

// Credentials: prefer environment variable, fall back to config file value.
// Set CMX_AUTH in .env as: CMX_AUTH="Basic <base64credentials>"
const auth   = process.env.CMX_AUTH || config.get("app.auth");
const host   = config.get("address.host");
const APP_TZ = process.env.TZ || "America/New_York";

// Hard ceiling on a single floor request, retries included (axios-retry runs
// with shouldResetTimeout: false, and does not retry a timeout).  axios's own
// default is 0 — wait forever — and that is what turned the October 2026 CMX
// outage into a silent one: CMX accepted the TCP connection but never finished
// the TLS handshake, so every request hung with no error, no log line, and no
// end, and four days of hung sockets piled up.  A normal request answers in a
// second or two; 30 s is generous.  Worst case per cycle is King's four
// sequential floors, 2 minutes, well inside the 15-minute interval.
const REQUEST_TIMEOUT_MS = Number(process.env.CMX_TIMEOUT_MS) || 30000;

// Attach retry behaviour to the shared axios instance used for all CMX calls.
axiosRetry(axios, {
  retries: 3,
  retryDelay: (retryCount) => {
    const delay = axiosRetry.exponentialDelay(retryCount); // 2s, 4s, 8s
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
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
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
      ` Error in makeFloorRequest: Invalid floor key: ${floorKey}`
    );
    return cb(null);
  }

  try {
    const response = await axios.get(floorInfo.url, {
      headers: { Authorization: auth },
      timeout: REQUEST_TIMEOUT_MS,
    });

    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
      ` Devices connected in ${floorInfo.displayName}: ${response.data.length}`
    );
    cb(response.data);
  } catch (error) {
    // A timeout is never retried, so "all retries exhausted" would mislead —
    // name it for what it is, since it points at a different fix (CMX hung)
    // than a 503 or an expired certificate does.
    const reason = error.code === "ECONNABORTED"
      ? `no response within ${REQUEST_TIMEOUT_MS / 1000}s — CMX is not answering`
      : `all retries exhausted: ${error.message}`;
    console.log(
      `[${new Date().toLocaleString("en-US", { timeZone: APP_TZ })}]` +
      ` Error fetching ${floorKey} (${reason})`
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
