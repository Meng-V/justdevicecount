// The Recreation Center patron formula — the single source of truth, shared by
// the live endpoint (routes/recapi.js), the collector's cache
// (modules/app_core.js) and the admin day/range views and exports
// (routes/admin.js).  Keep the maths here so those can never disagree.
//
//   patrons = (hourlyMean - baseline) / devicesPerPatron      while open
//   patrons = 0                                               while closed
//
// baseline is every device CMX reports that is not a patron.  It is measured,
// not guessed: the median raw count during the previous night's closed hours,
// when the building is empty by definition.  That catches the always-on kit
// (access points, staff devices — about 10 devices) and also the "ghost"
// clients CMX keeps reporting after people leave.  From early September 2026
// CMX stopped expiring those: the Rec's closed-hours count climbed from ~12 to
// ~300 in ten days and stayed there, so most of each daytime reading was ghosts.
// A fixed baseline of 10 left all of them in the published count.
//
// The ghost count only grows overnight in steps, so subtracting last night's
// figure removes everything that had piled up before today.  Devices that get
// stuck during today are still counted until tonight's measurement; that is a
// known, smaller overcount.
//
// devicesPerPatron is how many devices the average patron carries — above 1,
// because a phone plus a watch is common in a gym.
//
// Tunables live in config/default.json under "rec".

const config = require("config");

const APP_TZ = process.env.TZ || "America/New_York";

const HOUR_MS     = 60 * 60 * 1000;
const WINDOW_SIZE = 4;               // four 15-minute samples = one hour

// Closed-hours readings closer than this to closing or opening are not used
// for the baseline: people are still leaving, or staff are arriving.
const CLOSED_GRACE_MINUTES = 30;
// A night needs at least this many closed readings to be trusted.
const MIN_BASELINE_SAMPLES = 3;
// If last night has no readings (an outage, a restart), fall back to the most
// recent night within this many.  Callers load this much history.
const LOOKBACK_NIGHTS = 3;

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Fall 2026 (Aug 21 - Dec 9), from miamioh.edu/athletics-recreation/recreation/
// about/hours.html.  Overridden by rec.hours in config, which is where it
// should be updated when the Rec changes its hours.
const DEFAULT_HOURS = {
  mon: ["06:00", "23:00"], tue: ["06:00", "23:00"], wed: ["06:00", "23:00"],
  thu: ["06:00", "23:00"], fri: ["06:00", "22:00"],
  sat: ["08:00", "22:00"], sun: ["10:00", "22:00"],
};

function params() {
  return {
    defaultBaseline:  config.has("rec.baselineDevices")  ? config.get("rec.baselineDevices")  : 10,
    devicesPerPatron: config.has("rec.devicesPerPatron") ? config.get("rec.devicesPerPatron") : 1.2,
    gate:             config.has("rec.groundFirstGate")  ? config.get("rec.groundFirstGate")  : 1.0,
    capacity:         config.has("rec.capacity")         ? config.get("rec.capacity")         : 200,
    widgetMax:        config.has("rec.widgetMax")        ? config.get("rec.widgetMax")        : 200,
  };
}

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

function hoursFor(day) {
  const hours = config.has("rec.hours") ? config.get("rec.hours") : DEFAULT_HOURS;
  const [open, close] = hours[day];
  return { open: toMinutes(open), close: toMinutes(close) };
}

const etFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Eastern-Time calendar date ("YYYY-MM-DD"), weekday and minute of the day.
function etParts(time) {
  const p = Object.fromEntries(etFormat.formatToParts(new Date(time)).map((x) => [x.type, x.value]));
  return {
    date:   `${p.year}-${p.month}-${p.day}`,
    day:    p.weekday.slice(0, 3).toLowerCase(),
    minute: Number(p.hour) * 60 + Number(p.minute),
  };
}

function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dayOf = (date) => DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

function isOpen(time) {
  const { day, minute } = etParts(time);
  const { open, close } = hoursFor(day);
  return minute >= open && minute < close;
}

// The night a reading measures the baseline for, named by the ET date the
// night starts on — or null when the reading is too close to opening hours to
// be trusted.  "Tuesday night" runs from Tuesday's close (+ grace) to
// Wednesday's opening (- grace).
function closedNightOf(time) {
  const { date, minute } = etParts(time);
  const { open, close } = hoursFor(dayOf(date));
  if (minute >= close + CLOSED_GRACE_MINUTES) return date;
  if (minute <= open - CLOSED_GRACE_MINUTES) return shiftDate(date, -1);
  return null;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Group raw closed-hours readings by night: Map("YYYY-MM-DD" -> [raw, ...]).
function closedReadingsByNight(samples) {
  const nights = new Map();
  for (const s of samples) {
    const night = closedNightOf(s.timeStamp);
    if (!night) continue;
    if (!nights.has(night)) nights.set(night, []);
    nights.get(night).push(s.patrons);
  }
  return nights;
}

// The baseline in force at `time`: last night's median closed-hours reading,
// or the most recent usable night before it, or the configured default.
//   -> { baseline, source: "night" | "default", night }
function baselineAt(time, nights) {
  const lastNight = shiftDate(etParts(time).date, -1);
  for (let back = 0; back < LOOKBACK_NIGHTS; back++) {
    const night  = shiftDate(lastNight, -back);
    const values = nights.get(night);
    if (values && values.length >= MIN_BASELINE_SAMPLES) {
      return { baseline: median(values), source: "night", night };
    }
  }
  return { baseline: params().defaultBaseline, source: "default", night: null };
}

// Convenience for a single point in time, given recent raw samples (at least
// LOOKBACK_NIGHTS + 1 days of them).  Used by the collector for the live cache.
function baselineFromSamples(samples, time) {
  return baselineAt(time, closedReadingsByNight(samples));
}

// ---------------------------------------------------------------------------
// Published figures
// ---------------------------------------------------------------------------

// Estimated head count for an hourly mean of raw device counts.
function patronsFromHourlyMean(hourlyMean, baseline = params().defaultBaseline) {
  const { devicesPerPatron } = params();
  return Math.max(0, Math.round((hourlyMean - baseline) / devicesPerPatron));
}

// The figure /recapi publishes as data.patrons, rescaled to the public widget.
//
// The Rec page's widget (a copy of the gist, maintained on the university
// site, not by us) hard-codes MAX_CAPACITY = 200 and shows patrons / 200 as
// the occupancy.  If the building's real capacity differs, set rec.capacity
// and the API scales the estimate so the widget's arithmetic still lands on
// the right percentage:
//
//   widgetPatrons / widgetMax == estimatedPatrons / capacity
//
// capacity defaults to widgetMax (no scaling) until the Rec gives us a real
// figure.  Only the public endpoint does this; the admin views, exports and
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

// Everything the admin views need for each sample of a time-ordered series.
// Load LOOKBACK_NIGHTS days before the first sample you intend to show, so the
// earliest rows have a night to take their baseline from.
function applyToSeries(samples) {
  const means  = rollingHourlyMeans(samples);
  const nights = closedReadingsByNight(samples);

  return samples.map((s, i) => {
    const open = isOpen(s.timeStamp);
    const { baseline, source } = baselineAt(s.timeStamp, nights);
    return {
      hourlyMean:     Math.round(means[i] * 100) / 100,
      baseline:       Math.round(baseline),
      baselineSource: source,
      open,
      patrons:        open ? patronsFromHourlyMean(means[i], baseline) : 0,
    };
  });
}

module.exports = {
  LOOKBACK_NIGHTS,
  params,
  isOpen,
  shiftDate,
  baselineFromSamples,
  patronsFromHourlyMean,
  widgetPatrons,
  rollingHourlyMeans,
  applyToSeries,
  isDegraded,
  groundFirstRatio,
};
