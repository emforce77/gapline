/**
 * Where the demo film reads and writes, which runs it shows, and the fixed sizes of the picture.
 * Paths resolve from this file, not the working directory.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
 * The automatic Korean run the film shows from replay to playback: made end to end on 23 Sep 2026
 * with the final check's fix stage, with no editor (runtime/showcase.json pins it for the app too).
 */
export const SAMPLE_RUN = "20260923t065852164-ko-standard-350b05";

export const runFile = (runId: string, file: string): string => join(RUNS_DIR, runId, file);
export const CLIP_FILE = join(REPO, "runtime/projects", PROJECT_ID, "clip.mp4");

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Picture area above the caption band. */
export const CONTENT_HEIGHT = 960;
export const MAX_SECONDS = 180;

/** Browser recording: a 1440×720 CSS viewport at device scale 2 gives 2880×1440 frames. */
export const VIEWPORT = { width: 1440, height: 720 };
export const DEVICE_SCALE = 2;
/** CSS pixels to output pixels at zoom 1. */
export const CSS_TO_OUT = WIDTH / VIEWPORT.width;

export const CHROME_PATH = "/usr/bin/google-chrome";
export const FONTS_DIR = join(REPO, "node_modules/pretendard/dist/public/static");
