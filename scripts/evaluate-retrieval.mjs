import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { createArchiveStore, LOCALES } from "./lib/local-search.mjs";
import { createSemanticSearch } from "./lib/semantic-search.mjs";
import { verifyExpectedEvidence, evidenceRank, summarizeRanks } from "./lib/retrieval-evaluation.mjs";
import { sha256 } from "./lib/chunk-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bytes = fs.readFileSync(path.join(root, "config/retrieval-evaluation.json"));
const dataset = JSON.parse(bytes), archive = createArchiveStore(root);
assert.equal(archive.status().sourceCommit, dataset.sourceCommit);
const semantic = createSemanticSearch(root, archive);
const semanticReady = process.argv.includes("--semantic");
if (semanticReady) assert.equal(semantic.status().ready, true);
const modes = ["literal-natural-question", "literal-manual-keywords", ...(semanticReady ? ["semantic-natural-question", "hybrid-natural-question"] : [])];
const runs = modes.map((mode) => ({ mode, cases: [] }));
for (const locale of LOCALES) {
  const records = archive.records(locale);
  for (const question of dataset.questions.filter((question) => question.locale === locale)) {
    const evidence = verifyExpectedEvidence(question, records);
    for (const run of runs) {
      const query = run.mode === "literal-manual-keywords" ? question.keywords : question.question;
      const started = performance.now();
      const result = (run.mode.startsWith("semantic") || run.mode.startsWith("hybrid")) ? await semantic.search({ query, locale, kind: "all", limit: 20,
        mode: run.mode.startsWith("hybrid") ? "hybrid" : "semantic" })
        : archive.search({ query, locale, kind: "all", limit: 20 });
      const rank = evidenceRank(result.results, evidence, question.quote);
      run.cases.push({ id: question.id, family: question.family, locale, query, rank, total: result.total,
        elapsedMs: Math.round(performance.now() - started), evidence,
        top5: result.results.slice(0, 5).map((chunk) => ({ id: chunk.id, title: chunk.title, score: chunk.score })) });
      console.log(JSON.stringify({ mode: run.mode, id: question.id, rank, ms: run.cases.at(-1).elapsedMs }));
    }
  }
}
for (const run of runs) {
  run.summary = summarizeRanks(run.cases);
  run.byLocale = Object.fromEntries(LOCALES.map((locale) => [locale, summarizeRanks(run.cases.filter((entry) => entry.locale === locale))]));
}
const report = { generatedAtUtc: new Date().toISOString(), datasetId: dataset.id, datasetSha256: sha256(bytes),
  sourceCommit: dataset.sourceCommit, indexManifestSha256: sha256(fs.readFileSync(path.join(root, "data/indexes/global-v1/manifest.json"))),
  semantic: semanticReady ? semantic.status() : null, evidenceValidationPassed: true, limitations: dataset.limitations, runs };
const destination = path.join(root, `data/reports/retrieval-${semanticReady ? "comparison" : "baseline"}.json`);
fs.writeFileSync(destination, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: destination, summaries: runs.map(({ mode, summary }) => ({ mode, ...summary })) }));
