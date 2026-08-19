#!/usr/bin/env python3
"""Safely install a completed, externally-produced edition package."""

import argparse
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_ARCHIVE_BYTES = 25 * 1024 * 1024
MAX_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_MEMBERS = 100
IMAGE_SUFFIXES = {".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"}


class PackageError(Exception):
    pass


def safe_name(info):
    name = info.filename
    if not name or "\\" in name or "\0" in name:
        raise PackageError(f"unsafe ZIP member name: {name!r}")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise PackageError(f"unsafe ZIP member path: {name}")
    mode = info.external_attr >> 16
    file_type = stat.S_IFMT(mode)
    if stat.S_ISLNK(mode) or file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
        raise PackageError(f"links and special files are forbidden: {name}")
    return path


def inspect(archive, edition_id):
    if archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise PackageError("package exceeds the 25 MiB archive limit")
    with zipfile.ZipFile(archive) as bundle:
        infos = bundle.infolist()
        if len(infos) > MAX_MEMBERS:
            raise PackageError("package has too many ZIP members")
        files = {}
        expanded = 0
        for info in infos:
            member = safe_name(info)
            key = member.as_posix().rstrip("/")
            if key in files:
                raise PackageError(f"duplicate ZIP member: {key}")
            files[key] = info
            if not info.is_dir():
                if info.file_size > MAX_FILE_BYTES:
                    raise PackageError(f"ZIP member exceeds the 10 MiB limit: {key}")
                expanded += info.file_size
        if expanded > MAX_EXPANDED_BYTES:
            raise PackageError("package exceeds the 50 MiB expanded limit")
        if "edition.json" not in files or files["edition.json"].is_dir():
            raise PackageError("package must contain one edition.json file")
        try:
            edition = json.loads(bundle.read(files["edition.json"]))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise PackageError(f"edition.json is not valid UTF-8 JSON: {error}") from error
        if not isinstance(edition, dict):
            raise PackageError("edition.json must contain a JSON object")
        if edition.get("schemaVersion") != 2:
            raise PackageError("edition.json schemaVersion must be exactly 2")
        if edition.get("id") != edition_id:
            raise PackageError("edition.json id must match --edition-id")
        if not edition_id or not __import__("re").fullmatch(r"\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*", edition_id):
            raise PackageError("edition id must be a dated lowercase slug")
        stories = edition.get("stories")
        if not isinstance(stories, list):
            raise PackageError("edition.json stories must be an array")
        expected = {"edition.json"}
        for story in stories:
            src = story.get("illustration", {}).get("src") if isinstance(story, dict) else None
            if not isinstance(src, str) or not src.startswith("/"):
                raise PackageError("every story must reference an absolute canonical image path")
            image = PurePosixPath(src[1:])
            if image.parts[:2] != ("images", edition_id) or image.suffix.lower() not in IMAGE_SUFFIXES:
                raise PackageError(f"image is not under /images/{edition_id}/ or has an unsupported type: {src}")
            expected.add(image.as_posix())
        actual = {name for name, info in files.items() if not info.is_dir()}
        extras, missing = actual - expected, expected - actual
        if extras:
            raise PackageError(f"unexpected package files: {', '.join(sorted(extras))}")
        if missing:
            raise PackageError(f"missing referenced images: {', '.join(sorted(missing))}")
        # Reading every accepted member verifies its CRC before anything is installed.
        contents = {name: bundle.read(files[name]) for name in expected}
        return edition, contents


def ingest(root, archive, edition_id):
    edition, contents = inspect(archive, edition_id)
    destinations = {"edition.json": root / "data" / f"{edition_id}.json"}
    destinations.update({name: root / name for name in contents if name != "edition.json"})
    existing = [str(path.relative_to(root)) for path in destinations.values() if path.exists()]
    if existing:
        raise PackageError(f"refusing to overwrite existing files: {', '.join(sorted(existing))}")

    with tempfile.TemporaryDirectory(prefix="msfk-ingest-") as temporary:
        validation_root = Path(temporary)
        (validation_root / "data").mkdir()
        shutil.copy2(root / "data" / "site-config.json", validation_root / "data" / "site-config.json")
        for name, content in contents.items():
            target = (validation_root / "data" / f"{edition_id}.json") if name == "edition.json" else validation_root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
        result = subprocess.run(
            ["node", str(root / "scripts" / "validate-edition.js"), str(validation_root)],
            cwd=root, text=True, capture_output=True
        )
        if result.returncode:
            raise PackageError(f"publisher validation failed:\n{result.stderr.strip() or result.stdout.strip()}")

    for name, content in contents.items():
        target = destinations[name]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return edition


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--edition-id", required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    try:
        ingest(args.root.resolve(), args.archive.resolve(), args.edition_id)
        print(f"Installed canonical edition {args.edition_id} and its referenced images.")
    except (PackageError, OSError, zipfile.BadZipFile) as error:
        print(f"ingestion failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
