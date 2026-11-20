// motion-core.mjs — 纯函数层（无 React、无 Remotion 依赖，可单独用 node 测试）
//
// 所有函数都是**闭式解**：给定绝对时间 t 直接算出结果，不做积分、不读前一帧。
// 这是抽帧渲染的前提——seek 到任意时刻都必须和顺序播放得到同一个画面。

/* ================= 时间 ================= */

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, p) => a + (b - a) * p;

// 缓动：全部精确从 0 到 1
export const EASE = { // ledger-allow: 缓动曲线库，所有片共用；具体某拍用哪条由场景文件按台账选
  linear: (p) => p,
  // expo out：快起慢收。p=0 时精确为 0（Remotion 自带 Easing.exp 做不到）
  out: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p))),
  // expo in：慢起快收
  in: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * clamp(p) - 10)),
  inOut: (p) => {
    const x = clamp(p);
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5
      ? Math.pow(2, 20 * x - 10) / 2
      : (2 - Math.pow(2, -20 * x + 10)) / 2;
  },
  // 回弹落定：用于"东西掉下来停住"，不要滥用（禁用清单里"被禁处的回弹"）
  back: (p) => {
    const x = clamp(p);
    const c = 1.70158;
    return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
  },
};

export const smooth = (p) => {
  const x = clamp(p);
  return x * x * (3 - 2 * x);
};
export const snap = (p, edge = 0.08) => {
  const x = clamp(p);
  return clamp((x - edge) / (1 - 2 * edge));
};

/**
 * prog — 进度：t 落在 [start, start+dur] 内返回 0..1（已缓动）
 * 用它可以避免手写 clamp，并且保证"窗口外精确为 0 或 1"。
 */
export function prog(t, start, dur, ease = EASE.linear) {
  if (dur <= 0) return t >= start ? 1 : 0;
  return ease(clamp((t - start) / dur));
}

/**
 * settle — 落定：在 landing 时刻前后做一次"过冲后回正"
 * 用于"东西到位后停住"的收尾感。lead 是提前量（默认 0.05s）。
 * 注意：这是闭式解，bounce 用衰减余弦，不积分。
 */
export function settle(t, fps, landing, { lead = 0.05, dur = 0.45, bounce = 0 } = {}) {
  const start = landing - lead;
  if (t <= start) return 0;
  const p = clamp((t - start) / dur);
  const base = EASE.out(p);
  if (!bounce) return base;
  // 衰减余弦：过冲幅度 bounce，随时间收敛到 0
  const decay = Math.exp(-6 * p) * Math.cos(p * Math.PI * 3.2);
  return base + bounce * decay * (1 - p);
}

/* ================= 节拍 ================= */

/**
 * beats(bpm) — 节拍网格
 * .at(n)   第 n 拍的绝对秒
 * .bar(n)  第 n 小节（4 拍）的绝对秒
 * .index(t) 当前是第几拍（可带小数）
 */
export function beats(bpm) {
  const beat = 60 / bpm;
  return {
    beat,
    at: (n) => n * beat,
    bar: (n) => n * 4 * beat,
    index: (t) => t / beat,
    nearest: (t) => Math.round(t / beat) * beat,
  };
}

/* ================= 确定性随机 ================= */

/** mulberry32：给定 seed 返回 [0,1) 生成器。同 seed 永远同序列。 */
export function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** rand(seed) — 单次随机（同一 seed 恒定） */
export function rand(seed) {
  return makeRand(seed)();
}

/**
 * wobble — 手绘感抖动：seed 与 i 决定形状，t 决定相位
 * 同一 (seed, i) 在任意 t 都可复现，不依赖帧序。
 */
export function wobble(seed, i, t, { amp = 1, freq = 1 } = {}) {
  const r1 = rand(seed * 7919 + i * 104729);
  const r2 = rand(seed * 7919 + i * 104729 + 1);
  const phase = r1 * Math.PI * 2;
  const speed = 0.6 + r2 * 0.8;
  return Math.sin(phase + t * speed * Math.PI * 2 * freq) * amp;
}

/** stepped — 固定步频跳动（做"沸腾"的线条，不是每帧随机） */
export function stepped(t, perSecond = 8) {
  return Math.floor(t * perSecond);
}

/* ================= 形状 ================= */

export const circle = (cx, cy, r, n = 64) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
};

export const polygon = (cx, cy, r, sides, rot = 0, n = 96) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
    // 多边形：把圆按 sides 等分后线性插值
    const seg = (i / n) * sides;
    const k = Math.floor(seg);
    const f = seg - k;
    const a0 = (k / sides) * Math.PI * 2 - Math.PI / 2 + rot;
    const a1 = ((k + 1) / sides) * Math.PI * 2 - Math.PI / 2 + rot;
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    pts.push([lerp(x0, x1, f), lerp(y0, y1, f)]);
    void a;
  }
  return pts;
};

export const line = (x1, y1, x2, y2, n = 2) => {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1 || 1);
    pts.push([lerp(x1, x2, p), lerp(y1, y2, p)]);
  }
  return pts;
};

/** toPath — 点数组 → SVG path 的 d 属性 */
export function toPath(pts, close = true) {
  if (!pts.length) return '';
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return close ? `${d} Z` : d;
}

/**
 * morphPts — 逐点插值：点数必须相同（不同就先重采样）
 * 这是"真变形"的基础：不是淡入淡出，是每个点都在走。
 */
export function morphPts(a, b, p) {
  const n = Math.min(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push([lerp(a[i][0], b[i][0], p), lerp(a[i][1], b[i][1], p)]);
  }
  return out;
}

/** morphPath — 两个形状路径直接插值 */
export function morphPath(a, b, p) {
  return toPath(morphPts(a, b, p));
}

/**
 * chain — 多段变形：按时间段依次 morph
 * segs: [{ at, dur, pts, ease }]
 * 返回当前时刻的点数组。段与段之间连续（下一段从上一段的终点开始）。
 */
export function chain(t, segs, initial) {
  let pts = initial || (segs[0] && segs[0].pts) || [];
  for (const seg of segs) {
    const p = prog(t, seg.at, seg.dur, seg.ease || EASE.inOut);
    if (p <= 0) break;
    const from = pts;
    pts = morphPts(from, seg.pts, p);
    if (p < 1) break;
  }
  return pts;
}

/**
 * converge — 多对一合并
 * items: [{ pts, arrive, mass, travel }]
 * 每个 item 从自己的位置出发，在 arrive 时刻到达目标位置；mass 决定合并后的半径。
 */
export function converge(t, items, target, { baseRadius = 6, radiusPerMass = 3 } = {}) {
  const shapes = items.map((it) => {
    const p = prog(t, it.arrive - (it.travel ?? 1.4), it.travel ?? 1.4, EASE.inOut);
    const dst = target(it.pts);
    return morphPts(it.pts, dst, p);
  });
  const totalMass = items.reduce((s, it) => s + (it.mass ?? 1), 0);
  const radius = baseRadius + radiusPerMass * totalMass;
  return { shapes, radius };
}

/** drawOn — 描边进度：把点数组截断到 p 比例（用于"线被画出来"） */
export function drawOn(pts, p) {
  if (p >= 1) return pts;
  if (p <= 0) return [];
  const n = Math.max(2, Math.round(pts.length * clamp(p)));
  return pts.slice(0, n);
}

/* ================= 颜色 ================= */

export function shadeHex(hex, k) {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const f = (v) => Math.round(clamp(v * k, 0, 255));
  return `#${f(r).toString(16).padStart(2, '0')}${f(g).toString(16).padStart(2, '0')}${f(b).toString(16).padStart(2, '0')}`;
}

export function inkCoverage(hex, inks) {
  // 给定颜色在几种墨里的覆盖比例（半调用）
  const target = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  let best = 0;
  for (const ink of inks) {
    const c = ink.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
    const d = Math.sqrt(c.reduce((s, v, i) => s + (v - target[i]) ** 2, 0));
    best = Math.max(best, 1 - d / 441.67);
  }
  return clamp(best);
}

/* ================= 角色 ================= */

export const DEG = Math.PI / 180; // ledger-allow: 角度转弧度，单位换算常量，任何片都一样

/**
 * rig — 由 Body + Pose 算出各关节的世界坐标
 * 角度制：肩 0=下垂，90=前伸，180=上举；肘向前弯，膝向后弯
 */
export function rig(body, pose) {
  const { x, y, facing = 1, lean = 0, head = 0 } = pose;
  const { torso = [40, 70], head: headR = 14, upperArm = 26, foreArm = 24, thigh = 32, shin = 30 } = body;

  const leanR = lean * DEG;
  const hipY = y - thigh - shin;
  const shoulderY = hipY - torso[1];
  const neck = [x + Math.sin(leanR) * torso[1] * 0.1, shoulderY];
  const headPos = [neck[0] + Math.sin(leanR + head * DEG) * (headR + 6), neck[1] - Math.cos(leanR + head * DEG) * (headR + 6)];

  const arm = (angles) => {
    const [sh, el] = angles || [0, 0];
    const a0 = (sh * facing) * DEG;
    const elbow = [neck[0] + Math.cos(a0 - Math.PI / 2) * upperArm, neck[1] + Math.sin(a0 - Math.PI / 2) * upperArm];
    const a1 = a0 + el * facing * DEG;
    const hand = [elbow[0] + Math.cos(a1 - Math.PI / 2) * foreArm, elbow[1] + Math.sin(a1 - Math.PI / 2) * foreArm];
    return { shoulder: neck, elbow, hand };
  };

  const leg = (angles) => {
    const [hp, kn] = angles || [0, 0];
    const a0 = hp * facing * DEG;
    const knee = [x + Math.sin(a0) * thigh, hipY + Math.cos(a0) * thigh];
    const a1 = a0 - kn * facing * DEG;
    const foot = [knee[0] + Math.sin(a1) * shin, knee[1] + Math.cos(a1) * shin];
    return { hip: [x, hipY], knee, foot };
  };

  return {
    hip: [x, hipY],
    neck,
    head: headPos,
    headR,
    torso,
    armL: arm(pose.armL),
    armR: arm(pose.armR),
    legL: leg(pose.legL),
    legR: leg(pose.legR),
    facing,
  };
}

/** grip — 手的世界坐标（道具要画在这个点上） */
export function grip(body, pose, side = 'R') {
  const r = rig(body, pose);
  return (side === 'L' ? r.armL : r.armR).hand;
}

/** nearSide — 面向观众的那一侧（决定先画哪只手） */
export function nearSide(pose) {
  return (pose.facing ?? 1) >= 0 ? 'R' : 'L';
}

/** poseMix — 两个姿势插值（过渡用） */
export function poseMix(a, b, p) {
  const mixArr = (x = [0, 0], y = [0, 0]) => [lerp(x[0], y[0], p), lerp(x[1], y[1], p)];
  return {
    x: lerp(a.x, b.x, p),
    y: lerp(a.y, b.y, p),
    facing: a.facing,
    lean: lerp(a.lean ?? 0, b.lean ?? 0, p),
    head: lerp(a.head ?? 0, b.head ?? 0, p),
    mood: p < 0.5 ? a.mood : b.mood,
    look: lerp(a.look ?? 0, b.look ?? 0, p),
    armL: mixArr(a.armL, b.armL),
    armR: mixArr(a.armR, b.armR),
    legL: mixArr(a.legL, b.legL),
    legR: mixArr(a.legR, b.legR),
  };
}

/** walk — 走路的腿部角度（闭式解：正弦驱动，不积分） */
export function walk(t, base, stepsPerSecond = 2, swing = 22) {
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

/* ================= 质感 ================= */

/** roughFor — 粗糙度随尺寸缩放：小字不要抖成锯齿，大字不要太平 */
export function roughFor(sizePx, strength = 1) {
  return clamp((sizePx / 120) * strength, 0.15, 1.6);
}

/* ================= 排版 ================= */

/**
 * fitSize — 单行文字按声明宽度 fit
 * 返回应使用的字号。粗略按每字符宽度 = size * ratio 估算。
 */
export function fitSize(text, maxWidth, baseSize, ratio = 0.58) {
  const est = text.length * baseSize * ratio;
  return est <= maxWidth ? baseSize : Math.floor((maxWidth / (text.length * ratio)));
}

/** letters — 逐字时间表：每个字的入场时间与进度 */
export function letters(t, text, start, { stagger = 0.04, dur = 0.6, ease = EASE.out } = {}) {
  const chars = [...text];
  return chars.map((ch, i) => {
    const at = start + i * stagger;
    return { ch, i, at, p: prog(t, at, dur, ease) };
  });
}
