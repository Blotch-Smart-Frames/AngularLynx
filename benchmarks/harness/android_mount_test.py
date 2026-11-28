"""Tests for how android_mount.py works out each cost per element
(python3 -m unittest discover -s benchmarks/harness -p '*_test.py')."""

import csv
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import android_launch  # noqa: E402
import android_mount  # noqa: E402


def rows(app, *mounts):
    return [{"app": app, "mount_ms": mount} for mount in mounts]


class CostsTest(unittest.TestCase):
    def test_from_each_screens_fastest_mount(self):
        screens = {
            ("view", 1500): rows("angular-lynx", "120.0", "100.0") + rows("react-lynx", "60.0", "50.0"),
            ("view", 5000): rows("angular-lynx", "310.0", "380.0") + rows("react-lynx", "155.0", "190.0"),
        }
        costs = android_mount.costs(screens, ("angular-lynx", "react-lynx"))
        # (310 - 100) ms / 3,500 elements, and (155 - 50) / 3,500.
        self.assertAlmostEqual(costs[("view", "angular-lynx")], 60.0)
        self.assertAlmostEqual(costs[("view", "react-lynx")], 30.0)

    def test_none_without_mounts(self):
        # A CSV from a shell before the log lines: every mount_ms is empty.
        screens = {
            ("text", 1500): rows("angular-lynx", "") + rows("react-lynx", "50.0"),
            ("text", 5000): rows("angular-lynx", "") + rows("react-lynx", "155.0"),
        }
        costs = android_mount.costs(screens, ("angular-lynx", "react-lynx"))
        self.assertIsNone(costs[("text", "angular-lynx")])
        self.assertAlmostEqual(costs[("text", "react-lynx")], 30.0)

    def test_a_kind_with_one_screen_has_no_cost(self):
        screens = {("image", 1500): rows("angular-lynx", "100.0")}
        self.assertEqual(android_mount.costs(screens, ("angular-lynx",)), {})


class SessionTest(unittest.TestCase):
    def test_each_counts_builds_on_ids_of_their_own(self):
        apps, labels = android_mount.session_apps("react-lynx", [1500, 15000])
        self.assertEqual(
            apps,
            [
                ("angular-lynx:1500", "com.angularlynx.bench.angularlynx.m1500"),
                ("react-lynx:1500", "com.angularlynx.bench.rival.m1500"),
                ("angular-lynx:15000", "com.angularlynx.bench.angularlynx.m15000"),
                ("react-lynx:15000", "com.angularlynx.bench.rival.m15000"),
            ],
        )
        self.assertEqual(labels["react-lynx:15000"], ("react-lynx", 15000))

    def test_the_defaults_have_15000_elements_on_the_emulator_and_5000_on_a_phone(self):
        self.assertEqual(sorted({count for _, count in android_mount.EMULATOR_SCREENS}), [1500, 15000])
        self.assertEqual(sorted({count for _, count in android_mount.PHONE_SCREENS}), [1500, 5000])

    def test_a_session_splits_into_csvs_costs_reads(self):
        # android_launch.py's columns and order for a kind's four builds,
        # two runs, split as main() does, and read back as its costs.
        apps, labels = android_mount.session_apps("react-lynx", [1500, 15000])
        mounts = {"angular-lynx:1500": 100.0, "react-lynx:1500": 50.0, "angular-lynx:15000": 910.0, "react-lynx:15000": 455.0}
        session, previous = [], ""
        for run in (1, 2):
            for label, app_id in android_launch.run_order(apps, run):
                # The second run is 10 ms slower: only the fastest counts.
                session.append(
                    {"app": label, "package": app_id, "run": str(run), "previous_app": previous, "mount_ms": f"{mounts[label] + (run - 1) * 10:.1f}"}
                )
                previous = label
        with tempfile.TemporaryDirectory() as folder:
            combined = os.path.join(folder, "session.csv")
            with open(combined, "w", newline="") as file:
                writer = csv.DictWriter(file, fieldnames=android_launch.FIELDS)
                writer.writeheader()
                writer.writerows(session)
            outs = {count: os.path.join(folder, f"mount-{count}.csv") for count in (1500, 15000)}
            android_mount.split_session(combined, outs, labels)
            screens = {}
            for count, out in outs.items():
                with open(out, newline="") as file:
                    screens[("view", count)] = list(csv.DictReader(file))
        self.assertEqual({row["package"] for row in screens[("view", 15000)]}, {app_id for _, app_id in apps[2:]})
        costs = android_mount.costs(screens, ("angular-lynx", "react-lynx"))
        # (910 - 100) ms / 13,500 elements, and (455 - 50) / 13,500.
        self.assertAlmostEqual(costs[("view", "angular-lynx")], 60.0)
        self.assertAlmostEqual(costs[("view", "react-lynx")], 30.0)


if __name__ == "__main__":
    unittest.main()
