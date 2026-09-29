"""Drawing primitives for the template deck: text boxes that prove they fit, shapes, pictures.

Every text box is measured before it is written: the words are wrapped with the same static font
cuts LibreOffice renders (pitch_fonts.py), line by line, and a box whose text would run past its
bottom or right edge stops the build with the slide and the text named. Nothing shrinks to fit.
Theme styles are stripped from shapes so no renderer adds shadows or theme fills.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from lxml import etree
from PIL import ImageFont
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

from pitch_fonts import KOREAN_FAMILY, font_file
from pitch_theme import LINE_SPACING

EMU_PER_PT = 12700
MEASURE_SCALE = 20  # font pixels per point when measuring, for sub-point precision
SUPERSCRIPT_SCALE = 0.65
SUPERSCRIPT_BASELINE = "30000"
FIT_TOLERANCE_PT = 0.5
USE_TYPO_METRICS = 1 << 7  # OS/2 fsSelection bit: line height comes from the typo metrics
# Measured 2026-09-29 on LibreOffice 26.2.6.3 (pdftotext -bbox, sizes 10-22 pt): the line pitch of
# the Google Sans Flex cuts is 1.200 x size at 100% spacing and 1.343 x size at 112%. The font's
# own metrics say 1.252, so the build uses the measured value.
GOOGLE_SANS_LINE_EM = 1.2
WIDTH_SAFETY = 1.02  # measured widths are padded 2%: PIL does not kern, LibreOffice does
BULLET_INDENT = Emu(Pt(11).emu)
ALIGN = {"l": PP_ALIGN.LEFT, "c": PP_ALIGN.CENTER, "r": PP_ALIGN.RIGHT}
ANCHOR = {"t": MSO_ANCHOR.TOP, "m": MSO_ANCHOR.MIDDLE, "b": MSO_ANCHOR.BOTTOM}

Style = tuple[str, float, object]  # family, size in pt, RGBColor


class TextFitError(RuntimeError):
    """A text box whose words would not fit inside it."""


@dataclass(frozen=True)
class Box:
    """A rectangle in EMU."""

    x: int
    y: int
    w: int
    h: int

    @property
    def right(self) -> int:
        return self.x + self.w

    @property
    def bottom(self) -> int:
        return self.y + self.h


@dataclass(frozen=True)
class Run:
    text: str
    style: Style
    bold: bool = False
    italic: bool = False
    strike: bool = False
    sup: bool = False
    link: str | None = None


@dataclass(frozen=True)
class Para:
    runs: tuple[Run, ...]
    align: str = "l"
    space_before: float = 0.0
    space_after: float = 0.0
    line_spacing: float = LINE_SPACING
    bullet: bool = False


@dataclass
class TextRecord:
    """What the build wrote, for the check note and the post-render checks."""

    slide: str
    name: str
    box: Box
    text: str
    min_pt: float
    lines: int


@dataclass
class Canvas:
    """One slide being drawn, and the record of its text boxes."""

    slide: object
    label: str
    texts: list[TextRecord] = field(default_factory=list)


def r(text: str, style: Style, **flags: object) -> Run:
    return Run(text, style, **flags)  # type: ignore[arg-type]


def p(*runs: Run, **props: object) -> Para:
    return Para(tuple(runs), **props)  # type: ignore[arg-type]


def box(x: float, y: float, w: float, h: float) -> Box:
    """A box from inches."""
    return Box(int(x * 914400), int(y * 914400), int(w * 914400), int(h * 914400))


@lru_cache(maxsize=64)
def _pil_font(path: Path, size_pt: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=max(1, round(size_pt * MEASURE_SCALE)))


@lru_cache(maxsize=16)
def _line_factor(path: Path) -> float:
    """Line height per point of size at 100% spacing, as LibreOffice lays the font out."""
    if path.name.startswith("GoogleSansFlex"):
        return GOOGLE_SANS_LINE_EM
    from fontTools.ttLib import TTFont

    font = TTFont(path, lazy=True)
    upm = font["head"].unitsPerEm
    os2 = font["OS/2"]
    if os2.fsSelection & USE_TYPO_METRICS:
        return (os2.sTypoAscender - os2.sTypoDescender + os2.sTypoLineGap) / upm
    hhea = font["hhea"]
    return (hhea.ascent - hhea.descent + hhea.lineGap) / upm


def _run_font(run: Run) -> tuple[Path, float]:
    family, size, _ = run.style
    size = size * SUPERSCRIPT_SCALE if run.sup else size
    return font_file(family, run.bold, run.italic), size


def text_width_pt(text: str, style: Style, bold: bool = False, italic: bool = False) -> float:
    """Advance width of one line of text, in points."""
    path = font_file(style[0], bold, italic)
    return _pil_font(path, style[1]).getlength(text) / MEASURE_SCALE * WIDTH_SAFETY


def _tokens(run: Run) -> list[tuple[str, Run]]:
    out: list[tuple[str, Run]] = []
    word = ""
    for ch in run.text:
        if ch == " ":
            if word:
                out.append((word, run))
                word = ""
            out.append((" ", run))
        else:
            word += ch
    if word:
        out.append((word, run))
    return out


def _needs_korean(text: str) -> bool:
    return any("가" <= ch <= "힣" or "㄰" <= ch <= "㆏" for ch in text)


def _token_width(token: str, run: Run) -> float:
    if _needs_korean(token):
        path = font_file(KOREAN_FAMILY, run.bold)
        size = run.style[1] * (SUPERSCRIPT_SCALE if run.sup else 1)
    else:
        path, size = _run_font(run)
    return _pil_font(path, size).getlength(token) / MEASURE_SCALE * WIDTH_SAFETY


def _wrap(para: Para, width_pt: float) -> list[list[tuple[str, Run]]]:
    """Greedy word wrap, as LibreOffice does it (no hyphenation). Long words break by character."""
    lines: list[list[tuple[str, Run]]] = [[]]
    used = 0.0
    tokens = [t for run in para.runs for t in _tokens(run)]
    for token, run in tokens:
        w = _token_width(token, run)
        if token == " ":
            if lines[-1]:
                lines[-1].append((token, run))
                used += w
            continue
        if used + w <= width_pt or not lines[-1]:
            if w > width_pt:
                raise TextFitError(f"'{token}' is wider than its box ({w:.0f} > {width_pt:.0f} pt)")
            lines[-1].append((token, run))
            used += w
            continue
        while lines[-1] and lines[-1][-1][0] == " ":
            lines[-1].pop()
        lines.append([(token, run)])
        used = w
    return lines


def _para_height(para: Para, lines: list[list[tuple[str, Run]]]) -> float:
    height = para.space_before + para.space_after
    for line in lines:
        runs = [run for _, run in line] or list(para.runs[:1])
        tallest = max(_line_factor(_run_font(run)[0]) * run.style[1] for run in runs)
        height += tallest * para.line_spacing
    return height


def measure(paras: list[Para], width_emu: int) -> tuple[float, int]:
    """Height in points and line count of paragraphs set in a box of this inner width."""
    total, count = 0.0, 0
    for para in paras:
        indent = BULLET_INDENT / EMU_PER_PT if para.bullet else 0.0
        lines = _wrap(para, width_emu / EMU_PER_PT - indent)
        total += _para_height(para, lines)
        count += len(lines)
    return total, count


def _set_bullet(paragraph: object) -> None:
    ppr = paragraph._p.get_or_add_pPr()  # type: ignore[attr-defined]
    ppr.set("marL", str(BULLET_INDENT))
    ppr.set("indent", str(-BULLET_INDENT))
    for tag in ("a:buNone", "a:buChar", "a:buFont"):
        for el in ppr.findall(qn(tag)):
            ppr.remove(el)
    font = etree.SubElement(ppr, qn("a:buFont"))
    font.set("typeface", "Arial")
    char = etree.SubElement(ppr, qn("a:buChar"))
    char.set("char", "•")


def _write_run(paragraph: object, run: Run) -> None:
    family, size, color = run.style
    out = paragraph.add_run()  # type: ignore[attr-defined]
    out.text = run.text
    font = out.font
    font.name = family
    font.size = Pt(size * (SUPERSCRIPT_SCALE if run.sup else 1))
    font.bold = run.bold
    font.italic = run.italic
    font.color.rgb = color
    rpr = out._r.get_or_add_rPr()
    if run.strike:
        rpr.set("strike", "sngStrike")
    if run.sup:
        rpr.set("baseline", SUPERSCRIPT_BASELINE)
    latin = rpr.find(qn("a:latin"))
    ea = etree.Element(qn("a:ea"))
    ea.set("typeface", KOREAN_FAMILY)
    latin.addnext(ea)
    if run.link:
        out.hyperlink.address = run.link


def text(
    canvas: Canvas,
    where: Box,
    paras: list[Para],
    name: str,
    anchor: str = "t",
    inset: float = 0.0,
    min_pt: float | None = None,
) -> object:
    """A text box that must hold its paragraphs; raises TextFitError otherwise."""
    inner_w = where.w - 2 * int(inset * EMU_PER_PT)
    need, count = measure(paras, inner_w)
    have = (where.h - 2 * int(inset * EMU_PER_PT)) / EMU_PER_PT
    if need > have + FIT_TOLERANCE_PT:
        words = " ".join(run.text for para in paras for run in para.runs)[:80]
        raise TextFitError(
            f"{canvas.label} / {name}: needs {need:.1f} pt, box holds {have:.1f} pt: {words!r}"
        )
    shape = canvas.slide.shapes.add_textbox(where.x, where.y, where.w, where.h)  # type: ignore[attr-defined]
    shape.name = name
    frame = shape.text_frame
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.NONE
    margin = Pt(inset)
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = margin
    frame.vertical_anchor = ANCHOR[anchor]
    for i, para in enumerate(paras):
        out = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        out.alignment = ALIGN[para.align]
        out.line_spacing = para.line_spacing
        out.space_before = Pt(para.space_before)
        out.space_after = Pt(para.space_after)
        if para.bullet:
            _set_bullet(out)
        for run in para.runs:
            _write_run(out, run)
    sizes = [run.style[1] for para in paras for run in para.runs if not run.sup]
    smallest = min(sizes) if sizes else 0.0
    canvas.texts.append(
        TextRecord(
            canvas.label,
            name,
            where,
            " ".join(run.text for para in paras for run in para.runs),
            min_pt if min_pt is not None else smallest,
            count,
        )
    )
    return shape
