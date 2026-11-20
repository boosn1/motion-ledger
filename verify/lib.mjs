// verify/lib.mjs — 零依赖工具集（只用 Node 内置 + ffmpeg/ffprobe）
// 不做任何网络请求，不写任何文件（除非显式要求）。

import {
  readFileSync, readdirSync, statSync, existsSync,
  openSync, closeSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join, extname, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/* ---------------- 参数 ---------------- */

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/* ---------------- 输出 ---------------- */

const COLORS = {
  pass: '\x1b[32m', fail: '\x1b[31m', warn: '\x1b[33m',
  dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m',
};

export function makeReporter(title) {
  const rows = [];
  let failed = 0, warned = 0;
  console.log(`\n${COLORS.bold}${title}${COLORS.reset}\n`);

  const report = (status, name, detail = '') => {
    const tag = status === 'PASS' ? `${COLORS.pass}PASS${COLORS.reset}`
      : status === 'FAIL' ? `${COLORS.fail}FAIL${COLORS.reset}`
      : `${COLORS.warn}WARN${COLORS.reset}`;
    if (status === 'FAIL') failed++;
    if (status === 'WARN') warned++;
    rows.push({ status, name, detail });
    const line = `  ${tag}  ${name}${detail ? `  ${COLORS.dim}${detail}${COLORS.reset}` : ''}`;
    console.log(line);
  };

  const pass = (n, d) => report('PASS', n, d);
  const fail = (n, d) => report('FAIL', n, d);
  const warn = (n, d) => report('WARN', n, d);

  const summary = () => {
    console.log('');
    if (failed > 0) {
      console.log(`${COLORS.fail}${COLORS.bold}✗ ${failed} 项不通过${COLORS.reset}${warned ? `，${warned} 项警告` : ''}`);
    } else if (warned > 0) {
      console.log(`${COLORS.warn}${COLORS.bold}△ 全部通过，${warned} 项警告${COLORS.reset}`);
    } else {
      console.log(`${COLORS.pass}${COLORS.bold}✓ 全部通过${COLORS.reset}`);
    }
    console.log('');
    return { failed, warned, rows };
  };

  return { pass, fail, warn, summary };
}

/* ---------------- 文件 ---------------- */

export function readText(p) {
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html']);

export function walkSources(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) stack.push(full);
      else if (SOURCE_EXT.has(extname(name))) files.push(full);
    }
  }
  return files;
}

/* ---------------- 台账解析 ---------------- */

// 匹配 | S01 | ... | 形式的表格行首 id；允许 S01* 这种"推测补全"标记
const LEDGER_ROW = /^\|\s*([SXE]\d{2,4})\*?\s*\|/;

export function parseLedger(text) {
  const ids = new Map(); // id -> { kind, star, line }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(LEDGER_ROW);
    if (!m) return;
    const id = m[1];
    const star = line.startsWith('|') && /\|\s*[SXE]\d{2,4}\*\s*\|/.test(line);
    if (ids.has(id)) return;
    ids.set(id, { kind: id[0], star, line: i + 1, raw: line.trim() });
  });
  return ids;
}

/**
 * 从台账读「计划内运动峰值」表。
 *
 * 这是这套门禁与「凭感觉看一眼」的分界：尖峰不是自动判坏的。
 * 台账声明了哪个区间允许有峰值，代码只核对声明；没声明就动的东西才是 bug。
 * 返回 null 表示台账没写这张表（严格模式：任何尖峰都算计划外）。
 */
export function parsePeakWindows(text) {
  const sec = text.split(/^###\s*计划内运动峰值\s*$/m)[1];
  if (!sec) return null;
  const out = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([\d.]+)\s*[–\-~]\s*([\d.]+)\s*\|/);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out.length ? out : null;
}

/**
 * 从台账读「计划内静止」表。
 *
 * 与峰值窗口对称：定版后的 hold 本来就没有动作，不该被判成死区。
 * 返回 null 表示台账没写这张表（严格模式：超过阈值的静止一律算 bug）。
 */
export function parseStillWindows(text) {
  const sec = text.split(/^###\s*计划内静止\s*$/m)[1];
  if (!sec) return null;
  const out = [];
  for (const line of sec.split(/\r?\n/)) {
    const m = line.match(/^\|\s*([\d.]+)\s*[–\-~]\s*([\d.]+)\s*\|/);
    if (m) out.push([Number(m[1]), Number(m[2])]);
  }
  return out.length ? out : null;
}

/* ---------------- 源码 id 引用 ---------------- */

// 源码里出现的台账 id（注释或字符串里都算）
export function collectSourceIds(sources) {
  const found = new Map(); // id -> [{file, line}]
  for (const { file, text } of sources) {
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const re = /\b([SXE])(\d{2,4})\b/g;
      let m;
      while ((m = re.exec(line)) !== null) {
        const id = m[1] + m[2];
        if (!found.has(id)) found.set(id, []);
        found.get(id).push({ file, line: i + 1 });
      }
    });
  }
  return found;
}

/* ---------------- 源码常量 ---------------- */

// 只认**文件顶层**常量（行首无缩进）。函数体内的局部变量不该要求台账 id——
// 它们是实现细节，台账管的是"这一帧长什么样"的常量，不是循环计数器。
const TOP_CONST = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*[:=]/;
const HAS_LEDGER_ID = /\b[SXE]\d{2,4}\b/;
const WAIVER = /ledger-allow\s*:\s*(.+)$/;
/** 文件级豁免：写在文件头 12 行内，同样必须给理由。只用于「这个文件里没有设计决定」。 */
const FILE_WAIVER = /ledger-file-allow\s*:\s*(.+)$/m;

/**
 * 常量是不是"机制"而不是"设计"。
 *
 * 台账管的是**设计决定**：时长、颜色、尺寸、BPM、关键时刻。
 * 它不管 clamp/lerp/morphPts 这类工具函数，也不管 polyfill 式的实现细节——
 * 那些改了不会让片子长得不一样，要求它们带台账 id 只会制造噪声，让人开始无脑加豁免。
 */
function isMechanism(line) {
  // 箭头函数 / 函数表达式
  if (/=>\s*\{?\s*$/.test(line) || /=>\s*\S/.test(line)) return true;
  if (/=\s*function\b/.test(line)) return true;
  // 跨行函数签名的开头（下一行才是 =>）
  if (/=\s*\([^)]*\)\s*$/.test(line) || /=\s*\($/.test(line)) return true;
  // 工具库里的通用名（约定式，不做语义猜测）
  if (/^\s*(?:export\s+)?const\s+(?:clamp|lerp|smooth|median|at|easeExp)\b/.test(line)) return true;
  return false;
}

/**
 * 对象容器：成员各自带台账 id 时，容器本身不必再带一个。
 *
 * `const FILM = {` 的每个字段后面都写着 // S01 S02…，再要求 FILM 自己挂 id
 * 就是重复记账——重复记账最后一定变成漏记账。
 */
function containerHasLedgerIds(lines, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < lines.length && i < startIdx + 60; i++) {
    const line = lines[i];
    if (HAS_LEDGER_ID.test(line)) return true;
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return false; }
    }
    if (i === startIdx && !line.includes('{')) return false;
  }
  return false;
}

export function scanConstants(sources) {
  const unaccounted = [];
  for (const { file, text } of sources) {
    const lines = text.split(/\r?\n/);
    // 文件级豁免：渲染入口、构建工具这类文件里没有设计决定，
    // 全是 CLI 参数与路径拼接。逐行写 ledger-allow 只会把文件写成噪声，
    // 所以允许在文件头声明一次，但必须写明理由。
    const head = lines.slice(0, 12).join('\n');
    if (FILE_WAIVER.test(head)) continue;
    lines.forEach((line, i) => {
      if (!TOP_CONST.test(line)) return;
      // 台账 id 可以写在同一行，也可以写在紧邻的上一行（注释块的最后一行）
      if (HAS_LEDGER_ID.test(line)) return;
      const prev = i > 0 ? lines[i - 1] : '';
      if (HAS_LEDGER_ID.test(prev) && /^\s*(\/\/|\/\*|\*)/.test(prev)) return;
      if (WAIVER.test(line)) return;
      // 纯类型/接口声明不算常量
      if (/^\s*(?:export\s+)?const\s+\w+\s*:\s*(?:type\s+)?[A-Z]\w*</.test(line)) return;
      // React 组件不是设计常量：它装的是别的常量，自己没有数值
      if (/^\s*(?:export\s+)?const\s+\w+\s*:\s*React\.FC\b/.test(line)) return;
      // 机制层（工具函数、实现细节）
      if (isMechanism(line)) return;
      // 对象容器：成员已记账
      if (/\{\s*$/.test(line) && containerHasLedgerIds(lines, i)) return;
      unaccounted.push({ file, line: i + 1, text: line.trim().slice(0, 100) });
    });
  }
  return unaccounted;
}

/* ---------------- 禁用项 ---------------- */

/**
 * 禁用项分两类扫，不能一视同仁。
 *
 * - `code` 类扫**去注释后**的文本：注释里写「禁用 Math.random()」是规则说明，
 *   不是真用了随机数——规则文件自己不该成为违规证据。
 * - `text` 类扫**原文**：TODO 本来就是写在注释里的，去掉注释等于把要抓的东西删了。
 *   Lorem 同理，它抓的是"这段文案是不是占位"。
 */
export const FORBIDDEN = [
  { id: 'Math.random', scope: 'code', re: /\bMath\.random\s*\(/, why: '用 rand(seed) 种子随机' },
  { id: 'Date.now', scope: 'code', re: /\bDate\.now\s*\(|new\s+Date\s*\(/, why: '用时间函数 f(t)' },
  { id: 'setTimeout', scope: 'code', re: /\bsetTimeout\s*\(/, why: '从 t 推导，不要定时器' },
  { id: 'setInterval', scope: 'code', re: /\bsetInterval\s*\(/, why: '从 t 推导，不要定时器' },
  { id: 'CSS keyframes', scope: 'code', re: /@keyframes\s|animation\s*:\s*[\w-]+\s+[\d.]+s/, why: '主时间线驱动，不要独立 CSS 动画' },
  { id: '未记账渐变', scope: 'code', re: /linear-gradient\s*\(/, why: '渐变需有光源动机；无动机请删' },
  { id: 'glow/bloom', scope: 'code', re: /filter\s*:\s*blur\s*\(|drop-shadow\s*\(\s*0\s+0/, why: '装饰性 glow 禁用；有动机的光要画成形' },
  { id: 'TODO', scope: 'text', re: /\bTODO\b|\bFIXME\b|\bTBD\b/, why: '不留 TODO；写不下用 // CONTINUE FROM <path>' },
  { id: 'Lorem', scope: 'text', re: /lorem ipsum/i, why: '占位文案禁用' },
  // 排除 ✓✗✔✘（U+2713/2714/2717/2718）：它们是终端状态符号，不会出现在画面里。
  // 规则要抓的是「往片子里塞 stock emoji」，不是「构建日志不许打对勾」。
  { id: 'emoji', scope: 'text', re: /(?![\u2713\u2714\u2717\u2718])[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u, why: 'stock emoji 禁用' },
];

/**
 * 去掉注释再扫禁用项。
 *
 * 直接扫原文会把"文档里写的『禁用 Math.random()』"当成用了 Math.random——
 * 规则文件自己就成了违规证据。注释里的字不是代码。
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（保留 http:// 这类）
}

export function scanForbidden(sources) {
  const hits = [];
  for (const { file, text } of sources) {
    const rawLines = text.split(/\r?\n/);
    // 逐行保留原始行号：用同样行数的"去注释版本"对齐
    const clean = stripComments(text).split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      if (WAIVER.test(rawLines[i])) continue;
      const codeLine = clean[i] ?? '';
      const rawLine = rawLines[i];
      for (const rule of FORBIDDEN) {
        const line = rule.scope === 'text' ? rawLine : codeLine;
        if (rule.re.test(line)) {
          hits.push({ rule: rule.id, why: rule.why, file, line: i + 1, text: rawLine.trim().slice(0, 100) });
        }
      }
    }
  }
  return hits;
}

/* ---------------- starter 占位符 ---------------- */

export const PLACEHOLDERS = [
  { id: 'TITLE 占位', re: /\bTITLE\b/, why: 'starter 占位文案' },
  { id: 'SUBTITLE 占位', re: /\bSUBTITLE\b/, why: 'starter 占位文案' },
  { id: 'duration: 10', re: /duration\s*:\s*10\s*[,}]/, why: 'starter 默认时长，必须来自 S 表' },
  { id: 'placeholder', re: /\bplaceholder\b/i, why: '占位符残留' },
  // 用哨兵而不是文件名：starter 的场景本来就叫 Scene01，改名不算"改过"，
  // 真正要抓的是"从模板原样拷出来就交片"。模板里带 __STARTER__ 标记，删掉它才算动了手。
  { id: 'starter 未改动', re: /__STARTER__/, why: '模板哨兵还在，说明这段没按台账重写' },
];

export function scanPlaceholders(sources) {
  const hits = [];
  for (const { file, text } of sources) {
    // 脚手架文件本身不算
    if (/[\\/](index|Root)\.[jt]sx?$/.test(file)) continue;
    // templates/ 下的文件**就是模板**，哨兵本来就该在那儿。
    // 复制出去的工程如果还带着哨兵，才说明没按台账重写。
    if (/[\\/]templates[\\/]/.test(file)) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (WAIVER.test(line)) return;
      for (const rule of PLACEHOLDERS) {
        if (rule.re.test(line)) {
          hits.push({ rule: rule.id, why: rule.why, file, line: i + 1, text: line.trim().slice(0, 100) });
        }
      }
    });
  }
  return hits;
}

/* ---------------- spec.ts 解析 ---------------- */

export function parseSpec(text) {
  if (!text) return null;
  const block = (name) => {
    const i = text.search(new RegExp(`(?:const|let|var)\\s+${name}\\b`));
    if (i < 0) return '';
    const rest = text.slice(i);
    const end = rest.search(/\}\s*;|\n\s*\n\s*(?:export|const|let|var|function)/);
    return end < 0 ? rest.slice(0, 800) : rest.slice(0, Math.min(end + 2, 1200));
  };

  const film = block('FILM');
  const num = (key) => {
    const m = film.match(new RegExp(`${key}\\s*:\\s*([\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  const bool = (key) => {
    const m = film.match(new RegExp(`${key}\\s*:\\s*(true|false)`));
    return m ? m[1] === 'true' : null;
  };

  return {
    raw: film,
    duration: num('duration'),
    fps: num('fps'),
    width: num('width'),
    height: num('height'),
    sound: bool('sound'),
    loop: bool('loop'),
  };
}


/* ---------------- 进程调用（不依赖管道） ----------------
 * 沙箱/受限环境常禁止 pipe stdio（spawnSync 默认 pipe 会 EPERM），
 * 所以一律把子进程输出重定向到临时文件再读回。
 */

export function runCaptured(cmd, args, { wantStdout = true, cwd } = {}) {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'ml-'));
  } catch (e) {
    return { error: `无法创建临时目录：${e.message}` };
  }
  const outPath = join(dir, 'out.bin');
  const errPath = join(dir, 'err.txt');
  let r, stdout = Buffer.alloc(0), stderr = '';
  try {
    const outFd = wantStdout ? openSync(outPath, 'w') : 'ignore';
    const errFd = openSync(errPath, 'w');
    try {
      r = spawnSync(cmd, args, { stdio: ['ignore', outFd, errFd], cwd });
    } finally {
      if (wantStdout) closeSync(outFd);
      closeSync(errFd);
    }
    if (wantStdout && existsSync(outPath)) stdout = readFileSync(outPath);
    if (existsSync(errPath)) stderr = readFileSync(errPath, 'utf8');
  } catch (e) {
    return { error: `${cmd} 调用失败：${e.message}` };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (r.error) return { error: `${cmd} 无法执行：${r.error.message}` };
  return { status: r.status, stdout, stderr };
}

export function hasBinary(name) {
  const r = runCaptured(name, ['-version'], { wantStdout: false });
  return !r.error && r.status === 0;
}

export function ffprobe(file) {
  const r = runCaptured('ffprobe', [
    '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', file,
  ]);
  if (r.error) return { error: r.error };
  if (r.status !== 0) return { error: (r.stderr || '').trim().slice(0, 500) || 'ffprobe 失败' };
  let j;
  try {
    j = JSON.parse(r.stdout.toString('utf8'));
  } catch (e) {
    return { error: `ffprobe 输出无法解析：${e.message}` };
  }
  const v = (j.streams || []).find((s) => s.codec_type === 'video');
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  if (!v) return { error: '没有视频流' };
  const [n, d] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
  return {
    width: v.width,
    height: v.height,
    fps: d ? n / d : 0,
    duration: Number(j.format?.duration ?? v.duration ?? 0),
    videoCodec: v.codec_name,
    hasAudio: Boolean(a),
    audioCodec: a?.codec_name ?? null,
  };
}

// 抽一段灰度的逐帧原始数据，返回 { w, h, frames, data }
//
// 分辨率不能太低：1080p 里一条 4px 的描边缩到 64×36 只剩不到一个像素，
// 运动会被平均掉，门禁就会把有动作的片子判成静止。96×54 是实测能留住细描边的下限。
export function grayFrames(file, { w = 96, h = 54, maxFrames = 3600 } = {}) {
  const r = runCaptured('ffmpeg', [
    '-v', 'error', '-i', file,
    '-vf', `scale=${w}:${h},format=gray`,
    '-frames:v', String(maxFrames),
    '-f', 'rawvideo', '-',
  ]);
  if (r.error) return { error: r.error };
  if (r.status !== 0) return { error: (r.stderr || '').trim().slice(0, 500) || 'ffmpeg 抽帧失败' };
  const buf = r.stdout;
  const size = w * h;
  const frames = Math.floor(buf.length / size);
  if (!frames) return { error: '没有抽到帧' };
  return { w, h, frames, data: buf };
}

// 单帧（指定时间）的灰度像素
export function grayAt(file, seconds, { w = 96, h = 54 } = {}) {
  const r = runCaptured('ffmpeg', [
    '-v', 'error', '-ss', String(seconds), '-i', file,
    '-frames:v', '1', '-vf', `scale=${w}:${h},format=gray`,
    '-f', 'rawvideo', '-',
  ]);
  if (r.error || r.status !== 0) return null;
  const size = w * h;
  if (r.stdout.length < size) return null;
  return r.stdout.subarray(0, size);
}

/**
 * 末帧灰度。
 *
 * 不能用 grayAt(duration)：最后一帧的显示时间戳在 duration - 1/fps，
 * seek 到 duration 已经越过片尾，ffmpeg 什么都不返回——循环接缝就会被判成"计算失败"。
 * -sseof 从尾部倒着找，才拿得到真正的末帧。
 */
export function grayLast(file, { w = 96, h = 54 } = {}) {
  const r = runCaptured('ffmpeg', [
    '-v', 'error', '-sseof', '-0.5', '-i', file,
    '-vf', `scale=${w}:${h},format=gray`,
    '-f', 'rawvideo', '-',
  ]);
  if (r.error || r.status !== 0) return null;
  const size = w * h;
  const n = Math.floor(r.stdout.length / size);
  if (!n) return null;
  return r.stdout.subarray((n - 1) * size, n * size);
}

export function frameDiff(a, b) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) sum += Math.abs(a[i] - b[i]);
  return sum / n; // 0..255
}

export function audioRms(file) {
  const r = runCaptured('ffmpeg', [
    '-v', 'info', '-i', file, '-vn', '-af', 'volumedetect', '-f', 'null', '-',
  ]);
  const text = `${(r.stdout || Buffer.alloc(0)).toString('utf8')}${r.stderr || ''}`;
  const m = text.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
  return m ? Number(m[1]) : null;
}

/** 两张同尺寸灰度图之间的全局 SSIM。 */
export function ssimFromPixels(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let va = 0, vb = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    va += da * da; vb += db * db; cov += da * db;
  }
  va /= n; vb /= n; cov /= n;
  return ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
}

export function ssim(file, t1, t2, { w = 320, h = 180 } = {}) {
  // 两次单帧导出 + 全局灰度 SSIM
  const a = grayAt(file, t1, { w, h });
  const b = grayAt(file, t2, { w, h });
  if (!a || !b) return null;
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let va = 0, vb = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    va += da * da; vb += db * db; cov += da * db;
  }
  va /= n; vb /= n; cov /= n;
  const s = ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
  return s;
}

export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export { relative, join };