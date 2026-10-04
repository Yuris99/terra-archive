import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchiveStore, LOCALES, KINDS } from "./lib/local-search.mjs";
import { sha256 } from "./lib/chunk-corpus.mjs";
import { uniqueInputs, embedInputs, installedEmbeddingModel } from "./lib/semantic-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rebuildFiles = new Set(process.argv.slice(2).map((arg) => {
  assert(arg.startsWith("--rebuild="), "지원하는 옵션은 --rebuild=<locale>/<kind>입니다.");
  const name = arg.slice("--rebuild=".length), [locale, kind] = name.split("/");
  assert(LOCALES.includes(locale) && KINDS.includes(kind) && name === `${locale}/${kind}`, "재생성 대상이 올바르지 않습니다.");
  return name;
}));
const directory = path.join(root, "data/indexes/semantic-v1");
const policyBytes = fs.readFileSync(path.join(root, "config/semantic-policy.json"));
const policy = JSON.parse(policyBytes), archive = createArchiveStore(root);
const inputBytes = fs.readFileSync(path.join(root, "data/indexes/global-v1/manifest.json"));
const inputManifest = JSON.parse(inputBytes);
archive.status();
await installedEmbeddingModel(policy);
fs.mkdirSync(directory, { recursive: true });
const manifestPath = path.join(directory, "manifest.json");
const lockPath = path.join(directory, "build.lock.json");
if (fs.existsSync(lockPath)) {
  const previous = JSON.parse(fs.readFileSync(lockPath));
  assert(Number.isInteger(previous.pid) && previous.pid > 0, "생성 작업 잠금의 PID가 올바르지 않습니다.");
  let alive = true;
  try { process.kill(previous.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
  assert(!alive, "다른 의미 검색 생성 작업이 실행 중입니다.");
  fs.unlinkSync(lockPath); // Stale derived-job lock, never source data.
}
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAtUtc: new Date().toISOString() }), { flag: "wx" });
try {
const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : null;
const manifest = { schemaVersion: 1, inputManifestSha256: sha256(inputBytes), policySha256: sha256(policyBytes),
  sourceCommit: inputManifest.sourceCommit, model: policy.model, modelDigest: policy.modelDigest,
  dimensions: policy.dimensions, validationPassed: false, chunks: 0, uniqueInputs: 0, files: [], startedAtUtc: new Date().toISOString() };
manifest.firstStartedAtUtc = previous?.inputManifestSha256 === manifest.inputManifestSha256 && previous?.policySha256 === manifest.policySha256
  ? previous.firstStartedAtUtc ?? previous.startedAtUtc : manifest.startedAtUtc;
function saveManifest() {
  fs.writeFileSync(`${manifestPath}.tmp`, JSON.stringify(manifest, null, 2));
  fs.renameSync(`${manifestPath}.tmp`, manifestPath);
}
saveManifest();
const started = Date.now();
let generated = 0, reused = 0;
for (const locale of LOCALES) for (const kind of [...KINDS.filter((kind) => kind !== "story"), "story"]) {
  const name = `${locale}/${kind}`, prefix = path.join(directory, name);
  fs.mkdirSync(path.dirname(prefix), { recursive: true });
  const { inputs, rows } = uniqueInputs(archive.records(locale, kind));
  const source = inputManifest.files.find((file) => file.locale === locale && file.kind === kind);
  const key = sha256(JSON.stringify({ source: source.sha256, policy: manifest.policySha256, inputs, rows }));
  const checkpointPath = `${prefix}.checkpoint.json`, vectorPath = `${prefix}.f32`;
  let checkpoint = { key, completed: 0, vectorsSha256: sha256(Buffer.alloc(0)) };
  if (fs.existsSync(checkpointPath)) {
    const previous = JSON.parse(fs.readFileSync(checkpointPath));
    if (previous.key === key && !rebuildFiles.has(name)) checkpoint = previous;
  }
  let existing = fs.existsSync(vectorPath) ? fs.readFileSync(vectorPath) : Buffer.alloc(0);
  if (checkpoint.completed === 0) existing = Buffer.alloc(0);
  assert(Number.isInteger(checkpoint.completed) && checkpoint.completed >= 0 && checkpoint.completed <= inputs.length);
  const expectedBytes = checkpoint.completed * policy.dimensions * 4;
  assert(existing.length >= expectedBytes, `체크포인트보다 짧은 벡터 파일: ${name}`);
  existing = existing.subarray(0, expectedBytes);
  assert.equal(sha256(existing), checkpoint.vectorsSha256, `체크포인트 지문 불일치: ${name}`);
  // Only derived vector output is restored to its last verified batch; raw/source data is untouched.
  fs.writeFileSync(vectorPath, existing);
  const hash = crypto.createHash("sha256").update(existing);
  reused += checkpoint.completed;
  const fileStarted = Date.now();
  function progress() {
    manifest.progress = { file: name, uniqueInputsCompleted: checkpoint.completed, uniqueInputsTotal: inputs.length,
      chunksCompleted: manifest.chunks + rows.filter((row) => row.row < checkpoint.completed).length,
      chunksTotal: inputManifest.chunks, filesCompleted: manifest.files.length, filesTotal: inputManifest.files.length };
    saveManifest();
  }
  progress();
  for (let offset = checkpoint.completed; offset < inputs.length; offset += policy.batchSize) {
    const vectors = await embedInputs(policy, inputs.slice(offset, offset + policy.batchSize));
    const bytes = Buffer.concat(vectors.map((vector) => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)));
    fs.appendFileSync(vectorPath, bytes);
    hash.update(bytes); generated += vectors.length;
    checkpoint = { key, completed: offset + vectors.length, vectorsSha256: hash.copy().digest("hex") };
    fs.writeFileSync(`${checkpointPath}.tmp`, JSON.stringify(checkpoint));
    fs.renameSync(`${checkpointPath}.tmp`, checkpointPath);
    progress();
    if (offset === 0 || (offset / policy.batchSize) % 20 === 0 || checkpoint.completed === inputs.length) {
      console.log(JSON.stringify({ file: name, completed: checkpoint.completed, uniqueInputs: inputs.length,
        sourceChunks: rows.length, fileElapsedSeconds: Math.round((Date.now() - fileStarted) / 1000),
        generated, reused, totalElapsedSeconds: Math.round((Date.now() - started) / 1000) }));
    }
  }
  const vectorBytes = fs.readFileSync(vectorPath);
  assert.equal(sha256(vectorBytes), checkpoint.vectorsSha256);
  assert.equal(vectorBytes.length, inputs.length * policy.dimensions * 4);
  const rowBytes = Buffer.from(JSON.stringify(rows));
  fs.writeFileSync(`${prefix}.rows.json`, rowBytes);
  manifest.files.push({ path: name, locale, kind, sourceSha256: source.sha256, chunks: rows.length,
    uniqueInputs: inputs.length, vectorsSha256: sha256(vectorBytes), rowsSha256: sha256(rowBytes) });
  manifest.chunks += rows.length; manifest.uniqueInputs += inputs.length;
  saveManifest();
}
assert.equal(manifest.chunks, inputManifest.chunks);
assert.equal(manifest.files.length, 20);
assert.equal(sha256(fs.readFileSync(path.join(root, "data/indexes/global-v1/manifest.json"))), manifest.inputManifestSha256);
archive.status();
await installedEmbeddingModel(policy);
assert.equal(sha256(fs.readFileSync(path.join(root, "config/semantic-policy.json"))), manifest.policySha256);
manifest.validationPassed = true;
manifest.completedAtUtc = new Date().toISOString();
manifest.elapsedSeconds = Math.round((Date.now() - started) / 1000);
manifest.totalWallSeconds = Math.round((Date.now() - Date.parse(manifest.firstStartedAtUtc)) / 1000);
manifest.generated = generated; manifest.reused = reused;
manifest.progress = { chunksCompleted: manifest.chunks, chunksTotal: inputManifest.chunks, filesCompleted: 20, filesTotal: 20 };
saveManifest();
console.log(JSON.stringify({ validationPassed: true, chunks: manifest.chunks, uniqueInputs: manifest.uniqueInputs,
  generated, reused, elapsedSeconds: manifest.elapsedSeconds, totalWallSeconds: manifest.totalWallSeconds }));
} finally {
  if (JSON.parse(fs.readFileSync(lockPath)).pid === process.pid) fs.unlinkSync(lockPath);
}
