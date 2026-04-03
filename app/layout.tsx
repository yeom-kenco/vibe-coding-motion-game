import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://motion-fruit-shooter.vercel.app",
  ),
  title: "모션 과일 슈터 | 웹캠 손 제스처 슈팅 게임",
  description:
    "웹캠과 손 제스처만으로 과일을 쏘는 브라우저 미니 게임. MediaPipe 손 인식 기반, 설치 없이 바로 플레이.",
  keywords: [
    "모션 게임",
    "웹캠 게임",
    "손 제스처",
    "과일 슈터",
    "MediaPipe",
    "브라우저 게임",
    "hand tracking game",
  ],
  authors: [{ name: "Kenco" }],
  openGraph: {
    title: "모션 과일 슈터",
    description: "웹캠 + 손 제스처로 과일을 쏴보세요! 설치 없이 브라우저에서 바로 플레이.",
    type: "website",
    locale: "ko_KR",
    siteName: "모션 과일 슈터",
  },
  twitter: {
    card: "summary_large_image",
    title: "모션 과일 슈터",
    description: "웹캠 + 손 제스처로 과일을 쏴보세요! 설치 없이 브라우저에서 바로 플레이.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
