#!/usr/bin/env python3
"""Validate a deck against the locked visual-direction selection contract."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


REQUIRED_DIRECTION_KEYS = (
    "theme",
    "cover_family",
    "surface",
    "title_anchor",
    "hero_form",
    "type_direction",
    "palette_direction",
)
REQUIRED_ATTRIBUTE_MAP = {
    "data-theme": "theme",
    "data-cover-family": "cover_family",
    "data-surface": "surface",
    "data-title-anchor": "title_anchor",
    "data-hero-form": "hero_form",
    "data-type-direction": "type_direction",
    "data-palette-direction": "palette_direction",
}
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
CONTRAST_THRESHOLDS = {
    "normal-text": 4.5,
    "large-text": 3.0,
    "decorative": 3.0,
}


def digest(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def relative_luminance(color: str) -> float:
    channels = [int(color[index : index + 2], 16) / 255 for index in (1, 3, 5)]

    def linearize(channel: float) -> float:
        if channel <= 0.04045:
            return channel / 12.92
        return ((channel + 0.055) / 1.055) ** 2.4

    red, green, blue = (linearize(channel) for channel in channels)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast_ratio(foreground: str, background: str) -> float:
    lighter, darker = sorted(
        (relative_luminance(foreground), relative_luminance(background)),
        reverse=True,
    )
    return (lighter + 0.05) / (darker + 0.05)


class BodyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.attributes: dict[str, str] | None = None
        self.duplicate_attributes: set[str] = set()

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag != "body" or self.attributes is not None:
            return
        names = [name for name, _ in attrs]
        self.duplicate_attributes = {
            name for name, count in Counter(names).items() if count > 1
        }
        self.attributes = {name: value or "" for name, value in attrs}


def validate_semantic_colors(
    colors: Any,
    *,
    label: str = "design contract selected.semantic_colors",
) -> list[str]:
    errors: list[str] = []
    if not isinstance(colors, dict):
        return [f"{label} is missing"]
    tokens = colors.get("tokens")
    pairs = colors.get("contrast_pairs")
    if not isinstance(tokens, dict) or not tokens:
        errors.append(f"{label}.tokens must be a non-empty object")
        tokens = {}
    else:
        for name, value in tokens.items():
            if not isinstance(name, str) or not name.strip():
                errors.append(f"{label}.tokens contains an invalid token name")
            if not isinstance(value, str) or not HEX_COLOR.fullmatch(value):
                errors.append(
                    f"{label}.tokens.{name} must be a concrete #RRGGBB color"
                )
    if not isinstance(pairs, list) or not pairs:
        errors.append(f"{label}.contrast_pairs must be a non-empty list")
        return errors

    for index, pair in enumerate(pairs):
        pair_label = f"{label}.contrast_pairs[{index}]"
        if not isinstance(pair, dict):
            errors.append(f"{pair_label} must be an object")
            continue
        foreground_name = pair.get("foreground")
        background_name = pair.get("background")
        usage = pair.get("usage", "normal-text")
        if usage not in CONTRAST_THRESHOLDS:
            errors.append(
                f"{pair_label}.usage must be normal-text, large-text, or decorative"
            )
            continue
        if not isinstance(foreground_name, str) or foreground_name not in tokens:
            errors.append(f"{pair_label}.foreground must name a semantic color token")
            continue
        if not isinstance(background_name, str) or background_name not in tokens:
            errors.append(f"{pair_label}.background must name a semantic color token")
            continue
        foreground = tokens[foreground_name]
        background = tokens[background_name]
        if not (
            isinstance(foreground, str)
            and HEX_COLOR.fullmatch(foreground)
            and isinstance(background, str)
            and HEX_COLOR.fullmatch(background)
        ):
            continue
        ratio = contrast_ratio(foreground, background)
        threshold = CONTRAST_THRESHOLDS[usage]
        if ratio + 1e-9 < threshold:
            errors.append(
                f"{pair_label} contrast {ratio:.2f}:1 is below {threshold:.1f}:1 "
                f"for {usage} ({foreground_name} on {background_name})"
            )
    return errors


def load_contract(path: Path) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return None, [f"design contract is unreadable: {exc}"]
    if not isinstance(value, dict):
        return None, ["design contract root must be a JSON object"]
    if value.get("schema_version") != 1:
        errors.append("design contract schema_version must be 1")
    if value.get("status") != "locked":
        errors.append("design contract must be generated with --output and have status=locked")

    selected = value.get("selected")
    if not isinstance(selected, dict):
        errors.append("design contract selected direction is missing")
        selected = {}
    else:
        for key in REQUIRED_DIRECTION_KEYS:
            if not isinstance(selected.get(key), str) or not selected[key].strip():
                errors.append(f"design contract selected.{key} is missing")

    required = value.get("required_html_attributes")
    if not isinstance(required, dict):
        errors.append("design contract required_html_attributes is missing")
        required = {}
    else:
        if "data-design-contract-id" in required:
            errors.append(
                "design contract required_html_attributes must not override "
                "data-design-contract-id"
            )
        for attribute, selected_key in REQUIRED_ATTRIBUTE_MAP.items():
            expected = selected.get(selected_key)
            actual = required.get(attribute)
            if actual != expected:
                errors.append(
                    f"design contract internal mismatch: required_html_attributes."
                    f"{attribute} must equal selected.{selected_key} "
                    f"{expected!r}, found {actual!r}"
                )

    selected_colors = selected.get("semantic_colors")
    errors.extend(validate_semantic_colors(selected_colors))
    if value.get("semantic_color_contract") != selected_colors:
        errors.append(
            "design contract semantic_color_contract must equal "
            "selected.semantic_colors"
        )

    expected_id = value.get("contract_id")
    unhashed = dict(value)
    unhashed.pop("contract_id", None)
    if not isinstance(expected_id, str) or expected_id != digest(unhashed):
        errors.append("design contract hash is stale or was edited after selection")
    return value, errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument("contract", type=Path)
    args = parser.parse_args()
    deck = args.deck.resolve()
    contract_path = args.contract.resolve()
    for label, path in (("deck", deck), ("design contract", contract_path)):
        if not path.is_file():
            parser.error(f"{label} not found: {path}")

    contract, errors = load_contract(contract_path)
    if contract is None:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    html = deck.read_text(encoding="utf-8")
    body_parser = BodyParser()
    body_parser.feed(html)
    body_parser.close()
    attributes = body_parser.attributes
    if attributes is None:
        errors.append("deck has no body element")
    else:
        required = contract.get("required_html_attributes")
        if isinstance(required, dict):
            expected = {
                "data-design-contract-id": contract.get("contract_id", ""),
                **required,
            }
            for name in sorted(body_parser.duplicate_attributes.intersection(expected)):
                errors.append(f"body contains duplicate required attribute {name}")
            for name, value in expected.items():
                if attributes.get(name) != value:
                    errors.append(
                        f"body {name} must equal the locked contract value "
                        f"{value!r}, found {attributes.get(name)!r}"
                    )

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1
    print(
        "OK: deck matches locked design contract "
        f"{contract['contract_id']} ({contract['selected']['theme']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
