import type { Cue, SpeechSegment } from "@/lib/pipeline/schemas";

/** A static strip: dialogue in grey, narration in amber, placed at their real times. */
export function TimelinePreview({
  clipSeconds,
  speech,
  cues,
  labels,
}: {
  clipSeconds: number;
  speech: SpeechSegment[];
  cues: Cue[];
  labels: { dialogue: string; narration: string };
}) {
  const pct = (s: number) => `${(s / clipSeconds) * 100}%`;
  return (
    <div className="preview" aria-hidden="true">
      <div className="preview-row">
        <span className="preview-label">{labels.dialogue}</span>
        <div className="preview-track">
          {speech.map((s, i) => (
            <span
              key={i}
              className="preview-block dialogue"
              style={{ left: pct(s.start), width: pct(s.end - s.start) }}
            />
          ))}
        </div>
      </div>
      <div className="preview-row">
        <span className="preview-label">{labels.narration}</span>
        <div className="preview-track">
          {cues.map((c) => (
            <span
              key={c.id}
              className="preview-block narration"
              style={{ left: pct(c.start), width: pct(c.seconds ?? 0) }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
