// 发布：改完 skill 就推 GitHub，作为长期记忆。
//
// 这不是「一个方便的推送脚本」，是一条纪律的执行器：
//   1. 先把门禁全跑一遍——门禁不过就拒绝提交。坏的门禁比没有门禁更糟。
//   2. 再查有没有「改了文档没改代码」的悬空引用。
//   3. 提交信息从改动文件自动归类，写清楚改了什么。
//   4. 推上去。推失败不吞错，原样报出来。
//
// 用法：
//   node scripts/publish.mjs                    # 跑门禁 → 提交 → 推送
//   node scripts/publish.mjs --dry              # 只跑门禁和自查，不提交
//   node scripts/publish.mjs -m "改了什么"       # 自定义提交信息
//   node scripts/publish.mjs --skip-gates       # 跳过门禁（只在改文档时用，会警告）
//
// 为什么要有这一步：用户明确要求「每次更新优化完 skill，同步推送到 github，作为长期记忆」。
// 靠记性做不到——所以把它变成一条命令，并在 SKILL.md 里写成收尾纪律。

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function gitPath() {
  const guesses = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe'),
  ];
  for (const g of guesses) if (g && existsSync(g)) return g;
  return 'git';
}
const GIT = gitPath();

// 沙箱/受限环境里 spawnSync 的 pipe 会被拒，所以统一走文件重定向。
function run(cmd, args, { cwd = ROOT, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  if (r.status !== 0 && !allowFail) {
    const err = new Error(`${cmd} ${args.join(' ')} 失败（exit ${r.status}）\n${out.trim()}`);
    err.output = out;
    throw err;
  }
  return { status: r.status, out };
}

const git = (args, opts) => run(GIT, args, opts);

function parseArgs(argv) {
  const a = { dry: false, skipGates: false, message: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dry') a.dry = true;
    else if (argv[i] === '--skip-gates') a.skipGates = true;
    else if (argv[i] === '-m' || argv[i] === '--message') a.message = argv[++i];
  }
  return a;
}

const log = (...xs) => process.stdout.write(xs.join(' ') + '\n');
const fail = (...xs) => { process.stderr.write(xs.join(' ') + '\n'); };

// ---------- 门禁 ----------

const GATES = [
  { name: '门禁自测', args: ['verify/selftest.mjs'], why: '门禁自己坏了，后面全部结论都不可信' },
  { name: '配乐脚本一致', args: ['verify/sync.mjs'], why: '两份 score.mjs 分叉后，两条路线的音色会悄悄不同' },
  {
    name: '台账对账 · remotion-starter',
    args: ['verify/spec.mjs', '--ledger', 'templates/remotion-starter/LEDGER.md', '--src', 'templates/remotion-starter/src'],
    why: '台账写了但代码没兑现',
  },
  {
    name: '台账对账 · node-starter',
    args: ['verify/spec.mjs', '--ledger', 'templates/node-starter/LEDGER.md', '--src', 'templates/node-starter/src'],
    why: '同上',
  },
  {
    name: '成片门禁 · remotion-starter',
    args: ['verify/film.mjs',
      '--film', 'templates/remotion-starter/out/film.mp4',
      '--spec', 'templates/remotion-starter/src/spec.ts',
      '--ledger', 'templates/remotion-starter/LEDGER.md'],
    why: '成片与 spec / 台账不符',
    optional: true, // 没渲染过就没有 out/，那不算错
  },
  {
    name: '成片门禁 · node-starter',
    args: ['verify/film.mjs',
      '--film', 'templates/node-starter/out/film.mp4',
      '--spec', 'templates/node-starter/src/spec.mjs',
      '--ledger', 'templates/node-starter/LEDGER.md'],
    why: '同上',
    optional: true,
  },
];

function runGates() {
  const results = [];
  for (const g of GATES) {
    const [script, ...rest] = g.args;
    if (!existsSync(join(ROOT, script))) {
      results.push({ ...g, status: 'missing', detail: `${script} 不存在` });
      continue;
    }
    // 成片门禁在没渲染过时直接跳过：没有 out/ 不代表代码坏了
    if (g.optional) {
      const filmIdx = rest.indexOf('--film');
      const film = filmIdx >= 0 ? join(ROOT, rest[filmIdx + 1]) : null;
      if (film && !existsSync(film)) {
        results.push({ ...g, status: 'skipped', detail: '成片未渲染' });
        continue;
      }
    }
    const r = spawnSync(process.execPath, [join(ROOT, script), ...rest], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
    });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    results.push({ ...g, status: r.status === 0 ? 'pass' : 'fail', detail: out });
  }
  return results;
}

// ---------- 悬空引用 ----------

// 文档里提到的路径必须真实存在。这条不是洁癖——之前就发生过
// 「文档说不许改 src/lib/motion.tsx，但那个文件当时不存在」。
function checkDanglingRefs() {
  const docs = ['README.md', 'SKILL.md', 'PUBLISH.md', 'ATTRIBUTION.md',
    'references/01-ledgers.md', 'references/02-playbooks.md', 'references/03-timing-and-grammar.md',
    'references/04-engineering-contract.md', 'references/05-review.md', 'references/06-sound.md',
    'references/07-competitive-map.md', 'references/08-delivery.md', 'references/09-capabilities.md'];
  const bad = [];
  // 只查带路径分隔符的引用。裸文件名（`spec.ts`、`cues.json`）在正文里是
  // 泛指的「那个文件」，可能属于仓库根、某个 starter、或某个 examples 目录——
  // 强行按某个基准去解析只会产生噪声。带 `/` 的才是真正的路径承诺。
  const re = /`([A-Za-z0-9_\-][A-Za-z0-9_\-./]*\/[A-Za-z0-9_\-./]+\.(?:mjs|ts|tsx|js|md|json|wav|mp4|sh))`/g;
  const bases = ['', 'templates/remotion-starter/', 'templates/node-starter/', 'references/'];
  for (const d of docs) {
    const p = join(ROOT, d);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(re)) {
      const ref = m[1];
      if (ref.startsWith('http') || ref.includes('*') || ref.includes('<')) continue;
      if (bases.some((b) => existsSync(join(ROOT, b, ref)))) continue;
      bad.push(`${d} → \`${ref}\``);
    }
  }
  return bad;
}

// ---------- 提交信息 ----------

function classify(files) {
  const groups = { skill: [], refs: [], verify: [], templates: [], docs: [], scripts: [] };
  for (const f of files) {
    if (f === 'SKILL.md') groups.skill.push(f);
    else if (f.startsWith('references/')) groups.refs.push(f);
    else if (f.startsWith('verify/')) groups.verify.push(f);
    else if (f.startsWith('templates/')) groups.templates.push(f);
    else if (f.startsWith('scripts/')) groups.scripts.push(f);
    else groups.docs.push(f);
  }
  const parts = [];
  if (groups.skill.length) parts.push('SKILL');
  if (groups.refs.length) parts.push('参考文档');
  if (groups.verify.length) parts.push('门禁');
  if (groups.templates.length) parts.push('模板');
  if (groups.scripts.length) parts.push('脚本');
  if (groups.docs.length) parts.push('说明');
  return { groups, summary: parts.join(' / ') };
}

function autoMessage(files) {
  const { groups, summary } = classify(files);
  const lines = [`chore: 更新 ${summary}`, ''];
  const show = (title, xs) => {
    if (!xs.length) return;
    lines.push(title);
    for (const f of xs.slice(0, 12)) lines.push(`  ${f}`);
    if (xs.length > 12) lines.push(`  … 另 ${xs.length - 12} 个`);
    lines.push('');
  };
  show('SKILL.md', groups.skill);
  show('参考文档', groups.refs);
  show('门禁', groups.verify);
  show('模板', groups.templates);
  show('脚本', groups.scripts);
  show('说明', groups.docs);
  lines.push('门禁：node verify/selftest.mjs 全绿后提交。');
  return lines.join('\n');
}

// ---------- 主流程 ----------

function main() {
  const a = parseArgs(process.argv.slice(2));

  // 是不是 git 仓库
  const inside = git(['rev-parse', '--is-inside-work-tree'], { allowFail: true });
  if (inside.status !== 0) {
    fail('这里不是 git 仓库。先 git init，或确认在 motion-ledger 目录下跑。');
    process.exit(2);
  }

  // 1) 门禁
  if (!a.skipGates) {
    log('=== 门禁 ===');
    const results = runGates();
    let hard = 0;
    for (const r of results) {
      const tag = r.status === 'pass' ? 'PASS' : r.status === 'skipped' ? 'SKIP' : r.status === 'missing' ? 'MISS' : 'FAIL';
      log(`[${tag}] ${r.name}`);
      if (r.status === 'fail') {
        hard++;
        log(r.detail.split('\n').slice(0, 12).map((l) => '       ' + l).join('\n'));
      } else if (r.status === 'missing') {
        hard++;
      } else if (r.status === 'skipped') {
        log('       ' + r.detail);
      }
    }
    if (hard > 0) {
      fail(`\n门禁未通过（${hard} 项）。拒绝提交——坏的门禁比没有门禁更糟。`);
      fail('确要跳过：node scripts/publish.mjs --skip-gates（只用于纯文档改动）');
      process.exit(1);
    }
  } else {
    log('=== 门禁（已跳过，仅限纯文档改动）===');
  }

  // 2) 悬空引用
  log('\n=== 悬空引用 ===');
  const dangling = checkDanglingRefs();
  if (dangling.length) {
    for (const d of dangling) fail('  ' + d);
    fail(`\n文档引用了 ${dangling.length} 个不存在的文件。先补齐或改掉引用。`);
    process.exit(1);
  }
  log('  无悬空引用');

  // 3) 有没有改动
  // -uall 展开未跟踪目录（否则只报 `scripts/`，看不出到底动了哪些文件）；
  // 用 --porcelain=v1 -z 会更稳，但这里要人看的列表，就按两列状态码正确切片。
  const status = git(['status', '--porcelain', '-uall']).out.replace(/\s+$/, '');
  if (!status) {
    log('\n没有改动，无需发布。');
    process.exit(0);
  }
  const changed = status.split('\n')
    .map((l) => l.slice(2).trim())      // 前两位是 XY 状态码，第 3 位起是路径
    .map((p) => p.replace(/^"|"$/g, '')) // 含空格/中文的路径会被引号包起来
    .filter(Boolean);

  log('\n=== 待提交 ===');
  for (const f of changed) log('  ' + f);

  if (a.dry) {
    log('\n--dry：不提交。');
    process.exit(0);
  }

  // 4) 提交
  log('\n=== 提交 ===');
  git(['add', '-A']);
  const msg = a.message || autoMessage(changed);
  git(['commit', '-m', msg]);
  const head = git(['log', '-1', '--oneline']).out.trim();
  log('  ' + head);

  // 5) 推送
  log('\n=== 推送 ===');
  const push = git(['push'], { allowFail: true });
  if (push.status !== 0) {
    fail(push.out.trim());
    fail('\n推送失败。检查：');
    fail('  - git remote -v 里 origin 对不对');
    fail('  - ssh 能不能通：ssh -T git@github.com');
    fail('  - 提交已经在本地了，网络恢复后直接 git push 即可，不用重做');
    process.exit(1);
  }
  log('  ' + (push.out.trim() || '已推送'));

  const remote = git(['remote', 'get-url', 'origin'], { allowFail: true }).out.trim();
  log(`\n完成。远端：${remote}`);
}

try {
  main();
} catch (e) {
  fail('失败：' + (e.message || e));
  if (e.output) fail(e.output.trim());
  process.exit(1);
}
