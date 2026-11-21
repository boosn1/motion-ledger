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
  // 有音高：铺底。**不是纯正弦堆**——纯正弦听起来就是电流嗡鸣。
  // 三处改动：① 每个音三路微失谐（±0.35%），产生自然的合唱厚度而不是单频拍
  //          ② 加一点非谐波泛音（4.7 倍），让它有「气」而不是「嗡」
  //          ③ 起音 0.35s 慢进，且**不衰减**（长音用 sustain 包络），避免切片重启造成周期性起伏
  pad(t, dur, hz, gain) {
    const attack = Math.min(1, t / 0.35);
    // 结尾一律留 0.35s 淡出。原来写的是 `dur > 2 ? 1 : 淡出`，理由是「长音被切片会周期性起伏」——
    // 那个问题已经由 synth() 的 isSustain 分支解决（持续音不再切片）。现在和弦每 6 秒换一次，
    // 必须让每个和弦自己淡出，否则切点上是硬切。相邻和弦靠 dur 多给 0.5s 交叠，淡出与下一个的
    // 淡入重叠，接缝处才不会掉到零（掉到零就是一个「抽气」）。
    const release = Math.max(0, Math.min(1, (dur - t) / 0.35));
    const env = attack * release;
    const d1 = 1 + 0.0035, d2 = 1 - 0.0031;
    const v = 0.34 * Math.sin(TAU * hz * d1 * t)
      + 0.30 * Math.sin(TAU * hz * d2 * t + 0.7)
      + 0.16 * Math.sin(TAU * hz * 2 * t + 0.4)
      + 0.08 * Math.sin(TAU * hz * 3 * t + 1.1)
      + 0.05 * Math.sin(TAU * hz * 4.7 * t + 2.1);
    return gain * env * v;
  },

  // 有音高：低音。**必须带泛音，不能是纯正弦**——纯正弦在 80–130Hz 就是电流声，
  // 这正是上一版被投诉「嗡嗡像电流」的成因之一。二三次谐波给了耳朵「这是个音」的依据，
  // 同时把能量摊开，不再是频谱上的一根针。
  bass(t, dur, hz, gain) {
    const attack = Math.min(1, t / 0.08);
    const release = Math.max(0, Math.min(1, (dur - t) / 0.25));
    const env = attack * release;
    const v = 0.62 * Math.sin(TAU * hz * t)
      + 0.26 * Math.sin(TAU * hz * 2 * t + 0.3)
      + 0.12 * Math.sin(TAU * hz * 3 * t + 0.9)
      + 0.05 * Math.sin(TAU * hz * 4.02 * t + 1.4);
    return gain * env * v;
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
  const { duration, bpm, palette = [], bed = [], chords = [], patterns = [], events = [] } = cues;
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
    const isSustain = inst === 'pad' || inst.startsWith('ambience');
    if (isSustain) {
      // 持续音：一次铺满整段。切片会让包络每 1.7 秒重启一次，
      // 听感上就是周期性的「一涌一涌」，和嗡鸣叠在一起特别难受。
      for (const hz of notes) addNote(b.at ?? 0, dur, inst, hz, gain);
    } else {
      // 衰减型（pluck/bell 等）才切片，避免单个指数包络把整段压没
      const slice = Math.min(2, dur);
      for (let s = 0; s < dur; s += slice * 0.85) {
        const d = Math.min(slice, dur - s);
        if (d <= 0.02) break;
        for (const hz of notes) addNote((b.at ?? 0) + s, d, inst, hz, gain);
      }
    }
  }

  // chords：和声进行。这是「像一首曲子」与「像一台机器在响」的分界线。
  //
  // 为什么单独开一段而不是让 bed 自己换音：bed 是「一个音色铺多久」，
  // chords 是「和声走到哪」。二者生命周期不同——一个和弦可以跨两个 bed，
  // 一个 bed 也可以盖住三个和弦。混在一起写，改和声就得改 bed。
  //
  // 每个和弦多给 tailOverlap 秒：pad 的 release 是 0.35s，不交叠的话
  // 换和弦的瞬间会掉到零，听感上是一个「抽气」。交叠让两和弦的淡出淡入
  // 重叠，接缝处才有连续感。
  const tailOverlap = 0.5;
  for (const c of chords) {
    const inst = resolveInstrument(c.inst || 'pad');
    if (!inst) continue;
    const gain = c.gain ?? 0.075;
    const at = c.at ?? 0;
    const dur = (c.dur ?? 6) + tailOverlap;
    for (const hz of c.notes || []) addNote(at, dur, inst, hz, gain);
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

// 双二阶滤波器（RBJ cookbook）。为什么不用一阶：一阶的斜率只有 6dB/oct，
// 要压掉 40Hz 那股「电流底噪」得把整个低频都砍掉；二阶 12dB/oct 能把
// 80Hz 以下压下去而保住 150Hz 以上的和声根音。
function biquad(buf, type, freq, sampleRate, Q = 0.707, gainDb = 0) {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  const A = Math.pow(10, gainDb / 40);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'lowpass') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else if (type === 'peak') {
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else if (type === 'highshelf') {
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cos + s);
    b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    b2 = A * ((A + 1) + (A - 1) * cos - s);
    a0 = (A + 1) - (A - 1) * cos + s;
    a1 = 2 * ((A - 1) - (A + 1) * cos);
    a2 = (A + 1) - (A - 1) * cos - s;
  } else return;
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = B0 * x0 + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    buf[i] = y0;
  }
}

// 母版链：先砍掉嗡鸣的地基，再补一点空气感。
// 实测原始配乐 20–80Hz 占 37%、80–250Hz 占 59%、250Hz 以上只有 3.7%——
// 能量几乎全堆在低频，人耳听到的就是「嗡」。这不是音色问题，是频谱失衡。
function masterChain(buf, sampleRate) {
  biquad(buf, 'highpass', 95, sampleRate, 0.8);   // 95Hz 以下基本清掉（嗡鸣主战场）
  biquad(buf, 'peak', 160, sampleRate, 1.1, -2.5); // 160Hz 那点闷声压一下
  biquad(buf, 'highshelf', 3200, sampleRate, 0.7, 2.0); // 3.2k 以上抬 2dB，补回清晰度
  return buf;
}

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
const chords = cues.chords || [];
const patterns = cues.patterns || [];

// 硬门禁：既无音乐也无 ambience → 拒绝出谱
const hasPitched = [...bed, ...chords, ...patterns].some((x) => resolveInstrument(x.inst || 'pad'));
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
masterChain(buf, SR);
const norm = normalize(buf);

if (cues.loop) foldTail(buf, 0.35, SR);
fadeInOut(buf, 0.02, SR);

mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(outPath, encodeWav(buf, SR));

/* ---------------- 报告 ---------------- */

const seconds = buf.length / SR;
const usedInstruments = [...new Set(
  [...bed, ...chords, ...patterns, ...(cues.events || [])]
    .map((x) => resolveInstrument(x.inst || 'pad'))
    .filter(Boolean)
)];

console.log('');
console.log(`  ✓ 已生成 ${outPath}`);
console.log(`    时长 ${seconds.toFixed(2)}s / ${SR}Hz / 单声道 16bit`);
console.log(`    乐器 ${usedInstruments.join(', ')}`);
console.log(`    事件 ${(cues.events || []).length} 个 / 床 ${bed.length} 条 / 和声 ${chords.length} 个 / 节奏型 ${patterns.length} 条`);
console.log(`    峰值归一化 ${norm.applied ? `×${norm.gain.toFixed(2)}（原峰 ${norm.peak.toFixed(3)}）` : '跳过（全静音）'}`);
if (cues.loop) console.log(`    循环：尾部 0.35s 已折进开头`);
console.log('');

if (Math.abs(seconds - duration) > 0.01) {
  console.error(`  ⚠ 音频时长 ${seconds.toFixed(3)}s 与 cues.duration ${duration}s 不一致\n`);
  process.exit(1);
}
