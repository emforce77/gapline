/**
 * One H.264 segment per scene, all encoded alike so they join without re-encoding:
 *   page   — a motion page rendered frame by frame (motion.ts);
 *   film   — the described film itself, letterboxed, with Scene's lines as amber subtitles;
 *   beat   — the app recording, retimed through its squeezed waits, with the camera and overlays.
 * The caption band under the picture carries the presenter's captions in every scene.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Browser } from "playwright-core";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
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
import { cameraAt, cameraFilters, cameraKeys, settledAt, toPicture } from "./camera";
import { CONTENT_HEIGHT, EDIT_CHILD_RUN, FPS, HEIGHT, runFile, WIDTH } from "./config";
import { encodeArgs, subtitlesFilter } from "./encode";
import { film } from "./facts";
import { masterCut } from "./master";
import { renderMotion } from "./motion";
import { PAGES } from "./pages/index";
import { toOutput, type BeatRecord, type Frame } from "./recorder-kit";
import type { Scene } from "./storyboard";
import type { ScenePlan } from "./voice";

export const DESCRIBED_FILM = runFile(EDIT_CHILD_RUN, "described.mp4");
const BAND = COLOR.screen.replace("#", "0x");
const FILM_H = 800;
const FILM_TOP = (CONTENT_HEIGHT - FILM_H) / 2;
const SUB_Y = FILM_TOP + FILM_H - 40;
const TAG_POS = { x: 28, y: 26 };
const CHIP_GAP = 18;
/** A caption of dialogue is taken down just before Scene's next line starts. */
const DIALOGUE_CLEAR_S = 0.05;
const DIALOGUE_HOLD_S = 0.6;

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
  lang: string;
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
  const says = s.plan.parts.filter((p) => p.sentence);
  const filmPart = s.plan.parts.find((p) => "film" in p.part);
  const timing = {
    T: s.seconds,
    S: says.map((p) => p.start),
    L: says.map((p) => p.seconds),
    film: filmPart?.start,
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

async function filmSegment(s: SegmentInput): Promise<void> {
  if (!("film" in s.scene.show)) throw new Error("not a film scene");
  const { from, to } = s.scene.show.film;
  const h = film.hook;
  const at = (filmSeconds: number) => filmSeconds - from;
  const events: AssEvent[] = [...s.captions];
  const firstLine = Math.min(...h.lines.map((l) => l.start));
  events.push(
    dialogueEvent(at(h.locked.start), at(firstLine - DIALOGUE_CLEAR_S), `…${h.locked.text}`, SUB_Y),
    dialogueEvent(
      at(h.freaky.start),
      at(Math.min(to, h.freaky.end + DIALOGUE_HOLD_S)),
      h.freaky.text,
      SUB_Y,
    ),
    ...h.lines.map((l) =>
      subEvent(at(l.start), at(l.start + l.voiced + 0.3), l.text, l.gloss, SUB_Y),
    ),
    tagEvent(
      0.2,
      at(firstLine) + 1.2,
      "Scene’s Korean description · English glosses ours",
      TAG_POS.x,
      TAG_POS.y,
    ),
  );
  const assFile = join(s.workDir, `${s.scene.id}.ass`);
  await writeFile(assFile, assDocument(events));
  await encodeWithFilters(
    ["-i", await masterCut(from, to)],
    [
      `scale=${WIDTH}:${FILM_H}:flags=lanczos`,
      `fps=${FPS}`,
      `pad=${WIDTH}:${HEIGHT}:0:${FILM_TOP}:color=black`,
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

function overlayEvents(rec: BeatRecord): AssEvent[] {
  const keys = cameraKeys(rec.shots);
  return rec.overlays.flatMap((o): AssEvent[] => {
    if (o.kind === "tag") return [tagEvent(o.at, o.until, o.text, TAG_POS.x, TAG_POS.y)];
    const at = settledAt(keys, o.at);
    const r = toPicture(o.rect, cameraAt(keys, at));
    if (o.kind === "spotlight") return spotlightEvents(at, o.until, r);
    return [chipEvent(at, o.until, o.text, r.x - CHIP_GAP, r.y + r.h / 2)];
  });
}

async function beatSegment(s: SegmentInput): Promise<void> {
  const rec = s.rec;
  if (!rec) throw new Error(`no recording for ${s.scene.id}`);
  const list = join(s.workDir, `${s.scene.id}.ffconcat`);
  await writeFile(list, beatConcat(s.frames, rec));
  const assFile = join(s.workDir, `${s.scene.id}.ass`);
  await writeFile(assFile, assDocument([...s.captions, ...overlayEvents(rec)]));
  await encodeWithFilters(
    ["-f", "concat", "-safe", "0", "-i", list],
    [
      `fps=${FPS}`,
      ...cameraFilters(cameraKeys(rec.shots)),
      `pad=${WIDTH}:${HEIGHT}:0:0:color=${BAND}`,
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

export async function renderSegment(s: SegmentInput): Promise<void> {
  const show = s.scene.show;
  if ("page" in show) return pageSegment(s);
  if ("film" in show) return filmSegment(s);
  return beatSegment(s);
}
