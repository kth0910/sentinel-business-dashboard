#!/usr/bin/env python3
"""Exercise full and incremental Chromium rendering end to end."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RENDERER = ROOT / "scripts" / "render_slides.js"
VALIDATOR = ROOT / "scripts" / "validate_visual_review.py"
COVER_VALIDATOR = ROOT / "scripts" / "validate_cover_review.py"
TEMPLATE = ROOT / "assets" / "runtime-shell.html"
CONTRACT = json.loads((ROOT / "scripts" / "validation_contract.json").read_text(encoding="utf-8"))


class RenderPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if shutil.which("node") is None:
            raise unittest.SkipTest("Node.js is unavailable")
        check = subprocess.run(
            ["node", str(RENDERER), "--check"],
            capture_output=True,
            text=True,
            check=False,
        )
        if check.returncode:
            raise unittest.SkipTest(f"Playwright/Chromium preflight failed: {check.stderr.strip()}")

    def complete_rendered_reviews(self, manifest: dict) -> None:
        reviewed = set(manifest["render_run"].get("review_slides", manifest["render_run"]["rendered_slides"]))
        reviewer_count = 1 if manifest["mode"] == "quick" else (3 if manifest["review_risk"] == "high" else 2)
        group_size = (len(manifest["slides"]) + reviewer_count - 1) // reviewer_count
        for slide in manifest["slides"]:
            if slide["slide"] not in reviewed:
                continue
            if not slide["required_ai_profiles"]:
                self.assertEqual(slide["review_method"], "automated-geometry-only")
                self.assertEqual(slide["status"], "automation-pass")
                continue
            group = min((slide["slide"] - 1) // group_size, reviewer_count - 1)
            slide["reviewer"] = f"render-smoke-{group + 1}"
            slide["reviewer_ref"] = f"agent-render-smoke-{group + 1:03}"
            slide["inspected_profiles"] = slide["required_ai_profiles"]
            slide["observation"] = (
                f"Opened slide {slide['slide']} once with all current profiles; visible content and boundaries remain clear."
            )
            slide["checks"] = {name: "pass" for name in slide["checks"]}
            slide["identity_review"] = [
                {
                    "target_id": target["target_id"],
                    "subject_name": target["subject_name"],
                    "verdict": "pass",
                    "observation": "Candidate and canonical reference share the red hair and star badge without any conflicting character cues.",
                }
                for target in slide.get("identity_targets", [])
            ]
            warnings = {
                warning["warning_id"]: warning
                for warning in manifest.get("automation_gate", {}).get("warnings", [])
                if warning.get("slide") == slide["slide"] and warning.get("requires_ai_review") is True
            }
            slide["warning_reviews"] = [
                {
                    "warning_id": warning_id,
                    "code": warnings[warning_id]["code"],
                    "inspected_profile": warnings[warning_id]["profile"],
                    "verdict": "pass",
                    "observation": (
                        "Opened the warning-routed profile and confirmed the visible boundary, "
                        "label, and foreground geometry remain coherent."
                    ),
                }
                for warning_id in slide.get("required_warning_ids", [])
            ]
            slide["status"] = "pass"

    def validate(self, deck: Path, manifest_path: Path) -> subprocess.CompletedProcess[str]:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest.get("mode") == "full":
            brief_path = deck.parent / "drafts" / "research-brief.md"
            brief_path.parent.mkdir(parents=True, exist_ok=True)
            brief_path.write_text(
                "# Research brief\n\nAudience, claims, citations, story order, and visual decisions are frozen.\n",
                encoding="utf-8",
            )
            manifest["research_brief"] = {
                "path": str(brief_path.resolve()),
                "sha256": hashlib.sha256(brief_path.read_bytes()).hexdigest(),
            }
            selected = {"theme": "Render Test"}
            design_path = deck.parent / "drafts" / "design-contract.json"
            design_value = {
                "schema_version": 1,
                "contract_id": "render-test-contract",
                "selected": selected,
                "selection": {"reason": "test"},
            }
            design_path.write_text(
                f"{json.dumps(design_value, ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )
            design_signature = hashlib.sha256(
                json.dumps(
                    selected,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=False,
                ).encode("utf-8")
            ).hexdigest()
            manifest["design_contract"] = {
                "path": str(design_path.resolve()),
                "sha256": hashlib.sha256(design_path.read_bytes()).hexdigest(),
                "contract_id": "render-test-contract",
                "design_signature": design_signature,
                "selected": selected,
                "selection": {"reason": "test"},
            }
            manifest["validation_session"] = {
                "started_at_epoch": 1_700_000_000,
                "deadline_at_epoch": 1_700_003_600,
                "budget_seconds": 3600,
                "state": "active",
                "design_signature": design_signature,
            }
            manifest_path.write_text(
                f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n",
                encoding="utf-8",
            )
        return subprocess.run(
            ["python3", str(VALIDATOR), str(deck), str(manifest_path)],
            capture_output=True,
            text=True,
            check=False,
        )

    def create_webps(self, *targets: tuple[Path, str] | tuple[Path, str, int]) -> None:
        script = r"""
const fs = require('fs');
const { loadPlaywright } = require(process.argv[2]);
const { chromium } = loadPlaywright();
(async () => {
  const targets = JSON.parse(process.argv[1]);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  for (const target of targets) {
    const data = await page.evaluate(({ color, size }) => {
      const canvas = document.createElement('canvas');
      canvas.width = size || 800;
      canvas.height = size || 800;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff';
      context.fillRect(280, 280, 240, 240);
      return canvas.toDataURL('image/webp', 0.82).split(',')[1];
    }, { color: target.color, size: target.size });
    fs.writeFileSync(target.path, Buffer.from(data, 'base64'));
  }
  await browser.close();
})();
"""
        payload = [
            {
                "path": str(target[0]),
                "color": target[1],
                "size": target[2] if len(target) == 3 else 800,
            }
            for target in targets
        ]
        result = subprocess.run(
            [
                "node",
                "-e",
                script,
                json.dumps(payload),
                str(ROOT / "scripts" / "playwright_loader.js"),
            ],
            cwd=ROOT.parents[2],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_renderer_requires_explicit_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            render = subprocess.run(
                ["node", str(RENDERER), str(deck)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 2)
            self.assertIn("user-approved mode", render.stderr)

    def test_init_workspace_seeds_research_brief_without_a_deck(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            planned_deck = root / "planned-deck.html"
            environment = os.environ.copy()
            environment["BUILD_HTML_SLIDES_WORKSPACE_ROOT"] = str(root / "workspaces")
            first = subprocess.run(
                ["node", str(RENDERER), "--init-workspace", str(planned_deck)],
                capture_output=True,
                text=True,
                check=False,
                env=environment,
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            workspace = Path(first.stdout.strip())
            brief = workspace / "drafts" / "research-brief.md"
            editorial_review = workspace / "drafts" / "research-storyboard-review.md"
            self.assertTrue(brief.is_file())
            self.assertTrue(editorial_review.is_file())
            self.assertTrue((workspace / "tmp").is_dir())
            self.assertFalse(planned_deck.exists())
            brief.write_text("# Preserved research\n", encoding="utf-8")
            second = subprocess.run(
                ["node", str(RENDERER), "--init-workspace", str(planned_deck)],
                capture_output=True,
                text=True,
                check=False,
                env=environment,
            )
            self.assertEqual(second.returncode, 0, second.stderr)
            self.assertEqual(brief.read_text(encoding="utf-8"), "# Preserved research\n")
            self.assertIn(
                "# Research and Storyboard Editorial Review",
                editorial_review.read_text(encoding="utf-8"),
            )

    def test_full_then_incremental_render_validates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_1_CONTENT -->", "<h1>Initial slide content</h1>", 1
                ),
                encoding="utf-8",
            )
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            self.assertIn("rendered 3/3 slides across 3 profiles", initial.stdout)

            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema_version"], CONTRACT["schema_version"])
            self.assertEqual(list(manifest["viewports"]), ["normal", "short", "zoom150"])
            self.assertEqual(manifest["viewports"]["zoom150"]["viewport"], "1920x1080")
            self.assertEqual(manifest["viewports"]["zoom150"]["visual_viewport"], "1280x720")
            self.assertEqual(manifest["viewports"]["zoom150"]["scale_mode"], "browser-page")
            self.assertEqual(manifest["slides"][0]["captures"]["zoom150"]["device_pixel_ratio"], 1)
            self.assertEqual(manifest["phase"], "iteration")
            self.assertTrue(all(
                capture["motion_disabled"]
                for slide in manifest["slides"]
                for capture in slide["captures"].values()
            ))
            self.assertIn("transition: opacity 360ms", deck.read_text(encoding="utf-8"))
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
            first_validation = self.validate(deck, manifest_path)
            self.assertEqual(first_validation.returncode, 0, first_validation.stdout + first_validation.stderr)

            reused_capture = review_dir / manifest["slides"][2]["captures"]["normal"]["path"]
            reused_mtime = reused_capture.stat().st_mtime_ns
            reused_hash = manifest["slides"][2]["captures"]["normal"]["sha256"]
            deck.write_text(
                deck.read_text(encoding="utf-8").replace(
                    "Initial slide content", "Changed slide content", 1
                ),
                encoding="utf-8",
            )
            incremental = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "1", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(incremental.returncode, 0, incremental.stderr)
            self.assertIn("rendered 1/3 slides across 3 profiles (incremental", incremental.stdout)

            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["rendered_slides"], [1])
            self.assertEqual(manifest["render_run"]["reused_slides"], [2, 3])
            self.assertEqual(manifest["render_run"]["impact_scope"], "direct")
            self.assertEqual(manifest["slides"][0]["review_scope"], "text")
            self.assertEqual(
                list(manifest["slides"][0]["checks"]),
                CONTRACT["checks_by_change"]["text"] + CONTRACT["cover_checks"],
            )
            self.assertEqual(reused_capture.stat().st_mtime_ns, reused_mtime)
            self.assertEqual(manifest["slides"][2]["captures"]["normal"]["sha256"], reused_hash)
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
            second_validation = self.validate(deck, manifest_path)
            self.assertEqual(second_validation.returncode, 0, second_validation.stdout + second_validation.stderr)
            self.assertIn("1 refreshed slides use adaptive AI review", second_validation.stdout)

            selected_capture = review_dir / manifest["slides"][0]["captures"]["normal"]["path"]
            selected_mtime = selected_capture.stat().st_mtime_ns
            finalize = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--finalize-prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(finalize.returncode, 1)
            self.assertIn("Quick Draft finishes after verify", finalize.stderr)
            self.assertEqual(selected_capture.stat().st_mtime_ns, selected_mtime)

    def test_full_finalize_prepare_generates_bounded_cross_review_batches(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "full"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
            self.assertEqual(self.validate(deck, manifest_path).returncode, 0)
            cover = subprocess.run(
                ["python3", str(COVER_VALIDATOR), str(deck), str(manifest_path)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(cover.returncode, 0, cover.stdout + cover.stderr)
            self.assertIn("does not approve or finalize the full deck", cover.stdout)

            finalize = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--finalize-prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(finalize.returncode, 0, finalize.stderr)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["phase"], "final")
            self.assertTrue(manifest["cross_review_batches"])
            self.assertTrue(all(len(batch["slides"]) <= 4 for batch in manifest["cross_review_batches"]))

            manifest["quality_score"] = {
                "status": "pass",
                "reviewer": "final-editor",
                "reviewer_ref": "final-editor-run-001",
                "review_method": "contact-sheet-plus-targeted-full-size",
                "inspected_overview_sha256": [
                    sheet["sha256"]
                    for sheet in manifest["final_overview_review"]["contact_sheets"]
                ],
                "dimensions": {name: 3 for name in (
                    "story", "art_direction", "layout_rhythm", "typography",
                    "imagery", "composition", "evidence", "presentation_utility",
                )},
                "total": 24,
                "weakest_slides": [1, 2, 3],
                "notes": "The settled deck keeps readable hierarchy, varied composition, and presentation-ready evidence.",
            }
            overview = manifest["final_overview_review"]
            overview["status"] = "pass"
            overview["reviewer"] = "final-editor"
            overview["reviewer_ref"] = "final-editor-run-001"
            overview["checks"] = {name: "pass" for name in overview["checks"]}
            overview["observation"] = (
                "The contact sheet shows coherent deck rhythm, varied composition, balanced density, "
                "appropriate media coverage, and consistent visual treatment."
            )
            for review in manifest["cross_reviews"]:
                review["reviewer"] = "final-editor"
                review["reviewer_ref"] = "final-editor-run-001"
                review["inspected_profiles"] = manifest["slides"][review["slide"] - 1]["required_ai_profiles"]
                review["observation"] = (
                    f"Independently opened slide {review['slide']} at every required profile and found no crop, text, or control defect."
                )
                review["checks"] = {name: "pass" for name in review["checks"]}
                review["status"] = "pass"
            for batch in manifest["cross_review_batches"]:
                batch["status"] = "complete"
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
            validation = self.validate(deck, manifest_path)
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

            settled_evidence = manifest_path.read_bytes()
            repeated = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--finalize-prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(repeated.returncode, 1)
            self.assertIn("refusing to reset quality or cross-review evidence", repeated.stderr)
            self.assertEqual(manifest_path.read_bytes(), settled_evidence)

    def test_incremental_fix_reuses_independent_cross_reviews_for_unchanged_slides(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_3_CONTENT -->", "<p>Initial copy</p>", 1
            ).replace(
                "    </main>",
                '      <section class="slide" data-title="Slide 4"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Four</p></div></section>\n'
                '      <section class="slide" data-title="Slide 5"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Five</p></div></section>\n'
                "    </main>",
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "full"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
            finalize = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--finalize-prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(finalize.returncode, 0, finalize.stderr)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            initially_cross_reviewed = {review["slide"] for review in manifest["cross_reviews"]}
            self.assertIn(3, initially_cross_reviewed)
            for review in manifest["cross_reviews"]:
                review["reviewer"] = "independent-reviewer"
                review["reviewer_ref"] = "independent-review-run-001"
                review["inspected_profiles"] = manifest["slides"][review["slide"] - 1]["required_ai_profiles"]
                review["observation"] = (
                    f"Independently inspected slide {review['slide']} against its current captures and found no visual defect."
                )
                review["checks"] = {name: "pass" for name in review["checks"]}
                review["status"] = "pass"
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")

            deck.write_text(html.replace("Initial copy", "Revised copy"), encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "full",
                    "--slides", "3", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            retained = {review["slide"] for review in manifest["retained_cross_reviews"]}
            self.assertEqual(retained, initially_cross_reviewed - {3})
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
            finalize_again = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--finalize-prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(finalize_again.returncode, 0, finalize_again.stderr)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            complete_slides = {
                number
                for batch in manifest["cross_review_batches"]
                if batch["status"] == "complete"
                for number in batch["slides"]
            }
            pending_slides = {
                number
                for batch in manifest["cross_review_batches"]
                if batch["status"] == "pending"
                for number in batch["slides"]
            }
            self.assertEqual(complete_slides, retained)
            self.assertEqual(pending_slides, {3})

    def test_reviewer_fail_requires_source_change_before_new_capture(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_1_CONTENT -->", "<h1>Initial cover</h1>", 1
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["slides"][0]["status"] = "fail"
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")

            unchanged = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "1", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(unchanged.returncode, 1)
            self.assertIn("reviewer FAIL requires a source fix", unchanged.stderr)

            deck.write_text(html.replace("Initial cover", "Corrected cover"), encoding="utf-8")
            corrected = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "1", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(corrected.returncode, 0, corrected.stderr)
            corrected_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(corrected_manifest["render_run"]["rendered_slides"], [1])

    def test_image_change_declared_as_text_uses_detected_image_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "first.webp", "#225599"), (assets / "second.webp", "#992255"))
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<img src="assets/first.webp" alt="Product view" '
                    'style="width:320px;height:320px;object-fit:contain">',
                    1,
                ),
                encoding="utf-8",
            )
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            deck.write_text(
                deck.read_text(encoding="utf-8").replace("assets/first.webp", "assets/second.webp"),
                encoding="utf-8",
            )

            incremental = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(incremental.returncode, 0, incremental.stderr)
            self.assertIn("resolved to image", incremental.stderr)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["change_type"], "image")
            self.assertEqual(manifest["render_run"]["detected_change_type"], "image")
            self.assertEqual(manifest["render_run"]["rendered_slides"], [2])
            self.assertEqual(manifest["slides"][1]["review_scope"], "image")

    def test_external_stylesheet_rule_is_scoped_to_matching_slides(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            stylesheet = root / "theme.css"
            stylesheet.write_text(".slide h1 { color: rgb(10, 20, 30); }\n", encoding="utf-8")
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8")
                .replace("</head>", '<link rel="stylesheet" href="theme.css"></head>', 1)
                .replace("<!-- SLIDE_1_CONTENT -->", "<h1>Fingerprint target</h1>", 1),
                encoding="utf-8",
            )

            before = subprocess.run(
                ["node", str(RENDERER), "--fingerprints", str(deck)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(before.returncode, 0, before.stderr)
            stylesheet.write_text(".slide h1 { color: rgb(200, 40, 30); }\n", encoding="utf-8")
            after = subprocess.run(
                ["node", str(RENDERER), "--fingerprints", str(deck)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(after.returncode, 0, after.stderr)
            before_fingerprints = json.loads(before.stdout)
            after_fingerprints = json.loads(after.stdout)
            self.assertEqual(
                before_fingerprints["global_sha256"],
                after_fingerprints["global_sha256"],
            )
            self.assertNotEqual(
                before_fingerprints["slides"]["1"],
                after_fingerprints["slides"]["1"],
            )
            self.assertEqual(
                before_fingerprints["slides"]["2"],
                after_fingerprints["slides"]["2"],
            )

    def test_local_image_mutation_invalidates_existing_visual_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            image = assets / "subject.webp"
            self.create_webps((image, "#225588"))
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<img src="assets/subject.webp" alt="Subject" '
                    'style="width:320px;height:320px;object-fit:contain">',
                    1,
                ),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            self.assertEqual(self.validate(deck, manifest_path).returncode, 0)

            self.create_webps((image, "#882255"))
            stale = self.validate(deck, manifest_path)
            self.assertEqual(stale.returncode, 1)
            self.assertIn("local fingerprint entry 1 changed after rendering", stale.stdout)

    def test_inactive_responsive_srcset_asset_is_fingerprinted(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            small = assets / "small.webp"
            large = assets / "large.webp"
            self.create_webps((small, "#225588"), (large, "#882255"))
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<picture><source media="(max-width:700px)" srcset="assets/small.webp">'
                    '<img src="assets/large.webp" alt="Responsive subject" '
                    'style="width:320px;height:320px;object-fit:contain"></picture>',
                    1,
                ),
                encoding="utf-8",
            )
            before = subprocess.run(
                ["node", str(RENDERER), "--fingerprints", str(deck)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(before.returncode, 0, before.stderr)
            before_fingerprints = json.loads(before.stdout)

            self.create_webps((small, "#118844"))
            after = subprocess.run(
                ["node", str(RENDERER), "--fingerprints", str(deck)],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(after.returncode, 0, after.stderr)
            after_fingerprints = json.loads(after.stdout)
            self.assertNotEqual(
                before_fingerprints["components"]["2"]["media_sha256"],
                after_fingerprints["components"]["2"]["media_sha256"],
            )
            self.assertNotEqual(before_fingerprints["slides"]["2"], after_fingerprints["slides"]["2"])

    def test_opaque_visual_covering_text_blocks_quick_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            content = (
                '<h1 style="position:absolute;left:120px;top:120px;width:520px;z-index:1">Visible headline text</h1>'
                '<div style="position:absolute;left:100px;top:100px;width:600px;height:180px;'
                'background:#111;z-index:10"></div>'
            )
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace("<!-- SLIDE_2_CONTENT -->", content, 1),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds"
            ]
            self.assertTrue(any("opaque visual layer" in issue for issue in issues), issues)

    def test_visible_overflow_outside_custom_painted_parent_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-promql {
                  position:absolute; left:100px; top:160px; width:250px; height:100px;
                  padding:18px; background:#fff; border:1px solid #bbb; overflow:visible;
                }
                .qa-promql code {
                  display:block; white-space:nowrap; font-size:25px; line-height:1.3;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-promql">
                  <code>hubble.metrics.serviceMonitor.enabled=true</code>
                </div>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds"
            ]
            self.assertTrue(any(
                "rendered glyph bounds cross the intended text container" in issue
                or "nearest painted parent container" in issue
                for issue in issues
            ), issues)

    def test_contrast_gate_blocks_hubble_style_inherited_and_theme_override_regressions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-dark-slide { background:#111827; color:#ffffff; }
                .qa-white-card {
                  position:absolute; left:90px; top:110px; width:430px;
                  padding:22px; background:#ffffff; border-radius:12px;
                }
                .qa-white-card p { margin:0; color:inherit; font-size:18px; }
                .qa-muted {
                  position:absolute; left:90px; top:290px; margin:0;
                  color:#273449; font-size:18px;
                }
                </style>
                """,
                1,
            ).replace(
                '<section class="slide" data-title="Slide 2"',
                '<section class="slide qa-dark-slide" data-title="Slide 2"',
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-white-card"><p>Hubble observability</p></div>
                <p class="qa-muted">Muted theme note</p>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds" and failure["slide"] == 2
            ]
            self.assertTrue(any(
                "Hubble observability: text contrast" in issue and "4.5:1" in issue
                for issue in issues
            ), issues)
            self.assertTrue(any(
                "Muted theme note: text contrast" in issue and "4.5:1" in issue
                for issue in issues
            ), issues)

    def test_contrast_gate_applies_wcag_large_text_and_alpha_compositing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-contrast-slide { background:#000000; }
                .qa-threshold {
                  position:absolute; left:80px; margin:0; color:#626262;
                  font-weight:400;
                }
                .qa-normal { top:80px; font-size:23.99px; }
                .qa-large { top:160px; font-size:24px; }
                .qa-bold-large { top:240px; font-size:18.66px; font-weight:700; }
                .qa-alpha-card {
                  position:absolute; left:80px; top:320px; padding:18px;
                  background:rgba(255, 255, 255, 0.5);
                }
                .qa-alpha-card p { margin:0; color:#000000; font-size:16px; }
                </style>
                """,
                1,
            ).replace(
                '<section class="slide" data-title="Slide 2"',
                '<section class="slide qa-contrast-slide" data-title="Slide 2"',
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <p class="qa-threshold qa-normal" data-title="Normal threshold">Normal threshold</p>
                <p class="qa-threshold qa-large" data-title="Large regular threshold">Large regular threshold</p>
                <p class="qa-threshold qa-bold-large" data-title="Large bold threshold">Large bold threshold</p>
                <div class="qa-alpha-card"><p data-title="Alpha composited safe">Alpha composited safe</p></div>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds" and failure["slide"] == 2
            ]
            self.assertTrue(any(
                "Normal threshold: text contrast" in issue and "4.5:1" in issue
                for issue in issues
            ), issues)
            self.assertFalse(any("Large regular threshold: text contrast" in issue for issue in issues), issues)
            self.assertFalse(any("Large bold threshold: text contrast" in issue for issue in issues), issues)
            self.assertFalse(any("Alpha composited safe: text contrast" in issue for issue in issues), issues)

    def test_contrast_gate_warns_for_gradient_text_and_decorative_exemption(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-gradient {
                  position:absolute; left:80px; top:100px; margin:0; padding:18px;
                  color:#ffffff; font-size:18px;
                  background-image:linear-gradient(90deg, #111111, #eeeeee);
                }
                .qa-decorative {
                  position:absolute; left:80px; top:220px; padding:12px;
                  color:#ffffff; background:#ffffff; font-size:16px;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <p class="qa-gradient">Gradient-backed copy</p>
                <span class="qa-decorative" data-contrast-ignore="decorative">DECORATIVE LABEL</span>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            warnings = [
                warning for warning in manifest["automation_gate"]["warnings"]
                if warning["check"] == "text_bounds" and warning["slide"] == 2
            ]
            self.assertTrue(any(
                "image/gradient-backed text contrast" in warning["warning"]
                and warning["code"] == "surface-contrast-boundary"
                and warning["requires_ai_review"] is True
                for warning in warnings
            ), warnings)
            self.assertTrue(any(
                "decorative contrast exemption" in warning["warning"]
                and warning["code"] == "visual-inspection-required"
                for warning in warnings
            ), warnings)
            self.assertEqual(manifest["slides"][1]["required_ai_profiles"], ["normal", "short", "zoom150"])
            self.assertEqual(
                manifest["slides"][1]["required_warning_ids"],
                [warning["warning_id"] for warning in warnings],
            )

    def test_contrast_exemption_is_exact_and_rejects_unsupported_values(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-exact-parent {
                  position:absolute; left:80px; top:100px; padding:16px;
                  color:#ffffff; background:#ffffff;
                }
                .qa-exact-parent span { color:#ffffff; font-size:16px; }
                .qa-unsupported {
                  position:absolute; left:80px; top:220px; margin:0;
                  color:#ffffff; background:#ffffff; font-size:16px;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-exact-parent" data-contrast-ignore="decorative">
                  DECORATIVE <span>Meaningful descendant</span>
                </div>
                <p class="qa-unsupported" data-contrast-ignore="all">Unsupported exemption</p>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds" and failure["slide"] == 2
            ]
            warnings = [
                warning["warning"] for warning in manifest["automation_gate"]["warnings"]
                if warning["check"] == "text_bounds" and warning["slide"] == 2
            ]
            self.assertTrue(any("Meaningful descendant: text contrast" in issue for issue in issues), issues)
            self.assertTrue(any("unsupported data-contrast-ignore=\"all\"" in issue for issue in issues), issues)
            self.assertTrue(any("decorative contrast exemption" in warning for warning in warnings), warnings)

    def test_contrast_gate_ignores_hidden_text_and_pure_decorative_pseudo_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-hidden-parent { opacity:0; }
                .qa-hidden-parent p { color:#ffffff; background:#ffffff; }
                .qa-pseudo {
                  position:absolute; left:80px; top:160px; width:120px; height:60px;
                }
                .qa-pseudo::before { content:"DECORATIVE"; color:#ffffff; }
                .qa-visible {
                  position:absolute; left:80px; top:260px; margin:0;
                  color:#111111; font-size:18px;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-hidden-parent"><p>Hidden low contrast text</p></div>
                <div class="qa-pseudo" aria-hidden="true"></div>
                <p class="qa-visible">Visible high contrast text</p>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds" and failure["slide"] == 2
            ]
            warnings = [
                warning["warning"] for warning in manifest["automation_gate"]["warnings"]
                if warning["check"] == "text_bounds" and warning["slide"] == 2
            ]
            self.assertFalse(any("contrast" in issue for issue in issues), issues)
            self.assertFalse(any("contrast" in warning for warning in warnings), warnings)

    def test_transformed_card_crossing_annotation_bar_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-layout {
                  position:absolute; left:60px; top:100px; width:520px; height:320px;
                  background:#f8f6f2;
                }
                .qa-card {
                  position:absolute; left:20px; top:20px; width:480px; height:300px;
                  padding:24px; background:#fff; border:1px solid #bbb;
                  transform:translateY(20px);
                }
                .qa-annotation {
                  position:absolute; left:64px; top:430px; width:1120px; height:72px;
                  padding:18px 24px; background:#f4e8df; border-left:6px solid #d66d55;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-layout band" data-title="카드 영역">
                  <section class="qa-card card" data-title="사용빈도 카드">
                    <h2>사용빈도</h2><p>자주 쓰는 혜택은 월 정액의 설명력이 높다.</p>
                  </section>
                </div>
                <aside class="qa-annotation" data-protected-region="annotation" data-title="해석 한계">
                  <strong>해석 한계</strong> 공개 자료만으로 인과효과를 분리할 수 없다.
                </aside>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds"
            ]
            self.assertTrue(any(
                "사용빈도 카드 / 해석 한계" in issue
                and "overlaps protected region" in issue
                for issue in issues
            ), issues)

    def test_card_stops_before_annotation_bar_passes_protected_region_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-card {
                  position:absolute; left:80px; top:120px; width:480px; height:280px;
                  padding:24px; background:#fff; border:1px solid #bbb;
                }
                .qa-annotation {
                  position:absolute; left:64px; top:430px; width:1120px; height:72px;
                  padding:18px 24px; background:#f4e8df; border-left:6px solid #d66d55;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <section class="qa-card card" data-title="사용빈도 카드">
                  <h2>사용빈도</h2><p>자주 쓰는 혜택은 월 정액의 설명력이 높다.</p>
                </section>
                <aside class="qa-annotation" data-protected-region="annotation" data-title="해석 한계">
                  <strong>해석 한계</strong> 공개 자료만으로 인과효과를 분리할 수 없다.
                </aside>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "text_bounds"
            ]
            self.assertFalse(any("protected region" in issue for issue in issues), issues)

    def test_noop_strong_emphasis_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            content = (
                '<h2 style="margin:120px;font-size:48px;font-weight:400;color:#111">'
                '보통 문장 <strong style="font-weight:inherit;color:inherit">강조 실패</strong></h2>'
            )
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace("<!-- SLIDE_2_CONTENT -->", content, 1),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [failure["issue"] for failure in manifest["automation_gate"]["failures"]]
            self.assertTrue(any("has no visible emphasis" in issue for issue in issues), issues)

    def test_unsupported_declared_font_weight_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                "@font-face{font-family:'Single Weight';src:local('Arial');font-weight:400}"
                ".unsupported-weight{font-family:'Single Weight';font-weight:800}</style>",
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<h2 class="unsupported-weight" style="margin:120px;font-size:48px">합성 굵기 차단</h2>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [failure["issue"] for failure in manifest["automation_gate"]["failures"]]
            self.assertTrue(any("outside its declared local faces" in issue for issue in issues), issues)

    def test_partial_korean_font_fallback_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                "@font-face{font-family:'Partial Korean Fixture';src:local('Arial');font-weight:400}"
                ".partial-korean{font-family:'Partial Korean Fixture',sans-serif;font-weight:400}</style>",
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<h2 class="partial-korean" style="margin:100px;font-size:48px">'
                '응원팀은 성적표가 아니라 자꾸 다음 경기를 찾게 되는 이유로 고른다.</h2>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            failures = manifest["automation_gate"]["failures"]
            font_failures = [failure for failure in failures if failure["check"] == "font_integrity"]
            self.assertTrue(font_failures, failures)
            self.assertTrue(any("응(U+C751)" in failure["issue"] for failure in font_failures), font_failures)
            self.assertTrue(any("complete Korean font" in failure["issue"] for failure in font_failures), font_failures)

    def test_meaningful_cover_crop_routes_quick_slide_to_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "subject.webp", "#336699"))
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<img src="assets/subject.webp" alt="Named product" '
                    'style="width:320px;height:200px;object-fit:cover">',
                    1,
                ),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            warnings = [warning for warning in manifest["automation_gate"]["warnings"] if warning["slide"] == 2]
            self.assertTrue(any("cover-cropped" in warning["warning"] for warning in warnings), warnings)
            self.assertTrue(manifest["slides"][1]["required_ai_profiles"])

    def test_low_effective_raster_density_blocks_before_ai(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "small.webp", "#335577"))
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<img src="assets/small.webp" alt="Large product detail" '
                    'style="width:700px;height:700px;object-fit:contain">',
                    1,
                ),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [failure["issue"] for failure in manifest["automation_gate"]["failures"]]
            self.assertTrue(any("effective raster resolution" in issue for issue in issues), issues)

    def test_single_slide_css_change_keeps_incremental_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>", ".slide-2-only{color:#123456}</style>", 1
            ).replace(
                "<!-- SLIDE_2_CONTENT -->", '<p class="slide-2-only">Scoped copy</p>', 1
            ).replace(
                "    </main>",
                '      <section class="slide" data-title="Slide 4"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Four</p></div></section>\n'
                '      <section class="slide" data-title="Slide 5"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Five</p></div></section>\n'
                "    </main>",
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            first = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            global_hash = first["source_fingerprints"]["global_sha256"]

            deck.write_text(html.replace("#123456", "#654321"), encoding="utf-8")
            incremental = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(incremental.returncode, 0, incremental.stderr)
            second = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(second["render_run"]["strategy"], "incremental")
            self.assertEqual(second["render_run"]["directly_changed_slides"], [2])
            self.assertEqual(second["render_run"]["rendered_slides"], [2])
            self.assertEqual(second["render_run"]["reused_slides"], [1, 3, 4, 5])
            self.assertEqual(second["render_run"]["impact_scope"], "direct")
            self.assertEqual(second["source_fingerprints"]["global_sha256"], global_hash)

    def test_structure_change_renders_changed_slide_and_neighbors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->", '<p class="scoped-copy">Scoped copy</p>', 1
            ).replace(
                "    </main>",
                '      <section class="slide" data-title="Slide 4"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Four</p></div></section>\n'
                '      <section class="slide" data-title="Slide 5"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Five</p></div></section>\n'
                "    </main>",
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            deck.write_text(
                html.replace(
                    '<p class="scoped-copy">Scoped copy</p>',
                    '<div class="scoped-copy"><p>Scoped copy</p></div>',
                ),
                encoding="utf-8",
            )
            incremental = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(incremental.returncode, 0, incremental.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["impact_scope"], "neighbors")
            self.assertEqual(manifest["render_run"]["rendered_slides"], [1, 2, 3])
            self.assertEqual(manifest["render_run"]["reused_slides"], [4, 5])
            self.assertIn("structure", manifest["render_run"]["content_changes"])

    def test_slide_scoped_transition_change_includes_neighbors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>", ".slide-2-motion{transition:transform 200ms ease}</style>", 1
            ).replace(
                "<!-- SLIDE_2_CONTENT -->", '<p class="slide-2-motion">Scoped motion</p>', 1
            ).replace(
                "    </main>",
                '      <section class="slide" data-title="Slide 4"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Four</p></div></section>\n'
                '      <section class="slide" data-title="Slide 5"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Five</p></div></section>\n'
                "    </main>",
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            deck.write_text(html.replace("200ms", "420ms"), encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "all",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["impact_scope"], "neighbors")
            self.assertEqual(manifest["render_run"]["rendered_slides"], [1, 2, 3])

    def test_slide_reordering_includes_neighbors_without_full_render(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "    </main>",
                '      <section class="slide" data-title="Slide 4"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Four</p></div></section>\n'
                '      <section class="slide" data-title="Slide 5"><div class="slide-media" aria-hidden="true"></div><div class="slide-content"><p>Five</p></div></section>\n'
                "    </main>",
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            reordered = html.replace('data-title="Slide 2"', 'data-title="SWAP"', 1)
            reordered = reordered.replace('data-title="Slide 3"', 'data-title="Slide 2"', 1)
            reordered = reordered.replace('data-title="SWAP"', 'data-title="Slide 3"', 1)
            deck.write_text(reordered, encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["impact_scope"], "neighbors")
            self.assertEqual(manifest["render_run"]["rendered_slides"], [1, 2, 3, 4])
            self.assertEqual(manifest["render_run"]["reused_slides"], [5])

    def test_shared_css_change_renders_all_without_navigation_e2e_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>", ".slide{--qa-accent:#123456}</style>", 1
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            deck.write_text(html.replace("#123456", "#654321"), encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["strategy"], "full")
            self.assertEqual(manifest["render_run"]["impact_scope"], "full")
            self.assertEqual(manifest["render_run"]["rendered_slides"], [1, 2, 3])
            self.assertFalse(manifest["render_run"]["navigation_changed"])
            self.assertEqual(manifest["render_run"]["content_changes"], ["style"])

    def test_global_wrapper_change_renders_all_without_navigation_e2e_scope(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8")
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            deck.write_text(html.replace('<main class="stage"', '<main class="stage qa-revised"', 1), encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "all",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["strategy"], "full")
            self.assertFalse(manifest["render_run"]["navigation_changed"])
            self.assertEqual(manifest["render_run"]["content_changes"], ["structure"])

    def test_incremental_text_render_omits_unrelated_geometry_payloads(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->", "<p>Initial copy</p>", 1
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            initial = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            deck.write_text(html.replace("Initial copy", "Revised copy"), encoding="utf-8")
            revised = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            for capture in manifest["slides"][1]["captures"].values():
                self.assertIn("text_geometry", capture)
                self.assertIn("container_density", capture)
                self.assertNotIn("image_geometry", capture)
                self.assertNotIn("control_geometry", capture)

    def test_failed_image_geometry_blocks_review_batches(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                '<div class="slide-media" aria-hidden="true"></div>',
                '<div class="slide-media" aria-hidden="true"><img src="missing.webp" alt=""></div>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            self.assertIn("automated geometry gate blocked AI review", render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["automation_gate"]["status"], "fail")
            self.assertEqual(manifest["review_batches"], [])

    def test_misaligned_mirrored_media_and_content_layers_block_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            original = (
                '      <section class="slide" data-title="Slide 2" data-composition-family="diagram">\n'
                '        <div class="slide-media" aria-hidden="true"></div>\n'
                '        <div class="slide-content"><!-- SLIDE_2_CONTENT --></div>\n'
                '      </section>'
            )
            replacement = (
                '      <section class="slide" data-title="Slide 2" data-composition-family="diagram">\n'
                '        <div class="slide-media" aria-hidden="true">'
                '<div class="trend-card" style="position:absolute;left:120px;top:120px;'
                'width:420px;height:360px;background:#334"></div></div>\n'
                '        <div class="slide-content"><div class="trend-card" '
                'style="position:absolute;left:120px;top:165px;width:420px;height:270px;'
                'border:3px solid #fff"></div></div>\n'
                '      </section>'
            )
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(original, replacement, 1),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            failures = [
                failure for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "layer_alignment"
            ]
            self.assertTrue(
                any("mirrored class .trend-card" in failure["issue"] for failure in failures),
                failures,
            )
            self.assertEqual(manifest["review_batches"], [])

    def test_declared_intentional_cross_layer_overlap_is_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            original = (
                '      <section class="slide" data-title="Slide 2" data-composition-family="diagram">\n'
                '        <div class="slide-media" aria-hidden="true"></div>\n'
                '        <div class="slide-content"><!-- SLIDE_2_CONTENT --></div>\n'
                '      </section>'
            )
            replacement = (
                '      <section class="slide" data-title="Slide 2" data-composition-family="diagram">\n'
                '        <div class="slide-media" aria-hidden="true">'
                '<div class="hero-layer" data-overlap-intent="hero-underlay" '
                'style="position:absolute;left:80px;top:80px;width:720px;height:480px;'
                'background:#334"></div></div>\n'
                '        <div class="slide-content"><div class="hero-layer" '
                'data-overlap-intent="hero-underlay" '
                'style="position:absolute;left:180px;top:160px;width:460px;height:220px;'
                'border:3px solid #fff"></div></div>\n'
                '      </section>'
            )
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace(original, replacement, 1),
                encoding="utf-8",
            )
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertFalse([
                failure for failure in manifest["automation_gate"]["failures"]
                if failure["check"] == "layer_alignment"
            ])

    def test_fix_after_automation_failure_rerenders_only_failed_slide_then_batches_pending_reviews(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            assets = root / "assets"
            assets.mkdir()
            self.create_webps(
                (assets / "small.webp", "#335577", 240),
                (assets / "large.webp", "#335577", 1600),
            )
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<img src="assets/small.webp" alt="Product detail" '
                'style="width:500px;height:500px;object-fit:contain">',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            failed = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(failed.returncode, 1)
            first = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(first["review_batches"], [])

            deck.write_text(html.replace("small.webp", "large.webp"), encoding="utf-8")
            fixed = subprocess.run(
                [
                    "node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick",
                    "--slides", "2", "--change-type", "image",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(fixed.returncode, 0, fixed.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["render_run"]["rendered_slides"], [2])
            self.assertEqual(manifest["render_run"]["review_slides"], [1, 3])
            self.assertEqual([batch["slides"] for batch in manifest["review_batches"]], [[1, 3]])
            self.complete_rendered_reviews(manifest)
            manifest_path = review_dir / "review.json"
            manifest_path.write_text(f"{json.dumps(manifest, indent=2)}\n", encoding="utf-8")
            validation = self.validate(deck, manifest_path)
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

    def test_text_geometry_blocks_orphan_line_collision_and_nav_occlusion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-orphan { position:absolute; left:48px; top:38px; width:980px; margin:0; font-size:58px; line-height:1.1; }
                .qa-leading { position:absolute; left:48px; top:260px; width:850px; font-size:90px; line-height:.68; }
                .qa-overlap-a { position:absolute; left:72px; top:540px; margin:0; font-size:34px; }
                .qa-overlap-b { position:absolute; left:110px; top:548px; margin:0; font-size:34px; }
                .qa-footer { position:absolute; right:18px; bottom:18px; margin:0; font-size:20px; }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <div class="qa-orphan"><span>행사마다 표정은 달라도, 서점의 목소리는 하나입니</span><br><span>다.</span></div>
                <div class="qa-leading">다음 장면을<br>함께 만들어가요.</div>
                <p class="qa-overlap-a">First text region</p>
                <p class="qa-overlap-b">Second text region</p>
                <p class="qa-footer">One modular rule, many voices</p>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            self.assertIn("automated geometry gate blocked AI review", render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            failures = [failure["issue"] for failure in manifest["automation_gate"]["failures"]]
            self.assertTrue(any("stranded Korean ending" in issue for issue in failures))
            self.assertTrue(any("rendered text lines collide" in issue for issue in failures))
            self.assertTrue(any("rendered text regions overlap" in issue for issue in failures))
            self.assertTrue(any("covered by navigation controls" in issue for issue in failures))
            self.assertEqual(manifest["review_batches"], [])

    def test_text_geometry_accepts_balanced_multiline_display_type(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-balanced { position:absolute; left:64px; top:72px; width:900px; margin:0; font-size:58px; line-height:1.08; }
                .qa-safe-footer { position:absolute; left:64px; bottom:76px; margin:0; font-size:20px; }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                """
                <h1 class="qa-balanced">행사마다 표정은 달라도,<br>서점의 목소리는 하나입니다.</h1>
                <p class="qa-safe-footer">Campaign posters and event leaflets</p>
                """,
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            failures = [failure for failure in manifest["automation_gate"]["failures"] if failure["slide"] == 2]
            self.assertEqual(failures, [])

    def test_line_break_exemption_routes_quick_slide_to_ai_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                ".qa-exempt { position:absolute; left:64px; top:72px; margin:0; font-size:58px; line-height:1.08; }</style>",
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<h1 class="qa-exempt" data-line-break-ok>의도적인 포스터 문장 구성입니<br>다.</h1>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            warnings = [
                warning for warning in manifest["automation_gate"]["warnings"]
                if warning["slide"] == 2 and "final-line exemption" in warning["warning"]
            ]
            self.assertEqual({warning["profile"] for warning in warnings}, {"normal", "short", "zoom150"})
            self.assertEqual(manifest["slides"][1]["required_ai_profiles"], ["normal", "short", "zoom150"])
            self.assertTrue(any(2 in batch["slides"] for batch in manifest["review_batches"]))

    def test_severely_underfilled_container_blocks_before_ai_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<div class="card" style="width:900px;height:420px;border:1px solid #bbb"><p>짧은 사실</p></div>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            failures = [
                failure for failure in manifest["automation_gate"]["failures"]
                if failure["slide"] == 2 and failure["check"] == "container_density"
            ]
            self.assertEqual({failure["profile"] for failure in failures}, {"normal", "short", "zoom150"})
            self.assertTrue(any("oversized low-information container" in failure["issue"] for failure in failures))
            self.assertEqual(manifest["slides"][1]["required_ai_profiles"], [])
            self.assertFalse(manifest["review_batches"])

    def test_repeated_component_wall_blocks_before_ai_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            boxes = "".join(
                f'<div class="qa-widget"><span>STATUS {index:02}</span></div>'
                for index in range(1, 17)
            )
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "</style>",
                """
                .qa-wall {
                  position:absolute; left:80px; top:90px; width:1040px; height:480px;
                  display:grid; grid-template-columns:repeat(4,1fr); gap:12px;
                }
                .qa-widget {
                  display:grid; place-items:center; background:#27323a;
                  border:1px solid #66737c; color:white;
                }
                </style>
                """,
                1,
            ).replace(
                "<!-- SLIDE_2_CONTENT -->",
                f'<div class="qa-wall">{boxes}</div>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            issues = [
                failure["issue"] for failure in manifest["automation_gate"]["failures"]
                if failure["slide"] == 2 and failure["check"] == "container_density"
            ]
            self.assertTrue(any("repeated component wall" in issue for issue in issues), issues)

    def test_identity_contract_binds_reference_and_routes_quick_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            assets = root / "assets"
            identity = assets / "identity"
            identity.mkdir(parents=True)
            self.create_webps(
                (assets / "candidate.webp", "#cc3344"),
                (identity / "official.webp", "#993355"),
            )
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<img src="assets/candidate.webp" alt="Character A" style="width:320px;height:320px;object-fit:contain" '
                'data-subject-id="series:character-a" data-subject-name="Character A / 캐릭터 A" '
                'data-identity-reference="assets/identity/official.webp" '
                'data-identity-cues="red hair; star badge" data-identity-mode="primary">',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(
                render.returncode,
                0,
                render.stderr + (review_dir / "review.json").read_text(encoding="utf-8"),
            )
            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            record = manifest["slides"][1]
            self.assertTrue(record["identity_required"])
            self.assertEqual(record["identity_detection"], "subject-metadata")
            self.assertEqual(record["required_ai_profiles"], ["normal"])
            self.assertEqual(len(record["identity_targets"]), 1)
            self.assertEqual(record["identity_targets"][0]["reference_path"], "assets/identity/official.webp")
            self.assertIn("content_match", record["checks"])
            self.assertIn("completion", record["checks"])
            self.assertIn("identity", record["checks"])
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
            validation = self.validate(deck, manifest_path)
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

    def test_identity_contract_blocks_missing_reference_before_ai_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "candidate.webp", "#cc3344"))
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<img src="assets/candidate.webp" alt="Character A" style="width:320px;height:320px;object-fit:contain" '
                'data-subject-id="series:character-a" data-subject-name="Character A" '
                'data-identity-reference="assets/identity/missing.webp" '
                'data-identity-cues="red hair; star badge">',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            self.assertIn("automated geometry gate blocked AI review", render.stderr)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["automation_gate"]["status"], "fail")
            self.assertEqual(manifest["review_batches"], [])

    def test_semantic_character_profile_cannot_bypass_identity_review_by_omitting_flag(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "candidate.webp", "#4488cc"))
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<div class="character-profile"><img src="assets/candidate.webp" alt="Named character" '
                'style="width:320px;height:320px;object-fit:contain"></div>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            record = manifest["slides"][1]
            self.assertTrue(record["identity_required"])
            self.assertEqual(record["identity_detection"], "semantic-markup")
            self.assertTrue(any(
                "identity review requires data-subject-id" in failure["issue"]
                for failure in manifest["automation_gate"]["failures"]
            ))

    def test_descendant_person_content_kind_activates_identity_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            assets = root / "assets"
            assets.mkdir()
            self.create_webps((assets / "candidate.webp", "#225599"))
            html = TEMPLATE.read_text(encoding="utf-8").replace(
                "<!-- SLIDE_2_CONTENT -->",
                '<figure data-content-kind="person"><img src="assets/candidate.webp" alt="Named person" '
                'style="width:320px;height:320px;object-fit:contain"></figure>',
                1,
            )
            deck.write_text(html, encoding="utf-8")
            review_dir = root / "review"
            render = subprocess.run(
                ["node", str(RENDERER), str(deck), str(review_dir), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(render.returncode, 1)
            manifest = json.loads((review_dir / "review.json").read_text(encoding="utf-8"))
            record = manifest["slides"][1]
            self.assertTrue(record["identity_required"])
            self.assertEqual(record["identity_detection"], "semantic-markup")

    def test_default_workspace_stays_under_agent_home_and_can_be_cleaned(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            delivery = root / "delivery"
            delivery.mkdir()
            deck = delivery / "발표 자료 (최종).html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            deck_alias = root / "deck-alias.html"
            deck_alias.symlink_to(deck)
            codex_home = root / "codex-home"
            env = {**os.environ, "CODEX_HOME": str(codex_home)}

            review_lookup = subprocess.run(
                ["node", str(RENDERER), "--review-dir", str(deck)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(review_lookup.returncode, 0, review_lookup.stderr)
            review_dir = Path(review_lookup.stdout.strip())
            self.assertTrue(str(review_dir).startswith(str(codex_home)))
            self.assertEqual(review_dir.name, "review")
            alias_lookup = subprocess.run(
                ["node", str(RENDERER), "--review-dir", str(deck_alias)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(alias_lookup.returncode, 0, alias_lookup.stderr)
            self.assertEqual(Path(alias_lookup.stdout.strip()), review_dir)

            render = subprocess.run(
                ["node", str(RENDERER), str(deck), "--mode", "quick"],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(render.returncode, 0, render.stderr)
            self.assertTrue((review_dir / "review.json").is_file())
            self.assertTrue((review_dir.parent / "drafts").is_dir())
            self.assertTrue((review_dir.parent / "tmp").is_dir())
            self.assertFalse((delivery / "review").exists())

            manifest_path = review_dir / "review.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["review_workspace"]["storage"], "agent-home")
            self.complete_rendered_reviews(manifest)
            manifest_path.write_text(f"{json.dumps(manifest, ensure_ascii=False, indent=2)}\n", encoding="utf-8")
            validation = subprocess.run(
                ["python3", str(VALIDATOR), str(deck_alias)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(validation.returncode, 0, validation.stdout + validation.stderr)

            clean = subprocess.run(
                ["node", str(RENDERER), "--clean-workspace", str(deck)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(clean.returncode, 0, clean.stderr)
            self.assertFalse(review_dir.parent.exists())

    def test_claude_config_dir_selects_claude_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "claude-deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            claude_home = root / "claude-home"
            env = {key: value for key, value in os.environ.items() if key != "CODEX_HOME"}
            env["CLAUDE_CONFIG_DIR"] = str(claude_home)

            lookup = subprocess.run(
                ["node", str(RENDERER), "--workspace-dir", str(deck)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(lookup.returncode, 0, lookup.stderr)
            self.assertTrue(Path(lookup.stdout.strip()).is_relative_to(claude_home))

    def test_gemini_home_selects_gemini_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "gemini-deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            gemini_home = root / "gemini-home"
            env = {
                key: value for key, value in os.environ.items()
                if key not in {"CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_HOME"}
            }
            env["GEMINI_HOME"] = str(gemini_home)

            lookup = subprocess.run(
                ["node", str(RENDERER), "--workspace-dir", str(deck)],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            self.assertEqual(lookup.returncode, 0, lookup.stderr)
            self.assertTrue(Path(lookup.stdout.strip()).is_relative_to(gemini_home))


if __name__ == "__main__":
    unittest.main()
