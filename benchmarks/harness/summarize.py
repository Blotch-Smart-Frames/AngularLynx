#!/usr/bin/env python3
"""Prints the median, p90 and run count of each metric per app, as a Markdown
table, from one or more of the harness's CSVs.

    python3 summarize.py ../results/ios/launch-*.csv

Each app's launches are split by what ran before: "again" right after its
own last launch (iOS still has its files in memory, about 80 ms faster) and
"after other" after the other app's. The harness alternates A B, B A, so each
app has about half of each. The order comes from each row's timestamp.

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


def main(paths):
    samples = defaultdict(lambda: defaultdict(list))
    failed = defaultdict(int)
    order = []
    for path in paths:
        with open(path, newline="") as file:
            ordered = sorted(csv.DictReader(file), key=lambda row: row["timestamp"])
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
    header = ["app", "runs"] + [f"{m} median / p90" for m in METRICS] + ["failed"]
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for app in order:
        cells = [app, str(max((len(v) for v in samples[app].values()), default=0))]
        for metric in METRICS:
            values = samples[app][metric]
            cells.append(
                f"{percentile(values, 0.5):.1f} / {percentile(values, 0.9):.1f}" if values else "–"
            )
        cells.append(str(failed[app]))
        print("| " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main(sys.argv[1:])
