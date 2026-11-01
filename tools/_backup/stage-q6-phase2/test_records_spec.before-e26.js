/**
 * tools/test_records_spec.js
 *
 * 记录级生成规格的可执行断言（**不实现生成器**）。
 *
 * 目的：把 2026-10-23 只读审计里「已经确定、无需再裁决」的规则固化成会红的测试，
 *       这样后续任何人改转述稿或写生成器，都能立刻发现口径漂移。
 *
 * 三类结果，必须分开统计：
 *   PASS     —— 断言成立
 *   FAIL     —— 断言不成立（规格漂移或文档被改坏，属于**真问题**）
 *   PENDING  —— 依赖尚未存在的产物（records.json / tools/pilot/gen_records.js），
 *               记为「预期失败·待实现」，不计入失败，但必须打印原因
 *
 * 退出码：0 = 无 FAIL（允许有 PENDING）；1 = 有 FAIL 或测试自身错误。
 *
 * 依据文档（相对路径，均为只读）：
 *   tools/pilot/TRANSCRIPTION_2F.md
 *   tools/pilot/TRANSCRIPTION_3F.md
 *   docs/RECORD_LEVEL_GENERATION_PLAN_20261023.md
 *   docs/RECORD_AUDIT_PRECHECK_20261023.md
 *
 * 本轮**不生成** CSV 与 records.json，也不修改任何既有文件。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = {
  t2f: path.join(ROOT, 'tools', 'pilot', 'TRANSCRIPTION_2F.md'),
  t3f: path.join(ROOT, 'tools', 'pilot', 'TRANSCRIPTION_3F.md'),
  plan: path.join(ROOT, 'docs', 'RECORD_LEVEL_GENERATION_PLAN_20261023.md'),
  audit: path.join(ROOT, 'docs', 'RECORD_AUDIT_PRECHECK_20261023.md'),
  contract: path.join(ROOT, 'docs', 'RECORD_GENERATOR_CONTRACT_20261023.md'),
  gen: path.join(ROOT, 'tools', 'pilot', 'gen_records.js'),
  records: path.join(ROOT, 'tools', 'pilot', 'records.json')
};

function readText(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error('无法读取' + (label || '文件') + '：' + path.basename(file) + '（' + e.code + '）');
  }
}

const T2F = readText(P.t2f, '2F 转述稿');
const T3F = readText(P.t3f, '3F 转述稿');
const PLAN = readText(P.plan, '生成方案');
const AUDIT = readText(P.audit, '只读审计报告');
const CONTRACT = readText(P.contract, '生成器契约');

// ---------------------------------------------------------------- 表格解析

/** 把文本切成 markdown 表格块：{ header, rows[], line } */
function extractTables(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\s*\|/.test(lines[i])) {
      const start = i;
      const block = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { block.push(lines[i]); i++; }
      if (block.length >= 2 && /^\s*\|[\s:\-|]+\|\s*$/.test(block[1])) {
        out.push({
          header: block[0],
          rows: block.slice(2),
          line: start + 1
        });
      }
      continue;
    }
    i++;
  }
  return out;
}

/**
 * 按「所属章节标题」取菜品表。
 *
 * 转述稿把每个档口写成 `### W2-01 …` / `### W03 …`，该标题下的所有表格都算菜品数据
 * （含「项目 | 价格」「套餐 | 价格」「菜品 | 小份 | 大份」等多形态表）。
 * 早期版本用表头关键字过滤，会漏掉这些表，导致行数系统性偏低（254 vs 316），
 * 属于测试自身缺陷，已改为按章节归集。
 */
function sectionTables(text, headingRe) {
  const lines = text.split('\n');
  const heads = [];
  lines.forEach((ln, idx) => {
    const m = ln.match(/^(#{2,4})\s+(.*)$/);
    if (m) heads.push({ line: idx + 1, text: m[2].trim() });
  });
  const headAt = (line) => {
    let cur = '';
    for (const h of heads) { if (h.line <= line) cur = h.text; else break; }
    return cur;
  };
  return extractTables(text)
    .map(t => ({ line: t.line, heading: headAt(t.line), header: t.header, count: t.rows.length }))
    .filter(t => headingRe.test(t.heading));
}

function sumCount(tables) { return tables.reduce((s, t) => s + t.count, 0); }

// ---------------------------------------------------------------- 断言收集

const results = [];
function pass(id, rule, source, note) { results.push({ id, rule, source, status: 'PASS', note }); }
function fail(id, rule, source, note) { results.push({ id, rule, source, status: 'FAIL', note }); }
function pending(id, rule, source, note) { results.push({ id, rule, source, status: 'PENDING', note }); }

function assertContains(id, rule, source, text, needle, note) {
  if (text.indexOf(needle) !== -1) pass(id, rule, source, note);
  else fail(id, rule, source, '未找到：' + needle + (note ? '｜' + note : ''));
  return text.indexOf(needle) !== -1;
}

function assertNotContains(id, rule, source, text, needle, note) {
  if (text.indexOf(needle) === -1) pass(id, rule, source, note);
  else fail(id, rule, source, '不应出现：' + needle);
}

// ================================================================ T1
(function T1() {
  const rule = 'R1 一菜一价 / 行数口径：2F 逐档菜品表合计 316 行';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §三 逐家抄录';
  const tables = sectionTables(T2F, /^W2-\d+/);   // ### W2-01 … 下的全部表格
  const total = sumCount(tables);
  if (total === 316) pass('T1', rule, source, '实测 ' + total + ' 行（' + tables.length + ' 张表，按档口章节归集）');
  else fail('T1', rule, source, '实测 ' + total + ' 行，期望 316（表数 ' + tables.length + '）');
})();

// ================================================================ T2
(function T2() {
  const rule = '行数口径：3F 逐档菜品表合计 145 行';
  const source = 'tools/pilot/TRANSCRIPTION_3F.md §二 逐档口抄录';
  const tables = sectionTables(T3F, /^W\d\d/);   // ### W01 … 下的全部表格
  const total = sumCount(tables);
  if (total === 145) pass('T2', rule, source, '实测 ' + total + ' 行（' + tables.length + ' 张表，按档口章节归集）');
  else fail('T2', rule, source, '实测 ' + total + ' 行，期望 145（表数 ' + tables.length + '）');
})();

// ================================================================ T3
(function T3() {
  const rule = 'R2/B6 双拼饭按 8 条独立记录计，价格序列 13,13,14,16,16,15,15,16';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §4.1 双拼饭清单';
  const expect = [
    ['红烧鸡翅根', '13'], ['美味鸡腿肉', '13'], ['黑椒鸡排', '14'], ['蒲烧鳗鱼', '16'],
    ['秘制红烧肉', '16'], ['黑金卤肉饭', '15'], ['把子肉', '15'], ['鲜卤排骨', '16']
  ];
  const missing = expect.filter(([n, p]) => {
    // 允许「菜名 ... 13」或「菜名 | 13」两种写法
    const re = new RegExp(n + '[^\\n]{0,40}?' + p + '(?!\\d)');
    return !re.test(T2F);
  });
  if (missing.length === 0) pass('T3', rule, source, '8 款菜名与价格全部命中');
  else fail('T3', rule, source, '未命中：' + missing.map(m => m[0] + '/' + m[1]).join('、'));
})();

// ================================================================ T4
(function T4() {
  const rule = 'B7 辣椒炒肉 14.9 与辣椒炒肥肠 17.9 是两道独立菜，不得合并';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §三 W2-10 + §四 #8';
  // 牌面原文是「辣椒炒肉（招牌）| 14.9 / 17.9 元（两档）」，裁决写在 §四 #8：
  //   「14.9 = 辣椒炒肉、17.9 = 辣椒炒肥肠，两道独立菜，互不覆盖」
  const raw = /辣椒炒肉[^\n]{0,20}14\.9[^\n]{0,20}17\.9/.test(T2F);
  const adjA = /14\.9\s*=\s*辣椒炒肉/.test(T2F);
  const adjB = /17\.9\s*=\s*辣椒炒肥肠/.test(T2F);
  if (raw && adjA && adjB) pass('T4', rule, source, '牌面两档 + 裁决「14.9=辣椒炒肉、17.9=辣椒炒肥肠」均在');
  else fail('T4', rule, source, '牌面=' + raw + ' 14.9=辣椒炒肉:' + adjA + ' 17.9=辣椒炒肥肠:' + adjB);
  // 方案文档必须同口径：明确写出 17.9 属于辣椒炒肥肠（不是辣椒炒肉的第二档）
  if (/17\.9\s*(?:是|=)\s*辣椒炒肥肠/.test(PLAN)) pass('T4b', 'B7 方案文档明确 17.9 属辣椒炒肥肠', 'docs/RECORD_LEVEL_GENERATION_PLAN_20261023.md §4.1');
  else fail('T4b', 'B7 方案文档明确 17.9 属辣椒炒肥肠', 'docs/RECORD_LEVEL_GENERATION_PLAN_20261023.md §4.1', '未找到「17.9 是/＝ 辣椒炒肥肠」');
})();

// ================================================================ T5
(function T5() {
  const rule = 'R5 按规格拆条：W2-07 15 行 → 30 条、W2-09 9 行 → 18 条（仅双价行拆，一行多口味不拆）';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §7.5 + 方案文档 §二';
  const ok2f = /W2-07[^\n]{0,40}30/.test(T2F) && /W2-09[^\n]{0,40}18/.test(T2F);
  const okPlan = /\| W2-07 四有青年面馆 \| \*\*30\*\* \|/.test(PLAN) && /\| W2-09 博山水饺 \| \*\*18\*\* \|/.test(PLAN);
  if (ok2f && okPlan) pass('T5', rule, source, '2F 与方案文档一致（30 / 18）');
  else fail('T5', rule, source, '2F=' + ok2f + ' 方案=' + okPlan);
})();

// ================================================================ T6
(function T6() {
  const rule = 'R3 多基底同价拆条：W2-04 米线区 12→36、W2-11 砂锅区 11→33；foodType = rice_vermicelli / noodle / other';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §7.1 + §6.1 + 方案文档 §二';
  const cnt = /米线区[^\n]{0,20}12[^\n]{0,12}36/.test(T2F) || /12 行 → 36 条/.test(T2F);
  const cnt2 = /砂锅区[^\n]{0,20}11[^\n]{0,12}33/.test(T2F) || /11 行 → 33 条/.test(T2F);
  const ft = /rice_vermicelli/.test(T2F) && /noodle/.test(T2F) && /other/.test(T2F);
  if (cnt && cnt2 && ft) pass('T6', rule, source, '36 / 33 与三个枚举均命中');
  else fail('T6', rule, source, '36=' + cnt + ' 33=' + cnt2 + ' 枚举=' + ft);
  // 土豆粉必须锁定 other 且标「待复核分类」，不得并入 rice_vermicelli
  const lock = /土豆粉[^\n]{0,40}other/.test(T2F);
  const flag = /土豆粉[^\n]{0,40}待复核分类/.test(T2F);
  if (lock && flag) pass('T6b', '土豆粉锁 other + 标记待复核分类（不并入粉类）', 'tools/pilot/TRANSCRIPTION_2F.md §7.1');
  else fail('T6b', '土豆粉锁 other + 标记待复核分类', 'tools/pilot/TRANSCRIPTION_2F.md §7.1', 'lock=' + lock + ' flag=' + flag);
})();

// ================================================================ T7
(function T7() {
  const rule = 'R4/R7 同菜多做法拆条：蛋炒区 13 口味 × 3 做法 = 39 条；foodType = snack(饼) / noodle(面) / rice(饭)';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md §7.2';
  const three = /13 [^\n]{0,20}39/.test(T2F);
  const ft = /炒饼[^\n]{0,20}snack/.test(T2F) && /炒面[^\n]{0,20}noodle/.test(T2F) && /炒饭[^\n]{0,20}rice/.test(T2F);
  if (three && ft) pass('T7', rule, source, '13→39 与三条 foodType 映射均命中');
  else fail('T7', rule, source, '13→39=' + three + ' foodType=' + ft);
})();

// ================================================================ T8
(function T8() {
  const rule = '账目总量：2F 419（A347/B39/C33）、3F 145（A116/C29）、合计 564（A463/B39/C62），三处文档一致';
  const source = '方案文档 §二/§八、2F §7.4 更正块、docs/RAW_DATA_BLOCKERS_20261023.md';
  const blk = readText(path.join(ROOT, 'docs', 'RAW_DATA_BLOCKERS_20261023.md'), '阻塞报告');
  const checks = [
    ['方案 §二 2F=419', /\| 2F \| \*\*316\*\* \| \*\*419\*\* \|/.test(PLAN)],
    ['方案 §二 合计=564', /\| 合计 \| \*\*461\*\* \| \*\*564\*\* \|/.test(PLAN)],
    ['方案 §八 2F 347/39/33', /\| 2F \| \*\*419\*\* \| \*\*347\*\* \| \*\*39\*\* \| \*\*33\*\* \|/.test(PLAN)],
    ['方案 §八 合计 564/463', /\| \*\*合计\*\* \| \*\*564\*\* \| \*\*463\*\* \|/.test(PLAN)],
    ['2F 更正块 419', /当前口径的 2F 规划合计为 419 条/.test(T2F)],
    ['阻塞报告 2F=419', /\| 2F \| 316 \| \*\*419\*\* \| 347 \| 39 \| 33 \|/.test(blk)],
    ['阻塞报告 合计=564', /\| 合计 \| 461 \| \*\*564\*\* \| 463 \| 39 \| 62 \|/.test(blk)]
  ];
  const bad = checks.filter(c => !c[1]).map(c => c[0]);
  if (bad.length === 0) pass('T8', rule, source, '7 处锚点全部一致');
  else fail('T8', rule, source, '不一致：' + bad.join('、'));
  // 闭合校验（纯算术，独立于文档）
  const closed = (347 + 39 + 33 === 419) && (116 + 0 + 29 === 145) && (463 + 39 + 62 === 564)
    && (419 + 145 === 564) && (347 + 116 === 463) && (33 + 29 === 62);
  if (closed) pass('T8b', 'A+B+C 与两层相加闭合', 'arithmetic', '347+39+33=419；463+39+62=564');
  else fail('T8b', 'A+B+C 闭合', 'arithmetic');
})();

// ================================================================ T9
(function T9() {
  const rule = '全部生成记录的元数据必须 verifyStatus=unverified、verifiedAt=null（不得因裁决升级为已核实）';
  const source = '2F §7.4/§8、3F §八 前置条件 + 审计报告 §五 契约';
  const docRule = /verifyStatus[^\n]{0,20}unverified/.test(T2F) && /verifiedAt[^\n]{0,20}null/.test(T2F)
    || /verifyStatus[^\n]{0,20}unverified[\s\S]{0,80}verifiedAt[^\n]{0,20}null/.test(T3F);
  if (docRule) pass('T9', rule + '（文档规则层）', source, '转述稿已写明该约束');
  else fail('T9', rule + '（文档规则层）', source, '转述稿未写明 unverified / null 约束');
  pending('T9b', rule + '（产物层）', 'tools/pilot/records.json', '生成器未实现，无法核对每条记录');
})();

// ================================================================ T10
(function T10() {
  const rule = 'B5 楼层建模：3F = 服务楼三楼，与 2F 同属店铺 c01，楼层 id c01_f3，不新建第三个店';
  const source = 'tools/pilot/TRANSCRIPTION_3F.md §四 #13 + §八';
  const a = /c01_f3/.test(T3F);
  const b = /不新建第三个店|与 2F 同属/.test(T3F);
  const c = /建模裁决/.test(T3F);
  if (a && b && c) pass('T10', rule, source, 'c01_f3 + 同店 + 建模裁决说明齐备');
  else fail('T10', rule, source, 'c01_f3=' + a + ' 同店=' + b + ' 建模裁决=' + c);
})();

// ================================================================ T11
(function T11() {
  const rule = 'B8 三个暂定店名必须保留「暂定」标记，不得写成已核实正式名';
  const source = 'tools/pilot/TRANSCRIPTION_2F.md 名册/逐家抄录';
  // 文档里写作「黄焖鸡店（暂定名，名册无对应）」「烽盛面馆（暂定名；…）」「（炒粉炒面炒饼，暂定）」
  const expect = [
    ['黄焖鸡店', /黄焖鸡店[^\n]{0,12}暂定/],
    ['炒粉炒面炒饼', /炒粉炒面炒饼[^\n]{0,20}暂定/],
    ['烽盛面馆', /烽盛面馆[^\n]{0,12}暂定/]
  ];
  const miss = expect.filter(pair => !pair[1].test(T2F)).map(pair => pair[0]);
  if (miss.length === 0) pass('T11', rule, source, '三处暂定名均带「暂定」标记');
  else fail('T11', rule, source, '缺暂定标记：' + miss.join('、'));
})();

// ================================================================ T12
(function T12() {
  const rule = 'R6/R7/B13 阻塞过滤：B 档（待补证）不得进 CSV 候选，C 档（口径/归属未决）不得生成；source_detail 必须含「第 N 张」+ 牌面原文';
  const source = '方案文档 §四 三档定义 + §五 字段约束 + 2F §7.4';
  // 方案文档 §四 的写法是「B 候选·待补证 … ❌ 不可，直到补图」「C 留待确认 … ❌ **不得生成**」
  const bRule = /B 候选·待补证[\s\S]{0,240}?❌\s*不可/.test(PLAN);
  const cRule = /C 留待确认[\s\S]{0,240}?❌\s*\**不得生成/.test(PLAN);
  if (bRule && cRule) pass('T12', rule + '（文档规则层）', source, 'B 档「❌ 不可」、C 档「❌ 不得生成」均写明');
  else fail('T12', rule + '（文档规则层）', source, 'B=' + bRule + ' C=' + cRule);
  const srcRule = /第 \d+ 张|第 N 张/.test(T2F) || /第 \d+ 张/.test(T3F);
  if (srcRule) pass('T12b', 'source_detail 生成规则要求含照片序号', source);
  else fail('T12b', 'source_detail 生成规则要求含照片序号', source);
  pending('T12c', rule + '（产物层）', 'tools/pilot/records.json', '生成器未实现，无法核对每条记录是否带 source_detail 与阻塞标记');
})();

// ================================================================ T13–T20（2026-10-23 冻结规则）
// 依据：docs/RECORD_GENERATOR_CONTRACT_20261023.md §5.6 / §5.7 / §5.8 / §10
(function freezeRules() {
  /** 取表格单元格（去掉首尾空段与反引号） */
  const cells = (row) => row.split('|').slice(1, -1).map(s => s.trim().replace(/`/g, ''));
  const norm = (s) => s.replace(/\s+/g, '');
  const tables = extractTables(CONTRACT);

  // ---------- T13：名册顺序映射（37 行，t01–t37 连续）
  // 注意：契约里有两张表都以「名册位次 + 冻结」开头（三家人工确认表只有 3 行），
  // 这里必须取行数最多的那张（37 行全名册），否则会误取确认表。
  const mapTable = tables
    .filter(tb => /名册位次/.test(tb.header) && /冻结/.test(tb.header))
    .sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!mapTable) {
    fail('T13', 'D-1 名册顺序映射表', '契约 §5.6.1', '未找到「名册位次 + 冻结」表');
  } else {
    const rows = mapTable.rows.map(cells);
    const ids = rows.map(r => r[2]);
    const expect = Array.from({ length: 37 }, (_, i) => 'c01_t' + String(i + 1).padStart(2, '0'));
    const same = ids.length === 37 && ids.every((v, i) => v === expect[i]);
    const head = rows[0] && rows[0][1] === '七和米线';
    const tail = rows[36] && rows[36][1] === '西雅苏新疆炒米粉';
    if (same && head && tail) {
      pass('T13', 'D-1 名册顺序映射：东①→t01 … 西㉕→t37 连续且首尾正确', '契约 §5.6.1 + TRANSCRIPTION_2F.md:30/33',
        rows.length + ' 行，' + ids[0] + '–' + ids[36]);
    } else {
      fail('T13', 'D-1 名册顺序映射', '契约 §5.6.1',
        '行数=' + rows.length + ' 连续=' + same + ' 首=' + head + ' 尾=' + tail);
    }
  }

  // ---------- T14：三家人工确认（西⑩→t22 / 西⑪→t23 / 西⑬→t25）
  const triples = [
    ['西⑩', '朱家小馆羊肚面', 'c01_t22'],
    ['西⑪', '张记隆江猪脚饭', 'c01_t23'],
    ['西⑬', '砂锅米线月亮馍', 'c01_t25']
  ];
  const miss14 = mapTable
    ? triples.filter(([slot, name, id]) => {
        const row = mapTable.rows.map(cells).find(r => r[0] === slot);
        return !row || row[1] !== name || row[2] !== id;
      }).map(t => t[0])
    : ['（无表）'];
  const noPendingWord = /不再标「待确认」|人人工确认|三家人工人确认|三家人工确认/.test(CONTRACT);
  if (miss14.length === 0 && noPendingWord) {
    pass('T14', 'D-1 三家人工确认（西⑩→t22 / 西⑪→t23 / 西⑬→t25）且不再是「待确认」', '契约 §5.6.1 + batch1/stalls.csv');
  } else {
    fail('T14', 'D-1 三家人工确认', '契约 §5.6.1', '不符项=' + miss14.join('、') + '；措辞=' + noPendingWord);
  }

  // ---------- T15：烽盛面馆「名称已确认 ≠ 拍摄位置已确认」
  const t15a = /名称已确认\s*≠\s*拍摄位置已确认/.test(CONTRACT);
  const t15b = /W2-14/.test(CONTRACT) && /位置/.test(CONTRACT);
  const t15c = /名称已确认/.test(T2F) === false || /暂定/.test(T2F); // 2F 里仍保留「暂定」措辞
  if (t15a && t15b && t15c) {
    pass('T15', 'D-1 烽盛面馆：名称确认不等于照片位置确认，仍保留位置阻塞', '契约 §5.6.1 + §10.3');
  } else {
    fail('T15', 'D-1 烽盛面馆位置对应仍阻塞', '契约 §5.6.1 + §10.3', 'a=' + t15a + ' b=' + t15b + ' c=' + t15c);
  }

  // ---------- T16：D-2 perShop 规则
  const need16 = ['按店连续', 'perShop', 'c01_d040', 'c01_d319', '永不重编', '单独批准的重编阶段', '不占号'];
  const miss16 = need16.filter(k => CONTRACT.indexOf(k) === -1);
  if (miss16.length === 0) {
    pass('T16', 'D-2 菜品 ID 按店连续、正式 ID 永不重编、C 档与无 stallId 不占号、草稿重编需单独批准', '契约 §5.6.2');
  } else {
    fail('T16', 'D-2 perShop 规则要素缺失', '契约 §5.6.2', '缺=' + miss16.join('、'));
  }

  // ---------- T17：D-3 3F 候选 ID 与 W01–W10 顺序一致
  const f3Table = tables.find(tb => /3F编号/.test(norm(tb.header)) && /候选/.test(tb.header));
  if (!f3Table) {
    fail('T17', 'D-3 3F 候选映射表', '契约 §5.6.3', '未找到「3F 编号 + 候选」表');
  } else {
    const rows = f3Table.rows.map(cells);
    const okOrder = rows.length === 10 && rows.every((r, i) =>
      r[0] === 'W' + String(i + 1).padStart(2, '0') && r[2] === 'c01_t' + (38 + i));
    const candWord = /候选映射规则，不是本轮已分配的正式 ID/.test(CONTRACT);
    if (okOrder && candWord) pass('T17', 'D-3 3F：W01–W10 → c01_t38–t47 顺序一致，且写明「候选≠已分配」', '契约 §5.6.3');
    else fail('T17', 'D-3 3F 候选映射', '契约 §5.6.3', '顺序=' + okOrder + ' 措辞=' + candWord + ' 行数=' + rows.length);
  }

  // ---------- T18：候选 ID 不解除阻塞
  const t18 = /不等于\**\s*解除任何阻塞/.test(CONTRACT) || /不解除任何阻塞/.test(CONTRACT);
  const stillC = /W03/.test(CONTRACT) && /W04/.test(CONTRACT) && /C 档/.test(CONTRACT);
  if (t18 && stillC) pass('T18', 'D-3 分配候选档口 ID 不解除证据/CSV 阻塞（W03、W04 仍 C 档）', '契约 §5.6.3 + §5.8 + TRANSCRIPTION_3F.md:420-421');
  else fail('T18', 'D-3 候选 ID 与阻塞的关系', '契约 §5.6.3 + §5.8', 't18=' + t18 + ' stillC=' + stillC);

  // ---------- T19：D-4 三层位置
  const need19 = ['店铺级', '楼层级', '档口级', '服务楼', 'c01_f2', 'c01_f3'];
  const miss19 = need19.filter(k => CONTRACT.indexOf(k) === -1);
  const forbid19 = /把 3F 档口挂在这个位置下/.test(CONTRACT);
  if (miss19.length === 0 && forbid19) pass('T19', 'D-4 位置分三层（店铺=服务楼 / 楼层 / 档口方位），禁止 3F 挂 2F 方位', '契约 §5.7');
  else fail('T19', 'D-4 三层位置', '契约 §5.7', '缺=' + miss19.join('、') + ' 禁令=' + forbid19);

  // ---------- T20：D-5 / D-6 不生成
  const need20 = ['暂不拆', '保留 1 条候选', '不得进入 CSV', 'C 档，不生成', '双拼', '12 元/份'];
  const miss20 = need20.filter(k => CONTRACT.indexOf(k) === -1);
  if (miss20.length === 0) {
    pass('T20', 'D-5 B13 暂不拆（1 条候选且不进 CSV）/ D-6 W03 双拼与 W04「12 元/份」继续 C 档不生成', '契约 §5.8 + TRANSCRIPTION_3F.md:420-421/444');
  } else {
    fail('T20', 'D-5 / D-6 冻结要素缺失', '契约 §5.8', '缺=' + miss20.join('、'));
  }
})();

// ================================================================ 契约收尾（T21–T26）
(function contractWrapUp() {

  // ---------- T21：perShop 显式定义
  (function () {
    const need = ['按 `shopId` 编号，与楼层无关', '跨楼层连续序列', '本契约否定这种读法', '输入行序变化后仍稳定'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) {
      pass('T21', 'perShop 已写入显式定义：按 shopId、跨楼层连续、否定「按楼层从 001 起算」，且声明 C16 幂等 ≠ 抗行序变化', '契约 §5.6.2 定义块；审计 A');
    } else {
      fail('T21', 'perShop 显式定义缺失', '契约 §5.6.2', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T22：稳定 ID 映射策略
  (function () {
    const need = ['物理行号', 'K1 = (stallId, name, specLabel)', 'id-map.json', 'ORPHAN_IN_MAP', '稳定映射未落盘'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) {
      pass('T22', '稳定映射已写入：sourceLine 不作键、K1 会碰撞、采用 id-map.json、orphan 不静默删、无 map 不得编号', '契约 §5.6.5；审计 B');
    } else {
      fail('T22', '稳定映射策略要素缺失', '契约 §5.6.5', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T23：null 合法例外
  (function () {
    const need = ['stallId === null', 'id === null', 'W2-05 炒粉炒面炒饼（暂定）', '不得因「必填」而拒绝生成'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) {
      pass('T23', 'null 例外已写入：仅无名册对应项的档口可 stallId=null、仅无 stallId 可 id=null、两者恒 blocked、不得拒绝生成', '契约 §5.6.4；审计 C');
    } else {
      fail('T23', 'null 例外要素缺失', '契约 §5.6.4', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T24：资格断言与四态
  (function () {
    const need = ['C17', 'C18', 'C19', 'C20', 'candidate_only', 'id_status', 'E11_UNEXPECTED_ELIGIBLE'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) {
      pass('T24', '资格断言已写入：无乐观值、candidate_only 当前 = 0 且 >0 即失败、四态含 id_status、id 非空 ≠ 可导入', '契约 §4.3（C17–C20）；审计 D');
    } else {
      fail('T24', '资格断言要素缺失', '契约 §4.3', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T25：派生统计六数
  (function () {
    const need = [
      '派生统计',
      '| 规划总记录数 | **564** |',
      '| 可生成草稿（A + B） | **502** |',
      '| `id = null` 的候选 | **107** |',
      '| 有正式 `dishId` 的候选 | **395** |',
      '| C 档不生成 | **62** |',
      '| 可进入 CSV 的候选 | **0** |',
      '**计算值**'
    ];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) {
      // 再验算术自洽：502 - 107 === 395，且 564 - 62 === 502
      const okMath = (502 - 107 === 395) && (564 - 62 === 502) && (419 + 145 === 564);
      if (okMath) {
        pass('T25', '派生统计六数齐全（564/502/107/395/62/0），395 标注为计算值，且 502−107=395、564−62=502、419+145=564 自洽', '契约 §6.2.1；审计 E');
      } else {
        fail('T25', '派生统计算术不自洽', '契约 §6.2.1', '502-107/564-62/419+145 校验失败');
      }
    } else {
      fail('T25', '派生统计行缺失', '契约 §6.2.1', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T26：术语清理（只校验 §5.1 的两行原文，避免命中文档里对旧措辞的引述）
  (function () {
    const staleOldId = '| `id` | string | 是 | 见 §5.6（**待决**） |';
    const staleOldStall = '| `stallId` | string | 是 | 见 §5.6（**待决**） |';
    const staleComment = 'ID 策略待决，未决时留 null';
    const fresh = CONTRACT.indexOf('**已冻结**：perShop 连续编号') !== -1 &&
                  CONTRACT.indexOf('**已冻结**：由名册位次唯一决定') !== -1;
    const stillStale = CONTRACT.indexOf(staleOldId) !== -1 ||
                       CONTRACT.indexOf(staleOldStall) !== -1 ||
                       CONTRACT.indexOf(staleComment) !== -1;
    if (!stillStale && fresh) {
      pass('T26', '§5.1 两行的「见 §5.6（待决）」与 JSON 示例里的「ID 策略待决」均已清理为已冻结表述', '契约 §5.1 + §3.2 示例；审计 F');
    } else {
      fail('T26', '§5.1 / 示例仍有过期术语', '契约 §5.1', 'stillStale=' + stillStale + ' newWording=' + fresh);
    }
  })();
})();

// ================================================================ 稳定 ID 映射语义（T27–T36）
// 说明：本段只在测试进程内验证「键 → ID」的语义契约，
//       不创建 gen_records.js、不写任何文件、不产出 records.json / id-map.json。
const REF = (function () {
  function normKeyPart(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[。，,、；;]+|[。，,、；;]+$/g, '');
  }
  function makeKey(rec) {
    return [rec.stallId || '', normKeyPart(rec.groupKey), normKeyPart(rec.specLabel), normKeyPart(rec.disambiguator)].join('|');
  }
  function indexMap(map) {
    const byKey = new Map();
    const ids = new Set();
    const errors = [];
    if (map && typeof map === 'object' && map.schemaVersion !== 1) errors.push('E15_BAD_MAP');
    const entries = (map && Array.isArray(map.entries)) ? map.entries : [];
    if (map && !Array.isArray(map.entries)) errors.push('E15_BAD_MAP');
    for (const e of entries) {
      if (!e || typeof e.key !== 'string' || !e.key) { errors.push('E15_BAD_MAP'); continue; }
      if (byKey.has(e.key)) errors.push('E14_DUP_KEY');
      if (e.dishId) { if (ids.has(e.dishId)) errors.push('E13_DUP_ID'); ids.add(e.dishId); }
      const usable = e.dishId && e.status === 'active';
      byKey.set(e.key, Object.assign({}, e, { dishId: usable ? e.dishId : null }));
    }
    return { byKey, ids, errors };
  }
  function resolve(records, map) {
    if (map === undefined) return { fatal: 'E12_NO_ID_MAP', errors: [], results: [], blockers: [], orphans: [] };
    const idx = indexMap(map);
    if (idx.errors.length) return { fatal: idx.errors[0], errors: idx.errors, results: [], blockers: [], orphans: [] };
    const groups = new Map();
    for (const r of records) {
      const k = makeKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const results = [], blockers = [];
    for (const [k, rs] of groups) {
      if (rs.length > 1) { blockers.push({ key: k, code: 'KEY_COLLISION' }); continue; }
      const hit = idx.byKey.get(k);
      if (hit && hit.dishId) {
        results.push({ key: k, dishId: hit.dishId, status: 'assigned_from_map', idStatus: 'assigned_from_map', priceChanged: hit.price !== undefined && hit.price !== rs[0].price });
      } else {
        blockers.push({ key: k, code: hit ? 'PENDING_REVIEW' : 'NEW_KEY' });
      }
    }
    const present = new Set(groups.keys());
    const orphans = [...idx.byKey.keys()].filter(k => !present.has(k));
    return { fatal: null, errors: [], results, blockers, orphans };
  }
  return { normKeyPart, makeKey, indexMap, resolve };
})();

(function stableIdMapping() {

  // ---------- T27：身份域 / 可变域
  (function () {
    const need = ['身份域', '可变域', '禁止用作身份', '`sourceLine`（物理行号', '数组下标'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T27', '身份域/可变域表已写入：price/sourceLine/下标明确禁止作为身份', '契约 §5.6.5.1');
    else fail('T27', '身份域/可变域表述缺失', '契约 §5.6.5.1', '缺=' + miss.join('、'));
  })();

  // ---------- T28：价格变化复用原 ID
  (function () {
    const key = REF.makeKey({ stallId: 'c01_t07', groupKey: '见面就好', specLabel: '', disambiguator: '' });
    const map2 = { schemaVersion: 1, entries: [{ key: key, dishId: 'c01_d040', status: 'active', price: 12 }] };
    const r = REF.resolve([{ stallId: 'c01_t07', groupKey: '见面就好', specLabel: '', disambiguator: '', price: 13 }], map2);
    const ok = r.fatal === null && r.results.length === 1 && r.results[0].dishId === 'c01_d040' && r.results[0].priceChanged === true && r.blockers.length === 0;
    if (ok) pass('T28', '价格 12→13 时复用原 dishId 且标记 priceChanged=true（键唯一时）', '契约 §5.6.5.1 + 测试侧参考语义');
    else fail('T28', '价格变化未按契约复用 ID', '契约 §5.6.5.1', JSON.stringify(r.results) + ' fatal=' + r.fatal);
  })();

  // ---------- T29：行序变化不影响 ID
  (function () {
    const A = { stallId: 'c01_t07', groupKey: '见面就好', specLabel: '', disambiguator: '' };
    const B = { stallId: 'c01_t16', groupKey: '四有青年面馆', specLabel: '小碗', disambiguator: '' };
    const C = { stallId: 'c01_t30', groupKey: '老马家·博山水饺', specLabel: '大份', disambiguator: '' };
    const map = { schemaVersion: 1, entries: [
      { key: REF.makeKey(A), dishId: 'c01_d040', status: 'active' },
      { key: REF.makeKey(B), dishId: 'c01_d070', status: 'active' },
      { key: REF.makeKey(C), dishId: 'c01_d200', status: 'active' }
    ] };
    const r1 = REF.resolve([A, B, C], map);
    const r2 = REF.resolve([C, A, B], map);
    const m1 = r1.results.map(x => x.key + '=' + x.dishId).sort().join(';');
    const m2 = r2.results.map(x => x.key + '=' + x.dishId).sort().join(';');
    if (m1 === m2 && r1.results.length === 3) pass('T29', '三种输入行序（ABC / CAB）得到完全相同的 键→ID 映射', '契约 §5.6.5.6 情形④');
    else fail('T29', '行序变化导致 ID 变化', '契约 §5.6.5.6 ④', m1 + ' vs ' + m2);
  })();

  // ---------- T30：同名同规格无消歧 → 阻塞
  (function () {
    const rec = { stallId: 'c01_t23', groupKey: '秘制红烧肉', specLabel: '', disambiguator: '' };
    const map = { schemaVersion: 1, entries: [{ key: REF.makeKey(rec), dishId: 'c01_d100', status: 'active' }] };
    const r = REF.resolve([Object.assign({}, rec, { price: 15 }), Object.assign({}, rec, { price: 16 })], map);
    const blocked = r.blockers.length === 1 && r.blockers[0].code === 'KEY_COLLISION' && r.results.length === 0;
    if (blocked) pass('T30', '同键两条记录（秘制红烧肉 15/16，无 disambiguator）→ KEY_COLLISION，不分配任何 ID', '契约 §5.6.5.4 + RECORD_AUDIT_PRECHECK:89');
    else fail('T30', '碰撞未被阻塞或错误分配了 ID', '契约 §5.6.5.4', JSON.stringify(r));
  })();

  // ---------- T31：孤儿保留
  (function () {
    const gone = { stallId: 'c01_t20', groupKey: '手抓饼', specLabel: '', disambiguator: '' };
    const live = { stallId: 'c01_t07', groupKey: '见面就好', specLabel: '', disambiguator: '' };
    const map = { schemaVersion: 1, entries: [
      { key: REF.makeKey(gone), dishId: null, status: 'orphan' },
      { key: REF.makeKey(live), dishId: 'c01_d040', status: 'active' }
    ] };
    const r = REF.resolve([live], map);
    const idx = REF.indexMap(map);
    const kept = r.orphans.length === 1 && idx.byKey.has(REF.makeKey(gone)) && map.entries.length === 2;
    if (kept) pass('T31', '当前输入缺失的键进入 orphans 且 map 条目未被删除、ID 未被复用', '契约 §5.6.5.5 + 情形⑤');
    else fail('T31', '孤儿映射被删除或被复用', '契约 §5.6.5.5', JSON.stringify(r.orphans));
  })();

  // ---------- T32：新键不自动分配
  (function () {
    const fresh = { stallId: 'c01_t01', groupKey: '七和米线', specLabel: '', disambiguator: '' };
    const r = REF.resolve([fresh], { schemaVersion: 1, entries: [] });
    const ok = r.results.length === 0 && r.blockers.length === 1 && r.blockers[0].code === 'NEW_KEY';
    if (ok) pass('T32', '未命中键 → NEW_KEY 阻塞、无 ID（不自动追加末尾号）', '契约 §5.6.5.6 情形①');
    else fail('T32', '未命中键被自动分配 ID', '契约 §5.6.5.6 ①', JSON.stringify(r));
  })();

  // ---------- T33：无 map 拒绝编号
  (function () {
    const r = REF.resolve([{ stallId: 'c01_t01', groupKey: 'x' }], undefined);
    const docOk = CONTRACT.indexOf('E12_NO_ID_MAP') !== -1 && CONTRACT.indexOf('不得开始编号') !== -1;
    if (r.fatal === 'E12_NO_ID_MAP' && docOk) pass('T33', '缺少 id-map.json ⇒ E12_NO_ID_MAP（拒绝开始编号，不生成）', '契约 §5.6.5.7 + 情形⑧');
    else fail('T33', '无 map 未拒绝编号', '契约 §5.6.5.7', 'fatal=' + r.fatal + ' docOk=' + docOk);
  })();

  // ---------- T34：重复 ID / 重复键 / 坏结构
  (function () {
    const dupId = REF.indexMap({ schemaVersion: 1, entries: [
      { key: 'a', dishId: 'c01_d040', status: 'active' },
      { key: 'b', dishId: 'c01_d040', status: 'active' }
    ] });
    const dupKey = REF.indexMap({ schemaVersion: 1, entries: [
      { key: 'a', dishId: 'c01_d040', status: 'active' },
      { key: 'a', dishId: 'c01_d041', status: 'active' }
    ] });
    const badSchema = REF.indexMap({ schemaVersion: 2, entries: [] });
    const badShape = REF.indexMap({ schemaVersion: 1, entries: {} });
    const ok = dupId.errors.indexOf('E13_DUP_ID') !== -1 &&
               dupKey.errors.indexOf('E14_DUP_KEY') !== -1 &&
               badSchema.errors.indexOf('E15_BAD_MAP') !== -1 &&
               badShape.errors.indexOf('E15_BAD_MAP') !== -1;
    if (ok) pass('T34', '重复 ID→E13_DUP_ID、重复键→E14_DUP_KEY、版本/结构非法→E15_BAD_MAP，均显式失败', '契约 §5.6.5.6 情形⑨');
    else fail('T34', '非法映射未产生明确失败码', '契约 §5.6.5.6 ⑨', JSON.stringify({ dupId: dupId.errors, dupKey: dupKey.errors, badSchema: badSchema.errors, badShape: badShape.errors }));
  })();

  // ---------- T35：id 非空 ≠ 可导入
  (function () {
    const need = ['`id` 非空 **不得**用于推断 `import_eligibility`', 'C20', '当前 395 条有 `dishId`、仍全为 `blocked`'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T35', 'id 非空不等于可导入（C20 不退让，395 条有 id 仍 blocked）', '契约 §4.3 C20');
    else fail('T35', 'id≠可导入的约束缺失', '契约 §4.3 C20', '缺=' + miss.join('、'));
  })();

  // ---------- T36：语义确定性 vs 字节确定性
  (function () {
    const need = ['语义确定性', '文件字节确定性', 'generatedAt', '剔除', '按 `key` 字典序排序'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T36', 'generatedAt 不参与身份；语义确定性（被断言）与文件字节确定性（需剔除时间戳并排序）分开表述', '契约 §5.6.5.5');
    else fail('T36', '确定性表述缺失', '契约 §5.6.5.5', '缺=' + miss.join('、'));
  })();
})();

// ================================================================ D1–D4 裁决落地（T37–T46）
// 测试分层声明（与契约 §9.2 一致，禁止混写）：
//   L-A 契约静态断言：只读文档文本，结论只能说「契约已写明 X」；
//   L-B 纯函数参考语义：用测试侧 REF 验证「键→ID」语义，不落盘、不导出、不等于生成器；
//   L-C 待实现（PENDING）：依赖 records.json / gen_records.js / id-map.json，本轮不转 PASS。
(function approvedDecisions() {

  // ---------- T37：D1 gen 块 + CSV 白名单
  (function () {
    const need = ['#### 5.3.1 CSV 导出字段白名单', '明令禁止导出', '`gen`（整块）', '不得自动导出',
                  'dish_id, dish_name, record_type, shop_id, stall_id, price, food_type,'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    const block = (CONTRACT.split('#### 5.3.1')[1] || '').split('```')[1] || '';
    const cols = block.replace(/\n/g, ' ').split(',').map(s => s.trim()).filter(Boolean);
    if (miss.length === 0 && cols.length === 14) {
      pass('T37', 'D1 落地：gen 块随 records.json 输出 + CSV 白名单恰 14 列、内部字段明令禁出', '契约 §5.3 / §5.3.1');
    } else {
      fail('T37', 'D1 落地不完整', '契约 §5.3 / §5.3.1', '缺=' + miss.join('、') + ' 列数=' + cols.length);
    }
  })();

  // ---------- T38：D2 十阶段（Q6-1 新增 S9/S10）+ 不保证事务原子性
  (function () {
    const need = ['#### 7.2.1 十个阶段', 'S1 临时生成', 'S6 发布前目标检查', 'S7 单次 rename', 'S8 发布后自检',
                  'S9 清除标记', 'S10 清除后复核',
                  '不保证多文件整体事务原子性', '连续三次单文件 rename'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T38', 'D2 落地：写出分 S1–S10 十阶段（含 Q6-1 的 S9/S10），并显式否认「多文件整体事务原子性」', '契约 §7.2.1 / §7.2.2');
    else fail('T38', 'D2 阶段或否认性表述缺失', '契约 §7.2.1 / §7.2.2', '缺=' + miss.join('、'));
  })();

  // ---------- T39：D2 EXDEV 不退化 + 发布标记（静态部分；运行时属 L-C）
  (function () {
    const need = ['不得退化为逐文件拷贝', '禁止**「先复制再删源」', 'PUBLISHING', 'E17_INCOMPLETE_PUBLISH',
                  '若无法建在同卷'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T39', 'D2 落地：EXDEV 直接失败不降级；用 PUBLISHING 标记 + E17 识别不完整发布（静态）', '契约 §7.2.3 / §7.2.4');
    else fail('T39', 'EXDEV 或发布标记规则缺失', '契约 §7.2.3 / §7.2.4', '缺=' + miss.join('、'));
  })();

  // ---------- T40：D3 首版不读 3F 名册
  (function () {
    const need = ['首版生成器不得读取独立的 3F 档口名册', '位置证据不足', '位置已核实', '≠'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    const triple = CONTRACT.indexOf('存在 ID 候选') !== -1;
    if (miss.length === 0 && triple) pass('T40', 'D3 落地：首版不读 3F 名册；候选 ID ≠ 位置已核实 ≠ 可导入（三态分离）', '契约 §2.1 / §5.6.5.9');
    else fail('T40', 'D3 输入范围或三态分离缺失', '契约 §2.1 / §5.6.5.9', '缺=' + miss.join('、') + ' triple=' + triple);
  })();

  // ---------- T41：D4 初始化计划九项
  (function () {
    const seg = CONTRACT.split('##### 5.6.5.8')[1] || '';
    const need = ['计划必须展示以下九项', '不得创建', 'id-map.json', '不等于', '批准 CSV 导入', '批准云端写入'];
    const miss = need.filter(k => seg.indexOf(k) === -1);
    const rows = (seg.split('| # | 计划必须展示的内容 |')[1] || '').split('###')[0].split('\n').filter(l => /^\|\s*\d\s*\|/.test(l.trim()));
    if (miss.length === 0 && rows.length === 9) pass('T41', 'D4 落地：初始化计划九项齐全、计划不得创建 id-map.json、批准初始化≠批准导入/写云', '契约 §5.6.5.8');
    else fail('T41', 'D4 落地不完整', '契约 §5.6.5.8', '缺=' + miss.join('、') + ' 行数=' + rows.length);
  })();

  // ---------- T42：A 审批留痕七字段为建议（2026-10-24：存储位置已冻结，但「无既存系统」的否认性声明必须保留）
  (function () {
    const seg = CONTRACT.split('##### 5.6.5.8')[1] || '';
    const need = ['approvalId', 'approvedRole', 'approvedAt', 'planDigest', 'mapVersion', 'scope', 'result',
                  '**不存在**任何审批系统，也**没有**任何既存审批记录'];
    const miss = need.filter(k => seg.indexOf(k) === -1);
    if (miss.length === 0) pass('T42', 'A 落地：审批留痕七字段齐全，且仍声明当前不存在任何审批系统与既存审批记录', '契约 §5.6.5.8');
    else fail('T42', '审批留痕或否认性声明缺失', '契约 §5.6.5.8', '缺=' + miss.join('、'));
  })();

  // ---------- T43：B 价格不得建立 disambiguator
  (function () {
    const seg = CONTRACT.split('##### 5.6.5.9')[1] || '';
    const need = ['W2-03', '继续阻塞', 'KEY_COLLISION', '排列顺序或模型推断', '低价=小份'];
    const miss = need.filter(k => seg.indexOf(k) === -1);
    if (miss.length === 0) pass('T43', 'B 落地：仅凭价格不得建立身份，W2-03 三组继续 KEY_COLLISION 阻塞', '契约 §5.6.5.9');
    else fail('T43', 'B 的证据门槛缺失', '契约 §5.6.5.9', '缺=' + miss.join('、'));
  })();

  // ---------- T44：C 3F 酸菜肉丝面 有条件
  (function () {
    const seg = CONTRACT.split('##### 5.6.5.9')[1] || '';
    const struck = seg.indexOf('~~`3F` 酸菜肉丝面 9 / 12~~') !== -1;
      const fixed = seg.indexOf('已更正：不是碰撞') !== -1 && seg.indexOf('撤销阻塞') !== -1 && seg.indexOf('5.6.5.9.1') !== -1;
      if (struck && fixed) pass('T44', 'C 已更正：3F 酸菜肉丝面 9/12 属跨档口，撤销阻塞并指向 §5.6.5.9.1', '契约 §5.6.5.9');
      else fail('T44', 'C 的更正记录缺失（旧「有条件」写法应已划掉）', '契约 §5.6.5.9', 'struck=' + struck + ' fixed=' + fixed);
  })();

  // ---------- T45：D 缺失 vs 损坏诊断不同 + 确定性排序 + 时间戳不影响语义（L-A + L-B）
  (function () {
    const need = ['`E12_NO_ID_MAP`', '`E15_BAD_MAP`', '按 `key` 字典序排序', '不参与身份判断'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    const e1 = { schemaVersion: 1, generatedAt: 'A', entries: [
      { key: 'b', dishId: 'c01_d041', status: 'active' },
      { key: 'a', dishId: 'c01_d040', status: 'active' }] };
    const e2 = { schemaVersion: 1, generatedAt: 'B', entries: [
      { key: 'a', dishId: 'c01_d040', status: 'active' },
      { key: 'b', dishId: 'c01_d041', status: 'active' }] };
    const m1 = [...REF.indexMap(e1).byKey.entries()].map(([k, v]) => k + '=' + v.dishId).sort().join(';');
    const m2 = [...REF.indexMap(e2).byKey.entries()].map(([k, v]) => k + '=' + v.dishId).sort().join(';');
    if (miss.length === 0 && m1 === m2) pass('T45', 'D 落地：缺失(E12)与损坏(E15)诊断不同；条目顺序与 generatedAt 不影响语义映射', '契约 §5.6.5.5 / §5.6.5.6 + REF');
    else fail('T45', 'D 的诊断区分或确定性表述缺失', '契约 §5.6.5.5 / §5.6.5.6', '缺=' + miss.join('、') + ' 语义一致=' + (m1 === m2));
  })();

  // ---------- T46：测试分层声明
  (function () {
    const need = ['L-A 契约静态断言', 'L-B 纯函数参考语义', 'L-C 待实现（PENDING）', 'T39b', 'T45b'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T46', '测试三层分类已在契约 §9.2 声明，且本轮未新增 PENDING 以求绿', '契约 §9.2');
    else fail('T46', '测试分层声明缺失', '契约 §9.2', '缺=' + miss.join('、'));
  })();
})();

// ================================================================ 第三轮裁决收尾（T47–T52，全部 L-A）
(function roundThreeWrapUp() {
  function has(s) { return CONTRACT.indexOf(s) !== -1; }

  // ---------- T47：A 旁路审批记录
  (function () {
    const need = [
      "5.6.5.8.1 旁路审批记录",
      "tools/pilot/approvals/<approvalId>.json",
      "approvalId", "approvedRole", "approvedAt", "planDigest", "mapVersion", "result", "scope",
      "approvalRef", "W_APPROVAL_REF_MISSING",
      "本轮未创建该目录，也未创建任何审批文件",
      "不得虚构"
    ];
    const miss = need.filter(function (k) { return !has(k); });
    const dirExists = fs.existsSync(path.join(ROOT, "tools", "pilot", "approvals"));
    if (miss.length === 0 && !dirExists) {
      pass("T47", "A 冻结：旁路审批记录 7 必填字段 + 路径/命名 + id-map 只存引用；项目内确实不存在 approvals 目录", "契约 §5.6.5.8.1");
    } else {
      fail("T47", "A 的旁路审批记录规则缺失或误建目录", "契约 §5.6.5.8.1", "缺=" + miss.join("、") + " 目录存在=" + dirExists);
    }
  })();

  // ---------- T48：B 规范化策略 + rawGroupKey 永久保留
  (function () {
    const need = ["NFKC", "连续空白折叠为单个空格", "rawGroupKey", "永久保留",
      "同义词归并", "括注", "价格或输入行号", "丢弃原始证据"];
    const miss = need.filter(function (k) { return !has(k); });
    if (miss.length === 0) pass("T48", "B 冻结：规范化策略不变、rawGroupKey 永久保留、四条禁令齐全", "契约 §5.6.5.2");
    else fail("T48", "B 的规范化/保留规则缺失", "契约 §5.6.5.2", "缺=" + miss.join("、"));
  })();

  // ---------- T49：C lastSeenAt 仅审计 + 规范化比较视图
  (function () {
    const need = ["lastSeenAt", "只作审计", "不参与身份键", "不参与 ID 分配",
      "语义一致性比较", "规范化视图", "剔除全部时间字段", "UTF-16 code unit",
      "表述纪律", "原始 JSON 文件字节完全一致", "语义一致"];
    const miss = need.filter(function (k) { return !has(k); });
    if (miss.length === 0) pass("T49", "C 冻结：lastSeenAt 只作审计；一致性只比较规范化视图，禁止称原始字节一致", "契约 §5.6.5.5.1");
    else fail("T49", "C 的时间戳/视图规则缺失", "契约 §5.6.5.5.1", "缺=" + miss.join("、"));
  })();

  // ---------- T50：D 禁止 P2 降级
  (function () {
    const need = ["P1 是唯一允许的正式写出策略", "报告并停止", "而不是降级",
      "E17_INCOMPLETE_PUBLISH", "PUBLISHING", "EXDEV"];
    const miss = need.filter(function (k) { return !has(k); });
    const bad = ["允许降级到 P2", "可以改用 P2", "失败后自动改为复制"];
    const hit = bad.filter(function (k) { return has(k); });
    if (miss.length === 0 && hit.length === 0) pass("T50", "D 冻结：P1 唯一、失败即报告停止；文档不含任何允许降级的表述", "契约 §7.2.2 / §10.2");
    else fail("T50", "D 的禁止降级规则缺失或被削弱", "契约 §7.2.2", "缺=" + miss.join("、") + " 出现降级表述=" + hit.join("、"));
  })();

  // ---------- T51：E W2-03 四项核实 + 无证据继续阻塞
  (function () {
    const need = ["四项逐条核实要求", "唯一", "相互矛盾", "可追溯", "KEY_COLLISION",
      "排列顺序或模型推断"];
    const miss = need.filter(function (k) { return !has(k); });
    if (miss.length === 0) pass("T51", "E 冻结：W2-03 需四项核实，证据不足继续 KEY_COLLISION，禁止凭价格/顺序/推断消歧", "契约 §5.6.5.9");
    else fail("T51", "E 的核实要求缺失", "契约 §5.6.5.9", "缺=" + miss.join("、"));
  })();

  // ---------- T52：F 更正记录 + 不虚构系列键
  (function () {
    const need = ["5.6.5.9.1 更正记录", "撤销阻塞", ":271", ":397", "W07 辣肉面", "W10 吴可心",
      "档口不同"];
    const miss = need.filter(function (k) { return !has(k); });
    const bad = ["酸菜肉丝面（汤面）", "酸菜肉丝面（拌面）"];
    const hit = bad.filter(function (k) { return has(k); });
    if (miss.length === 0 && hit.length === 0) pass("T52", "F 冻结：酸菜肉丝面 9/12 已更正为跨档口非碰撞，且未虚构系列键", "契约 §5.6.5.9.1");
    else fail("T52", "F 的更正记录缺失或虚构了系列键", "契约 §5.6.5.9.1", "缺=" + miss.join("、") + " 虚构=" + hit.join("、"));
  })();
})();

// ================================================================ 审批机制冻结（T53–T61，用户 A1–A5，全部 L-A）
(function roundFourApprovalFreeze() {
  const P = {
    approvals: path.join(ROOT, 'tools', 'pilot', 'approvals'),
    idMap: path.join(ROOT, 'tools', 'pilot', 'id-map.json'),
    gen: path.join(ROOT, 'tools', 'pilot', 'gen_records.js'),
    records: path.join(ROOT, 'tools', 'pilot', 'records.json'),
    blockers: path.join(ROOT, 'tools', 'pilot', 'records_blockers.json'),
    manifest: path.join(ROOT, 'tools', 'pilot', 'gen-manifest.json')
  };
  function has(s) { return CONTRACT.indexOf(s) !== -1; }
  function need(keys) { return keys.filter(function (k) { return !has(k); }); }

  // ---------- T53：A1 唯一批准人身份标识
  (function () {
    const miss = need(['唯一最终批准人是**项目负责人本人**', '批准人身份标识固定为 `项目负责人`',
      '唯一允许值 `项目负责人`']);
    if (miss.length === 0) {
      pass('T53', 'A1 冻结：唯一批准人是项目负责人本人，approvedRole 唯一允许值 `项目负责人`', '契约 §5.6.5.8.2 A1 / §5.6.5.8.1');
    } else {
      fail('T53', 'A1 的唯一批准人与身份标识未冻结', '契约 §5.6.5.8.2 A1', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T54：A1 DS/ChatGPT 无权批准、不设代理、不得推定
  (function () {
    const miss = need(['**DeepSeek（DS）是执行者**', '不得自行批准',
      '**ChatGPT 是技术审查者**', '无权代替负责人批准',
      '不设默认代理批准人', '不得推定批准']);
    const bad = ['DS 可以自行批准', 'ChatGPT 可以批准', '默认由 DS 代理批准'];
    const hit = bad.filter(function (k) { return has(k); });
    if (miss.length === 0 && hit.length === 0) {
      pass('T54', 'A1 冻结：DS 只能执行、ChatGPT 只能审查、无代理批准人、禁止推定批准', '契约 §5.6.5.8.2 A1');
    } else {
      fail('T54', 'A1 的越权/推定禁令缺失', '契约 §5.6.5.8.2 A1', '缺=' + miss.join('、') + ' 出现越权表述=' + hit.join('、'));
    }
  })();

  // ---------- T55：A2 授权范围仅 id-map.json 初始化
  (function () {
    const miss = need(['初始化批准**只**覆盖「创建 `id-map.json` 的初始映射」这一件事',
      '不得把初始化批准扩大解释']);
    if (miss.length === 0) {
      pass('T55', 'A2 冻结：授权范围仅 id-map.json 初始化，且禁止扩大解释', '契约 §5.6.5.8.2 A2');
    } else {
      fail('T55', 'A2 的授权范围表述缺失', '契约 §5.6.5.8.2 A2', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T56：A2 七项「不包含」
  (function () {
    const rows = ['实现或修改生成器', '生成任何正式产物', '分配、重编号或覆盖正式 ID',
      '重编或修改任何 CSV', '修改 `data/` `pages/` `utils/` `cloudfunctions/` `config/`',
      '导入数据、访问或修改云端、部署、改权限', '任何 Git 写操作'];
    const miss = rows.filter(function (k) { return !has(k); });
    const arts = ['`records.json` / `records_blockers.json` / `gen-manifest.json`',
      '`tools/pilot/gen_records.js` 仍需单独授权'];
    const miss2 = arts.filter(function (k) { return !has(k); });
    if (miss.length === 0 && miss2.length === 0) {
      pass('T56', 'A2 冻结：初始化批准不含生成器/产物/正式 ID/CSV/业务代码/云端/部署/Git 写（七项齐全）', '契约 §5.6.5.8.2 A2');
    } else {
      fail('T56', 'A2 的「不包含」清单不完整', '契约 §5.6.5.8.2 A2', '缺=' + miss.concat(miss2).join('、'));
    }
  })();

  // ---------- T57：A3 计划绑定与重新审批
  (function () {
    const miss = need(['执行前必须先生成**独立的初始化计划**', '`planDigest`（sha256 小写 hex）',
      '**计划发生实质变化 → 原批准不得沿用**', '一般性表述不构成批准',
      '`继续`', '`检查一下`', '`按你的想法来`']);
    if (miss.length === 0) {
      pass('T57', 'A3 冻结：审批绑定 planDigest、实质变更须重新审批、一般性表述不构成批准', '契约 §5.6.5.8.2 A3');
    } else {
      fail('T57', 'A3 的计划绑定规则缺失', '契约 §5.6.5.8.2 A3', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T58：A4 缺失只报 W_APPROVAL_REF_MISSING
  (function () {
    const miss = need(['`W_APPROVAL_REF_MISSING`', '不改变', '映射本身的有效性']);
    if (miss.length === 0) {
      pass('T58', 'A4 冻结：审批记录缺失只报 W_APPROVAL_REF_MISSING，不改变映射有效性', '契约 §5.6.5.8.2 A4 / §5.6.5.8.1');
    } else {
      fail('T58', 'A4 的缺失处理规则缺失', '契约 §5.6.5.8.2 A4', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T59：A4 禁止伪造/补造/推定
  (function () {
    const miss = need(['**不得**伪造记录、补造批准时间或推定已获批准']);
    const also = ['不创建**示例文件', '不声称已有审批系统'];
    const miss2 = also.filter(function (k) { return !has(k); });
    if (miss.length === 0 && miss2.length === 0) {
      pass('T59', 'A4 冻结：禁止伪造审批记录、补造时间、推定已批准或声称已有审批系统', '契约 §5.6.5.8.2 A4 / §5.6.5.8.1');
    } else {
      fail('T59', 'A4 的防伪造表述缺失', '契约 §5.6.5.8.2 A4', '缺=' + miss.concat(miss2).join('、'));
    }
  })();

  // ---------- T60：A5 执行保护
  (function () {
    const miss = need(['`id-map.json` 已存在 → **停止**', '不覆盖、不重建',
      '候选 ID ≠ 位置已核实 ≠ 可导入', '**不得**解除 `KEY_COLLISION`',
      '不得**降级写出策略', 'P1 仍是唯一允许的正式写出策略']);
    if (miss.length === 0) {
      pass('T60', 'A5 冻结：已存在即停止、候选≠核实≠可导入、不解除证据阻塞、失败不降级（P1 唯一）', '契约 §5.6.5.8.2 A5');
    } else {
      fail('T60', 'A5 的执行保护规则缺失', '契约 §5.6.5.8.2 A5', '缺=' + miss.join('、'));
    }
  })();

  // ---------- T61：真实磁盘检查（六者均不存在）
  (function () {
    const paths = [
      ['approvals 目录', P.approvals],
      ['id-map.json', P.idMap],
      ['gen_records.js', P.gen],
      ['records.json', P.records],
      ['records_blockers.json', P.blockers],
      ['gen-manifest.json', P.manifest]
    ];
    const exists = paths.filter(function (it) { return fs.existsSync(it[1]); }).map(function (it) { return it[0]; });
    if (exists.length === 0) {
      pass('T61', 'A4/A5 边界：磁盘实测 approvals 目录与五类产物均不存在（规则冻结未产生任何文件）', '磁盘实测（fs.existsSync）');
    } else {
      fail('T61', '本轮不应创建任何审批目录或产物文件', '磁盘实测（fs.existsSync）', '实际存在=' + exists.join('、'));
    }
  })();
})();
(function runtimeBranches() {
  pending('T39b', 'PUBLISHING 标记与 E17_INCOMPLETE_PUBLISH 的运行时行为（需真实写出实现）', '契约 §7.2.3', '生成器未实现');
  pending('T45b', 'E12（映射缺失）与 E15（映射损坏）在真实加载路径上的分支（需真实加载器）', '契约 §5.6.5.6', '生成器未实现');
})();

// ================================================================ 生成器依赖项
(function generatorChecks() {
  const genExists = fs.existsSync(P.gen);
  const recExists = fs.existsSync(P.records);
  if (!genExists) {
    pending('G1', '生成器存在性：tools/pilot/gen_records.js 尚未实现（预期待实现）', 'tools/pilot/gen_records.js', '文件不存在');
  } else {
    try {
      const mod = require(P.gen);
      if (mod && typeof mod.generate === 'function') pass('G1', '生成器导出 generate()', 'tools/pilot/gen_records.js');
      else fail('G1', '生成器导出 generate()', 'tools/pilot/gen_records.js', '导出缺失');
    } catch (e) {
      fail('G1', '生成器可被 require 且不抛错', 'tools/pilot/gen_records.js', 'require 抛错：' + e.message);
    }
  }
  if (!recExists) {
    pending('G2', '产物层断言：records.json 三类判定与 A/B/C 过滤（待生成器实现后启用）', 'tools/pilot/records.json', '文件不存在');
  } else {
    try {
      const recs = JSON.parse(fs.readFileSync(P.records, 'utf8'));
      const list = Array.isArray(recs) ? recs : (recs.records || []);
      const badMeta = list.filter(r => r.verifyStatus !== 'unverified' || r.verifiedAt !== null);
      if (badMeta.length === 0) pass('G2', '产物全部 unverified / verifiedAt=null', 'tools/pilot/records.json', list.length + ' 条');
      else fail('G2', '产物全部 unverified / verifiedAt=null', 'tools/pilot/records.json', badMeta.length + ' 条不符');
    } catch (e) {
      fail('G2', 'records.json 可解析', 'tools/pilot/records.json', e.message);
    }
  }
})();

// ---------------------------------------------------------------- Q6 发布协议（Q6-1…Q6-7，2026-10-24 裁决）
// 说明：本组除 T63b / T64b / T68b 为运行时（L-C，只能报 PENDING）外，其余全部为 L-A 契约静态断言。
// 纪律：静态命中只证明「规则写在文件里」，不证明生成器执行时遵守。
(function q6PublishProtocol() {
  const c = CONTRACT;

  if (/S9 清除标记/.test(c) && /S10 清除后复核/.test(c) && /十个阶段/.test(c)) {
    pass('T62', 'Q6-1/Q6-3：新增 S9 清除、S10 复核，阶段总数为十', '§7.2.1');
  } else {
    fail('T62', '契约含 S9/S10 且标题改写为十阶段', '§7.2.1', '缺阶段行或标题未同步');
  }

  if (/清除动作（Q6-1=A）/.test(c) && /S8 通过之后/.test(c) && /删除目标目录内的 `PUBLISHING`/.test(c)) {
    pass('T63', 'Q6-1=A：清除动作绑定在 S8 通过之后，删除对象为目标目录内标记', '§7.2.3');
  } else {
    fail('T63', '清除动作条款完整', '§7.2.3', '未命中「清除动作（Q6-1=A）」或删除对象');
  }
  pending('T63b', 'Q6-1=A 运行时：清除后目标目录不再含标记', 'tools/pilot/gen_records.js', '生成器未实现');

  if (/E18_MARKER_CLEAR_FAILED/.test(c) && /按\*\*整体失败\*\*处理（Q6-2=A）/.test(c)) {
    pass('T64', 'Q6-2=A：清除失败归整体失败，诊断标识 E18 存在', '§7.2.3 / §7.2.5');
  } else {
    fail('T64', '清除失败归整体失败 + E18 标识', '§7.2.3 / §7.2.5', '缺少归类句或标识');
  }
  pending('T64b', 'Q6-2=A 运行时：清除失败时不产生成功结果', 'tools/pilot/gen_records.js', '生成器未实现');

  if (/E19_MARKER_STILL_PRESENT/.test(c) && /\*\*S10 复核失败\*\*/.test(c)) {
    pass('T65', 'Q6-3=A：S10 复核失败归整体失败，诊断标识 E19 存在', '§7.2.1 / §7.2.5');
  } else {
    fail('T65', 'S10 失败条款 + E19 标识', '§7.2.1 / §7.2.5', '缺少条款或标识');
  }

  if (/读侧\*\*不增加\*\*来源或批次校验（\*\*Q6-6=A\*\*）/.test(c) && /有意接受的边界/.test(c)) {
    pass('T66', 'Q6-6=A：读侧不增加来源/批次校验，并声明为有意接受的边界', '§7.2.3');
  } else {
    fail('T66', '读侧边界与「不增加校验」条款', '§7.2.3', '缺少声明或缺「有意接受的边界」');
  }

  const has727 = /#### 7\.2\.7 修复路径（按失败类型，/.test(c);
  const hasMarkerRow = /S9 清除失败（`E18`）/.test(c) && /S10 复核失败（`E19`）/.test(c);
  const hasP3b = /人工移除整个目录后重跑（\*\*P-3=\(b\)\*\*）/.test(c);
  if (has727 && hasMarkerRow && hasP3b) {
    pass('T67', 'Q6-7=D：修复路径按失败类型分列，且覆盖 PUBLISHING 残留（P-3=(b)）', '§7.2.7');
  } else {
    fail('T67', '§7.2.7 失败类型表覆盖标记残留', '§7.2.7', '缺章节/缺标记行/缺 P-3=(b) 之一');
  }

  const fiveFields = ['schemaVersion', 'counts', 'recordsSha256', 'blockersSha256', 'publishedAt'];
  const f6 = c.indexOf('6. 每次运行都会在 `gen-manifest.json` 写入');
  const seg6 = f6 >= 0 ? c.slice(f6, f6 + 700) : '';
  const allFive = fiveFields.every(k => seg6.indexOf(k) >= 0);
  const noExtra = /任何额外字段一律判错/.test(seg6) && /additionalProperties = false/.test(seg6);
  if (allFive && noExtra) {
    pass('T68', 'Q6-5=C：manifest 恰好 5 个字段 + 额外字段一律判错', '§7.2.2');
  } else {
    fail('T68', 'manifest 五字段与严格档条款', '§7.2.2', '字段不全或缺少 additionalProperties=false');
  }
  pending('T68b', 'Q6-5=C 运行时：产物 manifest 恰含 5 字段且拒绝额外字段', 'tools/pilot/records.json', '生成器未实现');

  const twoCases = /情形一·外部并发创建/.test(c) && /情形二·`rename` 本身失败/.test(c);
  const actualReport = /按本次运行的实际结果报告/.test(c);
  // 纪律：只在 §7.2.5 的「S7 失败」语义段内做负向检查——该段允许出现「不得无条件声称『目标一定不存在』」这类否认语境；
  //       禁止的是把绝对断言当事实写死。扫描范围收窄到本段，避免命中 §9.1 测试表对本条自身的描述。
  const segStart = c.indexOf('情形一·外部并发创建');
  const segEnd = c.indexOf('### 7.3 不得伪装成功');
  const seg = (segStart >= 0 && segEnd > segStart) ? c.slice(segStart, segEnd) : '';
  const stripped = seg.split('不得无条件声称「目标一定不存在」').join('');
  const noAbsClaim = seg.length > 0 && !/目标一定不存在/.test(stripped);
  if (twoCases && actualReport && noAbsClaim) {
    pass('T69', 'Q6-4=D：S7 失败拆两条，且不断言目标一定不存在', '§7.2.5');
  } else {
    fail('T69', 'S7 失败两情形 + 不绝对断言', '§7.2.5', '缺情形/缺「按实际结果报告」/出现绝对断言');
  }

  const q6All = ['Q6-1', 'Q6-2', 'Q6-3', 'Q6-4', 'Q6-5', 'Q6-6', 'Q6-7'].every(k => /### 10.6 Q6 发布协议裁决/.test(c) && c.indexOf(k) >= 0);
  const dex = /D-EXIT/.test(c) && /尚未规定 S8 失败的具体数值/.test(c);
  // E2-1 强化：不能只验证「S8 未定义」这一处正确措辞，还要验证同一条款的退出码事实与禁述项。
  const d61s = c.indexOf('#### 10.6.1 待决 `D-EXIT`');
  const d61e = c.indexOf('## 十一、边界声明与工作区');
  const d61 = (d61s >= 0 && d61e > d61s) ? c.slice(d61s, d61e) : '';
  const factNeed = ['S1＝`3`', 'S2＝校验类 `1`／IO 类 `3`', 'S3／S4 沿用 S2 的分类口径', 'S6＝`3`',
                    '§7.3 非空 `violations`＝`1`', 'E1 输入不可读＝`1`',
                    'S5、S7、S8、S9、S10 与 `--out` 失败'];
  const factMiss = factNeed.filter(k => d61.indexOf(k) < 0);
  const factForbidden = ['只为 S1–S5 规定', '为 `--out` 规定 `2`', 'S6–S8 只写'].filter(k => d61.indexOf(k) >= 0);
  if (q6All && dex && d61.length > 0 && factMiss.length === 0 && factForbidden.length === 0) {
    pass('T70', 'Q6 七项裁决 + D-EXIT 已登记，且退出码事实正确（S6=3 已定义、未定义项逐个列明、无虚构 `2`）', '§10.6 / §10.6.1');
  } else {
    fail('T70', '§10.6 登记与退出码事实', '§10.6 / §10.6.1',
         '缺事实=' + factMiss.join('、') + '；禁述项命中=' + factForbidden.join('、') + '；段落长度=' + d61.length);
  }
})();

// ---------------------------------------------------------------- 输出

const order = { FAIL: 0, PENDING: 1, PASS: 2 };
results.sort((a, b) => (order[a.status] - order[b.status]) || a.id.localeCompare(b.id));

console.log('记录级生成规格断言（不实现生成器）');
console.log('依据：2F/3F 转述稿、生成方案、审计报告\n');
for (const r of results) {
  const mark = r.status === 'PASS' ? 'PASS   ' : (r.status === 'FAIL' ? 'FAIL   ' : 'PENDING');
  console.log(mark + ' [' + r.id + '] ' + r.rule);
  console.log('        源：' + r.source + (r.note ? '｜' + r.note : ''));
}

const n = { PASS: 0, FAIL: 0, PENDING: 0 };
results.forEach(r => n[r.status]++);
console.log('\n汇总：通过 ' + n.PASS + ' / 失败 ' + n.FAIL + ' / 待实现 ' + n.PENDING);
if (n.PENDING) console.log('说明：待实现项依赖 records.json（生成器尚未实现），属预期失败，不计入失败。');
console.log(n.FAIL ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(n.FAIL ? 1 : 0);
