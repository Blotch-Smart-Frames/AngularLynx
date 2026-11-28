#!/usr/bin/env python3
"""Launches benchmark apps on an iPhone, or on the iOS Simulator, one
Instruments trace per launch, and appends what each launch measured to a CSV.

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

The apps take turns run by run (A B, B A, A B... and with more than two, the
order also rotates), so drift over a session (heat, battery, background work)
falls on every app alike. Each row's previous_app is the app launched before
it, counting a run dropped over --max-load (below), which the CSV doesn't
hold: summarize.py splits each app's launches by it. Battery level,
charging, thermal state, the OS build and the Mac's load average (the
fixture server runs on it) are recorded with every run.

With --simulator, --device is a booted Simulator's UDID, and each launch is
the light recording (--light) plus a memory reading:

    python3 ios_launch.py --simulator --device <UDID> --runs 20 \\
        --app angular-lynx=com.angularlynx.bench.angularlynx \\
        --app react-lynx=com.angularlynx.bench.rival \\
        --out ../results/ios-simulator/launch.csv

On the Simulator, the App Launch template records no life-cycle phases and
Activity Monitor fails, so first_frame_ms and peak_memory_mb stay empty.
fully_drawn_ms is the light recording's, from dyld's launch of the process.
memory_mb is `footprint`'s reading of the app's process (every Simulator app
is a process on the Mac), --memory-after seconds into the recording: 6 by
default, about 4 s after a Pokédex or mount screen is drawn there. The
thermal state is the Mac's, and battery and charging are left empty. The
Simulator runs on the Mac's cores, so a busy Mac slows every launch: the
harness waits for the Mac's load average to be under --max-load before each
launch (half the Mac's cores by default), and drops and launches again a
run whose recording ends over it (--max-load off waits for nothing, for a
host whose load average says nothing of how busy it is). With --max-wait, a launch still waiting for
the load, or just dropped for it, that many seconds after its first try ends
the session, for a host (a CI runner) that may never get that quiet.

A Simulator's numbers aren't a phone's: every launch takes about 1.45 s
longer, and memory doesn't rank the apps as a phone does. They compare runs
of one session with each other, such as two builds of one app, or one app's
cost per element between two screen sizes.
"""

import argparse
import concurrent.futures
import csv
import datetime
import json
import os
import re
import shutil
import signal
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
    "previous_app",
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


def simulator_info(udid):
    """The Simulator's name and its iOS version and build, as the device and
    os_build columns. ideviceinfo only reaches phones."""

    def simctl_json(*args):
        return json.loads(
            subprocess.run(["xcrun", "simctl", "list", *args, "-j"], check=True, capture_output=True, text=True).stdout
        )

    for runtime, devices in simctl_json("devices")["devices"].items():
        for device in devices:
            if device["udid"] != udid:
                continue
            if device["state"] != "Booted":
                raise SystemExit(f"the Simulator {device['name']} ({udid}) isn't booted: xcrun simctl boot {udid}")
            os_build = next(
                (
                    f"{r['version']} ({r['buildversion']})"
                    for r in simctl_json("runtimes")["runtimes"]
                    if r["identifier"] == runtime
                ),
                runtime,
            )
            return f"{device['name']} (Simulator)", os_build
    raise SystemExit(f"no Simulator has the UDID {udid} (xcrun simctl list devices)")


def run_order(apps, run):
    """The order the apps launch in on a run: as listed on odd runs and
    reversed on even ones, so each app goes first as often as last. With more
    than two apps, the list also rotates by one every two runs, so each app
    follows each of the others in turn: a launch right after another app's
    pays for that app's work in the file caches, and (on the Simulator) for
    the Mac's cores it left busy. Rotating two apps is the same as reversing
    them, which would undo the alternation, so two keep A B, B A."""
    if len(apps) > 2:
        turn = (run - 1) // 2 % len(apps)
        apps = apps[turn:] + apps[:turn]
    return list(apps) if run % 2 else list(reversed(apps))


def wait_for_load(max_load, deadline=None):
    """Waits until the Mac's 1-minute load average is at most max_load, and
    ends the session if it's still over at deadline (time.monotonic()), so a
    host that never gets that quiet fails rather than waits forever."""
    waiting_since = None
    while os.getloadavg()[0] > max_load:
        if deadline is not None and time.monotonic() > deadline:
            raise SystemExit(load_error(max_load))
        if waiting_since is None or time.monotonic() - waiting_since > 60:
            print(
                f"the Mac's load average is {os.getloadavg()[0]:.1f}, over --max-load {max_load}: waiting",
                file=sys.stderr,
                flush=True,
            )
            waiting_since = time.monotonic()
        time.sleep(5)


def load_error(max_load):
    return (
        f"the Mac's load average is {os.getloadavg()[0]:.1f}, and hasn't stayed under --max-load {max_load} "
        "through a launch within --max-wait: raise --max-load, or run on a quieter host"
    )


def max_load_value(text):
    """--max-load's value: a load average, or "off" for no limit. On GitHub's
    3-core macOS runners the 1-minute load average stays between 80 and 200
    after the Simulator boots (measured on #854's run), so no limit near the
    core count is ever reached there."""
    return "off" if text == "off" else float(text)


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


def measure_light(trace, memory=None):
    """A light recording's fully drawn: no App Launch phases, so the process's
    start is dyld's "Launch Executable", which begins about 2 ms after the
    App Launch template's first phase (measured on one trace with both).

    memory is a Simulator run's (pid, bytes) from footprint, kept only if it
    read the process the trace launched."""
    data = tables(
        trace,
        "dyld-activity-interval",
        "PointsOfInterestEvents",
        "device-thermal-state-intervals",
    )
    launches = [r for r in data["dyld-activity-interval"] if r["type"][1] == "Launch Executable"]
    if not launches:
        raise RuntimeError("no dyld launch in the trace")
    launch = min(launches, key=lambda r: int(r["start"][0]))
    pid = launch["process"][2].findtext("pid")
    start = int(launch["start"][0])
    fully_drawn = None
    for r in data["PointsOfInterestEvents"]:
        if of_pid(r["process"], pid) and r["name"][1] in FULLY_DRAWN:
            fully_drawn = int(r["time"][0]) - start
            break
    thermal = sorted({r["thermal-state"][1] for r in data["device-thermal-state-intervals"]})
    footprint = None
    if memory and memory[0] == pid:
        footprint = memory[1]
    elif memory:
        print(f"footprint read pid {memory[0]}, not the launched {pid}: no memory", file=sys.stderr, flush=True)
    return {
        "first_frame_ms": "",
        "fully_drawn_ms": f"{fully_drawn / 1e6:.1f}" if fully_drawn is not None else "",
        "memory_mb": f"{footprint / 1048576:.1f}" if footprint else "",
        "peak_memory_mb": "",
        "thermal_state": "/".join(thermal),
    }


def record(udid, bundle_id, trace, seconds, extra_instruments, light=False):
    command = ["xcrun", "xctrace", "record"]
    if light:
        # About 15 s a launch instead of 60: no CPU sampling, no launch phases.
        command += [
            "--instrument", "Points of Interest",
            "--instrument", "dyld Activity",
            "--instrument", "Thermal State",
        ]
    else:
        command += [
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


def simulator_app_pid(udid, bundle_id):
    """The pid of the app's process on the Simulator, from its launchd, or
    None while it isn't running. launchd lists an app as
    UIKitApplication:<bundle ID>[<instance>]..."""
    listing = subprocess.run(
        ["xcrun", "simctl", "spawn", udid, "launchctl", "list"], capture_output=True, text=True
    ).stdout
    for line in listing.splitlines():
        fields = line.split("\t")
        if len(fields) == 3 and fields[2].startswith(f"UIKitApplication:{bundle_id}[") and fields[0].isdigit():
            return fields[0]
    return None


def footprint(pid):
    """The process's physical footprint in bytes, as `footprint` reads it:
    the number Xcode's memory gauge and a phone's Activity Monitor show."""
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "footprint.json")
        subprocess.run(["footprint", "-p", pid, "-j", path], check=True, capture_output=True)
        with open(path) as file:
            report = json.load(file)
    return report["processes"][0]["footprint"] * report.get("bytes per unit", 1)


# How long xctrace may take to start a Simulator recording (about a second
# on a Mac), and to end one after its time limit, before it counts as stuck.
RECORDING_START_TIMEOUT = 120
# A session whose recordings fail this many times in a row measures nothing,
# and would take hours to find out run by run.
FAILURES_IN_A_ROW = 3


def record_simulator(udid, bundle_id, trace, seconds, memory_after, thermal=True):
    """Records a launch on the Simulator, and returns the app's (pid, bytes)
    from footprint memory_after seconds into the recording, or None.

    On the Simulator, the App Launch template records no life-cycle phases
    and Activity Monitor fails, so this is the light recording, and the
    memory comes from footprint: a Simulator app is a process on the Mac.
    It's read once, after the app has drawn and settled rather than during
    the launch, where footprint's reading would take the Mac's time from it.

    thermal=False leaves out the Thermal State instrument, for a Mac (a
    GitHub runner, a virtual machine) where it keeps xctrace from ever
    starting the recording.
    """
    command = [
        "xcrun", "xctrace", "record",
        "--instrument", "Points of Interest",
        "--instrument", "dyld Activity",
    ]
    if thermal:
        # The Mac's thermal state, which the Simulator runs under.
        command += ["--instrument", "Thermal State"]
    command += [
        "--device", udid,
        "--time-limit", f"{seconds}s",
        "--output", trace,
        "--no-prompt",
        "--launch", "--", bundle_id,
    ]
    # In a session of its own, so a stuck recording's kill takes the
    # processes it started too, which would hold its pipes open.
    process = subprocess.Popen(
        command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
    )
    # xctrace prints this once it has launched the app and started the
    # recording, about a second after it starts (Xcode 27.2). The time limit
    # counts from here. Both pipes are read on threads, so a full stderr
    # can't block xctrace, and so a recording that never starts (on a CI
    # runner, the first launch sat silent for 45 minutes in #854) ends
    # with what xctrace said rather than hanging the session.
    output, errors = [], []
    started = threading.Event()

    def read_output():
        for line in process.stdout:
            output.append(line)
            if "Ctrl-C to stop" in line:
                started.set()
        # The process has ended, started or not.
        started.set()

    def read_errors():
        errors.extend(process.stderr)

    readers = [threading.Thread(target=read_output, daemon=True), threading.Thread(target=read_errors, daemon=True)]
    for reader in readers:
        reader.start()

    def stop(why):
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        for reader in readers:
            reader.join(5)
        raise subprocess.CalledProcessError(-9, command, "".join(output), f"{''.join(output)}{''.join(errors)}{why}")

    try:
        if not started.wait(RECORDING_START_TIMEOUT):
            stop(f"xctrace hadn't started recording after {RECORDING_START_TIMEOUT} s")
        memory = None
        if process.poll() is None:
            time.sleep(memory_after)
            pid = simulator_app_pid(udid, bundle_id)
            if pid:
                try:
                    memory = (pid, footprint(pid))
                except subprocess.CalledProcessError as error:
                    print(f"footprint failed: {error.stderr.strip()[-300:]}", file=sys.stderr, flush=True)
        try:
            process.wait(timeout=seconds + RECORDING_START_TIMEOUT)
        except subprocess.TimeoutExpired:
            stop(f"xctrace hadn't ended its {seconds} s recording after {seconds + RECORDING_START_TIMEOUT} s")
    except BaseException:
        # Anything else that ends the harness here (a Ctrl-C, which the
        # recording's own session doesn't get from the terminal) would
        # leave xctrace running, and one still starting has no time limit.
        # stop() has already killed it if it raised; a recording that has
        # ended has no group left to kill.
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise
    for reader in readers:
        reader.join(5)
    if process.returncode:
        raise subprocess.CalledProcessError(process.returncode, command, "".join(output), "".join(errors))
    return memory


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the iPhone's UDID, or with --simulator a booted Simulator's")
    parser.add_argument("--app", action="append", required=True, help="name=bundle.id, two or more")
    parser.add_argument("--runs", type=int, default=20, help="launches per app")
    parser.add_argument("--seconds", type=int, default=8, help="how long each recording lasts")
    parser.add_argument("--out", required=True, help="the CSV to append to")
    parser.add_argument("--keep-traces", help="a folder to keep each trace in")
    parser.add_argument("--rest", type=float, default=3, help="seconds between launches")
    parser.add_argument(
        "--light",
        action="store_true",
        help="record only fully drawn, without the App Launch template (for the mount screens)",
    )
    parser.add_argument(
        "--simulator",
        action="store_true",
        help="launch on the iOS Simulator: the light recording, and memory from footprint",
    )
    parser.add_argument(
        "--memory-after",
        type=float,
        default=6,
        help="with --simulator, seconds into the recording to read the app's memory (default 6)",
    )
    parser.add_argument(
        "--max-load",
        type=max_load_value,
        help="drop a run whose recording ends with the Mac's 1-minute load average over this, and "
        "launch it again once the load is under it (with --simulator, default: half the Mac's cores; "
        "off: no limit, every row still records the load)",
    )
    parser.add_argument(
        "--no-thermal",
        action="store_true",
        help="with --simulator, record without the Thermal State instrument (its column stays empty), "
        "for a Mac where it keeps the recording from starting",
    )
    parser.add_argument(
        "--max-wait",
        type=float,
        help="with --max-load, end the session when a launch is still waiting for the load to come under it, "
        "or has just been dropped for going over it, this many seconds after its first try; a launch measured "
        "under it counts, however long it took (default: wait as long as it takes)",
    )
    args = parser.parse_args()
    if args.simulator and args.max_load is None:
        args.max_load = (os.cpu_count() or 2) / 2
    if args.max_load == "off":
        args.max_load = None
    if args.simulator and args.memory_after >= args.seconds:
        parser.error("--memory-after has to be under --seconds: the app ends with the recording")

    apps = [tuple(app.split("=", 1)) for app in args.app]
    if args.simulator:
        device, os_build = simulator_info(args.device)
    else:
        device = device_value(args.device, "ProductType")
        os_build = f"{device_value(args.device, 'ProductVersion')} ({device_value(args.device, 'BuildVersion')})"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    new_file = not os.path.exists(args.out) or os.path.getsize(args.out) == 0
    if not new_file:
        # Rows go by FIELDS' order, so a CSV from a version of the harness
        # with other columns (such as one without previous_app) would get
        # each value under the wrong heading.
        with open(args.out, newline="") as existing:
            header = next(csv.reader(existing), [])
        if header != FIELDS:
            raise SystemExit(
                f"{args.out} has other columns than this harness writes: name a new --out\n"
                f"  its columns: {','.join(header)}\n  these: {','.join(FIELDS)}"
            )
    work = tempfile.mkdtemp(prefix="ios-launch-")
    out = open(args.out, "a", newline="")
    writer = csv.DictWriter(out, fieldnames=FIELDS)
    if new_file:
        writer.writeheader()
    lock = threading.Lock()
    # The app launched before each one, counting the runs dropped over
    # --max-load: a dropped run is launched again straight away, so the run
    # that replaces it follows its own app, not the one its row comes after
    # in the CSV. summarize.py splits each app's launches by it ("again" or
    # "after other").
    previous = ""

    def finish(row, trace, memory=None):
        try:
            if args.simulator:
                values = measure_light(trace, memory)
            else:
                values = measure_light(trace) if args.light else measure(trace)
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
                f"battery {row.get('battery_percent') or '-'}%, load {row['host_load']}",
                flush=True,
            )

    def launch(name, bundle_id, run, trace):
        """Records one launch, and returns its row and (on the Simulator)
        its memory reading, or (None, None) when xctrace failed. A run that
        ends over --max-load is dropped and launched again, until
        --max-wait has gone by."""
        nonlocal previous
        deadline = time.monotonic() + args.max_wait if args.max_wait is not None else None
        while True:
            if args.max_load is not None:
                wait_for_load(args.max_load, deadline)
            before = os.getloadavg()[0]
            row = {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "device": device,
                "os_build": os_build,
                "app": name,
                "bundle_id": bundle_id,
                "run": run,
                "previous_app": previous,
            }
            if not args.simulator:
                row["battery_percent"] = device_value(args.device, "BatteryCurrentCapacity", "com.apple.mobile.battery")
                row["charging"] = device_value(args.device, "BatteryIsCharging", "com.apple.mobile.battery")
            memory = None
            try:
                if args.simulator:
                    memory = record_simulator(
                        args.device, bundle_id, trace, args.seconds, args.memory_after, thermal=not args.no_thermal
                    )
                else:
                    record(args.device, bundle_id, trace, args.seconds, [], light=args.light)
            except subprocess.CalledProcessError as error:
                print(f"{name} run {run}: xctrace failed: {error.stderr.strip()[-500:]}", file=sys.stderr, flush=True)
                row["host_load"] = f"{before:.1f}"
                with lock:
                    writer.writerow(row)
                    out.flush()
                shutil.rmtree(trace, ignore_errors=True)
                return None, None
            finally:
                # A failed recording counts too: xctrace may have started the
                # app before it failed, and its row is in the CSV.
                previous = name
            # The Mac serves the fixtures (a busy Mac answers later) and, on
            # the Simulator, runs the app. The 1-minute average after the
            # recording covers the recording; the one before, the minute
            # before it. A phone's row keeps the one before, as its earlier
            # sessions do.
            load = os.getloadavg()[0]
            row["host_load"] = f"{max(before, load) if args.simulator else before:.1f}"
            if args.max_load is None or load <= args.max_load:
                return row, memory
            print(
                f"{name} run {run}: dropped, the Mac's load average reached {load:.1f}; launching it again",
                file=sys.stderr,
                flush=True,
            )
            shutil.rmtree(trace, ignore_errors=True)
            # A launch can push the load over the limit by itself, on a host
            # with few cores, and then every run is dropped.
            if deadline is not None and time.monotonic() > deadline:
                raise SystemExit(load_error(args.max_load))

    failures = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for run in range(1, args.runs + 1):
            for name, bundle_id in run_order(apps, run):
                trace = os.path.join(work, f"{name}-{run}.trace")
                row, memory = launch(name, bundle_id, run, trace)
                if row is None:
                    failures += 1
                    if failures >= FAILURES_IN_A_ROW:
                        raise SystemExit(f"xctrace failed {failures} launches in a row: ending the session")
                    continue
                failures = 0
                if args.simulator:
                    # Reading a trace keeps the Mac busy, and the Simulator
                    # launches on the Mac's cores: read it before the next
                    # launch rather than beside it.
                    finish(row, trace, memory)
                else:
                    # Reading a trace takes about as long as recording one, so
                    # it runs beside the next launch, on the Mac, while the
                    # phone records.
                    pool.submit(finish, row, trace)
                time.sleep(args.rest)
    out.close()
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
