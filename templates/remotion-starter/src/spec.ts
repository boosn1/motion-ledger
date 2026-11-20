// spec.ts — 本片所有常量。**每条都必须带台账 id**，没有 id 的常量就是没记账的常量。
//
// 这是唯一该改的两个文件之一（另一个是 scenes/）。
// FILM 的值必须逐条对应 LEDGER.md 里 S 表的某一行。

// ── S 表 ────────────────────────────────────────────────
export const FILM = {
  duration: 15,      // S01 时长 15 秒
  fps: 30,           // S02 30fps（平静片）
  width: 1920,       // S03 画幅 1920×1080
  height: 1080,      // S03
  loop: false,       // S04 收在字标定版，不做循环 reel（循环要求末帧==首帧）
  sound: true,       // S05 有配乐
};

// S06 底色墨绿 / S07 米白 / S08 朱红 / S09 中性灰
export const PALETTE = ['#22483A', '#F4F1EA', '#C4553B', '#8C9B92'];

// S10 五个方块 / S11 散落半径 420 / S12 方块边长 96
export const BLOCKS = {
  count: 5,
  spread: 420,
  size: 96,
  cy: 540,
};

// S13 计时器半径 180 / S14 描边 4 / S15 刻度 5 条
export const TIMER = {
  cx: 960,
  cy: 540,
  r: 180,
  stroke: 4,
  ticks: 5,
};

// S16 字标横条 520×88 / 圆角 44
export const MARK = {
  w: 520,
  h: 88,
  r: 44,
  cx: 960,
  cy: 540,
};

// S17 BPM 72
export const BPM = 72;

// ── 时间线（T 块：命名关键时刻）──────────────────────────
// 这些时刻必须与 LEDGER.md 的时间线表逐字一致。
export const T = {
  scene1Start: 0.0,    // 场 1 起
  gatherStart: 2.5,    // X01 五个方块开始合并
  gatherDur: 1.6,      // X01 持续 1.6s
  timerIn: 4.2,        // 场 2 计时器浮现
  growStart: 7.5,      // X02 合并体开始变成横条
  growDur: 1.8,        // X02 持续 1.8s
  settle: 11.0,        // T2 横条落定
  holdEnd: 15.0,       // S18 结尾 hold（11.0 → 15.0 = 4 秒）
};
