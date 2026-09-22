# Demo production, version 2

Outputs are written under `runtime/demo-v2/`, preserving the earlier `runtime/demo/` films. English is the submission draft; Korean is the review copy. Both target 175 seconds. The builder throws before encoding or after probing if duration is **180 seconds or longer**.

Pin `runtime/demo-v2/selection.json` to the project, generation run, edit parent, and recorded children. Nothing selects “the latest run” implicitly. The opening uses the edited Korean sample at 54–60.4 seconds, first as original sound, then with description. Both films contain English burned-in captions and an English SRT.

```json
{
  "projectId": "tos-opening",
  "generationRunId": "completed-generation-id",
  "editBaseRunId": "completed-parent-id",
  "editedRuns": {},
  "edit": { "cueId": "L4", "text": "시뮬레이션 준비 완료.", "start": 54.2 }
}
```

Run production steps serially:

```sh
npm run demo -- en voice
npm run demo -- ko voice
npm run demo -- en record
npm run demo -- en build
npm run demo -- ko record
npm run demo -- ko build
node --env-file=.env.local --import tsx scripts/demo/presentation.ts
```

Voice requests use Google Cloud TTS and cache unchanged text/voice/rate. **Recording performs a paid sentence edit against the deployed service.** It records a real private upload, replays the pinned generation's saved trace, displays a genuinely changed rejected line, edits one dropped sentence, listens, and downloads VTT. The uploaded project and the replayed sample are distinct; narration explicitly says it is a saved trace for the same sample. No new full generation is claimed in the recording.

The edit writes a child run and records its exact ID. Do not rerun recording simply to repeat an already-successful paid mutation. The recorded cursor is an overlay on actual browser interaction. Time-compressed sections carry the speed and original run/edit processing time; listening remains at normal speed. Frame/media timestamps align the described soundtrack to recorded playback. Every source is loudness-adjusted, and an output limiter prevents digital over-levels.

The September delivery uses one actual English-interface edit recording for both narration languages. Cards and presenter speech are localized; the listening beat starts film sound at ten seconds to keep both presenters clear of it. The first recording stopped while locating the download link after the paid edit had succeeded. Its edit frames were preserved and recovered using file write timestamps, then combined with a new CDP-timed upload/replay/listening/download recording. `DEMO_EDIT_CAPTURE` explicitly points to that preserved capture and checks the child run ID; it never simulates or repeats the edit. The recorder now checkpoints each beat so a later failure cannot discard completed paid evidence.

Each film has a technical check note. Full decode, video dimensions/codecs, duration, audio loudness/peaks, frame samples, caption placement and voice/film separation can be checked automatically. These checks do **not** substitute for a human listening to both complete films before submission. No claim of participant impact or certified zero real speech/sound intrusion is made.

Source: _Tears of Steel_, Blender Foundation, CC BY 3.0. The presentation also attributes the Korean Wikitongues evaluation source. Browser session files, owner tokens, raw recordings and media stay ignored. Neither this script nor deployment publishes GitHub or submits to the contest.
