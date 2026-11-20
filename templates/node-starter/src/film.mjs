// film.mjs — 元素 builder。每个元素一个函数，返回当前时刻的绘制指令。
//
// 每处都标了台账 id。没有 id 的绘制就是没记账的绘制。
//
// 关键设计：X02「环变横条」是**真变形**，不是环淡出 + 横条淡入。
// 做法是轮廓的 96 个点逐点从圆走到超椭圆，同时描边宽度从 4px 同步涨到 44px——
// 一条细线圈被拉直并同时变粗，最终自己长成实体横条。叠加/交叉淡化在这里是被禁止的。

import { COLOR, CHARS, TIMER, MARK, T } from './spec.mjs';
import { hexToRgb, fillPoly, strokePolyline, fillDisc, fillRoundRect, fillBand } from './raster.mjs';
import {
  EASE, prog, lerp, clamp, circle, morphPts,
  makeRand, settle, beats,
} from './lib/motion-core.mjs';

// S06 S07 S08 调色板的 RGB 形式（由 COLOR 换算，不引入新颜色）
const RGB = {
  ink: hexToRgb(COLOR.ink),
  accent: hexToRgb(COLOR.accent),
};

/* ---------- 形状：所有可变形体统一 96 点 ---------- */

const N = 96; // ledger-allow: 采样点数，圆与横条都取 96 才能逐点对应

/** 超椭圆：指数 4.2 让它比椭圆方、比矩形圆，是"字标"该有的形状（结构参数，不是装饰） */
function stadium(cx, cy, w, h, n = N) {
  const a = w / 2, b = h / 2, e = 4.2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 - Math.PI / 2;
    const c = Math.cos(th), s = Math.sin(th);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    const y = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    out.push([cx + a * x, cy + b * y]);
  }
  return out;
}

const RING = circle(TIMER.cx, TIMER.cy, TIMER.r, N); // X02 起点

/* ---------- E01 方块：结构特征 = 圆角 + 一侧暗面 + 描边 ---------- */

export const makeBlock = (size) => ({ size });  // E01

export function drawBlock(cv, block, x, y, rgb, alpha = 1, opts = {}) {  // E01
  const s = block.size;
  const half = s / 2;
  // 圆角方块（圆角是结构特征，不是装饰）
  fillRoundRect(cv, x - half, y - half, s, s, s * 0.16, rgb, alpha);
  // 一侧暗面：做体积。k<1 就是同一个色的暗调，不是加渐变
  if (opts.shade !== false) {
    const dark = rgb.map((v) => v * 0.72);
    fillPoly(cv, [
      [x + half * 0.18, y - half + s * 0.16],
      [x + half * 0.92, y - half + s * 0.3],
      [x + half * 0.92, y + half - s * 0.3],
      [x + half * 0.18, y + half - s * 0.16],
    ], dark, alpha * 0.5);
  }
  return block;
}

/* ---------- E02 计时器细节：刻度 + 指针（只属于"计时器"，变形前淡出） ---------- */

export function drawTimerTicks(cv, t, alpha = 1) {  // E02
  const { cx, cy, r, stroke, ticks } = TIMER;
  const b = beats(90);  // S15
  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
    const on = t >= b.at(i) * 1.5;
    const len = on ? 14 : 8;
    const x1 = cx + Math.cos(a) * (r - len);
    const y1 = cy + Math.sin(a) * (r - len);
    const x2 = cx + Math.cos(a) * (r - 2);
    const y2 = cy + Math.sin(a) * (r - 2);
    strokePolyline(cv, [[x1, y1], [x2, y2]], stroke, RGB.ink, alpha * (on ? 0.9 : 0.3));
  }
}

export function drawTimerHand(cv, t, alpha = 1) {  // E02
  const { cx, cy, r } = TIMER;
  const sweep = (t / 4) * Math.PI * 2 - Math.PI / 2;
  const hx = cx + Math.cos(sweep) * (r - 26);
  const hy = cy + Math.sin(sweep) * (r - 26);
  strokePolyline(cv, [[cx, cy], [hx, hy]], 3, RGB.accent, alpha);
  fillDisc(cv, cx, cy, 5, RGB.accent, alpha);
}

/* ---------- E03 字标凹口：落定后才出现 ---------- */

export function drawNotches(cv, t, p) {  // E03
  const { cx, cy, w, h } = MARK;
  for (let i = 0; i < 3; i++) {
    const x = cx - w / 2 + w * (0.3 + i * 0.2);
    const hh = h * 0.44 * p;
    fillRoundRect(cv, x - 3, cy - hh / 2, 6, hh, 3, RGB.accent, p);
  }
  void t;
}

/* ---------- E04 背景：两层，不是纯色块 ---------- */

export function drawBackground(cv, t) {  // E04
  // 底：深墨绿。用极缓的呼吸，不是渐变装饰
  const breathe = 0.5 + 0.5 * Math.sin((t / 4) * Math.PI * 2);
  const base = hexToRgb(COLOR.bgTop);
  for (let y = 0; y < cv.h; y++) {
    const p = y / cv.h;
    // 竖向压暗（光从上方来，有动机）
    const k = 0.82 + 0.18 * (1 - p) + 0.03 * breathe;
    for (let x = 0; x < cv.w; x++) {
      const i = (y * cv.w + x) * 3;
      const radial = 1 - 0.35 * Math.hypot((x - cv.w / 2) / cv.w, (y - cv.h * 0.42) / cv.h);
      const kk = k * radial;
      cv.buf[i] = clamp(base[0] * kk, 0, 255);
      cv.buf[i + 1] = clamp(base[1] * kk, 0, 255);
      cv.buf[i + 2] = clamp(base[2] * kk, 0, 255);
    }
  }
}

/* ---------- 主体：五个方块 → 聚拢 → 环 → 横条字标 ---------- */

export function drawScene(cv, t) {  // X01 X02
  drawBackground(cv, t);

  const rand = makeRand(1337);  // 确定性：同 seed 同布局

  // 五个方块的起始位置（S09 S10 S11）
  const starts = [];
  for (let i = 0; i < CHARS.count; i++) {
    const a = (i / CHARS.count) * Math.PI * 2 - Math.PI / 2 + rand() * 0.4;
    const rr = CHARS.spread * (0.55 + rand() * 0.45);
    starts.push([TIMER.cx + Math.cos(a) * rr, TIMER.cy + Math.sin(a) * rr * 0.62]);
  }

  const block = makeBlock(CHARS.size);  // E01

  // X01：五个方块聚到中心（0.6s 起，1.0s 内到齐）
  const gather = prog(t, T.gatherStart, T.gatherDur, EASE.inOut);

  // X02：环变横条（2.0s 起，1.0s 内完成）
  const grow = prog(t, T.growStart, T.growDur, EASE.inOut);

  // 阶段一：散落 → 聚拢 → 被环吸收
  //
  // 吸收必须**在环成形之前**结束。之前把方块的收缩绑在 grow 上，结果变形阶段
  // 环里面还飘着 30% 不透明度的方块——那还是"叠加"，只是换了个位置。
  // 现在吸收窗是 1.5–2.0s，环在 1.4–1.9s 长出，两者交接，不留残影。
  const absorb = prog(t, T.gatherStart + T.gatherDur - 0.1, 0.5, EASE.in);
  if (absorb < 1) {
    for (let i = 0; i < starts.length; i++) {
      const [sx, sy] = starts[i];
      // 各自带一点延迟到齐（不是齐步走）
      const lag = i * 0.06;
      const pi = prog(t, T.gatherStart + lag, T.gatherDur - lag, EASE.inOut);
      const x = lerp(sx, TIMER.cx, pi);
      const y = lerp(sy, TIMER.cy, pi);
      const s = 1 - absorb * 0.9;
      if (s <= 0.02) continue;
      const a = clamp(1 - absorb * 1.1, 0, 1);
      drawBlock(cv, block, x, y, RGB.ink, a * 0.95, { shade: absorb < 0.3 });
    }
  }

  // 阶段二：环浮现 → 变形为横条
  //
  // 真变形的做法：轮廓点从 RING 逐点走到超椭圆，描边宽度同步从 4px 涨到 44px。
  // 目标轮廓按"描边中心线"算（最终宽高各收掉一个描边宽度），所以 p=1 时
  // 中心线退化成一条 256px 的横线、描边 44px 铺开——正好是 300×44 的实体横条。
  const ringA = prog(t, 1.4, 0.5, EASE.out);
  if (ringA > 0.01) {
    const sw = lerp(TIMER.stroke * 2, MARK.h, grow);
    const tw = Math.max(1, MARK.w - sw);
    const th = Math.max(0, MARK.h - sw);
    const target = stadium(TIMER.cx, TIMER.cy, tw, th);
    const pts = morphPts(RING, target, grow);
    // 粗描边必须一次填充成环带：逐段拼四边形会在相邻段重叠处被奇偶规则填两次，
    // 反而变透明，外缘被咬出一圈波浪缺口。sw 越粗、点越密，缺口越明显。
    fillBand(cv, pts, sw / 2, RGB.ink, ringA * 0.95);

    // 刻度与指针属于"计时器"，不属于横条——变形一开始就淡出
    const detailA = ringA * (1 - prog(t, T.growStart, 0.35, EASE.in));
    if (detailA > 0.01) {
      drawTimerTicks(cv, t, detailA);
      drawTimerHand(cv, t, detailA);
    }
  }

  // 阶段三：落定 + 凹口（settle 只做过冲，不弹跳）
  const notchP = prog(t, T.settle, 0.35, EASE.out);
  if (notchP > 0.01) {
    // settle 的过冲量作用在整体缩放上，幅度很小（0.012），不是弹簧玩具
    const over = settle(t, 30, T.settle, { lead: 0.05, dur: 0.45, bounce: 0.012 });
    if (Math.abs(over) > 1e-4) {
      // 过冲：把已画好的横条按 (1+over) 重画一层（幅度极小，视觉上是"压实"）
      const sw = lerp(TIMER.stroke * 2, MARK.h, 1);
      const tw = Math.max(1, (MARK.w - sw) * (1 + over));
      const th = Math.max(0, (MARK.h - sw) * (1 + over));
      fillBand(cv, stadium(MARK.cx, MARK.cy, tw, th), (sw * (1 + over)) / 2,
        RGB.ink, ringA * 0.95);
    }
    drawNotches(cv, t, notchP);
  }

  void gather;
}
