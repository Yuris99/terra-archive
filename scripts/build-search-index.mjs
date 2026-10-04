import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chunkDocument, auditChunkRecord, sha256, validateChunkPolicy } from "./lib/chunk-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(root, "data/retrieval/global-v1");
const outputRoot = path.join(root, "data/indexes/global-v1");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const manifestBytes = fs.readFileSync(path.join(sourceRoot, "manifest.json"));
const input = JSON.parse(manifestBytes);
const policyBytes = fs.readFileSync(path.join(root, "config/chunk-policy.json"));
const policy = JSON.parse(policyBytes);
validateChunkPolicy(policy);
assert.equal(input.validationPassed, true);
assert.equal(input.policyId, policy.inputPolicyId);
assert.equal(sha256(fs.readFileSync(path.join(root, "config/retrieval-policy.json"))), input.policySha256);
assert.equal(sha256(fs.readFileSync(path.join(root, "config/content-annotations.json"))), input.annotations.registrySha256);
assert.equal(sha256(fs.readFileSync(path.join(sourceRoot, "catalog.json"))), input.catalog.sha256);
const entries = json(path.join(sourceRoot, "catalog.json")).entries;
const allowed = new Set(entries.flatMap((entry) => Object.values(entry.variants).map((variant) => variant.documentId)));
const annotationBytes = fs.readFileSync(path.join(sourceRoot, "annotations.json"));
assert.equal(sha256(annotationBytes), input.annotations.sha256);
const marks = JSON.parse(annotationBytes).entries;
fs.mkdirSync(outputRoot, { recursive: true });
const previous = fs.existsSync(path.join(outputRoot, "manifest.json")) ? json(path.join(outputRoot, "manifest.json")) : null;
const report = { schemaVersion: 1, sourceCommit: input.source.commit, inputManifestSha256: sha256(manifestBytes),
  policyId: input.policyId, policySha256: input.policySha256, chunkPolicySha256: sha256(policyBytes),
  generatedAtUtc: new Date().toISOString(), validationPassed: false, documents: 0, segments: 0, chunks: 0,
  annotationsSha256: sha256(annotationBytes), markedChunks: 0, emptyDocuments: 0, rebuiltFiles: 0, reusedFiles: 0, files: [] };
fs.writeFileSync(path.join(outputRoot, "manifest.json"), JSON.stringify({ ...report, generationInProgress: true }));
const seen = new Set();
for (const file of input.files) {
  const destination = path.join(outputRoot, file.path);
  const bytes = fs.readFileSync(path.join(sourceRoot, file.path));
  assert.equal(bytes.length, file.bytes);
  assert.equal(sha256(bytes), file.sha256, "verified global input only");
  const prior = previous?.validationPassed && previous.chunkPolicySha256 === report.chunkPolicySha256
    && previous.policySha256 === report.policySha256 && previous.annotationsSha256 === report.annotationsSha256
    ? previous.files.find((entry) => entry.path === file.path && entry.inputSha256 === file.sha256) : null;
  let reuse = false;
  if (prior && fs.existsSync(destination)) reuse = sha256(fs.readFileSync(destination)) === prior.sha256;
  let saved;
  if (reuse) { saved = fs.readFileSync(destination, "utf8").trimEnd().split("\n"); report.reusedFiles++; }
  else { fs.mkdirSync(path.dirname(destination), { recursive: true }); saved = []; report.rebuiltFiles++; }
  let count = 0, segments = 0, chunks = 0, markedChunks = 0, emptyDocuments = 0;
  for (const line of bytes.toString("utf8").trimEnd().split("\n")) {
    const source = JSON.parse(line);
    assert.ok(allowed.has(source.id) && !seen.has(source.id), "all and only allowed source documents");
    seen.add(source.id);
    const annotations = marks.filter((entry) => entry.documentId === source.id);
    for (const annotation of annotations) {
      assert.equal(source.segments[annotation.segmentOrdinal].sourcePointer, annotation.source.jsonPointer);
      assert.equal(sha256(source.segments[annotation.segmentOrdinal].text), annotation.segmentTextSha256);
    }
    const record = reuse ? JSON.parse(saved[count]) : chunkDocument(source, policy, annotations);
    const audit = auditChunkRecord(source, record, policy, annotations);
    if (!reuse) saved.push(JSON.stringify(record));
    count++; segments += audit.segments; chunks += audit.chunks; markedChunks += audit.markedChunks;
    if (!record.chunks.length) emptyDocuments++;
  }
  assert.equal(count, file.documents); assert.equal(segments, file.segments); assert.equal(saved.length, count);
  if (!reuse) {
    fs.writeFileSync(`${destination}.partial`, `${saved.join("\n")}\n`);
    fs.renameSync(`${destination}.partial`, destination);
  }
  // Read saved output independently, then audit against the source again.
  const stream = fs.createReadStream(destination);
  const sourceLines = bytes.toString("utf8").trimEnd().split("\n");
  let position = 0;
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    const source = JSON.parse(sourceLines[position++]);
    auditChunkRecord(source, JSON.parse(line), policy, marks.filter((entry) => entry.documentId === source.id));
  }
  assert.equal(position, count);
  const output = fs.readFileSync(destination);
  report.files.push({ path: file.path, locale: file.locale, kind: file.kind, inputSha256: file.sha256,
    sha256: sha256(output), bytes: output.length, documents: count, segments, chunks, markedChunks, emptyDocuments });
  report.documents += count; report.segments += segments; report.chunks += chunks;
  report.markedChunks += markedChunks; report.emptyDocuments += emptyDocuments;
  console.log(`${reuse ? "reuse" : "build"} ${file.path}: ${count} documents, ${chunks} chunks`);
}
assert.equal(seen.size, allowed.size);
report.validationPassed = true;
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(root, "data/reports/chunking.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ documents: report.documents, segments: report.segments, chunks: report.chunks,
  markedChunks: report.markedChunks, emptyDocuments: report.emptyDocuments, reusedFiles: report.reusedFiles }));
