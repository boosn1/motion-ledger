// spec.mjs — 本片所有常量。每条都带台账 id，没有 id 的常量就是没记账的常量。
//
// 对应 LEDGER.md 的 S/X/E 表。

// S01 时长 4 秒 / S02 画幅 960×540 / S03 30fps / S04 不循环（收在字标定版）/ S05 有声音
export const FILM = {
  duration: 4,
  width: 960,
  height: 540,
  fps: 30,
  loop: false,
  sound: true,
};

// S06 深墨绿底 / S07 米白 / S08 朱红
export const COLOR = {
  bgTop: '#22483A',
  bgBottom: '#14261F',
  ink: '#F4F1EA',
  accent: '#C4553B',
};

// S09 五个方块 / S10 散落半径 / S11 方块边长
export const CHARS = {
  count: 5,
  spread: 250,
  size: 34,
  y: 270,
};

// S12 计时器直径 / S13 中心
export const TIMER = {
  cx: 480,
  cy: 270,
  r: 82,
  stroke: 2,
  ticks: 5,
};

// S14 横条字标：宽 / 高 / 圆角
export const MARK = {
  w: 300,
  h: 44,
  r: 22,
  cx: 480,
  cy: 270,
};

// S15 节拍 90 BPM
export const BPM = 90;

// 关键时刻（时间线里命名过的）
export const T = {
  gatherStart: 0.6,   // X01 开始
  gatherDur: 1.0,
  growStart: 2.0,     // X02 开始
  growDur: 1.0,
  settle: 3.0,        // 落定
  holdEnd: 4.0,       // S16 结尾 hold 1 秒
};
