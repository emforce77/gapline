/**
 * One H.264 segment per scene, all encoded alike so they join without re-encoding:
 *   page   — a motion page rendered frame by frame (motion.ts);
 *   film   — the described film itself, centred in the picture area, with Scene's lines in the band;
 *   beat   — the app recording, retimed through its warps, with the camera and overlays. Where the
 *            recording plays the film, the film itself is laid over the player's picture.
 * The caption band under the picture carries the film's captions in every scene.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { COLOR } from "../deck/theme";
import {
  assDocument,
  chipEvent,
  dialogueEvent,
  spotlightEvents,
  subEvent,
  tagEvent,
  type AssEvent,
} from "./ass";
import {
  cameraAt,
  cameraFilters,
  cameraKeys,
  movesDuring,
  pieces,
  settledAt,
  toPicture,
} from "./camera";
import { CONTENT_HEIGHT, DEVICE_SCALE, FPS, HEIGHT, runFile, SAMPLE_RUN, WIDTH } from "./config";
import { encodeArgs, subtitlesFilter } from "./encode";
import { film } from "./facts";
import { labels } from "./labels";
import { masterCut } from "./master";
import { renderMotion } from "./motion";
import { PAGES } from "./pages/index";
import { toOutput, type BeatRecord, type Frame } from "./recorder-kit";
import { LISTEN, type Scene } from "./storyboard";
import type { ScenePlan } from "./timing";

export const DESCRIBED_FILM = runFile(SAMPLE_RUN, "described.mp4");
const BAND = COLOR.screen.replace("#", "0x");
/** The master's 2.4:1 picture at full width, centred in the picture area (40 px above and below). */
const FILM_H = 800;
const FILM_TOP = (CONTENT_HEIGHT - FILM_H) / 2;
/**
 * The reveal's words sit in the caption band, off the picture: the label near its top, Scene's line
 * (and in English its translation) or the film's dialogue centred below it, every line ending at
 * least 54 px (title-safe) above the frame's foot.
 */
const REVEAL_LABEL_Y = CONTENT_HEIGHT + 4;
const REVEAL_SUB_CENTRE_Y = CONTENT_HEIGHT + 106;
const TAG_POS = { x: 28, y: 26 };
/** A tag about the film being played sits on the film's picture, this far in from its corner. */
const TAG_INSET = 28;
const CHIP_GAP = 18;
/** A caption of dialogue is taken down just before Scene's next line starts. */
const DIALOGUE_CLEAR_S = 0.05;
const DIALOGUE_HOLD_S = 0.6;
/** Scene's line stays up this long after its voice ends. */
const LINE_HOLD_S = 0.3;
const LABEL_START_S = 0.2;

export interface SegmentInput {
  scene: Scene;
  plan: ScenePlan;
  seconds: number;
  captions: AssEvent[];
  workDir: string;
  out: string;
  browser: Browser;
  rec?: BeatRecord;
  frames: Frame[];
  lang: Language;
}

export interface Excerpt {
  /** Where it starts in the scene (output seconds). */
  at: number;
  /** The media second it starts from, and how long it runs. */
  media: number;
  seconds: number;
}

/**
 * The film an app scene plays, from the page's media log: where the page's first frame is in the
 * scene, the media second it shows, and how long until the planned listen ends (LISTEN.to), never
 * the length of a page that stalled. beatSegment lays the picture from this excerpt; its sound
 * (heardExcerpt) is the same file on the same clock, so the two cannot drift apart.
 */
export function playbackExcerpt(rec: BeatRecord, sceneSeconds: number): Excerpt | null {
  const pb = rec.playback;
  if (!pb) return null;
  const at = toOutput(rec, pb.wall);
  return { at, media: pb.media, seconds: Math.min(LISTEN.to - pb.media, sceneSeconds - at) };
}

/**
 * The part of the played film that is heard: from LISTEN.from, since "Play from here" starts the
 * page up to a second earlier, inside the voice of the line before (mix.ts lays it).
 */
export function heardExcerpt(play: Excerpt): Excerpt {
  const skip = Math.max(0, LISTEN.from - play.media);
  return { at: play.at + skip, media: play.media + skip, seconds: play.seconds - skip };
}

const fade = (scene: Scene) => (scene.chapter ? ["fade=t=in:st=0:d=0.25"] : []);

async function encodeWithFilters(
  inputArgs: string[],
  filters: string[],
  seconds: number,
  out: string,
  workDir: string,
  name: string,
): Promise<void> {
  const script = join(workDir, `${name}.filter`);
  await writeFile(script, filters.join(",\n"));
  await runFfmpeg([
    "-y",
    ...inputArgs,
    "-filter_script:v",
    script,
    "-t",
    seconds.toFixed(3),
    ...encodeArgs(),
    out,
  ]);
}

async function pageSegment(s: SegmentInput): Promise<void> {
  if (!("page" in s.scene.show)) throw new Error("not a page scene");
  const says = s.plan.parts.filter((p) => p.captions);
  const filmPart = s.plan.parts.find((p) => "film" in p.part);
  const timing = {
    T: s.seconds,
    S: says.map((p) => p.start),
    L: says.map((p) => p.seconds),
    film: filmPart?.start,
    lang: s.lang,
  };
  const assFile = join(s.workDir, `${s.scene.id}.ass`);
  await writeFile(assFile, assDocument(s.captions));
  await renderMotion({
    browser: s.browser,
    name: `${s.scene.id}-${s.lang}`,
    html: await PAGES[s.scene.show.page](timing),
    seconds: s.seconds,
    assFile,
    fadeIn: Boolean(s.scene.chapter),
    out: s.out,
  });
}

/** An event's words centred on its position, whatever the style's own alignment. */
const centred = (e: AssEvent): AssEvent => ({ ...e, text: `{\\an5}${e.text}` });

/** The reveal's words in the band: the label, Scene's lines, and the film's own dialogue. */
export function revealEvents(
  lang: Language,
  from: number,
  to: number,
  seconds: number,
): AssEvent[] {
  const h = film.hook;
  const words = labels(lang);
  const at = (filmSeconds: number) => filmSeconds - from;
  const firstLine = Math.min(...h.lines.map((l) => l.start));
  const ko = words.dialogueKo;
  const dialogue = (start: number, end: number, en: string, translated?: string) =>
    centred(
      dialogueEvent(start, end, translated ? `${en}\n${translated}` : en, REVEAL_SUB_CENTRE_Y),
    );
  const label = tagEvent(LABEL_START_S, seconds, words.revealLabel, WIDTH / 2, REVEAL_LABEL_Y);
  return [
    dialogue(at(h.locked.start), at(firstLine - DIALOGUE_CLEAR_S), `…${h.locked.text}`, ko?.locked),
    dialogue(
      at(h.freaky.start),
      at(Math.min(to, h.freaky.end + DIALOGUE_HOLD_S)),
      h.freaky.text,
      ko?.freaky,
    ),
    // The English film glosses Scene's Korean line; the Korean film shows the line alone. Each is
    // up from its first spoken sound, not from its voice file's lead-in.
    ...h.lines.map((l) =>
      centred(
        subEvent(
          at(l.start + l.onset),
          at(l.start + l.voiced + LINE_HOLD_S),
          l.text,
          lang === "en" ? l.gloss : "",
          REVEAL_SUB_CENTRE_Y,
        ),
      ),
    ),
    { ...label, text: `{\\an8}${label.text}` },
  ];
}

async function filmSegment(s: SegmentInput): Promise<void> {
  if (!("film" in s.scene.show)) throw new Error("not a film scene");
  const { from, to } = s.scene.show.film;
  const assFile = join(s.workDir, `${s.scene.id}.ass`);
  await writeFile(
    assFile,
    assDocument([...s.captions, ...revealEvents(s.lang, from, to, s.seconds)]),
  );
  await encodeWithFilters(
    ["-i", await masterCut(from, to)],
    [
      `scale=${WIDTH}:${FILM_H}:flags=lanczos`,
      `fps=${FPS}`,
      `pad=${WIDTH}:${HEIGHT}:0:${FILM_TOP}:color=${BAND}`,
      `tpad=stop_mode=clone:stop_duration=${Math.max(0, s.seconds - (to - from)).toFixed(3)}`,
      subtitlesFilter(assFile),
      ...fade(s.scene),
      "format=yuv420p",
    ],
    s.seconds,
    s.out,
    s.workDir,
    s.scene.id,
  );
}

/** The recording's frames as an ffconcat list in picture time. */
function beatConcat(frames: Frame[], rec: BeatRecord): string {
  let first = frames.findLastIndex((f) => f.t <= rec.wallStart);
  if (first < 0) first = frames.findIndex((f) => f.t >= rec.wallStart);
  const lines = ["ffconcat version 1.0"];
  for (let i = first; i < frames.length && frames[i].t < rec.wallEnd; i++) {
    const from = toOutput(rec, Math.max(frames[i].t, rec.wallStart));
    const to =
      i + 1 < frames.length && frames[i + 1].t < rec.wallEnd
        ? toOutput(rec, frames[i + 1].t)
        : rec.seconds;
    if (to <= from) continue;
    lines.push(`file '${frames[i].file}'`, `duration ${(to - from).toFixed(4)}`);
  }
  lines.push(lines[lines.length - 2]);
  return `${lines.join("\n")}\n`;
}

const FADE = /\\fad\((\d+),(\d+)\)/;

/**
 * An overlay event drawn as one piece of its whole span (`from`–`to`): its own fade-in and fade-out
 * become the opacity this piece has at its two ends (the pieces break at the fades' ends, so each
 * piece's opacity changes linearly).
 */
function faded(e: AssEvent, from: number, to: number): AssEvent {
  const m = e.text.match(FADE);
  if (!m) return e;
  const [fadeIn, fadeOut] = [Number(m[1]) / 1000, Number(m[2]) / 1000];
  const shown = (t: number) =>
    Math.min(1, Math.max(0, Math.min((t - from) / fadeIn, (to - t) / fadeOut)));
  const alpha = (t: number) => Math.round(255 * (1 - shown(t)));
  const [a, b] = [alpha(e.start), alpha(e.end)];
  const ms = Math.round((e.end - e.start) * 1000);
  const tag = a || b ? `\\fade(${a},${b},${b},0,${ms},${ms},${ms})` : "";
  return { ...e, text: e.text.replace(FADE, tag) };
}

/** Where an overlay's fade-in ends and its fade-out begins: its pieces break there. */
function fadeEnds(e: AssEvent, from: number, to: number): number[] {
  const m = e.text.match(FADE);
  return m ? [from + Number(m[1]) / 1000, to - Number(m[2]) / 1000] : [];
}

/**
 * The overlays in picture pixels. A spotlight or chip lights up once the camera has arrived; the
 * camera may drift under it, and it is then drawn frame by frame where its element is. Any other
 * move while it is lit would leave it behind: the build fails.
 */
export function overlayEvents(rec: BeatRecord): AssEvent[] {
  const keys = cameraKeys(rec.shots);
  const play = playbackExcerpt(rec, rec.seconds);
  return rec.overlays.flatMap((o): AssEvent[] => {
    if (o.kind === "tag") {
      if (o.media === undefined) return [tagEvent(o.at, o.until, o.text, TAG_POS.x, TAG_POS.y)];
      if (!play || !rec.playback)
        throw new Error(`${rec.beat}: "${o.text}" waits for a film that never played`);
      // Up when the film reaches that second, on the film's picture (clear of the page's header).
      const at = play.at + (o.media - play.media);
      const picture = toPicture(rec.playback.rect, cameraAt(keys, at));
      if (movesDuring(keys, at, o.until).length)
        throw new Error(`${rec.beat}: the camera moves while "${o.text}" is up on the film`);
      return [tagEvent(at, o.until, o.text, picture.x + TAG_INSET, picture.y + TAG_INSET)];
    }
    const from = settledAt(keys, o.at);
    const moving = movesDuring(keys, from, o.until);
    if (moving.length)
      throw new Error(
        `${rec.beat}: the camera moves at ${moving[0].at.toFixed(2)} s while a ${o.kind} is lit (${from.toFixed(2)}–${o.until.toFixed(2)} s)`,
      );
    const draw = (start: number, end: number, at: number): AssEvent[] => {
      const r = toPicture(o.rect, cameraAt(keys, at));
      return o.kind === "spotlight"
        ? spotlightEvents(start, end, r)
        : [chipEvent(start, end, o.text, r.x - CHIP_GAP, r.y + r.h / 2)];
    };
    const whole = draw(from, o.until, from);
    const drifts = keys.some((k) => k.drift && k.at < o.until && k.at + k.move > from);
    if (!drifts) return whole;
    const parts = pieces(keys, from, o.until, fadeEnds(whole[0], from, o.until));
    return parts.flatMap((p) => draw(p.start, p.end, p.at).map((e) => faded(e, from, o.until)));
  });
}

const even = (n: number) => 2 * Math.round(n / 2);

/**
 * The FFmpeg graph that lays the film over the player's picture in the recording (2880-wide
 * frames, before the camera): the described film from media second `media`, scaled into the
 * picture's box with its rounded corners, from scene second `at` for `seconds`, then held on its
 * last frame like a paused player. Input 0 is the recording, input 1 the film already cut with
 * -ss/-t, so its timestamps start at the cut.
 */
export function playbackOverlay(
  pb: { rect: { x: number; y: number; w: number; h: number }; radius: number },
  at: number,
): { graph: string; box: { x: number; y: number; w: number; h: number; r: number } } {
  const box = {
    x: even(pb.rect.x * DEVICE_SCALE),
    y: even(pb.rect.y * DEVICE_SCALE),
    w: even(pb.rect.w * DEVICE_SCALE),
    h: even(pb.rect.h * DEVICE_SCALE),
    r: pb.radius * DEVICE_SCALE,
  };
  // Opaque inside the rounded box, with a one-pixel soft edge.
  const r = box.r.toFixed(2);
  const dx = `max(max(${r}-X-0.5,X+0.5-(W-${r})),0)`;
  const dy = `max(max(${r}-Y-0.5,Y+0.5-(H-${r})),0)`;
  const mask = box.r > 0 ? `255*clip(${r}+0.5-hypot(${dx},${dy}),0,1)` : "255";
  const graph = [
    `[0:v]fps=${FPS}[rec]`,
    `[1:v]scale=${box.w}:${box.h}:flags=lanczos,format=yuva420p[pic]`,
    `color=c=white:s=${box.w}x${box.h}:r=${FPS},format=gray,geq=lum='${mask}'[mask]`,
    `[pic][mask]alphamerge,setpts=PTS+${at.toFixed(4)}/TB[film]`,
    `[rec][film]overlay=${box.x}:${box.y}:eof_action=repeat:format=auto`,
  ].join(";\n");
  return { graph, box };
}

async function beatSegment(s: SegmentInput): Promise<void> {
  const rec = s.rec;
  if (!rec) throw new Error(`no recording for ${s.scene.id}`);
  const list = join(s.workDir, `${s.scene.id}.ffconcat`);
  await writeFile(list, beatConcat(s.frames, rec));
  const assFile = join(s.workDir, `${s.scene.id}.ass`);
  await writeFile(assFile, assDocument([...s.captions, ...overlayEvents(rec)]));
  const after = [
    ...cameraFilters(cameraKeys(rec.shots)),
    `pad=${WIDTH}:${HEIGHT}:0:0:color=${BAND}`,
    subtitlesFilter(assFile),
    ...fade(s.scene),
    "format=yuv420p",
  ];
  const recording = ["-f", "concat", "-safe", "0", "-i", list];
  const play = playbackExcerpt(rec, s.seconds);
  if (!play || !rec.playback) {
    await encodeWithFilters(
      recording,
      [`fps=${FPS}`, ...after],
      s.seconds,
      s.out,
      s.workDir,
      s.scene.id,
    );
    return;
  }
  const { graph } = playbackOverlay(rec.playback, play.at);
  const script = join(s.workDir, `${s.scene.id}.filter`);
  await writeFile(script, `${graph},\n${after.join(",\n")}[v]`);
  await runFfmpeg([
    "-y",
    ...recording,
    "-ss",
    play.media.toFixed(4),
    "-t",
    play.seconds.toFixed(4),
    "-i",
    DESCRIBED_FILM,
    "-filter_complex_script",
    script,
    "-map",
    "[v]",
    "-t",
    s.seconds.toFixed(3),
    ...encodeArgs(),
    s.out,
  ]);
}

export async function renderSegment(s: SegmentInput): Promise<void> {
  const show = s.scene.show;
  if ("page" in show) return pageSegment(s);
  if ("film" in show) return filmSegment(s);
  return beatSegment(s);
}
