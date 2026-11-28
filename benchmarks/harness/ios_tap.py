#!/usr/bin/env python3
"""Runs the tap benchmarks: each app launched under Instruments with its
probe on, tapped by the tapper, and timed from the touch reaching the app to
the frame that shows what the tap changed.

    python3 ios_tap.py --device <UDID> --bench tap --runs 10 \\
        --app angular-lynx=com.angularlynx.bench.angularlynx \\
        --app react-lynx=com.angularlynx.bench.rival \\
        --out ../results/ios/tap-<date>-react-lynx.csv

The apps are built for the benchmark's screen (build_ios_app.sh with `tap`,
`update`, `busy` or no screen for `first-tap`; or ios_tap_session.py, which
builds them too). Either they're installed already, or each `--app` gives its
.app as a third field (`name=bundle.id=path/to/App.app`), and the script
keeps one of them installed at a time, as ios_scroll.py does: a free Apple
team can have three apps on a phone, and the tapper's runner is one. Each
install is followed by an unmeasured launch (the tapper's testWarm), which
allows the local network prompt a new install asks for, so the measured
launch never shows it; `installed` is `yes` on the runs right after one.

- tap: the tap screen (SPEC.md, "Tap"), tapped once a second at its button.
  One CSV row per tap.
- update: the update screen, its three buttons tapped in turn, once a second.
  One CSV row per tap; `button` is 0 (1 row), 1 (every 10th) or 2 (every row).
- busy: the busy screen, whose handler works for 50 ms, tapped once a second
  while its box moves. One CSV row per tap, with how many frames the box
  stood still in the half second after the touch (and in the half second
  before it, when nothing was tapped).
- first-tap: the Pokédex, its first row's heart tapped over and over from
  the moment the app comes to the front. One CSV row per launch, timed from
  the process starting to the first tap whose change reaches the screen.

How a run goes: the tapper (tapper/, an XCUITest bundle) starts first and
waits for the app to come to the front. Then `xctrace record --launch` starts
the app with BENCH_PROBE=1, which turns on its probe (probe/BenchProbe.m), and
records Points of Interest, dyld Activity and Thermal State. The probe marks
each touch as it reaches the app ("Touch"), the end of each run loop pass
that changed what the screen watches ("Commit"), and the display link tick
after it ("Frame"), whose target time is the frame that change is first shown
in. Every time in the probe's messages is the app's CACurrentMediaTime();
the harness puts them on the trace's clock through the Commit event's own
time.

The apps alternate run by run (ABBA order), as in ios_launch.py, and battery,
charging, thermal state, the OS build and the Mac's load are recorded with
every run.
"""

import argparse
import csv
import datetime
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ios_launch import FULLY_DRAWN, device_value, of_pid  # noqa: E402
from xctrace_tables import tables  # noqa: E402

TAPPER = os.path.join(HERE, "tapper")

# Where each benchmark taps, as fractions of the screen. Every app lays its
# screens out the same way (SPEC.md): the tap screen's button is its bottom
# half, and the update screen's three buttons share its bottom quarter.
POINTS = {
    "tap": "0.5,0.75",
    "update": "0.1667,0.875;0.5,0.875;0.8333,0.875",
    "busy": "0.5,0.75",
}

# How each benchmark taps: (seconds to wait once the app is in front, taps,
# seconds from one tap to the next, seconds to record).
PLANS = {
    "tap": (3, 12, 1, 20),
    # Longer to start: the first launch after an install can still be
    # building the 1,000 rows three seconds in, and a lost first tap would
    # leave the run without its buttons' order.
    "update": (5, 12, 1, 22),
    # 1.37 s apart, out of step with the box's 1 s legs: taps a whole second
    # apart would land at the same point of its path every time, so anything
    # the animation does there of its own (a turn) would fall after every tap
    # and never before one.
    "busy": (3, 12, 1.37, 25),
    # As fast as the tapper can, for the first six seconds.
    "first-tap": (0, 40, 0.1, 10),
}

TAP_FIELDS = [
    "timestamp", "device", "os_build", "app", "bundle_id", "bench", "run", "tap", "button",
    "touch_ms", "delivery_ms", "commit_ms", "frame_ms", "changes",
    "stalled_frames", "longest_stall_ms", "idle_stalled_frames",
    "thermal_state", "battery_percent", "charging", "host_load", "installed", "error",
]
FIRST_TAP_FIELDS = [
    "timestamp", "device", "os_build", "app", "bundle_id", "bench", "run",
    "fully_drawn_ms", "first_touch_ms", "first_change_ms", "taps_before", "tap_to_frame_ms",
    "thermal_state", "battery_percent", "charging", "host_load", "installed", "error",
]


# The probe's counts; every other number in its messages is a time.
COUNTS = ("changes", "ticks")


def message_values(message):
    """A probe message's `key=value` pairs: times in seconds (the probe sends
    whole microseconds), counts as numbers. Instruments groups a number's
    thousands with commas, which go."""
    values = {}
    for key, value in re.findall(r"(\w+)=(\S+)", message or ""):
        try:
            number = float(value.replace(",", ""))
        except ValueError:
            values[key] = value
            continue
        values[key] = number if key in COUNTS else number / 1e6
    return values


def probe_events(trace):
    """The launched process's start (trace ns), its fully-drawn time (trace
    ns), and its probe events, each with `time` (trace ns) and its message's
    values, in order, plus the thermal states."""
    data = tables(trace, "dyld-activity-interval", "PointsOfInterestEvents", "device-thermal-state-intervals")
    launches = [r for r in data["dyld-activity-interval"] if r["type"][1] == "Launch Executable"]
    if not launches:
        raise RuntimeError("no dyld launch in the trace")
    launch = min(launches, key=lambda r: int(r["start"][0]))
    pid = launch["process"][2].findtext("pid")
    start = int(launch["start"][0])
    events = []
    fully_drawn = None
    for r in data["PointsOfInterestEvents"]:
        if not of_pid(r["process"], pid):
            continue
        name = r["name"][1]
        if name in FULLY_DRAWN:
            fully_drawn = fully_drawn or int(r["time"][0])
            continue
        if name not in ("Touch", "Commit", "Frame", "Stall"):
            continue
        events.append({"name": name, "time": int(r["time"][0]), **message_values(r["message"][1])})
    events.sort(key=lambda e: e["time"])
    thermal = sorted({r["thermal-state"][1] for r in data["device-thermal-state-intervals"]})
    return start, fully_drawn, events, "/".join(thermal)


def clock_offset(events):
    """Trace ns minus the app's CACurrentMediaTime() in ns, from the events
    whose time is in their message: a Touch's `now` and a Commit's `commit`
    are taken right before the signpost is emitted. The smallest difference
    is the one with the least delay between the two."""
    offsets = [
        e["time"] - e["now"] * 1e9 if e["name"] == "Touch" else e["time"] - e["commit"] * 1e9
        for e in events
        if e["name"] in ("Touch", "Commit")
    ]
    if not offsets:
        raise RuntimeError("no probe events in the trace: was the app built with the probe?")
    return min(offsets)


def taps_of(events):
    """Each tap (a touch down and the up after it), with the frames whose
    commit came after its up and before the next tap's down."""
    taps = []
    down = None
    for e in events:
        if e["name"] == "Touch" and e["phase"] == "down":
            down = e
        elif e["name"] == "Touch" and e["phase"] == "up" and down is not None:
            taps.append({"down": down, "up": e, "commits": [], "frames": []})
            down = None
    for i, tap in enumerate(taps):
        end = taps[i + 1]["down"]["now"] if i + 1 < len(taps) else float("inf")
        for e in events:
            if e["name"] == "Commit" and tap["up"]["now"] <= e["commit"] < end:
                tap["commits"].append(e)
            if e["name"] == "Frame" and tap["up"]["now"] <= e["commit"] < end:
                tap["frames"].append(e)
    return taps


# How long after a touch the busy screen's box is watched for stalls, and
# how long before it for the frames it stalls with nothing tapped.
STALL_WINDOW = 0.5


def stalls_in(events, start, end):
    """The frames the box stood still in [start, end), and the longest stall
    there in ms. Only a stall's frames inside the window count, so one that
    crosses a touch isn't counted both before and after it. A Stall runs from
    the tick the box last moved at to the one it moved again, with its still
    ticks between, a frame apart."""
    frames, longest = 0, 0.0
    for e in events:
        if e["name"] != "Stall" or e["to"] <= start or e["from"] >= end:
            continue
        frame = (e["to"] - e["from"]) / (e["ticks"] + 1)
        inside = sum(1 for k in range(1, int(e["ticks"]) + 1) if start <= e["from"] + k * frame < end)
        if inside:
            frames += inside
            # From the tick before the first still one inside to the tick
            # after the last: the whole stall, when it's all inside.
            longest = max(longest, (inside + 1) * frame * 1e3)
    return frames, longest


def measure_taps(trace, points, tapped, busy=False):
    """One row per tap: how long the finger was down, how long the touch took
    to reach the app (from the touch screen's timestamp), and from its
    reaching the app to the last commit and the last frame of what it
    changed."""
    _start, _fully_drawn, events, thermal = probe_events(trace)
    found = taps_of(events)
    # A tap's button is its place in the run, so a run that lost one can't
    # say which button the rest were.
    if len(found) != tapped:
        raise RuntimeError(f"{len(found)} of the {tapped} taps reached the app")
    rows = []
    for i, tap in enumerate(found):
        up = tap["up"]
        row = {
            "tap": i + 1,
            "button": i % points,
            "touch_ms": f"{(up['now'] - tap['down']['now']) * 1e3:.1f}",
            "delivery_ms": f"{(up['now'] - up['hid']) * 1e3:.1f}",
            "thermal_state": thermal,
        }
        if tap["frames"]:
            # The last: a change made over several run loop passes is only
            # all on screen with the last one's frame.
            frame = tap["frames"][-1]
            row["commit_ms"] = f"{(frame['commit'] - up['now']) * 1e3:.1f}"
            row["frame_ms"] = f"{(frame['target'] - up['now']) * 1e3:.1f}"
            row["changes"] = int(sum(f["changes"] for f in tap["frames"]))
        if busy:
            frames, longest = stalls_in(events, up["now"], up["now"] + STALL_WINDOW)
            row["stalled_frames"] = frames
            row["longest_stall_ms"] = f"{longest:.1f}"
            row["idle_stalled_frames"] = stalls_in(
                events, tap["down"]["now"] - STALL_WINDOW, tap["down"]["now"])[0]
        rows.append(row)
    return rows


def measure_first_tap(trace):
    """From the process starting to the frame of the first change a tap made
    (the heart's label changing), and which tap it was. The probe can't say
    which touch a change answers, so it's the last touch before the change's
    commit: right while the app answers faster than the taps come, and a
    lower bound on tap_to_frame_ms (with taps_before too high) when a late
    answer to one tap is committed after the next."""
    start, fully_drawn, events, thermal = probe_events(trace)
    offset = clock_offset(events)
    to_ms = lambda seconds: f"{(seconds * 1e9 + offset - start) / 1e6:.1f}"
    ups = [e for e in events if e["name"] == "Touch" and e["phase"] == "up"]
    row = {
        "fully_drawn_ms": f"{(fully_drawn - start) / 1e6:.1f}" if fully_drawn else "",
        "first_touch_ms": to_ms(ups[0]["now"]) if ups else "",
        "thermal_state": thermal,
    }
    # The first frame after a touch: a change before any touch is the app's
    # own first render.
    frames = [e for e in events if e["name"] == "Frame" and ups and e["commit"] >= ups[0]["now"]]
    if frames:
        frame = frames[0]
        answered = [u for u in ups if u["now"] <= frame["commit"]]
        row["first_change_ms"] = to_ms(frame["target"])
        row["taps_before"] = len(answered) - 1
        row["tap_to_frame_ms"] = f"{(frame['target'] - answered[-1]['now']) * 1e3:.1f}"
    return row


class Tapper:
    """The tapper's built test bundle, run on one device."""

    def __init__(self, device, simulator):
        self.device = device
        self.simulator = simulator
        self.derived = os.path.join(TAPPER, "build")
        platform = "iphonesimulator" if simulator else "iphoneos"
        # Built every session, so an edit to the tapper is never left out;
        # xcodebuild skips it when nothing changed.
        self.build()
        found = glob.glob(os.path.join(self.derived, "Build", "Products", f"Tapper_Tapper_{platform}*.xctestrun"))
        # Without its DSTROOTPath: with one, xcodebuild installs the runner on
        # a phone as a "root", which only Apple's internal iOS builds accept.
        self.xctestrun = os.path.join(self.derived, "Build", "Products", f"tapper-{platform}.xctestrun")
        self.runner = os.path.join(self.derived, "Build", "Products", f"Debug-{platform}", "Tapper-Runner.app")
        shutil.copy(found[0], self.xctestrun)
        subprocess.run(
            ["plutil", "-remove", "TestConfigurations.0.TestTargets.0.DSTROOTPath", self.xctestrun],
            check=False, capture_output=True,
        )

    def build(self):
        subprocess.run(["xcodegen", "generate", "--quiet"], cwd=TAPPER, check=True)
        destination = "generic/platform=iOS Simulator" if self.simulator else "generic/platform=iOS"
        subprocess.run(
            [
                "xcodebuild", "build-for-testing", "-project", "Tapper.xcodeproj", "-scheme", "Tapper",
                "-destination", destination, "-derivedDataPath", self.derived, "-allowProvisioningUpdates",
            ],
            cwd=TAPPER, check=True, capture_output=True,
        )

    def start(self, test, settings):
        """Starts a test, and returns once it has printed TAPPER READY."""
        env = {**os.environ, **{f"TEST_RUNNER_{k}": str(v) for k, v in settings.items()}}
        process = subprocess.Popen(
            [
                "xcodebuild", "test-without-building", "-xctestrun", self.xctestrun,
                "-destination", f"id={self.device}", f"-only-testing:Tapper/Tapper/{test}",
            ],
            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        lines = []
        ready = threading.Event()

        def read():
            for line in process.stdout:
                lines.append(line)
                if "TAPPER READY" in line:
                    ready.set()
            ready.set()

        threading.Thread(target=read, daemon=True).start()
        if not ready.wait(180) or process.poll() not in (None, 0):
            process.kill()
            raise RuntimeError("the tapper didn't start:\n" + "".join(lines[-30:]))
        return process, lines

    def locate(self, bundle_id, label):
        """Where the app's element with this label is (the app must be in
        front), as `x,y` fractions of the screen."""
        process, lines = self.start("testLocate", {"TAP_APP": bundle_id, "TAP_LABEL": label})
        process.wait()
        return self.located(bundle_id, label, lines)

    def warm(self, bundle_id, label=None):
        """Opens a newly installed app once and closes it (testWarm), and
        returns where `label` is, when given."""
        settings = {"TAP_APP": bundle_id, **({"TAP_LABEL": label} if label else {})}
        process, lines = self.start("testWarm", settings)
        if process.wait() != 0:
            raise RuntimeError(f"the warm-up launch of {bundle_id} failed:\n" + "".join(lines[-30:]))
        return self.located(bundle_id, label, lines) if label else None

    @staticmethod
    def located(bundle_id, label, lines):
        for line in lines:
            match = re.search(r"TAPPER LOCATE .*=([\d.]+,[\d.]+)", line)
            if match:
                return match.group(1)
        raise RuntimeError(f"no {label} in {bundle_id}:\n" + "".join(lines[-30:]))


def install(device, simulator, path):
    if simulator:
        subprocess.run(["xcrun", "simctl", "install", device, path], check=True, capture_output=True)
    else:
        subprocess.run(["xcrun", "devicectl", "device", "install", "app", "--device", device, path], check=True,
                       capture_output=True)


def uninstall(device, simulator, bundle_id):
    # Not checked: it isn't an error for the app not to be there.
    if simulator:
        subprocess.run(["xcrun", "simctl", "uninstall", device, bundle_id], capture_output=True)
    else:
        subprocess.run(["xcrun", "devicectl", "device", "uninstall", "app", "--device", device, bundle_id],
                       capture_output=True)


def launch(device, simulator, bundle_id):
    """Opens the app without Instruments, for the tapper to locate things in."""
    if simulator:
        subprocess.run(["xcrun", "simctl", "launch", "--terminate-running-process", device, bundle_id], check=True,
                       capture_output=True)
    else:
        subprocess.run(
            ["xcrun", "devicectl", "device", "process", "launch", "--terminate-existing", "--device", device,
             bundle_id],
            check=True, capture_output=True,
        )


def record(device, bundle_id, trace, seconds, extra=()):
    subprocess.run(
        [
            "xcrun", "xctrace", "record",
            "--instrument", "Points of Interest",
            "--instrument", "dyld Activity",
            "--instrument", "Thermal State",
            *(arg for instrument in extra for arg in ("--instrument", instrument)),
            "--device", device,
            "--time-limit", f"{seconds}s",
            "--output", trace,
            "--no-prompt",
            "--env", "BENCH_PROBE=1",
            "--launch", "--", bundle_id,
        ],
        check=True, capture_output=True, text=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True, help="the iPhone's (or a simulator's) UDID")
    parser.add_argument("--bench", required=True, choices=sorted(PLANS))
    parser.add_argument(
        "--app", action="append", required=True,
        help="name=bundle.id, or name=bundle.id=path/to/App.app to keep one app installed at a time; two or more",
    )
    parser.add_argument("--runs", type=int, default=10, help="launches per app")
    parser.add_argument("--out", required=True, help="the CSV to append to")
    parser.add_argument("--keep-traces", help="a folder to keep each trace in")
    parser.add_argument("--rest", type=float, default=3, help="seconds between launches")
    parser.add_argument("--simulator", action="store_true", help="the device is a simulator")
    parser.add_argument(
        "--instrument", action="append", default=[],
        help="another instrument to record, such as Display and Hitches, to check the probe's frames against Instruments' own",
    )
    args = parser.parse_args()

    apps = [tuple(app.split("=", 2)) for app in args.app]
    swap = all(len(app) == 3 for app in apps)
    paths = {app[1]: app[2] for app in apps if len(app) == 3}
    apps = [(app[0], app[1]) for app in apps]
    tapper = Tapper(args.device, args.simulator)
    start_wait, count, interval, seconds = PLANS[args.bench]
    heart = "Add to favorites|Remove from favorites"

    # The first-tap benchmark taps the first row's heart, wherever each app
    # draws it: found once per app, before any timed run (when it's swapped
    # in, by its first install's warm-up launch).
    points = {}
    if swap:
        # The runner goes on first, and stays: iOS removes a developer's
        # profile, and the phone's trust in it, with the last app it signed,
        # so the team's apps never all leave the phone at once, even between
        # two installs. Then room for it: none of the apps is installed until
        # its turn.
        install(args.device, args.simulator, tapper.runner)
        for _, bundle_id in apps:
            uninstall(args.device, args.simulator, bundle_id)
    for name, bundle_id in apps:
        if args.bench != "first-tap":
            points[name] = POINTS[args.bench]
        elif not swap:
            launch(args.device, args.simulator, bundle_id)
            points[name] = tapper.locate(bundle_id, heart)
            print(f"{name}: the heart is at {points[name]}", flush=True)
    installed = None

    if args.simulator:
        device, os_build = "simulator", ""
    else:
        device = device_value(args.device, "ProductType")
        os_build = f"{device_value(args.device, 'ProductVersion')} ({device_value(args.device, 'BuildVersion')})"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    fields = FIRST_TAP_FIELDS if args.bench == "first-tap" else TAP_FIELDS
    new_file = not os.path.exists(args.out)
    out = open(args.out, "a", newline="")
    writer = csv.DictWriter(out, fieldnames=fields)
    if new_file:
        writer.writeheader()
    work = tempfile.mkdtemp(prefix="ios-tap-")

    for run in range(1, args.runs + 1):
        order = apps if run % 2 else list(reversed(apps))
        for name, bundle_id in order:
            fresh = swap and installed != bundle_id
            if fresh:
                # The outgoing app first, for the free team's limit of
                # three: the runner keeps the team on the phone meanwhile.
                if installed:
                    uninstall(args.device, args.simulator, installed)
                install(args.device, args.simulator, paths[bundle_id])
                installed = bundle_id
                located = tapper.warm(bundle_id, heart if args.bench == "first-tap" and name not in points else None)
                if located:
                    points[name] = located
                    print(f"{name}: the heart is at {located}", flush=True)
            trace = os.path.join(work, f"{args.bench}-{name}-{run}.trace")
            base = {
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "device": device,
                "os_build": os_build,
                "app": name,
                "bundle_id": bundle_id,
                "bench": args.bench,
                "run": run,
                "battery_percent": "" if args.simulator else device_value(
                    args.device, "BatteryCurrentCapacity", "com.apple.mobile.battery"),
                "charging": "" if args.simulator else device_value(
                    args.device, "BatteryIsCharging", "com.apple.mobile.battery"),
                "host_load": f"{os.getloadavg()[0]:.1f}",
                "installed": "yes" if fresh else "",
            }
            lines = []
            process = None
            try:
                process, lines = tapper.start("testTap", {
                    "TAP_APP": bundle_id,
                    "TAP_POINTS": points[name],
                    "TAP_COUNT": count,
                    "TAP_INTERVAL": interval,
                    "TAP_START": start_wait,
                })
                record(args.device, bundle_id, trace, seconds, args.instrument)
                process.wait(timeout=120)
                if args.bench == "first-tap":
                    rows = [measure_first_tap(trace)]
                else:
                    rows = measure_taps(trace, len(points[name].split(";")), count, busy=args.bench == "busy")
            except Exception as error:  # noqa: BLE001 - one bad run shouldn't end a session
                # Recorded, so every run is in the CSV, and left out of the
                # medians (summarize_taps.py).
                print(f"{name} run {run}: {error}", file=sys.stderr, flush=True)
                rows = [{"error": str(error).splitlines()[0]}]
            finally:
                # A tapper left running after a failed recording would go on
                # tapping into the next run.
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait()
            for row in rows:
                writer.writerow({**base, **row})
            out.flush()
            if args.bench == "first-tap":
                row = rows[0]
                print(
                    f"{name:>18} run {run:>2}: fully drawn {row.get('fully_drawn_ms', '?'):>7} ms, "
                    f"first change {row.get('first_change_ms', '?'):>7} ms "
                    f"({row.get('taps_before', '?')} taps before it)",
                    flush=True,
                )
            else:
                frames = sorted(float(r["frame_ms"]) for r in rows if r.get("frame_ms"))
                median = frames[len(frames) // 2] if frames else None
                print(
                    f"{name:>18} run {run:>2}: {len(frames)}/{len(rows)} taps drawn, "
                    f"median {median if median is not None else '?'} ms to the frame",
                    flush=True,
                )
            if args.keep_traces:
                os.makedirs(args.keep_traces, exist_ok=True)
                kept = os.path.join(args.keep_traces, os.path.basename(trace))
                # A trace is a folder: moved onto an older one of the same
                # name, it would land inside it.
                shutil.rmtree(kept, ignore_errors=True)
                # None when the run failed before Instruments wrote one.
                if os.path.exists(trace):
                    shutil.move(trace, kept)
                # The tapper's own log, with when it tapped, to check a run
                # whose taps the trace doesn't show.
                with open(os.path.join(args.keep_traces, f"{args.bench}-{name}-{run}.tapper.log"), "w") as log:
                    log.writelines(lines)
            else:
                shutil.rmtree(trace, ignore_errors=True)
            time.sleep(args.rest)
    out.close()
    shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
