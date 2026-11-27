#!/usr/bin/env python3
"""Launches benchmark apps on an Android emulator (or a phone) with adb, one
launch at a time, and appends what each launch measured to a CSV.

    python3 android_launch.py --device emulator-5554 --runs 20 \\
        --app angular-lynx=com.angularlynx.bench.angularlynx \\
        --app react-lynx=com.angularlynx.bench.reactlynx \\
        --out ../results/android-emulator/launch-<date>-react-lynx.csv

Each launch is `am start -S -W`: the app's process is stopped first, so
every launch starts a new process with the system's file caches warm (what
Android calls a cold launch, and what iOS calls a warm one). From each:

- first_frame_ms: `am start -W`'s TotalTime, from the launch starting to the
  activity's first frame. The shells keep their splash screen up until the
  app's first screen is ready, so it's the first frame the app draws.
- fully_drawn_ms: the system's `Fully drawn <package>/<activity>: +<time>`
  log line, which the shells print through Activity.reportFullyDrawn() when
  the app's first screen is complete (AngularLynx's reportFullyDrawn(), and
  the ReactLynx app's call to the same shell module), timed from the same
  start as TotalTime. Android reports a call made before the first frame at
  the first frame's time, so the two are equal when the app's screen was
  complete before its first frame: the screen can't be seen any sooner.
- memory_mb / rss_mb: `dumpsys meminfo`'s TOTAL PSS and TOTAL RSS for the
  app's process, read --memory-after seconds after the launch (6 by
  default), a few seconds after it's drawn. PSS divides each shared page
  among the processes that map it, which is how Android ranks apps' memory.

The apps take turns run by run (A B, B A, A B... and with more than two, the
order also rotates), as ios_launch.py does. Before the first measured run
each app is launched once unmeasured (--warmup), so the one-time work after
an install (ART verifying the app's code, the first unpack of its files)
isn't in any run.

The device's localhost:8787 is pointed at the Mac's with `adb reverse`, so
the apps reach the fixture server on the Mac at localhost
(benchmarks/fixtures/server.mjs).

An emulator runs on the Mac's cores, so a busy Mac slows every launch:
before each launch the harness waits until the Mac's 1-minute load average
is under --max-load (half its cores by default), and drops and repeats a run
whose load went over it. The load is recorded with every run, with the
device's battery, charging and thermal status (an emulator's are emulated).
An emulator's numbers aren't a phone's: they compare runs of one session.
"""

import argparse
import csv
import datetime
import os
import re
import shutil
import subprocess
import sys
import threading
import time

FIELDS = [
    "timestamp",
    "device",
    "os_build",
    "app",
    "package",
    "run",
    "launch_state",
    "first_frame_ms",
    "fully_drawn_ms",
    "memory_mb",
    "rss_mb",
    "thermal_state",
    "battery_percent",
    "charging",
    "host_load",
]

# ActivityTaskManager's line once an activity reports itself fully drawn:
# "Fully drawn com.example/dev.angularlynx.shell.MainActivity: +1s234ms".
FULLY_DRAWN = re.compile(r"Fully drawn (\S+?)/\S+: \+(?:(\d+)s)?(\d+)ms")


def find_adb():
    """adb from the PATH, ANDROID_HOME or Android Studio's default SDK."""
    found = shutil.which("adb")
    if found:
        return found
    for sdk in (
        os.environ.get("ANDROID_HOME"),
        os.environ.get("ANDROID_SDK_ROOT"),
        os.path.expanduser("~/Library/Android/sdk"),
        os.path.expanduser("~/Android/Sdk"),
    ):
        if sdk and os.path.exists(os.path.join(sdk, "platform-tools", "adb")):
            return os.path.join(sdk, "platform-tools", "adb")
    raise SystemExit("adb wasn't found: put the Android SDK's platform-tools on the PATH, or set ANDROID_HOME")


class Device:
    def __init__(self, adb, serial):
        self.adb = adb
        self.serial = serial

    def run(self, *args, check=True):
        return subprocess.run(
            [self.adb, "-s", self.serial, *args], check=check, capture_output=True, text=True
        ).stdout

    def shell(self, *args, check=True):
        return self.run("shell", *args, check=check)

    def prop(self, name):
        return self.shell("getprop", name).strip()

    def info(self):
        """The device's name and its Android version and build, as the device
        and os_build columns."""
        if self.prop("sys.boot_completed") != "1":
            raise SystemExit(f"{self.serial} hasn't finished booting")
        model = self.prop("ro.product.model")
        if self.prop("ro.kernel.qemu") == "1" or self.serial.startswith("emulator-"):
            avd = self.run("emu", "avd", "name", check=False).splitlines()
            model = f"{avd[0].strip() if avd else model} (emulator)"
        return model, f"{self.prop('ro.build.version.release')} ({self.prop('ro.build.id')})"

    def activity(self, package):
        """The package's launcher activity, as package/class."""
        resolved = self.shell("cmd", "package", "resolve-activity", "--brief", package).strip().splitlines()
        if not resolved or "/" not in resolved[-1]:
            raise SystemExit(f"{package} isn't installed on {self.serial}, or has no launcher activity")
        return resolved[-1].strip()

    def battery(self):
        """(level, charging) from dumpsys battery."""
        values = {}
        for line in self.shell("dumpsys", "battery").splitlines():
            key, _, value = line.strip().partition(": ")
            values[key] = value
        charging = any(values.get(f"{source} powered") == "true" for source in ("AC", "USB", "Wireless"))
        return values.get("level", ""), "true" if charging else "false"

    def thermal(self):
        match = re.search(r"Thermal Status: (\d+)", self.shell("dumpsys", "thermalservice", check=False))
        return match.group(1) if match else ""

    def memory(self, package):
        """(PSS, RSS) of the package's process in KB, from dumpsys meminfo,
        or None when it isn't running."""
        output = self.shell("dumpsys", "meminfo", package, check=False)
        pss = re.search(r"TOTAL PSS:\s+(\d+)", output)
        rss = re.search(r"TOTAL RSS:\s+(\d+)", output)
        if not pss:
            return None
        return int(pss.group(1)), int(rss.group(1)) if rss else None


class FullyDrawnWatcher:
    """Follows logcat for the system's `Fully drawn` lines. One logcat for
    the whole session rather than one per launch: starting adb's logcat
    takes time the launch would share the emulator's cores with."""

    def __init__(self, device):
        device.run("logcat", "-c", check=False)
        self.process = subprocess.Popen(
            [device.adb, "-s", device.serial, "logcat", "-v", "brief", "-e", "Fully drawn"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self.condition = threading.Condition()
        self.seen = []
        threading.Thread(target=self.follow, daemon=True).start()

    def follow(self):
        for line in self.process.stdout:
            match = FULLY_DRAWN.search(line)
            if match:
                ms = int(match.group(2) or 0) * 1000 + int(match.group(3))
                with self.condition:
                    self.seen.append((match.group(1), ms))
                    self.condition.notify_all()

    def mark(self):
        """Where the next launch's lines start."""
        with self.condition:
            return len(self.seen)

    def wait(self, package, since, deadline):
        """The package's fully drawn time after `since`, waiting until the
        monotonic `deadline`, or None."""
        with self.condition:
            while True:
                for name, ms in self.seen[since:]:
                    if name == package:
                        return ms
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.condition.wait(remaining)

    def close(self):
        self.process.terminate()


def run_order(apps, run):
    """As ios_launch.py's: listed on odd runs, reversed on even ones, and
    with more than two apps also rotated by one every two runs, so each app
    follows each of the others in turn."""
    if len(apps) > 2:
        turn = (run - 1) // 2 % len(apps)
        apps = apps[turn:] + apps[:turn]
    return list(apps) if run % 2 else list(reversed(apps))


def wait_for_load(max_load):
    """Waits until the Mac's 1-minute load average is at most max_load."""
    waiting_since = None
    while os.getloadavg()[0] > max_load:
        if waiting_since is None or time.monotonic() - waiting_since > 60:
            print(
                f"the Mac's load average is {os.getloadavg()[0]:.1f}, over --max-load {max_load}: waiting",
                file=sys.stderr,
                flush=True,
            )
            waiting_since = time.monotonic()
        time.sleep(5)


def launch(device, watcher, package, activity, seconds, memory_after):
    """Launches the app once from a stopped process, and returns what it
    measured. The app is stopped again at the end."""
    since = watcher.mark()
    started = time.monotonic()
    # -S stops the app first, -W waits for its first frame and prints the
    # launch's times.
    output = device.shell("am", "start", "-S", "-W", "-n", activity)
    values = dict(
        line.strip().split(": ", 1) for line in output.splitlines() if ": " in line.strip()
    )
    if values.get("Status") != "ok":
        raise RuntimeError(f"am start: {output.strip()[-300:]}")
    # Memory first, at the same moment of every launch: waiting for Fully
    # drawn first would move a slow or missing one's reading later. The
    # watcher keeps every line it sees, so one logged meanwhile isn't lost.
    pause = started + memory_after - time.monotonic()
    if pause > 0:
        time.sleep(pause)
    memory = device.memory(package)
    fully_drawn = watcher.wait(package, since, started + seconds)
    rest = started + seconds - time.monotonic()
    if rest > 0:
        time.sleep(rest)
    device.shell("am", "force-stop", package)
    kb = lambda value: f"{value / 1024:.1f}" if value else ""
    return {
        "launch_state": values.get("LaunchState", ""),
        "first_frame_ms": values.get("TotalTime", ""),
        "fully_drawn_ms": str(fully_drawn) if fully_drawn is not None else "",
        "memory_mb": kb(memory[0]) if memory else "",
        "rss_mb": kb(memory[1]) if memory else "",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the emulator's or phone's serial (adb devices)")
    parser.add_argument("--app", action="append", required=True, help="name=application.id, two or more")
    parser.add_argument("--runs", type=int, default=20, help="launches per app")
    parser.add_argument("--seconds", type=float, default=10, help="how long each launch runs before it's stopped")
    parser.add_argument("--out", required=True, help="the CSV to append to")
    parser.add_argument("--rest", type=float, default=3, help="seconds between launches")
    parser.add_argument(
        "--memory-after",
        type=float,
        default=6,
        help="seconds after each launch starts to read the app's memory (default 6)",
    )
    parser.add_argument("--warmup", type=int, default=1, help="unmeasured launches of each app first (default 1)")
    parser.add_argument("--fixture-port", type=int, default=8787, help="the fixture server's port on the Mac")
    parser.add_argument(
        "--max-load",
        type=float,
        help="drop a run whose launch ends with the Mac's 1-minute load average over this, and launch it "
        "again once the load is under it (default: half the Mac's cores; 0 turns it off)",
    )
    args = parser.parse_args()
    if args.max_load is None:
        args.max_load = (os.cpu_count() or 2) / 2
    if args.memory_after >= args.seconds:
        parser.error("--memory-after has to be under --seconds: the app is stopped at the end of each launch")

    device = Device(find_adb(), args.device)
    name, os_build = device.info()
    device.run("reverse", f"tcp:{args.fixture_port}", f"tcp:{args.fixture_port}")
    apps = [tuple(app.split("=", 1)) for app in args.app]
    activities = {package: device.activity(package) for _, package in apps}
    watcher = FullyDrawnWatcher(device)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    new_file = not os.path.exists(args.out)
    out = open(args.out, "a", newline="")
    writer = csv.DictWriter(out, fieldnames=FIELDS)
    if new_file:
        writer.writeheader()

    try:
        for _ in range(args.warmup):
            for app, package in apps:
                if args.max_load:
                    wait_for_load(args.max_load)
                try:
                    launch(device, watcher, package, activities[package], args.seconds, args.memory_after)
                except (RuntimeError, subprocess.CalledProcessError) as error:
                    print(f"{app} warm-up: {error}", file=sys.stderr, flush=True)
                time.sleep(args.rest)
        for run in range(1, args.runs + 1):
            for app, package in run_order(apps, run):
                while True:
                    if args.max_load:
                        wait_for_load(args.max_load)
                    before = os.getloadavg()[0]
                    battery, charging = device.battery()
                    row = {
                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                        "device": name,
                        "os_build": os_build,
                        "app": app,
                        "package": package,
                        "run": run,
                        "battery_percent": battery,
                        "charging": charging,
                    }
                    try:
                        values = launch(device, watcher, package, activities[package], args.seconds, args.memory_after)
                    except (RuntimeError, subprocess.CalledProcessError) as error:
                        print(f"{app} run {run}: {error}", file=sys.stderr, flush=True)
                        values = {}
                    # The emulator runs on the Mac's cores and the Mac serves
                    # the fixtures: the 1-minute average after the launch
                    # covers it, the one before covers the minute before.
                    load = os.getloadavg()[0]
                    row["host_load"] = f"{max(before, load):.1f}"
                    if not args.max_load or load <= args.max_load:
                        break
                    print(
                        f"{app} run {run}: dropped, the Mac's load average reached {load:.1f}; launching it again",
                        file=sys.stderr,
                        flush=True,
                    )
                row["thermal_state"] = device.thermal()
                writer.writerow({**row, **values})
                out.flush()
                print(
                    f"{app:>18} run {run:>2}: first frame {values.get('first_frame_ms') or '?':>5} ms, "
                    f"fully drawn {values.get('fully_drawn_ms') or '?':>5} ms, "
                    f"PSS {values.get('memory_mb') or '?'} MB, load {row['host_load']}",
                    flush=True,
                )
                time.sleep(args.rest)
    finally:
        watcher.close()
        out.close()


if __name__ == "__main__":
    main()
