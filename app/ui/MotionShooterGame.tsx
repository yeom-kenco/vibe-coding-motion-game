"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

type Vec2 = { x: number; y: number };

type FruitKind = "apple" | "lemon" | "grape" | "watermelon" | "cherry";

type Fruit = {
  id: string;
  kind: FruitKind;
  pos: Vec2;
  vel: Vec2;
  size: number;
  rotation: number;
  spin: number;
};

type Particle = {
  id: string;
  pos: Vec2;
  vel: Vec2;
  lifeMs: number;
  bornAt: number;
  size: number;
  color: string;
};

type Crosshair = {
  pos: Vec2;
  aimPoseActive: boolean;
  shootGestureActive: boolean;
  lastShotAt: number;
  confidence: number; // 0..1
};

type HandLm = { x: number; y: number };

/** package.json과 맞추면 wasm/model 불일치로 추론이 죽는 경우를 줄일 수 있음 */
const MEDIAPIPE_TASKS_VERSION = "0.10.34";

const GAME_MS = 30_000;
/** 한 제스처당 한 발: 자세를 풀었다가 다시 해야 연사 가능 */
const SHOT_COOLDOWN_MS = 380;
const HIT_RADIUS_PX = 130;
const MAX_FRUITS_ON_SCREEN = 4;
const HUD_FRAME_INTERVAL = 18;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function dist(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function pick<T>(arr: readonly T[]) {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function lmDist(a: HandLm, b: HandLm) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 손목 기준으로 손가락이 펴졌는지(조준용 검지 등) */
function fingerExtendedFromWrist(
  lm: HandLm[],
  tipIdx: number,
  pipIdx: number,
  wristIdx = 0,
  ratio = 1.12,
) {
  return lmDist(lm[tipIdx]!, lm[wristIdx]!) > lmDist(lm[pipIdx]!, lm[wristIdx]!) * ratio;
}

/** 조준: 오직 검지(손목 기준)만 사용 */
function isAimPose(lm: HandLm[]) {
  if (lm.length < 21) return false;
  return fingerExtendedFromWrist(lm, 8, 6, 0, 1.06);
}

/** 발사: "검지를 위로 확 들어올리는" 모션(짧은 시간 내 y가 크게 감소) */
function isIndexFlickUpShot(
  prev: { y: number; t: number } | null,
  cur: { y: number; t: number },
) {
  if (!prev) return false;
  const dtMs = Math.max(1, cur.t - prev.t);
  // 너무 짧거나 너무 길면 노이즈/일반 이동
  if (dtMs < 45 || dtMs > 320) return false;
  const dy = prev.y - cur.y; // 위로 가면 +dy (y는 위쪽이 작음)
  const speed = dy / dtMs; // normalized per ms
  // 충분히 "확" 올라가는 모션만
  return dy > 0.032 && speed > 0.00018;
}

function drawPixelSprite(
  ctx: CanvasRenderingContext2D,
  sprite: string[],
  palette: Record<string, string>,
  x: number,
  y: number,
  pixel: number,
) {
  for (let j = 0; j < sprite.length; j++) {
    const row = sprite[j]!;
    for (let i = 0; i < row.length; i++) {
      const key = row[i]!;
      if (key === ".") continue;
      const color = palette[key];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + i * pixel, y + j * pixel, pixel, pixel);
    }
  }
}

const FRUIT_SPRITES: Record<
  FruitKind,
  {
    sprite: string[];
    palette: Record<string, string>;
  }
> = {
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

export function MotionShooterGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);

  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef<number>(performance.now());
  const lastSpawnAtRef = useRef<number>(performance.now());

  const fruitsRef = useRef<Fruit[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastHandOkRef = useRef(false);
  const hudFrameRef = useRef(0);
  const gestureRef = useRef({
    prevIndex: null as { y: number; t: number } | null,
    lastAimAt: 0,
  });
  const crosshairRef = useRef<Crosshair>({
    pos: { x: 0.5, y: 0.6 },
    aimPoseActive: false,
    shootGestureActive: false,
    lastShotAt: 0,
    confidence: 0,
  });

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "requesting_camera" | "running" | "ended" | "error"
  >("idle");
  const [score, setScore] = useState(0);
  const [timeLeftMs, setTimeLeftMs] = useState(GAME_MS);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [handTracked, setHandTracked] = useState(false);

  const fruitKinds = useMemo(
    () => ["apple", "lemon", "grape", "watermelon", "cherry"] as const,
    [],
  );

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    function onResize() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      handLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
    };
  }, []);

  function applyHandResult(result: HandLandmarkerResult) {
    const landmarks = result.landmarks?.[0] as HandLm[] | undefined;
    const crosshair = crosshairRef.current;

    if (!landmarks || landmarks.length < 21) {
      lastHandOkRef.current = false;
      crosshair.confidence = Math.max(0, crosshair.confidence - 0.1);
      crosshair.aimPoseActive = false;
      crosshair.shootGestureActive = false;
      return;
    }

    lastHandOkRef.current = true;

    const indexTip = landmarks[8]!;
    const aimPose = isAimPose(landmarks);
    if (aimPose) gestureRef.current.lastAimAt = performance.now();

    crosshair.aimPoseActive = aimPose;

    if (aimPose) {
      const x = 1 - clamp01(indexTip.x);
      const y = clamp01(indexTip.y);
      crosshair.pos = { x, y };
      crosshair.confidence = Math.min(1, crosshair.confidence + 0.22);
    } else {
      crosshair.confidence = Math.max(0, crosshair.confidence - 0.12);
    }

    // 발사는 "모션 이벤트"로만: 조준 중에 검지를 위로 확 올리는 순간만 1프레임 true
    const now = performance.now();
    const prev = gestureRef.current.prevIndex;
    const cur = { y: indexTip.y, t: now };
    // 조준이 순간 끊겨도(프레임 드랍/손 가림) 220ms 정도는 발사 모션 판정을 유지
    const aimGrace = now - gestureRef.current.lastAimAt < 220;
    const flickUp = aimGrace && isIndexFlickUpShot(prev, cur);
    crosshair.shootGestureActive = flickUp;
    // prevIndex를 매 프레임 갱신하면 dtMs가 ~16ms(60fps)라 항상 < 45ms 조건에 걸림
    // 60ms 이상 간격으로만 갱신해서 의미 있는 이동량 비교가 가능하게 함
    if (!prev || now - prev.t >= 60) {
      gestureRef.current.prevIndex = cur;
    }
  }

  async function setupHandLandmarker() {
    const wasmPath = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VERSION}/wasm`;
    const vision = await FilesetResolver.forVisionTasks(wasmPath);
    const modelAssetPath =
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    const common = {
      numHands: 1,
      runningMode: "VIDEO" as const,
      minHandDetectionConfidence: 0.45,
      minHandPresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    };

    try {
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        ...common,
        baseOptions: { modelAssetPath, delegate: "GPU" },
      });
    } catch {
      handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
        ...common,
        baseOptions: { modelAssetPath, delegate: "CPU" },
      });
    }
  }

  function spawnFruit(w: number) {
    const kind = pick(fruitKinds);
    // "진짜 크게" 보이려면 캔버스 폭에 비례해 스케일을 잡아야 함.
    // size는 픽셀 스프라이트 스케일링에 쓰이고, 실제 렌더 폭/높이로 스폰 경계를 계산한다.
    const minSize = Math.max(150, w * 0.24);
    const maxSize = Math.max(minSize + 1, Math.max(210, w * 0.34));
    const size = rand(minSize, maxSize);

    const { sprite } = FRUIT_SPRITES[kind];
    const pixel = Math.max(2, Math.floor(size / 12));
    const renderW = sprite[0]!.length * pixel;
    const renderH = sprite.length * pixel;
    const halfW = renderW / 2;
    const halfH = renderH / 2;

    // 렌더 폭이 화면보다 커도 중앙 스폰해서 "거대"하게 보이게
    const x =
      renderW >= w ? w / 2 : rand(halfW, Math.max(halfW + 1, w - halfW));
    const y = -halfH - rand(0, 120);
    const vy = rand(28, 46);
    const vx = rand(-5, 5);
    fruitsRef.current.push({
      id: uid("fruit"),
      kind,
      pos: { x, y },
      vel: { x: vx, y: vy },
      size,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-2.4, 2.4),
    });
  }

  function explode(at: Vec2, baseColor: string) {
    const now = performance.now();
    const n = Math.floor(rand(18, 28));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(120, 520);
      const tint = i % 3 === 0 ? "#ffffff" : baseColor;
      particlesRef.current.push({
        id: uid("p"),
        pos: { x: at.x, y: at.y },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        lifeMs: rand(420, 860),
        bornAt: now,
        size: rand(2, 6),
        color: tint,
      });
    }
  }

  function tryShoot(canvasW: number, canvasH: number) {
    const now = performance.now();
    const crosshair = crosshairRef.current;
    if (!crosshair.shootGestureActive) return;
    if (crosshair.confidence < 0.2) return;
    if (now - crosshair.lastShotAt < SHOT_COOLDOWN_MS) return;
    crosshair.lastShotAt = now;
    crosshair.shootGestureActive = false;

    const aim = { x: crosshair.pos.x * canvasW, y: crosshair.pos.y * canvasH };

    let hits = 0;
    const remaining: Fruit[] = [];
    for (const f of fruitsRef.current) {
      if (dist(f.pos, aim) <= HIT_RADIUS_PX + f.size * 0.42) {
        hits++;
        const { palette } = FRUIT_SPRITES[f.kind];
        const baseColor = palette["r"] || palette["y"] || palette["p"] || palette["g"] || "#60a5fa";
        explode(f.pos, baseColor);
      } else {
        remaining.push(f);
      }
    }
    if (hits > 0) setScore((s) => s + hits * 10);
    fruitsRef.current = remaining;

    // Extra muzzle burst at aim point
    explode(aim, "#60a5fa");
  }

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.clearRect(0, 0, w, h);

    // Background video (subtle)
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      // mirror video to match aiming
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      const dx = (w - dw) / 2;
      const dy = (h - dh) / 2;
      ctx.drawImage(video, dx, dy, dw, dh);
      ctx.restore();
    } else {
      // fallback gradient
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#0b1020");
      g.addColorStop(1, "#05060a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Vignette
    ctx.save();
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.45, Math.max(w, h));
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.7)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Fruits
    for (const f of fruitsRef.current) {
      const { sprite, palette } = FRUIT_SPRITES[f.kind];
      const pixel = Math.max(2, Math.floor(f.size / 12));
      const spriteW = sprite[0]!.length * pixel;
      const spriteH = sprite.length * pixel;

      ctx.save();
      ctx.translate(f.pos.x, f.pos.y);
      ctx.rotate(f.rotation);
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 12;
      drawPixelSprite(ctx, sprite, palette, -spriteW / 2, -spriteH / 2, pixel);
      ctx.restore();
    }

    // Particles
    const now = performance.now();
    for (const p of particlesRef.current) {
      const t = clamp01((now - p.bornAt) / p.lifeMs);
      const a = 1 - t;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Crosshair
    const crosshair = crosshairRef.current;
    if (crosshair.confidence > 0.12) {
      const x = crosshair.pos.x * w;
      const y = crosshair.pos.y * h;
      const r = crosshair.shootGestureActive ? 14 : crosshair.aimPoseActive ? 18 : 22;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = 2;
      ctx.strokeStyle = crosshair.shootGestureActive
        ? "#fbbf24"
        : crosshair.aimPoseActive
          ? "#60a5fa"
          : "rgba(148,163,184,0.7)";
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r - 6, y);
      ctx.lineTo(x - r + 2, y);
      ctx.moveTo(x + r - 2, y);
      ctx.lineTo(x + r + 6, y);
      ctx.moveTo(x, y - r - 6);
      ctx.lineTo(x, y - r + 2);
      ctx.moveTo(x, y + r - 2);
      ctx.lineTo(x, y + r + 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function step() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    const now = performance.now();
    const dt = Math.min(0.05, (now - lastFrameAtRef.current) / 1000);
    lastFrameAtRef.current = now;

    const video = videoRef.current;
    const landmarker = handLandmarkerRef.current;
    if (runningRef.current && landmarker && video && video.readyState >= 2) {
      applyHandResult(landmarker.detectForVideo(video, now));
    }

    hudFrameRef.current += 1;
    if (hudFrameRef.current % HUD_FRAME_INTERVAL === 0) {
      setHandTracked(lastHandOkRef.current);
    }

    // Timer
    setTimeLeftMs((ms) => {
      if (!runningRef.current) return ms;
      const next = Math.max(0, ms - dt * 1000);
      if (next <= 0 && status === "running") {
        runningRef.current = false;
        setStatus("ended");
      }
      return next;
    });

    // Spawn fruits
    if (
      runningRef.current &&
      fruitsRef.current.length < MAX_FRUITS_ON_SCREEN &&
      now - lastSpawnAtRef.current > rand(1200, 1900)
    ) {
      lastSpawnAtRef.current = now;
      spawnFruit(w);
    }

    // Update fruits
    const gravity = 38;
    const nextFruits: Fruit[] = [];
    for (const f of fruitsRef.current) {
      const pos = { x: f.pos.x + f.vel.x * dt, y: f.pos.y + f.vel.y * dt };
      const vel = { x: f.vel.x * 0.999, y: f.vel.y + gravity * dt };
      const rotation = f.rotation + f.spin * dt;

      // Cull below screen
      if (pos.y < h + f.size + 80) {
        nextFruits.push({ ...f, pos, vel, rotation });
      }
    }
    fruitsRef.current = nextFruits;

    if (runningRef.current) tryShoot(w, h);

    // Update particles
    particlesRef.current = particlesRef.current
      .map((p) => ({
        ...p,
        pos: { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt },
        vel: { x: p.vel.x * 0.98, y: p.vel.y * 0.98 + 240 * dt },
      }))
      .filter((p) => now - p.bornAt < p.lifeMs);

    draw(ctx, w, h);

    if (runningRef.current) {
      rafRef.current = requestAnimationFrame(step);
    }
  }

  async function start() {
    if (!ready) return;
    if (status === "requesting_camera" || status === "running") return;

    setErrorMsg(null);
    setHandTracked(false);
    lastHandOkRef.current = false;
    setScore(0);
    setTimeLeftMs(GAME_MS);
    fruitsRef.current = [];
    particlesRef.current = [];
    gestureRef.current = { prevIndex: null, lastAimAt: 0 };
    crosshairRef.current = {
      pos: { x: 0.5, y: 0.6 },
      aimPoseActive: false,
      shootGestureActive: false,
      lastShotAt: 0,
      confidence: 0,
    };

    setStatus("requesting_camera");

    try {
      const video = videoRef.current;
      if (!video) throw new Error("비디오 초기화에 실패했습니다.");

      await setupHandLandmarker();
      if (!handLandmarkerRef.current) throw new Error("손 인식 초기화에 실패했습니다.");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();

      runningRef.current = true;
      lastFrameAtRef.current = performance.now();
      lastSpawnAtRef.current = performance.now();
      setStatus("running");

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(step);
    } catch (e) {
      runningRef.current = false;
      setStatus("error");
      const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
      setErrorMsg(msg);
    }
  }

  function reset() {
    runningRef.current = false;
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      for (const t of video.srcObject.getTracks()) t.stop();
      video.srcObject = null;
    }
    setStatus("idle");
    setHandTracked(false);
    lastHandOkRef.current = false;
    setTimeLeftMs(GAME_MS);
    setScore(0);
    fruitsRef.current = [];
    particlesRef.current = [];
    gestureRef.current = { prevIndex: null, lastAimAt: 0 };
    crosshairRef.current = {
      pos: { x: 0.5, y: 0.6 },
      aimPoseActive: false,
      shootGestureActive: false,
      lastShotAt: 0,
      confidence: 0,
    };
  }

  const timeLeftSec = Math.ceil(timeLeftMs / 1000);

  return (
    <div className="relative h-dvh w-full overflow-hidden font-sans antialiased text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(139,92,246,0.35),transparent_55%),radial-gradient(ellipse_80%_60%_at_100%_50%,rgba(34,211,238,0.14),transparent_50%),radial-gradient(ellipse_70%_50%_at_0%_80%,rgba(244,114,182,0.12),transparent_45%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(2,6,23,0.2),rgba(2,6,23,0.92))]"
      />

      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      <video
        ref={videoRef}
        playsInline
        muted
        className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 p-3 sm:p-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-950/55 px-4 py-2.5 shadow-lg shadow-violet-500/10 backdrop-blur-xl">
              <span className="text-lg font-semibold tracking-tight bg-linear-to-r from-violet-200 via-white to-cyan-200 bg-clip-text text-transparent">
                모션 과일 슈터
              </span>
              <span className="hidden text-xs text-zinc-400 sm:inline">웹캠 · 손 제스처</span>
            </div>

            {status === "running" ? (
              <div
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md ${
                  handTracked
                    ? "border-emerald-400/30 bg-emerald-950/40 text-emerald-200"
                    : "border-amber-400/25 bg-amber-950/35 text-amber-100"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${handTracked ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "animate-pulse bg-amber-400"}`}
                />
                {handTracked ? "손 인식됨" : "손을 화면 안에 보여주세요"}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-2 text-sm backdrop-blur-xl">
              <span className="text-zinc-400">점수</span>{" "}
              <span className="font-semibold tabular-nums text-white">{score}</span>
            </div>
            <div className="rounded-2xl border border-cyan-500/20 bg-linear-to-br from-cyan-950/40 to-zinc-950/50 px-4 py-2 text-sm backdrop-blur-xl">
              <span className="text-cyan-200/80">남은 시간</span>{" "}
              <span className="font-semibold tabular-nums text-white">{timeLeftSec}s</span>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 p-3 sm:p-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl rounded-2xl border border-white/10 bg-zinc-950/50 p-4 text-sm leading-relaxed text-zinc-300 shadow-lg backdrop-blur-xl">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">조작</div>
            <p>
              <span className="font-medium text-cyan-200">조준:</span> 검지를 펴서 가리키기{" "}
              <span className="text-zinc-500">(손바닥 완전 펼침은 제외)</span>
            </p>
            <p className="mt-1">
              <span className="font-medium text-amber-200">발사:</span> 손총 자세로 잠깐 잡기 — 검지는 위로, 나머지는 접기,
              손을 화면 위쪽으로, 엄지는 검지에서 떼기. 한 번 쏘면 자세를 풀었다가 다시 잡아야 합니다.
            </p>
            {errorMsg ? (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-red-200">{errorMsg}</p>
            ) : null}
          </div>

          <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
            {status === "running" ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-2xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white backdrop-blur-md transition hover:bg-white/10 active:bg-white/15"
              >
                그만하기
              </button>
            ) : (
              <button
                type="button"
                onClick={start}
                className="rounded-2xl bg-linear-to-r from-violet-500 via-fuchsia-500 to-cyan-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!ready || status === "requesting_camera"}
              >
                {status === "requesting_camera"
                  ? "카메라 준비 중…"
                  : status === "ended"
                    ? "다시 플레이"
                    : "게임 시작"}
              </button>
            )}
          </div>
        </div>
      </div>

      {status === "ended" ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-zinc-950/75 p-8 text-center shadow-2xl shadow-violet-500/20 backdrop-blur-2xl">
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">라운드 종료</div>
            <div className="mt-2 text-3xl font-bold tracking-tight text-white">수고했어요</div>
            <div className="mt-6 text-sm text-zinc-400">최종 점수</div>
            <div className="mt-1 bg-linear-to-r from-violet-200 to-cyan-200 bg-clip-text text-5xl font-bold tabular-nums text-transparent">
              {score}
            </div>
            <p className="mt-6 text-sm text-zinc-500">
              아래 <span className="text-zinc-300">다시 플레이</span>로 이어서 할 수 있어요.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

