export const HYBRID_POLICY = { id: "metadata-focused-rrf-v1", reciprocalRankConstant: 60,
  weights: { semantic: 1, lexical: 1, focused: 2 } };
const stop = new Set("a an the what which who how does did do is are was were in on of to and or for with she he it her his tell told thing about this that as at from be has have 뭐야 무엇 어떤 누가 누구 어떻게 왜 몇 했어 말했어 있어 그 이 것".split(" "));
const normal = (value) => value.normalize("NFC").toLowerCase();
function includesPhrase(query, phrase) {
  if (!/^[a-z0-9]/.test(phrase)) return query.includes(phrase);
  let from = 0;
  while (from < query.length) {
    const index = query.indexOf(phrase, from);
    if (index === -1) return false;
    if (!/[a-z0-9]/.test(query[index - 1] ?? "") && !/[a-z0-9]/.test(query[index + phrase.length] ?? "")) return true;
    from = index + 1;
  }
  return false;
}
export function lexicalTerms(query) {
  const terms = new Set();
  for (const token of normal(query).match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (token.length < 2 || stop.has(token)) continue;
    terms.add(token);
    if (/[가-힣]/.test(token)) {
      const stripped = token.replace(/(?:에게서|에게|에서|으로|처럼|까지|부터|이라면|이라면서|라고|이고|은|는|이|가|을|를|의|에|와|과)$/u, "");
      if (stripped.length >= 2 && !stop.has(stripped)) terms.add(stripped);
    } else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)) {
      const characters = [...token];
      for (let i = 0; i < characters.length - 1; i++) terms.add(characters.slice(i, i + 2).join(""));
    }
  }
  return [...terms].slice(0, 32);
}
export function prepareHybridQuery(documents, query) {
  const normalized = normal(query), frequencies = new Map();
  for (const document of documents) frequencies.set(normal(document.title), (frequencies.get(normal(document.title)) ?? 0) + 1);
  const titles = new Set(), operators = new Set();
  for (const document of documents) {
    const title = normal(document.title), operator = normal(document.context.operator?.name ?? "");
    // Common headings such as Profile/Talk 1 are not specific document references.
    if (title.length >= 3 && frequencies.get(title) <= 4 && includesPhrase(normalized, title)) titles.add(title);
    if (operator.length >= 2 && includesPhrase(normalized, operator)) operators.add(operator);
  }
  let focusedQuery = normalized;
  for (const phrase of [...titles, ...operators].sort((a, b) => b.length - a.length)) focusedQuery = focusedQuery.split(phrase).join(" ");
  focusedQuery = focusedQuery.replace(/\s+/g, " ").trim();
  return { terms: lexicalTerms(query), titles, operators, focusedQuery: focusedQuery.length >= 3 ? focusedQuery : query,
    anchored: titles.size > 0 || operators.size > 0 };
}
export function matchesAnchor(document, plan) {
  // An explicitly named rare title is a more precise reference than a character alone.
  return plan.titles.size ? plan.titles.has(normal(document.title)) : plan.operators.has(normal(document.context.operator?.name ?? ""));
}
function compare(a, b) {
  return a.result.documentId.localeCompare(b.result.documentId) || a.result.spans[0].segmentOrdinal - b.result.spans[0].segmentOrdinal;
}
function uniqueRanked(entries, field) {
  const ranked = [...entries].sort((a, b) => b[field] - a[field] || compare(a, b)), unique = [], seen = new Set();
  for (const entry of ranked) {
    const key = `${entry.result.kind}:${entry.result.text}`;
    if (!seen.has(key)) { seen.add(key); unique.push(entry); }
  }
  return unique.slice(0, 1000);
}
export function fuseHybridRanks(entries, plan) {
  const frequency = new Map(plan.terms.map((term) => [term, 0]));
  for (const entry of entries) {
    const body = normal(entry.result.text), metadata = normal([entry.document.title, entry.document.context.groupName,
      entry.document.context.operator?.name, entry.document.context.storyCode].filter(Boolean).join(" "));
    entry.hits = plan.terms.flatMap((term) => {
      const bodyHit = body.includes(term), metadataHit = metadata.includes(term);
      if (!bodyHit && !metadataHit) return [];
      frequency.set(term, frequency.get(term) + 1);
      return [{ term, weight: bodyHit ? 1 : 0.8 }];
    });
  }
  for (const entry of entries) entry.lexicalScore = entry.hits.reduce((sum, hit) =>
    sum + hit.weight * Math.log(1 + (entries.length - frequency.get(hit.term) + 0.5) / (frequency.get(hit.term) + 0.5)), 0)
    / Math.sqrt(1 + entry.result.text.length / 900);
  const lists = [
    [uniqueRanked(entries, "semanticScore"), HYBRID_POLICY.weights.semantic],
    [uniqueRanked(entries.filter((entry) => entry.lexicalScore > 0), "lexicalScore"), HYBRID_POLICY.weights.lexical],
    [uniqueRanked(entries.filter((entry) => entry.focusedScore !== undefined), "focusedScore"), HYBRID_POLICY.weights.focused],
  ];
  const fused = new Map();
  for (const [list, weight] of lists) list.forEach((entry, rank) => {
    const current = fused.get(entry.result.id) ?? { entry, score: 0 };
    current.score += weight / (HYBRID_POLICY.reciprocalRankConstant + rank + 1); fused.set(entry.result.id, current);
  });
  const ranked = [...fused.values()].sort((a, b) => b.score - a.score || compare(a.entry, b.entry));
  const results = [], seen = new Set();
  for (const { entry, score } of ranked) {
    const key = `${entry.result.kind}:${entry.result.text}`;
    if (!seen.has(key)) { seen.add(key); results.push({ ...entry.result, score, semanticScore: entry.semanticScore }); }
  }
  return results;
}
