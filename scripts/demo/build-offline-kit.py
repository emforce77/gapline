# /// script
# requires-python = ">=3.10"
# dependencies = ["qrcode[pil]==8.2"]
# ///
"""From the repository root: uv run --env-file .env.local scripts/demo/build-offline-kit.py.

Build the production app first: NEXT_DIST_DIR=.next-verify npm run build
Pass --dist-dir .next to select a different local standalone build. Packaging and playback use local files.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

import qrcode

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://scene-ad-117546381357.asia-northeast3.run.app"
SCREENING = SITE + "/screening"
RELEASE_PDF = (
    "https://github.com/emforce77/gapline/releases/download/v0.2.0-preview/gapline-pitch.pdf"
)
SAMPLE = ROOT / "runtime/projects/tos-opening"
AUTO_EN = "20260928t064307205-en-standard-221ceb"
RELEASE_PDF_SHA = "5ab24d08facbf173cbf9985bc7a5c955bffe02d51fad35390d1b0dec7de19875"
# Team-curated public sample pins on the serving revision on 2026-11-20.
RUNS = {
    "en": "edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f",
    "ko": "20260923t065852164-ko-standard-350b05",
}
MEDIA = (
    "launch-review.mp4", "launch-en.vtt", "launch-ko.vtt", "brain.jpg", "eyepiece.jpg",
    "english-line.m4a", "english-original.m4a", "english-edited.m4a", "hanbid.mp4", "hanbid-en.vtt", "hanbid-ko.vtt",
)

GUIDE = """Gapline · 결선 오프라인 키트

ZIP을 쓰기 가능한 폴더에 모두 푼 뒤 사용하세요. H.264/AAC와 WebVTT를 지원하는 브라우저가 필요합니다.

Gapline 앱 열기
이 ZIP의 앱 빌드 환경은 BUILD_TARGET입니다. 행사 전에 Node.js를 설치하세요.
Linux x64 빌드에는 이 환경용 네이티브 이미지 라이브러리가 들어 있습니다. Windows/macOS 기본 Node 실행은
현장 기기에서 확인해야 합니다. 앱을 열어 영상·편집기까지 확인하세요. Windows x64 노트북에서 Linux판을
사용하려면 미리 설치한 WSL2 x64 Linux와 해당 환경의 Node.js로 아래 명령을 실행하세요.
압축 해제 폴더의 터미널에서 node start-offline.cjs 를 실행하세요. npm 설치, 계정, API 키, 인터넷은 필요 없습니다.
상영 페이지 http://127.0.0.1:21969/screening
편집 작업공간 http://127.0.0.1:21969/p/tos-opening
포트가 사용 중이면 node start-offline.cjs 21970 으로 바꾸고 출력된 주소를 사용하세요. 종료는 Ctrl+C입니다.
저장된 영어 자동본·영어 수정본·한국어 자동본, 원본·해설 영상, 문장별 음성·검수 보고서와 편집 기록을 볼 수 있습니다.
편집기에서 문장 및 시작 시각의 초안을 바꾸고 장면을 비교할 수 있습니다. 초안은 새 결과로 저장되지 않습니다.
업로드, 새 생성, 재합성·저장, 중단 작업 복구, 외부 링크는 온라인 서비스에서 사용하세요.

녹화 상영만 열기
Node.js나 호환 환경이 없으면 압축 해제 폴더에서 아래 명령을 실행하고 http://127.0.0.1:21966 을 여세요.
Windows PowerShell (Python 3 설치): py -3 -m http.server 21966 --bind 127.0.0.1
macOS / Linux 터미널 (Python 3 설치): python3 -m http.server 21966 --bind 127.0.0.1
이 경로로는 저장 영상, 음성, 검수 보고서, 덱을 볼 수 있습니다. 작업공간은 위의 앱 서버를 실행해야 열립니다.
인쇄용 screening-qr.png는 인터넷이 필요한 공개 상영 주소입니다. 행사장에서 스피커로 발사 안내 방송을 확인하세요.
동봉한 제출용 PDF는 기존 공개본이며 결선 템플릿 확정 전입니다.

Sources
- Tears of Steel, Blender Foundation, https://mango.blender.org/ (CC BY 3.0).
  Gapline cut excerpts, synthesized original descriptions, mixed audio and added captions.
- Hanbid speaking Korean, Wikitongues / Teddy Nee, Wikimedia Commons (CC BY-SA 4.0).
  https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm
  Gapline's narrated excerpt remains CC BY-SA 4.0.
- Submission deck: RELEASE_PDF
- Source and reproduction: https://github.com/emforce77/gapline/tree/main/scripts/demo
"""


def add_app(kit: ZipFile, dist: Path) -> dict:
    standalone = dist / "standalone"
    built = standalone / dist.name
    manifest = json.loads((built / "required-server-files.json").read_text())
    if manifest["config"]["env"]:
        raise ValueError("The offline build needs an empty next.config env")
    if (built / "BUILD_ID").read_bytes() != (dist / "BUILD_ID").read_bytes():
        raise ValueError("Standalone and static build IDs differ")
    if not (dist / "static" / "chunks").is_dir():
        raise FileNotFoundError(f"Missing client chunks in {dist}/static")
    kit.write(standalone / "server.js", "app/server.js")
    kit.write(standalone / "package.json", "app/package.json")
    # The tracer can also copy .env.local, source files, deployment configs and runtime data.
    # Ship only Next's compiled server, its selected modules and the matching browser bundle.
    for source, target in (
        (built, f"app/{dist.name}"),
        (dist / "static", f"app/{dist.name}/static"),
        (standalone / "node_modules", "app/node_modules"),
    ):
        for file in sorted(source.rglob("*")):
            if not file.is_file():
                continue
            relative = file.relative_to(source)
            if source == built and relative.parts[0] == "static":
                continue
            if any(part.startswith(".env") for part in relative.parts) or file.suffix in {".pem", ".key", ".p12", ".pfx"}:
                raise ValueError(f"Unexpected credential file in standalone input: {relative}")
            if not file.resolve().is_relative_to(source.resolve()):
                raise ValueError(f"File points outside build: {relative}")
            kit.write(file, f"{target}/{relative.as_posix()}", compress_type=ZIP_DEFLATED)
    for filename in ("favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png", "robots.txt"):
        kit.write(ROOT / "public" / filename, f"app/public/{filename}")
    for filename in MEDIA:
        kit.write(ROOT / "public/screening-media" / filename, f"app/public/screening-media/{filename}")
    target = json.loads(subprocess.check_output([
        "node", "-p", "JSON.stringify({platform:process.platform,arch:process.arch,node:process.version})",
    ]))
    kit.writestr("build-target.json", json.dumps(target))
    kit.write(ROOT / "scripts/demo/start-offline.cjs", "start-offline.cjs")
    return target


def add_sample(kit: ZipFile) -> None:
    project = json.loads((SAMPLE / "project.json").read_text())
    if project["id"] != SAMPLE.name or project["kind"] != "sample" or "ownerHash" in project:
        raise ValueError("Expected the public Tears of Steel sample")
    kit.writestr("runtime/showcase.json", json.dumps({"projectId": SAMPLE.name, "runs": RUNS}))
    def add(file: Path) -> None:
        if not file.resolve().is_relative_to(SAMPLE.resolve()):
            raise ValueError(f"File points outside public sample: {file.name}")
        kit.write(file, "runtime/projects/tos-opening/" + file.relative_to(SAMPLE).as_posix())
    for name in ("project.json", "analysis.json", "clip.mp4", "poster.jpg", "strip.jpg"):
        add(SAMPLE / name)
    for run_id in [AUTO_EN, *RUNS.values()]:
        run = SAMPLE / "runs" / run_id
        if any((run / f).exists() for f in ("owner.json", "editor.json")):
            raise ValueError(f"Run {run_id} is private")
        for name in ("script.json", "events.jsonl", "described.mp4", "descriptions.vtt", "narration.wav"):
            add(run / name)
        for cue in json.loads((run / "script.json").read_text())["cues"]:
            if audio := cue.get("audioFile"):
                if not re.fullmatch(r"voice/L[0-9]+\.wav", audio):
                    raise ValueError(f"Unexpected public audio path: {audio}")
                add(run / audio)


def video(file: str, title: str, captions: str | None = None) -> str:
    tracks = ""
    if captions:
        tracks = (
            f'<track kind="captions" src="app/public/screening-media/{captions}-en.vtt" srclang="en" label="English" default>'
            f'<track kind="captions" src="app/public/screening-media/{captions}-ko.vtt" srclang="ko" label="한국어">'
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
<p><a href="submission-deck.pdf">Submission deck (PDF)</a> · <a href="README.txt">Setup and credits</a> · <a href="http://127.0.0.1:21969/p/tos-opening">Open the local workspace (start Node first)</a></p>
<section><h2>What does the display say?</h2><p>Listen for the pause after “locked.” Then play the same moment with description.</p>
<h3>Original soundtrack</h3><audio controls preload="none" aria-label="Original soundtrack in the seven-second window" src="media/opening-original.m4a"></audio>
<h3>With description</h3><audio controls preload="none" aria-label="Same window with English description" src="media/opening-described.m4a"></audio></section>
<section><h2>Can you hear the launch call?</h2>
<p>The first mix reads a production credit over the launch controller. Listen for “We have main engine start” when the same scene plays again.</p>
{video("app/public/screening-media/launch-review.mp4", "Launch call, first and revised mix", "launch")}</section>
<section><h2>When does the eyepiece appear?</h2><p>Listen to the first line, then compare the two frames.</p>
<audio controls preload="none" aria-label="Original English line" src="app/public/screening-media/english-original.m4a"></audio><div class="frames">
<figure><img src="app/public/screening-media/brain.jpg" alt="Electrodes protrude from a brain."><figcaption>At the start of the line</figcaption></figure>
<figure><img src="app/public/screening-media/eyepiece.jpg" alt="A man with a robotic eyepiece leans above the brain."><figcaption>Later in the shot</figcaption></figure></div>
<p>Now listen to the producer’s edit at the same starting frame.</p>
<audio controls preload="none" aria-label="Edited English line" src="app/public/screening-media/english-edited.m4a"></audio></section>
<section><h2>A pause in Hanbid’s interview</h2>
{video("app/public/screening-media/hanbid.mp4", "Interview with Korean audio description", "hanbid")}</section>
<section><h2>The complete opening with description</h2>
<h3>English</h3>{video("runtime/projects/tos-opening/runs/" + RUNS["en"] + "/described.mp4", "Complete opening with revised English description")}
<a href="review-en.txt">English line review</a>
<h3>한국어</h3>{video("runtime/projects/tos-opening/runs/" + RUNS["ko"] + "/described.mp4", "Complete opening with Korean description")}
<a href="review-ko.txt" lang="ko">한국어 문장별 검수 보고서</a></section></main></html>
"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist-dir", type=Path, default=Path(".next-verify"))
    args = parser.parse_args()
    dist = (ROOT / args.dist_dir).resolve()
    output = ROOT / "runtime/finalist-offline"
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output) as scratch:
        temp = Path(scratch)
        qr = temp / "screening-qr.png"
        qrcode.make(SCREENING, box_size=18, border=4).save(qr)
        archive = temp / "gapline-offline.zip"
        with ZipFile(archive, "w", compression=ZIP_STORED) as kit:
            target = add_app(kit, dist)
            add_sample(kit)
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
                report = subprocess.check_output([
                    "node", "--import", "tsx", "scripts/demo/offline-report.ts", language, run,
                ], cwd=ROOT, env={**os.environ, "DATA_DIR": str(SAMPLE.parents[1]), "DATA_BUCKET": ""})
                kit.writestr(f"review-{language}.txt", report)
            pdf = (ROOT / "runtime/pitch/gapline-pitch.pdf").read_bytes()
            if hashlib.sha256(pdf).hexdigest() != RELEASE_PDF_SHA:
                raise ValueError("Local submission deck differs from the pinned release PDF")
            kit.writestr("submission-deck.pdf", pdf)
            kit.write(qr, qr.name)
            kit.writestr("index.html", screening_page())
            platform = f'{target["platform"]}/{target["arch"]}, Node.js {target["node"]}'
            guide = GUIDE.replace("RELEASE_PDF", RELEASE_PDF).replace("BUILD_TARGET", platform)
            kit.writestr("README.txt", guide + "\nPublic sample runs\n" + "\n".join([AUTO_EN, *RUNS.values()]))
        archive.replace(output / archive.name)
        qr.replace(output / qr.name)
    print(output / "gapline-offline.zip")


if __name__ == "__main__":
    main()
