"""Tests for how ios_launch.py reads a trace's Points of Interest events into
fully drawn and the mount's duration (python3 -m unittest discover -s
benchmarks/harness -p '*_test.py')."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ios_launch  # noqa: E402


def event(time_ns, name, message=None, pid="42"):
    """A PointsOfInterestEvents row as xctrace_tables.tables() hands it back:
    each cell (raw text, formatted text, element). Only the process cell's
    formatted text is read, "Name (pid)"."""
    row = {
        "time": (str(time_ns), None, None),
        "process": (None, f"App ({pid})", None),
        "name": (name, name, None),
    }
    if message is not None:
        row["message"] = (message, message, None)
    return row


class MarksTest(unittest.TestCase):
    def test_an_event_named_mount_start(self):
        # The React Native apps', Angular Native's and Flutter's.
        events = [event(1_200_000_000, "MountStart"), event(1_500_000_000, "TTFD")]
        fully_drawn, mount_start = ios_launch.marks(events, "42", 1_000_000_000)
        self.assertEqual((fully_drawn, mount_start), (500_000_000, 200_000_000))
        self.assertEqual(ios_launch.mount_ms(fully_drawn, mount_start), "300.0")

    def test_the_shells_mark_with_mount_start_as_its_message(self):
        # The Lynx apps': ShellModule.markEvent('MountStart').
        events = [event(1_250_000_000, "Mark", "MountStart"), event(1_500_000_000, "Fully Drawn")]
        fully_drawn, mount_start = ios_launch.marks(events, "42", 1_000_000_000)
        self.assertEqual(ios_launch.mount_ms(fully_drawn, mount_start), "250.0")

    def test_the_earliest_mount_start_counts(self):
        # ReactLynx marks from each thread that renders the screen; the
        # rows aren't always in time order.
        events = [
            event(1_300_000_000, "Mark", "MountStart"),
            event(1_100_000_000, "Mark", "MountStart"),
            event(1_500_000_000, "Fully Drawn"),
        ]
        self.assertEqual(ios_launch.marks(events, "42", 1_000_000_000), (500_000_000, 100_000_000))

    def test_other_processes_and_marks_are_left_out(self):
        events = [
            event(1_050_000_000, "MountStart", pid="7"),
            event(1_100_000_000, "Mark", "SomethingElse"),
            event(1_200_000_000, "Mark", "MountStart"),
            event(1_400_000_000, "Fully Drawn", pid="7"),
            event(1_500_000_000, "Fully Drawn"),
        ]
        self.assertEqual(ios_launch.marks(events, "42", 1_000_000_000), (500_000_000, 200_000_000))

    def test_no_mount_without_both_marks_in_order(self):
        # The Pokédex marks no MountStart; a screen that never drew has no
        # Fully Drawn; a MountStart after Fully Drawn didn't start the screen.
        self.assertEqual(ios_launch.mount_ms(500_000_000, None), "")
        self.assertEqual(ios_launch.mount_ms(None, 200_000_000), "")
        self.assertEqual(ios_launch.mount_ms(200_000_000, 500_000_000), "")


if __name__ == "__main__":
    unittest.main()
