// Device utility functions for validation and processing

// Helper: Returns current UTC timestamp for database storage
function dateTime() {
  // Return current UTC time as Date object for Prisma
  return new Date();
}

// Helper method: To get rid of weak rssi devices
function validRssi(parseRssi) {
  var rssiValue = parseInt(parseRssi);
  if (!isNaN(rssiValue)) {
    if (rssiValue >= -70 && rssiValue < -1) {
      return true;
    }
  }
  return false;
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
  return (
    validRssi(device.maxDetectedRssi.rssi) &&
    validTime(device.statistics.currentServerTime, device.lastSeen) &&
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

module.exports = {
  dateTime,
  validRssi,
  validTime,
  isValidDevice,
  isWithinBounds
};
