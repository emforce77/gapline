"use client";

import { useEffect, useRef, useState } from "react";
import { pictureSlots } from "./picture-lane";

/**
 * The timeline's picture row: whole frames from the clip's thumbnail strip at their own shape, a
 * portrait clip as much as a widescreen one (see pictureSlots). Decorative: the frames repeat what
 * the player shows, so the lane is hidden from screen readers.
 */
export function PictureLane({
  className,
  stripUrl,
  clipSeconds,
  stepSeconds,
}: {
  className: string;
  stripUrl: string;
  clipSeconds: number;
  /** Seconds covered by each thumbnail in the strip (Project.stripStepSeconds). */
  stepSeconds: number;
}) {
  const lane = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLImageElement>(null);
  const [laneSize, setLaneSize] = useState<{ width: number; height: number } | null>(null);
  const [strip, setStrip] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = lane.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setLaneSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // The strip may finish loading before hydration, when React has not yet attached onLoad.
  useEffect(() => {
    const image = probe.current;
    if (image?.complete && image.naturalWidth)
      setStrip({ width: image.naturalWidth, height: image.naturalHeight });
  }, [stripUrl]);

  const slots =
    laneSize && strip
      ? pictureSlots({
          laneWidth: laneSize.width,
          laneHeight: laneSize.height,
          clipSeconds,
          stepSeconds,
          stripWidth: strip.width,
          stripHeight: strip.height,
        })
      : [];

  return (
    <div ref={lane} className={`${className} picture-lane`} aria-hidden="true">
      <img
        ref={probe}
        src={stripUrl}
        alt=""
        hidden
        onLoad={(e) =>
          setStrip({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })
        }
      />
      {slots.map((slot, i) => (
        <span key={i} className="picture-frame" style={{ left: slot.left, width: slot.width }}>
          <img src={stripUrl} alt="" draggable={false} style={slot.image} />
        </span>
      ))}
    </div>
  );
}
