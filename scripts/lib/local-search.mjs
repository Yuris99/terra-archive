import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { sha256 } from "./chunk-corpus.mjs";

export const LOCALES = ["ko_KR", "en_US", "ja_JP", "zh_CN"];
export const KINDS = ["story", "profile", "voice", "module", "skin"];
export function parseSearchQuery(value) {
  if (typeof value !== "string" || value.length > 200) throw new Error("검색어는 200자 이내로 입력하세요.");
  const terms = [...value.normalize("NFC").toLowerCase().matchAll(/"([^"]+)"|([^\s"]+)/g)]
    .map((match) => (match[1] ?? match[2]).trim()).filter(Boolean);
  if (!terms.length || terms.length > 12) throw new Error("검색어를 1~12개 입력하세요. 따옴표로 문구를 묶을 수 있습니다.");
  return [...new Set(terms)];
}

export function searchRecords(records, { query, limit = 20, offset = 0, documentId = null }) {
  const terms = parseSearchQuery(query);
  const results = [];
  for (const record of records) {
    if (documentId && record.document.id !== documentId) continue;
    const doc = record.document;
    const metadata = [doc.title, doc.context.groupName, doc.context.storyCode, doc.context.operator?.name, doc.context.operator?.id]
      .filter(Boolean).join(" ").normalize("NFC").toLowerCase();
    for (const chunk of record.chunks) {
      const body = chunk.text.normalize("NFC").toLowerCase();
      if (!terms.every((term) => body.includes(term) || metadata.includes(term))) continue;
      const score = terms.reduce((sum, term) => sum + (body.includes(term) ? 4 : 1) + (doc.title.toLowerCase().includes(term) ? 1 : 0), 0);
      results.push({ id: chunk.id, documentId: doc.id, canonicalId: doc.canonicalId, locale: doc.locale, kind: doc.kind,
        title: doc.title, groupName: doc.context.groupName ?? doc.context.operator?.name ?? null,
        storyCode: doc.context.storyCode ?? null, text: chunk.text, spans: chunk.spans, condition: chunk.condition,
        annotations: chunk.annotations, warnings: chunk.warnings, source: doc.source, score });
    }
  }
  results.sort((a, b) => b.score - a.score || a.documentId.localeCompare(b.documentId) || a.spans[0].segmentOrdinal - b.spans[0].segmentOrdinal);
  // Repeated identical content in one language is collapsed in results, not deleted from the archive.
  const unique = [], keys = new Set();
  for (const result of results) {
    const key = `${result.locale}:${result.kind}:${result.text}`;
    if (keys.has(key)) continue;
    keys.add(key); unique.push(result);
  }
  return { total: unique.length, results: unique.slice(offset, offset + limit), terms, mode: "literal-all-terms" };
}

export function createArchiveStore(projectRoot) {
  const indexRoot = path.join(projectRoot, "data/indexes/global-v1");
  const selectedRoot = path.join(projectRoot, "data/retrieval/global-v1");
  const cache = new Map();
  let stamp = "";
  function manifest() {
    const bytes = fs.readFileSync(path.join(indexRoot, "manifest.json"));
    const data = JSON.parse(bytes);
    assert.equal(data.validationPassed, true, "검색 자료 생성·검증이 완료되지 않았습니다.");
    const selectedBytes = fs.readFileSync(path.join(selectedRoot, "manifest.json"));
    assert.equal(data.inputManifestSha256, sha256(selectedBytes), "선택본이 변경됐습니다. 검색 자료를 다시 생성하세요.");
    assert.equal(JSON.parse(selectedBytes).annotations.registrySha256, sha256(fs.readFileSync(path.join(projectRoot, "config/content-annotations.json"))), "언어판 차이 표시가 변경됐습니다. 재검증이 필요합니다.");
    assert.equal(data.policySha256, sha256(fs.readFileSync(path.join(projectRoot, "config/retrieval-policy.json"))));
    assert.equal(data.chunkPolicySha256, sha256(fs.readFileSync(path.join(projectRoot, "config/chunk-policy.json"))));
    const next = sha256(bytes);
    if (stamp !== next) { cache.clear(); stamp = next; }
    return data;
  }
  function records(locale, kind = "all") {
    if (!LOCALES.includes(locale) || (kind !== "all" && !KINDS.includes(kind))) throw new Error("지원하지 않는 언어 또는 자료 종류입니다.");
    const data = manifest();
    return data.files.filter((file) => file.locale === locale && (kind === "all" || file.kind === kind)).flatMap((file) => {
      assert.equal(file.path, `${file.locale}/${file.kind}.jsonl`);
      const absolute = path.join(indexRoot, file.path);
      const fileStamp = `${fs.statSync(absolute).mtimeMs}:${fs.statSync(absolute).size}`;
      const cached = cache.get(file.path);
      if (cached?.stamp === fileStamp) return cached.records;
      const bytes = fs.readFileSync(absolute);
      assert.equal(sha256(bytes), file.sha256, "검색 자료 해시가 다릅니다. 재검증이 필요합니다.");
      const parsed = bytes.toString("utf8").trimEnd().split("\n").filter(Boolean).map(JSON.parse);
      assert.equal(parsed.length, file.documents);
      cache.set(file.path, { stamp: fileStamp, records: parsed });
      // Keep at most two languages in memory for local research use.
      const locales = [...new Set([...cache.keys()].map((key) => key.split("/")[0]))];
      if (locales.length > 2) for (const key of cache.keys()) if (key.startsWith(`${locales[0]}/`)) cache.delete(key);
      return parsed;
    });
  }
  return {
    records,
    status: () => { const data = manifest(); return { ready: true, documents: data.documents, segments: data.segments,
      chunks: data.chunks, markedChunks: data.markedChunks, sourceCommit: data.sourceCommit, policyId: data.policyId,
      locales: LOCALES, semanticSearch: false, branchRoutesResolved: false }; },
    search: ({ locale = "ko_KR", kind = "all", query, limit = 20, offset = 0 }) => searchRecords(records(locale, kind), { query, limit, offset }),
    document: (id, offset = 0, limit = 30) => {
      if (typeof id !== "string" || id.length > 500) throw new Error("문서 ID가 올바르지 않습니다.");
      const [locale, kind] = id.split(":");
      const record = records(locale, kind).find((entry) => entry.document.id === id);
      if (!record) return null;
      return { document: record.document, totalChunks: record.chunks.length, chunks: record.chunks.slice(offset, offset + limit),
        variants: LOCALES.map((language) => ({ locale: language, documentId: `${language}:${record.document.canonicalId}` })) };
    },
  };
}
