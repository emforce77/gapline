/**
 * Everything the template deck prints that Gapline measured or configured, exported once as JSON for
 * the Python builder (build_pitch.py). Numbers come from the HTML deck's checked data modules, which
 * parse the run records and throw when a guard no longer holds; settings come from the source that
 * sets them (deploy/cloud-run.sh, models.ts, api-contract.ts, the pipeline). Nothing here is typed by
 * hand except the pitch-only team leader name below.
 *
 * Out: runtime/pitch/pitch-data.json (with how and when it was produced).
 * Run: node --import tsx scripts/pitch/export-data.ts (part of `npm run pitch`).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SECONDS,
  RUN_TIME_LIMIT_SECONDS,
} from "../../src/lib/api-contract";
import { MODELS, GEMINI_ACCESS_LABEL } from "../../src/lib/models";
import { MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "../../src/lib/pipeline/gaps";
import { GUIDELINE_RULES } from "../../src/lib/pipeline/guidelines";
import { MIN_ROOM_SECONDS } from "../../src/lib/pipeline/cues";
import { SPEC } from "../deck/data/deploy";
import { fitRule, newspaper } from "../deck/data/city";
import { launchCall } from "../deck/data/recognizers";
import { line, runId, seven } from "../deck/data/sample";
import {
  AUDIENCE,
  CATEGORY,
  COMPARE_COLUMNS,
  COMPETITORS,
  FILM_CREDIT,
  HAND_MADE,
  LAWSUIT,
  PRICE_POINTS,
  SCENE_ROW,
  STREAMING_DUTY,
  SUBMISSION,
  THEME,
} from "../deck/facts";
import { REPO } from "../deck/paths";

/** The template's cover asks for it; set it here before the final build (`npm run pitch -- --final`). */
const TEAM_LEADER: string | null = null;

const OUT_DIR = join(REPO, "runtime/pitch");
const OUT_FILE = join(OUT_DIR, "pitch-data.json");
const BYTES_PER_MB = 1024 * 1024;
const SECONDS_PER_MINUTE = 60;

function sourceConstant(file: string, name: string): number {
  const text = readFileSync(join(REPO, file), "utf8");
  const m = text.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!m) throw new Error(`${file} no longer defines ${name} as a number`);
  return Number(m[1]);
}

function deployFlag(name: string): string {
  const text = readFileSync(join(REPO, "deploy/cloud-run.sh"), "utf8");
  const m = text.match(new RegExp(`--${name}[ =]("[^"]*"|\\S+)`));
  if (!m) throw new Error(`deploy/cloud-run.sh has no --${name}`);
  return m[1].replace(/"/g, "");
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();
}

const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const reviewRounds = sourceConstant("src/lib/pipeline/run.ts", "MAX_REVIEW_ROUNDS");
const rules = GUIDELINE_RULES.map((r) => ({ id: r.id, title: r.title.en, source: r.source.en }));
const ruleTitle = (id: string): string => {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`no guideline rule ${id}`);
  return rule.title;
};

const data = {
  meta: {
    producedBy: "scripts/pitch/export-data.ts",
    producedAt: new Date().toISOString(),
    gitCommit: git(["rev-parse", "--short", "HEAD"]),
    gitDirty: git(["status", "--porcelain"]).length > 0,
    sampleRun: runId,
  },
  team: {
    name: SUBMISSION.team,
    leader: TEAM_LEADER,
    theme: THEME,
    category: CATEGORY,
  },
  links: { repo: SUBMISSION.repoUrl, video: SUBMISSION.videoUrl, demo: SUBMISSION.demoUrl },
  filmCredit: FILM_CREDIT,
  product: {
    model: MODELS.flash,
    geminiAccess: GEMINI_ACCESS_LABEL,
    maxClipSeconds: MAX_UPLOAD_SECONDS,
    maxUploadMb: MAX_UPLOAD_BYTES / BYTES_PER_MB,
    runLimitMinutes: RUN_TIME_LIMIT_SECONDS / SECONDS_PER_MINUTE,
    minSilenceSeconds: MIN_GAP_SECONDS,
    speechGuardSeconds: SPEECH_GUARD_SECONDS,
    minRoomSeconds: MIN_ROOM_SECONDS,
    rewritesAfterReview: reviewRounds - 1,
    ruleCount: rules.length,
    rules,
    maxSpeedUpPercent: Math.round((fitRule.maxRate - 1) * 100),
    shortenings: fitRule.shortenings,
    versions: {
      next: pkg.dependencies.next,
      react: pkg.dependencies.react,
      zod: pkg.dependencies.zod,
    },
  },
  cloudRun: {
    ...SPEC,
    timeoutMinutes: Number(deployFlag("timeout")) / SECONDS_PER_MINUTE,
  },
  seven,
  reviewer: {
    start: line.start,
    room: line.room,
    draft: line.draft.text,
    rejectedFor: line.draft.rules.map(ruleTitle),
    quote: line.draft.quote,
    fix: line.draft.fix,
    rewrite: line.rewrite.text,
    voiced: line.voiced,
  },
  newspaper: {
    room: newspaper.room,
    estimate: newspaper.estimate,
    wordsPerSecond: newspaper.wordsPerSecond,
    tries: newspaper.tries,
  },
  launchCall: {
    text: launchCall.text,
    firstListen: launchCall.chirp,
    silence: launchCall.before.gap,
    lineOverCall: { start: launchCall.before.line.start, voiced: launchCall.before.line.voiced },
    relisten: launchCall.after.relisten,
  },
  facts: {
    lawsuit: LAWSUIT,
    streamingDuty: STREAMING_DUTY,
    handMade: HAND_MADE,
    audience: AUDIENCE,
    prices: PRICE_POINTS,
    compare: { columns: COMPARE_COLUMNS, competitors: COMPETITORS, gapline: SCENE_ROW },
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, `${JSON.stringify(data, null, 1)}\n`);
process.stdout.write(`wrote ${OUT_FILE} (sample ${runId}, commit ${data.meta.gitCommit})\n`);
