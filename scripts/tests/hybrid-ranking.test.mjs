import test from "node:test";
import assert from "node:assert/strict";
import { lexicalTerms, prepareHybridQuery, matchesAnchor, fuseHybridRanks } from "../lib/hybrid-ranking.mjs";
const document = (id, title, name) => ({ id, title, context: { operator: { name } } });
const entry = (id, doc, text, semanticScore, focusedScore) => ({ document: doc, semanticScore, focusedScore,
  result: { id, documentId: doc.id, title: doc.title, text, kind: "voice", spans: [{ segmentOrdinal: 0 }],
    source: { path: "original" }, annotations: [{ id: "mark" }], condition: { references: "1" } } });
test("Korean particle variants are added without discarding original query words", () => {
  const terms = lexicalTerms("아미야는 어떤 악기를 다시 연습했어?");
  assert(terms.includes("아미야는")); assert(terms.includes("아미야")); assert(terms.includes("악기"));
  assert(!terms.includes("어떤"));
});
test("rare exact titles narrow the focused list, common headings do not", () => {
  const docs = [document("target", "엑시아의 걸작", "엑시아"), ...Array.from({ length: 6 }, (_, i) => document(String(i), "프로필", "아미야"))];
  const plan = prepareHybridQuery(docs, "엑시아의 걸작에서 캔디는 무슨 맛이야?");
  assert(plan.titles.has("엑시아의 걸작")); assert(!plan.titles.has("프로필"));
  assert(matchesAnchor(docs[0], plan)); assert(!matchesAnchor(docs[1], plan));
  assert(!plan.focusedQuery.includes("엑시아의 걸작"));
});
test("Latin operator names require word boundaries, not arbitrary substring matches", () => {
  const docs = [document("one", "Talk", "May")];
  assert.equal(prepareHybridQuery(docs, "maybe tomorrow").anchored, false);
  assert(prepareHybridQuery(docs, "What did May say?").operators.has("may"));
});
test("rank fusion promotes explicit question anchors and preserves original evidence", () => {
  const target = document("target", "Talk", "Amiya"), other = document("other", "Story", "Other");
  const plan = prepareHybridQuery([target, other], "Which instrument did Amiya practice?");
  const a = entry("evidence", target, "Amiya: I picked up the violin again.", 0.5, 0.9);
  const b = entry("distractor", other, "Amiya has an important mission.", 0.9);
  const result = fuseHybridRanks([b, a], plan);
  assert.equal(result[0].id, "evidence"); assert.deepEqual(result[0].source, { path: "original" });
  assert.deepEqual(result[0].annotations, [{ id: "mark" }]); assert.deepEqual(result[0].condition, { references: "1" });
  assert.equal(result[0].text, a.result.text);
});
test("duplicate evidence is collapsed without losing the source text or requiring manual tags", () => {
  const doc = document("one", "Story", "Amiya"), plan = prepareHybridQuery([doc], "Amiya");
  const entries = [entry("a", doc, "same original", 0.5, 0.5), entry("b", doc, "same original", 0.4, 0.4)];
  assert.equal(fuseHybridRanks(entries, plan).length, 1); assert.equal(entries.length, 2);
});
