import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SPEC } from "../scripts/deck/data/deploy";
import { line as sampleLine, run as sampleRun } from "../scripts/deck/data/sample";
import { SUBMISSION } from "../scripts/deck/facts";
import { assDocument, CAPTION_CHARS, captionGroups, sayEvent } from "../scripts/demo/ass";
import { HEIGHT, MAX_SECONDS } from "../scripts/demo/config";
import { film, GEMINI_NAME, tenths } from "../scripts/demo/facts";
import { labels } from "../scripts/demo/labels";
import { PAGES } from "../scripts/demo/pages/index";
import { buildStoryboard, LISTEN, type PageId, type Scene } from "../scripts/demo/storyboard";
import { MIN_CAPTION_S, planScene, READING_CPS, readingSeconds } from "../scripts/demo/timing";
import { formatSeconds, toRecordedSeconds } from "../src/lib/format";

const lines = (text: string, lang: "en" | "ko") => captionGroups(text, lang).flat();
const LANGS = ["en", "ko"] as const;

describe("captionGroups", () => {
  it("keeps a two-word name on one line and never ends a line on an article", () => {
    const text =
      "In September, Korea's Supreme Court confirmed that the three big cinema chains discriminate when films lack audio description and captions.";
    const all = lines(text, "en");
    assert.ok(all.every((l) => l.length <= CAPTION_CHARS.en));
    assert.ok(all.some((l) => l.includes("Supreme Court")));
    assert.ok(all.every((l) => !/ (the|of|and)$/.test(l)));
    assert.equal(all.join(" "), text);
  });

  it("changes caption at a clause end rather than inside a noun phrase", () => {
    const text =
      "In this 65-second clip, that leaves 6 usable silences, the shortest only 2.1 seconds.";
    const groups = captionGroups(text, "en");
    assert.equal(groups.length, 2);
    assert.match(groups[0].join(" "), /silences,$/);
  });

  it("starts the second line with a conjunction rather than split a phrase", () => {
    assert.deepEqual(
      captionGroups("Gapline rewrites it from the review's fix and reviews it again.", "en"),
      [["Gapline rewrites it from the review's fix", "and reviews it again."]],
    );
  });

  it("keeps a Korean number with its counter and a bound word with its noun", () => {
    const rule = lines("그리고 가이드라인의 규칙 8가지로 모든 문장을 검수합니다.", "ko");
    assert.ok(rule.some((l) => l.includes("규칙 8가지로")));
    const bound = lines("시작 시각은 같은 침묵 안에서만 옮길 수 있습니다.", "ko");
    assert.ok(bound.some((l) => l.includes("침묵 안에서만")));
    assert.ok([...rule, ...bound].every((l) => l.length <= CAPTION_CHARS.ko));
  });

  it("uses groups given by hand, and refuses ones that do not read as the sentence or fit", () => {
    const text =
      "Speech-to-Text finds the words, Gemini watches, writes and reviews, and Text-to-Speech speaks.";
    const groups = [
      ["Speech-to-Text finds the words,", "Gemini watches, writes and reviews,"],
      ["and Text-to-Speech speaks."],
    ];
    assert.deepEqual(captionGroups(text, "en", groups), groups);
    assert.throws(() => captionGroups(text, "en", [["Speech-to-Text finds the words,"]]));
    assert.throws(() => captionGroups(text, "en", [[text]]));
  });
});

describe("caption geometry", () => {
  const TITLE_SAFE_PX = Math.round(HEIGHT * 0.05);
  const positions = (rows: string[]) => rows.map((r) => Number(/\\pos\(\d+,(\d+)\)/.exec(r)?.[1]));

  it("writes each line as its own event, 60 px apart, the last on the title-safe line", () => {
    const two = sayEvent({ start: 1, end: 3, lines: ["First line", "second line."] });
    assert.deepEqual(positions(two.rows!), [HEIGHT - TITLE_SAFE_PX - 60, HEIGHT - TITLE_SAFE_PX]);
    assert.ok(two.rows!.every((r) => r.includes("\\b600") && r.includes("\\an2")));
    const one = sayEvent({ start: 3, end: 5, lines: ["One line."] });
    assert.deepEqual(positions(one.rows!), [HEIGHT - TITLE_SAFE_PX]);
    const dialogues = assDocument([two, one])
      .split("\n")
      .filter((l) => l.startsWith("Dialogue:"));
    assert.equal(dialogues.length, 3);
    assert.match(assDocument([two]), /Style: Say,Pretendard,50,/);
  });
});

describe("caption timing", () => {
  const scene: Scene = {
    id: "test",
    show: { page: "cloud" },
    parts: [
      {
        caption: {
          en: "Speech-to-Text times the words, Gemini watches, writes and reviews, and Text-to-Speech voices each line.",
          ko: "음성 인식이 단어의 시각을 재고, 제미나이가 보고 쓰고 검수하고, 음성 합성이 문장을 읽습니다.",
        },
      },
      { pause: 1.5 },
      { caption: { en: "Try it.", ko: "해 보세요." } },
    ],
    hold: 1,
  };

  it("gives every caption its reading time, back to back, never under the minimum", () => {
    const plan = planScene(scene, "en");
    const shown = plan.parts.flatMap((p) => p.captions ?? []);
    assert.ok(shown.length >= 3);
    for (const [i, c] of shown.entries()) {
      assert.ok(c.end - c.start >= MIN_CAPTION_S);
      assert.ok(c.lines.join(" ").length / (c.end - c.start) <= READING_CPS.en);
      if (i > 0 && plan.parts[0].captions!.includes(c)) assert.equal(c.start, shown[i - 1].end);
    }
    assert.ok(Math.abs(shown.at(-1)!.end - shown.at(-1)!.start - MIN_CAPTION_S) < 1e-9);
  });

  it("keys the picture to sentence starts and keeps pauses as they are", () => {
    const plan = planScene(scene, "ko");
    const [first, gap, last] = plan.parts;
    assert.deepEqual(plan.captionStarts, [first.start, last.start]);
    assert.equal(gap.seconds, 1.5);
    assert.equal(last.start, gap.start + gap.seconds);
    assert.equal(plan.seconds, last.start + last.seconds + scene.hold);
    assert.equal(readingSeconds(["해 보세요."], "ko"), MIN_CAPTION_S);
  });
});

describe("the film's storyboard", () => {
  const scenes = buildStoryboard();
  const sentences = (lang: (typeof LANGS)[number]) =>
    scenes.flatMap((s) => s.parts.flatMap((p) => ("caption" in p ? [p.caption[lang]] : [])));

  for (const lang of LANGS)
    it(`fits every ${lang} caption to its lines and pace, and the film under ${MAX_SECONDS} s`, () => {
      let total = 0;
      for (const scene of scenes) {
        const plan = planScene(scene, lang);
        total += plan.seconds;
        for (const c of plan.parts.flatMap((p) => p.captions ?? [])) {
          assert.ok(c.lines.length <= 2, c.lines.join(" / "));
          assert.ok(
            c.lines.every((l) => l.length <= CAPTION_CHARS[lang]),
            c.lines.join(" / "),
          );
          assert.ok(c.lines.join(" ").length / (c.end - c.start) <= READING_CPS[lang] + 1e-9);
        }
      }
      assert.ok(total < MAX_SECONDS, `planned ${total.toFixed(1)} s`);
    });

  it("gives each app scene the sentences its recording keys to", () => {
    const shape = (id: string) =>
      scenes
        .find((s) => s.id === id)!
        .parts.map((p) => ("caption" in p ? "c" : "pause" in p ? "p" : "f"))
        .join("");
    assert.equal(shape("upload"), "cpc");
    assert.equal(shape("replay"), "pccc");
    assert.equal(shape("review"), "pccc");
    assert.equal(shape("result"), "ccp");
    assert.equal(shape("edit"), "cpc");
  });

  it("states the default and offers the edit once, with no defensive negatives", () => {
    const en = sentences("en");
    const ko = sentences("ko");
    const negatives =
      /no one|no edits|0 edits|unattended|without an editor|in the loop|사람은|개입 없이|편집자/i;
    assert.deepEqual(
      [...en, ...ko].filter((s) => negatives.test(s)),
      [],
    );
    assert.equal(en.filter((s) => /\bedit\b/i.test(s)).length, 1);
    assert.equal(ko.filter((s) => s.includes("직접 고칠")).length, 1);
    assert.ok(en.some((s) => s.startsWith("One press of Generate")));
  });

  it("claims no more than the sample shows (2026-09-23 verification)", () => {
    // The sample has 2 or 3 lines in some silences, its final check added no line, an edit reviews
    // the whole track, the screen shows the title in English, not the line's gloss, and the writer
    // and the reviewer are one model with separate instructions (2026-09-23 re-verification).
    const overclaims =
      /one line for each silence|fixes what it finds|re-checks just that line|words on screen|second Gemini|침묵마다 한 문장|스스로 고칩니다|두 번째 제미나이/i;
    assert.deepEqual(
      [...sentences("en"), ...sentences("ko")].filter((s) => overclaims.test(s)),
      [],
    );
  });

  it("names each thing one way in Korean: 낭독 for voicing, 최종 점검 for the final check", () => {
    // 음성 stays only in the service names (음성 인식, 음성 합성).
    const retired = /음성(?! 인식| 합성)|재합성|녹음|최종 내용 확인|보완/;
    assert.deepEqual(
      sentences("ko").filter((s) => retired.test(s)),
      [],
    );
  });

  it("captions the result line's seconds as the app's fit meter prints them", () => {
    // The owner saw "Spoken 3.7 s" on the meter under a caption saying 3.6 (2026-09-29): the line
    // records 3.65 s, which toFixed(1) rounds down and the app rounds up.
    assert.equal(tenths(3.65), "3.7");
    const cue = sampleRun.cues.find((c) => c.id === sampleLine.cueId)!;
    const measured = cue.seconds ?? cue.versions.at(-1)!.voice!.seconds;
    const room = cue.windowEnd - cue.start;
    const result = scenes.find((s) => s.id === "result")!;
    const said = result.parts.find((p) => "caption" in p)!;
    if (!("caption" in said)) throw new Error("the result scene opens without a caption");
    for (const lang of LANGS) {
      const text = said.caption[lang];
      for (const shown of [measured, room]) {
        const number = formatSeconds(toRecordedSeconds(shown), lang).replace(/\s+s$|초$/, "");
        assert.ok(text.includes(number), `${lang}: "${text}" lacks the meter's ${number}`);
      }
    }
  });

  it("starts the listen after the voice of the line before it", () => {
    const before = film.opening.lines.filter((l) => l.start < film.line.start).at(-1)!;
    assert.ok(LISTEN.from >= before.start + before.voiced, `listen from ${LISTEN.from}`);
    assert.ok(LISTEN.from <= film.line.start && LISTEN.to > film.line.start + film.line.voiced);
    assert.equal(LISTEN.lineAt, film.line.start - LISTEN.from);
  });
});

describe("motion pages in the Korean film", () => {
  // Pages that cut no stills (the seven and constraint pages call FFmpeg for theirs).
  const PAGE_IDS: PageId[] = ["dark", "stakes", "cloud", "compare", "close"];
  const words = (s: string) => s.match(/[A-Za-z][\w.\-/()&']*/g) ?? [];
  const hook = film.hook;
  const allowed = new Set(
    words(
      [
        "Tears of Steel Gapline Cloud Run Storage Gemini Speech-to-Text v2 Text-to-Speech Chirp HD",
        "FFmpeg Next.js Secret Manager Build deploy/cloud-run.sh vCPU API AI Builder Cup",
        "Artifact Registry MediaScribe ViddyScribe Microsoft 3Play Media Verbit",
        GEMINI_NAME,
        film.geminiAccess,
        film.credit,
        film.theme,
        film.category,
        new URL(film.service).host,
        SUBMISSION.repoUrl?.replace(/^https:\/\//, "") ?? "",
        Object.values(SPEC).join(" "),
        hook.locked.text,
        hook.freaky.text,
      ].join(" "),
    ).map((w) => w.replace(/[.,]$/, "")),
  );

  for (const id of PAGE_IDS)
    it(`draws the ${id} page's words in Korean, keeping only names and the film's dialogue`, async () => {
      const scene = buildStoryboard().find((s) => "page" in s.show && s.show.page === id)!;
      const plan = planScene(scene, "ko");
      const says = plan.parts.filter((p) => p.captions);
      const html = await PAGES[id]({
        T: plan.seconds,
        S: says.map((p) => p.start),
        L: says.map((p) => p.seconds),
        film: plan.parts.find((p) => "film" in p.part)?.start,
        lang: "ko",
      });
      assert.match(html, /<html lang="ko">/);
      const visible = html
        .replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&");
      const english = words(visible)
        .map((w) => w.replace(/[.,:;]$/, ""))
        .filter((w) => !allowed.has(w));
      assert.deepEqual(english, []);
      const dialogue = labels("ko").dialogueKo!;
      if (id === "dark" || id === "close") assert.ok(visible.includes(dialogue.freaky));
    });
});
