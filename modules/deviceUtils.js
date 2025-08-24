// Device utility functions for validation and processing

// Helper: Time to local time zone - returns NY time as ISO format for Prisma
function dateTime() {
  // Get current time in NY timezone
  const now = new Date();
  const nyTimeString = now.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // Parse the NY time string and create a proper Date object
  const [datePart, timePart] = nyTimeString.split(', ');
  const [month, day, year] = datePart.split('/');
  const [hour, minute, second] = timePart.split(':');
  
  // Create Date object representing NY time but store as if it were UTC
  const nyAsUtc = new Date(Date.UTC(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  ));
  
  return nyAsUtc.toISOString();
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
