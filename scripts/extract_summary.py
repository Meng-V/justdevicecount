#!/usr/bin/env python3
"""
extract_summary.py — Summarise stored_data JSON files.

Reads every *_device_data.json file under stored_data/, extracts only
  • timeStamp   (ISO-8601 string, UTC)
  • patrons     (int)
  • countByFloor (list[int]: [ground, first, second, third])

then writes one compact summary file per calendar month into
stored_data/summaries/  named  YYYY-MM_summary.json.

Each output file is a list of objects, sorted chronologically:
  [
    {
      "timeStamp":    "2025-10-01T08:00:00.000Z",
      "patrons":      142,
      "countByFloor": [12, 55, 48, 27]
    },
    ...
  ]

Usage:
    python3 scripts/extract_summary.py

Optional flags:
    --input-dir  PATH    directory containing raw *_device_data.json files
                         (default: stored_data/)
    --output-dir PATH    where to write summary files
                         (default: stored_data/summaries/)
    --overwrite          overwrite existing summary files (default: skip)
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

FLOOR_NAMES = ["ground", "first", "second", "third"]


def parse_timestamp(ts_str: str) -> datetime:
    """Parse an ISO-8601 string (with or without trailing Z) into a UTC datetime."""
    ts_str = ts_str.rstrip("Z")
    # Handle both milliseconds (.000) and no fractional seconds
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(ts_str, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError(f"Unrecognised timestamp format: {ts_str!r}")


def month_key(dt: datetime) -> str:
    """Return 'YYYY-MM' for a datetime."""
    return dt.strftime("%Y-%m")


def extract_record(raw: dict) -> dict | None:
    """
    Pull timeStamp / patrons / countByFloor from a raw DB record.
    Returns None if any required field is missing or malformed.
    """
    try:
        ts_str       = raw["timeStamp"]
        patrons      = int(raw["patrons"])
        count_by_floor = raw["countByFloor"]

        if not isinstance(count_by_floor, list):
            raise ValueError("countByFloor is not a list")

        # Normalise to exactly 4 ints (pad with 0 if shorter, truncate if longer)
        count_by_floor = [int(x) for x in count_by_floor]
        while len(count_by_floor) < 4:
            count_by_floor.append(0)
        count_by_floor = count_by_floor[:4]

        dt = parse_timestamp(ts_str)

        return {
            "timeStamp":    dt.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
            "patrons":      patrons,
            "countByFloor": count_by_floor,
        }
    except (KeyError, ValueError, TypeError) as exc:
        return None          # Caller will count and report skipped records


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run(input_dir: str, output_dir: str, overwrite: bool) -> None:
    os.makedirs(output_dir, exist_ok=True)

    # Collect all raw *_device_data.json files
    source_files = sorted(
        f for f in os.listdir(input_dir)
        if f.endswith("_device_data.json")
    )

    if not source_files:
        print(f"[extract_summary] No *_device_data.json files found in {input_dir!r}. Exiting.")
        sys.exit(0)

    print(f"[extract_summary] Found {len(source_files)} input file(s) in {input_dir!r}")
    print()

    # Month bucket: YYYY-MM → list of extracted records
    buckets: dict[str, list[dict]] = defaultdict(list)
    total_read    = 0
    total_skipped = 0

    for filename in source_files:
        filepath = os.path.join(input_dir, filename)
        try:
            with open(filepath, encoding="utf-8") as fh:
                raw_records = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"  [WARN] Could not read {filename}: {exc}")
            continue

        file_read    = 0
        file_skipped = 0

        for raw in raw_records:
            record = extract_record(raw)
            if record is None:
                file_skipped += 1
                total_skipped += 1
                continue

            dt  = parse_timestamp(record["timeStamp"])
            key = month_key(dt)
            buckets[key].append(record)
            file_read    += 1
            total_read   += 1

        print(f"  {filename}: {file_read} extracted, {file_skipped} skipped")

    print()

    # Write one output file per month
    months_written = 0
    months_skipped = 0

    for month in sorted(buckets.keys()):
        out_filename = f"{month}_summary.json"
        out_path     = os.path.join(output_dir, out_filename)

        if os.path.exists(out_path) and not overwrite:
            print(f"  [SKIP] {out_filename} already exists (use --overwrite to replace)")
            months_skipped += 1
            continue

        records = sorted(buckets[month], key=lambda r: r["timeStamp"])

        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(records, fh, indent=2)

        # Quick stats for the month
        patron_values = [r["patrons"] for r in records]
        cbf_totals    = [
            sum(r["countByFloor"][i] for r in records) // len(records)
            for i in range(4)
        ]
        avg_patrons   = sum(patron_values) // len(patron_values)
        peak_patrons  = max(patron_values)

        print(
            f"  {out_filename}: {len(records)} records | "
            f"avg {avg_patrons} patrons | "
            f"peak {peak_patrons} patrons | "
            f"avg floor [{', '.join(str(x) for x in cbf_totals)}]"
        )
        months_written += 1

    # Summary
    print()
    print("=" * 60)
    print("  Done.")
    print(f"  Input  records : {total_read} extracted, {total_skipped} skipped")
    print(f"  Output files   : {months_written} written, {months_skipped} skipped")
    print(f"  Output dir     : {os.path.abspath(output_dir)}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract timeStamp/patrons/countByFloor from stored_data/ files "
                    "and write one summary JSON per month."
    )
    parser.add_argument(
        "--input-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data"),
        help="Directory containing raw *_device_data.json files (default: stored_data/)",
    )
    parser.add_argument(
        "--output-dir",
        default=os.path.join(os.path.dirname(__file__), "..", "stored_data", "summaries"),
        help="Directory to write YYYY-MM_summary.json files (default: stored_data/summaries/)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing summary files (default: skip them)",
    )
    args = parser.parse_args()

    run(
        input_dir  = os.path.abspath(args.input_dir),
        output_dir = os.path.abspath(args.output_dir),
        overwrite  = args.overwrite,
    )


if __name__ == "__main__":
    main()
