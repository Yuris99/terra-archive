import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchiveStore } from "./lib/local-search.mjs";
import { sha256 } from "./lib/chunk-corpus.mjs";
import { createSemanticSearch, uniqueInputs, installedEmbeddingModel } from "./lib/semantic-search.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = createArchiveStore(root), semantic = createSemanticSearch(root, archive);
assert.equal(semantic.status().ready, true);
const directory = path.join(root, "data/indexes/semantic-v1");
const policy = JSON.parse(fs.readFileSync(path.join(root, "config/semantic-policy.json")));
await installedEmbeddingModel(policy);
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json")));
const files = [];
for (const file of manifest.files) {
  assert.equal(file.path, `${file.locale}/${file.kind}`);
  const source = uniqueInputs(archive.records(file.locale, file.kind));
  const rowBytes = fs.readFileSync(path.join(directory, `${file.path}.rows.json`));
  assert.equal(sha256(rowBytes), file.rowsSha256);
  assert.deepEqual(JSON.parse(rowBytes), source.rows);
  assert.equal(file.uniqueInputs, source.inputs.length);
  const bytes = fs.readFileSync(path.join(directory, `${file.path}.f32`));
  assert.equal(sha256(bytes), file.vectorsSha256);
  assert.equal(bytes.length, source.inputs.length * policy.dimensions * 4);
  const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  for (let row = 0; row < source.inputs.length; row++) {
    let squared = 0;
    for (let column = 0; column < policy.dimensions; column++) {
      const value = vectors[row * policy.dimensions + column];
      assert(Number.isFinite(value)); squared += value * value;
    }
    assert(Math.abs(squared - 1) < 0.00001, `정규화 벡터 검사 실패: ${file.path}:${row}`);
  }
  files.push({ path: file.path, chunks: source.rows.length, uniqueInputs: source.inputs.length, verified: true });
  console.log(JSON.stringify(files.at(-1)));
}
const chunks = files.reduce((sum, file) => sum + file.chunks, 0);
assert.equal(chunks, archive.status().chunks);
const report = { verifiedAtUtc: new Date().toISOString(), validationPassed: true, chunks, files,
  model: policy.model, modelDigest: policy.modelDigest, dimensions: policy.dimensions,
  indexManifestSha256: sha256(fs.readFileSync(path.join(directory, "manifest.json"))),
  limitations: ["Checks all source mappings, counts, hashes, finite normalized vectors and pinned model, not semantic answer accuracy."] };
fs.writeFileSync(path.join(root, "data/reports/semantic-validation.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ validationPassed: true, files: files.length, chunks }));
