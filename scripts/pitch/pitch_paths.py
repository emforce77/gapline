"""Every file the pitch deck reads or writes. Paths resolve from this file, not the cwd."""

from pathlib import Path

PITCH_SRC = Path(__file__).resolve().parent
REPO = PITCH_SRC.parents[1]

OUT = REPO / "runtime/pitch"
CACHE = OUT / "cache"
FONTS = OUT / "fonts"
FONT_CACHE = OUT / "fontcache"
PAGES = OUT / "pages"
LO_PROFILE = OUT / "lo-profile"

PPTX = OUT / "gapline-pitch.pptx"
PDF = OUT / "gapline-pitch.pdf"
CONTACT_SHEET = OUT / "contact-sheet.png"
CHECK_NOTE = OUT / "gapline-pitch_check.md"
FONTS_CONF = OUT / "fonts.conf"

# Written by export-data.ts from the deck's checked data modules (numbers are computed there).
DATA_JSON = OUT / "pitch-data.json"
# Written by snapshots.ts from the live service.
SNAPSHOTS = OUT / "snapshots"
SNAPSHOT_MANIFEST = SNAPSHOTS / "manifest.json"

# The official Hack2skill template, downloaded once and pinned by SHA-256.
TEMPLATE_ID = "13rg7vW43mEH6DkpuusAE6fdoEylSFz8waNpE4RLzoUg"
TEMPLATE_URL = f"https://docs.google.com/presentation/d/{TEMPLATE_ID}/export/pptx"
TEMPLATE = CACHE / "submission-template.pptx"

# Assets the HTML deck already cut and checked (film stills, spectrogram).
DECK_ASSETS = REPO / "runtime/deck/assets"
STILLS = DECK_ASSETS / "stills"
SPECTROGRAMS = DECK_ASSETS / "spectrograms"

PRETENDARD_OTF = REPO / "node_modules/pretendard/dist/public/static"
