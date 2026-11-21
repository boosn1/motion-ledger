#!/usr/bin/env node
// concat-stems.mjs — 把分轨铺进 Concat 工程，一层一条轨，方便逐轨静音试听。
//
// 为什么需要这个脚本：
//   concat-bridge.mjs 交付的是「成片 + 一条字幕轨」。那对交付是对的，
//   但对**判断问题**不够——用户听到「嗡嗡声」，需要的是把低频层、噪声层
//   分开，一条一条关掉听。混在一起的成品没法回答「是哪一层在响」。
//
// 它做什么：
//   1. 起 Concat（headless MCP）
//   2. 建工程，导入视频与每条分轨
//   3. 视频进 V1，每条分轨各占一条音频轨（顺序按 BUS_ORDER）
//   4. 字幕进最后一条轨
//   5. 保留工程不删，打印路径
//
// 用法：
//   node scripts/concat-stems.mjs --film out/film.mp4 --stems public/stems
//   node scripts/concat-stems.mjs --film out/film.mp4 --stems public/stems --name my-film
//
// 它**不**导出成片——分轨工程的用途是试听，不是交付。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

/* ---------------- 参数 ---------------- */

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const key = k.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      a[key] = next;
      i++;
    } else {
      a[key] = true;
    }
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h) {
  console.log(`
用法：
  node scripts/concat-stems.mjs --film <成片.mp4> --stems <分轨目录>

参数：
  --film <path>       必填。成片（视频轨）
  --stems <dir>       必填。分轨目录，读里面所有 .wav
  --name <name>       工程名（默认 film-<时间戳>）
  --work <dir>        工程父目录（默认 ~/.motion-ledger-concat）
  --concat <path>     concat.exe 路径（默认自动查找）
  --subs-from-spec <path>  可选，从 spec.ts 的 SUBS 读字幕
  --subs <path>       可选，.srt/.vtt/.json 字幕
  --caption-offset <n> 字幕位置（默认 0.35 = 近底部）
  --json              输出 JSON
  --no-keep           跑完删工程（默认保留）

它不导出成片。用途是逐轨静音试听。
`);
  process.exit(0);
}

const film = args.film ? resolve(args.film) : null;
const stemsDir = args.stems ? resolve(args.stems) : null;

if (!film || !existsSync(film)) {
  console.error(`\n✗ --film 不存在：${film ?? '(未给)'}\n`);
  process.exit(2);
}
if (!stemsDir || !existsSync(stemsDir)) {
  console.error(`\n✗ --stems 目录不存在：${stemsDir ?? '(未给)'}\n`);
  console.error(`  先生成分轨：node scripts/score.mjs --cues scripts/cues.json --stems\n`);
  process.exit(2);
}

/* ---------------- 找 concat ---------------- */

function findConcat() {
  if (args.concat) return resolve(args.concat);
  const home = homedir();
  const candidates = [
    'D:\\Program Files\\Concat\\concat.exe',
    'C:\\Program Files\\Concat\\concat.exe',
    join(home, 'AppData', 'Local', 'Programs', 'Concat', 'concat.exe'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Concat', 'concat.exe'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch { /* 无权限就当没有 */ }
  }
  return 'concat';
}

const CONCAT = findConcat();

/* ---------------- MCP 客户端 ---------------- */

class Concat {
  constructor(exe) {
    this.exe = exe;
    this.buf = '';
    this.id = 0;
    this.waiters = new Map();
    this.stderr = '';
  }

  start() {
    this.proc = spawn(this.exe, ['--mcp', 'headless'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const w = this.waiters.get(msg.id);
        if (w) { this.waiters.delete(msg.id); w(msg); }
      }
    });
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => { this.stderr += d; });
    this.proc.stdin.on('error', (e) => { if (e.code !== 'EPIPE') throw e; });
    return this;
  }

  rpc(method, params) {
    return new Promise((res) => {
      const myId = ++this.id;
      this.waiters.set(myId, res);
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
      const timer = setTimeout(() => {
        if (this.waiters.has(myId)) { this.waiters.delete(myId); res({ __timeout: true }); }
      }, 120000);
      timer.unref?.();
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async init() {
    const r = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'concat-stems', version: '1.0.0' },
    });
    if (r.__timeout) throw new Error('Concat 没有响应 initialize');
    if (r.error) throw new Error(`initialize 失败：${JSON.stringify(r.error)}`);
    this.notify('notifications/initialized', {});
    return r.result?.serverInfo ?? {};
  }

  async tool(name, toolArgs) {
    const r = await this.rpc('tools/call', { name, arguments: toolArgs });
    if (r.__timeout) throw new Error(`${name} 超时`);
    if (r.error) throw new Error(`${name} 失败：${JSON.stringify(r.error)}`);
    const content = r.result?.content ?? [];
    const text = content.map((c) => c.text ?? '').join('\n');
    if (r.result?.isError) throw new Error(`${name} 被拒绝：${text}`);
    return { text, structured: r.result?.structuredContent, raw: r.result };
  }

  stop() {
    try { this.proc.kill(); } catch { /* 已经退了 */ }
  }
}

/* ---------------- 工具 ---------------- */

const log = (s) => console.log(s);

function stamp() {
  return Date.now().toString(36);
}

// 判断一个 WAV 是否全静音：读 44 字节头拿到位深与声道数，然后扫 data 区。
// 为什么不用 ffprobe：这脚本承诺零依赖（除了 Concat 本身），而 WAV 头足够简单，
// 而且分轨都是本仓库 score.mjs 自己写的标准 PCM。
function isSilentWav(file, threshold = 8) {
  try {
    const buf = readFileSync(file);
    if (buf.length <= 44) return true;
    // 找 data chunk：从 12 字节 RIFF 头之后逐块走
    let off = 12;
    let dataStart = -1;
    let dataLen = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'data') { dataStart = off + 8; dataLen = Math.min(size, buf.length - dataStart); break; }
      off += 8 + size + (size % 2);
    }
    if (dataStart < 0 || dataLen <= 0) return true;
    // 16bit 单声道：逐样本看绝对值，超过阈值就算有声
    for (let i = dataStart; i + 1 < dataStart + dataLen; i += 2) {
      if (Math.abs(buf.readInt16LE(i)) > threshold) return false;
    }
    return true;
  } catch {
    return false;   // 读不了就当有声，宁可多一条轨也不要静默吞掉
  }
}

/* ---------------- 主流程 ---------------- */

async function main() {
  // 分轨文件：按目录里的实际内容读，不假设一定有九条
  const allStemFiles = readdirSync(stemsDir)
    .filter((f) => f.toLowerCase().endsWith('.wav'))
    .map((f) => join(stemsDir, f))
    .sort();

  // 跳过全静音的分轨：score.mjs 会把没用到的层也导出一个空 WAV，
  // 把它铺到时间线上会多出一条无声轨，试听时看着像「这层有问题」。
  const stemFiles = allStemFiles.filter((f) => !isSilentWav(f));
  const skipped = allStemFiles.filter((f) => isSilentWav(f)).map((f) => basename(f, '.wav'));

  if (stemFiles.length === 0) {
    console.error(`\n✗ ${stemsDir} 里没有有声的 .wav\n`);
    process.exit(2);
  }
  if (skipped.length) log(`跳过静音层：${skipped.join(', ')}`);

  const workRoot = args.work ? resolve(args.work) : join(homedir(), '.motion-ledger-concat');
  if (!existsSync(workRoot)) mkdirSync(workRoot, { recursive: true });
  const projectName = typeof args.name === 'string' ? args.name : `stems-${stamp()}`;
  const projectDir = join(workRoot, projectName);

  const c = new Concat(CONCAT).start();
  let serverInfo = {};
  try {
    serverInfo = await c.init();

    // 工程目录已存在就先删掉：project_create 拒绝已有工程的目录
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });

    await c.tool('project_create', { location: workRoot, name: projectName });
    log(`Concat ${serverInfo.version ?? '?'} · ${CONCAT}`);
    log(`工程 ${projectDir}`);

    // 每次 tools/call 前都要 open：进程一退项目就不算开着
    const open = async () => { await c.tool('project_open', { path: projectDir }); };

    // 导入视频
    await open();
    const v = await c.tool('media_import', { path: projectDir, file: film });
    const vMedia = findMediaId(v.structured);
    log(`导入成片 ${vMedia ?? '?'} · ${basename(film)}`);

    // 读时间线拿第一条轨
    await open();
    const tl0 = await c.tool('timeline_read', { path: projectDir });
    const tl = parseTimeline(tl0);
    // Concat 的轨道不分类别，一条轨能放视频也能放音频。
    // 约定：第一条轨放视频，后面每条放一层音频。
    const vTrack = tl.tracks[0];
    if (!vTrack) throw new Error('工程里没有轨道');

    // 视频片段铺满整片
    await open();
    await c.tool('clip_add', {
      path: projectDir,
      mediaId: vMedia,
      trackId: vTrack.id,
      start: 0,
    });
    log(`视频进 ${vTrack.id}`);

    // 每条分轨一条音频轨
    let added = 0;
    const placed = [];   // [[层名, 轨 id], ...] 供下面的自检回读核对
    for (const f of stemFiles) {
      const name = basename(f, '.wav');
      await open();
      const m = await c.tool('media_import', { path: projectDir, file: f });
      const mediaId = findMediaId(m.structured);

      await open();
      const t = await c.tool('track_add', { path: projectDir });
      const trackId = findTrackId(t.structured);

      await open();
      await c.tool('clip_add', {
        path: projectDir,
        mediaId,
        trackId,
        start: 0,
      });
      log(`  ${name.padEnd(11)} → ${trackId}`);
      placed.push([name, trackId]);
      added++;
    }

    // 字幕（可选）
    let cueCount = 0;
    const subs = await loadSubs();
    if (subs.length) {
      await open();
      await c.tool('captions_add', {
        path: projectDir,
        captions: subs,
        ...(args['caption-offset'] != null
          ? { offsetY: Number(args['caption-offset']) }
          : {}),
      });
      cueCount = subs.length;
      log(`字幕 ${cueCount} 条`);
    }

    await open();
    await c.tool('project_save', { path: projectDir });

    // 自检：核对每条音轨上放的确实是它自己那一层。
    // 为什么必须自检：media_import 返回的是整个媒体列表，误读 createdId 会让
    // 九条轨全放同一个视频，而脚本一路打印「成功」。这种静默错位只能靠
    // 回读时间线抓出来。
    await open();
    const tl1 = await c.tool('timeline_read', { path: projectDir });
    const final = parseTimeline(tl1);
    const mediaName = Object.fromEntries(
      (tl1.structured?.media ?? []).map((m) => [m.id, m.name])
    );
    const mismatches = [];
    for (const [stemName, trackId] of placed) {
      const clips = final.clips.filter((cl) => (cl.track ?? cl.trackId) === trackId);
      const names = clips.map((cl) => mediaName[cl.media ?? cl.mediaId] ?? '?');
      if (names.length !== 1 || names[0] !== `${stemName}.wav`) {
        mismatches.push(`${stemName} → ${trackId} 上是 ${names.join(',') || '(空)'}`);
      }
    }
    if (mismatches.length) {
      throw new Error(`分轨没有正确落位：\n  ${mismatches.join('\n  ')}`);
    }

    // 清锁：留着会让 GUI 认为工程被占用
    try { rmSync(join(projectDir, 'concat.lock'), { force: true }); } catch { /* 没有就算了 */ }

    log('');
    log(`✓ 工程已就绪：${projectDir}`);
    log(`  ${added} 条分轨 + 1 条视频${cueCount ? ` + ${cueCount} 条字幕` : ''}`);
    log('');
    log(`  在 Concat 里打开：${CONCAT} --project "${projectDir}"`);
    log(`  逐轨静音试听，就能听出是哪一层在响`);
    log('');

    if (args.json) {
      console.log(JSON.stringify({
        ok: true,
        project: projectDir,
        concat: CONCAT,
        version: serverInfo.version ?? null,
        stems: stemFiles.map((f) => basename(f, '.wav')),
        cues: cueCount,
      }, null, 2));
    }

    if (args['no-keep']) {
      rmSync(projectDir, { recursive: true, force: true });
      log(`（工程已删除：--no-keep）`);
    }
  } finally {
    c.stop();
  }
}

/* ---------------- 解析 Concat 返回 ---------------- */

// media_import 的返回里，新导入媒体的 id 在 `createdId`（实测 m1/m3/m6…），
// 而 structuredContent 同时带着**整个媒体列表** media[]。
// 如果遍历整个对象找 m\d+，第一条永远是已经导入过的 film.mp4（m1）——
// 结果九条音轨上放的全是视频，看着「成功」，实际一条分轨都没用上。
// 这是本项目踩过的最隐蔽的一个坑：不读 createdId 就会静默错位。
function findMediaId(structured) {
  if (!structured) return null;
  if (typeof structured.createdId === 'string') return structured.createdId;
  if (structured.media && typeof structured.media.id === 'string') return structured.media.id;
  return null;
}

// track_add 的返回里，新建轨的 id 在 `createdId`（实测是**小写** t42），
// 而 structuredContent 里同时带着整个 timeline.tracks 数组（大写 T1…T4）。
// 如果在这里遍历整个对象找 t\d+，会先撞上 T1——结果九条轨全叠到第一条上，
// 画面看着「成功」，实际只有一条轨有内容。所以必须先读 createdId。
function findTrackId(structured) {
  if (!structured) return null;
  if (typeof structured.createdId === 'string') return structured.createdId;
  if (structured.track && typeof structured.track.id === 'string') return structured.track.id;
  return null;
}

// timeline_read / project_open 的真实结构（实测）：
//   { timeline: { tracks: [{ id: 'T1', index: 0 }, ...], clips: [], duration } }
// 注意三点：轨道在 structuredContent.timeline.tracks 里（不是顶层）、
// id 是**大写** T1（不是 t1）、轨道没有 kind 字段——Concat 的轨道不分
// 视频/音频，一条轨能放什么都行。所以「视频轨」只是约定：第一条。
function parseTimeline({ structured, text }) {
  const tracks = structured?.timeline?.tracks;
  if (Array.isArray(tracks)) {
    return {
      tracks: tracks.map((t) => ({ id: t.id, index: t.index })),
      clips: structured.timeline.clips ?? [],
      duration: structured.timeline.duration ?? 0,
    };
  }
  const ids = [...new Set((text ?? '').match(/\bT\d+\b/g) ?? [])];
  return { tracks: ids.map((id, i) => ({ id, index: i })), clips: [], duration: 0 };
}

/* ---------------- 字幕 ---------------- */

async function loadSubs() {
  const specPath = args['subs-from-spec'] ? resolve(args['subs-from-spec']) : null;
  const subsPath = args.subs ? resolve(args.subs) : null;

  if (specPath && existsSync(specPath)) {
    const { readFileSync } = await import('node:fs');
    return parseSubsFromSpec(readFileSync(specPath, 'utf8'));
  }
  if (subsPath && existsSync(subsPath)) {
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(subsPath, 'utf8');
    if (subsPath.toLowerCase().endsWith('.json')) return parseSubsJson(raw);
    return parseSubsText(raw);
  }
  return [];
}

function parseSubsFromSpec(src) {
  const at = src.search(/\bSUBS\b/);
  if (at < 0) return [];
  const eq = src.indexOf('=', at);
  if (eq < 0) return [];
  const open = src.indexOf('[', eq);
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) return [];
  const body = src.slice(open, end + 1);
  const re = /\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]/g;
  const out = [];
  let m;
  while ((m = re.exec(body))) {
    const text = m[3].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    out.push({ start: Number(m[1]), end: Number(m[2]), text });
  }
  return out.filter((c) => c.end > c.start && c.text.trim());
}

function parseSubsJson(raw) {
  const j = JSON.parse(raw);
  const arr = Array.isArray(j) ? j : (j.cues ?? j.captions ?? j.subs ?? []);
  return arr.map((c) => {
    if (Array.isArray(c)) return { start: Number(c[0]), end: Number(c[1]), text: String(c[2] ?? '') };
    return { start: Number(c.start), end: Number(c.end), text: String(c.text ?? '') };
  }).filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && c.text.trim());
}

function parseSubsText(raw) {
  const blocks = raw.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const out = [];
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx < 0) continue;
    const [a, z] = lines[arrowIdx].split('-->').map((s) => s.trim());
    const start = parseTime(a);
    const end = parseTime(z);
    const text = lines.slice(arrowIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (start == null || end == null || end <= start || !text) continue;
    out.push({ start, end, text });
  }
  return out.sort((x, y) => x.start - y.start);
}

function parseTime(s) {
  if (!s) return null;
  const t = s.trim();
  const m = t.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000;
  const m2 = t.match(/^(\d+):(\d{2})[.,](\d{1,3})$/);
  if (m2) return Number(m2[1]) * 60 + Number(m2[2]) + Number(m2[3].padEnd(3, '0')) / 1000;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});
