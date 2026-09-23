/**
 * 10. A failure we found and fixed, on the first eleven seconds of the opening, drawn to one seconds
 * scale: the soundtrack's spectrogram (the voice is visible), the words as a second recognizer hears
 * them slice by slice, Chirp 3's first pass with the launch call two seconds early and the silence it
 * left, and the line Scene wrote into that silence, removed by an editor. Under it, the fix and
 * plainly how far it has been tested.
 */
import { MIN_GAP_SECONDS } from "../../../src/lib/pipeline/gaps";
import { RELISTEN_PADDING_SECONDS } from "../../../src/lib/pipeline/relisten";
import { launchCall as lc, OPENING_SPAN } from "../data/recognizers";
import { dayMonthYear, esc, intro, px, REJECT_MARK, secs, slide } from "../html";
import { notesFor } from "../notes";
import { LAUNCH_SPECTROGRAM, spectrogramUrl, VOICE_BAND_HZ } from "../spectrogram";
import { MARGIN, W } from "../theme";

const X0 = 440;
const X1 = W - MARGIN;
const Y = {
  spec: 258,
  words: 452,
  slices: 490,
  chirp: 590,
  chirpText: 634,
  line: 688,
  lineText: 732,
  axis: 790,
  fix: 862,
};
const LANE_H = 36;
/** Space left between two slices drawn side by side, so each reads as its own piece. */
const SLICE_SEP = 4;
/** Where the arrow from Chirp 3's placement turns towards the words' true place. */
const ARROW_Y = 552;
const AXIS_LABEL_STEP_S = 2;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five"];

const pps = (X1 - X0) / (OPENING_SPAN[1] - OPENING_SPAN[0]);
const x = (t: number) => X0 + (t - OPENING_SPAN[0]) * pps;
const mid = (s: { start: number; end: number }) => (x(s.start) + x(s.end)) / 2;
/** SVG path coordinates: plain numbers, two decimals. */
const n2 = (v: number) => Math.round(v * 100) / 100;
/** Seconds as the notes write a span: "4.40–6.16 s". */
const range = (s: { start: number; end: number }) => `${s.start.toFixed(2)}–${secs(s.end)}`;

export function caughtSlide(): string {
  const note = notesFor(10, "Our recognizer put a launch call…");
  if (
    LAUNCH_SPECTROGRAM.from !== OPENING_SPAN[0] ||
    LAUNCH_SPECTROGRAM.to !== OPENING_SPAN[1] ||
    Math.abs(LAUNCH_SPECTROGRAM.width - (X1 - X0)) > 1
  )
    throw new Error("the spectrogram is not drawn to the slide's seconds scale");
  const early = NUMBER_WORDS[Math.round(lc.early)];
  if (!early) throw new Error(`no word for ${lc.early} s`);
  const line = lc.line;
  const removedOn = dayMonthYear(
    new Date(line.at).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }),
  );

  const sliceNote = note(
    `A second recognizer (${esc(lc.source)}, on a CPU) on ${lc.slices.map((s) => `${s.from.toFixed(2)}–${s.to.toFixed(2)}`).join(", ")} s of the clip, ${dayMonthYear(lc.checkedAt)}. On the whole clip it puts the call at ${range(lc.wholeClip)}. Above: the clip’s soundtrack, 0–${VOICE_BAND_HZ / 1000} kHz (ffmpeg); stacked harmonics are a voice.`,
  );
  const chirpNote = note(
    `Chirp 3’s first pass put the call’s words on ${range(lc.chirp)}, where the slices find “${esc(lc.slices[0].text)}”, and heard nothing from ${lc.gap.start} to ${secs(lc.gap.end)}. Scene’s own watch pass labelled ${lc.watchLabel.start}–${secs(lc.watchLabel.end)} “${esc(lc.watchLabel.label)}”, but as ambience, which blocks nothing.`,
  );
  const lineNote = note(
    `Scene wrote the title card into that silence at ${secs(line.start)}, voiced ${secs(line.voiced)}; it passed review and played over the call. An editor removed it on ${removedOn}.`,
  );
  const fixNote = note(
    `Since 23 Sep 2026, before any line is written, Scene recognizes each silence of ${MIN_GAP_SECONDS} s or more again on its own, with ${RELISTEN_PADDING_SECONDS} s of audio either side; words it finds close the silence. A unit test gives it this case with the slices’ timing: the silence closes and the line is not placed. Not yet run with Chirp 3 on real audio; the sample track was fixed by hand.`,
  );

  const spectrogram = `<img class="still" src="${spectrogramUrl(LAUNCH_SPECTROGRAM)}" alt="" style="left:${X0}px;top:${Y.spec}px;width:${LAUNCH_SPECTROGRAM.width}px;height:${LAUNCH_SPECTROGRAM.height}px">`;
  const call = lc.slices.find((s) => s.start === lc.heard.start);
  if (!call) throw new Error("the launch call is not one of the slices");
  // Each slice's words sit above them; the call carries its times, so the words of the slice after
  // it move below their lane, clear of the call's times.
  const after = lc.slices.filter((s) => s.from >= call.to);
  const sliceWords = lc.slices
    .map((s) => {
      if (s === call)
        return `<p class="cg-said key" style="left:${px(x(s.start))};top:${Y.words}px">${esc(s.text)}<span class="mono">${range(s)}</span></p>`;
      const top = after.includes(s) ? Y.slices + LANE_H + 6 : Y.words;
      return `<p class="cg-said" style="left:${px(x(s.start))};top:${top}px">${esc(s.text)}</p>`;
    })
    .join("");
  const sliceLane = lc.slices
    .map(
      (s) =>
        `<div class="lane" style="left:${px(x(s.from))};width:${px(x(s.to) - x(s.from) - SLICE_SEP)};top:${Y.slices}px;height:${LANE_H}px">${s.words
          .map(
            (w) =>
              `<div class="clip dialogue" style="left:${px(x(w.start) - x(s.from))};width:${px(Math.max((w.end - w.start) * pps, 2))}"></div>`,
          )
          .join("")}</div>`,
    )
    .join("");
  const chirpLane = lc.chirpSpeech
    .map(
      (s) =>
        `<div class="clip dialogue" style="left:${px(x(s.start) - X0)};width:${px(Math.max((s.end - s.start) * pps, 2))}"></div>`,
    )
    .join("");
  const gapBox = `<div class="cg-gap" style="left:${px(x(lc.gap.start) - X0)};width:${px(lc.gap.seconds * pps)}"><span>looked silent</span></div>`;
  const arrow = `<svg class="cg-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">
  <defs><marker id="cg-h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#ece9e3"/></marker></defs>
  <path d="M${n2(mid(lc.chirp))} ${Y.chirp - 4} V${ARROW_Y} H${n2(mid(lc.heard))} V${Y.slices + LANE_H + 8}" class="cg-arrow" marker-end="url(#cg-h)"/>
</svg>`;
  const lineBar =
    `<div class="room" style="left:${px(x(line.start) - X0)};width:${px((line.windowEnd - line.start) * pps)}"></div>` +
    `<div class="clip ad" style="left:${px(x(line.start) - X0)};width:${px(line.voiced * pps)}"></div>` +
    `<div class="cg-strike" style="left:${px(x(line.start) - X0 - 6)};width:${px((line.windowEnd - line.start) * pps + 12)}"></div>`;
  const ticks = Array.from(
    { length: OPENING_SPAN[1] - OPENING_SPAN[0] + 1 },
    (_, i) => OPENING_SPAN[0] + i,
  )
    .map((t) => {
      const tick = `<div class="cg-tick" style="left:${px(x(t))}"></div>`;
      if (t === OPENING_SPAN[1])
        return `${tick}<p class="cg-t" style="right:${px(W - x(t))}">${t} s</p>`;
      if (t % AXIS_LABEL_STEP_S !== 0) return tick;
      return `${tick}<p class="cg-t" style="left:${px(x(t))};transform:translateX(-50%)">${t}</p>`;
    })
    .join("");
  const head = (top: number, label: string, sub = "") =>
    `<div class="cg-head" style="top:${top}px;height:${LANE_H}px"><p class="label">${label}</p>${sub ? `<p class="cg-sub">${sub}</p>` : ""}</div>`;

  return slide({
    id: "s-caught",
    name: "caught",
    folio: 10,
    kind: "exhibit",
    body: `
${intro(`Our recognizer put a launch call ${early} seconds early. We caught it.`, undefined, 1500)}
${spectrogram}
<div class="cg-head" style="top:${Y.spec}px;height:${LANE_H * 5}px"><p class="label">Sound</p><p class="cg-sub">voice band</p></div>
${sliceWords}
${head(Y.slices, `Each slice alone${sliceNote}`)}
${sliceLane}
${arrow}
<p class="cg-early" style="left:${px(mid(lc.chirp) + 14)};top:${ARROW_Y - 36}px">${secs(lc.early)} early</p>
${head(Y.chirp, `Chirp 3, whole clip${chirpNote}`)}
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.chirp}px;height:${LANE_H}px">${chirpLane}${gapBox}</div>
<p class="cg-said" style="left:${px(x(lc.chirp.start))};top:${Y.chirpText}px">${esc(lc.text)}<span class="mono">${range(lc.chirp)}</span></p>
${head(Y.line, "Scene’s line")}
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.line}px;height:${LANE_H}px">${lineBar}</div>
<p class="verdict cg-removed" style="left:${px(x(line.windowEnd) + 24)};top:${Y.line}px;line-height:${LANE_H}px">${REJECT_MARK}<span>removed by an editor${lineNote}</span></p>
<p class="cg-line" style="left:${px(x(line.start))};top:${Y.lineText}px"><del class="strike" lang="ko">${esc(line.text)}</del> <span>${esc(line.gloss)}</span><span class="mono">${range({ start: line.start, end: line.start + line.voiced })}</span></p>
<div class="cg-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<div class="cg-fix" style="left:${MARGIN}px;top:${Y.fix}px;width:${W - 2 * MARGIN}px">
  <p class="label">The fix</p>
  <p class="body">Scene now re-listens to every silence on its own before it writes into it. A test replays this case; it has not run on real audio yet.${fixNote}</p>
</div>`,
  });
}

export const CAUGHT_CSS = `
.cg-head { position:absolute; left:${MARGIN}px; width:${X0 - MARGIN - 24}px; display:flex; flex-direction:column; justify-content:center; }
.cg-head .label { white-space:nowrap; }
.cg-sub { font-size:24px; line-height:1.3; color:var(--ink-400); }
.cg-said { position:absolute; font-size:24px; line-height:30px; color:var(--ink-300); white-space:nowrap; }
.cg-said.key { color:var(--ink-100); font-weight:600; }
.cg-said .mono, .cg-line .mono { margin-left:14px; font-size:24px; font-weight:400; color:var(--ink-300); }
.cg-gap { position:absolute; top:0; height:100%; background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.5);
  border-radius:3px; display:flex; align-items:center; }
.cg-gap span { padding-left:12px; font-size:22px; font-weight:500; color:var(--ink-100); white-space:nowrap; }
.cg-svg { position:absolute; left:0; top:0; }
.cg-arrow { fill:none; stroke:var(--ink-100); stroke-width:2; }
.cg-early { position:absolute; font-size:24px; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cg-strike { position:absolute; top:50%; height:3px; margin-top:-1.5px; background:var(--ink-100); }
.cg-removed { position:absolute; white-space:nowrap; }
.cg-line { position:absolute; font-size:24px; line-height:30px; color:var(--ink-100); white-space:nowrap; }
.cg-line span { margin-left:12px; color:var(--ink-300); }
.cg-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.cg-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.cg-t { position:absolute; top:16px; font-size:24px; color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.cg-fix { position:absolute; display:grid; grid-template-columns:200px 1fr; column-gap:24px; border-top:1px solid var(--rule); padding-top:18px; }
.cg-fix .label { padding-top:6px; }
.cg-fix .body { font-size:30px; line-height:1.4; color:var(--ink-100); }
`;
