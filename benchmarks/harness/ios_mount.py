#!/usr/bin/env python3
"""Runs the mount benchmark: each app built to open on a screen of N views,
texts or images (BENCH_SCREEN), launched under Instruments, and timed from the
process starting to the app reporting the screen drawn.

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
session they compare: each app's cost per element is
(5,000-element screen - 1,500-element screen) / 3,500.
"""

import argparse
import datetime
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCREENS = [(kind, count) for count in (1500, 5000) for kind in ("view", "text", "image")]
OURS = "com.angularlynx.bench.angularlynx"
RIVAL = "com.angularlynx.bench.rival"


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


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True)
    parser.add_argument("--rival", required=True, help="a folder in ../apps")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and screen")
    parser.add_argument("--screens", help="kind:count,... (default: all six)")
    parser.add_argument("--simulator", action="store_true", help="--device is a booted iOS Simulator")
    parser.add_argument("--max-load", help="passed to ios_launch.py")
    parser.add_argument("--max-wait", help="passed to ios_launch.py")
    args = parser.parse_args()
    screens = (
        [(s.split(":")[0], int(s.split(":")[1])) for s in args.screens.split(",")]
        if args.screens
        else SCREENS
    )
    date = datetime.date.today().isoformat()
    for kind, count in screens:
        screen = f"mount?kind={kind}&count={count}"
        print(f"== {screen}: building", flush=True)
        build_and_install(args.device, "angular-lynx", OURS, screen, args.simulator)
        build_and_install(args.device, args.rival, RIVAL, screen, args.simulator)
        results = "ios-simulator" if args.simulator else "ios"
        out = os.path.join(HERE, "..", "results", results, f"mount-{date}-{kind}-{count}-{args.rival}.csv")
        # The Simulator mode is always the light recording.
        mode = ["--simulator"] if args.simulator else ["--light"]
        if args.max_load:
            mode += ["--max-load", args.max_load]
        if args.max_wait:
            mode += ["--max-wait", args.max_wait]
        subprocess.run(
            [
                sys.executable, "-u", os.path.join(HERE, "ios_launch.py"),
                "--device", args.device,
                "--runs", str(args.runs),
                *mode,
                "--app", f"angular-lynx={OURS}",
                "--app", f"{args.rival}={RIVAL}",
                "--out", out,
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
