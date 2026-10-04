import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { sha256 } from "./chunk-corpus.mjs";
import { KINDS, LOCALES } from "./local-search.mjs";
import { OLLAMA_BASE } from "./local-rag.mjs";
import { HYBRID_POLICY, prepareHybridQuery, matchesAnchor, fuseHybridRanks } from "./hybrid-ranking.mjs";

export function embeddingText(document, chunk) {
  return [document.title, document.context.groupName, document.context.operator?.name,
    document.context.storyCode, chunk.text].filter(Boolean).join("\n");
}
export function uniqueInputs(records) {
  const inputs = [], rows = [], seen = new Map();
  for (const { document, chunks } of records) for (const chunk of chunks) {
    const input = embeddingText(document, chunk);
    let row = seen.get(input);
    if (row === undefined) { row = inputs.length; seen.set(input, row); inputs.push(input); }
    rows.push({ id: chunk.id, row });
  }
  return { inputs, rows };
}
export function normalizedVector(values, dimensions) {
  assert.equal(values?.length, dimensions, "임베딩 차원이 다릅니다.");
  assert(values.every(Number.isFinite), "임베딩에 잘못된 숫자가 있습니다.");
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  assert(norm > 0, "빈 임베딩을 사용할 수 없습니다.");
  return Float32Array.from(values, (value) => value / norm);
}
export async function installedEmbeddingModel(policy, fetcher = fetch) {
  const response = await fetcher(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("로컬 임베딩 모델 목록을 읽지 못했습니다.");
  const data = await response.json();
  const model = data.models?.find((entry) => entry.name === policy.model && entry.size > 0
    && !entry.remote_host && !entry.remote_model);
  assert(model && model.digest === policy.modelDigest, "지정한 로컬 임베딩 모델 버전이 설치되어 있어야 합니다. 자동 다운로드하지 않습니다.");
  return model;
}
export async function embedInputs(policy, input, { fetcher = fetch, signal } = {}) {
  const timeout = AbortSignal.timeout(120000);
  const response = await fetcher(`${OLLAMA_BASE}/api/embed`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    body: JSON.stringify({ model: policy.model, input, dimensions: policy.dimensions, truncate: false,
      keep_alive: "10m", options: { num_ctx: policy.contextTokens } }),
  });
  if (!response.ok) throw new Error(`로컬 임베딩 생성 실패 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  assert.equal(data.embeddings?.length, input.length, "임베딩 개수가 입력과 다릅니다.");
  return data.embeddings.map((values) => normalizedVector(values, policy.dimensions));
}
export function rankVectors(vectors, dimensions, query, count) {
  assert.equal(vectors.length % dimensions, 0);
  const scores = [];
  for (let row = 0; row < vectors.length / dimensions; row++) {
    let score = 0;
    for (let column = 0; column < dimensions; column++) score += vectors[row * dimensions + column] * query[column];
    scores.push({ row, score });
  }
  return scores.sort((a, b) => b.score - a.score || a.row - b.row).slice(0, count);
}

export function createSemanticSearch(projectRoot, archive, { fetcher = fetch } = {}) {
  const directory = path.join(projectRoot, "data/indexes/semantic-v1");
  const cache = new Map(), queryCache = new Map();
  let stamp = "";
  function manifest() {
    // This also validates the original global-release/annotation/chunk policies.
    archive.status();
    const policyBytes = fs.readFileSync(path.join(projectRoot, "config/semantic-policy.json"));
    const bytes = fs.readFileSync(path.join(directory, "manifest.json"));
    const data = JSON.parse(bytes), policy = JSON.parse(policyBytes);
    assert.equal(data.validationPassed, true, "의미 검색 자료 생성·검증이 아직 완료되지 않았습니다.");
    const originalBytes = fs.readFileSync(path.join(projectRoot, "data/indexes/global-v1/manifest.json"));
    assert.equal(data.inputManifestSha256, sha256(originalBytes), "본문 검색 자료가 변경됐습니다. 의미 검색 자료를 다시 생성하세요.");
    assert.equal(data.policySha256, sha256(policyBytes), "임베딩 설정이 변경됐습니다. 재생성이 필요합니다.");
    assert.equal(data.files.length, LOCALES.length * KINDS.length);
    assert.equal(new Set(data.files.map((file) => file.path)).size, data.files.length);
    const original = JSON.parse(originalBytes);
    for (const file of data.files) {
      assert(LOCALES.includes(file.locale) && KINDS.includes(file.kind));
      assert.equal(file.path, `${file.locale}/${file.kind}`);
      assert.equal(file.sourceSha256, original.files.find((entry) => entry.locale === file.locale && entry.kind === file.kind)?.sha256);
    }
    const next = sha256(bytes);
    if (stamp !== next) { cache.clear(); queryCache.clear(); stamp = next; }
    return { data, policy };
  }
  function load(file, policy) {
    assert(LOCALES.includes(file.locale) && KINDS.includes(file.kind));
    assert.equal(file.path, `${file.locale}/${file.kind}`);
    const records = archive.records(file.locale, file.kind);
    const cached = cache.get(file.path);
    const vectorPath = path.join(directory, `${file.path}.f32`), rowsPath = path.join(directory, `${file.path}.rows.json`);
    const fileStamp = `${fs.statSync(vectorPath).mtimeMs}:${fs.statSync(rowsPath).mtimeMs}:${fs.statSync(vectorPath).size}:${fs.statSync(rowsPath).size}`;
    if (cached?.stamp === fileStamp) return cached;
    const bytes = fs.readFileSync(vectorPath), rowBytes = fs.readFileSync(rowsPath);
    assert.equal(sha256(bytes), file.vectorsSha256, "의미 검색 벡터 해시가 다릅니다.");
    assert.equal(sha256(rowBytes), file.rowsSha256, "의미 검색 출처 연결 해시가 다릅니다.");
    assert.equal(bytes.length, file.uniqueInputs * policy.dimensions * 4);
    const mapping = JSON.parse(rowBytes), flattened = records.flatMap(({ document, chunks }) => chunks.map((chunk) => ({ document, chunk })));
    assert.equal(mapping.length, flattened.length);
    assert.equal(mapping.length, file.chunks);
    const rowSources = Array.from({ length: file.uniqueInputs }, () => []);
    mapping.forEach((entry, i) => {
      assert.equal(entry.id, flattened[i].chunk.id, "의미 검색 연결 순서가 원문과 다릅니다.");
      assert(Number.isInteger(entry.row) && entry.row >= 0 && entry.row < rowSources.length);
      rowSources[entry.row].push(flattened[i]);
    });
    assert(rowSources.every((entries) => entries.length));
    const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
    const loaded = { stamp: fileStamp, vectors, rowSources };
    cache.set(file.path, loaded);
    const languages = [...new Set([...cache.keys()].map((key) => key.split("/")[0]))];
    if (languages.length > 2) for (const key of cache.keys()) if (key.startsWith(`${languages[0]}/`)) cache.delete(key);
    return loaded;
  }
  return {
    status: () => {
      try { const { data, policy } = manifest(); return { ready: true, chunks: data.chunks, model: policy.model, dimensions: policy.dimensions, hybridRanking: HYBRID_POLICY.id }; }
      catch (error) {
        let progress;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json")));
          if (data.validationPassed === false && data.policySha256 === sha256(fs.readFileSync(path.join(projectRoot, "config/semantic-policy.json")))
            && data.inputManifestSha256 === sha256(fs.readFileSync(path.join(projectRoot, "data/indexes/global-v1/manifest.json")))
            && data.progress?.chunksTotal === archive.status().chunks
            && Number.isInteger(data.progress?.chunksCompleted) && data.progress.chunksCompleted >= 0 && data.progress.chunksCompleted <= data.progress.chunksTotal) progress = data.progress;
        } catch { /* Incompatible or unreadable output is not progress evidence. */ }
        return { ready: false, reason: error.code === "ENOENT" ? "의미 검색 자료를 아직 생성하지 않았습니다." : error.message, progress };
      }
    },
    search: async ({ query, locale = "ko_KR", kind = "all", mode = "semantic", limit = 20, offset = 0, signal }) => {
      if (!["semantic", "hybrid"].includes(mode)) throw new Error("지원하지 않는 검색 방식입니다.");
      if (!LOCALES.includes(locale) || (kind !== "all" && !KINDS.includes(kind))) throw new Error("지원하지 않는 언어 또는 자료 종류입니다.");
      if (typeof query !== "string" || !query.trim() || query.length > 1000) throw new Error("의미 검색 질문을 1~1,000자로 입력하세요.");
      if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset >= 250) throw new Error("의미 검색은 상위 250개 이내에서 조회하세요.");
      const { data, policy } = manifest();
      await installedEmbeddingModel(policy, fetcher);
      const normalized = query.normalize("NFC").trim();
      let vector = queryCache.get(normalized);
      if (!vector) {
        [vector] = await embedInputs(policy, [`Instruct: ${policy.queryInstruction}\nQuery: ${normalized}`], { fetcher, signal });
        queryCache.set(normalized, vector);
        if (queryCache.size > 64) queryCache.delete(queryCache.keys().next().value);
      }
      const candidates = [];
      const entries = [];
      const selectedFiles = data.files.filter((file) => file.locale === locale && (kind === "all" || file.kind === kind));
      const plan = mode === "hybrid" ? prepareHybridQuery(archive.records(locale, kind).map((record) => record.document), normalized) : null;
      let focusedVector = vector;
      if (plan?.anchored && plan.focusedQuery !== normalized) {
        const key = `focused:${plan.focusedQuery}`;
        focusedVector = queryCache.get(key);
        if (!focusedVector) {
          [focusedVector] = await embedInputs(policy, [`Instruct: ${policy.queryInstruction}\nQuery: ${plan.focusedQuery}`], { fetcher, signal });
          queryCache.set(key, focusedVector);
          if (queryCache.size > 64) queryCache.delete(queryCache.keys().next().value);
        }
      }
      // More unique rows than requested covers repeated text collapsed below, without returning the entire corpus.
      const count = Math.min(1000, (offset + limit) * 4 + 100);
      for (const file of selectedFiles) {
        const { vectors, rowSources } = load(file, policy);
        for (const { row, score } of rankVectors(vectors, policy.dimensions, vector, mode === "hybrid" ? rowSources.length : count)) {
          for (const { document: doc, chunk } of rowSources[row]) {
            const result = {
            id: chunk.id, documentId: doc.id, canonicalId: doc.canonicalId, locale: doc.locale, kind: doc.kind,
            title: doc.title, groupName: doc.context.groupName ?? doc.context.operator?.name ?? null,
            storyCode: doc.context.storyCode ?? null, text: chunk.text, spans: chunk.spans,
            condition: chunk.condition, annotations: chunk.annotations, warnings: chunk.warnings, source: doc.source, score,
            };
            if (mode === "hybrid") {
              let focusedScore;
              if (matchesAnchor(doc, plan)) {
                focusedScore = 0;
                for (let column = 0; column < policy.dimensions; column++) focusedScore += vectors[row * policy.dimensions + column] * focusedVector[column];
              }
              entries.push({ result, document: doc, semanticScore: score, focusedScore });
            } else candidates.push(result);
          }
        }
      }
      if (mode === "hybrid") {
        const ranked = fuseHybridRanks(entries, plan), total = Math.min(250, ranked.length);
        return { total, results: ranked.slice(offset, Math.min(offset + limit, total)), mode: "hybrid-rrf",
          model: policy.model, dimensions: policy.dimensions, rankingPolicy: HYBRID_POLICY.id, rankingOnly: true,
          anchors: { titles: [...plan.titles], operators: [...plan.operators] },
          warning: "제목·인물 이름·단어 단서와 의미를 함께 비교합니다. 검색 순위는 정답 여부나 근거의 충분함을 보증하지 않습니다." };
      }
      candidates.sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.spans[0].segmentOrdinal - b.spans[0].segmentOrdinal);
      const unique = [], seen = new Set();
      for (const candidate of candidates) {
        const key = `${candidate.locale}:${candidate.kind}:${candidate.text}`;
        if (!seen.has(key)) { seen.add(key); unique.push(candidate); }
      }
      const total = Math.min(250, unique.length);
      return { total, results: unique.slice(offset, Math.min(offset + limit, total)), mode: "semantic-cosine",
        model: policy.model, dimensions: policy.dimensions, rankingOnly: true,
        warning: "유사도 순위는 정답 여부나 근거의 충분함을 보증하지 않습니다." };
    },
  };
}
