import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sha256 } from "../lib/chunk-corpus.mjs";
import { LOCALES, KINDS } from "../lib/local-search.mjs";
import { uniqueInputs, normalizedVector, rankVectors, embedInputs, installedEmbeddingModel, createSemanticSearch } from "../lib/semantic-search.mjs";
const doc = (id, text) => ({ document: { id: `ko_KR:profile:${id}`, canonicalId: `profile:${id}`,
  locale: "ko_KR", kind: "profile", title: "기록", context: { operator: { id: "operator", name: "아미야" } },
  source: { commit: "fixed", path: "original.json", sha256: "source" } }, chunks: [{ id, text,
    spans: [{ sourcePointer: "/original/0", segmentOrdinal: 0 }], annotations: [{ id: "mark" }],
    condition: { references: "1", routeResolved: false }, warnings: [] }] });

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terra-semantic-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); // Exact newly-created test directory only.
  fs.mkdirSync(path.join(root, "config"));
  fs.mkdirSync(path.join(root, "data/indexes/global-v1"), { recursive: true });
  const policy = { model: "embed:local", modelDigest: "fixed-digest", dimensions: 2, contextTokens: 4096, queryInstruction: "Find evidence." };
  const policyBytes = Buffer.from(JSON.stringify(policy));
  fs.writeFileSync(path.join(root, "config/semantic-policy.json"), policyBytes);
  const records = [doc("one", "리더가 이끈다."), doc("two", "바이올린을 연습한다.")];
  const original = Buffer.from(JSON.stringify({ files: LOCALES.flatMap((locale) => KINDS.map((kind) => ({ locale, kind, path: `${locale}/${kind}.jsonl`, sha256: "fixture" }))) }));
  fs.writeFileSync(path.join(root, "data/indexes/global-v1/manifest.json"), original);
  const files = [];
  for (const locale of LOCALES) for (const kind of KINDS) {
    const name = `${locale}/${kind}`, prefix = path.join(root, "data/indexes/semantic-v1", name);
    fs.mkdirSync(path.dirname(prefix), { recursive: true });
    const populated = locale === "ko_KR" && kind === "profile";
    const vectors = Buffer.from(new Float32Array(populated ? [1, 0, 0, 1] : []).buffer);
    const rows = Buffer.from(JSON.stringify(populated ? [{ id: "one", row: 0 }, { id: "two", row: 1 }] : []));
    fs.writeFileSync(`${prefix}.f32`, vectors); fs.writeFileSync(`${prefix}.rows.json`, rows);
    files.push({ path: name, locale, kind, chunks: populated ? 2 : 0, uniqueInputs: populated ? 2 : 0,
      sourceSha256: "fixture", vectorsSha256: sha256(vectors), rowsSha256: sha256(rows) });
  }
  const manifestPath = path.join(root, "data/indexes/semantic-v1/manifest.json");
  const manifest = { validationPassed: true, inputManifestSha256: sha256(original), policySha256: sha256(policyBytes), chunks: 2, files };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  let valid = true, embeddings = 0;
  const archive = { status: () => { assert(valid, "Global policy invalid"); return { chunks: 2 }; }, records: (locale, kind) => locale === "ko_KR" && kind === "profile" ? records : [] };
  const fetcher = async (url, options) => ({ ok: true, json: async () => {
    if (url.endsWith("/api/tags")) return { models: [{ name: policy.model, digest: policy.modelDigest, size: 1 }] };
    const body = JSON.parse(options.body); assert.equal(body.truncate, false); assert.equal(body.dimensions, 2);
    assert(body.input[0].startsWith("Instruct: Find evidence.\nQuery:")); embeddings++;
    return { embeddings: [[1, 0]] };
  } });
  const semantic = createSemanticSearch(root, archive, { fetcher });
  return { root, records, semantic, policy, manifest, manifestPath, setInvalid: () => { valid = false; }, embeddingCount: () => embeddings };
}
test("vectors normalize, reject nonfinite/zero/dimension errors and sort deterministically", () => {
  const vector = normalizedVector([3, 4], 2);
  assert(Math.abs(vector[0] - 0.6) < 1e-6); assert(Math.abs(vector[1] - 0.8) < 1e-6);
  assert.throws(() => normalizedVector([0, 0], 2));
  assert.throws(() => normalizedVector([Infinity, 1], 2));
  assert.throws(() => normalizedVector([1], 2));
  assert.deepEqual(rankVectors(Float32Array.from([0, 1, 1, 0, 1, 0]), 2, [1, 0], 2), [{ row: 1, score: 1 }, { row: 2, score: 1 }]);
});
test("deduplication preserves every source mapping and does not mutate originals", () => {
  const a = doc("one", "同じ本文"), b = doc("two", "同じ本文");
  const { inputs, rows } = uniqueInputs([a, b]);
  assert.equal(inputs.length, 1); assert.deepEqual(rows, [{ id: "one", row: 0 }, { id: "two", row: 0 }]);
  assert.equal(a.chunks[0].text, "同じ本文");
});
test("semantic results preserve source pointers, conditions and locale-difference marks", async (t) => {
  const f = fixture(t);
  assert.equal(f.semantic.status().ready, true);
  const result = await f.semantic.search({ query: "トップ責任者", locale: "ko_KR", kind: "profile", limit: 1 });
  assert.equal(result.results[0].id, "one"); assert.equal(result.results[0].score, 1);
  assert.deepEqual(result.results[0].source, f.records[0].document.source);
  assert.deepEqual(result.results[0].condition, f.records[0].chunks[0].condition);
  assert.deepEqual(result.results[0].annotations, [{ id: "mark" }]);
  assert.equal(result.rankingOnly, true);
  await f.semantic.search({ query: "トップ責任者", kind: "profile" });
  assert.equal(f.embeddingCount(), 1);
});

test("hybrid retrieval preserves evidence and caches its metadata-focused query", async (t) => {
  const f = fixture(t);
  const options = { query: "아미야 리더 권한", locale: "ko_KR", kind: "profile", mode: "hybrid", limit: 1 };
  const result = await f.semantic.search(options);
  assert.equal(result.mode, "hybrid-rrf");
  assert.deepEqual(result.anchors.operators, ["아미야"]);
  assert.equal(result.results[0].id, "one");
  assert.deepEqual(result.results[0].source, f.records[0].document.source);
  assert.deepEqual(result.results[0].spans, f.records[0].chunks[0].spans);
  assert.deepEqual(result.results[0].condition, f.records[0].chunks[0].condition);
  assert.deepEqual(result.results[0].annotations, [{ id: "mark" }]);
  assert.equal(f.embeddingCount(), 2);
  await f.semantic.search(options);
  assert.equal(f.embeddingCount(), 2);
  await assert.rejects(f.semantic.search({ ...options, mode: "unknown" }), /검색 방식/);
});
test("incomplete, changed corpus and changed embedding policies fail closed", async (t) => {
  const f = fixture(t);
  f.manifest.validationPassed = false; fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.equal(f.semantic.status().ready, false);
  await assert.rejects(f.semantic.search({ query: "質問" }), /아직/);
  f.manifest.validationPassed = true; fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  fs.writeFileSync(path.join(f.root, "config/semantic-policy.json"), JSON.stringify({ ...f.policy, dimensions: 3 }));
  await assert.rejects(f.semantic.search({ query: "質問" }), /설정/);
});
test("changing the original release policy prevents semantic retrieval", async (t) => {
  const f = fixture(t); f.setInvalid();
  await assert.rejects(f.semantic.search({ query: "質問" }), /Global policy/);
});
test("a changed chunk manifest invalidates previously completed semantic data", async (t) => {
  const f = fixture(t);
  fs.appendFileSync(path.join(f.root, "data/indexes/global-v1/manifest.json"), "\n");
  assert.equal(f.semantic.status().ready, false);
  await assert.rejects(f.semantic.search({ query: "質問" }), /변경/);
});
test("compatible in-progress coverage is visible but never enables search", async (t) => {
  const f = fixture(t);
  f.manifest.validationPassed = false; f.manifest.progress = { chunksCompleted: 1, chunksTotal: 2 };
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.deepEqual(f.semantic.status().progress, { chunksCompleted: 1, chunksTotal: 2 });
  assert.equal(f.semantic.status().ready, false);
  await assert.rejects(f.semantic.search({ query: "質問" }), /아직/);
  f.manifest.progress.chunksTotal = 100;
  fs.writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
  assert.equal(f.semantic.status().progress, undefined);
});
test("corrupt vector output and invalid inputs are rejected", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "data/indexes/semantic-v1/ko_KR/profile.f32"), new Uint8Array(16));
  await assert.rejects(f.semantic.search({ query: "質問", kind: "profile" }), /벡터/);
  await assert.rejects(f.semantic.search({ query: "質問", locale: "../raw" }), /언어/);
  await assert.rejects(f.semantic.search({ query: "", kind: "profile" }), /질문/);
  await assert.rejects(f.semantic.search({ query: "質問", offset: 250 }), /250/);
});
test("the last UI page at offset 240 is valid within the 250-candidate cap", async (t) => {
  const f = fixture(t);
  const result = await f.semantic.search({ query: "質問", offset: 240 });
  assert.equal(result.total, 2); assert.deepEqual(result.results, []);
});
test("embedding calls enforce input counts and a pinned installed local digest", async () => {
  const policy = { model: "embed:local", modelDigest: "correct", dimensions: 2 };
  await assert.rejects(installedEmbeddingModel(policy, async () => ({ ok: true, json: async () => ({ models: [{ name: policy.model, size: 1, digest: "wrong" }] }) })), /버전/);
  await assert.rejects(embedInputs(policy, ["one", "two"], { fetcher: async () => ({ ok: true, json: async () => ({ embeddings: [[1, 0]] }) }) }), /개수/);
});
