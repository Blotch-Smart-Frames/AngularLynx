#!/usr/bin/env python3
"""Prints the median, p90 and count of the tap benchmarks per app, as
Markdown tables, from ios_tap.py's CSVs.

    python3 summarize_taps.py ../results/ios/tap-*.csv ../results/ios/update-*.csv \\
        ../results/ios/first-tap-*.csv

- tap, update and busy: per app (and per button for update), from the touch
  reaching the app to the frame that shows the change (frame_ms), and to the
  commit that carries it (commit_ms). A tap with no frame (the app never
  showed a change) is counted under "missed". For busy, also the frames its
  box stood still in the half second after the touch, and before it.
- first-tap: per app, from the process starting to the frame of the first
  change a tap made (first_change_ms), to fully drawn, and how many taps
  went unanswered before it. A launch no tap changed is counted under
  "unanswered".

Runs the harness couldn't measure have an `error` and are left out.

Each file is one session, so its apps are compared within it.
"""

import csv
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from summarize import percentile  # noqa: E402

BUTTONS = ["1 row", "every 10th", "every row"]


def stat(values):
    if not values:
        return "–"
    return f"{percentile(values, 0.5):.1f} / {percentile(values, 0.9):.1f}"


def taps(path, rows):
    update = rows and rows[0]["bench"] == "update"
    busy = rows and rows[0]["bench"] == "busy"
    groups = defaultdict(lambda: {"frame": [], "commit": [], "missed": 0, "stalled": [], "idle": [], "longest": []})
    order = []
    for row in rows:
        # A run the harness couldn't measure (its error says why) has no taps.
        if row.get("error"):
            continue
        key = row["app"] + (f" ({BUTTONS[int(row['button'])]})" if update and row.get("button") else "")
        if key not in order:
            order.append(key)
        if row.get("frame_ms"):
            groups[key]["frame"].append(float(row["frame_ms"]))
            groups[key]["commit"].append(float(row["commit_ms"]))
        else:
            groups[key]["missed"] += 1
        if busy and row.get("stalled_frames"):
            groups[key]["stalled"].append(float(row["stalled_frames"]))
            groups[key]["idle"].append(float(row["idle_stalled_frames"]))
            groups[key]["longest"].append(float(row["longest_stall_ms"]))
    print(f"### {os.path.basename(path)}\n")
    extra = " | frames the box stood still after the tap median / p90 | longest stall median / p90 (ms) | stood still before it median / p90" if busy else ""
    print(f"| app | taps | tap to frame median / p90 (ms) | tap to commit median / p90 (ms) | missed{extra} |")
    print("|---|---|---|---|---|" + ("---|---|---|" if busy else ""))
    for key in sorted(order):
        g = groups[key]
        cells = f"| {key} | {len(g['frame'])} | {stat(g['frame'])} | {stat(g['commit'])} | {g['missed']}"
        if busy:
            cells += f" | {stat(g['stalled'])} | {stat(g['longest'])} | {stat(g['idle'])}"
        print(cells + " |")
    print()


def first_taps(path, rows):
    groups = defaultdict(lambda: defaultdict(list))
    launches = defaultdict(int)
    order = []
    for row in rows:
        if row.get("error"):
            continue
        if row["app"] not in order:
            order.append(row["app"])
        launches[row["app"]] += 1
        for metric in ("first_change_ms", "fully_drawn_ms", "taps_before", "tap_to_frame_ms"):
            if row.get(metric):
                groups[row["app"]][metric].append(float(row[metric]))
    print(f"### {os.path.basename(path)}\n")
    print("| app | runs | unanswered | first change median / p90 (ms) | fully drawn median / p90 (ms) | taps before it median / p90 | its tap to frame median / p90 (ms) |")
    print("|---|---|---|---|---|---|---|")
    for app in order:
        g = groups[app]
        print(
            f"| {app} | {launches[app]} | {launches[app] - len(g['first_change_ms'])} "
            f"| {stat(g['first_change_ms'])} | {stat(g['fully_drawn_ms'])} "
            f"| {stat(g['taps_before'])} | {stat(g['tap_to_frame_ms'])} |"
        )
    print()


def main(paths):
    for path in paths:
        with open(path, newline="") as file:
            rows = list(csv.DictReader(file))
        if rows and rows[0]["bench"] == "first-tap":
            first_taps(path, rows)
        else:
            taps(path, rows)


if __name__ == "__main__":
    main(sys.argv[1:])
