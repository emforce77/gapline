/** Every file the deck reads or writes, in one place. Paths resolve from this file, not the cwd. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DECK_SRC = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(DECK_SRC, "../..");

/** Build output: the PDF, one PNG per slide, the contact sheet and the check note. */
export const OUT = join(REPO, "runtime/deck");
export const OUT_SLIDES = join(OUT, "slides");
export const ASSETS = join(OUT, "assets");
export const STILLS = join(ASSETS, "stills");
export const SCREENS = join(ASSETS, "screens");
export const FONTS_OUT = join(ASSETS, "fonts");
export const CACHE = join(OUT, "cache");

export const DECK_HTML = join(OUT, "scene-deck.html");
export const DECK_PDF = join(OUT, "scene-deck.pdf");
export const CONTACT_SHEET = join(OUT, "contact-sheet.png");
export const CHECK_NOTE = join(OUT, "scene-deck_check.md");

export const PROJECTS = join(REPO, "runtime/projects");
/** The one sample run the app, the film and the deck show (project and run id). */
export const SHOWCASE_PIN = join(REPO, "runtime/showcase.json");
/** The clip Scene heard for the sample (the opening, film 0–65 s). */
export const SHOWCASE_CLIP = join(PROJECTS, "tos-opening/clip.mp4");
/** Checks run against the live Cloud Run service on 22 Sep 2026, around one line edit. */
export const LIVE_CHECK = join(REPO, "runtime/demo-v2/live-check.json");
/** English run (default reviewer) on the Tears of Steel city sequence, 45 s. */
export const CITY_RUN = join(
  REPO,
  "runtime/projects/eval-tos-city/runs/20260922t052954613-en-standard-d8685b/script.json",
);
/** The voice stage's source, read only to check the speed-up rule the newspaper slide relies on. */
export const FIT_SOURCE = join(REPO, "src/lib/pipeline/fit-voice.ts");
/** Ten runs over six clips, two reviewer settings. */
export const EVAL_SUMMARY = join(REPO, "runtime/evaluation/summary.json");
/** A second recognizer (faster-whisper small) on the same opening clip. */
export const OPENING_SECOND_ASR = join(
  REPO,
  "runtime/evaluation/tos-opening.independent-speech.json",
);
/** The same recognizer on short slices of the opening, each on its own (scripts/deck/probe). */
export const SLICE_ASR = join(OUT, "evidence/slice-asr.json");
/** The re-listen regression test's fixture: the launch-call case, as the recognizer would answer. */
export const RELISTEN_FIXTURE = join(REPO, "tests/fixtures/tos-opening-relisten.json");
/** Spectrograms the build renders from the clip's soundtrack. */
export const SPECTROGRAMS = join(ASSETS, "spectrograms");

/** The repo's own clips, used only to prove the frame offsets of the 1080p master. */
export const OPENING_CLIP = SHOWCASE_CLIP;
export const CITY_CLIP = join(REPO, "runtime/evaluation/eval-tos-city.mp4");

export const PRETENDARD_STATIC = join(REPO, "node_modules/pretendard/dist/web/static/woff2");
export const VENDORED_FONTS = join(DECK_SRC, "fonts");
