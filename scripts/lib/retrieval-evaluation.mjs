import assert from "node:assert/strict";

export function verifyExpectedEvidence(question, records) {
  const documentId = `${question.locale}:${question.canonicalId}`;
  const expected = records.find((record) => record.document.id === documentId);
  assert(expected, `평가 원문이 선택본에 없습니다: ${question.id}`);
  const target = expected.chunks.find((chunk) => chunk.text.includes(question.quote));
  assert(target, `기대 인용이 실제 원문에 없습니다: ${question.id}`);
  const acceptableIds = records.filter((record) => record.document.id === documentId ||
    (question.equivalentOperator && record.document.kind === expected.document.kind &&
      record.document.context.operator?.id === question.equivalentOperator))
    .flatMap((record) => record.chunks.filter((chunk) => chunk.text.includes(question.quote)).map((chunk) => chunk.id));
  return { documentId, targetChunkId: target.id, source: expected.document.source,
    sourcePointers: target.spans.map((span) => span.sourcePointer), acceptableIds };
}
export function evidenceRank(results, evidence, quote) {
  const index = results.findIndex((result) => evidence.acceptableIds.includes(result.id) && result.text.includes(quote));
  return index === -1 ? null : index + 1;
}
export function summarizeRanks(cases) {
  const ranks = cases.map((entry) => entry.rank);
  return { questions: ranks.length, hitAt5: ranks.filter((rank) => rank !== null && rank <= 5).length,
    hitAt20: ranks.filter((rank) => rank !== null && rank <= 20).length,
    meanReciprocalRankAt20: ranks.length ? ranks.reduce((sum, rank) => sum + (rank !== null && rank <= 20 ? 1 / rank : 0), 0) / ranks.length : 0 };
}
