# Scene

Scene helps an editor make Korean and English audio description for short films. It grounds lines in visible scenes, places them inside speech-free windows, measures the synthesized voice, and keeps a reviewable history. An editor can change a sentence or its start time and produce a new mix while preserving the original result.

[Try the existing Cloud Run demo](https://scene-ad-958994530029.asia-northeast3.run.app) · [Architecture](docs/ARCHITECTURE.md) · [Evaluation results and limits](docs/EVALUATION.md) · [Demo production](scripts/demo/MODULE.md)

## What works

- Google Cloud Chirp 3 recognizes word timings; Gemini 3.8 Flash watches, writes and reviews through OpenRouter.
- Placement never moves a sentence into a different gap. Contradictory verdicts and unchanged rejected rewrites fail validation.
- Validated speech and scene analysis are saved separately as soon as they finish. Reuse requires the same source hash, film language, model and analysis version.
- Chirp 3 HD voices each line. Actual PCM length determines whether it fits; automatic generation can shorten or drop a line. A final audit checks the sentences that survived.
- The inspector shows scene evidence, review reasons and version history. Human edits stay verbatim. A failed edit leaves the original result available.
- Each edit creates a child run with `parentRunId` and an edit history. Unchanged WAV files are reused byte for byte.
- Outputs: described H.264/AAC MP4, narration WAV, WebVTT, and a JSON script with review history.

“Model checked” is a model judgment, not independent certification. Unresolved facts or missing information remain **Review needed**. The on-screen overlap metric compares with the recognizer used by the pipeline. Independent evaluation and user acceptance are separate; no claim of improved blind/low-vision user comprehension or satisfaction is made.

The bounded September screen recorded ten runs: seven outputs and three failures from unusable speech timings. The medium-effort reviewer candidate was not promoted because essential coverage was lost. OpenRouter screening spend was $0.848, plus $0.135 in Google speech estimates. Later prompt corrections are documented separately from these frozen measurements.

## Local setup

Use Node.js 20.9 or newer and FFmpeg with libx264, AAC, FLAC and ebur128. The film builder also needs libass. Install dependencies with `npm ci`, copy `.env.example` to `.env.local`, and supply your OpenRouter key and Google Cloud project/configuration. Never commit credentials. Google Cloud Speech-to-Text and Text-to-Speech must be enabled for the configured account.

```sh
npm run dev                 # http://127.0.0.1:21960
npm run samples             # licensed Tears of Steel source, clip and metadata
npm run pipeline -- tos-opening ko standard  # paid APIs; demo budget applies
npm test                    # deterministic regressions, no paid APIs
npm run test:media          # synthetic FFmpeg workflow; providers mocked
npm run typecheck
NEXT_DIST_DIR=.next-verify npm run build
```

The app accepts video clips up to 90 seconds. Runtime data lives in `runtime/` locally and `/data` on Cloud Run. Keep uploaded clips and generated files out of Git.

## Editing and privacy

`POST /api/projects/{id}/runs/{baseRunId}/edits` accepts `{ "cueId": "L3", "text": "40 years later.", "start": 45.5, "requestId": "a-unique-request-id" }`. A start must stay in the same gap and preserve the line order, after the previous line's measured voice and before the next line. Repeated identical requests return the same child run; a reused request ID with different content fails. A missing per-line WAV requires a fresh generation. A rejected line with a valid gap can be corrected and restored.

Samples are public. Uploads are protected by a random, HttpOnly, SameSite=Strict owner cookie; the stored project contains only its hash. The same check protects listing, pages, media, run events, generation and edits. Clearing the cookie loses access; this is an anonymous session, not an account/recovery system. Legacy uploads with no owner are not publicly claimable. Internal metadata and ledgers are not downloadable through the media endpoint.

## Cost control and recovery

The public demo allowance is $5 per UTC day. Every run reserves $2.50 conservatively and settles to its recorded API charges. Each OpenRouter attempt reserves $1.10 within that run, enough for the supported model's context/output ceilings at the configured price ceilings; Google speech calls also reserve their list-price estimates. Unknown charges retain the hold. HTTP 429/503 or matching stream errors get at most one retry; `Retry-After` is respected. Delays over ten minutes are returned as retryable errors rather than holding a request beyond the service timeout.

Cloud Run requires `DATA_BUCKET`: reservations and edit request claims use Cloud Storage generation preconditions. Local state uses a filesystem lock and atomic rename. A crash retains reservations/claims until an operator reconciles actual charges and run artifacts. Do not clear holds merely because a request disconnected.

The evaluation scope is separate and serial, capped at $10/day and $20 total, conservatively counting Google speech charges too. `runtime/evaluation/runs.jsonl` records at most twelve screening runs. Failed and retried calls remain in each run's ledger. Cloud hosting, storage, build and network costs are excluded from the displayed **API cost**.

## Sources and release boundary

The sample is _Tears of Steel_, Blender Foundation, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), [source](https://mango.blender.org/). Evaluation also uses Wikitongues / Teddy Nee, [Hanbid speaking Korean](https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm), CC BY-SA 4.0; excerpts and derivatives must retain attribution and share-alike terms. The synthetic signal fixture is explicitly identified separately.

This checkout remains unpublished. No GitHub push, repository visibility change, contest registration or submission is performed by the upgrade workflow. Public release and submission remain with the owner.
