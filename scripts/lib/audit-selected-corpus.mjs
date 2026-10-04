import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Independently enumerate permitted source IDs, then read every selected output back.
export async function auditSelectedCorpus({ outputRoot, sourceCatalog, selectedCatalog, files, policy, releaseTimes, sourceLineHashes, annotationFile, expectedAnnotations }) {
  const savedCatalog = JSON.parse(fs.readFileSync(path.join(outputRoot, "catalog.json"), "utf8"));
  assert.deepEqual(savedCatalog, selectedCatalog, "saved catalog matches selection");
  const cutoff = Date.parse(policy.globalReleaseCutoff) / 1000;
  const expectedEntries = sourceCatalog.entries.filter((entry) =>
    policy.requiredGlobalLocales.every((locale) => entry.variants?.[locale]) &&
    (releaseTimes.get(entry.canonicalId) ?? []).every((time) => Number.isFinite(time) && time <= cutoff),
  );
  assert.deepEqual(selectedCatalog.entries.map((entry) => entry.canonicalId).sort(), expectedEntries.map((entry) => entry.canonicalId).sort(), "exact permitted catalog");
  const expectedDocuments = new Map();
  for (const entry of expectedEntries) for (const [locale, variant] of Object.entries(entry.variants)) {
    if (policy.allowedLocales.includes(locale)) expectedDocuments.set(variant.documentId, { locale, entry, variant });
  }
  const seen = new Set();
  const annotationsByDocument = new Map();
  let annotations = [];
  if (annotationFile) {
    assert.equal(annotationFile.path, "annotations.json");
    const bytes = fs.readFileSync(path.join(outputRoot, annotationFile.path));
    assert.equal(bytes.length, annotationFile.bytes, "annotation file size");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), annotationFile.sha256, "annotation file hash");
    const savedAnnotations = JSON.parse(bytes.toString("utf8"));
    assert.deepEqual(savedAnnotations, expectedAnnotations, "saved annotations match reviewed registry");
    assert.equal(savedAnnotations.releaseEligibilityImpact, "none");
    annotations = savedAnnotations.entries;
    assert.equal(annotations.length, annotationFile.entries);
    for (const annotation of annotations) {
      assert.ok(expectedDocuments.has(annotation.documentId), "annotation cannot grant eligibility");
      assert.equal(annotation.action, "retain-and-mark");
      assert.equal(annotation.releaseStatusEvidence, false);
      if (!annotationsByDocument.has(annotation.documentId)) annotationsByDocument.set(annotation.documentId, []);
      annotationsByDocument.get(annotation.documentId).push(annotation);
    }
  }
  let auditedAnnotations = 0;
  let auditedSegments = 0;
  for (const file of files) {
    assert.equal(file.path, `${file.locale}/${file.kind}.jsonl`);
    const stream = fs.createReadStream(path.join(outputRoot, file.path));
    const digest = createHash("sha256");
    let bytes = 0;
    let documents = 0;
    let segments = 0;
    stream.on("data", (chunk) => { digest.update(chunk); bytes += chunk.length; });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        const document = JSON.parse(line);
        const expected = expectedDocuments.get(document.id);
        assert.ok(expected, "no excluded content in selected files");
        assert.ok(!seen.has(document.id), "no duplicate selected document");
        assert.equal(document.locale, file.locale);
        assert.equal(document.kind, file.kind);
        assert.equal(document.canonicalId, expected.entry.canonicalId);
        assert.equal(expected.variant.file, file.path);
        assert.equal(createHash("sha256").update(line).digest("hex"), sourceLineHashes.get(document.id), "selected document is byte-identical to normalized source");
        for (const annotation of annotationsByDocument.get(document.id) ?? []) {
          assert.equal(document.canonicalId, annotation.canonicalId);
          assert.equal(document.locale, annotation.locale);
          for (const field of ["commit", "path", "sha256"]) assert.equal(document.source[field], annotation.source[field]);
          const segment = document.segments[annotation.segmentOrdinal];
          assert.equal(segment?.sourcePointer, annotation.source.jsonPointer, "saved annotation points to retained segment");
          assert.equal(createHash("sha256").update(segment.text).digest("hex"), annotation.segmentTextSha256, "saved annotation text matches retained source");
          auditedAnnotations++;
        }
        seen.add(document.id);
        documents++;
        segments += document.segments.length;
      }
    } finally {
      lines.close();
      if (!stream.closed) {
        const closed = new Promise((resolve) => stream.once("close", resolve));
        stream.destroy();
        await closed;
      }
    }
    assert.equal(documents, file.documents);
    assert.equal(segments, file.segments);
    assert.equal(bytes, file.bytes);
    assert.equal(digest.digest("hex"), file.sha256);
    auditedSegments += segments;
  }
  assert.equal(seen.size, expectedDocuments.size, "all and only permitted documents copied");
  assert.equal(auditedAnnotations, annotations.length, "all reviewed annotations verified");
  return { auditedDocuments: seen.size, auditedSegments, eligibleCanonicalDocuments: expectedEntries.length, ...(annotationFile ? { auditedAnnotations } : {}) };
}
