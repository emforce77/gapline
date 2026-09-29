"""The proof pages: live snapshots, what the checks did on a real film, and benchmarking.

Numbers here belong to an example (a line's room, its voice, a call's timing); no totals from the
single sample run appear (owner, 2026-09-28).
"""

from __future__ import annotations

from pitch_draw import Canvas, box, p, r, text
from pitch_fonts import FAMILY_SEMIBOLD
from pitch_notes import NoteBook
from pitch_parts import card, columns, credit, headline, table
from pitch_paths import SNAPSHOTS, SPECTROGRAMS, STILLS
from pitch_shapes import line, picture, rect
from pitch_theme import (
    AMBER,
    AMBER_EDGE,
    CARD_TITLE,
    FINE,
    INK,
    INK_3,
    LABEL,
    RULE,
    RULE_STRONG,
    SMALL,
    SPEECH,
    SURFACE_2,
    WHITE,
)

EMU = 914400
SUPPORT_WORD = {"yes": "Yes", "partly": "Partly", "no": "No", "unknown": "—"}


def build_snapshots(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    top = headline(canvas, "Hear the sample, then see how each line was made.")
    gap = 0.26
    w = (9.22 - gap) / 2
    h = w * 900 / 1440
    shots = [
        (
            "landing.png",
            "Start: play the seven silent seconds with and without description, or upload your own "
            "clip.",
        ),
        (
            "workspace.png",
            "Workspace: each line sits in its silence; Line 2 shows the draft the reviewer sent "
            "back and the rewrite.",
        ),
    ]
    for i, (name, caption) in enumerate(shots):
        x = 0.39 + i * (w + gap)
        picture(canvas, SNAPSHOTS / name, box(x, top, w, h), border=RULE)
        text(canvas, box(x, top + h + 0.1, w, 0.5), [p(r(caption, SMALL))], f"snapshot-{i}")
    credit(canvas, f"Screens from the live Cloud Run service · {data['filmCredit']}")


def _card_inner(where) -> tuple[float, float, float, float]:
    x, y, w, h = where.x / EMU, where.y / EMU, where.w / EMU, where.h / EMU
    pad = 0.12
    return x + pad, y + pad, w - 2 * pad, h - 2 * pad


PROOF_IMAGE_ASPECT = 3.2


def _reviewer_card(canvas: Canvas, where, data: dict, notes: NoteBook, section: str) -> None:
    rev = data["reviewer"]
    x, y, w, h = _card_inner(where)
    img_h = w / PROOF_IMAGE_ASPECT
    picture(canvas, STILLS / "line-start.jpg", box(x, y, w, img_h))
    text(
        canvas,
        box(x, y + img_h + 0.1, w, h - img_h - 0.1),
        [
            p(r("The reviewer sent a line back", CARD_TITLE), space_after=6),
            p(r("Draft  ", LABEL), r(rev["draft"], (SMALL[0], SMALL[1], INK_3), strike=True)),
            p(
                r("× " + " · ".join(rev["rejectedFor"]), (FINE[0], FINE[1], INK)),
                r(notes.mark("reviewer_rules", section), FINE, sup=True),
                space_after=6,
            ),
            p(r("Rewrite  ", LABEL), r(rev["rewrite"], (FAMILY_SEMIBOLD, SMALL[1], INK))),
            p(r(f"Passed and voiced: {rev['voiced']:.2f} s in its {rev['room']:.1f} s room", FINE)),
        ],
        "reviewer",
    )


def _voice_card(canvas: Canvas, where, data: dict, notes: NoteBook, section: str) -> None:
    news = data["newspaper"]
    x, y, w, h = _card_inner(where)
    img_h = w / PROOF_IMAGE_ASPECT
    picture(canvas, STILLS / "news.jpg", box(x, y, w, img_h))
    ty = y + img_h + 0.1
    first, sped = news["tries"][0], news["tries"][1]
    text(canvas, box(x, ty, w, 0.26), [p(r("The voice ran long", CARD_TITLE))], "voice-title")
    chart_top = ty + 0.56
    label_w = 1.1
    bar_x0 = x + label_w
    bar_w = w - label_w - 0.02
    t_max = 4.8

    def at(seconds: float) -> float:
        return bar_x0 + seconds / t_max * bar_w

    rows = [
        ("Estimate", news["estimate"], "fits on paper", "words_per_second"),
        ("Real voice", first["voiced"], "too long", None),
        ("Shortened, faster", sped["voiced"], "still too long", None),
    ]
    row_h = 0.3
    room_x = at(news["room"])
    line(
        canvas,
        int(room_x * EMU),
        int((chart_top - 0.05) * EMU),
        int(room_x * EMU),
        int((chart_top + 3 * row_h) * EMU),
        INK,
        dash=True,
    )
    text(
        canvas,
        box(room_x - 0.6, chart_top - 0.25, 1.2, 0.2),
        [p(r(f"Room {news['room']:.2f} s", (FINE[0], FINE[1], INK)), align="c")],
        "room",
    )
    for i, (label, seconds, verdict, note_key) in enumerate(rows):
        ry = chart_top + i * row_h
        runs = [r(label, FINE)]
        if note_key:
            runs.append(r(notes.mark(note_key, section), FINE, sup=True))
        text(canvas, box(x, ry, label_w - 0.04, row_h), [p(*runs)], f"voice-label-{i}", anchor="m")
        bar_h = 0.13
        bar_y = ry + (row_h - bar_h) / 2 - 0.06
        if i == 0:
            rect(
                canvas,
                box(bar_x0, bar_y, at(seconds) - bar_x0, bar_h),
                fill=WHITE,
                line=RULE_STRONG,
                dash=True,
            )
        else:
            rect(
                canvas, box(bar_x0, bar_y, at(seconds) - bar_x0, bar_h), fill=AMBER, line=AMBER_EDGE
            )
        text(
            canvas,
            box(bar_x0, bar_y + bar_h, bar_w, 0.17),
            [p(r(f"{seconds:.2f} s, {verdict}", FINE))],
            f"voice-value-{i}",
        )
    text(
        canvas,
        box(x, chart_top + 3 * row_h + 0.06, w, y + h - (chart_top + 3 * row_h + 0.06)),
        [
            p(
                r(
                    "Timed on its real voice, the line was dropped rather than run into the next.",
                    SMALL,
                )
            )
        ],
        "voice-caption",
    )


def _listen_card(canvas: Canvas, where, data: dict) -> None:
    """The launch call: its sound, where the first listen put a silence, and the second listen."""
    call = data["launchCall"]
    x, y, w, h = _card_inner(where)
    span = 11.0
    label_w = 0.94
    lane_x0 = x + label_w
    lane_w = w - label_w

    def at(t: float) -> float:
        return lane_x0 + t / span * lane_w

    img_h = w / PROOF_IMAGE_ASPECT
    text(
        canvas,
        box(x, y, label_w - 0.04, img_h),
        [p(r("Sound", LABEL)), p(r(f"0–{span:g} s", FINE))],
        "sound-label",
        anchor="m",
    )
    picture(canvas, SPECTROGRAMS / "launch-call.png", box(lane_x0, y, lane_w, img_h), stretch=True)
    ty = y + img_h + 0.1
    text(
        canvas,
        box(x, ty, w, 0.5),
        [p(r("The first listen missed the launch call", CARD_TITLE))],
        "listen-title",
    )
    lanes_top = ty + 0.54
    lane_h = 0.4
    for i, label in enumerate(("Heard once", "Heard twice")):
        text(
            canvas,
            box(x, lanes_top + i * lane_h, label_w - 0.02, 0.24),
            [p(r(label, LABEL))],
            f"lane-{i}",
            anchor="m",
        )
    once_y = lanes_top + 0.06
    first = call["firstListen"]
    rect(
        canvas,
        box(at(first["start"]), once_y, at(first["end"]) - at(first["start"]), 0.12),
        fill=SPEECH,
    )
    silence = call["silence"]
    rect(
        canvas,
        box(at(silence["start"]), once_y - 0.02, at(silence["end"]) - at(silence["start"]), 0.16),
        line=RULE_STRONG,
        dash=True,
    )
    over = call["lineOverCall"]
    rect(
        canvas,
        box(
            at(over["start"]),
            once_y + 0.02,
            at(over["start"] + over["voiced"]) - at(over["start"]),
            0.08,
        ),
        fill=AMBER,
        line=AMBER_EDGE,
    )
    text(
        canvas,
        box(lane_x0, once_y + 0.16, lane_w, 0.17),
        [p(r("× a line spoken over it", (FINE[0], FINE[1], INK)))],
        "once-note",
    )
    twice_y = lanes_top + lane_h + 0.06
    heard = call["relisten"]
    rect(
        canvas,
        box(at(heard["start"]), twice_y, at(heard["end"]) - at(heard["start"]), 0.12),
        fill=SPEECH,
    )
    text(
        canvas,
        box(lane_x0, twice_y + 0.16, lane_w, 0.17),
        [p(r("heard; no line written", (FINE[0], FINE[1], INK)))],
        "twice-note",
    )
    axis_y = lanes_top + 2 * lane_h + 0.02
    line(
        canvas,
        int(lane_x0 * EMU),
        int(axis_y * EMU),
        int((lane_x0 + lane_w) * EMU),
        int(axis_y * EMU),
        RULE,
    )
    for t in (0, 5, 10):
        text(
            canvas,
            box(at(t) - 0.2, axis_y + 0.02, 0.4, 0.17),
            [p(r(f"{t} s", FINE), align="c")],
            f"tick-{t}",
        )
    cap_y = axis_y + 0.26
    text(
        canvas,
        box(x, cap_y, w, y + h - cap_y),
        [p(r("Now every silence is heard twice.", SMALL))],
        "listen-caption",
    )


def build_performance(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "Prototype Performance report"
    top = headline(canvas, "Gapline’s checks caught what a word count would miss.")
    where = columns(0.39, top, 9.22, 3, 0.18, 5.14 - top - 0.24)
    for i, w in enumerate(where):
        card(canvas, w, f"proof-{i}")
    _reviewer_card(canvas, where[0], data, notes, section)
    _voice_card(canvas, where[1], data, notes, section)
    _listen_card(canvas, where[2], data)
    credit(canvas, data["filmCredit"])


def build_benchmarking(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    section = "Benchmarking"
    top = headline(canvas, "Others fit the voice or check by hand; Gapline does both.")
    compare = data["facts"]["compare"]
    head = (LABEL[0], 9.5, INK_3)
    header = [[p(r("", head))]] + [[p(r(col, head))] for col in compare["columns"]]

    def cell(c: dict, strong: bool) -> list:
        word = SUPPORT_WORD[c["support"]]
        paras = [
            p(r(word, (FAMILY_SEMIBOLD, SMALL[1], INK) if strong else (SMALL[0], SMALL[1], INK)))
        ]
        if c["note"]:
            paras.append(p(r(c["note"], FINE)))
        return paras

    rows = [header]
    for comp in compare["competitors"]:
        rows.append(
            [[p(r(comp["name"], (SMALL[0], SMALL[1], INK)))]]
            + [cell(c, False) for c in comp["cells"]]
        )
    rows.append(
        [[p(r("Gapline", (FAMILY_SEMIBOLD, 12.5, INK)))]]
        + [cell(c, True) for c in compare["gapline"]]
    )
    widths = [1.6] + [(9.22 - 1.6) / 6] * 6
    bottom = table(
        canvas,
        0.39,
        top,
        widths,
        rows,
        5.0,
        "compare",
        shade_rows=(len(rows) - 1,),
        shade=SURFACE_2,
        pad_in=0.05,
    )
    text(
        canvas,
        box(0.39, bottom + 0.08, 9.22, 0.22),
        [p(r("— = not published", FINE), r(notes.mark("landscape", section), FINE, sup=True))],
        "compare-legend",
    )
