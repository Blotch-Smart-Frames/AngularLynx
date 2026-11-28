#!/usr/bin/env python3
"""The parts of the Simulator benchmark's workflow (.github/workflows/
simulator-benchmarks.yml) that aren't a build or a launch: booting the
Simulator, and reading a run's CSVs into a report, a history and an alert.

    python3 track.py boot
    python3 track.py shutdown
    python3 track.py report --launch launch.csv --mount-dir ../results/ios-simulator \\
        --history history.jsonl --commit <sha> --run-url <url> \\
        --summary summary.md --alert alert.md

`boot` creates (once) and boots a Simulator named "AngularLynx Benchmarks"
and prints its UDID, and `shutdown` shuts it down.

`report` reads one run's launches of the Pokédex (ios_launch.py) and its
mount screens (ios_mount.py, `mount-<date>-<kind>-<count>-react-lynx.csv`),
and works out, for AngularLynx and ReactLynx:

- the Pokédex's median fully drawn time and memory
- the cost of each view, text and image: (fastest launch of the kind's
  largest screen - fastest launch of its smallest) / the elements between
  them. On the Simulator, ios_mount.py launches 1,500 and 15,000 (#882).

The costs per element take each screen's fastest launch rather than its
median because the difference of two launches is small against the
launches: the Simulator's launch alone takes 1.6-2 s, and the host only ever
adds to it, a few launches in ten by up to a second. Those pulled a median
of 10 up by 100-200 ms on one screen and not the other, and gave costs below
zero. The fastest launch is the one the host held up least: in one session,
each AngularLynx cost from 1,500 and 5,000 elements came within 3% of the
same cost from 1,500 and 15,000.

A Simulator's times aren't a phone's, and the host moves them by 5-30% from
one run to the next, so what's tracked is the ratio of each, AngularLynx /
ReactLynx: both apps run in the same session, on the same shell, in turn, so
the host's share cancels out of the ratio. The run is appended to --history
(one JSON object per line, one a day) and written to --summary as Markdown,
with the days before it.

A ratio that has moved more than --threshold (10%) from its baseline (the
median of the --window days before the last --days) on each of the last
--days days measured (3) is a sustained change: one day is noise, several in
a row aren't. Each one goes in --alert, which is written only when there is
one, for the workflow to open an issue with.
"""

import argparse
import csv
import glob
import json
import math
import os
import re
import statistics
import subprocess
import sys

OURS = "angular-lynx"
RIVAL = "react-lynx"
NAMES = {OURS: "AngularLynx", RIVAL: "ReactLynx"}
KINDS = ("view", "text", "image")
SIMULATOR_NAME = "AngularLynx Benchmarks"

# Each tracked measure: its label, unit and how many decimals to print. A
# higher number is worse for every one of them, so a higher ratio means
# AngularLynx has fallen behind ReactLynx.
METRICS = {
    "launch.fully_drawn_ms": ("Pokédex fully drawn", "ms", 0),
    "launch.memory_mb": ("Pokédex memory", "MB", 1),
    **{f"mount.{kind}.us_per_element": (f"Cost of {'an' if kind == 'image' else 'a'} {kind}", "µs", 1) for kind in KINDS},
}


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def read_csv(path):
    with open(path, newline="") as file:
        return list(csv.DictReader(file))


def number(text):
    """A CSV cell's number, or None for an empty cell or one that isn't a
    finite number: json.dumps would write NaN or Infinity into the history,
    which isn't JSON, and a NaN would pass for a measurement."""
    try:
        value = float(text)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def app_median(rows, app, column):
    return median(number(row.get(column)) for row in rows if row["app"] == app)


def app_fastest(rows, app, column):
    values = [value for value in (number(row.get(column)) for row in rows if row["app"] == app) if value is not None]
    return min(values) if values else None


def mount_files(folder):
    """The mount CSVs against ReactLynx of each kind's newest date, by kind
    and count. ios_mount.py names them mount-<date>-<kind>-<count>-<rival>.csv.

    Only the kind's newest date: day() takes the kind's smallest and largest
    counts, whichever they are, so an earlier run's 15,000-element CSV left
    in the folder would otherwise pair with a later run's 1,500, a cost from
    two sessions. The date is ios_mount.py's, the Mac's own, so it's taken
    from the names rather than matched to the launches' timestamps (UTC)."""
    found = {}
    pattern = re.compile(rf"^mount-(\d{{4}}-\d\d-\d\d)-(\w+)-(\d+)-{RIVAL}\.csv$")
    for path in glob.glob(os.path.join(folder, f"mount-*-{RIVAL}.csv")):
        match = pattern.match(os.path.basename(path))
        if match:
            found[(match.group(1), match.group(2), int(match.group(3)))] = path
    newest = {}
    for date, kind, _ in found:
        newest[kind] = max(newest.get(kind, date), date)
    return {(kind, count): path for (date, kind, count), path in found.items() if date == newest[kind]}


def day(launch_rows, mount_rows, date, commit, run_url):
    """One day's record: each metric's value for each app, and what the
    rows say about the host. mount_rows maps (kind, count) to its rows."""
    metrics = {}
    for column, metric in (("fully_drawn_ms", "launch.fully_drawn_ms"), ("memory_mb", "launch.memory_mb")):
        metrics[metric] = {app: app_median(launch_rows, app, column) for app in (OURS, RIVAL)}
    counts = {}
    for kind in KINDS:
        # The kind's smallest and largest screens, whichever ios_mount.py
        # ran: the counts aren't fixed, so a run on other counts still
        # works out a cost per element rather than none.
        sizes = sorted(count for k, count in mount_rows if k == kind)
        if len(sizes) < 2:
            continue
        small, large = sizes[0], sizes[-1]
        costs = {}
        for app in (OURS, RIVAL):
            a = app_fastest(mount_rows[(kind, small)], app, "fully_drawn_ms")
            b = app_fastest(mount_rows[(kind, large)], app, "fully_drawn_ms")
            # Milliseconds over the elements between them, in microseconds
            # each.
            costs[app] = (b - a) / (large - small) * 1000 if a is not None and b is not None else None
        metrics[f"mount.{kind}.us_per_element"] = costs
        counts[kind] = [small, large]
    all_rows = launch_rows + [row for rows in mount_rows.values() for row in rows]
    launches = {
        app: sum(1 for row in launch_rows if row["app"] == app and number(row.get("fully_drawn_ms")) is not None)
        for app in (OURS, RIVAL)
    }
    failed = sum(1 for row in all_rows if number(row.get("fully_drawn_ms")) is None)
    first = next((row for row in all_rows if row.get("device")), {})
    return {
        "date": date,
        "commit": commit,
        "run": run_url,
        "device": first.get("device", ""),
        "os_build": first.get("os_build", ""),
        "cores": os.cpu_count(),
        "host_load": median(number(row.get("host_load")) for row in all_rows),
        "launches": launches,
        "failed": failed,
        # Which screens each cost came from: a cost from 1,500 and 5,000
        # elements isn't one from 1,500 and 15,000, whose launches' noise
        # weighs less on it.
        "mount_counts": counts,
        "metrics": metrics,
    }


def ratio(record, metric):
    """AngularLynx / ReactLynx for the metric on a day, or None. A cost of
    zero or less is noise (the two screens' launches crossed), not a cost."""
    values = record.get("metrics", {}).get(metric) or {}
    ours, rival = values.get(OURS), values.get(RIVAL)
    if ours is None or rival is None or ours <= 0 or rival <= 0:
        return None
    return ours / rival


def sustained_changes(history, days=3, window=14, threshold=0.10, min_baseline=3):
    """Each metric whose ratio was more than threshold off its baseline, the
    same way, on each of the last `days` days in the history. The
    baseline is the median ratio of up to `window` days before those that
    have one, and needs at least min_baseline of them."""
    changes = []
    for metric in METRICS:
        recent = [(record, ratio(record, metric)) for record in history[-days:]]
        # Each of the last days needs a ratio: one that measured nothing
        # for this metric (no screen, or a cost that came out zero or less)
        # breaks the run of days rather than being skipped.
        if len(recent) < days or any(value is None for _, value in recent):
            continue
        before = [(record, ratio(record, metric)) for record in history[:-days]]
        before = [(record, value) for record, value in before if value is not None][-window:]
        if len(before) < min_baseline:
            continue
        baseline = median(value for _, value in before)
        moves = [value / baseline - 1 for _, value in recent]
        if all(move > threshold for move in moves):
            direction = "up"
        elif all(move < -threshold for move in moves):
            direction = "down"
        else:
            continue
        changes.append(
            {
                "metric": metric,
                "direction": direction,
                "baseline": baseline,
                # The last day before the change, so the alert can name the
                # commits it came in with.
                "since": before[-1][0]["commit"],
                "days": [{"date": r["date"], "commit": r["commit"], "ratio": v} for r, v in recent],
            }
        )
    return changes


def fmt(value, decimals):
    return "–" if value is None else f"{value:,.{decimals}f}"


def percent(move):
    return f"{move * 100:+.1f}%"


def baseline_of(history, metric, window):
    """The median ratio of up to `window` days before the latest, for the
    summary's comparison of the latest with them."""
    values = [ratio(record, metric) for record in history[:-1]][-window:]
    return median(values)


def short(commit):
    return commit[:7] if commit else "–"


def screens_note(record):
    """Which screens the day's costs per element came from, as a sentence."""
    counts = record.get("mount_counts") or {}
    if not counts:
        return ""
    pairs = {tuple(pair) for pair in counts.values()}
    if len(pairs) == 1:
        [(small, large)] = pairs
        return (
            f" Each cost per element is from the fastest launch of the {small:,}- and {large:,}-element "
            "screens."
        )
    each = ", ".join(f"{kind} {small:,} and {large:,}" for kind, (small, large) in counts.items())
    return f" The costs per element are from the fastest launch of these screens: {each}."


def summary(history, changes, days, window, threshold):
    latest = history[-1]
    lines = [
        "## Simulator benchmarks: AngularLynx / ReactLynx",
        "",
        f"`{short(latest['commit'])}` on {latest['device'] or 'the Simulator'} "
        f"({latest['os_build'] or 'unknown iOS'}), a host with {latest['cores']} cores "
        f"(median load {fmt(latest['host_load'], 1)}). "
        f"{latest['launches'].get(OURS, 0)} Pokédex launches of AngularLynx and "
        f"{latest['launches'].get(RIVAL, 0)} of ReactLynx; {latest['failed']} runs drew nothing.",
        "",
        "A Simulator's times aren't a phone's, and the host moves them from one run to the next: compare the "
        "ratios, which the host's share mostly cancels out of. The baseline is the median ratio of the "
        f"{window} days before.{screens_note(latest)}",
        "",
        "| Measure | AngularLynx | ReactLynx | AngularLynx / ReactLynx | Baseline | Change |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for metric, (label, unit, decimals) in METRICS.items():
        values = latest["metrics"].get(metric)
        if values is None:
            continue
        value = ratio(latest, metric)
        baseline = baseline_of(history, metric, window)
        move = value / baseline - 1 if value is not None and baseline else None
        lines.append(
            f"| {label} | {fmt(values.get(OURS), decimals)} {unit} | {fmt(values.get(RIVAL), decimals)} {unit} "
            f"| {fmt(value, 2)} | {fmt(baseline, 2)} | {percent(move) if move is not None else '–'} |"
        )
    if changes:
        lines += ["", "### Sustained changes", ""]
        lines += [describe(change) for change in changes]
    else:
        lines += [
            "",
            f"No sustained change: no ratio has been more than {threshold:.0%} off its baseline on each of the "
            f"last {days} days measured.",
        ]
    earlier = history[-window:]
    if len(earlier) > 1:
        tracked = [m for m in METRICS if any(ratio(record, m) is not None for record in earlier)]
        lines += [
            "",
            f"### The last {len(earlier)} days, AngularLynx / ReactLynx",
            "",
            "| Day | Commit | " + " | ".join(METRICS[m][0] for m in tracked) + " |",
            "|---|---|" + "---:|" * len(tracked),
        ]
        for record in reversed(earlier):
            commit = short(record["commit"])
            link = f"[`{commit}`]({record['run']})" if record.get("run") else f"`{commit}`"
            cells = [fmt(ratio(record, m), 2) for m in tracked]
            lines.append(f"| {record['date']} | {link} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def describe(change):
    label, unit, _ = METRICS[change["metric"]]
    worse = change["direction"] == "up"
    if unit == "MB":
        how = "heavier" if worse else "lighter"
    else:
        how = "slower" if worse else "faster"
    moves = ", ".join(
        f"{n['date']} `{short(n['commit'])}` {n['ratio']:.2f} ({percent(n['ratio'] / change['baseline'] - 1)})"
        for n in change["days"]
    )
    return (
        f"- **{label}**: AngularLynx has been {how} against "
        f"ReactLynx on the last {len(change['days'])} days it ran: a ratio of {moves}, against a baseline of "
        f"{change['baseline']:.2f}."
    )


def alert(history, changes, run_url, days, window, threshold):
    since, first = changes[0]["since"], changes[0]["days"][0]["commit"]
    lines = [
        f"The Simulator benchmark ({run_url}) has measured a sustained change in AngularLynx against "
        f"ReactLynx: each ratio below has been more than {threshold:.0%} off its baseline (the median of the "
        f"{window} days before) on each of the last {days} days it ran.",
        "",
        *[describe(change) for change in changes],
        "",
        f"It came in with the commits after the last day before them, `{short(since)}`, up to the first of "
        f"them, `{short(first)}`: `git log {short(since)}..{short(first)}`. A higher ratio means AngularLynx is "
        "slower or uses more memory than it did against ReactLynx; a lower one that it got faster or lighter, "
        "or that ReactLynx got slower (its version is pinned in `benchmarks/apps/react-lynx`), or that a screen "
        "stopped drawing all it should.",
        "",
        "To check on a Mac, build each commit's app and launch the two builds in turn on one Simulator "
        "(`benchmarks/README.md`, On the iOS Simulator).",
        "",
        summary(history, changes, days, window, threshold),
    ]
    return "\n".join(lines)


def read_history(path):
    if not path or not os.path.exists(path):
        return []
    with open(path) as file:
        return [json.loads(line) for line in file if line.strip()]


def report(args):
    launch_rows = read_csv(args.launch)
    mount_rows = {key: read_csv(path) for key, path in mount_files(args.mount_dir).items()} if args.mount_dir else {}
    date = args.date or max((row["timestamp"][:10] for row in launch_rows if row.get("timestamp")), default="")
    history = read_history(args.history)
    # A history has one record a day, the latest run's: a re-run, or a run
    # by hand on master the same day, replaces the day's earlier record,
    # so three runs in a day can't pass for three days.
    history = [
        record
        for record in history
        if record.get("date") != date and (not args.run_url or record.get("run") != args.run_url)
    ]
    history.append(day(launch_rows, mount_rows, date, args.commit, args.run_url))
    # An app with no value for a measure drew nothing on every run of it (a
    # build that broke the screen, or a harness that measured nothing).
    missing = [
        f"{METRICS[metric][0]} ({NAMES[app]})"
        for metric, values in history[-1]["metrics"].items()
        for app, value in values.items()
        if value is None
    ]
    changes = sustained_changes(history, args.days, args.window, args.threshold)
    text = summary(history, changes, args.days, args.window, args.threshold)
    if args.summary:
        with open(args.summary, "a") as file:
            file.write(text)
    else:
        print(text)
    # The summary says what such a run measured, and the exit makes it a
    # failure. It leaves the history and the alert as they were: a run that
    # broke an app would otherwise replace the day's good record, and its
    # gap would break the run of days a sustained change needs.
    if missing:
        raise SystemExit("No measurement of " + ", ".join(missing))
    if args.history:
        with open(args.history, "w") as file:
            for record in history:
                file.write(json.dumps(record, ensure_ascii=False) + "\n")
    if args.alert:
        if changes:
            with open(args.alert, "w") as file:
                file.write(alert(history, changes, args.run_url, args.days, args.window, args.threshold))
        elif os.path.exists(args.alert):
            os.remove(args.alert)


def simctl_json(*args):
    return json.loads(subprocess.run(["xcrun", "simctl", "list", *args, "-j"], check=True, capture_output=True,
                                     text=True).stdout)


def version_key(runtime):
    return tuple(int(part) for part in re.findall(r"\d+", runtime.get("version", "")))


def simulator_choices(listing):
    """(runtime, device type) pairs to try, best first: the newest iOS
    runtime that runs a plain "iPhone <n> Pro", with that phone, then the
    others with their first iPhone. iOS 27.1 runs only the iPhone Duo, a new
    screen shape that broke the E2E tests' flows (packages/e2e/src/native/
    ios.ts), and a Pro keeps the benchmark on the same kind of phone as the
    runtimes change."""
    plain_pro = re.compile(r"^iPhone \d+ Pro$")
    runtimes = sorted(
        (r for r in listing["runtimes"] if r.get("isAvailable") and "iOS" in r["identifier"]),
        key=version_key,
        reverse=True,
    )

    def iphones(runtime):
        return [t for t in runtime.get("supportedDeviceTypes", []) if t.get("productFamily") == "iPhone"]

    with_pro = [r for r in runtimes if any(plain_pro.match(t["name"]) for t in iphones(r))]
    others = [r for r in runtimes if r not in with_pro]
    choices = []
    for runtime in with_pro + others:
        types = iphones(runtime)
        device_type = next((t for t in types if plain_pro.match(t["name"])), types[0] if types else None)
        if device_type:
            choices.append((runtime, device_type))
    return choices


def boot(_args):
    listing = simctl_json()
    choices = simulator_choices(listing)
    if not choices:
        raise SystemExit("No iOS Simulator runtime with an iPhone is installed.")
    for runtime, device_type in choices:
        existing = next(
            (d for d in listing["devices"].get(runtime["identifier"], []) if d["name"] == SIMULATOR_NAME), None
        )
        udid = existing["udid"] if existing else subprocess.run(
            ["xcrun", "simctl", "create", SIMULATOR_NAME, device_type["identifier"], runtime["identifier"]],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        if not existing or existing["state"] != "Booted":
            # Fails harmlessly when it's already booting.
            subprocess.run(["xcrun", "simctl", "boot", udid], capture_output=True)
        # GitHub's runners sometimes fail to boot one ("Data Migration
        # Failed"): try the next runtime, as the E2E tests do.
        status = subprocess.run(["xcrun", "simctl", "bootstatus", udid, "-b"], capture_output=True, text=True)
        if status.returncode == 0:
            print(f"Booted {device_type['name']} on {runtime['name']} ({udid})", file=sys.stderr)
            print(udid)
            return
        print(f"{device_type['name']} didn't boot on {runtime['name']}; trying another runtime", file=sys.stderr)
        subprocess.run(["xcrun", "simctl", "delete", udid], capture_output=True)
    raise SystemExit("The Simulator didn't boot on any installed runtime.")


def shutdown(_args):
    """Shut down every Simulator with the benchmark's name that isn't shut
    down, and no other: a Mac of your own may be running its own. That
    includes one still booting: a run that failed early stops `boot`, but
    the boot it started goes on."""
    for devices in simctl_json("devices")["devices"].values():
        for device in devices:
            if device["name"] == SIMULATOR_NAME and device["state"] != "Shutdown":
                subprocess.run(["xcrun", "simctl", "shutdown", device["udid"]], check=False)
                print(f"Shut down {device['udid']}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("boot", help="create and boot the Simulator, and print its UDID").set_defaults(run=boot)
    commands.add_parser("shutdown", help="shut the Simulator down").set_defaults(run=shutdown)
    reporting = commands.add_parser("report", help="read a run's CSVs into the summary, history and alert")
    reporting.set_defaults(run=report)
    reporting.add_argument("--launch", required=True, help="ios_launch.py's CSV of the Pokédex's launches")
    reporting.add_argument("--mount-dir", help="the folder ios_mount.py wrote its CSVs to")
    reporting.add_argument("--history", help="the JSON-lines history to append the run to")
    reporting.add_argument("--commit", default="", help="the commit measured")
    reporting.add_argument("--run-url", default="", help="the workflow run, linked from the history")
    reporting.add_argument("--date", help="the run's date (default: the launches' last)")
    reporting.add_argument("--summary", help="a Markdown file to append the summary to (default: print it)")
    reporting.add_argument("--alert", help="a Markdown file to write a sustained change to, for an issue")
    reporting.add_argument("--days", type=int, default=3, help="days measured in a row a change has to last")
    reporting.add_argument("--window", type=int, default=14, help="days before them that make the baseline")
    reporting.add_argument("--threshold", type=float, default=0.10, help="how far off the baseline counts")
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
