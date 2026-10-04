import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createArchiveStore, LOCALES } from "./lib/local-search.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const store = createArchiveStore(root);
const selected = json("data/retrieval/global-v1/catalog.json").entries;
const full = json("data/normalized/v1/catalog.json").entries;
const selectedIds = new Set(selected.map((entry) => entry.canonicalId));
const held = full.filter((entry) => !selectedIds.has(entry.canonicalId));
assert.equal(held.length, 1433);
const cases = [];
for (const [locale, query] of [["ko_KR", "살카즈"], ["en_US", "Sarkaz"], ["ja_JP", "サルカズ"], ["zh_CN", "萨卡兹"]]) {
  const start = performance.now();
  const found = store.search({ query, locale, kind: "story", limit: 20 });
  assert.ok(found.total > 0);
  assert.ok(found.results.every((result) => result.locale === locale && result.text.toLowerCase().includes(query.toLowerCase()) && selectedIds.has(result.canonicalId)));
  cases.push({ locale, query, total: found.total, elapsedMs: Math.round(performance.now() - start) });
}
const baselineRecords = selected.filter((entry) => entry.kind === "story");
for (const title of ["불을 쫓는 낙엽", "오랜만"]) {
  const found = store.search({ query: `"${title}"`, locale: "ko_KR", kind: "story", limit: 5 });
  assert.ok(found.total > 0, `supplemental Korean story group ${title} searchable`);
  cases.push({ locale: "ko_KR", query: title, total: found.total });
}
const video = baselineRecords.find((entry) => entry.canonicalId.includes("level_main_14-20_beg"));
assert.ok(video);
for (const locale of LOCALES) {
  const record = store.document(video.variants[locale].documentId);
  assert.equal(record.document.contentState, "video-only"); assert.equal(record.totalChunks, 0);
}
const mark = json("data/retrieval/global-v1/annotations.json").entries[0];
const marked = store.document(mark.documentId, 0, 10000);
assert.equal(marked.chunks.flatMap((chunk) => chunk.annotations).filter((entry) => entry.id === mark.id).length, 1);
const main17 = held.find((entry) => entry.canonicalId.includes("level_main_17"));
assert.ok(main17 && main17.variants.zh_CN);
assert.equal(store.document(main17.variants.zh_CN.documentId), null, "known held chapter cannot be read via API store");
assert.throws(() => store.document("../../etc/passwd"));
assert.throws(() => store.search({ locale: "bad", query: "x" }));
assert.throws(() => store.search({ query: "" }));
const report = { generatedAtUtc: new Date().toISOString(), validationPassed: true, cases,
  tested: { heldCanonicalRecords: held.length, videoOnlyLocales: 4, propagatedAnnotations: 1, supplementalKoreanGroups: 2,
    invalidPathsRejected: true, invalidQueriesRejected: true }, limitations: [
    "These are literal-search smoke checks, not a semantic retrieval benchmark or full question-answer evaluation.",
    "Source conditions are preserved; complete game branch routes are not interpreted.",
  ] };
fs.writeFileSync(path.join(root, "data/reports/search-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
