/**
 * Assembles the film: places every scene on the timeline (app scenes take the length they were
 * recorded at), renders one segment per scene, joins them without re-encoding, mixes the sound and
 * writes the check note, the contact sheet and an SRT of the presenter's captions.
 *
 * Output: runtime/demo-v3/<lang>/scene-demo-<lang>.mp4, _check.md, _contact.jpg, .srt
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { sayEvent, sentenceCaptions, type AssEvent } from "./ass";
import { writeCheck } from "./check";
import { CHROME_PATH, FPS, MAX_SECONDS } from "./config";
import { mixSound, type Placed } from "./mix";
import { preparePageAssets } from "./pages/shell";
import type { BeatRecord, Frame } from "./recorder-kit";
import { renderSegment } from "./segments";
import type { Scene } from "./storyboard";
import { measureSpeech, planScene, type VoicedSentence } from "./voice";

/** Segments rendered at once: each is one Chrome page or one FFmpeg encode. */
const CONCURRENCY = 3;
const CAPTION_TAIL_S = 0.25;
/** A sentence's caption appears this long before its first word is heard. */
const CAPTION_LEAD_S = 0.1;
const toFrames = (s: number) => Math.round(s * FPS) / FPS;

function srtTime(v: number): string {
  const ms = Math.round(v * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

export interface SrtCue {
  start: number;
  end: number;
  text: string;
}

/**
 * The presenter's captions for each placed scene, timed from where each sentence's words are heard
 * in its file (an estimated sentence has no file and fills its slot), and the same cues in film time
 * for the SRT.
 */
export async function presenterCaptions(
  placed: Placed[],
  lang: Language,
): Promise<{ events: AssEvent[][]; srt: SrtCue[]; lines: string[] }> {
  const events: AssEvent[][] = [];
  const srt: SrtCue[] = [];
  const lines: string[] = [];
  for (const p of placed) {
    const says = p.plan.parts.flatMap((x) =>
      x.sentence && "say" in x.part
        ? [{ start: x.start, sentence: x.sentence, groups: x.part.captions?.[lang] }]
        : [],
    );
    const spans: { from: number; to: number }[] = [];
    for (const s of says) {
      const { onset, offset } = s.sentence.file
        ? await measureSpeech(s.sentence.file)
        : { onset: 0, offset: s.sentence.seconds };
      spans.push({ from: s.start + onset, to: s.start + offset });
    }
    const shows = says.map((s, k) => Math.max(s.start, spans[k].from - CAPTION_LEAD_S));
    events.push(
      says.flatMap((s, k) => {
        const timing = {
          show: shows[k],
          hide: Math.min(spans[k].to + CAPTION_TAIL_S, shows[k + 1] ?? p.seconds),
          speechFrom: spans[k].from,
          speechTo: spans[k].to,
        };
        return sentenceCaptions(s.sentence.text, lang, timing, s.groups).map((c) => {
          lines.push(...c.lines);
          srt.push({ start: p.start + c.start, end: p.start + c.end, text: c.lines.join("\n") });
          return sayEvent(c);
        });
      }),
    );
  }
  return { events, srt, lines };
}

export async function buildFilm(input: {
  lang: Language;
  scenes: Scene[];
  voiced: VoicedSentence[];
  recDir: string;
  outDir: string;
}): Promise<string> {
  const { lang, scenes, voiced, recDir, outDir } = input;
  const workDir = join(outDir, "build");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  const beats: BeatRecord[] = JSON.parse(await readFile(join(recDir, "beats.json"), "utf8"));
  const frames: Frame[] = JSON.parse(await readFile(join(recDir, "frames.json"), "utf8"));

  let cursor = 0;
  const placed: Placed[] = scenes.map((scene) => {
    const plan = planScene(scene, voiced);
    const rec =
      "beat" in scene.show
        ? beats.find((b) => b.beat === (scene.show as { beat: string }).beat)
        : undefined;
    if ("beat" in scene.show && !rec)
      throw new Error(`no recording for ${scene.id}; run the record step`);
    const seconds = toFrames(rec ? rec.seconds : plan.seconds);
    const p = { scene, plan, start: cursor, seconds, rec };
    cursor += seconds;
    return p;
  });
  const total = toFrames(cursor);
  if (total >= MAX_SECONDS)
    throw new Error(`film would run ${total.toFixed(2)} s; the limit is under ${MAX_SECONDS}`);

  const captions = await presenterCaptions(placed, lang);

  await preparePageAssets();
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  const segments = placed.map((_, i) => join(workDir, `seg-${String(i).padStart(2, "0")}.mp4`));
  try {
    const queue = placed.map((p, i) => ({ p, i }));
    const work = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const started = Date.now();
        await renderSegment({
          scene: job.p.scene,
          plan: job.p.plan,
          seconds: job.p.seconds,
          captions: captions.events[job.i],
          workDir,
          out: segments[job.i],
          browser,
          rec: job.p.rec,
          frames,
          lang,
        });
        console.log(
          `segment ${job.p.scene.id}: ${job.p.seconds.toFixed(1)} s in ${((Date.now() - started) / 1000).toFixed(0)} s`,
        );
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
  } finally {
    await browser.close();
  }

  const list = join(workDir, "segments.ffconcat");
  await writeFile(list, `ffconcat version 1.0\n${segments.map((s) => `file '${s}'`).join("\n")}\n`);
  const sound = await mixSound(placed, total, workDir);
  const out = join(outDir, `scene-demo-${lang}.mp4`);
  await runFfmpeg([
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    list,
    "-i",
    sound.audio,
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
    total.toFixed(3),
    "-movflags",
    "+faststart",
    out,
  ]);
  await writeFile(
    join(outDir, `scene-demo-${lang}.${lang}.srt`),
    captions.srt
      .sort((a, b) => a.start - b.start)
      .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
      .join("\n"),
  );
  const note = await writeCheck({
    lang,
    out,
    outDir,
    placed,
    total,
    voiced,
    captionLines: captions.lines,
    frames,
    soundNotes: sound.notes,
    recDir,
  });
  console.log(`check: ${note}`);
  return out;
}
