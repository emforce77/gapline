"use client";

import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import type { Cue, Gap, SpeechSegment } from "@/lib/pipeline/schemas";

const RULER_STEP_SECONDS = 5;

function cueClass(cue: Cue): string {
  const latest = cue.versions[cue.versions.length - 1];
  if (cue.status === "dropped") return "cue dropped";
  if (cue.status === "fits") return "cue fits";
  if (latest.review && !latest.review.pass) return "cue rejected";
  if (cue.status === "approved") return "cue approved";
  return "cue pending";
}

/** Picture, dialogue, room and narration on one time axis; click anywhere to seek. */
export function Timeline({
  clipSeconds,
  stripUrl,
  speech,
  gaps,
  cues,
  currentTime,
  selectedCueId,
  onSeek,
  onSelect,
}: {
  clipSeconds: number;
  stripUrl: string;
  speech: SpeechSegment[];
  gaps: Gap[];
  cues: Cue[];
  currentTime: number;
  selectedCueId: string | null;
  onSeek: (seconds: number) => void;
  onSelect: (cueId: string) => void;
}) {
  const { t } = useI18n();
  const pct = (s: number) => `${(Math.max(0, Math.min(s, clipSeconds)) / clipSeconds) * 100}%`;
  const ticks = Array.from(
    { length: Math.floor(clipSeconds / RULER_STEP_SECONDS) + 1 },
    (_, i) => i * RULER_STEP_SECONDS,
  );

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * clipSeconds);
  };

  return (
    <div className="timeline">
      <div className="tl-labels">
        <span />
        <span>{t.timeline.picture}</span>
        <span>{t.timeline.dialogue}</span>
        <span>{t.timeline.room}</span>
        <span>{t.timeline.narration}</span>
      </div>
      <div className="tl-body" onClick={seekFromEvent} role="presentation">
        <div className="tl-ruler">
          {ticks.map((s) => (
            <span key={s} className="tl-tick mono" style={{ left: pct(s) }}>
              {s}
            </span>
          ))}
        </div>
        <div className="tl-track tl-picture" style={{ backgroundImage: `url(${stripUrl})` }} />
        <div className="tl-track">
          {speech.map((s, i) => (
            <span
              key={i}
              className="tl-dialogue"
              style={{ left: pct(s.start), width: pct(s.end - s.start) }}
              title={s.text}
            />
          ))}
        </div>
        <div className="tl-track">
          {gaps.map((g) => (
            <span
              key={g.id}
              className="tl-room"
              style={{ left: pct(g.start), width: pct(g.end - g.start) }}
            >
              {g.end - g.start >= 2.5
                ? fill(t.timeline.seconds, { n: (g.end - g.start).toFixed(1) })
                : ""}
            </span>
          ))}
        </div>
        <div className="tl-track tl-narration">
          {cues.map((cue) => {
            const spoken = cue.seconds ?? cue.windowEnd - cue.start;
            return (
              <button
                key={cue.id}
                type="button"
                className={`${cueClass(cue)}${cue.id === selectedCueId ? " selected" : ""}`}
                style={{ left: pct(cue.start), width: pct(spoken) }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(cue.id);
                }}
                aria-label={cue.versions[cue.versions.length - 1].text}
              >
                <span className="cue-id mono">{cue.id}</span>
              </button>
            );
          })}
        </div>
        <span className="tl-playhead" style={{ left: pct(currentTime) }} />
      </div>
    </div>
  );
}
