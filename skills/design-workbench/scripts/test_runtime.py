#!/usr/bin/env python3
"""Focused stdlib tests for the local Design Workbench runtime."""

from __future__ import annotations

import importlib.util
import copy
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


SCRIPT_DIR = Path(__file__).resolve().parent


def load_module(name: str, path: Path):
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Unable to load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


serve = load_module("workbench_serve", SCRIPT_DIR / "serve.py")
init_session = load_module("workbench_init_session", SCRIPT_DIR / "init_session.py")
migrate_session = load_module("workbench_migrate_session", SCRIPT_DIR / "migrate_session.py")


class SchemaTests(unittest.TestCase):
    def sample(self):
        state, _, warning = serve.SessionStore(init_session.EXAMPLE_SESSION.parent).snapshot()
        self.assertIsNone(warning)
        return serve.portable_session(state)

    def test_optional_schema_and_legacy_sessions(self):
        sample = self.sample()
        self.assertIs(serve.validate_session(sample), sample)
        for key in ("viewport", "view", "designer", "sample"):
            sample.pop(key, None)
        for variant in sample["variants"]:
            for key in ("css", "tweaks", "tweakValues", "baselineTweakValues", "designer", "summary"):
                variant.pop(key, None)
        self.assertIs(serve.validate_session(sample), sample)

    def test_malformed_optional_types_are_validation_errors(self):
        mutations = [
            lambda s: s.update(viewport=[]),
            lambda s: s["viewport"].update(width=True),
            lambda s: s.update(view={"mode": [], "activeId": "A"}),
            lambda s: s["view"].update(activeId="missing"),
            lambda s: s["variants"][0].update(css={}),
            lambda s: s["variants"][0].update(tweaks={}),
            lambda s: s["variants"][0]["tweaks"][0].update(type=[]),
            lambda s: s["variants"][0]["tweaks"][0].update(attribute="data-size"),
            lambda s: s["variants"][0]["tweaks"][0].update(cssVar="--bad; color:red"),
            lambda s: s["variants"][0]["tweaks"][0].update(min=True),
            lambda s: s["variants"][0]["tweakValues"].update(titleSize=True),
            lambda s: s["variants"][0]["tweakValues"].update(missing="x"),
            lambda s: s["variants"][0]["tweaks"][2].update(options=[{}, {}]),
            lambda s: s.update(designer="Astra"),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                sample = self.sample()
                mutate(sample)
                with self.assertRaises(serve.SessionValidationError):
                    serve.validate_session(sample)


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(prefix="workbench-test-")
        self.project = Path(self.temp_dir.name) / "session"
        created, _ = init_session.initialize(self.project)
        self.assertTrue(created)
        self.server = serve.create_server(self.project, 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()
        self.temp_dir.cleanup()

    def request(self, method: str, path: str, payload=None, headers=None):
        body = None if payload is None else payload if isinstance(payload, bytes) else json.dumps(payload).encode("utf-8")
        request = Request(f"{self.base_url}{path}", data=body, headers=headers or {}, method=method)
        try:
            with urlopen(request, timeout=3) as response:
                raw = response.read().decode("utf-8")
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    data = raw
                return response.status, data
        except HTTPError as error:
            raw = error.read().decode("utf-8")
            error.close()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = raw
            return error.code, data

    def get_state(self):
        status, payload = self.request("GET", "/api/state")
        self.assertEqual(status, 200, payload)
        return payload

    def test_persistence_revision_conflict_and_atomic_save(self) -> None:
        initial = self.get_state()
        self.assertIsNone(initial["state"]["selectedId"])
        changed = json.loads(json.dumps(initial["state"]))
        changed["title"] = "ローカルで更新したタイトル"
        status, saved = self.request("POST", "/api/state", {"state": changed, "revision": initial["revision"]}, {"Content-Type": "application/json"})
        self.assertEqual(status, 200, saved)
        self.assertEqual(saved["state"]["title"], changed["title"])
        on_disk = json.loads((self.project / "session.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk["title"], changed["title"])
        self.assertEqual(list(self.project.glob(".session.*.tmp")), [])

        external = json.loads((self.project / "session.json").read_text(encoding="utf-8"))
        external["title"] = "エージェント側の更新"
        (self.project / "session.json").write_text(json.dumps(external, ensure_ascii=False), encoding="utf-8")
        stale = json.loads(json.dumps(changed))
        stale["title"] = "古いブラウザの下書き"
        status, conflict = self.request("POST", "/api/state", {"state": stale, "revision": saved["revision"]}, {"Content-Type": "application/json"})
        self.assertEqual(status, 409)
        self.assertEqual(conflict["error"], "revision_conflict")
        self.assertEqual(conflict["state"]["title"], "エージェント側の更新")
        self.assertEqual(json.loads((self.project / "session.json").read_text(encoding="utf-8"))["title"], "エージェント側の更新")

    def test_invalid_json_is_rejected_and_last_valid_state_is_retained(self) -> None:
        initial = self.get_state()
        before = (self.project / "session.json").read_bytes()
        status, payload = self.request("POST", "/api/state", b"{invalid", {"Content-Type": "application/json"})
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid_json")
        self.assertEqual((self.project / "session.json").read_bytes(), before)

        (self.project / "session.json").write_text("{invalid on disk", encoding="utf-8")
        status, retained = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(retained["state"], initial["state"])
        self.assertIn("warning", retained)
        self.assertEqual(retained["revision"], initial["revision"])

    def test_traversal_and_foreign_origin_are_rejected(self) -> None:
        status, payload = self.request("GET", "/..%2Fsession.json")
        self.assertEqual(status, 400)
        self.assertEqual(payload["error"], "invalid_path")

        status, payload = self.request("GET", "/api/state", headers={"Origin": "https://foreign.example"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "foreign_origin")

        status, payload = self.request("GET", "/api/state", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "invalid_host")

        initial = self.get_state()
        status, payload = self.request(
            "POST",
            "/api/state",
            {"state": initial["state"], "revision": initial["revision"]},
            {"Content-Type": "application/json", "Origin": "https://foreign.example"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "foreign_origin")

    def test_invalid_disk_blocks_conditional_write(self) -> None:
        initial = self.get_state()
        (self.project / "session.json").write_text("not json", encoding="utf-8")
        changed = json.loads(json.dumps(initial["state"]))
        changed["title"] = "下書き"
        status, payload = self.request("POST", "/api/state", {"state": changed, "revision": initial["revision"]}, {"Content-Type": "application/json"})
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "invalid_current_state")
        self.assertTrue(payload["invalidCurrent"])
        self.assertEqual(payload["state"], initial["state"])
        self.assertEqual((self.project / "session.json").read_text(encoding="utf-8"), "not json")

    def test_empty_brief_fields_and_omitted_notes_are_valid(self) -> None:
        initial = self.get_state()
        changed = json.loads(json.dumps(initial["state"]))
        changed["brief"]["mood"] = ""
        changed["brief"]["avoid"] = ""
        for variant in changed["variants"]:
            variant.pop("notes", None)
        status, payload = self.request("POST", "/api/state", {"state": changed, "revision": initial["revision"]}, {"Content-Type": "application/json"})
        self.assertEqual(status, 200, payload)

        invalid_color = json.loads(json.dumps(payload["state"]))
        invalid_color["variants"][0]["tokens"]["accent"] = "#12345"
        status, error = self.request("POST", "/api/state", {"state": invalid_color, "revision": payload["revision"]}, {"Content-Type": "application/json"})
        self.assertEqual(status, 422)
        self.assertEqual(error["error"], "invalid_state")

    def test_init_does_not_overwrite_existing_session(self) -> None:
        output = Path(self.temp_dir.name) / "new-session"
        created, target = init_session.initialize(output)
        self.assertTrue(created)
        original = target.read_bytes()
        target.write_bytes(b'{"user":"content"}\n')
        created_again, same_target = init_session.initialize(output)
        self.assertFalse(created_again)
        self.assertEqual(target, same_target)
        self.assertEqual(target.read_bytes(), b'{"user":"content"}\n')
        self.assertNotEqual(target.read_bytes(), original)

    def test_assets_are_served_without_project_file_access(self) -> None:
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIsInstance(body, str)
        self.assertEqual(self.request("GET", "/A/index.html")[0], 404)

    def test_source_edit_conflicts_and_retry_cannot_revert_author_content(self):
        initial = self.get_state()
        draft = copy.deepcopy(initial["state"])
        draft["variants"][0]["notes"] = "この調整を残す"
        path = self.project / "A/index.html"
        path.write_text(path.read_text() + "\n<p>新しい著者編集</p>", encoding="utf-8")
        revised_source = path.read_bytes()
        status, conflict = self.request("POST", "/api/state", {"state": draft, "revision": initial["revision"]})
        self.assertEqual(status, 409)
        self.assertIn("新しい著者編集", conflict["state"]["variants"][0]["html"])
        status, saved = self.request("POST", "/api/state", {"state": draft, "revision": conflict["revision"]})
        self.assertEqual(status, 200, saved)
        self.assertIn("新しい著者編集", saved["state"]["variants"][0]["html"])
        self.assertEqual(saved["state"]["variants"][0]["notes"], "この調整を残す")
        self.assertEqual(path.read_bytes(), revised_source)
        manifest = json.loads((self.project / "session.json").read_text())
        self.assertFalse(any(key in manifest["variants"][0] for key in serve.AUTHORED_FIELDS))


class FileSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="workbench-files-")
        self.root = Path(self.temp_dir.name)
        self.project = self.root / "session"
        init_session.initialize(self.project)
        self.store = serve.SessionStore(self.project)

    def tearDown(self):
        self.temp_dir.cleanup()

    def sources(self):
        return {str(path.relative_to(self.project)): path.read_bytes() for path in self.project.glob("*/*") if path.is_file()}

    def test_init_split_layout_and_conflicts_never_overwrite(self):
        manifest = json.loads((self.project / "session.json").read_text())
        self.assertEqual(manifest["version"], 2)
        self.assertEqual(len(self.sources()), 9)
        for variant in manifest["variants"]:
            self.assertEqual(variant["sources"]["html"], f'{variant["id"]}/index.html')
            self.assertFalse(any(key in variant for key in serve.AUTHORED_FIELDS))
        output = self.root / "conflict"
        (output / "B").mkdir(parents=True)
        sentinel = output / "B/style.css"
        sentinel.write_bytes(b"keep my author file")
        with self.assertRaises(FileExistsError):
            init_session.initialize(output)
        self.assertEqual(sentinel.read_bytes(), b"keep my author file")
        self.assertFalse((output / "session.json").exists())
        self.assertFalse((output / "A").exists())

    def test_browser_saves_preserve_sources_metadata_and_reset_baselines(self):
        before = self.sources()
        initial, revision, _ = self.store.snapshot()
        candidate = copy.deepcopy(initial)
        variant = candidate["variants"][0]
        variant.update(html="stale", css="bad", tweaks=[], sources={"html": "outside"}, name="browser forged name")
        variant["baselineTokens"]["spacing"] = 99
        variant["baselineTweakValues"]["titleSize"] = 40
        variant["tokens"]["spacing"] = 30
        variant["tweakValues"]["titleSize"] = 39
        variant["notes"] = "残すメモ"
        candidate["selectedId"] = "B"
        candidate["view"] = {"mode": "focus", "activeId": "A"}
        saved, _ = self.store.save_if_revision(candidate, revision)
        self.assertEqual(self.sources(), before)
        self.assertEqual(saved["selectedId"], "B")
        self.assertEqual(saved["variants"][0]["notes"], "残すメモ")
        self.assertEqual(saved["variants"][0]["tokens"]["spacing"], 30)
        self.assertEqual(saved["variants"][0]["tweakValues"]["titleSize"], 39)
        for field in ("name", "html", "css", "tweaks", "sources", "baselineTokens", "baselineTweakValues"):
            self.assertEqual(saved["variants"][0][field], initial["variants"][0][field])
        self.assertEqual(saved["variants"][1], initial["variants"][1])
        portable = serve.portable_session(saved)
        self.assertEqual(portable["version"], 1)
        self.assertNotIn("sources", portable["variants"][0])
        standalone = self.root / "standalone"
        standalone.mkdir()
        (standalone / "session.json").write_text(json.dumps(portable))
        self.assertEqual(serve.SessionStore(standalone).snapshot()[0], portable)

    def test_all_source_bytes_participate_in_revision(self):
        for relative in ("A/index.html", "A/style.css", "A/controls.json"):
            with self.subTest(relative=relative):
                initial, revision, _ = self.store.snapshot()
                path = self.project / relative
                path.write_bytes(path.read_bytes() + b"\n")
                latest, updated, warning = self.store.snapshot()
                self.assertIsNone(warning)
                self.assertNotEqual(revision, updated)
                with self.assertRaises(serve.RevisionConflict):
                    self.store.save_if_revision(initial, revision)
                self.assertEqual(latest["variants"][0]["tokens"], initial["variants"][0]["tokens"])

    def test_control_defaults_only_fill_new_values_and_removed_controls_are_invalid(self):
        initial, revision, _ = self.store.snapshot()
        initial["variants"][0]["tweakValues"]["titleSize"] = 39
        self.store.save_if_revision(initial, revision)
        path = self.project / "A/controls.json"
        controls = json.loads(path.read_text())
        controls["tokens"]["spacing"] = 35
        controls["tweaks"][0]["default"] = 40
        controls["tweaks"].append({"id": "enabled", "label": "追加", "type": "toggle", "attribute": "data-enabled", "default": True})
        path.write_text(json.dumps(controls))
        latest, revision, warning = self.store.snapshot()
        self.assertIsNone(warning)
        variant = latest["variants"][0]
        self.assertEqual(variant["tokens"]["spacing"], 25)
        self.assertEqual(variant["baselineTokens"]["spacing"], 25)
        self.assertEqual(variant["tweakValues"]["titleSize"], 39)
        self.assertEqual(variant["baselineTweakValues"]["titleSize"], 36)
        self.assertTrue(variant["tweakValues"]["enabled"])
        self.assertTrue(variant["baselineTweakValues"]["enabled"])
        self.store.save_if_revision(latest, revision)
        controls["tweaks"].pop(0)
        path.write_text(json.dumps(controls))
        retained, _, warning = self.store.snapshot()
        self.assertEqual(retained, latest)
        self.assertIn("unknown control", warning)
        with self.assertRaises(serve.InvalidCurrentState):
            self.store.save_if_revision(latest, revision)

    def test_malformed_sources_keep_last_valid_state_and_block_writes(self):
        initial, revision, _ = self.store.snapshot()
        non_finite = json.loads((self.project / "A/controls.json").read_text())
        non_finite["tweaks"][0]["extension"] = float("nan")
        for relative, invalid in (("A/controls.json", b"[]"), ("A/controls.json", b"{invalid"), ("A/controls.json", json.dumps(non_finite).encode()), ("A/index.html", b"\xff"), ("A/style.css", b"\xff")):
            with self.subTest(relative=relative, invalid=invalid):
                path = self.project / relative
                original = path.read_bytes()
                path.write_bytes(invalid)
                retained, same_revision, warning = self.store.snapshot()
                self.assertTrue(warning)
                self.assertEqual(retained, initial)
                self.assertEqual(same_revision, revision)
                with self.assertRaises(serve.InvalidCurrentState):
                    self.store.save_if_revision(initial, revision)
                self.assertEqual(path.read_bytes(), invalid)
                path.write_bytes(original)

    def test_path_confinement_and_symlinks_are_rejected(self):
        manifest_path = self.project / "session.json"
        original = manifest_path.read_bytes()
        for relative in ("../outside.html", "/tmp/outside.html", "A/../B/index.html", "A\\index.html", "A//index.html"):
            manifest = json.loads(original)
            manifest["variants"][0]["sources"]["html"] = relative
            manifest_path.write_text(json.dumps(manifest))
            with self.assertRaises((serve.SessionValidationError, OSError)):
                serve.SessionStore(self.project).snapshot()
        manifest_path.write_bytes(original)
        external = self.root / "outside.html"
        external.write_text("private sentinel")
        path = self.project / "A/index.html"
        saved_html = path.read_bytes()
        path.unlink()
        path.symlink_to(external)
        with self.assertRaises(OSError):
            serve.SessionStore(self.project).snapshot()
        path.unlink()
        path.write_bytes(saved_html)
        (self.project / "A").rename(self.project / "original-A")
        (self.project / "A").symlink_to(self.project / "original-A", target_is_directory=True)
        with self.assertRaises(OSError):
            serve.SessionStore(self.project).snapshot()
        (self.project / "A").unlink()
        (self.project / "original-A").rename(self.project / "A")
        manifest_path.unlink()
        manifest_path.symlink_to(external)
        with self.assertRaises(OSError):
            serve.SessionStore(self.project).snapshot()
        self.assertEqual(external.read_text(), "private sentinel")

    def inline_project(self):
        inline = serve.portable_session(self.store.snapshot()[0])
        inline["variants"][0]["tokens"]["spacing"] = 30
        inline["variants"][0]["tweakValues"]["titleSize"] = 39
        inline["variants"][0]["notes"] = "移行前のメモ"
        inline["selectedId"] = "B"
        inline["view"] = {"mode": "focus", "activeId": "A"}
        target = self.root / "inline"
        target.mkdir()
        raw = (json.dumps(inline, ensure_ascii=False, indent=3) + "\n").encode()
        (target / "session.json").write_bytes(raw)
        return target, inline, raw

    def test_migration_snapshot_values_reset_notes_adoption_and_old_v1(self):
        project, inline, raw = self.inline_project()
        old_store = serve.SessionStore(project)
        state, revision, _ = old_store.snapshot()
        self.assertEqual(state, inline)
        old_store.save_if_revision(state, revision)
        (project / "session.json").write_bytes(raw)
        target, snapshot = migrate_session.migrate(project)
        self.assertEqual(snapshot.read_bytes(), raw)
        migrated, _, warning = serve.SessionStore(project).snapshot()
        self.assertIsNone(warning)
        self.assertEqual(serve.portable_session(migrated), inline)
        self.assertEqual(json.loads(target.read_text())["version"], 2)
        with self.assertRaises(ValueError):
            migrate_session.migrate(project)

    def test_migration_conflict_or_publish_failure_keeps_original(self):
        project, _, raw = self.inline_project()
        (project / "B").mkdir()
        with self.assertRaises(FileExistsError):
            migrate_session.migrate(project)
        self.assertEqual((project / "session.json").read_bytes(), raw)
        self.assertFalse((project / "A").exists())
        self.assertEqual(list(project.glob("session.inline-v1.*.json")), [])
        (project / "B").rmdir()
        with patch.object(migrate_session.SessionStore, "_atomic_write", side_effect=OSError("simulated publish failure")):
            with self.assertRaises(OSError):
                migrate_session.migrate(project)
        self.assertEqual((project / "session.json").read_bytes(), raw)
        self.assertFalse((project / "A").exists())
        self.assertEqual(next(project.glob("session.inline-v1.*.json")).read_bytes(), raw)

    def test_legacy_css_is_materialized_on_migration(self):
        project, inline, _ = self.inline_project()
        inline["variants"][0].pop("css")
        (project / "session.json").write_text(json.dumps(inline))
        migrate_session.migrate(project)
        self.assertEqual((project / "A/style.css").read_text(), (serve.ASSET_DIR / "legacy-v1.css").read_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
