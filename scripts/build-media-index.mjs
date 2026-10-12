import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";

const root = process.cwd();
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const read = (name) => fs.readFileSync(path.join(root, name));
const json = (name) => JSON.parse(read(name));
const manifestBytes = read("data/retrieval/global-v1/manifest.json");
const manifest = JSON.parse(manifestBytes);
assert.equal(manifest.validationPassed, true);
assert.equal(manifest.policySha256, digest(read("config/retrieval-policy.json")));
function documents(kind) {
  const file = manifest.files.find((file) => file.locale === "ko_KR" && file.kind === kind);
  const bytes = read(`data/retrieval/global-v1/${file.path}`);
  assert.equal(digest(bytes), file.sha256, "Selected documents changed; rebuild the selection first");
  return bytes.toString("utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}
const index = { schemaVersion: 1, generatedAt: new Date().toISOString(), policyId: manifest.policyId,
  selectionSha256: digest(manifestBytes), policySha256: manifest.policySha256,
  operators: {}, stories: {}, documentSubjects: {}, korean: [], files: {}, summary: {} };
const mediaRoot = "data/raw/arknights-assets2/";
function addFile(relative, label, category, extra = {}) {
  if (!relative.startsWith(mediaRoot) || !fs.existsSync(path.join(root, relative))) return null;
  const info = fs.lstatSync(path.join(root, relative));
  assert.ok(info.isFile() && !info.isSymbolicLink());
  const extension = path.extname(relative).toLowerCase();
  if (![".png", ".jpg", ".webp", ".mp3"].includes(extension)) return null;
  const id = digest(relative).slice(0, 32);
  index.files[id] = { path: relative, bytes: info.size, category };
  return { id, label, category, ...extra };
}
function pushUnique(list, entry) { if (entry && !list.some((item) => item.id === entry.id)) list.push(entry); }
const profiles = documents("profile");
for (const doc of profiles) {
  const operator = doc.context.operator;
  if (!operator) continue;
  index.operators[operator.id] ??= { id: operator.id, name: operator.name, images: [], voices: [] };
  index.documentSubjects[doc.canonicalId] = { operator: operator.id };
}
const selectedSkins = documents("skin");
const skinBytes = read("data/raw/arknights-story-json/ko_KR/gamedata/excel/skin_table.json");
assert.equal(digest(skinBytes), selectedSkins[0].source.sha256);
const skins = JSON.parse(skinBytes).charSkins;
for (const doc of documents("module")) if (doc.context.operator?.id) index.documentSubjects[doc.canonicalId] = { operator: doc.context.operator.id };
const allowedSkins = new Set(selectedSkins.map((doc) => doc.canonicalId.slice(5)));
for (const doc of selectedSkins) index.documentSubjects[doc.canonicalId] = { operator: doc.context.operator.id };
for (const skin of Object.values(skins)) {
  const operator = index.operators[skin.charId];
  // Base/evolution outfits also have selected skin records. Never infer release from a filename.
  if (!operator || !allowedSkins.has(skin.skinId) || !skin.illustId) continue;
  const stem = skin.illustId.replace(/^illust_/, "");
  const relative = `${mediaRoot}en/assets/dyn/arts/characters/${skin.charId}/${stem}.png`;
  pushUnique(operator.images, addFile(relative, skin.displaySkin.skinName ?? skin.displaySkin.skinGroupName ?? "기본 복장", "illustration", { asset: stem }));
}
const selectedVoices = documents("voice");
const wordBytes = read("data/raw/arknights-story-json/ko_KR/gamedata/excel/charword_table.json");
assert.equal(digest(wordBytes), selectedVoices[0].source.sha256);
const words = JSON.parse(wordBytes);
const voiceLanguages = { voice_kr: "한국어", voice: "일본어", voice_en: "영어", voice_cn: "중국어", voice_custom: "지역 음성" };
for (const doc of selectedVoices) {
  const operator = index.operators[doc.context.operator?.id];
  if (!operator) continue;
  index.documentSubjects[doc.canonicalId] = { operator: operator.id };
  const [, bucket, key] = doc.canonicalId.split(":");
  const asset = words[bucket]?.[key]?.voiceAsset;
  if (typeof asset !== "string" || !/^[a-zA-Z0-9_/#@+-]+$/.test(asset)) continue;
  for (const [folder, language] of Object.entries(voiceLanguages)) {
    pushUnique(operator.voices, addFile(`${mediaRoot}voice/assets/dyn/audio/sound_beta_2/${folder}/${asset.toLowerCase()}.mp3`, doc.title, "voice",
      { language, languageId: folder, text: doc.segments.map((segment) => segment.text).join("\n"), voiceId: doc.context.voiceId, cueId: doc.canonicalId, documentId: doc.id }));
  }
}
// Only visuals explicitly referenced by an allowed Korean story are exposed.
const visualFolders = { background: "backgrounds", image: "images", character: "characters" };
const missing = new Set();
for (const doc of documents("story")) {
  const story = { id: doc.canonicalId, documentId: doc.id, title: doc.title, group: doc.context.groupName ?? "기타",
    groupId: doc.context.groupId, code: doc.context.storyCode ?? "", phase: doc.context.phase ?? "", images: [] };
  const original = read(`data/raw/arknights-story-json/${doc.source.path}`);
  assert.equal(digest(original), doc.source.sha256, `Story source changed: ${doc.id}`);
  for (const row of JSON.parse(original).storyList ?? []) {
    const type = row.prop.toLowerCase();
    const folder = visualFolders[type];
    if (!folder) continue;
    const attributes = row.attributes ?? {};
    const names = type === "character" ? [attributes.name, attributes.name2] : [attributes.image];
    for (const name of names) {
      if (typeof name !== "string" || !/^[a-zA-Z0-9_#@+.-]+$/.test(name)) continue;
      const relative = `${mediaRoot}en/assets/dyn/avg/${folder}/${name.toLowerCase()}.png`;
      const entry = addFile(relative, name, type, { rowId: row.id });
      if (entry) pushUnique(story.images, entry);
      else missing.add(`${folder}/${name}`);
    }
  }
  index.stories[doc.canonicalId] = story;
  index.documentSubjects[doc.canonicalId] = { story: doc.canonicalId };
}
const krManifest = "data/raw/manifests/kr-localized-images.json";
if (fs.existsSync(path.join(root, krManifest))) {
  const kr = json(krManifest);
  assert.equal(kr.complete, true, "Korean acquisition has not completed");
  const groups = new Map(Object.values(index.stories).map((story) => [story.groupId, story.group]));
  const chapters = new Map(Object.values(index.stories).filter((story) => story.id.startsWith("story:main/"))
    .map((story) => [story.id.match(/story:main\/level_(\d+)-/)?.[1], story.group]));
  for (const image of kr.images) {
    const main = /^main_(\d+)$/.exec(image.name);
    const label = groups.get(image.name) ?? (main ? chapters.get(main[1]) : null);
    // Gacha/shop banners and unknown or future events are retained locally, held out of the viewer.
    if (!label) continue;
    assert.equal(digest(read(image.path)), image.sha256);
    pushUnique(index.korean, addFile(image.path, label, "korean-banner", { asset: image.name, width: image.width, height: image.height }));
  }
  index.koreanSource = { resourceVersion: kr.resourceVersion, savedImages: kr.uniqueFiles, shownImages: index.korean.length };
}
index.summary = { operators: Object.values(index.operators).filter((entry) => entry.images.length || entry.voices.length).length,
  illustrations: Object.values(index.operators).reduce((n, entry) => n + entry.images.length, 0),
  voiceFiles: Object.values(index.operators).reduce((n, entry) => n + entry.voices.length, 0),
  stories: Object.values(index.stories).filter((story) => story.images.length).length,
  storyImages: new Set(Object.values(index.stories).flatMap((story) => story.images.map((image) => image.id))).size,
  unmatchedStoryReferences: missing.size, koreanImages: index.korean.length, allowedFiles: Object.keys(index.files).length };
fs.mkdirSync(path.join(root, "data/indexes/media-v1"), { recursive: true });
fs.writeFileSync(path.join(root, "data/indexes/media-v1/index.json"), JSON.stringify(index));
console.log(JSON.stringify(index.summary, null, 2));
