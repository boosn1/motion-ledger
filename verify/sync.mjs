#!/usr/bin/env node
// 两份 score.mjs 是否还一致。
//
// 为什么会有两份：starter 必须**自包含**——用户 `cp -R templates/remotion-starter my-film`
// 之后，那个目录要能独立 `npm install && npm run score`，任何指回仓库根的相对路径都会断。
// 所以配乐脚本在每个 starter 里各存一份。
//
// 代价是它们会漂移：修了 remotion-starter 里的一个 bug，忘了同步 node-starter，
// 于是两条路线合成的配乐不一样，而没人会发现。
// 这个脚本就是那道检查。不是让它俩永远一样——是让「不一样」必须是一个有意识的决定。
//
// 用法：
//   node verify/sync.mjs            比对，不一致则退出码 1
//   node verify/sync.mjs --write    用 remotion-starter 的版本覆盖 node-starter
//
// 退出码：0 一致（或已写入）/ 1 不一致 / 2 文件缺失

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// 主副本在前：冲突时以它为准。
const FILES = [
  join(ROOT, 'templates', 'remotion-starter', 'scripts', 'score.mjs'),
  join(ROOT, 'templates', 'node-starter', 'scripts', 'score.mjs'),
];

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function shortHash(h) {
  return h.slice(0, 12);
}

// 逐行差异，只报到第一处不同为止——两处不同通常意味着整体重写，
// 那不是「忘了同步」，那是「故意分叉」，应该走人看，而不是让脚本列 200 行。
function firstDiff(a, b) {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      return {
        line: i + 1,
        a: la[i] === undefined ? '<文件到此结束>' : la[i],
        b: lb[i] === undefined ? '<文件到此结束>' : lb[i],
        aLines: la.length,
        bLines: lb.length,
      };
    }
  }
  return null;
}

function main() {
  const missing = FILES.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error('✗ 找不到文件：');
    for (const m of missing) console.error(`    ${m}`);
    process.exit(2);
  }

  const [main, other] = FILES;
  const mainText = readFileSync(main, 'utf8');
  const otherText = readFileSync(other, 'utf8');
  const hm = digest(main);
  const ho = digest(other);

  const rel = (p) => p.slice(ROOT.length + 1).replace(/\\/g, '/');
  console.log(`  ${rel(main).padEnd(44)} sha256:${shortHash(hm)}`);
  console.log(`  ${rel(other).padEnd(44)} sha256:${shortHash(ho)}`);

  if (hm === ho) {
    console.log('✓ 两份 score.mjs 一致');
    process.exit(0);
  }

  const d = firstDiff(mainText, otherText);
  console.error('');
  console.error('✗ 两份 score.mjs 不一致——配乐合成行为会在两条路线之间分叉。');
  if (d) {
    console.error(`  第一处不同在第 ${d.line} 行（${d.aLines} 行 vs ${d.bLines} 行）：`);
    console.error(`    主副本: ${JSON.stringify(d.a)}`);
    console.error(`    另一份: ${JSON.stringify(d.b)}`);
  }
  console.error('');
  console.error('  修法二选一：');
  console.error('    a) 同步过去：node verify/sync.mjs --write');
  console.error('    b) 确认这是有意的分叉（两条路线真的需要不同的配乐实现）——');
  console.error('       那就把这段说明写进两个文件的头部注释，并从这里移除对应条目。');
  console.error('  「先不管」不是选项：分叉的配乐脚本会在几个月后变成「为什么这条片子');
  console.error('  的音色和那条不一样，但代码看起来一样」这类查不出来的问题。');

  if (WRITE) {
    writeFileSync(other, mainText);
    console.log('');
    console.log(`✓ 已用主副本覆盖 ${rel(other)}`);
    console.log(`  新 sha256:${shortHash(digest(other))}`);
    process.exit(0);
  }

  process.exit(1);
}

main();
