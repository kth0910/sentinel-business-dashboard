#!/usr/bin/env python3
"""Freeze settled slide copy and notes into the durable research brief."""

from __future__ import annotations

import sys

try:
    from validate_authoring_state import main
except ModuleNotFoundError:
    from scripts.validate_authoring_state import main


if __name__ == "__main__":
    raise SystemExit(main())
