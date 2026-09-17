#!/usr/bin/env python3
"""Create a starter Design Workbench project without overwriting a session."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from file_layout import json_bytes, new_source_files, split_inline_session, write_exclusive
from serve import SessionStore, portable_session


SCRIPT_DIR = Path(__file__).resolve().parent
EXAMPLE_SESSION = SCRIPT_DIR.parent / "assets" / "workbench" / "example" / "session.json"


def initialize(output: Path) -> tuple[bool, Path]:
    """Create split author files and a manifest, refusing any existing source paths."""

    destination = Path(output).expanduser()
    destination.mkdir(parents=True, exist_ok=True)
    if not destination.is_dir():
        raise NotADirectoryError(destination)
    target = destination / "session.json"
    if os.path.lexists(target):
        return False, target
    example, _, warning = SessionStore(EXAMPLE_SESSION.parent).snapshot()
    if warning:
        raise ValueError(warning)
    document, files = split_inline_session(portable_session(example))
    with new_source_files(destination, files) as root_fd:
        write_exclusive(root_fd, "session.json", json_bytes(document))
    return True, target


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a Design Workbench session")
    parser.add_argument("--output", required=True, type=Path, help="session directory to create or reuse")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        created, target = initialize(args.output)
    except (OSError, ValueError) as error:
        print(f"Initialization refused: {error}")
        return 2
    if created:
        print(f"Created {target}")
        return 0
    print(f"Already exists; left unchanged: {target}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
