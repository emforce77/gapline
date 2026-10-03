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
| Live prototype | https://scene-ad-117546381357.asia-northeast3.run.app |
| Submission video, English (Google Drive) | [Watch on Google Drive](https://drive.google.com/file/d/1yuhGGyPOm_IhLdVcERYa43bwXbHBhTub/view) |
| Pitch deck in the Hack2skill template | [Download PDF](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-pitch.pdf) |
| English demo, 2 min 56 s | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-demo-en.mp4) |
| Korean review copy | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-demo-ko.mp4) |

The deck is built by `npm run pitch` from the organisers' template ([scripts/pitch](../scripts/pitch/MODULE.md));
the film by `npm run demo` ([scripts/demo](../scripts/demo/MODULE.md)).

## Delivery status — 3 October 2026

- On 3 October the live prototype moved to a new Cloud Run service at the address above (revision
  `scene-ad-00001-9jd`). It calls the Gemini API directly with `GOOGLE_API_KEY` from Secret Manager,
  on paid-tier quota. The daily API allowance is $5 and renews at 00:00 UTC.
- Checked on the new service on 3 October: a 12-second uploaded clip ran through every stage in 37.6
  seconds for $0.034, its four files downloaded, an edit was saved as a new version, and a second
  browser session got 404 for the upload.
- A request the API rejects with 429 or 503 is retried with exponential backoff up to four times, and
  a rejected request does not hold part of the daily allowance (the API does not bill it).
- The film runs under 3 minutes: English 176.57 seconds (2:56), Korean 176.83 seconds. The
  `v0.2.0-preview` release MP4s and the Google Drive file play this cut.
- The `v0.2.0-preview` pitch PDF still shows the earlier prototype address. Rebuild it with
  `npm run pitch` and replace the release file to show the address above.
- The film runs under 3 minutes, as the owner confirmed on 29 September. The template says
  "3 minutes" and the public FAQ says "under 3 minutes"; the build fails at 180 seconds or more
  ([the demo module](../scripts/demo/MODULE.md)).
- The Hack2skill dashboard requires the team's authenticated session; the prototype address entered
  there must match the one above.

Official requirements: [What to submit](https://aibuildercup.com/themes.html),
[FAQ](https://aibuildercup.com/Faqs.html). Team dashboard:
[Hack2skill](https://hack2skill.com/event/aibuildercup2026/dashboard/team-management).
