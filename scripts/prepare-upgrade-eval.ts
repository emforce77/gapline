import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { createProject } from "../src/lib/store/ingest";
import { projectDir } from "../src/lib/store/projects";
import { parseSrt } from "../src/lib/srt";
const tos = "runtime/source/tears_of_steel_720p.mov";
const korean = "runtime/source/hanbid-korean.webm";
const dir = "runtime/evaluation";
const cases = [
  {
    id: "tos-opening",
    source: tos,
    from: 0,
    seconds: 65,
    language: "ko",
    filmLanguage: "en-US",
    split: "development",
    facts: [
      "Rocket engines ignite and rocket rises above a canal city.",
      "A woman has a mechanical right hand; dialogue carries their argument.",
      "40 YEARS LATER marks the change to a laboratory.",
      "Technicians inspect a brain covered in electrodes.",
    ],
    license: "CC BY 3.0",
    url: "https://download.blender.org/demo/movies/ToS/",
    author: "Blender Foundation",
  },
  {
    id: "eval-ko-intro",
    source: korean,
    from: 0,
    seconds: 45,
    language: "ko",
    filmLanguage: "ko-KR",
    split: "development",
    facts: [
      "A man with glasses and a checkered shirt sits behind a desk, speaking and gesturing.",
      "Curtain to the left; SEAMi lettering and flower emblem on the wall.",
    ],
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm",
    author: "Wikitongues / Teddy Nee",
  },
  {
    id: "eval-tos-city",
    source: tos,
    from: 65,
    seconds: 45,
    language: "en",
    filmLanguage: "en-US",
    split: "development",
    facts: [
      "TEARS OF STEEL title on black.",
      "Ruined city and an elevated lookout.",
      "A man aims a rifle with a scope.",
      "Large machines approach through the city.",
    ],
    license: "CC BY 3.0",
    url: "https://download.blender.org/demo/movies/ToS/",
    author: "Blender Foundation",
  },
  {
    id: "eval-signal",
    source: join(dir, "synthetic-signal.mp4"),
    from: 0,
    seconds: 30,
    language: "ko",
    filmLanguage: "en-US",
    split: "development",
    facts: [
      "A red square is visible from 0 to 10 seconds.",
      "A blue square replaces it from 10 to 20 seconds.",
      "A green square replaces it from 20 to 30 seconds.",
      "A short authored beep sounds at each transition (10 and 20 seconds).",
    ],
    license: "CC0",
    url: "scripts/prepare-upgrade-eval.ts",
    author: "Scene synthetic fixture",
  },
  {
    id: "eval-ko-holdout",
    source: korean,
    from: 90,
    seconds: 40,
    language: "ko",
    filmLanguage: "ko-KR",
    split: "confirmation",
    facts: ["Same desk interview setting; the speaker uses both hands while talking."],
    license: "CC BY-SA 4.0",
    url: "https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm",
    author: "Wikitongues / Teddy Nee",
  },
  {
    id: "eval-tos-team",
    source: tos,
    from: 190,
    seconds: 45,
    language: "en",
    filmLanguage: "en-US",
    split: "confirmation",
    facts: [
      "A man in a red jacket addresses an older gray-haired man; a woman stands beside them.",
      "Technicians operate floating holographic controls.",
      "A holographic grid transforms the ruined exterior street into a sunny canal town.",
    ],
    license: "CC BY 3.0",
    url: "https://download.blender.org/demo/movies/ToS/",
    author: "Blender Foundation",
  },
];
async function main() {
  if (existsSync(join(dir, "runs.jsonl")))
    throw new Error(
      "Screening references are frozen after the first run; use a fresh checkout for a new screen.",
    );
  if (!existsSync(korean)) {
    const response = await fetch(
      "https://upload.wikimedia.org/wikipedia/commons/1/10/WIKITONGUES-_Hanbid_speaking_Korean.webm",
    );
    if (!response.ok) throw new Error(`Korean source download failed: ${response.status}`);
    await mkdir("runtime/source", { recursive: true });
    await writeFile(korean, Buffer.from(await response.arrayBuffer()));
  }
  await mkdir(dir, { recursive: true });
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=640x360:r=24:d=30",
    "-f",
    "lavfi",
    "-i",
    "aevalsrc=if(between(t\\,10\\,10.3)+between(t\\,20\\,20.3)\\,0.3*sin(2*PI*1000*t)\\,0):s=48000:d=30",
    "-vf",
    "drawbox=x=270:y=130:w=100:h=100:color=red:t=fill:enable='lt(t,10)',drawbox=x=270:y=130:w=100:h=100:color=blue:t=fill:enable='between(t,10,20)',drawbox=x=270:y=130:w=100:h=100:color=green:t=fill:enable='gte(t,20)'",
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-pix_fmt",
    "yuv420p",
    join(dir, "synthetic-signal.mp4"),
  ]);
  const subtitles = parseSrt(await readFile(`${tos}.en.srt`, "utf8"));
  for (const c of cases) {
    if (c.id !== "tos-opening") {
      const cut = join(dir, `${c.id}.mp4`);
      await runFfmpeg([
        "-y",
        "-ss",
        String(c.from),
        "-i",
        c.source,
        "-t",
        String(c.seconds),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "22",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-ac",
        "2",
        cut,
      ]);
      await createProject({
        id: c.id,
        title: c.id,
        kind: "upload",
        sourceFile: cut,
        alreadyNormalised: true,
        filmLanguageCode: c.filmLanguage,
        attribution: c.author,
        license: c.license,
      });
    }
    const reference = {
      ...c,
      synthetic: c.id === "eval-signal",
      sha256: createHash("sha256")
        .update(await readFile(join(projectDir(c.id), "clip.mp4")))
        .digest("hex"),
      speechReference:
        c.source === tos
          ? subtitles
              .filter((s) => s.end > c.from && s.start < c.from + c.seconds)
              .map((s) => ({
                ...s,
                start: Math.max(0, s.start - c.from),
                end: Math.min(c.seconds, s.end - c.from),
              }))
          : null,
      protectedSounds:
        c.id === "eval-signal"
          ? [
              { start: 10, end: 10.3 },
              { start: 20, end: 20.3 },
            ]
          : null,
      referenceStatus:
        c.id === "eval-signal"
          ? "authored-exact"
          : c.source === tos
            ? "subtitle-windows-not-vocal-certification"
            : "independent-transcription-pending",
      fixedAt: new Date().toISOString(),
    };
    await writeFile(join(dir, `${c.id}.reference.json`), JSON.stringify(reference, null, 2));
  }
  await writeFile(join(dir, "cases.json"), JSON.stringify(cases, null, 2));
  console.log("Prepared six cases; evaluation-only projects are not publicly accessible.");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
