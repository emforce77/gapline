import type { Cue, Gap, SpeechSegment } from "@/lib/pipeline/schemas";

const TICK_SECONDS = 5;
/** Only these ticks stay labelled on a phone, where the clip gets about 3 px per second. */
const MAJOR_TICK_SECONDS = 10;

/**
 * The landing's large timeline of the sample: picture, dialogue, and every room to speak with the
 * narration placed inside it, at their recorded times. Row labels carry the counts, so the picture
 * explains itself. Static: it is a figure, the workspace has the interactive one.
 */
export function TimelinePreview({
  clipSeconds,
  stripUrl,
  speech,
  gaps,
  cues,
  highlight,
  labels,
}: {
  clipSeconds: number;
  stripUrl: string;
  speech: SpeechSegment[];
  gaps: Gap[];
  cues: Cue[];
  /** A span to mark (the seven seconds), with the id of the element it links to. */
  highlight: { start: number; end: number; href: string } | null;
  labels: {
    picture: string;
    dialogue: string;
    dialogueStat: string;
    room: string;
    roomStat: string;
    narration: string;
    narrationStat: string;
    shortest: string;
    seven: string;
    caption: string;
  };
}) {
  const pct = (s: number) => `${(Math.max(0, Math.min(s, clipSeconds)) / clipSeconds) * 100}%`;
  const ticks = Array.from(
    { length: Math.floor(clipSeconds / TICK_SECONDS) + 1 },
    (_, i) => i * TICK_SECONDS,
  );
  const shortest = gaps.reduce<Gap | null>(
    (min, g) => (!min || g.end - g.start < min.end - min.start ? g : min),
    null,
  );

  return (
    <figure className="annotated">
      <div className="at-scroll">
        <div className="at-grid">
          <div className="at-labels">
            <span />
            <span>{labels.picture}</span>
            <span>
              {labels.dialogue}
              <small>{labels.dialogueStat}</small>
            </span>
            <span className="at-label-room">
              {labels.room} · {labels.narration}
              <small>{labels.roomStat}</small>
              <small>{labels.narrationStat}</small>
            </span>
          </div>
          <div className="at-body">
            <div className="at-ruler" aria-hidden="true">
              {ticks.map((s) => (
                <span
                  key={s}
                  className={`at-tick mono${s % MAJOR_TICK_SECONDS ? " minor" : ""}`}
                  style={{ left: pct(s) }}
                >
                  {s}
                </span>
              ))}
            </div>
            <div className="at-track at-picture" style={{ backgroundImage: `url(${stripUrl})` }} />
            <div className="at-track">
              {speech.map((s, i) => (
                <span
                  key={i}
                  className="at-dialogue"
                  style={{ left: pct(s.start), width: pct(s.end - s.start) }}
                />
              ))}
            </div>
            <div className="at-track at-rooms">
              {gaps.map((g) => (
                <span
                  key={g.id}
                  className="at-room"
                  style={{ left: pct(g.start), width: pct(g.end - g.start) }}
                />
              ))}
              {cues.map((c) => (
                <span
                  key={c.id}
                  className="at-line"
                  style={{ left: pct(c.start), width: pct(c.seconds ?? 0) }}
                />
              ))}
              {shortest ? (
                <span
                  className="at-note"
                  style={{ left: pct(shortest.start), width: pct(shortest.end - shortest.start) }}
                >
                  {labels.shortest}
                </span>
              ) : null}
            </div>
            {highlight ? (
              <a
                className={`at-highlight${highlight.start > clipSeconds / 2 ? " end" : ""}`}
                href={highlight.href}
                style={{ left: pct(highlight.start), width: pct(highlight.end - highlight.start) }}
              >
                <span>{labels.seven}</span>
              </a>
            ) : null}
          </div>
        </div>
      </div>
      <figcaption className="label">{labels.caption}</figcaption>
    </figure>
  );
}
