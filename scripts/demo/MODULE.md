# scripts/demo — the submission film

## Direction

Builds the under-3-minute English submission film and a Korean review copy (same picture, Korean
captions) into `runtime/demo-v3/<lang>/`: `scene-demo-<lang>.mp4`, `_check.md`, `_contact.jpg` and
`.srt`. There is no presenter voice (the owner found the synthetic narration worse than none,
2026-09-23): captions tell the story and the only sound is the film's own. The story follows the deck
(`scripts/deck`, direction "Screening room"): hook with eyes closed, the same seconds with Scene, why
now, the constraint, the product in the app (upload and Generate, the saved automatic run replayed,
a line a check sent back and Scene rewrote from the reviewer's fix, the measured fit and playback,
and an editor's change shown as the option it is), Google Cloud, evidence, close.

- The app scenes show one automatic run of the sample, made end to end with no editor (`SAMPLE_RUN`
  in `config.ts`; `runtime/showcase.json` pins the same run for the app). `sample.ts` reads it and
  refuses a run with an editor's line; `facts.ts` adds the evaluation (deck data modules) and the
  outside facts (`scripts/deck/facts.ts`). Nothing on screen or in a caption is typed by hand. The
  Gemini access wording is `GEMINI_ACCESS_LABEL` (src/lib/models.ts).
- Timing (`timing.ts`): each caption (up to two lines) stays up 0.5 s plus its characters at 17 per
  second in English and 10 in Korean (below the Netflix timed-text maxima of 20 and 12, since the
  picture changes underneath), never under 1.8 s. Scenes are as long as their captions, pauses and
  film sound; the recorder and the pages key their moves to caption sentence starts.
- Captions (`ass.ts`): Pretendard Medium 41 px in the band under the picture, fading in and out. A
  sentence becomes one two-line caption when a break fits both lines (42 characters English, 26
  Korean), else several; breaks keep names, counted numbers and Korean bound words together, never
  end a line on an article or preposition, and prefer a clause end or a conjunction at the start of
  the second line. `groups` on a caption sets them by hand where a list defeats the rules.
- Motion scenes are HTML pages in the deck's theme, rendered frame by frame in headless Chrome and
  piped into FFmpeg (`motion.ts`, `pages/`). The cloud scene (`pages/cloud.ts`) is drawn in hairlines:
  the Cloud Run outline, one line lighting the run's stages in order with the model each calls, the
  two loops that send a line back, then Cloud Storage and the live progress stream; arrowheads ride
  the drawn end of each line, and a slow push-in keeps the picture moving while it is read.
- App scenes are recorded at device scale 2 (2880×1440 frames, 1440×720 CSS viewport). The recorder
  logs element boxes, camera shots and overlays in film time (`recorder-kit.ts`); `camera.ts` turns
  them into eased scale+crop filters; overlays (spotlight, service chips, labels) are ASS drawings,
  because this FFmpeg has no drawtext.
- Waits (upload preparation, the saved run's replay) are squeezed, and every squeezed stretch carries
  a label with its real length. Film playback in the app stays at 1×; its sound is laid from the
  page's own media log. One shared gain brings all the film excerpts together to -16 LUFS.
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
127.0.0.1:21961 (`LOCAL_URL`), reading the same `runtime/` data as the dev server:

```sh
NEXT_DIST_DIR=.next-verify npm run build
cp -r .next-verify/static .next-verify/standalone/.next-verify/static
cp -r public .next-verify/standalone/public
cd .next-verify/standalone && DATA_DIR=$PWD/../../runtime PORT=21961 HOSTNAME=127.0.0.1 \
  FFMPEG_PATH=<the FFMPEG_PATH of .env.local> node server.js
```

When the day's live allowance is spent, the workspace shows a notice and disables Generate; the
films of 2026-09-23 were recorded with `DATA_DIR` pointing at a folder that links every entry of
`runtime/` except `budget/` (the recording never spends). Repeat both steps for `ko`. The record step
must follow any caption change, because each app scene is timed by its captions.

The check note fails (unchecked box) on: length 180 s or more, loudness more than 1.5 LU from
-16 LUFS, a frozen stretch over 4 s in the picture area, a caption faster than the reading pace or
shorter than 1.8 s, a line over the caption limit, more than 6 s with neither a caption nor film
sound, and the development Gemini label (`GEMINI_ACCESS_LABEL` naming OpenRouter) on the cloud page.
It never ticks the human watch-through.

## Debug log

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
  failing again, so the screen contradicted "fixed by itself".

## Status

Rebuilt on 2026-09-23 without the presenter voice, around the automatic sample run; the current
`_check.md` of each film lists what it meets. Open: the development Gemini label (until the switch to
Google AI Studio), the human watch-through, and the Cloud Run URL on the close page, which answers
again only after a redeploy under the same service name. Tests: `tests/demo-captions.test.ts`
(caption breaks, given groups, reading-time plan).
