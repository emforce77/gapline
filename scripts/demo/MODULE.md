# scripts/demo — the submission video

## Direction

Makes the under-3-minute demo video, one per language (`npm run demo -- <ko|en> [cards|voice|record|build|all]`).
Everything shown comes from the deployed service: the run list, each run's `script.json` and
`described.mp4` (demo-data.ts). The presenter's numbers are read from those runs, never typed in.

- `storyboard.ts` — scenes and presenter sentences for KO and EN. `featuredLine` picks the line the
  inspector opens: a genuinely rewritten line (review loop) if the run has one, otherwise a line whose
  first voicing overran its pause (length loop). The narration follows whichever it is.
- `cards.ts` — still frames drawn as HTML in the app's tokens, captured by Chrome at 1920×960.
- `voice.ts` — presenter voice (Chirp 3 HD Aoede, distinct from the Charon narrator), one request per
  sentence, cached by text+voice; `planScene` turns measured lengths into scene timing.
- `record.ts` — drives the deployed app in headless Chrome (1440×720 at 4/3 → 1920×960) with a drawn
  cursor; frames come from the DevTools screencast with capture times, and the page logs when the film
  plays. Each beat lasts at least as long as its narration, so the build never freezes or cuts picture.
- `build.ts` — one H.264 segment per scene with captions burned in (libass, Pretendard OTF), joined
  without re-encoding; audio laid at planned/recorded times, each source at -16 LUFS; writes
  `scene-demo-<lang>_check.md` (length ≤ 180 s, loudness, capture fps, film alignment).

Not its job: making runs. Runs are made on the service (scripts/cloud-run-sse.sh logs one over SSE).

Outputs (gitignored): `runtime/demo/media/*` (downloads), `runtime/demo/<lang>/{cards,voice,rec,build}/`,
`runtime/demo/<lang>/scene-demo-<lang>.mp4` and its `_check.md`.

## Debug log

- [2026-09-22] Featured line for EN run 20260921t082401167: L3 was rejected (spoiler) and "revised" to the
  identical text, which then passed. Showing that as "rejected → rewritten" would be false, so
  `featuredLine` requires the revised text to differ, and the video shows L5 (voiced 3.27 s in a 2.8 s
  pause → shortened to 2.37 s). The app's metric was relabelled from "caught and fixed" to
  "flagged in review" (it now shows `summary.cuesRejected`) for the same reason.
- [2026-09-22] Stopping the eyes-closed playback on wall time cut the last line of dialogue ("This is
  pretty freaky", 60.8–62.4 s), because play starts ~0.4 s after the planned offset. The recorder now
  waits for the video's own `currentTime` to reach the end of the stretch.
- [2026-09-22] Dry run with silent presenter lines of estimated length (words ÷ 2.7/s): 168.7 s total,
  capture 57 fps during the replay animation, 30 fps during playback, 9–19 fps on static screens
  (the screencast sends frames only on change; ffconcat durations hold each one).

- [2026-09-22] Parking the paused player on 57.5 s right after `.metrics` appeared did nothing: the
  player swaps to the described film when the run loads and restores the previous position (0 s).
  The recorder now waits until the video's `currentSrc` is the run's film and `readyState >= 2`.
- [2026-09-22] KO presenter first came to 122.0 s (EN 113.0 s), which put the plan at ~177 s. Four
  sentences were tightened to 116.2 s; the KO video ended at 169.6 s.

## Status

- [2026-09-22] Both videos built from revision scene-ad-00003-667:
  - EN `runtime/demo/en/scene-demo-en.mp4` — 168.1 s, -16.2 LUFS, run 20260921t082401167 (7/7 lines,
    $0.190, 4 min 11 s), featured line L5 (length loop).
  - KO `runtime/demo/ko/scene-demo-ko.mp4` — 169.6 s, -16.1 LUFS, run 20260922t024410240 (4/4 lines,
    1 dropped after review, $0.219, 5 min 14 s), featured line L3 (review loop, genuinely rewritten).
  - Presenter TTS: EN 1,678 chars $0.050, KO 1,087 chars $0.033. Checks in `scene-demo-<lang>_check.md`.
- Only `voice` calls a paid API (Google Text-to-Speech, gcloud login). Runs themselves are made on the
  service; Gemini goes through OpenRouter there.
