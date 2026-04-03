"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

// ─── Types ───────────────────────────────────────────────

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
  spawnedAt: number;
};

type Particle = {
  id: string;
  pos: Vec2;
  vel: Vec2;
  lifeMs: number;
  bornAt: number;
  size: number;
  color: string;
  glow: boolean;
};

type ScorePopup = {
  id: string;
  pos: Vec2;
  value: number;
  combo: number;
  bornAt: number;
};

type Star = {
  x: number;
  y: number;
  size: number;
  speed: number;
  alpha: number;
  twinkleOffset: number;
};

type Crosshair = {
  pos: Vec2;
  smoothPos: Vec2;
  aimPoseActive: boolean;
  shootGestureActive: boolean;
  lastShotAt: number;
  confidence: number;
  trail: Vec2[];
};

type Shake = {
  intensity: number;
  startAt: number;
  durationMs: number;
};

type MuzzleFlash = {
  pos: Vec2;
  startAt: number;
};

type HandLm = { x: number; y: number };

type GestureSnapshot = {
  indexTip: Vec2;
  wrist: Vec2;
  thumbToIndexMcp: number;
  t: number;
};

// ─── Constants ───────────────────────────────────────────

const MEDIAPIPE_TASKS_VERSION = "0.10.34";
const GAME_MS = 30_000;
const SHOT_COOLDOWN_MS = 320;
const HIT_RADIUS_PX = 140;
const MAX_FRUITS_ON_SCREEN = 5;
const HUD_FRAME_INTERVAL = 18;
const STAR_COUNT = 100;
const TRAIL_LEN = 10;
const GESTURE_HISTORY_MAX = 15;
const COMBO_WINDOW_MS = 2500;
const SHAKE_MS = 160;
const MUZZLE_MS = 100;
const POPUP_MS = 1400;
const URGENCY_THRESHOLD_S = 10;

// ─── Utilities ───────────────────────────────────────────

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
function dist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: readonly T[]) {
  return arr[Math.floor(Math.random() * arr.length)]!;
}
function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}`;
}
function lmDist(a: HandLm, b: HandLm) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

// ─── Sound System (Web Audio synthesis) ──────────────────

class GameAudio {
  private ctx: AudioContext | null = null;

  private ensure(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /** "피우" 사운드 */
  shoot() {
    const c = this.ensure();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1400, t);
    o.frequency.exponentialRampToValueAtTime(350, t + 0.09);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** 귀여운 "팝" 사운드 */
  hit() {
    const c = this.ensure();
    const t = c.currentTime;
    // tonal pop
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1100, t + 0.04);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.18);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.22);
    // noise burst
    const len = Math.floor(c.sampleRate * 0.04);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const ns = c.createBufferSource();
    ns.buffer = buf;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.12, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    ns.connect(ng).connect(c.destination);
    ns.start(t);
    ns.stop(t + 0.06);
  }

  /** 콤보 차임 (콤보 수에 따라 피치 상승) */
  combo(count: number) {
    const c = this.ensure();
    const t = c.currentTime;
    const freq = 660 + Math.min(count, 10) * 80;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + 0.08);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** 카운트다운 틱 */
  tick() {
    const c = this.ensure();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1000, t);
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.05);
  }

  /** 게임 시작 징글 */
  gameStart() {
    const c = this.ensure();
    const t = c.currentTime;
    [523, 659, 784, 1047].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t + i * 0.09);
      g.gain.setValueAtTime(0.18, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.14);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.14);
    });
  }

  /** 게임 종료 징글 */
  gameEnd() {
    const c = this.ensure();
    const t = c.currentTime;
    [784, 659, 523, 392].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t + i * 0.11);
      g.gain.setValueAtTime(0.18, t + i * 0.11);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.11 + 0.2);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.11);
      o.stop(t + i * 0.11 + 0.2);
    });
  }

  /** 미스 사운드 */
  miss() {
    const c = this.ensure();
    const t = c.currentTime;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.15);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + 0.18);
  }

  close() {
    this.ctx?.close();
    this.ctx = null;
  }
}

// ─── Hand gesture helpers ────────────────────────────────

function fingerExtendedFromWrist(
  lm: HandLm[],
  tipIdx: number,
  pipIdx: number,
  wristIdx = 0,
  ratio = 1.12,
) {
  return lmDist(lm[tipIdx]!, lm[wristIdx]!) > lmDist(lm[pipIdx]!, lm[wristIdx]!) * ratio;
}

function isAimPose(lm: HandLm[]) {
  if (lm.length < 21) return false;
  return fingerExtendedFromWrist(lm, 8, 6, 0, 1.04);
}

/** 히스토리 버퍼에서 일정 시간 전 프레임 찾기 */
function findOldSnapshot(
  history: GestureSnapshot[],
  now: number,
  minAge: number,
  maxAge: number,
): GestureSnapshot | null {
  for (let i = history.length - 2; i >= 0; i--) {
    const age = now - history[i]!.t;
    if (age >= minAge && age <= maxAge) return history[i]!;
    if (age > maxAge) return null;
  }
  return null;
}

/** 다중 방법 슈팅 감지 */
function detectShootGesture(
  history: GestureSnapshot[],
  lastAimAt: number,
): boolean {
  if (history.length < 3) return false;
  const recent = history[history.length - 1]!;
  const now = recent.t;

  // 조준 grace window
  if (now - lastAimAt > 280) return false;

  // 방법 1: 검지 플릭 업
  const oldFlick = findOldSnapshot(history, now, 50, 280);
  if (oldFlick) {
    const dy = oldFlick.indexTip.y - recent.indexTip.y; // 위로 → 양수
    const dtMs = now - oldFlick.t;
    if (dy > 0.028 && dy / dtMs > 0.00014) return true;
  }

  // 방법 2: 손목 리코일 (아래로 빠르게)
  const oldRecoil = findOldSnapshot(history, now, 50, 220);
  if (oldRecoil) {
    const dy = recent.wrist.y - oldRecoil.wrist.y; // 아래로 → 양수
    const dtMs = now - oldRecoil.t;
    if (dy > 0.032 && dy / dtMs > 0.00016) return true;
  }

  // 방법 3: 엄지 트리거 (엄지가 검지 MCP에 접근)
  const oldThumb = findOldSnapshot(history, now, 50, 250);
  if (oldThumb) {
    const delta = oldThumb.thumbToIndexMcp - recent.thumbToIndexMcp; // 좁아지면 양수
    const dtMs = now - oldThumb.t;
    if (delta > 0.022 && delta / dtMs > 0.0001 && recent.thumbToIndexMcp < 0.065) return true;
  }

  return false;
}

// ─── Pixel Sprites ───────────────────────────────────────

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

const FRUIT_SPRITES: Record<FruitKind, { sprite: string[]; palette: Record<string, string> }> = {
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

function fruitBaseColor(kind: FruitKind): string {
  const p = FRUIT_SPRITES[kind].palette;
  return p["r"] || p["y"] || p["p"] || p["g"] || "#60a5fa";
}

// ─── Star field generator ────────────────────────────────

function createStars(count: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random(),
    y: Math.random(),
    size: rand(0.5, 2.2),
    speed: rand(0.002, 0.008),
    alpha: rand(0.2, 0.8),
    twinkleOffset: rand(0, Math.PI * 2),
  }));
}

// ─── Component ───────────────────────────────────────────

export function MotionShooterGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const audioRef = useRef<GameAudio | null>(null);

  const runningRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const lastSpawnAtRef = useRef(0);
  const gameStartAtRef = useRef(0);

  const fruitsRef = useRef<Fruit[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const popupsRef = useRef<ScorePopup[]>([]);
  const starsRef = useRef<Star[]>(createStars(STAR_COUNT));
  const shakeRef = useRef<Shake | null>(null);
  const muzzleRef = useRef<MuzzleFlash | null>(null);

  const lastHandOkRef = useRef(false);
  const hudFrameRef = useRef(0);

  // Gesture
  const gestureHistoryRef = useRef<GestureSnapshot[]>([]);
  const lastAimAtRef = useRef(0);
  const crosshairRef = useRef<Crosshair>({
    pos: { x: 0.5, y: 0.6 },
    smoothPos: { x: 0.5, y: 0.6 },
    aimPoseActive: false,
    shootGestureActive: false,
    lastShotAt: 0,
    confidence: 0,
    trail: [],
  });

  // Combo
  const comboRef = useRef({ count: 0, lastHitAt: 0 });

  // Countdown tick tracking
  const lastTickSecRef = useRef(-1);

  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "requesting_camera" | "running" | "ended" | "error"
  >("idle");
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
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
      audioRef.current?.close();
      audioRef.current = null;
    };
  }, []);

  // ─── Hand processing ────────────────────────────────

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
    const now = performance.now();
    const indexTip = landmarks[8]!;
    const wrist = landmarks[0]!;
    const thumbTip = landmarks[4]!;
    const indexMcp = landmarks[5]!;

    // 히스토리에 추가
    const history = gestureHistoryRef.current;
    history.push({
      indexTip: { x: indexTip.x, y: indexTip.y },
      wrist: { x: wrist.x, y: wrist.y },
      thumbToIndexMcp: lmDist(thumbTip, indexMcp),
      t: now,
    });
    // 오래된 항목 제거
    while (history.length > GESTURE_HISTORY_MAX) history.shift();

    const aimPose = isAimPose(landmarks);
    if (aimPose) lastAimAtRef.current = now;
    crosshair.aimPoseActive = aimPose;

    if (aimPose) {
      const x = 1 - clamp01(indexTip.x);
      const y = clamp01(indexTip.y);
      crosshair.pos = { x, y };
      crosshair.confidence = Math.min(1, crosshair.confidence + 0.22);
    } else {
      crosshair.confidence = Math.max(0, crosshair.confidence - 0.12);
    }

    // 슈팅 감지 (히스토리 기반 다중 방법)
    crosshair.shootGestureActive = detectShootGesture(
      history,
      lastAimAtRef.current,
    );
  }

  // ─── MediaPipe setup ─────────────────────────────────

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

  // ─── Game logic ──────────────────────────────────────

  function spawnFruit(w: number) {
    const kind = pick(fruitKinds);
    const minSize = Math.max(150, w * 0.24);
    const maxSize = Math.max(minSize + 1, Math.max(210, w * 0.34));
    const size = rand(minSize, maxSize);

    const { sprite } = FRUIT_SPRITES[kind];
    const pixel = Math.max(2, Math.floor(size / 12));
    const renderW = sprite[0]!.length * pixel;
    const renderH = sprite.length * pixel;
    const halfW = renderW / 2;
    const halfH = renderH / 2;

    const x = renderW >= w ? w / 2 : rand(halfW, Math.max(halfW + 1, w - halfW));
    const y = -halfH - rand(0, 120);
    const vy = rand(30, 50);
    const vx = rand(-8, 8);
    fruitsRef.current.push({
      id: uid("f"),
      kind,
      pos: { x, y },
      vel: { x: vx, y: vy },
      size,
      rotation: rand(0, Math.PI * 2),
      spin: rand(-2.8, 2.8),
      spawnedAt: performance.now(),
    });
  }

  function explode(at: Vec2, baseColor: string, big: boolean) {
    const now = performance.now();
    const n = big ? Math.floor(rand(30, 45)) : Math.floor(rand(10, 18));
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = big ? rand(160, 640) : rand(80, 320);
      const colors = ["#ffffff", baseColor, baseColor, baseColor, "#fbbf24"];
      particlesRef.current.push({
        id: uid("p"),
        pos: { x: at.x, y: at.y },
        vel: { x: Math.cos(a) * sp, y: Math.sin(a) * sp },
        lifeMs: rand(400, big ? 1100 : 600),
        bornAt: now,
        size: rand(big ? 2 : 1.5, big ? 7 : 4),
        color: pick(colors),
        glow: i % 4 === 0,
      });
    }
  }

  function addScorePopup(pos: Vec2, value: number, comboCount: number) {
    popupsRef.current.push({
      id: uid("sp"),
      pos: { ...pos },
      value,
      combo: comboCount,
      bornAt: performance.now(),
    });
  }

  function triggerShake(intensity: number) {
    shakeRef.current = {
      intensity,
      startAt: performance.now(),
      durationMs: SHAKE_MS,
    };
  }

  function triggerMuzzle(pos: Vec2) {
    muzzleRef.current = {
      pos: { ...pos },
      startAt: performance.now(),
    };
  }

  function tryShoot(canvasW: number, canvasH: number) {
    const now = performance.now();
    const crosshair = crosshairRef.current;
    if (!crosshair.shootGestureActive) return;
    if (crosshair.confidence < 0.18) return;
    if (now - crosshair.lastShotAt < SHOT_COOLDOWN_MS) return;
    crosshair.lastShotAt = now;
    crosshair.shootGestureActive = false;

    const audio = audioRef.current;
    audio?.shoot();

    const aim = { x: crosshair.smoothPos.x * canvasW, y: crosshair.smoothPos.y * canvasH };
    triggerMuzzle(aim);

    let hits = 0;
    const remaining: Fruit[] = [];
    for (const f of fruitsRef.current) {
      if (dist(f.pos, aim) <= HIT_RADIUS_PX + f.size * 0.42) {
        hits++;
        const color = fruitBaseColor(f.kind);
        explode(f.pos, color, true);
      } else {
        remaining.push(f);
      }
    }
    fruitsRef.current = remaining;

    if (hits > 0) {
      const c = comboRef.current;
      if (now - c.lastHitAt < COMBO_WINDOW_MS) {
        c.count += hits;
      } else {
        c.count = hits;
      }
      c.lastHitAt = now;

      const multiplier = Math.max(1, c.count);
      const points = hits * 10 * multiplier;
      setScore((s) => s + points);
      setCombo(c.count);
      addScorePopup(aim, points, c.count);

      audio?.hit();
      if (c.count >= 2) audio?.combo(c.count);

      triggerShake(Math.min(12, 4 + c.count * 2));
    } else {
      audio?.miss();
      // 작은 머즐 파티클만
      explode(aim, "#60a5fa", false);
    }
  }

  // ─── Draw ────────────────────────────────────────────

  function draw(ctx: CanvasRenderingContext2D, w: number, h: number, timeLeft: number) {
    const now = performance.now();

    // Screen shake offset
    let shakeX = 0;
    let shakeY = 0;
    const shake = shakeRef.current;
    if (shake && now - shake.startAt < shake.durationMs) {
      const t = 1 - (now - shake.startAt) / shake.durationMs;
      shakeX = (Math.random() - 0.5) * shake.intensity * t * 2;
      shakeY = (Math.random() - 0.5) * shake.intensity * t * 2;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);

    ctx.clearRect(-20, -20, w + 40, h + 40);

    // ── Background ──
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
      const dw = video.videoWidth * scale;
      const dh = video.videoHeight * scale;
      ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#0b1020");
      g.addColorStop(1, "#05060a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Vignette
    const vg = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.45, Math.max(w, h));
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.75)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    // ── Star field ──
    for (const s of starsRef.current) {
      const twinkle = 0.5 + 0.5 * Math.sin(now * 0.002 + s.twinkleOffset);
      ctx.save();
      ctx.globalAlpha = s.alpha * twinkle;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Drift stars down slowly
    for (const s of starsRef.current) {
      s.y += s.speed * 0.016;
      if (s.y > 1.05) {
        s.y = -0.05;
        s.x = Math.random();
      }
    }

    // ── Urgency vignette (last 10 seconds) ──
    const timeLeftSec = timeLeft / 1000;
    if (timeLeftSec <= URGENCY_THRESHOLD_S && timeLeftSec > 0) {
      const urgency = 1 - timeLeftSec / URGENCY_THRESHOLD_S;
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 * (1 + urgency * 3));
      ctx.save();
      ctx.globalAlpha = urgency * 0.35 * pulse;
      const ug = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.2, w * 0.5, h * 0.5, w * 0.8);
      ug.addColorStop(0, "transparent");
      ug.addColorStop(1, "#ef4444");
      ctx.fillStyle = ug;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    // ── Fruits ──
    for (const f of fruitsRef.current) {
      const { sprite, palette } = FRUIT_SPRITES[f.kind];
      const pixel = Math.max(2, Math.floor(f.size / 12));
      const spriteW = sprite[0]!.length * pixel;
      const spriteH = sprite.length * pixel;
      const age = now - f.spawnedAt;
      const pulse = 1 + 0.03 * Math.sin(age * 0.005);

      ctx.save();
      ctx.translate(f.pos.x, f.pos.y);
      ctx.rotate(f.rotation);
      ctx.scale(pulse, pulse);

      // Glow
      ctx.shadowColor = fruitBaseColor(f.kind);
      ctx.shadowBlur = 20 + 6 * Math.sin(age * 0.004);
      drawPixelSprite(ctx, sprite, palette, -spriteW / 2, -spriteH / 2, pixel);

      // Reset shadow and draw again on top for crisp look
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      drawPixelSprite(ctx, sprite, palette, -spriteW / 2, -spriteH / 2, pixel);

      ctx.restore();
    }

    // ── Particles ──
    for (const p of particlesRef.current) {
      const t = clamp01((now - p.bornAt) / p.lifeMs);
      const a = 1 - t;
      ctx.save();
      ctx.globalAlpha = a;
      if (p.glow) {
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 12;
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── Muzzle flash ──
    const muzzle = muzzleRef.current;
    if (muzzle && now - muzzle.startAt < MUZZLE_MS) {
      const t = (now - muzzle.startAt) / MUZZLE_MS;
      const radius = 60 + t * 40;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      const mg = ctx.createRadialGradient(
        muzzle.pos.x, muzzle.pos.y, 0,
        muzzle.pos.x, muzzle.pos.y, radius,
      );
      mg.addColorStop(0, "#ffffff");
      mg.addColorStop(0.3, "#fbbf24");
      mg.addColorStop(1, "transparent");
      ctx.fillStyle = mg;
      ctx.fillRect(
        muzzle.pos.x - radius,
        muzzle.pos.y - radius,
        radius * 2,
        radius * 2,
      );
      ctx.restore();
    }

    // ── Score popups ──
    for (const sp of popupsRef.current) {
      const t = clamp01((now - sp.bornAt) / POPUP_MS);
      const easeOut = 1 - (1 - t) * (1 - t);
      const y = sp.pos.y - easeOut * 80;
      const alpha = 1 - t;
      const scale = 1 + (sp.combo > 1 ? 0.3 : 0);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `bold ${Math.floor(22 * scale)}px system-ui, sans-serif`;
      ctx.textAlign = "center";

      // Shadow text
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillText(`+${sp.value}`, sp.pos.x + 2, y + 2);

      // Main text
      ctx.fillStyle = sp.combo > 1 ? "#fbbf24" : "#ffffff";
      ctx.shadowColor = sp.combo > 1 ? "#fbbf24" : "#60a5fa";
      ctx.shadowBlur = 10;
      ctx.fillText(`+${sp.value}`, sp.pos.x, y);

      // Combo label
      if (sp.combo > 1) {
        ctx.font = `bold ${Math.floor(15 * scale)}px system-ui, sans-serif`;
        ctx.fillStyle = "#fb923c";
        ctx.fillText(`COMBO x${sp.combo}`, sp.pos.x, y + 22);
      }
      ctx.restore();
    }

    // ── Crosshair ──
    const crosshair = crosshairRef.current;
    if (crosshair.confidence > 0.1) {
      const cx = crosshair.smoothPos.x * w;
      const cy = crosshair.smoothPos.y * h;

      // Trail
      const trail = crosshair.trail;
      for (let i = 0; i < trail.length; i++) {
        const tt = i / trail.length;
        ctx.save();
        ctx.globalAlpha = tt * 0.3;
        ctx.fillStyle = crosshair.aimPoseActive ? "#60a5fa" : "#94a3b8";
        ctx.beginPath();
        ctx.arc(trail[i]!.x * w, trail[i]!.y * h, 3 + tt * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Main crosshair
      const isShot = now - crosshair.lastShotAt < 100;
      const r = isShot ? 12 : crosshair.aimPoseActive ? 18 : 22;
      const color = isShot
        ? "#fbbf24"
        : crosshair.aimPoseActive
          ? "#60a5fa"
          : "rgba(148,163,184,0.6)";
      const rotation = now * 0.001;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);

      // Outer ring
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = isShot ? 20 : 10;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();

      // Inner dot
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, isShot ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Cross lines (rotating)
      ctx.beginPath();
      const len = r + 8;
      const gap = r - 3;
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(angle) * gap, Math.sin(angle) * gap);
        ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
      }
      ctx.stroke();

      ctx.restore();
    }

    // ── Canvas Combo HUD (bottom center) ──
    const c = comboRef.current;
    if (c.count > 1 && now - c.lastHitAt < COMBO_WINDOW_MS) {
      const fade = clamp01(1 - (now - c.lastHitAt) / COMBO_WINDOW_MS);
      const pulse = 1 + 0.08 * Math.sin(now * 0.012);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.textAlign = "center";
      ctx.font = `bold ${Math.floor(36 * pulse)}px system-ui, sans-serif`;
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "#f97316";
      ctx.shadowBlur = 20;
      ctx.fillText(`COMBO x${c.count}`, w / 2, h * 0.48);
      ctx.restore();
    }

    ctx.restore(); // end shake transform
  }

  // ─── Game loop ───────────────────────────────────────

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

    // Hand detection
    const video = videoRef.current;
    const landmarker = handLandmarkerRef.current;
    if (runningRef.current && landmarker && video && video.readyState >= 2) {
      applyHandResult(landmarker.detectForVideo(video, now));
    }

    // Smooth crosshair (lerp)
    const crosshair = crosshairRef.current;
    crosshair.smoothPos = {
      x: lerp(crosshair.smoothPos.x, crosshair.pos.x, 0.28),
      y: lerp(crosshair.smoothPos.y, crosshair.pos.y, 0.28),
    };
    // Trail
    crosshair.trail.push({ ...crosshair.smoothPos });
    while (crosshair.trail.length > TRAIL_LEN) crosshair.trail.shift();

    // HUD update (throttled)
    hudFrameRef.current += 1;
    if (hudFrameRef.current % HUD_FRAME_INTERVAL === 0) {
      setHandTracked(lastHandOkRef.current);
    }

    // Timer
    let currentTimeLeft = GAME_MS;
    setTimeLeftMs((ms) => {
      if (!runningRef.current) return ms;
      const next = Math.max(0, ms - dt * 1000);
      currentTimeLeft = next;
      if (next <= 0 && status === "running") {
        runningRef.current = false;
        setStatus("ended");
        audioRef.current?.gameEnd();
      }
      return next;
    });

    // Countdown tick sound (last 5 seconds)
    const secLeft = Math.ceil(currentTimeLeft / 1000);
    if (secLeft <= 5 && secLeft > 0 && secLeft !== lastTickSecRef.current) {
      lastTickSecRef.current = secLeft;
      audioRef.current?.tick();
    }

    // Combo decay
    const c = comboRef.current;
    if (c.count > 0 && now - c.lastHitAt > COMBO_WINDOW_MS) {
      c.count = 0;
      setCombo(0);
    }

    // Spawn fruits — faster as time runs out
    const urgencyBoost = currentTimeLeft < URGENCY_THRESHOLD_S * 1000
      ? 1 + (1 - currentTimeLeft / (URGENCY_THRESHOLD_S * 1000)) * 0.6
      : 1;
    const spawnInterval = rand(900, 1600) / urgencyBoost;
    if (
      runningRef.current &&
      fruitsRef.current.length < MAX_FRUITS_ON_SCREEN &&
      now - lastSpawnAtRef.current > spawnInterval
    ) {
      lastSpawnAtRef.current = now;
      spawnFruit(w);
    }

    // Update fruits
    const gravity = 40;
    const nextFruits: Fruit[] = [];
    for (const f of fruitsRef.current) {
      const pos = { x: f.pos.x + f.vel.x * dt, y: f.pos.y + f.vel.y * dt };
      const vel = { x: f.vel.x * 0.999, y: f.vel.y + gravity * dt };
      const rotation = f.rotation + f.spin * dt;
      if (pos.y < h + f.size + 80) {
        nextFruits.push({ ...f, pos, vel, rotation });
      }
    }
    fruitsRef.current = nextFruits;

    // Shoot
    if (runningRef.current) tryShoot(w, h);

    // Update particles
    particlesRef.current = particlesRef.current
      .map((p) => ({
        ...p,
        pos: { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt },
        vel: { x: p.vel.x * 0.97, y: p.vel.y * 0.97 + 280 * dt },
      }))
      .filter((p) => now - p.bornAt < p.lifeMs);

    // Cleanup popups
    popupsRef.current = popupsRef.current.filter((sp) => now - sp.bornAt < POPUP_MS);

    draw(ctx, w, h, currentTimeLeft);

    if (runningRef.current) {
      rafRef.current = requestAnimationFrame(step);
    }
  }

  // ─── Start / Reset ──────────────────────────────────

  async function start() {
    if (!ready) return;
    if (status === "requesting_camera" || status === "running") return;

    // Init audio
    if (!audioRef.current) audioRef.current = new GameAudio();

    setErrorMsg(null);
    setHandTracked(false);
    lastHandOkRef.current = false;
    setScore(0);
    setCombo(0);
    setTimeLeftMs(GAME_MS);
    fruitsRef.current = [];
    particlesRef.current = [];
    popupsRef.current = [];
    gestureHistoryRef.current = [];
    lastAimAtRef.current = 0;
    comboRef.current = { count: 0, lastHitAt: 0 };
    lastTickSecRef.current = -1;
    shakeRef.current = null;
    muzzleRef.current = null;
    starsRef.current = createStars(STAR_COUNT);
    crosshairRef.current = {
      pos: { x: 0.5, y: 0.6 },
      smoothPos: { x: 0.5, y: 0.6 },
      aimPoseActive: false,
      shootGestureActive: false,
      lastShotAt: 0,
      confidence: 0,
      trail: [],
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
      const now = performance.now();
      lastFrameAtRef.current = now;
      lastSpawnAtRef.current = now;
      gameStartAtRef.current = now;
      setStatus("running");

      audioRef.current?.gameStart();

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
    setCombo(0);
    fruitsRef.current = [];
    particlesRef.current = [];
    popupsRef.current = [];
    gestureHistoryRef.current = [];
    comboRef.current = { count: 0, lastHitAt: 0 };
    crosshairRef.current = {
      pos: { x: 0.5, y: 0.6 },
      smoothPos: { x: 0.5, y: 0.6 },
      aimPoseActive: false,
      shootGestureActive: false,
      lastShotAt: 0,
      confidence: 0,
      trail: [],
    };
  }

  const timeLeftSec = Math.ceil(timeLeftMs / 1000);
  const isUrgent = status === "running" && timeLeftSec <= URGENCY_THRESHOLD_S;

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

      {/* ── HUD Top ── */}
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
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium backdrop-blur-md transition-colors ${
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
            {/* Combo badge */}
            {combo > 1 && status === "running" ? (
              <div className="animate-bounce rounded-2xl border border-amber-400/30 bg-amber-950/50 px-4 py-2 text-sm backdrop-blur-xl">
                <span className="font-bold text-amber-300">COMBO x{combo}</span>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-zinc-950/50 px-4 py-2 text-sm backdrop-blur-xl">
              <span className="text-zinc-400">점수</span>{" "}
              <span className="font-semibold tabular-nums text-white">{score}</span>
            </div>
            <div
              className={`rounded-2xl border px-4 py-2 text-sm backdrop-blur-xl transition-all ${
                isUrgent
                  ? "animate-pulse border-red-500/40 bg-red-950/40"
                  : "border-cyan-500/20 bg-linear-to-br from-cyan-950/40 to-zinc-950/50"
              }`}
            >
              <span className={isUrgent ? "text-red-300" : "text-cyan-200/80"}>남은 시간</span>{" "}
              <span className={`font-semibold tabular-nums ${isUrgent ? "text-red-100" : "text-white"}`}>
                {timeLeftSec}s
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom HUD ── */}
      <div className="absolute inset-x-0 bottom-0 z-30 p-3 sm:p-5">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl rounded-2xl border border-white/10 bg-zinc-950/50 p-4 text-sm leading-relaxed text-zinc-300 shadow-lg backdrop-blur-xl">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              조작법
            </div>
            <p>
              <span className="font-medium text-cyan-200">조준:</span> 검지를 펴서 가리키기
            </p>
            <p className="mt-1">
              <span className="font-medium text-amber-200">발사:</span> 조준 상태에서 손을 아래로
              빠르게 톡 치기, 또는 엄지로 검지 아래쪽 톡 누르기
            </p>
            <p className="mt-1">
              <span className="font-medium text-fuchsia-200">콤보:</span> 빠르게 연속 명중하면
              콤보 배율 UP!
            </p>
            {errorMsg ? (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-red-200">
                {errorMsg}
              </p>
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

      {/* ── Game Over overlay ── */}
      {status === "ended" ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-zinc-950/75 p-8 text-center shadow-2xl shadow-violet-500/20 backdrop-blur-2xl">
            <div className="text-sm font-medium uppercase tracking-[0.2em] text-zinc-500">
              라운드 종료
            </div>
            <div className="mt-2 text-3xl font-bold tracking-tight text-white">수고했어요!</div>
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
