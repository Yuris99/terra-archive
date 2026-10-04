import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");
const rawRoot = path.join(projectRoot, "site/data/arknights-gamedata/kr/gamedata");
const excelRoot = path.join(rawRoot, "excel");
const storyRoot = path.join(rawRoot, "story");
const manifestPath = path.join(projectRoot, "site/data/manifests/arknights-gamedata-kr.json");
const outputPath = path.join(projectRoot, "site/app/generated/archive-data.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function readTable(name) {
  return readJson(path.join(excelRoot, name));
}

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function normalizeText(value, limit = 260) {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit).trim()}…` : text;
}

function dateFromTimestamp(value) {
  return value > 0 ? new Date(value * 1000).toISOString().slice(0, 10) : null;
}

function getStoryPath(relativePath) {
  return relativePath ? path.join(storyRoot, `${relativePath}.txt`) : null;
}

function extractDialoguePreview(filePath, limit = 8) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const rows = [];

  for (const sourceLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line === "[Dialog]" || line.startsWith("[Background") || line.startsWith("[Character")) continue;
    const named = line.match(/^\[name="([^"]*)"\]\s*(.+)$/);
    if (named) rows.push({ speaker: named[1] || "???", text: normalizeText(named[2], 220) });
    else if (!line.startsWith("[") && !line.startsWith("#")) rows.push({ speaker: "지문", text: normalizeText(line, 220) });
    if (rows.length >= limit) break;
  }
  return rows;
}

const characters = readTable("character_table.json");
const handbook = readTable("handbook_info_table.json");
const charword = readTable("charword_table.json");
const modules = readTable("uniequip_table.json");
const storyReview = readTable("story_review_table.json");
const manifest = readJson(manifestPath);
const storyFiles = walk(storyRoot);

const voicesByCharacter = new Map();
for (const voice of Object.values(charword.charWords ?? {})) {
  if (!voicesByCharacter.has(voice.charId)) voicesByCharacter.set(voice.charId, []);
  voicesByCharacter.get(voice.charId).push(voice);
}

const modulesByCharacter = new Map();
for (const equipment of Object.values(modules.equipDict ?? {})) {
  if (!equipment.charId) continue;
  if (!modulesByCharacter.has(equipment.charId)) modulesByCharacter.set(equipment.charId, []);
  modulesByCharacter.get(equipment.charId).push(equipment);
}

const operators = Object.entries(handbook.handbookDict ?? {})
  .filter(([id]) => id.startsWith("char_"))
  .map(([id, operatorHandbook]) => {
    const character = characters[id] ?? {};
    const voices = voicesByCharacter.get(id) ?? [];
    const operatorModules = modulesByCharacter.get(id) ?? [];
    const records = Object.values(operatorHandbook.handbookAvgList ?? {});
    const profiles = (operatorHandbook.storyTextAudio ?? []).map((section) => ({
      title: section.storyTitle,
      excerpt: normalizeText(section.stories?.[0]?.storyText),
    }));

    return {
      id,
      name: character.name ?? id,
      appellation: character.appellation ?? null,
      rarity: Number(String(character.rarity ?? "0").replace("TIER_", "")),
      profession: character.profession ?? "UNKNOWN",
      displayNumber: character.displayNumber ?? null,
      nationId: character.nationId ?? null,
      groupId: character.groupId ?? null,
      tags: character.tagList ?? [],
      profileCount: profiles.length,
      voiceCount: voices.length,
      moduleCount: operatorModules.length,
      recordCount: records.length,
      profiles,
      voiceSamples: voices
        .sort((a, b) => (a.voiceIndex ?? 0) - (b.voiceIndex ?? 0))
        .map((voice) => ({ title: voice.voiceTitle, text: normalizeText(voice.voiceText) }))
        .filter((voice, index, allVoices) =>
          allVoices.findIndex((candidate) => candidate.title === voice.title && candidate.text === voice.text) === index,
        )
        .slice(0, 4),
      modules: operatorModules
        .sort((a, b) => (a.charEquipOrder ?? 0) - (b.charEquipOrder ?? 0))
        .map((equipment) => ({ id: equipment.uniEquipId, name: equipment.uniEquipName, excerpt: normalizeText(equipment.uniEquipDesc) })),
      records: records.map((record) => ({ id: record.storySetId, name: record.storySetName, date: dateFromTimestamp(record.storyGetTime) })),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "ko"));

const typeLabels = {
  MAINLINE: "메인",
  ACTIVITY: "이벤트",
  MINI_ACTIVITY: "미니",
  NONE: "오퍼레이터 기록",
};

const storyGroups = Object.values(storyReview).map((group) => {
  const entries = (group.infoUnlockDatas ?? []).map((story) => {
    const filePath = getStoryPath(story.storyTxt);
    return {
      id: story.storyId,
      code: story.storyCode || null,
      name: story.storyName,
      sourcePath: story.storyTxt ? `kr/gamedata/story/${story.storyTxt}.txt` : null,
      available: Boolean(filePath && fs.existsSync(filePath)),
    };
  });

  return {
    id: group.id,
    name: group.name,
    type: typeLabels[group.entryType] ?? group.entryType,
    typeKey: group.entryType,
    startDate: dateFromTimestamp(group.startTime),
    storyCount: entries.length,
    availableCount: entries.filter((entry) => entry.available).length,
    entries,
  };
});

const latestEvent = storyGroups
  .filter((group) => group.startDate)
  .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
const latestEventSource = latestEvent.entries.find((entry) => entry.available)?.sourcePath;
const latestEventPath = latestEventSource ? path.join(rawRoot, latestEventSource.replace(/^kr\/gamedata\//, "")) : null;

const knownGaps = storyGroups
  .filter((group) => group.availableCount !== group.storyCount)
  .map((group) => ({ id: group.id, name: group.name, missing: group.storyCount - group.availableCount, total: group.storyCount }));

const indexedStoryCount = storyGroups.reduce((sum, group) => sum + group.storyCount, 0);
const availableStoryCount = storyGroups.reduce((sum, group) => sum + group.availableCount, 0);

const archiveData = {
  source: {
    commit: manifest.source.commit,
    commitDate: manifest.source.commitDate,
    retrievedAtUtc: manifest.source.retrievedAtUtc,
    region: manifest.source.region,
  },
  overview: {
    storyFiles: storyFiles.length,
    indexedStories: indexedStoryCount,
    availableStories: availableStoryCount,
    operatorCount: operators.length,
    mainChapters: storyGroups.filter((group) => group.typeKey === "MAINLINE").length,
    eventGroups: storyGroups.filter((group) => group.typeKey === "ACTIVITY").length,
    miniGroups: storyGroups.filter((group) => group.typeKey === "MINI_ACTIVITY").length,
    operatorRecordGroups: storyGroups.filter((group) => group.typeKey === "NONE").length,
  },
  latestEvent: {
    ...latestEvent,
    dialoguePreview: extractDialoguePreview(latestEventPath),
  },
  knownGaps,
  operators,
  storyGroups,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(archiveData, null, 2)}\n`, "utf8");
console.log(`Generated ${path.relative(projectRoot, outputPath)}`);
console.log(`${operators.length} operators, ${storyGroups.length} story groups`);
