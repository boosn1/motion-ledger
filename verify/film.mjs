#!/usr/bin/env node
// verify/film.mjs — 成片门禁（零依赖，只调 ffmpeg / ffprobe）
//
//   node verify/film.mjs --film out/film.mp4 --spec src/spec.ts
//
// 硬门禁（FAIL 即不过）：
//   1. 格式对 spec（width / height / fps / duration）
//   2. 首帧无闪色（第 0 帧与第 1 帧平均差 ≤ 6）
//   3. 循环接缝（spec.loop 为 true 时，末帧 vs 首帧 SSIM ≥ 0.97）
//   4. 运动曲线无计划外尖峰（默认 0 处，可用 --allow-spikes N 声明计划内硬切）
//   5. 中段无死区（最长静止段 ≤ 1.5s，可用 --allow-still <秒> 放宽）
//   6. 有声音时非静音（mean_volume > -70 dB）
//
// 退出码：0 全通过 / 1 有 FAIL / 2 环境或输入错误

import { existsSync } from 'node:fs';
import {
  parseArgs, makeReporter, readText, parseSpec, parsePeakWindows, parseStillWindows,
  hasBinary, ffprobe, grayFrames, grayAt, grayLast, frameDiff,
  audioRms, ssimFromPixels, median,
} from './lib.mjs';

const args = parseArgs();
const filmPath = typeof args.film === 'string' ? args.film : 'out/film.mp4';
const specPath = typeof args.spec === 'string' ? args.spec : 'src/spec.ts';
const ledgerPath = typeof args.ledger === 'string' ? args.ledger : 'LEDGER.md';
const allowSpikes = args['allow-spikes'] === undefined ? 0 : Number(args['allow-spikes']);
const allowStill = args['allow-still'] === undefined ? 1.5 : Number(args['allow-still']);

const r = makeReporter('motion-ledger · film 门禁');

/* ---------- 环境 ---------- */

if (!hasBinary('ffprobe') || !hasBinary('ffmpeg')) {
  r.fail('环境', '找不到 ffmpeg / ffprobe，请先安装并加入 PATH');
  r.summary();
  process.exit(2);
}

if (!existsSync(filmPath)) {
  r.fail('成片', `${filmPath} 不存在（先 npm run render）`);
  r.summary();
  process.exit(2);
}

const probe = ffprobe(filmPath);
if (probe.error) {
  r.fail('成片可读', probe.error);
  r.summary();
  process.exit(2);
}

/* ---------- spec ---------- */

const specText = existsSync(specPath) ? readText(specPath) : null;
const spec = specText ? parseSpec(specText) : null;

if (!spec || !spec.duration) {
  r.warn('spec', specText ? `${specPath} 里没解析到 FILM.duration，跳过格式比对` : `${specPath} 不存在，跳过格式比对`);
}

/* ---------- 1. 格式 ---------- */

if (spec && spec.duration) {
  const checks = [];
  if (spec.width && probe.width !== spec.width) checks.push(`宽 ${probe.width} ≠ ${spec.width}`);
  if (spec.height && probe.height !== spec.height) checks.push(`高 ${probe.height} ≠ ${spec.height}`);
  if (spec.fps && Math.abs(probe.fps - spec.fps) > 0.5) checks.push(`fps ${probe.fps.toFixed(2)} ≠ ${spec.fps}`);
  if (Math.abs(probe.duration - spec.duration) > 0.15) {
    checks.push(`时长 ${probe.duration.toFixed(2)}s ≠ ${spec.duration}s`);
  }
  if (checks.length === 0) {
    r.pass('格式对 spec', `${probe.width}×${probe.height} @ ${probe.fps.toFixed(2)}fps / ${probe.duration.toFixed(2)}s`);
  } else {
    r.fail('格式对 spec', checks.join('；'));
  }
} else {
  r.pass('格式（实测）', `${probe.width}×${probe.height} @ ${probe.fps.toFixed(2)}fps / ${probe.duration.toFixed(2)}s`);
}

/* ---------- 抽帧 ---------- */

const gray = grayFrames(filmPath, { w: 96, h: 54 });
if (gray.error) {
  r.fail('抽帧', gray.error);
  r.summary();
  process.exit(2);
}

const { w, h, frames, data } = gray;
const size = w * h;
const frame = (i) => data.subarray(i * size, (i + 1) * size);
const at = (i) => (i / (frames > 1 ? frames - 1 : 1)) * probe.duration;

r.pass('抽帧', `${frames} 帧 @ ${w}×${h} 灰度`);

/* ---------- 2. 首帧无闪色 ---------- */

if (frames >= 2) {
  const d01 = frameDiff(frame(0), frame(1));
  if (d01 <= 6) {
    r.pass('首帧无闪色', `第 0→1 帧差 ${d01.toFixed(2)} ≤ 6`);
  } else {
    r.fail('首帧无闪色', `第 0→1 帧差 ${d01.toFixed(2)} > 6（开头有硬跳/闪帧）`);
  }
} else {
  r.warn('首帧无闪色', '帧数不足，跳过');
}

/* ---------- 3. 循环接缝 ---------- */

if (spec && spec.loop === true) {
  // 末帧不能 seek 到 duration：最后一帧的时间戳在 duration - 1/fps，
  // seek 过去已经越界，ffmpeg 返回空 → 接缝被判成"计算失败"而不是"不合格"。
  const last = grayLast(filmPath);
  const first = grayAt(filmPath, 0);
  const seam = last && first ? ssimFromPixels(last, first) : null;
  if (seam === null) {
    r.warn('循环接缝', 'SSIM 计算失败（末帧或首帧抽不出来）');
  } else if (seam >= 0.97) {
    r.pass('循环接缝', `SSIM ${seam.toFixed(4)} ≥ 0.97`);
  } else {
    r.fail('循环接缝', `SSIM ${seam.toFixed(4)} < 0.97（末帧与首帧对不上，循环会跳）`);
  }
} else {
  r.pass('循环接缝', '非循环片，跳过');
}

/* ---------- 4 / 5. 运动曲线 ---------- */

const v = [];
for (let i = 0; i + 1 < frames; i++) {
  v.push(frameDiff(frame(i), frame(i + 1)) / 255); // 归一化 0..1
}

if (v.length < 4) {
  r.warn('运动曲线', '帧数不足，跳过');
} else {
  const med = median(v);
  // 阈值只跟中位走，不加绝对值地板。
  //
  // 之前写的是 max(4*med, 0.03)：干净片子的中位只有 0.0001，0.03 就成了实际阈值——
  // 真实变形（5 倍于中位）永远够不到它，尖峰检测等于关掉。地板保护的是"中位为 0 的静止片"，
  // 而静止片在下一项死区检查里本来就会红，不需要这里兜。
  const spikeThreshold = 4 * med;

  // 台账里声明的「计划内运动峰值」窗口。给了就只抓窗口外的尖峰。
  const peakWindows = existsSync(ledgerPath) ? parsePeakWindows(readText(ledgerPath)) : null;

  const spikes = [];
  for (let i = 0; i < v.length; i++) {
    if (v[i] > spikeThreshold) spikes.push({ i, t: at(i), val: v[i] });
  }

  const unplanned = peakWindows
    ? spikes.filter((s) => !peakWindows.some(([a, b]) => s.t >= a - 0.2 && s.t <= b + 0.2))
    : spikes;

  if (unplanned.length === 0 && spikes.length > 0 && peakWindows) {
    r.pass(
      '运动曲线无计划外尖峰',
      `${spikes.length} 处峰值全部落在台账声明的 ${peakWindows.length} 个区间内`
    );
  } else if (spikes.length <= allowSpikes) {
    const note = spikes.length
      ? `${spikes.length} 处已在允许范围（--allow-spikes ${allowSpikes}）：${spikes.map((s) => `${s.t.toFixed(2)}s`).join(', ')}`
      : `中位 ${med.toFixed(4)}，阈值 ${spikeThreshold.toFixed(4)}，无尖峰`;
    r.pass('运动曲线无尖峰', note);
  } else {
    const bad = unplanned.length ? unplanned : spikes;
    r.fail('运动曲线有尖峰', `${bad.length} 处计划外尖峰 > 阈值 ${spikeThreshold.toFixed(4)}（允许 ${allowSpikes}）`);
    for (const s of bad.slice(0, 12)) {
      console.log(`        ${s.t.toFixed(2)}s  变化 ${s.val.toFixed(4)}（中位的 ${(s.val / (med || 1e-6)).toFixed(1)}×）`);
    }
    if (bad.length > 12) console.log(`        … 还有 ${bad.length - 12} 处`);
    console.log(`        ${'\x1b[2m'}计划内的峰值请在台账「### 计划内运动峰值」表里声明区间；否则是漏了过渡。${'\x1b[0m'}`);
  }

  // 死区：连续静止段
  //
  // 阈值跟中位走，但留一个**极小的**地板。
  //
  // 之前地板是 0.001，比干净片的中位（0.0001）大 10 倍，成了实际阈值，
  // 连"有 0.6% 呼吸在动"的定版 hold 都被判死——那是把检测关掉。
  // 但完全没有地板也不行：整片静止时中位=0，阈值=0，没有任何帧满足"小于 0"，
  // 于是静止片反而被判成"无死区"。地板取 1e-5（真实噪声级），只兜住中位为 0 这一种情况。
  const stillThreshold = Math.max(med * 0.25, 1e-5);
  let run = 0, best = { len: 0, start: 0 };
  for (let i = 0; i < v.length; i++) {
    if (v[i] < stillThreshold) {
      run++;
      if (run > best.len) best = { len: run, start: i - run + 1 };
    } else run = 0;
  }
  const stillSec = best.len / (probe.fps || 30);
  const stillT0 = at(best.start);
  const stillT1 = at(best.start + best.len);

  // 台账声明了「计划内静止」就只抓窗口外的
  const stillWindows = existsSync(ledgerPath) ? parseStillWindows(readText(ledgerPath)) : null;
  const declared = stillWindows && stillWindows.some(([a, b]) => stillT0 >= a - 0.3 && stillT1 <= b + 0.3);

  if (stillSec <= allowStill) {
    r.pass('中段无死区', `最长静止 ${stillSec.toFixed(2)}s ≤ ${allowStill}s`);
  } else if (declared) {
    r.pass('中段无计划外死区', `${stillSec.toFixed(2)}s 静止落在台账声明的 hold 区间内（${stillT0.toFixed(2)}–${stillT1.toFixed(2)}s）`);
  } else {
    r.fail('中段有死区', `从 ${stillT0.toFixed(2)}s 起静止 ${stillSec.toFixed(2)}s > ${allowStill}s`);
    console.log(`        ${'\x1b[2m'}计划的 hold 请在台账「### 计划内静止」表里声明区间；否则是漏了动作。${'\x1b[0m'}`);
  }
}

/* ---------- 6. 音频 ---------- */

const wantsSound = spec ? spec.sound === true : probe.hasAudio;
if (!wantsSound) {
  r.pass('音频', 'spec 声明无声，跳过');
} else if (!probe.hasAudio) {
  r.fail('音频', 'spec 声明有声音，但成片没有音轨');
} else {
  const db = audioRms(filmPath);
  if (db === null) {
    r.warn('音频', '无法测量响度');
  } else if (db > -70) {
    r.pass('音频', `mean_volume ${db.toFixed(1)} dB（非静音）`);
  } else {
    r.fail('音频', `mean_volume ${db.toFixed(1)} dB（基本静音，检查 score.wav 是否为空）`);
  }
}

/* ---------- 汇总 ---------- */

const { failed, warned } = r.summary();

if (failed > 0) {
  console.log(`${'\x1b[2m'}信 stills 胜过信代码：失败项请抽帧确认，不要只看数字。${'\x1b[0m'}\n`);
}
process.exit(failed > 0 ? 1 : 0);
