#!/usr/bin/env node
/**
 * 金样本抓取/对比工具（阶段②安全网）。
 *
 * 用法：
 *   node scripts/capture-golden.mjs capture <baseUrl> <outDir>   # 抓取基线
 *   node scripts/capture-golden.mjs diff    <baseDir> <candDir>  # 逐端点对比
 *
 * 抓取的都是读端点（GET）；含时间戳的易变字段在 diff 时归一化。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';

const ROUTES = [
  ['health', '/health'],
  ['summary', '/functions/tud-account-usage-summary'],
  ['daily-7', '/functions/tud-usage-daily?days=7'],
  ['daily-90', '/functions/tud-usage-daily?days=90'],
  ['hourly-1', '/functions/tud-usage-hourly?days=1'],
  ['breakdown-7', '/functions/tud-usage-model-breakdown?days=7'],
  ['sync-status', '/functions/tud-sync-status'],
  ['config', '/functions/tud-config'],
  ['pets-catalog', '/functions/tud-desktop-pets/catalog'],
  ['subscription-codex', '/functions/tud-subscription/codex'],
  ['subscription-claude', '/functions/tud-subscription/claude'],
];

/** 易变字段路径（抓取间必然不同，diff 时忽略） */
const VOLATILE = [
  ['data', 'fetchedAt'],
  ['data', 'checkedAt'],
  ['data', 'pub_date'],
  ['data', 'lastSyncAt'],
  ['data', 'lastUploadAt'],
];

function stripVolatile(envelope) {
  // body 存的是字符串：先解析再剥离易变字段（data.lastSyncAt 等嵌套路径）
  let parsed;
  try {
    parsed = JSON.parse(envelope.body);
  } catch {
    return envelope;
  }
  for (const path of VOLATILE) {
    let cur = parsed;
    for (let i = 0; i < path.length - 1; i++) {
      cur = cur?.[path[i]];
      if (!cur) break;
    }
    if (cur && typeof cur === 'object') delete cur[path.at(-1)];
  }
  return { status: envelope.status, body: parsed };
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'capture') {
  const [baseUrl, outDir] = args;
  if (!baseUrl || !outDir) { console.error('usage: capture <baseUrl> <outDir>'); process.exit(1); }
  mkdirSync(outDir, { recursive: true });
  for (const [name, route] of ROUTES) {
    try {
      const res = await fetch(baseUrl + route);
      const body = await res.text();
      writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ status: res.status, body }, null, 2));
      console.log(`  ✓ ${name} (${res.status})`);
    } catch (e) {
      writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ status: 0, body: String(e) }, null, 2));
      console.log(`  ✗ ${name} (${String(e).slice(0, 60)})`);
    }
  }
  console.log(`captured ${ROUTES.length} routes → ${outDir}`);
} else if (cmd === 'diff') {
  const [baseDir, candDir] = args;
  if (!baseDir || !candDir) { console.error('usage: diff <baseDir> <candDir>'); process.exit(1); }
  let same = 0; let diff = 0;
  for (const file of readdirSync(baseDir)) {
    if (!existsSync(`${candDir}/${file}`)) { console.log(`  ✗ ${file}: candidate 缺失`); diff++; continue; }
    const base = JSON.parse(readFileSync(`${baseDir}/${file}`, 'utf8'));
    const cand = JSON.parse(readFileSync(`${candDir}/${file}`, 'utf8'));
    if (JSON.stringify(stripVolatile(base)) === JSON.stringify(stripVolatile(cand))) {
      same++; console.log(`  ✓ ${file}`);
    } else {
      diff++; console.log(`  ✗ ${file}: 响应不一致（status ${base.status} vs ${cand.status}）`);
    }
  }
  console.log(`\n结果: ${same} 一致 / ${diff} 不一致`);
  process.exit(diff > 0 ? 1 : 0);
} else {
  console.error('usage: capture <baseUrl> <outDir> | diff <baseDir> <candDir>');
  process.exit(1);
}
