#!/usr/bin/env python3
"""
big_summary.py — Comprehensive patron analytics across all monthly summary files.

Reads every YYYY-MM_summary.json from stored_data/summaries/, then computes
a rich set of analyses and writes the result to:

    stored_data/analysis/big_summary.json

Analysis produced
-----------------
Global:
  • overall_stats          — all-time avg / peak / total records
  • monthly_overview       — per-month avg, peak, peak date, total records
  • cross_month_top10_days — the 10 highest single-day averages across all data
  • cross_month_low10_days — the 10 lowest single-day averages
  • day_of_week_profile    — Mon-Sun avg + peak + low across ALL months
  • hourly_profile (ET)    — 00-23 avg + peak across ALL months

Per-month (in "months" dict, keyed "YYYY-MM"):
  • summary            — avg, peak, peak_record, low_record, record_count
  • top10_days         — top-10 calendar dates by daily avg patron count
  • bottom10_days      — bottom-10 calendar dates by daily avg patron count
  • day_of_week        — Mon-Sun avg, peak, low counts
  • hourly_profile(ET) — 00-23 avg, peak counts
  • floor_breakdown    — per-floor avg, peak and:
      · floor_top_hours    — which ET hours each floor peaks
      · floor_top_dates    — which calendar dates each floor peaks
  • peak_record        — single highest 15-min reading with full context
  • quiet_record       — single lowest 15-min reading with full context

Usage:
    python3 scripts/big_summary.py

Flags:
    --summaries-dir PATH    input dir  (default: stored_data/summaries/)
    --output-dir    PATH    output dir (default: stored_data/analysis/)
    --et-offset     INT     UTC→ET offset in hours, negative (default: -4 for EDT,
                            use -5 for EST)
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from statistics import mean


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

FLOOR_LABELS = ["Ground", "First", "Second", "Third"]
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday",
                 "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_ts(ts_str: str) -> datetime:
    return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))


def to_et(dt: datetime, offset_hours: int) -> datetime:
    return dt + timedelta(hours=offset_hours)


def fmt_dt(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M ET")


def fmt_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def fmt_weekday(dt: datetime) -> str:
    return WEEKDAY_NAMES[dt.weekday()]


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def load_summaries(summaries_dir: str) -> dict[str, list[dict]]:
    """Return {YYYY-MM: [records]} sorted by month."""
    files = sorted(
        f for f in os.listdir(summaries_dir)
        if f.endswith("_summary.json")
    )
    if not files:
        print(f"[big_summary] No *_summary.json files found in {summaries_dir!r}")
        sys.exit(1)

    result = {}
    for fname in files:
        month_key = fname.replace("_summary.json", "")
        path = os.path.join(summaries_dir, fname)
        with open(path, encoding="utf-8") as fh:
            result[month_key] = json.load(fh)
        print(f"  Loaded {fname}: {len(result[month_key])} records")
    return result


# ---------------------------------------------------------------------------
# Core analysis functions
# ---------------------------------------------------------------------------

def compute_day_buckets(records: list[dict], et_offset: int) -> dict[str, list[int]]:
    """Group patron counts by calendar date (ET)."""
    buckets: dict[str, list[int]] = defaultdict(list)
    for r in records:
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        buckets[fmt_date(dt_et)].append(r["patrons"])
    return buckets


def day_stats(buckets: dict[str, list[int]]) -> list[dict]:
    """Return list of {date, avg, peak, low, samples} sorted by date."""
    out = []
    for date, vals in buckets.items():
        out.append({
            "date":    date,
            "weekday": WEEKDAY_NAMES[datetime.strptime(date, "%Y-%m-%d").weekday()],
            "avg":     round(mean(vals)),
            "peak":    max(vals),
            "low":     min(vals),
            "samples": len(vals),
        })
    return sorted(out, key=lambda x: x["date"])


def top_bottom_days(day_list: list[dict], n: int = 10) -> tuple[list, list]:
    by_avg = sorted(day_list, key=lambda x: x["avg"], reverse=True)
    return by_avg[:n], by_avg[-n:][::-1]


def compute_weekday_profile(records: list[dict], et_offset: int) -> list[dict]:
    """Mon-Sun avg, peak, low over all records."""
    buckets: dict[int, list[int]] = defaultdict(list)
    for r in records:
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        buckets[dt_et.weekday()].append(r["patrons"])
    out = []
    for wd in range(7):
        vals = buckets.get(wd, [0])
        out.append({
            "weekday": WEEKDAY_NAMES[wd],
            "avg":     round(mean(vals)),
            "peak":    max(vals),
            "low":     min(vals),
            "samples": len(vals),
        })
    return out


def compute_hourly_profile(records: list[dict], et_offset: int) -> list[dict]:
    """Hour 0-23 (ET) avg, peak over all records."""
    buckets: dict[int, list[int]] = defaultdict(list)
    for r in records:
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        buckets[dt_et.hour].append(r["patrons"])
    out = []
    for h in range(24):
        vals = buckets.get(h, [0])
        out.append({
            "hour_et":  h,
            "label":    f"{h:02d}:00",
            "avg":      round(mean(vals)),
            "peak":     max(vals),
            "samples":  len(vals),
        })
    return out


def compute_floor_breakdown(records: list[dict], et_offset: int) -> list[dict]:
    """Per-floor avg, peak, top hours, top dates."""
    floor_patron_vals  = [[] for _ in FLOOR_LABELS]
    hour_buckets       = [defaultdict(list) for _ in FLOOR_LABELS]
    date_buckets       = [defaultdict(list) for _ in FLOOR_LABELS]

    for r in records:
        cbf = r.get("countByFloor", [0, 0, 0, 0])
        while len(cbf) < 4:
            cbf.append(0)
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        h = dt_et.hour
        d = fmt_date(dt_et)
        for i, label in enumerate(FLOOR_LABELS):
            v = cbf[i]
            floor_patron_vals[i].append(v)
            hour_buckets[i][h].append(v)
            date_buckets[i][d].append(v)

    result = []
    for i, label in enumerate(FLOOR_LABELS):
        vals = floor_patron_vals[i]

        # Top 5 hours by avg
        hour_avgs = {
            h: round(mean(vs)) for h, vs in hour_buckets[i].items()
        }
        top_hours = sorted(hour_avgs.items(), key=lambda x: x[1], reverse=True)[:5]

        # Top 5 dates by avg
        date_avgs = {
            d: round(mean(vs)) for d, vs in date_buckets[i].items()
        }
        top_dates = sorted(date_avgs.items(), key=lambda x: x[1], reverse=True)[:5]

        result.append({
            "floor":     label,
            "avg":       round(mean(vals)),
            "peak":      max(vals),
            "low":       min(vals),
            "top_hours": [{"hour_et": h, "label": f"{h:02d}:00", "avg": a}
                          for h, a in top_hours],
            "top_dates": [{"date": d, "avg": a} for d, a in top_dates],
        })
    return result


def find_peak_record(records: list[dict], et_offset: int) -> dict:
    r = max(records, key=lambda x: x["patrons"])
    dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
    return {
        "timestamp_utc": r["timeStamp"],
        "timestamp_et":  fmt_dt(dt_et),
        "weekday":       fmt_weekday(dt_et),
        "patrons":       r["patrons"],
        "countByFloor":  r.get("countByFloor", []),
    }


def find_quiet_record(records: list[dict], et_offset: int) -> dict:
    # Ignore pure-zero records (maintenance / sensor off)
    non_zero = [r for r in records if r["patrons"] > 0] or records
    r = min(non_zero, key=lambda x: x["patrons"])
    dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
    return {
        "timestamp_utc": r["timeStamp"],
        "timestamp_et":  fmt_dt(dt_et),
        "weekday":       fmt_weekday(dt_et),
        "patrons":       r["patrons"],
        "countByFloor":  r.get("countByFloor", []),
    }


def compute_month_analysis(month_key: str, records: list[dict],
                           et_offset: int) -> dict:
    all_patrons = [r["patrons"] for r in records]
    day_buckets = compute_day_buckets(records, et_offset)
    day_list    = day_stats(day_buckets)
    top10, bot10 = top_bottom_days(day_list)

    return {
        "month":          month_key,
        "summary": {
            "record_count": len(records),
            "avg_patrons":  round(mean(all_patrons)),
            "peak_patrons": max(all_patrons),
            "low_patrons":  min(r["patrons"] for r in records if r["patrons"] > 0),
        },
        "peak_record":    find_peak_record(records, et_offset),
        "quiet_record":   find_quiet_record(records, et_offset),
        "top10_days":     top10,
        "bottom10_days":  bot10,
        "all_days":       day_list,
        "day_of_week":    compute_weekday_profile(records, et_offset),
        "hourly_profile": compute_hourly_profile(records, et_offset),
        "floor_breakdown":compute_floor_breakdown(records, et_offset),
    }


# ---------------------------------------------------------------------------
# Cross-month (global) analyses
# ---------------------------------------------------------------------------

def compute_global(all_months: dict[str, dict], et_offset: int) -> dict:
    all_records: list[dict] = []
    for m in all_months.values():
        all_records.extend(_flatten_records(m))

    all_patrons = [r["patrons"] for r in all_records]

    # Cross-month top/bottom days by single-day average
    cross_day_buckets: dict[str, list[int]] = defaultdict(list)
    for r in all_records:
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        cross_day_buckets[fmt_date(dt_et)].append(r["patrons"])

    cross_days = [
        {
            "date":    d,
            "weekday": WEEKDAY_NAMES[datetime.strptime(d, "%Y-%m-%d").weekday()],
            "avg":     round(mean(vs)),
            "peak":    max(vs),
        }
        for d, vs in cross_day_buckets.items()
    ]
    cross_days.sort(key=lambda x: x["avg"], reverse=True)

    return {
        "overall_stats": {
            "total_records": len(all_records),
            "months_covered": sorted(all_months.keys()),
            "all_time_avg":   round(mean(all_patrons)),
            "all_time_peak":  max(all_patrons),
            "all_time_low":   min(p for p in all_patrons if p > 0),
            "peak_record":    find_peak_record(all_records, et_offset),
            "quiet_record":   find_quiet_record(all_records, et_offset),
        },
        "monthly_overview": [
            {
                "month":        mk,
                "record_count": m["summary"]["record_count"],
                "avg_patrons":  m["summary"]["avg_patrons"],
                "peak_patrons": m["summary"]["peak_patrons"],
                "peak_date":    m["peak_record"]["timestamp_et"],
                "peak_weekday": m["peak_record"]["weekday"],
            }
            for mk, m in sorted(all_months.items())
        ],
        "cross_month_top10_days": cross_days[:10],
        "cross_month_low10_days": list(reversed(cross_days[-10:])),
        "day_of_week_profile":    compute_weekday_profile(all_records, et_offset),
        "hourly_profile":         compute_hourly_profile(all_records, et_offset),
        "floor_breakdown":        compute_floor_breakdown(all_records, et_offset),
    }


def _flatten_records(month_analysis: dict) -> list[dict]:
    """Re-expand day_list back into pseudo-records for global calcs.
    We use the all_days daily aggregates — but for global we need the
    originals.  They are stored in 'all_days' only as daily summaries.
    Instead we keep a reference to the raw list via a side-channel."""
    return month_analysis.get("_raw", [])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(summaries_dir: str, output_dir: str, et_offset: int) -> None:
    os.makedirs(output_dir, exist_ok=True)

    print(f"\n[big_summary] Loading from {summaries_dir!r} ...")
    raw_by_month = load_summaries(summaries_dir)
    print(f"\n[big_summary] Analysing {len(raw_by_month)} month(s) ...\n")

    # Per-month analysis
    months_analysis: dict[str, dict] = {}
    for mk, records in sorted(raw_by_month.items()):
        print(f"  {mk}: {len(records)} records")
        result = compute_month_analysis(mk, records, et_offset)
        result["_raw"] = records          # stash for global calcs
        months_analysis[mk] = result

    # Global analysis (uses raw records stashed above)
    print("\n[big_summary] Computing cross-month global analysis ...")
    all_records_flat: list[dict] = []
    for m in months_analysis.values():
        all_records_flat.extend(m["_raw"])

    global_analysis = {
        "overall_stats": {
            "total_records":   len(all_records_flat),
            "months_covered":  sorted(months_analysis.keys()),
            "all_time_avg":    round(mean(r["patrons"] for r in all_records_flat)),
            "all_time_peak":   max(r["patrons"] for r in all_records_flat),
            "all_time_low":    min(r["patrons"] for r in all_records_flat if r["patrons"] > 0),
            "peak_record":     find_peak_record(all_records_flat, et_offset),
            "quiet_record":    find_quiet_record(all_records_flat, et_offset),
        },
        "monthly_overview": [
            {
                "month":        mk,
                "record_count": months_analysis[mk]["summary"]["record_count"],
                "avg_patrons":  months_analysis[mk]["summary"]["avg_patrons"],
                "peak_patrons": months_analysis[mk]["summary"]["peak_patrons"],
                "peak_date":    months_analysis[mk]["peak_record"]["timestamp_et"],
                "peak_weekday": months_analysis[mk]["peak_record"]["weekday"],
            }
            for mk in sorted(months_analysis.keys())
        ],
        "day_of_week_profile": compute_weekday_profile(all_records_flat, et_offset),
        "hourly_profile":      compute_hourly_profile(all_records_flat, et_offset),
        "floor_breakdown":     compute_floor_breakdown(all_records_flat, et_offset),
    }

    # Cross-month top/bottom single days
    cross_day_buckets: dict[str, list[int]] = defaultdict(list)
    for r in all_records_flat:
        dt_et = to_et(parse_ts(r["timeStamp"]), et_offset)
        cross_day_buckets[fmt_date(dt_et)].append(r["patrons"])
    cross_days = sorted(
        [
            {
                "date":    d,
                "weekday": WEEKDAY_NAMES[datetime.strptime(d, "%Y-%m-%d").weekday()],
                "avg":     round(mean(vs)),
                "peak":    max(vs),
            }
            for d, vs in cross_day_buckets.items()
        ],
        key=lambda x: x["avg"],
        reverse=True,
    )
    global_analysis["cross_month_top10_days"] = cross_days[:10]
    global_analysis["cross_month_low10_days"] = list(reversed(cross_days[-10:]))

    # Strip _raw before serialising
    for m in months_analysis.values():
        m.pop("_raw", None)

    # Assemble final document
    output = {
        "generated_at": datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "et_offset_hours": et_offset,
        "global": global_analysis,
        "months": months_analysis,
    }

    out_path = os.path.join(output_dir, "big_summary.json")
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2)

    # Human-readable console report
    _print_report(output)
    print(f"\n[big_summary] Full analysis written → {os.path.abspath(out_path)}")


def _print_report(doc: dict) -> None:
    g = doc["global"]
    s = g["overall_stats"]
    print("\n" + "=" * 70)
    print("  PATRON ANALYTICS — BIG SUMMARY")
    print("=" * 70)
    print(f"  Months covered : {', '.join(s['months_covered'])}")
    print(f"  Total records  : {s['total_records']:,}")
    print(f"  All-time avg   : {s['all_time_avg']} patrons")
    print(f"  All-time peak  : {s['all_time_peak']} patrons  "
          f"({s['peak_record']['timestamp_et']}, {s['peak_record']['weekday']})")
    print(f"  All-time low   : {s['all_time_low']} patrons  "
          f"({s['quiet_record']['timestamp_et']}, {s['quiet_record']['weekday']})")

    print("\n  MONTHLY OVERVIEW")
    print(f"  {'Month':<10} {'Records':>8} {'Avg':>6} {'Peak':>6}  Peak date")
    print("  " + "-" * 60)
    for m in g["monthly_overview"]:
        print(f"  {m['month']:<10} {m['record_count']:>8,} {m['avg_patrons']:>6} "
              f"{m['peak_patrons']:>6}  {m['peak_date']}  ({m['peak_weekday']})")

    print("\n  TOP-10 DAYS ACROSS ALL MONTHS (by daily avg)")
    print(f"  {'Rank':<5} {'Date':<12} {'Weekday':<11} {'Avg':>5} {'Peak':>6}")
    print("  " + "-" * 45)
    for i, d in enumerate(g["cross_month_top10_days"], 1):
        print(f"  {i:<5} {d['date']:<12} {d['weekday']:<11} {d['avg']:>5} {d['peak']:>6}")

    print("\n  BOTTOM-10 DAYS ACROSS ALL MONTHS (by daily avg)")
    print(f"  {'Rank':<5} {'Date':<12} {'Weekday':<11} {'Avg':>5} {'Peak':>6}")
    print("  " + "-" * 45)
    for i, d in enumerate(g["cross_month_low10_days"], 1):
        print(f"  {i:<5} {d['date']:<12} {d['weekday']:<11} {d['avg']:>5} {d['peak']:>6}")

    print("\n  DAY-OF-WEEK PROFILE (all months combined)")
    print(f"  {'Weekday':<12} {'Avg':>6} {'Peak':>6} {'Low':>6}")
    print("  " + "-" * 35)
    for wd in g["day_of_week_profile"]:
        print(f"  {wd['weekday']:<12} {wd['avg']:>6} {wd['peak']:>6} {wd['low']:>6}")

    print("\n  HOURLY PROFILE (Eastern Time, all months)")
    print(f"  {'Hour ET':<10} {'Avg':>6} {'Peak':>6}")
    print("  " + "-" * 25)
    for h in g["hourly_profile"]:
        bar = "█" * (h["avg"] // 50)
        print(f"  {h['label']:<10} {h['avg']:>6} {h['peak']:>6}  {bar}")

    print("\n  FLOOR BREAKDOWN (all months)")
    print(f"  {'Floor':<10} {'Avg':>6} {'Peak':>6}  Top hours ET")
    print("  " + "-" * 50)
    for fl in g["floor_breakdown"]:
        hrs = ", ".join(h["label"] for h in fl["top_hours"])
        print(f"  {fl['floor']:<10} {fl['avg']:>6} {fl['peak']:>6}  {hrs}")

    print("\n  PER-MONTH TOP-3 DAYS")
    for mk, ma in sorted(doc["months"].items()):
        t3 = ma["top10_days"][:3]
        days_str = " | ".join(f"{d['date']} ({d['weekday'][:3]}) avg={d['avg']}" for d in t3)
        print(f"  {mk}: {days_str}")

    print("\n" + "=" * 70)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Comprehensive patron analytics from monthly summary files."
    )
    parser.add_argument(
        "--summaries-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data", "summaries"),
        help="Directory containing YYYY-MM_summary.json files",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data", "analysis"),
        help="Directory to write big_summary.json (default: stored_data/analysis/)",
    )
    parser.add_argument(
        "--et-offset",
        type=int,
        default=-4,
        help="UTC→Eastern offset in hours: -4 for EDT (summer), -5 for EST (winter). "
             "Default: -4",
    )
    args = parser.parse_args()
    run(
        summaries_dir=os.path.abspath(args.summaries_dir),
        output_dir=os.path.abspath(args.output_dir),
        et_offset=args.et_offset,
    )


if __name__ == "__main__":
    main()
