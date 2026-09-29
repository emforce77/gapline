# Gapline — AI Builder Cup 2026

Team: **Grab Your Dream**  
Theme: **Media, Content & Digital Experiences**  
Impact category: **Accessibility**

## Project description

Gapline creates audio description for blind and low-vision viewers in Korean and English. It finds
the silences between dialogue, checks each description against published audio-description
guidelines, voices it, and measures the returned audio before mixing the track. If a line fails the
final review, Gapline can rewrite it; the editor keeps every line open for a person's changes.

The direct Gemini API (Google AI Studio) handles video understanding, writing, and review.
Google Cloud Speech-to-Text times dialogue and listens again to each usable silence. Text-to-Speech
voices each description. The application runs on Cloud Run with Cloud Storage, Secret Manager,
Cloud Build, and Artifact Registry.

The prototype supports clips up to 90 seconds and 30 MB. It has not yet been evaluated with blind or
low-vision listeners or professional describers. Results and limitations are documented in
[EVALUATION.md](EVALUATION.md).

## Public materials

| Item | Link |
| --- | --- |
| Source repository | https://github.com/emforce77/gapline |
| Live prototype | https://scene-ad-958994530029.asia-northeast3.run.app |
| Submission video, English (Google Drive) | [Watch on Google Drive](https://drive.google.com/file/d/1yuhGGyPOm_IhLdVcERYa43bwXbHBhTub/view) |
| Pitch deck in the Hack2skill template | [Download PDF](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-pitch.pdf) |
| English demo, 2 min 56 s | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-demo-en.mp4) |
| Korean review copy | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-demo-ko.mp4) |

The deck is built by `npm run pitch` from the organisers' template ([scripts/pitch](../scripts/pitch/MODULE.md));
the film by `npm run demo` ([scripts/demo](../scripts/demo/MODULE.md)).

## Delivery status — 29 September 2026

- Cloud Run revision `scene-ad-00003-nmh` serves the live prototype, calling the Gemini API directly
  with `GOOGLE_API_KEY` from Secret Manager. Its daily API allowance remains $5.
- The Gemini API key in use is on the free tier. Measured on 29 September: a 429 answer names the
  quota `GenerateRequestsPerMinutePerProjectPerModel-FreeTier` (5 requests a minute), Gemini 3.8
  Flash answered 4 of 8 small requests with HTTP 503 ("high demand"), and the model's free daily
  requests then ran out. Fresh generation needs paid-tier quota: set up billing for the key's
  project in Google AI Studio, or add prepaid credits to project `majestic-voice-486204-q6` (a key
  there answered 402, "prepayment credits are depleted") and store a key from it in
  `scene-ad-gemini-key`.
- Since revision `scene-ad-00003-nmh`, a request the API rejects with 429 or 503 is retried with
  exponential backoff up to four times, and a rejected request no longer holds part of the daily
  allowance (the API does not bill it). Two runs that failed earlier on 29 September still hold
  theirs; the allowance renews at 00:00 UTC.
- The film now runs under 3 minutes: English 176.57 seconds (2:56), Korean 176.83 seconds. The
  `v0.2.0-preview` release MP4s were replaced on 29 September, and anonymous downloads match the local
  films by SHA-256. The Google Drive link still plays the earlier 3:30 cut (210.53 seconds) until the
  owner uploads the new English film as a new version of the same Drive file, which keeps the link.
- The final 16-page deck at `runtime/pitch/gapline-pitch.pdf` matches the publicly downloadable
  `v0.2.0-preview` PDF by SHA-256. The deck includes the public repository, Drive and prototype links.
- The film runs under 3 minutes, as the owner confirmed on 29 September. The template says
  "3 minutes" and the public FAQ says "under 3 minutes"; the build fails at 180 seconds or more
  ([the demo module](../scripts/demo/MODULE.md)).
- Further Gemini generation checks are deferred at the owner's request because the daily quota
  is exhausted. No additional generation or quota changes were made for this material update.
- The Hack2skill dashboard requires the team's authenticated session. The competition entry has
  not been submitted.

Official requirements: [What to submit](https://aibuildercup.com/themes.html),
[FAQ](https://aibuildercup.com/Faqs.html). Team dashboard:
[Hack2skill](https://hack2skill.com/event/aibuildercup2026/dashboard/team-management).
