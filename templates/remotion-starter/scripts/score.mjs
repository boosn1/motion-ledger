#!/usr/bin/env node
// scripts/score.mjs — 从 cues.json 合成配乐 WAV（纯 Node，零依赖）
//
//   node scripts/score.mjs --cues scripts/cues.json --out public/score.wav
//
// 只用 Node 内置模块：自己算 PCM，自己写 44 字节 WAV 头。
// 硬门禁：bed 与 patterns 都为空时**拒绝出谱**（06-sound.md 的规则）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) out[k] = true;
      else { out[k] = v; i++; }
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const cuesPath = typeof args.cues === 'string' ? args.cues : 'scripts/cues.json';
const outPath = typeof args.out === 'string' ? args.out : 'public/score.wav';
const SR = 48000;

/* ---------------- 工具 ---------------- */

const TAU = Math.PI * 2;
const clamp = (x, a = -1, b = 1) => Math.min(b, Math.max(a, x));

// mulberry32：确定性噪声
function makeRand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ---------------- 乐器 ----------------
 * 每个乐器：(t, dur, hz, gain, rnd) => 样本值
 * 全部闭式解，不积分——任意时刻可直接算。
 */

const INSTRUMENTS = {
  // 有音高：正弦 + 慢起 + 长衰减
  pad(t, dur, hz, gain) {
    const env = Math.min(1, t / 0.35) * Math.exp(-t / (dur * 0.9));
    const vib = 1 + 0.0025 * Math.sin(TAU * 4.5 * t);
    return gain * env * (
      0.55 * Math.sin(TAU * hz * vib * t) +
      0.25 * Math.sin(TAU * hz * 2 * t + 0.4) +
      0.12 * Math.sin(TAU * hz * 3 * t + 1.1)
    );
  },

  // 有音高：拨弦，快起快衰
  pluck(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.28) * Math.min(1, t / 0.004);
    return gain * env * (
      0.7 * Math.sin(TAU * hz * t) +
      0.2 * Math.sin(TAU * hz * 2 * t) +
      0.08 * Math.sin(TAU * hz * 3.01 * t)
    );
  },

  // 有音高：钟，泛音非整数比
  bell(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.9) * Math.min(1, t / 0.003);
    return gain * env * (
      0.6 * Math.sin(TAU * hz * t) +
      0.25 * Math.sin(TAU * hz * 2.76 * t) +
      0.12 * Math.sin(TAU * hz * 5.4 * t) +
      0.06 * Math.sin(TAU * hz * 8.9 * t)
    );
  },

  // 节奏：短促高频点击
  tick(t, dur, hz, gain, rnd) {
    const env = Math.exp(-t / 0.012);
    const n = rnd() * 2 - 1;
    return gain * env * (0.6 * n + 0.4 * Math.sin(TAU * 2200 * t));
  },

  // 节奏：底鼓，低频扫频
  kick(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.11);
    const f = 55 + 110 * Math.exp(-t / 0.03);
    return gain * env * Math.sin(TAU * f * t);
  },

  // 节奏：拍手，噪声爆发
  clap(t, dur, hz, gain, rnd) {
    const env = Math.exp(-t / 0.045) * Math.min(1, t / 0.002);
    return gain * env * (rnd() * 2 - 1) * 0.8;
  },

  // 节奏：踩镲，高通噪声
  hat(t, dur, hz, gain, rnd) {
    const env = Math.exp(-t / 0.02);
    const n = rnd() * 2 - 1;
    // 一阶差分近似高通
    return gain * env * n * 0.5;
  },

  // 点缀：扫风，噪声 + 带通包络
  whoosh(t, dur, hz, gain, rnd) {
    const env = Math.sin(Math.PI * Math.min(1, t / dur)) ** 2;
    const n = rnd() * 2 - 1;
    const center = 900 + 2600 * (t / dur);
    return gain * env * n * 0.45 * Math.sin(TAU * center * t) * 0.3 + gain * env * n * 0.25;
  },

  // 点缀：下落，扫频向下
  drop(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.2) * Math.min(1, t / 0.005);
    const f = 900 * Math.exp(-t / 0.12) + 90;
    return gain * env * Math.sin(TAU * f * t);
  },

  // 点缀：敲击，木质感
  knock(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.07);
    return gain * env * (
      0.5 * Math.sin(TAU * 320 * t) +
      0.3 * Math.sin(TAU * 640 * t + 0.2) +
      0.2 * Math.sin(TAU * 1280 * t + 0.5)
    );
  },

  // 点缀：刮擦
  scratch(t, dur, hz, gain, rnd) {
    const env = Math.exp(-t / 0.08) * Math.min(1, t / 0.01);
    const n = rnd() * 2 - 1;
    return gain * env * n * 0.6;
  },

  // 点缀：低频轰鸣
  boom(t, dur, hz, gain) {
    const env = Math.exp(-t / 0.55);
    const f = 42 * (1 + 0.3 * Math.exp(-t / 0.05));
    return gain * env * Math.sin(TAU * f * t) * 0.9;
  },

  // 环境床：雨（噪声 + 稀疏噼啪）
  ambience_rain(t, dur, hz, gain, rnd) {
    const n = rnd() * 2 - 1;
    const hiss = n * 0.28;
    const drop = rnd() < 0.0009 ? (rnd() * 2 - 1) * 0.9 : 0;
    return gain * (hiss + drop);
  },

  // 环境床：风（低频噪声起伏）
  ambience_wind(t, dur, hz, gain, rnd) {
    const n = rnd() * 2 - 1;
    const sway = 0.5 + 0.5 * Math.sin(TAU * 0.13 * t);
    return gain * n * 0.3 * sway;
  },

  // 环境床：房间（极低噪声 + 轻微驻波）
  ambience_room(t, dur, hz, gain, rnd) {
    const n = rnd() * 2 - 1;
    return gain * (n * 0.06 + 0.04 * Math.sin(TAU * 62 * t));
  },
};

const ALIASES = {
  ambience: 'ambience_room',
  'ambience(rain)': 'ambience_rain',
  'ambience(wind)': 'ambience_wind',
  'ambience(room)': 'ambience_room',
};

function resolveInstrument(name) {
  if (!name) return null;
  const key = ALIASES[name] || name;
  return INSTRUMENTS[key] ? key : null;
}

/* ---------------- 合成 ---------------- */

function synth(cues) {
  const { duration, bpm, palette = [], bed = [], patterns = [], events = [] } = cues;
  const total = Math.round(duration * SR);
  const buf = new Float64Array(total);
  const rnd = makeRand(0x5EED);

  const addNote = (startSec, durSec, inst, hz, gain) => {
    const fn = INSTRUMENTS[inst];
    if (!fn) return;
    const s0 = Math.round(startSec * SR);
    const n = Math.round(durSec * SR);
    for (let i = 0; i < n; i++) {
      const idx = s0 + i;
      if (idx < 0 || idx >= total) continue;
      buf[idx] += fn(i / SR, durSec, hz, gain, rnd);
    }
  };

  // bed：铺底
  for (const b of bed) {
    const inst = resolveInstrument(b.inst);
    if (!inst) continue;
    const gain = b.gain ?? 0.18;
    const notes = (b.notes || []).length ? b.notes : [220];
    const dur = b.dur ?? duration;
    // 长床切成 2 秒片，避免单个指数衰减包络把整段压没
    const slice = Math.min(2, dur);
    for (let s = 0; s < dur; s += slice * 0.85) {
      const d = Math.min(slice, dur - s);
      if (d <= 0.02) break;
      for (const hz of notes) addNote((b.at ?? 0) + s, d, inst, hz, gain);
    }
  }

  // patterns：节奏型
  for (const p of patterns) {
    const inst = resolveInstrument(p.inst);
    if (!inst) continue;
    const every = p.every ?? (60 / (bpm || 120));
    const from = p.from ?? 0;
    const to = p.to ?? duration;
    const gain = p.gain ?? 0.22;
    const notes = (p.notes || []).length ? p.notes : [0];
    let k = 0;
    for (let t = from; t < to - 1e-6; t += every) {
      const hz = notes[k % notes.length];
      addNote(t, Math.min(every * 1.6, 1.2), inst, hz || 440, gain);
      k++;
    }
  }

  // events：单点音效
  for (const e of events) {
    const inst = resolveInstrument(e.inst);
    if (!inst) continue;
    const gain = e.gain ?? 0.4;
    const hz = e.hz ?? (e.note != null ? midiToHz(e.note) : 440);
    addNote(e.at ?? 0, e.dur ?? 0.8, inst, hz, gain);
  }

  return buf;
}

/* ---------------- 后处理 ---------------- */

function normalize(buf, targetPeak = 0.89) {
  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > peak) peak = a;
  }
  if (peak < 1e-9) return { peak: 0, applied: false };
  const k = targetPeak / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return { peak, applied: true, gain: k };
}

// 循环：尾部折进开头（把末尾 fadeLen 秒交叉淡入到开头）
function foldTail(buf, fadeSec, sampleRate) {
  const n = Math.round(fadeSec * sampleRate);
  if (n <= 0 || n * 2 >= buf.length) return false;
  const total = buf.length;
  for (let i = 0; i < n; i++) {
    const w = i / n;                    // 0→1
    const tail = buf[total - n + i];
    buf[i] = buf[i] * w + tail * (1 - w);
  }
  // 尾部淡出，避免和开头叠加后爆音
  for (let i = 0; i < n; i++) {
    const w = i / n;
    buf[total - n + i] *= (1 - w);
  }
  return true;
}

function fadeInOut(buf, sec, sampleRate) {
  const n = Math.round(sec * sampleRate);
  for (let i = 0; i < n && i < buf.length; i++) {
    const w = i / n;
    buf[i] *= w;
    buf[buf.length - 1 - i] *= w;
  }
}

/* ---------------- WAV ---------------- */

function encodeWav(buf, sampleRate) {
  const channels = 1;
  const bits = 16;
  const bytesPerSample = bits / 8;
  const dataSize = buf.length * bytesPerSample;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);              // fmt chunk size
  header.writeUInt16LE(1, 20);               // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
  header.writeUInt16LE(channels * bytesPerSample, 32);               // block align
  header.writeUInt16LE(bits, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < buf.length; i++) {
    const v = clamp(buf[i], -1, 1);
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return Buffer.concat([header, data]);
}

/* ---------------- 主流程 ---------------- */

if (!existsSync(cuesPath)) {
  console.error(`\n✗ 找不到 ${cuesPath}\n`);
  process.exit(2);
}

let cues;
try {
  cues = JSON.parse(readFileSync(cuesPath, 'utf8'));
} catch (e) {
  console.error(`\n✗ ${cuesPath} 不是合法 JSON：${e.message}\n`);
  process.exit(2);
}

const bed = cues.bed || [];
const patterns = cues.patterns || [];

// 硬门禁：既无音乐也无 ambience → 拒绝出谱
const hasPitched = [...bed, ...patterns].some((x) => resolveInstrument(x.inst));
const hasAmbience = [...bed, ...patterns].some((x) => String(x.inst || '').startsWith('ambience'));

if (!hasPitched && !hasAmbience) {
  console.error('\n✗ 拒绝出谱：cues.json 里既没有音乐床（bed/patterns）也没有 ambience。');
  console.error('  这是硬门禁——静音片请在 spec.ts 里写 FILM.sound = false，不要交一个空音轨。\n');
  process.exit(1);
}

const duration = Number(cues.duration);
if (!Number.isFinite(duration) || duration <= 0) {
  console.error('\n✗ cues.json 缺少合法的 duration\n');
  process.exit(2);
}

const buf = synth(cues);
const norm = normalize(buf);

if (cues.loop) foldTail(buf, 0.35, SR);
fadeInOut(buf, 0.02, SR);

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, encodeWav(buf, SR));

/* ---------------- 报告 ---------------- */

const seconds = buf.length / SR;
const usedInstruments = [...new Set(
  [...bed, ...patterns, ...(cues.events || [])]
    .map((x) => resolveInstrument(x.inst))
    .filter(Boolean)
)];

console.log('');
console.log(`  ✓ 已生成 ${outPath}`);
console.log(`    时长 ${seconds.toFixed(2)}s / ${SR}Hz / 单声道 16bit`);
console.log(`    乐器 ${usedInstruments.join(', ')}`);
console.log(`    事件 ${(cues.events || []).length} 个 / 床 ${bed.length} 条 / 节奏型 ${patterns.length} 条`);
console.log(`    峰值归一化 ${norm.applied ? `×${norm.gain.toFixed(2)}（原峰 ${norm.peak.toFixed(3)}）` : '跳过（全静音）'}`);
if (cues.loop) console.log(`    循环：尾部 0.35s 已折进开头`);
console.log('');

if (Math.abs(seconds - duration) > 0.01) {
  console.error(`  ⚠ 音频时长 ${seconds.toFixed(3)}s 与 cues.duration ${duration}s 不一致\n`);
  process.exit(1);
}
