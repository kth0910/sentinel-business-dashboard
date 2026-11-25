#!/usr/bin/env python3
"""Regression tests for locked visual-direction enforcement."""

from __future__ import annotations

import hashlib
import html
import json
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parent
SELECTOR = SCRIPTS / "select_visual_direction.py"
VALIDATOR = SCRIPTS / "validate_design_contract.py"
SHELL = SCRIPTS.parent / "assets" / "runtime-shell.html"


class DesignContractTests(unittest.TestCase):
    def create_contract(self, root: Path, *extra: str) -> tuple[Path, dict]:
        contract = root / "design-contract.json"
        result = subprocess.run(
            [
                "python3",
                str(SELECTOR),
                "--title",
                "Hubble 네트워크 관측",
                "--audience",
                "DevOps 개발자",
                "--job",
                "system explanation",
                "--output",
                str(contract),
                *extra,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return contract, json.loads(contract.read_text(encoding="utf-8"))

    @staticmethod
    def rehash(contract: dict) -> None:
        unhashed = dict(contract)
        unhashed.pop("contract_id", None)
        encoded = json.dumps(
            unhashed,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        contract["contract_id"] = hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def bind(self, contract: dict) -> str:
        source = SHELL.read_text(encoding="utf-8")
        values = {
            "data-design-contract-id": contract["contract_id"],
            **contract["required_html_attributes"],
        }
        for name, value in values.items():
            source = source.replace(
                f'{name}="{self.attribute(source, name)}"',
                f'{name}="{html.escape(value, quote=True)}"',
                1,
            )
        return source

    @staticmethod
    def attribute(source: str, name: str) -> str:
        marker = f'{name}="'
        start = source.index(marker) + len(marker)
        return html.unescape(source[start : source.index('"', start)])

    def validate(self, deck: Path, contract: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["python3", str(VALIDATOR), str(deck), str(contract)],
            capture_output=True,
            text=True,
            check=False,
        )

    def write_contract(self, path: Path, contract: dict) -> None:
        path.write_text(
            json.dumps(contract, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def test_locked_contract_matches_bound_body_and_safe_color_pairs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            colors = contract["semantic_color_contract"]
            self.assertEqual(colors, contract["selected"]["semantic_colors"])
            self.assertTrue(
                {
                    "panel",
                    "on_panel",
                    "inverse_canvas",
                    "on_inverse",
                }.issubset(colors["tokens"])
            )
            deck = root / "deck.html"
            deck.write_text(self.bind(contract), encoding="utf-8")
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_body_cannot_silently_switch_theme(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            deck = root / "deck.html"
            deck.write_text(
                self.bind(contract).replace(
                    f'data-theme="{html.escape(contract["selected"]["theme"], quote=True)}"',
                    'data-theme="Incident Dossier"',
                    1,
                ),
                encoding="utf-8",
            )
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn("data-theme must equal the locked contract value", result.stdout)

    def test_duplicate_required_body_attribute_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            source = self.bind(contract).replace(
                "<body\n",
                f'<body\n  data-theme="{html.escape(contract["selected"]["theme"], quote=True)}"\n',
                1,
            )
            deck = root / "deck.html"
            deck.write_text(source, encoding="utf-8")
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn("duplicate required attribute data-theme", result.stdout)

    def test_selected_and_required_attributes_must_be_internally_consistent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            contract["required_html_attributes"]["data-theme"] = "Swiss Signal"
            self.rehash(contract)
            self.write_contract(contract_path, contract)
            deck = root / "deck.html"
            deck.write_text(self.bind(contract), encoding="utf-8")
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn("design contract internal mismatch", result.stdout)

    def test_required_attributes_cannot_override_contract_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            contract["required_html_attributes"]["data-design-contract-id"] = "override"
            self.rehash(contract)
            self.write_contract(contract_path, contract)
            deck = root / "deck.html"
            deck.write_text(self.bind(contract), encoding="utf-8")
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "must not override data-design-contract-id",
                result.stdout,
            )

    def test_unsafe_semantic_token_contrast_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            unsafe = deepcopy(contract["selected"]["semantic_colors"])
            unsafe["tokens"]["text"] = unsafe["tokens"]["canvas"]
            contract["selected"]["semantic_colors"] = unsafe
            contract["semantic_color_contract"] = deepcopy(unsafe)
            self.rehash(contract)
            self.write_contract(contract_path, contract)
            deck = root / "deck.html"
            deck.write_text(self.bind(contract), encoding="utf-8")
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn("contrast 1.00:1 is below 4.5:1", result.stdout)

    def test_contract_edit_invalidates_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract = self.create_contract(root)
            deck = root / "deck.html"
            deck.write_text(self.bind(contract), encoding="utf-8")
            contract["selected"]["palette_direction"] = "charcoal + safety orange"
            self.write_contract(contract_path, contract)
            result = self.validate(deck, contract_path)
            self.assertEqual(result.returncode, 1)
            self.assertIn("hash is stale", result.stdout)


if __name__ == "__main__":
    unittest.main()
