import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { KINDS, SCHEMA_VERSION, escapePointer } from "./lib/normalize-corpus.mjs";
import { auditDocument } from "./lib/audit-normalized-corpus.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawRoot = path.join(projectRoot, "data/raw/arknights-story-json");
const outputRoot = path.join(projectRoot, "data/normalized/v1");
const reportPath = path.join(projectRoot, "data/reports/normalized-validation.json");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const errors = [];
const locales = [];
const seenDocuments = new Map();
const sourceManifest = readJson(path.join(projectRoot, "data/raw/manifests/arknights-story-json.json"));
const outputManifest = readJson(path.join(outputRoot, "manifest.json"));
const inputReport = readJson(path.join(projectRoot, "data/reports/story-json-coverage.json"));
const summaryPath = path.join(projectRoot, "data/reports/normalization.json");
let totalSourceFields = 0;
let totalSegments = 0;
let verifiedSourceFiles = 0;
let sharedStories = 0;
let chineseOnlyStories = 0;

function checkedPath(root, relativePath) {
  assert.equal(typeof relativePath, "string", "relative path type");
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "path must stay inside data directory");
  return resolved;
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : entry.isFile() && filePath.endsWith(".json") ? [filePath] : [];
  }).sort();
}

function storyReferences(table) {
  return Object.values(table).flatMap((group) => (group.infoUnlockDatas ?? []).map((entry) => ({ path: `${entry.storyTxt}.json`, storyId: entry.storyId, groupId: group.id, order: entry.storySort ?? null })));
}

try {
  assert.equal(outputManifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(outputManifest.source.commit, sourceManifest.source.commit);
  assert.equal(inputReport.validationPassed, true);
  assert.equal(inputReport.source.commit, sourceManifest.source.commit);
  assert.equal(execFileSync("git", ["-C", rawRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceManifest.source.commit, "checkout commit");
  assert.equal(execFileSync("git", ["-C", rawRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim(), "", "clean input checkout");
  const pipelineHash = createHash("sha256").update(fs.readFileSync(path.join(projectRoot, "scripts/normalize-corpus.mjs"))).update(fs.readFileSync(path.join(projectRoot, "scripts/lib/normalize-corpus.mjs"))).digest("hex");
  assert.equal(outputManifest.pipelineSha256, pipelineHash, "current normalizer code hash");
  const expectedOutputPaths = sourceManifest.inventory.flatMap(({ locale }) => KINDS.map((kind) => `${locale}/${kind}.jsonl`)).sort();
  assert.deepEqual(outputManifest.files.map((file) => file.path).sort(), expectedOutputPaths, "exact output file inventory");
  const koreanReview = readJson(path.join(projectRoot, "data/raw/arknights-gamedata/kr/gamedata/excel/story_review_table.json"));
  const koreanReferences = storyReferences(koreanReview);

  for (const inventory of sourceManifest.inventory) {
    const { locale } = inventory;
    const sourceTables = new Map();
    const sourceHashes = new Map();
    const tableNames = ["character_table.json", "handbook_info_table.json", "charword_table.json", "uniequip_table.json", "skin_table.json", "story_review_table.json"];
    for (const file of inventory.supportFiles) {
      const bytes = fs.readFileSync(checkedPath(rawRoot, file.path));
      const digest = hash(bytes);
      assert.equal(digest, file.sha256, `support hash: ${file.path}`);
      assert.equal(bytes.length, file.bytes, `support size: ${file.path}`);
      sourceHashes.set(file.path, digest);
      if (tableNames.includes(path.basename(file.path))) sourceTables.set(file.path, JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")));
      verifiedSourceFiles++;
    }
    const table = (name) => sourceTables.get(`${locale}/gamedata/excel/${name}`);
    const characters = table("character_table.json");
    const expectations = new Map();
    const add = (kind, key, tableName, pointer, title, context = {}) => {
      const sourcePath = `${locale}/gamedata/excel/${tableName}`;
      const canonicalId = `${kind}:${key}`;
      const id = `${locale}:${canonicalId}`;
      assert.ok(!expectations.has(id), "unique expected record");
      expectations.set(id, { kind, canonicalId, sourcePath, pointer, title: title ?? key, context });
    };
    for (const [operatorId, handbook] of Object.entries(table("handbook_info_table.json").handbookDict ?? {})) {
      for (const [sectionIndex, section] of (handbook.storyTextAudio ?? []).entries()) for (const [variantIndex] of (section.stories ?? []).entries()) {
        add("profile", `${operatorId}:${sectionIndex}:${variantIndex}`, "handbook_info_table.json", `/handbookDict/${escapePointer(operatorId)}/storyTextAudio/${sectionIndex}/stories/${variantIndex}`, section.storyTitle, { operatorId, sectionIndex, variantIndex });
      }
    }
    for (const bucket of ["charWords", "charExtraWords"]) for (const [key, record] of Object.entries(table("charword_table.json")[bucket] ?? {})) add("voice", `${bucket}:${key}`, "charword_table.json", `/${bucket}/${escapePointer(key)}`, record.voiceTitle ?? record.voiceId, { bucket });
    for (const [key, record] of Object.entries(table("uniequip_table.json").equipDict ?? {})) add("module", key, "uniequip_table.json", `/equipDict/${escapePointer(key)}`, record.uniEquipName);
    for (const [key, record] of Object.entries(table("skin_table.json").charSkins ?? {})) add("skin", key, "skin_table.json", `/charSkins/${escapePointer(key)}`, record.displaySkin?.skinName ?? key);
    const storyRoot = path.join(rawRoot, locale, "gamedata/story");
    const storyFiles = walk(storyRoot);
    assert.equal(storyFiles.length, inventory.storyFileCount, "source story count");
    for (const filePath of storyFiles) {
      const relativePath = path.relative(storyRoot, filePath).split(path.sep).join("/");
      const canonicalId = `story:${relativePath.replace(/\.json$/, "")}`;
      expectations.set(`${locale}:${canonicalId}`, { kind: "story", canonicalId, sourcePath: `${locale}/gamedata/story/${relativePath}`, pointer: "" });
    }
    const references = new Map();
    for (const { path: storyPath, ...reference } of storyReferences(table("story_review_table.json"))) {
      if (!references.has(storyPath)) references.set(storyPath, []);
      references.get(storyPath).push(reference);
    }
    const seen = new Set();
    const counts = {};
    const textlessScenes = [];
    let extraVoices = 0;
    for (const file of outputManifest.files.filter((item) => item.locale === locale)) {
      assert.equal(file.path, `${locale}/${file.kind}.jsonl`);
      const digest = createHash("sha256");
      let bytes = 0;
      let documents = 0;
      let segments = 0;
      let emptyDocuments = 0;
      const stream = fs.createReadStream(checkedPath(outputRoot, file.path));
      stream.on("data", (chunk) => { digest.update(chunk); bytes += chunk.length; });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of lines) {
        documents++;
        try {
          assert.ok(line.trim(), "no blank records");
          const document = JSON.parse(line);
          assert.equal(document.schemaVersion, SCHEMA_VERSION);
          assert.equal(document.kind, file.kind);
          assert.equal(document.locale, locale);
          assert.equal(document.language, inventory.language);
          assert.equal(document.region, inventory.region);
          assert.ok(!seenDocuments.has(document.id), "unique document ID");
          const expected = expectations.get(document.id);
          assert.ok(expected, "document exists in source inventory");
          assert.equal(document.canonicalId, expected.canonicalId);
          assert.equal(document.source.repository, sourceManifest.source.name);
          assert.equal(document.source.commit, sourceManifest.source.commit);
          assert.equal(document.source.path, expected.sourcePath);
          assert.equal(document.source.jsonPointer, expected.pointer);
          let raw = sourceTables.get(expected.sourcePath);
          if (document.kind === "story") {
            const rawBytes = fs.readFileSync(checkedPath(rawRoot, expected.sourcePath));
            sourceHashes.set(expected.sourcePath, hash(rawBytes));
            raw = JSON.parse(rawBytes.toString("utf8").replace(/^\uFEFF/, ""));
            verifiedSourceFiles++;
            assert.equal(document.title, raw.storyName ?? expected.canonicalId.slice(6));
            assert.equal(document.source.format, "astr-parsed-json");
            assert.equal(document.source.originalStoryTxtCommit, null);
            const storyPath = expected.sourcePath.slice(`${locale}/gamedata/story/`.length);
            assert.deepEqual(document.context.references, references.get(storyPath) ?? []);
            if (document.contentState !== "text") textlessScenes.push({ path: storyPath, kind: document.contentState });
          } else {
            assert.equal(document.title, expected.title);
            assert.equal(document.source.format, "game-data-table-json");
            for (const [key, value] of Object.entries(expected.context)) {
              assert.deepEqual(key === "operatorId" ? document.context.operator.id : document.context[key], value);
            }
            if (document.context.bucket === "charExtraWords") extraVoices++;
          }
          assert.equal(document.source.sha256, sourceHashes.get(expected.sourcePath), "source content hash");
          const result = auditDocument(document, raw, characters);
          totalSourceFields += result.sourceTextFields;
          totalSegments += document.segments.length;
          segments += document.segments.length;
          if (!document.segments.some((segment) => segment.text)) emptyDocuments++;
          seen.add(document.id);
          seenDocuments.set(document.id, { canonicalId: document.canonicalId, kind: document.kind, locale, title: document.title, alignmentMethod: document.alignmentMethod, file: file.path });
        } catch (error) {
          if (errors.length < 100) errors.push(`${file.path}:${documents}: ${error.message}`);
        }
      }
      assert.equal(bytes, file.bytes, `output bytes: ${file.path}`);
      assert.equal(digest.digest("hex"), file.sha256, `output hash: ${file.path}`);
      assert.equal(documents, file.documents, `output record count: ${file.path}`);
      assert.equal(segments, file.segments, `output segment count: ${file.path}`);
      assert.equal(emptyDocuments, file.emptyDocuments, `output empty count: ${file.path}`);
      counts[file.kind] = documents;
    }
    const missing = [...expectations.keys()].filter((id) => !seen.has(id));
    assert.deepEqual(missing, [], "all source records normalized");
    const corpusHash = createHash("sha256");
    for (const filePath of storyFiles) {
      const relativePath = path.relative(storyRoot, filePath).split(path.sep).join("/");
      corpusHash.update(`${relativePath}\0${sourceHashes.get(`${locale}/gamedata/story/${relativePath}`)}\n`);
    }
    assert.equal(corpusHash.digest("hex"), inputReport.languages.find((item) => item.locale === locale).storyCorpusSha256, "source story corpus hash");
    const coverage = (items) => ({ indexed: items.length, available: items.filter((item) => seen.has(`${locale}:story:${item.path.replace(/\.json$/, "")}`)).length });
    const koreanCoverage = coverage(koreanReferences);
    assert.equal(koreanCoverage.available, koreanCoverage.indexed);
    const ownCoverage = coverage(storyReferences(table("story_review_table.json")));
    assert.equal(ownCoverage.available, ownCoverage.indexed);
    const recoveredKoreanGaps = ["act24side", "act13mini"].map((groupId) => ({ groupId, ...coverage(koreanReferences.filter((item) => item.groupId === groupId)) }));
    locales.push({ locale, counts, extraVoices, textlessScenes, sourceIndexCoverage: ownCoverage, koreanIndexCoverage: koreanCoverage, recoveredKoreanGaps });
    console.log(`${locale}: ${seen.size} documents audited against original fields; Korean index ${koreanCoverage.available}/${koreanCoverage.indexed}`);
  }
  const catalogBytes = fs.readFileSync(checkedPath(outputRoot, outputManifest.catalog.path));
  assert.equal(catalogBytes.length, outputManifest.catalog.bytes);
  assert.equal(hash(catalogBytes), outputManifest.catalog.sha256);
  const catalog = JSON.parse(catalogBytes.toString("utf8"));
  assert.equal(catalog.schemaVersion, SCHEMA_VERSION);
  assert.equal(catalog.sourceCommit, sourceManifest.source.commit);
  assert.equal(catalog.entries.length, outputManifest.catalog.entries);
  const seenCanonicalIds = new Set();
  const catalogDocuments = new Set();
  for (const entry of catalog.entries) {
    assert.ok(!seenCanonicalIds.has(entry.canonicalId), "unique catalog record");
    seenCanonicalIds.add(entry.canonicalId);
    for (const [locale, variant] of Object.entries(entry.variants)) {
      const document = seenDocuments.get(variant.documentId);
      assert.ok(document, "catalog variant exists");
      assert.ok(!catalogDocuments.has(variant.documentId), "one catalog entry per document");
      catalogDocuments.add(variant.documentId);
      assert.equal(entry.canonicalId, document.canonicalId);
      assert.equal(entry.kind, document.kind);
      assert.equal(entry.alignmentMethod, document.alignmentMethod);
      assert.equal(locale, document.locale);
      assert.equal(variant.title, document.title);
      assert.equal(variant.file, document.file);
    }
    if (entry.kind === "story") {
      if (Object.keys(entry.variants).length === sourceManifest.inventory.length) sharedStories++;
      if (Object.keys(entry.variants).length === 1 && entry.variants.zh_CN) chineseOnlyStories++;
    }
  }
  assert.equal(catalogDocuments.size, seenDocuments.size, "catalog covers all documents");
  assert.equal(sharedStories, inputReport.sharedStoryPathsAcrossCollectedLanguages);
  assert.equal(totalSourceFields, totalSegments);
} catch (error) {
  errors.push(error.message);
}

const report = {
  schemaVersion: SCHEMA_VERSION,
  checkedAtUtc: new Date().toISOString(),
  sourceCommit: sourceManifest.source.commit,
  validationPassed: errors.length === 0,
  verifiedSourceFiles,
  auditedDocuments: seenDocuments.size,
  auditedSourceTextFields: totalSourceFields,
  auditedSegments: totalSegments,
  sharedStoriesAcrossAllLocales: sharedStories,
  chineseOnlyStoriesInCollectedSnapshot: chineseOnlyStories,
  locales,
  errors,
  limitations: [
    "Validation covers selected ASTR JSON and table fields, not every text ever present in the game.",
    "Readable text normalization is tested but original TXT fidelity and sentence-level translation alignment are not certified.",
    "No retrieval chunks, search index, spoiler filter or RAG answer generation is created in this phase.",
  ],
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (fs.existsSync(summaryPath)) {
  const summary = readJson(summaryPath);
  summary.status = report.validationPassed ? "validated" : "validation-failed";
  summary.validationReport = "data/reports/normalized-validation.json";
  summary.validatedAtUtc = report.checkedAtUtc;
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify({ validationPassed: report.validationPassed, auditedDocuments: report.auditedDocuments, auditedSourceTextFields: totalSourceFields, verifiedSourceFiles, sharedStories, chineseOnlyStories, errors, reportPath: path.relative(projectRoot, reportPath) }, null, 2));
if (errors.length) process.exitCode = 1;
