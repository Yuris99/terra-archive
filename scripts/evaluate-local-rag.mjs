import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchiveStore } from "./lib/local-search.mjs";
import { generateLocalAnswer } from "./lib/local-rag.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createArchiveStore(root);
const model = process.argv[2] ?? "gemma4:12b";
const cases = [];
for (const question of [
  "이 자료에서 살카즈를 어떻게 설명하는지 근거를 들어 짧게 알려줘.",
  "켈시가 살카즈의 고통과 광석병에 대해 말한 내용만 알려줘. 종족 전체에 대한 다른 인물의 경험으로 일반화하지 마.",
]) {
  const answer = await generateLocalAnswer({ store, question, query: "살카즈", locale: "ko_KR", kind: "profile", model });
  assert.ok(answer.claims.length > 0, "real local model must supply at least one exact quote");
  for (const claim of answer.claims) for (const citation of claim.citations) {
    assert.ok(answer.sources[citation.source - 1].text.includes(citation.quote));
  }
  assert.equal(answer.verification.interpretations, "unverified");
  cases.push({ question, claims: answer.claims, sourceIds: answer.sources.map((source) => source.id),
    rejectedClaims: answer.rejectedClaims, durationMs: answer.durationMs,
    verification: answer.verification, uncertainty: answer.uncertainty });
  console.log(JSON.stringify(cases.at(-1)));
}
const report = { generatedAtUtc: new Date().toISOString(), model,
  quoteValidationPassed: true, semanticValidationPassed: null, cases,
  limitations: [
    "Two local-model smoke tests, not a semantic accuracy benchmark.",
    "A previous test produced a semantically distorted explanation despite an exact source quote.",
    "The UI defaults to source quotes and hides unverified AI interpretations in disclosure panels.",
    "Retrieval uses literal keywords and five chunks; no embeddings or full-corpus reasoning.",
  ] };
fs.writeFileSync(path.join(root, "data/reports/local-rag-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ quoteValidationPassed: true, semanticValidationPassed: null, model, cases: cases.length }));
