#!/usr/bin/env python3
"""Lock one AI editorial review and one consolidated research/storyboard revision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

try:
    from validate_authoring_state import (
        EDITORIAL_REVIEW_PATTERN,
        editorial_review_record,
        load_editorial_review,
        validate_brief,
        validate_editorial_review_document,
    )
except ModuleNotFoundError:
    from scripts.validate_authoring_state import (
        EDITORIAL_REVIEW_PATTERN,
        editorial_review_record,
        load_editorial_review,
        validate_brief,
        validate_editorial_review_document,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("brief", type=Path)
    parser.add_argument("review", type=Path)
    parser.add_argument("--reviewer-ref", required=True)
    args = parser.parse_args()
    brief = args.brief.resolve()
    review = args.review.resolve()
    for label, path in (("research brief", brief), ("editorial review", review)):
        if not path.is_file():
            parser.error(f"{label} not found: {path}")

    source = brief.read_text(encoding="utf-8")
    existing = load_editorial_review(source)
    if existing and existing.get("status") == "reviewed-once":
        print("ERROR: research and storyboard editorial review is already locked; do not rerun it")
        return 1

    errors = validate_brief(source)
    errors.extend(validate_editorial_review_document(review.read_text(encoding="utf-8")))
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    try:
        record = editorial_review_record(brief, review, args.reviewer_ref)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1
    comment = (
        "<!-- build-html-slides-editorial-review:"
        f"{json.dumps(record, separators=(',', ':'))} -->"
    )
    updated = EDITORIAL_REVIEW_PATTERN.sub(comment, source, count=1)
    if updated == source:
        updated = f"{source.rstrip()}\n\n{comment}\n"
    brief.write_text(updated, encoding="utf-8")
    print(f"OK: locked one editorial review and one consolidated revision in {brief}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
