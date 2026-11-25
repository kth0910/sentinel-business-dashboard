#!/usr/bin/env python3
"""Validate shared CSS, Korean fonts, and navigation on two or three representative slides."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
CONTRACT = json.loads((SCRIPTS / "validation_contract.json").read_text(encoding="utf-8"))
ALLOWED_ROLES = ("cover", "dense", "closing")
REQUIRED_ROLES = ("cover", "dense")


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class ProbeParser(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=True)
        self.source = source
        self.line_starts = [0]
        self.line_starts.extend(match.end() for match in re.finditer(r"\n", source))
        self.stack: list[dict] = []
        self.slides: list[dict] = []
        self.feed(source)
        self.close()

    def source_offset(self) -> int:
        line, column = self.getpos()
        return self.line_starts[line - 1] + column

    def handle_starttag(self, tag: str, attrs) -> None:
        values = {name: value or "" for name, value in attrs}
        start = self.source_offset()
        raw = self.get_starttag_text() or f"<{tag}>"
        record = {"tag": tag, "start": start, "content_start": start + len(raw), "attrs": values}
        self.stack.append(record)

    def handle_startendtag(self, tag: str, attrs) -> None:
        self.handle_starttag(tag, attrs)
        self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        end_start = self.source_offset()
        closing = self.source.find(">", end_start)
        end = len(self.source) if closing < 0 else closing + 1
        for index in range(len(self.stack) - 1, -1, -1):
            record = self.stack[index]
            if record["tag"] == tag:
                if tag == "section" and "slide" in record["attrs"].get("class", "").split():
                    self.slides.append({**record, "end": end})
                del self.stack[index:]
                return


def probe_records(deck: Path) -> list[dict]:
    source = deck.read_text(encoding="utf-8")
    parser = ProbeParser(source)
    selected: dict[str, dict] = {}
    for number, slide in enumerate(parser.slides, 1):
        role = slide["attrs"].get("data-common-preflight", "").strip()
        if not role:
            continue
        if role not in ALLOWED_ROLES:
            raise ValueError(
                f"slide {number} has invalid data-common-preflight={role!r}; "
                f"use {', '.join(ALLOWED_ROLES)}"
            )
        if role in selected:
            raise ValueError(f"common preflight role {role!r} appears more than once")
        selected[role] = {
            "role": role,
            "slide": number,
            "title": slide["attrs"].get("data-title", "").strip(),
            "source_sha256": digest_bytes(source[slide["start"]:slide["end"]].encode("utf-8")),
        }
    missing = [role for role in REQUIRED_ROLES if role not in selected]
    if missing:
        raise ValueError(
            "mark representative slides with data-common-preflight for: " + ", ".join(missing)
        )
    if not 2 <= len(selected) <= 3:
        raise ValueError("common preflight requires exactly two or three marked slides")
    return [selected[role] for role in ALLOWED_ROLES if role in selected]


def common_fingerprint(deck: Path) -> str:
    result = subprocess.run(
        ["node", str(SCRIPTS / "render_slides.js"), "--fingerprints", str(deck)],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    if result.returncode:
        raise ValueError(
            result.stderr.strip()
            or result.stdout.strip()
            or "could not fingerprint shared CSS, runtime, fonts, and navigation"
        )
    try:
        fingerprints = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ValueError("renderer returned invalid common-system fingerprints") from exc
    value = fingerprints.get("global_sha256")
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("renderer omitted the common-system fingerprint")
    return value


def workspace_directory(deck: Path) -> Path:
    result = subprocess.run(
        ["node", str(SCRIPTS / "render_slides.js"), "--workspace-dir", str(deck)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or "could not resolve workspace")
    return Path(result.stdout.strip()).resolve()


def render_probe(deck: Path, output: Path, slides: list[int]) -> dict:
    result = subprocess.run(
        [
            "node",
            str(SCRIPTS / "render_slides.js"),
            str(deck),
            str(output),
            "--mode",
            "quick",
            "--review-risk",
            "standard",
            "--slides",
            ",".join(map(str, slides)),
            "--common-preflight",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise ValueError(result.stderr.strip() or result.stdout.strip() or "common preflight render failed")
    manifest = json.loads((output / "review.json").read_text(encoding="utf-8"))
    gate = manifest.get("automation_gate", {})
    if gate.get("status") != "pass":
        raise ValueError("common preflight automation gate did not pass")
    return manifest


def capture_matrix(manifest: dict, slides: list[int]) -> dict[str, str]:
    matrix = {}
    records = {record["slide"]: record for record in manifest.get("slides", [])}
    for number in slides:
        for profile in CONTRACT["base_profiles"]:
            capture = records.get(number, {}).get("captures", {}).get(profile)
            if not capture or not capture.get("sha256"):
                raise ValueError(f"common preflight is missing slide {number} profile {profile}")
            matrix[f"{number}:{profile}"] = capture["sha256"]
    return matrix


def validate_report(deck: Path, workspace: Path) -> dict:
    report_path = workspace / "common-preflight" / "report.json"
    if not report_path.is_file():
        raise ValueError(f"common preflight report is missing: {report_path}")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("schema_version") != 1 or report.get("deck_path") != str(deck):
        raise ValueError("common preflight report belongs to another deck or schema")
    if report.get("common_sha256") != common_fingerprint(deck):
        raise ValueError("shared CSS, runtime, font, or navigation changed; rerun common preflight")
    current = probe_records(deck)
    recorded = report.get("probes")
    if not isinstance(recorded, list) or [
        (item.get("role"), item.get("slide"))
        for item in recorded
    ] != [
        (item.get("role"), item.get("slide"))
        for item in current
    ]:
        raise ValueError("common preflight slide roles changed; rerun common preflight")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("deck", type=Path)
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    deck = args.deck.resolve()
    if not deck.is_file():
        parser.error(f"deck not found: {deck}")
    try:
        workspace = (args.workspace or workspace_directory(deck)).resolve()
        if args.check:
            report = validate_report(deck, workspace)
            print(f"OK: common preflight still binds {len(report['probes'])} representative slides")
            return 0
        probes = probe_records(deck)
        root = workspace / "common-preflight"
        first = render_probe(deck, root / "run-a", [probe["slide"] for probe in probes])
        second = render_probe(deck, root / "run-b", [probe["slide"] for probe in probes])
        first_matrix = capture_matrix(first, [probe["slide"] for probe in probes])
        second_matrix = capture_matrix(second, [probe["slide"] for probe in probes])
        mismatches = [
            key for key, value in first_matrix.items() if second_matrix.get(key) != value
        ]
        if mismatches:
            raise ValueError(
                "nondeterministic render for unchanged source/profile: "
                + ", ".join(mismatches)
                + "; do not retry a third time"
            )
        report = {
            "schema_version": 1,
            "deck_path": str(deck),
            "common_sha256": common_fingerprint(deck),
            "probes": probes,
            "capture_sha256": first_matrix,
            "render_run_ids": [
                first.get("render_run", {}).get("id"),
                second.get("render_run", {}).get("id"),
            ],
        }
        root.mkdir(parents=True, exist_ok=True)
        (root / "report.json").write_text(
            f"{json.dumps(report, ensure_ascii=False, indent=2)}\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"ERROR: common preflight failed: {exc}")
        return 1
    print(f"OK: common preflight passed for {len(probes)} representative slides")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
