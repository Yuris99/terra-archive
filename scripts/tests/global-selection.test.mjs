import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { auditSelectedCorpus } from "../lib/audit-selected-corpus.mjs";

const policy = JSON.parse(fs.readFileSync(new URL("../../config/retrieval-policy.json", import.meta.url), "utf8"));
const digest = (value) => createHash("sha256").update(value).digest("hex");

function fixture() {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terra-global-selection-test-"));
  const locales = ["en_US", "ko_KR", "ja_JP"];
  const entries = [{ canonicalId: "story:released", kind: "story", variants: Object.fromEntries(locales.map((locale) => [locale, { documentId: `${locale}:story:released`, file: `${locale}/story.jsonl` }])) }];
  const sourceCatalog = { entries: [...entries, { canonicalId: "story:cn-only", kind: "story", variants: { zh_CN: { documentId: "zh_CN:story:cn-only" } } }] };
  const selectedCatalog = { entries };
  fs.writeFileSync(path.join(outputRoot, "catalog.json"), JSON.stringify(selectedCatalog));
  const sourceLineHashes = new Map();
  const files = locales.map((locale) => {
    fs.mkdirSync(path.join(outputRoot, locale));
    const document = { id: `${locale}:story:released`, canonicalId: "story:released", locale, kind: "story", source: { commit: "a".repeat(40), path: `${locale}/gamedata/story/released.json`, sha256: "b".repeat(64) }, segments: [{ ordinal: 0, sourcePointer: "/storyList/1/attributes/content", text: "full source paragraph" }] };
    const line = JSON.stringify(document);
    const payload = `${line}\n`;
    fs.writeFileSync(path.join(outputRoot, locale, "story.jsonl"), payload);
    sourceLineHashes.set(document.id, digest(line));
    return { path: `${locale}/story.jsonl`, locale, kind: "story", documents: 1, segments: 1, bytes: Buffer.byteLength(payload), sha256: digest(payload) };
  });
  const cleanup = () => {
    assert.equal(path.dirname(outputRoot), os.tmpdir());
    assert.ok(path.basename(outputRoot).startsWith("terra-global-selection-test-"));
    for (const locale of locales) {
      fs.unlinkSync(path.join(outputRoot, locale, "story.jsonl"));
      fs.rmdirSync(path.join(outputRoot, locale));
    }
    fs.unlinkSync(path.join(outputRoot, "catalog.json"));
    if (fs.existsSync(path.join(outputRoot, "annotations.json"))) fs.unlinkSync(path.join(outputRoot, "annotations.json"));
    fs.rmdirSync(outputRoot);
  };
  return { options: { outputRoot, sourceCatalog, selectedCatalog, files, policy, releaseTimes: new Map(), sourceLineHashes }, cleanup };
}

test("full read-back audit includes all permitted translations and no Chinese-only record", async () => {
  const { options, cleanup } = fixture();
  try {
    assert.deepEqual(await auditSelectedCorpus(options), { auditedDocuments: 3, auditedSegments: 3, eligibleCanonicalDocuments: 1 });
  } finally { cleanup(); }
});

function addAnnotations(options) {
  const document = JSON.parse(fs.readFileSync(path.join(options.outputRoot, options.files[0].path), "utf8"));
  options.expectedAnnotations = { schemaVersion: 1, releaseEligibilityImpact: "none", entries: [{
    id: "reviewed-mark", documentId: document.id, canonicalId: document.canonicalId, locale: document.locale,
    action: "retain-and-mark", releaseStatusEvidence: false, segmentOrdinal: 0,
    source: { ...document.source, jsonPointer: document.segments[0].sourcePointer },
    segmentTextSha256: digest(document.segments[0].text),
  }] };
  const save = () => {
    const payload = JSON.stringify(options.expectedAnnotations);
    fs.writeFileSync(path.join(options.outputRoot, "annotations.json"), payload);
    options.annotationFile = { path: "annotations.json", entries: 1, bytes: Buffer.byteLength(payload), sha256: digest(payload) };
  };
  save();
  return save;
}

test("annotation read-back verifies a mark on unchanged selected content", async () => {
  const { options, cleanup } = fixture();
  try {
    addAnnotations(options);
    assert.equal((await auditSelectedCorpus(options)).auditedAnnotations, 1);
  } finally { cleanup(); }
});

test("an incorrect annotation pointer fails even with matching saved metadata and hash", async () => {
  const { options, cleanup } = fixture();
  try {
    const save = addAnnotations(options);
    options.expectedAnnotations.entries[0].source.jsonPointer = "/storyList/2/attributes/content";
    save();
    await assert.rejects(auditSelectedCorpus(options), /points to retained segment/);
  } finally { cleanup(); }
});

test("tampered selected text fails even if output hashes are recomputed", async () => {
  const { options, cleanup } = fixture();
  try {
    const file = options.files[0];
    const target = path.join(options.outputRoot, file.path);
    const document = JSON.parse(fs.readFileSync(target, "utf8"));
    document.segments[0].text = "shortened";
    const payload = `${JSON.stringify(document)}\n`;
    fs.writeFileSync(target, payload);
    file.bytes = Buffer.byteLength(payload);
    file.sha256 = digest(payload);
    await assert.rejects(auditSelectedCorpus(options), /byte-identical/);
  } finally { cleanup(); }
});

test("future-dated content cannot remain in the selected catalog", async () => {
  const { options, cleanup } = fixture();
  try {
    options.releaseTimes.set("story:released", [Date.parse(policy.globalReleaseCutoff) / 1000 + 1]);
    await assert.rejects(auditSelectedCorpus(options), /exact permitted catalog/);
  } finally { cleanup(); }
});

test("saved catalog corruption is detected before selected content is used", async () => {
  const { options, cleanup } = fixture();
  try {
    fs.writeFileSync(path.join(options.outputRoot, "catalog.json"), JSON.stringify({ entries: [] }));
    await assert.rejects(auditSelectedCorpus(options), /saved catalog matches selection/);
  } finally { cleanup(); }
});
