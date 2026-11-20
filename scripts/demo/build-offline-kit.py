# /// script
# requires-python = ">=3.10"
# dependencies = ["qrcode[pil]==8.2"]
# ///
"""From the repository root: uv run --env-file .env.local scripts/demo/build-offline-kit.py.

Package only the published screening excerpts, the original opening, two curated sample mixes, their reports and the
submission PDF. On the presentation laptop the unzipped kit only needs Python 3 and a browser.
"""

import os
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.request import urlopen
from zipfile import ZIP_STORED, ZipFile

import qrcode

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://scene-ad-117546381357.asia-northeast3.run.app"
SCREENING = SITE + "/screening"
RELEASE_PDF = (
    "https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-pitch.pdf"
)
SAMPLE = ROOT / "runtime/projects/tos-opening"
REPORT_URL = SITE + "/api/projects/tos-opening/runs/"
# Team-curated public sample pins on the serving revision on 2026-11-20.
RUNS = {
    "en": "edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f",
    "ko": "20260923t065852164-ko-standard-350b05",
}
MEDIA = (
    "launch-review.mp4", "launch-en.vtt", "launch-ko.vtt", "brain.jpg", "eyepiece.jpg",
    "english-line.m4a", "hanbid.mp4", "hanbid-en.vtt", "hanbid-ko.vtt",
)

GUIDE = """Gapline • Recorded screening kit • 20 November 2026

Unzip the archive first. In the extracted folder run one command and keep that window open.
Windows PowerShell (with the Python launcher): py -3 -m http.server 21966 --bind 127.0.0.1
macOS or Linux terminal (with Python 3): python3 -m http.server 21966 --bind 127.0.0.1
Open http://127.0.0.1:21966 in a browser that plays H.264 video, AAC audio and WebVTT.
Close the server with Ctrl+C after the presentation. If 21966 is busy, use a free port in both
the command and the browser address. No model calls, login, downloads or internet needed to play.

This kit plays recordings. Live generation, editing and interrupted-run recovery require the app.
The included PDF is the published submission deck, pending confirmation of the finals template.
Print screening-qr.png for visitors. The QR points to the public screening page and needs internet.
At the venue check the laptop audio output and listen for the original launch call under room noise.
Keep the phone hotspot available for the public site. Test the extracted kit before travel.

Sources
- Tears of Steel, Blender Foundation, https://mango.blender.org/ (CC BY 3.0).
  Gapline cut excerpts, synthesized original descriptions, mixed audio and added captions.
- Hanbid speaking Korean, Wikitongues / Teddy Nee, Wikimedia Commons (CC BY-SA 4.0).
  https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm
  Gapline's narrated excerpt remains CC BY-SA 4.0.
- Submission deck: RELEASE_PDF
- Source and reproduction: https://github.com/emforce77/gapline/tree/main/scripts/demo
"""


def fetch(url: str, *expected_types: str) -> bytes:
    with urlopen(url, timeout=45) as response:
        data = response.read()
        if response.headers.get_content_type() not in expected_types or not data:
            raise ValueError(f"Unexpected response for {url}")
        return data


def video(file: str, title: str, captions: str | None = None) -> str:
    tracks = ""
    if captions:
        tracks = (
            f'<track kind="captions" src="media/{captions}-en.vtt" srclang="en" label="English" default>'
            f'<track kind="captions" src="media/{captions}-ko.vtt" srclang="ko" label="한국어">'
        )
    return f'<video controls playsinline preload="metadata" aria-label="{title}" src="{file}">{tracks}</video>'


def screening_page() -> str:
    return f"""<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Gapline · Recorded screening</title>
<style>
*{{box-sizing:border-box}} body{{margin:2rem auto;padding:0 1rem;max-width:54rem;background:#faf9f6;color:#201e1b;font:1.05rem/1.55 system-ui,sans-serif}}
h1,h2{{line-height:1.2}} section{{margin-block:2.4rem}} video,audio,img{{width:100%;display:block}}
video{{background:black;max-height:65vh}} .frames{{display:flex;gap:.7rem}} figure{{margin:0;flex:1;min-width:0}}
figcaption{{font-size:.9rem}} a{{color:#714800}} summary{{cursor:pointer}} a:focus-visible,summary:focus-visible{{outline:3px solid #946300}}
</style><main><h1>Gapline · Recorded screening</h1>
<p><a href="submission-deck.pdf">Submission deck (PDF)</a> · <a href="README.txt">Setup and credits</a></p>
<section><h2>What does the display say?</h2><p>Listen for the pause after “locked.” Then play the same moment with description.</p>
<h3>Original soundtrack</h3><audio controls preload="none" aria-label="Original soundtrack in the seven-second window" src="media/opening-original.m4a"></audio>
<h3>With description</h3><audio controls preload="none" aria-label="Same window with English description" src="media/opening-described.m4a"></audio></section>
<section><h2>Can you hear the launch call?</h2>
<p>The first mix reads a production credit over the launch controller. Listen for “We have main engine start” when the same scene plays again.</p>
{video("media/launch-review.mp4", "Launch call, first and revised mix", "launch")}</section>
<section><h2>When does the eyepiece appear?</h2><div class="frames">
<figure><img src="media/brain.jpg" alt="Electrodes protrude from a brain."><figcaption>At the start of the line</figcaption></figure>
<figure><img src="media/eyepiece.jpg" alt="A man with a robotic eyepiece leans above the brain."><figcaption>Later in the shot</figcaption></figure></div>
<p>Hear the original line, followed by the producer’s edit at the same starting frame.</p>
<audio controls preload="none" aria-label="English line before and after the edit" src="media/english-line.m4a"></audio></section>
<section><h2>A pause in Hanbid’s interview</h2>
{video("media/hanbid.mp4", "Interview with Korean audio description", "hanbid")}</section>
<section><h2>The complete opening with description</h2>
<h3>English</h3>{video("sample-en.mp4", "Complete opening with revised English description")}
<a href="review-en.txt">English line review</a>
<h3>한국어</h3>{video("sample-ko.mp4", "Complete opening with Korean description")}
<a href="review-ko.txt" lang="ko">한국어 문장별 검수 보고서</a></section></main></html>
"""


def main() -> None:
    output = ROOT / "runtime/finalist-offline"
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output) as scratch:
        temp = Path(scratch)
        qr = temp / "screening-qr.png"
        qrcode.make(SCREENING, box_size=18, border=4).save(qr)
        archive = temp / "gapline-offline.zip"
        with ZipFile(archive, "w", compression=ZIP_STORED) as kit:
            for filename in MEDIA:
                kit.write(ROOT / "public/screening-media" / filename, "media/" + filename)
            # Python's simple HTTP server does not reliably seek MP4 fragments across browsers.
            # Cut the exact listening window once, so an offline play always starts at "locked."
            for version, source in (
                ("original", SAMPLE / "clip.mp4"),
                ("described", SAMPLE / "runs" / RUNS["en"] / "described.mp4"),
            ):
                audio = temp / f"opening-{version}.m4a"
                subprocess.run([
                    os.environ.get("FFMPEG_PATH") or "ffmpeg", "-v", "error", "-nostdin",
                    "-ss", "49.5", "-i", str(source), "-t", "7", "-map", "0:a:0",
                    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(audio),
                ], check=True)
                kit.write(audio, "media/" + audio.name)
            for language, run in RUNS.items():
                kit.write(SAMPLE / "runs" / run / "described.mp4", f"sample-{language}.mp4")
                report = fetch(f"{REPORT_URL}{run}?download=review&lang={language}", "text/plain")
                kit.writestr(f"review-{language}.txt", report)
            pdf = fetch(RELEASE_PDF, "application/pdf", "application/octet-stream")
            if not pdf.startswith(b"%PDF-"):
                raise ValueError("Release asset does not have a PDF header")
            kit.writestr("submission-deck.pdf", pdf)
            kit.write(qr, qr.name)
            kit.writestr("index.html", screening_page())
            guide = GUIDE.replace("RELEASE_PDF", RELEASE_PDF)
            kit.writestr("README.txt", guide + "\nPublic sample runs\n" + "\n".join(RUNS.values()))
        archive.replace(output / archive.name)
        qr.replace(output / qr.name)
    print(output / "gapline-offline.zip")


if __name__ == "__main__":
    main()
