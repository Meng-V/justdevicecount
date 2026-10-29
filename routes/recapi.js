// RecAPI — returns live recreation-center patron count.
// The live count is served from an in-memory cache; the raw counts are also
// persisted every collection cycle to the rec_data table (see app_core.js).
//
// Estimated patrons = (hourlyMean - baseline) / devicesPerPatron while the Rec
// is open, 0 while it is closed.  hourlyMean is the mean of the last four
// 15-minute raw device counts; baseline is last night's closed-hours device
// count, which removes the devices CMX reports that are not patrons.  See
// modules/recFormula.js; the knobs live in config/default.json under "rec".
//
// data.patrons is that estimate rescaled to the public Rec widget, which
// hard-codes a maximum of 200 (identical while rec.capacity is also 200).
// Consumers that want a head count should read metadata.estimatedPatrons, or
// metadata.occupancyPercent for the percentage.

const express = require("express");
const router  = express.Router();
const { getRecData } = require("../modules/app_core");
const recFormula = require("../modules/recFormula");

router.get("/", (req, res) => {
  try {
    const data = getRecData();

    const {
      defaultBaseline, devicesPerPatron: DEVICES_PER_PATRON, gate: GF_GATE,
      capacity: CAPACITY, widgetMax: WIDGET_MAX,
    } = recFormula.params();

    // Measured by the collector each cycle; before its first cycle there is
    // none yet, so fall back to the configured default.
    const baseline = data.baseline ?? { baseline: defaultBaseline, source: "default", night: null };
    const open     = recFormula.isOpen(new Date());

    // hourlyMean = mean of the last four 15-minute patrons_raw samples,
    // computed by the collector (modules/app_core.js).  Before the first
    // collection cycle completes the cache has no mean yet, so fall back to the
    // live sample rather than publishing 0.
    const hourlyMean = Number.isFinite(data.hourlyMean) ? data.hourlyMean : data.patrons;

    const estimatedPatrons = open ? recFormula.patronsFromHourlyMean(hourlyMean, baseline.baseline) : 0;
    const widgetPatrons    = recFormula.widgetPatrons(estimatedPatrons);

    const [ground, first] = data.countByFloor ?? [0, 0];

    // Quality gate: on 4 of 5 observed days ground/first is 0.58-0.73; on 2026-08-10 it was
    // 1.71 and the formula over-counted by +9 on average.  Do not silently serve those hours.
    const groundFirstRatio = recFormula.groundFirstRatio(ground, first);
    const degraded = recFormula.isDegraded(ground, first);

    res.json({
      success: true,
      data: {
        timeStamp:    data.timeStamp,
        patrons:      widgetPatrons,                // scaled to the widget's max — see header
        countByFloor: data.countByFloor ?? [0, 0],  // [ground, first], raw (no offset)
        degraded,                                   // true = ratio outside the sane band, treat with suspicion
      },
      metadata: {
        cached:           true,
        lastUpdated:      data.lastUpdated,
        source:           "Recreation Center Memory Cache",
        refreshInterval:  "15 minutes",
        hourlyMean:       Math.round(hourlyMean * 100) / 100,
        estimatedPatrons,
        capacity:         CAPACITY,
        occupancyPercent: Math.round(estimatedPatrons / CAPACITY * 100),
        widgetMax:        WIDGET_MAX,
        open,
        baselineDevices:  Math.round(baseline.baseline),
        baselineSource:   baseline.source === "night"
          ? `median closed-hours reading, night of ${baseline.night}`
          : "configured default (no recent closed-hours readings)",
        devicesPerPatron: DEVICES_PER_PATRON,
        groundFirstRatio: Math.round(groundFirstRatio * 100) / 100,
        degradedReason:   degraded
          ? `ground/first ratio ${groundFirstRatio.toFixed(2)} exceeds the ${GF_GATE} sanity limit; ` +
            "the count is likely over-stated for this period"
          : null,
        note: "Live count served from memory; raw counts are also persisted to the rec_data table",
      },
    });
  } catch (error) {
    console.error("Error fetching recreation data:", error);
    res.status(500).json({
      success: false,
      error:   "Failed to retrieve recreation data",
      message: error.message,
    });
  }
});

router.post("/", (req, res) => res.redirect("/"));

module.exports = router;
