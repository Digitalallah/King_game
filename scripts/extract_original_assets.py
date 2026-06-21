#!/usr/bin/env python3
"""Prepare a local extraction workspace for original DOS game assets.

This script deliberately keeps generated and source binary assets under
`assets/original/`, which is ignored by Git. It does not create extracted PNGs
inside tracked directories.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import shutil

DEFAULT_ASSET_DIR = Path("assets/original")
BINARY_EXTENSIONS = {".exe", ".fnt", ".lib", ".dat", ".zip", ".rar", ".png", ".jpg", ".jpeg", ".gif", ".ovl", ".hlp"}


def copy_originals(source_dir: Path, target_dir: Path) -> list[Path]:
    """Copy known original binary files into the ignored local asset directory."""
    target_dir.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []

    for source_path in sorted(source_dir.iterdir()):
        if not source_path.is_file() or source_path.suffix.lower() not in BINARY_EXTENSIONS:
            continue

        target_path = target_dir / source_path.name
        shutil.copy2(source_path, target_path)
        copied.append(target_path)

    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy original DOS binaries to the ignored assets/original/ workspace.")
    parser.add_argument("source", type=Path, help="Directory containing local original DOS game files.")
    parser.add_argument("--target", type=Path, default=DEFAULT_ASSET_DIR, help="Ignored workspace for original assets.")
    args = parser.parse_args()

    if not args.source.is_dir():
        parser.error(f"source directory does not exist: {args.source}")

    copied = copy_originals(args.source, args.target)
    if copied:
        print("Copied original assets to ignored workspace:")
        for path in copied:
            print(f"- {path}")
    else:
        print("No supported original binary files found.")

    print("Keep extracted PNG files under assets/original/ as local-only artifacts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
