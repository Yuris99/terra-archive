import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { byteRange, createMediaStore } from "../lib/local-media.mjs";

test("audio byte ranges handle open bounds, suffixes, and unsatisfiable requests", () => {
  assert.deepEqual(byteRange("bytes=2-5", 10), { start: 2, end: 5, partial: true });
  assert.deepEqual(byteRange("bytes=7-", 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(byteRange("bytes=0-99", 10), { start: 0, end: 9, partial: true });
  for (const bad of ["bytes=20-", "bytes=-0", "bytes=5-2", "bytes=0-1,4-5", "bytes=-", "bytes=9007199254740992-"]) assert.equal(byteRange(bad, 10), null);
});

test("viewer only serves allowlisted media and fails closed after policy changes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terra-media-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, data) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data); };
  const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
  write("config/retrieval-policy.json", "policy");
  write("data/retrieval/global-v1/manifest.json", "selection");
  const id = "a".repeat(32), outside = "b".repeat(32);
  write("data/raw/arknights-assets2/voice/test.mp3", "0123456789");
  write("private.mp3", "private");
  write("data/indexes/media-v1/index.json", JSON.stringify({ schemaVersion: 1, policySha256: hash("policy"), selectionSha256: hash("selection"),
    operators: { released: { id: "released", name: "Released", images: [], voices: [{ id }] } },
    stories: {}, documentSubjects: { "voice:released": { operator: "released" } },
    files: { [id]: { path: "data/raw/arknights-assets2/voice/test.mp3", bytes: 10 }, [outside]: { path: "private.mp3", bytes: 7 } } }));
  const store = createMediaStore(root);
  assert.equal(store.operator("unreleased"), null);
  assert.equal(store.operator("__proto__"), null);
  assert.equal(store.document("ko_KR:voice:released").name, "Released");
  assert.equal(store.document("ko_KR:story:future"), null);
  assert.equal((await store.response("../private.mp3")).status, 404);
  assert.equal((await store.response(outside)).status, 404);
  assert.equal((await store.response("c".repeat(32))).status, 404);
  const response = await store.response(id, "bytes=2-5");
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(await response.text(), "2345");
  assert.equal((await store.response(id, "bytes=99-")).status, 416);
  assert.equal((await store.response(id, null, true)).body, null);
  write("config/retrieval-policy.json", "changed");
  assert.throws(() => store.operator("released"), /공개 범위/);
});
