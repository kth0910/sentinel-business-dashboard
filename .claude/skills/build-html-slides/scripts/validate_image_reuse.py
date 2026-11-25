#!/usr/bin/env python3
import base64
import hashlib
import math
import re
import sys
from collections import defaultdict
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote, urlsplit, urlunsplit

try:
    from PIL import Image
except ImportError:
    Image = None


def fail(message: str) -> None:
    print(f"ERROR: {message}")
    raise SystemExit(1)


if len(sys.argv) != 2:
    fail("usage: validate_image_reuse.py DECK.html")

deck_path = Path(sys.argv[1]).resolve()
if not deck_path.is_file():
    fail(f"deck not found: {deck_path}")

html = deck_path.read_text(encoding="utf-8")
slides = re.findall(r'<section\b[^>]*class=["\'][^"\']*\bslide\b[^"\']*["\'][^>]*>[\s\S]*?</section>', html, re.I)
if not slides:
    fail("no slides found")

URL_RE = re.compile(r'url\(\s*(?:"([^"]*)"|\'([^\']*)\'|([^\)"\']+))\s*\)', re.I)


def css_urls(text: str):
    for match in URL_RE.finditer(text):
        value = next(group for group in match.groups() if group is not None).strip()
        if not value or value.startswith("#") or value.lower().startswith("%23"):
            continue
        yield value


def perceptual_fingerprint(data: bytes):
    if Image is None:
        return None
    try:
        with Image.open(BytesIO(data)) as source:
            image = source.convert("RGB")
            if image.width < 16 or image.height < 16:
                return None
            resampling = getattr(Image, "Resampling", Image).LANCZOS
            sample = image.resize((17, 16), resampling)
            pixel_reader = getattr(sample, "get_flattened_data", sample.getdata)
            pixels = list(pixel_reader())
    except Exception:
        return None

    luminance = [
        (299 * red + 587 * green + 114 * blue) / 1000
        for red, green, blue in pixels
    ]
    mean_luma = sum(luminance) / len(luminance)
    variance = sum((value - mean_luma) ** 2 for value in luminance) / len(luminance)
    if math.sqrt(variance) < 12:
        return None

    difference_hash = 0
    bit = 0
    for row in range(16):
        offset = row * 17
        for column in range(16):
            if luminance[offset + column] > luminance[offset + column + 1]:
                difference_hash |= 1 << bit
            bit += 1

    histogram = []
    for channel in range(3):
        bins = [0] * 16
        for pixel in pixels:
            bins[min(15, pixel[channel] // 16)] += 1
        histogram.extend(value / len(pixels) for value in bins)
    mean_rgb = tuple(sum(pixel[channel] for pixel in pixels) / len(pixels) for channel in range(3))
    return difference_hash, tuple(histogram), mean_rgb, tuple(pixels)


def perceptually_similar(left, right) -> bool:
    left_hash, left_histogram, left_mean, left_pixels = left
    right_hash, right_histogram, right_mean, right_pixels = right
    hash_distance = (left_hash ^ right_hash).bit_count()
    histogram_distance = sum(abs(a - b) for a, b in zip(left_histogram, right_histogram))
    mean_distance = max(abs(a - b) for a, b in zip(left_mean, right_mean))
    pixel_distance = sum(
        abs(a - b)
        for left_pixel, right_pixel in zip(left_pixels, right_pixels)
        for a, b in zip(left_pixel, right_pixel)
    ) / (len(left_pixels) * 3)
    return (
        pixel_distance <= 8
        or (hash_distance <= 16 and histogram_distance <= 0.2 and mean_distance <= 12)
    )


def fingerprint(asset: str):
    asset = asset.strip()
    if asset.startswith("data:"):
        header, _, payload = asset.partition(",")
        if header.lower().startswith("data:image/svg+xml"):
            return None
        try:
            data = base64.b64decode(payload) if ";base64" in header.lower() else unquote(payload).encode("utf-8")
        except Exception:
            data = asset.encode("utf-8")
        return (
            "sha256:" + hashlib.sha256(data).hexdigest(),
            "embedded data image",
            perceptual_fingerprint(data),
        )

    parts = urlsplit(asset)
    if parts.scheme in {"http", "https"}:
        normalized = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query, ""))
        return "url:" + normalized, normalized, None

    clean = unquote(parts.path).replace("/", str(Path("/")))
    candidate = (deck_path.parent / clean).resolve()
    if candidate.is_file():
        data = candidate.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        return (
            "sha256:" + digest,
            str(candidate.relative_to(deck_path.parent) if candidate.is_relative_to(deck_path.parent) else candidate),
            perceptual_fingerprint(data),
        )
    normalized = str(Path(clean)).casefold()
    return "path:" + normalized, clean, None


uses = defaultdict(list)
labels = defaultdict(set)
perceptual = {}


def record(asset: str, slide_number: int, repeat_token: str, role: str, origin: str):
    result = fingerprint(asset)
    if result is None:
        return
    key, label, visual_fingerprint = result
    uses[key].append((slide_number, repeat_token.strip(), role.strip().lower(), origin))
    labels[key].add(label)
    if visual_fingerprint is not None:
        perceptual[key] = visual_fingerprint


for index, slide in enumerate(slides, 1):
    opening = slide.split(">", 1)[0] + ">"
    for tag in re.findall(r'<(?:img|source|image|video)\b[^>]+>', slide, re.I):
        repeat_match = re.search(r'\bdata-repeat-ok=["\']([^"\']+)["\']', tag, re.I)
        role_match = re.search(r'\bdata-image-role=["\']([^"\']+)["\']', tag, re.I)
        repeat_token = repeat_match.group(1) if repeat_match else ""
        role = role_match.group(1) if role_match else ""
        for attribute in ("src", "href", "poster"):
            match = re.search(rf'\b{attribute}=["\']([^"\']+)', tag, re.I)
            if match:
                record(match.group(1), index, repeat_token, role, f"<{attribute}> element")
        srcset = re.search(r'\bsrcset=["\']([^"\']+)', tag, re.I)
        if srcset:
            for candidate in srcset.group(1).split(","):
                asset = candidate.strip().split()[0]
                if asset:
                    record(asset, index, repeat_token, role, "srcset")

    for style_match in re.finditer(r'<[^>]+\bstyle=(["\'])(.*?)\1[^>]*>', slide, re.I | re.S):
        tag = style_match.group(0)
        for asset in css_urls(style_match.group(2)):
            record(asset, index, "", "background", "inline style")

# Raster slide imagery in global CSS is prohibited because ownership, layering, alt text,
# and cross-slide reuse cannot be determined reliably without a full browser CSS engine.
styles = "\n".join(re.findall(r'<style\b[^>]*>([\s\S]*?)</style>', html, re.I))
policy_errors = []
for asset in css_urls(styles):
    lowered = urlsplit(asset).path.lower()
    if asset.lower().startswith("data:image/svg+xml"):
        continue
    if asset.lower().startswith("data:image/") or re.search(r'\.(?:png|jpe?g|webp|avif|gif|bmp|tiff?)$', lowered):
        policy_errors.append(f"raster image must be an element inside .slide-media, not global CSS url(): {asset[:140]}")

errors = []


def approved_continuity(occurrences):
    unique_slides = sorted({slide for slide, _, _, _ in occurrences})
    tokens = {token for _, token, _, _ in occurrences if token}
    roles = [role for _, _, role, _ in occurrences]
    return (
        len(unique_slides) == 2
        and len(tokens) == 1
        and all(token for _, token, _, _ in occurrences)
        and "thumbnail" in roles
        and any(role in {"hero", "detail"} for role in roles)
        and not any(role == "background" for role in roles)
    )


for key, occurrences in uses.items():
    unique_slides = sorted({slide for slide, _, _, _ in occurrences})
    if len(unique_slides) > 1:
        origins = sorted({origin for _, _, _, origin in occurrences})
        roles = [role for _, _, role, _ in occurrences]
        if not approved_continuity(occurrences):
            label = " | ".join(sorted(labels[key]))
            errors.append(f"{label} reused on slides {', '.join(map(str, unique_slides))} with roles {roles} ({'; '.join(origins)})")

perceptual_keys = sorted(perceptual)
for index, left_key in enumerate(perceptual_keys):
    for right_key in perceptual_keys[index + 1:]:
        left_slides = {slide for slide, _, _, _ in uses[left_key]}
        right_slides = {slide for slide, _, _, _ in uses[right_key]}
        if not left_slides or not right_slides or left_slides == right_slides:
            continue
        if not perceptually_similar(perceptual[left_key], perceptual[right_key]):
            continue
        combined = uses[left_key] + uses[right_key]
        if approved_continuity(combined):
            continue
        left_label = " | ".join(sorted(labels[left_key]))
        right_label = " | ".join(sorted(labels[right_key]))
        slides = sorted(left_slides | right_slides)
        errors.append(
            f"visually near-duplicate images {left_label} and {right_label} appear on slides "
            f"{', '.join(map(str, slides))}; crop, resize, recompression, recolor, or re-encoding does not create a new asset"
        )

if errors or policy_errors:
    for error in policy_errors + errors:
        print(f"ERROR: {error}")
    print("NOTE: script-created/computed imagery and visually similar re-encodes still require the all-slide visual review.")
    raise SystemExit(1)

detail = "exact and perceptual" if Image is not None else "exact; install optional Pillow for perceptual"
print(f"OK: {deck_path} - no unapproved cross-slide image reuse ({detail} checks)")
