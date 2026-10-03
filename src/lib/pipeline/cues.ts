import type { Cue, DraftCue, Gap } from "./schemas";

/** A line needs at least this much room. */
export const MIN_ROOM_SECONDS = 1.0;

/** Turns the writer's lines into placed cues: inside a gap, in order, each with its room computed. */
export function placeCues(drafts: DraftCue[], gaps: Gap[]): { placed: Cue[]; dropped: Cue[] } {
  const placed: Cue[] = [];
  const dropped: Cue[] = [];
  const byGap = new Map<string, DraftCue[]>();
  let n = 0;
  for (const draft of drafts) {
    const gap = gaps.find((g) => g.id === draft.gapId && draft.at >= g.start && draft.at < g.end);
    if (!gap || !Number.isFinite(draft.at) || !draft.text.trim()) {
      dropped.push({
        id: `L${++n}`,
        gapId: draft.gapId,
        start: draft.at,
        windowEnd: draft.at,
        versions: [{ text: draft.text, by: "write", model: "" }],
        status: "dropped",
        droppedReason: "invalid_placement",
      });
      continue;
    }
    byGap.set(gap.id, [...(byGap.get(gap.id) ?? []), { ...draft, gapId: gap.id }]);
  }
  for (const gap of gaps) {
    const lines = (byGap.get(gap.id) ?? []).sort((a, b) => a.at - b.at);
    lines.forEach((line, i) => {
      const start = line.at;
      const next = lines[i + 1];
      const windowEnd = next ? Math.min(Math.max(next.at, gap.start), gap.end) : gap.end;
      const cue: Cue = {
        id: `L${++n}`,
        gapId: gap.id,
        start,
        windowEnd,
        versions: [{ text: line.text.trim(), by: "write", model: "" }],
        status: "pending",
      };
      if (windowEnd - start < MIN_ROOM_SECONDS) {
        cue.status = "dropped";
        cue.droppedReason = "no_room";
        dropped.push(cue);
      } else placed.push(cue);
    });
  }
  return { placed, dropped };
}

/** Air kept after a voiced line before a line added behind it may start. */
export const LINE_SPACING_SECONDS = 0.3;

/**
 * Where a line can still be added to a voiced track near second `at` without moving or cutting any
 * voiced line: inside the gap, from the end of the last line spoken before `at` (plus spacing) to the
 * next line's start or the gap end. The line starts at `at`, or earlier when `at` is within a second of
 * the room's end (a moment at the end of a silence, or just after it), never before the line in front.
 * Null when that leaves less than MIN_ROOM_SECONDS.
 */
export function freeRoom(
  at: number,
  gap: Gap,
  voiced: { start: number; end: number }[],
): { start: number; end: number } | null {
  const inGap = voiced
    .filter((l) => l.start >= gap.start && l.start < gap.end)
    .sort((a, b) => a.start - b.start);
  const before = inGap.filter((l) => l.start <= at).at(-1);
  const after = inGap.find((l) => l.start > at);
  const earliest = Math.max(gap.start, before ? before.end + LINE_SPACING_SECONDS : gap.start);
  const end = after ? after.start : gap.end;
  const start = Math.max(earliest, Math.min(at, end - MIN_ROOM_SECONDS));
  return end - start >= MIN_ROOM_SECONDS ? { start, end } : null;
}

/**
 * How far a moment the final check found may lie outside the silence it names and still get a line
 * there. Of 31 such moments in the QA runs of 2026-10-03, 21 sat within 2.93 s of their silence and
 * the next was 6.13 s away; a line 9 s from what it describes would describe the wrong picture.
 */
export const MAX_MOMENT_DISTANCE_SECONDS = 3;

/**
 * The free room a line about a missing moment can use (freeRoom), with the moment clamped into the
 * silence it names; null when that silence is unknown, the moment lies further than
 * MAX_MOMENT_DISTANCE_SECONDS outside it, or there is no room.
 */
export function roomForMoment(
  item: { gapId: string; at: number },
  gaps: Gap[],
  voiced: { start: number; end: number }[],
): { start: number; end: number } | null {
  const gap = gaps.find((g) => g.id === item.gapId);
  if (!gap) return null;
  const at = Math.min(Math.max(item.at, gap.start), gap.end);
  if (Math.abs(at - item.at) > MAX_MOMENT_DISTANCE_SECONDS) return null;
  return freeRoom(at, gap, voiced);
}

/** The version a line currently stands on. */
export function latest(cue: Cue) {
  return cue.versions[cue.versions.length - 1];
}

/**
 * True when `text` has the words of one of the line's earlier versions. Every earlier version was
 * rejected, too long, or is the one that stands now, so going back to one gains nothing: it counts
 * as no rewrite (reason "unchanged").
 */
export function triedBefore(cue: Cue, text: string): boolean {
  return cue.versions.some((v) => sameWords(v.text, text));
}

/**
 * A rewrite request's fix, followed by the line's earlier wordings that failed and why: the writer
 * sees only the current text otherwise, and offered rejected or too-long wordings again (QA,
 * 2026-10-03: 9 lines went back to an earlier wording, some 2–4 times).
 */
export function withFailedWordings(cue: Cue, fix: string): string {
  const room = cue.windowEnd - cue.start;
  const current = latest(cue).text;
  const failed: string[] = [];
  for (const v of cue.versions) {
    const why =
      v.review?.pass === false
        ? v.review.violations.map((x) => `${x.rule}: ${x.reason}`).join("; ")
        : v.voice && v.voice.seconds > room
          ? `spoken in ${v.voice.seconds.toFixed(1)} s, room ${room.toFixed(1)} s`
          : null;
    if (!why || sameWords(v.text, current) || failed.some((f) => f.startsWith(`"${v.text}"`)))
      continue;
    failed.push(`"${v.text}" (${why})`);
  }
  if (failed.length === 0) return fix;
  return `${fix}\n  already tried and failed, do not offer again: ${failed.join("; ")}`;
}

export function sameWords(a: string, b: string): boolean {
  return (
    a.normalize("NFKC").replace(/\s+/g, " ").trim() ===
    b.normalize("NFKC").replace(/\s+/g, " ").trim()
  );
}
