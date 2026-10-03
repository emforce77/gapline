"""The system pages: the architecture diagram and the technologies."""

from __future__ import annotations

from pitch_draw import Canvas, box, p, r, text
from pitch_fonts import FAMILY_SEMIBOLD
from pitch_notes import NoteBook
from pitch_parts import headline, table
from pitch_shapes import arrow, rect
from pitch_theme import (
    CARD_TITLE,
    FINE,
    INK,
    INK_3,
    LABEL,
    RULE,
    RULE_STRONG,
    SMALL,
    SURFACE_2,
    WHITE,
)

STAGE_NAME = (FAMILY_SEMIBOLD, 11, INK)
AI_FILL = SURFACE_2


def _access(product: dict) -> str:
    """GEMINI_ACCESS_LABEL (src/lib/models.ts) without its leading 'via '."""
    return product["geminiAccess"].removeprefix("via ")


def _display_model(model_id: str) -> str:
    """'gemini-3.8-flash' -> 'Gemini 3.8 Flash'."""
    return " ".join(part.capitalize() for part in model_id.split("-"))


def build_architecture(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    product = data["product"]
    run = data["cloudRun"]
    model = _display_model(product["model"])
    top = headline(canvas, "One Cloud Run service calls three Google AI services.")
    gcp_x0, gcp_x1 = 1.95, 6.85
    gcp_y0, gcp_y1 = top, 5.14
    rect(
        canvas,
        box(gcp_x0, gcp_y0, gcp_x1 - gcp_x0, gcp_y1 - gcp_y0),
        line=RULE_STRONG,
        dash=True,
        radius=0.06,
        name="gcp",
    )
    text(
        canvas,
        box(gcp_x0 + 0.12, gcp_y0 + 0.06, 3.5, 0.22),
        [p(r(f"Google Cloud · {run['region']}", LABEL))],
        "gcp-label",
    )
    inner_x0, inner_x1 = gcp_x0 + 0.14, gcp_x1 - 0.14

    build_y = gcp_y0 + 0.3
    build_h = 0.4
    _box_with_text(canvas, inner_x0, build_y, 1.3, build_h, "Cloud Build", None)
    _box_with_text(canvas, inner_x0 + 1.62, build_y, 1.6, build_h, "Artifact Registry", None)
    arrow(
        canvas,
        [(inner_x0 + 1.3, build_y + build_h / 2), (inner_x0 + 1.62, build_y + build_h / 2)],
        RULE_STRONG,
    )

    run_y = build_y + build_h + 0.22
    run_h = 1.1
    rect(
        canvas,
        box(inner_x0, run_y, inner_x1 - inner_x0, run_h),
        fill=WHITE,
        line=INK,
        radius=0.05,
        name="cloud-run",
    )
    text(
        canvas,
        box(inner_x0 + 0.14, run_y + 0.1, inner_x1 - inner_x0 - 0.28, run_h - 0.2),
        [
            p(r("Cloud Run service", CARD_TITLE), space_after=2),
            p(
                r(
                    f"Next.js {product['versions']['next'].split('.')[0]} app and FFmpeg in one "
                    "container",
                    SMALL,
                )
            ),
            p(r("Runs the whole pipeline, from hearing the clip to the mix", SMALL), space_after=4),
            p(
                r(
                    f"2nd gen · {run['cpu']} vCPU · {run['memory'].replace('Gi', ' GiB')} · "
                    f"up to {run['max']} instances · {run['timeoutMinutes']:g}-min requests",
                    FINE,
                )
            ),
        ],
        "cloud-run",
    )
    registry_c = inner_x0 + 1.62 + 0.8
    arrow(canvas, [(registry_c, build_y + build_h), (registry_c, run_y)], RULE_STRONG)
    text(
        canvas,
        box(registry_c + 0.06, build_y + build_h + 0.04, 0.8, 0.2),
        [p(r("deploy", FINE))],
        "deploy",
    )

    store_y = run_y + run_h + 0.22
    store_h = gcp_y1 - 0.12 - store_y
    store_w = 3.0
    _box_with_text(
        canvas,
        inner_x0,
        store_y,
        store_w,
        store_h,
        "Cloud Storage",
        "Bucket mounted at /data: uploads, runs, every version. Conditional writes guard the daily "
        "allowance.",
    )
    secret_x = inner_x0 + store_w + 0.22
    _box_with_text(
        canvas,
        secret_x,
        store_y,
        inner_x1 - secret_x,
        store_h,
        "Secret Manager",
        "The Gemini API key",
    )
    store_c = inner_x0 + store_w / 2
    arrow(canvas, [(store_c, run_y + run_h), (store_c, store_y)], RULE_STRONG, both=True)
    secret_c = secret_x + (inner_x1 - secret_x) / 2
    arrow(canvas, [(secret_c, store_y), (secret_c, run_y + run_h)], RULE_STRONG)

    browser_y = run_y + 0.25
    _box_with_text(canvas, 0.39, browser_y, 1.0, 0.92, "Browser", "player and timeline")
    arrow(canvas, [(1.39, browser_y + 0.3), (inner_x0, browser_y + 0.3)], RULE_STRONG)
    arrow(canvas, [(inner_x0, browser_y + 0.64), (1.39, browser_y + 0.64)], RULE_STRONG)
    text(
        canvas,
        box(1.42, browser_y + 0.07, 0.65, 0.2),
        [p(r("clip", FINE), align="c")],
        "clip-label",
    )
    text(
        canvas,
        box(1.39, browser_y + 0.68, 0.7, 0.2),
        [p(r("progress", FINE), align="c")],
        "progress-label",
    )

    ai_x = 7.12
    ai_w = 9.61 - ai_x
    text(canvas, box(ai_x, top + 0.02, ai_w, 0.22), [p(r("Google AI", LABEL))], "ai-label")
    services = [
        (model, f"{_access(product)}: watches, writes, reviews, fixes."),
        ("Speech-to-Text v2, Chirp 3", "Word timings for the dialogue; each silence heard again."),
        ("Text-to-Speech, Chirp 3 HD", "One narrator per language; every take is measured."),
    ]
    ai_h, ai_gap = 0.86, 0.14
    ai_y0 = top + 0.34
    bus_x = 7.0
    centers = []
    for i, (title, body) in enumerate(services):
        y = ai_y0 + i * (ai_h + ai_gap)
        rect(canvas, box(ai_x, y, ai_w, ai_h), fill=AI_FILL, line=RULE, radius=0.05, name=f"ai-{i}")
        text(
            canvas,
            box(ai_x + 0.1, y + 0.07, ai_w - 0.2, ai_h - 0.14),
            [p(r(title, STAGE_NAME), space_after=2), p(r(body, FINE))],
            f"ai-{i}",
        )
        centers.append(y + ai_h / 2)
    run_mid = run_y + run_h / 2
    arrow(canvas, [(inner_x1, run_mid), (bus_x, run_mid)], RULE_STRONG)
    arrow(
        canvas, [(bus_x, min(centers + [run_mid])), (bus_x, max(centers + [run_mid]))], RULE_STRONG
    )
    for c in centers:
        arrow(canvas, [(bus_x, c), (ai_x, c)], RULE_STRONG)


def _box_with_text(
    canvas: Canvas, x: float, y: float, w: float, h: float, title: str, body: str | None
) -> None:
    rect(canvas, box(x, y, w, h), fill=WHITE, line=RULE_STRONG, radius=0.05, name=f"box-{title}")
    paras = [p(r(title, CARD_TITLE))]
    if body:
        paras = [p(r(title, CARD_TITLE), space_after=2), p(r(body, FINE))]
    text(
        canvas,
        box(x + 0.1, y + 0.05, w - 0.2, h - 0.1),
        paras,
        f"box-{title}",
        anchor="m" if not body else "t",
    )


def build_technologies(canvas: Canvas, data: dict, notes: NoteBook) -> None:
    product = data["product"]
    versions = product["versions"]
    model = _display_model(product["model"])
    top = headline(canvas, "The model writes; code decides where each line goes.")
    head = (LABEL[0], 10, INK_3)
    major = lambda words: p(r(words, STAGE_NAME))  # noqa: E731
    minor = lambda words: p(r(words, SMALL))  # noqa: E731
    rows = [
        [[p(r("Technology", head))], [p(r("What it does in Gapline", head))]],
        [
            [major(model), minor(_access(product))],
            [
                minor(
                    f"Watches the clip, writes, reviews against {product['ruleCount']} rules and "
                    "fixes, in checked JSON."
                )
            ],
        ],
        [
            [major("Speech-to-Text v2, Chirp 3")],
            [minor("Word timings for the dialogue, then each silence heard again on its own.")],
        ],
        [
            [major("Text-to-Speech, Chirp 3 HD")],
            [minor("One narrator per language; Gapline measures every take.")],
        ],
        [
            [major("Cloud Run, second generation")],
            [minor("One container runs the Next.js app and FFmpeg; runs stream their progress.")],
        ],
        [
            [major("Cloud Storage")],
            [minor("Uploads, runs and every version; conditional writes guard the allowance.")],
        ],
        [
            [major("Secret Manager, Cloud Build, Artifact Registry")],
            [minor("Keep the Gemini API key; build the image and deploy it to Cloud Run.")],
        ],
        [
            [
                major(
                    f"Next.js {versions['next'].split('.')[0]}, React "
                    f"{versions['react'].split('.')[0]}, TypeScript, Zod "
                    f"{versions['zod'].split('.')[0]}"
                )
            ],
            [minor("Interface and API routes, and a schema check on every model answer.")],
        ],
        [
            [major("FFmpeg")],
            [minor("A 360p copy for Gemini, FLAC for speech, loudness, and the ducked mix.")],
        ],
    ]
    table(canvas, 0.39, top, [3.3, 5.92], rows, 5.14, "tech", pad_in=0.05)
