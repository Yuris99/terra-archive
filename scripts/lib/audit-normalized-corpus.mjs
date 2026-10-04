import assert from "node:assert/strict";
import { getPointer, readableText } from "./normalize-corpus.mjs";

// This auditor enumerates source fields independently; it never calls a normalizer.
export function auditDocument(document, raw, characters = {}) {
  const expected = [];
  const append = (record, names, pointer, speaker = null, extra = {}) => {
    for (const field of names) {
      const value = record?.[field];
      if (typeof value !== "string" || !value.trim()) continue;
      expected.push({ pointer: `${pointer}/${field}`, field, speaker, value, ...extra });
    }
  };
  if (document.kind === "story") {
    assert.equal(raw.lang, document.locale, "story language");
    const controls = [];
    for (const [index, row] of raw.storyList.entries()) {
      const rowType = String(row.prop).toLowerCase();
      const attributes = row.attributes ?? {};
      const pointer = `/storyList/${index}`;
      const speaker = ["name", "multiline"].includes(rowType) && typeof attributes.name === "string" && attributes.name.trim() ? readableText(attributes.name) : null;
      append(attributes, ["content", "text", "options"], `${pointer}/attributes`, speaker, { rowId: row.id, rowType, row });
      if (["decision", "predicate", "video"].includes(rowType)) {
        const control = { rowId: row.id, rowType, sourcePointer: pointer, attributes };
        for (const field of ["targetLine", "endOfOpt"]) if (Object.hasOwn(row, field)) control[field] = row[field];
        controls.push(control);
      }
    }
    assert.deepEqual(document.controls, controls, "branch/video controls");
    assert.equal(document.contentState, expected.some((item) => readableText(item.value)) ? "text" : controls.some((item) => item.rowType === "video") ? "video-only" : "no-readable-text", "content state");
    assert.equal(document.alignmentMethod, "shared-story-path");
    assert.equal(document.context.groupId, raw.eventid ?? null);
    assert.equal(document.context.groupName, raw.eventName ?? null);
    assert.equal(document.context.storyType, raw.entryType ?? null);
    assert.equal(document.context.storyCode, raw.storyCode ?? null);
    assert.equal(document.context.phase, raw.avgTag ?? null);
    assert.equal(document.context.introduction, raw.storyInfo ?? null);
  } else {
    const record = getPointer(raw, document.source.jsonPointer);
    const pointer = document.source.jsonPointer;
    if (document.kind === "profile") {
      append(record, ["storyText"], pointer);
      const conditions = Object.fromEntries(Object.entries(record).filter(([field]) => field !== "storyText"));
      assert.deepEqual(document.context.conditions, conditions, "profile conditions");
      assert.equal(document.alignmentMethod, "section-position-candidate");
    } else if (document.kind === "voice") {
      append(record, ["voiceText"], pointer, characters[record.charId]?.name ?? null);
      for (const field of ["voiceId", "voiceIndex", "voiceType", "unlockType", "unlockParam", "lockDescription"]) assert.deepEqual(document.context[field], record[field] ?? null, `voice ${field}`);
    } else if (document.kind === "module") {
      append(record, ["uniEquipDesc", "specialEquipDesc"], pointer);
      assert.equal(document.context.equipmentType, record.type ?? null);
      assert.deepEqual(document.context.missionIds, record.missionList ?? null);
    } else if (document.kind === "skin") {
      append(record.displaySkin, ["content", "dialog", "usage", "description"], `${pointer}/displaySkin`);
      assert.equal(document.context.groupId, record.displaySkin?.skinGroupId ?? null);
      assert.equal(document.context.groupName, record.displaySkin?.skinGroupName ?? null);
    } else throw new Error(`Unknown document kind: ${document.kind}`);
    if (document.kind !== "profile") assert.equal(document.alignmentMethod, "shared-upstream-key");
    const operatorId = document.kind === "profile" ? document.context.operator.id : record.charId ?? null;
    assert.deepEqual(document.context.operator, { id: operatorId, name: characters[operatorId]?.name ?? null }, "operator source");
  }
  assert.equal(document.segments.length, expected.length, "source text field count");
  for (const [ordinal, item] of expected.entries()) {
    const segment = document.segments[ordinal];
    assert.equal(segment.ordinal, ordinal, "segment order");
    assert.equal(segment.sourcePointer, item.pointer, "source text field order/location");
    assert.equal(getPointer(raw, segment.sourcePointer), item.value, "source text pointer");
    assert.equal(segment.text, readableText(item.value), "complete readable text");
    assert.equal(segment.speaker, item.speaker, "speaker");
    assert.equal(segment.kind, item.field === "options" ? "choice" : item.speaker ? "dialogue" : "narration", "segment type");
    if (document.kind === "story") {
      assert.equal(segment.rowId, item.rowId);
      assert.equal(segment.rowType, item.rowType);
      if (item.field === "options") {
        const values = typeof item.row.attributes.values === "string" ? item.row.attributes.values.split(";") : [];
        assert.deepEqual(segment.choices, item.value.split(";").map((value, index) => ({ text: readableText(value), value: values[index] ?? null, targetLine: item.row.targetLine?.[`option${index + 1}`] ?? null })), "choice values/targets");
      }
    } else assert.equal(segment.field, item.field);
  }
  return { sourceTextFields: expected.length };
}
