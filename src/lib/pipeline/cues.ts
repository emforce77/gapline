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
