import Link from "next/link";
import MediaExplorer from "./media-explorer";

export default function MediaPage() {
  return <main className="archive-grid min-h-screen pb-16 text-slate-100">
    <header className="border-b border-white/10 bg-[#081116]/90">
      <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-4 px-5 py-6">
        <div><p className="font-mono text-xs tracking-widest text-cyan-200">TERRA ARCHIVE / MEDIA</p><h1 className="mt-2 text-2xl font-semibold">이미지와 목소리</h1></div>
        <nav className="flex flex-wrap gap-3"><Link href="/" className="archive-chip text-sm">수집 현황</Link><Link href="/search" className="archive-chip text-sm">본문 검색</Link></nav>
      </div>
    </header>
    <div className="mx-auto max-w-[1280px] px-5 pt-7"><MediaExplorer /></div>
  </main>;
}
