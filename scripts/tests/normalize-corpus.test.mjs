import test from "node:test";
import assert from "node:assert/strict";
import { escapePointer, getPointer, readableText, normalizeStory, normalizeTables } from "../lib/normalize-corpus.mjs";
import { auditDocument } from "../lib/audit-normalized-corpus.mjs";

const environment = { locale: "ko_KR", language: "ko", region: "kr" };
const source = { path: "ko_KR/gamedata/story/example.json", jsonPointer: "" };
const story = (rows) => ({ lang: "ko_KR", storyName: "시험 이야기", storyList: rows });
const row = (prop, attributes, extra = {}) => ({ id: `line-${prop}`, prop, attributes, ...extra });

test("formatting removal preserves names, variables, literal angles and long prose", () => {
  assert.equal(readableText(" <@lv.item>안녕</> <i>친구</i><br/>다음\r\n<color name=#ffffff>문장</color> <p=1>끝</> "), "안녕 친구\n다음\n문장 끝");
  const prose = "<Active Originium> <The Romance of Ives> <I> <R系列动力装甲> <활성 오리지늄> x < y {@nickname}";
  assert.equal(readableText(prose), prose);
  assert.equal(readableText("&lt;i&gt; &#x1f642; &#65; &amp; &#0; &#xD800;"), "<i> 🙂 A & &#0; &#xD800;");
  assert.equal(readableText("오랜 기록 ".repeat(5000)).length, "오랜 기록 ".repeat(5000).trim().length);
});

test("JSON pointers round-trip escaped upstream keys and reject missing paths", () => {
  const key = "operator/~1";
  assert.equal(escapePointer(key), "operator~1~01");
  const original = { records: { [key]: { text: "원문" } } };
  assert.equal(getPointer(original, `/records/${escapePointer(key)}/text`), "원문");
  assert.equal(getPointer(original, ""), original);
  assert.throws(() => getPointer(original, "/records/missing"), /Missing/);
  assert.throws(() => getPointer(original, "records"), /Invalid/);
});

test("stories retain all text types, speakers, order and source locations", () => {
  const input = story([
    row("name", { name: "아미야", content: "첫 대사" }),
    row("name", { content: "지문" }),
    row("MULTILINE", { name: "켈시", content: "긴\r\n대사" }),
    row("subtitle", { text: "자막" }),
    row("sticker", { name: "layout", text: "표지판" }),
    row("animtext", { name: "group_location_stamp", content: "<p=1>런디니움</>" }),
    row("futureText", { content: "새 형식도 보존" }),
    row("background", { image: "an_asset_path" }),
  ]);
  const output = normalizeStory(input, "obt/main/example.json", environment, source);
  assert.equal(output.id, "ko_KR:story:obt/main/example");
  assert.equal(output.segments.length, 7);
  assert.deepEqual(output.segments.map((s) => s.speaker), ["아미야", null, "켈시", null, null, null, null]);
  assert.deepEqual(output.segments.map((s) => s.kind), ["dialogue", "narration", "dialogue", "narration", "narration", "narration", "narration"]);
  assert.deepEqual(output.segments.map((s) => s.ordinal), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(output.segments[2].text, "긴\n대사");
  assert.equal(getPointer(input, output.segments[3].sourcePointer), "자막");
  assert.deepEqual(output.unknownTextTypes, ["futuretext"]);
  assert.equal(output.contentState, "text");
});

test("choices and predicate controls are preserved without resolving branches", () => {
  const decision = row("Decision", { options: "왼쪽;오른쪽", values: "1;2" }, { targetLine: { option1: "line5", option2: "line9" } });
  const predicate = row("Predicate", { references: "1" }, { endOfOpt: false, targetLine: { jump: "line12" } });
  const output = normalizeStory(story([decision, predicate]), "example.json", environment, source);
  assert.deepEqual(output.segments[0].choices, [{ text: "왼쪽", value: "1", targetLine: "line5" }, { text: "오른쪽", value: "2", targetLine: "line9" }]);
  assert.equal(output.segments[0].kind, "choice");
  assert.equal(output.controls[1].endOfOpt, false);
  assert.deepEqual(output.controls[1].attributes, { references: "1" });
  assert.deepEqual(output.controls[1].targetLine, { jump: "line12" });
  assert.equal(output.controls[0].sourcePointer, "/storyList/0");
});

test("video-only scenes remain documents and are not mistaken for English prose", () => {
  const output = normalizeStory(story([row("Video", { res: "Assets/Video/Story/movie" })]), "video.json", environment, source);
  assert.equal(output.contentState, "video-only");
  assert.equal(output.segments.length, 0);
  assert.equal(output.controls[0].attributes.res, "Assets/Video/Story/movie");
  assert.throws(() => normalizeStory({ lang: "en_US", storyList: [] }, "bad.json", environment, source), /Invalid/);
});

export function tableFixture() {
  return {
    characters: { "op/~": { name: "아미야" } },
    handbook: { handbookDict: { "op/~": { storyTextAudio: [{ storyTitle: "기록", stories: [{ storyText: "첫 기록", unLockType: "TRUST", unLockParam: "50" }, { storyText: "다른 기록", patchIdList: ["patch1"] }] }] } } },
    voices: { charWords: { "CN_001": { charId: "op/~", voiceId: "CN_001", voiceText: "한국어 대사", unlockType: "DIRECT" } }, charExtraWords: { "extra/~": { charId: "op/~", voiceId: "CN_extra", voiceText: "추가 대사" } } },
    equipment: { equipDict: { "badge/~": { charId: "op/~", type: "INITIAL", uniEquipName: "증표", uniEquipDesc: "기본 설명", specialEquipDesc: "특수 설명" } } },
    skins: { charSkins: { "skin/~": { charId: "op/~", displaySkin: { skinName: "복장", content: "공통", dialog: "공통", usage: "용도", description: "상세" } }, empty: { charId: "unknown", displaySkin: {} } } },
  };
}

test("tables include every profile variant, extra voice, initial module and skin field", () => {
  const tables = tableFixture();
  const sourceFor = (table, pointer) => ({ path: table, jsonPointer: pointer });
  const documents = [...normalizeTables(tables, environment, sourceFor)];
  assert.equal(documents.length, 7);
  const profiles = documents.filter((d) => d.kind === "profile");
  assert.deepEqual(profiles.map((d) => d.segments[0].text), ["첫 기록", "다른 기록"]);
  assert.deepEqual(profiles[0].context.conditions, { unLockType: "TRUST", unLockParam: "50" });
  assert.equal(profiles[0].alignmentMethod, "section-position-candidate");
  const voices = documents.filter((d) => d.kind === "voice");
  assert.equal(voices.length, 2);
  assert.ok(voices.every((d) => d.locale === "ko_KR" && d.language === "ko"));
  assert.ok(voices.every((d) => d.segments[0].speaker === "아미야"));
  assert.equal(voices[1].context.bucket, "charExtraWords");
  const module = documents.find((d) => d.kind === "module");
  assert.equal(module.context.equipmentType, "INITIAL");
  assert.deepEqual(module.segments.map((s) => s.text), ["기본 설명", "특수 설명"]);
  const skin = documents.find((d) => d.title === "복장");
  assert.deepEqual(skin.segments.map((s) => s.field), ["content", "dialog", "usage", "description"]);
  assert.equal(skin.segments.filter((s) => s.text === "공통").length, 2);
  assert.equal(documents.find((d) => d.title === "empty").segments.length, 0);
  assert.equal(documents.find((d) => d.title === "empty").context.operator.name, null);
  const allSourceTables = { "handbook_info_table.json": tables.handbook, "charword_table.json": tables.voices, "uniequip_table.json": tables.equipment, "skin_table.json": tables.skins };
  for (const document of documents) for (const segment of document.segments) {
    assert.equal(readableText(getPointer(allSourceTables[document.source.path], segment.sourcePointer)), segment.text);
  }
  const translated = [...normalizeTables(tables, { locale: "en_US", language: "en", region: "en" }, sourceFor)];
  assert.deepEqual(translated.map((d) => d.canonicalId), documents.map((d) => d.canonicalId));
  assert.notEqual(translated[0].id, documents[0].id);
});

test("independent audit rejects dropped, shortened, misordered or wrongly attributed text", () => {
  const input = story([row("name", { name: "아미야", content: "전체 대사입니다." }), row("subtitle", { text: "두 번째 문장" })]);
  const output = normalizeStory(input, "example.json", environment, source);
  assert.deepEqual(auditDocument(output, input), { sourceTextFields: 2 });
  const dropped = structuredClone(output);
  dropped.segments.pop();
  assert.throws(() => auditDocument(dropped, input), /source text field count/);
  const shortened = structuredClone(output);
  shortened.segments[0].text = "전체";
  assert.throws(() => auditDocument(shortened, input), /complete readable text/);
  const speaker = structuredClone(output);
  speaker.segments[1].speaker = "아미야";
  assert.throws(() => auditDocument(speaker, input), /speaker/);
  const order = structuredClone(output);
  order.segments.reverse();
  assert.throws(() => auditDocument(order, input), /segment order/);
});

test("independent audit rejects lost controls and changed option destinations", () => {
  const input = story([row("decision", { options: "첫째;둘째", values: "1;2" }, { targetLine: { option1: "line10", option2: "line20" } }), row("predicate", { references: "1" }, { endOfOpt: true })]);
  const output = normalizeStory(input, "example.json", environment, source);
  auditDocument(output, input);
  const controls = structuredClone(output);
  controls.controls.pop();
  assert.throws(() => auditDocument(controls, input), /branch\/video controls/);
  const choice = structuredClone(output);
  choice.segments[0].choices[0].targetLine = "line20";
  assert.throws(() => auditDocument(choice, input), /choice values\/targets/);
});

test("independent table audit checks each source record and condition", () => {
  const tables = tableFixture();
  const originals = { "handbook_info_table.json": tables.handbook, "charword_table.json": tables.voices, "uniequip_table.json": tables.equipment, "skin_table.json": tables.skins };
  const documents = [...normalizeTables(tables, environment, (table, pointer) => ({ path: table, jsonPointer: pointer }))];
  for (const document of documents) auditDocument(document, originals[document.source.path], tables.characters);
  const profile = structuredClone(documents.find((d) => d.kind === "profile"));
  profile.context.conditions = {};
  assert.throws(() => auditDocument(profile, tables.handbook, tables.characters), /profile conditions/);
  const skin = structuredClone(documents.find((d) => d.title === "복장"));
  skin.segments.splice(1, 1);
  assert.throws(() => auditDocument(skin, tables.skins, tables.characters), /source text field count/);
});
