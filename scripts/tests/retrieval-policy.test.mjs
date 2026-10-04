import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { selectEntry, canRetrieve, publicationTimes, validatePolicy } from "../lib/retrieval-policy.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../config/retrieval-policy.json", import.meta.url), "utf8"));
const entry = (locales) => ({ canonicalId: "story:scene", kind: "story", variants: Object.fromEntries(locales.map((locale) => [locale, { documentId: `${locale}:story:scene` }])) });
const shared = entry(["ko_KR", "ja_JP", "en_US", "zh_CN"]);
const document = { id: "zh_CN:story:scene", canonicalId: "story:scene", kind: "story", locale: "zh_CN" };

test("Chinese translations of globally represented content remain eligible", () => {
  assert.equal(selectEntry(shared, policy).allowed, true);
  assert.equal(canRetrieve(document, shared, policy), true);
});

test("Chinese-only content and incomplete global coverage are rejected", () => {
  for (const locales of [["zh_CN"], ["zh_CN", "ja_JP"], ["zh_CN", "ko_KR"], ["zh_CN", "en_US"]]) {
    assert.equal(selectEntry(entry(locales), policy).allowed, false);
    assert.equal(canRetrieve(document, entry(locales), policy), false);
  }
  assert.equal(canRetrieve(document, undefined, policy), false);
  assert.equal(canRetrieve({ ...document, id: "fabricated" }, shared, policy), false);
});

test("missing language variants cannot enter through another language's allowlist", () => {
  assert.equal(canRetrieve(document, entry(["ko_KR", "ja_JP", "en_US"]), policy), false);
  assert.equal(canRetrieve({ ...document, locale: "zh_TW" }, shared, policy), false);
});

test("future dates and invalid dates block every translation", () => {
  const cutoff = Date.parse(policy.globalReleaseCutoff) / 1000;
  assert.equal(selectEntry(shared, policy, [cutoff]).allowed, true);
  assert.equal(selectEntry(shared, policy, [cutoff + 1]).reason, "future-global-release-time");
  assert.equal(canRetrieve(document, shared, policy, [cutoff + 1]), false);
  assert.equal(selectEntry(shared, policy, [Number.NaN]).reason, "invalid-release-time");
});

test("release evidence uses global first-publication dates, not future reruns", () => {
  const tables = { review: { a: { startTime: 100, remakeStartTime: 9999999999, infoUnlockDatas: [{ storyTxt: "scene" }] } }, equipment: { equipDict: { module: { uniEquipGetTime: 200 } } }, skins: { charSkins: { skin: { displaySkin: { getTime: 300 } } } } };
  assert.deepEqual(publicationTimes({ kind: "story", source: { path: "en_US/gamedata/story/scene.json" } }, tables), [100]);
  assert.deepEqual(publicationTimes({ kind: "module", source: { jsonPointer: "/equipDict/module" } }, tables), [200]);
  assert.deepEqual(publicationTimes({ kind: "skin", source: { jsonPointer: "/charSkins/skin" } }, tables), [300]);
});

test("turning off fail-closed protection is not silently accepted", () => {
  assert.throws(() => validatePolicy({ ...policy, allowMissingGlobalCounterpart: true }));
  assert.throws(() => validatePolicy({ ...policy, requiredGlobalLocales: ["en_US"] }));
  assert.throws(() => validatePolicy({ ...policy, releasedLocaleDifferences: "exclude" }));
});
