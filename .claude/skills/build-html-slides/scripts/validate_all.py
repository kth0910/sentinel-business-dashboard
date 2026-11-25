#!/usr/bin/env python3
"""Run the complete deterministic, render, and evidence-validation workflow."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    from source_cache import local_assets
    from validate_authoring_state import load_editorial_review
    from workflow_timer import REPORT_NAME, record_event
except ModuleNotFoundError:  # Allows unittest imports from the skill root.
    from scripts.source_cache import local_assets
    from scripts.validate_authoring_state import load_editorial_review
    from scripts.workflow_timer import REPORT_NAME, record_event


SCRIPTS = Path(__file__).resolve().parent
CONTRACT = json.loads((SCRIPTS / "validation_contract.json").read_text(encoding="utf-8"))
IMPACT_SCOPES = set(CONTRACT["impact_scopes"])
CONTENT_CHANGE_CATEGORIES = set(CONTRACT["content_change_categories"])
COMMAND_TIMEOUT_SECONDS = int(os.environ.get("BUILD_HTML_SLIDES_COMMAND_TIMEOUT", "900"))
WORKFLOW_LIMITS = CONTRACT["workflow_limits"]
HIGH_RISK_REASONS = set(WORKFLOW_LIMITS["high_risk_reasons"])
VALIDATION_RESTART_REASONS = set(WORKFLOW_LIMITS["validation_restart_reasons"])
PARALLEL_CHECK_LIMITS = WORKFLOW_LIMITS["parallel_deterministic_checks"]


def persist_timing(path: Path, stage: str, **event: object) -> dict | None:
    try:
        return record_event(path, stage, **event)
    except (OSError, RuntimeError) as timing_error:
        print(
            f"WARNING: could not persist timing for {event.get('step', stage)}: {timing_error}",
            file=sys.stderr,
        )
        return None


def default_notes(deck: Path) -> Path:
    candidates = (
        deck.with_name(f"{deck.stem}-notes.md"),
        deck.with_name(f"{deck.stem}_notes.md"),
        deck.with_name("speaker-notes.md"),
    )
    return next((path for path in candidates if path.is_file()), candidates[0])


def default_guide(deck: Path) -> Path:
    candidates = (
        deck.with_name(f"{deck.stem}-guide.md"),
        deck.with_name(f"{deck.stem}_guide.md"),
        deck.with_name("slide-guide.md"),
    )
    return next((path for path in candidates if path.is_file()), candidates[0])


def run(
    label: str,
    command: list[str],
    *,
    deadline: float | None = None,
    timing_path: Path | None = None,
    timing_stage: str = "validation",
    debug_timing: bool = False,
) -> None:
    started = time.monotonic()
    started_at_epoch = time.time()
    status = "fail"
    detail: str | None = None
    print(f"RUN: {label}")
    timeout = COMMAND_TIMEOUT_SECONDS
    if deadline is not None:
        remaining = deadline - time.time()
        if remaining <= 0:
            raise RuntimeError("Full Validation exceeded its 60-minute hard time budget")
        timeout = max(1, min(timeout, int(remaining)))
    try:
        result = subprocess.run(
            command,
            text=True,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        status = "timeout"
        detail = f"timeout={timeout}s"
        if deadline is not None and time.time() >= deadline:
            error = RuntimeError("Full Validation exceeded its 60-minute hard time budget")
        else:
            error = RuntimeError(f"{label} exceeded the {timeout}s command timeout")
        raise error from exc
    else:
        elapsed = time.monotonic() - started
        if result.returncode:
            detail = f"exit_code={result.returncode}"
            raise RuntimeError(f"{label} failed after {elapsed:.1f}s")
        status = "pass"
        print(f"PASS: {label} ({elapsed:.1f}s)")
    finally:
        if timing_path is not None:
            finished_at_epoch = time.time()
            event = persist_timing(
                timing_path,
                timing_stage,
                step=label,
                started_at_epoch=started_at_epoch,
                finished_at_epoch=finished_at_epoch,
                status=status,
                source="validate_all",
                detail=detail,
            )
            if debug_timing and event is not None:
                print(
                    f"TIMING: {timing_stage} / {label} = "
                    f"{event['duration_ms'] / 1000:.3f}s ({status})"
                )


def repair_lane(label: str) -> str:
    if label == "research brief and copy freeze":
        return "copy-state"
    if label == "presenter notes":
        return "notes"
    if label == "reader study guide":
        return "guide"
    if label in {"source locality", "hash-bound source cache", "image reuse"}:
        return "media-provenance"
    if label in {"interaction semantics", "browser interaction and print E2E"}:
        return "runtime"
    return "deck-source"


def parallel_worker_count(command_count: int) -> int:
    configured = int(
        os.environ.get(
            "BUILD_HTML_SLIDES_VALIDATION_WORKERS",
            str(PARALLEL_CHECK_LIMITS["default_workers"]),
        )
    )
    if configured <= 0:
        raise RuntimeError("parallel validation worker count must be positive")
    return min(command_count, configured, int(PARALLEL_CHECK_LIMITS["max_workers"]))


def execute_captured(
    label: str,
    command: list[str],
    *,
    deadline: float | None,
) -> dict[str, object]:
    started = time.monotonic()
    started_at_epoch = time.time()
    timeout = COMMAND_TIMEOUT_SECONDS
    if deadline is not None:
        remaining = deadline - time.time()
        if remaining <= 0:
            return {
                "label": label,
                "command": command,
                "status": "timeout",
                "returncode": None,
                "stdout": "",
                "stderr": "",
                "detail": "Full Validation exceeded its 60-minute hard time budget",
                "started_at_epoch": started_at_epoch,
                "finished_at_epoch": time.time(),
                "elapsed": time.monotonic() - started,
            }
        timeout = max(1, min(timeout, int(remaining)))
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except OSError as exc:
        return {
            "label": label,
            "command": command,
            "status": "fail",
            "returncode": None,
            "stdout": "",
            "stderr": "",
            "detail": f"{type(exc).__name__}: {exc}",
            "started_at_epoch": started_at_epoch,
            "finished_at_epoch": time.time(),
            "elapsed": time.monotonic() - started,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout.decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
        stderr = exc.stderr.decode() if isinstance(exc.stderr, bytes) else (exc.stderr or "")
        detail = (
            "Full Validation exceeded its 60-minute hard time budget"
            if deadline is not None and time.time() >= deadline
            else f"timeout={timeout}s"
        )
        return {
            "label": label,
            "command": command,
            "status": "timeout",
            "returncode": None,
            "stdout": stdout,
            "stderr": stderr,
            "detail": detail,
            "started_at_epoch": started_at_epoch,
            "finished_at_epoch": time.time(),
            "elapsed": time.monotonic() - started,
        }
    return {
        "label": label,
        "command": command,
        "status": "pass" if result.returncode == 0 else "fail",
        "returncode": result.returncode,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "detail": None if result.returncode == 0 else f"exit_code={result.returncode}",
        "started_at_epoch": started_at_epoch,
        "finished_at_epoch": time.time(),
        "elapsed": time.monotonic() - started,
    }


def write_failure_report(
    path: Path,
    *,
    phase: str,
    workers: int,
    failures: list[dict[str, object]],
) -> None:
    lanes: dict[str, int] = {}
    records = []
    for failure in failures:
        lane = repair_lane(str(failure["label"]))
        lanes[lane] = lanes.get(lane, 0) + 1
        records.append(
            {
                "label": failure["label"],
                "repair_lane": lane,
                "status": failure["status"],
                "returncode": failure["returncode"],
                "command": failure["command"],
                "stdout": failure["stdout"],
                "stderr": failure["stderr"],
                "detail": failure["detail"],
                "duration_ms": round(float(failure["elapsed"]) * 1000),
            }
        )
    write_json(
        path,
        {
            "schema_version": 1,
            "phase": phase,
            "generated_at_epoch": time.time(),
            "parallel_workers": workers,
            "failure_count": len(records),
            "repair_lanes": lanes,
            "failures": records,
        },
    )


def run_parallel_group(
    commands: list[tuple[str, list[str]]],
    *,
    deadline: float | None,
    timing_path: Path,
    timing_stage: str,
    failure_report: Path,
    debug_timing: bool = False,
) -> None:
    if not commands:
        failure_report.unlink(missing_ok=True)
        return
    workers = parallel_worker_count(len(commands))
    print(f"RUN: {len(commands)} deterministic checks with {workers} parallel workers")
    for label, _command in commands:
        print(f"RUN: {label} [parallel]")
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(execute_captured, label, command, deadline=deadline)
            for label, command in commands
        ]
        results = [future.result() for future in futures]

    failures = []
    for result in results:
        stdout = str(result["stdout"])
        stderr = str(result["stderr"])
        if stdout:
            print(stdout, end="" if stdout.endswith("\n") else "\n")
        if stderr:
            print(stderr, file=sys.stderr, end="" if stderr.endswith("\n") else "\n")
        event = persist_timing(
            timing_path,
            timing_stage,
            step=result["label"],
            started_at_epoch=result["started_at_epoch"],
            finished_at_epoch=result["finished_at_epoch"],
            status=result["status"],
            source="validate_all",
            detail=result["detail"],
        )
        if debug_timing and event is not None:
            print(
                f"TIMING: {timing_stage} / {result['label']} = "
                f"{event['duration_ms'] / 1000:.3f}s ({result['status']})"
            )
        if result["status"] == "pass":
            print(f"PASS: {result['label']} ({float(result['elapsed']):.1f}s)")
        else:
            failures.append(result)
            print(
                f"FAIL: {result['label']} ({float(result['elapsed']):.1f}s)",
                file=sys.stderr,
            )

    if failures:
        write_failure_report(
            failure_report,
            phase=timing_stage,
            workers=workers,
            failures=failures,
        )
        labels = ", ".join(str(failure["label"]) for failure in failures)
        raise RuntimeError(
            f"{len(failures)} deterministic checks failed: {labels}. "
            f"Repair report: {failure_report}"
        )
    failure_report.unlink(missing_ok=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validation_state_path(review: Path) -> Path:
    return review.parent / "validation-session.json"


def read_manifest(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"could not read validation manifest: {path}") from exc


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(f"{json.dumps(value, indent=2)}\n", encoding="utf-8")
    temporary.replace(path)


def canonical_json(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def current_design_state(review: Path) -> dict[str, str]:
    path = review.parent / "drafts" / "design-contract.json"
    try:
        raw = path.read_bytes()
        contract = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"locked design contract is missing or invalid: {path}") from exc
    selected = contract.get("selected")
    if not isinstance(selected, dict) or not selected:
        raise RuntimeError("locked design contract needs a non-empty selected visual grammar")
    return {
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "contract_id": str(contract.get("contract_id", "")),
        "design_signature": hashlib.sha256(canonical_json(selected).encode("utf-8")).hexdigest(),
    }


def validation_session(
    review: Path,
    deck: Path,
    *,
    phase: str,
    mode: str | None,
    review_risk: str | None,
    high_risk_reason: str | None,
    restart_reason: str | None = None,
    change_impact: str | None = None,
    allow_expired: bool = False,
) -> dict | None:
    path = validation_state_path(review)
    existing = read_manifest(path) if path.is_file() else None
    manifest_path = review / "review.json"
    manifest = read_manifest(manifest_path) if manifest_path.is_file() else {}
    effective_mode = mode or manifest.get("mode")
    if effective_mode != "full":
        return None
    effective_risk = review_risk or manifest.get("review_risk") or "standard"
    effective_reason = high_risk_reason or manifest.get("high_risk_reason")
    design = current_design_state(review)
    if restart_reason is not None:
        if phase != "prepare":
            raise RuntimeError("a Full Validation restart is valid only during prepare")
        if restart_reason not in VALIDATION_RESTART_REASONS:
            raise RuntimeError(f"unsupported Full Validation restart reason: {restart_reason}")
        if existing is None:
            raise RuntimeError("cannot restart a Full Validation session that has not started")
        if change_impact != "full":
            raise RuntimeError("a theme-invalidated restart requires a full-impact design replacement")
        previous_signature = existing.get("design_signature")
        if not isinstance(previous_signature, str) or previous_signature == design["design_signature"]:
            raise RuntimeError(
                "theme-invalidated restart requires a genuinely different selected visual grammar"
            )
    if phase == "prepare" and (
        existing is None
        or existing.get("status") == "complete"
        or existing.get("deck_path") != str(deck)
        or restart_reason is not None
    ):
        requested_seconds = int(
            os.environ.get(
                "BUILD_HTML_SLIDES_FULL_VALIDATION_SECONDS",
                str(WORKFLOW_LIMITS["full_validation_seconds"]),
            )
        )
        if requested_seconds <= 0:
            raise RuntimeError("Full Validation time budget must be positive")
        seconds = min(requested_seconds, WORKFLOW_LIMITS["full_validation_seconds"])
        now = time.time()
        history = list(existing.get("history", [])) if isinstance(existing, dict) else []
        generation = 1
        restart_count = 0
        if restart_reason is not None and existing is not None:
            generation = int(existing.get("generation", 1)) + 1
            restart_count = int(existing.get("restart_count", 0)) + 1
            history.append({
                "generation": existing.get("generation", 1),
                "status": existing.get("status"),
                "started_at_epoch": existing.get("started_at_epoch"),
                "deadline_at_epoch": existing.get("deadline_at_epoch"),
                "budget_seconds": existing.get("budget_seconds"),
                "design_signature": existing.get("design_signature"),
                "invalidated_at_epoch": now,
                "restart_reason": restart_reason,
            })
        existing = {
            "schema_version": 2,
            "status": "active",
            "deck_path": str(deck),
            "mode": "full",
            "review_risk": effective_risk,
            "high_risk_reason": effective_reason,
            "generation": generation,
            "restart_count": restart_count,
            "restart_reason": restart_reason,
            "history": history,
            **design,
            "started_at_epoch": now,
            "deadline_at_epoch": now + seconds,
            "budget_seconds": seconds,
        }
        write_json(path, existing)
    if existing is None:
        raise RuntimeError(
            "Full Validation session is missing; run the initial --phase prepare to start the 60-minute budget"
        )
    if existing.get("review_risk") != effective_risk or existing.get("high_risk_reason") != effective_reason:
        raise RuntimeError("review risk changed after the Full Validation budget started")
    if existing.get("design_signature") != design["design_signature"]:
        raise RuntimeError(
            "selected visual grammar changed after the Full Validation budget started; "
            "use --restart-validation-session theme-invalidated only when the prior theme was rejected"
        )
    remaining = float(existing.get("deadline_at_epoch", 0)) - time.time()
    if remaining <= 0:
        existing["status"] = "time-budget-exceeded"
        existing.setdefault("exceeded_at_epoch", time.time())
        write_json(path, existing)
        if not allow_expired:
            raise RuntimeError(
                "Full Validation exceeded its 60-minute hard time budget; "
                "only a slide-1 --cover-rescue prepare or --phase cover-verify may continue"
            )
        print(
            "WARNING: Full Validation time budget expired; continuing only the mandatory slide-1 "
            "cover rescue gate. Finalization and deployment remain blocked."
        )
        return existing
    warning = WORKFLOW_LIMITS["warning_seconds"]
    elapsed = time.time() - float(existing.get("started_at_epoch", time.time()))
    if elapsed >= warning:
        print(
            f"WARNING: Full Validation has used {elapsed / 60:.1f} minutes; "
            f"{remaining / 60:.1f} minutes remain before the hard stop"
        )
    return existing


def authoring_brief(review: Path) -> Path:
    return review.parent / "drafts" / "research-brief.md"


def annotate_manifest(manifest_path: Path, session: dict | None, brief: Path | None) -> None:
    manifest = read_manifest(manifest_path)
    if session is not None:
        manifest["validation_session"] = {
            "started_at_epoch": session["started_at_epoch"],
            "deadline_at_epoch": session["deadline_at_epoch"],
            "budget_seconds": session["budget_seconds"],
            "status": session["status"],
            "generation": session.get("generation", 1),
            "restart_count": session.get("restart_count", 0),
            "restart_reason": session.get("restart_reason"),
            "design_signature": session["design_signature"],
        }
    if brief is not None:
        editorial_review = brief.with_name("research-storyboard-review.md")
        editorial_record = load_editorial_review(brief.read_text(encoding="utf-8"))
        manifest["research_brief"] = {
            "path": str(brief),
            "sha256": sha256(brief),
        }
        if editorial_record is not None and editorial_review.is_file():
            manifest["research_editorial_review"] = {
                "path": str(editorial_review),
                "sha256": sha256(editorial_review),
                "reviewer_ref": editorial_record.get("reviewer_ref"),
                "review_passes": editorial_record.get("review_passes"),
                "revision_passes": editorial_record.get("revision_passes"),
            }
    write_json(manifest_path, manifest)


def deterministic_commands(
    deck: Path,
    notes: Path,
    guide: Path,
    sources: Path,
    change_type: str,
    *,
    browser_e2e: bool = False,
    content_changes: list[str] | None = None,
) -> list[tuple[str, list[str]]]:
    python = sys.executable
    if content_changes is None:
        content_changes = {
            "all": ["text", "image", "structure", "style", "runtime"],
            "text": ["text"],
            "image": ["image"],
            "navigation": ["runtime"],
        }[change_type]
    changed = set(content_changes)
    commands = [
        ("deck structure", [python, str(SCRIPTS / "validate_deck.py"), str(deck)]),
        (
            "placeholder and incomplete-asset gate",
            [python, str(SCRIPTS / "validate_placeholders.py"), str(deck)],
        ),
    ]
    if changed & {"text", "structure"}:
        commands.append(
            ("presenter notes", [python, str(SCRIPTS / "validate_speaker_notes.py"), str(deck), str(notes)])
        )
        if guide.is_file():
            commands.append(
                (
                    "reader study guide",
                    [python, str(SCRIPTS / "validate_slide_guide.py"), str(deck), str(guide)],
                )
            )
    if "image" in changed:
        commands.append(("source locality", [python, str(SCRIPTS / "validate_source_locality.py"), str(deck)]))
    assets = local_assets(deck)
    if "image" in changed:
        if assets or sources.exists():
            commands.append((
                "hash-bound source cache",
                [python, str(SCRIPTS / "source_cache.py"), str(deck), str(sources), "--check"],
            ))
        commands.append(("image reuse", [python, str(SCRIPTS / "validate_image_reuse.py"), str(deck)]))
    if "runtime" in changed or change_type == "navigation" or browser_e2e:
        commands.extend((
            ("interaction semantics", [python, str(SCRIPTS / "validate_interactions.py"), str(deck)]),
            ("browser interaction and print E2E", ["node", str(SCRIPTS / "validate_browser_e2e.js"), str(deck)]),
        ))
    return commands


def review_directory(deck: Path, explicit: Path | None) -> Path | None:
    if explicit is not None:
        return explicit.resolve()
    result = subprocess.run(
        ["node", str(SCRIPTS / "render_slides.js"), "--review-dir", str(deck)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "could not resolve review directory")
    return Path(result.stdout.strip()).resolve()


def classify_change_scope(
    deck: Path,
    review: Path,
    requested: str,
    mode: str,
    review_risk: str,
    responsive: bool,
    cache: Path,
) -> dict[str, object]:
    result = subprocess.run(
        [
            "node",
            str(SCRIPTS / "render_slides.js"),
            "--classify-change",
            str(deck),
            str(review),
            requested,
            mode,
            review_risk,
            str(responsive).lower(),
            str(cache),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "could not classify the source change")
    try:
        classification = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("change classifier returned invalid JSON") from exc
    effective = classification.get("effective")
    if effective not in {"all", "text", "image", "navigation"}:
        raise RuntimeError("change classifier returned an invalid effective scope")
    if classification.get("impact") not in IMPACT_SCOPES:
        raise RuntimeError("change classifier returned an invalid impact scope")
    if not isinstance(classification.get("navigation_changed"), bool):
        raise RuntimeError("change classifier returned an invalid navigation flag")
    content_changes = classification.get("content_changes")
    if (
        not isinstance(content_changes, list)
        or len(content_changes) != len(set(content_changes))
        or any(value not in CONTENT_CHANGE_CATEGORIES for value in content_changes)
    ):
        raise RuntimeError("change classifier returned invalid content change categories")
    if effective != requested:
        print(
            f"NOTICE: requested change type {requested} resolved to {effective} "
            f"after detecting {classification.get('detected', 'unknown')} changes"
        )
    return classification


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument(
        "--phase",
        choices=(
            "prepare",
            "verify",
            "cover-verify",
            "finalize-prepare",
            "finalize-verify",
            "finalize",
        ),
        default="prepare",
    )
    parser.add_argument("--mode", choices=("quick", "full"))
    parser.add_argument("--review-risk", choices=("standard", "high"), default="standard")
    parser.add_argument("--high-risk-reason", choices=sorted(HIGH_RISK_REASONS))
    parser.add_argument("--notes", type=Path)
    parser.add_argument("--guide", type=Path)
    parser.add_argument("--sources", type=Path)
    parser.add_argument("--review-dir", type=Path)
    parser.add_argument("--slides")
    parser.add_argument("--change-type", choices=("all", "text", "image", "navigation"), default="all")
    parser.add_argument("--responsive", action="store_true")
    parser.add_argument(
        "--restart-validation-session",
        choices=sorted(VALIDATION_RESTART_REASONS),
        help="start a fresh 60-minute cycle only after a full replacement of an invalidated theme",
    )
    parser.add_argument(
        "--cover-rescue",
        action="store_true",
        help="after deadline, permit only a changed slide-1 prepare; finalization remains blocked",
    )
    parser.add_argument(
        "--debug-timing",
        action="store_true",
        help="print millisecond timing details; timings are persisted even without this flag",
    )
    args = parser.parse_args()
    if args.phase == "finalize":
        print("NOTICE: --phase finalize is deprecated; using finalize-prepare")
        args.phase = "finalize-prepare"

    deck = args.deck.resolve()
    if not deck.is_file():
        parser.error(f"deck not found: {deck}")
    if args.phase == "prepare" and args.mode is None:
        parser.error("--mode quick|full is required for prepare")
    if args.phase != "prepare" and args.slides:
        parser.error("--slides is only valid during prepare")
    if args.restart_validation_session and (
        args.phase != "prepare" or args.mode != "full" or args.slides
    ):
        parser.error(
            "--restart-validation-session requires --phase prepare --mode full and a full-deck prepare"
        )
    if args.cover_rescue and (
        args.phase != "prepare"
        or args.mode != "full"
        or (args.slides or "").strip() != "1"
        or args.restart_validation_session
    ):
        parser.error("--cover-rescue requires --phase prepare --mode full --slides 1")
    if args.review_risk == "high" and args.high_risk_reason is None:
        parser.error(
            "--review-risk high requires --high-risk-reason "
            + "|".join(sorted(HIGH_RISK_REASONS))
        )
    if args.review_risk == "standard" and args.high_risk_reason is not None:
        parser.error("--high-risk-reason is valid only with --review-risk high")

    notes = (args.notes or default_notes(deck)).resolve()
    guide = (args.guide or default_guide(deck)).resolve()
    if args.guide is not None and not guide.is_file():
        parser.error(f"requested guide not found: {guide}")
    sources = (args.sources or deck.with_name("sources.json")).resolve()
    started = time.monotonic()
    workflow_started_at_epoch = time.time()
    fingerprint_cache: Path | None = None
    timing_path: Path | None = None
    debug_timing = args.debug_timing or os.environ.get("BUILD_HTML_SLIDES_DEBUG_TIMING") == "1"

    try:
        review_resolution_started = time.time()
        review = review_directory(deck, args.review_dir)
        timing_path = review.parent / REPORT_NAME
        persist_timing(
            timing_path,
            f"validation.{args.phase}",
            step="review workspace resolution",
            started_at_epoch=review_resolution_started,
            status="pass",
            source="validate_all",
        )
        if debug_timing:
            print(
                f"TIMING: validation.{args.phase} / review workspace resolution = "
                f"{time.time() - review_resolution_started:.3f}s (pass)"
            )

        def run_step(label: str, command: list[str]) -> None:
            run(
                label,
                command,
                deadline=deadline,
                timing_path=timing_path,
                timing_stage=f"validation.{args.phase}",
                debug_timing=debug_timing,
            )

        manifest = review / "review.json"
        session: dict | None = None
        deadline: float | None = None
        brief: Path | None = None
        if args.phase != "prepare":
            session = validation_session(
                review,
                deck,
                phase=args.phase,
                mode=args.mode,
                review_risk=None,
                high_risk_reason=None,
                allow_expired=args.phase == "cover-verify",
            )
            deadline = (
                None
                if session is not None and session.get("status") == "time-budget-exceeded"
                else float(session["deadline_at_epoch"]) if session is not None else None
            )
            brief = authoring_brief(review) if session is not None else None
        if args.phase == "prepare":
            classification: dict[str, object] = {
                "effective": "all" if not args.slides else args.change_type,
                "impact": "full" if not args.slides else "direct",
                "navigation_changed": True if not args.slides else args.change_type == "navigation",
                "content_changes": (
                    ["text", "image", "structure", "style", "runtime"]
                    if not args.slides
                    else {
                        "all": ["text", "image", "structure", "style", "runtime"],
                        "text": ["text"],
                        "image": ["image"],
                        "navigation": ["runtime"],
                    }[args.change_type]
                ),
            }
            existing_manifest = manifest.is_file()
            if args.slides or existing_manifest:
                fingerprint_cache = review / ".fingerprint-cache.json"
                classification_started = time.time()
                classification_status = "fail"
                try:
                    classification = classify_change_scope(
                        deck,
                        review,
                        args.change_type,
                        args.mode,
                        args.review_risk,
                        args.responsive,
                        fingerprint_cache,
                    )
                    classification_status = "pass"
                finally:
                    persist_timing(
                        timing_path,
                        f"validation.{args.phase}",
                        step="source change classification",
                        started_at_epoch=classification_started,
                        status=classification_status,
                        source="validate_all",
                    )
            changed_slides = classification.get("changed_slides")
            if (
                existing_manifest
                and not args.slides
                and classification.get("detected") == "none"
                and isinstance(changed_slides, list)
                and not changed_slides
                and not args.restart_validation_session
                and not args.cover_rescue
            ):
                print("OK: no source change detected; existing captures remain current")
                return 0
            session = validation_session(
                review,
                deck,
                phase=args.phase,
                mode=args.mode,
                review_risk=args.review_risk,
                high_risk_reason=args.high_risk_reason,
                restart_reason=args.restart_validation_session,
                change_impact=str(classification.get("impact")),
                allow_expired=args.cover_rescue,
            )
            deadline = (
                None
                if session is not None and session.get("status") == "time-budget-exceeded"
                else float(session["deadline_at_epoch"]) if session is not None else None
            )
            brief = authoring_brief(review) if session is not None else None
            if not args.slides:
                run_step(
                    "tool preflight",
                    [sys.executable, str(SCRIPTS / "check_environment.py")],
                )
            automatic_slides: list[int] = []
            if (
                existing_manifest
                and not args.slides
                and classification.get("impact") != "full"
                and isinstance(changed_slides, list)
            ):
                automatic_slides = [number for number in changed_slides if isinstance(number, int)]
            validation_scope = str(classification["effective"])
            if session is not None:
                if brief is None or not brief.is_file():
                    raise RuntimeError(
                        "research brief is missing; initialize the workspace before research with "
                        "`node scripts/render_slides.js --init-workspace OUTPUT.html`"
                    )
            parallel_commands: list[tuple[str, list[str]]] = []
            if session is not None:
                parallel_commands.append(
                    (
                        "locked visual direction",
                        [
                            sys.executable,
                            str(SCRIPTS / "validate_design_contract.py"),
                            str(deck),
                            str(brief.with_name("design-contract.json")),
                        ],
                    )
                )
                if not existing_manifest or "text" in classification["content_changes"]:
                    parallel_commands.append(
                        (
                            "research brief and copy freeze",
                            [
                                sys.executable,
                                str(SCRIPTS / "validate_authoring_state.py"),
                                str(deck),
                                str(notes),
                                str(brief),
                            ],
                        )
                    )
            parallel_commands.extend(
                deterministic_commands(
                    deck,
                    notes,
                    guide,
                    sources,
                    validation_scope,
                    browser_e2e=bool(classification["navigation_changed"])
                    or args.change_type == "navigation",
                    content_changes=list(classification["content_changes"]),
                )
            )
            run_parallel_group(
                parallel_commands,
                deadline=deadline,
                timing_path=timing_path,
                timing_stage=f"validation.{args.phase}",
                failure_report=timing_path.parent / "validation-failures.json",
                debug_timing=debug_timing,
            )
            if session is not None:
                run_step(
                    "common CSS, Korean font, and navigation preflight",
                    [
                        sys.executable,
                        str(SCRIPTS / "validate_common_preflight.py"),
                        str(deck),
                        "--check",
                    ],
                )

            command = [
                "node", str(SCRIPTS / "render_slides.js"), str(deck), str(review),
                "--mode", args.mode, "--review-risk", args.review_risk,
                "--change-type", args.change_type,
            ]
            if args.review_risk == "high":
                command.extend(("--high-risk-reason", args.high_risk_reason))
            if args.slides:
                command.extend(("--slides", args.slides))
            elif automatic_slides:
                command.extend(("--slides", ",".join(map(str, automatic_slides))))
            if args.responsive:
                command.append("--responsive")
            if fingerprint_cache and fingerprint_cache.is_file():
                command.extend(("--fingerprint-cache", str(fingerprint_cache)))
            run_step("Chromium render and geometry gate", command)
            annotate_manifest(manifest, session, brief)
            print(f"NEXT: complete only the AI batches listed in {manifest}, then run --phase verify")
        elif args.phase == "verify":
            run_step(
                "visual evidence contract",
                [
                    sys.executable,
                    str(SCRIPTS / "validate_visual_review.py"),
                    str(deck),
                    str(manifest),
                    "--capture-scope",
                    "refreshed",
                    "--source-fingerprint-scope",
                    "metadata",
                ],
            )
        elif args.phase == "cover-verify":
            run_step(
                "mandatory slide-1 cover evidence",
                [
                    sys.executable,
                    str(SCRIPTS / "validate_cover_review.py"),
                    str(deck),
                    str(manifest),
                ],
            )
            if session is not None:
                session["cover_review_verified_at_epoch"] = time.time()
                write_json(validation_state_path(review), session)
            print(
                "NOTICE: cover review is verified, but an expired Full Validation session remains "
                "incomplete and cannot be finalized or deployed"
            )
        elif args.phase == "finalize-prepare":
            run_step(
                "iteration evidence before finalization",
                [
                    sys.executable,
                    str(SCRIPTS / "validate_visual_review.py"),
                    str(deck),
                    str(manifest),
                    "--capture-scope",
                    "metadata",
                    "--source-fingerprint-scope",
                    "metadata",
                ],
            )
            run_step(
                "prepare final review without rerender",
                ["node", str(SCRIPTS / "render_slides.js"), str(deck), str(review), "--finalize-prepare"],
            )
            print(
                f"NEXT: fill the final quality score and generated cross-review batches in {manifest}, "
                "then run --phase finalize-verify"
            )
        else:
            run_step(
                "final quality score and cross-review evidence",
                [
                    sys.executable,
                    str(SCRIPTS / "validate_visual_review.py"),
                    str(deck),
                    str(manifest),
                    "--capture-scope",
                    "full",
                    "--source-fingerprint-scope",
                    "metadata",
                ],
            )
            if session is not None:
                session["status"] = "complete"
                session["completed_at_epoch"] = time.time()
                write_json(validation_state_path(review), session)
    except (OSError, RuntimeError, ValueError) as exc:
        if fingerprint_cache:
            fingerprint_cache.unlink(missing_ok=True)
        if timing_path is not None:
            persist_timing(
                timing_path,
                f"validation.{args.phase}.wall-clock",
                step="phase total",
                started_at_epoch=workflow_started_at_epoch,
                status="fail",
                source="validate_all",
                detail=str(exc),
            )
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    if timing_path is not None:
        persist_timing(
            timing_path,
            f"validation.{args.phase}.wall-clock",
            step="phase total",
            started_at_epoch=workflow_started_at_epoch,
            status="pass",
            source="validate_all",
        )
    print(f"OK: complete validation entrypoint phase '{args.phase}' finished in {time.monotonic() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
