/**
 * Where the demo film reads and writes, which runs it shows, and the fixed sizes of the picture.
 * Paths resolve from this file, not the working directory.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pin } from "../deck/data/runs";

export const DEMO_SRC = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(DEMO_SRC, "../..");

/** Output: runtime/demo-v3/<lang>/scene-demo-<lang>.mp4, its check note, SRT and contact sheet. */
export const OUT = join(REPO, "runtime/demo-v3");
export const PAGES_DIR = join(OUT, "pages");
export const CACHE_DIR = join(OUT, "cache");

/**
 * The server the app scenes are recorded from: a production build of this repo run locally, reading
 * the same runtime/ data (pinned sample runs) as the dev server. The owner took the Cloud Run service
 * down on 2026-09-23 and chose local recording.
 */
export const LOCAL_URL = "http://127.0.0.1:21961";
export const BASE_URL = (process.env.DEMO_BASE_URL || LOCAL_URL).replace(/\/$/, "");

export const PROJECT_ID = "tos-opening";
const RUNS_DIR = join(REPO, "runtime/projects", PROJECT_ID, "runs");
/**
 * The automatic Korean run the film shows from replay to playback: the one sample runtime/showcase.json
 * pins for the app, the film and the deck (read through the deck's data/runs.ts).
 */
export const SAMPLE_RUN = pin.runs.ko;

export const runFile = (runId: string, file: string): string => join(RUNS_DIR, runId, file);
export const CLIP_FILE = join(REPO, "runtime/projects", PROJECT_ID, "clip.mp4");

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/**
 * Picture area above the caption band. The band (880–1080) holds two caption lines of 50 px at a
 * 60 px pitch, the lower one's descenders at least 54 px (5 %, title-safe) above the frame's foot.
 */
export const CONTENT_HEIGHT = 880;
export const MAX_SECONDS = 180;

/**
 * Browser recording: a 1440×660 CSS viewport at device scale 2 gives 2880×1320 frames, the picture
 * area's own aspect (1920×880), so the camera's wide shot shows the whole page.
 */
export const VIEWPORT = { width: 1440, height: 660 };
export const DEVICE_SCALE = 2;
/** CSS pixels to output pixels at zoom 1. */
export const CSS_TO_OUT = WIDTH / VIEWPORT.width;
if (Math.abs(VIEWPORT.height * CSS_TO_OUT - CONTENT_HEIGHT) > 0.5)
  throw new Error("the recording viewport must have the picture area's aspect");

export const CHROME_PATH = "/usr/bin/google-chrome";
export const FONTS_DIR = join(REPO, "node_modules/pretendard/dist/public/static");
