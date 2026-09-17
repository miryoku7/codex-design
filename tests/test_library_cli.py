#!/usr/bin/env python3
"""Exercise the Python file/API bridge against a real, temporary Miniflare D1."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import library


def tree_bytes(path):
    return {str(file.relative_to(path)): file.read_bytes() for file in path.rglob("*") if file.is_file()}


class LibraryCLITest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="codex-library-cli-")
        # macOS /var and /tmp aliases are symlinks; use the real test root.
        cls.root = Path(cls.temporary.name).resolve()
        cls.server = subprocess.Popen(["node", "tests/cli-server.mjs", str(cls.root)], cwd=ROOT,
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        selector = selectors.DefaultSelector()
        selector.register(cls.server.stdout, selectors.EVENT_READ)
        if not selector.select(timeout=20):
            cls.server.terminate()
            _, error = cls.server.communicate(timeout=5)
            raise RuntimeError(f"Local test server did not start: {error}")
        line = cls.server.stdout.readline()
        selector.close()
        if not line:
            _, error = cls.server.communicate(timeout=5)
            raise RuntimeError(f"Local test server failed: {error}")
        cls.url = json.loads(line)["url"]
        cls.client = library.Client(cls.url)

    @classmethod
    def tearDownClass(cls):
        cls.server.stdin.close()
        cls.server.wait(timeout=10)
        cls.server.stdout.close()
        cls.server.stderr.close()
        cls.temporary.cleanup()

    def setUp(self):
        self.directory = self.root / self.id().split(".")[-1]
        self.directory.mkdir()
        self.source = self.directory / "source"
        shutil.copytree(ROOT / "skills/design-workbench/assets/workbench/example", self.source)
        manifest = json.loads((self.source / "session.json").read_text())
        manifest["selectedId"] = "B"
        manifest["variants"][0]["notes"] = "残すメモ"
        manifest["variants"][0]["tokens"]["spacing"] = 30
        (self.source / "session.json").write_bytes(library.json_bytes(manifest))

    def command(self, *arguments):
        return subprocess.run([sys.executable, str(ROOT / "scripts/library.py"), "--base-url", self.url, *map(str, arguments)],
                              cwd=ROOT, capture_output=True, text=True, timeout=20)

    def imported(self):
        return library.import_design(self.source, self.url)

    def test_import_export_keeps_authored_files_reset_notes_and_adoption(self):
        original = tree_bytes(self.source)
        result = self.command("import", self.source)
        self.assertEqual(result.returncode, 0, result.stderr)
        imported = json.loads(result.stdout)
        self.assertEqual(tree_bytes(self.source), original)
        self.assertNotEqual(imported["id"], library.load_source(self.source)["id"])
        output = self.directory / "export"
        result = self.command("export", imported["id"], output)
        self.assertEqual(result.returncode, 0, result.stderr)
        exported = library.load_source(output)
        expected = library.load_source(self.source)
        expected["id"] = imported["id"]
        self.assertEqual(exported, expected)
        document = json.loads((output / "session.json").read_text())
        self.assertEqual(document["version"], 2)
        self.assertNotIn("html", document["variants"][0])
        self.assertNotIn("css", document["variants"][0])
        self.assertNotIn("tweaks", document["variants"][0])
        receipt, _ = library.read_receipt(output)
        self.assertEqual(receipt, {"version": 1, "baseUrl": self.url, "designId": imported["id"], "revision": imported["revision"],
                                   "library": {"projectId": None, "kind": "screen"}})
        before = tree_bytes(output)
        refused = self.command("export", imported["id"], output)
        self.assertEqual(refused.returncode, 2)
        self.assertEqual(tree_bytes(output), before)
        empty = self.directory / "existing-empty"
        empty.mkdir()
        self.assertEqual(self.command("export", imported["id"], empty).returncode, 2)

    def test_push_is_conditional_preserves_local_files_and_refreshes_only_receipt(self):
        imported = self.imported()
        output = self.directory / "export"
        library.export_design(imported["id"], output, self.url)
        (output / "A/index.html").write_text("<main>新しい制作</main>\n")
        before = tree_bytes(output)
        pushed = self.command("push", output)
        self.assertEqual(pushed.returncode, 0, pushed.stderr)
        after = tree_bytes(output)
        self.assertNotEqual(after[library.RECEIPT_NAME], before[library.RECEIPT_NAME])
        self.assertEqual({key: value for key, value in after.items() if key != library.RECEIPT_NAME},
                         {key: value for key, value in before.items() if key != library.RECEIPT_NAME})
        server = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        self.assertEqual(server["state"], library.load_source(output))
        self.assertEqual(server["revision"], json.loads(pushed.stdout)["revision"])

    def test_stale_push_refuses_without_rewriting_receipt_or_browser_state(self):
        imported = self.imported()
        output = self.directory / "export"
        library.export_design(imported["id"], output, self.url)
        initial = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        changed = copy.deepcopy(initial["state"])
        changed["variants"][0]["notes"] = "ブラウザの新しいメモ"
        latest = self.client.request("POST", f"/api/designs/{imported['id']}/state", {"state": changed, "revision": initial["revision"]})
        (output / "A/index.html").write_text("<main>未反映の制作</main>")
        before = tree_bytes(output)
        result = self.command("push", output)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn("Revision conflict", result.stderr)
        self.assertEqual(tree_bytes(output), before)
        self.assertEqual(self.client.request("GET", f"/api/designs/{imported['id']}/state"), latest)

    def test_projects_commands_and_component_import_export_push_preserve_metadata(self):
        project_result = self.command("projects", "create", "部品のプロジェクト")
        self.assertEqual(project_result.returncode, 0, project_result.stderr)
        project = json.loads(project_result.stdout)
        self.assertEqual(project["name"], "部品のプロジェクト")
        self.assertEqual(project["designCount"], 0)
        before = tree_bytes(self.source)
        result = self.command("import", self.source, "--project", project["id"], "--kind", "component")
        self.assertEqual(result.returncode, 0, result.stderr)
        imported = json.loads(result.stdout)
        self.assertEqual(tree_bytes(self.source), before)
        listed = self.command("projects", "list")
        self.assertEqual(listed.returncode, 0, listed.stderr)
        counted = next(item for item in json.loads(listed.stdout)["projects"] if item["id"] == project["id"])
        self.assertEqual((counted["designCount"], counted["screenCount"], counted["componentCount"]), (1, 0, 1))
        output = self.directory / "component-export"
        self.assertEqual(self.command("export", imported["id"], output).returncode, 0)
        metadata = {"projectId": project["id"], "kind": "component"}
        receipt, _ = library.read_receipt(output)
        self.assertEqual(receipt["library"], metadata)
        document = json.loads((output / "session.json").read_text())
        self.assertNotIn("library", document)
        self.assertNotIn("projectId", document)
        self.assertNotIn("kind", document)
        (output / "A/index.html").write_text("<button>新しい部品</button>\n")
        self.assertEqual(self.command("push", output).returncode, 0)
        saved = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        self.assertEqual(saved["library"], metadata)
        self.assertEqual(saved["state"], library.load_source(output))
        self.assertEqual(library.read_receipt(output)[0]["library"], metadata)

    def test_legacy_receipt_push_keeps_server_assignment_and_refreshes_metadata(self):
        project = library.create_project("旧receipt互換", self.url)
        imported = library.import_design(self.source, self.url, project_id=project["id"], kind="component")
        output = self.directory / "legacy-export"
        library.export_design(imported["id"], output, self.url)
        receipt, _ = library.read_receipt(output)
        del receipt["library"]  # A receipt generated before library metadata existed.
        (output / library.RECEIPT_NAME).write_bytes(library.json_bytes(receipt))
        self.assertEqual(library.read_receipt(output)[0], receipt)
        (output / "A/style.css").write_text("button { border-radius: 8px; }\n")
        before = tree_bytes(output)
        result = self.command("push", output)
        self.assertEqual(result.returncode, 0, result.stderr)
        metadata = {"projectId": project["id"], "kind": "component"}
        saved = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        self.assertEqual(saved["library"], metadata)
        self.assertEqual(library.read_receipt(output)[0]["library"], metadata)
        self.assertEqual({key: value for key, value in tree_bytes(output).items() if key != library.RECEIPT_NAME},
                         {key: value for key, value in before.items() if key != library.RECEIPT_NAME})

    def test_metadata_change_invalidates_export_and_cannot_be_undone_by_stale_push(self):
        imported = self.imported()
        output = self.directory / "stale-metadata-export"
        library.export_design(imported["id"], output, self.url)
        project = library.create_project("移動先", self.url)
        self.client.request("PATCH", f"/api/designs/{imported['id']}/metadata",
                            {"revision": imported["revision"], "projectId": project["id"], "kind": "component"})
        latest = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        (output / "A/index.html").write_text("<main>未反映の制作</main>\n")
        before = tree_bytes(output)
        result = self.command("push", output)
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertEqual(tree_bytes(output), before)
        self.assertEqual(self.client.request("GET", f"/api/designs/{imported['id']}/state"), latest)

    def test_invalid_project_kind_and_receipt_metadata_are_refused(self):
        before = tree_bytes(self.source)
        for args in [("--project", "missing"), ("--project", "../bad"), ("--kind", "unknown")]:
            result = self.command("import", self.source, *args)
            self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(tree_bytes(self.source), before)
        self.assertEqual(self.command("projects", "create", " ").returncode, 2)
        imported = self.imported()
        output = self.directory / "invalid-receipt-export"
        library.export_design(imported["id"], output, self.url)
        receipt, _ = library.read_receipt(output)
        for metadata in ({"projectId": "../bad", "kind": "screen"}, {"projectId": None, "kind": "unknown"}, {"kind": "screen"}):
            receipt["library"] = metadata
            (output / library.RECEIPT_NAME).write_bytes(library.json_bytes(receipt))
            unchanged = tree_bytes(output)
            self.assertEqual(self.command("push", output).returncode, 2)
            self.assertEqual(tree_bytes(output), unchanged)
        self.assertEqual(self.client.request("GET", f"/api/designs/{imported['id']}/state")["revision"], imported["revision"])

    def test_source_paths_symlinks_and_controls_are_rejected_before_import(self):
        document = json.loads((self.source / "session.json").read_text())
        document["variants"][0]["sources"]["html"] = "../outside.html"
        (self.source / "session.json").write_bytes(library.json_bytes(document))
        with self.assertRaises(ValueError):
            library.import_design(self.source, self.url)
        document["variants"][0]["sources"]["html"] = "A/index.html"
        (self.source / "session.json").write_bytes(library.json_bytes(document))
        html = self.source / "A/index.html"
        contents = html.read_bytes()
        html.unlink()
        html.symlink_to(self.source / "B/index.html")
        with self.assertRaises((ValueError, OSError)):
            library.load_source(self.source)
        html.unlink()
        html.write_bytes(contents)
        controls = self.source / "A/controls.json"
        definition = json.loads(controls.read_text())
        definition["unexpected"] = True
        controls.write_bytes(library.json_bytes(definition))
        with self.assertRaises(ValueError):
            library.load_source(self.source)
        link = self.directory / "linked-source"
        link.symlink_to(self.source, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Symlink"):
            library.load_source(link)

    def test_kits_prepare_version_export_roundtrip_and_exact_project_pin(self):
        imported = self.imported()
        original_source = tree_bytes(self.source)
        recipe = self.directory / "recipe.json"
        recipe.write_bytes(library.json_bytes({"name": "共有キット", "sources": [{"designId": imported["id"], "variantId": "A", "revision": imported["revision"]}]}))
        prepared = self.directory / "content.json"
        result = self.command("kits", "prepare", recipe, prepared)
        self.assertEqual(result.returncode, 0, result.stderr)
        content = json.loads(prepared.read_text())
        self.assertEqual(content["examples"][0]["source"]["variantId"], "A")
        self.assertEqual(content["examples"][0]["variant"]["notes"], "残すメモ")
        self.assertEqual(next(item for item in content["tokens"] if item["name"] == "spacing")["value"], "30px")
        prepared_bytes = prepared.read_bytes()
        self.assertEqual(self.command("kits", "prepare", recipe, prepared).returncode, 2)
        self.assertEqual(prepared.read_bytes(), prepared_bytes)
        self.assertEqual(tree_bytes(self.source), original_source)
        created = self.command("kits", "create", prepared)
        self.assertEqual(created.returncode, 0, created.stderr)
        kit = json.loads(created.stdout)
        self.assertEqual(kit["latestVersion"], 1)
        self.assertEqual(json.loads(self.command("kits", "show", kit["id"], "--version", 1).stdout)["content"], content)
        self.assertTrue(any(item["id"] == kit["id"] for item in json.loads(self.command("kits", "list").stdout)["kits"]))
        project = library.create_project("キット利用先", self.url)
        pinned = self.command("projects", "use-kit", project["id"], kit["id"], "--version", 1, "--revision", project["revision"])
        self.assertEqual(pinned.returncode, 0, pinned.stderr)
        project = json.loads(pinned.stdout)
        before_design = self.client.request("GET", f"/api/designs/{imported['id']}/state")
        content["tokens"][0]["value"] = "#aa2233"
        content["rules"] = "余白と文字のルールを明文化。"
        prepared.write_bytes(library.json_bytes(content))
        updated = self.command("kits", "version", kit["id"], prepared, "--revision", kit["revision"], "--summary", "色とルールを更新")
        self.assertEqual(updated.returncode, 0, updated.stderr)
        version_two = json.loads(updated.stdout)
        self.assertEqual(version_two["latestVersion"], 2)
        current_context = self.command("projects", "kit", project["id"])
        self.assertEqual(current_context.returncode, 0, current_context.stderr)
        self.assertEqual(json.loads(current_context.stdout)["kit"], {"kitId": kit["id"], "version": 1, "content": kit["content"]})
        stale = self.command("kits", "version", kit["id"], prepared, "--revision", kit["revision"], "--summary", "stale")
        self.assertEqual(stale.returncode, 3, stale.stderr)
        self.assertEqual(self.client.request("GET", f"/api/designs/{imported['id']}/state"), before_design)
        output = self.directory / "kit-export"
        exported = self.command("kits", "export", kit["id"], output, "--version", 1)
        self.assertEqual(exported.returncode, 0, exported.stderr)
        manifest = json.loads((output / "kit.json").read_text())
        self.assertEqual(manifest["content"], kit["content"])
        self.assertEqual(manifest["version"], 1)
        self.assertIn('<iframe sandbox=""', (output / "examples/example-1/preview.html").read_text())
        before_output = tree_bytes(output)
        self.assertEqual(self.command("kits", "export", kit["id"], output, "--version", 1).returncode, 2)
        self.assertEqual(tree_bytes(output), before_output)
        linked = self.directory / "linked-kit-export"
        linked.symlink_to(output, target_is_directory=True)
        self.assertEqual(self.command("kits", "export", kit["id"], linked, "--version", 1).returncode, 2)
        self.assertEqual(tree_bytes(output), before_output)
        roundtrip = self.command("kits", "create", output / "kit.json")
        self.assertEqual(roundtrip.returncode, 0, roundtrip.stderr)
        self.assertNotEqual(json.loads(roundtrip.stdout)["id"], kit["id"])
        self.assertEqual(json.loads(roundtrip.stdout)["content"], kit["content"])
        cleared = self.command("projects", "clear-kit", project["id"], "--revision", project["revision"])
        self.assertEqual(cleared.returncode, 0, cleared.stderr)
        self.assertIsNone(json.loads(cleared.stdout)["kit"])
        self.assertIsNone(json.loads(self.command("projects", "kit", project["id"]).stdout)["kit"])

    def test_large_kit_bundle_uses_export_response_limit_and_remains_portable(self):
        imported = self.imported()
        content = self.client.request("POST", "/api/kits/prepare", {"sources": [{"designId": imported["id"], "variantId": "A", "revision": imported["revision"]}]})["content"]
        example = content["examples"][0]
        content["examples"] = []
        for index in range(3):
            item = copy.deepcopy(example)
            item["id"] = f"large-{index}"
            item["variant"]["html"] = f"<main>{'x' * 250000}</main>"
            content["examples"].append(item)
        filename = self.directory / "large.json"
        filename.write_bytes(library.json_bytes(content))
        self.assertLess(filename.stat().st_size, library.MAX_BODY_BYTES)
        created = self.command("kits", "create", filename)
        self.assertEqual(created.returncode, 0, created.stderr)
        kit = json.loads(created.stdout)
        output = self.directory / "large-export"
        result = self.command("kits", "export", kit["id"], output, "--version", 1)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertGreater(sum(len(value) for value in tree_bytes(output).values()), library.MAX_BODY_BYTES)
        self.assertEqual(json.loads((output / "kit.json").read_text())["content"], content)

    def test_kit_export_paths_duplicates_and_traversal_are_refused_before_creating_files(self):
        base = [{"path": path, "content": "{}"} for path in ("kit.json", "tokens.css", "GUIDE.md")]
        for index, path in enumerate(("../outside", "/absolute", "examples/../preview.html", "examples/link/../../outside", "examples/A/script.js")):
            output = self.directory / f"unsafe-{index}"
            with self.assertRaisesRegex(ValueError, "unsafe|unsupported"):
                library.write_kit_bundle(output, base + [{"path": path, "content": "danger"}])
            self.assertFalse(output.exists())
        with self.assertRaisesRegex(ValueError, "duplicate"):
            library.write_kit_bundle(self.directory / "duplicate", base + [base[0]])
        with self.assertRaisesRegex(ValueError, "traversal"):
            library.export_kit("valid", self.directory / ".." / "escape", 1, self.url)

    def test_receipt_and_destination_boundary(self):
        imported = self.imported()
        output = self.directory / "export"
        library.export_design(imported["id"], output, self.url)
        receipt = output / library.RECEIPT_NAME
        value = receipt.read_bytes()
        receipt.unlink()
        other = self.directory / "receipt-copy.json"
        other.write_bytes(value)
        receipt.symlink_to(other)
        with self.assertRaises((ValueError, OSError)):
            library.push_design(output)
        self.assertEqual(other.read_bytes(), value)
        with self.assertRaises(ValueError):
            library.export_design("../bad", self.directory / "new", self.url)
        for url in ("https://127.0.0.1:8787", "http://example.com:8787", "http://localhost:8787/api", "http://user:pass@localhost:8787"):
            with self.assertRaises(ValueError):
                library.Client(url)
        destination_link = self.directory / "linked-export"
        destination_link.symlink_to(self.source, target_is_directory=True)
        original = tree_bytes(self.source)
        with self.assertRaises(ValueError):
            library.export_design(imported["id"], destination_link, self.url)
        self.assertEqual(tree_bytes(self.source), original)


if __name__ == "__main__":
    unittest.main(verbosity=2)
