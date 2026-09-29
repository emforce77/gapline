"""Static cuts of the template's font, so LibreOffice renders and embeds what the template names.

Why: the Hack2skill template sets its text in Google Sans Flex under three family names
("Google Sans Flex", "Google Sans Flex Medium", "Google Sans Flex SemiBold", as Google Slides
exports weights). LibreOffice 7.3 cannot pick weights out of the variable font, so the build cuts
static instances at the named-instance axes (opsz 18, wdth 100, GRAD 0, ROND 0) and names each
cut as the template does. The cuts stay in runtime/ (not distributed); the PDF embeds subsets,
which the OFL allows. Korean glyphs (one quoted guideline line) use Pretendard's static OTFs.

In:  the variable font from google/fonts at a pinned commit (OFL, no Reserved Font Names).
Out: runtime/pitch/fonts/*.ttf|otf and runtime/pitch/fonts.conf for the soffice process only.
"""

from __future__ import annotations

import hashlib
import shutil
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

from pitch_paths import CACHE, FONT_CACHE, FONTS, FONTS_CONF, PRETENDARD_OTF

GOOGLE_FONTS_COMMIT = "3dc14e61f108f036db84188b9b405a67df9b7c88"
VF_URL = (
    "https://raw.githubusercontent.com/google/fonts/"
    f"{GOOGLE_FONTS_COMMIT}/ofl/googlesansflex/"
    "GoogleSansFlex%5BGRAD%2CROND%2Copsz%2Cslnt%2Cwdth%2Cwght%5D.ttf"
)
VF_SHA256 = "c31a482fbecbf2e07e6890134d20078723aadf732c9b9c6c9a44f86f8265b6fe"
VF_FILE = CACHE / "GoogleSansFlex-VF.ttf"
# The named instances' fixed axes; only weight and slant vary between the cuts.
BASE_AXES = {"opsz": 18.0, "wdth": 100.0, "GRAD": 0.0, "ROND": 0.0}

FAMILY = "Google Sans Flex"
FAMILY_MEDIUM = "Google Sans Flex Medium"
FAMILY_SEMIBOLD = "Google Sans Flex SemiBold"
KOREAN_FAMILY = "Pretendard"

# name table IDs that would give fontconfig a second family name for a cut.
TYPOGRAPHIC_NAME_IDS = (16, 17, 21, 22, 25)
FS_SELECTION_ITALIC = 1 << 0
FS_SELECTION_BOLD = 1 << 5
FS_SELECTION_REGULAR = 1 << 6
MAC_STYLE_BOLD = 1 << 0
MAC_STYLE_ITALIC = 1 << 1
ITALIC_SLANT = -10.0


@dataclass(frozen=True)
class FontCut:
    """One static instance and the names fontconfig will see."""

    file_name: str
    family: str
    style: str
    postscript: str
    weight: int
    italic: bool = False


CUTS = (
    FontCut("GoogleSansFlex-Regular.ttf", FAMILY, "Regular", "GoogleSansFlex-Regular", 400),
    FontCut("GoogleSansFlex-Bold.ttf", FAMILY, "Bold", "GoogleSansFlex-Bold", 700),
    FontCut("GoogleSansFlex-Italic.ttf", FAMILY, "Italic", "GoogleSansFlex-Italic", 400, True),
    FontCut("GoogleSansFlex-Medium.ttf", FAMILY_MEDIUM, "Regular", "GoogleSansFlex-Medium", 500),
    FontCut(
        "GoogleSansFlex-SemiBold.ttf", FAMILY_SEMIBOLD, "Regular", "GoogleSansFlex-SemiBold", 600
    ),
)
PRETENDARD_CUTS = ("Pretendard-Regular.otf", "Pretendard-SemiBold.otf")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _fetch_variable_font() -> Path:
    if not VF_FILE.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(VF_URL, VF_FILE)
    actual = _sha256(VF_FILE)
    if actual != VF_SHA256:
        raise RuntimeError(f"{VF_FILE} has SHA-256 {actual}, expected {VF_SHA256}")
    return VF_FILE


def _name_cut(font: TTFont, cut: FontCut) -> None:
    names = font["name"]
    for name_id in TYPOGRAPHIC_NAME_IDS:
        names.removeNames(nameID=name_id)
    full = f"{cut.family} {cut.style}" if cut.style != "Regular" else cut.family
    for name_id, value in ((1, cut.family), (2, cut.style), (4, full), (6, cut.postscript)):
        names.setName(value, name_id, 3, 1, 0x409)
        names.setName(value, name_id, 1, 0, 0)
    os2 = font["OS/2"]
    os2.usWeightClass = cut.weight
    selection = os2.fsSelection & ~(FS_SELECTION_ITALIC | FS_SELECTION_BOLD | FS_SELECTION_REGULAR)
    mac_style = 0
    if cut.style == "Bold":
        selection |= FS_SELECTION_BOLD
        mac_style |= MAC_STYLE_BOLD
    elif cut.italic:
        selection |= FS_SELECTION_ITALIC
        mac_style |= MAC_STYLE_ITALIC
    else:
        selection |= FS_SELECTION_REGULAR
    os2.fsSelection = selection
    font["head"].macStyle = mac_style
    font["post"].italicAngle = ITALIC_SLANT if cut.italic else 0.0


def _write_cut(source: Path, cut: FontCut) -> Path:
    out = FONTS / cut.file_name
    if out.exists() and out.stat().st_mtime >= source.stat().st_mtime:
        return out
    axes = {**BASE_AXES, "wght": float(cut.weight), "slnt": ITALIC_SLANT if cut.italic else 0.0}
    font = instantiateVariableFont(TTFont(source), axes, updateFontNames=False)
    _name_cut(font, cut)
    font.save(out)
    return out


def _write_fonts_conf() -> Path:
    FONT_CACHE.mkdir(parents=True, exist_ok=True)
    FONTS_CONF.write_text(
        '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
        '  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>\n'
        f"  <dir>{FONTS}</dir>\n  <cachedir>{FONT_CACHE}</cachedir>\n</fontconfig>\n"
    )
    return FONTS_CONF


def prepare_pitch_fonts() -> dict[str, Path]:
    """Cut the static fonts and write fonts.conf. Returns family-or-file name -> path."""
    FONTS.mkdir(parents=True, exist_ok=True)
    source = _fetch_variable_font()
    written = {cut.file_name: _write_cut(source, cut) for cut in CUTS}
    for name in PRETENDARD_CUTS:
        target = FONTS / name
        if not target.exists():
            shutil.copyfile(PRETENDARD_OTF / name, target)
        written[name] = target
    written["fonts.conf"] = _write_fonts_conf()
    return written


def font_file(family: str, bold: bool = False, italic: bool = False) -> Path:
    """The cut LibreOffice will use for a run, for measuring text before rendering."""
    if family == KOREAN_FAMILY:
        return FONTS / PRETENDARD_CUTS[1 if bold else 0]
    for cut in CUTS:
        if cut.family != family:
            continue
        if family == FAMILY and cut.style != (
            "Bold" if bold else "Italic" if italic else "Regular"
        ):
            continue
        return FONTS / cut.file_name
    raise KeyError(f"no cut for family={family!r} bold={bold} italic={italic}")
