#!/usr/bin/env python3
"""Tests for exact and perceptual cross-slide image reuse detection."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None


ROOT = Path(__file__).resolve().parent.parent
VALIDATOR = ROOT / "scripts" / "validate_image_reuse.py"


def deck(slides: list[str]) -> str:
    return "<!doctype html><html><body>" + "".join(
        f'<section class="slide"><div class="slide-media">{content}</div></section>'
        for content in slides
    ) + "</body></html>"


class ValidateImageReuseTests(unittest.TestCase):
    def validate(self, html: str, root: Path) -> subprocess.CompletedProcess[str]:
        deck_path = root / "deck.html"
        deck_path.write_text(html, encoding="utf-8")
        return subprocess.run(
            [sys.executable, str(VALIDATOR), str(deck_path)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_exact_cross_slide_reuse_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "same.webp").write_bytes(b"same-raster")
            result = self.validate(deck([
                '<img src="same.webp" data-image-role="hero">',
                '<img src="same.webp" data-image-role="hero">',
            ]), root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("reused on slides 1, 2", result.stdout)

    def test_explicit_subordinate_continuity_pair_passes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "same.webp").write_bytes(b"same-raster")
            result = self.validate(deck([
                '<img src="same.webp" data-image-role="hero" data-repeat-ok="subject-a">',
                '<img src="same.webp" data-image-role="thumbnail" data-repeat-ok="subject-a">',
            ]), root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    @unittest.skipUnless(Image is not None, "optional Pillow is needed for perceptual reuse checks")
    def test_reencoded_same_visual_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = Image.new("RGB", (320, 180))
            pixels = image.load()
            for y in range(image.height):
                for x in range(image.width):
                    pixels[x, y] = (
                        (x * 3 + y) % 256,
                        (x + y * 5) % 256,
                        (x * 2 + y * 2) % 256,
                    )
            image.save(root / "original.png", format="PNG")
            image.save(root / "reencoded.jpg", format="JPEG", quality=88)
            result = self.validate(deck([
                '<img src="original.png" data-image-role="hero">',
                '<img src="reencoded.jpg" data-image-role="hero">',
            ]), root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("visually near-duplicate images", result.stdout)

    @unittest.skipUnless(Image is not None, "optional Pillow is needed for perceptual reuse checks")
    def test_distinct_photos_pass_perceptual_check(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = Image.new("RGB", (320, 180))
            second = Image.new("RGB", (320, 180))
            first_pixels = first.load()
            second_pixels = second.load()
            for y in range(first.height):
                for x in range(first.width):
                    first_pixels[x, y] = ((x * 3 + y) % 256, (x + y * 5) % 256, (x * 2 + y * 2) % 256)
                    second_pixels[x, y] = ((x * 7) % 256, (255 - y * 3) % 256, ((x // 8) * 29) % 256)
            first.save(root / "first.png", format="PNG")
            second.save(root / "second.png", format="PNG")
            result = self.validate(deck([
                '<img src="first.png" data-image-role="hero">',
                '<img src="second.png" data-image-role="hero">',
            ]), root)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
