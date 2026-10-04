import assert from "node:assert/strict";
import { getPointer } from "./normalize-corpus.mjs";

export function validatePolicy(policy) {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(policy.baselineLocale, "en_US");
  assert.deepEqual([...policy.requiredGlobalLocales].sort(), ["en_US", "ja_JP", "ko_KR"]);
  assert.deepEqual([...policy.allowedLocales].sort(), ["en_US", "ja_JP", "ko_KR", "zh_CN"]);
  assert.equal(policy.allowMissingGlobalCounterpart, false);
  assert.equal(policy.blockFutureDatedContent, true);
  assert.equal(policy.unknownContentRule, "exclude");
  assert.equal(policy.exclusionScope, "globally-unreleased-content");
  assert.equal(policy.releasedLocaleDifferences, "retain-and-mark");
  assert.ok(Number.isFinite(Date.parse(policy.globalReleaseCutoff)));
}

export function selectEntry(entry, policy, releaseTimes = []) {
  validatePolicy(policy);
  if (!entry || !policy.requiredGlobalLocales.every((locale) => entry.variants?.[locale])) return { allowed: false, reason: "missing-global-counterpart" };
  const cutoff = Date.parse(policy.globalReleaseCutoff) / 1000;
  if (releaseTimes.some((timestamp) => !Number.isFinite(timestamp))) return { allowed: false, reason: "invalid-release-time" };
  if (releaseTimes.some((timestamp) => timestamp > cutoff)) return { allowed: false, reason: "future-global-release-time" };
  return { allowed: true, reason: "global-snapshot-counterpart", baselineDocumentId: entry.variants[policy.baselineLocale].documentId };
}

// Only first-publication dates are used: future reruns do not make old content unreleased.
export function publicationTimes(document, tables) {
  if (document.kind === "story") {
    const relativePath = document.source.path.split("/gamedata/story/")[1]?.replace(/\.json$/, "");
    assert.ok(relativePath, "story source path");
    return Object.values(tables.review).filter((group) => (group.infoUnlockDatas ?? []).some((entry) => entry.storyTxt === relativePath)).map((group) => group.startTime).filter((time) => time > 0);
  }
  if (document.kind === "module") {
    const time = getPointer(tables.equipment, document.source.jsonPointer).uniEquipGetTime;
    return time == null ? [] : [time];
  }
  if (document.kind === "skin") {
    const time = getPointer(tables.skins, document.source.jsonPointer).displaySkin?.getTime;
    return time == null ? [] : [time];
  }
  return [];
}

export function canRetrieve(document, entry, policy, releaseTimes = []) {
  if (!document || !policy.allowedLocales.includes(document.locale)) return false;
  const variant = entry?.variants?.[document.locale];
  if (!variant || document.id !== variant.documentId || document.canonicalId !== entry.canonicalId || document.kind !== entry.kind) return false;
  return selectEntry(entry, policy, releaseTimes).allowed;
}
