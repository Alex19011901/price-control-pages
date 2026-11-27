#!/usr/bin/env python3
"""Describe the already-built public snapshot without recalculating any data."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

REPOSITORY = "Alex19011901/price-control-pages"
BRANCH = "main"
MANIFEST = "sync-manifest.json"
READY = "sync-ready.json"
MAX_FILES = 128
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024
SOURCE_DATA = (
    "current.json", "full.json", "purchase_history.json", "tracked_products.json",
    "mix_data.json", "produce_receipts.json", "aish_price_aliases.json",
    "invoice_price_slices.json",
)
REQUIRED = frozenset((*SOURCE_DATA, "index.html", "deployment.json"))
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
SAFE_PATH = re.compile(r"[A-Za-z0-9_./-]+\Z")
PRIVATE_SUFFIXES = (".pem", ".key", ".env", ".sqlite", ".sqlite-wal", ".sqlite-shm", ".db")


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def encoded(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def collect(site: Path) -> dict[str, bytes]:
    if site.is_symlink() or not site.is_dir():
        raise ValueError("Snapshot must be a real directory")
    files: dict[str, bytes] = {}
    total = 0
    for path in sorted(site.rglob("*")):
        if path.is_symlink():
            raise ValueError("Snapshot symbolic link: " + path.name)
        if path.is_dir():
            continue
        if not path.is_file():
            raise ValueError("Snapshot member is not a regular file")
        name = path.relative_to(site).as_posix()
        parts = name.split("/")
        if (not SAFE_PATH.fullmatch(name) or any(p in ("", ".", "..", ".git") for p in parts)
                or any(p.startswith(".env") for p in parts) or name.endswith(PRIVATE_SUFFIXES)):
            raise ValueError("Unsafe snapshot path: " + name)
        if name in (MANIFEST, READY):
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("Snapshot file exceeds size limit: " + name)
        raw = path.read_bytes()
        if len(raw) > MAX_FILE_BYTES:
            raise ValueError("Snapshot file grew beyond size limit: " + name)
        total += len(raw)
        if len(files) >= MAX_FILES or total > MAX_TOTAL_BYTES:
            raise ValueError("Snapshot exceeds total bounds")
        files[name] = raw
    if not REQUIRED <= set(files):
        raise ValueError("Snapshot is incomplete: " + ", ".join(sorted(REQUIRED - set(files))))
    return files


def build_manifest(site: Path, source_data: Path, commit: str) -> dict:
    """Hash copied bytes; outputs are the only files this function writes."""
    if not COMMIT.fullmatch(commit):
        raise ValueError("Exact checked-out Git commit required")
    files = collect(site)
    original_data = {}
    for name in SOURCE_DATA:
        source = source_data / name
        if source.is_symlink() or not source.is_file():
            raise ValueError("Source data must be a regular file: " + name)
        raw = source.read_bytes()
        json.loads(raw)
        original_data[name] = raw
        if files[name] != raw:
            raise ValueError("Source data changed while publishing: " + name)
    deployment = json.loads(files["deployment.json"])
    if deployment.get("commit") != commit or deployment.get("credentialsInSite") is not False:
        raise ValueError("Deployment does not identify the checked-out source")
    current, full = json.loads(files["current.json"]), json.loads(files["full.json"])
    if current["week"]["key"] != full["currentKey"]:
        raise ValueError("Current period differs between copied datasets")
    manifest = {
        "schema": "price-control-sync-manifest-v1", "repository": REPOSITORY,
        "branch": BRANCH, "commit": commit,
        "files": {name: {"bytes": len(raw), "sha256": digest(raw)} for name, raw in files.items()},
        "totalBytes": sum(map(len, files.values())),
    }
    manifest_raw = encoded(manifest)
    ready = {"schema": "price-control-sync-ready-v1", "commit": commit,
             "manifestSha256": digest(manifest_raw)}
    # Refuse a concurrently changed input before announcing a complete generation.
    if collect(site) != files or any((source_data / name).read_bytes() != raw
                                     for name, raw in original_data.items()):
        raise ValueError("Snapshot inputs changed during publication")
    (site / MANIFEST).write_bytes(manifest_raw)
    # The ready marker is last and binds the exact immutable manifest bytes.
    (site / READY).write_bytes(encoded(ready))
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", type=Path, required=True)
    parser.add_argument("--source-data", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    args = parser.parse_args()
    manifest = build_manifest(args.site, args.source_data, args.commit)
    print(json.dumps({"snapshotReady": True, "commit": manifest["commit"],
                      "files": len(manifest["files"]), "bytes": manifest["totalBytes"],
                      "sourceDataFilesUnchanged": len(SOURCE_DATA), "periodsRecalculated": 0}))


if __name__ == "__main__":
    main()
