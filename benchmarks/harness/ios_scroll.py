#!/usr/bin/env python3
"""Scrolls benchmark apps on an iPhone with a UI test, one launch per run,
and appends what each swipe measured to a CSV.

    python3 ios_scroll.py --device <UDID> --runs 10 \\
        --app angular-lynx=com.angularlynx.bench.angularlynx=path/to/LaunchPerfAL.app \\
        --app react-native=com.angularlynx.bench.rival=path/to/LaunchPerfRN.app \\
        --out ../results/ios/scroll-<date>-react-native.csv

Each run launches the app with the UI test in `ios-scroll/` (one runner for
every framework: it drives the app by its bundle ID), waits for the list,
then swipes up through it, always further, ten times. XCTest measures each
swipe, from the finger landing until four seconds later, when every app's
list has come to rest:

- XCTOSSignpostMetric.scrollingAndDecelerationMetric: UIKit's own signposts
  for a scroll view's drag and deceleration, as Xcode's scroll performance
  tests read them. scroll_ms is how long the list moved, fps the frames it
  drew per second meanwhile, hitches how many frames came late to the
  screen, hitch_ms their total lateness and hitch_ratio that per second of
  scrolling, Apple's measure of smoothness (under 5 ms/s is good, over 10 is
  bad).
- XCTCPUMetric: the app's CPU time and instructions over the swipe, on every
  thread.
- XCTMemoryMetric: the app's physical footprint at the end of the swipe.

The runner is an app of its own. A free Apple team can have three apps on a
phone, so with any other app of the team installed, the two benchmark apps
can't both be: give each `--app` its .app as a third field, and the script
keeps one of them installed at a time, reinstalling it when it's its turn.
The UI test allows the local network prompt a new install asks for. The
apps alternate run by run (ABBA order), as in ios_launch.py, which with one
app installed at a time reinstalls every other run.

Battery level, charging, thermal state, the OS build and the Mac's load
average (the fixture server runs on it) are recorded with every run.
"""

import argparse
import csv
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.join(HERE, "ios-scroll", "ScrollBench.xcodeproj")
FIELDS = [
    "timestamp",
    "device",
    "os_build",
    "app",
    "bundle_id",
    "run",
    "swipe",
    "scroll_ms",
    "fps",
    "hitches",
    "hitch_ms",
    "hitch_ratio",
    "cpu_ms",
    "instructions_m",
    "memory_mb",
    "thermal_state",
    "battery_percent",
    "charging",
    "host_load",
]

# The end of each XCTest metric's identifier, the CSV column it goes in, and
# the factor from XCTest's unit to the column's. The identifiers hold the
# app's bundle ID (the CPU and memory metrics) or UIKit's interval's name
# (Scroll_DraggingAndDeceleration), so they're matched by their ending.
# XCTest also reports the scroll's frame count, but on iOS 27 it reads 0
# beside a real frame rate, so the CSV leaves it out.
METRICS = {
    "Scroll_DraggingAndDeceleration.duration": ("scroll_ms", 1000),  # s
    "Scroll_DraggingAndDeceleration.animation.frame.rate": ("fps", 1),
    "Scroll_DraggingAndDeceleration.animation.hitch.number": ("hitches", 1),
    "Scroll_DraggingAndDeceleration.animation.hitches.total.duration": ("hitch_ms", 1),
    "Scroll_DraggingAndDeceleration.animation.hitch.time.ratio": ("hitch_ratio", 1),  # ms per s
    ".time": ("cpu_ms", 1000),  # s
    ".instructions_retired": ("instructions_m", 1e-3),  # thousands
    ".physical_absolute": ("memory_mb", 1 / 1024),  # kB
}


def device_value(udid, key, domain=None):
    command = ["ideviceinfo", "-u", udid, "-k", key]
    if domain:
        command += ["-q", domain]
    result = subprocess.run(command, capture_output=True, text=True)
    return result.stdout.strip()


def build_runner(udid, team, work):
    """Builds the UI test runner once, and returns its .xctestrun file."""
    subprocess.run(
        [
            "xcodebuild", "build-for-testing",
            "-project", PROJECT,
            "-scheme", "ScrollBench",
            "-destination", f"id={udid}",
            "-derivedDataPath", work,
            f"DEVELOPMENT_TEAM={team}",
            "-allowProvisioningUpdates",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    products = os.path.join(work, "Build", "Products")
    runs = [f for f in os.listdir(products) if f.endswith(".xctestrun")]
    if not runs:
        raise RuntimeError(f"no .xctestrun in {products}")
    return os.path.join(products, runs[0])


def read_metrics(result_bundle):
    """Each swipe's metrics, from the result bundle, as CSV cells."""
    output = subprocess.run(
        ["xcrun", "xcresulttool", "get", "test-results", "metrics", "--path", result_bundle],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    swipes = {}
    for test in json.loads(output):
        for run in test.get("testRuns", []):
            for metric in run.get("metrics", []):
                identifier = metric.get("identifier", "")
                for ending, (column, factor) in METRICS.items():
                    if identifier.endswith(ending):
                        for i, value in enumerate(metric.get("measurements", [])):
                            swipes.setdefault(i + 1, {})[column] = f"{value * factor:.1f}"
    return [swipes[i] for i in sorted(swipes)]


def run_once(udid, xctestrun, bundle_id, swipes, work, name):
    result_bundle = os.path.join(work, f"{name}-{time.time_ns()}.xcresult")
    env = {
        **os.environ,
        # xcodebuild hands TEST_RUNNER_-prefixed variables to the runner.
        "TEST_RUNNER_BENCH_BUNDLE_ID": bundle_id,
        "TEST_RUNNER_BENCH_SWIPES": str(swipes),
    }
    result = subprocess.run(
        [
            "xcodebuild", "test-without-building",
            "-xctestrun", xctestrun,
            "-destination", f"id={udid}",
            "-resultBundlePath", result_bundle,
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    try:
        if result.returncode != 0:
            raise RuntimeError(f"the UI test failed: {(result.stdout + result.stderr).strip()[-800:]}")
        rows = read_metrics(result_bundle)
    finally:
        shutil.rmtree(result_bundle, ignore_errors=True)
    if not rows or not any(row.get("scroll_ms") for row in rows):
        raise RuntimeError("no scroll measured: is the app on its list?")
    conditions = re.search(r"BENCH_CONDITIONS thermal=(\w+)", result.stdout)
    return rows, conditions.group(1) if conditions else ""


def devicectl(*args):
    subprocess.run(["xcrun", "devicectl", "device", *args], check=True, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the iPhone's UDID")
    parser.add_argument(
        "--app",
        action="append",
        required=True,
        help="name=bundle.id, or name=bundle.id=path/to/App.app to keep one app installed at a time; two or more",
    )
    parser.add_argument("--runs", type=int, default=10, help="launches per app")
    parser.add_argument("--swipes", type=int, default=10, help="swipes measured per launch")
    parser.add_argument("--team", default=os.environ.get("TEAM_ID", "F64LTK85F6"), help="the signing team")
    parser.add_argument("--out", required=True, help="the CSV to append to")
    parser.add_argument("--rest", type=float, default=3, help="seconds between runs")
    args = parser.parse_args()

    apps = [tuple(app.split("=", 2)) for app in args.app]
    swap = all(len(app) == 3 for app in apps)
    device = device_value(args.device, "ProductType")
    os_build = f"{device_value(args.device, 'ProductVersion')} ({device_value(args.device, 'BuildVersion')})"
    work = tempfile.mkdtemp(prefix="ios-scroll-")
    if swap:
        # Room for the runner: none of the benchmark apps is installed until
        # its turn.
        for _, bundle_id, _ in apps:
            subprocess.run(
                ["xcrun", "devicectl", "device", "uninstall", "app", "--device", args.device, bundle_id],
                capture_output=True,
            )
    print("building the UI test runner", flush=True)
    xctestrun = build_runner(args.device, args.team, os.path.join(work, "build"))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    new_file = not os.path.exists(args.out)
    installed = None
    with open(args.out, "a", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=FIELDS)
        if new_file:
            writer.writeheader()
        for run in range(1, args.runs + 1):
            # ABBA: A B, B A, A B, ...
            order = apps if run % 2 else list(reversed(apps))
            for app in order:
                name, bundle_id = app[0], app[1]
                if swap and installed != bundle_id:
                    if installed:
                        devicectl("uninstall", "app", "--device", args.device, installed)
                    devicectl("install", "app", "--device", args.device, app[2])
                    installed = bundle_id
                row = {
                    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                    "device": device,
                    "os_build": os_build,
                    "app": name,
                    "bundle_id": bundle_id,
                    "run": run,
                    "battery_percent": device_value(args.device, "BatteryCurrentCapacity", "com.apple.mobile.battery"),
                    "charging": device_value(args.device, "BatteryIsCharging", "com.apple.mobile.battery"),
                    "host_load": f"{os.getloadavg()[0]:.1f}",
                }
                try:
                    swipes, thermal = run_once(args.device, xctestrun, bundle_id, args.swipes, work, name)
                except Exception as error:  # noqa: BLE001 - one bad run shouldn't end a session
                    print(f"{name} run {run}: {error}", file=sys.stderr, flush=True)
                    continue
                for i, values in enumerate(swipes, start=1):
                    writer.writerow({**row, "swipe": i, "thermal_state": thermal, **values})
                out.flush()
                cpu = sorted(float(s["cpu_ms"]) for s in swipes if s.get("cpu_ms"))
                fps = sorted(float(s["fps"]) for s in swipes if s.get("fps"))
                hitches = sum(float(s.get("hitches") or 0) for s in swipes)
                print(
                    f"{name:>18} run {run:>2}: {len(swipes)} swipes, {hitches:.0f} hitches, "
                    f"fps median {fps[len(fps) // 2] if fps else '?'}, "
                    f"CPU median {cpu[len(cpu) // 2] if cpu else '?'} ms, {thermal}, "
                    f"battery {row['battery_percent']}%",
                    flush=True,
                )
                time.sleep(args.rest)
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
