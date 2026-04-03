import { ImageResponse } from "next/og";

export const alt = "모션 과일 슈터 — 웹캠 손 제스처 슈팅 게임";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// ─── Pixel sprite data (game과 동일) ─────────────────────

type SpriteData = { sprite: string[]; palette: Record<string, string> };

const SPRITES: Record<string, SpriteData> = {
  apple: {
    sprite: [
      "....gg....",
      "...ggg....",
      "..rrr.....",
      ".rrrrr....",
      ".rrrrr....",
      ".rrrrr....",
      "..rrr.....",
      "...r......",
    ],
    palette: { r: "#ff3b3b", g: "#4ade80" },
  },
  lemon: {
    sprite: [
      "....y.....",
      "...yyy....",
      "..yyyyy...",
      ".yyyyyyy..",
      "..yyyyy...",
      "...yyy....",
      "....y.....",
      "..........",
    ],
    palette: { y: "#fde047" },
  },
  grape: {
    sprite: [
      "....p.....",
      "...ppp....",
      "..ppppp...",
      "...ppp....",
      "..ppppp...",
      "...ppp....",
      "....g.....",
      "..........",
    ],
    palette: { p: "#a855f7", g: "#22c55e" },
  },
  watermelon: {
    sprite: [
      "..........",
      "..ggggg...",
      ".gpppppg..",
      ".gpppppg..",
      "..ggggg...",
      "..........",
      "..........",
      "..........",
    ],
    palette: { g: "#22c55e", p: "#fb7185" },
  },
  cherry: {
    sprite: [
      "....g.....",
      "...g......",
      "..g..g....",
      ".r...r....",
      ".rr.rr....",
      "..rrr.....",
      "...r......",
      "..........",
    ],
    palette: { r: "#ef4444", g: "#16a34a" },
  },
};

// ─── Pixel sprite → JSX divs ────────────────────────────

function PixelSprite({
  data,
  px,
  x,
  y,
  rotate,
}: {
  data: SpriteData;
  px: number;
  x: number;
  y: number;
  rotate?: number;
}) {
  const cols = data.sprite[0]!.length;
  const rows = data.sprite.length;
  const w = cols * px;
  const h = rows * px;

  const pixels: React.ReactNode[] = [];
  for (let row = 0; row < rows; row++) {
    const line = data.sprite[row]!;
    for (let col = 0; col < cols; col++) {
      const key = line[col]!;
      if (key === ".") continue;
      const color = data.palette[key];
      if (!color) continue;
      pixels.push(
        <div
          key={`${row}-${col}`}
          style={{
            position: "absolute",
            left: col * px,
            top: row * px,
            width: px,
            height: px,
            background: color,
          }}
        />,
      );
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        left: x - w / 2,
        top: y - h / 2,
        width: w,
        height: h,
        display: "flex",
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      {pixels}
    </div>
  );
}

// ─── Scattered fruit positions ──────────────────────────

const FRUIT_PLACEMENTS = [
  { kind: "apple", x: 140, y: 120, px: 9, rotate: -15 },
  { kind: "lemon", x: 1050, y: 90, px: 8, rotate: 20 },
  { kind: "grape", x: 250, y: 430, px: 10, rotate: 10 },
  { kind: "watermelon", x: 960, y: 480, px: 11, rotate: -25 },
  { kind: "cherry", x: 80, y: 290, px: 8, rotate: 5 },
  { kind: "apple", x: 1120, y: 310, px: 7, rotate: 30 },
  { kind: "lemon", x: 480, y: 60, px: 7, rotate: -10 },
  { kind: "grape", x: 720, y: 540, px: 8, rotate: 15 },
];

// ─── Stars ──────────────────────────────────────────────

const STARS = Array.from({ length: 40 }, (_, i) => ({
  x: ((i * 137 + 43) % 1200),
  y: ((i * 89 + 17) % 630),
  size: 1.5 + (i % 3),
  opacity: 0.2 + (i % 5) * 0.12,
}));

// ─── Main ───────────────────────────────────────────────

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
        background: "linear-gradient(150deg, #0b1120 0%, #1e1b4b 45%, #0f172a 100%)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative blobs */}
      <div
        style={{
          position: "absolute",
          top: -100,
          right: -80,
          width: 500,
          height: 500,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.3), transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -120,
          left: -60,
          width: 400,
          height: 400,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(34,211,238,0.2), transparent 70%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 200,
          left: 400,
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(244,114,182,0.12), transparent 70%)",
        }}
      />

      {/* Stars */}
      {STARS.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            background: "#ffffff",
            opacity: s.opacity,
          }}
        />
      ))}

      {/* Pixel fruit sprites */}
      {FRUIT_PLACEMENTS.map((p, i) => (
        <PixelSprite
          key={i}
          data={SPRITES[p.kind]!}
          px={p.px}
          x={p.x}
          y={p.y}
          rotate={p.rotate}
        />
      ))}

      {/* Crosshair */}
      <div
        style={{
          position: "absolute",
          left: 580,
          top: 280,
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            border: "2px solid rgba(96,165,250,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#60a5fa",
            }}
          />
        </div>
      </div>

    </div>,
    { ...size },
  );
}
