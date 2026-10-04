import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

test("answer quality suite separates development from frozen multilingual held-out questions", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../../config/answer-quality-evaluation.json", import.meta.url)));
  const prior = JSON.parse(fs.readFileSync(new URL("../../config/retrieval-evaluation.json", import.meta.url)));
  assert.equal(config.questions.length, 15);
  assert.equal(new Set(config.questions.map((q) => q.id)).size, 15);
  const dev = config.questions.filter((q) => q.split === "development"), held = config.questions.filter((q) => q.split === "held-out");
  assert.equal(dev.length, 9); assert.equal(held.length, 6);
  assert.deepEqual([...new Set(held.map((q) => q.locale))].sort(), ["en_US", "ja_JP", "ko_KR", "zh_CN"]);
  for (const q of config.questions) {
    assert(q.expectedBehavior);
    if (q.retrievalCaseId) assert(prior.questions.some((p) => p.id === q.retrievalCaseId));
    else { assert(q.question); assert(q.locale); }
    if (q.category === "unsupported") assert(!q.quote && !q.canonicalId);
    else if (!q.retrievalCaseId) assert(q.quote.length >= 6 && q.canonicalId);
  }
});
