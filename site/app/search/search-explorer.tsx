"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Mark = { id: string; label: string; note: string };
type Chunk = { id: string; ordinal?: number; text: string; annotations: Mark[]; warnings: string[];
  condition: { references: string; sourcePointer: string; routeResolved: false } | null;
  spans: { segmentOrdinal: number; sourcePointer: string; start: number; end: number }[] };
type Source = { commit: string; path: string; sha256: string; repository?: string };
type Result = Chunk & { documentId: string; canonicalId: string; title: string; locale: string; kind: string;
  groupName: string | null; storyCode: string | null; source: Source };
type DocumentView = { document: { id: string; title: string; locale: string; kind: string; contentState?: string;
  context: { groupName?: string; operator?: { name: string } }; source: Source };
  totalChunks: number; chunks: Chunk[]; variants: { locale: string; documentId: string }[] };
type Status = { documents: number; chunks: number; markedChunks: number; sourceCommit: string; semanticSearch: boolean;
  semantic: { ready: boolean; model?: string; reason?: string; progress?: { chunksCompleted: number; chunksTotal: number } };
  models: { name: string; size: number }[] };
type Answer = { claims: { text: string; citations: { source: number; quote: string }[] }[]; uncertainty: string;
  warning: string; rejectedClaims?: number; sources: Result[]; model: string | null; durationMs?: number;
  requested?: { question: string; query: string; locale: string; kind: string; mode: string } };
const locales = [{ id: "ko_KR", name: "한국어" }, { id: "en_US", name: "영어" }, { id: "ja_JP", name: "일본어" }, { id: "zh_CN", name: "중국어" }];
const kinds = [{ id: "all", name: "모든 자료" }, { id: "story", name: "스토리" }, { id: "profile", name: "프로필" },
  { id: "voice", name: "음성 대사" }, { id: "module", name: "모듈" }, { id: "skin", name: "스킨" }];
const controlClass = "min-h-11 rounded border border-white/15 bg-[#102028] px-3 py-2 text-slate-100";

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "요청에 실패했습니다.");
  return data as T;
}
function ChunkLabels({ chunk }: { chunk: Chunk }) {
  return <div className="flex flex-wrap gap-2 text-xs">
    {chunk.condition && <span className="archive-chip text-cyan-200">선택지 조건 {chunk.condition.references} · 경로 해석 전</span>}
    {chunk.annotations.map((mark) => <span key={mark.id} title={mark.note} className="archive-chip text-amber-200">{mark.label}</span>)}
    {chunk.warnings.length > 0 && <span className="archive-chip text-amber-200">원본 선택지 구조 확인 필요</span>}
  </div>;
}

export default function SearchExplorer() {
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState("살카즈");
  const [locale, setLocale] = useState("ko_KR");
  const [kind, setKind] = useState("all");
  const [mode, setMode] = useState("literal");
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<DocumentView | null>(null);
  const [opening, setOpening] = useState(false);
  const [documentOffset, setDocumentOffset] = useState(0);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState("gemma4:12b");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [answering, setAnswering] = useState(false);
  const requestSequence = useRef(0);
  const documentSequence = useRef(0);
  const answerController = useRef<AbortController | null>(null);
  const reader = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState({ query: "", locale: "", kind: "", mode: "" });
  useEffect(() => {
    const controller = new AbortController();
    let poll: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const loaded = await readResponse<Status>(await fetch("/api/archive/status", { signal: controller.signal }));
        if (controller.signal.aborted) return;
        setStatus(loaded);
        if (loaded.semanticSearch) setMode("hybrid");
        else poll = setTimeout(() => void load(), 15000);
        if (loaded.models.length && !loaded.models.some((entry) => entry.name === "gemma4:12b")) setModel(loaded.models[0].name);
      } catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
    }
    void load();
    return () => { controller.abort(); if (poll) clearTimeout(poll); answerController.current?.abort(); };
  }, []);

  async function search(nextOffset = 0) {
    const sequence = ++requestSequence.current;
    setSearching(true); setError("");
    try {
      const parameters = new URLSearchParams({ q: query, locale, kind, mode, offset: String(nextOffset) });
      const response = await readResponse<{ total: number; results: Result[] }>(await fetch(`/api/archive/search?${parameters}`));
      if (sequence !== requestSequence.current) return;
      setResults(response.results); setTotal(response.total); setOffset(nextOffset);
      setSelection({ query, locale, kind, mode });
    } catch (failure) { if (sequence === requestSequence.current) setError((failure as Error).message); }
    finally { if (sequence === requestSequence.current) setSearching(false); }
  }
  async function openDocument(id: string, nextOffset = 0) {
    const sequence = ++documentSequence.current;
    setOpening(true); setError("");
    try {
      const parameters = new URLSearchParams({ id, offset: String(nextOffset) });
      const response = await readResponse<DocumentView>(await fetch(`/api/archive/document?${parameters}`));
      if (sequence !== documentSequence.current) return;
      setView(response); setDocumentOffset(nextOffset);
      reader.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (failure) { if (sequence === documentSequence.current) setError((failure as Error).message); }
    finally { if (sequence === documentSequence.current) setOpening(false); }
  }
  async function ask() {
    const controller = new AbortController(); answerController.current = controller;
    const requested = { question, query: mode !== "literal" ? question : query, locale, kind, mode };
    setAnswering(true); setAnswer(null); setError("");
    try {
      const response = await readResponse<Answer>(await fetch("/api/archive/answer", { method: "POST",
        headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ question, query, locale, kind, mode, model }) }));
      setAnswer({ ...response, requested });
    } catch (failure) { setError(controller.signal.aborted ? "답변 요청을 취소했습니다." : (failure as Error).message); }
    finally { setAnswering(false); answerController.current = null; }
  }
  const changedSearch = selection.query !== query || selection.locale !== locale || selection.kind !== kind || selection.mode !== mode;
  return <main className="archive-grid min-h-screen pb-16">
    <header className="border-b border-white/10 bg-[#081116]/90">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-6">
        <div><p className="font-mono text-xs tracking-widest text-cyan-200">TERRA ARCHIVE / LOCAL RESEARCH</p>
          <h1 className="mt-2 text-2xl font-semibold">세계관 본문 검색</h1></div>
        <Link href="/" className="archive-chip text-sm text-slate-300">기존 한국어 수집 현황 보기</Link>
      </div>
    </header>
    <div className="mx-auto max-w-[1440px] space-y-6 px-5 pt-7">
      <section className="archive-card space-y-4 p-5" aria-label="자료 범위와 검색">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="archive-chip text-lime-200">글로벌 범위 선택본</span><span className="archive-chip">한 · 중 · 일 · 영</span>
          <span className="archive-chip">{status ? `${status.documents.toLocaleString()}개 문서 · ${status.chunks.toLocaleString()}개 검색 묶음` : "자료 상태 확인 중"}</span>
          <span className="archive-chip text-cyan-200">{status?.semanticSearch ? "로컬 의미 검색 + 단어 검색" : "단어 검색 · 의미 검색 준비 중"}</span>
        </div>
        <p className="text-sm leading-6 text-slate-400">미출시·출시 확인 전 자료는 보류합니다. 출시된 이야기의 언어판 차이는 보존하고 표시합니다. 공개 범위는 고정 수집본 기준이며 실시간 출시 인증은 아닙니다.</p>
        <form className="flex flex-wrap gap-3" onSubmit={(event) => { event.preventDefault(); void search(); }}>
          <label className="min-w-52 flex-1"><span className="mb-1 block text-xs text-slate-400">{mode !== "literal" ? "질문 문장 · 관련 원문을 찾습니다" : "검색어 · 공백은 모두 포함, 따옴표는 문구 검색"}</span>
            <input className={`${controlClass} w-full`} aria-label="본문 검색어" value={query} maxLength={mode !== "literal" ? 1000 : 200} onChange={(event) => setQuery(event.target.value)} placeholder={mode !== "literal" ? "예: 아미야가 다시 연습하기 시작한 악기는 뭐야?" : '예: 살카즈 / "로도스 아일랜드"'} /></label>
          <label><span className="mb-1 block text-xs text-slate-400">검색 방식</span><select className={controlClass} aria-label="검색 방식" value={mode} onChange={(event) => setMode(event.target.value)}><option value="literal">단어 일치</option><option value="hybrid" disabled={!status?.semanticSearch}>의미·단어 혼합{!status?.semanticSearch ? " · 준비 중" : ""}</option><option value="semantic" disabled={!status?.semanticSearch}>의미만 비교{!status?.semanticSearch ? " · 준비 중" : ""}</option></select></label>
          <label><span className="mb-1 block text-xs text-slate-400">자료 언어</span><select className={controlClass} aria-label="자료 언어" value={locale} onChange={(event) => setLocale(event.target.value)}>{locales.map((language) => <option key={language.id} value={language.id}>{language.name}</option>)}</select></label>
          <label><span className="mb-1 block text-xs text-slate-400">자료 종류</span><select className={controlClass} aria-label="자료 종류" value={kind} onChange={(event) => setKind(event.target.value)}>{kinds.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <button className={`${controlClass} self-end bg-lime-300 text-slate-950 disabled:opacity-50`} disabled={searching || !query.trim()}>{searching ? "찾는 중…" : "본문 찾기"}</button>
        </form>
        {!status?.semanticSearch && status?.semantic.progress && <p role="status" className="text-xs text-cyan-200">의미 검색 자료 생성 중 · {status.semantic.progress.chunksCompleted.toLocaleString()} / {status.semantic.progress.chunksTotal.toLocaleString()}개 묶음 연결 완료. 15초마다 갱신하며 전체 검증 후 선택할 수 있습니다.</p>}
        {mode !== "literal" && <p className="text-xs leading-5 text-amber-200">{mode === "hybrid" ? "질문에 나온 제목·인물 이름·단어 단서도 함께 반영합니다. " : ""}상위 250개 검색 후보를 보여 줍니다. 닮은 내용이 나와도 질문에 대한 정답이나 충분한 근거라는 뜻은 아닙니다. 자료 언어는 위에서 선택한 언어로 제한됩니다.</p>}
      </section>
      {error && <p role="alert" className="border border-amber-300/30 bg-amber-300/10 p-4 text-amber-100">{error}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="space-y-3" aria-label="검색 결과" aria-busy={searching}>
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">검색 결과 {total > 0 && `· ${selection.mode !== "literal" ? "후보 " : ""}${total.toLocaleString()}개`}</h2>
            {changedSearch && results.length > 0 && <span className="text-xs text-amber-200">조건 변경됨 · 다시 검색하세요</span>}</div>
          {results.length === 0 && <p className="archive-card p-5 text-sm text-slate-400">{selection.query ? "일치하는 본문이 없습니다. 짧은 핵심 단어나 다른 언어로 검색해 보세요." : "검색어를 입력하고 본문 찾기를 눌러 주세요."}</p>}
          {results.map((result) => <article key={result.id} className="archive-card space-y-3 p-5">
            <p className="text-xs text-cyan-200">{result.groupName ?? kinds.find((entry) => entry.id === result.kind)?.name} {result.storyCode}</p>
            <button className="text-left text-base font-semibold underline decoration-white/20 underline-offset-4" onClick={() => void openDocument(result.documentId)}>{result.title}</button>
            <ChunkLabels chunk={result} /><p className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{result.text}</p>
            <p className="break-all text-xs text-slate-500">{result.source.path} · {result.spans[0].sourcePointer}</p>
            <button className={`${controlClass} text-sm`} disabled={opening} onClick={() => void openDocument(result.documentId)}>원문 · 다른 언어판 열기</button>
          </article>)}
          {total > 20 && <div className="flex items-center justify-between gap-3"><button className={controlClass} disabled={offset === 0 || searching || changedSearch} onClick={() => void search(offset - 20)}>이전</button>
            <span className="text-sm text-slate-400">{offset + 1}–{Math.min(offset + 20, total)} / {total.toLocaleString()}</span>
            <button className={controlClass} disabled={offset + 20 >= total || searching || changedSearch} onClick={() => void search(offset + 20)}>다음</button></div>}
        </section>
        <div className="space-y-6">
          <section ref={reader} className="archive-card space-y-4 p-5" aria-label="원문 읽기" aria-busy={opening}>
            <h2 className="text-lg font-semibold">원문 읽기 · 언어판 비교</h2>
            {opening && <p role="status" className="text-sm text-cyan-200">문서를 여는 중…</p>}
            {!view && <p className="text-sm text-slate-400">검색 결과의 제목을 누르면 원문 순서대로 읽을 수 있습니다. 언어별 문장 수는 다를 수 있으며, 문장 단위 번역 대응은 보장하지 않습니다.</p>}
            {view && <><h3 className="text-xl">{view.document.title}</h3>
              <div className="flex flex-wrap gap-2">{view.variants.map((variant) => <button key={variant.locale} className={`${controlClass} text-sm ${variant.locale === view.document.locale ? "border-cyan-300 text-cyan-200" : ""}`} disabled={opening} onClick={() => void openDocument(variant.documentId)}>{locales.find((entry) => entry.id === variant.locale)?.name}</button>)}</div>
              <details className="break-all text-xs text-slate-400"><summary className="cursor-pointer">출처와 자료 버전</summary>
                <p className="mt-2">파일: {view.document.source.path}</p><p>버전: {view.document.source.commit}</p><p>원문 지문: {view.document.source.sha256}</p></details>
              {view.totalChunks === 0 && <p className="text-sm text-slate-400">{view.document.contentState === "video-only" ? "동영상만 있는 장면입니다. 검색용 대사를 만들어 넣지 않았습니다." : "원본에 읽을 수 있는 본문이 없는 항목입니다."}</p>}
              <div className="max-h-[720px] space-y-6 overflow-auto pr-2">{view.chunks.map((chunk) => <article key={chunk.id} className="space-y-2 border-t border-white/10 pt-4">
                <p className="font-mono text-xs text-slate-500">묶음 {(chunk.ordinal ?? 0) + 1} · 본문 항목 {chunk.spans[0].segmentOrdinal + 1}–{chunk.spans.at(-1)!.segmentOrdinal + 1}</p>
                <ChunkLabels chunk={chunk} /><p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{chunk.text}</p>
              </article>)}</div>
              {view.totalChunks > 30 && <div className="flex items-center justify-between gap-3"><button className={controlClass} disabled={documentOffset === 0 || opening} onClick={() => void openDocument(view.document.id, documentOffset - 30)}>앞부분</button>
                <span className="text-xs text-slate-400">{documentOffset + 1}–{Math.min(documentOffset + 30, view.totalChunks)} / {view.totalChunks}</span>
                <button className={controlClass} disabled={documentOffset + 30 >= view.totalChunks || opening} onClick={() => void openDocument(view.document.id, documentOffset + 30)}>뒷부분</button></div>}
            </>}
          </section>
          <section className="archive-card space-y-4 p-5" aria-label="로컬 AI 근거 답변">
            <div><h2 className="text-lg font-semibold">로컬 AI 근거 답변 · 실험 기능</h2><p className="mt-2 text-sm leading-6 text-slate-400">{mode !== "literal" ? "아래 질문 문장과 선택한 검색 방식으로 찾은 상위 5개 묶음을 읽습니다. 위의 검색어를 따로 바꿀 필요는 없습니다." : "위 검색어로 찾은 상위 5개 묶음만 읽습니다. 질문은 설명용이고, 위 검색어가 근거 선택을 결정합니다."} 전체 세계관의 정답을 검증하는 기능은 아닙니다. 기본 결과는 원문 인용이며, AI 해석과 한계 설명은 모두 미검증 상태로 접어 둡니다.</p></div>
            <label className="block"><span className="mb-2 block text-xs text-slate-400">찾은 자료에 대해 물어볼 질문</span><textarea className={`${controlClass} min-h-24 w-full`} aria-label="AI 질문" maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 이 자료에서 살카즈를 어떻게 설명하고 있어?" /></label>
            <div className="flex flex-wrap gap-3"><select className={controlClass} aria-label="로컬 AI 모델" value={model} onChange={(event) => setModel(event.target.value)}>
              {!status?.models.length && <option value="gemma4:12b">로컬 모델 연결 확인 필요</option>}
              {status?.models.map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}</select>
              <button className={`${controlClass} border-cyan-300/40 text-cyan-200 disabled:opacity-40`} disabled={answering || !question.trim() || (mode === "literal" && !query.trim()) || !status?.models.length} onClick={() => void ask()}>{answering ? "PC에서 답변 생성 중…" : "근거로 답변 만들기"}</button>
              {answering && <button className={controlClass} onClick={() => answerController.current?.abort()}>취소</button>}</div>
            <p className="text-xs leading-5 text-slate-500">설치된 로컬 모델만 사용합니다. 모델 자동 다운로드·유료 API 호출은 없습니다. AI의 인용과 설명은 직접 확인해야 합니다.</p>
            {answer && <div className="space-y-4 border-t border-white/10 pt-4">
              {answer.requested && <p className="text-xs leading-5 text-slate-400">요청한 질문: {answer.requested.question}<br />근거 검색 조건: {answer.requested.query} · {answer.requested.mode === "hybrid" ? "의미·단어 혼합" : answer.requested.mode === "semantic" ? "의미만 비교" : "단어 일치"} · {locales.find((entry) => entry.id === answer.requested?.locale)?.name} · {kinds.find((entry) => entry.id === answer.requested?.kind)?.name}</p>}
              {answer.claims.map((claim, index) => <article key={index} className="space-y-2">
                <p className="text-xs text-cyan-200">원문 일치 확인 · 인용 {index + 1}</p>
                {claim.citations.map((citation, citationIndex) => <div key={citationIndex} className="border-l-2 border-cyan-300/30 pl-3 text-sm text-slate-400">
                  <p className="whitespace-pre-wrap">“{citation.quote}”</p><button className="mt-1 text-xs text-cyan-200 underline" onClick={() => void openDocument(answer.sources[citation.source - 1].documentId)}>근거 {citation.source} · {answer.sources[citation.source - 1].title}</button></div>)}
                <details className="text-sm leading-7 text-slate-300"><summary className="cursor-pointer text-xs text-amber-200">AI 해석 보기 · 의미 미검증</summary><p className="mt-2">{claim.text}</p></details>
              </article>)}
              {answer.model && answer.claims.length === 0 && <p className="text-sm text-amber-200">표시할 수 있는 원문 인용이 없습니다. 모델이 답을 보류했거나 인용 검사를 통과하지 못한 결과입니다. 이것만으로 자료 전체에 답이 없다고 판정하지 않습니다.</p>}
              {answer.uncertainty && (answer.model
                ? <details className="text-sm leading-7 text-slate-300"><summary className="cursor-pointer text-xs text-amber-200">AI 한계 설명 보기 · 의미 미검증</summary><p className="mt-2">{answer.uncertainty}</p></details>
                : <p className="text-sm text-amber-200">{answer.uncertainty}</p>)}
              {!!answer.rejectedClaims && <p className="text-xs text-amber-200">원문 인용 검사를 통과하지 못한 설명 {answer.rejectedClaims}개를 숨겼습니다.</p>}
              <p className="text-xs leading-5 text-slate-500">{answer.warning} {answer.model && `사용 모델: ${answer.model}`}</p>
            </div>}
          </section>
        </div>
      </div>
    </div>
  </main>;
}
