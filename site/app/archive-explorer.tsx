"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Archive,
  BookOpenText,
  Boxes,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Database,
  FileText,
  GitCommitHorizontal,
  Layers3,
  Mic2,
  Quote,
  Search,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import archiveData from "./generated/archive-data.json";
import { MediaPanel } from "@/components/media-panel";

const professionLabels: Record<string, string> = {
  PIONEER: "뱅가드",
  WARRIOR: "가드",
  TANK: "디펜더",
  SNIPER: "스나이퍼",
  CASTER: "캐스터",
  MEDIC: "메딕",
  SUPPORT: "서포터",
  SPECIAL: "스페셜리스트",
};

const storyFilters = [
  { key: "ALL", label: "전체" },
  { key: "MAINLINE", label: "메인" },
  { key: "ACTIVITY", label: "이벤트" },
  { key: "MINI_ACTIVITY", label: "미니" },
  { key: "NONE", label: "기록" },
] as const;

type StoryFilter = (typeof storyFilters)[number]["key"];

function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "cyan",
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Archive;
  tone?: "cyan" | "lime" | "amber";
}) {
  const tones = {
    cyan: "border-cyan-300/20 bg-cyan-300/[0.045] text-cyan-200",
    lime: "border-lime-300/20 bg-lime-300/[0.045] text-lime-200",
    amber: "border-amber-300/20 bg-amber-300/[0.045] text-amber-200",
  };

  return (
    <article className={`archive-card min-h-40 p-5 ${tones[tone]}`}>
      <div className="mb-7 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-400">{label}</span>
        <Icon aria-hidden="true" className="size-5" />
      </div>
      <p className="font-mono text-4xl font-semibold tracking-[-0.05em] text-slate-50">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{note}</p>
    </article>
  );
}

function DataLabel({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-xs uppercase tracking-[0.13em] text-slate-500">{children}</span>;
}

export default function ArchiveExplorer() {
  const [operatorQuery, setOperatorQuery] = useState("");
  const [selectedOperatorId, setSelectedOperatorId] = useState("char_102_texas");
  const [storyQuery, setStoryQuery] = useState("");
  const [storyFilter, setStoryFilter] = useState<StoryFilter>("ALL");
  const [selectedStoryId, setSelectedStoryId] = useState(archiveData.latestEvent.id);

  const selectedOperator =
    archiveData.operators.find((operator) => operator.id === selectedOperatorId) ?? archiveData.operators[0];

  const filteredOperators = useMemo(() => {
    const query = operatorQuery.trim().toLocaleLowerCase("ko");
    if (!query) return archiveData.operators;
    return archiveData.operators.filter((operator) =>
      [operator.name, operator.appellation, operator.id, operator.displayNumber]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("ko").includes(query)),
    );
  }, [operatorQuery]);

  const filteredStories = useMemo(() => {
    const query = storyQuery.trim().toLocaleLowerCase("ko");
    return archiveData.storyGroups.filter((group) => {
      const typeMatches = storyFilter === "ALL" || group.typeKey === storyFilter;
      const queryMatches = !query || group.name.toLocaleLowerCase("ko").includes(query) || group.id.toLocaleLowerCase("ko").includes(query);
      return typeMatches && queryMatches;
    });
  }, [storyFilter, storyQuery]);

  const selectedStory = archiveData.storyGroups.find((group) => group.id === selectedStoryId) ?? archiveData.storyGroups[0];
  const coverage = (archiveData.overview.availableStories / archiveData.overview.indexedStories) * 100;

  return (
    <main className="min-h-screen bg-[var(--background)] text-slate-100">
      <div className="archive-grid min-h-screen">
        <header className="border-b border-white/10 bg-[#081116]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1520px] flex-col gap-5 px-4 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="relative size-16 shrink-0 overflow-hidden border border-cyan-200/25 bg-black shadow-[0_0_32px_rgba(73,215,232,0.12)]">
                <Image
                  src="/terra-archive-logo.png"
                  alt="Terra Archive 로고"
                  fill
                  priority
                  sizes="64px"
                  className="scale-[1.6] object-cover object-top"
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-[-0.025em]">Terra Archive</h1>
                  <Badge className="border-cyan-300/30 bg-cyan-300/10 text-cyan-100">KR</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">원본 데이터 구조를 확인하는 로컬 기록 탐색기</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-400">
              <Link href="/search" className="archive-chip text-lime-200">새 다국어 본문 검색 열기</Link>
              <Link href="/media" className="archive-chip text-cyan-200">이미지 · 음성</Link>
              <span className="flex items-center gap-2"><CircleCheck className="size-4 text-lime-300" />기존 KR 스냅샷</span>
              <span className="flex items-center gap-2 font-mono text-xs"><GitCommitHorizontal className="size-4 text-cyan-300" />{archiveData.source.commit.slice(0, 10)}</span>
              <span className="font-mono text-xs text-slate-600">{archiveData.source.commitDate.slice(0, 10)}</span>
            </div>
          </div>
        </header>

        <Tabs defaultValue="overview" className="mx-auto w-full max-w-[1520px] gap-0 px-4 pb-16 sm:px-7">
          <div className="sticky top-0 z-20 -mx-4 border-b border-white/10 bg-[#081116]/90 px-4 py-3 backdrop-blur-xl sm:-mx-7 sm:px-7">
            <TabsList variant="line" className="h-11 w-full justify-start gap-3 overflow-hidden sm:gap-5">
              <TabsTrigger value="overview" className="flex-none px-1"><Database />현황</TabsTrigger>
              <TabsTrigger value="operators" className="flex-none px-1"><Users />오퍼레이터</TabsTrigger>
              <TabsTrigger value="stories" className="flex-none px-1"><BookOpenText />스토리</TabsTrigger>
              <TabsTrigger value="sources" className="flex-none px-1"><Archive />출처</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="pt-7">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div><DataLabel>snapshot overview</DataLabel><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">지금 확보된 기록</h2></div>
              <p className="max-w-xl text-sm leading-6 text-slate-500">최신 한국어 스냅샷의 색인과 실제 파일을 대조한 결과입니다. 무엇이 연결되고 어디가 비어 있는지 보여줍니다.</p>
            </div>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="스토리 원본" value={archiveData.overview.storyFiles.toLocaleString()} note="TXT 및 보조 JSON" icon={FileText} tone="cyan" />
              <MetricCard label="색인된 이야기" value={archiveData.overview.indexedStories.toLocaleString()} note={`${archiveData.overview.availableStories.toLocaleString()}편 파일 확인`} icon={BookOpenText} tone="lime" />
              <MetricCard label="오퍼레이터" value={archiveData.overview.operatorCount.toLocaleString()} note="프로필 보유 기준" icon={Users} tone="amber" />
              <MetricCard label="스토리 묶음" value={archiveData.storyGroups.length.toLocaleString()} note={`${archiveData.overview.mainChapters} 메인 · ${archiveData.overview.eventGroups} 이벤트`} icon={Layers3} tone="cyan" />
            </section>

            <section className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
              <article className="archive-card overflow-hidden">
                <div className="border-b border-white/10 p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><DataLabel>latest indexed story</DataLabel><h3 className="mt-2 text-2xl font-semibold tracking-tight">{archiveData.latestEvent.name}</h3></div>
                    <Badge className="border-lime-300/30 bg-lime-300/10 text-lime-100">{archiveData.latestEvent.availableCount}/{archiveData.latestEvent.storyCount} 확인</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-sm text-slate-400"><span className="archive-chip">{archiveData.latestEvent.id}</span><span className="archive-chip">{archiveData.latestEvent.startDate}</span><span className="archive-chip">{archiveData.latestEvent.type}</span></div>
                </div>
                <div className="grid min-h-80 md:grid-cols-[220px_1fr]">
                  <div className="border-b border-white/10 bg-white/[0.02] p-5 md:border-b-0 md:border-r">
                    <DataLabel>records</DataLabel>
                    <div className="mt-4 space-y-2">
                      {archiveData.latestEvent.entries.slice(0, 8).map((entry, index) => (
                        <div key={entry.id} className="flex items-center gap-3 text-sm"><span className="font-mono text-xs text-slate-600">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0 flex-1 truncate text-slate-300">{entry.code || entry.name}</span><span className="size-1.5 shrink-0 bg-lime-300" /></div>
                      ))}
                    </div>
                  </div>
                  <div className="p-5 sm:p-6">
                    <div className="mb-4 flex items-center gap-2 text-sm text-slate-400"><Quote className="size-4 text-amber-300" />첫 원문 미리보기</div>
                    <div className="space-y-4">
                      {archiveData.latestEvent.dialoguePreview.slice(0, 5).map((line, index) => (
                        <div key={`${line.speaker}-${index}`} className="grid gap-1 sm:grid-cols-[92px_1fr] sm:gap-4"><span className="font-mono text-xs text-cyan-200">{line.speaker}</span><p className="text-[0.95rem] leading-7 text-slate-300">{line.text}</p></div>
                      ))}
                    </div>
                  </div>
                </div>
              </article>

              <div className="grid gap-4">
                <article className="archive-card p-5 sm:p-6">
                  <div className="flex items-center justify-between"><DataLabel>coverage</DataLabel><span className="font-mono text-sm text-lime-200">{coverage.toFixed(2)}%</span></div>
                  <Progress value={coverage} className="mt-5 h-2 bg-white/10 [&_[data-slot=progress-indicator]]:bg-lime-300" />
                  <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-slate-500">실제 파일</p><p className="mt-1 font-mono text-lg">{archiveData.overview.availableStories.toLocaleString()}</p></div><div><p className="text-slate-500">색인</p><p className="mt-1 font-mono text-lg">{archiveData.overview.indexedStories.toLocaleString()}</p></div></div>
                </article>
                <article className="archive-card border-amber-300/20 bg-amber-300/[0.035] p-5 sm:p-6">
                  <div className="flex items-center gap-2"><CircleAlert className="size-5 text-amber-300" /><h3 className="font-semibold">알려진 공백</h3></div>
                  <div className="mt-5 space-y-4">
                    {archiveData.knownGaps.map((gap) => <div key={gap.id} className="flex items-center justify-between gap-4"><div><p className="text-sm text-slate-200">{gap.name}</p><p className="mt-1 font-mono text-xs text-slate-600">{gap.id}</p></div><Badge variant="outline" className="border-amber-300/30 text-amber-200">-{gap.missing}</Badge></div>)}
                  </div>
                  <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-slate-500">로컬 수집 누락이 아니라 상류 KR 스냅샷에 파일이 없는 항목입니다.</p>
                </article>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="operators" className="pt-7">
            <div className="grid min-h-[720px] gap-4 xl:grid-cols-[360px_1fr]">
              <aside className="archive-card flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <DataLabel>operator index</DataLabel>
                  <label className="relative mt-4 block"><span className="sr-only">오퍼레이터 검색</span><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><Input value={operatorQuery} onChange={(event) => setOperatorQuery(event.target.value)} placeholder="이름, 코드, 영문명 검색" className="h-11 border-white/10 bg-white/[0.035] pl-10 text-base placeholder:text-slate-600" /></label>
                  <p className="mt-3 text-sm text-slate-500">{filteredOperators.length.toLocaleString()}명 표시</p>
                </div>
                <ScrollArea className="h-[620px]">
                  <div className="p-2">
                    {filteredOperators.map((operator) => (
                      <button key={operator.id} type="button" onClick={() => setSelectedOperatorId(operator.id)} className={`group flex w-full items-center gap-3 border-l-2 px-3 py-3 text-left transition-colors ${operator.id === selectedOperator.id ? "border-lime-300 bg-lime-300/[0.07]" : "border-transparent hover:bg-white/[0.04]"}`}>
                        <div className="grid size-10 shrink-0 place-items-center border border-white/10 bg-white/[0.035] font-mono text-sm text-cyan-200">{operator.name.slice(0, 1)}</div>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-200">{operator.name}</p><p className="mt-1 truncate font-mono text-xs text-slate-600">{operator.id}</p></div><ChevronRight className="size-4 text-slate-700 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </aside>

              <section className="archive-card overflow-hidden">
                <div className="border-b border-white/10 p-5 sm:p-7">
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div><div className="flex flex-wrap items-center gap-2"><Badge className="border-cyan-300/25 bg-cyan-300/10 text-cyan-100">★ {selectedOperator.rarity}</Badge><span className="font-mono text-xs text-slate-600">{selectedOperator.displayNumber}</span></div><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{selectedOperator.name}</h2><p className="mt-2 font-mono text-sm text-slate-500">{selectedOperator.appellation} · {professionLabels[selectedOperator.profession] ?? selectedOperator.profession}</p></div>
                    <div className="grid grid-cols-3 gap-px overflow-hidden border border-white/10 bg-white/10 text-center">
                      {[["기록", selectedOperator.recordCount], ["음성", selectedOperator.voiceCount], ["모듈", selectedOperator.moduleCount]].map(([label, value]) => <div key={label} className="min-w-20 bg-[#0b171d] px-3 py-3"><p className="font-mono text-lg">{value}</p><p className="mt-1 text-xs text-slate-600">{label}</p></div>)}
                    </div>
                  </div>
                </div>
                <div className="border-b border-white/10 bg-[#0b171d] p-5 sm:p-7"><MediaPanel key={selectedOperator.id} operatorId={selectedOperator.id} /></div>
                <div className="grid gap-px bg-white/10 lg:grid-cols-2">
                  <div className="bg-[#0b171d] p-5 sm:p-7">
                    <div className="flex items-center gap-2"><FileText className="size-4 text-lime-300" /><h3 className="font-semibold">프로필 기록</h3></div>
                    <div className="mt-5 space-y-5">{selectedOperator.profiles.slice(0, 5).map((profile) => <article key={profile.title}><p className="text-sm font-medium text-cyan-100">{profile.title}</p><p className="mt-2 text-sm leading-6 text-slate-400">{profile.excerpt}</p></article>)}</div>
                  </div>
                  <div className="bg-[#0b171d] p-5 sm:p-7">
                    <div className="flex items-center gap-2"><Mic2 className="size-4 text-amber-300" /><h3 className="font-semibold">음성 및 연결 기록</h3></div>
                    <div className="mt-5 space-y-4">{selectedOperator.voiceSamples.map((voice, index) => <blockquote key={`${voice.title}-${index}`} className="border-l border-amber-300/40 pl-4"><p className="text-xs text-amber-200">{voice.title}</p><p className="mt-1 text-sm leading-6 text-slate-400">{voice.text}</p></blockquote>)}</div>
                    <div className="mt-7 border-t border-white/10 pt-5"><DataLabel>operator records</DataLabel><div className="mt-3 flex flex-wrap gap-2">{selectedOperator.records.length ? selectedOperator.records.map((record) => <span key={record.id} className="archive-chip">{record.name}</span>) : <span className="text-sm text-slate-600">연결된 기록 없음</span>}</div></div>
                    <div className="mt-5"><DataLabel>modules</DataLabel><div className="mt-3 space-y-2">{selectedOperator.modules.map((module) => <div key={module.id} className="flex items-center justify-between gap-3 border border-white/10 bg-white/[0.025] px-3 py-2 text-sm"><span className="text-slate-300">{module.name}</span><Boxes className="size-4 text-cyan-300" /></div>)}</div></div>
                  </div>
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="stories" className="pt-7">
            <div className="grid min-h-[720px] gap-4 xl:grid-cols-[410px_1fr]">
              <aside className="archive-card flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-white/10 p-5">
                  <DataLabel>story index</DataLabel>
                  <label className="relative mt-4 block"><span className="sr-only">스토리 검색</span><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" /><Input value={storyQuery} onChange={(event) => setStoryQuery(event.target.value)} placeholder="스토리 제목 또는 ID" className="h-11 border-white/10 bg-white/[0.035] pl-10 text-base placeholder:text-slate-600" /></label>
                  <div className="mt-3 flex flex-wrap gap-2">{storyFilters.map((filter) => <button key={filter.key} type="button" onClick={() => setStoryFilter(filter.key)} className={`archive-filter ${storyFilter === filter.key ? "archive-filter-active" : ""}`}>{filter.label}</button>)}</div>
                </div>
                <ScrollArea className="h-[590px]"><div className="p-2">{filteredStories.map((group) => <button key={group.id} type="button" onClick={() => setSelectedStoryId(group.id)} className={`group w-full border-l-2 px-3 py-3 text-left transition-colors ${group.id === selectedStory.id ? "border-cyan-300 bg-cyan-300/[0.07]" : "border-transparent hover:bg-white/[0.04]"}`}><div className="flex items-center justify-between gap-3"><span className="archive-type">{group.type}</span><span className={`size-1.5 ${group.availableCount === group.storyCount ? "bg-lime-300" : "bg-amber-300"}`} /></div><p className="mt-2 truncate text-sm font-medium text-slate-200">{group.name}</p><p className="mt-1 font-mono text-xs text-slate-600">{group.id} · {group.availableCount}/{group.storyCount}</p></button>)}</div></ScrollArea>
              </aside>
              <section className="archive-card overflow-hidden">
                <div className="border-b border-white/10 p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div><span className="archive-type">{selectedStory.type}</span><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">{selectedStory.name}</h2><p className="mt-2 font-mono text-sm text-slate-600">{selectedStory.id}</p></div><div className="text-right"><p className="font-mono text-2xl text-lime-200">{selectedStory.availableCount}/{selectedStory.storyCount}</p><p className="mt-1 text-sm text-slate-500">원본 파일 확인</p></div></div></div>
                <div className="p-5 sm:p-7"><div className="grid grid-cols-[44px_minmax(0,1fr)_auto] border-b border-white/10 pb-3 text-xs uppercase tracking-widest text-slate-600"><span>No.</span><span>기록</span><span>상태</span></div><div className="divide-y divide-white/[0.07]">{selectedStory.entries.map((entry, index) => <div key={entry.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 py-4"><span className="font-mono text-xs text-slate-600">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="truncate text-sm text-slate-200">{entry.code ? `${entry.code} · ` : ""}{entry.name}</p><p className="mt-1 truncate font-mono text-xs text-slate-600">{entry.sourcePath}</p></div>{entry.available ? <CircleCheck className="size-4 text-lime-300" aria-label="파일 있음" /> : <CircleAlert className="size-4 text-amber-300" aria-label="파일 없음" />}</div>)}</div></div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="sources" className="pt-7">
            <section className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
              <article className="archive-card p-6 sm:p-8"><DataLabel>source of truth</DataLabel><h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">한국어 RAW 스냅샷</h2><p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">이 화면은 원본을 수정하지 않고 별도 카탈로그로 읽습니다. 정규화 결과는 다시 만들 수 있고, 모든 항목은 원본 파일 경로와 커밋으로 돌아갈 수 있습니다.</p><dl className="mt-8 grid gap-px overflow-hidden border border-white/10 bg-white/10 sm:grid-cols-2">{[["저장소", "ArknightsAssets/ArknightsGamedata"], ["리전", archiveData.source.region.toUpperCase()], ["커밋", archiveData.source.commit], ["원본 파일", archiveData.overview.storyFiles.toLocaleString()]].map(([term, description]) => <div key={term} className="bg-[#0b171d] p-4"><dt className="text-sm text-slate-500">{term}</dt><dd className="mt-2 break-all font-mono text-sm text-slate-200">{description}</dd></div>)}</dl></article>
              <article className="archive-card p-6 sm:p-8"><DataLabel>data boundary</DataLabel><h3 className="mt-3 text-xl font-semibold">현재 포함 범위</h3><ul className="mt-6 space-y-4 text-sm text-slate-400">{["한국어 스토리 전체 디렉터리", "오퍼레이터 프로필 및 기록", "음성 대사와 모듈", "스토리·이벤트 색인", "스킨 및 기본 캐릭터 정보"].map((item) => <li key={item} className="flex items-center gap-3"><span className="size-1.5 bg-cyan-300" />{item}</li>)}</ul><div className="mt-8 border border-amber-300/20 bg-amber-300/[0.04] p-4 text-sm leading-6 text-slate-400"><strong className="text-amber-200">로컬 전용.</strong> 게임 원문 전체를 공개 배포하지 않고, 구조 검증과 연구에 사용합니다.</div></article>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
