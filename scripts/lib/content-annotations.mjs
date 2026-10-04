import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const digest = (text) => createHash("sha256").update(text).digest("hex");

export function validateContentAnnotations(registry) {
  assert.equal(registry.schemaVersion, 1);
  assert.ok(Array.isArray(registry.entries));
  const ids = new Set();
  for (const entry of registry.entries) {
    assert.ok(typeof entry.id === "string" && entry.id.length > 0);
    assert.ok(!ids.has(entry.id), "unique annotation ID");
    ids.add(entry.id);
    assert.equal(entry.kind, "locale-text-difference");
    assert.equal(entry.action, "retain-and-mark");
    assert.equal(entry.releaseStatusEvidence, false, "locale difference is not release evidence");
    assert.ok(["zh_CN", "ko_KR", "ja_JP", "en_US"].includes(entry.locale));
    assert.equal(entry.documentId, `${entry.locale}:${entry.canonicalId}`);
    assert.ok(entry.canonicalId.startsWith("story:"));
    assert.deepEqual([...entry.reviewedAgainstLocales].sort(), ["en_US", "ja_JP", "ko_KR"]);
    assert.ok(/^[a-f\d]{40}$/.test(entry.source.commit));
    assert.ok(entry.source.path.startsWith(`${entry.locale}/gamedata/story/`));
    assert.ok(/^[a-f\d]{64}$/.test(entry.source.sha256));
    assert.ok(/^\/storyList\/\d+\/attributes\/(content|text|options)$/.test(entry.source.jsonPointer));
    assert.ok(/^[a-f\d]{64}$/.test(entry.segmentTextSha256));
    assert.ok(typeof entry.label === "string" && entry.label.trim());
    assert.ok(typeof entry.note === "string" && entry.note.trim());
  }
}

// A separate index keeps the corpus byte-identical and cannot grant retrieval eligibility.
export function resolveContentAnnotations(registry, documents, selectedCatalog) {
  validateContentAnnotations(registry);
  const entries = new Map(selectedCatalog.entries.map((entry) => [entry.canonicalId, entry]));
  return {
    schemaVersion: 1,
    releaseEligibilityImpact: "none",
    entries: registry.entries.map((annotation) => {
      const document = documents.get(annotation.documentId);
      assert.ok(document, "annotation target must be selected; annotations cannot override release policy");
      const entry = entries.get(annotation.canonicalId);
      assert.equal(entry?.variants?.[annotation.locale]?.documentId, document.id, "annotation target in selected catalog");
      assert.equal(document.canonicalId, annotation.canonicalId);
      assert.equal(document.locale, annotation.locale);
      for (const field of ["commit", "path", "sha256"]) {
        assert.equal(document.source[field], annotation.source[field], `annotation source ${field} needs review after source changes`);
      }
      const matches = document.segments.filter((segment) => segment.sourcePointer === annotation.source.jsonPointer);
      assert.equal(matches.length, 1, "annotation pointer must match exactly one selected segment");
      assert.equal(digest(matches[0].text), annotation.segmentTextSha256, "annotation text needs review after source changes");
      return { ...annotation, segmentOrdinal: matches[0].ordinal };
    }),
  };
}
