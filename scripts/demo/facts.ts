/**
 * Every number the film prints or says, read from Scene's run records through the deck's checked data
 * modules (scripts/deck/data), so the deck and the film cannot disagree. Outside facts (court, prices)
 * come from scripts/deck/facts.ts with their source lines.
 */
import { readFileSync } from "node:fs";
import { MAX_UPLOAD_SECONDS } from "../../src/lib/api-contract";
import { GEMINI_ACCESS_LABEL, MODELS } from "../../src/lib/models";
import { editSession, lineHistory, opening, originalRun, seven } from "../deck/data/demo";
import { evaluationFacts } from "../deck/data/evaluation";
import { loopCounts } from "../deck/data/loops";
import type { RunCue } from "../deck/data/schema";
import { lastVersion, sessions } from "../deck/data/showcase";
import { CATEGORY, FILM_CREDIT, HAND_MADE, LAWSUIT, THEME } from "../deck/facts";
import { EDIT_CHILD_RUN, EDIT_PARENT_RUN, ORIGINAL_RUN, REPO, runFile } from "./config";

/** Film seconds heard in the hook: from just before "…locked." to just after "This is pretty freaky." */
const HOOK_LEAD_S = 0.25;
const HOOK_TAIL_S = 0.2;

export const GEMINI_NAME = "Gemini 3.8 Flash";
if (!MODELS.flash.endsWith("gemini-3.8-flash"))
  throw new Error(`the film names ${GEMINI_NAME} but the app uses ${MODELS.flash}`);

/**
 * The film shows the result of the Line 5 edit. The pinned sample track (the deck's finalRun) may be
 * a later edit of that result, such as the removal of a line over dialogue on 23 Sep 2026, so the
 * film's result must be in the track's history and keep the numbers the film takes from the track:
 * the typed line and every line of the seven seconds.
 */
if (originalRun.runId !== ORIGINAL_RUN || !sessions.some((s) => s.runId === EDIT_CHILD_RUN))
  throw new Error("the film's runs are not in the deck's pinned sample track");
const child = JSON.parse(readFileSync(runFile(EDIT_CHILD_RUN, "script.json"), "utf8")) as {
  summary: { parentRunId?: string };
  cues: RunCue[];
};
if (child.summary.parentRunId !== EDIT_PARENT_RUN)
  throw new Error(`${EDIT_CHILD_RUN} was not made from ${EDIT_PARENT_RUN}`);
for (const line of [
  { id: lineHistory.id, text: lineHistory.typed.text, start: lineHistory.start },
  ...seven.lines,
]) {
  const cue = child.cues.find((c) => c.id === line.id && c.status === "fits");
  if (!cue || cue.start !== line.start || lastVersion(cue).text !== line.text)
    throw new Error(`${EDIT_CHILD_RUN} does not show ${line.id} as the pinned track has it`);
}

/** The day the recorded edit ran, from its own call ledger. */
const firstCall = readFileSync(runFile(EDIT_CHILD_RUN, "ledger.jsonl"), "utf8").split("\n")[0];
const editDay = new Date(JSON.parse(firstCall).at as string);

/** When the evaluation ran, from its own summary. */
const evaluatedAt = new Date(
  JSON.parse(readFileSync(`${REPO}/runtime/evaluation/summary.json`, "utf8")).at as string,
);

const court = LAWSUIT.events.find((e) => e.source.startsWith("Supreme Court"));
if (!court) throw new Error("no Supreme Court ruling in the deck facts");

export const film = {
  hook: {
    from: Math.round((seven.locked.start - HOOK_LEAD_S) * 100) / 100,
    to: Math.round((seven.freaky.end + HOOK_TAIL_S) * 100) / 100,
    locked: seven.locked,
    freaky: seven.freaky,
    silence: seven.silence,
    lines: seven.lines,
    domain: seven.domain,
  },
  opening,
  /** Line 5 in the app (cue L4): rejected twice, dropped, then typed by an editor. */
  line: {
    cueId: lineHistory.id,
    start: lineHistory.start,
    windowEnd: lineHistory.windowEnd,
    room: lineHistory.room,
    typed: lineHistory.typed.text,
    rejectedDraft: lineHistory.rewrite.text,
    voiced: lineHistory.typed.voiced,
  },
  edit: {
    seconds: editSession.seconds,
    costUsd: editSession.costUsd,
    reusedAudioFiles: editSession.reusedAudioFiles,
    day: editDay,
  },
  original: {
    seconds: originalRun.summary.wallSeconds,
    costUsd: originalRun.summary.costUsd,
    clipSeconds: originalRun.summary.clipSeconds,
  },
  loops: loopCounts,
  evaluatedAt,
  flagged: {
    finished: evaluationFacts.defaultFinished,
    flagged: evaluationFacts.defaultFlagged,
  },
  court: { date: new Date(court.date), source: court.source },
  handMade: HAND_MADE,
  maxClipSeconds: MAX_UPLOAD_SECONDS,
  service: editSession.service,
  geminiAccess: GEMINI_ACCESS_LABEL,
  credit: FILM_CREDIT,
  theme: THEME,
  category: CATEGORY,
};

/** "5 min 49 s" / "5분 49초" */
export function minutesSeconds(seconds: number, lang: "en" | "ko"): string {
  const whole = Math.round(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return lang === "ko" ? `${m}분 ${s}초` : `${m} min ${s} s`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "22 Sep 2026" (UTC) */
export const dayLabel = (d: Date): string =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
