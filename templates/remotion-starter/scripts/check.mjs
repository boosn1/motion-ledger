#!/usr/bin/env node
// check.mjs — 抽帧自查。**信 stills 胜过信代码。**
//
//   node scripts/check.mjs
//   TIMES="1.2,3.0,13.4,25.0,30.2,38.0,41.0,47.5,53.0" node scripts/check.mjs
//
// 产出 out/check/：
//   sheet.png    关键时刻拼图
//   still-*.png  单帧
//   motion.txt   相邻帧差曲线
//   audio.png    波形图
//
// 需要 ffmpeg / ffprobe 在 PATH 上。零 npm 依赖。

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'out');
const CHECK = resolve(OUT, 'check');
const FILM = resolve(OUT, 'film.mp4');
const LEDGER = resolve(ROOT, 'LEDGER.md');

/**
 * 从台账读「计划内运动峰值」表。
 *
 * 这是这套门禁和「凭感觉看一眼」的分界：尖峰不是自动判坏的，
 * 台账声明了哪个区间允许有峰值，代码只核对声明。没声明就动的东西才是 bug。
 */
function readPeakWindows() {
  if (!existsSync(LEDGER)) return null;
  const text = readFileSync(LEDGER, 'utf8');
  const sec = text.split(/^###\s*计划内运动峰值\s*$/m)[1];
  if (!sec) return null;
  const out = [];
  for (const line of sec.split('\n')) {
    const m = line.match(/^\|\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*\|/);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out.length ? out : null;
}

const peakWindows = readPeakWindows();

// 抽帧时刻。**默认跟片长走**，不写死——所以这里只存原始表达式，等拿到 dur 再算。
//
// 写死过一版（示例片 60 秒用的 1.2,3.0,13.4,25.0,...,53.0），结果 15 秒的 starter
// 一跑就「拼图失败」——因为 25.0 秒这种时刻在这支片里根本不存在，ffmpeg seek 越界，
// 九张里只抽出来三张，拼图凑不齐。**默认值必须对任何片长都成立。**
//
// 规则：在 [0.04, 0.96] × 片长 上等距取 9 个点。想看特定时刻就显式给 TIMES。
const TIMES_ENV = process.env.TIMES;

const passes = [];
const failures = [];

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) {
    console.error(`\n✗ 跑不了 ${cmd}：${r.error.message}`);
    console.error('  确认 ffmpeg / ffprobe 在 PATH 上。\n');
    process.exit(2);
  }
  return { ...r, text: r.stdout ? r.stdout.toString('utf8') : '', errText: r.stderr ? r.stderr.toString('utf8') : '' };
}

if (!existsSync(FILM)) {
  console.error(`\n✗ 找不到 ${FILM}\n  先跑：npm run render\n`);
  process.exit(2);
}

rmSync(CHECK, { recursive: true, force: true });
mkdirSync(CHECK, { recursive: true });

/* ── 1. 格式 ── */
// 只取第一条视频流：不加 -select_streams 时音频流也会被列出来，
// 它的 r_frame_rate 是 0/0，会在 Object.fromEntries 里覆盖掉视频的真实帧率，
// 于是打印出「@ 0/0」这种看着像坏了的读数。
const probe = run('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate,codec_type',
  '-of', 'default=nw=1',
  FILM,
]);
const info = Object.fromEntries(
  probe.text
    .split('\n')
    .map((l) => l.split('='))
    .filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()])
);
// 时长要单独问 format（-select_streams 会把 format 段一起吞掉）
const durProbe = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1', FILM]);
const dur = Number(durProbe.text.split('\n').find((l) => l.startsWith('duration='))?.slice(9));

// 抽帧时刻：默认在 [0.04, 0.96] × 片长 上等距取 9 个点，任何片长都成立；
// 显式给 TIMES 就用给的，越界的一律夹回片尾前 0.1 秒。
const DEFAULT_TIMES = Array.from({ length: 9 }, (_, i) => (0.04 + (0.92 * i) / 8) * dur);
const times = (TIMES_ENV ? TIMES_ENV.split(',').map((s) => Number(s.trim())) : DEFAULT_TIMES)
  .filter((n) => Number.isFinite(n))
  .map((n) => Math.min(n, Math.max(0, dur - 0.1)));

console.log('');
console.log(`  成片 ${info.width}×${info.height} @ ${info.r_frame_rate} / ${dur.toFixed(2)}s`);
passes.push('格式读取成功');

/* ── 2. 抽帧 ── */
const stills = [];
for (const t of times) {
  const name = `still-${t.toFixed(2)}.png`;
  const r = run('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', FILM, '-frames:v', '1', resolve(CHECK, name)]);
  if (r.status !== 0) {
    failures.push(`抽帧失败 t=${t}`);
    continue;
  }
  stills.push({ t, name });
}
console.log(`  抽帧 ${stills.length}/${times.length}`);

/* ── 3. 拼图（不带 drawtext，避免字体依赖）── */
if (stills.length >= 2) {
  const inputs = stills.flatMap((s) => ['-i', resolve(CHECK, s.name)]);
  const n = stills.length;
  const cols = Math.min(3, n);
  const layout = stills.map((_, i) => `${(i % cols) * 640}_${Math.floor(i / cols) * 360}`).join('|');
  const filter =
    stills.map((_, i) => `[${i}:v]scale=640:360,setsar=1[v${i}]`).join(';') +
    ';' + stills.map((_, i) => `[v${i}]`).join('') +
    `xstack=inputs=${n}:layout=${layout}:fill=black[out]`;
  const r = run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', resolve(CHECK, 'sheet.png')]);
  if (r.status === 0) passes.push('关键时刻拼图');
  else failures.push('拼图失败（单帧仍可用）');
}

/* ── 4. 运动曲线 ── */
// 采样密度必须跟片长走，不能写死。
//
// starter 里是 SAMPLES = 96：对 15 秒片是每 0.16 秒一个采样，够用；
// 对 60 秒片变成每 0.63 秒一个，两帧之间隔了 19 帧——入场、换字幕、元素滑入
// 全被压进一个采样间隔里，于是每一次「采样点正好跨过一段运动」都被判成尖峰。
// 实测：60 秒片用 96 采样报 2 处假尖峰，用逐帧采样（这里 1 秒 = 30 采样）全部消失。
//
// 所以：采样数 = 片长 × 15，下限 96、上限 1800。这样 15 秒片仍是 225（≥96 原行为），
// 60 秒片是 900，1 秒 15 个采样——足够看清每一次入场，又不至于把整片抽成逐帧（那太慢）。
const SAMPLES = Math.max(96, Math.min(1800, Math.round(dur * 15)));
const SW = 96;
const SH = 54;
const grays = [];
for (let i = 0; i < SAMPLES; i++) {
  const t = (i / (SAMPLES - 1)) * Math.max(0, dur - 0.05);
  const r = run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', FILM, '-frames:v', '1', '-vf', `scale=${SW}:${SH},format=gray`, '-f', 'rawvideo', '-']);
  if (r.status === 0 && r.stdout && r.stdout.length >= SW * SH) grays.push(r.stdout);
}

if (grays.length >= 8) {
  const vals = [];
  for (let i = 1; i < grays.length; i++) {
    const a = grays[i - 1];
    const b = grays[i];
    let sum = 0;
    for (let k = 0; k < SW * SH; k++) sum += Math.abs(a[k] - b[k]);
    vals.push(sum / (SW * SH) / 255);
  }
  writeFileSync(resolve(CHECK, 'motion.txt'), vals.map((v) => v.toFixed(6)).join('\n'), 'utf8');

  const sorted = [...vals].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)];
  const step = Math.max(0, dur - 0.05) / (vals.length - 1);

  if (med <= 0.01 / 255) {
    failures.push(`整片几乎静止（中位帧差 ${med.toExponential(2)}）——会被当成 PPT`);
  } else {
    passes.push(`运动中位 ${med.toExponential(2)}（${SAMPLES} 采样 / 每 ${step.toFixed(2)}s 一个）`);
  }

  const spikes = vals
    .map((v, i) => ({ v, t: (i + 1) * step }))
    .filter(({ v }) => v > 4 * med);

  if (spikes.length) {
    // 台账声明了窗口就只抓窗口外的；没声明就全部算计划外（严格模式）
    const unplanned = peakWindows
      ? spikes.filter((s) => !peakWindows.some(([a, b]) => s.t >= a - 0.2 && s.t <= b + 0.2))
      : spikes;

    if (unplanned.length) {
      const list = [...unplanned].sort((a, b) => b.v - a.v);
      const detail = list.map((s) => s.t.toFixed(2) + 's(' + (s.v / med).toFixed(0) + 'x)').join(' ');
      failures.push(`${list.length} 处计划外尖峰：${detail}`);
    } else {
      passes.push(`${spikes.length} 处尖峰全部落在台账声明区间内`);
    }
  } else {
    passes.push('无计划外尖峰');
  }

  const stillThr = Math.max(med * 0.06, 1e-5);
  let runLen = 0;
  let maxStill = 0;
  for (const v of vals) {
    if (v < stillThr) {
      runLen++;
      maxStill = Math.max(maxStill, runLen);
    } else runLen = 0;
  }
  const stillSec = maxStill * step;
  if (stillSec > 1.5) {
    failures.push(`最长静止 ${stillSec.toFixed(2)}s > 1.5s（死区）`);
  } else {
    passes.push(`无长死区（最长 ${stillSec.toFixed(2)}s）`);
  }
} else {
  failures.push('抽不到足够帧，运动曲线不可信');
}
/* ── 5. 音频 ── */
const audioProbe = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', FILM]);
if (audioProbe.text.trim()) {
  const vol = run('ffmpeg', ['-v', 'info', '-i', FILM, '-af', 'volumedetect', '-f', 'null', '-']);
  const m = (vol.errText || '').match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  if (m) {
    const mean = Number(m[1]);
    if (mean < -50) failures.push(`有音轨但基本静音（${mean} dB）`);
    else passes.push(`音频均值 ${mean} dB`);
  }
  run('ffmpeg', ['-v', 'error', '-y', '-i', FILM, '-filter_complex', '[0:a]showwavespic=s=1200x200:colors=#C4553B[out]', '-map', '[out]', '-frames:v', '1', resolve(CHECK, 'audio.png')]);
} else {
  passes.push('无音轨');
}

/* ── 报告 ── */
console.log('');
for (const p of passes) console.log(`  ✓ ${p}`);
for (const f of failures) console.log(`  ✗ ${f}`);
console.log('');
console.log(`  产物在 ${CHECK}`);
console.log('');

process.exit(failures.length ? 1 : 0);
