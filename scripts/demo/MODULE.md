# scripts/demo — the submission film

## Direction

Product name: Gapline (renamed from Gapline on 2026-09-28; entries before that date use the old name).
The demo's film-scene type is still `Scene` in code; it names a scene of the film, not the product.

Builds the 3-to-4-minute English submission film (the mandatory submission rules, 2026-09-29) and a Korean review copy (same picture, Korean
captions) into `runtime/demo-v3/<lang>/`: `gapline-demo-<lang>.mp4`, `_check.md`, `_contact.jpg` and
`.srt`. There is no presenter voice (the owner found the synthetic narration worse than none,
2026-09-23): captions tell the story and the only sound is the film's own. The story follows the deck
(`scripts/deck`, direction "Screening room"): hook with eyes closed, the same seconds with Gapline, why
now, the constraint, the product in the app (upload, and one press of Generate running every step;
the saved automatic run replayed; a line the final check sent back and Gapline rewrote from the
check's fix; the measured fit and playback; the optional edit, offered once), the checks
(the deck's performance report: a line dropped because its real voice ran long, and a launch call
the first listen missed), Google Cloud (with how it ships: Cloud Build, Artifact Registry, Secret
Manager), the comparison with other tools (the deck's benchmarking table), who would pay and what
we test next, close. Since 2026-09-29 the story follows the submission deck in the Hack2skill
template (`scripts/pitch`); the pages keep the film's own dark look. There is no evidence scene: one sample run's totals (lines, minutes, API fees) and the
evaluation's small counts read as a benchmark they are not (owner, 2026-09-28).

- The app scenes show the one automatic run `runtime/showcase.json` pins for the app, the film and
  the deck (`SAMPLE_RUN` in `config.ts`, read through `scripts/deck/data/runs.ts`). `facts.ts` reads
  the sample from `scripts/deck/data/sample.ts` and the outside facts from `scripts/deck/facts.ts`;
  it checks that the film's line is the one the final check sent back.
  Nothing on screen or in a caption is typed by hand. "One press" is a product claim: the sample was
  started from the command line through the same path as Generate. The Gemini access wording is
  `GEMINI_ACCESS_LABEL` (src/lib/models.ts).
- Timing (`timing.ts`): each caption (up to two lines) stays up 0.5 s plus its characters at 17 per
  second in English and 10 in Korean (below the Netflix timed-text maxima of 20 and 12, since the
  picture changes underneath), never under 1.8 s; 0.2 s before a scene's first caption, 0.1 s
  between sentences, 0.4 s around film sound. Scenes are as long as their captions, pauses and film
  sound; the recorder and the pages key their moves to caption sentence starts.
- Picture and band (`config.ts`): the picture area is 1920×880, the caption band 880–1080 (200 px,
  solid dark, no box).
- Captions (`ass.ts`): Pretendard SemiBold 50 px (cap height about 28 px). Each line is its own
  event, 60 px apart; the last line sits on the 5% title-safe line (y 1026, descenders 56 px above
  the frame's foot, measured), and a one-line caption takes the lower line. They fade in and out. A
  sentence becomes one two-line caption when a break fits both lines (42 characters English, 26
  Korean), else several; breaks keep names, counted numbers and Korean bound words together, never
  end a line on an article or preposition, and prefer a clause end or a conjunction at the start of
  the second line. `groups` on a caption sets them by hand where a list defeats the rules. The
  reveal has no captions of its own: `segments.ts` sets its label, Gapline's amber lines (with the
  English translation in the English film) and the film's dialogue (with a Korean line under it in
  the Korean film) inside the band.
- Language: every word on screen follows the film's language, except product names (Cloud Run,
  Gemini, Speech-to-Text, Chirp 3, Text-to-Speech, Cloud Storage), the URL, the film credit and the
  film's own dialogue. Pages get `PageTiming.lang`; the app is recorded in the film's language (the
  `scene_lang` cookie, buttons and stage names from the app's own dictionary); the labels the film
  draws over the app are in `labels.ts`.
- Motion scenes are HTML pages in the deck's theme, drawn on 1920×880, rendered frame by frame in
  headless Chrome and piped into FFmpeg (`motion.ts`, `pages/`). The cloud scene (`pages/cloud.ts`)
  is drawn in hairlines: the Cloud Run outline, one line lighting the run's stages in order (Hear,
  Watch, Write, Review, Voice, Check, Fix, Mix) with the model each calls, the loops that send a line
  back, then Cloud Storage and the live progress stream; arrowheads ride the drawn end of each line,
  and the page stays fixed while it is read. All explanation pages use fixed text and image scales;
  timed reveals, measured bars and diagram drawing provide the meaningful changes.
- App scenes are recorded at device scale 2 (2880×1320 frames, 1440×660 CSS viewport, the picture
  area's aspect). The recorder logs element boxes, camera shots and overlays in film time
  (`recorder-kit.ts`); `camera.ts` turns them into eased scale+crop filters; overlays (spotlight,
  service chips, labels) are ASS drawings, because this FFmpeg has no drawtext. Every box is read
  after the page settles, and each spotlight is read again as it lights up: below 90% overlap the
  recording fails. The replay's stage list is read again as its stages run: if it has moved under
  its chips, the recording fails.
- Waits (upload preparation, the saved run's replay) are squeezed, and every squeezed stretch carries
  a label with its real length. `clock.pace()` lands each stage of the replay on the sentence that
  names it (a stretch is slowed at most 5×). The upload's shortened stretch ends when the upload is
  answered; the page change, the new workspace's first paint and the switch to Korean narration (a
  new workspace opens in the page's language) all fall inside it. Replay is pressed before its scene
  starts, and the scene starts on the first screencast frame stamped after that (`frameAfter` in
  `record.ts`), so it opens on the reset stage list with the app's speed badge out of shot. Before
  that, the page is scrolled up by the few pixels that put the sticky inspector at its place, so the
  timeline growing during the replay moves nothing in it; the page goes back down once the replay
  is done.
- Camera (`camera.ts`, `beats.ts`): every app scene uses fixed framing and clean cuts. All decorative
  drift and animated zoom/pan are removed centrally by `cameraForBeat`, including from cached
  recordings, and new recordings write cuts only. The opening shot is effective from frame zero
  when its recorded timestamp falls in the first frame, avoiding a brief wide-shot flash. Both the
  picture and overlays use these same keys; a cut inside a lit overlay's span fails the build.
  Close-ups retain their target and timing and are placed so that no line of text
  is cut at any edge of the picture, the column beside the element included
  (`frameAround` in `recorder-kit.ts`: moved up or down, or up to 15% more page; failing that, only
  the element's own column is kept whole at top and foot). The upload section is framed for the page
  before and after the card's status line pushes the next section down. The edit scene opens on the
  whole workspace and types in a close-up of the line's box: a close-up of the whole editor is as
  tall as the player's caption strip and controls beside it, and cuts their labels. The recording's
  CSS (`recorder-kit.ts`) hides the model's scene memo (`.scene-evidence`) and turns off scroll
  anchoring, which had jumped the page 645 px at the end of the replay. The reveal's amber lines
  appear at each line's voice onset (`onset` in `scripts/deck/data/sample.ts`: the first 10 ms
  window within 30 dB of the file's peak).
- Result playback: the scene starts on a freshly loaded run page. `segments.playbackExcerpt()` is
  the one source of the excerpt's start, trim and length for both the sound (`mix.ts`) and the
  picture: `playbackOverlay()` lays `described.mp4` over the player's measured video box (rounded
  corners, last frame held), so a stall in the page cannot freeze the film. The sound starts at
  `LISTEN.from` (a second before the line, or 0.15 s after the previous line's voice if that is
  later: 46.59 s for Line 5), while the picture starts where the
  page's "Play from here" does; the line's tag comes up with its voice. The scene ends at the
  later of its plan and the excerpt's end plus 0.3 s. One shared gain brings all the film excerpts
  together to -16 LUFS.
- Sync is measured, not assumed (`check.ts`): each excerpt is found in the finished film's sound by
  cross-correlation (10 ms loudness envelopes within ±3 s of its place, then sample by sample), and
  video frames are counted. More than 40 ms off, a match below 0.5, or a sound track more than one
  frame shorter than the picture fails the check note and makes `npm run demo` exit 1.
- Nothing paid is started: Generate is only hovered, the edit is typed but never submitted, and
  requests that could start a paid run or edit are aborted (the recording fails if one was
  attempted).
- The hook's picture is cut from Blender's 1080p master (`master.ts`, same checksum as the deck),
  checked frame by frame against the repo clip; only the 10 MB cut is kept.

## Production

```sh
npm run demo -- en record   # from the local production server (below)
npm run demo -- en build    # about 4 minutes
```

Both steps are free. The app scenes are recorded from a production build of this repo on
127.0.0.1:21961 (`LOCAL_URL`), reading the `runtime/` data through a folder of links that leaves out
`budget/`. With the day's live allowance spent, the workspace shows a notice in the upload card,
under Generate and above the stage list. The recording never spends, so the server it records from
gets no `budget/`:

```sh
REC_DATA=<any folder outside runtime/>
mkdir -p "$REC_DATA"
for e in runtime/*; do [ "${e##*/}" = budget ] || ln -sfn "$PWD/$e" "$REC_DATA/"; done
NEXT_DIST_DIR=.next-verify npm run build
cp -r .next-verify/static .next-verify/standalone/.next-verify/static
cp -r public .next-verify/standalone/public
cd .next-verify/standalone && DATA_DIR="$REC_DATA" PORT=21961 HOSTNAME=127.0.0.1 \
  FFMPEG_PATH=<the FFMPEG_PATH of .env.local> node server.js
```

Before it records, `record.ts` asks the server's `/api/live-status` and stops when a run could not
start there (the notice would be in the picture). Repeat both steps for `ko`. The record step must
follow any caption change, because each app scene is timed by its captions.

The check note fails (unchecked box) on: length outside 180–240 s, a film excerpt heard more than
40 ms from its place or a sound track shorter than the picture (the build then exits 1), loudness
more than 1.5 LU from -16 LUFS, a frozen stretch over 4 s in the picture area, a caption faster
than the reading pace or shorter than 1.8 s, a line over the caption limit, more than 6 s with
neither a caption nor film sound, a recording made where `/api/live-status` said no run could start
(kept as `liveAllowance` in `source.json`), and the development Gemini label (`GEMINI_ACCESS_LABEL` naming
OpenRouter) on the cloud page. It never ticks the human watch-through.

## Debug log

- [2026-09-29] The owner asked for a longer film that follows the new template deck. Three motion
  pages were added from the deck's checked data (`pages/checks.ts`, `compare.ts`, `next.ts`) and a
  release row on the cloud page; no app scene or its captions changed, so the 2026-09-28
  recordings were reused. Planned EN 210.5 s, KO 208.9 s (160.0 s before). The length rule is now
  180–240 s (`MIN_SECONDS`, `MAX_SECONDS`), from the pasted rules' "3 to 4 minute" video. Before:
  `runtime/demo-v3/backups/20260929-before-lengthen/`.

- [2026-09-28] The film follows the English sample (`SAMPLE_LANGUAGE`, …221ceb) and the new name.
  The upload scene now presses the sample's narration language; the review scene's captions name the
  reviewer and say the draft named a city not yet on screen (guarded on the quote); the edit scene
  types "pink" before "brain." in the second line of the seven seconds. The English film prints no
  gloss under English lines; the Korean copy puts our Korean under them (`lineGloss`, `KO_LINES` in
  `labels.ts`) and keeps its overlays Korean ("단어 하나 추가"). The listen stops 0.2 s before the
  next line (L3 at 19.0 s, same shot); 0.45 s was the Korean line's cut. The constraint page no
  longer prints the sample's "6 lines, 17.0 s of voice" or the lines lane's voice total. First English
  record stopped in the replay: the line picker's top sat at 642 of the 660 CSS px frame (measured;
  the English timeline has one narration row, 188 px against the Korean run's 210). The replay's page
  now stops that much higher when the picker would be cut, with the picker just out of the picture.

- [2026-09-28] The evidence scene is gone (owner: one sample's "7 lines, 8 min 6 s, $0.32" and the
  evaluation's "18 of 20 lines" read cheap). The storyboard runs cloud straight into close;
  `pages/proof.ts` became `pages/close.ts`, and `film.loops`, `film.analysis`, `film.finalFix` and the
  sample's cost and line count left `facts.ts`. The replay tag "Saved run: 8 min 6 s of processing,
  sped up" stays: it discloses the time-lapse, not a benchmark. Rebuilt from the existing recordings
  (no app scene changed): EN 157.4 s (166.8 before), KO 156.5 s (167.3 planned before). Both check
  notes keep the longest frozen stretch they had before this change (EN 6.0 s at 85.5 s, KO 5.5 s),
  from the still framing of 2026-09-27; KO lost the 4.5 s stretch the evidence page held. Before:
  `runtime/demo-v3/backups/20260928-before-cut/`.

- [2026-09-26] The first fix only held the replay still and missed the same jitter on the review
  panel near 1:50 (EN drift 109.61–112.02 s; KO 108.72–111.20 s). All five app beats now discard
  decorative drift and use fixed close-ups with instantaneous editorial cuts. This covers all
  eight cached drift shots per language and every animated camera transition, while keeping the
  existing recording, scene lengths, caption timing and audio. A regression covers every beat.

- [2026-09-26] The replay's 4% push-in over 11–14 seconds made small text and service chips
  visibly jitter as FFmpeg rounded the scale and crop to pixels. Removed that drift while keeping
  the move to the finished timeline. Both the picture and overlay use the same camera policy,
  including when rebuilding the existing recordings; no new model run is needed.

- [2026-09-23] CDP screencast frames were 1440×720 in v2 whatever deviceScaleFactor was set; Chrome's
  `--force-device-scale-factor=2` gives 2880×1440 (the recorder checks the first frame's size).
- [2026-09-23] Google Cloud auth for TTS needed an interactive `gcloud auth login`; the drafts were
  built with `--estimate` (no presenter audio) and $0 spent.
- [2026-09-23] freezedetect (n=0.001) counts a slowly growing line or a ticking counter as frozen;
  motion pages reveal something at least every few seconds so no stretch passes 4 s.
- [2026-09-23] facts.ts required the deck's pinned track to be the film's result run; pinning the
  later removal of a line over dialogue (a child of that result) broke it. The guard now requires the
  result run to be in the pinned track's history and to hold the same Line 5 and seven-second lines.
- [2026-09-23] Chirp 3 HD Aoede (en) speaks short sentences fast: at the lowest presenter rate (0.85)
  ten English sentences still measure 152–203 words/min on trimmed audio, while the whole script is
  141 words/min (125 with the pauses). Korean stays under 135. Left for the owner to judge by ear.
- [2026-09-23] A watch-through QA (6 agents; findings with evidence kept outside the repo) confirmed 25
  problems in the first voiced films. Root causes worth keeping:
  - voice.ts wrote the rate-1.0 attempt and the slower retry to the same file, and cached by rate, so
    a re-run re-requested every slowed sentence and could leave a slow entry pointing at fast audio.
    Now files carry their rate and kept sentences are reused whatever their rate.
  - Chirp 3 HD returned "Now, with Scene." cut off mid-word (last 20 ms at -26 dBFS, a click in the
    mix). The edge guard re-requests such files; the fades stop any click.
  - The result playback's sound was laid from the video's 'playing' event, about 0.1–0.2 s before its
    first frame reached the screen. It is now laid from requestVideoFrameCallback frames; about 0.06 s
    of lead remains (screen recording delay, not corrected).
  - The saved trace spends half its time in Review, so one linear squeeze put Review under "writes".
    The replay now times one silent replay in the page first and presses so that Review starts with
    the sentence that names it.
  - freezedetect compares against the frame where a still stretch began, so change accumulates:
    small dots and a slowly drawn line add almost nothing, a large text block counts. The stakes page
    reveals the ruling's date and text at two points of its long sentence; the constraint page pushes
    in on the shortest silence while it is named.
- [2026-09-23] A second QA round found three more: the re-voiced "Supreme Court" sentence came back
  with 0.2 s of full-scale noise before the words (1,168 samples at 0.99 or more, silent edges, so the
  edge guard passed it); the landing hero's video stayed black for a whole take after the page
  reload; and picking Line 5 flashed the player black while it left its poster. Files with more than
  1 ms at full scale are now requested again, and the upload and review scenes seek their video and
  wait for the frame before recording. Caption groups can be set per sentence (`captions` on say())
  where a list defeats the break rules.
- [2026-09-23] Films without a presenter: captions timed at the old speaking rate ran 225 s. Merging
  sentences, a reading pace of 17 (English) and 10 (Korean) characters a second and shorter holds
  brought the plan to 169.5 s (English) and 162.7 s (Korean). Without the presenter the film sound
  was measured at -17.6 LUFS (gain set from the described reveal alone); the gain is now set from all
  excerpts together. The replay's close-up on the stage list stood still for 4.8 s: the camera now
  moves to the timeline for the last sentence, and the words held on the dark page drift slowly.
- [2026-09-23] The sample changed from the edited track to an automatic run made with the final
  check's fix stage (20260923t065852164-ko-standard-350b05). A first run of that day
  (…064439178…) was not used: it still audited the track a second time, which listed its own fix as
  failing again, so the screen contradicted "fixed by itself". The sample reused that run's hearing
  and watching (same clip; speech, scene and gaps equal field for field); wherever the film prints
  the sample's 8 min 6 s and $0.32 it says so (+$0.04, 25 s). `scripts/demo/sample.ts` moved to
  `scripts/deck/data/sample.ts`; the dialogue total is now the union of both listens (30.83 s, was
  a sum of 31.08 s that counted 0.25 s twice).
- [2026-09-23] Sound 2.70 s early. Symptom: the owner reported the sound out of sync.
  Measured on the finished files by cross-correlation: every excerpt heard 2.695 s early in both
  films (EN sound 168.000 s against 170.700 s of picture). Cause: `adelay` pads each excerpt with
  silence up to its start, but on a file input cut by `atrim` that silence carries no timestamps
  (FFmpeg 7.0.2) and `amix` dropped it, so the track started at the first excerpt. Fix:
  `aresample=async=1:first_pts=0` after `amix` (the only change to the filter graph). Re-mixed on the
  same inputs: every excerpt +5.0 ms, sound 170.709 s against 170.700 s (KO 163.883 / 163.867 s). The
  check now measures this and fails the build.
- [2026-09-23] Result playback froze for 2.02 s at media 48.125 s in 3 of 3 takes when the result
  scene reused the page after the replay and review scenes. Not the network (40–59 s buffered before
  Play, no waiting event) and not the screencast or the cursor script alone (A/B probes, no gap over
  0.22 s). With the result scene on a freshly loaded page: 0 of 3 froze (largest gap 0.15–0.27 s).
  Root cause still unconfirmed. The film is now laid over the player from the source file (94 of 94
  frames matched during the listen, the frame shown a median 19.7 ms behind the sound), so a stall
  would only lag the page's strip and clock under the player; the recorder warns when it sees one.
- [2026-09-23] tsx wraps named functions in `__name()`, which does not exist in the page: a named
  function sent into `page.evaluate` failed (the video box probe). Code sent into the page uses no
  named inner functions (the deck adds a `window.__name` shim instead).
- [2026-09-23] Captions were 41 px Medium in a 120 px band; the owner found the film's text
  unfriendly. The band grew to 200 px (`CONTENT_HEIGHT` 960 → 880; recording viewport 1440×720 →
  1440×660 to keep the picture's aspect), and captions are 50 px SemiBold, one event per line at a
  60 px pitch (56 px above the foot, measured). The rewritten captions planned EN at 183.3 s; shorter
  gaps and four shortened English captions brought it to 172.1 s (KO 168.6 s).
- [2026-09-23] The 19:43 (EN) and 19:50 (KO) recordings were made with `budget/` in `DATA_DIR`:
  five demo reservations of that day had used up the live allowance, so the spent-allowance notice
  ("Today's live allowance is used up … renews in 13 hours") showed in the upload card, under the
  spotlit Generate button while the caption said one press does the rest, and above the stage list
  (found on extracted frames by the verification panel). The Production note said the films had
  been recorded without `budget/`; nothing checked it. `record.ts` now asks `/api/live-status`
  before recording and stops when `canStart` is false.
- [2026-09-23] The same round's framing fixes, measured on dry runs against the dev server (GET
  only, nothing recorded into `demo-v3`): the English replay's 5.2 s still stretch is gone (the drift
  over the stage list; longest still stretch now 2.43 s EN and 2.17 s KO, in review), and every app
  scene ran within 0.01 s of its plan. One dry run crashed on a screencast frame acknowledged after
  the screencast stopped; `record.ts` now ignores frames that arrive after the stop.
- [2026-09-23] The re-verification of the 13:03Z/13:10Z films found polish items only. Root causes,
  measured on the recordings and on dry runs against the dev server:
  - The replay opened on the finished run for 6 frames (EN 79.47–79.63 s). The recording's frame
    stamped 7 ms before the replay's setup returned (two animation frames after the reset list was
    committed) still showed the finished run; the next, stamped 63 ms after, showed the reset list,
    and the first replay stretch is slowed about 3×. The scene now starts on the first frame stamped
    after its setup (`fromNextFrame`, `frameAfter`).
  - Chips and spotlight half a row off from Write's end (KO 83.5–91 s, EN too): the inspector is
    `position: sticky` (16 px) but the shortened page's grid foot held it at 0; when the first lines
    made the timeline 22 px taller, the whole inspector dropped 16 CSS px into place (logged in the
    page each animation frame, 1.37 s into the replay, in both languages). The replay's setup now
    scrolls the page up by that much first, and scrolls it back once the replay is done.
  - The upload shot cut the next section's heading at its foot (EN 72.1–74.2 s): the card's status
    line ("Converting and measuring…") appears after the shot was framed and pushes the page under
    it down 33 px. The shot is now framed once the status is up, against both layouts. Under the
    dry run's request interception the card never reaches its "preparing" status (the upload body is
    not reported sent before the answer); the harness reports it sent in the page.
  - Close-ups cut the player's labels at their left edge ("ption on", "ith a mechanical eye"): the
    framing only kept the element's own column whole, and drifts against the page's right edge swept
    their left edge into the neighbouring column. The framing now checks the sides against every
    line in the picture's rows, and a drift may push in about an edge or corner. The edit scene's
    two tall shots had no clean view within 15% (the strip and control labels fill x 98–626 CSS in
    their rows): it now opens wide and types in a close-up of the line's box.
  - The result scene pushed from zoom 1 to 2 in 0.83 s: its first shot was cut short by the meter's.
    It is now one 1.2 s push to the meter.
  - The edit's note above its button was found as the one `p.label` without `.mono`; the app's
    start range became a plain `p.label` this round ("Can start: 56.22–60.63 s"), and the note is
    now found by the app's own hint text.

## Status

2026-09-29: rebuilt at 3:30 from the 2026-09-28 recordings: EN 210.5 s, KO 208.9 s, published
as release v0.2.0-preview (`gapline-demo-en.mp4`, `gapline-demo-ko.mp4`). Sync, loudness, caption
and length boxes pass; the still-picture box stays open only for the app scenes it flagged before
(EN replay 6.2 s; KO replay 5.1 s, dark 4.6 s, review 4.5 s). The owner replaced the Google Drive
copy at the same link on 29 September. Its anonymous download is 210.53 s, 29,086,321 bytes, and
matches the local English MP4 by SHA-256 (`02dd46b1875e0773727c0a1ad5129bcf6b04042ad3152747e172d37390e52b38`).

2026-09-28: rebuilt without the evidence scene (debug log): EN 157.4 s, KO 156.5 s; every check box
as before (frozen stretch and the development Gemini label open, the watch-through not yet done).
The upload scene shows the app's landing, which still carries its "−54%" TV-subsidy figure
(`src/`, not this module); the deck dropped that figure.

2026-09-23: the films in `runtime/demo-v3/` were recorded at 13:03Z (EN) and 13:10Z (KO) and built
right after: EN 165.3 s, KO 166.1 s, as planned. Their check notes read every film excerpt +5 ms
from its place (dark, reveal and result, match at least 0.989), the sound as long as the picture,
the longest still stretch 2.8 s (EN) and 2.9 s (KO) against 4 s, loudness -16.4 LUFS, and
`/api/live-status` canStart true when recorded, so no spent-allowance notice is in the picture.
The re-verification round (1 fps and 5 fps frame reads, its own cross-correlation) found no P0 or
P1 left, only polish.

This round's polish is in the scripts, not yet in the films: the replay's first frame and the
inspector lift, the upload framing, the result push, the edit's framing and resting cursor, the edge
and drift rules (debug log); captions (a separate Gemini review; the finished tracks; the Korean
review and evidence sentences); the evidence page's figures, all in within 1.2 s of their caption,
with a slow push-in; the cloud page's Korean wording; the constraint page's tag "6.7 s / of 7.2 s
usable" ("7.2초 중 해설 가능"). Both films must be recorded and built again (`npm run demo -- en
all`, then `ko`) from a `DATA_DIR` without `budget/`; `planScene` now plans EN 166.8 s and KO
167.3 s (frame-rounded; 165.3 and 166.1 before). Dry runs of every app scene against the dev
server (GET only, live status answered canStart true in the browser, the upload answered there
after 5.6 s), both languages, rendered through `segments.ts`: every scene within 0.01 s of its
plan, every spotlight on 100% of its element, no line of text cut at any shot's or drift's end,
the replay's first frames all on the reset list, the chips on their rows before and after Write
ends, the timeline whole at the replay's end, the result push 1.2 s, the edit's cursor resting past
the button. The changed pages were rendered with their captions (constraint, cloud, evidence in
both languages; the evidence page's longest still stretch is 1.6 s). Each record step leaves a
private `u-*` upload project in `runtime/projects/`.
Open: the development Gemini label (until the switch to Google AI Studio), the human watch-through,
and the Cloud Run URL on the close page, which answers again only after a redeploy under the same
service name. Tests: `tests/demo-captions.test.ts` (caption breaks, geometry, reading pace, wording,
Korean pages) and `tests/demo-sync.test.ts` (excerpt location, mix graph, pacing, spotlights,
overlay geometry, Korean labels); both need the gitignored `runtime/`.
