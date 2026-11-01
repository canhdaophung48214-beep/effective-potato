#! /usr/bin/env node
'use strict';

/**
 * test_check_doc_refs.js — 文档引用检查器的样本测试（只读、离线）
 *
 * 目的：验证 tools/check_doc_refs.js 的分类能力与真实文档上的判定一致性，
 *      而不是替业务文档"修绿"。本套件不改任何项目文件。
 *
 * 运行：node tools/test_check_doc_refs.js
 * 退出码：0 = 全部通过；1 = 有失败
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECKER = path.join(ROOT, 'tools', 'check_doc_refs.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, extra) {
  pass++;
  console.log('  PASS  ' + name + (extra === undefined ? '' : '   ← ' + extra));
}
function bad(name, extra) {
  fail++;
  failures.push(name + (extra === undefined ? '' : '   ← ' + extra));
  console.log('  FAIL  ' + name + (extra === undefined ? '' : '   ← ' + extra));
}
function check(cond, name, extra) {
  if (cond) ok(name, extra); else bad(name, extra);
}
function eq(actual, expected, name) {
  check(actual === expected, name, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expected));
}

function runChecker(args, quiet) {
  try {
    const out = execFileSync(process.execPath, [CHECKER].concat(args || []), {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: String(e.stdout || '') };
  }
}

function runJson(args) {
  const r = runChecker(['--json'].concat(args || []), true);
  let parsed = null;
  try { parsed = JSON.parse(r.out); } catch (e) { parsed = null; }
  return { code: r.code, json: parsed, raw: r.out };
}

console.log('===== A. 自检模式 =====');
{
  const r = runChecker(['--self-test']);
  eq(r.code, 0, 'A1 --self-test 退出码为 0（夹具内锚点/行号/历史/误报各就位）');
  check(/SELF-TEST PASS/.test(r.out), 'A2 自检输出含 SELF-TEST PASS', r.out.split('\n')[0]);
}

console.log('\n===== B. 分类器小样本（临时夹具，确定性） =====');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docref-test-'));
  const doc = path.join(dir, 'DOC.md');
  const ref = path.join(dir, 'REF.md');
  fs.writeFileSync(doc, ['# DOC', '### 1.1 甲', '甲内容', '### 2.1 乙', '乙内容', '', '### 3.1 丙', '丙内容', ''].join('\n'));
  fs.writeFileSync(ref, [
    '# REF',
    '- 有效：DOC.md:3',
    '- 有效锚点：DOC.md §2.1',
    '- 越界：DOC.md:999',
    '- 空白：DOC.md:6',
    '- 历史：2026-10-23 版 DOC.md:42（已失效）',
    '- 时间：12:30 开会',
    '- 代码：data/dishes.js:10',
    '- 非集会文件：OTHER.md:5',
    ''
  ].join('\n'));
  const { json, code } = runJson(['--docs', doc + ',' + ref, '--root', dir]);
  check(!!json, 'B1 输出为可解析 JSON');
  if (json) {
    const by = (cls) => (json.refs || []).filter((x) => x.cls === cls);
    eq(by('LINE_OK').length, 0, 'B2a 无结构声称的普通行号不再直接判 LINE_OK（避免「行存在＝引用正确」）');
    eq(by('LINE_OK_UNVERIFIED').length, 1, 'B2b 无结构声称的有效行号计为 LINE_OK_UNVERIFIED');
    eq(by('HISTORICAL').length, 1, 'B3 标注历史的引用计为 HISTORICAL');
    eq(by('IGNORED').length, 2, 'B4 时间与非 Markdown 行号计为 IGNORED');
    eq(by('UNRESOLVED').length, 3, 'B5 越界行、空行、检查集外文件计为 UNRESOLVED');
    const anchors = (json.anchors || []);
    eq(anchors.filter((a) => a.cls === 'ANCHOR_OK').length, 1, 'B6 有效章节锚点计为 ANCHOR_OK');
    eq(code, 0, 'B7 无显式缺失锚点时退出码 0（UNRESOLVED 不致死）');
    const hist = by('HISTORICAL')[0];
    check(!!hist && hist.target === 'DOC.md', 'B8 历史引用仍解析到目标文件而不是丢进 IGNORED', hist && hist.target);
  }
}

console.log('\n===== B1b. 行号范围边界（:N-M） =====');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docref-range-'));
  const doc = path.join(dir, 'D.md');
  const ref = path.join(dir, 'R2.md');
  fs.writeFileSync(doc, ['# D', '甲', '乙', '丙', '丁', '戊', '己', '庚', ''].join('\n'));
  fs.writeFileSync(ref, [
    '# R2',
    '- 正常范围：D.md:2-4',
    '- 上界越界：D.md:3-99',
    '- 倒序范围：D.md:5-2',
    ''
  ].join('\n'));
  const { json } = runJson(['--docs', doc + ',' + ref, '--root', dir]);
  check(!!json, 'B9 范围夹具输出为可解析 JSON');
  if (json) {
    const refs = (json.refs || []).filter((x) => typeof x.raw === 'string' && x.raw.charAt(0) === ':');
    const unres = refs.filter((x) => x.cls === 'UNRESOLVED');
    const okU = refs.filter((x) => x.cls === 'LINE_OK_UNVERIFIED');
    eq(refs.length, 3, 'B10 三条范围引用都被解析');
    eq(unres.length, 2, 'B11 上界越界与倒序范围判为 UNRESOLVED（不能只校验起始行）');
    eq(okU.length, 1, 'B12 正常范围（起止都在界内）仍判 LINE_OK_UNVERIFIED');
  }
}

console.log('\n===== B2. 语义核验层（结构声称 vs 目标结构） =====');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docref-sem-'));
  const doc = path.join(dir, 'T.md');
  const ref = path.join(dir, 'R.md');
  fs.writeFileSync(doc, ['# T', '### 4.1 标题', '正文', '| 名 | 价 |', '|---|---|', '| 甲 | 1 |', ''].join('\n'));
  fs.writeFileSync(ref, [
    '# R',
    '- 表头误指标题：T.md:2',
    '- 表头命中：T.md:4',
    '- 小节命中：T.md:2',
    '- 表格行命中：T.md:6',
    ''
  ].join('\n'));
  const { json } = runJson(['--docs', doc + ',' + ref, '--root', dir]);
  if (!json) { bad('S1 语义夹具可解析 JSON'); } else {
    const by = (cls) => (json.refs || []).filter((x) => x.cls === cls);
    eq(by('LINE_SEMANTIC_REVIEW').length, 1, 'S1 声称「表头」但目标为标题行 → LINE_SEMANTIC_REVIEW');
    const sem = by('LINE_SEMANTIC_REVIEW')[0] || {};
    check(sem.claim === 'TABLE_HEADER' && sem.targetKind === 'heading',
      'S2 复核项携带 claim=TABLE_HEADER、targetKind=heading', JSON.stringify([sem.claim, sem.targetKind]));
    eq(by('LINE_OK').length, 3, 'S3 表头命中、小节命中、表格行命中各判 LINE_OK（共 3 条）');
    eq(by('LINE_OK_UNVERIFIED').length, 0, 'S4 结构声称可核验时不产生 UNVERIFIED');
    const claimed = by('LINE_OK').map((x) => x.claim).sort().join(',');
    eq(claimed, 'HEADING,TABLE,TABLE_HEADER', 'S5 LINE_OK 的 claim 覆盖 TABLE_HEADER / TABLE / HEADING');
  }
}

console.log('\n===== C. 真实文档：判定与文件内容自洽 =====');
{
  const r = runJson();
  check(!!r.json, 'C1 真实文档可解析为 JSON');
  if (r.json) {
    const docs = r.json.docs || [];
    check(docs.length >= 5, 'C2 至少扫描到 5 份文档', String(docs.length));
    const lines = {};
    docs.forEach((d) => { lines[path.basename(d.file)] = fs.readFileSync(d.file, 'utf8').replace(/^\uFEFF/, '').split('\n'); });

    const missing = (r.json.anchors || []).filter((a) => a.cls === 'ANCHOR_MISSING');
    const headingRe = /^#{2,5}\s+(\d+(?:\.\d+)*)\b/;
    let inconsistent = 0;
    const samples = [];
    missing.forEach((a) => {
      const fileKey = (a.file || '').split(/[\\/]/).pop();
      const targetBase = a.target;
      const targetFile = docs.find((d) => path.basename(d.file) === targetBase);
      if (!targetFile) { inconsistent++; samples.push(fileKey + ':' + a.line + ' target-not-scanned'); return; }
      const has = (lines[targetBase] || []).some((ln) => {
        const m = headingRe.exec(ln);
        return m && (m[1] === a.num || m[1].startsWith(a.num + '.'));
      });
      if (has) { inconsistent++; samples.push(fileKey + ':' + a.line + ' §' + a.num + ' 目标实际存在'); }
    });
    eq(inconsistent, 0, 'C3 所有 ANCHOR_MISSING 的目标文档确实缺该标题（无假阳性）', samples.slice(0, 3).join(' | '));

    eq(missing.length, 0, 'C4 4 处 §5.6.5.10.1 引用裁决后，真实文档不再有 ANCHOR_MISSING');

    const mism = (r.json.anchors || []).filter((a) => a.cls === 'TARGET_MISMATCH');
    eq(mism.length, 0, 'C11 真实文档中 TARGET_MISMATCH 为 0（行号引用里的文件名不得被误当章节归属）');

    const ambAll = (r.json.anchors || []).filter((a) => a.cls === 'ANCHOR_AMBIGUOUS');
    const ambBad = ambAll.filter((a) => a.evidence !== 'WHITELIST_MULTI');
    eq(ambBad.length, 0, 'C12 剩余歧义全部是「白名单内多候选」（WHITELIST_MULTI），不含启发式猜测');

    const contractBase = 'RECORD_GENERATOR_CONTRACT_20261023.md';
    const contractLines = lines[contractBase] || [];
    const has56010 = contractLines.some((ln) => /^#{2,5}\s+5\.6\.5\.10\b/.test(ln));
    const has560101 = contractLines.some((ln) => /^#{2,5}\s+5\.6\.5\.10\.1\b/.test(ln));
    check(has56010 && !has560101, 'C5 §5.6.5.10 存在而 §5.6.5.10.1 不存在 → 该缺失锚点判定与文件一致');

    const counts = r.json.summary.counts;
    check(((counts.LINE_OK || 0) + (counts.LINE_OK_UNVERIFIED || 0)) >= 40,
      'C6 行号引用（LINE_OK + LINE_OK_UNVERIFIED）至少 40 条（检查器确实在解析）',
      String((counts.LINE_OK || 0) + (counts.LINE_OK_UNVERIFIED || 0)));
    check((counts.LINE_TARGET_UNCERTAIN || 0) > 200,
      'C6b 裸行号不再默认归属当前文件：LINE_TARGET_UNCERTAIN 超过 200 条（错归属被降级为待核实）',
      String(counts.LINE_TARGET_UNCERTAIN || 0));
    check((counts.IGNORED || 0) > 0 && (counts.UNRESOLVED || 0) > 0 && (counts.HISTORICAL || 0) > 0,
      'C7 IGNORED / UNRESOLVED / HISTORICAL 三类均有命中（说明分类在真实文档上生效）',
      JSON.stringify(counts));
    check((counts.LINE_OK_UNVERIFIED || 0) > 0, 'C7b 真实文档存在「行存在但语义未核验」的引用（LINE_OK_UNVERIFIED）', String(counts.LINE_OK_UNVERIFIED));
    eq(r.code, 0, 'C8 无缺失锚点后退出码为 0（语义复核与失效行号不致死）');

    const stale = (r.json.anchors || []).filter((a) => a.num === '5.6.5.10.1');
    eq(stale.length, 0, 'C9 已无任何引用指向 §5.6.5.10.1（4 处已改为 §5.6.5.5.4.3）');
    const keyDiag = (r.json.anchors || []).filter((a) => a.num === '5.6.5.5.4.3' && a.cls === 'ANCHOR_OK');
    check(keyDiag.length >= 4, 'C10 §5.6.5.5.4.3（键一致性诊断）存在，且至少 4 处引用指向它', String(keyDiag.length));
  }
}

console.log('\n===== E. 归属白名单、限定词与裸行号（临时夹具） =====');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docref-wl-'));
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'doc_ref_whitelist.json'), JSON.stringify({
    schema: 1,
    sources: {
      'REF_WL_OK.md': { allowed: ['DOC.md'], basis: '测试夹具' },
      'REF_WL_DENY.md': { allowed: ['CONTRACT.md'], basis: '测试夹具' }
    }
  }));
  fs.writeFileSync(path.join(dir, 'CONTRACT.md'), ['# CONTRACT', '## 2.1 契约节', '契约内容', '## 3.3 契约专有', '内容', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'DOC.md'), ['# DOC', '## 2.1 文档节', '文档内容', '## 4.4 双方共有', '共有内容', '## 9.9 文档专有', '内容', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'OTHER.md'), ['# OTHER', '## 4.4 其他共有', '其他内容', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'REF_WL_OK.md'), ['# REF_WL_OK', '- §2.1 在白名单内', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'REF_WL_DENY.md'), ['# REF_WL_DENY', '- §4.4 不在白名单内', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'REF_MISC.md'), [
    '# REF_MISC',
    '## 2.1 自有节',
    '- 明确点名：CONTRACT.md §3.3',
    '- 点名了但目标没有：CONTRACT.md §9.9',
    '- 自引用：§2.1 本节',
    '- 行号引用里的文件名不构成归属：DOC.md:3 与 §4.4 无关',
    '- 显式文件行号：DOC.md:3',
    '- 裸行号无目标：:42',
    '- 范围：DOC.md:3-5',
    ''
  ].join('\n'));
  const files = ['CONTRACT.md', 'DOC.md', 'OTHER.md', 'REF_WL_OK.md', 'REF_WL_DENY.md', 'REF_MISC.md'].map((n) => path.join(dir, n));
  const { json } = runJson(['--docs', files.join(','), '--root', dir]);
  check(!!json, 'E1 夹具输出为可解析 JSON');
  if (json) {
    const anchorsOf = (base) => (json.anchors || []).filter((a) => a.file.endsWith(base));
    const okWl = anchorsOf('REF_WL_OK.md');
    eq(okWl.length, 1, 'E2 白名单允许：§2.1 解析为 1 条锚点');
    eq(okWl[0] && okWl[0].cls, 'ANCHOR_OK', 'E3 白名单允许：判为 ANCHOR_OK');
    eq(okWl[0] && okWl[0].target, 'DOC.md', 'E4 白名单允许：目标取白名单内唯一候选 DOC.md');
    eq(okWl[0] && okWl[0].evidence, 'WHITELIST', 'E5 白名单允许：依据标记 WHITELIST');
    const deny = anchorsOf('REF_WL_DENY.md');
    eq(deny[0] && deny[0].cls, 'ANCHOR_AMBIGUOUS', 'E6 白名单不含候选目标：保持 ANCHOR_AMBIGUOUS，不猜');
    const misc = anchorsOf('REF_MISC.md');
    const byNum = (n) => misc.find((a) => a.num === n) || {};
    eq(byNum('3.3').cls, 'ANCHOR_OK', 'E7 行文写出 CONTRACT.md：解析到该文件');
    eq(byNum('3.3').evidence, 'EXPLICIT', 'E8 显式文件名的依据标记 EXPLICIT');
    eq(byNum('9.9').cls, 'TARGET_MISMATCH', 'E9 点名 CONTRACT.md 但该节只在别处：判 TARGET_MISMATCH，不静默换目标');
    eq(byNum('2.1').cls, 'ANCHOR_OK', 'E13 自引用：本文档自己有该节时判 ANCHOR_OK');
    eq(byNum('2.1').evidence, 'SELF', 'E14 自引用的依据标记 SELF');
    const lineRefCase = misc.filter((a) => a.raw === '§4.4');
    eq(lineRefCase.length, 1, 'E15 行号引用里的文件名不参与章节归属（1 条 §4.4）');
    eq(lineRefCase[0] && lineRefCase[0].cls, 'ANCHOR_AMBIGUOUS', 'E16 「DOC.md:3 与 §4.4 无关」保持歧义，不误判 TARGET_MISMATCH');
    const refs = (json.refs || []).filter((x) => x.file.endsWith('REF_MISC.md'));
    const un = refs.filter((x) => x.cls === 'LINE_TARGET_UNCERTAIN');
    eq(un.length, 1, 'E10 裸行号（无文件线索）：1 条 LINE_TARGET_UNCERTAIN');
    const explicitLine = refs.filter((x) => x.cls === 'LINE_OK_UNVERIFIED' && x.n === 3 && x.n2 === null);
    eq(explicitLine.length, 2, 'E11 显式文件行号仍可解析（DOC.md:3 出现两处，均为单行号）');
    const range = refs.filter((x) => x.n === 3 && x.n2 === 5);
    check(range.length === 1, 'E12 行号范围 :3-5 被识别（n=3,n2=5）', JSON.stringify(range[0] || {}));
  }
}

console.log('\n===== D. 只读性 =====');
{
  const before = {};
  ['docs/RECORD_GENERATOR_CONTRACT_20261023.md', 'docs/RECORD_GENERATOR_PLAN_20261023.md',
    'docs/RAW_DATA_BLOCKERS_20261023.md', 'docs/decisions/ADAPTER_MAP_C_TO_L8_20261025.md',
    'tools/test_records_spec.js'].forEach((rel) => {
    const p = path.join(ROOT, rel);
    before[rel] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  });
  runChecker([]);
  const after = {};
  Object.keys(before).forEach((rel) => {
    const p = path.join(ROOT, rel);
    after[rel] = require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  });
  eq(JSON.stringify(after), JSON.stringify(before), 'D1 运行检查器前后 5 个被检查文件哈希不变（只读）');
}

console.log('\n===== 结果 =====');
console.log('通过 ' + pass + '，失败 ' + fail);
if (fail) { failures.forEach((f) => console.log('  - ' + f)); }
console.log('RESULT: ' + (fail ? 'FAIL' : 'OK'));
process.exitCode = fail ? 1 : 0;
