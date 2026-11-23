// modules/dashboardAnalytics.js
// Everything the analytics dashboard (/crowdindex/admin) shows for one
// building, computed from that building's 15-minute summary records
// (STORED_DATA_DIR/summaries or rec_summaries, see scripts/refresh_summaries.js).
//
// Rules that keep the numbers honest:
//   * Times are converted to Eastern Time reading by reading, so daylight
//     saving time is always right.  Days and months are Eastern calendar days
//     and months, not UTC ones.
//   * A day is "complete" when it holds at least 80% of the readings its
//     collection window should produce (the health check's own floor), and it
//     is not today.  Averages, the heat map, the floor profile and the day
//     rankings use complete days only, so CMX outages and the unfinished
//     current day cannot pass for quiet days.
//   * Hours with no readings (the overnight silent window) are left empty,
//     never drawn as zero.
//   * King Library values are device counts.  Recreation Center values are the
//     estimated head count the live widget publishes (modules/recFormula.js).

const recFormula = require("./recFormula");
const { expectedRowsPer24h, silentWindow, describeWindow } = require("./collectionWindow");

const TZ = process.env.TZ || "America/New_York";
const COMPLETE_SHARE = 0.8;
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const BUILDINGS = {
  king: {
    kind:   "king",
    name:   "King Library",
    floors: ["Ground", "First", "Second", "Third"],
    unit:   "devices",
    unitTitle: "Devices",
  },
  rec: {
    kind:   "rec",
    name:   "Recreation Center",
    floors: ["Ground", "First"],
    unit:   "estimated people",
    unitTitle: "Estimated people",
  },
};

// ---------------------------------------------------------------------------
// Eastern Time helpers
// ---------------------------------------------------------------------------

const etFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

// Monday = 0 … Sunday = 6 for a "YYYY-MM-DD" calendar date.
function weekdayIndex(date) {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function etParts(input) {
  const p = {};
  for (const { type, value } of etFormat.formatToParts(new Date(input))) p[type] = value;
  const date = `${p.year}-${p.month}-${p.day}`;
  return {
    date,
    month:   date.slice(0, 7),
    hour:    Number(p.hour),
    time:    `${p.hour}:${p.minute}`,
    weekday: weekdayIndex(date),
  };
}

function nextDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

function monthLabel(mk) {
  const [y, m] = mk.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y}`;
}

function hourLabel(h) {
  return `${String(h).padStart(2, "0")}:00`;
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

// records: [{ timeStamp (UTC ISO), patrons, countByFloor }], any order.
// options: { startMonth, endMonth ("YYYY-MM", inclusive, Eastern months), now }
function analyse(kind, records, options = {}) {
  const building = BUILDINGS[kind];
  if (!building) throw new Error(`Unknown building: ${kind}`);

  const { startMonth = null, endMonth = null, now = new Date() } = options;

  // Time-ordered, one record per timestamp.
  const sorted = records
    .filter((r) => r && r.timeStamp)
    .sort((a, b) => a.timeStamp.localeCompare(b.timeStamp))
    .filter((r, i, arr) => i === 0 || r.timeStamp !== arr[i - 1].timeStamp);

  const inRange = (month) =>
    (!startMonth || month >= startMonth) && (!endMonth || month <= endMonth);

  // A reading with every floor at zero is a failed CMX request, not an empty
  // building: both buildings always show a few always-on devices.  Until the
  // collector learned to skip them (August 2026) such zeros were stored, e.g.
  // throughout the CMX certificate outage of July-August 2026.
  const isFailed = (r) =>
    !Number(r.patrons) && (r.countByFloor || []).every((v) => !Number(v));
  const valid = sorted.filter((r) => !isFailed(r));
  const failedReadings = sorted.filter((r) => isFailed(r) && inRange(etParts(r.timeStamp).month)).length;

  // The Rec estimate is a rolling hourly mean, so it is computed over the full
  // series before the month filter cuts it.
  const recApplied = kind === "rec" ? recFormula.applyToSeries(valid) : null;

  const readings = [];
  valid.forEach((r, i) => {
    const et = etParts(r.timeStamp);
    if (!inRange(et.month)) return;

    const floors = building.floors.map((_, f) => Number(r.countByFloor?.[f]) || 0);
    readings.push({
      ...et,
      value:    kind === "rec" ? recApplied[i].patrons : Number(r.patrons) || 0,
      floors,
      degraded: kind === "rec" ? recFormula.isDegraded(floors[0], floors[1]) : false,
    });
  });

  const meta = {
    kind,
    name:       building.name,
    unit:       building.unit,
    unitTitle:  building.unitTitle,
    floors:     building.floors,
    silentWindow: describeWindow(kind),
    failedReadings,
  };

  if (!readings.length) return { available: false, ...meta };

  // ---- days ---------------------------------------------------------------
  const today    = etParts(now).date;
  const expected = expectedRowsPer24h(kind);
  const minRows  = Math.floor(expected * COMPLETE_SHARE);

  const dayMap = new Map();
  for (const r of readings) {
    let d = dayMap.get(r.date);
    if (!d) {
      d = { date: r.date, weekday: WEEKDAYS[r.weekday], n: 0, sum: 0, peak: -1, peakTime: null };
      dayMap.set(r.date, d);
    }
    d.n += 1;
    d.sum += r.value;
    if (r.value > d.peak) { d.peak = r.value; d.peakTime = r.time; }
  }

  const firstDate = readings[0].date;
  const lastDate  = readings[readings.length - 1].date;

  // Every calendar day from first to last, so missing days show as gaps.
  const days = [];
  for (let date = firstDate; date <= lastDate; date = nextDate(date)) {
    const d = dayMap.get(date);
    if (d) {
      days.push({
        date,
        weekday:  d.weekday,
        n:        d.n,
        avg:      Math.round(d.sum / d.n),
        peak:     d.peak,
        peakTime: d.peakTime,
        complete: d.n >= minRows && date !== today,
      });
    } else {
      days.push({ date, weekday: WEEKDAYS[weekdayIndex(date)], n: 0, complete: false });
    }
  }

  const completeDays = days.filter((d) => d.complete);
  const completeSet  = new Set(completeDays.map((d) => d.date));
  const goodReadings = readings.filter((r) => completeSet.has(r.date));

  // Runs of consecutive incomplete days (today excluded — it is still filling).
  const gaps = [];
  for (const d of days) {
    if (d.complete || d.date === today) continue;
    const last = gaps[gaps.length - 1];
    if (last && nextDate(last.to) === d.date) {
      last.to = d.date;
      last.days += 1;
      last.readings += d.n;
    } else {
      gaps.push({ from: d.date, to: d.date, days: 1, readings: d.n });
    }
  }

  // ---- hours, in the order the collection day runs ------------------------
  // Start at the end of the silent window (07:00 for King) and keep only the
  // hours that actually hold readings.
  const { end: dayStartHour } = silentWindow(kind);
  const hoursWithData = new Set(readings.map((r) => r.hour));
  const hours = [];
  for (let i = 0; i < 24; i++) {
    const h = (dayStartHour + i) % 24;
    if (hoursWithData.has(h)) hours.push(h);
  }
  const hourIndex = new Map(hours.map((h, i) => [h, i]));

  function heatmap(rs) {
    const sum = WEEKDAYS.map(() => hours.map(() => 0));
    const cnt = WEEKDAYS.map(() => hours.map(() => 0));
    for (const r of rs) {
      const hi = hourIndex.get(r.hour);
      sum[r.weekday][hi] += r.value;
      cnt[r.weekday][hi] += 1;
    }
    return sum.map((row, w) => row.map((s, h) => (cnt[w][h] ? Math.round(s / cnt[w][h]) : null)));
  }

  // ---- months -------------------------------------------------------------
  const currentMonth = today.slice(0, 7);
  const monthKeys = [...new Set(readings.map((r) => r.month))].sort();

  const byMonthReadings = new Map(monthKeys.map((mk) => [mk, []]));
  for (const r of goodReadings) byMonthReadings.get(r.month).push(r);

  const months = monthKeys.map((mk) => {
    const mDays     = days.filter((d) => d.date.startsWith(mk) && d.n > 0);
    const mComplete = mDays.filter((d) => d.complete);
    const mGood     = byMonthReadings.get(mk);
    const top       = mDays.reduce((a, d) => (d.peak > a.peak ? d : a), mDays[0]);

    return {
      month:        mk,
      label:        monthLabel(mk),
      inProgress:   mk === currentMonth,
      daysWithData: mDays.length,
      completeDays: mComplete.length,
      avg:          mGood.length ? Math.round(mean(mGood.map((r) => r.value))) : null,
      avgDailyPeak: mComplete.length ? Math.round(mean(mComplete.map((d) => d.peak))) : null,
      peak:         top.peak,
      peakDate:     top.date,
      peakTime:     top.peakTime,
    };
  });

  const heat = {
    all:     heatmap(goodReadings),
    byMonth: Object.fromEntries(monthKeys.map((mk) => [mk, heatmap(byMonthReadings.get(mk))])),
  };

  // Busiest cell of the week.
  let busiest = null;
  heat.all.forEach((row, w) => row.forEach((v, h) => {
    if (v !== null && (!busiest || v > busiest.avg)) {
      busiest = { weekday: WEEKDAYS[w], hour: hourLabel(hours[h]), avg: v };
    }
  }));

  // ---- floors by hour (complete days) --------------------------------------
  const floorSum = building.floors.map(() => hours.map(() => 0));
  const floorCnt = hours.map(() => 0);
  for (const r of goodReadings) {
    const hi = hourIndex.get(r.hour);
    floorCnt[hi] += 1;
    r.floors.forEach((v, f) => { floorSum[f][hi] += v; });
  }
  const floorsByHour = building.floors.map((name, f) => ({
    name,
    avg: hours.map((_, hi) => (floorCnt[hi] ? Math.round(floorSum[f][hi] / floorCnt[hi]) : null)),
  }));

  // ---- headline figures ---------------------------------------------------
  const peakReading = readings.reduce((a, r) => (r.value > a.value ? r : a), readings[0]);
  const latest      = readings[readings.length - 1];

  const topDays = [...completeDays]
    .sort((a, b) => b.peak - a.peak || b.avg - a.avg)
    .slice(0, 10);

  return {
    available: true,
    ...meta,
    today,
    expectedPerDay: expected,
    minRowsPerDay:  minRows,
    range: { startMonth, endMonth },

    overview: {
      firstDate,
      lastDate,
      readings:     readings.length,
      daysWithData: dayMap.size,
      completeDays: completeDays.length,
      avgDailyPeak: completeDays.length ? Math.round(mean(completeDays.map((d) => d.peak))) : null,
      peak: {
        value:   peakReading.value,
        date:    peakReading.date,
        time:    peakReading.time,
        weekday: WEEKDAYS[peakReading.weekday],
      },
      busiest,
      latest: { date: latest.date, time: latest.time, value: latest.value },
    },

    days: days.map((d) => ({
      date: d.date,
      avg:  d.complete ? d.avg : null,
      peak: d.complete ? d.peak : null,
    })),
    gaps,
    months,
    hours:   hours.map(hourLabel),
    weekdays: WEEKDAYS,
    heat,
    floorsByHour,
    topDays,
    degraded: kind === "rec"
      ? { count: readings.filter((r) => r.degraded).length, total: readings.length }
      : null,
  };
}

module.exports = { analyse, etParts, monthLabel, BUILDINGS, WEEKDAYS };
