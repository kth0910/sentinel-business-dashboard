#!/usr/bin/env python3
"""Tests for persistent workflow timing diagnostics."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.workflow_timer import (
    load_report,
    record_event,
    render_report,
    report_rows,
    start_stage,
    stop_stage,
    transition_stage,
)


class WorkflowTimerTests(unittest.TestCase):
    def test_manual_stage_round_trip_is_persistent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "workflow-timing.json"
            start_stage(path, "research", now=100.0, detail="six-month market sample")
            event = stop_stage(path, "research", now=165.5)
            report = load_report(path)
            self.assertEqual(event["duration_ms"], 65_500)
            self.assertEqual(report["events"][0]["source"], "manual")
            self.assertEqual(report["events"][0]["detail"], "six-month market sample")
            self.assertEqual(report["active"], {})

    def test_repeated_automatic_steps_aggregate_and_keep_failures(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "workflow-timing.json"
            record_event(
                path,
                "validation.prepare",
                step="deck structure",
                started_at_epoch=10,
                finished_at_epoch=12,
            )
            record_event(
                path,
                "validation.prepare",
                step="Chromium render and geometry gate",
                started_at_epoch=20,
                finished_at_epoch=23.5,
                status="fail",
            )
            rows = report_rows(load_report(path))
            self.assertEqual(rows, [("validation.prepare", 5_500, 2, 1)])
            rendered = render_report(load_report(path))
            self.assertIn("validation.prepare", rendered)
            self.assertIn("5.5s", rendered)

    def test_start_and_stop_reject_invalid_transitions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "workflow-timing.json"
            with self.assertRaisesRegex(RuntimeError, "not active"):
                stop_stage(path, "assets", now=1)
            start_stage(path, "assets", now=1)
            with self.assertRaisesRegex(RuntimeError, "already active"):
                start_stage(path, "assets", now=2)
            with self.assertRaisesRegex(RuntimeError, "another manual stage"):
                start_stage(path, "implementation", now=2)

    def test_transition_closes_one_stage_and_opens_the_next_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "workflow-timing.json"
            start_stage(path, "research", now=10)
            event = transition_stage(path, "storyboard", now=25)
            report = load_report(path)
            self.assertEqual(event["stage"], "research")
            self.assertEqual(event["duration_ms"], 15_000)
            self.assertEqual(list(report["active"]), ["storyboard"])
            transition_stage(path, "editorial-review", now=40)
            stop_stage(path, "editorial-review", now=50)
            rendered = render_report(load_report(path))
            self.assertIn("Pure research [research]", rendered)
            self.assertIn("Storyboard [storyboard]", rendered)
            self.assertIn("AI editorial review [editorial-review]", rendered)
            self.assertIn("Authoring elapsed: 40.0s", rendered)

    def test_transition_requires_exactly_one_active_stage(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "workflow-timing.json"
            with self.assertRaisesRegex(RuntimeError, "no manual stage"):
                transition_stage(path, "storyboard", now=1)


if __name__ == "__main__":
    unittest.main()
