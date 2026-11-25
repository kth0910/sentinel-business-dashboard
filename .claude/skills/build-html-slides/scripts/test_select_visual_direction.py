#!/usr/bin/env python3
"""Regression tests for registry-backed visual-direction selection."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("select_visual_direction.py")
REGISTRY = SCRIPT.with_name("theme_registry.json")
GALLERY_THEMES = [
    "Swiss Signal",
    "Editorial Culture",
    "Cinematic Noir",
    "Mission Control",
    "Product Keynote",
    "Data Newsroom",
    "Destination Magazine",
    "Field Notes",
    "Playful Modular",
    "Soft Kinetic",
    "Retro Future",
    "Constructivist Impact",
    "Museum Catalog",
    "Neo Brutalist",
    "Riso Zine",
    "Scientific Atlas",
    "Blueprint Workshop",
    "Documentary Photo Essay",
    "Ledger Trust",
    "Idol Editorial Index",
    "Consulting Precision",
    "Keynote Minimal Full-Bleed",
    "Duotone Split",
    "Typographic Editorial Poster",
    "Organic Material",
    "Isometric Systems",
]
NEW_THEMES = [
    "Sports Broadcast",
    "Clinical Clarity",
    "Fashion Lookbook",
    "Civic Service",
    "Event Wayfinding",
    "Portfolio Casebook",
    "Crafted Modern",
    "Kinetic Type",
    "Travel Editorial Collage",
    "Protocol Proof",
    "Pop Culture Scrapbook",
    "Technical Conference",
    "Research Report Editorial",
]


class VisualDirectionTests(unittest.TestCase):
    def select(
        self,
        title: str,
        *extra: str,
        audience: str = "기술 실무자",
        job: str = "technical-guide",
    ) -> dict:
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--title",
                title,
                "--audience",
                audience,
                "--job",
                job,
                *extra,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_registry_contains_gallery_then_new_themes_in_canonical_order(self) -> None:
        registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.assertEqual(registry["schema_version"], 1)
        self.assertEqual(
            [theme["theme"] for theme in registry["themes"]],
            GALLERY_THEMES + NEW_THEMES,
        )
        self.assertEqual(len({theme["theme"] for theme in registry["themes"]}), 39)

    def test_subject_routes_use_bounded_semantic_cues(self) -> None:
        cases = {
            "Tokyo 48-hour city guide": "Destination Magazine",
            "Stablecoin reserve backing and settlement": "Ledger Trust",
            "Clinical care pathway for hospitals": "Clinical Clarity",
            "Microscopy pathology specimen atlas": "Scientific Atlas",
            "K-pop idol generation listening guide": "Idol Editorial Index",
            "Football match recap and scouting report": "Sports Broadcast",
            "Japan regional photo journal from city to village": "Travel Editorial Collage",
            "Zero knowledge proof protocol guide": "Protocol Proof",
            "Single act comeback fan editorial": "Pop Culture Scrapbook",
            "DevOps engineering technical conference": "Technical Conference",
            "Annual research report and findings": "Research Report Editorial",
        }
        for title, expected in cases.items():
            with self.subTest(title=title):
                result = self.select(title)
                self.assertEqual(result["primary"]["theme"], expected)
                self.assertTrue(
                    result["selection_trace"]["ranking"][0]["matched_subject_cues"]
                )

    def test_substring_traps_do_not_create_test_or_vs_matches(self) -> None:
        latest = self.select("Latest stablecoin reserve report")
        self.assertEqual(latest["primary"]["theme"], "Ledger Trust")
        latest_cues = {
            cue
            for item in latest["selection_trace"]["ranking"]
            for cue in item["matched_subject_cues"]
        }
        self.assertNotIn("test", latest_cues)

        devsecops = self.select("DevSecOps system architecture guide")
        self.assertEqual(devsecops["primary"]["theme"], "Isometric Systems")
        devsecops_cues = {
            cue
            for item in devsecops["selection_trace"]["ranking"]
            for cue in item["matched_subject_cues"]
        }
        self.assertNotIn("vs", devsecops_cues)

    def test_public_axis_flags_add_semantic_selection_signal(self) -> None:
        result = self.select(
            "A new visual story",
            "--evidence",
            "authentic photography",
            "--density",
            "sparse keynote",
            "--emotional-register",
            "premium",
            "--surface-family",
            "full bleed image",
            "--focal-anchor",
            "person place",
            job="inspire",
        )
        selected = result["primary"]
        self.assertIn("authentic-photography", selected["evidence"])
        self.assertIn("sparse-keynote", selected["density"])
        self.assertIn("premium", selected["emotion"])
        self.assertIn("full-bleed-image", selected["surface_axis"])
        self.assertIn("person-place", selected["focal_anchors"])
        self.assertEqual(
            result["selection_trace"]["hash_role"],
            "tie-breaker-only",
        )

    def test_avoid_inputs_are_normalized_before_hashing(self) -> None:
        first = self.select(
            "Hubble network architecture",
            "--avoid-theme",
            " Mission   Control ",
            "--avoid-surface-family",
            " OPEN dark ",
        )
        second = self.select(
            "Hubble network architecture",
            "--avoid-theme",
            "mission control",
            "--avoid-surface-family",
            "open-dark",
        )
        self.assertEqual(first, second)

    def test_same_brief_is_stable_and_registry_metadata_is_exposed(self) -> None:
        first = self.select("분산 시스템 장애 대응")
        second = self.select("분산 시스템 장애 대응")
        self.assertEqual(first, second)
        self.assertEqual(first["registry"]["theme_count"], 39)
        self.assertEqual(first["registry"]["source"], "theme_registry.json")
        self.assertEqual(len(first["registry"]["sha256"]), 64)

    def test_any_registered_theme_can_be_selected_with_reason(self) -> None:
        result = self.select(
            "Hubble network architecture",
            "--select-theme",
            "Fashion Lookbook",
            "--selection-reason",
            "A supplied collection shoot is the factual evidence and brand constraint.",
        )
        self.assertEqual(result["selected"]["theme"], "Fashion Lookbook")
        self.assertEqual(result["selection"]["kind"], "registered-override")

    def test_retired_and_invented_theme_names_are_rejected(self) -> None:
        for retired in (
            "Margin Commentary",
            "Spatial Interface",
            "Systems Blueprint",
        ):
            with self.subTest(theme=retired):
                result = subprocess.run(
                    [
                        "python3",
                        str(SCRIPT),
                        "--title",
                        "Hubble network architecture",
                        "--audience",
                        "기술 실무자",
                        "--job",
                        "technical-guide",
                        "--select-theme",
                        retired,
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("retired and must not be used", result.stderr)

    def test_non_primary_selection_requires_an_explicit_reason(self) -> None:
        result = subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "--title",
                "Hubble network architecture",
                "--audience",
                "기술 실무자",
                "--job",
                "technical-guide",
                "--select-theme",
                "Fashion Lookbook",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("--selection-reason is required", result.stderr)

    def test_locked_contract_materializes_all_safe_surface_pairs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "design-contract.json"
            result = self.select(
                "Clinical care pathway",
                "--output",
                str(output),
            )
            locked = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(result, locked)
            self.assertEqual(locked["status"], "locked")
            colors = locked["semantic_color_contract"]
            self.assertEqual(colors, locked["selected"]["semantic_colors"])
            self.assertTrue(
                {
                    "canvas",
                    "text",
                    "panel",
                    "on_panel",
                    "inverse_canvas",
                    "on_inverse",
                }.issubset(colors["tokens"])
            )
            pairs = {
                (pair["foreground"], pair["background"])
                for pair in colors["contrast_pairs"]
            }
            self.assertIn(("text", "canvas"), pairs)
            self.assertIn(("on_panel", "panel"), pairs)
            self.assertIn(("on_inverse", "inverse_canvas"), pairs)
            self.assertEqual(
                locked["required_html_attributes"]["data-theme"],
                locked["selected"]["theme"],
            )
            self.assertEqual(len(locked["contract_id"]), 64)


if __name__ == "__main__":
    unittest.main()
