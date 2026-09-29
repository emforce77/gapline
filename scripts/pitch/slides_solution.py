"""The solution pages: features, the process flow, the architecture and the technologies."""

from __future__ import annotations

from pitch_draw import Canvas, box, p, r, text
from pitch_fonts import FAMILY_SEMIBOLD
from pitch_notes import NoteBook
from pitch_parts import card, columns, headline
from pitch_shapes import arrow, rect
from pitch_theme import (
    CARD_TITLE,
    FINE,
    INK,
    INK_3,
    RULE,
    RULE_STRONG,
    SMALL,
    SURFACE_2,
    WHITE,
)

STAGE_NAME = (FAMILY_SEMIBOLD, 11, INK)
AI_FILL = SURFACE_2


def _times(n: int) -> str:
    """2 -> 'twice', 3 -> '3 times'."""
    return "twice" if n == 2 else f"{n} times"


def build_features(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "List of features offered by the solution"
    product = data["product"]
    top = headline(canvas, "One press runs every step; every result stays open.")
    features = [
        (
            "One press, whole track",
            f"Upload a clip of up to {product['maxClipSeconds']} s, press Generate, get the "
            "described film.",
        ),
        ("Silence map", "Speech-to-Text times every word, then hears each silence again."),
        ("Scene understanding", "Gemini watches shots, people, on-screen text and key sounds."),
        (
            "Guideline review",
            f"Each line is checked against {product['ruleCount']} cited rules and rewritten if it "
            "fails.",
        ),
        (
            "Measured voice",
            f"Voiced, then measured: up to {product['maxSpeedUpPercent']}% faster, else shortened, "
            "else dropped.",
        ),
        (
            "Final check and fix",
            "Checks the whole track, then fixes weak lines and missed moments.",
        ),
        (
            "Korean and English",
            "Narration and interface in both, one Chirp 3 HD narrator for each.",
        ),
        (
            "Player and downloads",
            "Description on or off, eyes open or closed; MP4, WAV and WebVTT out.",
        ),
        ("Optional editing", "Change any line; Gapline re-voices it and checks the track again."),
    ]
    rows = 3
    gap = 0.14
    height = (5.12 - top - gap * (rows - 1)) / rows
    cells = []
    for row in range(rows):
        cells += columns(0.39, top + row * (height + gap), 9.22, 3, 0.18, height)
    for i, ((title, body), where) in enumerate(zip(features, cells)):
        card(canvas, where, f"feature-{i}")
        inner = box(
            where.x / 914400 + 0.14,
            where.y / 914400 + 0.1,
            where.w / 914400 - 0.28,
            where.h / 914400 - 0.16,
        )
        runs = [r(body, SMALL)]
        if title == "Guideline review":
            runs.append(r(notes.mark("rules", section), SMALL, sup=True))
        text(
            canvas,
            inner,
            [
                p(
                    r(f"{i + 1:02d}  ", (FAMILY_SEMIBOLD, 11, INK_3)),
                    r(title, CARD_TITLE),
                    space_after=3,
                ),
                p(*runs),
            ],
            f"feature-{i}",
        )


def _stage(
    canvas: Canvas, x: float, y: float, w: float, h: float, name: str, engine: str, ai: bool
) -> tuple[float, float, float, float]:
    rect(
        canvas,
        box(x, y, w, h),
        fill=AI_FILL if ai else WHITE,
        line=RULE if ai else RULE_STRONG,
        radius=0.05,
        name=f"stage-{name}",
    )
    text(
        canvas,
        box(x + 0.05, y + 0.03, w - 0.1, h - 0.06),
        [
            p(r(name, STAGE_NAME), align="c", line_spacing=1.0),
            p(r(engine, FINE), align="c", line_spacing=1.0),
        ],
        f"stage-{name}",
        anchor="m",
    )
    return x, y, w, h


def build_process_flow(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    product = data["product"]
    top = headline(canvas, "Each line is written, reviewed, voiced and measured.")
    gap = 0.34
    row1_y, row1_h = top + 0.42, 0.86
    widths1 = [0.9, 1.55, 1.45, 1.3, 1.55]
    xs1 = [0.39]
    for w in widths1[:-1]:
        xs1.append(xs1[-1] + w + gap)
    _stage(
        canvas,
        xs1[0],
        row1_y,
        widths1[0],
        row1_h,
        "Clip",
        f"up to {product['maxClipSeconds']} s",
        False,
    )
    half = (row1_h - 0.06) / 2
    _stage(canvas, xs1[1], row1_y, widths1[1], half, "Hear", "Speech-to-Text, twice", True)
    _stage(canvas, xs1[1], row1_y + half + 0.06, widths1[1], half, "Watch", "Gemini", True)
    _stage(
        canvas,
        xs1[2],
        row1_y,
        widths1[2],
        row1_h,
        "Find room",
        f"silences of {product['minSilenceSeconds']:g} s or more, clear of speech",
        False,
    )
    _stage(
        canvas, xs1[3], row1_y, widths1[3], row1_h, "Write", "Gemini: one line per silence", True
    )
    _stage(
        canvas,
        xs1[4],
        row1_y,
        widths1[4],
        row1_h,
        "Review",
        f"Gemini: {product['ruleCount']} cited rules",
        True,
    )
    mid1 = row1_y + row1_h / 2
    for (x, w), nxt in zip(zip(xs1, widths1), xs1[1:]):
        arrow(canvas, [(x + w, mid1), (nxt, mid1)], RULE_STRONG)
    write_c = xs1[3] + widths1[3] / 2
    review_c = xs1[4] + widths1[4] / 2
    loop_y = row1_y - 0.12
    arrow(
        canvas,
        [(review_c, row1_y), (review_c, loop_y), (write_c, loop_y), (write_c, row1_y)],
        RULE_STRONG,
    )
    text(
        canvas,
        box(write_c - 1.2, loop_y - 0.28, (review_c - write_c) + 2.4, 0.24),
        [
            p(
                r(
                    "Rejected: rewritten from the reviewer’s fix, up to "
                    f"{_times(product['rewritesAfterReview'])}",
                    FINE,
                ),
                align="c",
            )
        ],
        "review-loop",
    )

    row2_y, row2_h = row1_y + row1_h + 0.58, 0.72
    widths2 = [1.3, 1.3, 1.35, 1.3, 1.0, 1.67]
    gap2 = 0.26
    xs2 = [0.39]
    for w in widths2[:-1]:
        xs2.append(xs2[-1] + w + gap2)
    stages2 = [
        ("Voice", "Text-to-Speech, Chirp 3 HD", True),
        ("Measure", "the real audio against its room", False),
        ("Final check", "Gemini: the whole track", True),
        ("Fix", "Gemini: rewrite or add a line", True),
        ("Mix", "FFmpeg", False),
        ("Outputs", "MP4 · WAV · WebVTT · script", False),
    ]
    for (name, engine, ai), x, w in zip(stages2, xs2, widths2):
        _stage(canvas, x, row2_y, w, row2_h, name, engine, ai)
    mid2 = row2_y + row2_h / 2
    for (x, w), nxt in zip(zip(xs2, widths2), xs2[1:]):
        arrow(canvas, [(x + w, mid2), (nxt, mid2)], RULE_STRONG)
    bend_y = row1_y + row1_h + 0.26
    voice_c = xs2[0] + widths2[0] / 2
    arrow(
        canvas,
        [(review_c, row1_y + row1_h), (review_c, bend_y), (voice_c, bend_y), (voice_c, row2_y)],
        RULE_STRONG,
    )
    text(
        canvas,
        box(review_c - 3.6, bend_y + 0.03, 3.5, 0.22),
        [p(r("Only lines that pass go on to the voice", FINE), align="r")],
        "pass-label",
    )
    measure_c = xs2[1] + widths2[1] / 2
    loop2_y = row2_y + row2_h + 0.12
    arrow(
        canvas,
        [
            (measure_c, row2_y + row2_h),
            (measure_c, loop2_y),
            (voice_c, loop2_y),
            (voice_c, row2_y + row2_h),
        ],
        RULE_STRONG,
    )
    text(
        canvas,
        box(0.39, loop2_y + 0.04, 3.6, 0.22),
        [
            p(
                r(
                    f"Too long: up to {product['maxSpeedUpPercent']}% faster, else shortened, else "
                    "dropped",
                    FINE,
                )
            )
        ],
        "fit-loop",
    )
    fix_x = xs2[3]
    text(
        canvas,
        box(fix_x - 0.6, row2_y + row2_h + 0.06, 2.5, 0.36),
        [p(r("A fixed line is reviewed, voiced and measured again", FINE), align="c")],
        "fix-note",
    )
    legend_y = loop2_y + 0.4
    if legend_y + 0.2 > 5.3:
        raise RuntimeError(f"{canvas.label}: the legend would sit at {legend_y:.2f} in")
    rect(canvas, box(0.39, legend_y + 0.03, 0.2, 0.14), fill=AI_FILL, line=RULE)
    text(
        canvas,
        box(0.66, legend_y, 3.4, 0.2),
        [p(r("Google AI: Gemini, Speech-to-Text, Text-to-Speech", FINE))],
        "legend-ai",
    )
    rect(canvas, box(4.1, legend_y + 0.03, 0.2, 0.14), fill=WHITE, line=RULE_STRONG)
    text(canvas, box(4.37, legend_y, 3.0, 0.2), [p(r("Gapline’s own code", FINE))], "legend-code")
