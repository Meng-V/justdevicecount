// The Recreation Center patron formula — the single source of truth, shared by
// the live endpoint (routes/recapi.js) and the admin day/range views and
// exports (routes/admin.js).
//
// Those two used to each carry their own arithmetic: the live widget moved to
// a device baseline and scaling factor while admin was still subtracting a
// flat rec.staffOffset, so the same 15-minute reading showed two different
// numbers depending on the page.  Keep the maths here so that cannot happen
// again.
//
//   patrons = (hourlyMean - baselineDevices) / devicesPerPatron
//
// baselineDevices are the always-on devices (access points, staff kit) that
// are not patrons.  devicesPerPatron is how many devices the average patron
// carries — above 1, because a phone plus a watch is common in a gym.
//
// Until October 2026 the factor MULTIPLIED (1.2 x devices), which assumed
// there were more people than devices; at a semester peak of ~400 devices
// that published ~470 patrons.  Dividing gives ~325.
//
// Tunables live in config/default.json under "rec".

const config = require("config");

const HOUR_MS      = 60 * 60 * 1000;
const WINDOW_SIZE  = 4;              // four 15-minute samples = one hour

function params() {
  return {
    baseline:         config.has("rec.baselineDevices")  ? config.get("rec.baselineDevices")  : 10,
    devicesPerPatron: config.has("rec.devicesPerPatron") ? config.get("rec.devicesPerPatron") : 1.2,
    gate:             config.has("rec.groundFirstGate")  ? config.get("rec.groundFirstGate")  : 1.0,
    capacity:         config.has("rec.capacity")         ? config.get("rec.capacity")         : 350,
    widgetMax:        config.has("rec.widgetMax")        ? config.get("rec.widgetMax")        : 200,
  };
}

// The published patron figure for a given hourly mean of raw device counts.
function patronsFromHourlyMean(hourlyMean) {
  const { baseline, devicesPerPatron } = params();
  return Math.max(0, Math.round((hourlyMean - baseline) / devicesPerPatron));
}

// The figure /recapi publishes as data.patrons, rescaled to the public widget.
//
// The Rec page's widget (a copy of the gist, maintained on the university
// site, not by us) hard-codes MAX_CAPACITY = 200 and shows patrons / 200 as
// the occupancy.  The building's real capacity is closer to 350, so a true
// head count overflowed it — 320 patrons at the Oct 2026 peak read as 160%.
// Rather than ask for the widget to be edited, the API scales the estimate so
// the widget's arithmetic lands on the right percentage:
//
//   widgetPatrons / widgetMax == estimatedPatrons / capacity
//
// Only the public endpoint does this.  The admin views, exports, and
// metadata.estimatedPatrons keep the real estimate.
function widgetPatrons(estimatedPatrons) {
  const { capacity, widgetMax } = params();
  return Math.max(0, Math.round(estimatedPatrons * widgetMax / capacity));
}

// Ground/first sanity check.  A ratio above the gate means the reading is
// suspect and the caller should flag it rather than serve it as fact.
function isDegraded(ground, first) {
  return groundFirstRatio(ground, first) > params().gate;
}

function groundFirstRatio(ground, first) {
  return (ground || 0) / Math.max(first || 0, 1);
}

// Rolling hourly mean across a time-ordered series of raw 15-minute samples
// (`[{ timeStamp, patrons }]`, oldest first).  For each sample: the mean of it
// and up to three preceding ones, ignoring anything more than an hour older so
// an overnight collection gap is never averaged across.
//
// Deliberately mirrors recHourlyMean() in modules/app_core.js, which does the
// same thing live against rec_data: at most the four most recent samples within
// the trailing hour, the current sample included.
function rollingHourlyMeans(samples) {
  const times = samples.map((s) => new Date(s.timeStamp).getTime());

  return samples.map((_, i) => {
    let sum = 0;
    let n   = 0;

    for (let j = i; j >= 0 && n < WINDOW_SIZE; j--) {
      if (times[i] - times[j] > HOUR_MS) break;
      sum += samples[j].patrons;
      n++;
    }

    return n ? sum / n : samples[i].patrons;
  });
}

// Convenience: hourly mean + published figure for every sample in a series.
function applyToSeries(samples) {
  return rollingHourlyMeans(samples).map((mean) => ({
    hourlyMean: Math.round(mean * 100) / 100,
    patrons:    patronsFromHourlyMean(mean),
  }));
}

module.exports = {
  params,
  patronsFromHourlyMean,
  widgetPatrons,
  rollingHourlyMeans,
  applyToSeries,
  isDegraded,
  groundFirstRatio,
};
