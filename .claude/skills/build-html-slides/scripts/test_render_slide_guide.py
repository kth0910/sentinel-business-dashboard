#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "scripts" / "render_slide_guide.js"
PREFLIGHT = ROOT / "scripts" / "check_environment.py"


def guide_section(number: int, title: str) -> str:
    return f"""## {number}. {title}

### Core idea

This section explains the compressed claim in complete sentences so a reader can understand the subject without hearing the presentation. It supplies the operating context and connects the claim to the surrounding material.

### Mechanism and flow

Input enters the first stage, receives normalized metadata, passes policy checks, and moves to storage. Each stage has a distinct responsibility and emits enough state for an operator to diagnose failures.

### Component roles

- **Collector**: receives source events and adds timestamps and provenance.
- **Processor**: validates, transforms, filters, and routes each accepted record.

### Practical example

An operator compares input volume, processing delay, rejection rate, and stored output to isolate the stage responsible for an unexpected drop.

### Limits

- Sampling reduces cost but may remove evidence needed for later analysis.
"""


class RenderSlideGuideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        check = subprocess.run(
            ["python3", str(PREFLIGHT)], capture_output=True, text=True, check=False
        )
        if check.returncode:
            raise unittest.SkipTest(check.stdout + check.stderr)

    def test_produces_markdown_html_pdf_and_ordered_captures(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                """<!doctype html><html><head><style>
                html,body{margin:0;width:1280px;height:720px;overflow:hidden}
                .slide{width:1280px;height:720px;padding:80px;box-sizing:border-box;background:#eef;color:#123}
                </style></head><body>
                <section class="slide active" data-title="Flow pipeline"><h1>Flow pipeline</h1></section>
                <section class="slide" data-title="Storage and query"><h1>Storage and query</h1></section>
                </body></html>""",
                encoding="utf-8",
            )
            guide = root / "deck-guide.md"
            guide.write_text(
                "# Reader study guide\n\n"
                "| Identifier | Meaning |\n"
                "|---|---|\n"
                "| transferId | One transfer lifecycle |\n\n"
                + guide_section(1, "Flow pipeline")
                + "\n"
                + guide_section(2, "Storage and query")
                + "\n<!-- HUMANIZE-SUMMARY\nchange rate: 12%\nself-check: 6/6\n-->\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                ["node", str(RENDERER), str(deck), str(guide)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            markdown = guide.read_text(encoding="utf-8")
            first_heading = markdown.index("## 1. Flow pipeline")
            first_capture = markdown.index("![Slide 1 — Flow pipeline]", first_heading)
            first_explanation = markdown.index("### Core idea", first_heading)
            self.assertLess(first_capture, first_explanation)
            self.assertTrue((root / "deck-guide-assets" / "slide-01.png").is_file())
            self.assertTrue((root / "deck-guide-assets" / "slide-02.png").is_file())
            html = (root / "deck-guide.html").read_text(encoding="utf-8")
            self.assertIn("deck-guide-assets/slide-01.png", html)
            self.assertIn("Core idea", html)
            self.assertIn('<nav class="guide-index"', html)
            self.assertEqual(html.count('class="guide-section"'), 2)
            self.assertEqual(html.count('class="guide-subsection"'), 10)
            self.assertEqual(html.count('<a href="#slide-'), 2)
            self.assertIn("<table>", html)
            self.assertIn("<th scope=\"col\">Identifier</th>", html)
            self.assertNotIn("| Identifier | Meaning |", html)
            self.assertNotIn("HUMANIZE-SUMMARY", html)
            self.assertNotIn("change rate: 12%", html)
            self.assertTrue((root / "deck-guide.pdf").read_bytes().startswith(b"%PDF"))

            first_render = guide.read_text(encoding="utf-8")
            second = subprocess.run(
                ["node", str(RENDERER), str(deck), str(guide)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertEqual(guide.read_text(encoding="utf-8"), first_render)


if __name__ == "__main__":
    unittest.main()
