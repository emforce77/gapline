/**
 * Assembles the demo video from the cards, the app recording, the presenter's voice and the film.
 *
 * Picture: one H.264 segment per scene (1920×960 content over a 120 px caption bar, captions burned
 * in with libass and Pretendard), joined without re-encoding. App scenes use the recorded frames at
 * the times Chrome captured them; nothing is sped up, frozen or cut.
 * Sound: presenter sentences at their planned times, the bare film under the cold open, and the
 * described film exactly where the recording shows it playing. Each source is brought to -16 LUFS.
 *
 * Output: runtime/demo/<lang>/scene-demo-<lang>.mp4 and scene-demo-<lang>_check.md
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integratedLufs } from "../../src/lib/media/mix";
import { probeDurationSeconds, runFfmpeg } from "../../src/lib/media/ffmpeg";
import { readCallRecords } from "../../src/lib/llm/ledger";
import type { Language } from "../../src/lib/pipeline/schemas";
import type { DemoData } from "./demo-data";
import type { Frame, Mark, MediaEvent } from "./record";
import type { CardId, Scene } from "./storyboard";
import { planScene, type VoicedSentence } from "./voice";

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const CONTENT_HEIGHT = 960;
const TARGET_LUFS = -16;
const MAX_SECONDS = 180;
const CAPTION_TAIL_SECONDS = 0.25;
const FONTS_DIR = join(process.cwd(), "node_modules/pretendard/dist/public/static");

interface Placed {
  scene: Scene;
  start: number;
  seconds: number;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const toFrames = (seconds: number) => Math.round(seconds * FPS) / FPS;

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

function sceneAss(
  captions: { start: number; end: number; style: "Say" | "Film"; text: string }[],
): string {
  const lines = captions.map(
    (c) =>
      `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},${c.style},,0,0,0,,${c.text.replace(/[{}\\]/g, "")}`,
  );
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Say,Pretendard,38,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,150,150,24,1",
    "Style: Film,Pretendard,34,&H0098908A,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,150,150,40,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines,
    "",
  ].join("\n");
}

/** The recorded frames that were on screen during [start, end), as ffconcat entries. */
function beatConcat(frames: Frame[], mark: Mark): string {
  let first = frames.findLastIndex((f) => f.t <= mark.start);
  if (first < 0) first = 0;
  const entries: string[] = ["ffconcat version 1.0"];
  for (let i = first; i < frames.length && frames[i].t < mark.end; i++) {
    const from = Math.max(frames[i].t, mark.start);
    const to = Math.min(frames[i + 1]?.t ?? mark.end, mark.end);
    if (to <= from) continue;
    entries.push(`file '${frames[i].file}'`, `duration ${(to - from).toFixed(4)}`);
  }
  entries.push(entries[entries.length - 2]);
  return entries.join("\n") + "\n";
}

async function extractLufs(
  source: string,
  from: number,
  seconds: number,
  out: string,
): Promise<number> {
  await runFfmpeg([
    "-y",
    "-ss",
    String(from),
    "-t",
    String(seconds),
    "-i",
    source,
    "-vn",
    "-ac",
    "2",
    "-ar",
    "48000",
    out,
  ]);
  return integratedLufs(out);
}

export async function buildDemo(input: {
  lang: Language;
  data: DemoData;
  scenes: Scene[];
  voiced: VoicedSentence[];
  cards: Record<CardId | "black", string>;
  recDir: string;
  outDir: string;
}): Promise<string> {
  const { lang, data, scenes, voiced, cards, recDir, outDir } = input;
  const workDir = join(outDir, "build");
  await mkdir(workDir, { recursive: true });
  const frames = JSON.parse(await readFile(join(recDir, "frames.json"), "utf8")) as Frame[];
  const marks = JSON.parse(await readFile(join(recDir, "marks.json"), "utf8")) as Mark[];
  const media = JSON.parse(await readFile(join(recDir, "media.json"), "utf8")) as MediaEvent[];

  // Where each scene sits on the final timeline.
  const placed: Placed[] = [];
  let cursor = 0;
  for (const scene of scenes) {
    const plan = planScene(scene, voiced);
    const mark =
      "beat" in scene.show
        ? marks.find((m) => m.beat === (scene.show as { beat: string }).beat)
        : null;
    if ("beat" in scene.show && !mark) throw new Error(`No recording for beat ${scene.show.beat}`);
    const seconds = toFrames(mark ? mark.end - mark.start : plan.minSeconds);
    placed.push({ scene, start: cursor, seconds });
    cursor += seconds;
  }
  const total = cursor;

  // Picture: one segment per scene.
  const segments: string[] = [];
  const beatStats: string[] = [];
  for (const [i, p] of placed.entries()) {
    const plan = planScene(p.scene, voiced);
    const captions = plan.speech.map((s, k) => ({
      start: s.start,
      end: Math.min(
        s.start + s.seconds + CAPTION_TAIL_SECONDS,
        plan.speech[k + 1]?.start ?? p.seconds,
      ),
      style: "Say" as "Say" | "Film",
      text: s.text,
    }));
    if (plan.film && p.scene.film) {
      captions.push({
        start: plan.film.start,
        end: plan.film.start + plan.film.seconds,
        style: "Film",
        text: p.scene.film.caption,
      });
    }
    const assFile = join(workDir, `${p.scene.id}.ass`);
    await writeFile(assFile, sceneAss(captions));
    const listFile = join(workDir, `${p.scene.id}.ffconcat`);
    const show = p.scene.show;
    if ("beat" in show) {
      const mark = marks.find((m) => m.beat === show.beat)!;
      const inBeat = frames.filter((f) => f.t >= mark.start && f.t < mark.end).length;
      beatStats.push(
        `${show.beat}: ${inBeat} frames in ${round(mark.end - mark.start, 1)} s (${round(inBeat / (mark.end - mark.start), 1)} fps captured)`,
      );
      await writeFile(listFile, beatConcat(frames, mark));
    } else {
      const image = "card" in show ? cards[show.card] : cards.black;
      await writeFile(
        listFile,
        `ffconcat version 1.0\nfile '${image}'\nduration ${p.seconds}\nfile '${image}'\n`,
      );
    }
    const bar = "black" in show ? "black" : "0x0c0d0f";
    const segment = join(workDir, `seg-${String(i).padStart(2, "0")}.mp4`);
    await runFfmpeg([
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-vf",
      `scale=${WIDTH}:${CONTENT_HEIGHT}:flags=lanczos,fps=${FPS},pad=${WIDTH}:${HEIGHT}:0:0:color=${bar},` +
        `subtitles=filename='${assFile}':fontsdir='${FONTS_DIR}',format=yuv420p`,
      "-t",
      String(p.seconds),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "17",
      "-profile:v",
      "high",
      "-g",
      String(FPS * 2),
      "-an",
      segment,
    ]);
    segments.push(segment);
  }
  const segList = join(workDir, "segments.ffconcat");
  await writeFile(
    segList,
    `ffconcat version 1.0\n${segments.map((s) => `file '${s}'`).join("\n")}\n`,
  );

  // Sound: presenter and film, each brought to the same loudness.
  const presenterList = join(workDir, "presenter.ffconcat");
  await writeFile(
    presenterList,
    `ffconcat version 1.0\n${voiced.map((v) => `file '${v.file}'`).join("\n")}\n`,
  );
  const presenterAll = join(workDir, "presenter-all.wav");
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", presenterList, presenterAll]);
  const presenterGain = TARGET_LUFS - (await integratedLufs(presenterAll));

  const inputs: string[] = [];
  const chains: string[] = [];
  const addSound = (
    file: string,
    at: number,
    gainDb: number,
    trim?: { from: number; seconds: number },
  ) => {
    const k = inputs.length / 2;
    inputs.push("-i", file);
    const cut = trim
      ? `atrim=start=${trim.from}:duration=${trim.seconds},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, trim.seconds - 0.4)}:d=0.4,`
      : "";
    chains.push(
      `[${k}:a]${cut}aresample=48000,aformat=channel_layouts=stereo,volume=${gainDb.toFixed(2)}dB,adelay=${Math.round(at * 1000)}:all=1[a${k}]`,
    );
  };
  const filmNotes: string[] = [];
  for (const p of placed) {
    const plan = planScene(p.scene, voiced);
    for (const s of plan.speech) addSound(s.file, p.start + s.start, presenterGain);
    if (!plan.film || !p.scene.film) continue;
    const film = p.scene.film;
    if ("black" in p.scene.show) {
      const source = film.track === "original" ? data.clipFile : data.standard.describedFile;
      const lufs = await extractLufs(
        source,
        film.from,
        plan.film.seconds,
        join(workDir, `${p.scene.id}-film.wav`),
      );
      addSound(source, p.start + plan.film.start, TARGET_LUFS - lufs, {
        from: film.from,
        seconds: plan.film.seconds,
      });
      filmNotes.push(
        `${p.scene.id}: ${film.track} ${film.from}–${film.to} s at ${round(p.start + plan.film.start)} s (source ${lufs} LUFS)`,
      );
    } else {
      const mark = marks.find((m) => m.beat === (p.scene.show as { beat: string }).beat)!;
      const playing = media.find(
        (e) => e.type === "playing" && e.wall >= mark.start && e.wall < mark.end,
      );
      if (!playing) throw new Error(`The recording never shows the film playing in ${p.scene.id}`);
      const paused = media.find((e) => e.type === "pause" && e.wall > playing.wall);
      const seconds = Math.min(paused?.wall ?? mark.end, mark.end) - playing.wall;
      const source = film.track === "described" ? data.standard.describedFile : data.clipFile;
      const lufs = await extractLufs(
        source,
        playing.media,
        seconds,
        join(workDir, `${p.scene.id}-film.wav`),
      );
      addSound(source, p.start + (playing.wall - mark.start), TARGET_LUFS - lufs, {
        from: playing.media,
        seconds,
      });
      filmNotes.push(
        `${p.scene.id}: ${film.track} from ${round(playing.media)} s for ${round(seconds)} s at ${round(p.start + playing.wall - mark.start)} s, as the recording plays it (source ${lufs} LUFS)`,
      );
    }
  }
  const mixed = chains.map((_, k) => `[a${k}]`).join("");
  const graph = `${chains.join(";\n")};\n${mixed}amix=inputs=${chains.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total},alimiter=limit=0.89:level=false[out]`;
  const graphFile = join(workDir, "audio.filter");
  await writeFile(graphFile, graph);
  const audio = join(workDir, "audio.wav");
  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex_script",
    graphFile,
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    audio,
  ]);

  const out = join(outDir, `scene-demo-${lang}.mp4`);
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    segList,
    "-i",
    audio,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-t",
    String(total),
    "-movflags",
    "+faststart",
    out,
  ]);

  // Check note next to the video.
  const duration = await probeDurationSeconds(out);
  const loudness = await integratedLufs(out);
  const size = (await stat(out)).size;
  const tts = await readCallRecords(join(outDir, "voice", "ledger.jsonl"));
  const ttsChars = tts.filter((r) => r.ok).reduce((n, r) => n + (r.characters ?? 0), 0);
  const ttsCost = tts.reduce((n, r) => n + r.costUsd, 0);
  const run = data.standard;
  const check = [
    `# scene-demo-${lang}.mp4 — check (${new Date().toISOString().slice(0, 10)})`,
    "",
    `- [${duration <= MAX_SECONDS ? "x" : " "}] length: ${round(duration, 1)} s (limit ${MAX_SECONDS} s, planned ${round(total, 1)} s)`,
    `- [x] picture: ${WIDTH}×${HEIGHT} H.264 ${FPS} fps, ${round(size / 1e6, 1)} MB`,
    `- [${Math.abs(loudness - TARGET_LUFS) <= 1.5 ? "x" : " "}] loudness: ${loudness} LUFS integrated (target ${TARGET_LUFS})`,
    `- [x] presenter: ${voiced.length} sentences, ${ttsChars} characters synthesized this build set, $${ttsCost.toFixed(4)} (Chirp 3 HD ${voiced[0]?.voice})`,
    `- [x] runs shown: ${run.runId} (standard), ${data.brief.runId} (brief), from ${"the deployed service"}`,
    `- [x] numbers said: ${run.summary.cuesShipped} lines, ${run.summary.cuesFitting} fit, ${run.summary.overlapWithSpeechSeconds} s overlap, $${run.summary.costUsd.toFixed(4)}, ${run.summary.wallSeconds} s`,
    ...beatStats.map((b) => `- [x] recording ${b}`),
    ...filmNotes.map((f) => `- [x] film sound ${f}`),
    "",
    "| scene | start (s) | length (s) | shows |",
    "| --- | ---: | ---: | --- |",
    ...placed.map((p) => {
      const show = p.scene.show;
      const what =
        "card" in show ? `card ${show.card}` : "beat" in show ? `app ${show.beat}` : "black";
      return `| ${p.scene.id} | ${round(p.start, 1)} | ${round(p.seconds, 1)} | ${what} |`;
    }),
    "",
  ].join("\n");
  await writeFile(join(outDir, `scene-demo-${lang}_check.md`), check);
  return out;
}
