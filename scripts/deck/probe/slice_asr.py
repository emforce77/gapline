"""Recognize short slices of the Tears of Steel opening on their own, for the deck's evidence.

Why: Chirp 3's first pass on the whole clip put "We have main engine start." at 2.32-3.96 s, and
the gap it left at 4.21-6.59 s held Gapline's line L6. Recognizing each slice alone shows where the
words are. The same check covers the deck's "seven seconds" (53.72-60.88 s).

In:  runtime/projects/tos-opening/clip.mp4 (the clip Gapline heard), ffmpeg from $FFMPEG_PATH.
Out: runtime/deck/evidence/slice-asr.json -- per slice: its clip range and each word's clip time.
Model: faster-whisper "small" on CPU (int8), English, word timestamps, no VAD, no carried-over
text; the settings of the first probe (2026-09-23). Free and local.

Run: uv run --with faster-whisper==1.2.1 python scripts/deck/probe/slice_asr.py
"""

import hashlib
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel

REPO = Path(__file__).resolve().parents[3]
CLIP = REPO / "runtime/projects/tos-opening/clip.mp4"
OUT = REPO / "runtime/deck/evidence/slice-asr.json"
MODEL = "small"
SAMPLE_RATE = 16_000
# (from, to) in clip seconds. The first three are the probe's slices around the launch call; the
# last is the silence between "...locked." and "This is pretty freaky." as Chirp 3 timed them.
SLICES = [(1.8, 4.4), (4.4, 6.7), (6.7, 10.0), (53.72, 60.88)]
DIGITS = 2


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def decode_clip(ffmpeg: str) -> np.ndarray:
    """The whole soundtrack as 16 kHz mono float32, decoded once so slices are sample-exact."""
    pcm = subprocess.run(
        [
            ffmpeg,
            "-v",
            "error",
            "-i",
            str(CLIP),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "s16le",
            "-",
        ],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


def main() -> None:
    ffmpeg = os.environ.get("FFMPEG_PATH") or "ffmpeg"
    model = WhisperModel(MODEL, device="cpu", compute_type="int8")
    audio = decode_clip(ffmpeg)
    slices = []
    for start, end in SLICES:
        piece = audio[round(start * SAMPLE_RATE) : round(end * SAMPLE_RATE)]
        segments, _ = model.transcribe(
            piece,
            language="en",
            word_timestamps=True,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        words = [
            {
                "start": round(start + w.start, DIGITS),
                "end": round(start + w.end, DIGITS),
                "word": w.word.strip(),
                "probability": round(w.probability, DIGITS),
            }
            for s in segments
            for w in (s.words or [])
        ]
        slices.append({"from": start, "to": end, "words": words})
        print(f"{start}-{end} s:", " ".join(w["word"] for w in words) or "(no words)")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "source": f"faster-whisper {MODEL}, each slice recognized on its own",
                "producedBy": "scripts/deck/probe/slice_asr.py",
                "producedAt": datetime.now().astimezone().date().isoformat(),
                "clip": str(CLIP.relative_to(REPO)),
                "clipSha256": sha256(CLIP),
                "slices": slices,
            },
            indent=1,
        )
        + "\n"
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
