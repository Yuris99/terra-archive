import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const rowIndex = (pointer) => Number(pointer.match(/^\/storyList\/(\d+)(?:\/|$)/)?.[1] ?? -1);
export function validateChunkPolicy(policy) {
  assert.equal(policy.schemaVersion, 1);
  assert.ok(Number.isInteger(policy.targetCharacters) && policy.targetCharacters >= 100);
  assert.ok(Number.isInteger(policy.maxCharacters) && policy.maxCharacters >= policy.targetCharacters);
  assert.equal(policy.overlapCharacters, 0, "v1 uses disjoint source ranges; context is retrieved separately");
  assert.equal(policy.inputPolicyId, "global-only-v1");
  assert.equal(policy.branchHandling, "split-at-every-control-preserve-condition-no-route-inference");
}

function splitEnd(text, start, budget) {
  let end = Math.min(start + budget, text.length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  if (end < text.length) {
    const slice = text.slice(start, end);
    // Prefer a sentence/paragraph boundary, but retain the separator in the source range.
    const candidates = [...slice.matchAll(/[。！？.!?\n]\s*/g)];
    const last = candidates.at(-1);
    if (last && last.index + last[0].length > budget * 0.55) end = start + last.index + last[0].length;
  }
  return end;
}

export function chunkDocument(document, policy, annotations = []) {
  validateChunkPolicy(policy);
  const { segments, controls = [], ...metadata } = document;
  const chunks = [];
  let current = null;
  let condition = null;
  let controlOffset = 0;
  const ordered = [...controls].sort((a, b) => rowIndex(a.sourcePointer) - rowIndex(b.sourcePointer));
  const flush = () => {
    if (!current) return;
    const fingerprint = sha256(JSON.stringify({ text: current.text, spans: current.spans, condition: current.condition }));
    current.id = `${document.id}#chunk:${chunks.length}:${fingerprint.slice(0, 12)}`;
    current.ordinal = chunks.length;
    chunks.push(current);
    current = null;
  };
  for (const segment of segments) {
    const row = rowIndex(segment.sourcePointer);
    while (controlOffset < ordered.length && row >= rowIndex(ordered[controlOffset].sourcePointer)) {
      const control = ordered[controlOffset++];
      flush();
      if (control.rowType === "predicate") condition = control.attributes.references
        ? { sourcePointer: control.sourcePointer, references: control.attributes.references, routeResolved: false }
        : null;
      if (control.rowType === "decision") condition = null;
    }
    if (segment.kind === "choice") flush();
    if (!segment.text) continue;
    const prefix = segment.speaker ? `${segment.speaker}: ` : segment.kind === "choice" ? "[선택지] " : "";
    let start = 0;
    while (start < segment.text.length) {
      const budget = Math.max(2, policy.maxCharacters - prefix.length);
      const end = splitEnd(segment.text, start, budget);
      const part = segment.text.slice(start, end);
      const addition = `${prefix}${part}`;
      if (current && current.text.length + 1 + addition.length > policy.targetCharacters) flush();
      current ??= { text: "", spans: [], condition, annotations: [], warnings: [] };
      if (current.text) current.text += "\n";
      const textStart = current.text.length + prefix.length;
      current.text += addition;
      current.spans.push({ segmentOrdinal: segment.ordinal, sourcePointer: segment.sourcePointer,
        start, end, textStart, textEnd: textStart + part.length, kind: segment.kind, speaker: segment.speaker,
        ...(segment.rowId != null ? { rowId: segment.rowId } : {}) });
      for (const annotation of annotations.filter((entry) => entry.segmentOrdinal === segment.ordinal)) {
        if (!current.annotations.some((entry) => entry.id === annotation.id)) current.annotations.push(annotation);
      }
      if (segment.choices?.some((choice) => choice.value == null)) current.warnings.push("choice-count-mismatch");
      start = end;
      if (start < segment.text.length) flush();
    }
    if (segment.kind === "choice") flush();
  }
  flush();
  return { document: { ...metadata, segmentCount: segments.length, controls }, chunks };
}

// This validator does not call the chunk generator: source slices must reconstruct every segment.
export function auditChunkRecord(source, record, policy, annotations = []) {
  const { segments, controls = [], ...metadata } = source;
  assert.deepEqual(record.document, { ...metadata, segmentCount: segments.length, controls });
  const positions = new Map();
  let lastOrdinal = -1;
  const seenIds = new Set();
  let marked = 0;
  for (const [index, chunk] of record.chunks.entries()) {
    assert.equal(chunk.ordinal, index);
    assert.ok(!seenIds.has(chunk.id));
    seenIds.add(chunk.id);
    const fingerprint = sha256(JSON.stringify({ text: chunk.text, spans: chunk.spans, condition: chunk.condition }));
    assert.equal(chunk.id, `${source.id}#chunk:${index}:${fingerprint.slice(0, 12)}`);
    assert.ok(chunk.text.length <= policy.maxCharacters || chunk.spans[0].speaker?.length > policy.maxCharacters - 1);
    let rendered = "";
    for (const span of chunk.spans) {
      const original = segments[span.segmentOrdinal];
      assert.ok(original && span.segmentOrdinal >= lastOrdinal, "source order");
      lastOrdinal = span.segmentOrdinal;
      assert.equal(span.sourcePointer, original.sourcePointer);
      assert.equal(span.speaker, original.speaker);
      assert.equal(span.kind, original.kind);
      assert.equal(span.start, positions.get(span.segmentOrdinal) ?? 0, "no gaps or overlap");
      assert.ok(span.end > span.start && span.end <= original.text.length);
      assert.equal(chunk.text.slice(span.textStart, span.textEnd), original.text.slice(span.start, span.end));
      const prefix = original.speaker ? `${original.speaker}: ` : original.kind === "choice" ? "[선택지] " : "";
      if (rendered) rendered += "\n";
      assert.equal(span.textStart, rendered.length + prefix.length);
      rendered += prefix + original.text.slice(span.start, span.end);
      assert.equal(span.textEnd, rendered.length);
      positions.set(span.segmentOrdinal, span.end);
    }
    assert.equal(chunk.text, rendered, "no invented chunk text");
    const expectedWarnings = chunk.spans.filter((span) => source.segments[span.segmentOrdinal].choices?.some((choice) => choice.value == null))
      .map(() => "choice-count-mismatch");
    assert.deepEqual(chunk.warnings, expectedWarnings, "source quality warnings preserved");
    if (source.kind === "story") {
      const first = rowIndex(chunk.spans[0].sourcePointer);
      const last = rowIndex(chunk.spans.at(-1).sourcePointer);
      assert.ok(!controls.some((control) => rowIndex(control.sourcePointer) > first && rowIndex(control.sourcePointer) <= last), "no control boundary crossing");
      assert.ok(!chunk.spans.some((span) => span.kind === "choice") || chunk.spans.every((span) => span.kind === "choice"), "choices separate from dialogue");
      const previous = controls.filter((control) => rowIndex(control.sourcePointer) <= first && ["predicate", "decision"].includes(control.rowType)).at(-1);
      const expected = previous?.rowType === "predicate" && previous.attributes.references
        ? { sourcePointer: previous.sourcePointer, references: previous.attributes.references, routeResolved: false } : null;
      assert.deepEqual(chunk.condition, expected, "preserved branch condition, not inferred route");
    }
    const expectedMarks = annotations.filter((entry) => chunk.spans.some((span) => span.segmentOrdinal === entry.segmentOrdinal));
    assert.deepEqual(chunk.annotations, expectedMarks);
    marked += chunk.annotations.length;
  }
  for (const segment of segments) assert.equal(positions.get(segment.ordinal) ?? 0, segment.text.length, "every source character covered");
  return { chunks: record.chunks.length, segments: segments.length, markedChunks: marked };
}
