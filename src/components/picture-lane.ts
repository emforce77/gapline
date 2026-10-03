/** One thumbnail drawn in the picture lane, in pixels from the lane's top left corner. */
export interface PictureSlot {
  left: number;
  width: number;
  /** The whole strip image, scaled so the slot's thumbnail covers the slot without stretching. */
  image: { left: number; top: number; width: number; height: number };
}

/**
 * The picture lane as a filmstrip: as many whole frames as fit the lane at its height, each the
 * strip thumbnail at the slot's middle moment, so the frames stay aligned with the ruler. The strip
 * (ingest.ts writeStrip) is one row of ceil(clip / step) thumbnails at the clip's own shape; each is
 * scaled to cover its slot, cropping at most about half a slot, never stretched.
 */
export function pictureSlots({
  laneWidth,
  laneHeight,
  clipSeconds,
  stepSeconds,
  stripWidth,
  stripHeight,
}: {
  laneWidth: number;
  laneHeight: number;
  clipSeconds: number;
  stepSeconds: number;
  stripWidth: number;
  stripHeight: number;
}): PictureSlot[] {
  if (laneWidth <= 0 || laneHeight <= 0 || stripWidth <= 0 || stripHeight <= 0) return [];
  const tiles = Math.ceil(clipSeconds / stepSeconds);
  const tileWidth = stripWidth / tiles;
  const frameWidth = (laneHeight * tileWidth) / stripHeight;
  const count = Math.max(1, Math.round(laneWidth / frameWidth));
  const edge = (i: number) => Math.round((i * laneWidth) / count);
  return Array.from({ length: count }, (_, i) => {
    const width = edge(i + 1) - edge(i);
    const scale = Math.max(width / tileWidth, laneHeight / stripHeight);
    const tile = Math.min(tiles - 1, Math.floor((((i + 0.5) / count) * clipSeconds) / stepSeconds));
    return {
      left: edge(i),
      width,
      image: {
        left: -tile * tileWidth * scale + (width - tileWidth * scale) / 2,
        top: (laneHeight - stripHeight * scale) / 2,
        width: stripWidth * scale,
        height: stripHeight * scale,
      },
    };
  });
}
