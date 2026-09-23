# scripts/demo — the submission film

## Direction

Builds the under-3-minute English submission film and a Korean review copy (same picture, Korean
presenter and captions) into `runtime/demo-v3/<lang>/`: `scene-demo-<lang>.mp4`, `_check.md`,
`_contact.jpg` and `.srt`. The story follows the deck (`scripts/deck`, direction "Screening room"):
hook with eyes closed, the same seconds with Scene, why now, the constraint, the product in the app
(upload, replay, a rule-cited rejection, the editor's fix, the measured fit, playback), Google Cloud,
evidence, close.

- Numbers come from run records through the deck's data modules (`scripts/deck/data`, `facts.ts`),
  read by `facts.ts` here; nothing on screen or in a sentence is typed by hand. The Gemini access
  wording is `GEMINI_ACCESS_LABEL` (src/lib/models.ts).
- Motion scenes are HTML pages in the deck's theme, rendered frame by frame in headless Chrome and
  piped into FFmpeg (`motion.ts`, `pages/`). Their moves are keyed to sentence starts.
- App scenes are recorded at device scale 2 (2880×1440 frames, 1440×720 CSS viewport). The recorder
  logs element boxes, camera shots and overlays in film time (`recorder-kit.ts`); `camera.ts` turns
  them into eased scale+crop filters; overlays (spotlight, service chips, labels) are ASS drawings,
  because this FFmpeg has no drawtext.
- Waits (upload preparation, the saved run's replay) are squeezed, and every squeezed stretch carries
  a label with its real length. Film playback in the app stays at 1×; its sound is laid from the
  page's own media log.
- The edit is never submitted: the recorder types the reviewer's fix into the parent result and
  hovers "Review and re-voice", then the next scene opens the result that same edit produced on
  22 Sep 2026, labelled as such. Requests that could start a paid run or edit are aborted, and the
  recording fails if one was attempted.
- The hook's picture is cut from Blender's 1080p master (`master.ts`, same checksum as the deck),
  checked frame by frame against the repo clip; only the 10 MB cut is kept.

## Production

```sh
npm run demo -- en voice            # Google Cloud TTS, cached per sentence (needs gcloud auth)
npm run demo -- en voice --estimate # no audio: estimated lengths, film built silent and marked
npm run demo -- en record           # DEMO_BASE_URL=http://127.0.0.1:21960 for a local draft
npm run demo -- en build            # about 4 minutes
```

Repeat for `ko`. Recording and building are free; voice costs about $0.05 per language per full
script (Chirp 3 HD, $30 per 1M characters) and is capped at $0.50 in the check note. The record step
must follow any voice change, because each app scene is timed by its sentences. For the submission,
record from the deployed service (default `DEMO_BASE_URL`); the check note says which server the app
scenes came from. A human voice-over replaces a sentence when `runtime/demo-v3/<lang>/takes/<scene>-<n>.wav`
exists.

The check note fails (unchecked box) on: length 180 s or more, a frozen stretch over 4 s in the
picture area, a presenter sentence over 150 words per minute, a caption line over 42 characters
(22 for Korean), an estimated (unvoiced) presenter, recording from a server other than the deployed
one, and TTS spend over $0.50. It never ticks the human watch-through.

## Debug log

- [2026-09-23] CDP screencast frames were 1440×720 in v2 whatever deviceScaleFactor was set; Chrome's
  `--force-device-scale-factor=2` gives 2880×1440 (the recorder checks the first frame's size).
- [2026-09-23] Google Cloud auth for TTS needed an interactive `gcloud auth login`; the drafts were
  built with `--estimate` (no presenter audio) and $0 spent.
- [2026-09-23] freezedetect (n=0.001) counts a slowly growing line or a ticking counter as frozen;
  motion pages reveal something at least every few seconds so no stretch passes 4 s.

## Status

Draft films of 2026-09-23 (EN 174.0 s, KO 173.1 s) were recorded from the local dev server with
estimated narration timing and no presenter audio; their frames and build files were deleted after
the build, so the next build needs `voice` and `record` first. Each `_check.md` lists what the
drafts still fail (presenter not voiced, not recorded from the deployed service, not watched).
