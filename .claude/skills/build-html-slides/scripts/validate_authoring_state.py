#!/usr/bin/env python3
"""Validate or describe the durable research brief and copy-freeze state."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path


FREEZE_PATTERN = re.compile(
    r"<!--\s*build-html-slides-copy-freeze:(\{[\s\S]*?\})\s*-->"
)
EDITORIAL_REVIEW_PATTERN = re.compile(
    r"<!--\s*build-html-slides-editorial-review:(\{[\s\S]*?\})\s*-->"
)
REQUIRED_SECTIONS = (
    "Objective and audience",
    "User constraints and settled decisions",
    "Research depth decision",
    "Decision question tree",
    "Terminology and proper nouns",
    "Evidence and reasoning ledger",
    "Story and slide-role plan",
    "Locked visual direction",
    "Visual and asset decisions",
    "Open questions",
    "One-time editorial review",
    "Copy-freeze notes",
)
REVIEW_REQUIRED_SECTIONS = (
    "Review identity",
    "Editorial verdicts",
    "Consolidated findings",
    "Single-revision disposition",
)
POLISH_METHODS = {"humanize-korean", "manual-korean", "not-applicable"}
IGNORED_CLASSES = {"slide-nav", "deck-nav", "nav-panel", "slide-controls"}


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value)).strip()


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def research_material_digest(source: str) -> str:
    material = EDITORIAL_REVIEW_PATTERN.sub("", source)
    material = FREEZE_PATTERN.sub("", material)
    return digest(normalized(material))


class SlideCopyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, bool]] = []
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = {name: value or "" for name, value in attrs}
        classes = set(values.get("class", "").split())
        parent_in_slide = self.stack[-1][1] if self.stack else False
        parent_ignored = self.stack[-1][2] if self.stack else False
        is_slide = tag == "section" and "slide" in classes
        in_slide = parent_in_slide or is_slide
        ignored = parent_ignored or tag in {"script", "style", "template", "nav"} or bool(
            classes & IGNORED_CLASSES
        )
        self.stack.append((tag, in_slide, ignored))
        if is_slide:
            self.parts.append(f"\nSLIDE:{normalized(values.get('data-title', ''))}\n")

    def handle_startendtag(self, tag: str, attrs) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        if self.stack and self.stack[-1][1] and not self.stack[-1][2]:
            value = normalized(data)
            if value:
                self.parts.append(value)


def visible_copy(deck: Path) -> str:
    parser = SlideCopyParser()
    parser.feed(deck.read_text(encoding="utf-8"))
    parser.close()
    return normalized("\n".join(parser.parts))


def notes_copy(notes: Path) -> str:
    return normalized(notes.read_text(encoding="utf-8"))


def contains_korean(value: str) -> bool:
    return re.search(r"[\u3131-\u318E\uAC00-\uD7A3]", value) is not None


def section_body(source: str, heading: str) -> str:
    match = re.search(
        rf"^##\s+{re.escape(heading)}\s*$([\s\S]*?)(?=^##\s+|\Z)",
        source,
        flags=re.M,
    )
    if not match:
        return ""
    body = re.sub(r"<!--[\s\S]*?-->", "", match.group(1))
    body = re.sub(r"^\s*[|:\-\s]*$", "", body, flags=re.M)
    return normalized(body)


def validate_brief(source: str) -> list[str]:
    errors = []
    for heading in REQUIRED_SECTIONS:
        if not section_body(source, heading):
            errors.append(f"research brief section is missing or empty: {heading}")
    if re.search(r"\b(?:TODO|TBD|PLACEHOLDER)\b", source, re.I):
        errors.append("research brief still contains TODO/TBD/PLACEHOLDER text")
    if re.search(r"^-\s+[^:\n]+:\s*$", source, re.M) or re.search(
        r"^\|\s*(?:\|\s*){2,}$", source, re.M
    ):
        errors.append("research brief still contains blank required fields or table rows")
    if "|  |  |  |  |  | 사진·도형 없이 재구성 |" in source:
        errors.append("research brief still contains the blank visual coverage and fallback row")
    return errors


def validate_editorial_review_document(source: str) -> list[str]:
    errors = []
    for heading in REVIEW_REQUIRED_SECTIONS:
        if not section_body(source, heading):
            errors.append(f"editorial review section is missing or empty: {heading}")
    if re.search(r"\b(?:TODO|TBD|PLACEHOLDER)\b", source, re.I):
        errors.append("editorial review still contains TODO/TBD/PLACEHOLDER text")
    if re.search(r"^-\s+[^:\n]+:\s*$", source, re.M) or re.search(
        r"^\|\s*(?:\|\s*){2,}$", source, re.M
    ):
        errors.append("editorial review still contains blank required fields or table rows")
    return errors


def editorial_review_record(brief: Path, review: Path, reviewer_ref: str) -> dict:
    reviewer = reviewer_ref.strip()
    if not reviewer:
        raise ValueError("editorial reviewer reference must not be blank")
    return {
        "schema_version": 1,
        "status": "reviewed-once",
        "review_passes": 1,
        "revision_passes": 1,
        "reviewer_ref": reviewer,
        "reviewed_at_utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "research_brief_sha256": research_material_digest(brief.read_text(encoding="utf-8")),
        "review_sha256": digest(normalized(review.read_text(encoding="utf-8"))),
    }


def load_editorial_review(source: str) -> dict | None:
    match = EDITORIAL_REVIEW_PATTERN.search(source)
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def validate_editorial_review(brief: Path, review: Path | None = None) -> list[str]:
    review_path = review or brief.with_name("research-storyboard-review.md")
    if not review_path.is_file():
        return [f"one-time research and storyboard editorial review is missing: {review_path}"]
    review_source = review_path.read_text(encoding="utf-8")
    errors = validate_editorial_review_document(review_source)
    brief_source = brief.read_text(encoding="utf-8")
    record = load_editorial_review(brief_source)
    if (
        not record
        or record.get("schema_version") != 1
        or record.get("status") != "reviewed-once"
    ):
        errors.append("one-time research and storyboard editorial review lock is missing")
        return errors
    if record.get("review_passes") != 1 or record.get("revision_passes") != 1:
        errors.append("research and storyboard editorial review must have exactly one review and one revision")
    if record.get("research_brief_sha256") != research_material_digest(brief_source):
        errors.append("research brief changed after its one-time editorial review")
    if record.get("review_sha256") != digest(normalized(review_source)):
        errors.append("editorial review artifact changed after the research brief was locked")
    return errors


def freeze_record(deck: Path, notes: Path, polish: str) -> dict:
    copy = visible_copy(deck)
    notes_value = notes_copy(notes)
    if contains_korean(f"{copy}\n{notes_value}") and polish == "not-applicable":
        raise ValueError("Korean copy requires humanize-korean or manual-korean polish")
    return {
        "schema_version": 1,
        "status": "frozen",
        "polish": polish,
        "deck_copy_sha256": digest(copy),
        "notes_sha256": digest(notes_value),
    }


def load_freeze(source: str) -> dict | None:
    match = FREEZE_PATTERN.search(source)
    if not match:
        return None
    try:
        value = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def validate_state(deck: Path, notes: Path, brief: Path) -> list[str]:
    source = brief.read_text(encoding="utf-8")
    errors = validate_brief(source)
    errors.extend(validate_editorial_review(brief))
    record = load_freeze(source)
    if not record or record.get("schema_version") != 1 or record.get("status") != "frozen":
        errors.append("research brief copy-freeze record is missing or pending")
        return errors
    polish = record.get("polish")
    if polish not in POLISH_METHODS:
        errors.append("copy-freeze polish must be humanize-korean, manual-korean, or not-applicable")
    current = freeze_record(deck, notes, polish if polish in POLISH_METHODS else "not-applicable")
    if record.get("deck_copy_sha256") != current["deck_copy_sha256"]:
        errors.append("visible slide copy changed after the research brief was frozen")
    if record.get("notes_sha256") != current["notes_sha256"]:
        errors.append("presenter notes changed after the research brief was frozen")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument("notes", type=Path)
    parser.add_argument("brief", type=Path)
    parser.add_argument("--freeze", action="store_true")
    parser.add_argument("--polish", choices=sorted(POLISH_METHODS))
    args = parser.parse_args()
    deck = args.deck.resolve()
    notes = args.notes.resolve()
    brief = args.brief.resolve()
    for label, path in (("deck", deck), ("notes", notes), ("research brief", brief)):
        if not path.is_file():
            parser.error(f"{label} not found: {path}")

    source = brief.read_text(encoding="utf-8")
    errors = validate_brief(source)
    if args.freeze:
        if args.polish is None:
            parser.error("--polish is required with --freeze")
        errors.extend(validate_editorial_review(brief))
        if errors:
            for error in errors:
                print(f"ERROR: {error}")
            return 1
        try:
            record = freeze_record(deck, notes, args.polish)
        except ValueError as exc:
            print(f"ERROR: {exc}")
            return 1
        comment = f"<!-- build-html-slides-copy-freeze:{json.dumps(record, separators=(',', ':'))} -->"
        updated = FREEZE_PATTERN.sub(comment, source, count=1)
        if updated == source:
            updated = f"{source.rstrip()}\n\n{comment}\n"
        brief.write_text(updated, encoding="utf-8")
        print(f"OK: froze visible slide copy and presenter notes in {brief}")
        return 0

    try:
        errors = validate_state(deck, notes, brief)
    except ValueError as exc:
        errors.append(str(exc))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(f"OK: research brief and copy freeze are current: {brief}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
