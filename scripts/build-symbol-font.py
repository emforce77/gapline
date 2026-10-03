"""Builds src/styles/fonts/GaplineSymbols.woff2: the status glyphs the interface draws next to its
words (check, cross, warning, the two circular arrows, minus), cut from Pretendard Variable.

Pretendard's own web subsets (imported in src/app/layout.tsx) leave these code points out of every
unicode-range, so without this file they fall back to whatever symbol font the system has. The slice
keeps the weight axis, so a bold label gets a bold mark.

Pretendard is licensed under the SIL OFL 1.1 with the Reserved Font Name "Pretendard". A subset is a
Modified Version, so this one is renamed "Gapline Symbols"; the copyright and licence records stay in
its name table, and OFL.txt sits beside it. U+2715 (multiplication X) has no Pretendard glyph and is
mapped to Pretendard's U+2717 (ballot X), which Pretendard draws as a small ×.

Run from the repository root:
    uv run --with fonttools==4.66.0 --with brotli==1.1.0 python scripts/build-symbol-font.py
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"
OUTPUT = ROOT / "src/styles/fonts/GaplineSymbols.woff2"
FAMILY = "Gapline Symbols"
POSTSCRIPT_FAMILY = "GaplineSymbols"
# ✓ ✗ ⚠ ↺ ↻ −
CODEPOINTS = [0x2713, 0x2717, 0x26A0, 0x21BA, 0x21BB, 0x2212]
# ✕ drawn with ✗'s glyph.
ALIASES = {0x2715: 0x2717}
# Copyright, trademark notice, licence description and licence URL keep the original wording: the
# OFL requires the copyright and licence, and the trademark notice is about Pretendard's name, not ours.
KEPT_NAME_IDS = {0, 7, 13, 14}


def rename(font: TTFont) -> None:
    """Drops the Reserved Font Name from every name the font presents, and duplicate records."""
    table = font["name"]
    seen: set[tuple[int, int, int, int]] = set()
    records = []
    for record in table.names:
        key = (record.platformID, record.platEncID, record.langID, record.nameID)
        if key in seen:
            continue
        seen.add(key)
        text = record.toUnicode()
        if record.nameID not in KEPT_NAME_IDS and "Pretendard" in text:
            text = (
                text.replace("PretendardVariable", POSTSCRIPT_FAMILY)
                .replace("Pretendard Variable", FAMILY)
                .replace("Pretendard", FAMILY)
            )
            record.string = text
        records.append(record)
    table.names = records


def main() -> None:
    font = TTFont(SOURCE)
    options = subset.Options()
    options.layout_features = []
    options.name_IDs = ["*"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=CODEPOINTS)
    subsetter.subset(font)
    for cmap in font["cmap"].tables:
        if cmap.isUnicode():
            for alias, target in ALIASES.items():
                cmap.cmap[alias] = cmap.cmap[target]
    rename(font)
    font.flavor = "woff2"
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    font.save(OUTPUT)
    mapped = sorted(font.getBestCmap())
    print(
        f"{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} bytes, " + " ".join(map(chr, mapped))
    )


if __name__ == "__main__":
    main()
