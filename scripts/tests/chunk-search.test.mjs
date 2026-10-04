import test from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, auditChunkRecord } from "../lib/chunk-corpus.mjs";
import { searchRecords, parseSearchQuery } from "../lib/local-search.mjs";

const policy = { schemaVersion: 1, targetCharacters: 100, maxCharacters: 160, overlapCharacters: 0,
  inputPolicyId: "global-only-v1", branchHandling: "split-at-every-control-preserve-condition-no-route-inference" };
const document = (texts, overrides = {}) => ({ schemaVersion: 1, id: "ko_KR:story:test", canonicalId: "story:test", kind: "story",
  locale: "ko_KR", language: "Korean", region: "global", title: "테스트 이야기", context: {}, source: { commit: "abc", path: "test.json", sha256: "abc" },
  segments: texts.map((text, ordinal) => ({ ordinal, kind: "dialogue", speaker: "아미야", text, sourcePointer: `/storyList/${ordinal}/attributes/content`, rowId: ordinal })), controls: [], ...overrides });

test("chunking reconstructs long multilingual prose including whitespace and astral Unicode", () => {
  const source = document(["  긴 문장😀。\n日本語の文章。 English text! ".repeat(70), "끝"]);
  const result = chunkDocument(source, policy);
  assert.ok(result.chunks.length > 3);
  assert.doesNotThrow(() => auditChunkRecord(source, result, policy));
  assert.ok(result.chunks.every((chunk) => !chunk.text.includes("\uFFFD")));
});
test("choices and predicates split alternative paths without pretending to resolve them", () => {
  const source = document(["공통", "선택 A;선택 B", "A 대사", "B 대사", "재합류"]);
  source.segments[1].kind = "choice";
  source.segments[1].speaker = null;
  source.controls = [
    { rowType: "decision", sourcePointer: "/storyList/1", attributes: { values: "1;2" } },
    { rowType: "predicate", sourcePointer: "/storyList/2", attributes: { references: "1" } },
    { rowType: "predicate", sourcePointer: "/storyList/3", attributes: { references: "2" } },
    { rowType: "predicate", sourcePointer: "/storyList/4", attributes: { references: "" } },
  ];
  const result = chunkDocument(source, policy);
  auditChunkRecord(source, result, policy);
  assert.equal(result.chunks.length, 5);
  assert.equal(result.chunks[2].condition.references, "1");
  assert.equal(result.chunks[3].condition.references, "2");
  assert.equal(result.chunks[4].condition, null);
});
test("video-only and empty documents remain catalogued without invented searchable text", () => {
  const source = document([], { contentState: "video-only", controls: [{ rowType: "video", sourcePointer: "/storyList/0", attributes: {} }] });
  const result = chunkDocument(source, policy);
  auditChunkRecord(source, result, policy);
  assert.equal(result.chunks.length, 0);
  assert.equal(result.document.contentState, "video-only");
});
test("locale difference annotations propagate to every covering slice", () => {
  const source = document(["차이 문장 ".repeat(100)]);
  const mark = { id: "difference", segmentOrdinal: 0, label: "언어판 차이" };
  const result = chunkDocument(source, policy, [mark]);
  assert.equal(auditChunkRecord(source, result, policy, [mark]).markedChunks, result.chunks.length);
});
test("independent audit detects dropped, fabricated and reordered text", () => {
  const source = document(["one", "two", "three"]);
  const result = chunkDocument(source, policy);
  const missing = structuredClone(result); missing.chunks = [];
  assert.throws(() => auditChunkRecord(source, missing, policy));
  const altered = structuredClone(result); altered.chunks[0].text += "invented";
  assert.throws(() => auditChunkRecord(source, altered, policy));
  const shuffled = structuredClone(result); shuffled.chunks[0].spans.reverse();
  assert.throws(() => auditChunkRecord(source, shuffled, policy));
});
test("literal search accepts Unicode, phrases and punctuation without regex or SQL interpretation", () => {
  const records = [chunkDocument(document(["살카즈와 <Active Originium>을 연구한다."]), policy)];
  assert.equal(searchRecords(records, { query: "살카즈" }).total, 1);
  assert.equal(searchRecords(records, { query: '"Active Originium"' }).total, 1);
  assert.equal(searchRecords(records, { query: ".*" }).total, 0);
  assert.equal(searchRecords(records, { query: "살카즈 없는단어" }).total, 0);
  assert.throws(() => parseSearchQuery(""));
  assert.throws(() => parseSearchQuery("x".repeat(201)));
});
test("repeat search results collapse without deleting source documents", () => {
  const a = chunkDocument(document(["동일한 본문"]), policy);
  const b = chunkDocument(document(["동일한 본문"], { id: "ko_KR:story:test2", canonicalId: "story:test2" }), policy);
  assert.equal(searchRecords([a, b], { query: "동일한" }).total, 1);
  assert.equal(b.chunks.length, 1);
});
