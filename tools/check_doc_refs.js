#! /usr/bin/env node
'use strict';

/**
 * check_doc_refs.js — Markdown 交叉引用锚点静态检查器（只读，不修复、不写入）
 *
 * 章节锚点：ANCHOR_OK / ANCHOR_MISSING（显式指向且目标确有编号标题却缺该节）/
 *           ANCHOR_AMBIGUOUS（无法唯一确定目标文档，不判失败）
 * 行号引用：LINE_OK              目标行结构可验证且与上下文声称一致（表头/表格行/标题/字段）
 *           LINE_OK_UNVERIFIED   目标行存在，语义未核验（**不等于引用正确**）
 *           LINE_SEMANTIC_REVIEW 目标行存在，但结构与其上下文声称相矛盾，需人工复核
 *           UNRESOLVED           空行/表格分隔行/越界/检查集外文件
 *           HISTORICAL           上下文明确标注历史/旧版（保留原值）
 *           IGNORED              时间 HH:MM、非 Markdown 文件行号
 *
 * 语义层的能力边界：本工具只做**结构**核验（行是不是标题 / 表头 / 表格行 / 含某字段名），
 * 不能证明自然语言语义正确；无法判定时一律返回 LINE_OK_UNVERIFIED，绝不自动改写引用。
 *
 * 用法：
 *   node tools/check_doc_refs.js [--json] [--self-test] [--docs a.md,b.md] [--root dir]
 *
 * 退出码：0=无缺失锚点；1=存在 ANCHOR_MISSING；2=用法/读取错误
 * 注意：失效行号（UNRESOLVED）与语义复核（LINE_SEMANTIC_REVIEW）只计数并列出，不影响退出码。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DOCS = [
  'docs/RECORD_GENERATOR_CONTRACT_20261023.md',
  'docs/RECORD_GENERATOR_PLAN_20261023.md',
  'docs/RAW_DATA_BLOCKERS_20261023.md',
  'docs/decisions/ADAPTER_MAP_C_TO_L8_20261025.md',
  'tools/test_records_spec.js'
];

const HISTORY_MARKERS = ['历史', '旧版', '旧值', '已失效', '曾自述', '历史快照', /2026-10-\d{2}\s*版/];

const CLAIM_TABLE_HEADER = /表头|列名|表列名/;
const CLAIM_TABLE = /表格|表内|该表|本表/;
const CLAIM_HEADING = /小节|章节|标题/;
const CLAIM_FIELD = /字段|键名|字段名/;

class RefError extends Error {}

function readLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new RefError('无法读取 ' + file + '：' + e.message);
  }
  return text.replace(/^\uFEFF/, '').split('\n');
}

function collectAnchors(lines) {
  const set = new Set();
  lines.forEach((line) => {
    const m = /^#{2,5}\s+(\d+(?:\.\d+)*)\b/.exec(line);
    if (m) set.add(m[1]);
  });
  return set;
}

function isHistorical(text) {
  return HISTORY_MARKERS.some((k) => (k instanceof RegExp ? k.test(text) : text.includes(k)));
}

/** 上下文声明的目标类型（只认明确的词，避免误报） */
function claimOf(before) {
  if (CLAIM_TABLE_HEADER.test(before)) return 'TABLE_HEADER';
  if (CLAIM_TABLE.test(before)) return 'TABLE';
  if (CLAIM_HEADING.test(before)) return 'HEADING';
  if (CLAIM_FIELD.test(before)) return 'FIELD';
  return null;
}

/** 目标行的结构类型 */
function classifyTarget(lines, n) {
  const t = (lines[n - 1] || '').trim();
  const isSep = /^\|?[\s:|-]+\|?$/.test(t) && t.indexOf('-') >= 0;
  const cells = t.startsWith('|') ? t.split('|').length - 2 : 0;
  const isRow = t.startsWith('|') && cells >= 2 && !isSep;
  const isHeading = /^#{2,6}\s+\S/.test(t);
  let kind = 'text';
  if (isHeading) {
    kind = 'heading';
  } else if (isSep) {
    kind = 'separator';
  } else if (isRow) {
    const next = (lines[n] || '').trim();
    const nextSep = /^\|?[\s:|-]+\|?$/.test(next) && next.indexOf('-') >= 0;
    kind = nextSep ? 'table_header' : 'table_row';
  }
  return { kind, text: t };
}

const KIND_NAME = { heading: '标题行', table_header: '表头行', table_row: '表格数据行', separator: '表格分隔行', text: '普通文本行' };

/** 结构核验：返回 [cls, reason] */
function judgeStructure(claim, kind, text, before) {
  if (claim === 'TABLE_HEADER') {
    if (kind === 'table_header') return ['LINE_OK', '结构核验通过：目标为表头行'];
    if (kind === 'table_row') return ['LINE_OK_UNVERIFIED', '目标为表格数据行而非表头行，需人工确认'];
    return ['LINE_SEMANTIC_REVIEW', '上下文声称表头，但目标为' + KIND_NAME[kind]];
  }
  if (claim === 'TABLE') {
    if (kind === 'table_header' || kind === 'table_row') return ['LINE_OK', '结构核验通过：目标为表格行'];
    return ['LINE_SEMANTIC_REVIEW', '上下文声称表格行，但目标为' + KIND_NAME[kind]];
  }
  if (claim === 'HEADING') {
    if (kind === 'heading') return ['LINE_OK', '结构核验通过：目标为标题行'];
    return ['LINE_SEMANTIC_REVIEW', '上下文声称标题/小节，但目标为' + KIND_NAME[kind]];
  }
  if (claim === 'FIELD') {
    const tick = /`([^`]{1,40})`/.exec(text);
    if (tick && before.indexOf(tick[1]) >= 0) return ['LINE_OK', '结构核验通过：字段名「' + tick[1] + '」在目标行与上下文同时出现'];
    return ['LINE_OK_UNVERIFIED', '目标行存在，但字段名未能在目标行复现'];
  }
  return ['LINE_OK_UNVERIFIED', '目标行存在，语义未核验'];
}

/**
 * 依上下文关键词把引用指向已知文档；返回文档 key（basename）。
 * 2026-10-28：无任何线索时返回 null——裸行号不再默认指向当前文件（那会把引用错误归属）。
 */
function inferTarget(ctx, selfKey, docs) {
  const pick = (re) => Object.keys(docs).find((k) => re.test(k));
  const tail = ctx.split('||')[0];
  const near = /([\w./-]+\.md)\s*[:：]?\s*$/.exec(tail.slice(-40));
  if (near) { const hit = docKeyByName(near[1].split('/').pop(), docs); if (hit) return hit; }
  if (/契约|CONTRACT/.test(ctx)) return pick(/CONTRACT/) || null;
  if (/RAW|阻塞清单/.test(ctx)) return pick(/RAW/) || null;
  if (/ADAPTER|适配表/.test(ctx)) return pick(/ADAPTER/) || null;
  if (/记录级计划|RECORD_LEVEL/.test(ctx)) return pick(/RECORD_LEVEL/) || null;
  if (/转录稿|转述稿|TRANSCRIPTION_2F/.test(ctx)) return pick(/TRANSCRIPTION_2F/) || null;
  if (/计划文档|\bPLAN\b/.test(ctx)) return pick(/PLAN/) || null;
  return null;
}

function docKeyByName(name, docs) {
  return Object.keys(docs).find((k) => k === name || name.endsWith(k) || k.endsWith(name)) || null;
}

/**
 * 行文里显式写出的 .md 文件名 → 已加载文档 key；没有或不在扫描集内时返回 null。
 * 只接受"文件名"这一种显式证据，不接受"契约/计划"等简称或章节号邻近推断。
 */
function namedDocKey(before, docs) {
  // 只认"紧邻 § 之前的文件名"，且排除以 :NNN / #锚点 形式出现的行号/片段引用——
  // 否则同一行里"引用别的文件第 90 行"会被误当成"这一节属于那个文件"（实测产生过 2 个 TARGET_MISMATCH 假阳性）。
  const tail = before.slice(-40);
  const m = /([\w./-]+\.md)(?![A-Za-z0-9#:])(?!\s*:\d)/g;
  let last = null;
  let hit;
  while ((hit = m.exec(tail))) last = hit[1];
  if (!last) return null;
  const base = last.split('/').pop();
  const key = docKeyByName(base, docs);
  return key || null;
}

/**
 * 探测：白名单外、但"全库唯一所有者/限定词/标题相似"等旧启发式会解析成功的 §X.Y 引用。
 * 只读，用于评估"把归属改成只认白名单"会让多少条引用退化为歧义，以及是否会产生误判 TARGET_MISMATCH。
 */
function analyzeOutside(files, root, whitelist) {
  const expanded = root ? discoverReferencedDocs(files, root) : files;
  const docs = loadDocs(expanded);
  const items = [];
  Object.values(docs).forEach((d) => {
    const selfKey = d.key;
    const allowedBase = whitelist && whitelist[selfKey] && Array.isArray(whitelist[selfKey].allowed)
      ? whitelist[selfKey].allowed : [];
    const allowed = [selfKey].concat(allowedBase.filter((k) => k !== selfKey));
    d.lines.forEach((line, i) => {
      scanAnchors(selfKey, docs, line, whitelist).forEach((a) => {
        if (a.named || !a.owners || a.owners.length === 0) return;
        const cand = a.owners.filter((k) => allowed.includes(k));
        if (cand.length > 0) return;
        items.push({
          file: d.file, line: i + 1, num: a.num, sectionOwner: a.owners[0], targets: a.owners,
          classAfter: a.cls, mismatchAfter: a.cls === 'TARGET_MISMATCH',
          text: line.trim().slice(0, 120)
        });
      });
    });
  });
  return {
    outsideWhitelist: items,
    outsideMismatchAfter: items.filter((x) => x.mismatchAfter).length
  };
}

/**
 * 扫描一份文档的行号引用，返回不带行号的记录（行号由调用方补）
 */
function scanDoc(selfKey, docs, line) {
  const refs = [];
  let lastTarget = null;
  const re = /:(\d{1,4})(?:-(\d{1,4}))?(?![\d:])/g;
  let m;
  while ((m = re.exec(line))) {
    const n = Number(m[1]);
    const n2 = m[2] ? Number(m[2]) : null;
    const idx = m.index;
    const before = line.slice(Math.max(0, idx - 140), idx);
    const ctx = before + '||' + line.slice(idx, Math.min(line.length, idx + 140));

    // F1：时间 HH:MM（冒号前紧邻数字）
    if (/[0-9]/.test(line.charAt(idx - 1))) {
      refs.push({ cls: 'IGNORED', reason: '时间格式（HH:MM）', n, raw: m[0] });
      continue;
    }

    // 路径限定：xxx.md:12 / data/a.js:10
    const pathM = /([\w./-]+\.([A-Za-z0-9]+))$/.exec(before);
    let targetKey = selfKey;
    if (pathM) {
      const ext = pathM[2].toLowerCase();
      if (ext !== 'md') {
        refs.push({ cls: 'IGNORED', reason: '非 Markdown 文件行号（' + pathM[1] + '）', n, raw: m[0] });
        continue;
      }
      const resolved = docKeyByName(path.basename(pathM[1]), docs);
      if (!resolved) {
        refs.push({ cls: 'UNRESOLVED', reason: '引用的 Markdown 文件不在检查集内（' + pathM[1] + '）', n, raw: m[0], target: pathM[1] });
        continue;
      }
      targetKey = resolved;
      lastTarget = resolved;
    } else {
      targetKey = lastTarget || inferTarget(before, selfKey, docs);
      if (!targetKey) {
        refs.push({
          cls: 'LINE_TARGET_UNCERTAIN',
          reason: '裸行号：同行既无文件线索也无已确认的前序目标，不猜测归属',
          n, n2, raw: m[0]
        });
        continue;
      }
    }

    const targetLines = docs[targetKey].lines;
    const tl = (targetLines[n - 1] || '').trim();
    const alive = tl.length > 0 && !/^\|?[-|: ]+\|?$/.test(tl);

    const nearCtx = line.slice(Math.max(0, idx - 50), idx);
    if (isHistorical(nearCtx)) {
      refs.push({ cls: 'HISTORICAL', reason: '上下文标注历史/旧版，保留原值', n, n2, raw: m[0], target: targetKey });
    } else if (n > targetLines.length) {
      refs.push({ cls: 'UNRESOLVED', reason: '目标行越界（' + targetKey + ' 共 ' + targetLines.length + ' 行）', n, n2, raw: m[0], target: targetKey });
    } else if (n2 !== null && (n2 < n || n2 > targetLines.length)) {
      refs.push({
        cls: 'UNRESOLVED',
        reason: n2 < n
          ? '行号范围倒序（' + n + '-' + n2 + '）'
          : '行号范围上界越界（' + targetKey + ' 共 ' + targetLines.length + ' 行）',
        n, n2, raw: m[0], target: targetKey
      });
    } else if (!alive) {
      refs.push({
        cls: 'UNRESOLVED',
        reason: '目标行为空行/表格分隔行，无唯一证据可恢复',
        n, n2, raw: m[0], target: targetKey, targetText: tl.slice(0, 80)
      });
    } else {
      const claim = claimOf(before);
      const info = classifyTarget(targetLines, n);
      const [cls, reason] = judgeStructure(claim, info.kind, info.text, before);
      refs.push({
        cls, reason, n, n2, raw: m[0], target: targetKey,
        claim: claim || 'NONE', targetKind: info.kind, targetText: info.text.slice(0, 80)
      });
    }
  }
  return refs;
}

/** 行内限定词 → 目标文档（只认“明确写出文件名/文档名”的词，不做章节号或文件名相似推断） */
const QUALIFIERS = [
  [/记录级计划|RECORD_LEVEL_GENERATION_PLAN/i, /RECORD_LEVEL/i],
  [/契约|CONTRACT_20261023|RECORD_GENERATOR_CONTRACT/i, /CONTRACT/i],
  [/采集规范|REAL_DATA_COLLECTION_SPEC/i, /REAL_DATA_COLLECTION_SPEC/i],
  [/2F\s*§|转录稿|转述稿|TRANSCRIPTION_2F/i, /TRANSCRIPTION_2F/i],
  [/RAW|阻塞清单|BLOCKERS/i, /RAW_DATA_BLOCKERS/i],
  [/适配表|ADAPTER/i, /ADAPTER_MAP/i],
  [/预检|PRECHECK/i, /RECORD_AUDIT_PRECHECK/i],
  [/计划文档|\bPLAN\b/i, /RECORD_GENERATOR_PLAN/i]
];

function qualifierTarget(line, idx, docs) {
  let best = null;
  let bestDist = Infinity;
  QUALIFIERS.forEach(([alias, docRe]) => {
    const key = Object.keys(docs).find((k) => docRe.test(k));
    if (!key) return;
    const re = new RegExp(alias.source, 'gi');
    let m;
    while ((m = re.exec(line))) {
      const d = Math.abs(m.index - idx);
      if (d < bestDist) { bestDist = d; best = key; }
    }
  });
  return best;
}

function bigrams(s) {
  const out = new Set();
  const clean = String(s || '').replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, ' ');
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2);
    if (/^[\u4e00-\u9fa5]{2}$/.test(g)) out.add(g);
  }
  return out;
}

/** 用“该节标题与行文的词重合”作为最弱证据；只在唯一候选明显胜出时采纳 */
function titleHint(docs, owners, num, line) {
  const lb = bigrams(line);
  let bestDoc = null;
  let bestScore = 0;
  let tie = false;
  owners.forEach((k) => {
    const title = (docs[k].titles && docs[k].titles[num]) || '';
    let s = 0;
    bigrams(title).forEach((g) => { if (lb.has(g)) s++; });
    if (s > bestScore) { bestScore = s; bestDoc = k; tie = false; }
    else if (s === bestScore && s > 0) tie = true;
  });
  return bestScore >= 2 && !tie ? bestDoc : null;
}

function scanAnchors(selfKey, docs, line, whitelist) {
  const out = [];
  const re = /§(\d+(?:\.\d+)*)/g;
  let m;
  while ((m = re.exec(line))) {
    const num = m[1];
    const before = line.slice(Math.max(0, m.index - 120), m.index);
    const hit = (k) => docs[k].anchors.has(num) || [...docs[k].anchors].some((x) => x.startsWith(num + '.'));
    const owners = Object.keys(docs).filter(hit);
    const allowedBase = whitelist && whitelist[selfKey] && Array.isArray(whitelist[selfKey].allowed)
      ? whitelist[selfKey].allowed : [];
    // 自引用恒允许：文档引用自己文件内的 §X.Y 不需要额外证据。
    const allowed = [selfKey].concat(allowedBase.filter((k) => k !== selfKey));
    // 归属只认两类证据：①行文显式写出目标 .md 文件名；②调用方给出的白名单（每源文件允许的目标集合）。
    // 不再使用"限定词距离""全库唯一所有者""标题相似"等启发式——它们会让白名单外的引用看起来被解析成功。
    const named = namedDocKey(before, docs);

    let targetKey = null;
    let evidence = null;
    let cls;

    if (named) {
      if (owners.includes(named)) { targetKey = named; evidence = 'EXPLICIT'; cls = 'ANCHOR_OK'; }
      else { targetKey = named; evidence = 'EXPLICIT'; cls = owners.length ? 'TARGET_MISMATCH' : 'ANCHOR_MISSING'; }
    } else {
      const cand = owners.filter((k) => allowed.includes(k));
      if (owners.includes(selfKey)) { targetKey = selfKey; evidence = 'SELF'; cls = 'ANCHOR_OK'; }
      else if (cand.length === 1) { targetKey = cand[0]; evidence = 'WHITELIST'; cls = 'ANCHOR_OK'; }
      else if (cand.length > 1) { targetKey = cand.join('|'); evidence = 'WHITELIST_MULTI'; cls = 'ANCHOR_AMBIGUOUS'; }
      else { targetKey = owners.join('|'); evidence = 'NONE'; cls = 'ANCHOR_AMBIGUOUS'; }
    }
    if (!cls) {
      cls = 'ANCHOR_AMBIGUOUS';
      targetKey = qual || (allowed
        ? owners.filter((k) => allowed.includes(k)).join('|') || owners.join('|')
        : owners.join('|'));
      evidence = 'NONE';
    }

    const reason = cls === 'ANCHOR_OK'
      ? '章节存在（' + targetKey + ' §' + num + '；依据=' + evidence + '）'
      : cls === 'TARGET_MISMATCH'
        ? '行文点名契约 §' + num + '，但该标题只在 ' + owners.join('|') + '（契约无此节）'
        : cls === 'ANCHOR_MISSING'
          ? '目标文档（' + targetKey + '）无 §' + num + ' 对应标题'
          : '无法唯一确定目标文档（候选 ' + targetKey + '），不猜测';
    out.push({ cls, num, target: targetKey, evidence, owners, named, reason, raw: m[0] });
  }
  return out;
}

/** 读取归属白名单（缺省不报错：无白名单时退回“唯一所有者/限定词/标题重合”） */
function loadWhitelist(root) {
  const file = path.join(root, 'tools', 'doc_ref_whitelist.json');
  try {
    const wl = JSON.parse(fs.readFileSync(file, 'utf8'));
    return wl && wl.sources ? wl.sources : null;
  } catch (e) {
    return null;
  }
}

function loadDocs(files) {
  const docs = {};
  files.forEach((abs) => {
    const key = path.basename(abs);
    const lines = readLines(abs);
    const titles = {};
    lines.forEach((line) => {
      const m = /^#{2,6}\s+(\d+(?:\.\d+)*)\s*(.*)$/.exec(line);
      if (m) titles[m[1]] = m[2].trim();
    });
    docs[key] = { key, file: abs, lines, anchors: collectAnchors(lines), titles };
  });
  return docs;
}

function discoverReferencedDocs(files, root) {
  const found = new Set(files);
  const roots = [root];
  files.forEach((f) => roots.push(path.dirname(f)));
  files.forEach((f) => {
    let text = '';
    try { text = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    const re = /([\w./-]{1,160}\.md)(?=:)/g;
    let m;
    while ((m = re.exec(text))) {
      const rel = m[1];
      for (const base of roots) {
        const cand = path.resolve(base, rel);
        const alt = path.resolve(base, 'docs', rel);
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) { found.add(cand); break; }
        if (fs.existsSync(alt) && fs.statSync(alt).isFile()) { found.add(alt); break; }
      }
    }
  });
  return [...found];
}

function scanFiles(files, root, whitelist) {
  const expanded = root ? discoverReferencedDocs(files, root) : files;
  const docs = loadDocs(expanded);
  const refs = [];
  const anchors = [];
  Object.values(docs).forEach((d) => {
    d.lines.forEach((line, i) => {
      scanDoc(d.key, docs, line).forEach((r) => refs.push(Object.assign({ file: d.file, line: i + 1 }, r)));
      scanAnchors(d.key, docs, line, whitelist).forEach((a) => anchors.push(Object.assign({ file: d.file, line: i + 1 }, a)));
    });
  });
  return { docs, refs, anchors };
}

function summarize(result) {
  const counts = {};
  result.refs.forEach((r) => { counts[r.cls] = (counts[r.cls] || 0) + 1; });
  const anchorCounts = {};
  result.anchors.forEach((a) => { anchorCounts[a.cls] = (anchorCounts[a.cls] || 0) + 1; });
  return { counts, anchorCounts };
}

function render(result) {
  const { counts, anchorCounts } = summarize(result);
  const out = ['=== 文档引用锚点检查（只读）==='];
  Object.values(result.docs).forEach((d) =>
    out.push('  - ' + d.file + '（' + d.lines.length + ' 行，锚点 ' + d.anchors.size + ' 个）'));
  out.push('', '章节锚点：' + JSON.stringify(anchorCounts), '行号引用：' + JSON.stringify(counts), '');
  out.push('说明：LINE_OK 仅表示结构可验证（标题/表头/表格行/字段名）；LINE_OK_UNVERIFIED 表示行存在但语义未核验；LINE_SEMANTIC_REVIEW 表示结构与其上下文声称相矛盾，需人工复核。');
  const missing = result.anchors.filter((a) => a.cls === 'ANCHOR_MISSING');
  if (missing.length) {
    out.push('', '!! 缺失章节锚点（' + missing.length + '）：');
    missing.forEach((a) => out.push('  ' + a.file + ':' + a.line + '  ' + a.raw + ' → ' + a.reason));
  }
  const amb = result.anchors.filter((a) => a.cls === 'ANCHOR_AMBIGUOUS');
  if (amb.length) {
    out.push('', 'ambiguous 章节锚点（' + amb.length + ' 条，不判失败，列前 12 条）：');
    amb.slice(0, 12).forEach((a) => out.push('  ' + path.basename(a.file) + ':' + a.line + '  ' + a.raw + ' → ' + a.reason));
  }
  const sem = result.refs.filter((r) => r.cls === 'LINE_SEMANTIC_REVIEW');
  if (sem.length) {
    out.push('', '语义复核（' + sem.length + ' 条，列前 20 条）：');
    sem.slice(0, 20).forEach((r) => out.push('  ' + path.basename(r.file) + ':' + r.line + '  ' + r.raw + ' → ' + r.reason));
    if (sem.length > 20) out.push('  …共 ' + sem.length + ' 条，见 --json');
  }
  const bad = result.refs.filter((r) => r.cls === 'UNRESOLVED');
  if (bad.length) {
    out.push('', '失效行号（' + bad.length + ' 条，列前 40 条）：');
    bad.slice(0, 40).forEach((r) => out.push('  ' + r.file + ':' + r.line + '  ' + r.raw + ' → ' + r.reason));
    if (bad.length > 40) out.push('  …共 ' + bad.length + ' 条，见 --json');
  }
  out.push('', '结论：' + (missing.length ? 'FAIL（存在缺失锚点）' : 'PASS（锚点齐备；失效行号与语义复核仅计数）'));
  return out.join('\n');
}

function selfTest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docref-selftest-'));
  const good = path.join(tmp, 'GOOD.md');
  const refs = path.join(tmp, 'REFS.md');
  const goodLines = ['# GOOD', '### 5.1 章节甲', '内容甲', '### 7.2 章节乙', '内容乙', '',
    '| 名 | 价 |', '|---|---|', '| 甲 | 1 |'];
  for (let i = 1; i <= 20; i++) goodLines.push('### 1.' + i + ' 章节' + i, '内容' + i);
  goodLines.push('本节引用 §9.9（不存在）', '');
  fs.writeFileSync(good, goodLines.join('\n'));
  fs.writeFileSync(refs, [
    '# REFS',
    '- 有效锚点：§5.1 与 §7.2',
    '- 有效行号：GOOD.md:3 指向内容甲',
    '- 表头误指标题：GOOD.md:2',
    '- 表头命中：GOOD.md:7',
    '- 小节命中：GOOD.md:4',
    '- 越界行号：GOOD.md:99',
    '- 历史引用：2026-10-23 版 GOOD.md:42（历史）',
    '- 误报时间：12:30 开会',
    '- 误报路径：data/dishes.js:10',
    ''
  ].join('\n'));
  const result = scanFiles([good, refs], null, { 'REFS.md': { allowed: ['GOOD.md'] } });
  const { counts, anchorCounts } = summarize(result);
  const problems = [];
  const expect = (actual, want, label) => {
    if (actual !== want) problems.push(label + ' 期望 ' + want + '，实际 ' + actual);
  };
  expect(anchorCounts.ANCHOR_OK, 2, 'ANCHOR_OK');
  expect(anchorCounts.ANCHOR_MISSING || 0, 0, 'ANCHOR_MISSING');
  expect(anchorCounts.ANCHOR_AMBIGUOUS || 0, 1, 'ANCHOR_AMBIGUOUS');
  expect(counts.LINE_OK, 2, 'LINE_OK');
  expect(counts.LINE_OK_UNVERIFIED, 1, 'LINE_OK_UNVERIFIED');
  expect(counts.LINE_SEMANTIC_REVIEW, 1, 'LINE_SEMANTIC_REVIEW');
  expect(counts.UNRESOLVED, 1, 'UNRESOLVED');
  expect(counts.HISTORICAL, 1, 'HISTORICAL');
  expect(counts.IGNORED, 2, 'IGNORED');
  const sem = result.refs.find((r) => r.cls === 'LINE_SEMANTIC_REVIEW');
  if (!sem || sem.claim !== 'TABLE_HEADER' || sem.targetKind !== 'heading') {
    problems.push('LINE_SEMANTIC_REVIEW 样例应为「声称表头但目标是标题」');
  }
  if (problems.length) {
    console.log('SELF-TEST FAIL');
    problems.forEach((p) => console.log('  - ' + p));
    console.log(JSON.stringify({ counts, anchorCounts }));
    console.log(JSON.stringify(result.refs, null, 1));
    return 1;
  }
  console.log('SELF-TEST PASS ' + JSON.stringify({ counts, anchorCounts }));
  return 0;
}

function parseArgs(argv) {
  const out = { json: false, docs: null, root: process.cwd(), selfTest: false, detectOutside: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--self-test') out.selfTest = true;
    else if (a === '--detect-outside') out.detectOutside = true;
    else if (a === '--docs') out.docs = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--root') out.root = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/check_doc_refs.js [--json] [--self-test] [--docs a.md,b.md] [--root dir]');
      process.exit(0);
    } else {
      console.error('未知参数：' + a);
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const list = (args.docs && args.docs.length ? args.docs : DEFAULT_DOCS)
    .map((p) => (path.isAbsolute(p) ? p : path.join(args.root, p)));
  let result;
  try {
    result = scanFiles(list, args.root, loadWhitelist(args.root));
  } catch (e) {
    console.error('扫描失败：' + e.message);
    return 2;
  }
  const summary = summarize(result);
  const whitelist = loadWhitelist(args.root);
  const outside = args.detectOutside ? analyzeOutside(list, args.root, whitelist) : null;
  if (args.json) {
    const payload = { summary, docs: Object.values(result.docs).map((d) => ({ file: d.file, lines: d.lines.length, anchors: d.anchors.size })), anchors: result.anchors, refs: result.refs };
    if (outside) Object.assign(payload, outside);
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(render(result));
    if (outside) {
      console.log('', '=== 白名单外、但会被旧启发式解析的 §X.Y 引用（探测，只读）===');
      console.log('  条数：' + outside.outsideWhitelist.length + '；其中若按新规则会写成 TARGET_MISMATCH 的：' + outside.outsideMismatchAfter);
      outside.outsideWhitelist.forEach((x) => console.log('  ' + path.basename(x.file) + ':' + x.line + '  §' + x.num + ' → 唯一所有者 ' + x.sectionOwner + '（当前分类 ' + x.classAfter + '）'));
    }
  }
  return (summary.anchorCounts.ANCHOR_MISSING || 0) > 0 ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { collectAnchors, scanDoc, scanAnchors, scanFiles, summarize, claimOf, classifyTarget, judgeStructure, loadWhitelist, namedDocKey, analyzeOutside, qualifierTarget, titleHint, DEFAULT_DOCS };
