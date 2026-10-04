import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { KINDS, SCHEMA_VERSION, normalizeStory, normalizeTables } from "./lib/normalize-corpus.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawRoot = path.join(projectRoot, "data/raw/arknights-story-json");
const outputRoot = path.join(projectRoot, "data/normalized/v1");
const reportPath = path.join(projectRoot, "data/reports/normalization.json");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
const manifest = readJson(path.join(projectRoot, "data/raw/manifests/arknights-story-json.json"));
const inputReport = readJson(path.join(projectRoot, "data/reports/story-json-coverage.json"));
if (!inputReport.validationPassed || inputReport.source.commit !== manifest.source.commit) throw new Error("Run inspect-story-json.mjs on the current source first.");
const sourceCommit = execFileSync("git", ["-C", rawRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (sourceCommit !== manifest.source.commit) throw new Error("Input checkout commit differs from manifest.");
if (execFileSync("git", ["-C", rawRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim()) throw new Error("Input checkout has local changes.");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : entry.isFile() && entry.name.endsWith(".json") ? [filePath] : [];
  }).sort();
}

const catalog = new Map();
const files = [];
const locales = [];
const warnings = [];
fs.mkdirSync(outputRoot, { recursive: true });

function addCatalog(document, outputPath) {
  let entry = catalog.get(document.canonicalId);
  if (!entry) {
    entry = { canonicalId: document.canonicalId, kind: document.kind, alignmentMethod: document.alignmentMethod, variants: {} };
    catalog.set(document.canonicalId, entry);
  }
  if (Object.hasOwn(entry.variants, document.locale)) throw new Error(`Duplicate document: ${document.id}`);
  entry.variants[document.locale] = { documentId: document.id, title: document.title, file: outputPath };
}

for (const inventory of manifest.inventory) {
  const locale = inventory.locale;
  const localeDirectory = path.join(outputRoot, locale);
  fs.mkdirSync(localeDirectory, { recursive: true });
  const writers = new Map(KINDS.map((kind) => {
    const relativePath = `${locale}/${kind}.jsonl`;
    const destination = path.join(outputRoot, relativePath);
    return [kind, { path: relativePath, destination, partialPath: `${destination}.partial`, descriptor: fs.openSync(`${destination}.partial`, "w"), hash: createHash("sha256"), bytes: 0, documents: 0, segments: 0, emptyDocuments: 0 }];
  }));
  const environment = { locale, language: inventory.language, region: inventory.region };
  const supportHashes = new Map();
  for (const file of inventory.supportFiles) {
    const bytes = fs.readFileSync(path.join(rawRoot, file.path));
    const digest = hash(bytes);
    if (digest !== file.sha256 || bytes.length !== file.bytes) throw new Error(`Input checksum mismatch: ${file.path}`);
    supportHashes.set(file.path, digest);
  }
  const sourceFor = (tableName, pointer) => ({
    repository: manifest.source.name,
    commit: sourceCommit,
    path: `${locale}/gamedata/excel/${tableName}`,
    sha256: supportHashes.get(`${locale}/gamedata/excel/${tableName}`),
    jsonPointer: pointer,
    format: "game-data-table-json",
  });
  const emit = (document) => {
    const writer = writers.get(document.kind);
    const bytes = Buffer.from(`${JSON.stringify(document)}\n`, "utf8");
    fs.writeFileSync(writer.descriptor, bytes);
    writer.hash.update(bytes);
    writer.bytes += bytes.length;
    writer.documents++;
    writer.segments += document.segments.length;
    if (!document.segments.some((segment) => segment.text)) writer.emptyDocuments++;
    addCatalog(document, writer.path);
    for (const type of document.unknownTextTypes ?? []) warnings.push(`${document.id}: Text-bearing row type ${type} was preserved as narration.`);
  };
  let completed = false;
  try {
    const storyRoot = path.join(rawRoot, locale, "gamedata/story");
    const storyFiles = walk(storyRoot);
    const references = new Map();
    const review = readJson(path.join(rawRoot, locale, "gamedata/excel/story_review_table.json"));
    for (const group of Object.values(review)) for (const entry of group.infoUnlockDatas ?? []) {
      const key = `${entry.storyTxt}.json`;
      if (!references.has(key)) references.set(key, []);
      references.get(key).push({ storyId: entry.storyId, groupId: group.id, order: entry.storySort ?? null });
    }
    const corpusHash = createHash("sha256");
    for (const filePath of storyFiles) {
      const bytes = fs.readFileSync(filePath);
      const relativePath = path.relative(storyRoot, filePath).split(path.sep).join("/");
      const sha256 = hash(bytes);
      corpusHash.update(`${relativePath}\0${sha256}\n`);
      const story = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      emit(normalizeStory(story, relativePath, environment, {
        repository: manifest.source.name, commit: sourceCommit,
        path: `${locale}/gamedata/story/${relativePath}`, sha256,
        jsonPointer: "", format: "astr-parsed-json", originalStoryTxtCommit: null,
      }, references.get(relativePath) ?? []));
    }
    const expected = inputReport.languages.find((language) => language.locale === locale);
    if (storyFiles.length !== inventory.storyFileCount || corpusHash.digest("hex") !== expected.storyCorpusSha256) throw new Error(`Story corpus differs from verified input: ${locale}`);
    const loadTable = (name) => readJson(path.join(rawRoot, locale, `gamedata/excel/${name}`));
    const tables = { characters: loadTable("character_table.json"), handbook: loadTable("handbook_info_table.json"), voices: loadTable("charword_table.json"), equipment: loadTable("uniequip_table.json"), skins: loadTable("skin_table.json") };
    for (const document of normalizeTables(tables, environment, sourceFor)) emit(document);
    completed = true;
  } finally {
    for (const writer of writers.values()) fs.closeSync(writer.descriptor);
  }
  if (completed) {
    const counts = {};
    for (const [kind, writer] of writers) {
      fs.renameSync(writer.partialPath, writer.destination);
      files.push({ path: writer.path, locale, kind, documents: writer.documents, segments: writer.segments, emptyDocuments: writer.emptyDocuments, bytes: writer.bytes, sha256: writer.hash.digest("hex") });
      counts[kind] = writer.documents;
    }
    locales.push({ locale, counts });
    console.log(`${locale}: ${Object.entries(counts).map(([kind, count]) => `${kind} ${count}`).join(", ")}`);
  }
}

const entries = [...catalog.values()].sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
const catalogBytes = Buffer.from(`${JSON.stringify({ schemaVersion: SCHEMA_VERSION, sourceCommit, entries }, null, 2)}\n`, "utf8");
fs.writeFileSync(path.join(outputRoot, "catalog.json"), catalogBytes);
const pipelineHash = createHash("sha256").update(fs.readFileSync(fileURLToPath(import.meta.url))).update(fs.readFileSync(path.join(projectRoot, "scripts/lib/normalize-corpus.mjs"))).digest("hex");
const outputManifest = {
  schemaVersion: SCHEMA_VERSION,
  generator: "terra-archive/normalize-corpus-v1",
  generatedAtUtc: new Date().toISOString(),
  pipelineSha256: pipelineHash,
  source: manifest.source,
  files,
  catalog: { path: "catalog.json", entries: entries.length, bytes: catalogBytes.length, sha256: hash(catalogBytes) },
};
fs.writeFileSync(path.join(outputRoot, "manifest.json"), `${JSON.stringify(outputManifest, null, 2)}\n`, "utf8");
const storyEntries = entries.filter((entry) => entry.kind === "story");
const report = {
  schemaVersion: SCHEMA_VERSION,
  generatedAtUtc: outputManifest.generatedAtUtc,
  sourceCommit,
  status: "generated-awaiting-validation",
  totalDocuments: files.reduce((sum, file) => sum + file.documents, 0),
  totalSegments: files.reduce((sum, file) => sum + file.segments, 0),
  outputBytes: files.reduce((sum, file) => sum + file.bytes, 0) + catalogBytes.length,
  canonicalDocuments: entries.length,
  sharedStoriesAcrossAllLocales: storyEntries.filter((entry) => Object.keys(entry.variants).length === manifest.inventory.length).length,
  chineseOnlyStoriesInCollectedSnapshot: storyEntries.filter((entry) => Object.keys(entry.variants).length === 1 && entry.variants.zh_CN).length,
  locales,
  warnings,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
