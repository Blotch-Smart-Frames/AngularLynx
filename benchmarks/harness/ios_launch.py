#!/usr/bin/env python3
"""Launches benchmark apps on an iPhone, one Instruments trace per launch, and
appends what each launch measured to a CSV.

    python3 ios_launch.py --device <UDID> --runs 20 \\
        --app angular-lynx=dev.angularlynx.bench.angularlynx \\
        --app react-native=dev.angularlynx.bench.reactnative \\
        --out ../results/ios/launch.csv

Each launch is recorded with Instruments' App Launch template, which is how
Apple measures a launch, plus the Points of Interest, Activity Monitor and
Thermal State instruments. xctrace starts the app as a new process (it ends
the one before when its recording stops), so every launch is a launch from
scratch with the system's file caches warm: what iOS calls a warm launch. A
cold launch, the first after a reboot, can't be repeated without rebooting
and unlocking the phone each time.

From each trace:

- first_frame_ms: from the process starting to the end of App Launch's
  "Initial Frame Rendering" phase, the first frame the app gives the screen.
  For apps that keep a splash screen up, that frame is the splash screen.
- fully_drawn_ms: from the process starting to the app's fully-drawn
  signpost (`TTFD`, or `Fully Drawn` from AngularLynx's shell): its first
  page of data is on screen.
- memory_mb / peak_memory_mb: the app's physical footprint (what iOS counts
  against its memory limit, Xcode's memory gauge), in Activity Monitor's last
  sample before the recording ends, and its largest sample.

The apps alternate run by run (ABBA order), so drift over a session (heat,
battery, background work) falls on every app alike. Battery level, charging,
thermal state, the OS build and the Mac's load average (the fixture
server runs on it) are recorded with every run.
"""

import argparse
import concurrent.futures
import csv
import datetime
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from xctrace_tables import tables  # noqa: E402

FULLY_DRAWN = {"TTFD", "Fully Drawn"}
FIELDS = [
    "timestamp",
    "device",
    "os_build",
    "app",
    "bundle_id",
    "run",
    "first_frame_ms",
    "fully_drawn_ms",
    "memory_mb",
    "peak_memory_mb",
    "thermal_state",
    "battery_percent",
    "charging",
    "host_load",
]


def device_value(udid, key, domain=None):
    command = ["ideviceinfo", "-u", udid, "-k", key]
    if domain:
        command += ["-q", domain]
    result = subprocess.run(command, capture_output=True, text=True)
    return result.stdout.strip()


def of_pid(cell, pid):
    # A process cell reads "Name (pid)".
    return bool(cell and cell[1] and cell[1].endswith(f"({pid})"))


def measure(trace):
    data = tables(
        trace,
        "life-cycle-period",
        "PointsOfInterestEvents",
        "activity-monitor-process-live",
        "device-thermal-state-intervals",
    )
    # App Launch traces only the launched process's phases.
    periods = data["life-cycle-period"]
    if not periods:
        raise RuntimeError("no launch phases in the trace")
    pid = periods[0]["process"][2].findtext("pid")
    periods = [r for r in periods if of_pid(r["process"], pid)]
    start = min(int(r["start"][0]) for r in periods)
    first_frame = None
    for r in periods:
        if (r["period"][1] or "").endswith("Initial Frame Rendering"):
            first_frame = int(r["start"][0]) + int(r["duration"][0]) - start
            break
    fully_drawn = None
    for r in data["PointsOfInterestEvents"]:
        if of_pid(r["process"], pid) and r["name"][1] in FULLY_DRAWN:
            fully_drawn = int(r["time"][0]) - start
            break
    memory = [
        int(r["memory-physical-footprint"][0])
        for r in data["activity-monitor-process-live"]
        if of_pid(r["process"], pid) and r["memory-physical-footprint"][0]
    ]
    thermal = sorted({r["thermal-state"][1] for r in data["device-thermal-state-intervals"]})
    ms = lambda ns: f"{ns / 1e6:.1f}" if ns is not None else ""
    mb = lambda b: f"{b / 1048576:.1f}" if b else ""
    return {
        "first_frame_ms": ms(first_frame),
        "fully_drawn_ms": ms(fully_drawn),
        "memory_mb": mb(memory[-1] if memory else None),
        "peak_memory_mb": mb(max(memory) if memory else None),
        "thermal_state": "/".join(thermal),
    }


def record(udid, bundle_id, trace, seconds, extra_instruments):
    command = [
        "xcrun", "xctrace", "record",
        "--template", "App Launch",
        "--instrument", "Points of Interest",
        "--instrument", "Activity Monitor",
        "--instrument", "Thermal State",
    ]
    for instrument in extra_instruments:
        command += ["--instrument", instrument]
    command += [
        "--device", udid,
        "--time-limit", f"{seconds}s",
        "--output", trace,
        "--no-prompt",
        "--launch", "--", bundle_id,
    ]
    subprocess.run(command, check=True, capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the iPhone's UDID")
    parser.add_argument("--app", action="append", required=True, help="name=bundle.id, two or more")
    parser.add_argument("--runs", type=int, default=20, help="launches per app")
    parser.add_argument("--seconds", type=int, default=8, help="how long each recording lasts")
    parser.add_argument("--out", required=True, help="the CSV to append to")
    parser.add_argument("--keep-traces", help="a folder to keep each trace in")
    parser.add_argument("--rest", type=float, default=3, help="seconds between launches")
    args = parser.parse_args()

    apps = [tuple(app.split("=", 1)) for app in args.app]
    device = device_value(args.device, "ProductType")
    os_build = f"{device_value(args.device, 'ProductVersion')} ({device_value(args.device, 'BuildVersion')})"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    new_file = not os.path.exists(args.out)
    work = tempfile.mkdtemp(prefix="ios-launch-")
    out = open(args.out, "a", newline="")
    writer = csv.DictWriter(out, fieldnames=FIELDS)
    if new_file:
        writer.writeheader()
    lock = threading.Lock()

    def finish(row, trace):
        # Reading a trace takes about as long as recording one, so it runs
        # beside the next launch, on the Mac, while the phone records.
        try:
            values = measure(trace)
        except Exception as error:  # noqa: BLE001 - one bad run shouldn't end a session
            print(f"{row['app']} run {row['run']}: {error}", file=sys.stderr, flush=True)
            values = {}
        if args.keep_traces:
            os.makedirs(args.keep_traces, exist_ok=True)
            shutil.move(trace, os.path.join(args.keep_traces, os.path.basename(trace)))
        else:
            shutil.rmtree(trace, ignore_errors=True)
        with lock:
            writer.writerow({**row, **values})
            out.flush()
            print(
                f"{row['app']:>18} run {row['run']:>2}: first frame {values.get('first_frame_ms', '?'):>7} ms, "
                f"fully drawn {values.get('fully_drawn_ms', '?'):>7} ms, "
                f"memory {values.get('memory_mb', '?')} MB, {values.get('thermal_state', '?')}, "
                f"battery {row['battery_percent']}%",
                flush=True,
            )

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for run in range(1, args.runs + 1):
            # ABBA: A B, B A, A B, ...
            order = apps if run % 2 else list(reversed(apps))
            for name, bundle_id in order:
                trace = os.path.join(work, f"{name}-{run}.trace")
                row = {
                    "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                    "device": device,
                    "os_build": os_build,
                    "app": name,
                    "bundle_id": bundle_id,
                    "run": run,
                    "battery_percent": device_value(args.device, "BatteryCurrentCapacity", "com.apple.mobile.battery"),
                    "charging": device_value(args.device, "BatteryIsCharging", "com.apple.mobile.battery"),
                    # The Mac serves the fixtures: a busy Mac answers later.
                    "host_load": f"{os.getloadavg()[0]:.1f}",
                }
                try:
                    record(args.device, bundle_id, trace, args.seconds, [])
                except subprocess.CalledProcessError as error:
                    print(f"{name} run {run}: xctrace failed: {error.stderr.strip()[-500:]}", file=sys.stderr, flush=True)
                    with lock:
                        writer.writerow(row)
                        out.flush()
                    continue
                pool.submit(finish, row, trace)
                time.sleep(args.rest)
    out.close()
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
