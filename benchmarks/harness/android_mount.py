#!/usr/bin/env python3
"""Runs the mount benchmark on an Android emulator (or a phone): each app
built to open on a screen of N views, texts or images (BENCH_SCREEN),
launched with adb, and timed from the launch starting to the app reporting
the screen drawn. The Android counterpart of ios_mount.py.

    python3 android_mount.py --device emulator-5554 --rival react-lynx --runs 10

For each screen, it builds AngularLynx and the rival app with that screen
(build_android_app.sh), installs both (AngularLynx as
com.angularlynx.bench.angularlynx, the rival as com.angularlynx.bench.rival)
and launches them in turn with android_launch.py, appending to
../results/android-emulator/mount-<date>-<kind>-<count>-<rival>.csv, or
../results/android/... with --phone. Each app's cost per element is
(5,000-element screen - 1,500-element screen) / 3,500.

The installs replace the Pokédex builds of those IDs: install them again
before a launch session of the Pokédex.
"""

import argparse
import datetime
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from android_launch import find_adb  # noqa: E402

SCREENS = [(kind, count) for count in (1500, 5000) for kind in ("view", "text", "image")]
OURS = "com.angularlynx.bench.angularlynx"
RIVAL = "com.angularlynx.bench.rival"


def build_and_install(adb, device, app, app_id, screen):
    built = subprocess.run(
        ["sh", os.path.join(HERE, "build_android_app.sh"), app, app_id, screen],
        check=True,
        # Only stdout, the .apk's path: a failed build says where its log is
        # on stderr, which has to reach the terminal.
        stdout=subprocess.PIPE,
        text=True,
    ).stdout.strip().splitlines()[-1]
    subprocess.run([adb, "-s", device, "install", "-r", built], check=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the emulator's or phone's serial (adb devices)")
    parser.add_argument("--rival", required=True, help="a folder in ../apps that build_android_app.sh builds")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and screen")
    parser.add_argument("--screens", help="kind:count,... (default: all six)")
    parser.add_argument("--phone", action="store_true", help="write to ../results/android, not android-emulator")
    parser.add_argument("--max-load", help="passed to android_launch.py")
    args = parser.parse_args()
    screens = (
        [(s.split(":")[0], int(s.split(":")[1])) for s in args.screens.split(",")]
        if args.screens
        else SCREENS
    )
    adb = find_adb()
    date = datetime.date.today().isoformat()
    results = "android" if args.phone else "android-emulator"
    for kind, count in screens:
        screen = f"mount?kind={kind}&count={count}"
        print(f"== {screen}: building", flush=True)
        build_and_install(adb, args.device, "angular-lynx", OURS, screen)
        build_and_install(adb, args.device, args.rival, RIVAL, screen)
        out = os.path.join(HERE, "..", "results", results, f"mount-{date}-{kind}-{count}-{args.rival}.csv")
        extra = ["--max-load", args.max_load] if args.max_load else []
        subprocess.run(
            [
                sys.executable, "-u", os.path.join(HERE, "android_launch.py"),
                "--device", args.device,
                "--runs", str(args.runs),
                *extra,
                "--app", f"angular-lynx={OURS}",
                "--app", f"{args.rival}={RIVAL}",
                "--out", out,
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
