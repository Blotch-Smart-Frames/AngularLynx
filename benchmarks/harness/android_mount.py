#!/usr/bin/env python3
"""Runs the mount benchmark on an Android emulator (or a phone): each app
built to open on a screen of N views, texts or images (BENCH_SCREEN),
launched with adb, and timed to the app reporting the screen drawn: from
the launch starting (fully_drawn_ms), and from the screen's MountStart mark
(mount_ms, android_launch.py). The Android counterpart of ios_mount.py.

    python3 android_mount.py --device emulator-5554 --rival react-lynx --runs 10

Each kind's screens run in one session, as on the iOS Simulator (#882): for
each count, AngularLynx and the rival app are built with that screen
(build_android_app.sh) and installed side by side, each under an
application ID of its own (com.angularlynx.bench.angularlynx.m15000 and so
on), and android_launch.py launches all four builds in turn. The host's
drift then falls on both screens alike, rather than on one session and not
the other. The session's rows are split into one CSV per screen,
../results/android-emulator/mount-<date>-<kind>-<count>-<rival>.csv, or
../results/android/... with --phone (or --out-dir), with the app column
back to the app's name.

On the emulator, the large screens have 15,000 elements, not 5,000 (#904).
With 3,500 elements between the two screens, ReactLynx's took only
88-164 ms there, so a few milliseconds of the emulator's scheduling were
several percent of a cost, and its costs spread over ±13-22% where
AngularLynx's came within ±4%. A phone keeps 5,000, as the iPhone does.

Each app's cost per element is (fastest large mount - fastest 1,500-element
mount) / the elements between them, from mount_ms, which leaves out the
emulator's launch before the screen, as track.py works it out on the
Simulator (#892): the difference of two whole launches is mostly the
emulator's own start, which the host holds up by different amounts. The
fastest rather than the median, because the host only ever adds time. It
prints them at the end.

The mount builds have IDs of their own, so they leave the Pokédex's builds
(com.angularlynx.bench.angularlynx and the rival's) installed. Each kind's
builds replace the last kind's.
"""

import argparse
import csv
import datetime
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from android_launch import find_adb  # noqa: E402
from ios_mount import split_session  # noqa: E402
from track import app_fastest  # noqa: E402

KINDS = ("view", "text", "image")
EMULATOR_SCREENS = [(kind, count) for count in (1500, 15000) for kind in KINDS]
PHONE_SCREENS = [(kind, count) for count in (1500, 5000) for kind in KINDS]
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


def mount_app_id(base, count):
    """A mount build's application ID: one per app and count, so a kind's
    screens can be installed side by side. The kinds share them, each kind's
    builds replacing the last's."""
    return f"{base}.m{count}"


def session_apps(rival, counts):
    """A kind's session: its builds as (label, application ID) in the order
    android_launch.py takes them, each count's AngularLynx build and then
    its rival's, and each label's (app, count), for split_session. With four
    apps, android_launch.py's order rotates as well as reversing, so each
    build follows each of the others in turn."""
    apps, labels = [], {}
    for count in counts:
        for name, base in (("angular-lynx", OURS), (rival, RIVAL)):
            label = f"{name}:{count}"
            apps.append((label, mount_app_id(base, count)))
            labels[label] = (name, count)
    return apps, labels


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
    parser.add_argument(
        "--screens",
        help="kind:count,... (default: each kind at 1,500 and 15,000, or with --phone 1,500 and 5,000)",
    )
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
        else PHONE_SCREENS if args.phone else EMULATOR_SCREENS
    )
    adb = find_adb()
    date = datetime.date.today().isoformat()
    folder = args.out_dir or os.path.join(HERE, "..", "results", "android" if args.phone else "android-emulator")
    os.makedirs(folder, exist_ok=True)
    extra = ["--max-load", args.max_load] if args.max_load else []
    outs = {}
    # One session per kind, in the order the kinds first come in --screens.
    for kind in dict.fromkeys(kind for kind, _ in screens):
        counts = [count for k, count in screens if k == kind]
        apps, labels = session_apps(args.rival, counts)
        for label, app_id in apps:
            name, count = labels[label]
            screen = f"mount?kind={kind}&count={count}"
            print(f"== {screen}: building {name}", flush=True)
            build_and_install(adb, args.device, name, app_id, screen)
        kind_outs = {count: os.path.join(folder, f"mount-{date}-{kind}-{count}-{args.rival}.csv") for count in counts}
        outs.update({(kind, count): out for count, out in kind_outs.items()})
        with tempfile.TemporaryDirectory() as work:
            combined = os.path.join(work, f"mount-{date}-{kind}-{args.rival}.csv")
            try:
                subprocess.run(
                    [
                        sys.executable, "-u", os.path.join(HERE, "android_launch.py"),
                        "--device", args.device,
                        "--runs", str(args.runs),
                        *extra,
                        *[arg for label, app_id in apps for arg in ("--app", f"{label}={app_id}")],
                        "--out", combined,
                    ],
                    check=True,
                )
            finally:
                # What a session measured before it failed is still kept,
                # as android_launch.py's own rows are.
                if os.path.exists(combined):
                    split_session(combined, kind_outs, labels)
    rows = {}
    for screen, out in outs.items():
        with open(out, newline="") as file:
            rows[screen] = list(csv.DictReader(file))
    for (kind, app), cost in costs(rows, ("angular-lynx", args.rival)).items():
        print(f"{app:>18} per {kind}: {f'{cost:.1f} µs' if cost is not None else 'no mount_ms'}", flush=True)


if __name__ == "__main__":
    main()
