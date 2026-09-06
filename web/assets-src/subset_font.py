"""Build the subset character set for FZLTTHJW.TTF.

Three sources:
1. The small blocks the CSS unicode-range promises in full (general
   punctuation, CJK punctuation, fullwidth forms).
2. Every character in the shipped client source (web/**/*.ts,tsx) — this is
   what carries all UI strings from lib/translations.ts.
3. The GB2312 hanzi table, generated straight from the encoding. Covers
   typed chat and usernames in simplified Chinese. Anything rarer falls
   back to the system CJK font via the font-family stack.

Usage (from anywhere; paths resolve relative to this file):

    python3 web/assets-src/subset_font.py           # levels 1+2 (6763 chars)
    GB2312_LEVEL=1 python3 web/assets-src/subset_font.py   # 3755 common chars

Writes web/assets-src/font-chars.txt, consumed by the pyftsubset command in
README.md. See that file for the full regeneration pipeline.
"""

import os
import pathlib

here = pathlib.Path(__file__).resolve().parent
root = here.parent  # web/
exts = {".ts", ".tsx"}
skip_dirs = {"node_modules", ".next", "out", "public", "assets-src", "tests"}
chars: set[str] = set()


def add_range(lo: int, hi: int) -> None:
    for cp in range(lo, hi + 1):
        chars.add(chr(cp))


# 1. full small blocks promised by the CSS unicode-range
add_range(0x2000, 0x206F)  # – — ‘ ’ “ ” … ‰
add_range(0x3000, 0x303F)  # 、 。 《 》 「 」
add_range(0xFF00, 0xFFEF)  # ！ ？ ％ ： 全角字母数字

# 2. characters actually used by the client source
for p in root.rglob("*"):
    if not p.is_file() or p.suffix not in exts:
        continue
    if any(part in skip_dirs for part in p.parts):
        continue
    try:
        text = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        continue
    for ch in text:
        cp = ord(ch)
        if 0x2000 <= cp <= 0x206F or 0x3000 <= cp <= 0x9FFF or 0xFF00 <= cp <= 0xFFEF:
            chars.add(ch)

# 3. GB2312 hanzi. Levels 1+2 by default (6763 chars); GB2312_LEVEL=1 keeps
# only the 3755 pinyin-ordered common chars and lets rarer chat text fall
# back to the system CJK font.
hi_row = 0xD8 if os.environ.get("GB2312_LEVEL") == "1" else 0xF8
for b1 in range(0xB0, hi_row):
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(bytes([b1, b2]).decode("gb2312"))
        except UnicodeDecodeError:
            pass

out = here / os.environ.get("CHARSET_OUT", "font-chars.txt")
out.write_text("".join(sorted(chars)), encoding="utf-8")
print(f"unique chars: {len(chars)} -> {out}")
