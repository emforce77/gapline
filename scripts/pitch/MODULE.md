# scripts/pitch — the submission deck in the official template

## Direction

The AI Builder Cup's mandatory submission rules (pasted by the owner on 2026-09-29) require the pitch
deck in the prescribed Hack2skill template ("Submissions that do not follow the required format may
be subject to disqualification"); aibuildercup.com asks for "a deck/PPT converted into a PDF". The
HTML deck (`scripts/deck`, the dark "Screening room" design) does not follow that template, so this
module builds the submission deck from the template file itself:
Google Slides `13rg7vW43mEH6DkpuusAE6fdoEylSFz8waNpE4RLzoUg`, exported as PPTX and pinned by SHA-256
in `pitch_template.py`.

- Template kept: the cover (team details), the header band with the Google Cloud, AI Builder Cup and
  H2S marks, the foot bar, every section title in the organisers' order, and the thank-you page.
  Removed: the download-instructions page and the two optional sections (wireframes, implementation
  cost). A section that needs two pages gets a clone of its own page (Opportunities, Performance
  report / Benchmarking, Additional details / Future). The spare page holds the sources.
- Content is native and editable (text, shapes, lines, typographic tables); pictures are the film
  stills and spectrogram the HTML deck already cut, and two live snapshots.
- Numbers come from `export-data.ts`, which imports the HTML deck's checked data modules (they parse
  the run records and throw when a guard fails) and the source that sets each setting (models.ts,
  api-contract.ts, deploy/cloud-run.sh, the pipeline). The owner's wording rules carry over: no
  totals from the one sample run, outside sources only in the notes, the optional edit told once.
- Font: Google Sans Flex, the template's own (OFL, google/fonts@3dc14e61), cut into the static
  weights the template names; Pretendard for the one Korean quote. Monotone ink, amber only for
  Gapline's lines.
- Rendering: LibreOffice 26.2.6.3 (official AppImage, pinned by SHA-256, extracted into
  `runtime/pitch/cache`), because the machine's LibreOffice 7.3 has no Impress module and cannot
  pick weights from a variable font. Nothing is installed system-wide.

Not in scope: Firebase or Firestore (Gapline uses neither, so the deck does not claim them), the
demo video, the submission form's brief description.

## Files

- **`build_pitch.py`** — entry: page order, section titles, render, checks, check note
- `export-data.ts` — numbers and settings to `runtime/pitch/pitch-data.json`; `snapshots.ts` — live screens
- `pitch_template.py` — pinned template, clone/move/delete pages, section titles
- `pitch_draw.py` — measured text boxes; `pitch_shapes.py` — rects, lines, arrows, pictures;
  `pitch_parts.py` — headline, credit, cards, tables; `pitch_theme.py` — tokens; `pitch_fonts.py`
- `slides_opening.py` (cover, brief), `slides_opportunities.py`, `slides_solution.py` (features,
  process flow), `slides_system.py` (architecture, technologies), `slides_proof.py` (snapshots,
  performance, benchmarking), `slides_closing.py` (business, next, links, notes); `pitch_notes.py`
- `pitch_render.py` — LibreOffice, page PNGs, contact sheet; `pitch_checks.py` — PDF checks
- Out: `runtime/pitch/gapline-pitch.pdf` (submit this), `.pptx` (editable), `gapline-pitch_check.md`

## Run

1. `npm run pitch:snapshots` — two screenshots of the live service (read-only: non-GET requests are
   aborted). Re-run when the UI or the pinned sample changes.
2. `npm run pitch` — exports the data, builds `runtime/pitch/gapline-pitch.pptx` and `.pdf`, renders
   `pages/*.png` and `contact-sheet.png`, and writes `gapline-pitch_check.md`.
3. Before submission: set `TEAM_LEADER` in `export-data.ts`, then `npm run pitch -- --final` (refuses
   open items: leader, links, an OpenRouter label).

## Checks (the build stops instead of writing a doubtful deck)

- Before writing, every text box is measured with the same font cuts LibreOffice uses (greedy wrap,
  line pitch 1.2 × size × spacing, measured on 26.2.6.3); a box its text would overflow stops the
  build, naming the slide and the text. Nothing shrinks to fit.
- After rendering (`pdftotext -bbox`, `pdffonts`, pypdf): each page carries its section title in the
  template's order; only Google Sans Flex cuts and Pretendard, all embedded, no Type 3 (a fallback
  font means a missing glyph: the font has no arrows, check marks or ●); no two words overlap and
  none enters the header band, foot bar or page edge; the three links are clickable; no defensive
  negatives anywhere and no run ids, field ids, guideline acronym, page citations, speed multipliers,
  sample figures or API costs on slide faces.

## Debug log

- [2026-09-29] LibreOffice 7.3 (apt) printed "source file could not be loaded" for every PPTX: only
  `libreoffice-core` and `-writer` are installed. The pinned AppImage converts the same file.
- [2026-09-29] First render embedded DejaVu Sans: Google Sans Flex lacks → ← ✓ ✕ ● (checked with
  the cmap). Arrows are drawn as lines, marks are "×" or words.
- [2026-09-29] Line pitch measured at 1.200 × size (100%) and 1.343 × size (112%) for 10–22 pt,
  not the 1.252 the font's typo metrics give; widths matched PIL within 0.3% (2% margin kept).
- [2026-09-29] LibreOffice writes the bare-host Cloud Run link with a trailing slash; the link check
  compares without it.
- [2026-10-04] Rebuild stopped at "the notes do not fit two columns": the guideline sources grew
  (f8fca25, 67a1e1c), so note 10 went from 2 to 5 lines; the greedy fill measured 276.5 + 283.0 +
  45.5 pt against 301 pt columns. Note 10 now names the guides as "KMCC guideline" and "Netflix AD
  Style Guide" (notes 8 and 9 give the full names), and a section carried into the second column
  no longer repeats its heading: 276.5 + 294.3 pt.
- [2026-10-04] Page 7 read "0`–8 instances": the deploy-flag parser took the first
  `--min-instances` in deploy/cloud-run.sh, now inside a comment. One parser
  (scripts/deck/data/deploy.ts) skips comment lines and reads `${VAR:-default}` as its default; the
  slide says "up to 8 instances", since the live minimum (0) differs from the script default (1).

## Status

Built 2026-10-04 with snapshots of the current service (scene-ad-117546381357): 16 pages in the
template's order, all checks passing; replaced the release asset of v0.2.0-preview. The cover names the team
leader, Jeyoon Yeom (owner, 2026-09-29), and `npm run pitch -- --final` passes.
