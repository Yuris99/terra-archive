import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { validateContentAnnotations, resolveContentAnnotations } from "../lib/content-annotations.mjs";
import { canRetrieve } from "../lib/retrieval-policy.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../config/retrieval-policy.json", import.meta.url), "utf8"));
const digest = (text) => createHash("sha256").update(text).digest("hex");

function fixture() {
  const document = {
    id: "zh_CN:story:scene", canonicalId: "story:scene", kind: "story", locale: "zh_CN",
    source: { commit: "a".repeat(40), path: "zh_CN/gamedata/story/scene.json", sha256: "b".repeat(64) },
    segments: [{ ordinal: 0, text: "locale-only wording", sourcePointer: "/storyList/1/attributes/content" }],
  };
  const entry = { canonicalId: document.canonicalId, kind: "story", variants: Object.fromEntries(policy.allowedLocales.map((locale) => [locale, { documentId: `${locale}:story:scene` }])) };
  const registry = { schemaVersion: 1, entries: [{
    id: "known-locale-difference", kind: "locale-text-difference", action: "retain-and-mark", releaseStatusEvidence: false,
    documentId: document.id, canonicalId: document.canonicalId, locale: document.locale,
    label: "Locale difference", reviewedAgainstLocales: ["ko_KR", "en_US", "ja_JP"],
    source: { ...document.source, jsonPointer: document.segments[0].sourcePointer },
    segmentTextSha256: digest(document.segments[0].text), note: "Keep this difference; cause is unconfirmed.",
  }] };
  return { document, entry, registry, documents: new Map([[document.id, document]]), catalog: { entries: [entry] } };
}

test("known locale-only wording is retained with a separate mark and no source mutation", () => {
  const f = fixture();
  const original = JSON.stringify(f.document);
  const result = resolveContentAnnotations(f.registry, f.documents, f.catalog);
  assert.equal(result.releaseEligibilityImpact, "none");
  assert.equal(result.entries[0].segmentOrdinal, 0);
  assert.equal(result.entries[0].action, "retain-and-mark");
  assert.equal(canRetrieve(f.document, f.entry, policy), true);
  assert.equal(JSON.stringify(f.document), original);
});

test("a locale-difference mark cannot allow future or missing global content", () => {
  const f = fixture();
  const cutoff = Date.parse(policy.globalReleaseCutoff) / 1000;
  resolveContentAnnotations(f.registry, f.documents, f.catalog);
  assert.equal(canRetrieve(f.document, f.entry, policy, [cutoff + 1]), false);
  assert.equal(canRetrieve(f.document, { ...f.entry, variants: { zh_CN: f.entry.variants.zh_CN } }, policy), false);
  assert.throws(() => resolveContentAnnotations(f.registry, new Map(), f.catalog), /cannot override release policy/);
  assert.throws(() => resolveContentAnnotations(f.registry, f.documents, { entries: [] }), /selected catalog/);
});

test("source or text changes require re-review rather than moving an old mark silently", () => {
  for (const change of [
    (d) => { d.source.commit = "c".repeat(40); },
    (d) => { d.source.path = "zh_CN/gamedata/story/different.json"; },
    (d) => { d.source.sha256 = "c".repeat(64); },
    (d) => { d.segments[0].text = "changed wording"; },
    (d) => { d.segments[0].sourcePointer = "/storyList/2/attributes/content"; },
    (d) => { d.segments.push({ ...d.segments[0], ordinal: 1 }); },
  ]) {
    const f = fixture();
    change(f.document);
    assert.throws(() => resolveContentAnnotations(f.registry, f.documents, f.catalog));
  }
});

test("marks are not deletion instructions or evidence of unreleased content", () => {
  for (const change of [
    (r) => { r.entries[0].action = "exclude"; },
    (r) => { r.entries[0].releaseStatusEvidence = true; },
    (r) => { r.entries[0].kind = "unreleased"; },
    (r) => { r.entries.push({ ...r.entries[0] }); },
    (r) => { r.entries[0].reviewedAgainstLocales = ["en_US"]; },
  ]) {
    const f = fixture();
    change(f.registry);
    assert.throws(() => validateContentAnnotations(f.registry));
  }
});

test("no known marks leaves all corpus content alone", () => {
  assert.deepEqual(resolveContentAnnotations({ schemaVersion: 1, entries: [] }, new Map(), { entries: [] }), {
    schemaVersion: 1, releaseEligibilityImpact: "none", entries: [],
  });
});

test("the committed annotation registry has unique preserve-only marks", () => {
  const registry = JSON.parse(fs.readFileSync(new URL("../../config/content-annotations.json", import.meta.url), "utf8"));
  validateContentAnnotations(registry);
  assert.equal(registry.entries[0].documentId, "zh_CN:story:activities/act45side/level_act45side_08_beg");
});
