// raster.mjs — 极简光栅器（纯 Node，零依赖）
//
// 只做三件事：填多边形、描折线、铺底色。
// 不是通用绘图库——够画动效片的几何元素就行。
// 文字不在这里（文字要么走 Remotion 的 HTML，要么走 SVG + 浏览器）。

export function createCanvas(w, h, bg = [0, 0, 0]) {
  const buf = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = bg[0];
    buf[i * 3 + 1] = bg[1];
    buf[i * 3 + 2] = bg[2];
  }
  return { w, h, buf };
}

export function hexToRgb(hex) {
  const m = hex.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

function blend(cv, x, y, rgb, a) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h || a <= 0) return;
  const i = (y * cv.w + x) * 3;
  if (a >= 1) {
    cv.buf[i] = rgb[0];
    cv.buf[i + 1] = rgb[1];
    cv.buf[i + 2] = rgb[2];
    return;
  }
  const inv = 1 - a;
  cv.buf[i] = cv.buf[i] * inv + rgb[0] * a;
  cv.buf[i + 1] = cv.buf[i + 1] * inv + rgb[1] * a;
  cv.buf[i + 2] = cv.buf[i + 2] * inv + rgb[2] * a;
}

/** 填多边形（扫描线，奇偶规则） */
export function fillPoly(cv, pts, rgb, alpha = 1) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(cv.h - 1, Math.ceil(maxY));

  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(cv.w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) blend(cv, x, y, rgb, alpha);
    }
  }
}

/**
 * 填多边形（扫描线，**非零环绕规则**）。
 *
 * 与 fillPoly 的区别只在「重叠怎么算」：
 *   - fillPoly 用奇偶规则，同一条射线穿过两次 = 外部。适合单个简单多边形。
 *   - 本函数累计有向穿越数，winding ≠ 0 即内部。适合**环带**这种外轮廓
 *     + 反向内轮廓的组合，且内轮廓局部自交时（形状收细到比描边还窄）
 *     会判成「更内部」而不是「又回到外面」——于是收细处自动填实成实体，
 *     不会在顶部咬出一个楔形缺口。
 */
export function fillPolyWinding(cv, pts, rgb, alpha = 1) {
  if (pts.length < 3) return;
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(cv.h - 1, Math.ceil(maxY));

  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    const xs = []; // [x, dir] dir=+1 向下穿过, -1 向上穿过
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (a[1] <= yc && b[1] > yc) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push([a[0] + t * (b[0] - a[0]), 1]);
      } else if (b[1] <= yc && a[1] > yc) {
        const t = (yc - a[1]) / (b[1] - a[1]);
        xs.push([a[0] + t * (b[0] - a[0]), -1]);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let w = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      w += xs[k][1];
      if (w === 0) continue;
      const xa = Math.max(0, Math.ceil(xs[k][0] - 0.5));
      const xb = Math.min(cv.w - 1, Math.floor(xs[k + 1][0] - 0.5));
      for (let x = xa; x <= xb; x++) blend(cv, x, y, rgb, alpha);
    }
  }
}

/**
 * 粗描边（单多边形填充）。
 *
 * 为什么不用 strokePolyline 逐段拼：
 *   逐段填充在相邻段的接缝处会重复混合，粗描边的外缘被咬出一圈波浪。
 *
 * 做法：按每个点的**切线法向**把中心线向两侧各偏移 hw，拼成一个闭合环带，
 * 一次填充。用切线法向而不是从中心径向偏移——径向在细长形状上会把横条
 * 挤成透镜状，法向偏移对圆、超椭圆、横条都成立。
 *
 * 两处必须这么写，否则画面会坏：
 *   1. 多采一个点（i 走到 n），让首尾的截面边在几何上重合。只走 n 个点时，
 *      i=0 与 i=n-1 用的是不同切线，两条截面边之间空出一个楔形缺口——
 *      就是环顶上那道缝。
 *   2. 用非零环绕规则填充。环带的内轮廓在形状收细到比描边还窄时会自交，
 *      奇偶规则把自交区判成外部，收细处被咬穿；非零规则判成更内部，自动填实。
 */
export function fillBand(cv, pts, hw, rgb, alpha = 1) {
  const n = pts.length;
  if (n < 3 || hw <= 0) return;
  const outer = [], inner = [];
  let lx = 0, ly = 1;
  for (let i = 0; i <= n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i % n];
    const next = pts[(i + 1) % n];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty);
    if (len > 1e-9) { lx = -ty / len; ly = tx / len; }
    outer.push([cur[0] + lx * hw, cur[1] + ly * hw]);
    inner.push([cur[0] - lx * hw, cur[1] - ly * hw]);
  }
  fillPolyWinding(cv, outer.concat(inner.reverse()), rgb, alpha);
}

export function strokePolyline(cv, pts, width, rgb, alpha = 1) {
  if (pts.length < 2) return;
  const hw = width / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    fillPoly(cv, [
      [x1 + nx, y1 + ny],
      [x2 + nx, y2 + ny],
      [x2 - nx, y2 - ny],
      [x1 - nx, y1 - ny],
    ], rgb, alpha);
  }
  // 接头
  if (hw > 1) {
    for (let i = 1; i + 1 < pts.length; i++) {
      fillDisc(cv, pts[i][0], pts[i][1], hw, rgb, alpha);
    }
  }
}

/** 实心圆 */
export function fillDisc(cv, cx, cy, r, rgb, alpha = 1) {
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(cv.h - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy;
    const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (!Number.isFinite(dx)) continue;
    const xa = Math.max(0, Math.ceil(cx - dx - 0.5));
    const xb = Math.min(cv.w - 1, Math.floor(cx + dx - 0.5));
    for (let x = xa; x <= xb; x++) blend(cv, x, y, rgb, alpha);
  }
}

/** 描圆环（用于计时器外圈） */
export function strokeCircle(cv, cx, cy, r, width, rgb, alpha = 1) {
  const n = Math.max(48, Math.round(r * 1.2));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  strokePolyline(cv, pts, width, rgb, alpha);
}

/** 圆角矩形（用多边形近似） */
export function fillRoundRect(cv, x, y, w, h, r, rgb, alpha = 1) {
  const rr = Math.min(r, w / 2, h / 2);
  const pts = [];
  const arc = (cx, cy, a0, a1) => {
    const steps = Math.max(3, Math.round(rr * 0.6));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  arc(x + w - rr, y + rr, -Math.PI / 2, 0);
  arc(x + w - rr, y + h - rr, 0, Math.PI / 2);
  arc(x + rr, y + h - rr, Math.PI / 2, Math.PI);
  arc(x + rr, y + rr, Math.PI, Math.PI * 1.5);
  fillPoly(cv, pts, rgb, alpha);
}

/** 竖向渐变底（有光源动机才用，不是默认装饰） */
export function verticalGradient(cv, topHex, bottomHex) {
  const a = hexToRgb(topHex);
  const b = hexToRgb(bottomHex);
  for (let y = 0; y < cv.h; y++) {
    const p = y / Math.max(1, cv.h - 1);
    const rgb = [
      a[0] + (b[0] - a[0]) * p,
      a[1] + (b[1] - a[1]) * p,
      a[2] + (b[2] - a[2]) * p,
    ];
    for (let x = 0; x < cv.w; x++) {
      const i = (y * cv.w + x) * 3;
      cv.buf[i] = rgb[0];
      cv.buf[i + 1] = rgb[1];
      cv.buf[i + 2] = rgb[2];
    }
  }
}

/** 2× 超采样下采样（一次抗锯齿，够用） */
export function downsample2x(src, w, h) {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i00 = ((y * 2) * w * 2 + x * 2) * 3;
      const i01 = ((y * 2) * w * 2 + x * 2 + 1) * 3;
      const i10 = ((y * 2 + 1) * w * 2 + x * 2) * 3;
      const i11 = ((y * 2 + 1) * w * 2 + x * 2 + 1) * 3;
      const o = (y * w + x) * 3;
      for (let c = 0; c < 3; c++) {
        out[o + c] = (src[i00 + c] + src[i01 + c] + src[i10 + c] + src[i11 + c]) >> 2;
      }
    }
  }
  return out;
}
