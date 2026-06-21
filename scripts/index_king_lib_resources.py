#!/usr/bin/env python3
"""Index graphic-looking resources in the DOS KING.LIB archive.

The game stores KING.LIB as a packed binary blob and references it through
16-bit offset tables embedded in the DOS executables.  This tool does not write
copyrighted extracted artwork into the repository: it prints a textual index and
can write a local-only Markdown/CSV report for binaries placed under
``assets/original/``.
"""
from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path

DEFAULT_LIB = Path("assets/original/KING.LIB")
DEFAULT_EXES = (Path("assets/original/KING.EXE"), Path("assets/original/KING2.EXE"))
DEFAULT_MD = Path("assets/original/king-lib-resource-index.md")
DEFAULT_CSV = Path("assets/original/king-lib-resource-index.csv")

KNOWN_ROLES = {
    (52, 60): "card/contract sprite",
    (18, 26): "small button/icon",
    (18, 27): "small button/icon",
    (16, 13): "tiny control marker/button",
    (60, 14): "menu/button strip",
    (61, 14): "menu/button strip",
    (76, 37): "dialog/menu panel",
    (197, 86): "results/table panel",
    (264, 54): "score/table strip",
    (156, 108): "portrait or splash panel",
    (320, 88): "wide background/table/menu band",
}

@dataclass(frozen=True)
class Header:
    offset: int
    width: int
    height: int
    length_to_next: int | None
    source: str


def read(path: Path) -> bytes:
    try:
        return path.read_bytes()
    except FileNotFoundError as exc:
        raise SystemExit(f"Missing {path}. Copy original files with scripts/extract_original_assets.py first.") from exc


def offset_tables(exe: Path, lib_len: int, min_run: int = 16) -> list[list[int]]:
    data = read(exe)
    tables: list[list[int]] = []
    i = 0
    while i < len(data) - 2 * min_run:
        vals = []
        j = i
        last = -1
        while j + 2 <= len(data):
            v = int.from_bytes(data[j:j + 2], "little")
            if v > lib_len or (vals and v <= last):
                break
            vals.append(v)
            last = v
            j += 2
        if len(vals) >= min_run and vals[0] in (0, 1, 2, 4, 8, 16):
            tables.append(vals)
            i = j
        else:
            i += 1
    # de-duplicate suffix windows
    uniq: list[list[int]] = []
    seen = set()
    for t in tables:
        key = tuple(t)
        if key not in seen:
            uniq.append(t)
            seen.add(key)
    return uniq


def looks_like_header(data: bytes, off: int) -> tuple[int, int] | None:
    if off + 8 > len(data):
        return None
    w = int.from_bytes(data[off:off + 2], "little")
    h = int.from_bytes(data[off + 2:off + 4], "little")
    reserved = int.from_bytes(data[off + 4:off + 6], "little")
    first = int.from_bytes(data[off + 6:off + 8], "little")
    if not (4 <= w <= 640 and 4 <= h <= 480 and reserved == 0):
        return None
    # The RLE stream normally starts with a compact run/control word.
    if first > 0x00ff:
        return None
    return w, h


def scan_headers(data: bytes) -> list[Header]:
    offsets = []
    for off in range(len(data) - 8):
        wh = looks_like_header(data, off)
        if wh:
            offsets.append((off, *wh))
    # Prefer canonical paragraph-aligned starts when duplicate byte patterns also
    # occur inside a preceding compressed stream.
    canonical = []
    for off, w, h in offsets:
        if off % 16 == 0 or not any(0 < off - prev <= 128 and pw == w and ph == h for prev, pw, ph in offsets):
            canonical.append((off, w, h))
    result = []
    for idx, (off, w, h) in enumerate(canonical):
        nxt = canonical[idx + 1][0] if idx + 1 < len(canonical) else len(data)
        result.append(Header(off, w, h, nxt - off, "header-scan"))
    return result


def role(w: int, h: int) -> str:
    return KNOWN_ROLES.get((w, h), "unclassified graphic resource")


def write_reports(headers: list[Header], md_path: Path, csv_path: Path) -> None:
    md_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        wr = csv.writer(f)
        wr.writerow(["index", "offset_dec", "offset_hex", "width", "height", "length_to_next", "role"])
        for i, h in enumerate(headers):
            wr.writerow([i, h.offset, f"0x{h.offset:05x}", h.width, h.height, h.length_to_next, role(h.width, h.height)])
    lines = ["# KING.LIB graphic resource index", "", "| # | offset | size | bytes to next | contact-list label |", "|---:|---:|---:|---:|---|"]
    for i, h in enumerate(headers):
        lines.append(f"| {i} | `0x{h.offset:05x}` / {h.offset} | {h.width}x{h.height} | {h.length_to_next} | {role(h.width, h.height)} |")
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a complete textual index of graphic headers in KING.LIB.")
    ap.add_argument("--lib", type=Path, default=DEFAULT_LIB)
    ap.add_argument("--exe", type=Path, action="append", default=[])
    ap.add_argument("--markdown", type=Path, default=DEFAULT_MD)
    ap.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    args = ap.parse_args()
    data = read(args.lib)
    headers = scan_headers(data)
    write_reports(headers, args.markdown, args.csv)

    exes = args.exe or [p for p in DEFAULT_EXES if p.exists()]
    print(f"KING.LIB bytes: {len(data)}")
    for exe in exes:
        tables = offset_tables(exe, len(data))
        print(f"{exe}: {len(tables)} candidate 16-bit offset table(s)")
        for t in tables[:5]:
            print(f"  entries={len(t):3d} first=0x{t[0]:05x} last=0x{t[-1]:05x}")
    print(f"Graphic headers found: {len(headers)}")
    print(f"Reports written:\n- {args.markdown}\n- {args.csv}")
    print("\nContact-list:")
    for i, h in enumerate(headers):
        print(f"{i:03d} 0x{h.offset:05x} {h.width:>3}x{h.height:<3} {role(h.width, h.height)}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
