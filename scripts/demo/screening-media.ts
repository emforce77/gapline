// Reproduce the public listening excerpts from the named, licensed evaluation runs and the November English edit.
// From the repository root: node --env-file=.env.local --import tsx scripts/demo/screening-media.ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg, withScratchDir } from "../../src/lib/media/ffmpeg";

const out = "public/screening-media";
const opening = "runtime/projects/tos-opening";
const before = "20260922t051536291-ko-standard-d88b71";
const after = "20260923t064439178-ko-standard-837b9f";
const interview = "runtime/projects/eval-ko-intro/runs/20260922t052555638-ko-standard-cb49f5";
const movieCredit =
  "Tears of Steel (CC) Blender Foundation | mango.blender.org | CC BY 3.0 https://creativecommons.org/licenses/by/3.0/ | Excerpts, labels and narration by Gapline.";
const interviewCredit =
  "Hanbid speaking Korean, Wikitongues / Teddy Nee, via Wikimedia Commons. Excerpt with audio description by Gapline. CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/";

async function build() {
  await mkdir(out, { recursive: true });
  await withScratchDir(async (work) => {
    // Seven seconds from each finished mix, in the same order, at their saved relative levels.
    const titles = join(work, "versions.srt");
    await writeFile(
      titles,
      [
        "1",
        "00:00:00,000 --> 00:00:07,000",
        "FIRST PASS   /   Narration over the radio call",
        "",
        "2",
        "00:00:07,000 --> 00:00:14,000",
        "AFTER RE-LISTENING   /   The radio call alone",
        "",
      ].join("\n"),
    );
    await runFfmpeg([
      "-y",
      "-ss",
      "2",
      "-t",
      "7",
      "-i",
      join(opening, "runs", before, "described.mp4"),
      "-ss",
      "2",
      "-t",
      "7",
      "-i",
      join(opening, "runs", after, "described.mp4"),
      "-filter_complex",
      "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[film][audio];" +
        "[film]scale=960:-2,pad=960:480:0:0,subtitles=" +
        titles +
        ":force_style='Fontname=DejaVu Sans,FontSize=13,Alignment=2,MarginV=8'[picture]",
      "-map",
      "[picture]",
      "-map",
      "[audio]",
      "-c:v",
      "libx264",
      "-crf",
      "22",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-metadata",
      "comment=" + movieCredit,
      join(out, "launch-review.mp4"),
    ]);
  });
  // Both saved mixes start at 56.5 s. Hear the original English line, then the accepted edit.
  const englishMix = (run: string) => join(opening, "runs", run, "described.mp4");
  await runFfmpeg([
    "-y",
    "-ss",
    "56.5",
    "-t",
    "4",
    "-i",
    englishMix("20260928t064307205-en-standard-221ceb"),
    "-ss",
    "56.5",
    "-t",
    "4",
    "-i",
    englishMix("edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f"),
    "-filter_complex",
    "[0:a][1:a]concat=n=2:v=0:a=1[audio]",
    "-map",
    "[audio]",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    "-metadata",
    "comment=" + movieCredit,
    join(out, "english-line.m4a"),
  ]);
  for (const [seconds, name] of [
    ["56.7", "brain"],
    ["59.3", "eyepiece"],
  ]) {
    await runFfmpeg([
      "-y",
      "-ss",
      seconds,
      "-i",
      join(opening, "clip.mp4"),
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "2",
      join(out, name + ".jpg"),
    ]);
  }
  await runFfmpeg([
    "-y",
    "-ss",
    "21",
    "-t",
    "8",
    "-i",
    join(interview, "described.mp4"),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-vf",
    "scale=640:-2",
    "-c:v",
    "libx264",
    "-crf",
    "22",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-metadata",
    "comment=" + interviewCredit,
    join(out, "hanbid.mp4"),
  ]);
}

void build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
