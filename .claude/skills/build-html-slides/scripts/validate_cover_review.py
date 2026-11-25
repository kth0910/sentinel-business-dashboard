#!/usr/bin/env python3
"""Verify slide-1 AI evidence without approving or finalizing the full deck."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

try:
    from validate_visual_review import (
        BASE_PROFILES,
        CHECKS_BY_CHANGE,
        CONTRACT,
        PROFILE_SPECS,
        RESPONSIVE_PROFILES,
        SlideParser,
        png_info,
        required_checks,
        valid_hash,
        valid_observation,
        validate_identity_review,
        validate_identity_targets,
        validate_local_file_metadata,
        validate_warning_reviews,
    )
except ModuleNotFoundError:
    from scripts.validate_visual_review import (
        BASE_PROFILES,
        CHECKS_BY_CHANGE,
        CONTRACT,
        PROFILE_SPECS,
        RESPONSIVE_PROFILES,
        SlideParser,
        png_info,
        required_checks,
        valid_hash,
        valid_observation,
        validate_identity_review,
        validate_identity_targets,
        validate_local_file_metadata,
        validate_warning_reviews,
    )


def fail(errors: list[str]) -> int:
    for error in errors:
        print(f"ERROR: {error}")
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()
    deck = args.deck.expanduser().resolve()
    manifest_path = args.manifest.expanduser().resolve()
    errors: list[str] = []
    if not deck.is_file():
        errors.append(f"deck not found: {deck}")
    if not manifest_path.is_file():
        errors.append(f"review manifest not found: {manifest_path}")
    if errors:
        return fail(errors)

    deck_bytes = deck.read_bytes()
    try:
        deck_text = deck_bytes.decode("utf-8")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        return fail([f"invalid deck or review manifest: {exc}"])
    if not isinstance(manifest, dict):
        return fail(["review manifest root must be an object"])

    slides = SlideParser()
    slides.feed(deck_text)
    if not slides.slides or not str(slides.slides[0].get("title", "")).strip():
        errors.append("deck needs a titled slide 1")
        cover_title = ""
    else:
        cover_title = str(slides.slides[0]["title"])
    if manifest.get("schema_version") != CONTRACT["schema_version"]:
        errors.append(
            f"schema_version must be {CONTRACT['schema_version']}; regenerate the cover evidence"
        )
    if manifest.get("mode") != "full":
        errors.append("cover-verify is available only for Full Validation evidence")
    if manifest.get("deck_sha256") != hashlib.sha256(deck_bytes).hexdigest():
        errors.append("cover evidence belongs to an older deck source")

    design = manifest.get("design_contract")
    session = manifest.get("validation_session")
    if not isinstance(design, dict) or not valid_hash(design.get("design_signature")):
        errors.append("rendered design contract is missing its design signature")
    if not isinstance(session, dict) or session.get("design_signature") != (
        design.get("design_signature") if isinstance(design, dict) else None
    ):
        errors.append("validation session does not bind the rendered design signature")
    if isinstance(design, dict):
        design_path = Path(str(design.get("path", ""))).expanduser().resolve()
        if not design_path.is_file():
            errors.append(f"locked design contract is missing: {design_path}")
        elif hashlib.sha256(design_path.read_bytes()).hexdigest() != design.get("sha256"):
            errors.append("locked design contract changed after the current cover render")

    responsive = manifest.get("responsive") is True
    profiles = RESPONSIVE_PROFILES if responsive else BASE_PROFILES
    if tuple((manifest.get("viewports") or {})) != profiles:
        errors.append("cover evidence does not retain the canonical ordered profiles")

    records = [
        record
        for record in manifest.get("slides", [])
        if isinstance(record, dict) and record.get("slide") == 1
    ]
    if len(records) != 1:
        return fail(errors + ["review manifest must contain exactly one slide-1 record"])
    record = records[0]
    if record.get("title") != cover_title:
        errors.append("cover title does not match the current slide 1")
    scope = record.get("review_scope")
    if scope not in CHECKS_BY_CHANGE or scope == "navigation":
        errors.append("cover review scope must include visual content")
        scope = "all"
    source_hash = record.get("source_sha256")
    if source_hash != (manifest.get("source_fingerprints", {}).get("slides", {}) or {}).get("1"):
        errors.append("cover source fingerprint does not match the rendered manifest")

    required_profiles = record.get("required_ai_profiles")
    if required_profiles != list(profiles) or record.get("inspected_profiles") != list(profiles):
        errors.append("AI cover review must inspect every canonical cover profile exactly once")
    if record.get("review_method") != "vision-batched-full-size":
        errors.append("cover review must use full-size vision evidence")
    reviewer = str(record.get("reviewer", "")).strip()
    reviewer_ref = str(record.get("reviewer_ref", "")).strip()
    if not reviewer or len(reviewer_ref) < 8 or reviewer_ref == reviewer:
        errors.append("cover review needs a readable reviewer and stable reviewer_ref")
    if not valid_observation(record.get("observation")):
        errors.append("cover review needs one concrete visual observation")
    expected_checks = required_checks(scope, bool(record.get("identity_required")), True)
    checks = record.get("checks")
    if not isinstance(checks, dict) or tuple(checks) != expected_checks:
        errors.append("cover checks do not match the exact current review scope")
    elif any(str(checks.get(name, "")).lower() != "pass" for name in expected_checks):
        errors.append("every cover check must pass")
    if str(record.get("status", "")).lower() != "pass":
        errors.append("cover review status must pass")
    identity_required = bool(record.get("identity_required"))
    identity_targets = validate_identity_targets(
        record,
        deck.parent.resolve(),
        1,
        identity_required,
        errors,
    )
    if identity_required and scope in {"all", "image"}:
        validate_identity_review(
            record.get("identity_review"),
            identity_targets,
            1,
            "cover review",
            errors,
        )

    automation_gate = manifest.get("automation_gate")
    if not isinstance(automation_gate, dict):
        errors.append("automation_gate must be an object")
        automation_gate = {}
    if automation_gate.get("status") != "pass" or automation_gate.get("failures") != []:
        errors.append("cover automation gate must pass before cover approval")
    warnings = automation_gate.get("warnings", [])
    if not isinstance(warnings, list):
        errors.append("automation warnings must be an array")
        warnings = []
    for warning in warnings:
        if not isinstance(warning, dict) or warning.get("slide") != 1:
            continue
        if warning.get("requires_ai_review") is not True:
            errors.append("every cover warning must require AI review")
        if warning.get("blocks_cover_approval") is not True:
            errors.append("every cover warning must block approval until resolved")
    validate_warning_reviews(record, warnings, 1, errors)

    captures = record.get("captures")
    if not isinstance(captures, dict):
        errors.append("cover captures must be an object")
        captures = {}
    elif tuple(captures) != profiles:
        errors.append("cover captures must retain exactly the canonical ordered profiles")
    evidence_root = manifest_path.parent.resolve()
    for profile in profiles:
        capture = captures.get(profile)
        if not isinstance(capture, dict):
            errors.append(f"cover is missing its {profile} capture")
            continue
        relative = capture.get("path")
        if not isinstance(relative, str):
            errors.append(f"cover {profile} capture path is missing")
            continue
        capture_path = (evidence_root / relative).resolve()
        if not capture_path.is_relative_to(evidence_root) or not capture_path.is_file():
            errors.append(f"cover {profile} capture is unavailable: {relative}")
            continue
        try:
            dimensions, color_count, luma_range, digest = png_info(capture_path)
        except (OSError, ValueError) as exc:
            errors.append(f"cover {profile} capture is invalid: {exc}")
            continue
        expected_dimensions = tuple(map(int, PROFILE_SPECS[profile]["screenshot"].split("x")))
        if dimensions != expected_dimensions:
            errors.append(f"cover {profile} capture dimensions do not match the profile")
        if color_count < 4 or luma_range < 8:
            errors.append(f"cover {profile} capture appears blank or near-solid")
        if capture.get("sha256") != digest:
            errors.append(f"cover {profile} capture hash mismatch")
        if capture.get("active_slide") != 1 or capture.get("active_title") != cover_title:
            errors.append(f"cover {profile} active-slide evidence is stale")
        if capture.get("source_sha256") != source_hash:
            errors.append(f"cover {profile} source fingerprint mismatch")
        if capture.get("motion_disabled") is not True:
            errors.append(f"cover {profile} capture did not disable validation-only motion")
        for field in (
            "viewport",
            "visual_viewport",
            "screenshot",
            "zoom",
            "scale_mode",
            "device_pixel_ratio",
        ):
            if capture.get(field) != PROFILE_SPECS[profile][field]:
                errors.append(f"cover {profile} capture {field} does not match the canonical profile")
        if scope in {"all", "text"}:
            for field, label in (
                ("text_geometry", "text-bound geometry"),
                ("container_density", "container density"),
            ):
                result = capture.get(field)
                if not isinstance(result, dict) or result.get("ok") is not True or result.get("issues"):
                    errors.append(f"cover {profile} {label} did not pass")
        if scope in {"all", "navigation"}:
            result = capture.get("control_geometry")
            if not isinstance(result, dict) or result.get("ok") is not True or result.get("issues"):
                errors.append(f"cover {profile} control geometry did not pass")
        if scope in {"all", "image"}:
            for field, label in (
                ("image_geometry", "image geometry"),
                ("layer_alignment", "layer alignment"),
            ):
                result = capture.get(field)
                if not isinstance(result, dict) or result.get("ok") is not True or result.get("issues"):
                    errors.append(f"cover {profile} {label} did not pass")

    review_batches = manifest.get("review_batches")
    if not isinstance(review_batches, list):
        errors.append("review_batches must be an array")
    else:
        cover_batches = [
            batch
            for batch in review_batches
            if isinstance(batch, dict) and 1 in (batch.get("slides") or [])
        ]
        if len(cover_batches) != 1:
            errors.append("cover must belong to exactly one AI review batch")
        else:
            batch = cover_batches[0]
            if record.get("review_batch_id") != batch.get("id"):
                errors.append("cover review_batch_id does not match its generated batch")
            if (batch.get("capture_profiles") or {}).get("1") != list(profiles):
                errors.append("cover review batch does not bind every canonical profile")

    source_fingerprints = manifest.get("source_fingerprints")
    if isinstance(source_fingerprints, dict):
        validate_local_file_metadata(source_fingerprints, errors)
    else:
        errors.append("source_fingerprints must be an object")
    if errors:
        return fail(errors)
    print(
        f"OK: slide 1 cover review passed across {len(profiles)} full-size profile(s); "
        "this does not approve or finalize the full deck"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
