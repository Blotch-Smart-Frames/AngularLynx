"""Tests for how android_launch.py reads the shell's logcat lines into the
mount's duration (python3 -m unittest discover -s benchmarks/harness -p
'*_test.py')."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import android_launch  # noqa: E402


def parse(line):
    """A logcat line as FullyDrawnWatcher.follow() reads it into a mark."""
    match = android_launch.SHELL_MARK.search(line)
    return (match.group(1), match.group(2), int(match.group(3))) if match else None


class ShellMarkTest(unittest.TestCase):
    def test_a_mark(self):
        # ShellModule.kt's markEvent, in logcat's brief format.
        self.assertEqual(
            parse("I/AngularLynxShell( 4321): Mark MountStart at 1200000000 ns"),
            ("4321", "MountStart", 1_200_000_000),
        )

    def test_the_fully_drawn_call(self):
        self.assertEqual(
            parse("I/AngularLynxShell(  987): Fully Drawn at 1500000000 ns"),
            ("987", None, 1_500_000_000),
        )

    def test_not_the_systems_fully_drawn_line(self):
        # Read by FULLY_DRAWN instead.
        line = "I/ActivityTaskManager(  567): Fully drawn com.example/dev.angularlynx.shell.MainActivity: +1s234ms"
        self.assertIsNone(parse(line))
        self.assertIsNotNone(android_launch.FULLY_DRAWN.search(line))

    def test_another_tags_line(self):
        self.assertIsNone(parse("I/SomethingElse( 4321): Mark MountStart at 1200000000 ns"))


class MountMsTest(unittest.TestCase):
    def test_from_mount_start_to_fully_drawn(self):
        marks = [("42", "MountStart", 1_200_000_000), ("42", None, 1_500_000_000)]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_the_earliest_mount_start(self):
        # ReactLynx marks from the main thread, then the background thread.
        marks = [
            ("42", "MountStart", 1_200_000_000),
            ("42", "MountStart", 1_210_000_000),
            ("42", None, 1_500_000_000),
        ]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_the_first_fully_drawn_call(self):
        marks = [
            ("42", "MountStart", 1_200_000_000),
            ("42", None, 1_500_000_000),
            ("42", None, 1_900_000_000),
        ]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_only_the_fully_drawn_process(self):
        # A line another process logged, such as the app stopped before.
        marks = [
            ("7", "MountStart", 1_000_000_000),
            ("42", "MountStart", 1_200_000_000),
            ("42", None, 1_500_000_000),
        ]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_only_the_launched_process(self):
        # Another process's whole mount, logged first, isn't the launch's.
        marks = [
            ("7", "MountStart", 1_000_000_000),
            ("7", None, 1_010_000_000),
            ("42", "MountStart", 1_200_000_000),
            ("42", None, 1_500_000_000),
        ]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_empty_without_the_launched_process(self):
        # dumpsys found no process to read (the app had gone).
        marks = [("42", "MountStart", 1_200_000_000), ("42", None, 1_500_000_000)]
        self.assertEqual(android_launch.mount_ms(marks, None), "")

    def test_other_marks_are_left_out(self):
        marks = [("42", "Other", 1_000_000_000), ("42", "MountStart", 1_200_000_000), ("42", None, 1_500_000_000)]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "300.0")

    def test_empty_without_a_mount_start(self):
        # The Pokédex, or a shell from before the log lines.
        self.assertEqual(android_launch.mount_ms([("42", None, 1_500_000_000)], "42"), "")

    def test_empty_without_fully_drawn(self):
        self.assertEqual(android_launch.mount_ms([("42", "MountStart", 1_200_000_000)], "42"), "")

    def test_empty_when_drawn_before_the_start(self):
        marks = [("42", None, 1_000_000_000), ("42", "MountStart", 1_200_000_000)]
        self.assertEqual(android_launch.mount_ms(marks, "42"), "")


if __name__ == "__main__":
    unittest.main()
