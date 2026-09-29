# Gapline — AI Builder Cup 2026

Team: **Grab Your Dream**  
Theme: **Media, Content & Digital Experiences**  
Impact category: **Accessibility**

## Project description

Gapline creates audio description for blind and low-vision viewers in Korean and English. It finds
the silences between dialogue, checks each description against published audio-description
guidelines, voices it, and measures the returned audio before mixing the track. If a line fails the
final review, Gapline can rewrite it; the editor keeps every line open for a person's changes.

Gemini handles video understanding, writing, and review. Google Cloud Speech-to-Text times dialogue
and listens again to each usable silence. Text-to-Speech voices each description. The application
runs on Cloud Run with Cloud Storage, Secret Manager, Cloud Build, and Artifact Registry.

The prototype supports clips up to 90 seconds and 30 MB. It has not yet been evaluated with blind or
low-vision listeners or professional describers. Results and limitations are documented in
[EVALUATION.md](EVALUATION.md).

## Public materials

| Item | Link |
| --- | --- |
| Source repository | https://github.com/emforce77/gapline |
| English demo, 160 seconds | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-demo-en.mp4) |
| Korean review copy | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-demo-ko.mp4) |
| English pitch deck | [Download PDF](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-deck.pdf) |

## Delivery status — 29 September 2026

- Cloud Run redeployment is waiting for Google Cloud reauthentication. The previous service URL,
  `https://scene-ad-958994530029.asia-northeast3.run.app`, currently returns 404 and is not a live demo.
- The competition requires a public YouTube, Vimeo, or Google Drive video link. The GitHub MP4 above
  provides a download; upload the English file to one of the accepted hosts for the submission field.
- Gemini currently runs through OpenRouter, as the app, video, and deck disclose. Direct Gemini API
  access remains a planned change. The published technical requirements specify Google AI models
  and Cloud Run or Firebase; they do not explicitly require one Gemini API access route.
- Once the live demo and accepted video links work, set `SUBMISSION.demoUrl` and
  `SUBMISSION.videoUrl` in `scripts/deck/facts.ts`, then rebuild the PDF. The existing `--final` check
  also requires the planned direct Gemini API transition.
- The Hack2skill dashboard requires the team's authenticated session. The competition entry has
  not been submitted.

Official requirements: [What to submit](https://aibuildercup.com/themes.html),
[FAQ](https://aibuildercup.com/Faqs.html). Team dashboard:
[Hack2skill](https://hack2skill.com/event/aibuildercup2026/dashboard/team-management).
