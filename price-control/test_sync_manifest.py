"""Snapshot publication must preserve data and describe one complete generation."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from build_sync_manifest import SOURCE_DATA, build_manifest, collect, MAX_FILE_BYTES

COMMIT = "1" * 40


class ManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.site, self.source = self.root / "site", self.root / "source"
        self.site.mkdir()
        self.source.mkdir()
        values = {name: {} for name in SOURCE_DATA}
        values.update({"current.json": {"week": {"key": "2026-11-27"}},
                       "full.json": {"currentKey": "2026-11-27", "periods": [{"key": "closed", "fixed": 123}]}})
        for name, value in values.items():
            # Deliberate CRLF and spacing: preserving semantic JSON is not enough.
            raw = (json.dumps(value, ensure_ascii=False, indent=3) + "\r\n").encode()
            (self.source / name).write_bytes(raw)
            (self.site / name).write_bytes(raw)
        (self.site / "index.html").write_text('<script src="assets/new-widget.js"></script>')
        (self.site / "assets").mkdir()
        (self.site / "assets/new-widget.js").write_text("window.example = 1;\n")
        (self.site / "deployment.json").write_text(json.dumps({"commit": COMMIT, "credentialsInSite": False}))

    def hashes(self, directory):
        return {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in directory.rglob("*") if p.is_file()}

    def test_preserves_every_input_byte_and_captures_future_nested_assets(self):
        source_before, site_before = self.hashes(self.source), self.hashes(self.site)
        manifest = build_manifest(self.site, self.source, COMMIT)
        self.assertEqual(self.hashes(self.source), source_before)
        self.assertEqual({k: v for k, v in self.hashes(self.site).items() if k in site_before}, site_before)
        self.assertEqual(set(manifest["files"]), set(site_before))
        self.assertIn("assets/new-widget.js", manifest["files"])
        self.assertEqual(manifest["totalBytes"], sum(p["bytes"] for p in manifest["files"].values()))
        ready = json.loads((self.site / "sync-ready.json").read_bytes())
        self.assertEqual(ready["commit"], COMMIT)
        self.assertEqual(ready["manifestSha256"], hashlib.sha256((self.site / "sync-manifest.json").read_bytes()).hexdigest())

    def test_repeated_generation_is_identical_and_does_not_hash_itself(self):
        first = build_manifest(self.site, self.source, COMMIT)
        first_hashes = self.hashes(self.site)
        self.assertEqual(build_manifest(self.site, self.source, COMMIT), first)
        self.assertEqual(self.hashes(self.site), first_hashes)
        self.assertNotIn("sync-ready.json", first["files"])
        self.assertNotIn("sync-manifest.json", first["files"])

    def test_different_json_serialization_is_rejected_before_announcing_ready(self):
        build_manifest(self.site, self.source, COMMIT)
        ready_before = (self.site / "sync-ready.json").read_bytes()
        path = self.site / "full.json"
        path.write_text(json.dumps(json.loads(path.read_bytes())))
        with self.assertRaisesRegex(ValueError, "Source data changed"):
            build_manifest(self.site, self.source, COMMIT)
        self.assertEqual((self.site / "sync-ready.json").read_bytes(), ready_before)

    def test_missing_required_data_is_rejected(self):
        (self.site / "produce_receipts.json").unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            build_manifest(self.site, self.source, COMMIT)
        self.assertFalse((self.site / "sync-ready.json").exists())

    def test_symlink_payload_and_root_are_rejected(self):
        (self.site / "linked.js").symlink_to(self.site / "assets/new-widget.js")
        with self.assertRaisesRegex(ValueError, "symbolic link"):
            collect(self.site)
        (self.site / "linked.js").unlink()
        alias = self.root / "alias"
        alias.symlink_to(self.site, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "real directory"):
            collect(alias)

    def test_private_file_and_oversized_file_are_rejected(self):
        (self.site / ".env").write_text("not-a-real-secret")
        with self.assertRaisesRegex(ValueError, "Unsafe snapshot path"):
            collect(self.site)
        (self.site / ".env").unlink()
        with (self.site / "large.bin").open("wb") as stream:
            stream.truncate(MAX_FILE_BYTES + 1)
        with self.assertRaisesRegex(ValueError, "size limit"):
            collect(self.site)

    def test_actual_source_revision_and_safe_deployment_are_required(self):
        with self.assertRaisesRegex(ValueError, "Exact checked-out"):
            build_manifest(self.site, self.source, "main")
        (self.site / "deployment.json").write_text(json.dumps({"commit": "2" * 40, "credentialsInSite": False}))
        with self.assertRaisesRegex(ValueError, "checked-out source"):
            build_manifest(self.site, self.source, COMMIT)
        (self.site / "deployment.json").write_text(json.dumps({"commit": COMMIT, "credentialsInSite": True}))
        with self.assertRaisesRegex(ValueError, "checked-out source"):
            build_manifest(self.site, self.source, COMMIT)

    def test_contradictory_current_period_is_rejected(self):
        raw = json.dumps({"week": {"key": "different"}}).encode()
        for directory in (self.source, self.site):
            (directory / "current.json").write_bytes(raw)
        with self.assertRaisesRegex(ValueError, "Current period differs"):
            build_manifest(self.site, self.source, COMMIT)


if __name__ == "__main__":
    unittest.main()
