import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import type { ClipContext } from "../src/lib/pipeline/context";
import { GUIDELINE_RULES } from "../src/lib/pipeline/guidelines";
import { reviewerSystem } from "../src/lib/pipeline/review";
import { ReviewSchema } from "../src/lib/pipeline/schemas";

const context = (language: ClipContext["language"]): ClipContext => ({
  language,
  density: "standard",
  clipSeconds: 65,
  speech: [],
  scene: { shots: [], characters: [], sounds: [] },
  gaps: [],
  videoDataUrl: "data:video/mp4;base64,",
});

describe("reviewer instructions", () => {
  // A pinned Korean run suggested "…문구가 나타난다" as a fix, then rejected the rewrite that
  // followed it for viewer framing. The reviewer must hold its own advice to the rules.
  for (const language of ["ko", "en"] as const) {
    it(`require every suggested fix to obey the rules (${language})`, () => {
      const prompt = reviewerSystem(context(language)).replace(/\s+/g, " ");
      assert.match(prompt, /The fix must itself obey every rule above/);
      assert.match(prompt, /any wording it suggests must pass this same review/);
      assert.match(prompt, /never says the text appears or is shown on screen/);
      assert.match(prompt, /"fix" says how to repair the line in one sentence/);
      const name = language === "ko" ? "Korean" : "English";
      assert.match(prompt, new RegExp(`Write reason and fix in ${name}`));
    });
  }

  it("keep the requirement in the final-output audit too", () => {
    const prompt = reviewerSystem(context("ko"), true).replace(/\s+/g, " ");
    assert.match(prompt, /The fix must itself obey every rule above/);
    assert.match(prompt, /final surviving-output audit/);
  });

  it("carry the requirement in the JSON schema the model answers with", () => {
    const schema = JSON.stringify(z.toJSONSchema(ReviewSchema));
    assert.match(schema, /any wording it suggests must itself obey every rule/);
  });
});

describe("the redundant rule", () => {
  const rule = GUIDELINE_RULES.find((r) => r.id === "redundant")!;

  it("names both of its halves", () => {
    assert.equal(rule.title.en, "Redundant or low priority");
    assert.equal(rule.title.ko, "중복·덜 중요한 정보");
    assert.match(rule.check, /Repeats what the dialogue or an obvious sound already tells/);
    assert.match(rule.check, /a more important visual goes undescribed/);
  });

  it("cites KMCC p.7 (what must be described) and p.8 (what needs none) in both languages", () => {
    assert.match(rule.source.en, /p\.7 \(must describe: characters, place, time, movement/);
    assert.match(rule.source.en, /on-screen text\), p\.8 \(no description for sounds/);
    assert.match(rule.source.ko, /p\.7 「반드시 해설할 요소: 등장인물·장소·시간·움직임/);
    assert.match(rule.source.ko, /자막」, p\.8 「즉시 식별 가능한 소리, 대사로 알 수 있는 감정/);
  });

  // QA run b6e4aa: over digital silence a reviewer rejected every caption reading as repeating "the
  // voiceover". What the dialogue says is what was recognized, not what the reviewer imagines.
  it("judges on-screen words against the recognized speech, not an imagined voice", () => {
    assert.match(rule.check, /a title, caption, sign, or time or place card no one speaks/);
    assert.match(rule.check, /The dialogue is the recognized speech listed with the clip/);
    assert.match(
      rule.check,
      /repeats the dialogue only when that speech says the same words in the narration's language/,
    );
  });

  // Netflix §2.2 reads subtitles of foreign-language speech verbatim; "in any language" had told the
  // reviewer those repeat the dialogue (review of 2026-10-03).
  it("reads subtitles of speech in another language, and puts other credits last", () => {
    assert.match(rule.check, /subtitles of speech in another language are read, not redundant/);
    assert.doesNotMatch(rule.check, /in any language/);
    assert.match(rule.check, /Credits other than the title are the least important/);
  });
});

describe("rule clauses", () => {
  const rule = (id: string) => GUIDELINE_RULES.find((r) => r.id === id)!;

  // The pinned English sample cited "p.7 (characters)" against a skyline named 2.5 s before the cut
  // that shows it. Describing ahead of the picture is the spoiler rule's second half, and it now
  // cites the clauses that say so.
  it("cite a clause for describing ahead of the picture, and keep it out of unseen", () => {
    assert.match(rule("spoiler").check, /describes something before the picture shows it/);
    assert.match(rule("spoiler").check, /from the moment it starts/);
    assert.match(rule("spoiler").source.en, /p\.8 \(describe movement as it happens\)/);
    assert.match(rule("spoiler").source.en, /§5\.1 \(foreshadowing\)/);
    assert.match(rule("spoiler").source.ko, /p\.8 「움직임과 동시에 해설」/);
    // The timing clauses come first: the landing's showcase is a skyline named before its cut.
    assert.match(
      rule("spoiler").source.en,
      /\(KMCC\) p\.8 \(describe movement as it happens\), p\.7/,
    );
    assert.match(rule("spoiler").source.en, /Style Guide §5\.1 \(foreshadowing\), §1\.2$/);
    assert.match(
      rule("spoiler").source.ko,
      /^방미통위 가이드라인 p\.8 「움직임과 동시에 해설」, p\.7/,
    );
    assert.equal(rule("spoiler").title.ko, "스포일러 · 때 이른 해설");
    assert.match(rule("unseen").check, /appears later in the clip is spoiler, not unseen/);
  });

  it("let a lead-in name where text is written, and judge references by ear", () => {
    assert.match(rule("viewer_frame").check, /lead-in that names where text is written/);
    // A portrait run's "A screen reads:" was rejected as framing: the screen is the viewer's.
    assert.match(rule("viewer_frame").check, /'the screen reads' is/);
    // The same run's reviewer asked for every caption in full, longer than the room.
    assert.match(
      rule("clarity").check,
      /Part of a longer on-screen text, cut at a sentence boundary/,
    );
    assert.match(rule("clarity").check, /for a person that no earlier line introduced/);
    assert.match(rule("clarity").check, /'Open your eyes\.'/);
    // The style rules let a card or credit be read bare; run 790315's reviewer rejected one anyway.
    assert.match(rule("clarity").check, /A time or place card or a credit read bare .* is clear/);
    assert.match(
      rule("clarity").source.en,
      /§1\.2 \(pronouns only when it is clear who is meant\)/,
    );
    assert.match(rule("clarity").source.en, /§2\.1 \(introducing on-screen text\)/);
  });

  it("explain the Korean guideline in English instead of a bare acronym", () => {
    for (const r of GUIDELINE_RULES) {
      assert.match(r.source.en, /^Korea's broadcast audio description guideline \(KMCC\) p\./);
      assert.doesNotMatch(r.source.en, /KMCC guideline|AD Style Guide/);
      assert.match(r.source.ko, /^방미통위 가이드라인 p\./);
    }
  });

  it("tell the reviewer, in the schema, that a fix may lead in to on-screen text", () => {
    const schema = JSON.stringify(z.toJSONSchema(ReviewSchema));
    assert.match(schema, /after a short lead-in naming where it is written/);
    assert.match(
      schema,
      /each title, time or place card, caption or sign in the notes that no line reads; not other credits/,
    );
  });
});
