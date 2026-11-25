#!/usr/bin/env python3

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_slide_guide.py"


def deck() -> str:
    return """<!doctype html><html><body>
<section class="slide" data-title="Flow pipeline"></section>
<section class="slide" data-title="Storage and query"></section>
</body></html>"""


def section(number: int, title: str) -> str:
    return f"""## {number}. {title}

![Slide {number} — {title}](deck-guide-assets/slide-{number:02d}.png)

### 이 슬라이드에서 이해할 것

이 장은 입력 데이터가 수집기에서 처리기로 이동하고, 정규화와 필터를 거쳐 저장되는 전체 메커니즘을 설명한다. 단순한 화살표가 아니라 각 단계에서 데이터의 형태와 책임이 어떻게 달라지는지가 핵심이다.

### 슬라이드가 생략한 세부 내용

슬라이드에는 공간 때문에 공통 스키마를 붙이는 이유와 필터 순서가 생략되어 있다. 출처와 시간 정보가 먼저 정규화되어야 뒤 단계가 같은 기준으로 중복과 정책 위반을 판단할 수 있다.

### 어떻게 작동하나

수집기는 원본 이벤트를 받아 공통 스키마를 붙인다. 처리기는 중복을 제거하고 정책에 맞지 않는 레코드를 제외한다. 저장 단계에서는 조회 목적에 맞는 인덱스를 만들고 보존 기간을 적용한다.

### 실제로는 어떻게 쓰나

운영자는 장애 시 수집량, 처리 지연, 드롭 비율을 차례로 확인한다. 입력은 정상인데 저장량이 줄었다면 처리 규칙이나 백프레셔를 먼저 의심할 수 있다.

### 조건과 주의점

- **수집기**: 원본 이벤트를 받아 시간과 출처 메타데이터를 보강한다.
- **처리기**: 정규화, 필터링, 라우팅을 수행해 저장 가능한 레코드로 만든다.
- 샘플링과 보존 정책은 비용을 줄이지만 사후 분석에 필요한 원본을 없앨 수 있다.
"""


HUMANIZE_SUMMARY = """
<!-- HUMANIZE-SUMMARY
원본/윤문본 글자수: 1200/1180 · 변경률 8.0%
자체검증: 6/6 통과
등급: B
-->
"""


class SlideGuideValidatorTests(unittest.TestCase):
    def run_validator(self, guide_text: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck_path = root / "deck.html"
            guide_path = root / "deck-guide.md"
            deck_path.write_text(deck(), encoding="utf-8")
            guide_path.write_text(guide_text, encoding="utf-8")
            capture_dir = root / "deck-guide-assets"
            capture_dir.mkdir()
            (capture_dir / "slide-01.png").write_bytes(b"png")
            (capture_dir / "slide-02.png").write_bytes(b"png")
            (root / "deck-guide.html").write_text(
                '<!doctype html><html><body><img src="deck-guide-assets/slide-01.png">'
                '<img src="deck-guide-assets/slide-02.png"></body></html>',
                encoding="utf-8",
            )
            (root / "deck-guide.pdf").write_bytes(b"%PDF-1.7\n")
            return subprocess.run(
                ["python3", str(VALIDATOR), str(deck_path), str(guide_path)],
                capture_output=True,
                text=True,
                check=False,
            )

    def test_accepts_detailed_matching_sections(self) -> None:
        result = self.run_validator(
            section(1, "Flow pipeline")
            + "\n"
            + section(2, "Storage and query")
            + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_title_mismatch(self) -> None:
        result = self.run_validator(
            section(1, "Wrong title")
            + "\n"
            + section(2, "Storage and query")
            + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("title mismatch", result.stdout)

    def test_rejects_shallow_visual_cue(self) -> None:
        result = self.run_validator(
            "## 1. Flow pipeline\n\n"
            "![Slide 1](deck-guide-assets/slide-01.png)\n\n### 보기\n\n왼쪽부터 본다.\n\n"
            "## 2. Storage and query\n\n"
            "![Slide 2](deck-guide-assets/slide-02.png)\n\n### 보기\n\n오른쪽을 본다.\n"
            + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("detailed subject explanation", result.stdout)

    def test_rejects_template_placeholders(self) -> None:
        result = self.run_validator(
            section(1, "Flow pipeline").replace("이 장은", "{{설명}} 이 장은", 1)
            + "\n"
            + section(2, "Storage and query")
            + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("template placeholders", result.stdout)

    def test_rejects_presenter_script_section(self) -> None:
        result = self.run_validator(
            section(1, "Flow pipeline")
            + "\n### Presenter script\n\nRead every sentence aloud.\n"
            + section(2, "Storage and query")
            + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("omit presenter", result.stdout)

    def test_rejects_capture_below_explanation(self) -> None:
        misplaced = section(1, "Flow pipeline").replace(
            "![Slide 1 — Flow pipeline](deck-guide-assets/slide-01.png)\n\n### 이 슬라이드에서 이해할 것",
            "### 이 슬라이드에서 이해할 것\n\n![Slide 1 — Flow pipeline](deck-guide-assets/slide-01.png)",
            1,
        )
        result = self.run_validator(
            misplaced + "\n" + section(2, "Storage and query") + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("capture immediately above", result.stdout)

    def test_rejects_korean_guide_without_humanize_summary(self) -> None:
        result = self.run_validator(
            section(1, "Flow pipeline") + "\n" + section(2, "Storage and query")
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires humanize-korean", result.stdout)

    def test_rejects_section_without_omitted_detail_explanation(self) -> None:
        shallow = section(1, "Flow pipeline").replace(
            "### 슬라이드가 생략한 세부 내용",
            "### 추가 설명",
            1,
        )
        result = self.run_validator(
            shallow + "\n" + section(2, "Storage and query") + HUMANIZE_SUMMARY
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("details omitted from the slide", result.stdout)
