// motion.tsx — helper 库。**不要改这个文件。**
//
// 它决定东西**在哪、怎么动**，永远不决定**长什么样**。
// 交付时不许把这里的中性默认值（方盒子、火柴人、系统字体）当成品。
//
// 所有函数都是闭式解：给定绝对时间 t 直接算结果，不积分、不读前一帧。
// 这是 Remotion 抽帧渲染的前提——seek 到任意时刻必须和顺序播放得到同一个画面。

import React from 'react';
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from 'remotion';

/* ═══════════════ 时间 ═══════════════ */

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export const EASE = { // ledger-allow: 缓动曲线库，是所有片共用的机制；具体某拍用哪条曲线由场景文件按台账选，不在这里定
  linear: (p: number) => p,
  /** expo out：快起慢收，p=0 精确为 0（Remotion 自带 Easing.exp 做不到，会漏隐藏图层） */
  out: (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p))),
  /** expo in：慢起快收 */
  in: (p: number) => (p <= 0 ? 0 : Math.pow(2, 10 * clamp(p) - 10)),
  inOut: (p: number) => {
    const x = clamp(p);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
  },
  /** 回弹落定：只在"东西真的掉下来"时用，禁用于提示词没要求的地方 */
  back: (p: number) => {
    const x = clamp(p);
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  },
};

export const smooth = (p: number) => {
  const x = clamp(p);
  return x * x * (3 - 2 * x);
};

/** 进度：t 落在 [start, start+dur] 内返回 0..1（已缓动），窗口外精确为 0 或 1 */
export function prog(t: number, start: number, dur: number, ease: (p: number) => number = EASE.linear) {
  if (dur <= 0) return t >= start ? 1 : 0;
  return ease(clamp((t - start) / dur));
}

/** 落定：landing 时刻前后一次过冲回正。lead 是提前量。 */
export function settle(
  t: number,
  _fps: number,
  landing: number,
  { lead = 0.05, dur = 0.45, bounce = 0 } = {}
) {
  const start = landing - lead;
  if (t <= start) return 0;
  const p = clamp((t - start) / dur);
  const base = EASE.out(p);
  if (!bounce) return base;
  const decay = Math.exp(-6 * p) * Math.cos(p * Math.PI * 3.2);
  return base + bounce * decay * (1 - p);
}

/** 当前时间。**只用这个**，不要混用 useCurrentFrame。t 是绝对秒。 */
export function useTime() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  return {
    t: frame / fps,
    frame,
    fps,
    D: durationInFrames / fps,
    width,
    height,
  };
}

/* ═══════════════ 节拍 ═══════════════ */

export function beats(bpm: number) {
  const beat = 60 / bpm;
  return {
    beat,
    at: (n: number) => n * beat,
    bar: (n: number) => n * 4 * beat,
    index: (t: number) => t / beat,
    nearest: (t: number) => Math.round(t / beat) * beat,
  };
}

/* ═══════════════ 确定性随机 ═══════════════ */

/** mulberry32：同 seed 永远同序列。**禁用 Math.random()。** */
export function makeRand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (seed: number) => makeRand(seed)();

/** 手绘感抖动：seed 与 i 决定形状，t 决定相位。任意 t 可复现。 */
export function wobble(seed: number, i: number, t: number, { amp = 1, freq = 1 } = {}) {
  const r1 = rand(seed * 7919 + i * 104729);
  const r2 = rand(seed * 7919 + i * 104729 + 1);
  return Math.sin(r1 * Math.PI * 2 + t * (0.6 + r2 * 0.8) * Math.PI * 2 * freq) * amp;
}

/** 固定步频跳动（做"沸腾"的线条，不是每帧随机） */
export const stepped = (t: number, perSecond = 8) => Math.floor(t * perSecond);

/* ═══════════════ 形状 ═══════════════ */

export type Pt = [number, number];

export const circle = (cx: number, cy: number, r: number, n = 64): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });

export const polygon = (cx: number, cy: number, r: number, sides: number, rot = 0, n = 96): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const seg = (i / n) * sides;
    const k = Math.floor(seg);
    const f = seg - k;
    const a0 = (k / sides) * Math.PI * 2 - Math.PI / 2 + rot;
    const a1 = ((k + 1) / sides) * Math.PI * 2 - Math.PI / 2 + rot;
    return [
      lerp(cx + Math.cos(a0) * r, cx + Math.cos(a1) * r, f),
      lerp(cy + Math.sin(a0) * r, cy + Math.sin(a1) * r, f),
    ] as Pt;
  });

export const line = (x1: number, y1: number, x2: number, y2: number, n = 2): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const p = n === 1 ? 0 : i / (n - 1);
    return [lerp(x1, x2, p), lerp(y1, y2, p)] as Pt;
  });

export const toPath = (pts: Pt[], close = true) => {
  if (!pts.length) return '';
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return close ? `${d} Z` : d;
};

/** 逐点插值。**这是"真变形"的基础**——不是淡入淡出，是每个点都在走。 */
export function morphPts(a: Pt[], b: Pt[], p: number): Pt[] {
  const n = Math.min(a.length, b.length);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push([lerp(a[i][0], b[i][0], p), lerp(a[i][1], b[i][1], p)]);
  return out;
}

export const morphPath = (a: Pt[], b: Pt[], p: number) => toPath(morphPts(a, b, p));

/** 多段变形：按时间段依次 morph，段与段连续 */
export function chain(t: number, segs: { at: number; dur: number; pts: Pt[]; ease?: (p: number) => number }[], initial?: Pt[]) {
  let pts = initial ?? segs[0]?.pts ?? [];
  for (const seg of segs) {
    const p = prog(t, seg.at, seg.dur, seg.ease ?? EASE.inOut);
    if (p <= 0) break;
    pts = morphPts(pts, seg.pts, p);
    if (p < 1) break;
  }
  return pts;
}

/** 多对一合并 */
export function converge(
  t: number,
  items: { pts: Pt[]; arrive: number; mass?: number; travel?: number }[],
  target: (pts: Pt[]) => Pt[],
  { baseRadius = 6, radiusPerMass = 3 } = {}
) {
  const shapes = items.map((it) => {
    const travel = it.travel ?? 1.4;
    const p = prog(t, it.arrive - travel, travel, EASE.inOut);
    return morphPts(it.pts, target(it.pts), p);
  });
  const totalMass = items.reduce((s, it) => s + (it.mass ?? 1), 0);
  return { shapes, radius: baseRadius + radiusPerMass * totalMass };
}

/** 描边进度：把点数组截断到 p 比例（"线被画出来"） */
export const drawOn = (pts: Pt[], p: number) =>
  p >= 1 ? pts : p <= 0 ? [] : pts.slice(0, Math.max(2, Math.round(pts.length * clamp(p))));

/* ═══════════════ 颜色 ═══════════════ */

export function shadeHex(hex: string, k: number) {
  const m = hex.replace('#', '');
  const f = (v: string) => Math.round(clamp(parseInt(v, 16) * k, 0, 255)).toString(16).padStart(2, '0');
  return `#${f(m.slice(0, 2))}${f(m.slice(2, 4))}${f(m.slice(4, 6))}`;
}

/* ═══════════════ 角色 ═══════════════ */

export const DEG = Math.PI / 180; // ledger-allow: 角度转弧度，单位换算常量，任何片子都一样

export type Body = {
  torso: [number, number];
  head: number;
  upperArm: number;
  foreArm: number;
  thigh: number;
  shin: number;
  color: { body: string; head: string; limb: string; hand?: string; shoe?: string; shade?: string; line?: string };
  face?: 'dot' | 'none';
  parts?: React.ReactNode;
};

export type Pose = {
  x: number;
  y: number;          // 地面 y
  facing: 1 | -1;
  lean?: number;
  head?: number;
  mood?: string;
  look?: number;
  armL?: [number, number];
  armR?: [number, number];
  legL?: [number, number];
  legR?: [number, number];
};

/** 由 Body + Pose 算关节世界坐标。角度制：肩 0=下垂 90=前伸 180=上举；肘向前弯，膝向后弯。 */
export function rig(body: Body, pose: Pose) {
  const { x, y, facing = 1, lean = 0, head = 0 } = pose;
  const leanR = lean * DEG;
  const hipY = y - body.thigh - body.shin;
  const neck: Pt = [x + Math.sin(leanR) * body.torso[1] * 0.1, hipY - body.torso[1]];
  const headPos: Pt = [
    neck[0] + Math.sin(leanR + head * DEG) * (body.head + 6),
    neck[1] - Math.cos(leanR + head * DEG) * (body.head + 6),
  ];

  const arm = (angles: [number, number] = [0, 0]) => {
    const a0 = angles[0] * facing * DEG;
    const elbow: Pt = [neck[0] + Math.cos(a0 - Math.PI / 2) * body.upperArm, neck[1] + Math.sin(a0 - Math.PI / 2) * body.upperArm];
    const a1 = a0 + angles[1] * facing * DEG;
    const hand: Pt = [elbow[0] + Math.cos(a1 - Math.PI / 2) * body.foreArm, elbow[1] + Math.sin(a1 - Math.PI / 2) * body.foreArm];
    return { shoulder: neck, elbow, hand };
  };

  const leg = (angles: [number, number] = [0, 0]) => {
    const a0 = angles[0] * facing * DEG;
    const knee: Pt = [x + Math.sin(a0) * body.thigh, hipY + Math.cos(a0) * body.thigh];
    const a1 = a0 - angles[1] * facing * DEG;
    const foot: Pt = [knee[0] + Math.sin(a1) * body.shin, knee[1] + Math.cos(a1) * body.shin];
    return { hip: [x, hipY] as Pt, knee, foot };
  };

  return {
    hip: [x, hipY] as Pt,
    neck,
    head: headPos,
    headR: body.head,
    torso: body.torso,
    armL: arm(pose.armL),
    armR: arm(pose.armR),
    legL: leg(pose.legL),
    legR: leg(pose.legR),
    facing,
  };
}

/** 手的坐标（道具必须画在这里，否则"手不在道具上"） */
export const grip = (body: Body, pose: Pose, side: 'L' | 'R' = 'R') =>
  (side === 'L' ? rig(body, pose).armL : rig(body, pose).armR).hand;

export const nearSide = (pose: Pose): 'L' | 'R' => ((pose.facing ?? 1) >= 0 ? 'R' : 'L');

export function poseMix(a: Pose, b: Pose, p: number): Pose {
  const m = (x: [number, number] = [0, 0], y: [number, number] = [0, 0]): [number, number] => [
    lerp(x[0], y[0], p),
    lerp(x[1], y[1], p),
  ];
  return {
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    facing: a.facing,
    lean: lerp(a.lean ?? 0, b.lean ?? 0, p),
    head: lerp(a.head ?? 0, b.head ?? 0, p),
    mood: p < 0.5 ? a.mood : b.mood,
    look: lerp(a.look ?? 0, b.look ?? 0, p),
    armL: m(a.armL, b.armL),
    armR: m(a.armR, b.armR),
    legL: m(a.legL, b.legL),
    legR: m(a.legR, b.legR),
  };
}

/** 走路：正弦驱动的闭式解，不积分 */
export function walk(t: number, base: Pose, stepsPerSecond = 2, swing = 22): Pose {
  const phase = t * stepsPerSecond * Math.PI * 2;
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    ...base,
    legL: [s * swing, Math.max(0, -c) * swing * 0.6],
    legR: [-s * swing, Math.max(0, c) * swing * 0.6],
    armL: [-s * swing * 0.7, 8],
    armR: [s * swing * 0.7, 8],
  };
}

/* ═══════════════ 质感 ═══════════════ */

/** 粗糙度随尺寸缩放：小字别抖成锯齿，大字别太平 */
export const roughFor = (sizePx: number, strength = 1) => clamp((sizePx / 120) * strength, 0.15, 1.6);

/* ═══════════════ 组件 ═══════════════ */

/** 满屏容器 */
export const Stage: React.FC<{ bg?: string; children?: React.ReactNode }> = ({ bg = '#000', children }) => (
  <AbsoluteFill style={{ backgroundColor: bg, overflow: 'hidden' }}>{children}</AbsoluteFill>
);

/** 遮罩擦除：from 方向推入。**硬边，不是淡入。** */
export const Reveal: React.FC<{
  p: number;
  from?: 'left' | 'right' | 'top' | 'bottom';
  children?: React.ReactNode;
}> = ({ p, from = 'left', children }) => {
  const k = clamp(p);
  const inset =
    from === 'left' ? `inset(0 ${(1 - k) * 100}% 0 0)`
    : from === 'right' ? `inset(0 0 0 ${(1 - k) * 100}%)`
    : from === 'top' ? `inset(0 0 ${(1 - k) * 100}% 0)`
    : `inset(${(1 - k) * 100}% 0 0 0)`;
  return <div style={{ clipPath: inset, width: '100%', height: '100%' }}>{children}</div>;
};

/** 逐字入场。**保留空格。** */
export const Letters: React.FC<{
  text: string;
  t: number;
  start: number;
  stagger?: number;
  dur?: number;
  ease?: (p: number) => number;
  style?: (p: number, i: number) => React.CSSProperties;
}> = ({ text, t, start, stagger = 0.04, dur = 0.6, ease = EASE.out, style }) => (
  <>
    {[...text].map((ch, i) => {
      const p = prog(t, start + i * stagger, dur, ease);
      const base: React.CSSProperties = {
        display: 'inline-block',
        whiteSpace: 'pre',
        opacity: p,
        transform: `translateY(${(1 - p) * 18}px)`,
      };
      return (
        <span key={i} style={{ ...base, ...(style ? style(p, i) : {}) }}>
          {ch}
        </span>
      );
    })}
  </>
);

/** 数字滚动。p 从 0 到 1 时从 from 滚到 to。 */
export const Counter: React.FC<{ from: number; to: number; p: number; decimals?: number }> = ({
  from,
  to,
  p,
  decimals = 0,
}) => <>{lerp(from, to, clamp(p)).toFixed(decimals)}</>;
