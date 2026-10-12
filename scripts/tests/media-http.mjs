import assert from "node:assert/strict";
import fs from "node:fs";

const base = process.env.TERRA_MEDIA_TEST_URL ?? "http://127.0.0.1:3010";
const checks = [];
const index = JSON.parse(fs.readFileSync("data/indexes/media-v1/index.json", "utf8"));
async function get(url) {
  const response = await fetch(base + url);
  assert.equal(response.status, 200, url);
  return response.json();
}
const catalog = await get("/api/archive/media");
assert.deepEqual(catalog.summary, index.summary);
checks.push("catalog matches local allowlist");
const operator = await get("/api/archive/media?operator=char_102_texas");
assert.ok(operator.images.length > 0 && operator.voices.some((voice) => voice.languageId === "voice_kr"));
checks.push("operator illustration and Korean voice mapping");
for (const media of [operator.images[0], operator.voices.find((voice) => voice.languageId === "voice_kr")]) {
  const original = fs.readFileSync(index.files[media.id].path);
  const response = await fetch(base + media.url, { headers: { Range: "bytes=0-63" } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), `bytes 0-63/${original.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), original.subarray(0, 64));
  assert.equal(response.headers.get("Content-Type"), media.category === "voice" ? "audio/mpeg" : "image/png");
  const head = await fetch(base + media.url, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("Content-Length")), original.length);
}
checks.push("image and voice stream original bytes with Range and HEAD");
const invalidRange = await fetch(base + operator.voices[0].url, { headers: { Range: "bytes=99999999999-" } });
assert.equal(invalidRange.status, 416);
checks.push("invalid range rejected");
const story = await get("/api/archive/media?document=ko_KR:story:activities/a001/level_a001_01_beg");
assert.ok(story.images.some((image) => image.label === "ac1_0") && story.images.some((image) => image.category === "background"));
checks.push("story explicitly referenced CG and background");
for (const url of ["/api/archive/media?operator=__proto__", "/api/archive/media?operator=char_unknown_unreleased", "/api/archive/media?document=ko_KR:story:main/level_17-01_beg", "/api/archive/media/file?id=../config/retrieval-policy.json", `/api/archive/media/file?id=${"0".repeat(32)}`]) {
  assert.equal((await fetch(base + url)).status, 404, url);
}
checks.push("unknown, held-out, prototype, and traversal requests rejected");
assert.ok(catalog.korean.length > 0 && catalog.korean.length < catalog.koreanSource.savedImages);
const kr = await fetch(base + catalog.korean[0].url, { headers: { Range: "bytes=0-7" } });
assert.equal(kr.status, 206);
assert.equal(Buffer.from(await kr.arrayBuffer()).toString("hex"), "89504e470d0a1a0a");
checks.push("Korean image subset and PNG stream");
const report = { checkedAt: new Date().toISOString(), base, passed: true, checks, summary: catalog.summary };
fs.mkdirSync("data/reports", { recursive: true });
fs.writeFileSync("data/reports/media-http-20261012.json", JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
