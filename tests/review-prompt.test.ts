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
});
