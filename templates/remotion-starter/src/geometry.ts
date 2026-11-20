// geometry.ts — 元素几何。**元素按结构特征在这里建好**，不是在场景里临时画方块。
//
// 关键：所有形状都采样成**同样的点数**（N=96），这样 morphPts 才能逐点走，
// 才是"真变形"而不是淡入淡出。

import { Pt, lerp } from './lib/motion';
import { BLOCKS, TIMER, MARK } from './spec';

export const N = 96; // ledger-allow: 采样点数，所有形状统一用它才能逐点 morph；改它不改变画面外观，只改精度

/**
 * E01 方块：超椭圆（squircle）。结构特征 = 圆角收口 + 直边 + 明确的边角过渡。
 * 不是"画个方块"——超椭圆的指数决定圆角占比，这是可调的结构参数。
 */
export function blockPts(size: number, p = 3.2, n = N): Pt[] {
  const a = size / 2;
  return Array.from({ length: n }, (_, i) => {
    const th = (i / n) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [
      a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p),
      a * Math.sign(s) * Math.pow(Math.abs(s), 2 / p),
    ] as Pt;
  });
}

/** 把点数组平移到 (cx, cy) */
export const at = (pts: Pt[], cx: number, cy: number): Pt[] => pts.map(([x, y]) => [x + cx, y + cy] as Pt);

/** E02 环：整圆，n 点 */
export function ringPts(cx: number, cy: number, r: number, n = N): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

/**
 * E02 环的一段弧：第 k 段（共 total 段）。
 * 这是 X01 的**目标形状**——五个方块各自变成环的五分之一。
 * 点数必须与 blockPts 一致，否则 morph 会跳。
 */
export function arcPts(cx: number, cy: number, r: number, k: number, total: number, n = N): Pt[] {
  const span = (Math.PI * 2) / total;
  const a0 = -Math.PI / 2 + k * span;
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (i / n) * span;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

/**
 * E03 横条字标：超椭圆，宽高比大 → 天然是"两端圆头的横条"。
 * 指数 2.6 让它是 stadium（不是椭圆也不是矩形）——这就是结构特征。
 */
export function barPts(w: number, h: number, p = 2.6, n = N): Pt[] {
  const a = w / 2;
  const b = h / 2;
  return Array.from({ length: n }, (_, i) => {
    const th = (i / n) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    return [
      a * Math.sign(c) * Math.pow(Math.abs(c), 2 / p),
      b * Math.sign(s) * Math.pow(Math.abs(s), 2 / p),
    ] as Pt;
  });
}

/* ── 预设：直接从 spec.ts 取尺寸，不在场景里写魔法数 ── */

export const BLOCK_SHAPE = blockPts(BLOCKS.size);                       // S12
export const RING = ringPts(TIMER.cx, TIMER.cy, TIMER.r);               // S13
export const ARC = (k: number) => arcPts(TIMER.cx, TIMER.cy, TIMER.r, k, BLOCKS.count); // S10 S13

// 横条必须与环**同中心**。barPts 以原点为中心，不平移的话 morph 会把整条线拖到画面左上角——
// 两个形状的锚点不一致，逐点插值就会变成"从画面中间飞出去"。
export const BAR = at(barPts(MARK.w, MARK.h), MARK.cx, MARK.cy);        // S16

/** 五个方块各自的散落起点：确定性布局，同 seed 同结果 */
export function scatterPositions(seed = 1337): Pt[] {
  // 内联 mulberry32，避免场景依赖 lib 的随机实现细节
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: BLOCKS.count }, (_, i) => {
    const ang = (i / BLOCKS.count) * Math.PI * 2 - Math.PI / 2 + (rnd() - 0.5) * 0.5;
    const rad = BLOCKS.spread * (0.62 + rnd() * 0.38);
    return [TIMER.cx + Math.cos(ang) * rad, BLOCKS.cy + Math.sin(ang) * rad * 0.66] as Pt;
  });
}

/** 超椭圆指数插值：让方块在变成弧的过程中"收口"——这是结构在变，不是缩放 */
export const easeExp = (from: number, to: number, p: number) => lerp(from, to, p);

/* ═══════════ 球面暗面（月牙形，不是偏移圆盘）═══════════
 *
 * 反面教材：把球的点数组切掉一半、整体偏移一点填深色——得到的是一个
 * **凸出球外的硬边圆盘**，观众看到一块贴上去的饼，不是球有体积。
 *
 * 正确的暗面是**两个圆的差集（lune）**：球面圆 减去 光源偏移后的亮面圆。
 * 边界由两段弧组成——球自己的外缘（远侧）+ 明暗交界线（terminator）。
 * 交界线是**弧**不是直线，球才有体积。
 *
 * @param kx,ky  亮面圆心的偏移方向（单位向量）
 * @param pull   亮面圆偏移多远（相对 r）
 */
export function sphereShadePts(
  cx: number,
  cy: number,
  r: number,
  kx = 0.42,
  ky = 0.38,
  pull = 0.62,
  n = N
): Pt[] {
  const d = pull * r;
  const r2 = r; // 同半径才形成标准月牙
  // 两圆交点（局部坐标里亮面圆在 +x 方向）
  const x = (d * d + r * r - r2 * r2) / (2 * d);
  const y = Math.sqrt(Math.max(0, r * r - x * x));
  const a1 = Math.atan2(y, x);
  const rot = Math.atan2(ky, kx);
  const half = Math.floor(n / 2);
  const pts: Pt[] = [];

  // ① 球的外缘：从 a1 绕远侧走到 a2（跨过 π 那一侧）
  for (let i = 0; i <= half; i++) {
    const k = i / half;
    const a = a1 + (Math.PI * 2 - 2 * a1) * k;
    const la = a + rot;
    pts.push([cx + Math.cos(la) * r, cy + Math.sin(la) * r] as Pt);
  }
  // ② 交界线：沿亮面圆回到起点（走球内部那侧短弧）
  for (let i = 0; i <= half; i++) {
    const k = i / half;
    const b1 = Math.atan2(-y, x - d);
    const b2 = Math.atan2(y, x - d);
    let delta = b1 - b2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const b = b2 + delta * k;
    const lx = d + Math.cos(b) * r2;
    const ly = Math.sin(b) * r2;
    pts.push([cx + lx * Math.cos(rot) - ly * Math.sin(rot), cy + lx * Math.sin(rot) + ly * Math.cos(rot)] as Pt);
  }
  return pts;
}
