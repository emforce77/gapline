/**
 * Writes scene-demo-<lang>_check.md next to the film: length, picture, loudness, the pacing limits
 * (longest frozen stretch, presenter words per minute, caption line length), what the recording
 * captured, the presenter's text-to-speech spend, and whether the cloud page still shows the
 * development Gemini access label. Also writes the contact sheet (one frame every four seconds).
 * Unchecked boxes are limits the film does not meet.
 */
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords } from "../../src/lib/llm/ledger";
import { GEMINI_ACCESS_LABEL } from "../../src/lib/models";
import { integratedLufs } from "../../src/lib/media/mix";
import { probeDurationSeconds, probeMedia, runFfmpeg } from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { CAPTION_CHARS } from "./ass";
import { CONTENT_HEIGHT, MAX_SECONDS, OUT, WIDTH } from "./config";
import type { Placed } from "./mix";
import type { Frame } from "./recorder-kit";
import { MAX_WPM, type VoicedSentence } from "./voice";

export const MAX_FROZEN_S = 4;
const MAX_CAPTION_CHARS = 42;
const TTS_BUDGET_USD = 0.5;
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

async function ttsSpend(): Promise<{ lang: string; usd: number; chars: number }[]> {
  const rows = [];
  for (const lang of ["en", "ko"]) {
    const ledger = join(OUT, lang, "voice", "ledger.jsonl");
    if (!existsSync(ledger)) continue;
    const calls = await readCallRecords(ledger);
    rows.push({
      lang,
      usd: calls.reduce((n, c) => n + c.costUsd, 0),
      chars: calls.filter((c) => c.ok).reduce((n, c) => n + (c.characters ?? 0), 0),
    });
  }
  return rows;
}

export async function writeCheck(input: {
  lang: Language;
  out: string;
  outDir: string;
  placed: Placed[];
  total: number;
  voiced: VoicedSentence[];
  captionLines: string[];
  frames: Frame[];
  soundNotes: string[];
  recDir: string;
}): Promise<string> {
  const { lang, out, outDir, placed, voiced } = input;
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
  const estimated = voiced.some((v) => v.file === null);
  const fastest = [...voiced].sort((a, b) => b.wpm - a.wpm)[0];
  const lineLimit = Math.min(MAX_CAPTION_CHARS, CAPTION_CHARS[lang]);
  const widest = [...input.captionLines].sort((a, b) => b.length - a.length)[0] ?? "";
  const spend = await ttsSpend();
  const spent = spend.reduce((n, s) => n + s.usd, 0);
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
    `- ${box(!estimated && fastest.wpm <= MAX_WPM)} presenter pace: fastest sentence ${fastest.wpm.toFixed(0)} words/min (limit ${MAX_WPM}): "${fastest.text}"${estimated ? " — ESTIMATED, not voiced" : ""}`,
    `- ${box(widest.length <= lineLimit)} captions: longest line ${widest.length} characters (limit ${lineLimit}): "${widest}"`,
    estimated
      ? `- [ ] **presenter NOT VOICED**: sentence lengths are estimates (npm run demo -- ${lang} voice --estimate); the film has no presenter sound. Synthesize with \`npm run demo -- ${lang} voice\`, then record and build again.`
      : `- [x] presenter: ${voiced.length} sentences, voice ${[...new Set(voiced.map((v) => v.voice))].join(", ")}`,
    // Same open item as the deck's (scripts/deck/build-deck.ts): the cloud page prints this label.
    `- ${box(!/openrouter/i.test(GEMINI_ACCESS_LABEL))} Gemini access on the cloud page: "${GEMINI_ACCESS_LABEL}"${/openrouter/i.test(GEMINI_ACCESS_LABEL) ? " — the development label; switch to the Gemini API (Google AI Studio), change GEMINI_ACCESS_LABEL and build again before submission" : ""}`,
    `- ${box(spent <= TTS_BUDGET_USD)} presenter text-to-speech spend so far: $${spent.toFixed(4)} of $${TTS_BUDGET_USD.toFixed(2)} (${spend.map((s) => `${s.lang} ${s.chars} characters $${s.usd.toFixed(4)}`).join(", ") || "no calls"})`,
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
