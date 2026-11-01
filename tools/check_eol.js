#!/usr/bin/env node
'use strict';

/**
 * tools/check_eol.js —— Markdown 行尾检查器（只读，v2）
 *
 * 规范目标：说明性 Markdown 一律 UTF-8 无 BOM、行尾全 LF、文件末尾恰好一个 LF。
 *
 * 默认范围（两级）：
 *   [强制] docs/**\/*.md     违规即退出码 1
 *   [报告] tools/**\/*.md    只扫描并报告，不影响退出码（是否纳入强制范围需单独批准）
 * 排除：tools/_backup/**、node_modules/**、.git/**、miniprogram_npm/**；不跟随符号链接。
 *
 * 违规码分三组：
 *   源规则：E_BOM / E_CRLF / E_STRAY_CR
 *   规范化：E_EMPTY / E_NO_FINAL_LF / E_MULTI_FINAL_LF
 *   扫描：  E_DEPTH / E_IO
 *
 * 本工具只做检测：
 *   —— 把 CRLF 改成 LF 只是修复动作，**不视为通过**；
 *   —— 不提供 --fix，也不接受任意路径参数（路径只能由内部 API 注入）；
 *   —— 扫描不完整时报 E_DEPTH 并以退出码 2 拒绝给出通过结论，不静默跳过。
 *
 * 用法：node tools/check_eol.js [--all] [--json] [--quiet]
 * 退出码：0 通过 / 1 强制范围有违规 / 2 用法错误、IO 错误或扫描不完整。
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const MAX_DEPTH = 8;
const DEPTH_COUNT_LIMIT = 5000;

const EXCLUDE_DIR_NAMES = ['node_modules', '.git', 'miniprogram_npm'];
const EXCLUDE_REL_PREFIXES = ['tools/_backup'];

const CODES = {
  BOM: 'E_BOM',
  CRLF: 'E_CRLF',
  STRAY_CR: 'E_STRAY_CR',
  EMPTY: 'E_EMPTY',
  NO_FINAL_LF: 'E_NO_FINAL_LF',
  MULTI_FINAL_LF: 'E_MULTI_FINAL_LF',
  DEPTH: 'E_DEPTH',
  IO: 'E_IO'
};

const SEVERITY = {
  E_BOM: 'source',
  E_CRLF: 'source',
  E_STRAY_CR: 'source',
  E_EMPTY: 'style',
  E_NO_FINAL_LF: 'style',
  E_MULTI_FINAL_LF: 'style',
  E_DEPTH: 'scan',
  E_IO: 'scan'
};

const SEVERITY_LABEL = { source: '源规则', style: '规范化', scan: '扫描' };

const DEFAULT_SCOPES = [
  { root: 'docs', label: 'docs/**/*.md', enforced: true },
  { root: 'tools', label: 'tools/**/*.md', enforced: false }
];

// ---------- 纯函数层 ----------

/**
 * 分析文件原始字节。
 * @param {Buffer} buf
 */
function analyzeBuffer(buf) {
  const empty = buf.length === 0;
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  let text = buf.toString('utf8');
  if (bom) text = text.replace(/^\uFEFF/, '');

  const crlf = (text.match(/\r\n/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  const lf = newlines - crlf;
  const strayCr = (text.match(/\r(?!\n)/g) || []).length;
  const m = text.match(/\n+$/);
  const trailing = m ? m[0].length : 0;
  const endsWithCrlf = /\r\n$/.test(text);

  return { bytes: buf.length, empty, bom, crlf, newlines, lf, strayCr, trailing, endsWithCrlf };
}

/**
 * 判定违规码。空文件只报 E_EMPTY；以 CRLF 结尾时只报 E_CRLF，不重复报 E_NO_FINAL_LF。
 * @param {ReturnType<typeof analyzeBuffer>} a
 */
function judge(a) {
  if (a.empty) return [CODES.EMPTY];
  const codes = [];
  if (a.bom) codes.push(CODES.BOM);
  if (a.crlf > 0) codes.push(CODES.CRLF);
  if (a.strayCr > 0) codes.push(CODES.STRAY_CR);
  if (!a.endsWithCrlf) {
    if (a.trailing === 0) codes.push(CODES.NO_FINAL_LF);
    else if (a.trailing > 1) codes.push(CODES.MULTI_FINAL_LF);
  }
  return codes;
}

function severityOf(code) {
  return SEVERITY[code] || 'scan';
}

function codeDetail(code, a) {
  if (!a) return code;
  if (code === CODES.CRLF) return code + '(' + a.crlf + ')';
  if (code === CODES.STRAY_CR) return code + '(' + a.strayCr + ')';
  if (code === CODES.MULTI_FINAL_LF) return code + '(' + a.trailing + ')';
  return code;
}

/** 把一条记录的违规码按严重程度分组 */
function splitSeverity(codes) {
  const out = { source: 0, style: 0, scan: 0 };
  for (const c of codes) out[severityOf(c)] += 1;
  return out;
}

// ---------- 发现层 ----------

/**
 * 目录是否排除。
 * 相对前缀按「范围根」计算（不是仓库根），这样自测注入临时目录时同样生效；
 * 另外允许 `_backup` 直接出现在 tools 范围下（等价于 tools/_backup/**）。
 */
function isExcludedDir(absDir, name, scopeRoot) {
  if (EXCLUDE_DIR_NAMES.indexOf(name) !== -1) return true;
  const rel = path.relative(scopeRoot, absDir).split(path.sep).join('/');
  if (EXCLUDE_REL_PREFIXES.some(function (p) { return rel === p || rel.indexOf(p + '/') === 0; })) return true;
  const scopeName = path.basename(scopeRoot);
  return name === '_backup' && (scopeName === 'tools' || rel === '_backup');
}

function isInside(absPath, repoRoot) {
  const rel = path.relative(repoRoot, absPath);
  return rel === '' || (rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel));
}

/**
 * 深度超限时，尽力统计被跳过的 .md 数量（有上限，明确标注是否截断）。
 */
function countMdBelow(dir, budget) {
  let count = 0;
  let truncated = false;
  const stack = [dir];
  while (stack.length) {
    if (count >= budget) { truncated = true; break; }
    const cur = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of ents) {
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
      else if (/\.md$/i.test(ent.name)) count += 1;
      if (count >= budget) { truncated = true; break; }
    }
  }
  return { count, truncated };
}

function walk(dir, depth, acc, ctx) {
  if (depth > MAX_DEPTH) {
    const skipped = countMdBelow(dir, DEPTH_COUNT_LIMIT);
    acc.issues.push({
      path: dir,
      codes: [CODES.DEPTH],
      analysis: null,
      message: '该目录下的 .md 未被检查，跳过数量=' + skipped.count +
        (skipped.truncated ? '+（计数已达上限 ' + DEPTH_COUNT_LIMIT + '，实际可能更多）' : '')
    });
    return;
  }
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    acc.issues.push({ path: dir, codes: [CODES.IO], analysis: null, message: err.message });
    return;
  }
  for (const ent of ents) {
    const abs = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (isExcludedDir(abs, ent.name, ctx.scopeRoot)) continue;
      walk(abs, depth + 1, acc, ctx);
    } else if (/\.md$/i.test(ent.name)) {
      acc.files.push(abs);
    }
  }
}

// ---------- 编排层 ----------

/**
 * 检查一组范围。
 * @param {Array<{root:string,label?:string,enforced?:boolean}>|null} scopes
 * @param {{allowOutsideRepo?:boolean, repoRoot?:string}} [options]
 */
function runCheck(scopes, options) {
  const opts = options || {};
  const repoRoot = opts.repoRoot ? path.resolve(opts.repoRoot) : REPO_ROOT;
  const list = (scopes && scopes.length ? scopes : DEFAULT_SCOPES).map(function (s) {
    return {
      root: path.isAbsolute(s.root) ? path.resolve(s.root) : path.resolve(repoRoot, s.root),
      label: s.label || s.root,
      enforced: s.enforced !== false
    };
  });

  if (!opts.allowOutsideRepo) {
    for (const s of list) {
      if (!isInside(s.root, repoRoot)) {
        return { fatal: 'outside-repo', target: s.root, scopes: [], totals: null, scanErrors: [] };
      }
    }
  }
  for (const s of list) {
    if (!fs.existsSync(s.root)) {
      return { fatal: 'missing-root', target: s.root, scopes: [], totals: null, scanErrors: [] };
    }
  }

  const ctx = { repoRoot: repoRoot };
  const out = [];
  const scanErrors = [];
  const totals = { checked: 0, violations: 0, source: 0, style: 0, scan: 0 };

  for (const s of list) {
    const acc = { files: [], issues: [] };
    walk(s.root, 0, acc, { repoRoot: repoRoot, scopeRoot: s.root });

    const rows = [];
    for (const abs of acc.files.slice().sort()) {
      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch (err) {
        rows.push({ path: abs, codes: [CODES.IO], analysis: null, message: err.message });
        continue;
      }
      const a = analyzeBuffer(buf);
      const codes = judge(a);
      if (codes.length) rows.push({ path: abs, codes: codes, analysis: a });
    }
    rows.push.apply(rows, acc.issues);

    for (const r of rows) {
      const sp = splitSeverity(r.codes);
      totals.source += sp.source;
      totals.style += sp.style;
      totals.scan += sp.scan;
      if (sp.scan > 0) scanErrors.push({ scope: s.label, path: r.path, message: r.message || '' });
    }

    const checked = acc.files.length + acc.issues.length;
    totals.checked += checked;
    totals.violations += rows.length;

    out.push({
      label: s.label,
      root: s.root,
      enforced: s.enforced,
      checked: checked,
      clean: checked - rows.length,
      violations: rows.length,
      bySeverity: {
        source: rows.reduce(function (n, r) { return n + splitSeverity(r.codes).source; }, 0),
        style: rows.reduce(function (n, r) { return n + splitSeverity(r.codes).style; }, 0),
        scan: rows.reduce(function (n, r) { return n + splitSeverity(r.codes).scan; }, 0)
      },
      rows: rows
    });
  }

  return { fatal: null, repoRoot: repoRoot, scopes: out, totals: totals, scanErrors: scanErrors };
}

/**
 * 由检查结果决定退出码。
 * 扫描不完整（E_DEPTH/E_IO）→ 2（拒绝给出通过结论）；强制范围有违规 → 1。
 */
function decideExit(result) {
  if (!result || result.fatal) return 2;
  if (result.scanErrors && result.scanErrors.length) return 2;
  for (const s of result.scopes) {
    if (s.enforced && s.violations > 0) return 1;
  }
  return 0;
}

function relTo(repoRoot, abs) {
  const r = path.relative(repoRoot, abs);
  return (r && r.split(path.sep)[0] !== '..' ? r : abs).split(path.sep).join('/');
}

function formatRow(repoRoot, row) {
  const codes = row.codes.map(function (c) {
    return row.analysis ? codeDetail(c, row.analysis) : c;
  });
  const groups = Array.from(new Set(row.codes.map(severityOf))).map(function (s) {
    return SEVERITY_LABEL[s];
  }).join('+');
  const extra = row.message ? '  ' + row.message : '';
  return '  ✗ ' + relTo(repoRoot, row.path) + '    ' + codes.join(', ') + '  [' + groups + ']' + extra;
}

function buildReport(result, options) {
  const opts = options || {};
  const all = !!opts.all;
  const lines = [];
  lines.push('检查范围：' + result.scopes.map(function (s) {
    return (s.enforced ? '[强制] ' : '[报告] ') + s.label;
  }).join('　'));
  lines.push('排除：tools/_backup/**、node_modules/**、.git/**、miniprogram_npm/**；不跟随符号链接；目录深度上限 ' + MAX_DEPTH + ' 层');
  lines.push('');

  for (const s of result.scopes) {
    const tag = s.enforced ? '[强制]' : '[报告]';
    const tail = s.enforced ? '' : '（报告模式，不影响退出码）';
    lines.push(tag + ' ' + s.label + '：文件 ' + s.checked + ' 个，合规 ' + s.clean +
      '，违规 ' + s.violations + '（源规则 ' + s.bySeverity.source +
      ' / 规范化 ' + s.bySeverity.style + ' / 扫描 ' + s.bySeverity.scan + '）' + tail);
    if (s.violations) {
      const limit = all ? s.violations : 20;
      for (let i = 0; i < Math.min(limit, s.violations); i++) {
        lines.push(formatRow(result.repoRoot, s.rows[i]));
      }
      if (!all && s.violations > limit) {
        lines.push('  …… 其余 ' + (s.violations - limit) + ' 条未显示（加 --all 查看全部）');
      }
    }
    lines.push('');
  }

  lines.push('合计：文件 ' + result.totals.checked + ' 个，违规记录 ' + result.totals.violations +
    '（源规则 ' + result.totals.source + ' / 规范化 ' + result.totals.style + ' / 扫描 ' + result.totals.scan + '）');
  if (result.scanErrors.length) {
    lines.push('⚠ 扫描不完整：' + result.scanErrors.length + ' 处（存在超深目录或不可读目录），本工具拒绝给出通过结论。');
  }
  lines.push('说明：本工具只做检测。把 CRLF 改成 LF 只是修复动作，不视为通过；不提供 --fix。');
  return lines;
}

function printReport(result, options) {
  buildReport(result, options).forEach(function (l) { console.log(l); });
}

function printFatal(result) {
  if (result.fatal === 'outside-repo') {
    console.error('用法错误：目标路径越出仓库，已拒绝检查：' + result.target);
    console.error('普通 CLI 不接受路径参数；该限制用于避免误扫任意目录。');
  } else if (result.fatal === 'missing-root') {
    console.error('用法错误：目标目录不存在：' + result.target);
  } else {
    console.error('用法错误：' + String(result.fatal));
  }
  console.error('退出码 2');
}

function parseArgs(argv) {
  const out = { all: false, json: false, quiet: false, help: false, bad: null };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else { out.bad = a; return out; }
  }
  return out;
}

function usage() {
  console.log('用法：node tools/check_eol.js [--all] [--json] [--quiet]');
  console.log('');
  console.log('检查 Markdown 行尾规范：UTF-8 无 BOM、全 LF、末尾恰好一个换行。');
  console.log('  [强制] docs/**/*.md    违规 → 退出码 1');
  console.log('  [报告] tools/**/*.md   只报告，不影响退出码');
  console.log('排除 tools/_backup/**、node_modules/**、.git/**、miniprogram_npm/**；深度上限 ' + MAX_DEPTH + ' 层。');
  console.log('不提供 --fix；不接受任意路径参数（路径只能由内部 API 注入）。');
  console.log('退出码：0 通过 / 1 强制范围有违规 / 2 用法或扫描错误。');
}

function toJson(result) {
  return {
    scopes: result.scopes.map(function (s) {
      return {
        label: s.label,
        enforced: s.enforced,
        checked: s.checked,
        clean: s.clean,
        violations: s.violations,
        bySeverity: s.bySeverity,
        rows: s.rows.map(function (r) {
          return {
            path: relTo(result.repoRoot, r.path),
            codes: r.codes,
            severity: r.codes.map(severityOf),
            message: r.message || null
          };
        })
      };
    }),
    totals: result.totals,
    scanErrors: result.scanErrors,
    exitCode: decideExit(result)
  };
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { usage(); return 0; }
  if (opts.bad) {
    console.error('未知参数：' + opts.bad);
    usage();
    console.error('退出码 2');
    return 2;
  }

  const result = runCheck(null);
  if (result.fatal) { printFatal(result); return 2; }

  if (opts.json) console.log(JSON.stringify(toJson(result), null, 2));
  else if (opts.quiet) {
    buildReport(result, { all: false }).forEach(function (l) {
      if (l.indexOf('  ✗') !== 0) console.log(l);
    });
  } else printReport(result, { all: opts.all });

  const code = decideExit(result);
  if (code === 1) console.log('存在违规，退出码 1。');
  else if (code === 2) console.log('扫描不完整，退出码 2。');
  return code;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  CODES: CODES,
  SEVERITY: SEVERITY,
  SEVERITY_LABEL: SEVERITY_LABEL,
  MAX_DEPTH: MAX_DEPTH,
  DEFAULT_SCOPES: DEFAULT_SCOPES,
  analyzeBuffer: analyzeBuffer,
  judge: judge,
  severityOf: severityOf,
  splitSeverity: splitSeverity,
  codeDetail: codeDetail,
  countMdBelow: countMdBelow,
  runCheck: runCheck,
  decideExit: decideExit,
  buildReport: buildReport,
  printReport: printReport,
  parseArgs: parseArgs,
  usage: usage,
  toJson: toJson,
  main: main
};
