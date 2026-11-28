#!/usr/bin/env python3
"""Runs the mount benchmark: each app built to open on a screen of N views,
texts or images (BENCH_SCREEN), launched under Instruments, and timed to the
app reporting the screen drawn: from the process starting (fully_drawn_ms),
and from the screen's MountStart mark (mount_ms, ios_launch.py).

    python3 ios_mount.py --device <UDID> --rival react-native --runs 10

For each screen, it builds AngularLynx and the rival app with that screen,
installs both on the phone (AngularLynx as com.angularlynx.bench.angularlynx,
the rival as com.angularlynx.bench.rival) and launches them in turn with
ios_launch.py's light recording, appending to
../results/ios/mount-<date>-<kind>-<count>-<rival>.csv.

With --simulator, --device is a booted Simulator's UDID: the apps are built
for the Simulator, installed with simctl and launched with ios_launch.py's
--simulator mode, and the CSVs go in ../results/ios-simulator, which the
website doesn't chart. A Simulator's times aren't a phone's, but within a
session they compare: track.py works out each app's cost per element from
the 1,500- and 15,000-element screens.

The Simulator differs from a phone in two ways, both because each launch
there is mostly the Simulator's own launch, 1.6-2 s, which the host holds up
by as much as a second a few launches in ten (#882):

- Its large screens have 15,000 elements, not 5,000. On the Simulator, 3,500
  more views added less than its launches' noise, and their costs came out
  below zero; 13,500 more add from about 120 ms (ReactLynx's views) to a
  second (AngularLynx's texts).
- Each kind's screens run in one session, rather than a session each: both
  apps' builds of both screens are installed side by side, each under a
  bundle ID of its own (com.angularlynx.bench.angularlynx.m15000 and so on),
  and ios_launch.py takes all four in turn. The host's drift then falls on
  both screens alike rather than on one session and not the other. The rows
  are then split into the same per-screen CSVs.

track.py then takes each screen's fastest mount_ms, which leaves out the
launch before the screen (its docstring says why).

A phone keeps one session per screen on the two bundle IDs: a free team's
provisioning signs only so many new app IDs a week. So does a Simulator run
against a rival whose build takes its bundle ID from `expo prebuild` (the
React Native apps and Angular Native), which can't be installed under a
second.
"""

import argparse
import csv
import datetime
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCREENS = [(kind, count) for count in (1500, 5000) for kind in ("view", "text", "image")]
SIMULATOR_SCREENS = [(kind, count) for count in (1500, 15000) for kind in ("view", "text", "image")]
OURS = "com.angularlynx.bench.angularlynx"
RIVAL = "com.angularlynx.bench.rival"
# The apps whose Simulator build takes its bundle ID on the command line
# (build_ios_app.sh). The Expo apps and Angular Native take theirs from
# `expo prebuild`, so one build can't be installed under a second ID.
TAKES_BUNDLE_ID = {"angular-lynx", "react-lynx"}


def build_and_install(device, app, bundle_id, screen, simulator):
    build = ["sh", os.path.join(HERE, "build_ios_app.sh")]
    if simulator:
        build.append("--simulator")
    # Only stdout, the .app's path: build_ios_app.sh prints why a build
    # failed on stderr, which goes to this script's.
    built = subprocess.run(
        [*build, app, bundle_id, screen],
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip().splitlines()[-1]
    install = (
        ["xcrun", "simctl", "install", device, built]
        if simulator
        else ["xcrun", "devicectl", "device", "install", "app", "--device", device, built]
    )
    subprocess.run(install, check=True, capture_output=True)


def simulator_bundle_id(base, count):
    """A Simulator mount build's bundle ID: one per app and count, so a
    kind's screens can be installed side by side. The kinds share them, each
    kind's builds replacing the last's."""
    return f"{base}.m{count}"


def split_session(combined, outs, labels):
    """Splits a session's CSV, whose app column is each build's label
    (angular-lynx:5000), into the per-screen CSVs ios_launch.py would have
    written: outs maps a count to its CSV, labels a label to its (app,
    count). The app column goes back to the app's name, as the report and
    summarize.py read it, and the bundle ID still tells the builds apart. A
    previous_app that's the same build becomes its app's name, so
    summarize.py still counts that launch as following its own app; any
    other build, the same app's other screen included, stays a label,
    because that launch followed another process."""
    with open(combined, newline="") as file:
        reader = csv.DictReader(file)
        fields = reader.fieldnames or []
        rows = list(reader)
    by_count = {count: [] for count in outs}
    for row in rows:
        app, count = labels[row["app"]]
        previous = row.get("previous_app", "")
        by_count[count].append({**row, "app": app, "previous_app": app if previous == row["app"] else previous})
    for count, out in outs.items():
        new_file = not os.path.exists(out) or os.path.getsize(out) == 0
        if not new_file:
            # As ios_launch.py checks before appending: a CSV with other
            # columns would get each value under the wrong heading.
            with open(out, newline="") as existing:
                header = next(csv.reader(existing), [])
            if header != fields:
                raise SystemExit(f"{out} has other columns than ios_launch.py writes: move it out of the way")
        with open(out, "a", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=fields)
            if new_file:
                writer.writeheader()
            writer.writerows(by_count[count])


def launch(args, apps, out, mode):
    subprocess.run(
        [
            sys.executable, "-u", os.path.join(HERE, "ios_launch.py"),
            "--device", args.device,
            "--runs", str(args.runs),
            *mode,
            *[arg for name, bundle_id in apps for arg in ("--app", f"{name}={bundle_id}")],
            "--out", out,
        ],
        check=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True)
    parser.add_argument("--rival", required=True, help="a folder in ../apps")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and screen")
    parser.add_argument(
        "--screens",
        help="kind:count,... (default: each kind at 1,500 and 5,000, or with --simulator 1,500 and 15,000)",
    )
    parser.add_argument("--simulator", action="store_true", help="--device is a booted iOS Simulator")
    parser.add_argument("--max-load", help="passed to ios_launch.py")
    parser.add_argument("--max-wait", help="passed to ios_launch.py")
    parser.add_argument("--no-thermal", action="store_true", help="passed to ios_launch.py")
    args = parser.parse_args()
    screens = (
        [(s.split(":")[0], int(s.split(":")[1])) for s in args.screens.split(",")]
        if args.screens
        else SIMULATOR_SCREENS if args.simulator else SCREENS
    )
    date = datetime.date.today().isoformat()
    results = "ios-simulator" if args.simulator else "ios"

    def csv_for(kind, count):
        return os.path.join(HERE, "..", "results", results, f"mount-{date}-{kind}-{count}-{args.rival}.csv")

    # The Simulator mode is always the light recording.
    mode = ["--simulator"] if args.simulator else ["--light"]
    if args.max_load:
        mode += ["--max-load", args.max_load]
    if args.max_wait:
        mode += ["--max-wait", args.max_wait]
    if args.no_thermal:
        mode.append("--no-thermal")
    if not args.simulator or args.rival not in TAKES_BUNDLE_ID:
        if args.simulator:
            print(
                f"{args.rival}'s build can't take a second bundle ID, so each screen runs in a session of its own",
                file=sys.stderr,
                flush=True,
            )
        for kind, count in screens:
            screen = f"mount?kind={kind}&count={count}"
            print(f"== {screen}: building", flush=True)
            build_and_install(args.device, "angular-lynx", OURS, screen, args.simulator)
            build_and_install(args.device, args.rival, RIVAL, screen, args.simulator)
            launch(args, [("angular-lynx", OURS), (args.rival, RIVAL)], csv_for(kind, count), mode)
        return
    # One session per kind, in the order the kinds first come in --screens.
    kinds = list(dict.fromkeys(kind for kind, _ in screens))
    for kind in kinds:
        counts = [count for k, count in screens if k == kind]
        # Each count's AngularLynx build, then its rival's: with four apps,
        # ios_launch.py's order rotates as well as reversing, so each build
        # follows each of the others in turn.
        apps, labels = [], {}
        for count in counts:
            screen = f"mount?kind={kind}&count={count}"
            print(f"== {screen}: building", flush=True)
            for name, base in (("angular-lynx", OURS), (args.rival, RIVAL)):
                bundle_id = simulator_bundle_id(base, count)
                build_and_install(args.device, name, bundle_id, screen, True)
                label = f"{name}:{count}"
                apps.append((label, bundle_id))
                labels[label] = (name, count)
        folder = os.path.join(HERE, "..", "results", results)
        os.makedirs(folder, exist_ok=True)
        with tempfile.TemporaryDirectory() as work:
            combined = os.path.join(work, f"mount-{date}-{kind}-{args.rival}.csv")
            try:
                launch(args, apps, combined, mode)
            finally:
                # What a session measured before it failed is still kept,
                # as ios_launch.py's own rows are.
                if os.path.exists(combined):
                    split_session(combined, {count: csv_for(kind, count) for count in counts}, labels)


if __name__ == "__main__":
    main()
