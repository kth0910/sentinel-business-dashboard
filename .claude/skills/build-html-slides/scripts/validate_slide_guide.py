#!/usr/bin/env python3
"""Validate the detailed reader-facing companion for an HTML slide deck."""

from __future__ import annotations

import re
import sys
from pathlib import Path


MIN_SECTION_CHARACTERS = 220
MIN_SUBHEADINGS = 4
MIN_LIST_ITEMS = 2
SCRIPT_HEADING_PATTERN = re.compile(
    r"^#{2,4}\s+(?:발표(?:자)?\s*(?:대본|스크립트)|전체\s*낭독|presenter\s+script|"
    r"speaker\s+script|full\s+read[- ]?aloud|talk\s+track)\s*$",
    re.I | re.M,
)
KOREAN_PATTERN = re.compile(r"[\uac00-\ud7a3]")
HUMANIZE_SUMMARY_PATTERN = re.compile(r"<!--\s*HUMANIZE-SUMMARY\b.*?-->", re.S)
OMITTED_DETAIL_HEADING_PATTERN = re.compile(
    r"^###\s+(?:슬라이드(?:가|에서)?\s*(?:생략한|빠뜨린|밖)[^\n]*|"
    r"슬라이드\s*밖에서[^\n]*|omitted\s+details?|what\s+the\s+slide\s+"
    r"(?:omits|leaves\s+out)|beyond\s+the\s+slide)\s*$",
    re.I | re.M,
)


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    raise SystemExit(1)


if len(sys.argv) != 3:
    fail("usage: validate_slide_guide.py DECK.html DECK-guide.md")

deck_path, guide_path = map(Path, sys.argv[1:])
if not deck_path.is_file():
    fail(f"deck not found: {deck_path}")
if not guide_path.is_file():
    fail(f"detailed slide guide not found: {guide_path}")

deck = deck_path.read_text(encoding="utf-8")
guide = guide_path.read_text(encoding="utf-8")
guide_html_path = guide_path.with_suffix(".html")
guide_pdf_path = guide_path.with_suffix(".pdf")
titles = re.findall(
    r'<section\b[^>]*class=["\'][^"\']*\bslide\b[^"\']*["\'][^>]*data-title=["\']([^"\']+)',
    deck,
    re.I,
)
if not titles:
    fail("no slide titles found in deck")
if re.search(r"\{\{[^}]+\}\}", guide):
    fail("detailed slide guide still contains template placeholders")
if SCRIPT_HEADING_PATTERN.search(guide):
    fail("study guide must omit presenter and full read-aloud scripts")
if KOREAN_PATTERN.search(guide) and not HUMANIZE_SUMMARY_PATTERN.search(guide):
    fail("Korean study guide requires humanize-korean HUMANIZE-SUMMARY evidence")
if not guide_html_path.is_file():
    fail(f"readable guide HTML not found: {guide_html_path}")
if not guide_pdf_path.is_file() or not guide_pdf_path.read_bytes().startswith(b"%PDF"):
    fail(f"readable guide PDF not found or invalid: {guide_pdf_path}")

guide_html = guide_html_path.read_text(encoding="utf-8")
if "<img" not in guide_html.lower():
    fail("readable guide HTML has no slide captures")

section_matches = list(re.finditer(r"^##\s+(\d+)\.\s+(.+?)\s*$", guide, re.M))
if len(section_matches) != len(titles):
    fail(f"guide sections ({len(section_matches)}) do not match slides ({len(titles)})")

for index, (match, slide_title) in enumerate(zip(section_matches, titles), 1):
    number, guide_title = match.groups()
    if int(number) != index:
        fail(f"expected guide section {index}, found {number}")
    if guide_title.strip() != slide_title.strip():
        fail(f"slide {index} title mismatch: deck='{slide_title}', guide='{guide_title}'")
    body_start = match.end()
    body_end = section_matches[index].start() if index < len(section_matches) else len(guide)
    body = guide[body_start:body_end]
    capture = re.match(r"\s*!\[([^\]]*)\]\(([^)]+)\)", body)
    if capture is None:
        fail(f"slide {index} needs its capture immediately above the explanation")
    capture_path = (guide_path.parent / capture.group(2)).resolve()
    if not capture_path.is_file():
        fail(f"slide {index} capture not found: {capture_path}")
    plain_body = re.sub(r"[#>*_`~\-\s]", "", body)
    subheading_count = len(re.findall(r"^###\s+\S+", body, re.M))
    list_item_count = len(re.findall(r"^\s*(?:[-*]|\d+[.)])\s+\S+", body, re.M))
    if len(plain_body) < MIN_SECTION_CHARACTERS:
        fail(
            f"slide {index} needs a detailed subject explanation; "
            f"found {len(plain_body)} characters, need at least {MIN_SECTION_CHARACTERS}"
        )
    if subheading_count < MIN_SUBHEADINGS:
        fail(
            f"slide {index} needs at least {MIN_SUBHEADINGS} explanatory subsections; "
            f"found {subheading_count}"
        )
    if not OMITTED_DETAIL_HEADING_PATTERN.search(body):
        fail(
            f"slide {index} needs an explicit subsection for details omitted from the slide"
        )
    if list_item_count < MIN_LIST_ITEMS:
        fail(
            f"slide {index} needs at least {MIN_LIST_ITEMS} concrete component, step, "
            f"example, or caveat items; found {list_item_count}"
        )

print(f"OK: {guide_path} - {len(titles)} detailed slide-guide sections")
