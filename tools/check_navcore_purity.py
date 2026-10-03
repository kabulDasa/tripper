#!/usr/bin/env python3
"""Fail unless firmware/lib/navcore is pure C++17 (docs/design/architecture.md § Firmware layering).

Allowlist, not denylist: after stripping comments, every #include (and __has_include) must be
either a standard library header (<cmath>, <cstdint>, <array>, …: lowercase, no extension) or a
navcore header ("navcore/…"). Anything else — Arduino.h, Wire.h, esp_*.h, freertos/…, lvgl.h —
fails. A missing or empty navcore directory also fails, so the check can't pass by accident.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
NAVCORE = ROOT / "firmware/lib/navcore"
SOURCES = {".h", ".hpp", ".c", ".cc", ".cpp"}
INCLUDE_RE = re.compile(r'#\s*include\s*([<"][^>"]+[>"])|__has_include\s*\(\s*([<"][^>"]+[>"])\s*\)')
STD_RE = re.compile(r"^<[a-z_][a-z0-9_]*>$")  # <cmath>, <cstdint>, <string_view>
OWN_RE = re.compile(r'^"navcore/[A-Za-z0-9_./-]+\.h(pp)?"$')


def strip_comments(text: str) -> str:
    return re.sub(r"//[^\n]*", "", re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL))


def main() -> int:
    if not NAVCORE.is_dir():
        print(f"::error::{NAVCORE.relative_to(ROOT)} not found — purity check can't run")
        return 1
    files = sorted(p for p in NAVCORE.rglob("*") if p.suffix in SOURCES)
    if not files:
        print(f"::error::no C/C++ sources under {NAVCORE.relative_to(ROOT)}")
        return 1
    bad = []
    for f in files:
        text = strip_comments(f.read_text(encoding="utf-8"))
        for m in INCLUDE_RE.finditer(text):
            inc = m.group(1) or m.group(2)
            if not (STD_RE.match(inc) or OWN_RE.match(inc)):
                line = text.count("\n", 0, m.start()) + 1
                bad.append(f"{f.relative_to(ROOT)}:{line}: {inc}")
    if bad:
        print("::error::navcore must stay pure C++17 — only <std> and \"navcore/…\" includes allowed "
              "(docs/design/architecture.md § Firmware layering):")
        print("\n".join(f"  {b}" for b in bad))
        return 1
    print(f"navcore purity OK ({len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
