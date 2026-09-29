"""PPTX -> PDF with a pinned LibreOffice, then one PNG per page and a contact sheet for review.

Why a pinned LibreOffice: the machine's LibreOffice 7.3 has no Impress module (it cannot open PPTX)
and cannot pick weights out of a variable font. The official AppImage (LibreOffice 26.2.6.3) is
downloaded once into runtime/pitch/cache, checked by SHA-256 and extracted there; nothing is
installed. PITCH_SOFFICE points the build at another soffice with Impress, if one exists.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import urllib.request
from pathlib import Path

from PIL import Image

from pitch_paths import CACHE, CONTACT_SHEET, FONTS_CONF, LO_PROFILE, PAGES

LO_VERSION = "26.2.6.3"
LO_APPIMAGE = CACHE / f"LibreOffice-{LO_VERSION}.basic-x86_64.AppImage"
LO_URL = f"https://appimages.libreitalia.org/{LO_APPIMAGE.name}"
LO_SHA256 = "9f808e6313cbf9e0629ee8ce34c81fa8861591797aa2746cc811d46b87e702e0"
LO_DIR = CACHE / "libreoffice"
LO_SOFFICE = LO_DIR / "opt/libreoffice26.2/program/soffice"
CONVERT_TIMEOUT_S = 300
PAGE_DPI = 110
SHEET_COLS = 4
SHEET_THUMB_W = 480
SHEET_PAD = 8


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def soffice() -> Path:
    """The soffice binary: PITCH_SOFFICE, else the pinned AppImage (fetched and extracted once)."""
    override = os.environ.get("PITCH_SOFFICE")
    if override:
        return Path(override)
    if LO_SOFFICE.exists():
        return LO_SOFFICE
    if not LO_APPIMAGE.exists():
        urllib.request.urlretrieve(LO_URL, LO_APPIMAGE)
    actual = _sha256(LO_APPIMAGE)
    if actual != LO_SHA256:
        raise RuntimeError(f"{LO_APPIMAGE} has SHA-256 {actual}, expected {LO_SHA256}")
    LO_APPIMAGE.chmod(0o755)
    subprocess.run(
        [str(LO_APPIMAGE), "--appimage-extract"], cwd=CACHE, check=True, capture_output=True
    )
    shutil.move(str(CACHE / "squashfs-root"), LO_DIR)
    return LO_SOFFICE


def pptx_to_pdf(pptx: Path, pdf: Path) -> None:
    """Converts with the deck's own fonts only visible to this process (fonts.conf)."""
    if pdf.exists():
        pdf.unlink()
    env = {**os.environ, "FONTCONFIG_FILE": str(FONTS_CONF)}
    cmd = [
        str(soffice()),
        f"-env:UserInstallation=file://{LO_PROFILE}",
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        str(pdf.parent),
        str(pptx),
    ]
    result = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=CONVERT_TIMEOUT_S)
    produced = pdf.parent / f"{pptx.stem}.pdf"
    if result.returncode != 0 or not produced.exists():
        raise RuntimeError(f"LibreOffice did not convert {pptx}: {result.stdout} {result.stderr}")
    if produced != pdf:
        produced.replace(pdf)


def pdf_to_pages(pdf: Path) -> list[Path]:
    if PAGES.exists():
        shutil.rmtree(PAGES)
    PAGES.mkdir(parents=True)
    subprocess.run(
        ["pdftoppm", "-r", str(PAGE_DPI), "-png", str(pdf), str(PAGES / "page")], check=True
    )
    return sorted(PAGES.glob("page-*.png"))


def contact_sheet(pages: list[Path]) -> Path:
    thumbs = []
    for page in pages:
        with Image.open(page) as im:
            h = round(im.height * SHEET_THUMB_W / im.width)
            thumbs.append(im.convert("RGB").resize((SHEET_THUMB_W, h)))
    rows = (len(thumbs) + SHEET_COLS - 1) // SHEET_COLS
    th = thumbs[0].height
    sheet = Image.new(
        "RGB",
        (SHEET_COLS * (SHEET_THUMB_W + SHEET_PAD) + SHEET_PAD, rows * (th + SHEET_PAD) + SHEET_PAD),
        (128, 128, 128),
    )
    for i, thumb in enumerate(thumbs):
        row, col = divmod(i, SHEET_COLS)
        sheet.paste(
            thumb,
            (SHEET_PAD + col * (SHEET_THUMB_W + SHEET_PAD), SHEET_PAD + row * (th + SHEET_PAD)),
        )
    sheet.save(CONTACT_SHEET)
    return CONTACT_SHEET
