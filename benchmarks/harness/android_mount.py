#!/usr/bin/env python3
"""Runs the mount benchmark on an Android emulator (or a phone): each app
built to open on a screen of N views, texts or images (BENCH_SCREEN),
launched with adb, and timed to the app reporting the screen drawn: from
the launch starting (fully_drawn_ms), and from the screen's MountStart mark
(mount_ms, android_launch.py). The Android counterpart of ios_mount.py.

    python3 android_mount.py --device emulator-5554 --rival react-lynx --runs 10

For each screen, it builds AngularLynx and the rival app with that screen
(build_android_app.sh), installs both (AngularLynx as
com.angularlynx.bench.angularlynx, the rival as com.angularlynx.bench.rival)
and launches them in turn with android_launch.py, appending to
../results/android-emulator/mount-<date>-<kind>-<count>-<rival>.csv, or
../results/android/... with --phone (or --out-dir). Each app's cost per element is
(fastest 5,000-element mount - fastest 1,500-element mount) / 3,500, from
mount_ms, which leaves out the emulator's launch before the screen, as
track.py works it out on the Simulator (#892): the difference of two whole
launches is mostly the emulator's own start, which the host holds up by
different amounts. The fastest rather than the median, because the host only
ever adds time. It prints them at the end.

The installs replace the Pokédex builds of those IDs: install them again
before a launch session of the Pokédex.
"""

import argparse
import csv
import datetime
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from android_launch import find_adb  # noqa: E402
from track import app_fastest  # noqa: E402

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


def costs(rows_by_screen, apps):
    """Each kind's cost per element for each app, in microseconds, from the
    fastest mount_ms of the kind's smallest and largest screens
    (rows_by_screen maps (kind, count) to their CSV rows), or None where
    either has no mount."""
    result = {}
    for kind in sorted({kind for kind, _ in rows_by_screen}):
        sizes = sorted(count for k, count in rows_by_screen if k == kind)
        if len(sizes) < 2:
            continue
        small, large = sizes[0], sizes[-1]
        for app in apps:
            a = app_fastest(rows_by_screen[(kind, small)], app, "mount_ms")
            b = app_fastest(rows_by_screen[(kind, large)], app, "mount_ms")
            result[(kind, app)] = (b - a) / (large - small) * 1000 if a is not None and b is not None else None
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the emulator's or phone's serial (adb devices)")
    parser.add_argument("--rival", required=True, help="a folder in ../apps that build_android_app.sh builds")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and screen")
    parser.add_argument("--screens", help="kind:count,... (default: all six)")
    parser.add_argument("--phone", action="store_true", help="write to ../results/android, not android-emulator")
    parser.add_argument("--max-load", help="passed to android_launch.py")
    parser.add_argument(
        "--out-dir",
        help="where the CSVs go (default ../results/android-emulator, or ../results/android with --phone): "
        "another folder for a second session on the same day, whose CSVs would otherwise be appended to",
    )
    args = parser.parse_args()
    screens = (
        [(s.split(":")[0], int(s.split(":")[1])) for s in args.screens.split(",")]
        if args.screens
        else SCREENS
    )
    adb = find_adb()
    date = datetime.date.today().isoformat()
    folder = args.out_dir or os.path.join(HERE, "..", "results", "android" if args.phone else "android-emulator")
    outs = {}
    for kind, count in screens:
        screen = f"mount?kind={kind}&count={count}"
        print(f"== {screen}: building", flush=True)
        build_and_install(adb, args.device, "angular-lynx", OURS, screen)
        build_and_install(adb, args.device, args.rival, RIVAL, screen)
        out = os.path.join(folder, f"mount-{date}-{kind}-{count}-{args.rival}.csv")
        outs[(kind, count)] = out
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
    rows = {}
    for screen, out in outs.items():
        with open(out, newline="") as file:
            rows[screen] = list(csv.DictReader(file))
    apps = ("angular-lynx", args.rival)
    for (kind, app), cost in costs(rows, apps).items():
        print(f"{app:>18} per {kind}: {f'{cost:.1f} µs' if cost is not None else 'no mount_ms'}", flush=True)


if __name__ == "__main__":
    main()
