#!/usr/bin/env python3
"""Serve the dependency-free Design Workbench and one bounded JSON endpoint.

The project directory is deliberately separate from the bundled assets.  The
only writable route is POST /api/state, and it can replace only project/
session.json after a revision check.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import stat
import tempfile
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "assets" / "workbench"
SESSION_NAME = "session.json"
MAX_BODY_BYTES = 1_500_000
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$")
BRIEF_KEYS = ("purpose", "audience", "platform", "mood", "avoid")
TOKEN_KEYS = ("accent", "background", "text", "spacing", "fontSize", "radius")
CSS_VAR_RE = re.compile(r"^--[a-z][a-z0-9-]{0,63}$")
ATTRIBUTE_RE = re.compile(r"^data-[a-z][a-z0-9-]{0,63}$")
OPTION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
SOURCE_KEYS = {"html": ".html", "css": ".css", "controls": ".json"}
AUTHORED_FIELDS = ("html", "css", "tweaks")
MAX_SOURCE_BYTES = 1_200_000


class SessionValidationError(ValueError):
    """The incoming session or author source does not satisfy the local contract."""


class InvalidCurrentState(RuntimeError):
    """The on-disk session became invalid before a conditional write."""

    def __init__(self, message: str, state: dict[str, Any] | None, revision: str | None):
        super().__init__(message)
        self.state = state
        self.revision = revision


class RevisionConflict(RuntimeError):
    """A client tried to save against a state it has not seen."""

    def __init__(self, state: dict[str, Any], revision: str):
        super().__init__("The session or an author source changed since this browser loaded it")
        self.state = state
        self.revision = revision


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _require_string(value: Any, field: str, maximum: int) -> None:
    if not isinstance(value, str) or not value.strip():
        raise SessionValidationError(f"{field} must be a non-empty string")
    if len(value) > maximum:
        raise SessionValidationError(f"{field} is too long")


def _validate_tokens(tokens: Any, field: str = "tokens") -> None:
    if not isinstance(tokens, dict):
        raise SessionValidationError(f"{field} must be an object")
    if not tokens:
        return  # No base parameters; the design is authored directly in CSS.
    for key in TOKEN_KEYS:
        if key not in tokens:
            raise SessionValidationError(f"{field}.{key} is required")
    for key in ("accent", "background", "text"):
        if not isinstance(tokens[key], str) or not COLOR_RE.fullmatch(tokens[key]):
            raise SessionValidationError(f"{field}.{key} must be a hexadecimal color")
    ranges = {"spacing": (0, 128), "fontSize": (10, 48), "radius": (0, 32)}
    for key, (minimum, maximum) in ranges.items():
        if not _is_number(tokens[key]) or not minimum <= tokens[key] <= maximum:
            raise SessionValidationError(f"{field}.{key} must be between {minimum} and {maximum}")


def _validate_designer(value: Any, field: str) -> None:
    if not isinstance(value, dict):
        raise SessionValidationError(f"{field} must be an object")
    _require_string(value.get("model"), f"{field}.model", 128)
    if "role" in value:
        _require_string(value["role"], f"{field}.role", 128)


def _validate_tweak_value(value: Any, tweak: dict[str, Any], field: str) -> None:
    kind = tweak["type"]
    if kind == "range":
        valid = _is_number(value) and tweak["min"] <= value <= tweak["max"]
    elif kind == "color":
        valid = isinstance(value, str) and bool(COLOR_RE.fullmatch(value))
    elif kind == "toggle":
        valid = isinstance(value, bool)
    else:
        valid = isinstance(value, str) and value in {item["value"] for item in tweak["options"]}
    if not valid:
        raise SessionValidationError(f"{field} is not a valid {kind} value")


def _validate_tweaks(variant: dict[str, Any], prefix: str) -> None:
    tweaks = variant.get("tweaks", [])
    if not isinstance(tweaks, list) or len(tweaks) > 24:
        raise SessionValidationError(f"{prefix}.tweaks must be an array of at most 24 controls")
    by_id: dict[str, Any] = {}
    bindings: set[str] = set()
    for index, tweak in enumerate(tweaks):
        field = f"{prefix}.tweaks[{index}]"
        if not isinstance(tweak, dict):
            raise SessionValidationError(f"{field} must be an object")
        _require_string(tweak.get("id"), f"{field}.id", 32)
        if not ID_RE.fullmatch(tweak["id"]) or tweak["id"] in by_id:
            raise SessionValidationError(f"{field}.id must be a unique control id")
        _require_string(tweak.get("label"), f"{field}.label", 100)
        kind = tweak.get("type")
        if not isinstance(kind, str) or kind not in ("range", "color", "select", "toggle"):
            raise SessionValidationError(f"{field}.type must be range, color, select, or toggle")
        has_var, has_attr = "cssVar" in tweak, "attribute" in tweak
        if has_var == has_attr:
            raise SessionValidationError(f"{field} must bind exactly one cssVar or attribute")
        key, pattern = ("cssVar", CSS_VAR_RE) if has_var else ("attribute", ATTRIBUTE_RE)
        binding = tweak[key]
        if not isinstance(binding, str) or not pattern.fullmatch(binding) or binding in bindings:
            raise SessionValidationError(f"{field}.{key} must be a unique safe binding")
        bindings.add(binding)
        unit = tweak.get("unit", "")
        if not isinstance(unit, str) or unit not in ("", "px", "rem", "em", "%", "deg") or (unit and (kind != "range" or not has_var)):
            raise SessionValidationError(f"{field}.unit is unsupported")
        if kind == "range":
            minimum, maximum, step = tweak.get("min"), tweak.get("max"), tweak.get("step", 1)
            if not all(_is_number(x) for x in (minimum, maximum, step)) or not -10000 <= minimum < maximum <= 10000 or not 0 < step <= maximum - minimum:
                raise SessionValidationError(f"{field} requires finite min < max and a positive step")
        if kind == "select":
            options = tweak.get("options")
            if not isinstance(options, list) or not 2 <= len(options) <= 12:
                raise SessionValidationError(f"{field}.options must contain 2 to 12 options")
            values: set[str] = set()
            for option in options:
                if not isinstance(option, dict):
                    raise SessionValidationError(f"{field}.options entries must be objects")
                option_value = option.get("value")
                if not isinstance(option_value, str) or not OPTION_RE.fullmatch(option_value) or option_value in values:
                    raise SessionValidationError(f"{field}.options require unique safe values")
                _require_string(option.get("label"), f"{field}.options.label", 100)
                values.add(option_value)
        _validate_tweak_value(tweak.get("default"), tweak, f"{field}.default")
        by_id[tweak["id"]] = tweak
    for key in ("tweakValues", "baselineTweakValues"):
        if key not in variant:
            continue
        values = variant[key]
        if not isinstance(values, dict):
            raise SessionValidationError(f"{prefix}.{key} must be an object")
        for tweak_id, value in values.items():
            if tweak_id not in by_id:
                raise SessionValidationError(f"{prefix}.{key} contains an unknown control")
            _validate_tweak_value(value, by_id[tweak_id], f"{prefix}.{key}.{tweak_id}")


def _source_parts(value: Any, field: str) -> list[str]:
    if not isinstance(value, str) or len(value) > 256:
        raise SessionValidationError(f"{field} must be a project-relative file path")
    parts = value.split("/")
    if any(not part or part in (".", "..") or not re.fullmatch(r"[A-Za-z0-9_.-]+", part) for part in parts):
        raise SessionValidationError(f"{field} must be a confined relative path without dot segments")
    return parts


def _validate_sources(value: Any, field: str) -> None:
    if not isinstance(value, dict) or not {"html", "css"} <= set(value) <= set(SOURCE_KEYS):
        raise SessionValidationError(f"{field} requires html and css paths, with optional controls")
    for key in value:
        extension = SOURCE_KEYS[key]
        parts = _source_parts(value[key], f"{field}.{key}")
        if not parts[-1].endswith(extension) or value[key] == SESSION_NAME:
            raise SessionValidationError(f"{field}.{key} must name a {extension} source file")


def validate_session(value: Any, *, hydrated: bool = False) -> dict[str, Any]:
    """Validate an inline v1 or file-backed v2 session without mutating it.

    Only the API's hydrated v2 representation may contain authored fields.
    The on-disk v2 manifest must never duplicate those fields.
    """

    if not isinstance(value, dict):
        raise SessionValidationError("session must be a JSON object")
    if type(value.get("version")) is not int or value.get("version") not in (1, 2):
        raise SessionValidationError("version must be 1 or 2")
    file_backed = value["version"] == 2
    _require_string(value.get("id"), "id", 128)
    if not ID_RE.fullmatch(value["id"]):
        raise SessionValidationError("id contains unsupported characters")
    _require_string(value.get("title"), "title", 300)

    brief = value.get("brief")
    if not isinstance(brief, dict):
        raise SessionValidationError("brief must be an object")
    for key in BRIEF_KEYS:
        if key not in brief or not isinstance(brief[key], str):
            raise SessionValidationError(f"brief.{key} must be a string")
        if len(brief[key]) > 5_000:
            raise SessionValidationError(f"brief.{key} is too long")

    variants = value.get("variants")
    if not isinstance(variants, list) or not variants:
        raise SessionValidationError("variants must be a non-empty array")
    if len(variants) > 12:
        raise SessionValidationError("variants may contain at most 12 items")
    ids: set[str] = set()
    for index, variant in enumerate(variants):
        prefix = f"variants[{index}]"
        if not isinstance(variant, dict):
            raise SessionValidationError(f"{prefix} must be an object")
        _require_string(variant.get("id"), f"{prefix}.id", 32)
        if not ID_RE.fullmatch(variant["id"]):
            raise SessionValidationError(f"{prefix}.id contains unsupported characters")
        if variant["id"] in ids:
            raise SessionValidationError(f"duplicate variant id: {variant['id']}")
        ids.add(variant["id"])
        _require_string(variant.get("name"), f"{prefix}.name", 300)
        _require_string(variant.get("rationale"), f"{prefix}.rationale", 5_000)
        if file_backed:
            _validate_sources(variant.get("sources"), f"{prefix}.sources")
            if not hydrated and any(key in variant for key in AUTHORED_FIELDS):
                raise SessionValidationError(f"{prefix}: v2 author content belongs in source files, not session.json")
        elif "sources" in variant:
            raise SessionValidationError(f"{prefix}.sources requires session version 2")
        if not file_backed or hydrated:
            if not isinstance(variant.get("html"), str) or len(variant["html"]) > 300_000:
                raise SessionValidationError(f"{prefix}.html must be a string under 300KB")
        notes = variant.get("notes", "")
        if not isinstance(notes, str) or len(notes) > 20_000:
            raise SessionValidationError(f"{prefix}.notes must be a string under 20KB")
        _validate_tokens(variant.get("tokens"), f"{prefix}.tokens")
        if "baselineTokens" in variant:
            _validate_tokens(variant["baselineTokens"], f"{prefix}.baselineTokens")
        if "css" in variant and (not isinstance(variant["css"], str) or len(variant["css"]) > 300_000):
            raise SessionValidationError(f"{prefix}.css must be a string under 300KB")
        if "summary" in variant:
            _require_string(variant["summary"], f"{prefix}.summary", 300)
        if "designer" in variant:
            _validate_designer(variant["designer"], f"{prefix}.designer")
        if not file_backed or hydrated:
            _validate_tweaks(variant, prefix)
        else:
            for key in ("tweakValues", "baselineTweakValues"):
                if key in variant and not isinstance(variant[key], dict):
                    raise SessionValidationError(f"{prefix}.{key} must be an object")

    selected = value.get("selectedId")
    if selected is not None and (not isinstance(selected, str) or selected not in ids):
        raise SessionValidationError("selectedId must be null or a variant id")
    if "viewport" in value:
        viewport = value["viewport"]
        if not isinstance(viewport, dict):
            raise SessionValidationError("viewport must be an object")
        for key, minimum, maximum in (("width", 240, 2560), ("height", 320, 2160)):
            if type(viewport.get(key)) is not int or not minimum <= viewport[key] <= maximum:
                raise SessionValidationError(f"viewport.{key} must be an integer between {minimum} and {maximum}")
        if "preset" in viewport and (not isinstance(viewport["preset"], str) or viewport["preset"] not in ("mobile", "tablet", "desktop", "custom")):
            raise SessionValidationError("viewport.preset is unsupported")
    if "view" in value:
        view = value["view"]
        if not isinstance(view, dict) or view.get("mode") not in ("compare", "focus"):
            raise SessionValidationError("view.mode must be compare or focus")
        if not isinstance(view.get("activeId"), str) or view["activeId"] not in ids:
            raise SessionValidationError("view.activeId must be a variant id")
    if "designer" in value:
        _validate_designer(value["designer"], "designer")
    if "sample" in value and not isinstance(value["sample"], bool):
        raise SessionValidationError("sample must be a boolean")
    return value


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def state_revision(value: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def read_project_file(project: Path, relative: str, maximum: int = MAX_SOURCE_BYTES) -> bytes:
    """Read regular files beneath an open project directory, never following symlinks."""
    parts = _source_parts(relative, "source path")
    directory_fd = os.open(project, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    file_fd = None
    try:
        for part in parts[:-1]:
            next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
        if not stat.S_ISREG(os.fstat(file_fd).st_mode):
            raise SessionValidationError(f"{relative} must be a regular file")
        with os.fdopen(file_fd, "rb") as handle:
            file_fd = None
            raw = handle.read(maximum + 1)
        if len(raw) > maximum:
            raise SessionValidationError(f"{relative} is too large")
        return raw
    finally:
        if file_fd is not None:
            os.close(file_fd)
        os.close(directory_fd)


def decode_json(raw: bytes, label: str) -> Any:
    try:
        value = json.loads(raw.decode("utf-8"))
        canonical_json(value)  # Reject non-finite numbers even in extension metadata.
        return value
    except (UnicodeDecodeError, ValueError) as error:
        raise SessionValidationError(f"{label} is invalid UTF-8 JSON: {error}") from error


def hydrate_session(project: Path, document: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Resolve author files, filling only missing values; existing live/reset state wins."""
    validate_session(document)
    state = copy.deepcopy(document)
    hashes: dict[str, str] = {}
    if state["version"] == 1:
        return state, hashes
    for variant in state["variants"]:
        sources = variant["sources"]
        for kind, relative in sources.items():
            raw = read_project_file(project, relative)
            hashes[relative] = hashlib.sha256(raw).hexdigest()
            if kind == "controls":
                controls = decode_json(raw, relative)
                if not isinstance(controls, dict) or set(controls) != {"version", "tokens", "tweaks"} or type(controls["version"]) is not int or controls["version"] != 1:
                    raise SessionValidationError(f"{relative} requires version: 1, tokens, and tweaks")
                _validate_tokens(controls["tokens"], f"{relative}.tokens")
                _validate_tweaks(controls, relative)
                variant["tweaks"] = controls["tweaks"]
                variant.setdefault("baselineTokens", copy.deepcopy(controls["tokens"]))
                defaults = {definition["id"]: definition["default"] for definition in controls["tweaks"]}
                variant["tweakValues"] = {**defaults, **variant.get("tweakValues", {})}
                variant["baselineTweakValues"] = {**defaults, **variant.get("baselineTweakValues", {})}
            else:
                try:
                    variant[kind] = raw.decode("utf-8")
                except UnicodeDecodeError as error:
                    raise SessionValidationError(f"{relative} must be UTF-8 text") from error
        variant.setdefault("tweaks", [])
        variant.setdefault("baselineTokens", copy.deepcopy(variant["tokens"]))
        variant.setdefault("tweakValues", {})
        variant.setdefault("baselineTweakValues", {})
    validate_session(state, hydrated=True)
    return state, hashes


def portable_session(state: dict[str, Any]) -> dict[str, Any]:
    """Make a self-contained inline session from a hydrated API state."""
    result = copy.deepcopy(state)
    result["version"] = 1
    for variant in result["variants"]:
        variant.pop("sources", None)
    return validate_session(result)


class SessionStore:
    """Read cached-valid state and perform atomic conditional writes."""

    def __init__(self, project: Path):
        self.project = Path(project).expanduser().resolve()
        if not self.project.is_dir():
            raise ValueError(f"project directory does not exist: {self.project}")
        self.session_path = self.project / SESSION_NAME
        self._last_valid_state: dict[str, Any] | None = None
        self._last_valid_revision: str | None = None
        self._last_error: str | None = None
        self._lock = threading.RLock()

    @property
    def last_valid_state(self) -> dict[str, Any] | None:
        return copy.deepcopy(self._last_valid_state) if self._last_valid_state is not None else None

    @property
    def last_valid_revision(self) -> str | None:
        return self._last_valid_revision

    def _read_record(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, str], str]:
        document = decode_json(read_project_file(self.project, SESSION_NAME, MAX_BODY_BYTES), SESSION_NAME)
        state, hashes = hydrate_session(self.project, document)
        revision = state_revision({"session": document, "sources": hashes}) if hashes else state_revision(document)
        return document, state, hashes, revision

    def _read_disk(self) -> tuple[dict[str, Any], str]:
        _, state, _, revision = self._read_record()
        return state, revision

    def snapshot(self) -> tuple[dict[str, Any], str, str | None]:
        with self._lock:
            try:
                state, revision = self._read_disk()
            except (OSError, SessionValidationError) as error:
                self._last_error = str(error)
                if self._last_valid_state is None or self._last_valid_revision is None:
                    raise
                return copy.deepcopy(self._last_valid_state), self._last_valid_revision, self._last_error
            self._last_valid_state = copy.deepcopy(state)
            self._last_valid_revision = revision
            self._last_error = None
            return state, revision, None

    def save_if_revision(self, state: Any, expected_revision: str) -> tuple[dict[str, Any], str]:
        if not isinstance(expected_revision, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_revision):
            raise ValueError("revision must be a SHA-256 hex digest")
        with self._lock:
            try:
                document, current_state, hashes, current_revision = self._read_record()
            except (OSError, SessionValidationError) as error:
                raise InvalidCurrentState(
                    str(error), self.last_valid_state, self.last_valid_revision
                ) from error
            if current_revision != expected_revision:
                self._last_valid_state = copy.deepcopy(current_state)
                self._last_valid_revision = current_revision
                self._last_error = None
                raise RevisionConflict(current_state, current_revision)
            if document["version"] == 1:
                candidate = copy.deepcopy(validate_session(state))
                if candidate["version"] != 1:
                    raise SessionValidationError("Use migrate_session.py to change the storage format")
                resolved = candidate
            else:
                candidate = self._merge_mutable_state(document, current_state, state)
                resolved, candidate_hashes = hydrate_session(self.project, candidate)
                if hashes != candidate_hashes:
                    latest, revision = self._read_disk()
                    raise RevisionConflict(latest, revision)
            self._atomic_write(candidate)
            revision = state_revision({"session": candidate, "sources": hashes}) if hashes else state_revision(candidate)
            self._last_valid_state = copy.deepcopy(resolved)
            self._last_valid_revision = revision
            self._last_error = None
            return copy.deepcopy(resolved), revision

    @staticmethod
    def _merge_mutable_state(document: dict[str, Any], current: dict[str, Any], incoming: Any) -> dict[str, Any]:
        if not isinstance(incoming, dict) or incoming.get("version") != 2:
            raise SessionValidationError("A file-backed session requires a version 2 browser state")
        variants = incoming.get("variants")
        if not isinstance(variants, list) or any(not isinstance(v, dict) or not isinstance(v.get("id"), str) for v in variants):
            raise SessionValidationError("variants must contain the existing variant ids")
        by_id = {v["id"]: v for v in variants}
        if len(by_id) != len(variants) or set(by_id) != {v["id"] for v in current["variants"]}:
            raise SessionValidationError("Variant structure changed; load the current server version before saving")
        result = copy.deepcopy(document)
        for key in ("title", "brief", "selectedId", "viewport", "view"):
            if key in incoming:
                result[key] = copy.deepcopy(incoming[key])
        for variant, resolved in zip(result["variants"], current["variants"]):
            # Persist any newly introduced defaults, but never accept a browser's
            # source paths, metadata, author content, or reset-baseline changes.
            for key in ("baselineTokens", "baselineTweakValues", "tweakValues"):
                variant[key] = copy.deepcopy(resolved[key])
            for key in ("tokens", "tweakValues", "notes"):
                if key in by_id[variant["id"]]:
                    variant[key] = copy.deepcopy(by_id[variant["id"]][key])
        return validate_session(result)

    def _atomic_write(self, state: dict[str, Any]) -> None:
        self.project.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix=".session.", suffix=".tmp", dir=self.project)
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(state, handle, ensure_ascii=False, indent=2, allow_nan=False)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, self.session_path)
            try:
                directory_fd = os.open(self.project, os.O_RDONLY)
            except OSError:
                directory_fd = None
            if directory_fd is not None:
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def make_handler(store: SessionStore, assets: Path = ASSET_DIR):
    assets = Path(assets).resolve()
    static_files = {
        "/": (assets / "index.html", "text/html; charset=utf-8"),
        "/index.html": (assets / "index.html", "text/html; charset=utf-8"),
        "/styles.css": (assets / "styles.css", "text/css; charset=utf-8"),
        "/app.js": (assets / "app.js", "text/javascript; charset=utf-8"),
        "/i18n.js": (assets / "i18n.js", "text/javascript; charset=utf-8"),
        "/preview.js": (assets / "preview.js", "text/javascript; charset=utf-8"),
        "/legacy-v1.css": (assets / "legacy-v1.css", "text/css; charset=utf-8"),
    }

    class WorkbenchHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, format: str, *args: Any) -> None:
            # Keep the local design lab quiet; startup/errors are still reported by the CLI.
            return

        def _path(self) -> str:
            raw_path = urlsplit(self.path).path
            decoded = unquote(raw_path)
            if "\x00" in decoded or "\\" in decoded or any(part == ".." for part in decoded.split("/")):
                raise ValueError("path traversal is not allowed")
            return decoded

        def _origin_allowed(self) -> bool:
            origin = self.headers.get("Origin")
            if not origin:
                return True
            return origin in self.server.allowed_origins  # type: ignore[attr-defined]

        def _host_allowed(self) -> bool:
            host = self.headers.get("Host", "").lower()
            return host in self.server.allowed_hosts  # type: ignore[attr-defined]

        def _send_json(self, status: int, value: Any) -> None:
            body = _json_bytes(value)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Vary", "Origin")
            self.end_headers()
            self.wfile.write(body)

        def _send_text(self, status: int, text: str, content_type: str = "text/plain; charset=utf-8") -> None:
            body = text.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _api_forbidden(self) -> bool:
            if self._origin_allowed() and self._host_allowed():
                return False
            error = "foreign_origin" if not self._origin_allowed() else "invalid_host"
            self._send_json(HTTPStatus.FORBIDDEN, {"error": error, "message": "Only this local loopback host may use the state endpoint."})
            return True

        def do_GET(self) -> None:  # noqa: N802
            try:
                path = self._path()
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_path", "message": str(error)})
                return
            if path == "/api/state":
                if self._api_forbidden():
                    return
                try:
                    state, revision, warning = store.snapshot()
                except (OSError, SessionValidationError) as error:
                    self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "invalid_state", "message": str(error)})
                    return
                payload: dict[str, Any] = {"state": state, "revision": revision}
                if warning:
                    payload["warning"] = warning
                self._send_json(HTTPStatus.OK, payload)
                return
            if path not in static_files:
                self._send_text(HTTPStatus.NOT_FOUND, "Not found\n")
                return
            file_path, content_type = static_files[path]
            try:
                body = file_path.read_bytes()
            except OSError:
                self._send_text(HTTPStatus.INTERNAL_SERVER_ERROR, "Asset unavailable\n")
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self) -> None:  # noqa: N802
            try:
                path = self._path()
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_path", "message": str(error)})
                return
            if path != "/api/state":
                self._send_text(HTTPStatus.NOT_FOUND, "Not found\n")
                return
            if self._api_forbidden():
                return
            try:
                content_length = int(self.headers.get("Content-Length", "-1"))
            except ValueError:
                content_length = -1
            if content_length < 0 or content_length > MAX_BODY_BYTES:
                self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large", "message": "Request body is missing or too large."})
                return
            raw_body = self.rfile.read(content_length)
            try:
                payload = decode_json(raw_body, "request body")
            except SessionValidationError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_json", "message": str(error)})
                return
            if not isinstance(payload, dict) or "state" not in payload or "revision" not in payload:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_payload", "message": "Payload must contain state and revision."})
                return
            try:
                state, revision = store.save_if_revision(payload["state"], payload["revision"])
            except RevisionConflict as error:
                self._send_json(HTTPStatus.CONFLICT, {"error": "revision_conflict", "message": str(error), "state": error.state, "revision": error.revision})
                return
            except InvalidCurrentState as error:
                self._send_json(HTTPStatus.CONFLICT, {"error": "invalid_current_state", "invalidCurrent": True, "message": str(error), "state": error.state, "revision": error.revision})
                return
            except SessionValidationError as error:
                self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "invalid_state", "message": str(error)})
                return
            except ValueError as error:
                self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_revision", "message": str(error)})
                return
            self._send_json(HTTPStatus.OK, {"state": state, "revision": revision})

    return WorkbenchHandler


def create_server(project: Path, port: int = 8765) -> ThreadingHTTPServer:
    store = SessionStore(project)
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(store))
    server.daemon_threads = True
    actual_port = server.server_address[1]
    server.store = store  # type: ignore[attr-defined]
    server.allowed_origins = {  # type: ignore[attr-defined]
        f"http://127.0.0.1:{actual_port}",
        f"http://localhost:{actual_port}",
    }
    server.allowed_hosts = {  # type: ignore[attr-defined]
        f"127.0.0.1:{actual_port}",
        f"localhost:{actual_port}",
        "127.0.0.1",
        "localhost",
    }
    return server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve a local Design Workbench session")
    parser.add_argument("--project", required=True, type=Path, help="directory containing session.json")
    parser.add_argument("--port", type=int, default=8765, help="loopback port (default: 8765)")
    args = parser.parse_args()
    if not 0 <= args.port <= 65_535:
        parser.error("--port must be between 0 and 65535")
    if not args.project.expanduser().is_dir():
        parser.error(f"--project must be an existing directory: {args.project}")
    return args


def main() -> int:
    args = parse_args()
    server = create_server(args.project.expanduser(), args.port)
    port = server.server_address[1]
    print(f"Design Workbench: http://127.0.0.1:{port}/")
    print(f"Project: {Path(args.project).expanduser().resolve()}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
