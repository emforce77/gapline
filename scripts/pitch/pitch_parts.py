"""Parts every content slide shares: the sentence headline, a film credit, cards and stage boxes."""

from __future__ import annotations

from pitch_draw import Box, Canvas, box, measure, p, r, text
from pitch_shapes import rect
from pitch_theme import (
    CARD_TITLE,
    CONTENT_W,
    FINE,
    HEADLINE,
    HEADLINE_Y,
    LEFT,
    RULE,
    SMALL,
    SURFACE,
)

EMU_PER_IN = 914400
HEADLINE_GAP_IN = 0.2
CREDIT_Y_IN = 5.24
CREDIT_H_IN = 0.2


def inches(emu: int) -> float:
    return emu / EMU_PER_IN


def headline(canvas: Canvas, words: str) -> float:
    """The slide's sentence under the section title. Returns where content may start (inches)."""
    paras = [p(r(words, HEADLINE))]
    need_pt, _ = measure(paras, CONTENT_W)
    height = need_pt / 72 + 0.04
    text(canvas, Box(LEFT, HEADLINE_Y, CONTENT_W, int(height * EMU_PER_IN)), paras, "headline")
    return inches(HEADLINE_Y) + height + HEADLINE_GAP_IN


def credit(canvas: Canvas, words: str) -> None:
    """Fine print at the foot of the content area, right-aligned (film credits, capture notes)."""
    text(
        canvas,
        Box(LEFT, int(CREDIT_Y_IN * EMU_PER_IN), CONTENT_W, int(CREDIT_H_IN * EMU_PER_IN)),
        [p(r(words, FINE), align="r")],
        "credit",
    )


def card(canvas: Canvas, where: Box, name: str) -> None:
    """A quiet panel: surface fill, hairline edge, small radius."""
    rect(canvas, where, fill=SURFACE, line=RULE, radius=0.06, name=name)


def titled_block(
    canvas: Canvas, where: Box, title: str, body: list, name: str, title_style=CARD_TITLE
) -> None:
    """A title line and paragraphs beneath it, in one measured box."""
    text(canvas, where, [p(r(title, title_style), space_after=3), *body], name)


def columns(
    left_in: float, top_in: float, width_in: float, count: int, gap_in: float, height_in: float
) -> list[Box]:
    """`count` equal boxes side by side."""
    w = (width_in - gap_in * (count - 1)) / count
    return [box(left_in + i * (w + gap_in), top_in, w, height_in) for i in range(count)]


def small_paras(*lines: str) -> list:
    return [p(r(line, SMALL), space_after=2) for line in lines]


ROW_PAD_IN = 0.07


def table(
    canvas: Canvas,
    left_in: float,
    top_in: float,
    widths_in: list[float],
    rows: list[list[list]],
    bottom_limit_in: float,
    name: str,
    shade_rows: tuple[int, ...] = (),
    shade=None,
    pad_in: float = ROW_PAD_IN,
) -> float:
    """A typographic table: measured rows, hairlines between them. Returns its bottom (inches).

    `rows[i][j]` is a list of paragraphs for one cell. Each row is as tall as its tallest cell.
    """
    from pitch_shapes import line

    y = top_in
    for i, row in enumerate(rows):
        heights = [
            measure(cell, int((w - 0.08) * EMU_PER_IN))[0] / 72 for cell, w in zip(row, widths_in)
        ]
        row_h = max(heights) + 2 * pad_in
        if y + row_h > bottom_limit_in + 0.005:
            raise RuntimeError(
                f"{canvas.label} / {name}: row {i} ends at {y + row_h:.2f} in, limit "
                f"{bottom_limit_in:.2f}"
            )
        if i in shade_rows and shade is not None:
            rect(canvas, box(left_in, y, sum(widths_in), row_h), fill=shade)
        x = left_in
        for j, (cell, w) in enumerate(zip(row, widths_in)):
            text(
                canvas,
                box(x + 0.04, y + pad_in, w - 0.08, row_h - 2 * pad_in),
                cell,
                f"{name}-r{i}c{j}",
            )
            x += w
        y += row_h
        line(
            canvas,
            int(left_in * EMU_PER_IN),
            int(y * EMU_PER_IN),
            int((left_in + sum(widths_in)) * EMU_PER_IN),
            int(y * EMU_PER_IN),
            RULE,
        )
    return y
