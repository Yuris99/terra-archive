// Offline diagnostic only: never enables the production index or changes its completion marker.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchiveStore, LOCALES, KINDS } from "./lib/local-search.mjs";
import { sha256 } from "./lib/chunk-corpus.mjs";
import { uniqueInputs, installedEmbeddingModel, embedInputs, rankVectors } from "./lib/semantic-search.mjs";
import { verifyExpectedEvidence, evidenceRank, summarizeRanks } from "./lib/retrieval-evaluation.mjs";
import { prepareHybridQuery, matchesAnchor, fuseHybridRanks } from "./lib/hybrid-ranking.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = createArchiveStore(root), directory = path.join(root, "data/indexes/semantic-v1");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json")));
const policyBytes = fs.readFileSync(path.join(root, "config/semantic-policy.json")), policy = JSON.parse(policyBytes);
const original = fs.readFileSync(path.join(root, "data/indexes/global-v1/manifest.json"));
archive.status();
assert.equal(manifest.inputManifestSha256, sha256(original)); assert.equal(manifest.policySha256, sha256(policyBytes));
await installedEmbeddingModel(policy);
const dataset = JSON.parse(fs.readFileSync(path.join(root, "config/retrieval-evaluation.json"))), cases = [];
for (const locale of LOCALES) {
  const files = manifest.files.filter((file) => file.locale === locale);
  if (files.length !== KINDS.length || !KINDS.every((kind) => files.some((file) => file.kind === kind))) continue;
  const loaded = files.map((file) => {
    assert.equal(file.path, `${locale}/${file.kind}`);
    assert.equal(file.sourceSha256, JSON.parse(original).files.find((entry) => entry.locale === locale && entry.kind === file.kind).sha256);
    const records = archive.records(locale, file.kind), inputs = uniqueInputs(records);
    const vectorsBytes = fs.readFileSync(path.join(directory, `${file.path}.f32`));
    const rowsBytes = fs.readFileSync(path.join(directory, `${file.path}.rows.json`));
    assert.equal(sha256(vectorsBytes), file.vectorsSha256); assert.equal(sha256(rowsBytes), file.rowsSha256);
    assert.equal(vectorsBytes.length, inputs.inputs.length * policy.dimensions * 4);
    const mapping = JSON.parse(rowsBytes); assert.deepEqual(mapping, inputs.rows);
    const flattened = records.flatMap(({ document, chunks }) => chunks.map((chunk) => ({ ...chunk, document, kind: document.kind, documentId: document.id, title: document.title })));
    const sources = Array.from({ length: inputs.inputs.length }, () => []);
    mapping.forEach(({ row }, i) => sources[row].push(flattened[i]));
    return { vectors: new Float32Array(vectorsBytes.buffer, vectorsBytes.byteOffset, vectorsBytes.length / 4), sources };
  });
  const allRecords = archive.records(locale);
  for (const question of dataset.questions.filter((entry) => entry.locale === locale)) {
    const evidence = verifyExpectedEvidence(question, allRecords);
    const [query] = await embedInputs(policy, [`Instruct: ${policy.queryInstruction}\nQuery: ${question.question}`]);
    const plan = prepareHybridQuery(allRecords.map((record) => record.document), question.question);
    const [focused] = plan.anchored ? await embedInputs(policy, [`Instruct: ${policy.queryInstruction}\nQuery: ${plan.focusedQuery}`]) : [query];
    const entries = loaded.flatMap(({ vectors, sources }) => rankVectors(vectors, policy.dimensions, query, sources.length)
      .flatMap(({ row, score }) => sources[row].map((source) => {
        let focusedScore;
        if (matchesAnchor(source.document, plan)) {
          focusedScore = 0;
          for (let column = 0; column < policy.dimensions; column++) focusedScore += vectors[row * policy.dimensions + column] * focused[column];
        }
        return { result: { ...source, score }, document: source.document, semanticScore: score, focusedScore };
      })));
    const candidates = entries.map((entry) => entry.result);
    candidates.sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.spans[0].segmentOrdinal - b.spans[0].segmentOrdinal);
    const unique = [], seen = new Set();
    for (const result of candidates) {
      const key = `${result.kind}:${result.text}`;
      if (!seen.has(key)) { seen.add(key); unique.push(result); }
    }
    const rank = evidenceRank(unique.slice(0, 20), evidence, question.quote);
    const hybrid = fuseHybridRanks(entries, plan), hybridRank = evidenceRank(hybrid.slice(0, 20), evidence, question.quote);
    cases.push({ id: question.id, locale, rank, hybridRank, top5: unique.slice(0, 5).map(({ id, title, score }) => ({ id, title, score })),
      hybridTop5: hybrid.slice(0, 5).map(({ id, title, score }) => ({ id, title, score })) });
    console.log(JSON.stringify({ provisional: true, id: question.id, rank, hybridRank }));
  }
}
const report = { generatedAtUtc: new Date().toISOString(), provisional: true,
  productionIndexReady: manifest.validationPassed === true, cases, summary: summarizeRanks(cases),
  hybridSummary: summarizeRanks(cases.map((entry) => ({ rank: entry.hybridRank }))),
  limitation: "Only complete five-kind language sets are checked offline. Not a full-index validation or unseen accuracy benchmark." };
fs.writeFileSync(path.join(root, "data/reports/retrieval-preview.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ provisional: true, semantic: report.summary, hybrid: report.hybridSummary }));
