/**
 * Writes scene-demo-<lang>_check.md next to the film: length, picture, loudness, where each film
 * excerpt is actually heard, the pacing limits (longest frozen stretch, caption reading pace,
 * caption line length, blank caption band), what the recording captured (and whether a live run
 * could start where it was recorded), and whether the cloud page still shows the development Gemini
 * access label. Also writes the contact sheet (one frame every
 * four seconds). Unchecked boxes are limits the film does not meet; a sound out of sync, or a sound
 * track shorter than the picture, also fails the build.
 *
 * Sync is measured, not restated from the plan: each excerpt, decoded alone (mix.ts), is found in the
 * film's decoded sound by cross-correlation, first on 10 ms loudness envelopes within ±3 s of its
 * planned place, then sample by sample around the best envelope match.
 */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GEMINI_ACCESS_LABEL } from "../../src/lib/models";
import { integratedLufs } from "../../src/lib/media/mix";
import {
  decodeMonoPcm,
  probeDurationSeconds,
  probeMedia,
  runFfmpeg,
} from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { CAPTION_CHARS } from "./ass";
import type { SrtCue } from "./build";
import { CONTENT_HEIGHT, DEVICE_SCALE, FPS, MAX_SECONDS, VIEWPORT, WIDTH } from "./config";
import type { FilmSound, Placed } from "./mix";
import type { LiveAllowance } from "./record";
import type { BeatRecord, Frame } from "./recorder-kit";
import { heardExcerpt, playbackExcerpt } from "./segments";
import { MIN_CAPTION_S, READING_CPS } from "./timing";

export const MAX_FROZEN_S = 4;
const MAX_CAPTION_CHARS = 42;
/** Longest stretch with no caption up, outside film sound (where the film's own words speak). */
const MAX_BLANK_S = 6;
const CONTACT_EVERY_S = 4;
const FREEZE = "freezedetect=n=0.001:d=2";
/** Sound further than this from its picture fails (lip sync is noticed from about 45 ms early). */
export const MAX_SYNC_ERROR_S = 0.04;
/** Below this normalised correlation the excerpt is taken as not heard at all. */
const MIN_MATCH = 0.5;
const SYNC_RATE = 8000;
const HOP_S = 0.01;
const SEARCH_S = 3;
/** The sample-by-sample search spans this many envelope hops on each side of the envelope match. */
const FINE_HOPS = 2;

/** Loudness envelope: RMS of each hop. */
function envelope(x: Float32Array, hop: number): Float64Array {
  const env = new Float64Array(Math.floor(x.length / hop));
  for (let i = 0; i < env.length; i++) {
    let e = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) e += x[j] * x[j];
    env[i] = Math.sqrt(e / hop);
  }
  return env;
}

/** Pearson correlation of `ref` against `x` starting at `lag` (x is zero outside its range). */
function pearsonAt(ref: Float64Array, x: Float64Array, lag: number): number {
  const n = ref.length;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += ref[i];
    sb += x[lag + i] ?? 0;
  }
  const ma = sa / n;
  const mb = sb / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    const a = ref[i] - ma;
    const b = (x[lag + i] ?? 0) - mb;
    ab += a * b;
    aa += a * a;
    bb += b * b;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/** Normalised cross-correlation of `ref` against `x` starting at sample `lag`. */
function nccAt(ref: Float32Array, x: Float32Array, lag: number): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < ref.length; i++) {
    const b = x[lag + i] ?? 0;
    ab += ref[i] * b;
    aa += ref[i] * ref[i];
    bb += b * b;
  }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

/**
 * Where `ref` is heard in `x` (both mono at `rate`), searched within ±3 s of `planned` seconds:
 * the start in seconds and the normalised correlation there (1 is the same sound).
 */
export function locateExcerpt(
  x: Float32Array,
  ref: Float32Array,
  planned: number,
  rate: number,
): { at: number; match: number } {
  const hop = Math.round(rate * HOP_S);
  const refEnv = envelope(ref, hop);
  const xEnv = envelope(x, hop);
  const centre = Math.round(planned / HOP_S);
  const reach = Math.round(SEARCH_S / HOP_S);
  let coarse = centre;
  let best = -Infinity;
  for (let lag = centre - reach; lag <= centre + reach; lag++) {
    const r = pearsonAt(refEnv, xEnv, lag);
    if (r > best) [best, coarse] = [r, lag];
  }
  let at = coarse * hop;
  let match = -Infinity;
  for (let lag = (coarse - FINE_HOPS) * hop; lag <= (coarse + FINE_HOPS) * hop; lag++) {
    const r = nccAt(ref, x, lag);
    if (r > match) [match, at] = [r, lag];
  }
  return { at: at / rate, match };
}

export interface HeardExcerpt {
  label: string;
  planned: number;
  heard: number;
  seconds: number;
  match: number;
}

/**
 * Where each excerpt is heard in the film, and how long its sound and picture streams run. Failures
 * name every excerpt off by more than MAX_SYNC_ERROR_S or not found, and a sound track that ends
 * more than one frame before the picture.
 */
export async function measureSync(
  file: string,
  sounds: FilmSound[],
): Promise<{ heard: HeardExcerpt[]; audio: number; video: number; failures: string[] }> {
  const x = await decodeMonoPcm(file, SYNC_RATE);
  const heard: HeardExcerpt[] = [];
  for (const s of sounds) {
    const found = locateExcerpt(x, await decodeMonoPcm(s.ref, SYNC_RATE), s.at, SYNC_RATE);
    heard.push({
      label: s.label,
      planned: s.at,
      heard: found.at,
      seconds: s.seconds,
      match: found.match,
    });
  }
  // One line per video packet (stream copy: nothing is decoded); '#' lines are the header.
  const { stdout } = await runFfmpeg([
    "-i",
    file,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-f",
    "framecrc",
    "-",
  ]);
  const frames = stdout
    .toString()
    .split("\n")
    .filter((l) => l && !l.startsWith("#")).length;
  const video = frames / FPS;
  const audio = x.length / SYNC_RATE;
  const failures = [
    ...heard
      .filter((h) => h.match < MIN_MATCH || Math.abs(h.heard - h.planned) > MAX_SYNC_ERROR_S)
      .map((h) =>
        h.match < MIN_MATCH
          ? `${h.label}: not found near ${h.planned.toFixed(2)} s (best match ${h.match.toFixed(2)})`
          : `${h.label}: heard at ${h.heard.toFixed(3)} s, planned ${h.planned.toFixed(3)} s`,
      ),
    ...(audio < video - 1 / FPS
      ? [`the sound ends at ${audio.toFixed(3)} s, the picture at ${video.toFixed(3)} s`]
      : []),
  ];
  return { heard, audio, video, failures };
}

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

/** One recorded scene's line in the check note. */
function beatRow(p: Placed, frames: Frame[]): string {
  const rec = p.rec as BeatRecord;
  const r1 = (n: number) => n.toFixed(1);
  const n = frames.filter((f) => f.t >= rec.wallStart && f.t < rec.wallEnd).length;
  const wall = rec.wallEnd - rec.wallStart;
  const warps = rec.warps.map(
    (w) =>
      `${r1(w.to - w.from)} s shown in ${r1(w.seconds)} s ("${w.label}")${w.seconds > w.to - w.from ? ", slowed" : ""}`,
  );
  const late = rec.late.map((l) => `${l.what} ${l.by >= 0 ? "+" : ""}${r1(l.by)} s`);
  const spots = rec.spotChecks ?? [];
  const tightest = [...spots].sort((a, b) => a.share - b.share)[0];
  const play = playbackExcerpt(rec, p.seconds);
  const parts = [
    `${n} frames in ${r1(wall)} s (${r1(n / wall)} fps captured; still screens send none)`,
    ...(warps.length ? [`warped: ${warps.join(", ")}`] : []),
    ...(late.length ? [`off plan: ${late.join(", ")}`] : []),
    ...(tightest
      ? [
          `${spots.length} spotlights read again as they lit up, the tightest covering ${(tightest.share * 100).toFixed(0)} % of ${tightest.what}`,
        ]
      : []),
    ...(play
      ? [
          `the film laid over the player from media ${play.media.toFixed(2)} s for ${play.seconds.toFixed(2)} s at ${play.at.toFixed(2)} s of the scene, heard from media ${heardExcerpt(play).media.toFixed(2)} s`,
        ]
      : []),
    ...(rec.stalls?.length
      ? [
          `the page's own playback stalled ${rec.stalls.length} times (longest ${r1(Math.max(...rec.stalls.map((g) => g.seconds)))} s): the laid film covers the picture, not the caption strip or clock under it`,
        ]
      : []),
  ];
  return `  - ${rec.beat}: ${parts.join("; ")}`;
}

/** The longest stretch with neither a caption nor heard film sound. */
function longestBlank(
  covered: { start: number; end: number }[],
  total: number,
): { start: number; seconds: number } {
  let blank = { start: 0, seconds: 0 };
  let reach = 0;
  for (const c of [...covered].sort((a, b) => a.start - b.start)) {
    if (c.start - reach > blank.seconds) blank = { start: reach, seconds: c.start - reach };
    reach = Math.max(reach, c.end);
  }
  if (total - reach > blank.seconds) blank = { start: reach, seconds: total - reach };
  return blank;
}

/** Writes the check note; `failures` are the limits that must fail the build (sound sync). */
export async function writeCheck(input: {
  lang: Language;
  out: string;
  outDir: string;
  placed: Placed[];
  total: number;
  captions: SrtCue[];
  frames: Frame[];
  sounds: FilmSound[];
  soundNotes: string[];
  recDir: string;
}): Promise<{ note: string; failures: string[] }> {
  const { lang, out, outDir, placed, captions } = input;
  const box = (ok: boolean) => (ok ? "[x]" : "[ ]");
  const source = JSON.parse(await readFile(join(input.recDir, "source.json"), "utf8")) as {
    baseUrl: string;
    recordedAt: string;
    liveAllowance?: LiveAllowance;
  };
  const r1 = (n: number) => n.toFixed(1);
  const ms = (n: number) => `${n >= 0 ? "+" : ""}${Math.round(n * 1000)} ms`;
  const duration = await probeDurationSeconds(out);
  const media = await probeMedia(out);
  const lufs = await integratedLufs(out);
  const size = (await stat(out)).size;
  const frozen = await frozenStretches(out);
  const sync = await measureSync(out, input.sounds);
  const longest = frozen[0]?.seconds ?? 0;
  const lineLimit = Math.min(MAX_CAPTION_CHARS, CAPTION_CHARS[lang]);
  const widest =
    captions.flatMap((c) => c.text.split("\n")).sort((a, b) => b.length - a.length)[0] ?? "";
  const pace = (c: SrtCue) => c.text.replace("\n", " ").length / (c.end - c.start);
  const fastest = [...captions].sort((a, b) => pace(b) - pace(a))[0];
  const briefest = [...captions].sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  // Film sound (the hook and its reveal, the played line) is meant to be heard without captions:
  // where it is measured to be heard, not where it was planned.
  const heardSpans = sync.heard.map((h) => ({ start: h.heard, end: h.heard + h.seconds }));
  const blank = longestBlank([...captions, ...heardSpans], input.total);
  const inSync = sync.heard.every(
    (h) => Math.abs(h.heard - h.planned) <= MAX_SYNC_ERROR_S && h.match >= MIN_MATCH,
  );
  const lastsFilm = sync.audio >= sync.video - 1 / FPS;
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

  const lines = [
    `# scene-demo-${lang}.mp4 — check (${new Date().toLocaleDateString("en-CA")})`,
    "",
    `Built by \`npm run demo -- ${lang} build\` (scripts/demo/build.ts). App scenes recorded from ${source.baseUrl} at ${source.recordedAt}.`,
    "",
    `- ${box(duration < MAX_SECONDS)} length: ${r1(duration)} s (strictly below ${MAX_SECONDS} s; planned ${r1(input.total)} s)`,
    `- ${box(media.width === 1920 && media.height === 1080)} picture: ${media.width}×${media.height} H.264, ${r1(size / 1e6)} MB`,
    `- ${box(Math.abs(lufs - -16) <= 1.5)} loudness: ${lufs} LUFS integrated (target -16)`,
    `- ${box(inSync)} sound in sync: every film excerpt found in the film's sound within ${MAX_SYNC_ERROR_S * 1000} ms of its place (measured by cross-correlation)`,
    ...sync.heard.map(
      (h) =>
        `  - ${h.label}: planned ${h.planned.toFixed(3)} s, heard ${h.heard.toFixed(3)} s (${ms(h.heard - h.planned)}, match ${h.match.toFixed(3)})`,
    ),
    `- ${box(lastsFilm)} sound runs the whole film: sound ${sync.audio.toFixed(3)} s, picture ${sync.video.toFixed(3)} s`,
    `- Framing: app close-ups and explanation pages intentionally hold still, with cuts between app shots. The low-motion detections below include these reading holds; check the named intervals visually before treating them as stalled playback.`,
    `- ${box(longest <= MAX_FROZEN_S)} longest frozen stretch in the picture area: ${r1(longest)} s (limit ${MAX_FROZEN_S} s; ${frozen.length} stretches of 2 s or more)`,
    ...frozen
      .slice(0, 5)
      .map((f) => `  - ${r1(f.start)}–${r1(f.start + f.seconds)} s (${r1(f.seconds)} s)`),
    `- ${box(pace(fastest) <= READING_CPS[lang] + 0.05)} caption reading pace: ${captions.length} captions, fastest ${pace(fastest).toFixed(1)} characters/s (limit ${READING_CPS[lang]}): "${fastest.text.replace("\n", " ")}"`,
    `- ${box(briefest.end - briefest.start >= MIN_CAPTION_S - 0.01)} shortest caption on screen: ${r1(briefest.end - briefest.start)} s (at least ${MIN_CAPTION_S} s)`,
    `- ${box(widest.length <= lineLimit)} captions: longest line ${widest.length} characters (limit ${lineLimit}): "${widest}"`,
    `- ${box(blank.seconds <= MAX_BLANK_S)} longest stretch with no caption and no film sound heard: ${r1(blank.seconds)} s from ${r1(blank.start)} s (limit ${MAX_BLANK_S} s)`,
    `- [x] no presenter voice: the sound is the film's own, and captions tell the story`,
    `- ${box(source.liveAllowance?.canStart === true)} recorded where a live run could start, so the app shows no spent-allowance notice: ${source.liveAllowance ? `/api/live-status said canStart ${source.liveAllowance.canStart}${source.liveAllowance.reason ? ` (${source.liveAllowance.reason})` : ""}` : "not recorded (a recording from before the check)"}`,
    // Same open item as the deck's (scripts/deck/build-deck.ts): the cloud page prints this label.
    `- ${box(!/openrouter/i.test(GEMINI_ACCESS_LABEL))} Gemini access on the cloud page: "${GEMINI_ACCESS_LABEL}"${/openrouter/i.test(GEMINI_ACCESS_LABEL) ? " — the development label; switch to the Gemini API (Google AI Studio), change GEMINI_ACCESS_LABEL and build again before submission" : ""}`,
    `- [x] recording (${VIEWPORT.width * DEVICE_SCALE}×${VIEWPORT.height * DEVICE_SCALE} frames):`,
    ...placed.filter((p) => p.rec).map((p) => beatRow(p, input.frames)),
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
  return { note, failures: sync.failures };
}
