import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createArchiveStore } from "./lib/local-search.mjs";
import { createSemanticSearch } from "./lib/semantic-search.mjs";
import { generateLocalAnswer } from "./lib/local-rag.mjs";
import { verifyExpectedEvidence, evidenceRank } from "./lib/retrieval-evaluation.mjs";
import { sha256 } from "./lib/chunk-corpus.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const phase = process.argv[2];
assert(["baseline", "revised", "held-out"].includes(phase), "Use baseline, revised, or held-out.");
const model = process.argv[3] ?? "gemma4:12b";
const configBytes = fs.readFileSync(path.join(root, "config/answer-quality-evaluation.json"));
const config = JSON.parse(configBytes);
const previous = JSON.parse(fs.readFileSync(path.join(root, "config/retrieval-evaluation.json")));
const questions = config.questions.filter((q) => q.split === (phase === "held-out" ? "held-out" : "development"))
  .map((q) => q.retrievalCaseId ? { ...previous.questions.find((entry) => entry.id === q.retrievalCaseId), ...q } : q);
assert.equal(new Set(questions.map((q) => q.id)).size, questions.length);
const store = createArchiveStore(root), semantic = createSemanticSearch(root, store);
assert.equal(semantic.status().ready, true);
// Validate the evaluator's expected quotes against the selected corpus before running any model.
const expected = new Map(questions.filter((q) => q.canonicalId).map((q) => [q.id, verifyExpectedEvidence(q, store.records(q.locale))]));
const startedAtUtc = new Date().toISOString();
const reportPath = path.join(root, "data/reports", `answer-quality-${phase}-${startedAtUtc.replace(/[^0-9TZ]/g, "")}.json`);
let rawAnswer = null, systemPrompt = null, inferenceOptions = null;
const fetcher = async (url, options) => {
  if (url.endsWith("/api/chat")) {
    const request = JSON.parse(options.body);
    systemPrompt = request.messages.find((m) => m.role === "system").content;
    inferenceOptions = request.options;
    assert.deepEqual(Object.keys(JSON.parse(request.messages.find((m) => m.role === "user").content)).sort(), ["evidence", "question"]);
  }
  const response = await fetch(url, options);
  if (url.endsWith("/api/chat") && response.ok) {
    const data = await response.clone().json();
    rawAnswer = JSON.parse(data.message.content);
  }
  return response;
};
const report = { id: config.id, phase, startedAtUtc, generatedAtUtc: null, model,
  configSha256: sha256(configBytes), ragImplementationSha256: sha256(fs.readFileSync(path.join(root, "scripts/lib/local-rag.mjs"))),
  systemPrompt: null, systemPromptSha256: null, inferenceOptions: null, retrieval: semantic.status(),
  requestedCases: questions.length, completedCases: 0, acceptedCitations: 0,
  executionPassed: false, quoteValidationPassed: null, semanticValidationPassed: null,
  cases: [], limitations: config.limitations };
// The new path is exclusive; checkpoint updates touch only this run's own file.
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: "wx" });
for (const q of questions) {
  rawAnswer = null;
  const started = performance.now();
  try {
    const answer = await generateLocalAnswer({ store, semantic, mode: "hybrid", question: q.question,
      query: "unused literal words", locale: q.locale, kind: q.kind ?? "all", model, fetcher });
    for (const claim of answer.claims) for (const citation of claim.citations) assert(answer.sources[citation.source - 1].text.includes(citation.quote));
    const citedIds = answer.claims.flatMap((claim) => claim.citations.map((c) => answer.sources[c.source - 1].id));
    const target = expected.get(q.id);
    const entry = { id: q.id, split: q.split, category: q.category, locale: q.locale, question: q.question,
      expectedBehavior: q.expectedBehavior, expectedEvidence: target ?? null,
      retrievalRank: target ? evidenceRank(answer.sources, target, q.quote) : null,
      expectedSourceCited: target ? target.acceptableIds.some((id) => citedIds.includes(id)) : null,
      claims: answer.claims, uncertainty: answer.uncertainty, rejectedClaims: answer.rejectedClaims,
      modelAbstained: rawAnswer?.claims?.length === 0, validatedAbstained: answer.claims.length === 0,
      durationMs: answer.durationMs, elapsedMs: Math.round(performance.now() - started),
      rawAnswer, evidence: answer.sources, semanticVerdict: null };
    report.cases.push(entry);
    report.completedCases++;
    report.acceptedCitations += answer.claims.reduce((sum, claim) => sum + claim.citations.length, 0);
    const { evidence, rawAnswer: raw, expectedEvidence, expectedBehavior, ...summary } = entry;
    console.log(JSON.stringify(summary));
  } catch (error) {
    report.cases.push({ id: q.id, error: error.message, elapsedMs: Math.round(performance.now() - started), rawAnswer });
    console.log(JSON.stringify(report.cases.at(-1)));
    process.exitCode = 1;
  }
  report.generatedAtUtc = new Date().toISOString();
  report.systemPrompt = systemPrompt;
  report.systemPromptSha256 = systemPrompt ? sha256(systemPrompt) : null;
  report.inferenceOptions = inferenceOptions;
  report.executionPassed = report.completedCases === report.requestedCases;
  report.quoteValidationPassed = report.acceptedCitations > 0 ? true : null;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  if (process.exitCode) break;
}
console.log(JSON.stringify({ reportPath, phase, completedCases: report.completedCases, requestedCases: report.requestedCases,
  executionPassed: report.executionPassed, acceptedCitations: report.acceptedCitations,
  quoteValidationPassed: report.quoteValidationPassed, semanticValidationPassed: null }));
