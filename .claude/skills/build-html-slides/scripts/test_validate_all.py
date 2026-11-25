#!/usr/bin/env python3
"""End-to-end tests for the single validation entrypoint."""

from __future__ import annotations

import subprocess
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.validate_all import (
    classify_change_scope,
    deterministic_commands,
    parallel_worker_count,
    validation_session,
)


ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "scripts" / "validate_all.py"
PREFLIGHT = ROOT / "scripts" / "check_environment.py"
TEMPLATE = ROOT / "assets" / "runtime-shell.html"


def write_design_contract(root: Path, theme: str = "Theme A") -> Path:
    path = root / "drafts" / "design-contract.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "contract_id": f"contract-{theme}",
                "selected": {
                    "theme": theme,
                    "surface": "warm-paper",
                    "cover_family": "editorial-split",
                    "title_anchor": "left",
                    "hero_form": "contained-object",
                    "type_direction": "grotesk-display",
                    "palette_direction": "ink-red-teal",
                },
            }
        ),
        encoding="utf-8",
    )
    return path


def notes() -> str:
    sections = []
    for number in range(1, 4):
        sections.append(
            f"## {number}. Slide {number}\n\n"
            "- 핵심 메시지\n- 설명 근거\n- 전환 문장\n- 청중 질문\n- 다음 장 연결\n"
        )
    return "\n".join(sections)


def guide() -> str:
    sections = []
    for number in range(1, 4):
        sections.append(
            f"## {number}. Slide {number}\n\n"
            f"![Slide {number}](deck-guide-assets/slide-{number:02d}.png)\n\n"
            "### 이 슬라이드에서 이해할 것\n\n"
            "이 장은 슬라이드에 압축된 주장의 배경과 전제를 완전한 문장으로 풀어 설명한다. "
            "독자는 발표를 듣지 않아도 왜 이 정보가 필요한지와 앞뒤 장의 논리적 관계를 이해할 수 있다.\n\n"
            "### 슬라이드가 생략한 세부 내용\n\n"
            "슬라이드에는 정규화 순서와 오류 기록의 이유가 생략되어 있다. 공통 형식을 먼저 붙여야 "
            "뒤 단계가 같은 기준으로 정책을 적용하고 실패 지점을 비교할 수 있다.\n\n"
            "### 어떻게 작동하나\n\n"
            "입력은 첫 단계에서 공통 형식으로 정규화되고, 두 번째 단계에서 정책과 조건에 따라 "
            "필터링된다. 처리 결과는 다음 구성요소로 전달되며 상태와 오류 정보도 함께 기록된다.\n\n"
            "### 구성요소별 역할\n\n"
            "- **입력 단계**: 원본 데이터에 출처와 시간 메타데이터를 붙인다.\n"
            "- **처리 단계**: 검증, 변환, 라우팅을 수행해 다음 단계가 사용할 형태로 만든다.\n\n"
            "### 실무 적용과 예시\n\n"
            "운영자는 입력량, 처리 지연, 실패 비율을 순서대로 비교해 병목 위치를 좁힌다. "
            "입력량은 정상인데 출력만 줄었다면 처리 규칙과 백프레셔를 먼저 확인한다.\n\n"
            "### 한계와 주의사항\n\n"
            "- 샘플링과 보존 기간은 비용을 낮추지만 사후 분석에 필요한 원본을 줄일 수 있다.\n"
        )
    return "\n".join(sections) + """

<!-- HUMANIZE-SUMMARY
원본/윤문본 글자수: 1800/1740 · 변경률 8.1%
자체검증: 6/6 통과
등급: B
-->
"""


def write_guide_bundle(root: Path) -> Path:
    guide_path = root / "deck-guide.md"
    guide_path.write_text(guide(), encoding="utf-8")
    capture_dir = root / "deck-guide-assets"
    capture_dir.mkdir(exist_ok=True)
    for number in range(1, 4):
        (capture_dir / f"slide-{number:02d}.png").write_bytes(b"png")
    (root / "deck-guide.html").write_text(
        "<!doctype html><html><body>"
        + "".join(
            f'<img src="deck-guide-assets/slide-{number:02d}.png">'
            for number in range(1, 4)
        )
        + "</body></html>",
        encoding="utf-8",
    )
    (root / "deck-guide.pdf").write_bytes(b"%PDF-1.7\n")
    return guide_path


class ValidateAllTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        check = subprocess.run(
            ["python3", str(PREFLIGHT)], capture_output=True, text=True, check=False
        )
        if check.returncode:
            raise unittest.SkipTest(check.stdout + check.stderr)

    def test_prepare_runs_every_deterministic_gate_and_renderer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8").replace('<html lang="ko">', '<html lang="en">', 1),
                encoding="utf-8",
            )
            notes_path = root / "deck-notes.md"
            notes_path.write_text(notes(), encoding="utf-8")
            guide_path = write_guide_bundle(root)
            review = root / "review"
            result = subprocess.run(
                [
                    "python3", str(ENTRYPOINT), str(deck), "--phase", "prepare", "--mode", "quick",
                    "--notes", str(notes_path), "--guide", str(guide_path),
                    "--review-dir", str(review),
                    "--change-type", "text", "--debug-timing",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("PASS: browser interaction and print E2E", result.stdout)
            self.assertIn("PASS: Chromium render and geometry gate", result.stdout)
            self.assertIn("TIMING: validation.prepare / Chromium render and geometry gate", result.stdout)
            self.assertTrue((review / "review.json").is_file())
            timing = json.loads((root / "workflow-timing.json").read_text(encoding="utf-8"))
            steps = {event["step"] for event in timing["events"]}
            self.assertIn("browser interaction and print E2E", steps)
            self.assertIn("Chromium render and geometry gate", steps)
            self.assertIn("phase total", steps)

    def test_prepare_requires_user_approved_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            result = subprocess.run(
                ["python3", str(ENTRYPOINT), str(deck), "--phase", "prepare"],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("--mode quick|full is required", result.stderr)

    def test_parallel_worker_count_uses_default_and_hard_cap(self) -> None:
        self.assertEqual(parallel_worker_count(10), 4)
        with patch.dict("os.environ", {"BUILD_HTML_SLIDES_VALIDATION_WORKERS": "99"}):
            self.assertEqual(parallel_worker_count(20), 8)
        with patch.dict("os.environ", {"BUILD_HTML_SLIDES_VALIDATION_WORKERS": "2"}):
            self.assertEqual(parallel_worker_count(1), 1)
        with patch.dict("os.environ", {"BUILD_HTML_SLIDES_VALIDATION_WORKERS": "0"}):
            with self.assertRaisesRegex(RuntimeError, "must be positive"):
                parallel_worker_count(4)

    def test_prepare_blocks_place_note_before_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8")
                .replace('<html lang="ko">', '<html lang="en">', 1)
                .replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<div class="destination-art">PLACE NOTE</div><h2>Slide 2</h2>',
                    1,
                ),
                encoding="utf-8",
            )
            notes_path = root / "deck-notes.md"
            notes_path.write_text(notes(), encoding="utf-8")
            guide_path = write_guide_bundle(root)
            review = root / "review"
            result = subprocess.run(
                [
                    "python3", str(ENTRYPOINT), str(deck), "--phase", "prepare", "--mode", "quick",
                    "--notes", str(notes_path), "--guide", str(guide_path),
                    "--review-dir", str(review),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("blocked PLACE NOTE text", result.stdout)
            self.assertIn("placeholder and incomplete-asset gate", result.stderr)
            self.assertFalse((review / "review.json").exists())
            timing = json.loads((root / "workflow-timing.json").read_text(encoding="utf-8"))
            failed = [event for event in timing["events"] if event["status"] == "fail"]
            self.assertTrue(any(event["step"] == "placeholder and incomplete-asset gate" for event in failed))

    def test_prepare_collects_multiple_parallel_failures_before_rendering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8")
                .replace('<html lang="ko">', '<html lang="en">', 1)
                .replace(
                    "<!-- SLIDE_2_CONTENT -->",
                    '<div class="destination-art">PLACE NOTE</div><h2>Slide 2</h2>',
                    1,
                ),
                encoding="utf-8",
            )
            notes_path = root / "deck-notes.md"
            notes_path.write_text("## 1. Wrong slide\n\n- incomplete\n", encoding="utf-8")
            guide_path = write_guide_bundle(root)
            review = root / "review"
            result = subprocess.run(
                [
                    "python3", str(ENTRYPOINT), str(deck), "--phase", "prepare", "--mode", "quick",
                    "--notes", str(notes_path), "--guide", str(guide_path),
                    "--review-dir", str(review),
                    "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            combined = result.stdout + result.stderr
            self.assertEqual(result.returncode, 1, combined)
            self.assertIn("placeholder and incomplete-asset gate", combined)
            self.assertIn("presenter notes", combined)
            self.assertIn("2 deterministic checks failed", combined)
            self.assertFalse((review / "review.json").exists())
            report = json.loads((root / "validation-failures.json").read_text(encoding="utf-8"))
            labels = {failure["label"] for failure in report["failures"]}
            self.assertIn("placeholder and incomplete-asset gate", labels)
            self.assertIn("presenter notes", labels)
            self.assertEqual(report["failure_count"], len(report["failures"]))
            self.assertGreaterEqual(report["parallel_workers"], 2)
            self.assertEqual(report["repair_lanes"]["notes"], 1)
            self.assertEqual(report["repair_lanes"]["deck-source"], 1)

    def test_incremental_change_types_skip_unrelated_expensive_checks(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text('<!doctype html><html><body></body></html>', encoding="utf-8")
            notes_path = root / "deck-notes.md"
            guide_path = root / "deck-guide.md"
            sources = root / "sources.json"
            text_labels = {
                label
                for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "text"
                )
            }
            navigation_labels = {
                label
                for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "navigation"
                )
            }
            image_labels = {
                label
                for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "image"
                )
            }
            style_labels = {
                label for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "all", content_changes=["style"]
                )
            }
            structure_labels = {
                label for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "all", content_changes=["structure"]
                )
            }
            self.assertNotIn("browser interaction and print E2E", text_labels)
            self.assertNotIn("image reuse", text_labels)
            self.assertIn("placeholder and incomplete-asset gate", text_labels)
            self.assertIn("browser interaction and print E2E", navigation_labels)
            self.assertIn("placeholder and incomplete-asset gate", navigation_labels)
            self.assertNotIn("presenter notes", navigation_labels)
            self.assertNotIn("reader study guide", navigation_labels)
            self.assertIn("source locality", image_labels)
            self.assertNotIn("source locality", text_labels)
            self.assertEqual(
                style_labels,
                {"deck structure", "placeholder and incomplete-asset gate"},
            )
            self.assertIn("presenter notes", structure_labels)
            self.assertNotIn("reader study guide", structure_labels)
            self.assertNotIn("source locality", structure_labels)
            self.assertNotIn("browser interaction and print E2E", structure_labels)

            guide_path.write_text("optional guide", encoding="utf-8")
            structure_with_guide = {
                label for label, _command in deterministic_commands(
                    deck, notes_path, guide_path, sources, "all", content_changes=["structure"]
                )
            }
            self.assertIn("reader study guide", structure_with_guide)

    def test_incremental_prepare_widens_a_misdeclared_text_change(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(
                TEMPLATE.read_text(encoding="utf-8")
                .replace('<html lang="ko">', '<html lang="en">', 1)
                .replace("<!-- SLIDE_2_CONTENT -->", "<h2>Slide 2</h2>", 1),
                encoding="utf-8",
            )
            notes_path = root / "deck-notes.md"
            notes_path.write_text(notes(), encoding="utf-8")
            guide_path = write_guide_bundle(root)
            review = root / "review"
            initial = subprocess.run(
                [
                    "python3", str(ENTRYPOINT), str(deck), "--phase", "prepare", "--mode", "quick",
                    "--notes", str(notes_path), "--guide", str(guide_path),
                    "--review-dir", str(review),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stdout + initial.stderr)

            deck.write_text(
                deck.read_text(encoding="utf-8").replace(
                    "<h2>Slide 2</h2>",
                    "<h2><span>Slide 2</span></h2>",
                    1,
                ),
                encoding="utf-8",
            )
            revised = subprocess.run(
                [
                    "python3", str(ENTRYPOINT), str(deck), "--phase", "prepare", "--mode", "quick",
                    "--notes", str(notes_path), "--guide", str(guide_path),
                    "--review-dir", str(review),
                    "--slides", "2", "--change-type", "text",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(revised.returncode, 0, revised.stdout + revised.stderr)
            self.assertIn("requested change type text resolved to all", revised.stdout)
            manifest = json.loads((review / "review.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["change_type"], "all")
            self.assertEqual(manifest["render_run"]["requested_change_type"], "text")
            self.assertEqual(manifest["render_run"]["detected_change_type"], "all")

    def test_change_classifier_widens_when_review_configuration_changed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review = root / "review"
            initial = subprocess.run(
                [
                    "node", str(ROOT / "scripts" / "render_slides.js"), str(deck), str(review),
                    "--mode", "quick", "--review-risk", "standard",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(initial.returncode, 0, initial.stdout + initial.stderr)
            effective = classify_change_scope(
                deck,
                review,
                "text",
                "quick",
                "high",
                False,
                review / ".fingerprint-cache.json",
            )
            self.assertEqual(effective["effective"], "all")
            self.assertEqual(effective["impact"], "full")

    def test_full_validation_budget_cannot_exceed_sixty_minutes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review = root / "review"
            write_design_contract(root)
            with patch.dict(
                "os.environ",
                {"BUILD_HTML_SLIDES_FULL_VALIDATION_SECONDS": "7200"},
            ):
                session = validation_session(
                    review,
                    deck,
                    phase="prepare",
                    mode="full",
                    review_risk="standard",
                    high_risk_reason=None,
                )
            self.assertIsNotNone(session)
            self.assertEqual(session["budget_seconds"], 3600)

    def test_theme_invalidated_restart_uses_a_fresh_sixty_minute_cycle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review = root / "review"
            write_design_contract(root, "Theme A")
            initial = validation_session(
                review,
                deck,
                phase="prepare",
                mode="full",
                review_risk="standard",
                high_risk_reason=None,
            )
            write_design_contract(root, "Theme B")
            restarted = validation_session(
                review,
                deck,
                phase="prepare",
                mode="full",
                review_risk="standard",
                high_risk_reason=None,
                restart_reason="theme-invalidated",
                change_impact="full",
            )
            self.assertEqual(restarted["generation"], 2)
            self.assertEqual(restarted["restart_count"], 1)
            self.assertEqual(restarted["history"][0]["design_signature"], initial["design_signature"])
            self.assertEqual(restarted["budget_seconds"], 3600)

    def test_restart_rejects_the_same_visual_grammar(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review = root / "review"
            write_design_contract(root)
            validation_session(
                review,
                deck,
                phase="prepare",
                mode="full",
                review_risk="standard",
                high_risk_reason=None,
            )
            with self.assertRaisesRegex(RuntimeError, "genuinely different"):
                validation_session(
                    review,
                    deck,
                    phase="prepare",
                    mode="full",
                    review_risk="standard",
                    high_risk_reason=None,
                    restart_reason="theme-invalidated",
                    change_impact="full",
                )

    def test_expired_session_allows_only_explicit_cover_closeout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            review = root / "review"
            write_design_contract(root)
            session = validation_session(
                review,
                deck,
                phase="prepare",
                mode="full",
                review_risk="standard",
                high_risk_reason=None,
            )
            session["deadline_at_epoch"] = 1
            (root / "validation-session.json").write_text(json.dumps(session), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "only a slide-1"):
                validation_session(
                    review,
                    deck,
                    phase="verify",
                    mode="full",
                    review_risk="standard",
                    high_risk_reason=None,
                )
            closeout = validation_session(
                review,
                deck,
                phase="cover-verify",
                mode="full",
                review_risk="standard",
                high_risk_reason=None,
                allow_expired=True,
            )
            self.assertEqual(closeout["status"], "time-budget-exceeded")

    def test_high_risk_prepare_requires_an_explicit_allowed_reason(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            result = subprocess.run(
                [
                    "python3",
                    str(ENTRYPOINT),
                    str(deck),
                    "--phase",
                    "prepare",
                    "--mode",
                    "full",
                    "--review-risk",
                    "high",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("--high-risk-reason", result.stderr)


if __name__ == "__main__":
    unittest.main()
