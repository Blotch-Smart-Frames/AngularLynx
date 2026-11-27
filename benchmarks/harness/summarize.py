#!/usr/bin/env python3
"""Prints the median, p90 and run count of each metric per app, as a Markdown
table, from one or more of the harness's CSVs.

    python3 summarize.py ../results/ios/launch-*.csv
    python3 summarize.py ../results/ios/scroll-*.csv

Each app's launches are split by what ran before: "again" right after its
own last launch (iOS still has its files in memory, about 80 ms faster) and
"after other" after the other app's. The harness alternates A B, B A, so each
app has about half of each. The order comes from each row's timestamp.

A scroll CSV (ios_scroll.py, a row per swipe) is summed per launch first,
as the website charts it: hitch milliseconds per second scrolled, frames
per second scrolled, CPU milliseconds per swipe, and the memory after the
last swipe. Its launches aren't split by what ran before: each run starts a
new process and measures only after the list has loaded.

Percentiles use linear interpolation between the closest ranks, as numpy's
default does. Runs where a metric is missing (a failed recording) are left
out of that metric and counted in the "failed" column.
"""

import csv
import sys
from collections import defaultdict

METRICS = ["first_frame_ms", "fully_drawn_ms", "memory_mb", "peak_memory_mb"]


def percentile(values, p):
    values = sorted(values)
    if not values:
        return None
    rank = (len(values) - 1) * p
    low = int(rank)
    high = min(low + 1, len(values) - 1)
    return values[low] + (values[high] - values[low]) * (rank - low)


SCROLL_METRICS = ["hitch_ratio", "fps", "cpu_ms_per_swipe", "memory_mb"]


def scroll_runs(rows):
    """Each launch's swipes, added up as the website does."""
    runs = defaultdict(list)
    for row in rows:
        if row.get("scroll_ms"):
            # Run numbers start again at 1 each time ios_scroll.py appends to
            # a CSV; a launch's swipes all share its timestamp.
            runs[(row["app"], row["run"], row["timestamp"])].append(row)
    for (app, _, _), swipes in runs.items():
        seconds = sum(float(s["scroll_ms"]) for s in swipes) / 1000
        last = max(swipes, key=lambda s: int(s["swipe"]))
        yield app, {
            "hitch_ratio": sum(float(s["hitch_ms"] or 0) for s in swipes) / seconds,
            "fps": sum(float(s["fps"] or 0) * float(s["scroll_ms"]) for s in swipes) / 1000 / seconds,
            "cpu_ms_per_swipe": sum(float(s["cpu_ms"] or 0) for s in swipes) / len(swipes),
            "memory_mb": float(last["memory_mb"]) if last.get("memory_mb") else None,
        }


def table(order, samples, metrics, failed):
    header = ["app", "runs"] + [f"{m} median / p90" for m in metrics] + ["failed"]
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for app in order:
        cells = [app, str(max((len(v) for v in samples[app].values()), default=0))]
        for metric in metrics:
            values = samples[app][metric]
            cells.append(
                f"{percentile(values, 0.5):.1f} / {percentile(values, 0.9):.1f}" if values else "–"
            )
        cells.append(str(failed[app]))
        print("| " + " | ".join(cells) + " |")


def main(paths):
    samples = defaultdict(lambda: defaultdict(list))
    failed = defaultdict(int)
    order = []
    scroll = False
    for path in paths:
        with open(path, newline="") as file:
            rows = list(csv.DictReader(file))
        if rows and "swipe" in rows[0]:
            scroll = True
            for app, values in scroll_runs(rows):
                if app not in order:
                    order.append(app)
                for metric, value in values.items():
                    if value is not None:
                        samples[app][metric].append(value)
            continue
        ordered = sorted(rows, key=lambda row: row["timestamp"])
        previous = None
        for row in ordered:
            condition = "again" if row["app"] == previous else "after other"
            first = previous is None
            previous = row["app"]
            if first:
                continue
            app = f"{row['app']} ({condition})"
            if app not in order:
                order.append(app)
            if not row.get("fully_drawn_ms"):
                failed[app] += 1
            for metric in METRICS:
                if row.get(metric):
                    samples[app][metric].append(float(row[metric]))
    table(order, samples, SCROLL_METRICS if scroll else METRICS, failed)


if __name__ == "__main__":
    main(sys.argv[1:])
