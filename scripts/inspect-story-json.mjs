import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(projectRoot, "data/raw/manifests/arknights-story-json.json");
const rawRoot = path.join(projectRoot, "data/raw/arknights-story-json");
const reportPath = path.join(projectRoot, "data/reports/story-json-coverage.json");
const errors = [];
const warnings = [];
const languageScripts = {
  ko_KR: /[가-힣]/u,
  ja_JP: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh_CN: /\p{Script=Han}/u,
  en_US: /[a-z]/iu,
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : entry.isFile() ? [filePath] : [];
  });
}

function storyReferences(table) {
  return Object.values(table).flatMap((group) =>
    (group.infoUnlockDatas ?? []).map((entry) => ({
      groupId: group.id,
      type: group.entryType,
      storyId: entry.storyId,
      path: entry.storyTxt ? `${entry.storyTxt}.json` : null,
    })),
  );
}

function coverage(references, availablePaths) {
  const missing = references.filter((entry) => !entry.path || !availablePaths.has(entry.path));
  return { indexed: references.length, available: references.length - missing.length, missing };
}

const manifest = readJson(manifestPath);
const checkoutCommit = execFileSync("git", ["-C", rawRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const checkoutChanges = execFileSync("git", ["-C", rawRoot, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" }).trim();
if (checkoutCommit !== manifest.source.commit) errors.push("Source commit differs from manifest.");
if (checkoutChanges) errors.push("Source checkout has local changes.");

const koreanTable = readJson(path.join(projectRoot, "data/raw/arknights-gamedata/kr/gamedata/excel/story_review_table.json"));
const koreanReferences = storyReferences(koreanTable);
const koreanManifest = readJson(path.join(projectRoot, "data/raw/manifests/arknights-gamedata-kr.json"));
const localePaths = new Map();

const languages = manifest.inventory.map((inventory) => {
  const { locale } = inventory;
  const storyRoot = path.join(rawRoot, locale, "gamedata/story");
  const storyFiles = walk(storyRoot).filter((filePath) => filePath.endsWith(".json")).sort();
  const availablePaths = new Set();
  const corpusHash = createHash("sha256");
  let storyBytes = 0;
  let storyRows = 0;
  let storiesWithText = 0;
  let parsedStories = 0;
  const textlessScenes = [];

  for (const filePath of storyFiles) {
    const relativePath = path.relative(storyRoot, filePath).split(path.sep).join("/");
    const bytes = fs.readFileSync(filePath);
    storyBytes += bytes.length;
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    corpusHash.update(`${relativePath}\0${fileHash}\n`);
    try {
      const story = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      if (story.lang !== locale) throw new Error(`Expected lang ${locale}, got ${story.lang}`);
      if (!Array.isArray(story.storyList) || !story.storyList.length) throw new Error("Missing or empty storyList");
      const body = story.storyList.flatMap((row) => [
        row.text, row.content, row.attributes?.content, row.attributes?.text, row.attributes?.options,
      ]).filter((text) => typeof text === "string" && text.trim()).join("\n");
      if (body && !languageScripts[locale].test(body)) {
        warnings.push(`${locale}/${relativePath}: Text has no characters in the expected language script; inspect before indexing.`);
      }
      storyRows += story.storyList.length;
      if (body) storiesWithText++;
      else textlessScenes.push({
        path: relativePath,
        kind: story.storyList.some((row) => row.prop?.toLowerCase() === "video") ? "video-only" : "stage-directions-only",
      });
      parsedStories++;
      availablePaths.add(relativePath);
    } catch (error) {
      errors.push(`${locale}/${relativePath}: ${error.message}`);
    }
  }
  if (storyFiles.length !== inventory.storyFileCount) errors.push(`${locale}: Story count differs from manifest.`);
  if (storyBytes !== inventory.storyBytes) errors.push(`${locale}: Story byte count differs from manifest.`);

  let supportBytes = 0;
  let verifiedSupportFiles = 0;
  for (const expected of inventory.supportFiles) {
    try {
      const bytes = fs.readFileSync(path.join(rawRoot, expected.path));
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== expected.sha256 || bytes.length !== expected.bytes) throw new Error("Manifest hash or byte count mismatch");
      JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
      supportBytes += bytes.length;
      verifiedSupportFiles++;
    } catch (error) {
      errors.push(`${expected.path}: ${error.message}`);
    }
  }

  const readTable = (name) => readJson(path.join(rawRoot, locale, `gamedata/excel/${name}`));
  const sourceReferences = storyReferences(readTable("story_review_table.json"));
  const handbook = readTable("handbook_info_table.json");
  const voices = readTable("charword_table.json");
  const equipment = readTable("uniequip_table.json");
  const skins = readTable("skin_table.json");
  const koreanCoverage = coverage(koreanReferences, availablePaths);
  const sourceCoverage = coverage(sourceReferences, availablePaths);
  localePaths.set(locale, availablePaths);

  return {
    locale,
    language: inventory.language,
    region: inventory.region,
    storyFiles: storyFiles.length,
    parsedStories,
    storiesWithText,
    textlessScenes,
    storyRows,
    storyBytes,
    storyCorpusSha256: corpusHash.digest("hex"),
    verifiedSupportFiles,
    supportBytes,
    tables: {
      characters: Object.keys(readTable("character_table.json")).length,
      operatorHandbooks: Object.keys(handbook.handbookDict ?? {}).length,
      voiceLines: Object.keys(voices.charWords ?? {}).length,
      modules: Object.keys(equipment.equipDict ?? {}).length,
      skins: Object.keys(skins.charSkins ?? {}).length,
    },
    sourceIndexCoverage: sourceCoverage,
    koreanIndexCoverage: koreanCoverage,
    koreanIndexCoverageByType: Object.fromEntries([...new Set(koreanReferences.map((entry) => entry.type))].map((type) => {
      const typeCoverage = coverage(koreanReferences.filter((entry) => entry.type === type), availablePaths);
      return [type, { indexed: typeCoverage.indexed, available: typeCoverage.available }];
    })),
    recoveredKoreanGaps: ["act24side", "act13mini"].map((groupId) => {
      const gapCoverage = coverage(koreanReferences.filter((entry) => entry.groupId === groupId), availablePaths);
      return { groupId, indexed: gapCoverage.indexed, available: gapCoverage.available };
    }),
  };
});

const sharedPaths = [...(localePaths.get("ko_KR") ?? [])].filter((storyPath) =>
  [...localePaths.values()].every((paths) => paths.has(storyPath)),
);
const report = {
  schemaVersion: 1,
  checkedAtUtc: new Date().toISOString(),
  source: manifest.source,
  koreanBaselineCommit: koreanManifest.source.commit,
  validationPassed: errors.length === 0,
  totalStoryFiles: languages.reduce((sum, language) => sum + language.storyFiles, 0),
  totalPayloadBytes: languages.reduce((sum, language) => sum + language.storyBytes + language.supportBytes, 0),
  sharedStoryPathsAcrossCollectedLanguages: sharedPaths.length,
  languages,
  errors,
  warnings,
  limitations: [
    "File coverage and JSON structure are verified, not sentence-level translation alignment or original TXT fidelity.",
    "ASTR parsed stories do not guarantee inclusion of all tutorials, battle popups or other game text.",
    "Shared paths are alignment candidates; identical scene or line segmentation across languages is not verified.",
    "Chinese-server-only releases require separate spoiler filtering before retrieval.",
  ],
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  validationPassed: report.validationPassed,
  sourceCommit: checkoutCommit,
  totalStoryFiles: report.totalStoryFiles,
  totalPayloadBytes: report.totalPayloadBytes,
  sharedStoryPaths: sharedPaths.length,
  languages: languages.map((language) => ({
    locale: language.locale,
    storyFiles: language.storyFiles,
    parsedStories: language.parsedStories,
    verifiedSupportFiles: language.verifiedSupportFiles,
    sourceIndex: `${language.sourceIndexCoverage.available}/${language.sourceIndexCoverage.indexed}`,
    koreanIndex: `${language.koreanIndexCoverage.available}/${language.koreanIndexCoverage.indexed}`,
    ...language.tables,
  })),
  errors,
  warnings,
  reportPath: path.relative(projectRoot, reportPath),
}, null, 2));
if (errors.length) process.exitCode = 1;
