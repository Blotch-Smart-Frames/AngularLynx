#!/usr/bin/env python3
"""Runs the tap benchmarks for AngularLynx and one other app: for each
benchmark, builds both apps for it and runs ios_tap.py, which installs them
one at a time beside the tapper's runner (a free Apple team can have three
apps on a phone).

    python3 ios_tap_session.py --device <UDID> --rival react-lynx --runs 10
    python3 ios_tap_session.py --device <UDID> --rival react-lynx --handler main-thread

- tap, update and busy: the apps built to open on that screen (BENCH_SCREEN).
- first-tap: the Pokédex as it ships, with no BENCH_SCREEN.

`--handler main-thread` builds ReactLynx's screens with its main-thread
handlers (`tap?handler=main-thread`, SPEC.md); the Pokédex has none, so that
session skips the first tap. AngularLynx is installed as
com.angularlynx.bench.angularlynx and the rival as com.angularlynx.bench.rival,
as for the mount benchmark, and the results are appended to
../results/ios/<bench>-<date>-<rival>[-main-thread].csv.
"""

import argparse
import datetime
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ios_mount import HERE, OURS, RIVAL  # noqa: E402

BENCHES = {"tap": "tap", "update": "update", "busy": "busy", "first-tap": ""}


def build(app, bundle_id, screen):
    """Builds the app for the phone, and returns its .app."""
    return subprocess.run(
        ["sh", os.path.join(HERE, "build_ios_app.sh"), app, bundle_id, screen],
        check=True, capture_output=True, text=True,
    ).stdout.strip().splitlines()[-1]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--device", required=True)
    parser.add_argument("--rival", required=True, help="a folder in ../apps")
    parser.add_argument("--handler", choices=["default", "main-thread"], default="default",
                        help="ReactLynx's handlers (SPEC.md, \"Benchmark screens\")")
    parser.add_argument("--runs", type=int, default=10, help="launches per app and benchmark")
    parser.add_argument("--benches", default=",".join(BENCHES), help="which, comma-separated")
    args = parser.parse_args()
    date = datetime.date.today().isoformat()
    rival = args.rival if args.handler == "default" else f"{args.rival}-{args.handler}"
    for bench in args.benches.split(","):
        screen = BENCHES[bench]
        rival_screen = screen
        if args.handler != "default":
            if not screen:
                print(f"== {bench}: skipped, the Pokédex has no {args.handler} handlers", flush=True)
                continue
            rival_screen = f"{screen}?handler={args.handler}"
        print(f"== {bench}: building", flush=True)
        ours = build("angular-lynx", OURS, screen)
        theirs = build(args.rival, RIVAL, rival_screen)
        subprocess.run(
            [
                sys.executable, "-u", os.path.join(HERE, "ios_tap.py"),
                "--device", args.device,
                "--bench", bench,
                "--runs", str(args.runs),
                "--app", f"angular-lynx={OURS}={ours}",
                "--app", f"{rival}={RIVAL}={theirs}",
                "--out", os.path.join(HERE, "..", "results", "ios", f"{bench}-{date}-{rival}.csv"),
            ],
            check=True,
        )


if __name__ == "__main__":
    main()
