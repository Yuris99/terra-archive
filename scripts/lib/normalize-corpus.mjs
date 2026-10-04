export const SCHEMA_VERSION = 1;
export const KINDS = ["story", "profile", "voice", "module", "skin"];
export const TEXT_FIELDS = ["content", "text", "options"];

export function escapePointer(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

export function getPointer(document, pointer) {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split("/").reduce((value, token) => {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value == null || !Object.hasOwn(value, key)) throw new Error(`Missing JSON Pointer: ${pointer}`);
    return value[key];
  }, document);
}

export function readableText(value) {
  if (typeof value !== "string") return "";
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    // Angle-bracketed facility names and book titles are prose, not markup.
    .replace(/<\/?(?:i|b)>|<color(?:=[^<>]+|\s+name=[^<>]+)>|<\/color>|<p=\d+>|<@[\w.:-]+>|<\/>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
      const token = entity.slice(1, -1).toLowerCase();
      if (!token.startsWith("#")) return entities[token] ?? entity;
      const code = token.startsWith("#x") ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    }).trim();
}

export function hasSourceText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function bodySegment(value, pointer, extra = {}) {
  return { kind: "narration", speaker: null, text: readableText(value), sourcePointer: pointer, ...extra };
}

function makeDocument(kind, key, title, context, segments, environment, source) {
  const canonicalId = `${kind}:${key}`;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${environment.locale}:${canonicalId}`,
    canonicalId,
    kind,
    locale: environment.locale,
    language: environment.language,
    region: environment.region,
    title: title ?? key,
    context,
    source,
    segments: segments.map((segment, ordinal) => ({ ordinal, ...segment })),
  };
}

export function normalizeStory(story, relativePath, environment, source, references = []) {
  if (story.lang !== environment.locale || !Array.isArray(story.storyList)) throw new Error(`Invalid story: ${relativePath}`);
  const segments = [];
  const controls = [];
  const unknownTextTypes = new Set();
  const knownTextTypes = new Set(["name", "multiline", "subtitle", "sticker", "animtext", "decision"]);

  for (const [rowIndex, row] of story.storyList.entries()) {
    const rowType = String(row.prop).toLowerCase();
    const attributes = row.attributes ?? {};
    const rowPointer = `/storyList/${rowIndex}`;
    if (["decision", "predicate", "video"].includes(rowType)) {
      controls.push({
        rowId: row.id,
        rowType,
        sourcePointer: rowPointer,
        attributes,
        ...(Object.hasOwn(row, "targetLine") ? { targetLine: row.targetLine } : {}),
        ...(Object.hasOwn(row, "endOfOpt") ? { endOfOpt: row.endOfOpt } : {}),
      });
    }
    for (const field of TEXT_FIELDS) {
      if (!hasSourceText(attributes[field])) continue;
      if (!knownTextTypes.has(rowType)) unknownTextTypes.add(rowType);
      const named = ["name", "multiline"].includes(rowType);
      const speaker = named && hasSourceText(attributes.name) ? readableText(attributes.name) : null;
      const kind = field === "options" ? "choice" : speaker ? "dialogue" : "narration";
      const extra = { kind, speaker, rowId: row.id, rowType };
      if (field === "options") {
        const values = typeof attributes.values === "string" ? attributes.values.split(";") : [];
        extra.choices = attributes.options.split(";").map((text, optionIndex) => ({
          text: readableText(text),
          value: values[optionIndex] ?? null,
          targetLine: row.targetLine?.[`option${optionIndex + 1}`] ?? null,
        }));
      }
      segments.push(bodySegment(attributes[field], `${rowPointer}/attributes/${field}`, extra));
    }
  }
  const document = makeDocument("story", relativePath.replace(/\.json$/, ""), story.storyName, {
    groupId: story.eventid ?? null,
    groupName: story.eventName ?? null,
    storyType: story.entryType ?? null,
    storyCode: story.storyCode ?? null,
    phase: story.avgTag ?? null,
    introduction: story.storyInfo ?? null,
    references,
  }, segments, environment, source);
  document.controls = controls;
  document.contentState = segments.some((segment) => segment.text) ? "text" : controls.some((control) => control.rowType === "video") ? "video-only" : "no-readable-text";
  document.alignmentMethod = "shared-story-path";
  document.unknownTextTypes = [...unknownTextTypes];
  return document;
}

export function* normalizeTables(tables, environment, sourceFor) {
  const operator = (id) => ({ id: id ?? null, name: tables.characters[id]?.name ?? null });
  const fields = (record, names, pointer, speaker = null) => names.filter((name) => hasSourceText(record?.[name])).map((name) =>
    bodySegment(record[name], `${pointer}/${name}`, { speaker, kind: speaker ? "dialogue" : "narration", field: name }),
  );

  for (const [operatorId, handbook] of Object.entries(tables.handbook.handbookDict ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [sectionIndex, section] of (handbook.storyTextAudio ?? []).entries()) {
      for (const [variantIndex, variant] of (section.stories ?? []).entries()) {
        const pointer = `/handbookDict/${escapePointer(operatorId)}/storyTextAudio/${sectionIndex}/stories/${variantIndex}`;
        const { storyText: _text, ...conditions } = variant;
        const document = makeDocument("profile", `${operatorId}:${sectionIndex}:${variantIndex}`, section.storyTitle, {
          operator: operator(operatorId), sectionIndex, variantIndex, conditions,
        }, fields(variant, ["storyText"], pointer), environment, sourceFor("handbook_info_table.json", pointer));
        document.alignmentMethod = "section-position-candidate";
        yield document;
      }
    }
  }

  for (const bucket of ["charWords", "charExtraWords"]) {
    for (const [key, voice] of Object.entries(tables.voices[bucket] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      const pointer = `/${bucket}/${escapePointer(key)}`;
      const document = makeDocument("voice", `${bucket}:${key}`, voice.voiceTitle ?? voice.voiceId, {
        operator: operator(voice.charId), bucket, voiceId: voice.voiceId ?? null,
        voiceIndex: voice.voiceIndex ?? null, voiceType: voice.voiceType ?? null,
        unlockType: voice.unlockType ?? null, unlockParam: voice.unlockParam ?? null,
        lockDescription: voice.lockDescription ?? null,
      }, fields(voice, ["voiceText"], pointer, operator(voice.charId).name), environment, sourceFor("charword_table.json", pointer));
      document.alignmentMethod = "shared-upstream-key";
      yield document;
    }
  }

  for (const [key, equipment] of Object.entries(tables.equipment.equipDict ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const pointer = `/equipDict/${escapePointer(key)}`;
    const document = makeDocument("module", key, equipment.uniEquipName, {
      operator: operator(equipment.charId), equipmentType: equipment.type ?? null,
      templateId: equipment.tmplId ?? null, isSpecialEquip: equipment.isSpecialEquip ?? false,
      missionIds: equipment.missionList ?? null,
    }, fields(equipment, ["uniEquipDesc", "specialEquipDesc"], pointer), environment, sourceFor("uniequip_table.json", pointer));
    document.alignmentMethod = "shared-upstream-key";
    yield document;
  }

  for (const [key, skin] of Object.entries(tables.skins.charSkins ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    const pointer = `/charSkins/${escapePointer(key)}`;
    const display = skin.displaySkin ?? {};
    const document = makeDocument("skin", key, display.skinName ?? key, {
      operator: operator(skin.charId), groupId: display.skinGroupId ?? null,
      groupName: display.skinGroupName ?? null, isBuySkin: skin.isBuySkin ?? false,
    }, fields(display, ["content", "dialog", "usage", "description"], `${pointer}/displaySkin`), environment, sourceFor("skin_table.json", pointer));
    document.alignmentMethod = "shared-upstream-key";
    yield document;
  }
}
