"""Tests for nightly.py's report: the night's numbers, the sustained change
rule and the files it writes. The nightly workflow runs them before it
builds anything (python3 -m unittest discover -s benchmarks/harness -p
'*_test.py')."""

import argparse
import csv
import hashlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nightly  # noqa: E402

FIELDS = ["timestamp", "device", "os_build", "app", "run", "fully_drawn_ms", "memory_mb", "host_load"]


def rows(app_values, column="fully_drawn_ms"):
    """CSV rows for each app's values of one column."""
    out = []
    for app, values in app_values.items():
        for run, value in enumerate(values, 1):
            out.append(
                {
                    "timestamp": f"2026-11-28T02:{run:02d}:00+00:00",
                    "device": "iPhone 18 Pro (Simulator)",
                    "os_build": "27.0 (24A000)",
                    "app": app,
                    "run": str(run),
                    column: "" if value is None else str(value),
                    "host_load": "1.2",
                }
            )
    return out


def launches(app_values, memory=50):
    """Launch rows with a fully drawn time each, and the same memory."""
    out = rows(app_values)
    for row in out:
        row["memory_mb"] = str(memory)
    return out


def commit_of(date):
    return hashlib.sha1(date.encode()).hexdigest()


def record(date, ratios):
    """A history record whose metrics have these AngularLynx / ReactLynx
    ratios, ReactLynx at 100."""
    return {
        "date": date,
        "commit": commit_of(date),
        "run": f"https://example.invalid/{date}",
        "metrics": {metric: {nightly.OURS: value * 100, nightly.RIVAL: 100} for metric, value in ratios.items()},
    }


def nights(*values, metric="launch.fully_drawn_ms"):
    return [record(f"2026-11-{day:02d}", {metric: value}) for day, value in enumerate(values, 1)]


class NightTest(unittest.TestCase):
    def test_medians_and_cost_per_element(self):
        launch = rows({"angular-lynx": [1900, 2000, 2100], "react-lynx": [1500, 1600, 1700]})
        for row, memory in zip(launch, [60, 61, 62, 40, 41, 42]):
            row["memory_mb"] = str(memory)
        mount = {
            ("text", 1500): rows({"angular-lynx": [2000, 2010], "react-lynx": [1800, 1810]}),
            ("text", 5000): rows({"angular-lynx": [2285, 2295], "react-lynx": [1940, 1950]}),
        }
        result = nightly.night(launch, mount, "2026-11-28", "abc1234", "")
        self.assertEqual(result["metrics"]["launch.fully_drawn_ms"], {"angular-lynx": 2000, "react-lynx": 1600})
        self.assertEqual(result["metrics"]["launch.memory_mb"], {"angular-lynx": 61, "react-lynx": 41})
        # (2290 - 2005) / 3500 ms and (1945 - 1805) / 3500 ms, in µs.
        cost = result["metrics"]["mount.text.us_per_element"]
        self.assertAlmostEqual(cost["angular-lynx"], 285 / 3.5)
        self.assertAlmostEqual(cost["react-lynx"], 140 / 3.5)
        # A kind with only one screen measured has no cost.
        self.assertNotIn("mount.view.us_per_element", result["metrics"])
        self.assertEqual(result["launches"], {"angular-lynx": 3, "react-lynx": 3})
        self.assertEqual(result["device"], "iPhone 18 Pro (Simulator)")

    def test_runs_that_drew_nothing_are_left_out_and_counted(self):
        launch = rows({"angular-lynx": [1000, None, 1200], "react-lynx": [900, 1000, None]})
        result = nightly.night(launch, {}, "2026-11-28", "", "")
        self.assertEqual(result["metrics"]["launch.fully_drawn_ms"], {"angular-lynx": 1100, "react-lynx": 950})
        self.assertEqual(result["failed"], 2)

    def test_a_cost_of_zero_or_less_has_no_ratio(self):
        self.assertIsNone(nightly.ratio(record("2026-11-28", {"mount.view.us_per_element": -0.1}), "mount.view.us_per_element"))


class SustainedChangeTest(unittest.TestCase):
    def test_three_nights_over_the_threshold_are_a_change(self):
        history = nights(1.0, 1.02, 0.98, 1.0, 1.15, 1.2, 1.18)
        [change] = nightly.sustained_changes(history)
        self.assertEqual(change["metric"], "launch.fully_drawn_ms")
        self.assertEqual(change["direction"], "up")
        self.assertAlmostEqual(change["baseline"], 1.0)
        self.assertEqual([n["date"] for n in change["nights"]], ["2026-11-05", "2026-11-06", "2026-11-07"])

    def test_one_or_two_nights_are_noise(self):
        self.assertEqual(nightly.sustained_changes(nights(1.0, 1.0, 1.0, 1.0, 1.0, 1.3)), [])
        self.assertEqual(nightly.sustained_changes(nights(1.0, 1.0, 1.0, 1.0, 1.3, 1.3)), [])
        # A night back under the threshold breaks the run.
        self.assertEqual(nightly.sustained_changes(nights(1.0, 1.0, 1.0, 1.3, 1.05, 1.3)), [])

    def test_a_change_the_other_way_is_a_change_too(self):
        [change] = nightly.sustained_changes(nights(1.0, 1.0, 1.0, 0.85, 0.8, 0.88))
        self.assertEqual(change["direction"], "down")

    def test_moves_within_the_threshold_are_not(self):
        self.assertEqual(nightly.sustained_changes(nights(1.0, 1.0, 1.0, 1.09, 1.09, 1.09)), [])

    def test_too_few_nights_for_a_baseline(self):
        self.assertEqual(nightly.sustained_changes(nights(1.0, 1.0, 1.3, 1.3, 1.3)), [])

    def test_the_baseline_is_the_window_before_the_last_nights(self):
        # 20 nights at 2.0, then 14 at 1.0 and 3 at 1.2: only the 14 count.
        values = [2.0] * 20 + [1.0] * 14 + [1.2] * 3
        history = [record(f"night-{i:02d}", {"launch.fully_drawn_ms": v}) for i, v in enumerate(values)]
        [change] = nightly.sustained_changes(history)
        self.assertAlmostEqual(change["baseline"], 1.0)

    def test_a_night_without_the_metric_says_nothing_about_it(self):
        history = nights(1.0, 1.0, 1.0, 1.3, 1.3, 1.3)
        history.append(record("2026-11-07", {"launch.memory_mb": 1.0}))
        self.assertEqual(nightly.sustained_changes(history), [])


class ReportTest(unittest.TestCase):
    def write(self, folder, name, data):
        path = os.path.join(folder, name)
        with open(path, "w", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(data)
        return path

    def run_report(self, folder, history, **extra):
        args = argparse.Namespace(
            launch=os.path.join(folder, "launch.csv"),
            mount_dir=folder,
            history=history,
            commit="f00dfeed",
            run_url=extra.get("run_url", "https://example.invalid/run/9"),
            date=None,
            summary=os.path.join(folder, "summary.md"),
            alert=os.path.join(folder, "alert.md"),
            nights=3,
            window=14,
            threshold=0.10,
        )
        nightly.report(args)
        with open(args.summary) as file:
            return file.read()

    def test_appends_the_night_and_alerts_on_a_sustained_change(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, "launch.csv", launches({"angular-lynx": [1300, 1300], "react-lynx": [1000, 1000]}))
            for count, (ours, rival) in {1500: (2000, 1800), 5000: (2350, 1940)}.items():
                self.write(
                    folder,
                    f"mount-2026-11-28-text-{count}-react-lynx.csv",
                    rows({"angular-lynx": [ours], "react-lynx": [rival]}),
                )
            history = os.path.join(folder, "history.jsonl")
            with open(history, "w") as file:
                for past in nights(1.0, 1.0, 1.0, 1.0, 1.25, 1.3):
                    file.write(json.dumps(past) + "\n")
            text = self.run_report(folder, history)
            with open(history) as file:
                saved = [json.loads(line) for line in file]
            self.assertEqual(len(saved), 7)
            self.assertEqual(saved[-1]["date"], "2026-11-28")
            self.assertEqual(saved[-1]["metrics"]["launch.fully_drawn_ms"], {"angular-lynx": 1300, "react-lynx": 1000})
            self.assertIn("| Pokédex fully drawn | 1,300 ms | 1,000 ms | 1.30 |", text)
            self.assertIn("| Cost of a text | 100.0 µs | 40.0 µs | 2.50 |", text)
            self.assertIn("### Sustained changes", text)
            with open(os.path.join(folder, "alert.md")) as file:
                text = file.read()
            self.assertIn("**Pokédex fully drawn**: AngularLynx has been slower against ReactLynx for 3 nights", text)
            # The commits between the last night at the baseline and the
            # first night off it.
            since, first = commit_of("2026-11-04")[:7], commit_of("2026-11-05")[:7]
            self.assertIn(f"`git log {since}..{first}`", text)

            # The same run again (a re-run) replaces its night, and a night
            # back at the baseline removes the alert.
            self.write(folder, "launch.csv", launches({"angular-lynx": [1000], "react-lynx": [1000]}))
            self.run_report(folder, history)
            with open(history) as file:
                self.assertEqual(len(file.readlines()), 7)
            self.assertFalse(os.path.exists(os.path.join(folder, "alert.md")))

    def test_without_a_history(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, "launch.csv", launches({"angular-lynx": [1100], "react-lynx": [1000]}))
            text = self.run_report(folder, None)
            self.assertIn("No sustained change", text)
            self.assertFalse(os.path.exists(os.path.join(folder, "alert.md")))

    def test_fails_when_an_app_drew_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write(folder, "launch.csv", launches({"angular-lynx": [None, None], "react-lynx": [1000, 1000]}))
            with self.assertRaises(SystemExit) as error:
                self.run_report(folder, None)
            self.assertEqual(str(error.exception), "No measurement of Pokédex fully drawn (AngularLynx)")
            # The summary is written first, to show what was measured.
            with open(os.path.join(folder, "summary.md")) as file:
                self.assertIn("| Pokédex fully drawn | – ms | 1,000 ms | – |", file.read())


class SimulatorChoiceTest(unittest.TestCase):
    def test_prefers_the_newest_runtime_with_a_plain_pro(self):
        def runtime(version, *names):
            return {
                "identifier": f"com.apple.CoreSimulator.SimRuntime.iOS-{version.replace('.', '-')}",
                "name": f"iOS {version}",
                "version": version,
                "isAvailable": True,
                "supportedDeviceTypes": [
                    {"name": name, "identifier": name, "productFamily": "iPhone"} for name in names
                ],
            }

        listing = {
            "runtimes": [
                runtime("26.6", "iPhone 17", "iPhone 17 Pro"),
                runtime("27.0", "iPhone 18", "iPhone 18 Pro", "iPhone 18 Pro Max"),
                runtime("27.1", "iPhone Duo"),
            ]
        }
        choices = [(r["version"], t["name"]) for r, t in nightly.simulator_choices(listing)]
        self.assertEqual(choices, [("27.0", "iPhone 18 Pro"), ("26.6", "iPhone 17 Pro"), ("27.1", "iPhone Duo")])


if __name__ == "__main__":
    unittest.main()
