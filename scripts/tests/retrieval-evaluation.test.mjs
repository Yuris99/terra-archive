import test from "node:test";
import assert from "node:assert/strict";
import { verifyExpectedEvidence, evidenceRank, summarizeRanks } from "../lib/retrieval-evaluation.mjs";
test("gold evidence must actually exist and unrelated matching text is not a hit", () => {
  const question = { id: "case", locale: "ko_KR", canonicalId: "profile:one", quote: "검사한 원문" };
  const records = [{ document: { id: "ko_KR:profile:one", kind: "profile", context: {}, source: { commit: "fixed" } },
    chunks: [{ id: "expected", text: "검사한 원문이다.", spans: [{ sourcePointer: "/a/0" }] }] }];
  const evidence = verifyExpectedEvidence(question, records);
  assert.equal(evidenceRank([{ id: "unrelated", text: "검사한 원문" }, { id: "expected", text: "검사한 원문이다." }], evidence, question.quote), 2);
  assert.throws(() => verifyExpectedEvidence({ ...question, quote: "존재하지 않는 문장" }, records));
});
test("rank summaries count misses as zero and do not claim recall beyond top 20", () => {
  const summary = summarizeRanks([{ rank: 1 }, { rank: 5 }, { rank: 20 }, { rank: null }]);
  assert.equal(summary.hitAt5, 2); assert.equal(summary.hitAt20, 3);
  assert.equal(summary.meanReciprocalRankAt20, (1 + 0.2 + 0.05) / 4);
});
