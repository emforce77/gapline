"""Build Gapline's AI Builder Cup pitch deck in the official Hack2skill template.

Why: the submission rules require the prescribed template ("Submissions that do not follow the
required format may be subject to disqualification"). The deck therefore starts from the template
file itself, keeps its cover, frame, section titles, order and thank-you page, and fills each
section with native, editable text, shapes and tables.

In:  runtime/pitch/pitch-data.json (scripts/pitch/export-data.ts), runtime/pitch/snapshots/
     (scripts/pitch/snapshots.ts), the HTML deck's film stills and spectrogram
     (runtime/deck/assets),
     the pinned template (runtime/pitch/cache).
Out: runtime/pitch/gapline-pitch.pptx and .pdf, pages/*.png, contact-sheet.png, and
     gapline-pitch_check.md. The build stops on any check problem; --final also stops on open items.

Run: npm run pitch  (npm run pitch -- --final before submission)
"""

from __future__ import annotations

import copy
import json
import sys
from datetime import date

from pitch_checks import (
    check_collisions,
    check_fonts,
    check_links,
    check_order,
    check_wording,
    page_texts,
    pdf_words,
)
from pitch_draw import Canvas
from pitch_fonts import GOOGLE_FONTS_COMMIT, prepare_pitch_fonts
from pitch_notes import FIXED_NOTES, NoteBook, data_notes
from pitch_paths import CHECK_NOTE, CONTACT_SHEET, DATA_JSON, PDF, PPTX, SNAPSHOT_MANIFEST
from pitch_render import LO_VERSION, contact_sheet, pdf_to_pages, pptx_to_pdf
from pitch_template import (
    ADDITIONAL,
    ARCHITECTURE,
    BRIEF,
    COST,
    COVER,
    FEATURES,
    INSTRUCTIONS,
    LINKS,
    OPPORTUNITIES,
    PERFORMANCE,
    PROCESS_FLOW,
    SNAPSHOTS,
    SPARE,
    TECHNOLOGIES,
    TEMPLATE_SHA256,
    THANK_YOU,
    WIREFRAMES,
    clone_slide,
    delete_slide,
    move_slide,
    open_template,
    set_title,
    title_box,
)
from pitch_theme import MIN_FACE_PT, MIN_NOTES_PT
from slides_closing import build_business, build_links, build_next, build_notes_page
from slides_opening import build_brief, fill_cover
from slides_opportunities import build_opportunities, build_why_now
from slides_proof import build_benchmarking, build_performance, build_snapshots
from slides_solution import build_features, build_process_flow
from slides_system import build_architecture, build_technologies

TITLES = [
    "Team Details",
    "Brief about the idea",
    "Opportunities",
    "Opportunities",
    "List of features offered by the solution",
    "Process flow diagram",
    "Architecture diagram of the proposed solution",
    "Technologies to be used in the solution",
    "Snapshots of the prototype",
    "Prototype Performance report",
    "Benchmarking",
    "Additional Details/Future Development",
    "Additional Details/Future Development",
    "Links",
    "Sources and notes",
    None,  # the template's thank-you page is a picture
]
NOTES_PAGE = TITLES.index("Sources and notes")


def open_items(data: dict) -> list[str]:
    items = []
    if not data["team"]["leader"]:
        items.append(
            "team leader name is blank on the cover: set TEAM_LEADER in "
            "scripts/pitch/export-data.ts"
        )
    for key, url in data["links"].items():
        if not url:
            items.append(f"no {key} link: set it in scripts/deck/facts.ts SUBMISSION")
    if "openrouter" in data["product"]["geminiAccess"].lower():
        items.append("the Gemini access label still names OpenRouter (src/lib/models.ts)")
    return items


def assemble(data: dict) -> tuple[list[Canvas], NoteBook]:
    prs = open_template()
    t = list(prs.slides)
    page = {n: t[n - 1] for n in range(1, len(t) + 1)}
    solves = clone_slide(prs, page[OPPORTUNITIES])
    benchmarking = clone_slide(prs, page[PERFORMANCE])
    future = clone_slide(prs, page[ADDITIONAL])
    order = [
        page[COVER],
        page[BRIEF],
        page[OPPORTUNITIES],
        solves,
        page[FEATURES],
        page[PROCESS_FLOW],
        page[ARCHITECTURE],
        page[TECHNOLOGIES],
        page[SNAPSHOTS],
        page[PERFORMANCE],
        benchmarking,
        page[ADDITIONAL],
        future,
        page[LINKS],
        page[SPARE],
        page[THANK_YOU],
    ]
    for i, slide in enumerate(order):
        move_slide(prs, slide, i)
    for unused in (INSTRUCTIONS, WIREFRAMES, COST):
        delete_slide(prs, page[unused])
    for slide, title in zip(order, TITLES):
        if title and slide not in (page[COVER], page[SPARE], page[LINKS]):
            set_title(slide, title)

    spare_title = copy.deepcopy(title_box(page[BRIEF])._element)  # before any page is filled
    notes = NoteBook({**FIXED_NOTES, **data_notes(data)})
    canvases = [
        Canvas(slide, f"{i + 1:02d} {title or 'Thank you'}")
        for i, (slide, title) in enumerate(zip(order, TITLES))
    ]
    fill_cover(page[COVER], data, canvases[0])
    builders = [
        build_brief,
        build_why_now,
        build_opportunities,
        build_features,
        build_process_flow,
        build_architecture,
        build_technologies,
        build_snapshots,
        build_performance,
        build_benchmarking,
        build_business,
        build_next,
        build_links,
    ]
    for canvas, build in zip(canvases[1:], builders):
        build(canvas, data, notes)
    build_notes_page(canvases[NOTES_PAGE], spare_title, notes)
    prs.save(PPTX)
    return canvases, notes


def write_check_note(
    data: dict, canvases: list[Canvas], notes: NoteBook, results: dict, items: list[str]
) -> None:
    meta = data["meta"]
    snap = json.loads(SNAPSHOT_MANIFEST.read_text())
    records = [t for c in canvases for t in c.texts]
    face_min = min(t.min_pt for t in records if not t.name.startswith("notes") and t.min_pt)
    notes_min = min((t.min_pt for t in records if t.name.startswith("notes")), default=0)
    lines = [
        f"# gapline-pitch.pdf — check ({date.today().isoformat()})",
        "",
        "Built by `npm run pitch` (scripts/pitch/build_pitch.py) from the official Hack2skill "
        "template",
        f"(SHA-256 {TEMPLATE_SHA256[:12]}…), `pitch-data.json` (commit {meta['gitCommit']}"
        f"{', dirty tree' if meta['gitDirty'] else ''}, sample run {meta['sampleRun']}) and "
        "snapshots of",
        f"{snap['appUrl']} taken {snap['capturedAt']}. Rendered by LibreOffice {LO_VERSION} with "
        "Google Sans",
        f"Flex from google/fonts@{GOOGLE_FONTS_COMMIT[:8]}.",
        "",
        f"- [x] template: {len(TITLES)} pages in the template's order, each with its section "
        "title; "
        "removed: the download-instructions page and the two optional sections (wireframes, cost)",
        f"- [x] fonts embedded, no fallback, no Type 3: {', '.join(results['fonts'])}",
        f"- [x] text fit: {len(records)} text boxes measured before writing, 0 overflow; smallest "
        "text "
        f"{face_min:g} pt on slide faces (floor {MIN_FACE_PT}), {notes_min:g} pt in the notes "
        f"(floor {MIN_NOTES_PT})",
        "- [x] collisions: 0 overlapping words, 0 words in the header band, foot bar or page edge",
        f"- [x] links clickable: {', '.join(sorted(set(results['links'])))}",
        "- [x] wording: 0 defensive negatives or slide-face jargon; the optional edit on page(s) "
        f"{results['edit_pages']}",
        f"- [x] endnotes: {len(notes.order)}, each cited on a slide, outside sources only",
    ]
    lines += [f"- [ ] **open**: {item}" for item in items]
    lines += ["", "Pages (words of visible text):", ""]
    for canvas, text in zip(canvases, results["texts"]):
        lines.append(f"- {canvas.label}: {len(text.split())} words")
    CHECK_NOTE.write_text("\n".join(lines) + "\n")


def main(argv: list[str]) -> int:
    final = "--final" in argv
    data = json.loads(DATA_JSON.read_text())
    if not SNAPSHOT_MANIFEST.exists():
        raise RuntimeError("no snapshots: run `node --import tsx scripts/pitch/snapshots.ts` first")
    items = open_items(data)
    if final and items:
        raise RuntimeError("not final: " + "; ".join(items))
    prepare_pitch_fonts()
    canvases, notes = assemble(data)
    pptx_to_pdf(PPTX, PDF)
    pages = pdf_words(PDF)
    texts = page_texts(pages)
    problems = check_order(texts, TITLES)
    font_problems, fonts = check_fonts(PDF)
    problems += font_problems
    problems += check_collisions(pages, skip={len(TITLES) - 1})
    link_problems, links = check_links(PDF, [u for u in data["links"].values() if u])
    problems += link_problems
    wording_problems, edit_pages = check_wording(texts, NOTES_PAGE)
    problems += wording_problems
    contact_sheet(pdf_to_pages(PDF))
    if problems:
        sys.stderr.write("check problems:\n" + "\n".join(f"  - {p}" for p in problems) + "\n")
        return 1
    results = {"fonts": fonts, "links": links, "edit_pages": edit_pages, "texts": texts}
    write_check_note(data, canvases, notes, results, items)
    sys.stdout.write(
        f"wrote {PPTX.name}, {PDF.name} ({len(texts)} pages), {CONTACT_SHEET.name}, "
        f"{CHECK_NOTE.name}\n"
    )
    for item in items:
        sys.stdout.write(f"open: {item}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
