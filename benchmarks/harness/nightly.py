#!/usr/bin/env python3
"""The parts of the nightly Simulator benchmark (.github/workflows/
simulator-benchmarks.yml) that aren't a build or a launch: booting the
Simulator, and reading a night's CSVs into a report, a history and an alert.

    python3 nightly.py boot
    python3 nightly.py report --launch launch.csv --mount-dir ../results/ios-simulator \\
        --history history.jsonl --commit <sha> --run-url <url> \\
        --summary summary.md --alert alert.md

`boot` creates (once) and boots a Simulator named "AngularLynx Benchmarks"
and prints its UDID.

`report` reads one night's launches of the Pokédex (ios_launch.py) and its
mount screens (ios_mount.py, `mount-<date>-<kind>-<count>-react-lynx.csv`),
and works out, for AngularLynx and ReactLynx:

- the Pokédex's median fully drawn time and memory
- the cost of each view, text and image: (median of the 5,000-element
  screen - median of the 1,500-element screen) / 3,500

A Simulator's times aren't a phone's, and a CI runner's host moves them by
5-30% from one night to the next, so what's tracked is the ratio of each,
AngularLynx / ReactLynx: both apps run in the same session, on the same
shell, in turn, so the host's share cancels out of the ratio. The night is
appended to --history (one JSON object per line) and written to --summary as
Markdown, with the nights before it.

A ratio that has moved more than --threshold (10%) from its baseline (the
median of the --window nights before the last --nights) on each of the last
--nights nights (3) is a sustained change: one night is noise, several in a
row aren't. Each one goes in --alert, which is written only when there is
one, for the workflow to open an issue with.
"""

import argparse
import csv
import glob
import json
import os
import re
import statistics
import subprocess
import sys

OURS = "angular-lynx"
RIVAL = "react-lynx"
NAMES = {OURS: "AngularLynx", RIVAL: "ReactLynx"}
KINDS = ("view", "text", "image")
SMALL, LARGE = 1500, 5000
SIMULATOR_NAME = "AngularLynx Benchmarks"

# Each tracked measure: its label, unit and how many decimals to print. A
# higher number is worse for every one of them, so a higher ratio means
# AngularLynx has fallen behind ReactLynx.
METRICS = {
    "launch.fully_drawn_ms": ("Pokédex fully drawn", "ms", 0),
    "launch.memory_mb": ("Pokédex memory", "MB", 1),
    **{f"mount.{kind}.us_per_element": (f"Cost of a {kind}", "µs", 1) for kind in KINDS},
}


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def read_csv(path):
    with open(path, newline="") as file:
        return list(csv.DictReader(file))


def app_median(rows, app, column):
    return median(float(row[column]) for row in rows if row["app"] == app and row.get(column))


def mount_files(folder):
    """The newest mount CSV against ReactLynx for each screen, by kind and
    count. ios_mount.py names them mount-<date>-<kind>-<count>-<rival>.csv."""
    files = {}
    pattern = re.compile(rf"^mount-(\d{{4}}-\d\d-\d\d)-(\w+)-(\d+)-{RIVAL}\.csv$")
    for path in sorted(glob.glob(os.path.join(folder, f"mount-*-{RIVAL}.csv"))):
        match = pattern.match(os.path.basename(path))
        if match:
            # Sorted by name, so a later date replaces an earlier one.
            files[(match.group(2), int(match.group(3)))] = path
    return files


def night(launch_rows, mount_rows, date, commit, run_url):
    """One night's record: each metric's value for each app, and what the
    rows say about the host. mount_rows maps (kind, count) to its rows."""
    metrics = {}
    for column, metric in (("fully_drawn_ms", "launch.fully_drawn_ms"), ("memory_mb", "launch.memory_mb")):
        metrics[metric] = {app: app_median(launch_rows, app, column) for app in (OURS, RIVAL)}
    for kind in KINDS:
        small = mount_rows.get((kind, SMALL))
        large = mount_rows.get((kind, LARGE))
        if small is None or large is None:
            continue
        costs = {}
        for app in (OURS, RIVAL):
            a = app_median(small, app, "fully_drawn_ms")
            b = app_median(large, app, "fully_drawn_ms")
            # Milliseconds over 3,500 elements, in microseconds each.
            costs[app] = (b - a) / (LARGE - SMALL) * 1000 if a is not None and b is not None else None
        metrics[f"mount.{kind}.us_per_element"] = costs
    all_rows = launch_rows + [row for rows in mount_rows.values() for row in rows]
    launches = {
        app: sum(1 for row in launch_rows if row["app"] == app and row.get("fully_drawn_ms")) for app in (OURS, RIVAL)
    }
    failed = sum(1 for row in all_rows if not row.get("fully_drawn_ms"))
    first = next((row for row in all_rows if row.get("device")), {})
    return {
        "date": date,
        "commit": commit,
        "run": run_url,
        "device": first.get("device", ""),
        "os_build": first.get("os_build", ""),
        "cores": os.cpu_count(),
        "host_load": median(float(row["host_load"]) for row in all_rows if row.get("host_load")),
        "launches": launches,
        "failed": failed,
        "metrics": metrics,
    }


def ratio(record, metric):
    """AngularLynx / ReactLynx for the metric on a night, or None. A cost of
    zero or less is noise (the two screens' medians crossed), not a cost."""
    values = record.get("metrics", {}).get(metric) or {}
    ours, rival = values.get(OURS), values.get(RIVAL)
    if ours is None or rival is None or ours <= 0 or rival <= 0:
        return None
    return ours / rival


def sustained_changes(history, nights=3, window=14, threshold=0.10, min_baseline=3):
    """Each metric whose ratio was more than threshold off its baseline, the
    same way, on each of the last `nights` nights, the last of them being the
    newest night in the history. The baseline is the median ratio of up to
    `window` nights before those, and needs at least min_baseline of them."""
    if not history:
        return []
    newest = history[-1]
    changes = []
    for metric in METRICS:
        series = [(record, ratio(record, metric)) for record in history]
        series = [(record, value) for record, value in series if value is not None]
        # Tonight's ratio has to be one of them: a night that measured
        # nothing for this metric says nothing about it.
        if len(series) < nights + min_baseline or series[-1][0] is not newest:
            continue
        recent = series[-nights:]
        before = series[-nights - window : -nights]
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
                # The last night before the change, so the alert can name the
                # commits it came in with.
                "since": before[-1][0]["commit"],
                "nights": [{"date": r["date"], "commit": r["commit"], "ratio": v} for r, v in recent],
            }
        )
    return changes


def fmt(value, decimals):
    return "–" if value is None else f"{value:,.{decimals}f}"


def percent(move):
    return f"{move * 100:+.1f}%"


def baseline_of(history, metric, window):
    """The median ratio of up to `window` nights before tonight, for the
    summary's comparison of tonight with them."""
    values = [ratio(record, metric) for record in history[:-1]][-window:]
    return median(values)


def short(commit):
    return commit[:7] if commit else "–"


def summary(history, changes, nights, window, threshold):
    tonight = history[-1]
    lines = [
        "## Simulator benchmarks: AngularLynx / ReactLynx",
        "",
        f"`{short(tonight['commit'])}` on {tonight['device'] or 'the Simulator'} "
        f"({tonight['os_build'] or 'unknown iOS'}), a host with {tonight['cores']} cores "
        f"(median load {fmt(tonight['host_load'], 1)}). "
        f"{tonight['launches'].get(OURS, 0)} Pokédex launches of AngularLynx and "
        f"{tonight['launches'].get(RIVAL, 0)} of ReactLynx; {tonight['failed']} runs drew nothing.",
        "",
        "A Simulator's times aren't a phone's, and the host moves them from night to night: compare the "
        "ratios, which the host's share mostly cancels out of. The baseline is the median ratio of the "
        f"{window} nights before.",
        "",
        "| Measure | AngularLynx | ReactLynx | AngularLynx / ReactLynx | Baseline | Change |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for metric, (label, unit, decimals) in METRICS.items():
        values = tonight["metrics"].get(metric)
        if values is None:
            continue
        value = ratio(tonight, metric)
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
            f"last {nights} nights.",
        ]
    earlier = history[-window:]
    if len(earlier) > 1:
        tracked = [m for m in METRICS if any(ratio(record, m) is not None for record in earlier)]
        lines += [
            "",
            f"### The last {len(earlier)} nights, AngularLynx / ReactLynx",
            "",
            "| Night | Commit | " + " | ".join(METRICS[m][0] for m in tracked) + " |",
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
        for n in change["nights"]
    )
    return (
        f"- **{label}**: AngularLynx has been {how} against "
        f"ReactLynx for {len(change['nights'])} nights: a ratio of {moves}, against a baseline of "
        f"{change['baseline']:.2f}."
    )


def alert(history, changes, run_url, nights, window, threshold):
    since, first = changes[0]["since"], changes[0]["nights"][0]["commit"]
    lines = [
        f"The nightly Simulator benchmark ({run_url}) has measured a sustained change in AngularLynx against "
        f"ReactLynx: each ratio below has been more than {threshold:.0%} off its baseline (the median of the "
        f"{window} nights before) on each of the last {nights} nights.",
        "",
        *[describe(change) for change in changes],
        "",
        f"It came in with the commits after the last night before them, `{short(since)}`, up to the first of "
        f"them, `{short(first)}`: `git log {short(since)}..{short(first)}`. A higher ratio means AngularLynx is "
        "slower or uses more memory than it did against ReactLynx; a lower one that it got faster or lighter, "
        "or that ReactLynx got slower (its version is pinned in `benchmarks/apps/react-lynx`), or that a screen "
        "stopped drawing all it should.",
        "",
        "To check on a Mac, build each commit's app and launch the two builds in turn on one Simulator "
        "(`benchmarks/README.md`, On the iOS Simulator).",
        "",
        summary(history, changes, nights, window, threshold),
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
    # A night run twice (a re-run) replaces its first record.
    history = [record for record in history if record.get("run") != args.run_url or not args.run_url]
    history.append(night(launch_rows, mount_rows, date, args.commit, args.run_url))
    if args.history:
        with open(args.history, "w") as file:
            for record in history:
                file.write(json.dumps(record, ensure_ascii=False) + "\n")
    changes = sustained_changes(history, args.nights, args.window, args.threshold)
    text = summary(history, changes, args.nights, args.window, args.threshold)
    if args.summary:
        with open(args.summary, "a") as file:
            file.write(text)
    else:
        print(text)
    if args.alert:
        if changes:
            with open(args.alert, "w") as file:
                file.write(alert(history, changes, args.run_url, args.nights, args.window, args.threshold))
        elif os.path.exists(args.alert):
            os.remove(args.alert)
    # An app with no value for a measure drew nothing on every run of it (a
    # build that broke the screen, or a harness that measured nothing). The
    # summary says which; the exit makes the night a failure.
    missing = [
        f"{METRICS[metric][0]} ({NAMES[app]})"
        for metric, values in history[-1]["metrics"].items()
        for app, value in values.items()
        if value is None
    ]
    if missing:
        raise SystemExit("No measurement of " + ", ".join(missing))


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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("boot", help="create and boot the Simulator, and print its UDID").set_defaults(run=boot)
    reporting = commands.add_parser("report", help="read a night's CSVs into the summary, history and alert")
    reporting.set_defaults(run=report)
    reporting.add_argument("--launch", required=True, help="ios_launch.py's CSV of the Pokédex's launches")
    reporting.add_argument("--mount-dir", help="the folder ios_mount.py wrote its CSVs to")
    reporting.add_argument("--history", help="the JSON-lines history to append the night to")
    reporting.add_argument("--commit", default="", help="the commit measured")
    reporting.add_argument("--run-url", default="", help="the workflow run, linked from the history")
    reporting.add_argument("--date", help="the night's date (default: the launches' last)")
    reporting.add_argument("--summary", help="a Markdown file to append the summary to (default: print it)")
    reporting.add_argument("--alert", help="a Markdown file to write a sustained change to, for an issue")
    reporting.add_argument("--nights", type=int, default=3, help="nights in a row a change has to last")
    reporting.add_argument("--window", type=int, default=14, help="nights before them that make the baseline")
    reporting.add_argument("--threshold", type=float, default=0.10, help="how far off the baseline counts")
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
