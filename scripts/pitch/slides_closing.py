"""The closing pages: the business case, what we test next, the links, and the sources."""

from __future__ import annotations

import math

from pitch_draw import Canvas, box, measure, p, r, text
from pitch_fonts import FAMILY_SEMIBOLD
from pitch_notes import NoteBook
from pitch_parts import headline, table
from pitch_shapes import line, rect
from pitch_template import set_title
from pitch_theme import (
    AMBER,
    AMBER_EDGE,
    BODY,
    FINE,
    INK,
    INK_3,
    LABEL,
    NOTE,
    NOTE_HEAD,
    RULE,
    SMALL,
)

EMU = 914400
PRICE_AXIS = (0.1, 100.0)


def build_business(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "Additional Details/Future Development"
    audience = data["facts"]["audience"]
    top = headline(
        canvas, "Our bet: whoever supplies a film’s description file would pay Gapline to make it."
    )
    ink_small = (SMALL[0], SMALL[1], INK)
    rows = [
        [
            [p(r("Would pay", LABEL))],
            [
                p(
                    r("Foreign-film distributors and streaming services", ink_small),
                    r(notes.mark("supplier", section), SMALL, sup=True),
                    space_after=2,
                ),
                p(
                    r("A public program already covers Korean films", SMALL),
                    r(notes.mark("kofic", section), SMALL, sup=True),
                ),
            ],
        ],
        [
            [p(r("Runs it", LABEL))],
            [p(r("Teams preparing accessible versions of films and shows", ink_small))],
        ],
        [
            [p(r("Benefits", LABEL))],
            [
                p(
                    r(
                        f"Blind and low-vision viewers: {audience['koreansRegistered']} registered "
                        "in Korea",
                        ink_small,
                    ),
                    r(notes.mark("korea_audience", section), SMALL, sup=True),
                    space_after=2,
                ),
                p(
                    r(
                        "Nearly two in three of the world’s blind people live in Asia-Pacific",
                        ink_small,
                    ),
                    r(notes.mark("asia_pacific", section), SMALL, sup=True),
                ),
            ],
        ],
    ]
    table(canvas, 0.39, top + 0.05, [1.05, 3.55], rows, 5.1, "business")
    _price_chart(canvas, data, notes, section, 5.35, top, 9.61 - 5.35)


def _price_chart(
    canvas: Canvas, data: dict, notes: NoteBook, section: str, x: float, top: float, w: float
) -> None:
    text(
        canvas,
        box(x, top, w, 0.24),
        [
            p(
                r("What description costs per minute today (log scale)", LABEL),
                r(notes.mark("prices", section), LABEL, sup=True),
            )
        ],
        "price-title",
    )
    lo, hi = PRICE_AXIS

    def at(usd: float) -> float:
        return x + (math.log10(usd) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * w

    row_top = top + 0.42
    row_h = 0.62
    prices = data["facts"]["prices"]
    axis_y = row_top + len(prices) * row_h + 0.05
    for tick in (0.1, 1, 10, 100):
        tx = at(tick)
        line(
            canvas,
            int(tx * EMU),
            int((row_top - 0.05) * EMU),
            int(tx * EMU),
            int(axis_y * EMU),
            RULE,
        )
        label = f"${tick:g}" if tick >= 1 else "$0.10"
        text(
            canvas,
            box(tx - 0.3, axis_y + 0.03, 0.6, 0.18),
            [p(r(label, FINE), align="c")],
            f"price-tick-{tick:g}",
        )
    for i, price in enumerate(prices):
        y = row_top + i * row_h
        text(
            canvas,
            box(x, y, w, 0.2),
            [p(r(price["who"], (SMALL[0], SMALL[1], INK)))],
            f"price-who-{i}",
        )
        bar_y = y + 0.27
        if price["low"] == price["high"]:
            d = 0.13
            rect(canvas, box(at(price["low"]) - d / 2, bar_y - 0.005, d, d), fill=INK, radius=d / 2)
            value = f"${price['low']:g}"
            vx = at(price["low"]) + 0.1
        else:
            rect(
                canvas,
                box(at(price["low"]), bar_y, at(price["high"]) - at(price["low"]), 0.12),
                fill=INK,
            )
            value = f"${price['low']:g}–${price['high']:g}"
            vx = at(price["high"]) + 0.08
        right_room = x + w - vx
        if right_room < 1.0:
            text(
                canvas,
                box(at(price["low"]) - 1.3, bar_y - 0.04, 1.22, 0.2),
                [p(r(value, FINE), align="r")],
                f"price-value-{i}",
            )
        else:
            text(
                canvas,
                box(vx, bar_y - 0.04, right_room, 0.2),
                [p(r(value, FINE))],
                f"price-value-{i}",
            )


def build_next(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    product = data["product"]
    run = data["cloudRun"]
    top = headline(canvas, "Next, we test it with blind viewers and professional describers.")
    head = (LABEL[0], 10, INK_3)
    ink_small = (SMALL[0], SMALL[1], INK)
    rows = [
        [[p(r("What we want to learn", head))], [p(r("How we will test it", head))]],
        [
            [p(r("Blind and low-vision viewers find the lines useful", ink_small))],
            [p(r("Listening sessions with them", SMALL))],
        ],
        [
            [p(r("Describers would ship the automatic track", ink_small))],
            [
                p(
                    r(
                        "Describers review three automatic tracks and count the lines they would "
                        "change",
                        SMALL,
                    )
                )
            ],
        ],
        [
            [p(r("It carries to other Asia-Pacific languages", ink_small))],
            [p(r("One guideline and voice per language, reviewed by native describers", SMALL))],
        ],
    ]
    bottom = table(canvas, 0.39, top, [3.7, 5.52], rows, 4.2, "next")
    block_top = bottom + 0.3
    blocks = [
        (
            "Prototype limits",
            f"Clips up to {product['maxClipSeconds']} s and {product['maxUploadMb']:g} MB, one "
            f"request each; one Cloud Run service, up to {run['max']} instances.",
        ),
        (
            "Next, for whole films",
            "Split at shot boundaries; one Cloud Run job per scene, with the same checks.",
        ),
    ]
    block_w, block_gap = (9.22 - 0.3) / 2, 0.3
    for i, (title, body) in enumerate(blocks):
        x = 0.39 + i * (block_w + block_gap)
        line(
            canvas,
            int(x * EMU),
            int(block_top * EMU),
            int((x + block_w) * EMU),
            int(block_top * EMU),
            RULE,
        )
        text(
            canvas,
            box(x, block_top + 0.08, block_w, 5.12 - block_top - 0.08),
            [p(r(title, (FAMILY_SEMIBOLD, 12, INK)), space_after=3), p(r(body, SMALL))],
            f"block-{i}",
        )


def build_links(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    set_title(canvas.slide, "Links")
    links = data["links"]
    top = headline(canvas, "The code, the demo video and the live prototype are all public.")
    rows = [
        ("GitHub Public Repository", links["repo"]),
        ("Demo Video Link", links["video"]),
        ("Final Product Link", links["demo"]),
    ]
    y = top + 0.05
    for i, (label, url) in enumerate(rows):
        if not url:
            raise RuntimeError(f"no URL for {label}: set it in scripts/deck/facts.ts SUBMISSION")
        text(
            canvas,
            box(0.39, y, 9.22, 0.62),
            [p(r(label, LABEL), space_after=3), p(r(url, (FAMILY_SEMIBOLD, 14, INK), link=url))],
            f"link-{i}",
        )
        y += 0.72
        line(
            canvas,
            int(0.39 * EMU),
            int((y - 0.05) * EMU),
            int(9.61 * EMU),
            int((y - 0.05) * EMU),
            RULE,
        )
    rect(canvas, box(0.39, y + 0.18, 0.09, 0.09), fill=AMBER, line=AMBER_EDGE)
    text(
        canvas,
        box(0.58, y + 0.1, 9.0, 0.3),
        [
            p(
                r(
                    "Start with the sample: press Play with description, then listen again with "
                    "your eyes closed.",
                    BODY,
                )
            )
        ],
        "tip",
    )


def build_notes_page(canvas: Canvas, title_element: object, notes: NoteBook) -> None:
    """The template's spare page, titled with a copied section title box, lists every note."""
    canvas.slide.shapes._spTree.append(title_element)  # type: ignore[attr-defined]
    set_title(canvas.slide, "Sources and notes")
    col_w, gap = (9.22 - 0.3) / 2, 0.3
    top, bottom = 1.26, 5.44
    height_pt = (bottom - top) * 72
    width = int(col_w * EMU)
    columns: list[list] = [[]]
    heading_of = ""
    for section, entries in notes.grouped():
        for n, words in entries:
            note = p(r(f"{n}  ", NOTE_HEAD), r(words, NOTE), space_after=1.5)
            heading = (
                []
                if section == heading_of
                else [p(r(section, NOTE_HEAD), space_before=3, space_after=1)]
            )
            if measure(columns[-1] + heading + [note], width)[0] > height_pt:
                columns.append([])
                if len(columns) > 2:
                    raise RuntimeError("the notes do not fit two columns")
                # A section that carries on into the second column keeps its numbers, not its heading.
                heading = [p(r(section, NOTE_HEAD), space_after=1)] if heading else []
            columns[-1] += heading + [note]
            heading_of = section
    for i, paras in enumerate(columns):
        if paras:
            text(
                canvas,
                box(0.39 + i * (col_w + gap), top, col_w, bottom - top),
                paras,
                f"notes-{i}",
                min_pt=NOTE[1],
            )
