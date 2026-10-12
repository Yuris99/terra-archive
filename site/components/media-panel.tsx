"use client";

/* Local originals are streamed without Next image caching or duplicate image files. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";

export type MediaImage = { id: string; label: string; category: string; url: string; asset?: string };
type Voice = MediaImage & { languageId: string; language: string; text: string; voiceId: string; cueId: string };
type MediaData = { id: string; name?: string; title?: string; images: MediaImage[]; voices?: Voice[] };
const control = "min-h-11 max-w-full rounded-none border border-white/15 bg-[#0b171d] px-3 py-2 text-sm text-slate-200";

export function ImageViewer({ images }: { images: MediaImage[] }) {
  const [selected, setSelected] = useState(0);
  const [failed, setFailed] = useState("");
  const current = images[selected] ?? images[0];
  if (!current) return <p className="text-sm text-slate-400">연결할 수 있는 이미지가 없습니다.</p>;
  const names: Record<string, string> = { background: "배경", image: "장면", character: "등장인물", illustration: "일러스트", "korean-banner": "한국어 배너" };
  return <div className="min-w-0 space-y-3">
    <label className="block text-xs text-slate-400">이미지 · {images.length}개
      <select aria-label="이미지 선택" className={`${control} mt-2 w-full`} value={current.id} onChange={(event) => setSelected(images.findIndex((image) => image.id === event.target.value))}>
        {images.map((image, position) => <option key={image.id} value={image.id}>{position + 1}. {names[image.category]} · {image.label}</option>)}
      </select>
    </label>
    <div className="flex min-h-52 items-center justify-center border border-white/10 bg-gradient-to-b from-slate-800/50 to-black/30 p-3">
      {failed === current.id ? <p role="alert" className="text-sm text-amber-200">원본 이미지 파일을 불러오지 못했습니다.</p> :
        <a href={current.url} target="_blank" rel="noreferrer" className="block w-full" aria-label={`${current.label} 원본 이미지 열기`}>
          <img key={current.id} src={current.url} alt={`${names[current.category]} · ${current.label}`} loading="lazy" className="mx-auto max-h-[520px] max-w-full object-contain" onError={() => setFailed(current.id)} />
        </a>}
    </div>
    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
      <button type="button" className={control} disabled={selected <= 0} onClick={() => setSelected((value) => value - 1)}>이전 이미지</button>
      <span>{selected + 1} / {images.length}</span>
      <button type="button" className={control} disabled={selected >= images.length - 1} onClick={() => setSelected((value) => value + 1)}>다음 이미지</button>
    </div>
  </div>;
}

function VoicePlayer({ voices }: { voices: Voice[] }) {
  const languages = [...new Map(voices.map((voice) => [voice.languageId, voice.language])).entries()];
  const [language, setLanguage] = useState(languages.some(([id]) => id === "voice_kr") ? "voice_kr" : languages[0]?.[0]);
  const [selected, setSelected] = useState("");
  const [failed, setFailed] = useState("");
  const available = voices.filter((voice) => voice.languageId === language);
  const voice = available.find((voice) => voice.cueId === selected) ?? available[0];
  if (!voice) return <p className="text-sm text-slate-400">연결할 수 있는 음성이 없습니다.</p>;
  return <div className="min-w-0 space-y-4">
    <h4 className="font-semibold text-amber-100">목소리 듣기</h4>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400">음성 언어<select className={`${control} mt-2 w-full`} aria-label="음성 언어" value={language} onChange={(event) => setLanguage(event.target.value)}>{languages.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="text-xs text-slate-400">대사<select className={`${control} mt-2 w-full`} aria-label="음성 대사" value={voice.cueId} onChange={(event) => setSelected(event.target.value)}>{available.map((entry) => <option key={entry.id} value={entry.cueId}>{entry.label}</option>)}</select></label>
    </div>
    <p className="whitespace-pre-wrap text-sm leading-7 text-slate-200">{voice.text}</p>
    <audio key={voice.id} aria-label={`${voice.language} ${voice.label}`} controls preload="none" src={voice.url} className="w-full" onError={() => setFailed(voice.id)} />
    {failed === voice.id && <p role="alert" className="text-sm text-amber-200">음성 파일을 불러오지 못했습니다.</p>}
    <p className="text-xs leading-5 text-slate-500">표시 대사는 한국어 수집본입니다. 음성 언어에 따라 표현이 다를 수 있습니다.</p>
  </div>;
}

export function MediaPanel({ operatorId, documentId }: { operatorId?: string; documentId?: string }) {
  const query = operatorId ? `operator=${encodeURIComponent(operatorId)}` : `document=${encodeURIComponent(documentId ?? "")}`;
  const [result, setResult] = useState<{ query: string; data?: MediaData; error?: string }>();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/archive/media?${query}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as MediaData & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "미디어를 불러오지 못했습니다.");
      if (!controller.signal.aborted) setResult({ query, data });
    }).catch((error: Error) => { if (!controller.signal.aborted) setResult({ query, error: error.message }); });
    return () => controller.abort();
  }, [query]);
  const current = result?.query === query ? result : null;
  const cueId = documentId?.replace(/^(ko_KR|en_US|ja_JP|zh_CN):/, "");
  const voices = cueId?.startsWith("voice:") ? current?.data?.voices?.filter((voice) => voice.cueId === cueId) : current?.data?.voices;
  return <section aria-label="연결된 이미지와 음성" className="min-w-0 space-y-4">
    <h3 className="font-semibold text-cyan-100">이미지{operatorId || current?.data?.voices ? " · 음성" : ""}</h3>
    {!current && <p role="status" className="text-sm text-slate-400">미디어를 불러오는 중…</p>}
    {current?.error && <p role="status" className="text-sm text-slate-400">{current.error}</p>}
    {current?.data && <div key={query} className={`grid min-w-0 gap-6 ${voices?.length ? "xl:grid-cols-2" : ""}`}>
      <ImageViewer images={current.data.images} />
      {voices && <VoicePlayer voices={voices} />}
    </div>}
  </section>;
}
