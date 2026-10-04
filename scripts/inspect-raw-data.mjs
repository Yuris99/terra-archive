import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const rawRoot = path.resolve(
  process.argv[2] ?? path.join(projectRoot, "data/raw/arknights-gamedata"),
);
const excelRoot = path.join(rawRoot, "kr/gamedata/excel");
const storyRoot = path.join(rawRoot, "kr/gamedata/story");

function readJson(fileName) {
  const filePath = path.join(excelRoot, fileName);
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function walkFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      result.push(entryPath);
    }
  }
  return result;
}

function countByTopLevelDirectory(files, root) {
  const counts = {};
  for (const file of files) {
    const relative = path.relative(root, file);
    const [topLevel] = relative.split(path.sep);
    counts[topLevel] = (counts[topLevel] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

if (!fs.existsSync(storyRoot)) {
  throw new Error(`Story directory not found: ${storyRoot}`);
}

const characters = readJson("character_table.json");
const handbook = readJson("handbook_info_table.json");
const charword = readJson("charword_table.json");
const modules = readJson("uniequip_table.json");
const skins = readJson("skin_table.json");
const stories = readJson("story_table.json");
const storyReview = readJson("story_review_table.json");
const activities = readJson("activity_table.json");
const storyFiles = walkFiles(storyRoot);
const texasId = "char_102_texas";

const report = {
  rawRoot,
  storyFiles: {
    total: storyFiles.length,
    text: storyFiles.filter((file) => path.extname(file).toLowerCase() === ".txt").length,
    bytes: storyFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    byTopLevelDirectory: countByTopLevelDirectory(storyFiles, storyRoot),
  },
  tables: {
    characterEntries: Object.keys(characters).length,
    operatorHandbooks: Object.keys(handbook.handbookDict ?? {}).length,
    voiceLines: Object.keys(charword.charWords ?? {}).length,
    modules: Object.keys(modules.equipDict ?? {}).length,
    skins: Object.keys(skins.charSkins ?? {}).length,
    storyIndexEntries: Object.keys(stories).length,
    storyReviewGroups: Object.keys(storyReview).length,
    activities: Object.keys(activities.basicInfo ?? {}).length,
  },
  smokeTest: {
    texasCharacter: characters[texasId]?.name === "텍사스",
    texasHandbook: Boolean(handbook.handbookDict?.[texasId]),
    texasVoiceLines: Object.values(charword.charWords ?? {}).filter(
      (line) => line.charId === texasId,
    ).length,
    texasModules: modules.charEquip?.[texasId] ?? [],
  },
};

if (!report.smokeTest.texasCharacter || !report.smokeTest.texasHandbook) {
  throw new Error("Korean operator smoke test failed for char_102_texas.");
}

console.log(JSON.stringify(report, null, 2));

