"""Tests for how android_mount.py works out each cost per element
(python3 -m unittest discover -s benchmarks/harness -p '*_test.py')."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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


if __name__ == "__main__":
    unittest.main()
