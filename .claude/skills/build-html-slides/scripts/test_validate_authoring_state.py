#!/usr/bin/env python3
"""Tests for the research-brief and copy-freeze contract."""

from __future__ import annotations

import tempfile
import subprocess
import unittest
from pathlib import Path

from scripts.validate_authoring_state import (
    EDITORIAL_REVIEW_PATTERN,
    FREEZE_PATTERN,
    editorial_review_record,
    freeze_record,
    load_editorial_review,
    research_material_digest,
    validate_brief,
    validate_editorial_review,
    validate_state,
)


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "research-brief-template.md"
REVIEW_TEMPLATE = ROOT / "assets" / "research-storyboard-review-template.md"
LOCKER = ROOT / "scripts" / "lock_research_storyboard.py"


def settled_brief() -> str:
    return (
        TEMPLATE.read_text(encoding="utf-8")
        .replace("- 목적:", "- 목적: 팀 의사결정")
        .replace("- 청중:", "- 청중: 제품팀")
        .replace("- 의사결정자:", "- 의사결정자: 제품 책임자")
        .replace("- 발표 후 원하는 행동:", "- 발표 후 원하는 행동: 승인")
        .replace("- 기준 지역 및 기준일:", "- 기준 지역 및 기준일: 한국, 2026-07-28")
        .replace("- 요청 범위:", "- 요청 범위: 제품 전략")
        .replace("- 반드시 포함할 내용:", "- 반드시 포함할 내용: 근거")
        .replace("- 제외할 내용:", "- 제외할 내용: 미확인 추정")
        .replace("- 사용자와 합의된 결정:", "- 사용자와 합의된 결정: 3장")
        .replace("- 선택한 조사 깊이:", "- 선택한 조사 깊이: 분석형")
        .replace("- 그렇게 판단한 이유:", "- 그렇게 판단한 이유: 비교와 원인 설명이 의사결정에 필요함")
        .replace("- 이번 자료가 답해야 할 중심 질문:", "- 이번 자료가 답해야 할 중심 질문: 무엇이 성과 차이를 만드는가")
        .replace("- 필요한 증거 부담:", "- 필요한 증거 부담: 관측, 대안 가설, 실행 함의")
        .replace("- 디자인 계약 파일:", "- 디자인 계약 파일: drafts/design-contract.json")
        .replace("- 선택된 테마·커버 패밀리:", "- 선택된 테마·커버 패밀리: Swiss Signal, editorial")
        .replace("- 선택 이유 또는 대안 선택 사유:", "- 선택 이유 또는 대안 선택 사유: 근거 중심 기술 설명")
        .replace("- 사용할 구성 패밀리:", "- 사용할 구성 패밀리: cover, diagram, comparison")
        .replace("- 피할 최근 시그니처·금지 혼합:", "- 피할 최근 시그니처·금지 혼합: dark-console")
        .replace(
            "|  |  |  |  |",
            "| Q1 | 무엇이 달라졌나 | 원인과 규모 | Q2 | 해결됨 |",
            1,
        )
        .replace("|  |  |  |", "| API | API | 공식 명칭 |", 1)
        .replace(
            "|  |  |  |  |  |  |  |  |  |  |  |",
            "| C1 | 외부 사실 주장 없음 | 내부 결정 | 방향 제시 | 팀 정렬 | 대안 없음 | 승인 | 높음 | 내부 | 없음 | 2 |",
            1,
        )
        .replace(
            "|  |  |  |  |  |  |  |  |",
            "| 1 | 표지 | 무엇을 결정하나 | 방향 제시 | C1 | 팀이 같은 문제를 본다 | 왜 지금인가 | 제목 | 본문 |",
            1,
        )
        .replace("- 실제 사진·공식 이미지:", "- 실제 사진·공식 이미지: 없음")
        .replace("- 차트·다이어그램:", "- 차트·다이어그램: 흐름도")
        .replace("- 생성 이미지 사용 범위:", "- 생성 이미지 사용 범위: 없음")
        .replace("- 출처·라이선스 주의점:", "- 출처·라이선스 주의점: 없음")
        .replace(
            "|  |  |  |  |  | 사진·도형 없이 재구성 |",
            "| 1 | 실제 제품 확인 | 공식 제품 사진 | 없음 | 1600px 이상·선명함 | 사진 없이 제목 중심 구성 |",
            1,
        )
        .replace("- 검토 상태:", "- 검토 상태: 최초 조사·스토리보드 작성 완료")
        .replace("- 검토 입력:", "- 검토 입력: 사용자 요청, 조사 브리프, 출처, 스토리보드")
        .replace("- 검토 후 허용 수정:", "- 검토 후 허용 수정: 한 번의 통합 수정")
        .replace("- 반복 검토 금지:", "- 반복 검토 금지: 렌더 전 편집 검수는 한 번만 수행")
        .replace("- 해결됨:", "- 해결됨: 중심 질문과 근거 연결")
        .replace("- 미해결·공개 한계:", "- 미해결·공개 한계: 없음")
    )


def settled_review() -> str:
    return (
        REVIEW_TEMPLATE.read_text(encoding="utf-8")
        .replace("- 검토자:", "- 검토자: editorial-pass-001")
        .replace("- 검토 대상 조사 깊이:", "- 검토 대상 조사 깊이: 분석형")
        .replace("- 중심 질문 충족:", "- 중심 질문 충족: pass")
        .replace("- 자료·근거 충분성:", "- 자료·근거 충분성: pass")
        .replace("- 해석·인과 경계:", "- 해석·인과 경계: pass")
        .replace("- 지표의 쓰임:", "- 지표의 쓰임: pass")
        .replace("- 스토리 연결:", "- 스토리 연결: pass")
        .replace("- 결론·실행 함의:", "- 결론·실행 함의: pass")
        .replace(
            "|  |  |  |  |  |",
            "| 1 | 보통 | 지표 해석 | 총합의 쓰임 명시 | 수치만으로 의미 불명 | 반영 |",
            1,
        )
        .replace("- 남은 한계:", "- 남은 한계: 공개 자료 범위")
        .replace("- 통합 수정 결과:", "- 통합 수정 결과: 지표 해석과 전환을 한 번에 보강")
        .replace("- 최종 판정:", "- 최종 판정: proceed-with-disclosed-limits")
    )


def write_locked_brief(root: Path, source: str) -> Path:
    brief = root / "research-brief.md"
    review = root / "research-storyboard-review.md"
    brief.write_text(source, encoding="utf-8")
    review.write_text(settled_review(), encoding="utf-8")
    record = editorial_review_record(brief, review, "editorial-pass-001")
    brief.write_text(
        EDITORIAL_REVIEW_PATTERN.sub(
            f"<!-- build-html-slides-editorial-review:{__import__('json').dumps(record)} -->",
            source,
        ),
        encoding="utf-8",
    )
    return brief


class AuthoringStateTests(unittest.TestCase):
    def test_template_requires_material_content(self) -> None:
        self.assertTrue(validate_brief(TEMPLATE.read_text(encoding="utf-8")))
        self.assertFalse(validate_brief(settled_brief()))

    def test_visual_coverage_fallback_row_must_be_filled(self) -> None:
        source = settled_brief().replace(
            "| 1 | 실제 제품 확인 | 공식 제품 사진 | 없음 | 1600px 이상·선명함 | 사진 없이 제목 중심 구성 |",
            "|  |  |  |  |  | 사진·도형 없이 재구성 |",
            1,
        )
        self.assertIn(
            "research brief still contains the blank visual coverage and fallback row",
            validate_brief(source),
        )

    def test_editorial_review_lock_binds_one_review_and_revised_brief(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            brief = root / "research-brief.md"
            review = root / "research-storyboard-review.md"
            brief.write_text(settled_brief(), encoding="utf-8")
            review.write_text(settled_review(), encoding="utf-8")
            record = editorial_review_record(brief, review, "editorial-pass-001")
            brief.write_text(
                EDITORIAL_REVIEW_PATTERN.sub(
                    f"<!-- build-html-slides-editorial-review:{__import__('json').dumps(record)} -->",
                    brief.read_text(encoding="utf-8"),
                ),
                encoding="utf-8",
            )
            self.assertEqual(load_editorial_review(brief.read_text(encoding="utf-8")), record)
            self.assertFalse(validate_editorial_review(brief, review))
            self.assertEqual(record["review_passes"], 1)
            self.assertEqual(record["revision_passes"], 1)

    def test_editorial_review_lock_stales_after_research_or_story_change(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            brief = root / "research-brief.md"
            review = root / "research-storyboard-review.md"
            source = settled_brief()
            brief.write_text(source, encoding="utf-8")
            review.write_text(settled_review(), encoding="utf-8")
            record = editorial_review_record(brief, review, "editorial-pass-001")
            brief.write_text(
                EDITORIAL_REVIEW_PATTERN.sub(
                    f"<!-- build-html-slides-editorial-review:{__import__('json').dumps(record)} -->",
                    source,
                ),
                encoding="utf-8",
            )
            before = research_material_digest(brief.read_text(encoding="utf-8"))
            brief.write_text(
                brief.read_text(encoding="utf-8").replace("방향 제시", "수정된 방향", 1),
                encoding="utf-8",
            )
            self.assertNotEqual(before, research_material_digest(brief.read_text(encoding="utf-8")))
            self.assertIn(
                "research brief changed after its one-time editorial review",
                validate_editorial_review(brief, review),
            )

    def test_editorial_review_lock_refuses_a_second_review_cycle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            brief = root / "research-brief.md"
            review = root / "research-storyboard-review.md"
            brief.write_text(settled_brief(), encoding="utf-8")
            review.write_text(settled_review(), encoding="utf-8")
            command = [
                "python3",
                str(LOCKER),
                str(brief),
                str(review),
                "--reviewer-ref",
                "editorial-pass-001",
            ]
            first = subprocess.run(command, capture_output=True, text=True, check=False)
            second = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(second.returncode, 1)
            self.assertIn("already locked; do not rerun it", second.stdout)

    def test_korean_copy_requires_a_polish_method(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            notes = root / "deck-notes.md"
            deck.write_text(
                '<section class="slide" data-title="표지"><h1>안녕하세요</h1></section>',
                encoding="utf-8",
            )
            notes.write_text("발표자 노트", encoding="utf-8")
            with self.assertRaises(ValueError):
                freeze_record(deck, notes, "not-applicable")

    def test_css_and_navigation_changes_do_not_stale_copy_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            notes = root / "deck-notes.md"
            brief = root / "research-brief.md"
            html = (
                '<style>:root{--ink:#111}</style>'
                '<section class="slide" data-title="Title"><h1>Settled copy</h1></section>'
                '<nav class="slide-nav"><button>Next</button></nav>'
            )
            deck.write_text(html, encoding="utf-8")
            notes.write_text("Settled notes", encoding="utf-8")
            record = freeze_record(deck, notes, "not-applicable")
            source = FREEZE_PATTERN.sub(
                f"<!-- build-html-slides-copy-freeze:{__import__('json').dumps(record)} -->",
                settled_brief(),
            )
            brief = write_locked_brief(root, source)
            self.assertFalse(validate_state(deck, notes, brief))
            deck.write_text(
                html.replace("--ink:#111", "--ink:#222").replace(">Next<", ">Forward<"),
                encoding="utf-8",
            )
            self.assertFalse(validate_state(deck, notes, brief))

    def test_copy_or_notes_change_stales_freeze(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            deck = root / "deck.html"
            notes = root / "deck-notes.md"
            deck.write_text(
                '<section class="slide" data-title="Title"><h1>First</h1></section>',
                encoding="utf-8",
            )
            notes.write_text("First notes", encoding="utf-8")
            record = freeze_record(deck, notes, "not-applicable")
            source = (
                FREEZE_PATTERN.sub(
                    f"<!-- build-html-slides-copy-freeze:{__import__('json').dumps(record)} -->",
                    settled_brief(),
                )
            )
            brief = write_locked_brief(root, source)
            deck.write_text(
                '<section class="slide" data-title="Title"><h1>Second</h1></section>',
                encoding="utf-8",
            )
            errors = validate_state(deck, notes, brief)
            self.assertIn("visible slide copy changed after the research brief was frozen", errors)
            notes.write_text("Second notes", encoding="utf-8")
            errors = validate_state(deck, notes, brief)
            self.assertIn("presenter notes changed after the research brief was frozen", errors)


if __name__ == "__main__":
    unittest.main()
