import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { KINDS } from "./lib/normalize-corpus.mjs";
import { selectEntry, canRetrieve, publicationTimes, validatePolicy } from "./lib/retrieval-policy.mjs";
import { auditSelectedCorpus } from "./lib/audit-selected-corpus.mjs";
import { resolveContentAnnotations, validateContentAnnotations } from "./lib/content-annotations.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "data/normalized/v1");
const outputRoot = path.join(projectRoot, "data/retrieval/global-v1");
const reportPath = path.join(projectRoot, "data/reports/global-selection.json");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const policyBytes = fs.readFileSync(path.join(projectRoot, "config/retrieval-policy.json"));
const policy = JSON.parse(policyBytes.toString("utf8"));
validatePolicy(policy);
const annotationRegistryBytes = fs.readFileSync(path.join(projectRoot, "config/content-annotations.json"));
const annotationRegistry = JSON.parse(annotationRegistryBytes.toString("utf8"));
validateContentAnnotations(annotationRegistry);
const annotationTargets = new Set(annotationRegistry.entries.map((entry) => entry.documentId));
const annotatedDocuments = new Map();
const manifestBytes = fs.readFileSync(path.join(sourceRoot, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const validation = readJson(path.join(projectRoot, "data/reports/normalized-validation.json"));
assert.equal(validation.validationPassed, true, "normalization must pass validation first");
assert.equal(validation.sourceCommit, manifest.source.commit);
const catalogBytes = fs.readFileSync(path.join(sourceRoot, "catalog.json"));
assert.equal(hash(catalogBytes), manifest.catalog.sha256);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
const sourceManifest = readJson(path.join(projectRoot, "data/raw/manifests/arknights-story-json.json"));
assert.equal(sourceManifest.source.commit, manifest.source.commit);
const baselineInventory = sourceManifest.inventory.find((item) => item.locale === policy.baselineLocale);
assert.ok(baselineInventory);
const loadTable = (name) => {
  const relativePath = `${policy.baselineLocale}/gamedata/excel/${name}`;
  const expected = baselineInventory.supportFiles.find((file) => file.path === relativePath);
  assert.ok(expected);
  const bytes = fs.readFileSync(path.join(projectRoot, "data/raw/arknights-story-json", relativePath));
  assert.equal(hash(bytes), expected.sha256, "global release metadata hash");
  return JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
};
const tables = { review: loadTable("story_review_table.json"), equipment: loadTable("uniequip_table.json"), skins: loadTable("skin_table.json") };
const releaseTimes = new Map();

async function readLines(file, callback) {
  assert.equal(file.path, `${file.locale}/${file.kind}.jsonl`);
  const stream = fs.createReadStream(path.join(sourceRoot, file.path));
  const digest = createHash("sha256");
  let bytes = 0;
  let documents = 0;
  stream.on("data", (chunk) => { digest.update(chunk); bytes += chunk.length; });
  for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
    assert.ok(line.trim());
    const document = JSON.parse(line);
    assert.equal(document.locale, file.locale);
    assert.equal(document.kind, file.kind);
    callback(document, line);
    documents++;
  }
  assert.equal(digest.digest("hex"), file.sha256, "normalized input hash");
  assert.equal(bytes, file.bytes);
  assert.equal(documents, file.documents);
}

for (const file of manifest.files.filter((item) => item.locale === policy.baselineLocale)) {
  await readLines(file, (document) => releaseTimes.set(document.canonicalId, publicationTimes(document, tables)));
}
const selectedEntries = [];
const excludedByKind = Object.fromEntries(KINDS.map((kind) => [kind, 0]));
const excludedByReason = {};
for (const entry of catalog.entries) {
  const selection = selectEntry(entry, policy, releaseTimes.get(entry.canonicalId) ?? []);
  if (selection.allowed) selectedEntries.push(entry);
  else {
    excludedByKind[entry.kind]++;
    excludedByReason[selection.reason] = (excludedByReason[selection.reason] ?? 0) + 1;
  }
}
const selectedCatalog = { schemaVersion: 1, sourceCommit: manifest.source.commit, policyId: policy.id, entries: selectedEntries };
const entriesById = new Map(selectedEntries.map((entry) => [entry.canonicalId, entry]));
const sourceLineHashes = new Map();
const files = [];
fs.mkdirSync(outputRoot, { recursive: true });
// A failed rebuild must not leave an older success marker on partially replaced files.
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, policyId: policy.id, validationPassed: false, generationInProgress: true })}\n`, "utf8");
for (const file of manifest.files) {
  assert.ok(policy.allowedLocales.includes(file.locale));
  const destination = path.join(outputRoot, file.path);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partialPath = `${destination}.partial`;
  const descriptor = fs.openSync(partialPath, "w");
  const digest = createHash("sha256");
  let documents = 0;
  let segments = 0;
  let bytes = 0;
  try {
    await readLines(file, (document, line) => {
      const entry = entriesById.get(document.canonicalId);
      if (!canRetrieve(document, entry, policy, releaseTimes.get(document.canonicalId) ?? [])) return;
      assert.ok(!sourceLineHashes.has(document.id), "unique selected source ID");
      const payload = Buffer.from(`${line}\n`, "utf8");
      fs.writeFileSync(descriptor, payload);
      digest.update(payload);
      bytes += payload.length;
      documents++;
      segments += document.segments.length;
      sourceLineHashes.set(document.id, hash(line));
      if (annotationTargets.has(document.id)) annotatedDocuments.set(document.id, document);
    });
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(partialPath, destination);
  files.push({ path: file.path, locale: file.locale, kind: file.kind, documents, segments, bytes, sha256: digest.digest("hex") });
  console.log(`${file.path}: ${documents}/${file.documents} documents retained`);
}
const selectedCatalogBytes = Buffer.from(`${JSON.stringify(selectedCatalog, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputRoot, "catalog.json"), selectedCatalogBytes);
const resolvedAnnotations = resolveContentAnnotations(annotationRegistry, annotatedDocuments, selectedCatalog);
const annotationBytes = Buffer.from(`${JSON.stringify(resolvedAnnotations, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputRoot, "annotations.json"), annotationBytes);
const annotationFile = { path: "annotations.json", entries: resolvedAnnotations.entries.length, bytes: annotationBytes.length, sha256: hash(annotationBytes), registrySha256: hash(annotationRegistryBytes) };
const report = {
  schemaVersion: 1,
  generatedAtUtc: new Date().toISOString(),
  sourceCommit: manifest.source.commit,
  policy,
  policySha256: hash(policyBytes),
  normalizedManifestSha256: hash(manifestBytes),
  validationPassed: false,
  inputDocuments: manifest.files.reduce((sum, file) => sum + file.documents, 0),
  selectedDocuments: files.reduce((sum, file) => sum + file.documents, 0),
  selectedSegments: files.reduce((sum, file) => sum + file.segments, 0),
  eligibleCanonicalDocuments: selectedEntries.length,
  excludedCanonicalDocuments: catalog.entries.length - selectedEntries.length,
  excludedByKind,
  excludedByReason,
  annotations: annotationFile,
  outputPath: "data/retrieval/global-v1",
  limitations: [
    "Selection uses the fixed collected global snapshots, not live release-status certification.",
    "Future first-publication dates present in the global story/module/skin metadata are blocked; absent dates use global counterpart presence as evidence.",
    "Locale-specific wording in globally represented content is retained, not treated as unreleased content. Known differences are marked in annotations.json without changing the corpus.",
    "Missing global counterparts are conservatively held out as release-unverified; their absence does not certify live unreleased status.",
    "Shared keys are translation candidates, not proof of sentence-level equivalence. Annotations cover reviewed differences only.",
    "Raw and full normalized archives are preserved separately and must not be used as retrieval inputs.",
    "No chunking, search UI or RAG answering is implemented by this selector.",
  ],
  errors: [],
};
const writeReport = () => fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
writeReport();
try {
  report.audit = await auditSelectedCorpus({ outputRoot, sourceCatalog: catalog, selectedCatalog, files, policy, releaseTimes, sourceLineHashes, annotationFile, expectedAnnotations: resolvedAnnotations });
  report.validationPassed = true;
} catch (error) {
  report.errors.push(error.message.split("\n")[0]);
  process.exitCode = 1;
}
writeReport();
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, policyId: policy.id, policySha256: report.policySha256, normalizedManifestSha256: report.normalizedManifestSha256, source: manifest.source, validationPassed: report.validationPassed, files, annotations: annotationFile, catalog: { path: "catalog.json", entries: selectedEntries.length, sha256: hash(selectedCatalogBytes), bytes: selectedCatalogBytes.length } }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ validationPassed: report.validationPassed, selectedDocuments: report.selectedDocuments, selectedSegments: report.selectedSegments, excludedCanonicalDocuments: report.excludedCanonicalDocuments, excludedByKind, excludedByReason, errors: report.errors }, null, 2));
