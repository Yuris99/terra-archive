import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? "http://127.0.0.1:3010";
const semanticRequired = process.argv.includes("--semantic");
const url = new URL(base);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "local test targets only");
const cases = [];
async function check(name, route, expected, options) {
  const response = await fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, expected, name);
  cases.push({ name, status: response.status });
  return response.json();
}
const status = await check("validated corpus and local models available", "/api/archive/status", 200);
assert.equal(status.semanticSearch, semanticRequired);
assert.ok(status.models.length > 0);
assert.ok(!status.models.some((entry) => entry.name === "qwen3-embedding:0.6b"));
const search = await check("Korean literal story search", "/api/archive/search?q=" + encodeURIComponent("살카즈") + "&locale=ko_KR&kind=story", 200);
assert.ok(search.total > 0); assert.equal(search.results.length, 20);
const doc = await check("original document with four language variants", "/api/archive/document?id=" + encodeURIComponent(search.results[0].documentId), 200);
assert.equal(doc.variants.length, 4);
await check("invalid locale rejected", "/api/archive/search?q=x&locale=invalid", 400);
await check("invalid pagination rejected", "/api/archive/search?q=x&offset=-1", 400);
await check("unknown retrieval mode rejected", "/api/archive/search?q=x&mode=unknown", 400);
await check("external-origin search requests blocked", "/api/archive/search?q=x&mode=semantic", 403, { headers: { Origin: "https://example.com" } });
await check("cross-site browser GET without Origin blocked", "/api/archive/search?q=x&mode=semantic", 403, { headers: { "Sec-Fetch-Site": "cross-site" } });
await check("path traversal rejected", "/api/archive/document?id=" + encodeURIComponent("../../etc/passwd"), 400);
const selected = new Set(JSON.parse(fs.readFileSync(path.join(root, "data/retrieval/global-v1/catalog.json"), "utf8")).entries.map((entry) => entry.canonicalId));
const full = JSON.parse(fs.readFileSync(path.join(root, "data/normalized/v1/catalog.json"), "utf8")).entries;
const held = full.find((entry) => !selected.has(entry.canonicalId) && entry.canonicalId.includes("level_main_17"));
assert.ok(held);
await check("held chapter 17 inaccessible", "/api/archive/document?id=" + encodeURIComponent(held.variants.zh_CN.documentId), 404);
await check("external-origin model requests blocked", "/api/archive/answer", 403, {
  method: "POST", headers: { Origin: "https://example.com", "Content-Type": "application/json" }, body: "{}",
});
await check("oversized requests blocked", "/api/archive/answer", 413, { method: "POST", body: "x".repeat(16001) });
const empty = await check("no evidence means no model invocation", "/api/archive/answer", 200, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: base },
  body: JSON.stringify({ query: "terra_archive_nonexistent_9b732", question: "근거가 있어?" }),
});
assert.equal(empty.model, null); assert.equal(empty.claims.length, 0);
if (semanticRequired) {
  const result = await check("natural-language hybrid retrieval", "/api/archive/search?mode=hybrid&locale=ko_KR&q=" + encodeURIComponent("아미야가 다시 연습하기 시작한 악기는 뭐야?"), 200);
  assert.equal(result.mode, "hybrid-rrf"); assert.equal(result.rankingOnly, true);
  assert(result.results.some((entry) => entry.text.includes("바이올린")));
  assert(result.results.every((entry) => selected.has(entry.canonicalId)), "only globally selected evidence may be returned");
  const pure = await check("pure semantic mode remains available", "/api/archive/search?mode=semantic&q=" + encodeURIComponent("살카즈"), 200);
  assert.equal(pure.mode, "semantic-cosine");
  const lastPage = await check("last hybrid page is accessible", "/api/archive/search?mode=hybrid&offset=240&q=" + encodeURIComponent("살카즈"), 200);
  assert.equal(lastPage.results.length, 10);
  await check("semantic pagination bounded", "/api/archive/search?mode=semantic&q=x&offset=250", 400);
} else await check("unfinished semantic index cannot be used", "/api/archive/search?mode=semantic&q=x", 400);
const report = { generatedAtUtc: new Date().toISOString(), validationPassed: true, cases };
fs.writeFileSync(path.join(root, "data/reports/server-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
