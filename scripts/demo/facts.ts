/**
 * Every number the film prints or says. The sample's numbers come from the one automatic run the film
 * shows (sample.ts); the evaluation's from the deck's checked data modules (scripts/deck/data); outside
 * facts (court, prices) from scripts/deck/facts.ts with their source lines.
 */
import { readFileSync } from "node:fs";
import { MAX_UPLOAD_SECONDS } from "../../src/lib/api-contract";
import { GUIDELINE_RULES } from "../../src/lib/pipeline/guidelines";
import { GEMINI_ACCESS_LABEL, MODELS } from "../../src/lib/models";
import { loopCounts } from "../deck/data/loops";
import { editSession } from "../deck/data/demo";
import { CATEGORY, FILM_CREDIT, HAND_MADE, LAWSUIT, THEME } from "../deck/facts";
import { REPO } from "./config";
import { finalFix, line, notes, opening, seven, summary } from "./sample";

/** Film seconds heard in the hook: from just before "…locked." to just after "This is pretty freaky." */
const HOOK_LEAD_S = 0.25;
const HOOK_TAIL_S = 0.2;

export const GEMINI_NAME = "Gemini 3.8 Flash";
if (!MODELS.flash.endsWith("gemini-3.8-flash"))
  throw new Error(`the film names ${GEMINI_NAME} but the app uses ${MODELS.flash}`);

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
  /** The line the review and result scenes follow: rejected once, rewritten, passed and voiced. */
  line,
  finalFix,
  original: {
    seconds: summary.seconds,
    costUsd: summary.costUsd,
    clipSeconds: summary.clipSeconds,
    lines: summary.lines,
    qualityStatus: summary.qualityStatus,
    analysisReused: summary.analysisReused,
    day: summary.day,
  },
  /** What the final check still lists: its notes, and how many are moments with no silence left. */
  notes,
  rules: GUIDELINE_RULES.length,
  loops: loopCounts,
  evaluatedAt,
  court: { date: new Date(court.date), source: court.source },
  handMade: HAND_MADE,
  maxClipSeconds: MAX_UPLOAD_SECONDS,
  /** The live service URL, as the deck's live check recorded it. */
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
