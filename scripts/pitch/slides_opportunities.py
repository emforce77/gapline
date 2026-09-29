"""The two Opportunities pages: why now, and how Gapline differs, solves it and stands out."""

from __future__ import annotations

from pptx.util import Emu, Pt

from pitch_draw import Canvas, Para, box, measure, p, r, text
from pitch_fonts import FAMILY_SEMIBOLD
from pitch_notes import NoteBook
from pitch_parts import card, columns, headline
from pitch_shapes import line, rect
from pitch_theme import (
    AMBER_EDGE,
    BODY,
    BODY_STRONG,
    HEADLINE,
    INK,
    LABEL,
    RULE,
    RULE_STRONG,
    SMALL,
    WHITE,
)

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def _month_year(iso: str) -> str:
    year, month, _ = iso.split("-")
    return f"{MONTHS[int(month) - 1]} {year}"


def _year_fraction(iso: str) -> float:
    year, month, day = (int(x) for x in iso.split("-"))
    return year + (month - 1) / 12 + (day - 1) / 365


def build_why_now(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "Opportunities"
    top = headline(
        canvas,
        "Korea’s Supreme Court ruled that showing films without description or captions is "
        "discrimination.",
    )
    facts = data["facts"]
    lawsuit = facts["lawsuit"]
    events = [
        (
            lawsuit["filed"],
            "Blind and deaf moviegoers sue Korea’s three cinema chains",
            "filed",
            "below",
        ),
        (
            lawsuit["events"][0]["date"],
            "First ruling: only films supplied with a description file",
            "first_ruling",
            "above",
        ),
        (
            lawsuit["events"][1]["date"],
            "Appeals court caps it at 3% of screenings",
            "appeal",
            "above",
        ),
        (
            facts["streamingDuty"]["date"],
            "Streaming services are asked to provide it too",
            "streaming",
            "below",
        ),
        (
            lawsuit["events"][2]["date"],
            "Supreme Court confirms it is discrimination",
            "supreme_court",
            "above",
        ),
    ]
    x0, x1 = 0.75, 9.25
    y_axis = top + 1.3

    def at(iso: str) -> float:
        return x0 + (_year_fraction(iso) - 2016) / (2026.75 - 2016) * (x1 - x0)

    line(
        canvas,
        Emu(int(0.39 * 914400)),
        Emu(int(y_axis * 914400)),
        Emu(int(9.61 * 914400)),
        Emu(int(y_axis * 914400)),
        RULE_STRONG,
    )
    label_w = 2.1
    for iso, words, key, side in events:
        x = at(iso)
        key_event = key == "supreme_court"
        dot = 0.13 if key_event else 0.1
        rect(
            canvas,
            box(x - dot / 2, y_axis - dot / 2, dot, dot),
            fill=INK if key_event else WHITE,
            line=INK,
            radius=dot / 2,
        )
        lx = min(max(x - 0.06, 0.39), 9.61 - label_w)
        align = "r" if lx + label_w >= 9.6 else "l"
        paras = [
            p(r(_month_year(iso), LABEL)),
            p(
                r(words, BODY_STRONG if key_event else SMALL),
                r(notes.mark(key, section), SMALL, sup=True),
            ),
        ]
        if side == "above":
            where = box(lx, y_axis - 1.18, label_w, 1.08)
            anchor = "b"
        else:
            where = box(lx, y_axis + 0.14, label_w, 0.92)
            anchor = "t"
        text(
            canvas, where, [Para(q.runs, align=align) for q in paras], f"event-{key}", anchor=anchor
        )
    hand = facts["handMade"]
    band_top = y_axis + 1.12
    line(
        canvas,
        Emu(int(0.39 * 914400)),
        Emu(int(band_top * 914400)),
        Emu(int(9.61 * 914400)),
        Emu(int(band_top * 914400)),
        RULE,
    )
    text(
        canvas,
        box(0.39, band_top + 0.12, 9.22, 0.75),
        [
            p(r("One accessible film, made by hand", LABEL), space_after=2),
            p(
                r(
                    f"About {hand['months']} months, {hand['specialists']} specialists and "
                    f"₩{hand['wonMillions']} million (≈US${hand['usdThousands']}k)",
                    (HEADLINE[0], 18, INK),
                ),
                r(notes.mark("hand_made", section), (HEADLINE[0], 18, INK), sup=True),
            ),
        ],
        "hand-made",
    )


def build_opportunities(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "Opportunities"
    top = headline(canvas, "Each line fits a real silence and passes a cited review.")
    blocks = [
        (
            "How is it different from existing ideas?",
            [
                r(
                    "Other tools stretch the voice to fit a gap, or leave the checking to people.",
                    BODY,
                ),
                r(notes.mark("landscape", section), BODY, sup=True),
                r(
                    " Gapline measures every voiced line and reviews it against cited guideline "
                    "rules, then checks the whole track again.",
                    BODY,
                ),
            ],
        ),
        (
            "How will it solve the problem?",
            [
                r(
                    "One press of Generate turns a clip into a described film: silences mapped, a "
                    "line written for each, reviewed, voiced, measured, fixed and mixed. "
                    "Describers and distributors start from a checked track.",
                    BODY,
                ),
            ],
        ),
        (
            "USP of the proposed solution",
            [
                r(
                    "Description that stays out of the dialogue. Each line is timed on its real "
                    "voice, not a word count, and placed only where Korea’s guideline allows.",
                    BODY,
                ),
            ],
        ),
    ]
    paras = [
        [p(r(question, (FAMILY_SEMIBOLD, 13, INK)), space_after=8), p(*runs)]
        for question, runs in blocks
    ]
    pad = 0.16
    first = columns(0.39, top, 9.22, 3, 0.2, 1.0)[0]
    inner_w = first.w - int(2 * pad * 914400)
    card_h = max(measure(block, inner_w)[0] for block in paras) / 72 + 2 * 0.14 + 0.06
    for block, (question, _), where in zip(paras, blocks, columns(0.39, top, 9.22, 3, 0.2, card_h)):
        card(canvas, where, f"card-{question[:12]}")
        inner = box(
            where.x / 914400 + pad,
            where.y / 914400 + 0.14,
            where.w / 914400 - 2 * pad,
            where.h / 914400 - 0.28,
        )
        text(canvas, inner, block, f"answer-{question[:12]}")
    band = top + card_h + 0.26
    line(
        canvas,
        Emu(int(0.39 * 914400)),
        Emu(int(band * 914400)),
        Emu(int(1.19 * 914400)),
        Emu(int(band * 914400)),
        AMBER_EDGE,
        width=Pt(1.5),
    )
    text(
        canvas,
        box(0.39, band + 0.12, 9.22, 5.3 - band - 0.12),
        [
            p(
                r(
                    "“Dialogue and important sound effects should be zones that description does "
                    "not enter.”",
                    (FAMILY_SEMIBOLD, 14, INK),
                ),
                space_after=4,
            ),
            p(
                r(
                    "Korea’s audio-description guideline. Gapline enforces it before a line is "
                    "written.",
                    LABEL,
                ),
                r(notes.mark("zones", section), LABEL, sup=True),
            ),
        ],
        "zones-quote",
    )
