# scripts/deck — the pitch deck

## Direction

Product name: Gapline (renamed from Scene on 2026-09-28; entries before that date use the old name).

Builds the AI Builder Cup deck (14 slides plus "Sources and notes" pages, 1920x1080) from Scene's
own run records, so every number, timeline and bar on a slide is computed, not typed. The order is
`PAGES` in `slides/index.ts`: cover, seven seconds, why now, fit the silence, product, how it checks
itself, reviewer, measured, Scene listens twice, Google Cloud, how Scene differs, business, what we
will test next, close. Page numbers and notes groups follow a slide's position there, not its file
name (`08-editor.ts` is slide 5, the product).
`npm run deck` writes `runtime/deck/`: `gapline-deck.pdf`, `slides/NN-name.png`, `contact-sheet.png`,
`gapline-deck.html` and `gapline-deck_check.md` (what the build checked, with word counts per page).
The HTML opens as an offline presentation fitted to the window: arrows or Space advance,
Home/End jump to the first/last page, and Sources opens the notes. Escape or Back to slides returns
from the notes; source markers jump to the matching note. The current page survives a reload.
Printing includes every page at full resolution. The build uses `?export` to inspect every slide
at its original 1920x1080 size; `presenter.ts` keeps this viewer separate from the slide designs.
`npm run deck -- --final` also refuses to build while `SUBMISSION` in `facts.ts` lacks the demo
URL, repo, video or team, or `GEMINI_ACCESS_LABEL` still names OpenRouter; without `--final` those
are listed as open items in the check note and on the console. The close slide prints each link only
once it is set.
- Numbers (owner, 2026-09-28): one sample run's totals (its cost, time, lines, "N of M" counts, cost
  a minute) and the evaluation's small counts stay off the slides and the notes; a single run reads
  as a benchmark it is not. Numbers that are part of an example stay (the seven seconds and the
  lines in them, the newspaper line's room and voice). The check fails on "Sample:" and "API
  calls/cost/fees" on a slide face.

- Look: direction A "Screening room" (dark room, film stills, one accent). Amber only marks Scene's
  words; a rejection is an ink strike plus an x mark and a label, never a second hue. Compositions
  vary with the content: full-bleed still (cover), film strip (hook), timelines, flow and architecture
  diagrams, a title-card band with the review chain, still plus bar chart, four product crops with rings,
  tables, a log-scale price chart.
- Text budget: judges skim. A slide is a sentence headline (at most 14 words), one exhibit and at
  most 35 words of `.body` prose. `slide({ kind })` sets the cap on all visible text but the page
  number: "prose" 75 words, "exhibit" (table, chart, diagram) 100, "notes" none. Sizes are
  `TYPE_PX` in `theme.ts`: headline 72, body 30, labels 26 (the floor, grey text included), film
  credits, endnote markers and the notes pages 20.
- Wording: the story is automatic first. One press of Generate runs every step; the optional edit is
  told once, on the product slide. The check fails on defensive negatives anywhere ("no one
  edited", "with no one", "no edits", "without an editor", "unattended") and on audit jargon on a
  slide face (run ids, snake_case rule ids, "KMCC", page or § citations, "inferred", multipliers
  such as 1.04×, "Sample:", API costs). The check note lists the slide faces that mention
  editing (listed, not failed).
- Sources are endnotes: `notesFor("Short name")` gives a slide a `note(html)` function that prints a
  small linked superscript and files the text under the slide being built; `slides/16-notes.ts`
  prints every note at 20 px, grouped by slide position, split into pages by each note's estimated
  height (`LATIN_EM` 0.48, calibrated on 2026-09-23 against the rendered notes; `PAGE_FILL` 0.92); a
  group that runs over repeats its heading on the next page. Notes carry outside sources only
  (rulings, prices, population, guideline, competitors); run ids, sample figures and how the deck's
  build checked a claim stay in this file and in the build's guards. Film credits stay on every
  slide with a frame.
- Data: `data/*.ts` parse the run records (script.json, events.jsonl, ledger.jsonl) with zod, throw
  on a missing file or field, and cross-check against each run's own summary and events.
  `data/runs.ts` holds the shared helpers and reads the one pin in `runtime/showcase.json`; the app,
  the film (`scripts/demo/config.ts` `SAMPLE_RUN`) and the deck all show that run.
  `data/sample.ts` is the automatic sample (…350b05): the clip (speech counted once where the
  re-listen overlaps the first pass), the seven seconds, the line the final check sent back and Scene
  rewrote from its fix (L5) and the final check's list (3 moments, 2 during dialogue). It refuses a
  run with a parent, an edit, a line written by a person, or an added line.
  `data/analysis.ts` is the earlier run of the clip whose hearing and watching the sample reused
  (…837b9f; speech, scene and gaps checked field for field) and its re-listen report; the
  listens-twice slide checks that its second listen is that run's. `data/live-check.ts` is the 22 Sep
  live-service check around one line edit of an earlier track; the film reads the service URL from
  it. Re-pinning the
  sample changes the deck and the film on the next build, or stops the build where a guard no longer
  holds.
- Second recognizer: `data/recognizers.ts` reads faster-whisper on the whole clip and on short slices
  recognized on their own (`runtime/deck/evidence/slice-asr.json`, written by
  `uv run --with faster-whisper==1.2.1 python scripts/deck/probe/slice_asr.py`, free and local; the
  JSON carries the clip's SHA-256, checked). It gives the launch call's true timing, checks the
  re-listen test fixture still reproduces it, and fails the build if any finished line overlaps speech
  either recognizer hears, or if the seven seconds, recognized alone, hold a word. It is the build's
  check, not Scene's: no slide names it (the listens-twice slide draws the call's band from it
  unlabelled; Scene itself uses Chirp 3, twice). Launch call before
  and after: the evaluation's default run (d88b71, 22 Sep) had a silence over the call and a line at
  4.50 s spoken over it; in the sample the re-listen heard the call (3.71–6.47 s) and closed that
  2.38 s silence, so no line lies there. Runs are compared by time spans, never by gap ids.
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
- Reviewer example: the sample's Line 5 (47.2 s, `line` in `data/sample.ts`). It passed its review
  and was voiced (2.32 s); the final check sent it back for viewer or camera framing (뜬다), and Scene
  rewrote it as the check suggested, reading the on-screen title (전체 기억 재생., 1.74 s in
  2.63 s). The still is "playback" at 48.5 s, on the shot whose on-screen text reads MEMORY
  PLAYBACK - GLOBAL (`stills.ts` checks the shot and that the frame lies inside Line 5). The slide
  ends on the rewrite that passed.
- Fit-loop facts are read from the pipeline, not typed: `data/city.ts` reads `MAX_SPEAKING_RATE`,
  `MAX_SHORTEN_ROUNDS`, `RATE_HEADROOM` and the speed-up rule from `src/lib/pipeline/fit-voice.ts`, and recovers the unstored
  1.0x take of a sped-up version from its rate (the newspaper's shortened line: 3.52–3.55 s at 1.0x,
  3.91 s at 1.04x). The measured slide shows the estimate, the first voice and the closest shortened
  take.
- Stills come from the Blender 1080p master, fetched once into `runtime/deck/cache/` and checked by
  SHA-256. Before cutting, `film.ts` proves the repo clips' offsets against the master
  (clip.mp4 = film 0–65 s, eval-tos-city.mp4 = film 65–110 s); a mismatch stops the build.
- Product screenshots are taken with `--screens` from a running Scene (`SCENE_APP_URL`, default
  the local dev server): `screens.ts` opens the pinned run (`/p/<project>?run=<pin>`, English) at
  device scale 2 in a 1440x900 window and saves four crops shown 1:1 on the product slide: the
  player's switches (Eyes closed), the timeline from the switches' left edge to 65 s, Line 5's panel
  (heading, words, verdict chip), and last the Generate button: back on the run panel with Brief
  density chosen (the clip has no Brief track), where it reads "Generate", not "Generate again"; the
  capture stops if it reads anything else. Only buttons that send nothing are clicked.
  `workspace.json` keeps the crop sizes, the ring boxes and the run id; the slide refuses a capture
  of another run. Requests that could start a paid run or edit are aborted. Stills and `--screens`
  outside `npm run deck` need `FFMPEG_PATH` (from `.env.local`, which the build loads itself).
- Fonts are static cuts (Newsreader 72pt, IBM Plex Mono vendored in `fonts/` with their OFL texts;
  Pretendard static woff2 from `node_modules/pretendard`), so the PDF embeds CID TrueType, not Type 3.

Not in scope: the demo video (`scripts/demo/`), deployment, and the story's wording decisions
(the story spine lives with the deck owner).

## Checks the build runs (it fails instead of writing a doubtful deck)

Fonts actually painted (CDP `getPlatformFontsForNode`: headlines Newsreader, Korean Pretendard,
timecodes Plex Mono); text at least 26 px, grey text included (credits, note markers and the notes
pages 20 px); contrast at least 4.5:1 on its backdrop; no text within 24 px of a slide edge unless it
sits on film; no clipped, cut-off or overlapping text; the notes columns do not spill; all visible
text per slide within its budget, headline at most 14 words, prose at most 35; the wording rules
above; no reference to another slide by number; every marker has its note and every note a marker;
zero remote requests; `pdffonts` shows no Type 3 and every face embedded; `pdftotext -raw` returns
every `[lang=ko]` text on the deck (compared without whitespace).

## Debug log

- [2026-09-28] The owner found the numbers cheap: they came from one sample run ("Sample: 7 lines in
  8 min 6 s for $0.32", "1 of 8 dropped", "7 of 7 fit", "$0.33 a minute" on the competitors' price
  axis), and some exhibits read oddly once on the page. Taken off the faces: every sample total and
  count, the TV subsidy cut (a TV fund on a film deck), the KOFIC bars ("Korean films mostly get a
  description file already" argued against the market), the "Another recognizer" lane and "2.08 s
  early" (the build's check, read as a feature; the headline is now "The first listen mistimed the
  launch call"), "a second recognizer confirms it", "Recorded service check", "each paid step runs
  once", the close's recorded demonstration date and font note, the comparison legend's "checked in
  its code" and "model-written". Added: "Only lines that pass go on to the voice" and the other loop
  outcomes as mechanism; "Others fit the voice or check by hand. Scene does both, automatically.";
  Asia-Pacific's share of the world's blind people on the business face; `SUBMISSION.demoUrl`. Notes
  went from 48 over 4 pages to 16 on one page (outside sources only). The first rebuild split the
  notes 15 + 1: the height estimate ran about 88 px over one page though the rendered right column
  had about 250 px free; trimming three notes' own asides fitted one page, `LATIN_EM` and `PAGE_FILL`
  are unchanged. `data/loops.ts` and `data/evaluation.ts` were deleted (nothing reads them now), and
  the exports `cost`, `dropped`, `finalFix`, `sevenHeard`, `nearestSpeech` went with their slides;
  every guard on a claim still made stays. Before: `runtime/deck/backups/20260928-before-cut/`.

- [2026-09-26] Kept the Screening room design and added fitted offline presentation controls.
  The cover now leads with the fit-between-dialogue benefit; optional editing is explained only
  on the product slide. The close shows the recorded demonstration date instead of labelling the
  recorded service URL as live. The service diagram says "Recorded service check" and the audience
  validation slide says "test" rather than "prove". Prior final artifacts were copied to
  `runtime/deck/backups/20260926-152452-before-polish/` before rebuilding.

- [2026-09-23] Deck moved from `DECK_TRACK` (an edit chain whose lines an editor finished) to the
  automatic sample; `data/showcase.ts`, `data/demo.ts`, `scripts/demo/sample.ts` and the honesty
  slide (`09-honest.ts`) removed, the deck re-ordered to 14 slides. Measured: speech sum 31.08 s vs
  union 30.83 s (the re-listen overlaps the first pass by 0.25 s); `opening.speechTotal` is now the
  union. `spectrogram.ts` was the last importer of `data/demo` (typecheck error until switched).
- [2026-09-23] The owner found the deck's text unfriendly. The floors went from 22/24/18 px to
  26/26/20, the budgets from 90/120 words to 75/100 and prose from 40 to 35; the wording check was
  added. Before the rewrite, every content slide but one failed the 26 px floor and 9 of 12 capped
  slides were over the new budgets (all fixed). The optional edit was told four times (cover,
  product headline and prose, comparison cell); it is now told once, in the product slide's prose.

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
- [2026-09-23] Verification round 2. The product slide put "One press runs every step" over a button
  that read "Generate again": screens.ts matched /^Generate/ on the pinned run's page, where a track
  exists. The capture now takes the button last on the Brief density and checks its label (tested
  against the dev server: "Generate", 358x56 CSS px, so the headline column narrowed to 1000 px).
  Wording fixed from the judge's list: gap lengths carry "s"; "either recognizer" before recognizers
  were introduced; the final-check label claimed "missed moments get lines where there is room" and
  the comparison headline "fixes what fails, by itself" (the sample rewrote 1 line, added none and
  still lists 3 moments; the credit at 2.0 s had room); "all in" beside a cost that leaves out
  servers and storage; "shortened twice" over one charted shortening; dates as lane labels on the
  listens-twice slide (now in its notes); the reviewer slide's closing footer (now the rewrite's
  note). The requested business text took that slide to 107 words; the Asia-Pacific share moved from
  its face to its note (96). The exhibit cap stays 100.

- [2026-09-23] Polish round after the re-verify (all P2). Unsourced: the business slide's "Foreign
  films have no public programme" (no note carried it; the releases note itself prices a foreign
  barrier-free film), now "A public program covers Korean films" with a note on KOFIC's program.
  Misread: the constraint slide's "two speech recognizers checked every line" sounded like a product
  feature (Scene uses one recognizer, twice; the deck's build runs the second); the comparison
  legend's "No = checked in their open-source code" also covered Scene's own No. The comparison slide
  is at 99 of 100 words, so the legend names Microsoft instead of adding "a competitor's".

## Status

Last built 2026-09-28 with `npm run deck` (no `--screens`): 15 pages (14 slides, 1 notes page, 16
endnotes), 0 check problems, the Korean PDF text check passed, visible words 31–90 per slide (all
within their caps). `pdftotext` of the PDF holds no sample figure, run id or revision; the only
dollar figures are the competitors' prices and the price axis. The product crops are the earlier
`--screens` capture of run 350b05 (unchanged). Presenter checked with Playwright over a local
server: Home/End reach pages 1 and 15, a source marker opens its note on the notes page, Escape
returns to the slide (`.playwright-mcp/2026-09-28_1440_deck-cut/`). 5 submission items open (see
`runtime/deck/gapline-deck_check.md`): the development Gemini label, demo URL, repo URL, video URL and
team. The service was taken down on 23 Sep; set `SUBMISSION.demoUrl` after the redeploy. The 1080p
master stays in `runtime/deck/cache/` (584 MB) for `--stills`; delete it when the stills are final.
Tests: `tests/deck-data.test.ts` (needs the gitignored `runtime/`).
