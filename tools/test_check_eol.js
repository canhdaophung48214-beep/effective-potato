#!/usr/bin/env node
'use strict';

/**
 * tools/test_check_eol.js —— `tools/check_eol.js` 的独立自测（可重复、可清理）
 *
 * 覆盖三层：
 *   1) 纯函数：analyzeBuffer / judge / severityOf / splitSeverity / decideExit
 *   2) 临时目录：真实文件与目录树（含排除目录、中文名、深度超限、报告模式）
 *   3) 真实仓库：只读运行 CLI，要求强制范围 0 违规
 * 另做一次变异：把副本里的 CRLF 计数打断，确认测试能击穿它。
 *
 * 退出码：0 全部通过 / 1 有失败。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'check_eol.js');
const EOL = require('./check_eol.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, detail) {
  pass += 1;
  console.log('  PASS  ' + name + (detail ? '  ' + detail : ''));
}

function no(name, detail) {
  fail += 1;
  failures.push(name + (detail ? '  ' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '  ' + detail : ''));
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) ok(name);
  else no(name, '期望 ' + e + '，实际 ' + a);
}

function check(name, cond, detail) {
  if (cond) ok(name, detail);
  else no(name, detail || '');
}

function section(title) {
  console.log('');
  console.log('== ' + title + ' ==');
}

// ---------- 1) 纯函数 ----------

function testPure() {
  section('1) 纯函数');

  const clean = EOL.analyzeBuffer(Buffer.from('标题\n\n正文\n', 'utf8'));
  eq('clean 文件无违规码', EOL.judge(clean), []);
  eq('clean 计数 CRLF/LF/trailing', [clean.crlf, clean.lf, clean.trailing], [0, 3, 1]);

  const crlf = EOL.analyzeBuffer(Buffer.from('a\r\nb\r\n', 'utf8'));
  eq('CRLF 文件只报 E_CRLF（不重复报 NO_FINAL_LF）', EOL.judge(crlf), ['E_CRLF']);
  eq('CRLF 计数', [crlf.crlf, crlf.lf, crlf.endsWithCrlf], [2, 0, true]);

  const mixed = EOL.analyzeBuffer(Buffer.from('a\r\nb\nc\n', 'utf8'));
  eq('混合行尾报 E_CRLF', EOL.judge(mixed), ['E_CRLF']);
  eq('混合行尾 CRLF=1、独立 LF=2', [mixed.crlf, mixed.lf], [1, 2]);

  const stray = EOL.analyzeBuffer(Buffer.from('a\rb\n', 'utf8'));
  eq('裸 CR 报 E_STRAY_CR', EOL.judge(stray), ['E_STRAY_CR']);

  const noFinal = EOL.analyzeBuffer(Buffer.from('a', 'utf8'));
  eq('缺末尾换行报 E_NO_FINAL_LF', EOL.judge(noFinal), ['E_NO_FINAL_LF']);

  const multi = EOL.analyzeBuffer(Buffer.from('a\n\n\n', 'utf8'));
  eq('多个末尾换行报 E_MULTI_FINAL_LF', EOL.judge(multi), ['E_MULTI_FINAL_LF']);
  eq('末尾换行计数', multi.trailing, 3);

  const empty = EOL.analyzeBuffer(Buffer.alloc(0));
  eq('空文件只报 E_EMPTY', EOL.judge(empty), ['E_EMPTY']);

  const bom = EOL.analyzeBuffer(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('a\n', 'utf8')]));
  eq('BOM 文件报 E_BOM', EOL.judge(bom), ['E_BOM']);

  const combo = EOL.analyzeBuffer(Buffer.from('a\r\nb', 'utf8'));
  eq('同时有 CRLF 与缺末尾换行时报两条', EOL.judge(combo), ['E_CRLF', 'E_NO_FINAL_LF']);

  eq('严重性分组：源规则', EOL.severityOf('E_CRLF'), 'source');
  eq('严重性分组：规范化', EOL.severityOf('E_NO_FINAL_LF'), 'style');
  eq('严重性分组：扫描', EOL.severityOf('E_DEPTH'), 'scan');
  eq('splitSeverity 计数', EOL.splitSeverity(['E_CRLF', 'E_BOM', 'E_MULTI_FINAL_LF', 'E_DEPTH']),
    { source: 2, style: 1, scan: 1 });

  eq('CRLF 细节带数量', EOL.codeDetail('E_CRLF', crlf), 'E_CRLF(2)');
}

// ---------- 2) 临时目录 ----------

function writeFile(dir, rel, content) {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function testFixtures() {
  section('2) 临时目录');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eol-test-'));
  try {
    writeFile(tmp, 'ok.md', '标题\n\n正文\n');
    writeFile(tmp, 'crlf.md', '标题\r\n正文\r\n');
    writeFile(tmp, 'stray.md', '标题\r正文\n');
    writeFile(tmp, 'nofinal.md', '标题');
    writeFile(tmp, 'multi.md', '标题\n\n');
    writeFile(tmp, 'empty.md', '');
    writeFile(tmp, 'bom.md', Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('标题\n', 'utf8')]));
    writeFile(tmp, '中文名称.md', '标题\n');
    writeFile(tmp, 'Sub/Nested.MD', '标题\r\n');
    writeFile(tmp, 'upper/readme.MD', '标题\n');
    writeFile(tmp, 'tools/_backup/skip.md', '标题\r\n');
    writeFile(tmp, 'node_modules/skip.md', '标题\r\n');
    writeFile(tmp, '.git/skip.md', '标题\r\n');
    writeFile(tmp, 'notes.txt', '标题\r\n');

    const res = EOL.runCheck([{ root: tmp, label: 'tmp', enforced: true }], { allowOutsideRepo: true });

    check('临时目录检查完成', !res.fatal, res.fatal ? String(res.fatal) : '');
    eq('未把 txt 当 md', res.scopes[0].checked, 10);
    eq('排除目录内的 md 未被计入', res.scopes[0].rows.filter(r => r.path.indexOf('_backup') >= 0 ||
      r.path.indexOf('node_modules') >= 0 || r.path.indexOf('.git') >= 0).length, 0);
    eq('违规文件数', res.scopes[0].violations, 7);
    eq('严重性分组统计', res.scopes[0].bySeverity, { source: 4, style: 3, scan: 0 });
    eq('强制范围有违规时退出码为 1', EOL.decideExit(res), 1);
    eq('扫描错误为空', res.scanErrors.length, 0);

    const reportOnly = EOL.runCheck([{ root: tmp, label: 'tmp-report', enforced: false }], { allowOutsideRepo: true });
    eq('报告模式违规数相同', reportOnly.scopes[0].violations, 7);
    eq('报告模式不影响退出码', EOL.decideExit(reportOnly), 0);

    const cleanDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eol-clean-'));
    try {
      writeFile(cleanDir, 'a.md', '标题\n');
      writeFile(cleanDir, 'b/c.md', '正文\n');
      const cleanRes = EOL.runCheck([{ root: cleanDir, label: 'clean', enforced: true }], { allowOutsideRepo: true });
      eq('合规目录 0 违规、退出码 0', [cleanRes.scopes[0].violations, EOL.decideExit(cleanRes)], [0, 0]);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }

    // 深度超限：11 层目录里的 md 必须被显式报告，不得静默跳过
    const deep = path.join(tmp, 'deep');
    let cur = deep;
    for (let i = 1; i <= 11; i++) cur = path.join(cur, 'd' + i);
    writeFile(cur, 'buried.md', '标题\n');

    const deepRes = EOL.runCheck([{ root: deep, label: 'deep', enforced: true }], { allowOutsideRepo: true });
    const depthRows = deepRes.scopes[0].rows.filter(r => r.codes.indexOf('E_DEPTH') >= 0);
    eq('深度超限报 E_DEPTH 一条', depthRows.length, 1);
    check('E_DEPTH 说明里包含被跳过的 md 数量',
      !!depthRows[0] && /跳过数量=1/.test(String(depthRows[0].message)), depthRows[0] && depthRows[0].message);
    eq('扫描错误被记录', deepRes.scanErrors.length, 1);
    eq('扫描不完整时拒绝给出通过结论（退出码 2）', EOL.decideExit(deepRes), 2);

    // 仓库外路径：默认拒绝
    const outside = EOL.runCheck([{ root: os.tmpdir(), label: 'outside', enforced: true }]);
    eq('仓库外路径默认被拒绝', [outside.fatal, EOL.decideExit(outside)], ['outside-repo', 2]);

    // 目录不存在
    const missing = EOL.runCheck([{ root: path.join(tmp, 'not-exist'), label: 'missing', enforced: true }], { allowOutsideRepo: true });
    eq('目录不存在标记为 missing-root', missing.fatal, 'missing-root');

    // 不跟随符号链接（Windows 可能无权限，失败即跳过并如实记录）
    try {
      const linkTarget = path.join(tmp, 'linktarget');
      fs.mkdirSync(linkTarget, { recursive: true });
      fs.writeFileSync(path.join(linkTarget, 'x.md'), '标题\r\n');
      fs.symlinkSync(linkTarget, path.join(tmp, 'linkdir'), 'junction');
      const linkRes = EOL.runCheck([{ root: tmp, label: 'tmp-link', enforced: true }], { allowOutsideRepo: true });
      eq('符号链接目录本身未被跟随（路径中不出现 linkdir）',
        linkRes.scopes[0].rows.filter(r => String(r.path).indexOf('linkdir') >= 0).length, 0);
      eq('链接目标目录内的 md 只按真实路径计一次',
        linkRes.scopes[0].rows.filter(r => String(r.path).indexOf('linktarget') >= 0).length, 1);
    } catch (e) {
      ok('符号链接用例跳过（当前环境无权限）', String(e && e.code || ''));
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------- 3) 真实仓库 ----------

function testRealRepo() {
  section('3) 真实仓库只读');

  const res = EOL.runCheck(null);
  check('真实仓库检查完成', !res.fatal, res.fatal ? String(res.fatal) : '');
  eq('默认两个范围', res.scopes.length, 2);
  eq('docs 为强制范围', res.scopes[0].enforced, true);
  eq('tools 为报告范围', res.scopes[1].enforced, false);
  check('docs 范围存在文件', res.scopes[0].checked > 0, 'checked=' + res.scopes[0].checked);
  check('tools 范围存在文件', res.scopes[1].checked > 0, 'checked=' + res.scopes[1].checked);
  eq('强制范围 0 违规', res.scopes[0].violations, 0);
  eq('真实仓库退出码 0', EOL.decideExit(res), 0);

  const docs = res.scopes[0];
  console.log('  记录：docs 文件 ' + docs.checked + ' 个（源规则 ' + docs.bySeverity.source +
    ' / 规范化 ' + docs.bySeverity.style + '）；tools 文件 ' + res.scopes[1].checked +
    ' 个，违规 ' + res.scopes[1].violations + '（源规则 ' + res.scopes[1].bySeverity.source +
    ' / 规范化 ' + res.scopes[1].bySeverity.style + '）');

  const run = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  eq('CLI 默认运行退出码 0', run.status, 0);
  check('CLI 默认输出含「[强制]」与「[报告]」', /\[强制\]/.test(run.stdout) && /\[报告\]/.test(run.stdout));

  const json = spawnSync(process.execPath, [CLI, '--json'], { encoding: 'utf8' });
  eq('CLI --json 退出码 0', json.status, 0);
  let parsed = null;
  try { parsed = JSON.parse(json.stdout); } catch (e) { parsed = null; }
  check('CLI --json 输出可解析', !!parsed);
  check('CLI --json 含 scopes 与 totals', !!parsed && parsed.scopes.length === 2 && !!parsed.totals);
  eq('CLI --json 的 exitCode 与进程退出码一致', parsed && parsed.exitCode, json.status);

  const bad = spawnSync(process.execPath, [CLI, '--root', 'C:\\'], { encoding: 'utf8' });
  eq('CLI 拒绝未知参数（退出码 2）', bad.status, 2);

  const help = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  eq('CLI --help 退出码 0', help.status, 0);
  check('CLI --help 声明不提供 --fix', /不提供 --fix/.test(help.stdout));
}

// ---------- 4) 变异 ----------

function testMutation() {
  section('4) 变异测试（副本，不碰仓库文件）');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eol-mut-'));
  try {
    const src = fs.readFileSync(CLI, 'utf8');
    const mutated = src.replace('(text.match(/\\r\\n/g) || []).length', '0');
    check('变异成功注入（CRLF 计数被清零）', mutated !== src);

    const target = path.join(dir, 'check_eol.mut.js');
    fs.writeFileSync(target, mutated);
    delete require.cache[require.resolve(target)];
    const mod = require(target);
    const a = mod.analyzeBuffer(Buffer.from('a\r\nb\r\n', 'utf8'));
    eq('变异后 CRLF 计数变为 0', a.crlf, 0);
    eq('变异后漏报 E_CRLF', mod.judge(a), []);
    check('原始实现对同一输入仍报 E_CRLF', JSON.stringify(EOL.judge(EOL.analyzeBuffer(Buffer.from('a\r\nb\r\n', 'utf8')))) === '["E_CRLF"]');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  console.log('check_eol 自测开始');
  testPure();
  testFixtures();
  testRealRepo();
  testMutation();

  console.log('');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) {
    console.log('失败项：');
    failures.forEach(function (f) { console.log('  - ' + f); });
    console.log('RESULT: FAILED');
    return 1;
  }
  console.log('RESULT: OK');
  return 0;
}

process.exitCode = main();
