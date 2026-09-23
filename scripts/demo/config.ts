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
 * The service the app scenes are recorded from. Drafts use the local dev server (same code, same
 * pinned sample runs); the submission film is recorded from the deployed service.
 */
export const DEPLOYED_URL = "https://scene-ad-958994530029.asia-northeast3.run.app";
export const BASE_URL = (process.env.DEMO_BASE_URL || DEPLOYED_URL).replace(/\/$/, "");

export const PROJECT_ID = "tos-opening";
const RUNS_DIR = join(REPO, "runtime/projects", PROJECT_ID, "runs");
/** The automatic Korean run the replay and the rejection come from. */
export const ORIGINAL_RUN = "20260922t051536291-ko-standard-d88b71";
/** The result the editor typed into (itself an earlier editor session on the original). */
export const EDIT_PARENT_RUN = "edit-b81cc95c158ee4acf857a44a2f7cf609e1df851c";
/** The recorded result of that edit; the film shows it instead of paying for the edit again. */
export const EDIT_CHILD_RUN = "edit-6c4ddb3c5a06c7901a834befe1bb25ba04a7ebde";

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
