#!/usr/bin/env python3
"""Explicit local API bridge: import files, export to a NEW directory, push by receipt.

Import never changes the input directory. Export writes a v2 author project with a
.library.json receipt; push changes only that receipt after a successful revision
check. This is not automatic or bidirectional synchronization.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/design-workbench/scripts"))
from file_layout import json_bytes, new_source_files, split_inline_session, write_exclusive  # noqa: E402
from serve import MAX_BODY_BYTES, SESSION_NAME, decode_json, hydrate_session, portable_session, read_project_file, validate_session  # noqa: E402

DEFAULT_URL = "http://127.0.0.1:8787"
RECEIPT_NAME = ".library.json"
REVISION = re.compile(r"[0-9a-f]{32}\Z")
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}\Z")
MAX_EXPORT_RESPONSE_BYTES = 32_000_000  # Includes JSON escaping and repeated portable source in safe previews.
KIT_FILE = re.compile(r"(?:kit\.json|tokens\.css|GUIDE\.md|examples/[A-Za-z0-9][A-Za-z0-9_-]{0,31}/(?:variant\.json|preview\.html))\Z")


class LibraryError(ValueError):
    pass


class RevisionConflict(LibraryError):
    pass


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise LibraryError("Local API redirects are refused")


def local_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
                 and not parsed.username and not parsed.password and parsed.path in {"", "/"}
                 and not parsed.query and not parsed.fragment and parsed.port is not None)
    except ValueError as error:
        raise LibraryError("--base-url must be an HTTP loopback origin with an explicit port") from error
    if not valid:
        raise LibraryError("--base-url must be an HTTP loopback origin with an explicit port")
    return value.rstrip("/")


def safe_directory(value: Path, *, new: bool = False) -> Path:
    """Reject symlinks before resolving; export requires an entirely new leaf."""
    path = Path(os.path.abspath(value.expanduser()))
    current = Path(path.anchor)
    for index, part in enumerate(path.parts[1:]):
        current /= part
        last = index == len(path.parts) - 2
        try:
            status = current.lstat()
        except FileNotFoundError:
            if new and last:
                return path
            raise LibraryError(f"Directory does not exist: {current}")
        if stat.S_ISLNK(status.st_mode):
            raise LibraryError(f"Symlink directories are refused: {current}")
        if not stat.S_ISDIR(status.st_mode):
            raise LibraryError(f"Not a directory: {current}")
    if new:
        raise LibraryError(f"Refusing to overwrite an existing export directory: {path}")
    return path


def load_source(directory: Path) -> dict[str, Any]:
    project = safe_directory(directory)
    original = read_project_file(project, SESSION_NAME, MAX_BODY_BYTES)
    document = decode_json(original, SESSION_NAME)
    state, hashes = hydrate_session(project, document)
    # Refuse a mixed snapshot if a author file or manifest changed while loading.
    if read_project_file(project, SESSION_NAME, MAX_BODY_BYTES) != original:
        raise LibraryError("The session changed during import; retry after saving")
    for relative, digest in hashes.items():
        if hashlib.sha256(read_project_file(project, relative)).hexdigest() != digest:
            raise LibraryError(f"Source changed during import: {relative}")
    return portable_session(state)


class Client:
    def __init__(self, base_url: str):
        self.base_url = local_url(base_url)
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method: str, path: str, payload: dict | None = None, *, max_response_bytes: int = MAX_BODY_BYTES + 8192) -> dict:
        data = None if payload is None else json_bytes(payload)
        if data is not None and len(data) > MAX_BODY_BYTES:
            raise LibraryError("Portable session exceeds the 1,500,000-byte API request limit")
        request = Request(self.base_url + path, data=data, method=method,
                          headers={"Content-Type": "application/json", "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(max_response_bytes + 1)
        except HTTPError as error:
            raw = error.read(MAX_BODY_BYTES + 8193)
            try:
                message = decode_json(raw, "API error")
            except ValueError:
                message = {}
            if error.code == 409:
                raise RevisionConflict(f"Revision conflict; files and receipt are unchanged. Load the latest design, kit or project and reconcile before retrying. Current revision: {message.get('revision', 'unknown')}") from error
            raise LibraryError(f"API {error.code}: {message.get('message', message.get('error', 'request refused'))}") from error
        except URLError as error:
            raise LibraryError(f"Local library is unavailable at {self.base_url}: {error.reason}") from error
        if len(raw) > max_response_bytes:
            raise LibraryError("API response is too large")
        result = decode_json(raw, "API response")
        if not isinstance(result, dict):
            raise LibraryError("API response must be an object")
        return result


def check_identifier(value: Any, entity: str = "design") -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise LibraryError(f"Invalid {entity} id")
    return value


def check_revision(value: Any) -> str:
    if not isinstance(value, str) or not REVISION.fullmatch(value):
        raise LibraryError("Invalid library revision")
    return value


def check_library(value: Any) -> dict:
    if not isinstance(value, dict) or set(value) != {"projectId", "kind"}:
        raise LibraryError("Invalid library metadata")
    if value["projectId"] is not None:
        check_identifier(value["projectId"], "project")
    if value["kind"] not in ("screen", "component"):
        raise LibraryError("Library kind must be screen or component")
    return {"projectId": value["projectId"], "kind": value["kind"]}


def import_design(directory: Path, base_url: str = DEFAULT_URL, title: str | None = None,
                  project_id: str | None = None, kind: str = "screen") -> dict:
    metadata = check_library({"projectId": project_id, "kind": kind})
    payload = {"state": load_source(directory), **metadata}
    if title is not None:
        payload["title"] = title
    # Do not write a receipt into an existing author's project.
    return Client(base_url).request("POST", "/api/designs", payload)


def list_projects(base_url: str = DEFAULT_URL) -> dict:
    return Client(base_url).request("GET", "/api/projects")


def create_project(name: str, base_url: str = DEFAULT_URL) -> dict:
    return Client(base_url).request("POST", "/api/projects", {"name": name})


def check_version(value: Any) -> int:
    if type(value) is not int or not 1 <= value <= 1_000_000:
        raise LibraryError("Kit version must be a positive integer")
    return value


def read_json_file(filename: Path) -> dict:
    filename = filename.expanduser()
    parent = safe_directory(filename.parent)
    value = decode_json(read_project_file(parent, filename.name, MAX_EXPORT_RESPONSE_BYTES), filename.name)
    if not isinstance(value, dict):
        raise LibraryError("JSON input must be an object")
    return value


def load_kit_content(filename: Path) -> dict:
    value = read_json_file(filename)
    if value.get("format") == "codex-design-kit":
        check_identifier(value.get("kitId"), "kit")
        check_version(value.get("version"))
        value = value.get("content")
    if not isinstance(value, dict) or type(value.get("formatVersion")) is not int or value["formatVersion"] != 1:
        raise LibraryError("Expected KitContent formatVersion 1 or an exported kit.json")
    return value  # The API validates token types, examples and provenance before saving.


def list_kits(base_url: str = DEFAULT_URL) -> dict:
    return Client(base_url).request("GET", "/api/kits")


def prepare_kit(source_file: Path, output_file: Path, base_url: str = DEFAULT_URL) -> dict:
    output_file = output_file.expanduser()
    parent = safe_directory(output_file.parent)
    if os.path.lexists(parent / output_file.name):
        raise LibraryError("Refusing to overwrite an existing prepared content file")
    response = Client(base_url).request("POST", "/api/kits/prepare", read_json_file(source_file))
    if not isinstance(response.get("content"), dict):
        raise LibraryError("API returned invalid prepared content")
    root_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        write_exclusive(root_fd, output_file.name, json_bytes(response["content"]))
        os.fsync(root_fd)
    finally:
        os.close(root_fd)
    return {"file": str(parent / output_file.name), "exampleCount": len(response["content"].get("examples", []))}


def create_kit(content_file: Path, base_url: str = DEFAULT_URL) -> dict:
    return Client(base_url).request("POST", "/api/kits", {"content": load_kit_content(content_file)})


def show_kit(identifier: str, version: int | None = None, base_url: str = DEFAULT_URL) -> dict:
    identifier = check_identifier(identifier, "kit")
    suffix = "" if version is None else f"/versions/{check_version(version)}"
    return Client(base_url).request("GET", f"/api/kits/{identifier}{suffix}")


def add_kit_version(identifier: str, content_file: Path, revision: str, summary: str, base_url: str = DEFAULT_URL) -> dict:
    identifier = check_identifier(identifier, "kit")
    return Client(base_url).request("POST", f"/api/kits/{identifier}/versions",
                                   {"revision": check_revision(revision), "content": load_kit_content(content_file), "summary": summary})


def project_kit(identifier: str, base_url: str = DEFAULT_URL) -> dict:
    return Client(base_url).request("GET", f"/api/projects/{check_identifier(identifier, 'project')}/kit")


def use_project_kit(identifier: str, kit_id: str | None, version: int | None, revision: str, base_url: str = DEFAULT_URL) -> dict:
    identifier = check_identifier(identifier, "project")
    selected = None if kit_id is None else check_identifier(kit_id, "kit")
    if (selected is None) != (version is None):
        raise LibraryError("Clearing a kit requires both kit id and version to be null")
    return Client(base_url).request("PATCH", f"/api/projects/{identifier}/kit",
                                   {"revision": check_revision(revision), "kitId": selected, "version": None if version is None else check_version(version)})


def write_kit_bundle(destination: Path, files: list) -> None:
    """Write only a new tree with descriptor-relative, no-follow exclusive creation."""
    prepared = {}
    for entry in files:
        if not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or not KIT_FILE.fullmatch(entry["path"]):
            raise LibraryError("Kit export contains an unsafe or unsupported file path")
        if entry["path"] in prepared or not isinstance(entry.get("content"), str):
            raise LibraryError("Kit export contains duplicate paths or invalid content")
        prepared[entry["path"]] = entry["content"].encode("utf-8")
    if not {"kit.json", "tokens.css", "GUIDE.md"}.issubset(prepared):
        raise LibraryError("Kit export is missing required files")
    destination.mkdir()
    root_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    directories = {"": root_fd}
    created_files = []
    created_dirs = []
    complete = False
    try:
        for relative, contents in prepared.items():
            parts = relative.split("/")
            parent = ""
            for component in parts[:-1]:
                directory = f"{parent}/{component}".lstrip("/")
                if directory not in directories:
                    os.mkdir(component, dir_fd=directories[parent])
                    fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directories[parent])
                    status = os.fstat(fd)
                    directories[directory] = fd
                    created_dirs.append((parent, component, directory, (status.st_dev, status.st_ino)))
                parent = directory
            identity = write_exclusive(directories[parent], parts[-1], contents)
            created_files.append((parent, parts[-1], identity))
        for fd in directories.values():
            os.fsync(fd)
        complete = True
    finally:
        if not complete:
            for parent, filename, identity in reversed(created_files):
                try:
                    status = os.stat(filename, dir_fd=directories[parent], follow_symlinks=False)
                    if (status.st_dev, status.st_ino) == identity:
                        os.unlink(filename, dir_fd=directories[parent])
                except FileNotFoundError:
                    pass
        for parent, component, directory, identity in reversed(created_dirs):
            os.close(directories[directory])
            if not complete:
                try:
                    status = os.stat(component, dir_fd=directories[parent], follow_symlinks=False)
                    if (status.st_dev, status.st_ino) == identity:
                        os.rmdir(component, dir_fd=directories[parent])
                except OSError:
                    pass
        os.close(root_fd)
        if not complete:
            try:
                destination.rmdir()
            except OSError:
                pass


def export_kit(identifier: str, directory: Path, version: int, base_url: str = DEFAULT_URL) -> dict:
    identifier = check_identifier(identifier, "kit")
    version = check_version(version)
    if ".." in directory.parts:
        raise LibraryError("Kit export destination must not contain traversal segments")
    destination = safe_directory(directory, new=True)
    response = Client(base_url).request("GET", f"/api/kits/{identifier}/versions/{version}/export", max_response_bytes=MAX_EXPORT_RESPONSE_BYTES)
    files = response.get("files")
    if not isinstance(files, list) or len(files) > 51:
        raise LibraryError("API returned an invalid kit bundle")
    manifests = [entry for entry in files if isinstance(entry, dict) and entry.get("path") == "kit.json"]
    if len(manifests) != 1 or not isinstance(manifests[0].get("content"), str):
        raise LibraryError("API returned an invalid kit manifest")
    manifest = decode_json(manifests[0]["content"].encode("utf-8"), "kit.json")
    if not isinstance(manifest, dict) or manifest.get("kitId") != identifier or manifest.get("version") != version or manifest.get("format") != "codex-design-kit":
        raise LibraryError("API returned an unexpected kit identity or version")
    write_kit_bundle(destination, files)
    return {"kitId": identifier, "version": version, "directory": str(destination), "fileCount": len(files)}


def export_design(identifier: str, directory: Path, base_url: str = DEFAULT_URL) -> dict:
    identifier = check_identifier(identifier)
    destination = safe_directory(directory, new=True)
    client = Client(base_url)
    response = client.request("GET", f"/api/designs/{identifier}/state")
    state = validate_session(response.get("state"))
    if state["version"] != 1 or state["id"] != identifier:
        raise LibraryError("API returned an unexpected design identity or format")
    revision = check_revision(response.get("revision"))
    document, files = split_inline_session(state)
    metadata = check_library(response.get("library", {"projectId": None, "kind": "screen"}))
    receipt = {"version": 1, "baseUrl": client.base_url, "designId": identifier, "revision": revision, "library": metadata}
    destination.mkdir()  # O_EXCL semantics for the whole export; no existing leaf is reused.
    try:
        with new_source_files(destination, files) as root_fd:
            created = []
            try:
                for filename, value in ((SESSION_NAME, document), (RECEIPT_NAME, receipt)):
                    identity = write_exclusive(root_fd, filename, json_bytes(value))
                    created.append((filename, identity))
                os.fsync(root_fd)
            except BaseException:
                for filename, identity in reversed(created):
                    status = os.stat(filename, dir_fd=root_fd, follow_symlinks=False)
                    if (status.st_dev, status.st_ino) == identity:
                        os.unlink(filename, dir_fd=root_fd)
                raise
    except BaseException:
        try:
            destination.rmdir()
        except OSError:
            pass
        raise
    return {"id": identifier, "directory": str(destination), "revision": revision}


def read_receipt(project: Path) -> tuple[dict, bytes]:
    raw = read_project_file(project, RECEIPT_NAME, 4096)
    value = decode_json(raw, RECEIPT_NAME)
    required = {"version", "baseUrl", "designId", "revision"}
    if (not isinstance(value, dict) or not required.issubset(value) or set(value) - required - {"library"}
            or type(value["version"]) is not int or value["version"] != 1):
        raise LibraryError("An export-generated .library.json receipt is required")
    if not isinstance(value["baseUrl"], str) or not isinstance(value["designId"], str):
        raise LibraryError("Invalid library receipt")
    local_url(value["baseUrl"])
    check_identifier(value["designId"])
    check_revision(value["revision"])
    if "library" in value:
        check_library(value["library"])
    return value, raw


def write_receipt(project: Path, receipt: dict, original: bytes) -> None:
    if read_project_file(project, RECEIPT_NAME, 4096) != original:
        raise LibraryError("Library updated, but the receipt changed concurrently. Export fresh before another push")
    directory_fd = os.open(project, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = f".library-{uuid.uuid4().hex}.tmp"
    try:
        write_exclusive(directory_fd, temporary, json_bytes(receipt))
        os.replace(temporary, RECEIPT_NAME, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
        os.fsync(directory_fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        os.close(directory_fd)


def push_design(directory: Path, base_url: str | None = None) -> dict:
    project = safe_directory(directory)
    receipt, original = read_receipt(project)
    if base_url is not None and local_url(base_url) != receipt["baseUrl"]:
        raise LibraryError("--base-url differs from the export receipt; export from the intended library")
    state = load_source(project)
    if state["id"] != receipt["designId"]:
        raise LibraryError("Session identity differs from the export receipt")
    response = Client(receipt["baseUrl"]).request("PUT", f"/api/designs/{receipt['designId']}/source", {"state": state, "revision": receipt["revision"]})
    receipt["revision"] = check_revision(response.get("revision"))
    if "library" in response:
        receipt["library"] = check_library(response["library"])
    write_receipt(project, receipt, original)
    return {"id": receipt["designId"], "directory": str(project), "revision": receipt["revision"]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", help=f"HTTP loopback origin (default {DEFAULT_URL}; push uses export receipt)")
    commands = parser.add_subparsers(dest="command", required=True)
    importer = commands.add_parser("import", help="Register a snapshot; leave source files unchanged")
    importer.add_argument("directory", type=Path)
    importer.add_argument("--title")
    importer.add_argument("--project", help="Assign this snapshot to an existing project id")
    importer.add_argument("--kind", choices=("screen", "component"), default="screen")
    exporter = commands.add_parser("export", help="Write a fresh v2 project and revision receipt")
    exporter.add_argument("id")
    exporter.add_argument("directory", type=Path)
    pusher = commands.add_parser("push", help="Conditionally replace library source from an exported project")
    pusher.add_argument("directory", type=Path)
    projects = commands.add_parser("projects", help="List or explicitly create library projects")
    project_commands = projects.add_subparsers(dest="project_command", required=True)
    project_list = project_commands.add_parser("list", help="List projects with screen and component counts")
    project_create = project_commands.add_parser("create", help="Create an empty project")
    project_create.add_argument("name")
    project_context = project_commands.add_parser("kit", help="Read the exact pinned kit content for a project")
    project_context.add_argument("id")
    project_use = project_commands.add_parser("use-kit", help="Pin a project to an immutable kit version")
    project_use.add_argument("id")
    project_use.add_argument("kit_id")
    project_use.add_argument("--version", required=True, type=int)
    project_use.add_argument("--revision", required=True)
    project_clear = project_commands.add_parser("clear-kit", help="Clear a project's kit selection")
    project_clear.add_argument("id")
    project_clear.add_argument("--revision", required=True)
    kits = commands.add_parser("kits", help="Prepare, version and export reusable Design Kits")
    kit_commands = kits.add_subparsers(dest="kit_command", required=True)
    kit_list = kit_commands.add_parser("list")
    kit_prepare = kit_commands.add_parser("prepare", help="Snapshot explicit sources into a NEW content JSON file")
    kit_prepare.add_argument("input", type=Path)
    kit_prepare.add_argument("output", type=Path)
    kit_create = kit_commands.add_parser("create", help="Create version 1 from content JSON or exported kit.json")
    kit_create.add_argument("content", type=Path)
    kit_show = kit_commands.add_parser("show")
    kit_show.add_argument("id")
    kit_show.add_argument("--version", type=int)
    kit_version = kit_commands.add_parser("version", help="Append a version with a current revision")
    kit_version.add_argument("id")
    kit_version.add_argument("content", type=Path)
    kit_version.add_argument("--revision", required=True)
    kit_version.add_argument("--summary", required=True)
    kit_export = kit_commands.add_parser("export", help="Export an immutable kit bundle to a NEW directory")
    kit_export.add_argument("id")
    kit_export.add_argument("directory", type=Path)
    kit_export.add_argument("--version", required=True, type=int)
    for command in (importer, exporter, pusher, projects, project_list, project_create, project_context, project_use, project_clear,
                    kits, kit_list, kit_prepare, kit_create, kit_show, kit_version, kit_export):
        command.add_argument("--base-url", default=argparse.SUPPRESS, help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.command == "import":
            result = import_design(args.directory, args.base_url or DEFAULT_URL, args.title, args.project, args.kind)
        elif args.command == "export":
            result = export_design(args.id, args.directory, args.base_url or DEFAULT_URL)
        elif args.command == "push":
            result = push_design(args.directory, args.base_url)
        elif args.command == "projects":
            base_url = args.base_url or DEFAULT_URL
            if args.project_command == "list":
                result = list_projects(base_url)
            elif args.project_command == "create":
                result = create_project(args.name, base_url)
            elif args.project_command == "kit":
                result = project_kit(args.id, base_url)
            elif args.project_command == "use-kit":
                result = use_project_kit(args.id, args.kit_id, args.version, args.revision, base_url)
            else:
                result = use_project_kit(args.id, None, None, args.revision, base_url)
        else:
            base_url = args.base_url or DEFAULT_URL
            if args.kit_command == "list":
                result = list_kits(base_url)
            elif args.kit_command == "prepare":
                result = prepare_kit(args.input, args.output, base_url)
            elif args.kit_command == "create":
                result = create_kit(args.content, base_url)
            elif args.kit_command == "show":
                result = show_kit(args.id, args.version, base_url)
            elif args.kit_command == "version":
                result = add_kit_version(args.id, args.content, args.revision, args.summary, base_url)
            else:
                result = export_kit(args.id, args.directory, args.version, base_url)
    except RevisionConflict as error:
        print(str(error), file=sys.stderr)
        return 3
    except (OSError, ValueError) as error:
        print(f"Library operation refused: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
