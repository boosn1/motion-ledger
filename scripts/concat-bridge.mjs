// Concat 桥：把 motion-ledger 出的片子交给 Concat 做剪辑层的事（字幕、多轨、转场、混音、导出）。
//
// 为什么是「桥」而不是「替代」：
//   motion-ledger 是生成器——代码逐帧算出画面，管的是「这一帧长什么样」。
//   Concat 是剪辑器——管时间线上的片段、轨道、字幕、导出。
//   两者是上下游：先生成，再剪辑。用 Concat 替代 Remotion 等于用剪辑软件画动画，
//   每一帧都要手工摆位置，那就回到了「没有台账、没有门禁」的老路。
//
// 用法：
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --subs subs.srt
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --subs-from-spec src/spec.ts
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --caption "静水流深" --caption-start 0.5
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --json
//
// 字幕两条路（对应 references/08-delivery.md 的 Q9）：
//   A. 烧进画面——在 Film.tsx 里画 <Subtitles />，渲染时就是像素，任何播放器都带着。
//      好处是永不脱轨，坏处是改一个字要重渲整片，且字幕无法单独关闭。
//   B. 交给 Concat——用本脚本的 --subs / --subs-from-spec，字幕是时间线上的一条轨。
//      好处是改字幕不用重渲画面，坏处是最终 MP4 由 Concat 二次编码（约小 40%）。
//   选 A 还是 B 取决于「这一版还会不会改字幕」。会改就 B，定稿就 A。
//
// 依赖：
//   Concat 0.2.12+（D:\Program Files\Concat\concat.exe 或 PATH 里的 concat）。
//   它走 MCP over stdio——裸 JSON-RPC 方法名会被拒（Method not found），必须握手。
//
// 已知约束（都是实测出来的，不是猜的）：
//   1. headless 模式只允许写 C:\Users\<user> 下（stderr 会打印 writesUnder）。所以工程目录
//      默认落在用户主目录，成片再拷回 --out 指定位置。--work 可覆盖。
//   2. 每次 tools/call 前必须 project_open；进程一退，项目就不算开着。
//   3. title_add 的文案在 style.content，不在 text 顶层。写错会得到占位符 "Your text"。
//   4. export_start 返回 {job: "j1"}，不是 jobId。export_wait 只认 job。
//   5. clip_add 的 start 是绝对秒；不传 ripple 时新片段不挤开旧片段，会叠上去。
//   6. 批量字幕走 captions_add，不是循环 title_add——它的 captions 数组里每条
//      {start, end, text} 是一个时间区间，一次落一条轨，一个 undo 步。
//      captions_add 的 style.content 被忽略（每条用自己的 text）。
//   7. offsetY 是「距画面中心的画幅高度比例」：0.35 = 近底部（默认），0 = 正中，-0.35 = 顶部。
//      注意它和 fontSize 一样是比例，所以 1080p 调好的值在 4K 依然对。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';

// ---------- 参数 ----------

function parseArgs(argv) {
  const a = {
    film: null,
    out: null,
    work: null,
    // 单条字幕（旧行为，保留）
    caption: null,
    captionStart: 0.5,
    captionDur: 3,
    // 批量字幕（新）
    subs: null,
    subsFromSpec: null,
    subsShift: 0,
    subsScale: 1,
    // 共用外观
    captionSize: null,      // null = 按单条/批量各自的默认
    captionOffset: 0.35,
    captionBg: null,
    captionMaxWidth: 0,
    captionLineHeight: 1.2,
    captionWeight: null,
    font: 'Noto Sans SC',
    color: '#F4F1EA',
    // 分轨：给了 --stems 就把配乐拆成一层一条轨（视频轨自动静音）
    stems: null,
    name: null,          // 工程名（默认 film-<时间戳>）
    noExport: false,     // true = 只建工程不导出（试听/手工调时用）
    concat: null,
    json: false,
    keep: true,
    timeout: 300,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--film': a.film = v; i++; break;
      case '--out': a.out = v; i++; break;
      case '--work': a.work = v; i++; break;
      case '--caption': a.caption = v; i++; break;
      case '--caption-start': a.captionStart = Number(v); i++; break;
      case '--caption-dur': a.captionDur = Number(v); i++; break;
      case '--subs': a.subs = v; i++; break;
      case '--subs-from-spec': a.subsFromSpec = v; i++; break;
      case '--subs-shift': a.subsShift = Number(v); i++; break;
      case '--subs-scale': a.subsScale = Number(v); i++; break;
      case '--caption-size': a.captionSize = Number(v); i++; break;
      case '--caption-offset': a.captionOffset = Number(v); i++; break;
      case '--caption-bg': a.captionBg = v; i++; break;
      case '--caption-maxwidth': a.captionMaxWidth = Number(v); i++; break;
      case '--caption-lineheight': a.captionLineHeight = Number(v); i++; break;
      case '--caption-weight': a.captionWeight = Number(v); i++; break;
      case '--font': a.font = v; i++; break;
      case '--color': a.color = v; i++; break;
      case '--stems': a.stems = v; i++; break;
      case '--name': a.name = v; i++; break;
      case '--no-export': a.noExport = true; break;
      case '--concat': a.concat = v; i++; break;
      case '--timeout': a.timeout = Number(v); i++; break;
      case '--json': a.json = true; break;
    case '--keep': a.keep = true; break;
    case '--no-keep': a.keep = false; break;
      case '-h':
      case '--help': a.help = true; break;
      default:
        if (k.startsWith('-')) throw new Error(`未知参数 ${k}`);
    }
  }
  return a;
}

const log = (...xs) => process.stdout.write(xs.join(' ') + '\n');

// ---------- 字幕解析 ----------

// 时间戳：SRT 用 00:00:03,600，VTT 用 00:00:03.600，也接受裸秒数 3.6
function parseTime(s) {
  const t = String(s).trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = t.match(/^(\d+):(\d{2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) throw new Error(`看不懂的时间戳：${s}`);
  const [, h, mi, se, ms] = m;
  return Number(h) * 3600 + Number(mi) * 60 + Number(se) + Number(ms.padEnd(3, '0')) / 1000;
}

// SRT / VTT：按空行切块，第二行是时间轴，其余是文案
function parseSubtitleText(text, kind) {
  const body = kind === 'vtt' ? text.replace(/^\uFEFF?WEBVTT[^\n]*\n/, '') : text;
  const out = [];
  for (const block of body.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').map((x) => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    const idx = lines.findIndex((l) => l.includes('-->'));
    if (idx < 0) continue;                      // 序号块、NOTE 块、样式块都跳过
    const [a, b] = lines[idx].split('-->').map((x) => x.trim().split(/\s+/)[0]);
    const txt = lines.slice(idx + 1).join('\n');
    if (!txt) continue;
    out.push({ start: parseTime(a), end: parseTime(b), text: txt });
  }
  return out;
}

// JSON：接受 [{start,end,text}] / [[a,b,'t']] / {cues|captions|subs:[...]}
function parseSubtitleJson(text) {
  const j = JSON.parse(text);
  const arr = Array.isArray(j) ? j : (j.cues || j.captions || j.subs || null);
  if (!Array.isArray(arr)) throw new Error('JSON 字幕要是一个数组，或 {cues|captions|subs: [...]}');
  return arr.map((x) => {
    if (Array.isArray(x)) return { start: Number(x[0]), end: Number(x[1]), text: String(x[2]) };
    return { start: Number(x.start), end: Number(x.end), text: String(x.text) };
  });
}

// 从 spec.ts 的 SUBS 数组里取：SUBS: Sub[] = [[3.6, 7.4, '文案'], ...]
// 只认「数字, 数字, 单引号字符串」这一种形态——够用且不会误吃别的东西。
function parseSubsFromSpec(path) {
  const src = readFileSync(path, 'utf8');
  const at = src.search(/\bSUBS\b[^=]*=\s*\[/);
  if (at < 0) throw new Error(`${path} 里找不到 SUBS = [...]`);
  // 从 = 之后再找 [：类型标注里也有方括号（SUBS: [number, number, string][] = [...]），
  // 从 SUBS 本身往后找会先撞上类型标注那个 [，深度计数立刻归零，解析出 0 条。
  const eq = src.indexOf('=', at);
  const open = src.indexOf('[', eq);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error('SUBS 数组没有闭合');
  const lit = src.slice(open, end + 1);
  const re = /\[\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*'((?:[^'\\]|\\.)*)'\s*\]/g;
  const out = [];
  let m;
  while ((m = re.exec(lit))) {
    const text = m[3].replace(/\\'/g, "'").replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
    out.push({ start: Number(m[1]), end: Number(m[2]), text });
  }
  if (!out.length) throw new Error(`SUBS 数组里没解析出条目（只认 [[数字, 数字, '文案']] 形态）`);
  return out;
}

function loadSubtitles(a) {
  if (a.subs) {
    const p = resolve(a.subs);
    if (!existsSync(p)) throw new Error(`找不到字幕文件：${p}`);
    const ext = extname(p).toLowerCase();
    const text = readFileSync(p, 'utf8');
    const cues = ext === '.json' ? parseSubtitleJson(text)
      : ext === '.vtt' ? parseSubtitleText(text, 'vtt')
        : parseSubtitleText(text, 'srt');
    return { cues, source: p };
  }
  if (a.subsFromSpec) {
    const p = resolve(a.subsFromSpec);
    if (!existsSync(p)) throw new Error(`找不到 spec 文件：${p}`);
    return { cues: parseSubsFromSpec(p), source: p };
  }
  return null;
}

// ---------- 分轨工具 ----------

/** 判断一个 WAV 是不是全静音。
 *
 *  为什么需要：score.mjs --stems 会导出九层，但本片可能没用环境床（ambience），
 *  那一层就是一条全零的 WAV。铺进 Concat 会多出一条什么都不响的轨，
 *  在 GUI 里看着像「这里本该有内容但丢了」。
 *
 *  读不了文件时返回 false（当作有声）——宁可多一条轨，也不要静默吞掉内容。
 */
function isSilentWav(file, threshold = 8) {
  try {
    const buf = readFileSync(file);
    if (buf.length <= 44) return true;
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
    for (let i = dataStart; i + 1 < dataStart + dataLen; i += 2) {
      if (Math.abs(buf.readInt16LE(i)) > threshold) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ---------- 找 Concat ----------

function findConcat(explicit) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`--concat 指定的文件不存在：${explicit}`);
    return explicit;
  }
  const guesses = [
    'D:\\Program Files\\Concat\\concat.exe',
    'C:\\Program Files\\Concat\\concat.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Concat', 'concat.exe'),
    join(process.env.ProgramFiles || 'C:\\Program Files', 'Concat', 'concat.exe'),
  ];
  for (const g of guesses) if (g && existsSync(g)) return g;
  return 'concat';
}

// ---------- MCP 客户端 ----------

class Concat {
  constructor(exe) {
    this.exe = exe;
    this.child = null;
    this.buf = '';
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
  }

  async start() {
    this.child = spawn(this.exe, ['--mcp', 'headless'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        const waiter = m.id != null ? this.pending.get(m.id) : null;
        if (waiter) { this.pending.delete(m.id); waiter(m); }
      }
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => { this.stderr += d; });
    this.child.on('error', (e) => {
      for (const w of this.pending.values()) w({ error: { message: e.message } });
      this.pending.clear();
    });

    const init = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'motion-ledger-bridge', version: '1.1.0' },
    });
    if (init.error) throw new Error(`握手失败：${init.error.message || JSON.stringify(init.error)}`);
    this.notify('notifications/initialized');
    return init.result?.serverInfo || {};
  }

  rpc(method, params) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error(`${method} 超时`));
      }, 180000);
      this.pending.set(id, (m) => { clearTimeout(timer); res(m); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async tool(name, args) {
    const r = await this.rpc('tools/call', { name, arguments: args });
    if (r.error) throw new Error(`${name}：${r.error.message || JSON.stringify(r.error)}`);
    const content = r.result?.content;
    const text = Array.isArray(content)
      ? content.map((x) => x.text || '').join('\n')
      : JSON.stringify(r.result);
    if (r.result?.isError) throw new Error(`${name} 被拒绝：${text}`);
    let data = null;
    try { data = JSON.parse(text); } catch { /* 有的工具回纯文本 */ }
    return { text, data };
  }

  stop() {
    try { this.child?.kill(); } catch { /* 已经退了 */ }
  }
}

// ---------- 主流程 ----------

async function main() {
  const a = parseArgs(process.argv.slice(2));
  // --out 只在要导出时才必需。--no-export 是「只建工程，我要在 GUI 里试听」。
  if (a.help || !a.film || (!a.out && !a.noExport)) {
    log('用法: node scripts/concat-bridge.mjs --film <成片.mp4> --out <交付.mp4> [选项]');
    log('      node scripts/concat-bridge.mjs --film <成片.mp4> --no-export [选项]');
    log('');
    log('  片源');
    log('  --film <path>             motion-ledger 渲染出的成片（必需）');
    log('  --out <path>              最终交付路径（要导出时必需）');
    log('  --no-export               只建工程不导出（试听/手工调时用，省几十秒）');
    log('  --name <名字>             工程名，默认 film-<时间戳>');
    log('');
    log('  字幕 · 批量（推荐）');
    log('  --subs <path>             .srt / .vtt / .json 字幕文件');
    log('                            .json 接受 [{start,end,text}] / [[a,b,"t"]] / {cues|captions|subs:[...]}');
    log('  --subs-from-spec <path>   直接从 spec.ts 的 SUBS 数组取（单一真相源，不用另存一份）');
    log('  --subs-shift <秒>         整体平移，默认 0');
    log('  --subs-scale <倍数>       时间轴整体缩放（改片长时用），默认 1');
    log('');
    log('  字幕 · 单条（旧行为，仍可用）');
    log('  --caption <文本>          加一条字幕');
    log('  --caption-start <秒>      字幕起点，默认 0.5');
    log('  --caption-dur <秒>        字幕时长，默认 3');
    log('');
    log('  字幕 · 外观（两种模式共用）');
    log('  --caption-size <比例>     字号占画幅高度比例；单条默认 0.09，批量默认 0.04');
    log('  --caption-offset <比例>   距画面中心的比例：0.35 近底部（默认），0 居中，-0.35 顶部');
    log('  --caption-bg <#rrggbb[aa]> 字幕底板色，带 alpha；省略 = 无底板');
    log('  --caption-maxwidth <比例> 换行宽度，占画幅宽度比例，默认 0 = 不换行');
    log('  --caption-lineheight <倍数> 行距倍数，默认 1.2');
    log('  --caption-weight <100-900> 字重；单条默认 600，批量默认 600');
    log('  --font <字体名>           默认 Noto Sans SC');
    log('  --color <#rrggbb>         默认 #F4F1EA');
    log('');
    log('  分轨（给了就把配乐拆成一层一条轨，视频轨自动静音）');
    log('  --stems <目录>            读目录里所有 .wav，一个文件一条轨');
    log('                            配合 score.mjs --stems 产出的 public/stems');
    log('');
    log('  其他');
    log('  --work <目录>             工程目录；默认在用户主目录下（headless 只许写那儿）');
    log('  --concat <path>           指定 concat.exe；默认自动找');
    log('  --timeout <秒>            导出等待上限，默认 300');
    log('  --json                    输出机器可读结果');
    log('  --keep                    保留中间工程目录（现在默认就保留）');
    log('  --no-keep                 导出成功后删掉工程目录');
    process.exit(a.help ? 0 : 2);
  }

  const film = resolve(a.film);
  // --no-export 时没有 --out，out 保持 null；只有真要导出才 resolve。
  const out = a.noExport ? null : resolve(a.out);
  if (!existsSync(film)) throw new Error(`找不到成片：${film}`);

  // 先解析字幕再动 Concat——字幕文件写错时不该白起一个进程
  const subs = loadSubtitles(a);
  const cues = subs
    ? subs.cues
      .map((c) => ({
        start: Math.max(0, c.start * a.subsScale + a.subsShift),
        end: Math.max(0, c.end * a.subsScale + a.subsShift),
        text: c.text,
      }))
      .filter((c) => c.end > c.start && c.text.trim())
      .sort((x, y) => x.start - y.start)
    : null;
  if (cues && !cues.length) throw new Error('字幕文件解析出 0 条有效条目');

  const workRoot = a.work ? resolve(a.work) : join(homedir(), '.motion-ledger-concat');
  const projectName = a.name ? String(a.name) : 'film-' + Date.now().toString(36);
  const projectDir = join(workRoot, projectName);
  if (!existsSync(workRoot)) mkdirSync(workRoot, { recursive: true });

  const exe = findConcat(a.concat);
  const c = new Concat(exe);
  const result = {
    concat: exe, project: projectDir, film, out,
    caption: a.caption, subs: subs?.source || null, cueCount: cues?.length || 0,
    ok: false,
  };

  try {
    const info = await c.start();
    result.version = info.version;
    if (!a.json) log(`Concat ${info.version || '?'} · ${exe}`);

    // 1) 建工程
    await c.tool('project_create', { location: workRoot, name: projectName });
    if (!a.json) log(`工程 ${projectDir}`);

    // 2) 导入成片
    const imp = await c.tool('media_import', { path: projectDir, file: film });
    const mediaId = imp.data?.createdId;
    const media = imp.data?.media?.find((m) => m.id === mediaId);
    if (!mediaId) throw new Error('导入后没拿到 mediaId');
    result.media = { id: mediaId, duration: media?.duration, width: media?.width, height: media?.height };
    if (!a.json) log(`导入 ${mediaId} · ${media?.duration}s · ${media?.width}×${media?.height}`);

    // 3) 上时间线。start 是绝对秒，从 0 起才是「接在原片开头」。
    const add = await c.tool('clip_add', {
      path: projectDir, mediaId, trackId: 'T1', start: 0,
    });
    result.clip = add.data?.createdId;

    // 3b) 分轨：给了 --stems 就把配乐拆成一层一条轨。
    //
    // 为什么视频轨必须静音：成片自带混好的音轨，不静音的话听到的是
    // 「分轨 + 成片音轨」两遍配乐叠在一起，而且成片音轨会盖掉分轨，
    // 逐轨静音试听就失去意义了。
    let stemTracks = [];
    if (a.stems) {
      const stemDir = resolve(a.stems);
      if (!existsSync(stemDir)) throw new Error(`--stems 目录不存在：${stemDir}`);
      const files = readdirSync(stemDir)
        .filter((f) => extname(f).toLowerCase() === '.wav')
        .sort();
      if (!files.length) throw new Error(`--stems 目录里没有 .wav：${stemDir}`);

      // 静音视频轨。clip_update 的 patch.muted 是唯一正确做法——
      // 不要试图删视频的音轨，那是 detachAudio，会多出一条真音轨。
      await c.tool('clip_update', { path: projectDir, clipId: result.clip, patch: { muted: true } });
      if (!a.json) log('视频轨已静音（只听分轨）');

      // 分轨之和听起来比成品小几 dB：分轨是母版链（含限幅器）之前的信号。
      // score.mjs 会把建议补偿量写进 stems.json，这里读出来设到每条分轨的
      // clip.volume 上。为什么不直接放大 WAV：那会削顶，而 WAV 要留着做诊断。
      let stemVol = 1;
      const metaPath = join(stemDir, 'stems.json');
      if (existsSync(metaPath)) {
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
          if (Number.isFinite(meta.suggestGain) && meta.suggestGain > 0) stemVol = meta.suggestGain;
        } catch { /* 读坏了就当 1，不影响工程生成 */ }
      }
      if (stemVol !== 1 && !a.json) {
        log(`  分轨音量补偿 ×${stemVol.toFixed(2)}（${(20 * Math.log10(stemVol)).toFixed(1)} dB，来自 stems.json）`);
      }

      for (const f of files) {
        const name = basename(f, extname(f));
        // 全静音的层跳过：铺上去就是一条什么都不响的轨，在 GUI 里像「丢了内容」
        if (isSilentWav(join(stemDir, f))) {
          if (!a.json) log(`  跳过静音层 ${name}`);
          continue;
        }
        const t = await c.tool('track_add', { path: projectDir });
        // createdId 是小写 t42；timeline.tracks[] 里是 T1。两个不能混用。
        const trackId = t.data?.createdId ?? t.data?.timeline?.tracks?.at(-1)?.id;
        const im = await c.tool('media_import', { path: projectDir, file: join(stemDir, f) });
        // media_import 的 structuredContent 同时带 createdId 和整个 media 列表，
        // 遍历整个对象找 id 会撞到第一个旧条目（踩过：九条轨全放了 film.mp4）。
        const sid = im.data?.createdId ?? im.data?.media?.id;
        const ca = await c.tool('clip_add', { path: projectDir, mediaId: sid, trackId, start: 0 });
        if (stemVol !== 1) {
          const cid = ca.data?.createdId;
          if (cid) await c.tool('clip_update', { path: projectDir, clipId: cid, patch: { volume: stemVol } });
        }
        stemTracks.push({ name, trackId });
        if (!a.json) log(`  ${name.padEnd(11)} → ${trackId}`);
      }
      result.stems = stemTracks;
    }

    // 4a) 批量字幕：一次落一条轨，一个 undo 步
    if (cues) {
      const style = {
        fontFamily: a.font,
        fontSize: a.captionSize ?? 0.04,
        fontWeight: a.captionWeight ?? 600,
        color: a.color,
        align: 'center',
        lineHeight: a.captionLineHeight,
      };
      if (a.captionBg) style.background = a.captionBg;
      if (a.captionMaxWidth > 0) style.maxWidth = a.captionMaxWidth;

      const r = await c.tool('captions_add', {
        path: projectDir,
        captions: cues,
        offsetY: a.captionOffset,
        style,
      });
      const ids = (r.data?.createdIds || r.data?.created || []);
      result.captions = { count: cues.length, ids: Array.isArray(ids) ? ids.length : undefined };
      if (!a.json) {
        const first = cues[0], last = cues[cues.length - 1];
        log(`字幕 ${cues.length} 条 · ${first.start.toFixed(2)}–${last.end.toFixed(2)}s · offsetY ${a.captionOffset}`);
        log(`  来源 ${subs.source}`);
      }
    }

    // 4b) 单条字幕（旧行为）
    if (a.caption) {
      const style = {
        content: a.caption,
        fontFamily: a.font,
        fontSize: a.captionSize ?? 0.09,
        fontWeight: a.captionWeight ?? 600,
        color: a.color,
        align: 'center',
        lineHeight: a.captionLineHeight,
      };
      if (a.captionBg) style.background = a.captionBg;
      if (a.captionMaxWidth > 0) style.maxWidth = a.captionMaxWidth;
      const t = await c.tool('title_add', {
        path: projectDir,
        start: a.captionStart,
        duration: a.captionDur,
        offsetY: a.captionOffset === 0.35 ? null : a.captionOffset,  // 0.35 是批量默认，单条不传保持原样
        style,
      });
      result.title = t.data?.createdId;
      if (!a.json) log(`字幕「${a.caption}」· ${a.captionStart}–${a.captionStart + a.captionDur}s`);
    }

    // 4c) 删空轨。新建工程自带 4 条空轨（T1–T4），只用了 T1 和后面新建的，
    //     剩下的空轨在 GUI 里就是几条「什么都没有的横条」，看着像内容丢了。
    //
    //     必须放在所有 clip 铺完之后：先删会让后面的 track_add 复用编号，
    //     而 Concat 的轨道 id 删除后不重排。
    {
      const tl = await c.tool('timeline_read', { path: projectDir });
      const tracks = tl.data?.timeline?.tracks || [];
      const clips = tl.data?.timeline?.clips || [];
      const used = new Set(clips.map((cl) => cl.track ?? cl.trackId));
      const empties = tracks.filter((t) => !used.has(t.id));
      for (const t of empties) {
        await c.tool('edit_apply', { path: projectDir, command: { op: 'removeTrack', trackId: t.id } });
      }
      if (empties.length && !a.json) log(`删掉 ${empties.length} 条空轨（${empties.map((t) => t.id).join(', ')}）`);
    }

    // 5) 保存
    //
    // project_save 必须放在所有编辑之后。踩过：它写在删空轨之前，
    // 删轨只活在内存里，重开工程 T2/T3/T4 又回来了。Concat 的编辑默认不落盘。
    await c.tool('project_save', { path: projectDir });

    // --no-export：只建工程不导出。用途是「我要在 GUI 里逐轨试听调平衡」——
    // 导出一次要几十秒，调平衡时每改一次就导一次纯属浪费。
    if (a.noExport) {
      result.ok = true;
      result.projectDir = projectDir;
      if (!a.json) log(`工程保留在 ${projectDir}（--no-export，未导出）`);
      return;
    }

    // 6) 导出。临时落在工程旁，成功后拷到 --out，避免跨盘写入被拒。
    const staged = join(workRoot, `${projectName}.mp4`);
    const ex = await c.tool('export_start', { path: projectDir, output: staged });
    const job = ex.data?.job;
    if (!job) throw new Error('export_start 没回 job');

    const deadline = Date.now() + a.timeout * 1000;
    let status = null;
    while (Date.now() < deadline) {
      const w = await c.tool('export_wait', { job, timeoutSeconds: 120 });
      status = w.data;
      if (status?.state && status.state !== 'running') break;
    }
    result.export = { job, state: status?.state, stage: status?.stage, error: status?.error };
    if (status?.state !== 'done') {
      throw new Error(`导出未完成：state=${status?.state} ${status?.error || ''}`.trim());
    }

    // 7) 搬到交付位置
    const outDir = dirname(out);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    copyFileSync(staged, out);
    result.bytes = statSync(out).size;
    result.ok = true;
    if (!a.json) log(`交付 ${out} · ${result.bytes} bytes`);
    // 工程路径必须说出来：用户要在 Concat GUI 里打开它继续改。
    // 之前的默认行为是导出完就删，用户打开 Concat 只看到「项目不存在」。
    if (!a.json) log(`工程保留在 ${projectDir}`);
  } finally {
    c.stop();
    // 清掉 concat.lock：Concat 在进程退出时不一定回收它，留下的锁会让 GUI
    // 打开工程时报「已被占用」。PID 已被系统回收给别的进程时更是死锁。
    try { rmSync(join(projectDir, 'concat.lock'), { force: true }); } catch { /* 没锁就算了 */ }
    if (!a.keep) {
      try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* 占着就算了 */ }
      try { rmSync(join(workRoot, `${projectName}.mp4`), { force: true }); } catch { /* 同上 */ }
      try {
        const { readdirSync, rmdirSync } = await import('node:fs');
        if (readdirSync(workRoot).length === 0) rmdirSync(workRoot);
      } catch { /* 非空就不动 */ }
    }
    if (a.json) log(JSON.stringify(result, null, 2));
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  const msg = String(e && e.message ? e.message : e);
  log('失败：' + msg);
  if (/writesUnder|Permission|denied|not open/i.test(msg)) {
    log('提示：Concat headless 只允许写用户主目录，用 --work 指定别处，或让它留在默认位置。');
  }
  process.exit(1);
});
