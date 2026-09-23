# scripts/deck — the pitch deck

## Direction

Builds the AI Builder Cup deck (15 slides plus three "Sources and notes" pages, 1920x1080) from
Scene's own run records, so every number, timeline and bar on a slide is computed, not typed.
`npm run deck` writes `runtime/deck/`: `scene-deck.pdf`, `slides/NN-name.png`, `contact-sheet.png`,
`scene-deck.html` and `scene-deck_check.md` (what the build checked, with word counts per page). It
replaces `scripts/demo/presentation.ts`.
`npm run deck -- --final` also refuses to build while `SUBMISSION` in `facts.ts` lacks the repo,
video or team, or `GEMINI_ACCESS_LABEL` still names OpenRouter; without `--final` those are listed
as open items in the check note and on the console.

- Look: direction A "Screening room" (dark room, film stills, one accent). Amber only marks Scene's
  words; a rejection is an ink strike plus an x mark and a label, never a second hue. Compositions
  vary with the content: full-bleed still (cover), film strip (hook), timelines, flow and architecture
  diagrams, a title-card band with the review chain, still plus bar chart, the product screenshot with
  numbered callouts, one centred number, tables, a log-scale price chart.
- Text budget: judges skim. A slide is a sentence headline (at most 14 words), one exhibit and at
  most 40 words of `.body` prose. `slide({ kind })` sets the cap on all visible text but the page
  number: "prose" 90 words, "exhibit" (table, chart, diagram) 120, "notes" none.
- Sources are endnotes: `notesFor(folio, name)` gives a slide a `note(html)` function that prints a
  small linked superscript and files the text; `slides/15-notes.ts` prints every note, grouped by
  slide, on the last pages (two columns, 18 px). A number that is the slide's point keeps a short tag
  on the slide itself (the Supreme Court case number). Film credits stay on every slide with a frame.
- Data: `data/*.ts` parse the run JSON with zod and throw on a missing file or field, then
  cross-check sums against each run's summary (gaps, narration, edit cost, stage times).
  `data/showcase.ts` reads the Korean run pinned in `runtime/showcase.json` and walks its parents back
  to the automatic run; every run in between is one editor session. Re-pinning the sample changes
  slides 2, 4, 8, 9 and 13 on the next build. The live check (`runtime/demo-v2/live-check.json`)
  must name one of those sessions; its cost and time are checked against that session's summary.
- Second recognizer: `data/recognizers.ts` reads faster-whisper on the whole clip and on short slices
  recognized on their own (`runtime/deck/evidence/slice-asr.json`, written by
  `uv run --with faster-whisper==1.2.1 python scripts/deck/probe/slice_asr.py`, free and local; the
  JSON carries the clip's SHA-256, checked). It gives the launch call's true timing, checks the
  re-listen test fixture still reproduces it, and fails the build if any finished line overlaps speech
  either recognizer hears, or if the seven seconds, recognized alone, hold a word.
- Spectrograms (`spectrogram.ts`) are rendered by ffmpeg on every build from the sample clip: the
  launch-call slide's 0–11 s (assets/spectrograms) and, as evidence only, the seven seconds
  (`runtime/deck/evidence/seven-seconds-spectrogram.png`).
  `facts.ts` holds the outside facts (court, prices, competitors) with their source lines; they come
  from the checked phase-1 research of 2026-09-23 and must be re-checked before submission.
- Gemini access wording comes only from `GEMINI_ACCESS_LABEL` in `src/lib/models.ts`. Clip length and
  upload size come from `src/lib/api-contract.ts`; rule titles, texts and citations from
  `src/lib/pipeline/guidelines.ts` (the reviewer slide renders both rejections' titles and pages from
  it, so a retitled or re-cited rule shows up on the next build). Service settings come from
  `deploy/cloud-run.sh` (the architecture and limits slides parse its flags).
- Reviewer example: one line of the Korean opening followed end to end (`lineHistory` in
  `data/demo.ts`): the default reviewer's draft sent back as low priority (describe the on-screen
  SIMULATION READY instead), the rewrite built from its fix sent back for viewer framing and dropped,
  and its second fix typed by an editor. The slide owns the failure (the first fix broke another rule)
  and the reviewer-prompt change that followed. The honesty slide shows what the final check listed for
  that run (`autoCheck`) and that an editor filled both places; the product capture scrolls Line 5 to
  the second rejection and the editor's version, so the fix on screen is the one the editor typed.
- Fit-loop facts are read from the pipeline, not typed: `data/city.ts` reads `MAX_SPEAKING_RATE`,
  `MAX_SHORTEN_ROUNDS`, `RATE_HEADROOM` and the speed-up rule from `src/lib/pipeline/fit-voice.ts`, and recovers the unstored
  1.0x take of a sped-up version from its rate (the newspaper's shortened line: 3.52–3.55 s at 1.0x,
  3.91 s at 1.04x). The slide draws that take outlined and labels it inferred.
- `data/loops.ts` counts what the review and fit loops did in the default reviewer's finished
  evaluation runs; slide 5 prints those counts and fails if a dropped line is left by neither loop.
- Stills come from the Blender 1080p master, fetched once into `runtime/deck/cache/` and checked by
  SHA-256. Before cutting, `film.ts` proves the repo clips' offsets against the master
  (clip.mp4 = film 0–65 s, eval-tos-city.mp4 = film 65–110 s); a mismatch stops the build.
- Product screenshots are taken fresh at device scale 2 with `--screens` from a running Scene
  (`SCENE_APP_URL`, default the local dev server): the whole English workspace (1440x900 window) with
  Line 5 selected, plus the element boxes the callouts point at (`workspace-line5.json`). Requests
  that could start a paid run or edit are aborted.
- Fonts are static cuts (Newsreader 72pt, IBM Plex Mono vendored in `fonts/` with their OFL texts;
  Pretendard static woff2 from `node_modules/pretendard`), so the PDF embeds CID TrueType, not Type 3.

Not in scope: the demo video (`scripts/demo/`), deployment, and the story's wording decisions
(the story spine lives with the deck owner).

## Checks the build runs (it fails instead of writing a doubtful deck)

Fonts actually painted (CDP `getPlatformFontsForNode`: headlines Newsreader, Korean Pretendard,
timecodes Plex Mono); text at least 22 px, grey text at least 24 px (credits, note markers and the
notes pages 18 px); contrast at least 4.5:1 on its backdrop; no text within 24 px of a slide edge
unless it sits on film; no clipped, cut-off or overlapping text; the notes columns do not spill;
all visible text per slide within its budget, headline at most 14 words, prose at most 40; no
reference to another slide by number; every marker has its note and every note a marker; zero
remote requests; `pdffonts` shows no Type 3 and every face embedded; `pdftotext` returns the Korean.

## Debug log

- [2026-09-23] Round 5: the launch call. The lead measured that Chirp 3 put "We have main engine
  start." at 2.32–3.96 s; recognized slice by slice (faster-whisper small, sample-exact slices of one
  decoded track) it is at 4.40–6.16 s, and the spectrogram shows the voice at about 4.8–6.3 s. The
  showcase line at 4.50 s talked over it; an editor removed it (pinned run edit-b0521888…, 5 lines,
  3 editor sessions). The "disputed band" hatch on slide 4 is gone: the call is drawn where it is
  heard, the 2.38 s silence struck, the removed line struck. New slide 10 tells the story; the fix
  (re-listen each silence) is unit-tested with a fixture only, not run on real audio. Cutting slices
  with `-ss` on the mp4 gave "Roger." instead of "Roger, Roger." (AAC seek offset); the probe now
  decodes the whole track once and slices by sample, which matches the lead's result and reruns
  identically. The seven seconds recognized alone return no words and their spectrogram shows only
  steady tones (checked by eye); "hum and music" stays Gemini's label, nobody listened.
  `run.ts` was split: the speed-up rule moved to `fit-voice.ts` (the deck now reads it there).

- [2026-09-23] Earlier direction A examples used a reviewer rejection ("no crosshairs visible") that
  the master's frames put in doubt (entry below). The reviewer slide now uses the Korean line at 54.2 s from the default-reviewer
  run, whose first rejection points at the on-screen "SIMULATION READY" the still shows.
- [2026-09-23] Variable Newsreader/Pretendard embedded as Type 3 in Chrome's PDF; static cuts fixed it
  (checked with pdffonts).
- [2026-09-23] The story spine's word-count estimate for the newspaper line (2.8 s) assumed 7 words;
  the line has 8, so the estimate is 3.20 s, still under its 3.50 s of silence. The slide computes it.
- [2026-09-23] tsx keeps function names with `__name()`; code evaluated in the page needs a
  `window.__name` shim (added as an init script).
- [2026-09-23] Revision after two critiques. Fixed: "silence" where the number was the room before the
  next line (slides 1, 6, 7, 8); a run "finishes even if the viewer leaves" (Cloud Run CPU is
  request-based, never tested); "nothing is voiced unless reviewed" (edits are voiced, then reviewed;
  now "nothing ships"); a legal duty for distributors (slide 12 now states the 2017 ruling's
  condition); Scene's API cost on a price axis (now set apart as "not a price"); ViddyScribe "No"
  inferred from marketing (now a dash); "shortened 3.91 s" without its 1.04× speed; "facts written
  before the runs" (not for the opening); the undeployed zero-length-word fix (removed).
- [2026-09-23] The city "no crosshairs" rejection is disputed, not settled: on the 1080p master at
  film 90.5 s a faint vertical reticle line with tick marks runs down the scope's centre above the
  airship (contrast-enhanced crop: `runtime/deck/evidence/reticle-film-90.5s-enhanced.jpg`). The
  deck does not use that example.
- [2026-09-23] The first rejection on slide 6 cites the "redundant" rule (KMCC p.8), but its reason
  (describe the on-screen text) matches KMCC p.7's list of what must be described. The slide quotes
  the rule clause that applied and notes p.7 in its source line until the rule's source cites p.7.

- [2026-09-23] Round 4 (panels 74 and 72/100). False: the opening's "second recognizer hears a
  countdown Chirp 3 does not" (both hear it; faster-whisper times the launch call 1.89 s later, over
  the 4.50 s line; the hatch is now 4.21–6.84 s, computed from both word lists). Risky, fixed: "three
  Google AI APIs" beside "via OpenRouter" (headline now "three Google models"; the note reads "Gemini
  access: <label>"); "every take exceeds 3.50 s at 1.15x" (the sped-up take came back longer than
  its 1.0x take; shown with rates); "4.50 s of room" on the cover (now "before its next line");
  "two in three" (nearly); "Pays" (now "Would pay", a hypothesis); TV as a gap; the cheaper-setting
  reviewer example; "stopped instead of inventing silences" (now a limit on slide 13 with the fix);
  30 MiB (undeployed; dropped). Hear and Watch are drawn in parallel; slides 5 and 10 name the same
  stages. Chirp 3's "us" location is explained (Google lists Chirp 3 only in us and eu, read
  23 Sep 2026). Big serif numerals are left on the hook slide only; repo paths left the notes.
- [2026-09-23] Round 3 (panel 72/100: too much text, footers read like an audit, repeated template).
  The checker used to count only `.body` nodes and passed slides of 112–257 words; it now counts all
  visible text. Two-line source footers became endnotes. The reviewer example moved off the Korean
  line at 54.2 s, whose first rejection was a priority complaint and whose first suggested fix led to
  the second rejection. Searched every stored run for a "word count fits, voice does not" case whose
  room ends at dialogue: the only one is the 21 Sep English run's "Blender Foundation Presents" line
  (room 0–2.07 s before "Launch"), rejected because it predates the current pipeline and starts at
  0 s while the title appears at about 1.55 s (frame brightness measured on the clip). The newspaper
  case stays, with its room explained (the headline's shot, then the next shot's line) and the 1.04×
  detail removed; its first take at 1.0× was never logged. The stage-time strip left the Google Cloud
  slide (it came from a local run).

## Status

Last built 2026-09-23 (round 5) from the dev server (`--screens`) and runtime records; all layout,
text-budget, font and PDF checks pass (product 90/90 and business 120/120 words are at their caps);
4 submission items open (see `runtime/deck/scene-deck_check.md`). Notes pages split before slides 6
and 10 (`NOTE_PAGES`); page 3 is full, so a longer note there needs a fourth page. The 1080p master
stays in `runtime/deck/cache/` (584 MB) for `--stills`; delete it when the stills are final.
