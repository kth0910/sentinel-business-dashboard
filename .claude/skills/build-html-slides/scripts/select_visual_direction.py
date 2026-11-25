#!/usr/bin/env python3
"""Choose a stable visual direction from the registered theme vocabulary."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from copy import deepcopy
from pathlib import Path
from typing import Any

try:
    from .validate_design_contract import validate_semantic_colors
except ImportError:
    from validate_design_contract import validate_semantic_colors


REGISTRY_PATH = Path(__file__).with_name("theme_registry.json")
CONTRACT_KEYS = (
    "theme",
    "cover_family",
    "surface",
    "title_anchor",
    "hero_form",
    "type_direction",
    "palette_direction",
)
AXIS_FIELDS = {
    "jobs": "jobs",
    "evidence": "evidence",
    "density": "density",
    "emotion": "emotion",
    "surface": "surface_axis",
    "focal_anchor": "focal_anchors",
}
AXIS_WEIGHTS = {
    "jobs": 10,
    "evidence": 8,
    "density": 5,
    "emotion": 6,
    "surface": 6,
    "focal_anchor": 7,
}
GLOBAL_AVOID_SIGNATURES = (
    "dark-console-left-title-right-orbit",
    "top-model-badge-plus-neon-system-ring",
    "black-field-small-kicker-large-korean-title-right-box",
    "incident-dashboard-card-wall",
    "palette-splice-without-grammar",
)
RETIRED_THEME_NAMES = (
    "Margin Commentary",
    "Spatial Interface",
    "Systems Blueprint",
)


def normalize_text(value: str) -> str:
    """Normalize user text for exact token/phrase-boundary comparisons."""
    folded = unicodedata.normalize("NFKC", value).casefold().replace("_", " ")
    return " ".join(re.sub(r"[^\w]+", " ", folded, flags=re.UNICODE).split())


RETIRED_THEME_KEYS = {normalize_text(name) for name in RETIRED_THEME_NAMES}


def contains_phrase(text: str, phrase: str) -> bool:
    """Match a normalized phrase without matching inside a larger token."""
    normalized_text = normalize_text(text)
    normalized_phrase = normalize_text(phrase)
    if not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {normalized_text} "


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def contract_id(payload: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def load_registry(path: Path = REGISTRY_PATH) -> dict[str, Any]:
    try:
        registry = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"theme registry is unreadable: {exc}") from exc
    if not isinstance(registry, dict) or registry.get("schema_version") != 1:
        raise SystemExit("theme registry schema_version must be 1")
    themes = registry.get("themes")
    if not isinstance(themes, list) or not themes:
        raise SystemExit("theme registry themes must be a non-empty list")
    axis_values = registry.get("axis_values")
    if not isinstance(axis_values, dict):
        raise SystemExit("theme registry axis_values is missing")

    seen: set[str] = set()
    for index, theme in enumerate(themes):
        prefix = f"theme registry themes[{index}]"
        if not isinstance(theme, dict):
            raise SystemExit(f"{prefix} must be an object")
        for key in CONTRACT_KEYS:
            if not isinstance(theme.get(key), str) or not theme[key].strip():
                raise SystemExit(f"{prefix}.{key} must be a non-empty string")
        normalized_name = normalize_text(theme["theme"])
        if normalized_name in RETIRED_THEME_KEYS:
            raise SystemExit(f"theme registry contains retired theme: {theme['theme']}")
        if normalized_name in seen:
            raise SystemExit(f"theme registry has duplicate theme: {theme['theme']}")
        seen.add(normalized_name)
        for axis, field in AXIS_FIELDS.items():
            values = theme.get(field)
            allowed = axis_values.get(axis)
            if not isinstance(values, list) or not values:
                raise SystemExit(f"{prefix}.{field} must be a non-empty list")
            if not isinstance(allowed, list) or any(value not in allowed for value in values):
                raise SystemExit(f"{prefix}.{field} contains an unregistered axis value")
        cues = theme.get("subject_cues")
        if (
            not isinstance(cues, list)
            or not cues
            or len(cues) > 16
            or any(not isinstance(cue, str) or not normalize_text(cue) for cue in cues)
        ):
            raise SystemExit(f"{prefix}.subject_cues must contain 1 to 16 bounded phrases")
        colors = theme.get("semantic_colors")
        if not isinstance(colors, dict):
            raise SystemExit(f"{prefix}.semantic_colors is missing")
        if not isinstance(colors.get("tokens"), dict) or not isinstance(
            colors.get("contrast_pairs"), list
        ):
            raise SystemExit(f"{prefix}.semantic_colors is malformed")
        color_errors = validate_semantic_colors(colors, label=f"{prefix}.semantic_colors")
        if color_errors:
            raise SystemExit("; ".join(color_errors))
    return registry


def expand_semantic_colors(
    theme: dict[str, Any],
    derivations: dict[str, str],
) -> dict[str, Any]:
    """Materialize surface pairs so the contract never relies on one-sided overrides."""
    expanded = deepcopy(theme)
    colors = expanded["semantic_colors"]
    tokens = colors["tokens"]
    for role in ("panel", "on_panel", "inverse_canvas", "on_inverse"):
        source = derivations.get(role)
        if not isinstance(source, str) or source not in tokens:
            raise SystemExit(
                f"theme registry semantic_color_derivations.{role} "
                "must name an existing base token"
            )
        tokens[role] = tokens[source]
    required_pairs = (
        ("on_panel", "panel"),
        ("on_inverse", "inverse_canvas"),
    )
    existing = {
        (pair.get("foreground"), pair.get("background"))
        for pair in colors["contrast_pairs"]
        if isinstance(pair, dict)
    }
    for foreground, background in required_pairs:
        if (foreground, background) not in existing:
            colors["contrast_pairs"].append(
                {
                    "foreground": foreground,
                    "background": background,
                    "usage": "normal-text",
                }
            )
    return expanded


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--title", required=True)
    parser.add_argument("--audience", required=True)
    parser.add_argument("--job", required=True)
    parser.add_argument("--evidence")
    parser.add_argument("--density")
    parser.add_argument("--emotional-register", dest="emotion")
    parser.add_argument("--surface-family", dest="surface")
    parser.add_argument("--focal-anchor")
    parser.add_argument("--emotion", dest="emotion", help=argparse.SUPPRESS)
    parser.add_argument("--surface", dest="surface", help=argparse.SUPPRESS)
    parser.add_argument("--avoid-theme", action="append", default=[])
    parser.add_argument("--avoid-cover", action="append", default=[])
    parser.add_argument("--avoid-job", action="append", default=[])
    parser.add_argument("--avoid-evidence", action="append", default=[])
    parser.add_argument("--avoid-density", action="append", default=[])
    parser.add_argument(
        "--avoid-emotional-register",
        dest="avoid_emotion",
        action="append",
        default=[],
    )
    parser.add_argument(
        "--avoid-surface-family",
        dest="avoid_surface",
        action="append",
        default=[],
    )
    parser.add_argument("--avoid-focal-anchor", action="append", default=[])
    parser.add_argument(
        "--avoid-emotion",
        dest="avoid_emotion",
        action="append",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--avoid-surface",
        dest="avoid_surface",
        action="append",
        help=argparse.SUPPRESS,
    )
    parser.add_argument(
        "--select-theme",
        help="Lock any registered theme by exact name.",
    )
    parser.add_argument(
        "--selection-reason",
        help="Required whenever --select-theme is not the primary direction.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write a locked design-contract.json. Otherwise the result is preview-only.",
    )
    return parser.parse_args()


def resolve_axis(
    registry: dict[str, Any],
    axis: str,
    raw_value: str | None,
    *,
    strict: bool,
) -> list[str]:
    if not raw_value or not raw_value.strip():
        return []
    allowed = registry["axis_values"][axis]
    aliases = registry.get("axis_aliases", {}).get(axis, {})
    normalized = normalize_text(raw_value)
    exact = [value for value in allowed if normalize_text(value) == normalized]
    if exact:
        return exact
    matches: list[str] = []
    for value in allowed:
        phrases = [value, *aliases.get(value, [])]
        if any(contains_phrase(normalized, phrase) for phrase in phrases):
            matches.append(value)
    if not matches and strict:
        choices = ", ".join(allowed)
        raise SystemExit(
            f"unrecognized --{axis.replace('_', '-')} value {raw_value!r}; "
            f"use one of: {choices}"
        )
    return matches


def resolve_axis_avoids(
    registry: dict[str, Any],
    axis: str,
    raw_values: list[str] | None,
) -> list[str]:
    resolved: set[str] = set()
    for raw_value in raw_values or []:
        resolved.update(resolve_axis(registry, axis, raw_value, strict=True))
    return sorted(resolved)


def canonicalize_labels(raw_values: list[str], known: list[str]) -> list[str]:
    known_by_normalized = {normalize_text(value): value for value in known}
    normalized: set[str] = set()
    for raw_value in raw_values:
        value = normalize_text(raw_value)
        if value:
            normalized.add(known_by_normalized.get(value, value))
    return sorted(normalized, key=normalize_text)


def score_theme(
    theme: dict[str, Any],
    brief_text: str,
    requested_axes: dict[str, list[str]],
) -> tuple[int, list[str], list[str]]:
    score = 0
    signals: list[str] = []
    matched_cues = [
        cue for cue in theme["subject_cues"] if contains_phrase(brief_text, cue)
    ]
    matched_cues.sort(key=lambda cue: (-len(normalize_text(cue).split()), normalize_text(cue)))
    if matched_cues:
        strongest = len(normalize_text(matched_cues[0]).split())
        cue_score = 18 + min(strongest, 4) * 2 + min(len(matched_cues) - 1, 2) * 2
        score += cue_score
        signals.append(
            f"bounded subject cue: {', '.join(matched_cues[:3])} (+{cue_score})"
        )

    for axis, requested in requested_axes.items():
        if not requested:
            continue
        field = AXIS_FIELDS[axis]
        overlap = sorted(set(requested).intersection(theme[field]))
        if overlap:
            points = AXIS_WEIGHTS[axis] * len(overlap)
            score += points
            signals.append(f"{axis}: {', '.join(overlap)} (+{points})")
    return score, signals, matched_cues


def main() -> int:
    args = parse_args()
    if args.select_theme and normalize_text(args.select_theme) in RETIRED_THEME_KEYS:
        raise SystemExit(
            f"--select-theme is retired and must not be used: {args.select_theme}"
        )
    registry = load_registry()
    registry_hash = hashlib.sha256(
        canonical_json(registry).encode("utf-8")
    ).hexdigest()
    derivations = registry.get("semantic_color_derivations")
    if not isinstance(derivations, dict):
        raise SystemExit("theme registry semantic_color_derivations is missing")
    themes: list[dict[str, Any]] = [
        expand_semantic_colors(theme, derivations) for theme in registry["themes"]
    ]

    requested_axes = {
        "jobs": resolve_axis(registry, "jobs", args.job, strict=False),
        "evidence": resolve_axis(registry, "evidence", args.evidence, strict=True),
        "density": resolve_axis(registry, "density", args.density, strict=True),
        "emotion": resolve_axis(registry, "emotion", args.emotion, strict=True),
        "surface": resolve_axis(registry, "surface", args.surface, strict=True),
        "focal_anchor": resolve_axis(
            registry, "focal_anchor", args.focal_anchor, strict=True
        ),
    }
    avoid_axes = {
        "jobs": resolve_axis_avoids(registry, "jobs", args.avoid_job),
        "evidence": resolve_axis_avoids(registry, "evidence", args.avoid_evidence),
        "density": resolve_axis_avoids(registry, "density", args.avoid_density),
        "emotion": resolve_axis_avoids(registry, "emotion", args.avoid_emotion),
        "surface": resolve_axis_avoids(registry, "surface", args.avoid_surface),
        "focal_anchor": resolve_axis_avoids(
            registry, "focal_anchor", args.avoid_focal_anchor
        ),
    }
    avoid_themes = canonicalize_labels(
        args.avoid_theme, [theme["theme"] for theme in themes]
    )
    avoid_covers = canonicalize_labels(
        args.avoid_cover, [theme["cover_family"] for theme in themes]
    )
    avoid_theme_keys = {normalize_text(value) for value in avoid_themes}
    avoid_cover_keys = {normalize_text(value) for value in avoid_covers}

    eligible: list[dict[str, Any]] = []
    for theme in themes:
        if normalize_text(theme["theme"]) in avoid_theme_keys:
            continue
        if normalize_text(theme["cover_family"]) in avoid_cover_keys:
            continue
        if any(
            set(avoid_axes[axis]).intersection(theme[AXIS_FIELDS[axis]])
            for axis in AXIS_FIELDS
        ):
            continue
        eligible.append(theme)
    if not eligible:
        raise SystemExit("all visual directions were excluded")

    brief_text = " | ".join((args.title, args.audience, args.job))
    normalized_hash_input = {
        "title": normalize_text(args.title),
        "audience": normalize_text(args.audience),
        "job": normalize_text(args.job),
        "axes": requested_axes,
        "avoid": {
            "themes": sorted(normalize_text(value) for value in avoid_themes),
            "cover_families": sorted(normalize_text(value) for value in avoid_covers),
            **avoid_axes,
        },
    }
    tie_basis = hashlib.sha256(
        canonical_json(normalized_hash_input).encode("utf-8")
    ).hexdigest()

    ranking: list[dict[str, Any]] = []
    for theme in eligible:
        score, signals, matched_cues = score_theme(theme, brief_text, requested_axes)
        tie_breaker = hashlib.sha256(
            f"{tie_basis}|{normalize_text(theme['theme'])}".encode("utf-8")
        ).hexdigest()
        ranking.append(
            {
                "direction": theme,
                "score": score,
                "signals": signals,
                "matched_subject_cues": matched_cues,
                "tie_breaker": tie_breaker,
            }
        )
    ranking.sort(key=lambda item: (-item["score"], item["tie_breaker"]))
    candidates = [item["direction"] for item in ranking[:3]]
    primary = candidates[0]

    selected = primary
    selection_kind = "primary"
    selection_reason = "primary selector result"
    if args.select_theme:
        selected_matches = [
            theme
            for theme in themes
            if normalize_text(theme["theme"]) == normalize_text(args.select_theme)
        ]
        if not selected_matches:
            names = ", ".join(theme["theme"] for theme in themes)
            raise SystemExit(f"--select-theme is not registered; choose one of: {names}")
        selected = selected_matches[0]
        if selected["theme"] != primary["theme"]:
            selection_reason = (args.selection_reason or "").strip()
            if not selection_reason:
                raise SystemExit(
                    "--selection-reason is required when locking a non-primary theme"
                )
            candidate_names = [theme["theme"] for theme in candidates]
            if selected["theme"] in candidate_names[1:]:
                selection_kind = f"alternative-{candidate_names.index(selected['theme'])}"
            else:
                selection_kind = "registered-override"
        elif args.selection_reason:
            selection_reason = args.selection_reason.strip()

    primary_trace = ranking[0]
    routing_reason = (
        "; ".join(primary_trace["signals"])
        if primary_trace["signals"]
        else "no bounded semantic cue or axis preference matched; stable hash broke the tie"
    )
    required_html_attributes = {
        "data-theme": selected["theme"],
        "data-cover-family": selected["cover_family"],
        "data-surface": selected["surface"],
        "data-title-anchor": selected["title_anchor"],
        "data-hero-form": selected["hero_form"],
        "data-type-direction": selected["type_direction"],
        "data-palette-direction": selected["palette_direction"],
    }
    payload: dict[str, Any] = {
        "schema_version": 1,
        "status": "locked" if args.output else "preview",
        "registry": {
            "schema_version": registry["schema_version"],
            "registry_version": registry["registry_version"],
            "theme_count": len(themes),
            "sha256": registry_hash,
            "source": REGISTRY_PATH.name,
        },
        "brief": {
            "title": args.title.strip(),
            "audience": args.audience.strip(),
            "job": args.job.strip(),
        },
        "axes": requested_axes,
        "avoid": {
            "themes": avoid_themes,
            "cover_families": avoid_covers,
            "jobs": avoid_axes["jobs"],
            "evidence": avoid_axes["evidence"],
            "density": avoid_axes["density"],
            "emotion": avoid_axes["emotion"],
            "surface": avoid_axes["surface"],
            "focal_anchor": avoid_axes["focal_anchor"],
        },
        "primary": primary,
        "alternatives": candidates[1:],
        "selected": selected,
        "selection": {
            "kind": selection_kind,
            "reason": selection_reason,
        },
        "routing_reason": routing_reason,
        "selection_trace": {
            "scoring": "token-and-phrase-boundary semantic scoring",
            "hash_role": "tie-breaker-only",
            "eligible_theme_count": len(eligible),
            "normalized_axes": requested_axes,
            "ranking": [
                {
                    "theme": item["direction"]["theme"],
                    "score": item["score"],
                    "signals": item["signals"],
                    "matched_subject_cues": item["matched_subject_cues"],
                    "tie_breaker": item["tie_breaker"],
                }
                for item in ranking[:8]
            ],
        },
        "global_avoid_signatures": list(GLOBAL_AVOID_SIGNATURES),
        "required_html_attributes": required_html_attributes,
        "semantic_color_contract": selected["semantic_colors"],
        "composition_rules": {
            "declare_each_slide": "data-composition-family",
            "maximum_consecutive_same_family": 2,
            "generic_card_grid_limit_per_ten_slides": 2,
            "dashboard_evidence_attribute": 'data-dashboard-intent="evidence"',
        },
        "implementation_rule": (
            "Preserve the chosen theme, cover family, surface, title anchor, hero form, "
            "type direction, palette direction, and semantic foreground/background pairs "
            "as one indivisible visual contract. Do not splice another named direction's "
            "palette or component language, invent a post-selection alias such as Systems "
            "Blueprint, or override only one side of a contrast pair."
        ),
    }
    payload["contract_id"] = contract_id(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
