/**
 * The checks run against the live Cloud Run service on 22 Sep 2026 (runtime/demo-v2/live-check.json):
 * one line of an earlier track of the opening was edited there, and Gapline re-voiced and re-checked
 * only that line. It is the measured cost of the optional edit, and it proves the service's behaviour
 * (an edit sent twice makes one version; private files answer 404 to other visitors). It is checked
 * against the edit's own run record, not against the sample, which nobody edited.
 */
import { LIVE_CHECK } from "../paths";
import { LiveCheckSchema, readJsonFile } from "./schema";
import { agree, readRun, runDay } from "./runs";

const live = readJsonFile(LIVE_CHECK, LiveCheckSchema);
const edit = readRun(live.childRunId);
if (edit.parentRunId !== live.parentRunId)
  throw new Error(`the live check's edit ${live.childRunId} is not made from ${live.parentRunId}`);
if (edit.humanEdits?.length !== 1)
  throw new Error(`the live check's edit ${live.childRunId} should record exactly one line edit`);
agree("edit cost", live.childApiCost, edit.summary.costUsd);
agree("edit time", live.childWallSeconds, edit.summary.wallSeconds);
// Only the edited line is voiced again: every other line's audio is the parent's, byte for byte.
const lines = edit.cues.filter((c) => c.status === "fits").length;
if (live.unchangedWavFilesIdentical !== lines - 1)
  throw new Error("expected every other line's audio to be reused byte for byte");

const HTTP_NOT_FOUND = 404;

export const liveCheck = {
  /** The live service's URL. */
  service: live.service,
  /** The Cloud Run revision the checks ran on. */
  revision: live.revision,
  /** When the edit's calls started (the day of the check). */
  day: runDay(live.childRunId),
  /** One edited line: API cost and seconds until the new track was mixed. */
  editCostUsd: live.childApiCost,
  editSeconds: live.childWallSeconds,
  /** Lines whose audio the edit reused unchanged. */
  reusedAudioFiles: live.unchangedWavFilesIdentical,
  /** The same edit sent twice made one version. */
  idempotentRepeat: live.idempotentRepeat,
  privateRoutesDenied: live.privateUploadDeniedStatuses.filter((s) => s === HTTP_NOT_FOUND).length,
  privateRoutesChecked: live.privateUploadDeniedStatuses.length,
};
