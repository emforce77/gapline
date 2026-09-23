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

/** The version a line currently stands on. */
export function latest(cue: Cue) {
  return cue.versions[cue.versions.length - 1];
}

export function sameWords(a: string, b: string): boolean {
  return (
    a.normalize("NFKC").replace(/\s+/g, " ").trim() ===
    b.normalize("NFKC").replace(/\s+/g, " ").trim()
  );
}
