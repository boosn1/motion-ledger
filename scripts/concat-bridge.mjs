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
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --caption "静水流深" --caption-start 0.5 --caption-dur 3
//   node scripts/concat-bridge.mjs --film out/film.mp4 --out final.mp4 --json    // 输出机器可读结果
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

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// ---------- 参数 ----------

function parseArgs(argv) {
  const a = {
    film: null,
    out: null,
    work: null,
    caption: null,
    captionStart: 0.5,
    captionDur: 3,
    captionSize: 0.09,
    font: 'Noto Sans SC',
    color: '#F4F1EA',
    concat: null,
    json: false,
    keep: false,
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
      case '--caption-size': a.captionSize = Number(v); i++; break;
      case '--font': a.font = v; i++; break;
      case '--color': a.color = v; i++; break;
      case '--concat': a.concat = v; i++; break;
      case '--timeout': a.timeout = Number(v); i++; break;
      case '--json': a.json = true; break;
      case '--keep': a.keep = true; break;
      case '-h':
      case '--help': a.help = true; break;
      default:
        if (k.startsWith('-')) throw new Error(`未知参数 ${k}`);
    }
  }
  return a;
}

const log = (...xs) => process.stdout.write(xs.join(' ') + '\n');

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
  // 最后试 PATH
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

    // 进程起来要一点时间；握手本身带超时，不用 sleep
    const init = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'motion-ledger-bridge', version: '1.0.0' },
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

  // 调一个 MCP 工具；被拒时抛错并带上 Concat 自己的原话
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
  if (a.help || !a.film || !a.out) {
    log('用法: node scripts/concat-bridge.mjs --film <成片.mp4> --out <交付.mp4> [选项]');
    log('');
    log('  --film <path>             motion-ledger 渲染出的成片（必需）');
    log('  --out <path>              最终交付路径（必需）');
    log('  --caption <文本>          加一条字幕');
    log('  --caption-start <秒>      字幕起点，默认 0.5');
    log('  --caption-dur <秒>        字幕时长，默认 3');
    log('  --caption-size <比例>     字号占画幅高度的比例，默认 0.09');
    log('  --font <字体名>           默认 Noto Sans SC');
    log('  --color <#rrggbb>         默认 #F4F1EA');
    log('  --work <目录>             工程目录；默认在用户主目录下（headless 只许写那儿）');
    log('  --concat <path>           指定 concat.exe；默认自动找');
    log('  --timeout <秒>            导出等待上限，默认 300');
    log('  --json                    输出机器可读结果');
    log('  --keep                    保留中间工程目录');
    process.exit(a.help ? 0 : 2);
  }

  const film = resolve(a.film);
  const out = resolve(a.out);
  if (!existsSync(film)) throw new Error(`找不到成片：${film}`);

  // headless 模式只允许写用户主目录下，所以工程默认放那儿
  const workRoot = a.work ? resolve(a.work) : join(homedir(), '.motion-ledger-concat');
  const projectName = 'film-' + Date.now().toString(36);
  const projectDir = join(workRoot, projectName);
  if (!existsSync(workRoot)) mkdirSync(workRoot, { recursive: true });

  const exe = findConcat(a.concat);
  const c = new Concat(exe);
  const result = { concat: exe, project: projectDir, film, out, caption: a.caption, ok: false };

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

    // 4) 字幕（可选）。文案必须在 style.content——放顶层会得到占位符 "Your text"。
    if (a.caption) {
      const t = await c.tool('title_add', {
        path: projectDir,
        start: a.captionStart,
        duration: a.captionDur,
        style: {
          content: a.caption,
          fontFamily: a.font,
          fontSize: a.captionSize,
          fontWeight: 600,
          color: a.color,
          align: 'center',
        },
      });
      result.title = t.data?.createdId;
      if (!a.json) log(`字幕「${a.caption}」· ${a.captionStart}–${a.captionStart + a.captionDur}s`);
    }

    // 5) 保存
    await c.tool('project_save', { path: projectDir });

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
  } finally {
    c.stop();
    if (!a.keep) {
      try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* 占着就算了 */ }
      try { rmSync(join(workRoot, `${projectName}.mp4`), { force: true }); } catch { /* 同上 */ }
      try {
        // 主目录空了就一起收掉，不留痕迹
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
  // 把 Concat 的 stderr 尾巴带出来——写权限被拒、DLL 缺失这类问题只在这儿看得到
  if (/writesUnder|Permission|denied|not open/i.test(msg)) {
    log('提示：Concat headless 只允许写用户主目录，用 --work 指定别处，或让它留在默认位置。');
  }
  process.exit(1);
});
