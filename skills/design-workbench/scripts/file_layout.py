"""Create the v2 author-file layout without replacing pre-existing source files."""
from __future__ import annotations

import copy
import json
import os
from contextlib import contextmanager
from pathlib import Path

from serve import ASSET_DIR, validate_session


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def split_inline_session(inline: dict) -> tuple[dict, dict[str, bytes]]:
    validate_session(inline)
    if inline["version"] != 1:
        raise ValueError("The session is already file-backed; no migration is needed")
    document = copy.deepcopy(inline)
    document["version"] = 2
    files = {}
    for variant in document["variants"]:
        identifier = variant["id"]
        html = variant.pop("html")
        css = variant.pop("css", None)
        if css is None:
            css = (ASSET_DIR / "legacy-v1.css").read_text(encoding="utf-8")
        tweaks = variant.pop("tweaks", [])
        variant.setdefault("baselineTokens", copy.deepcopy(variant["tokens"]))
        defaults = {definition["id"]: definition["default"] for definition in tweaks}
        variant["tweakValues"] = {**defaults, **variant.get("tweakValues", {})}
        variant.setdefault("baselineTweakValues", copy.deepcopy(variant["tweakValues"]))
        # A persisted reset baseline is the best available original author default
        # for legacy tokens. Tweak definitions already carry explicit defaults.
        controls = {"version": 1, "tokens": copy.deepcopy(variant["baselineTokens"]), "tweaks": tweaks}
        variant["sources"] = {"html": f"{identifier}/index.html", "css": f"{identifier}/style.css", "controls": f"{identifier}/controls.json"}
        files[variant["sources"]["html"]] = html.encode("utf-8")
        files[variant["sources"]["css"]] = css.encode("utf-8")
        files[variant["sources"]["controls"]] = json_bytes(controls)
    validate_session(document)
    return document, files


def write_exclusive(directory_fd: int, filename: str, content: bytes) -> tuple[int, int]:
    fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644, dir_fd=directory_fd)
    status = os.fstat(fd)
    identity = status.st_dev, status.st_ino
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            current = os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
            if (current.st_dev, current.st_ino) == identity:
                os.unlink(filename, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        raise
    return identity


def check_source_conflicts(project: Path, files: dict[str, bytes]) -> None:
    for directory in {relative.split("/")[0] for relative in files}:
        if os.path.lexists(project / directory):
            raise FileExistsError(f"Refusing to overwrite existing source directory: {project / directory}")


@contextmanager
def new_source_files(project: Path, files: dict[str, bytes]):
    """Reserve fresh variant directories; roll back only files created by this call."""
    check_source_conflicts(project, files)
    root_fd = os.open(project, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directories = {}
    created = []
    complete = False
    try:
        for relative, content in files.items():
            directory, filename = relative.split("/")
            if directory not in directories:
                os.mkdir(directory, dir_fd=root_fd)
                directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd)
                status = os.fstat(directory_fd)
                directories[directory] = (directory_fd, (status.st_dev, status.st_ino))
            directory_fd = directories[directory][0]
            identity = write_exclusive(directory_fd, filename, content)
            created.append((directory_fd, filename, identity))
        yield root_fd
        complete = True
    finally:
        if not complete:
            for directory_fd, filename, identity in reversed(created):
                try:
                    status = os.stat(filename, dir_fd=directory_fd, follow_symlinks=False)
                    if (status.st_dev, status.st_ino) == identity:
                        os.unlink(filename, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass
        for directory, (directory_fd, identity) in directories.items():
            os.close(directory_fd)
            if not complete:
                try:
                    status = os.stat(directory, dir_fd=root_fd, follow_symlinks=False)
                    if (status.st_dev, status.st_ino) == identity:
                        os.rmdir(directory, dir_fd=root_fd)
                except OSError:
                    pass
        os.close(root_fd)
