#!/usr/bin/env python3
"""Runs the mount benchmark: each app built to open on a screen of N views,
texts or images (BENCH_SCREEN), launched under Instruments, and timed from the
process starting to the app reporting the screen drawn.

    python3 ios_mount.py --device <UDID> --rival react-native --runs 10

For each screen, it builds AngularLynx and the rival app with that screen,
installs both on the phone (AngularLynx as com.angularlynx.bench.angularlynx,
the rival as com.angularlynx.bench.rival) and launches them in turn with
ios_launch.py's light recording, appending to
../results/ios/mount-<kind>-<count>-<rival>.csv.
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


def build_and_install(device, app, bundle_id, screen):
    built = subprocess.run(
        ["sh", os.path.join(HERE, "build_ios_app.sh"), app, bundle_id, screen],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip().splitlines()[-1]
    subprocess.run(
        ["xcrun", "devicectl", "device", "install", "app", "--device", device, built],
        check=True,
        capture_output=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True)
    parser.add_argument("--rival", required=True, help="a folder in ../apps")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and screen")
    parser.add_argument("--screens", help="kind:count,... (default: all six)")
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
        build_and_install(args.device, "angular-lynx", OURS, screen)
        build_and_install(args.device, args.rival, RIVAL, screen)
        out = os.path.join(HERE, "..", "results", "ios", f"mount-{date}-{kind}-{count}-{args.rival}.csv")
        subprocess.run(
            [
                sys.executable, "-u", os.path.join(HERE, "ios_launch.py"),
                "--device", args.device,
                "--runs", str(args.runs),
                "--light",
                "--app", f"angular-lynx={OURS}",
                "--app", f"{args.rival}={RIVAL}",
                "--out", out,
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
