"use client";

import { useEffect, useRef, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatStart } from "./edit-errors";

/** Keep the video paused. Seeking currentTime decodes the requested frame even between keyframes. */
function SourceFrame({ src, at }: { src: string; at: number }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const requested = useRef<number | null>(null);
  const [decoded, setDecoded] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (el && el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      requested.current = at;
      el.currentTime = at;
    }
  }, [at]);

  function showFrame(el: HTMLVideoElement) {
    // Do not compare currentTime numerically: privacy settings can round its reported value.
    if (!el.seeking && requested.current === at) setDecoded(at);
  }

  return (
    <div className="source-frame" aria-busy={!failed && decoded !== at}>
      <video
        ref={video}
        src={src}
        preload="metadata"
        muted
        playsInline
        aria-hidden="true"
        style={{ visibility: decoded === at && !failed ? "visible" : "hidden" }}
        onLoadedMetadata={(event) => {
          requested.current = at;
          event.currentTarget.currentTime = at;
        }}
        onSeeking={() => setDecoded(null)}
        onLoadedData={(event) => showFrame(event.currentTarget)}
        onSeeked={(event) => showFrame(event.currentTarget)}
        onError={() => setFailed(true)}
      />
      {failed || decoded !== at ? (
        <span className="label">
          {failed ? t.editor.frameCompare.failed : t.editor.frameCompare.loading}
        </span>
      ) : null}
    </div>
  );
}

/** Opening the disclosure is the first time either preview asks the private project media route for bytes. */
export function FrameComparison({
  projectId,
  savedStart,
  draftStart,
  end,
  seconds,
}: {
  projectId: string;
  savedStart: number;
  draftStart: number | null;
  end: number;
  seconds?: number;
}) {
  const { t, lang } = useI18n();
  const labels = t.editor.frameCompare;
  const [open, setOpen] = useState(false);
  const src = `/api/projects/${encodeURIComponent(projectId)}/media/clip.mp4`;
  return (
    <details
      className="frame-comparison"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.open || event.nativeEvent.isComposing)
          return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary>{labels.open}</summary>
      {open ? (
        <>
          <div className="comparison-frames">
            {[
              { label: labels.saved, at: savedStart },
              { label: labels.draft, at: draftStart },
            ].map(({ label, at }) => (
              <figure key={label}>
                <figcaption>
                  {label}
                  {at !== null ? ` · ${fill(labels.time, { s: formatStart(at, lang) })}` : ""}
                </figcaption>
                {at === null ? (
                  <p className="label">{labels.invalid}</p>
                ) : (
                  <SourceFrame src={src} at={at} />
                )}
              </figure>
            ))}
          </div>
          <p className="label" role="status">
            {seconds === undefined
              ? labels.unvoiced
              : fill(labels.duration, { s: formatStart(seconds, lang) })}
            {draftStart !== null
              ? ` ${fill(labels.room, { s: formatStart(end - draftStart, lang) })}`
              : ""}
          </p>
        </>
      ) : null}
    </details>
  );
}
