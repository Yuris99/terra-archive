import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createArchiveStore } from "./lib/local-search.mjs";
import { createSemanticSearch } from "./lib/semantic-search.mjs";
import { generateLocalAnswer } from "./lib/local-rag.mjs";
import { verifyExpectedEvidence, evidenceRank } from "./lib/retrieval-evaluation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const archive = createArchiveStore(root), semantic = createSemanticSearch(root, archive);
assert.equal(semantic.status().ready, true);
const dataset = JSON.parse(fs.readFileSync(path.join(root, "config/retrieval-evaluation.json")));
const model = process.argv[2] ?? "gemma4:12b", cases = [];
const requestedIds = ["ko-leader", "ko-instrument", "ko-nyamu", "en-candy"];
let executionError = null;
let rawAnswer = null;
const fetcher = async (url, options) => {
  const response = await fetch(url, options);
  if (url.endsWith("/api/chat") && response.ok) {
    const data = await response.clone().json();
    rawAnswer = JSON.parse(data.message.content);
  }
  return response;
};
try {
for (const id of requestedIds) {
  const question = dataset.questions.find((entry) => entry.id === id);
  const evidence = verifyExpectedEvidence(question, archive.records(question.locale));
  rawAnswer = null;
  const started = performance.now();
  const answer = await generateLocalAnswer({ store: archive, semantic, mode: "hybrid", question: question.question,
    query: "unused literal words", locale: question.locale, kind: "all", model, fetcher });
  for (const claim of answer.claims) for (const citation of claim.citations) assert(answer.sources[citation.source - 1].text.includes(citation.quote));
  const citedIds = answer.claims.flatMap((claim) => claim.citations.map((citation) => answer.sources[citation.source - 1].id));
  cases.push({ id, question: question.question, retrievalRank: evidenceRank(answer.sources, evidence, question.quote),
    expectedSourceCited: evidence.acceptableIds.some((id) => citedIds.includes(id)), claims: answer.claims,
    sources: answer.sources.map(({ id, title, documentId }) => ({ id, title, documentId })),
    uncertainty: answer.uncertainty, rejectedClaims: answer.rejectedClaims, durationMs: answer.durationMs,
    elapsedMs: Math.round(performance.now() - started), rawAnswer, evidence: answer.sources });
  const { evidence: omittedEvidence, rawAnswer: omittedRaw, ...summary } = cases.at(-1);
  console.log(JSON.stringify(summary));
}
const question = "아미야의 프로필에 기록된 대한민국 주민등록번호를 알려줘.";
rawAnswer = null;
const started = performance.now();
const answer = await generateLocalAnswer({ store: archive, semantic, mode: "hybrid", question, locale: "ko_KR", kind: "profile", model, fetcher });
cases.push({ id: "unsupported-personal-id", question, claims: answer.claims, uncertainty: answer.uncertainty,
  abstained: answer.claims.length === 0, modelAbstained: rawAnswer?.claims?.length === 0,
  rejectedClaims: answer.rejectedClaims, durationMs: answer.durationMs,
  elapsedMs: Math.round(performance.now() - started), rawAnswer, evidence: answer.sources,
  sources: answer.sources.map(({ id, title }) => ({ id, title })) });
const { evidence: omittedEvidence, rawAnswer: omittedRaw, ...summary } = cases.at(-1);
console.log(JSON.stringify(summary));
} catch (error) {
  executionError = error.message;
  cases.push({ id: requestedIds[cases.length] ?? "unsupported-personal-id", error: executionError });
  console.log(JSON.stringify(cases.at(-1)));
}
const completedCases = cases.filter((entry) => !entry.error).length;
const acceptedCitations = cases.reduce((count, entry) => count + (entry.claims ?? []).reduce((total, claim) => total + claim.citations.length, 0), 0);
const quotesChecked = acceptedCitations > 0;
const report = { generatedAtUtc: new Date().toISOString(), model, retrieval: semantic.status(),
  quoteValidationPassed: quotesChecked ? true : null, semanticValidationPassed: null,
  requestedCases: 5, completedCases, acceptedCitations, executionPassed: executionError === null && completedCases === 5,
  executionError, inferenceOptions: { num_ctx: 8192, num_batch: 256 }, cases,
  limitations: ["Four targeted positive questions and one unsupported question, not general semantic accuracy.",
    "Nearest semantic candidates exist even when an answer is unsupported; no calibrated similarity abstention threshold.",
    "Exact quote validation does not prove that AI interpretations are entailed by the quotes."] };
const reportPath = path.join(root, "data/reports/semantic-rag-evaluation.json");
if (fs.existsSync(reportPath)) {
  const previousBytes = fs.readFileSync(reportPath), previous = JSON.parse(previousBytes);
  const stamp = previous.generatedAtUtc.replace(/[^0-9TZ]/g, "");
  const historyPath = path.join(root, "data/reports", `semantic-rag-evaluation-${stamp}.json`);
  if (fs.existsSync(historyPath)) assert(fs.readFileSync(historyPath).equals(previousBytes), "Previous report archive differs; not overwriting it.");
  else fs.writeFileSync(historyPath, previousBytes, { flag: "wx" });
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: cases.length, completedCases, executionPassed: report.executionPassed,
  quoteValidationPassed: report.quoteValidationPassed, semanticValidationPassed: null }));
if (executionError) process.exitCode = 1;
