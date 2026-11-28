"""Tests for ios_mount.py's split of a Simulator session, which launches
both apps' screens of a kind in turn, into the per-screen CSVs that
track.py and summarize.py read. The workflow runs them with track.py's
(python3 -m unittest discover -s benchmarks/harness -p '*_test.py')."""

import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ios_launch  # noqa: E402
import ios_mount  # noqa: E402

LABELS = {
    "angular-lynx:1500": ("angular-lynx", 1500),
    "react-lynx:1500": ("react-lynx", 1500),
    "angular-lynx:5000": ("angular-lynx", 5000),
    "react-lynx:5000": ("react-lynx", 5000),
}


def write(path, rows):
    with open(path, "w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=ios_launch.FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def read(path):
    with open(path, newline="") as file:
        return list(csv.DictReader(file))


def session(order):
    """A session's rows, one per (label, run) in order, each after the one
    before it, as ios_launch.py writes them."""
    rows, previous = [], ""
    for label, run in order:
        rows.append(
            {
                "app": label,
                "bundle_id": ios_mount.simulator_bundle_id(ios_mount.OURS, LABELS[label][1]),
                "run": str(run),
                "previous_app": previous,
                "fully_drawn_ms": "1800.0",
            }
        )
        previous = label
    return rows


class SplitSessionTest(unittest.TestCase):
    def test_splits_rows_by_screen_with_each_apps_name(self):
        apps = list(LABELS)
        # ios_launch.py's own order for four apps, two runs.
        order = [(label, run) for run in (1, 2) for label in ios_launch.run_order(apps, run)]
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session(order))
            outs = {count: os.path.join(folder, f"mount-{count}.csv") for count in (1500, 5000)}
            ios_mount.split_session(combined, outs, LABELS)
            small, large = read(outs[1500]), read(outs[5000])
        self.assertEqual(len(small), 4)
        self.assertEqual(len(large), 4)
        self.assertEqual(
            sorted(row["app"] for row in small), ["angular-lynx", "angular-lynx", "react-lynx", "react-lynx"]
        )
        # The order was 1500 AL, 1500 RL, 5000 AL, 5000 RL, then reversed:
        # run 2's first launch is 5000 RL again, right after itself, which
        # summarize.py counts as following its own app.
        self.assertEqual(
            [row["previous_app"] for row in large if row["app"] == "react-lynx"], ["angular-lynx:5000", "react-lynx"]
        )
        # A launch after the same app's other screen followed another
        # process, so it keeps that build's label.
        self.assertEqual(
            [row["previous_app"] for row in small if row["app"] == "angular-lynx"], ["", "react-lynx:1500"]
        )
        self.assertEqual(small[0]["bundle_id"], "com.angularlynx.bench.angularlynx.m1500")

    def test_appends_to_the_days_csvs(self):
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session([("angular-lynx:1500", 1), ("angular-lynx:5000", 1)]))
            outs = {count: os.path.join(folder, f"mount-{count}.csv") for count in (1500, 5000)}
            ios_mount.split_session(combined, outs, LABELS)
            ios_mount.split_session(combined, outs, LABELS)
            self.assertEqual(len(read(outs[1500])), 2)
            self.assertEqual(len(read(outs[5000])), 2)

    def test_refuses_a_csv_with_other_columns(self):
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session([("angular-lynx:1500", 1)]))
            out = os.path.join(folder, "mount-1500.csv")
            with open(out, "w") as file:
                file.write("timestamp,app,fully_drawn_ms\n")
            with self.assertRaises(SystemExit):
                ios_mount.split_session(combined, {1500: out}, LABELS)

    def test_a_refusal_leaves_every_csv_as_it_was(self):
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session([("angular-lynx:1500", 1), ("angular-lynx:5000", 1)]))
            good, bad = os.path.join(folder, "mount-1500.csv"), os.path.join(folder, "mount-5000.csv")
            with open(bad, "w") as file:
                file.write("timestamp,app,fully_drawn_ms\n")
            with self.assertRaises(SystemExit):
                ios_mount.split_session(combined, {1500: good, 5000: bad}, LABELS)
            self.assertFalse(os.path.exists(good))


class CheckOutsTest(unittest.TestCase):
    def test_takes_missing_empty_and_matching_csvs(self):
        with tempfile.TemporaryDirectory() as folder:
            empty, matching = os.path.join(folder, "empty.csv"), os.path.join(folder, "matching.csv")
            open(empty, "w").close()
            write(matching, [])
            ios_mount.check_outs([os.path.join(folder, "missing.csv"), empty, matching], ios_launch.FIELDS)

    def test_refuses_one_with_other_columns(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "mount-1500.csv")
            with open(out, "w") as file:
                file.write("timestamp,app,fully_drawn_ms\n")
            with self.assertRaises(SystemExit):
                ios_mount.check_outs([out], ios_launch.FIELDS)


class SplitOrKeepTest(unittest.TestCase):
    def test_keeps_the_sessions_rows_when_the_split_fails(self):
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session([("angular-lynx:1500", 1)]))
            out = os.path.join(folder, "mount-1500.csv")
            with open(out, "w") as file:
                file.write("timestamp,app,fully_drawn_ms\n")
            keep = os.path.join(folder, "kept.csv")
            with self.assertRaises(SystemExit):
                ios_mount.split_or_keep(combined, {1500: out}, LABELS, keep)
            self.assertEqual(read(keep)[0]["app"], "angular-lynx:1500")

    def test_a_second_failure_keeps_the_first_ones_rows(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "mount-1500.csv")
            with open(out, "w") as file:
                file.write("timestamp,app,fully_drawn_ms\n")
            keep = os.path.join(folder, "kept.csv")
            for run in (1, 2):
                combined = os.path.join(folder, f"session-{run}.csv")
                write(combined, session([("angular-lynx:1500", run)]))
                with self.assertRaises(SystemExit):
                    ios_mount.split_or_keep(combined, {1500: out}, LABELS, keep)
            self.assertEqual(read(keep)[0]["run"], "1")
            self.assertEqual(read(os.path.join(folder, "kept-2.csv"))[0]["run"], "2")

    def test_keeps_nothing_when_it_splits(self):
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            write(combined, session([("angular-lynx:1500", 1)]))
            keep = os.path.join(folder, "kept.csv")
            ios_mount.split_or_keep(combined, {1500: os.path.join(folder, "mount-1500.csv")}, LABELS, keep)
            self.assertFalse(os.path.exists(keep))


if __name__ == "__main__":
    unittest.main()
