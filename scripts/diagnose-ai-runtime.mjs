import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { ANSWER_SCHEMA, OLLAMA_BASE, generateLocalAnswer, localModels } from "./lib/local-rag.mjs";
import { createArchiveStore } from "./lib/local-search.mjs";
import { createSemanticSearch } from "./lib/semantic-search.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2] ?? "plain";
assert(["plain", "schema", "one", "five", "coexist-plain", "release-embedding-plain"].includes(stage));
const preset = process.argv[3] ?? "baseline";
assert(["baseline", "gpu40", "gpu40-release"].includes(preset), "Known diagnostic preset only");
const model = "gemma4:12b";
assert((await localModels()).some((entry) => entry.name === model), "Installed local completion model only");
const destination = path.join(root, "data/reports/ai-runtime-diagnostic-20261004.json");
const report = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination)) : {
  model, cases: [], limitations: ["Controlled runtime checks, not general answer accuracy.", "Only project-selected sources and installed models; no download or global settings changes."] };
const options = { temperature: 0, num_predict: 64, num_ctx: 8192, num_batch: 256 };
if (preset.startsWith("gpu40")) options.num_gpu = 40;
const started = performance.now();
const entry = { stage, preset, startedAtUtc: new Date().toISOString(), model, options, completed: false };
async function snapshot() {
  return (await (await fetch(`${OLLAMA_BASE}/api/ps`, { signal: AbortSignal.timeout(5000) })).json()).models
    .map(({ name, size, size_vram, context_length }) => ({ name, size, size_vram, context_length }));
}
async function releaseProjectEmbedding() {
  const policy = JSON.parse(fs.readFileSync(path.join(root, "config/semantic-policy.json")));
  const tags = await (await fetch(`${OLLAMA_BASE}/api/tags`)).json();
  assert(tags.models.some((installed) => installed.name === policy.model && installed.digest === policy.modelDigest));
  const response = await fetch(`${OLLAMA_BASE}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000), body: JSON.stringify({ model: policy.model, keep_alive: 0, stream: false }) });
  assert(response.ok, "Project embedding model unload failed");
  entry.modelsAfterRelease = await snapshot();
}
function metrics(data) {
  return Object.fromEntries(["total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration"]
    .map((key) => [key, data[key]]));
}
async function streamed(body) {
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(180000), body: JSON.stringify({ model, think: false, keep_alive: "10m", stream: true, options, ...body }) });
  if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 400)}`);
  let buffer = "", content = "", done = false;
  const decoder = new TextDecoder();
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
      if (!line) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(data.error);
      const text = data.message?.content ?? "";
      if (text && entry.firstTokenMs === undefined) {
        entry.firstTokenMs = Math.round(performance.now() - started);
        console.log(JSON.stringify({ stage, firstTokenMs: entry.firstTokenMs }));
      }
      content += text;
      entry.receivedCharacters = content.length;
      if (data.done) { entry.metrics = metrics(data); done = true; }
    }
  }
  assert(done, "No completed response frame");
  return content;
}
try {
  entry.modelsBefore = await snapshot();
  if (stage === "release-embedding-plain") {
    await releaseProjectEmbedding();
  }
  if (["plain", "coexist-plain", "release-embedding-plain"].includes(stage)) {
    if (stage === "coexist-plain") {
      const archive = createArchiveStore(root), semantic = createSemanticSearch(root, archive);
      const result = await semantic.search({ query: "시티 라이더 옷은 누가 직접 디자인했어?", mode: "hybrid", limit: 5 });
      entry.retrieved = result.results.map(({ id, title }) => ({ id, title }));
      entry.modelsAfterRetrieval = await snapshot();
    }
    entry.response = await streamed({ messages: [{ role: "user", content: "2+2는? 숫자 하나만 답해." }] });
    entry.expectedResponsePassed = entry.response.trim() === "4";
  } else if (stage === "schema") {
    options.num_predict = 256;
    entry.response = await streamed({ format: ANSWER_SCHEMA, messages: [{ role: "user", content:
      '근거 1: "로도스 아일랜드의 공식 리더는 아미야다." 질문: 공식 리더는 누구인가? claims 한 개에 설명과 source 1, 정확한 짧은 quote를 넣고 uncertainty는 빈 문자열로 답해.' }] });
    const answer = JSON.parse(entry.response);
    assert.equal(answer.claims.length, 1);
    assert.equal(answer.claims[0].citations[0].source, 1);
  } else {
    const archive = createArchiveStore(root), semantic = createSemanticSearch(root, archive);
    const dataset = JSON.parse(fs.readFileSync(path.join(root, "config/retrieval-evaluation.json")));
    const expected = dataset.questions.find((question) => question.id === "ko-leader");
    let store = archive;
    if (stage === "one") {
      const evidence = archive.search({ query: expected.keywords, locale: expected.locale, limit: 20 }).results
        .find((source) => source.text.includes(expected.quote));
      assert(evidence, "Verified source quote must exist");
      store = { search: () => ({ results: [evidence], mode: "diagnostic-one-source" }) };
    }
    const fetcher = async (url, input) => {
      if (url.endsWith("/api/chat")) {
        const body = JSON.parse(input.body);
        if (preset.startsWith("gpu40")) body.options.num_gpu = 40;
        if (preset === "gpu40-release") await releaseProjectEmbedding();
        entry.options = body.options;
        input = { ...input, body: JSON.stringify(body) };
      }
      const response = await fetch(url, input);
      if (url.endsWith("/api/chat") && response.ok) entry.metrics = metrics(await response.clone().json());
      return response;
    };
    const answer = await generateLocalAnswer({ store, semantic, mode: stage === "one" ? "literal" : "hybrid",
      question: expected.question, query: expected.keywords, locale: expected.locale, model, fetcher });
    entry.claims = answer.claims;
    entry.uncertainty = answer.uncertainty;
    entry.rejectedClaims = answer.rejectedClaims;
    entry.expectedQuoteCited = answer.claims.some((claim) => claim.citations.some((citation) => citation.quote.includes(expected.quote)));
    entry.sources = answer.sources.map(({ id, title }) => ({ id, title }));
  }
  entry.completed = true;
} catch (error) {
  entry.error = error.message;
  entry.errorName = error.name;
  process.exitCode = 1;
} finally {
  entry.elapsedMs = Math.round(performance.now() - started);
  try { entry.modelsAfter = await snapshot(); } catch (error) { entry.snapshotError = error.message; }
  report.cases.push(entry);
  report.updatedAtUtc = new Date().toISOString();
  fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(entry));
}
