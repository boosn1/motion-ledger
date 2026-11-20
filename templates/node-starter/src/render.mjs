// render.mjs — 入口：把每一帧画出来，pipe 给 ffmpeg 编成 MP4。
//
// ledger-file-allow: 渲染入口，只含 CLI 参数、路径与 ffmpeg 调用，没有设计决定
//
// 为什么走 pipe 而不是自己写 MP4：
//   ffmpeg 本来就是门禁的依赖（抽帧、运动曲线、音频检测都要它），
//   所以"零 npm 依赖"依然成立——这里没有引入任何新的包。
//
// 为什么不用 PNG 中间文件：
//   1080p 一帧 PNG 编码要几十毫秒，450 帧就是十几秒纯 IO；
//   rawvideo pipe 省掉编码和磁盘往返，而且不会在仓库里留一堆图。
//
// 用法：
//   node src/render.mjs                    → out/film.mp4
//   node src/render.mjs --scale 0.5        → 半尺寸快渲
//   node src/render.mjs --still 3.0        → 只出 t=3.0s 的单帧 PNG
//   node src/render.mjs --frames 0-90      → 只渲一段

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCanvas, verticalGradient } from './raster.mjs';
import { drawScene } from './film.mjs';
import { FILM, COLOR } from './spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------- 参数 ---------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const scale = args.scale === undefined ? 1 : Number(args.scale);
const width = Math.round((FILM.width || 1920) * scale);
const height = Math.round((FILM.height || 1080) * scale);
const fps = FILM.fps || 30;
const duration = FILM.duration || 15;
const totalFrames = Math.round(duration * fps);

// 分段渲染：--frames 0-90
let from = 0, to = totalFrames;
if (typeof args.frames === 'string') {
  const [a, b] = args.frames.split('-').map(Number);
  if (Number.isFinite(a)) from = a;
  if (Number.isFinite(b)) to = b + 1;
}

/* ---------- 画一帧 ---------- */

function renderFrame(t) {
  const cv = createCanvas(width, height, [0, 0, 0]);
  // 底色渐变属于"环境"，画在最底层；场景里的一切盖在它上面
  verticalGradient(cv, COLOR.bgTop || '#16261F', COLOR.bgBottom || '#0E1A15');
  // drawScene 内部的坐标按 FILM 的设计尺寸写死，scale 时整体缩放
  if (scale === 1) {
    drawScene(cv, t);
  } else {
    const big = createCanvas(FILM.width, FILM.height, [0, 0, 0]);
    verticalGradient(big, COLOR.bgTop || '#16261F', COLOR.bgBottom || '#0E1A15');
    drawScene(big, t);
    downscaleInto(big, cv);
  }
  return cv;
}

/** 最近邻缩放到目标画布（够用：门禁看的是运动结构，不是画质） */
function downscaleInto(src, dst) {
  const sx = src.w / dst.w, sy = src.h / dst.h;
  for (let y = 0; y < dst.h; y++) {
    const syi = Math.min(src.h - 1, Math.floor(y * sy));
    for (let x = 0; x < dst.w; x++) {
      const sxi = Math.min(src.w - 1, Math.floor(x * sx));
      const si = (syi * src.w + sxi) * 3;
      const di = (y * dst.w + x) * 3;
      dst.buf[di] = src.buf[si];
      dst.buf[di + 1] = src.buf[si + 1];
      dst.buf[di + 2] = src.buf[si + 2];
    }
  }
}

/* ---------- 单帧 PNG（给门禁抽帧 / 人工检查） ---------- */

function writePng(file, cv) {
  mkdirSync(dirname(file), { recursive: true });
  // 走 ffmpeg：rawvideo → png。避免自己实现 PNG 编码器（那是另一个坑）。
  const r = spawnSync('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24',
    '-s', `${cv.w}x${cv.h}`, '-i', 'pipe:0',
    '-frames:v', '1', file,
  ], { input: Buffer.from(cv.buf), encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`ffmpeg 写 PNG 失败：${r.stderr?.toString() || r.error?.message}`);
  }
}

/* ---------- 主流程 ---------- */

if (typeof args.still === 'string' || args.still === true) {
  const t = Number(args.still === true ? 0 : args.still);
  const out = resolve(ROOT, typeof args.out === 'string' ? args.out : `out/still-${t.toFixed(2)}.png`);
  writePng(out, renderFrame(t));
  console.log(`✓ 单帧 t=${t}s → ${out}`);
  process.exit(0);
}

const outFile = resolve(ROOT, typeof args.out === 'string' ? args.out : 'out/film.mp4');
mkdirSync(dirname(outFile), { recursive: true });

const wavFile = resolve(ROOT, 'public/score.wav');
const hasAudio = existsSync(wavFile);

// ffmpeg 的参数顺序有硬要求：**所有 -i 必须在所有输出选项之前**。
// 把 -c:v 写在第二个 -i 前面，它会被当成那个输入的选项，
// 报 Unknown decoder 'libx264'，然后整个命令崩掉。
const ffArgs = [
  '-v', 'error', '-y',
  '-f', 'rawvideo', '-pix_fmt', 'rgb24',
  '-s', `${width}x${height}`, '-r', String(fps),
  '-i', 'pipe:0',
  ...(hasAudio ? ['-i', wavFile] : []),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p',
  ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
  outFile,
];

const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

// ffmpeg 先死时 stdin 会 EPIPE。不接住它，Node 会把整段堆栈抛出来，
// 盖掉上面那句真正的错误原因（比如参数顺序错了）。
ff.stdin.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e;
});

const n = to - from;
let written = 0;

async function pump() {
  for (let i = from; i < to; i++) {
    const t = i / fps;
    const cv = renderFrame(t);
    const ok = ff.stdin.write(Buffer.from(cv.buf));
    if (!ok) await new Promise((res) => ff.stdin.once('drain', res));
    written++;
    if (written % fps === 0 || written === n) {
      const pct = ((written / n) * 100).toFixed(0);
      process.stdout.write(`\r  渲染 ${written}/${n} 帧 (${pct}%)`);
    }
  }
  ff.stdin.end();
}

pump().then(() => {
  ff.on('close', (code) => {
    process.stdout.write('\n');
    if (code !== 0) {
      console.error(`✗ ffmpeg 退出码 ${code}`);
      process.exit(1);
    }
    console.log(`✓ ${width}×${height} @ ${fps}fps, ${n} 帧 → ${outFile}`);
    console.log(`  下一步：node verify/film.mjs --film ${outFile} --spec src/spec.mjs --ledger LEDGER.md`);
  });
}).catch((e) => {
  console.error('✗ 渲染失败：', e.message);
  try { ff.kill(); } catch { /* 已经退了 */ }
  process.exit(1);
});
