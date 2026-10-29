// Drops Wi-Fi clients CMX keeps listing after they have left the building.
//
// Since about 6 Sep 2026 CMX (mualcmxp11) has stopped expiring departed
// clients.  It still marks them — networkStatus "INACTIVE", currentlyTracked
// false — but keeps refreshing lastSeen, so validTime() in deviceUtils, which
// was meant to drop anything not seen for 30 minutes, lets them all through.
// They piled up until most of every reading was devices that were not there.
// Measured on 29 Oct 2026:
//
//   Rec   390 counted, 287 INACTIVE — against 296 devices still reported
//         overnight while the building was closed.
//   King  129 devices present through the 01:00-07:00 closure; 97 of them
//         INACTIVE, 96 of those frozen at the same position for 4+ hours.
//         The 32 that were ACTIVE match the 30-43 always-on devices King
//         showed while closed before September.
//
// A device that has only just gone INACTIVE may still be here (a phone asleep
// in a bag) or may have just walked out, so it keeps counting for GRACE_MS —
// the same 30 minutes validTime() intended — and is dropped after that.  CMX
// has no "inactive since" field, so the clock is ours, kept in memory.  After
// a restart there is no way to know how long a device has been inactive, so
// every INACTIVE device in the first cycle is treated as stale.
//
// A client without networkStatus (an older CMX) is always counted.

const GRACE_MS  = 30 * 60 * 1000;
// Forget a device CMX has stopped listing, so the map cannot grow forever.
const FORGET_MS = 60 * 60 * 1000;

class StaleClientFilter {
  constructor() {
    this.inactiveSince = new Map();   // deviceId -> { since, lastListed }
    this.primed        = false;
    this.dropped       = 0;
  }

  // true = count this device.  Call once per device per cycle, after the
  // other checks have passed.
  keep(device, now = Date.now()) {
    const id = device.deviceId;

    if (device.networkStatus !== "INACTIVE") {
      this.inactiveSince.delete(id);
      return true;
    }

    let entry = this.inactiveSince.get(id);
    if (!entry) {
      entry = { since: this.primed ? now : -Infinity };
      this.inactiveSince.set(id, entry);
    }
    entry.lastListed = now;

    if (now - entry.since <= GRACE_MS) return true;
    this.dropped++;
    return false;
  }

  // Call after each cycle in which CMX answered.  Returns how many devices
  // were dropped as stale in that cycle.
  endCycle(now = Date.now()) {
    this.primed = true;
    for (const [id, entry] of this.inactiveSince) {
      if (now - entry.lastListed > FORGET_MS) this.inactiveSince.delete(id);
    }
    const dropped = this.dropped;
    this.dropped = 0;
    return dropped;
  }
}

module.exports = { StaleClientFilter, GRACE_MS };
