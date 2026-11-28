#!/usr/bin/env python3
"""Prints the median, p90 and run count of each metric per app, as a Markdown
table, from one or more of the harness's CSVs.

    python3 summarize.py ../results/ios/launch-*.csv
    python3 summarize.py ../results/ios/scroll-*.csv
    python3 summarize.py ../results/android-emulator/launch-*.csv

Each app's launches are split by what ran before: "again" right after its
own last launch (iOS still has its files in memory, about 80 ms faster) and
"after other" after the other app's. The harness alternates A B, B A, so each
app has about half of each. The order comes from each row's previous_app
column (android_launch.py, and ios_launch.py since it gained one), which also
counts the launches the CSV doesn't hold, or in an older CSV without it, from
each row's timestamp.

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
        # Each metric over the swipes that have it: a swipe the result bundle
        # gave no value for is left out of that metric, not counted as 0.
        def having(column):
            return [s for s in swipes if s.get(column)]

        def per_second(column, weight):
            measured = having(column)
            seconds = sum(float(s["scroll_ms"]) for s in measured) / 1000
            return sum(weight(s) for s in measured) / seconds if measured else None

        cpu = having("cpu_ms")
        last = max(swipes, key=lambda s: int(s["swipe"]))
        yield app, {
            "hitch_ratio": per_second("hitch_ms", lambda s: float(s["hitch_ms"])),
            "fps": per_second("fps", lambda s: float(s["fps"]) * float(s["scroll_ms"]) / 1000),
            "cpu_ms_per_swipe": sum(float(s["cpu_ms"]) for s in cpu) / len(cpu) if cpu else None,
            "memory_mb": float(last["memory_mb"]) if last.get("memory_mb") else None,
        }


def table(order, samples, metrics, failed, runs=None):
    """A Markdown table of each app's median and p90 per metric. `runs` counts
    each app's launches; without it, the longest metric's samples do."""
    header = ["app", "runs"] + [f"{m} median / p90" for m in metrics] + ["failed"]
    print("| " + " | ".join(header) + " |")
    print("|" + "---|" * len(header))
    for app in order:
        count = runs[app] if runs is not None else max((len(v) for v in samples[app].values()), default=0)
        cells = [app, str(count)]
        for metric in metrics:
            values = samples[app][metric]
            cells.append(
                f"{percentile(values, 0.5):.1f} / {percentile(values, 0.9):.1f}" if values else "–"
            )
        cells.append(str(failed[app]))
        print("| " + " | ".join(cells) + " |")


def main(paths):
    # Launch and scroll CSVs measure different things, so each kind gets its
    # own table when both are given.
    launch = (defaultdict(lambda: defaultdict(list)), defaultdict(int), [])
    scroll = (defaultdict(lambda: defaultdict(list)), defaultdict(int), [])
    # A scroll launch can lack a metric, so its metrics' samples don't count
    # its launches.
    scroll_launches = defaultdict(int)
    for path in paths:
        with open(path, newline="") as file:
            rows = list(csv.DictReader(file))
        if rows and "swipe" in rows[0]:
            samples, _, order = scroll
            for app, values in scroll_runs(rows):
                if app not in order:
                    order.append(app)
                scroll_launches[app] += 1
                for metric, value in values.items():
                    if value is not None:
                        samples[app][metric].append(value)
            continue
        samples, failed, order = launch
        ordered = sorted(rows, key=lambda row: row["timestamp"])
        previous = None
        for row in ordered:
            # The launch harnesses record the app launched before each run,
            # which may be a warm-up (android_launch.py) or a run dropped over
            # --max-load that the CSV doesn't hold. Older CSVs only have the
            # row before.
            if "previous_app" in row:
                before = row["previous_app"] or None
            else:
                before = previous
            condition = "again" if row["app"] == before else "after other"
            previous = row["app"]
            if before is None:
                continue
            app = f"{row['app']} ({condition})"
            if app not in order:
                order.append(app)
            if not row.get("fully_drawn_ms"):
                failed[app] += 1
            for metric in METRICS:
                if row.get(metric):
                    samples[app][metric].append(float(row[metric]))
    both = launch[2] and scroll[2]
    for title, (samples, failed, order), metrics, runs in (
        ("Launches", launch, METRICS, None),
        ("Scrolling", scroll, SCROLL_METRICS, scroll_launches),
    ):
        if not order:
            continue
        if both:
            print(f"\n{title}\n")
        table(order, samples, metrics, failed, runs)


if __name__ == "__main__":
    main(sys.argv[1:])
