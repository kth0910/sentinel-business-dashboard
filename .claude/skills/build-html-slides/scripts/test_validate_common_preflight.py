#!/usr/bin/env python3
"""Unit tests for common-system fingerprints and probe selection."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.validate_common_preflight import common_fingerprint, probe_records


def deck_html(
    shared: str = "#111",
    dense: str = "긴 한글 본문",
    local: str = "#333",
) -> str:
    return (
        "<!doctype html><html><head>"
        f"<style>:root{{--ink:{shared}}}"
        f'[data-title="본문"]{{--local-accent:{local}}}</style>'
        "</head><body>"
        '<section class="slide" data-title="표지" data-common-preflight="cover"><h1>표지</h1></section>'
        f'<section class="slide" data-title="본문" data-common-preflight="dense"><p>{dense}</p></section>'
        '<section class="slide" data-title="마무리" data-common-preflight="closing"><p>끝</p></section>'
        "<script>window.deckReady=true</script>"
        "</body></html>"
    )


class CommonPreflightTests(unittest.TestCase):
    def test_requires_cover_dense_and_at_most_one_closing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(deck_html(), encoding="utf-8")
            self.assertEqual(
                [record["role"] for record in probe_records(deck)],
                ["cover", "dense", "closing"],
            )
            deck.write_text(
                deck_html().replace(' data-common-preflight="dense"', ""),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                probe_records(deck)

    def test_shared_style_or_runtime_changes_invalidate_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(deck_html(), encoding="utf-8")
            first = common_fingerprint(deck)
            deck.write_text(deck_html(shared="#222"), encoding="utf-8")
            self.assertNotEqual(first, common_fingerprint(deck))

    def test_slide_copy_does_not_change_common_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(deck_html(dense="첫 문구"), encoding="utf-8")
            first = common_fingerprint(deck)
            deck.write_text(deck_html(dense="둘째 문구"), encoding="utf-8")
            self.assertEqual(first, common_fingerprint(deck))
            self.assertNotEqual(
                probe_records(deck)[1]["source_sha256"],
                probe_records_from_text(deck_html(dense="첫 문구"), deck)[1]["source_sha256"],
            )

    def test_slide_local_css_does_not_change_common_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            deck = Path(temporary) / "deck.html"
            deck.write_text(deck_html(local="#333"), encoding="utf-8")
            first = common_fingerprint(deck)
            deck.write_text(deck_html(local="#777"), encoding="utf-8")
            self.assertEqual(first, common_fingerprint(deck))


def probe_records_from_text(source: str, deck: Path) -> list[dict]:
    deck.write_text(source, encoding="utf-8")
    return probe_records(deck)


if __name__ == "__main__":
    unittest.main()
