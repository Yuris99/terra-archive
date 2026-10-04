import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Terra Archive — 기록 탐색기",
  description: "명일방주 한·중·일·영 원문을 출처와 함께 검색하는 로컬 연구 도구입니다.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
