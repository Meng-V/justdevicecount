// Use CMX Api. Call from Cisco

const axios = require("axios");
const config = require("config");

const auth = config.get("app.auth");
const host = config.get("address.host");

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

// Generic function to handle all floor requests
async function makeFloorRequest(floorKey, cb) {
  const floorInfo = floorConfig[floorKey];
  
  if (!floorInfo) {
    const error = new Error(`Invalid floor key: ${floorKey}`);
    console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] Error in makeFloorRequest: ${error.message}`);
    return cb(error);
  }

  try {
    const response = await axios.get(floorInfo.url, {
      headers: { Authorization: auth },
    });

    if (!response.error) {
      console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] Device Connected in ${floorInfo.displayName}: ${response.data.length}`);
      cb(response.data);
    }
  } catch (error) {
    console.log(`[${new Date().toLocaleString('en-US', {timeZone: 'America/New_York'})}] Error in ${floorKey}Request axiosApi: ${error}`);
    cb(error);
  }
}

// Individual floor request functions using the generic function
async function getGroundRequest(cb) {
  return makeFloorRequest('Ground', cb);
}

async function getFirstRequest(cb) {
  return makeFloorRequest('First', cb);
}

async function getSecondRequest(cb) {
  return makeFloorRequest('Second', cb);
}

async function getThirdRequest(cb) {
  return makeFloorRequest('Third', cb);
}

async function getRecFirstRequest(cb) {
  return makeFloorRequest('RecFirst', cb);
}

async function getRecGroundRequest(cb) {
  return makeFloorRequest('RecGround', cb);
}

module.exports = {
  getGroundRequest,
  getFirstRequest,
  getSecondRequest,
  getThirdRequest,
  getRecFirstRequest,
  getRecGroundRequest,
  makeFloorRequest // Export the generic function for potential future use
};
