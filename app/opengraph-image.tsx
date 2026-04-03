import { ImageResponse } from "next/og";

export const alt = "모션 과일 슈터 — 웹캠 손 제스처 슈팅 게임";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0b1120 0%, #1e1b4b 40%, #0f172a 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* decorative blobs */}
      <div
        style={{
          position: "absolute",
          top: -80,
          right: -60,
          width: 420,
          height: 420,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.35), transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -100,
          left: -40,
          width: 360,
          height: 360,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,211,238,0.22), transparent 70%)",
        }}
      />

      {/* fruit emojis row */}
      <div style={{ display: "flex", gap: 28, marginBottom: 28, fontSize: 72 }}>
        <span>🍎</span>
        <span>🍋</span>
        <span>🍇</span>
        <span>🍉</span>
        <span>🍒</span>
      </div>

      {/* title */}
      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          background: "linear-gradient(90deg, #c4b5fd, #ffffff, #67e8f9)",
          backgroundClip: "text",
          color: "transparent",
          lineHeight: 1.2,
          letterSpacing: -2,
        }}
      >
        모션 과일 슈터
      </div>

      {/* subtitle */}
      <div
        style={{
          fontSize: 28,
          color: "#a1a1aa",
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span>👋 웹캠</span>
        <span style={{ color: "#4b5563" }}>·</span>
        <span>🎯 손 제스처</span>
        <span style={{ color: "#4b5563" }}>·</span>
        <span>🔫 슈팅</span>
      </div>

      {/* tagline */}
      <div
        style={{
          fontSize: 20,
          color: "#71717a",
          marginTop: 28,
        }}
      >
        설치 없이 브라우저에서 바로 플레이
      </div>
    </div>,
    { ...size },
  );
}
