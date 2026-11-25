#!/usr/bin/env python3
"""Regression tests for validate_deck.py image and layer contracts."""

from __future__ import annotations

import re
import subprocess
import tempfile
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = SKILL_ROOT / "scripts" / "validate_deck.py"
GEOMETRY_CHECK = SKILL_ROOT / "scripts" / "measure_geometry.js"
TEMPLATE = SKILL_ROOT / "assets" / "runtime-shell.html"
EMPTY_MEDIA = '<div class="slide-media" aria-hidden="true"></div>'


class ValidateDeckTests(unittest.TestCase):
    def validate(self, html: str, assets: tuple[str, ...] = ()) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            deck = root / "deck.html"
            deck.write_text(html, encoding="utf-8")
            for asset in assets:
                (root / asset).touch()
            return subprocess.run(
                ["python3", str(VALIDATOR), str(deck)],
                check=False,
                capture_output=True,
                text=True,
            )

    def template_with(self, replacement: str) -> str:
        return TEMPLATE.read_text(encoding="utf-8").replace(EMPTY_MEDIA, replacement, 1)

    def test_starter_template_passes(self) -> None:
        result = self.validate(TEMPLATE.read_text(encoding="utf-8"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_webp_image_passes(self) -> None:
        html = self.template_with(
            '<div class="slide-media" aria-hidden="true"><img src="asset.webp" alt="test"></div>'
        )
        result = self.validate(html, ("asset.webp",))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_png_image_fails(self) -> None:
        html = self.template_with(
            '<div class="slide-media" aria-hidden="true"><img src="asset.png" alt="test"></div>'
        )
        result = self.validate(html, ("asset.png",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("raster image must be WebP", result.stdout)

    def test_svg_identity_reference_fails_even_when_svg_images_are_otherwise_allowed(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "<!-- SLIDE_1_CONTENT -->",
            '<img class="key-visual" src="candidate.webp" alt="Character" '
            'data-identity-reference="official.svg">',
            1,
        )
        result = self.validate(html, ("candidate.webp", "official.svg"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("identity reference must be a local WebP", result.stdout)

    def test_css_png_fails(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "</style>", '.test-bg{background-image:url("asset.png")}</style>', 1
        )
        result = self.validate(html, ("asset.png",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("raster image must be WebP (CSS url())", result.stdout)

    def test_css_webp_fails_layer_contract(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "</style>", '.test-bg{background-image:url("asset.webp")}</style>', 1
        )
        result = self.validate(html, ("asset.webp",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("raster image must be an element inside .slide-media", result.stdout)

    def test_svg_diagram_ancestor_allows_webp_image(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            '<div class="slide-content">',
            '<div class="slide-content"><div class="safe-media"><svg class="diagram">'
            '<image href="asset.webp"></image></svg></div>',
            1,
        )
        result = self.validate(html, ("asset.webp",))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_direct_foreground_image_outside_content_fails(self) -> None:
        html = self.template_with(
            '<div class="slide-media" aria-hidden="true"></div>'
            '<img class="key-visual" src="asset.webp" alt="test">'
        )
        result = self.validate(html, ("asset.webp",))
        self.assertEqual(result.returncode, 1)
        self.assertIn("image elements outside slide-media", result.stdout)

    def test_direct_inner_width_scaling_fails_even_with_visual_viewport(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "(() => {", "(() => { const legacyScale=Math.min(innerWidth/1920,innerHeight/1080);", 1
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("direct innerWidth/innerHeight ratio", result.stdout)

    def test_constant_based_inner_width_scaling_fails(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "(() => {",
            "(() => { const LEGACY_WIDTH=1920;const LEGACY_HEIGHT=1080;"
            "const sx=window.innerWidth/LEGACY_WIDTH;const sy=window.innerHeight/LEGACY_HEIGHT;",
            1,
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("direct innerWidth/innerHeight ratio", result.stdout)

    def test_geometry_check_accepts_template_nav_selector(self) -> None:
        template = TEMPLATE.read_text(encoding="utf-8")
        geometry = GEOMETRY_CHECK.read_text(encoding="utf-8")
        self.assertIn('class="nav"', template)
        self.assertIn("querySelector('.controls, .nav')", geometry)

    def test_template_nav_has_no_visible_slide_title(self) -> None:
        template = TEMPLATE.read_text(encoding="utf-8")
        self.assertNotIn('class="nav-title"', template)
        self.assertNotIn('id="navTitle"', template)

    def test_generic_system_font_only_deck_fails(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8")
        html = re.sub(r'--font-display:\s*[^;]+;', '--font-display: system-ui, sans-serif;', html)
        html = re.sub(r'--font-body:\s*[^;]+;', '--font-body: system-ui, sans-serif;', html)
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("deliberate named display/body font stack", result.stdout)

    def test_theme_font_variables_are_required(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace("--font-display:", "--removed-display:", 1)
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("typography must declare --font-display", result.stdout)

    def test_geometry_checks_page_counter_centers(self) -> None:
        geometry = GEOMETRY_CHECK.read_text(encoding="utf-8")
        self.assertIn(".page-separator, .pager-separator", geometry)
        self.assertIn("Math.abs(dy) > 1.5", geometry)

    def test_every_slide_requires_a_composition_family(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            ' data-composition-family="cover"', "", 1
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("slide 1 requires data-composition-family", result.stdout)

    def test_three_consecutive_slides_cannot_repeat_one_family(self) -> None:
        html = re.sub(
            r'data-composition-family="[^"]+"',
            'data-composition-family="diagram"',
            TEMPLATE.read_text(encoding="utf-8"),
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("repeat the same dominant composition family three times", result.stdout)

    def test_dashboard_intent_accepts_only_literal_evidence_value(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            'data-composition-family="diagram"',
            'data-composition-family="dashboard" data-dashboard-intent="style"',
            1,
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("supports only the exact value evidence", result.stdout)

    def test_duplicate_locked_body_attribute_fails(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            'data-theme="Runtime Shell"',
            'data-theme="Wrong Theme" data-theme="Runtime Shell"',
            1,
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("body attributes must not be duplicated: data-theme", result.stdout)

    def test_visible_title_must_match_data_title(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "<!-- SLIDE_1_CONTENT -->",
            "<h1>Different visible title</h1>",
            1,
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("visible h1/h2 title must match data-title", result.stdout)

    def test_visible_title_allows_nested_line_break_markup(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            "<!-- SLIDE_1_CONTENT -->",
            "<h1>Slide<br><em>1</em></h1>",
            1,
        )
        result = self.validate(html)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_direct_technical_register_rejects_repeated_declarative_endings(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8")
        titles = (
            "첫 번째 구성을 확인한다",
            "두 번째 연결을 확인한다",
            "세 번째 결과를 확인한다",
        )
        for number, title in enumerate(titles, 1):
            html = html.replace(f'data-title="Slide {number}"', f'data-title="{title}"', 1)
            html = html.replace(
                f"<!-- SLIDE_{number}_CONTENT -->",
                f"<h2>{title}</h2>",
                1,
            )
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("overuses declarative sentence endings", result.stdout)
        self.assertIn("three times in a row", result.stdout)

    def test_decision_register_allows_declarative_headline_sequence(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8").replace(
            'data-headline-register="direct-technical"',
            'data-headline-register="decision"',
            1,
        )
        titles = (
            "첫 번째 투자를 승인한다",
            "두 번째 위험을 수용한다",
            "세 번째 일정을 확정한다",
        )
        for number, title in enumerate(titles, 1):
            html = html.replace(f'data-title="Slide {number}"', f'data-title="{title}"', 1)
            html = html.replace(
                f"<!-- SLIDE_{number}_CONTENT -->",
                f"<h2>{title}</h2>",
                1,
            )
        result = self.validate(html)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_two_generic_grids_in_six_slides_exceeds_twenty_percent(self) -> None:
        html = TEMPLATE.read_text(encoding="utf-8")
        extra_slides = """
      <section class="slide" data-title="Slide 4" data-composition-family="card-grid">
        <div class="slide-media" aria-hidden="true"></div>
        <div class="slide-content"></div>
      </section>
      <section class="slide" data-title="Slide 5" data-composition-family="statement">
        <div class="slide-media" aria-hidden="true"></div>
        <div class="slide-content"></div>
      </section>
      <section class="slide" data-title="Slide 6" data-composition-family="card-grid">
        <div class="slide-media" aria-hidden="true"></div>
        <div class="slide-content"></div>
      </section>
"""
        html = html.replace("</main>", extra_slides + "    </main>", 1)
        result = self.validate(html)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exceeds the two-per-ten-slide limit", result.stdout)


if __name__ == "__main__":
    unittest.main()
