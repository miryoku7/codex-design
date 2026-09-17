#!/usr/bin/env python3
"""Explicitly migrate one inline v1 session, retaining a byte-exact snapshot."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from file_layout import check_source_conflicts, new_source_files, split_inline_session, write_exclusive
from serve import MAX_BODY_BYTES, SESSION_NAME, SessionStore, decode_json, hydrate_session, read_project_file


def migrate(project: Path) -> tuple[Path, Path]:
    project = Path(project).expanduser().resolve()
    if not project.is_dir():
        raise ValueError(f"Project directory does not exist: {project}")
    original = read_project_file(project, SESSION_NAME, MAX_BODY_BYTES)
    document, files = split_inline_session(decode_json(original, SESSION_NAME))
    check_source_conflicts(project, files)
    snapshot = project / f"session.inline-v1.{datetime.now(timezone.utc):%Y%m%dT%H%M%S.%fZ}.json"
    with new_source_files(project, files) as root_fd:
        hydrate_session(project, document)
        if read_project_file(project, SESSION_NAME, MAX_BODY_BYTES) != original:
            raise RuntimeError("session.json changed during migration; retry after all writers have stopped")
        write_exclusive(root_fd, snapshot.name, original)
        SessionStore(project)._atomic_write(document)
    return project / SESSION_NAME, snapshot


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, type=Path, help="directory containing an inline version 1 session.json")
    args = parser.parse_args()
    try:
        target, snapshot = migrate(args.project)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Migration refused: {error}")
        return 2
    print(f"Migrated {target}\nPreserved inline snapshot: {snapshot}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
