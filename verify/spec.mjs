#!/usr/bin/env node
// verify/spec.mjs — 台账与源码对账门禁（零依赖）
//
//   node verify/spec.mjs --ledger LEDGER.md --src src/
//
// 查四件事：
//   1. 台账覆盖率：每条 S/X/E 是否在源码里出现
//   2. 未记账常量：源码顶层 const 没有台账 id
//   3. starter 占位符残留
//   4. 禁用项（Math.random / Date.now / TODO / 无动机渐变 / glow / emoji ...）

import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';
import {
  parseArgs, makeReporter, readText, walkSources,
  parseLedger, collectSourceIds, scanConstants,
  scanForbidden, scanPlaceholders,
} from './lib.mjs';

const args = parseArgs();
const ledgerPath = typeof args.ledger === 'string' ? args.ledger : 'LEDGER.md';
const srcPath = typeof args.src === 'string' ? args.src : 'src';

const r = makeReporter('motion-ledger · spec 对账');

/* ---- 读台账 ---- */

if (!existsSync(ledgerPath)) {
  r.fail('台账文件', `${ledgerPath} 不存在`);
  r.summary();
  process.exit(1);
}

const ledgerText = readText(ledgerPath) || '';
const ledger = parseLedger(ledgerText);

if (ledger.size === 0) {
  r.fail('台账内容', '没有解析到任何 S/X/E 条目');
  r.summary();
  process.exit(1);
}

const counts = { S: 0, X: 0, E: 0 };
for (const [, v] of ledger) counts[v.kind]++;
r.pass('台账已解析', `S ${counts.S} / X ${counts.X} / E ${counts.E}，共 ${ledger.size} 条`);

/* ---- 读源码 ---- */

const files = walkSources(srcPath);
if (files.length === 0) {
  r.fail('源码目录', `${srcPath} 下没有可扫描的源文件`);
  r.summary();
  process.exit(1);
}

const sources = files.map((file) => ({
  file: relative(process.cwd(), file),
  text: readFileSync(file, 'utf8'),
}));
r.pass('源码已读取', `${sources.length} 个文件`);

/* ---- 1. 覆盖率 ---- */

const sourceIds = collectSourceIds(sources);
const missing = [];
for (const [id, meta] of ledger) {
  if (!sourceIds.has(id)) missing.push({ id, ...meta });
}

if (missing.length === 0) {
  r.pass('台账覆盖率', `${ledger.size}/${ledger.size} 条已回写源码`);
} else {
  const starMissing = missing.filter((m) => m.star).length;
  r.fail('台账覆盖率', `${ledger.size - missing.length}/${ledger.size}，缺 ${missing.length} 条${starMissing ? `（其中 ${starMissing} 条为推测补全）` : ''}`);
  for (const m of missing.slice(0, 20)) {
    console.log(`        ${m.id}  LEDGER.md:${m.line}  ${m.raw.slice(0, 70)}`);
  }
  if (missing.length > 20) console.log(`        … 还有 ${missing.length - 20} 条`);
}

/* ---- 2. 未记账常量 ---- */

const unaccounted = scanConstants(sources);
if (unaccounted.length === 0) {
  r.pass('未记账常量', '所有顶层常量都带台账 id');
} else {
  r.warn('未记账常量', `${unaccounted.length} 个顶层常量没有台账 id`);
  for (const u of unaccounted.slice(0, 15)) {
    console.log(`        ${u.file}:${u.line}  ${u.text}`);
  }
  if (unaccounted.length > 15) console.log(`        … 还有 ${unaccounted.length - 15} 个`);
  console.log(`        ${'\x1b[2m'}加 // S## 注释，或在行尾写 // ledger-allow: 理由${'\x1b[0m'}`);
}

/* ---- 3. 占位符 ---- */

const placeholders = scanPlaceholders(sources);
if (placeholders.length === 0) {
  r.pass('starter 占位符', '无残留');
} else {
  r.fail('starter 占位符', `${placeholders.length} 处残留`);
  for (const p of placeholders.slice(0, 15)) {
    console.log(`        ${p.file}:${p.line}  [${p.rule}] ${p.text}`);
  }
}

/* ---- 4. 禁用项 ---- */

const forbidden = scanForbidden(sources);
if (forbidden.length === 0) {
  r.pass('禁用项', '未命中');
} else {
  const byRule = new Map();
  for (const f of forbidden) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1);
  r.fail('禁用项', `${forbidden.length} 处命中：${[...byRule].map(([k, v]) => `${k}×${v}`).join(', ')}`);
  for (const f of forbidden.slice(0, 20)) {
    console.log(`        ${f.file}:${f.line}  [${f.rule}] ${f.text}`);
    console.log(`        ${'\x1b[2m'}→ ${f.why}${'\x1b[0m'}`);
  }
  if (forbidden.length > 20) console.log(`        … 还有 ${forbidden.length - 20} 处`);
}

/* ---- 汇总 ---- */

const { failed, warned } = r.summary();

if (failed > 0) {
  console.log(`${'\x1b[2m'}覆盖率不是"差不多"，是有条款没履行。${'\x1b[0m'}\n`);
}
process.exit(failed > 0 ? 1 : 0);
