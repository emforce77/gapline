"""Checks on the rendered PDF, so the deck is judged on what LibreOffice actually drew.

- order: every page carries its template section title, in the template's order
- fonts: only the template's Google Sans Flex cuts and Pretendard, all embedded, no Type 3
- collisions: no two words overlap (word boxes trimmed to their middle half, since pdftotext boxes
  span the font's full ascent and descent) and no word runs into the header band or foot bar
- links: the three submission links are clickable
- wording: the owner's rules from the HTML deck (checks.ts): no defensive negatives anywhere; on
  slide faces no run ids, field ids, guideline acronym, page citations, speed multipliers, sample
  figures or API costs; the optional edit on one page at most
"""

from __future__ import annotations

import html
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

HEADER_BAND_PT = 0.555 * 72
FOOT_TOP_PT = 5071875 / 12700
PAGE_W_PT = 720.0
EDGE_PT = 14.0
CORE_SHARE = 0.25  # half of the middle half: a word's core is its box's middle 50% in height
OVERLAP_PT = 0.6
ALLOWED_FONTS = ("GoogleSansFlex-", "Pretendard-")

DEFENSIVE_NEGATIVES = [
    r"\bno[- ]one\s+(?:edited|edits|stepped|touched|intervened|was in the loop)",
    r"\bwith no one\b",
    r"\bno[- ]one in the loop\b",
    r"\b(?:no|0|zero)\s+edits?\b",
    r"\bwithout\s+(?:an?\s+)?(?:editors?|edits?|anyone|human (?:help|input|review))\b",
    r"\bunattended\b",
]
FACE_JARGON = [
    (re.compile(r"\b\d{8}t\d{6,9}\b|\bedit-[0-9a-f]{8,}", re.I), "a run id"),
    (re.compile(r"\b[a-z]+(?:_[a-z]+)+\b"), "a rule or field id"),
    (re.compile(r"\bKMCC\b"), "the guideline's acronym"),
    (re.compile(r"\bpp?\.\s?\d+|§\s?\d+"), "a page or section citation"),
    (re.compile(r"\binferred\b", re.I), '"inferred"'),
    (re.compile(r"\d\.\d+\s?[×x](?!\w)"), "a speed multiplier"),
    (re.compile(r"\bSample:"), "a sample-run figure"),
    (re.compile(r"\bAPI (?:calls|cost|fees)\b", re.I), "an API cost"),
]
EDIT_MENTION = re.compile(r"\bedit(?:s|ed|ing|or|ors)?\b|\bchange any line\b", re.I)
WORD_RE = re.compile(
    r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>'
)


@dataclass(frozen=True)
class Word:
    page: int
    x0: float
    y0: float
    x1: float
    y1: float
    text: str

    def core(self) -> tuple[float, float, float, float]:
        mid = (self.y0 + self.y1) / 2
        half = (self.y1 - self.y0) * CORE_SHARE
        return self.x0, mid - half, self.x1, mid + half


def pdf_words(pdf: Path) -> list[list[Word]]:
    out = subprocess.run(
        ["pdftotext", "-bbox", str(pdf), "-"], capture_output=True, text=True, check=True
    ).stdout
    pages = out.split("<page ")[1:]
    return [
        [
            Word(i, float(a), float(b), float(c), float(d), html.unescape(t))
            for a, b, c, d, t in WORD_RE.findall(page)
        ]
        for i, page in enumerate(pages)
    ]


def page_texts(pages: list[list[Word]]) -> list[str]:
    return [" ".join(w.text for w in words) for words in pages]


def check_order(texts: list[str], titles: list[str | None]) -> list[str]:
    problems = []
    if len(texts) != len(titles):
        problems.append(f"{len(texts)} pages, expected {len(titles)}")
    for i, (page, title) in enumerate(zip(texts, titles), 1):
        if title and title not in page:
            problems.append(f"page {i} lacks its section title {title!r}")
    return problems


def check_fonts(pdf: Path) -> tuple[list[str], list[str]]:
    out = subprocess.run(["pdffonts", str(pdf)], capture_output=True, text=True, check=True).stdout
    problems, fonts = [], []
    for row in out.splitlines()[2:]:
        cols = row.split()
        name = cols[0].split("+", 1)[-1]
        fonts.append(name)
        if not name.startswith(ALLOWED_FONTS):
            problems.append(f"unexpected font {name} (a glyph fell back)")
        if "Type 3" in row:
            problems.append(f"{name} is embedded as Type 3")
        if " no " in f" {' '.join(cols[-5:-2])} ":
            problems.append(f"{name} is not embedded")
    return problems, sorted(set(fonts))


def check_collisions(pages: list[list[Word]], skip: set[int]) -> list[str]:
    problems = []
    for i, words in enumerate(pages):
        if i in skip:
            continue
        cores = [(w, w.core()) for w in words]
        for a in range(len(cores)):
            wa, (ax0, ay0, ax1, ay1) = cores[a]
            if (
                ay0 < HEADER_BAND_PT
                or ay1 > FOOT_TOP_PT
                or ax0 < EDGE_PT
                or ax1 > PAGE_W_PT - EDGE_PT
            ):
                problems.append(f"page {i + 1}: {wa.text!r} sits in the frame or at the edge")
            for b in range(a + 1, len(cores)):
                wb, (bx0, by0, bx1, by1) = cores[b]
                if (
                    min(ax1, bx1) - max(ax0, bx0) > OVERLAP_PT
                    and min(ay1, by1) - max(ay0, by0) > OVERLAP_PT
                ):
                    problems.append(f"page {i + 1}: {wa.text!r} overlaps {wb.text!r}")
    return problems


def check_links(pdf: Path, expected: list[str]) -> tuple[list[str], list[str]]:
    from pypdf import PdfReader

    found = []
    for page in PdfReader(str(pdf)).pages:
        for annot in page.get("/Annots") or []:
            action = annot.get_object().get("/A")
            if action and action.get("/URI"):
                found.append(str(action["/URI"]))
    # LibreOffice writes a bare host with a trailing slash; the same address either way.
    normal = {url.rstrip("/") for url in found}
    problems = [f"no clickable link to {url}" for url in expected if url.rstrip("/") not in normal]
    return problems, found


def check_wording(texts: list[str], notes_page: int) -> tuple[list[str], list[int]]:
    problems = []
    edit_pages = []
    for i, page in enumerate(texts):
        flat = re.sub(r"\s+", " ", page)
        for rule in DEFENSIVE_NEGATIVES:
            m = re.search(rule, flat, re.I)
            if m:
                problems.append(f"page {i + 1}: defensive negative {m.group(0)!r}")
        if i == notes_page:
            continue
        for rule, what in FACE_JARGON:
            m = rule.search(flat)
            if m:
                problems.append(f"page {i + 1}: {what} on a slide face ({m.group(0)!r})")
        if EDIT_MENTION.search(flat):
            edit_pages.append(i + 1)
    if len(edit_pages) > 1:
        problems.append(
            f"the optional edit is told on {len(edit_pages)} pages ({edit_pages}); once is enough"
        )
    return problems, edit_pages
