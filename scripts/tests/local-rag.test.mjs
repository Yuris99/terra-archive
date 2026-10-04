import test from "node:test";
import assert from "node:assert/strict";
import { ANSWER_INSTRUCTIONS, ANSWER_SCHEMA, generateLocalAnswer, validateGroundedAnswer, localModels } from "../lib/local-rag.mjs";
const sources = [{ text: "아미야: 로도스 아일랜드에 오신 것을 환영합니다.", annotations: [], condition: null }];
test("RAG rejects nonexistent sources and fabricated quotes", () => {
  const answer = { uncertainty: "", claims: [
    { text: "환영 인사가 있다.", citations: [{ source: 1, quote: "로도스 아일랜드에 오신 것을 환영합니다." }] },
    { text: "없는 주장", citations: [{ source: 2, quote: "없는 출처 문장이다" }] },
    { text: "조작 인용", citations: [{ source: 1, quote: "살카즈의 왕은 누구다" }] },
  ] };
  const result = validateGroundedAnswer(answer, sources);
  assert.equal(result.claims.length, 1); assert.equal(result.rejectedClaims, 2);
});
test("no retrieval evidence means no model invocation", async () => {
  const answer = await generateLocalAnswer({ store: { search: () => ({ results: [], mode: "literal" }) },
    question: "무엇인가?", query: "없는자료", fetcher: () => { throw new Error("must not call model"); } });
  assert.equal(answer.model, null); assert.equal(answer.claims.length, 0);
});
test("only installed local models appear, never cloud or remote models", async () => {
  const models = await localModels(async (url, options) => ({ ok: true, json: async () => url.endsWith("/api/tags") ? { models: [
    { name: "local:12b", size: 100 }, { name: "model:cloud", size: 0 }, { name: "remote", size: 100, remote_host: "external" },
    { name: "embedding:small", size: 100 },
  ] } : { capabilities: JSON.parse(options.body).model === "local:12b" ? ["completion"] : ["embedding"] } }));
  assert.deepEqual(models, [{ name: "local:12b", size: 100 }]);
});
test("semantic RAG uses the question, not unrelated literal keywords, and awaits retrieval", async () => {
  let called = false;
  const result = await generateLocalAnswer({ store: { search: () => { throw new Error("wrong search mode"); } },
    semantic: { search: async (input) => { called = true; assert.equal(input.query, "실제 질문"); return { results: [], mode: "semantic-cosine" }; } },
    mode: "semantic", question: "실제 질문", query: "관계 없는 단어", fetcher: () => { throw new Error("must not call model"); } });
  assert(called); assert.equal(result.retrievalMode, "semantic-cosine"); assert.equal(result.model, null);
});
test("unknown retrieval modes and unavailable semantic retrieval do not silently fall back", async () => {
  await assert.rejects(generateLocalAnswer({ mode: "unknown", question: "질문" }), /검색 방식/);
  await assert.rejects(generateLocalAnswer({ mode: "semantic", question: "질문" }), /아직/);
});
test("missing installed model is rejected without download", async () => {
  await assert.rejects(generateLocalAnswer({ store: { search: () => ({ results: sources }) },
    question: "질문", query: "로도스", model: "not-installed", fetcher: async () => ({ ok: true, json: async () => ({ models: [] }) }) }), /설치된/);
});

test("model loading timeouts are explained and release the answer lock", async () => {
  const input = { store: { search: () => ({ results: sources }) }, question: "질문", query: "로도스", model: "local:12b",
    fetcher: async (url, options) => {
      if (url.endsWith("/api/chat")) {
        assert.equal(JSON.parse(options.body).options.num_batch, 256);
        throw new DOMException("timed out", "TimeoutError");
      }
      return { ok: true, json: async () => url.endsWith("/api/tags")
        ? { models: [{ name: "local:12b", size: 100 }] } : { capabilities: ["completion"] } };
    } };
  await assert.rejects(generateLocalAnswer(input), /3분 제한/);
  await assert.rejects(generateLocalAnswer(input), /3분 제한/);
});
test("exact quotes do not certify semantic entailment", () => {
  const result = validateGroundedAnswer({ uncertainty: "", claims: [{
    text: "이 문장은 인용에서 도출되지 않는 설명이다.", citations: [{ source: 1, quote: "로도스 아일랜드에 오신 것을 환영합니다." }],
  }] }, sources);
  assert.equal(result.claims.length, 1);
  assert.deepEqual(result.verification, { quotes: "exact-match", interpretations: "unverified" });
});
test("malformed individual claims are rejected without crashing validation", () => {
  const result = validateGroundedAnswer({ uncertainty: "", claims: [null, { text: "설명", citations: [null] }] }, sources);
  assert.equal(result.rejectedClaims, 2); assert.equal(result.claims.length, 0);
});

test("model evidence separates archive metadata from unchanged speaker text, conditions and marks", async () => {
  const evidenceSources = [{ ...sources[0], title: "다른 인물의 모듈", groupName: "자료 주인",
    locale: "ko_KR", kind: "module", condition: { branch: 2 }, annotations: [{ label: "언어판 차이" }],
    spans: [{ speaker: "아미야" }, { speaker: null }, { speaker: "아미야" }] }];
  let chatCalled = false;
  const answer = await generateLocalAnswer({ store: { search: () => ({ results: evidenceSources }) },
    question: "본문의 화자는 누구인가?", query: "환영", model: "local:12b", fetcher: async (url, options) => {
      if (url.endsWith("/api/chat")) {
        chatCalled = true;
        const request = JSON.parse(options.body);
        assert.equal(request.messages[0].content, ANSWER_INSTRUCTIONS + " JSON 형식: " + JSON.stringify(ANSWER_SCHEMA));
        const input = JSON.parse(request.messages[1].content);
        assert.deepEqual(Object.keys(input).sort(), ["evidence", "question"]);
        assert.deepEqual(input.evidence[0], { number: 1,
          metadata: { title: "다른 인물의 모듈", groupName: "자료 주인", locale: "ko_KR", kind: "module" },
          condition: { branch: 2 }, annotations: ["언어판 차이"], text: sources[0].text });
        assert.equal(request.options.num_ctx, 8192); assert.equal(request.options.num_batch, 256);
        assert.equal(request.options.num_gpu, undefined); assert.equal(request.keep_alive, "2m");
        return { ok: true, json: async () => ({ message: { content: JSON.stringify({ claims: [], uncertainty: "검사 응답" }) } }) };
      }
      return { ok: true, json: async () => url.endsWith("/api/tags")
        ? { models: [{ name: "local:12b", size: 100 }] } : { capabilities: ["completion"] } };
    } });
  assert(chatCalled); assert.equal(answer.sources[0].text, sources[0].text);
});

test("generic answer instructions cover metadata, false premises and uncertainty without game-specific answers", () => {
  for (const rule of ["발언자라는 뜻이 아니다", "상대에게 부르는 이름", "이름을 추측하지", "조건부 미래", "전제를 그대로 따르지", "uncertainty에도 근거 없는", "제공 근거 안의 부재"])
    assert(ANSWER_INSTRUCTIONS.includes(rule));
  for (const answer of ["Exusiai", "엑시아", "라즈베리", "샤이닝", "바이올린", "르무엘"])
    assert(!ANSWER_INSTRUCTIONS.includes(answer));
});

test("quote punctuation is still exact, not normalized to pass a model response", () => {
  const text = "“모두 조심해서 이동하세요.”";
  const result = validateGroundedAnswer({ uncertainty: "", claims: [
    { text: "정확 인용", citations: [{ source: 1, quote: text }] },
    { text: "따옴표 변경", citations: [{ source: 1, quote: '"모두 조심해서 이동하세요."' }] },
  ] }, [{ text }]);
  assert.equal(result.claims.length, 1); assert.equal(result.rejectedClaims, 1);
});
