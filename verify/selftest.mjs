#!/usr/bin/env node
// verify/selftest.mjs — 门禁自测（证明门禁真的会红/会绿，不是摆设）
//
//   node verify/selftest.mjs
//
// 在系统临时目录里造夹具（不污染仓库），跑三组断言：
//   A. spec.mjs  正例 → 必须 PASS；反例 → 必须 FAIL 且命中预期项
//   B. film.mjs  运动片 → 必须 PASS；静止片/坏接缝/静音 → 必须 FAIL
//   C. 清理临时目录
//
// 退出码：0 全部断言通过 / 1 有断言失败 / 2 环境缺失（无 ffmpeg）

import {
  mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { hasBinary, runCaptured } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const SPEC = join(HERE, 'spec.mjs');
const FILM = join(HERE, 'film.mjs');

const C = {
  pass: '\x1b[32m', fail: '\x1b[31m', dim: '\x1b[2m',
  bold: '\x1b[1m', reset: '\x1b[0m',
};

let total = 0, bad = 0;

function check(name, ok, detail = '') {
  total++;
  if (ok) {
    console.log(`  ${C.pass}PASS${C.reset}  ${name}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`);
  } else {
    bad++;
    console.log(`  ${C.fail}FAIL${C.reset}  ${name}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}`);
  }
}

// 跑一个脚本，返回 { code, out }
// 不用 spawnSync 的 pipe（沙箱/受限环境会 EPERM），走 lib 的文件重定向
function run(script, args, cwd) {
  const r = runCaptured(process.execPath, [script, ...args], { cwd });
  if (r.error) return { code: null, out: r.error };
  return { code: r.status, out: r.stdout.toString('utf8') + (r.stderr || '') };
}

// 跑 ffmpeg（只关心退出码）
function ff(args) {
  const r = runCaptured('ffmpeg', ['-v', 'error', '-y', ...args], { wantStdout: false });
  return !r.error && r.status === 0;
}

if (!hasBinary('ffmpeg') || !hasBinary('ffprobe')) {
  console.log(`\n${C.fail}找不到 ffmpeg / ffprobe，无法跑 film 门禁自测。${C.reset}`);
  console.log(`${C.dim}spec 门禁自测不需要 ffmpeg，可单独跑：node verify/spec.mjs --help 不存在，看 README。${C.reset}\n`);
  process.exit(2);
}

const dir = mkdtempSync(join(tmpdir(), 'ml-selftest-'));
console.log(`\n${C.bold}motion-ledger · 门禁自测${C.reset}`);
console.log(`${C.dim}临时目录 ${dir}${C.reset}\n`);

try {
  /* ================= A. spec.mjs ================= */

  console.log(`${C.bold}A. spec.mjs${C.reset}`);

  const ledger = `# 测试台账

## S 表

| id | 原文引用 | 落地位置 |
|---|---|---|
| S01 | "2 秒" | FILM.duration |
| S02 | "深墨绿 #1B3A2F" | COLOR.bg |
| S03 | "米白 #F4F1EA" | COLOR.ink |
| S04 | "朱红 #C4553B" | COLOR.accent |
| S05 | "五个字" | COPY.chars |
| S06 | "『静水流深』" | COPY.title |
| S07 | "汇成一个计时器" | X01 |
| S08 | "长成字标" | X02 |
| S09 | "Inter 800 96px" | TYPE.title |
| S10* | （推测）320×180 30fps | FILM.width |

## X 表

| id | 源 | 目标 | 机制 | 起-止(s) | 守恒什么 |
|---|---|---|---|---|---|
| X01 | 五个字 | 计时器 | converge | 0.5–1.0 | 字数量 |
| X02 | 计时器 | 字标 | chain | 1.0–1.5 | 槽位 |

## E 表

| id | 元素 | playbook | 3+ 结构特征 | 尺寸/坐标 | 怎么动 |
|---|---|---|---|---|---|
| E01 | 背景 | Environment | 上浅下深 / 接缝 / 右侧光源 | 全幅 | 静止 |
| E02 | 五个字 | Type | Inter 800 / 96px / -0.02em | 散落 | 逐个入场 |
| E03 | 计时器 | Object | 外圈 / 五刻度 / 朱红指针 | 直径 320 | 匀速转 |
`;

  // A1 正例
  const okDir = join(dir, 'a-ok');
  mkdirSync(join(okDir, 'src'), { recursive: true });
  writeFileSync(join(okDir, 'LEDGER.md'), ledger);
  writeFileSync(join(okDir, 'src', 'spec.ts'), `
export const FILM = { duration: 2, fps: 30, width: 320, height: 180, sound: false, loop: false }; // S01 S10
export const COLOR = { bg: '#1B3A2F', ink: '#F4F1EA', accent: '#C4553B' }; // S02 S03 S04
export const TYPE = { title: { family: 'Inter', weight: 800, size: 96 } }; // S09
export const COPY = { chars: ['静','水','流','深','处'], title: '静水流深' }; // S05 S06
// E01 E02 E03 X01 X02 S07 S08
export const parts = [];
`);
  const a1 = run(SPEC, ['--ledger', 'LEDGER.md', '--src', 'src'], okDir);
  check('正例应通过', a1.code === 0, `exit ${a1.code}`);

  // A2 覆盖率缺失
  const missDir = join(dir, 'a-miss');
  mkdirSync(join(missDir, 'src'), { recursive: true });
  writeFileSync(join(missDir, 'LEDGER.md'), ledger);
  writeFileSync(join(missDir, 'src', 'spec.ts'), `
export const FILM = { duration: 2, fps: 30, width: 320, height: 180, sound: false, loop: false }; // S01
`);
  const a2 = run(SPEC, ['--ledger', 'LEDGER.md', '--src', 'src'], missDir);
  check('覆盖率缺失应 FAIL', a2.code === 1 && /台账覆盖率/.test(a2.out), `exit ${a2.code}`);

  // A3 占位符 + 禁用项
  const badDir = join(dir, 'a-bad');
  mkdirSync(join(badDir, 'src'), { recursive: true });
  writeFileSync(join(badDir, 'LEDGER.md'), ledger);
  writeFileSync(join(badDir, 'src', 'spec.ts'), `
export const FILM = { duration: 10, fps: 30, width: 320, height: 180, sound: false, loop: false };
export const TITLE = 'x';
const r = Math.random();
const n = Date.now();
// TODO later
const g = 'linear-gradient(90deg,#000,#fff)';
const e = '🎬';
`);
  const a3 = run(SPEC, ['--ledger', 'LEDGER.md', '--src', 'src'], badDir);
  const hits = ['duration: 10', 'TITLE', 'Math.random', 'Date.now', 'TODO', '未记账渐变', 'emoji'];
  const missingHits = hits.filter((h) => !a3.out.includes(h));
  check('占位符+禁用项应 FAIL', a3.code === 1 && missingHits.length === 0,
    missingHits.length ? `未命中：${missingHits.join(', ')}` : '七项全部命中');

  /* ================= B. film.mjs ================= */

  console.log(`\n${C.bold}B. film.mjs${C.reset}`);

  const fdir = join(dir, 'b');
  mkdirSync(join(fdir, 'src'), { recursive: true });

  const specNoSound = `export const FILM = { duration: 2, fps: 30, width: 320, height: 180, sound: false, loop: false };`;
  const specLoopSound = `export const FILM = { duration: 2, fps: 30, width: 320, height: 180, sound: true, loop: true };`;
  writeFileSync(join(fdir, 'src', 'nosound.ts'), specNoSound);
  writeFileSync(join(fdir, 'src', 'loopsound.ts'), specLoopSound);

  // 有运动的片
  const moving = join(fdir, 'moving.mp4');
  const madeMoving = ff([
    '-f', 'lavfi', '-i', 'color=c=0x1B3A2F:s=320x180:d=2:r=30',
    '-f', 'lavfi', '-i', 'color=c=0xF4F1EA:s=60x40:d=2:r=30',
    '-filter_complex', "[0:v][1:v]overlay=x='mod(t*120,320)':y=70,format=yuv420p",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', moving,
  ]);
  check('夹具：运动片已生成', madeMoving);

  if (madeMoving) {
    const b1 = run(FILM, ['--film', 'moving.mp4', '--spec', 'src/nosound.ts'], fdir);
    check('运动片应通过', b1.code === 0, `exit ${b1.code}`);
  }

  // 静止片 → 死区 FAIL
  const still = join(fdir, 'still.mp4');
  if (ff(['-f', 'lavfi', '-i', 'color=c=0x1B3A2F:s=320x180:d=2:r=30',
    '-vf', 'format=yuv420p', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', still])) {
    const b2 = run(FILM, ['--film', 'still.mp4', '--spec', 'src/nosound.ts'], fdir);
    check('静止片应判死区 FAIL', b2.code === 1 && /死区/.test(b2.out), `exit ${b2.code}`);
    // 放宽后应通过
    const b2b = run(FILM, ['--film', 'still.mp4', '--spec', 'src/nosound.ts', '--allow-still', '5'], fdir);
    check('--allow-still 放宽后应通过', b2b.code === 0, `exit ${b2b.code}`);
  }

  // 坏接缝 → 循环 SSIM FAIL
  const badseam = join(fdir, 'badseam.mp4');
  if (ff(['-f', 'lavfi', '-i', 'color=c=0x1B3A2F:s=320x180:d=2:r=30',
    '-vf', 'format=yuv420p,fade=in:st=0:d=0.1:color=white',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', badseam])) {
    const b3 = run(FILM, ['--film', 'badseam.mp4', '--spec', 'src/nosound.ts', '--allow-still', '5'], fdir);
    check('坏接缝应判首帧/循环 FAIL',
      b3.code === 1 && /首帧无闪色/.test(b3.out) && /循环接缝/.test(b3.out), `exit ${b3.code}`);
  }

  // 静音音轨 → 音频 FAIL
  const silent = join(fdir, 'silent.mp4');
  if (ff(['-f', 'lavfi', '-i', 'color=c=0x1B3A2F:s=320x180:d=2:r=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-filter_complex', '[0:v]format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a', '-t', '2',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', silent])) {
    const b4 = run(FILM, ['--film', 'silent.mp4', '--spec', 'src/loopsound.ts', '--allow-still', '5'], fdir);
    check('静音音轨应判音频 FAIL', b4.code === 1 && /音频/.test(b4.out), `exit ${b4.code}`);
  }

  // 有声 + 循环良好 → 通过
  const goodloop = join(fdir, 'goodloop.mp4');
  if (ff(['-f', 'lavfi', '-i', 'color=c=0x1B3A2F:s=320x180:d=2:r=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-filter_complex', '[0:v]format=yuv420p[v]',
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', goodloop])) {
    const b5 = run(FILM, ['--film', 'goodloop.mp4', '--spec', 'src/loopsound.ts', '--allow-still', '5'], fdir);
    check('有声循环片应通过（接缝+音频）', b5.code === 0, `exit ${b5.code}`);
  }

  // spec 不匹配 → 格式 FAIL
  if (existsSync(moving)) {
    writeFileSync(join(fdir, 'src', 'wrong.ts'),
      `export const FILM = { duration: 5, fps: 60, width: 1920, height: 1080, sound: false, loop: false };`);
    const b6 = run(FILM, ['--film', 'moving.mp4', '--spec', 'src/wrong.ts'], fdir);
    check('spec 不匹配应判格式 FAIL', b6.code === 1 && /格式对 spec/.test(b6.out), `exit ${b6.code}`);
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log('');
if (bad === 0) {
  console.log(`${C.pass}${C.bold}✓ ${total}/${total} 条断言通过${C.reset}`);
  console.log(`${C.dim}门禁会红也会绿——这不是摆设。${C.reset}\n`);
  process.exit(0);
} else {
  console.log(`${C.fail}${C.bold}✗ ${bad}/${total} 条断言失败${C.reset}\n`);
  process.exit(1);
}
