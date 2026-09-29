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
| Submission video, English, 160 seconds | [Watch on Google Drive](https://drive.google.com/file/d/1yuhGGyPOm_IhLdVcERYa43bwXbHBhTub/view) |
| Previously published English demo, 160 seconds | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-demo-en.mp4) |
| Previously published Korean review copy | [Download MP4](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-demo-ko.mp4) |
| Updated English pitch deck | [Download PDF](https://github.com/emforce77/gapline/releases/download/v0.1.0-preview/gapline-deck-submission.pdf) |

## Delivery status — 29 September 2026

- Cloud Run revision `scene-ad-00002-kmf` serves the live prototype above, using the direct Gemini API
  with `GOOGLE_API_KEY` from Secret Manager. Its daily API allowance remains $5.
- Sample playback, private-upload access checks, and the sample's four downloads pass. A minimal
  structured Gemini call also passes. Fresh video generation still fails at the watch stage with
  HTTP 503 (high demand), so end-to-end validation and publication of the migration remain pending.
  Two failed runs retain their conservative reservations; new live runs reopen at 00:00 UTC on
  30 September unless those unknown costs can be reconciled.
- The owner uploaded the original English MP4 to Google Drive; its public link above is the selected
  competition video. The updated PDF includes the live prototype, repository, and video links.
- The updated video and deck describe the direct Gemini API candidate. Its source migration remains
  unpublished pending live validation. Recorded sample runs and historical evaluation costs remain
  unchanged; new Gemini costs are estimates from reported usage and published token rates.
- The Hack2skill dashboard requires the team's authenticated session. The competition entry has
  not been submitted.

Official requirements: [What to submit](https://aibuildercup.com/themes.html),
[FAQ](https://aibuildercup.com/Faqs.html). Team dashboard:
[Hack2skill](https://hack2skill.com/event/aibuildercup2026/dashboard/team-management).
