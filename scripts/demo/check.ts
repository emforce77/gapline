/**
 * Writes scene-demo-<lang>_check.md next to the film: length, picture, loudness, the pacing limits
 * (longest frozen stretch, caption reading pace, caption line length, blank caption band), what the
 * recording captured, and whether the cloud page still shows the development Gemini access label.
 * Also writes the contact sheet (one frame every four seconds). Unchecked boxes are limits the film
 * does not meet.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GEMINI_ACCESS_LABEL } from "../../src/lib/models";
import { integratedLufs } from "../../src/lib/media/mix";
import { probeDurationSeconds, probeMedia, runFfmpeg } from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { CAPTION_CHARS } from "./ass";
import type { SrtCue } from "./build";
import { CONTENT_HEIGHT, MAX_SECONDS, WIDTH } from "./config";
import type { Placed } from "./mix";
import type { Frame } from "./recorder-kit";
import { MIN_CAPTION_S, READING_CPS } from "./timing";

export const MAX_FROZEN_S = 4;
const MAX_CAPTION_CHARS = 42;
/** Longest stretch with no caption up, outside film sound (where the film's own words speak). */
const MAX_BLANK_S = 6;
const CONTACT_EVERY_S = 4;
const FREEZE = "freezedetect=n=0.001:d=2";

/** Frozen stretches in the picture area (the caption band is left out), longest first. */
async function frozenStretches(file: string): Promise<{ start: number; seconds: number }[]> {
  const { stderr } = await runFfmpeg([
    "-i",
    file,
    "-vf",
    `crop=${WIDTH}:${CONTENT_HEIGHT}:0:0,${FREEZE}`,
    "-an",
    "-f",
    "null",
    "-",
  ]);
  const starts = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const lengths = [...stderr.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  const duration = await probeDurationSeconds(file);
  // A freeze still running at the end has a start but no duration line.
  if (starts.length > lengths.length) lengths.push(duration - starts[starts.length - 1]);
  return starts
    .map((start, i) => ({ start, seconds: lengths[i] }))
    .sort((a, b) => b.seconds - a.seconds);
}

export async function writeCheck(input: {
  lang: Language;
  out: string;
  outDir: string;
  placed: Placed[];
  total: number;
  captions: SrtCue[];
  frames: Frame[];
  soundNotes: string[];
  recDir: string;
}): Promise<string> {
  const { lang, out, outDir, placed, captions } = input;
  const box = (ok: boolean) => (ok ? "[x]" : "[ ]");
  const source = JSON.parse(await readFile(join(input.recDir, "source.json"), "utf8")) as {
    baseUrl: string;
    recordedAt: string;
  };
  const r1 = (n: number) => n.toFixed(1);
  const duration = await probeDurationSeconds(out);
  const media = await probeMedia(out);
  const lufs = await integratedLufs(out);
  const size = (await stat(out)).size;
  const frozen = await frozenStretches(out);
  const longest = frozen[0]?.seconds ?? 0;
  const lineLimit = Math.min(MAX_CAPTION_CHARS, CAPTION_CHARS[lang]);
  const widest =
    captions.flatMap((c) => c.text.split("\n")).sort((a, b) => b.length - a.length)[0] ?? "";
  const pace = (c: SrtCue) => c.text.replace("\n", " ").length / (c.end - c.start);
  const fastest = [...captions].sort((a, b) => pace(b) - pace(a))[0];
  const briefest = [...captions].sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  // Film sound (the hook and its reveal, the played line) is meant to be heard without captions.
  const heard = placed.flatMap((p) => [
    ...p.plan.parts
      .filter((x) => "film" in x.part)
      .map((x) => ({ start: p.start + x.start, end: p.start + x.start + x.seconds })),
    ...("film" in p.scene.show ? [{ start: p.start, end: p.start + p.seconds }] : []),
  ]);
  const covered = [...captions, ...heard].sort((a, b) => a.start - b.start);
  let blank = { start: 0, seconds: 0 };
  let reach = 0;
  for (const c of covered) {
    if (c.start - reach > blank.seconds) blank = { start: reach, seconds: c.start - reach };
    reach = Math.max(reach, c.end);
  }
  if (input.total - reach > blank.seconds) blank = { start: reach, seconds: input.total - reach };
  const contact = join(outDir, `scene-demo-${lang}_contact.jpg`);
  const cols = 6;
  const rows = Math.ceil(duration / CONTACT_EVERY_S / cols);
  await runFfmpeg([
    "-y",
    "-i",
    out,
    "-vf",
    `fps=1/${CONTACT_EVERY_S},scale=480:-1,tile=${cols}x${rows}`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    contact,
  ]);

  const beatRows = placed
    .filter((p) => p.rec)
    .map((p) => {
      const rec = p.rec!;
      const n = input.frames.filter((f) => f.t >= rec.wallStart && f.t < rec.wallEnd).length;
      const wall = rec.wallEnd - rec.wallStart;
      const warps = rec.warps.map(
        (w) => `${r1(w.to - w.from)} s shown in ${r1(w.seconds)} s ("${w.label}")`,
      );
      const late = rec.late.map((l) => `${l.what} +${r1(l.by)} s`);
      return `  - ${rec.beat}: ${n} frames in ${r1(wall)} s (${r1(n / wall)} fps captured; still screens send none)${warps.length ? `; squeezed: ${warps.join(", ")}` : ""}${late.length ? `; late: ${late.join(", ")}` : ""}`;
    });
  const lines = [
    `# scene-demo-${lang}.mp4 — check (${new Date().toLocaleDateString("en-CA")})`,
    "",
    `Built by \`npm run demo -- ${lang} build\` (scripts/demo/build.ts). App scenes recorded from ${source.baseUrl} at ${source.recordedAt}.`,
    "",
    `- ${box(duration < MAX_SECONDS)} length: ${r1(duration)} s (strictly below ${MAX_SECONDS} s; planned ${r1(input.total)} s)`,
    `- ${box(media.width === 1920 && media.height === 1080)} picture: ${media.width}×${media.height} H.264, ${r1(size / 1e6)} MB`,
    `- ${box(Math.abs(lufs - -16) <= 1.5)} loudness: ${lufs} LUFS integrated (target -16)`,
    `- ${box(longest <= MAX_FROZEN_S)} longest frozen stretch in the picture area: ${r1(longest)} s (limit ${MAX_FROZEN_S} s; ${frozen.length} stretches of 2 s or more)`,
    ...frozen
      .slice(0, 5)
      .map((f) => `  - ${r1(f.start)}–${r1(f.start + f.seconds)} s (${r1(f.seconds)} s)`),
    `- ${box(pace(fastest) <= READING_CPS[lang] + 0.05)} caption reading pace: ${captions.length} captions, fastest ${pace(fastest).toFixed(1)} characters/s (limit ${READING_CPS[lang]}): "${fastest.text.replace("\n", " ")}"`,
    `- ${box(briefest.end - briefest.start >= MIN_CAPTION_S - 0.01)} shortest caption on screen: ${r1(briefest.end - briefest.start)} s (at least ${MIN_CAPTION_S} s)`,
    `- ${box(widest.length <= lineLimit)} captions: longest line ${widest.length} characters (limit ${lineLimit}): "${widest}"`,
    `- ${box(blank.seconds <= MAX_BLANK_S)} longest stretch with no caption and no film sound: ${r1(blank.seconds)} s from ${r1(blank.start)} s (limit ${MAX_BLANK_S} s)`,
    `- [x] no presenter voice: the sound is the film's own, and captions tell the story`,
    // Same open item as the deck's (scripts/deck/build-deck.ts): the cloud page prints this label.
    `- ${box(!/openrouter/i.test(GEMINI_ACCESS_LABEL))} Gemini access on the cloud page: "${GEMINI_ACCESS_LABEL}"${/openrouter/i.test(GEMINI_ACCESS_LABEL) ? " — the development label; switch to the Gemini API (Google AI Studio), change GEMINI_ACCESS_LABEL and build again before submission" : ""}`,
    `- [x] recording (2880×1440 frames):`,
    ...beatRows,
    `- [x] sound:`,
    ...input.soundNotes.map((n) => `  - ${n}`),
    `- [ ] a person has watched and listened to the whole film`,
    "",
    "| scene | start (s) | length (s) | shows |",
    "| --- | ---: | ---: | --- |",
    ...placed.map((p) => {
      const show = p.scene.show;
      const what =
        "page" in show
          ? `motion: ${show.page}`
          : "film" in show
            ? "described film"
            : `app: ${show.beat}`;
      return `| ${p.scene.id} | ${r1(p.start)} | ${r1(p.seconds)} | ${what} |`;
    }),
    "",
    `Contact sheet: ${contact.split("/").pop()} (one frame every ${CONTACT_EVERY_S} s).`,
    "",
  ];
  const note = join(outDir, `scene-demo-${lang}_check.md`);
  await writeFile(note, lines.join("\n"));
  return note;
}
