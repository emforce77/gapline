/** Shared FFmpeg settings: every scene segment is encoded the same way so they join without re-encoding. */
import { FONTS_DIR, FPS } from "./config";

const CRF = 18;

export function encodeArgs(): string[] {
  return [
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    String(CRF),
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-g",
    String(FPS * 2),
    "-an",
  ];
}

/** Burns a scene's .ass file in with Pretendard from node_modules (this FFmpeg has no drawtext). */
export const subtitlesFilter = (assFile: string): string =>
  `subtitles=filename='${assFile}':fontsdir='${FONTS_DIR}'`;
