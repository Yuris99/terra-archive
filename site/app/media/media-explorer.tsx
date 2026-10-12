"use client";
import { useEffect, useState } from "react";
import { ImageViewer, MediaPanel, type MediaImage } from "@/components/media-panel";

type Catalog = { summary: { illustrations: number; voiceFiles: number; stories: number; koreanImages: number };
  operators: { id: string; name: string }[]; stories: { id: string; title: string; group: string; code: string; phase: string }[];
  korean: MediaImage[]; koreanSource?: { savedImages: number; shownImages: number } };
const control = "min-h-11 w-full border border-white/15 bg-[#0b171d] px-3 py-2 text-sm";
export default function MediaExplorer() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState("");
  const [tab, setTab] = useState("operators");
  const [query, setQuery] = useState("");
  const [operator, setOperator] = useState("char_102_texas");
  const [story, setStory] = useState("story:activities/a001/level_a001_01_beg");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/archive/media", { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as Catalog & { error?: string };
      if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) setCatalog(data);
    }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, []);
  const term = query.trim().toLowerCase();
  const operators = catalog?.operators.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(term)) ?? [];
  const stories = catalog?.stories.filter((item) => `${item.title} ${item.group} ${item.code}`.toLowerCase().includes(term)) ?? [];
  return <div className="space-y-6">
    <p className="max-w-3xl text-sm leading-6 text-slate-400">공개 범위에 연결된 일러스트와 스토리 장면, 언어별 음성을 볼 수 있습니다. 스토리 이미지에는 해당 이야기의 내용이 포함됩니다.</p>
    {catalog && <div className="flex flex-wrap gap-2 text-xs text-slate-300"><span className="archive-chip">일러스트 {catalog.summary.illustrations.toLocaleString()}개</span><span className="archive-chip">음성 {catalog.summary.voiceFiles.toLocaleString()}개</span><span className="archive-chip">스토리 {catalog.summary.stories.toLocaleString()}편</span><span className="archive-chip">한국어 이미지 {catalog.summary.koreanImages}개</span></div>}
    <div role="tablist" aria-label="미디어 종류" className="flex flex-wrap gap-3 border-b border-white/10 pb-4">{[["operators", "오퍼레이터"], ["stories", "스토리 장면"], ["korean", "한국어 배너"]].map(([id, name]) => <button key={id} role="tab" aria-selected={tab === id} aria-controls={`media-${id}`} id={`tab-${id}`} className={`archive-chip min-h-11 text-sm ${tab === id ? "border-cyan-200/50 text-cyan-100" : "text-slate-400"}`} onClick={() => { setTab(id); setQuery(""); }}>{name}</button>)}</div>
    {!catalog && !error && <p role="status" className="text-slate-400">미디어 목록을 불러오는 중…</p>}
    {error && <p role="alert" className="archive-card p-5 text-amber-200">{error}</p>}
    {catalog && <section role="tabpanel" id={`media-${tab}`} aria-labelledby={`tab-${tab}`} className="archive-card min-w-0 space-y-6 p-5 sm:p-7">
      {tab !== "korean" && <div className="grid gap-4 md:grid-cols-2">
        <label className="text-xs text-slate-400">이름 또는 제목 검색<input className={`${control} mt-2`} aria-label="미디어 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "operators" ? "예: 텍사스" : "예: 기병과 사냥꾼"} /></label>
        <label className="min-w-0 text-xs text-slate-400">{tab === "operators" ? `오퍼레이터 · ${operators.length}명` : `스토리 · ${stories.length}편`}
          {tab === "operators" ? <select className={`${control} mt-2`} aria-label="오퍼레이터 선택" value={operator} onChange={(event) => setOperator(event.target.value)}>
            {!operators.some((item) => item.id === operator) && <option value={operator}>{catalog.operators.find((item) => item.id === operator)?.name ?? "선택해 주세요"} · 현재 선택</option>}
            {operators.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> :
            <select className={`${control} mt-2`} aria-label="스토리 선택" value={story} onChange={(event) => setStory(event.target.value)}>
              {!stories.some((item) => item.id === story) && <option value={story}>{catalog.stories.find((item) => item.id === story)?.title ?? "선택해 주세요"} · 현재 선택</option>}
              {stories.map((item) => <option key={item.id} value={item.id}>{[item.group, item.code, item.title, item.phase].filter(Boolean).join(" · ")}</option>)}</select>}
        </label>
      </div>}
      {tab === "operators" && <MediaPanel key={operator} operatorId={operator} />}
      {tab === "stories" && <MediaPanel key={story} documentId={story} />}
      {tab === "korean" && <><h2 className="font-semibold">한국 서버 배너와 이벤트 표지</h2><p className="text-sm leading-6 text-slate-400">한국 서버에서 받은 {catalog.koreanSource?.savedImages ?? 0}개 이미지 중 기존 공개 범위에 연결된 {catalog.korean.length}개를 표시합니다. 전체 한국어 UI 이미지 모음은 아닙니다.</p><ImageViewer images={catalog.korean} /></>}
    </section>}
  </div>;
}
