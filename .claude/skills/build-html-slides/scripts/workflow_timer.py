#!/usr/bin/env python3
"""Persist and summarize deck-production stage timings."""

from __future__ import annotations

import argparse
import json
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
REPORT_NAME = "workflow-timing.json"
SCRIPTS = Path(__file__).resolve().parent
AUTHORING_STAGE_ORDER = (
    "research",
    "storyboard",
    "editorial-review",
    "editorial-revision",
    "asset-selection",
    "asset-production",
    "implementation",
    "common-preflight",
    "render-automation",
    "ai-review",
    "final-review",
)
AUTHORING_STAGE_LABELS = {
    "research": "Pure research",
    "storyboard": "Storyboard",
    "editorial-review": "AI editorial review",
    "editorial-revision": "Integrated revision",
    "asset-selection": "Image selection",
    "asset-production": "Asset production",
    "implementation": "HTML implementation",
    "common-preflight": "Common preflight",
    "render-automation": "Render automation",
    "ai-review": "AI visual review",
    "final-review": "Final review",
}


def iso_time(epoch: float) -> str:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def empty_report(workspace: Path) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "workspace": str(workspace),
        "active": {},
        "events": [],
    }


def load_report(path: Path, workspace: Path | None = None) -> dict[str, Any]:
    if not path.is_file():
        if workspace is None:
            workspace = path.parent
        return empty_report(workspace.resolve())
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"could not read timing report: {path}") from exc
    if report.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError(f"unsupported timing report schema: {report.get('schema_version')}")
    if not isinstance(report.get("active"), dict) or not isinstance(report.get("events"), list):
        raise RuntimeError(f"invalid timing report structure: {path}")
    return report


def save_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(f"{json.dumps(report, indent=2, ensure_ascii=False)}\n", encoding="utf-8")
    temporary.replace(path)


def start_stage(path: Path, stage: str, *, now: float | None = None, detail: str | None = None) -> None:
    timestamp = time.time() if now is None else now
    report = load_report(path)
    if stage in report["active"]:
        raise RuntimeError(f"stage is already active: {stage}")
    if report["active"]:
        current = ", ".join(sorted(report["active"]))
        raise RuntimeError(
            f"another manual stage is active: {current}; use transition or stop it before starting {stage}"
        )
    report["active"][stage] = {
        "started_at": iso_time(timestamp),
        "started_at_epoch": timestamp,
        "detail": detail,
    }
    save_report(path, report)


def record_event(
    path: Path,
    stage: str,
    *,
    started_at_epoch: float,
    finished_at_epoch: float | None = None,
    status: str = "pass",
    source: str = "automatic",
    step: str | None = None,
    detail: str | None = None,
) -> dict[str, Any]:
    finished = time.time() if finished_at_epoch is None else finished_at_epoch
    duration_ms = max(0, round((finished - started_at_epoch) * 1000))
    event = {
        "stage": stage,
        "step": step,
        "status": status,
        "source": source,
        "started_at": iso_time(started_at_epoch),
        "finished_at": iso_time(finished),
        "duration_ms": duration_ms,
        "detail": detail,
    }
    report = load_report(path)
    report["events"].append(event)
    save_report(path, report)
    return event


def stop_stage(
    path: Path,
    stage: str,
    *,
    now: float | None = None,
    status: str = "pass",
    detail: str | None = None,
) -> dict[str, Any]:
    timestamp = time.time() if now is None else now
    report = load_report(path)
    active = report["active"].pop(stage, None)
    if active is None:
        raise RuntimeError(f"stage is not active: {stage}")
    event = {
        "stage": stage,
        "step": None,
        "status": status,
        "source": "manual",
        "started_at": active["started_at"],
        "finished_at": iso_time(timestamp),
        "duration_ms": max(0, round((timestamp - float(active["started_at_epoch"])) * 1000)),
        "detail": detail or active.get("detail"),
    }
    report["events"].append(event)
    save_report(path, report)
    return event


def transition_stage(
    path: Path,
    stage: str,
    *,
    now: float | None = None,
    status: str = "pass",
    stop_detail: str | None = None,
    start_detail: str | None = None,
) -> dict[str, Any]:
    timestamp = time.time() if now is None else now
    report = load_report(path)
    active_names = list(report["active"])
    if len(active_names) != 1:
        if not active_names:
            raise RuntimeError("cannot transition because no manual stage is active")
        raise RuntimeError(
            "cannot transition a legacy report with multiple active stages; stop them explicitly first"
        )
    current = active_names[0]
    if current == stage:
        raise RuntimeError(f"stage is already active: {stage}")
    active = report["active"].pop(current)
    event = {
        "stage": current,
        "step": None,
        "status": status,
        "source": "manual",
        "started_at": active["started_at"],
        "finished_at": iso_time(timestamp),
        "duration_ms": max(0, round((timestamp - float(active["started_at_epoch"])) * 1000)),
        "detail": stop_detail or active.get("detail"),
    }
    report["events"].append(event)
    report["active"][stage] = {
        "started_at": iso_time(timestamp),
        "started_at_epoch": timestamp,
        "detail": start_detail,
    }
    save_report(path, report)
    return event


def format_duration(milliseconds: int) -> str:
    seconds = milliseconds / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes, remainder = divmod(seconds, 60)
    if minutes < 60:
        return f"{int(minutes)}m {remainder:04.1f}s"
    hours, minutes = divmod(int(minutes), 60)
    return f"{hours}h {minutes:02d}m"


def report_rows(report: dict[str, Any]) -> list[tuple[str, int, int, int]]:
    totals: dict[str, dict[str, int]] = {}
    for event in report["events"]:
        stage = str(event["stage"])
        row = totals.setdefault(stage, {"duration_ms": 0, "runs": 0, "failures": 0})
        row["duration_ms"] += int(event["duration_ms"])
        row["runs"] += 1
        if event["status"] != "pass":
            row["failures"] += 1
    return sorted(
        (
            (stage, values["duration_ms"], values["runs"], values["failures"])
            for stage, values in totals.items()
        ),
        key=lambda row: row[1],
        reverse=True,
    )


def render_report(report: dict[str, Any]) -> str:
    rows = report_rows(report)
    by_stage = {row[0]: row for row in rows}
    authoring_rows = [
        by_stage[stage]
        for stage in AUTHORING_STAGE_ORDER
        if stage in by_stage and any(
            event.get("source") == "manual" and event.get("stage") == stage
            for event in report["events"]
        )
    ]
    diagnostic_rows = [
        row
        for row in rows
        if row[0] not in {stage for stage, _duration, _runs, _failures in authoring_rows}
    ]
    lines = [
        "AUTHORING STAGES — exclusive manual elapsed time",
        "STAGE                                      TOTAL     RUNS  FAIL",
    ]
    for stage, duration_ms, runs, failures in authoring_rows:
        label = f"{AUTHORING_STAGE_LABELS.get(stage, stage)} [{stage}]"
        lines.append(f"{label[:40]:40} {format_duration(duration_ms):>9} {runs:>8} {failures:>5}")
    if not authoring_rows:
        lines.append("(no completed authoring stages)")
    authoring_total = sum(duration_ms for _stage, duration_ms, _runs, _failures in authoring_rows)
    lines.append(f"Authoring elapsed: {format_duration(authoring_total)}")
    lines.extend((
        "",
        "VALIDATION DIAGNOSTICS — spans may overlap; do not sum as elapsed time",
        "STAGE                                      TOTAL     RUNS  FAIL",
    ))
    for stage, duration_ms, runs, failures in diagnostic_rows:
        lines.append(f"{stage[:40]:40} {format_duration(duration_ms):>9} {runs:>8} {failures:>5}")
    if not diagnostic_rows:
        lines.append("(no completed validation diagnostics)")
    if report["active"]:
        lines.append("")
        lines.append("ACTIVE: " + ", ".join(sorted(report["active"])))
    return "\n".join(lines)


def workspace_from_deck(deck: Path) -> Path:
    result = subprocess.run(
        ["node", str(SCRIPTS / "render_slides.js"), "--workspace-dir", str(deck)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or "could not resolve workspace")
    return Path(result.stdout.strip()).resolve()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--workspace", type=Path)
    target.add_argument("--deck", type=Path)
    parser.add_argument("--report-file", type=Path)
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start")
    start.add_argument("stage")
    start.add_argument("--detail")

    stop = subparsers.add_parser("stop")
    stop.add_argument("stage")
    stop.add_argument("--status", choices=("pass", "fail", "blocked"), default="pass")
    stop.add_argument("--detail")

    transition = subparsers.add_parser("transition")
    transition.add_argument("stage")
    transition.add_argument("--status", choices=("pass", "fail", "blocked"), default="pass")
    transition.add_argument("--stop-detail")
    transition.add_argument("--start-detail")

    report_parser = subparsers.add_parser("report")
    report_parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    try:
        workspace = (args.workspace.resolve() if args.workspace else workspace_from_deck(args.deck.resolve()))
        path = args.report_file.resolve() if args.report_file else workspace / REPORT_NAME
        if args.command == "start":
            start_stage(path, args.stage, detail=args.detail)
            print(f"STARTED: {args.stage}")
        elif args.command == "stop":
            event = stop_stage(path, args.stage, status=args.status, detail=args.detail)
            print(f"STOPPED: {args.stage} ({format_duration(event['duration_ms'])}, {args.status})")
        elif args.command == "transition":
            event = transition_stage(
                path,
                args.stage,
                status=args.status,
                stop_detail=args.stop_detail,
                start_detail=args.start_detail,
            )
            print(
                f"TRANSITIONED: {event['stage']} "
                f"({format_duration(event['duration_ms'])}, {args.status}) -> {args.stage}"
            )
        else:
            report = load_report(path, workspace)
            print(json.dumps(report, indent=2, ensure_ascii=False) if args.json else render_report(report))
        return 0
    except RuntimeError as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
