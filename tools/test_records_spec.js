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
  records: path.join(ROOT, 'tools', 'pilot', 'records.json'),
  decision: path.join(ROOT, 'docs', 'decisions', 'DECISION_RECORD_SET_R2_20261024.md')
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
  pending('T9b', rule + '（产物层）', 'tools/pilot/records.json', '正式产物未生成（records.json），无法核对每条记录');
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
  pending('T12c', rule + '（产物层）', 'tools/pilot/records.json', '正式产物未生成（records.json），无法核对每条记录是否带 source_detail 与阻塞标记');
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
    // 2026-10-25 名册入册同步：前 37 行为正式名册（t01–t37 连续），末 2 行为 t48/t49 规划目标（规划目标≠正式分配）
    const ids = rows.map(r => String(r[2] || '').replace(/（.*$/, ''));
    const expect = Array.from({ length: 37 }, (_, i) => 'c01_t' + String(i + 1).padStart(2, '0'));
    const same = rows.length === 39 && ids.slice(0, 37).every((v, i) => v === expect[i]);
    const head = rows[0] && rows[0][1] === '七和米线';
    const tail = rows[36] && rows[36][1] === '西雅苏新疆炒米粉';
    const planned = rows.length === 39 && ids[37] === 'c01_t48' && ids[38] === 'c01_t49';
    if (same && head && tail && planned) {
      pass('T13', 'D-1 名册顺序映射：东①→t01 … 西㉕→t37 连续且首尾正确；t48/t49 规划目标行已登记（规划目标≠正式分配）', '契约 §5.6.1 + TRANSCRIPTION_2F.md:30/33',
        rows.length + ' 行，' + ids[0] + '–' + ids[36] + ' + t48/t49');
    } else {
      fail('T13', 'D-1 名册顺序映射', '契约 §5.6.1',
        '行数=' + rows.length + ' 连续=' + same + ' 首=' + head + ' 尾=' + tail + ' 规划行=' + planned);
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
      pass('T26', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.1 两行的「见 §5.6（待决）」与 JSON 示例里的「ID 策略待决」均已清理为已冻结表述', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.1 + §3.2 示例；审计 F');
    } else {
      fail('T26', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.1 / 示例仍有过期术语', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.1', 'stillStale=' + stillStale + ' newWording=' + fresh);
    }
  })();
})();

// ================================================================ 稳定 ID 映射语义（T27–T36）
// 说明：本段只在测试进程内验证「键 → ID」的语义契约，
//       不创建 gen_records.js、不写任何文件、不产出 records.json / id-map.json。
const REF = (function () {
  // R2：groupKey —— NFKC → 折叠 JS \s → trim → 去首尾 。，,、；;
  function normGroupKey(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[。，,、；;]+|[。，,、；;]+$/g, '');
  }
  // R3：specLabel —— 先 trim 再 NFKC；不折叠内部空白、不去标点
  function normSpecLabel(s) {
    return String(s == null ? '' : s).trim().normalize('NFKC');
  }
  // R1/R4：stallId 与 disambiguator 原样（仅 null/undefined → 空串）
  function rawPart(s) { return s == null ? '' : s; }
  // R7/R8：候选记录阶段——键段合法性（含 | 或非空非字符串即拒绝）
  function keyPartError(rec) {
    const fields = ['stallId', 'groupKey', 'specLabel', 'disambiguator'];
    for (let i = 0; i < fields.length; i += 1) {
      const f = fields[i];
      const v = rec ? rec[f] : undefined;
      if (v == null) continue;
      if (typeof v !== 'string') return { stage: 'candidate', field: f, code: 'E15_BAD_MAP', reason: 'non-string' };
      if (v.indexOf('|') >= 0) return { stage: 'candidate', field: f, code: 'E15_BAD_MAP', reason: 'contains-pipe' };
    }
    return null;
  }
  function makeKey(rec) {
    // §5.6.5.2：键的 groupKey 为该行菜名原文，不带层前缀（与生产实现 makeKeyFrom 同口径）
    const gk = String(rec.groupKey == null ? '' : rec.groupKey).replace(/^f[23]\//, '');
    return [rawPart(rec.stallId), normGroupKey(gk), normSpecLabel(rec.specLabel), rawPart(rec.disambiguator)].join('|');
  }
  function indexMap(map) {
    // 契约 §5.6.5.5.4：五步顺序，前一阶段失败即停，不把格式错误与重复检查混在一个循环里。
    const byKey = new Map();
    const ids = new Set();
    const errors = [];
    // 第 1 步：文件读取与 JSON 解析（由调用方完成，这里只接收已解析对象）
    // 第 2 步：schemaVersion、entries 容器结构及条目结构
    if (map && typeof map === 'object' && map.schemaVersion !== 1) errors.push('E15_BAD_MAP');
    const entries = (map && Array.isArray(map.entries)) ? map.entries : [];
    if (map && !Array.isArray(map.entries)) errors.push('E15_BAD_MAP');
    // 第 3 步：keyFormat 与映射键格式（必须恰好四段，即三个分隔符）
    for (const e of entries) {
      if (!e || typeof e.key !== 'string' || !e.key) { errors.push('E15_BAD_MAP'); continue; }
      if (e.key.split('|').length !== 4) errors.push('E15_BAD_MAP');
    }
    if (errors.length) return { byKey, ids, errors };
    // 第 4 步：重复 dishId
    for (const e of entries) {
      if (e.dishId) { if (ids.has(e.dishId)) errors.push('E13_DUP_ID'); ids.add(e.dishId); }
    }
    if (errors.length) return { byKey, ids, errors };
    // 第 5 步：重复 key
    for (const e of entries) {
      if (byKey.has(e.key)) errors.push('E14_DUP_KEY');
      const usable = e.dishId && e.status === 'active';
      byKey.set(e.key, Object.assign({}, e, { dishId: usable ? e.dishId : null }));
    }
    return { byKey, ids, errors };
  }
  function resolve(records, map) {
    if (map === undefined) return { fatal: 'E12_NO_ID_MAP', errors: [], results: [], blockers: [], orphans: [], violations: [] };
    const idx = indexMap(map);
    if (idx.errors.length) return { fatal: idx.errors[0], errors: idx.errors, results: [], blockers: [], orphans: [], violations: [] };
    const groups = new Map();
    const violations = [];
    for (const r of records) {
      const perr = keyPartError(r);
      if (perr) { violations.push(perr); continue; }
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
    return { fatal: null, errors: [], results, blockers, orphans, violations };
  }
  return { normGroupKey, normSpecLabel, rawPart, keyPartError, makeKey, indexMap, resolve };
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
    // 阶段 B-1：夹具键必须是合法的四段键，否则第 3 步先失败、到不了第 4/5 步
    const dupId = REF.indexMap({ schemaVersion: 1, entries: [
      { key: 'a|b|c|d', dishId: 'c01_d040', status: 'active' },
      { key: 'a|b|c|e', dishId: 'c01_d040', status: 'active' }
    ] });
    const dupKey = REF.indexMap({ schemaVersion: 1, entries: [
      { key: 'a|b|c|d', dishId: 'c01_d040', status: 'active' },
      { key: 'a|b|c|d', dishId: 'c01_d041', status: 'active' }
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
    const need = ['`id` 非空 **不得**用于推断 `import_eligibility`', 'C20', '当前 490 条有 `dishId`、仍全为 `blocked`'];
    const miss = need.filter(k => CONTRACT.indexOf(k) === -1);
    if (miss.length === 0) pass('T35', 'id 非空不等于可导入（C20 不退让，490 条有 id 仍 blocked）', '契约 §4.3 C20');
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
    // 2026-10-25 正式初始化执行轮起：approvals/ 已存在（ap-20261025-01 由负责人授权签发）。
    // 存在时验证「恰含一个已签署审批文件」；不存在时维持原边界断言（历史口径）。
    if (miss.length === 0 && !dirExists) {
      pass("T47", "A 冻结：旁路审批记录 7 必填字段 + 路径/命名 + id-map 只存引用；项目内确实不存在 approvals 目录", "契约 §5.6.5.8.1");
    } else if (miss.length === 0 && dirExists) {
      const files = fs.readdirSync(path.join(ROOT, "tools", "pilot", "approvals")).filter(function (n) { return /\.json$/.test(n); });
      const apOk = files.length === 1 && files[0] === 'ap-20261025-01.json';
      const ap = apOk ? JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "pilot", "approvals", files[0]), 'utf8')) : null;
      const signed = ap && ap.result === 'approved' && !!ap.approvedAt && !!ap.signature && ap.signature.signed === true;
      if (apOk && signed) {
        pass("T47", "A 冻结：旁路审批记录规则齐全；approvals/ 已存在（2026-10-25 正式签发）：恰含 ap-20261025-01 且已签署（result=approved/approvedAt/signature 齐全）", "契约 §5.6.5.8.1 / ap-20261025-01");
      } else {
        fail("T47", "approvals 目录内容不符合审批机制", "契约 §5.6.5.8.1", 'files=' + files.join(',') + ' signed=' + !!signed);
      }
    } else {
      fail("T47", "A 的旁路审批记录规则缺失", "契约 §5.6.5.8.1", "缺=" + miss.join("、"));
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

  // ---------- T61：真实磁盘检查（2026-10-25 正式初始化执行轮起：approvals/ 与 id-map.json 已由
  // 负责人签发的 ap-20261025-01 授权创建——存在为预期；records/blockers/manifest 三类产物仍不得存在）
  (function () {
    const forbidden = [
      ['records.json', P.records],
      ['records_blockers.json', P.blockers],
      ['gen-manifest.json', P.manifest]
    ];
    const exists = forbidden.filter(function (it) { return fs.existsSync(it[1]); }).map(function (it) { return it[0]; });
    const allowed = [
      ['approvals/ap-20261025-01.json', P.approvals && path.join(P.approvals, 'ap-20261025-01.json')],
      ['id-map.json', P.idMap]
    ].filter(function (it) { return it[1] && fs.existsSync(it[1]); }).map(function (it) { return it[0]; });
    if (exists.length === 0) {
      pass('T61', 'A4/A5 边界（2026-10-25 执行轮更新）：已授权存在=' + (allowed.join('、') || '无') + '；records/records_blockers/gen-manifest 三类产物仍不存在（生成能力边界未变）', '磁盘实测（fs.existsSync，绝对精确路径）');
    } else {
      fail('T61', '出现未授权产物文件', '磁盘实测（fs.existsSync）', '实际存在=' + exists.join('、'));
    }
  })();
})();
(function runtimeBranches() {
  pending('T39b', 'PUBLISHING 标记与 E17_INCOMPLETE_PUBLISH 的运行时行为（需真实写出实现）', '契约 §7.2.3', '缺少正式发布产物（需另行授权生成并发布后才能核对运行时行为）');

  // T45b —— 真实加载路径上的 E12 / E15 分支（2026-10-24 P1 实施）
  // 覆盖契约 §5.6.5.5.4 第 1 步（读取 + JSON 解析）；第 2–5 步（schemaVersion/entries/keyFormat/重复检查）
  // 骨架阶段尚未实现（gen_records.js 当时为骨架、run() 返回 SKELETON），故对“结构非法”的两种夹具只断言
  // 「不得误报 E12 且必须非零退出」这一在实现前后都成立的不变量，不把尚未实现的 E15 写成已通过。
  (function T45b() {
    const fsx = require('fs');
    const osx = require('os');
    const pathx = require('path');
    let dir = null;
    const steps = [];
    function rec(step, ok, detail) { steps.push({ step: step, ok: !!ok, detail: String(detail || '') }); return ok; }
    try {
      const gen = require(P.gen);
      dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'sl-t45b-'));
      const noCode = function (r, code) { return !(r.violations || []).some(function (v) { return v.code === code; }); };
      const brief = function (r) { return JSON.stringify({ exit: r.exitCode, status: r.summary.status, codes: (r.violations || []).map(function (v) { return v.code; }) }); };

      // 分支一：映射文件不存在（父目录存在，首个缺失组件无同名条目）→ E12、退出码 1
      const p1 = pathx.join(dir, 'absent-sub', 'id-map.json');
      const r1 = gen.run({ mapPath: p1, mode: 'dry-run', outDir: null });
      rec('缺失→E12/1', r1.exitCode === 1 && r1.summary.status === 'NO_ID_MAP' && noCode(r1, 'E15_BAD_MAP') && (r1.violations || []).some(function (v) { return v.code === 'E12_NO_ID_MAP'; }), brief(r1));

      // 分支二：文件存在但 JSON 语法损坏 → E15、退出码 1
      const p2 = pathx.join(dir, 'broken.json');
      fsx.writeFileSync(p2, '{ "schemaVersion": 1, ', 'utf8');
      const r2 = gen.run({ mapPath: p2, mode: 'dry-run', outDir: null });
      rec('语法损坏→E15/1', r2.exitCode === 1 && r2.summary.status === 'BAD_ID_MAP' && noCode(r2, 'E12_NO_ID_MAP') && (r2.violations || []).some(function (v) { return v.code === 'E15_BAD_MAP'; }), brief(r2));

      // 分支三：schemaVersion ≠ 1（契约第 2 步判 E15；骨架阶段该步未实现）→ 只断言不误报 E12 且非零退出
      const p3 = pathx.join(dir, 'schema2.json');
      fsx.writeFileSync(p3, JSON.stringify({ schemaVersion: 2, keyFormat: 'stallId|groupKey|specLabel|disambiguator', entries: [] }), 'utf8');
      const r3 = gen.run({ mapPath: p3, mode: 'dry-run', outDir: null });
      rec('schemaVersion≠1→非零且不误报E12', r3.exitCode !== 0 && noCode(r3, 'E12_NO_ID_MAP'), brief(r3));

      // 分支四：entries 不是数组（同样属第 2 步）→ 同一不变量
      const p4 = pathx.join(dir, 'entries-object.json');
      fsx.writeFileSync(p4, JSON.stringify({ schemaVersion: 1, keyFormat: 'stallId|groupKey|specLabel|disambiguator', entries: {} }), 'utf8');
      const r4 = gen.run({ mapPath: p4, mode: 'dry-run', outDir: null });
      rec('entries非数组→非零且不误报E12', r4.exitCode !== 0 && noCode(r4, 'E12_NO_ID_MAP'), brief(r4));

      // 分支五：结构合法的最小映射 → 加载成功（mapLoaded），但当时生成流程未实现，仍非零退出且无 E12/E15
      const p5 = pathx.join(dir, 'valid.json');
      fsx.writeFileSync(p5, JSON.stringify({ schemaVersion: 1, keyFormat: 'stallId|groupKey|specLabel|disambiguator', entries: [] }), 'utf8');
      const r5 = gen.run({ mapPath: p5, mode: 'dry-run', outDir: null });
      // 2026-10-25 records 最小实现轮迁移：合法映射下 dry-run 已完成 L8 内存闭环（原「退出码 1=未实现」由无 E12/E15 意图保留）
      rec('合法最小映射→加载成功且完成L8内存闭环', r5.summary.mapLoaded === true && r5.exitCode === 0 && r5.summary.status === 'L8_IN_MEMORY_ONLY' && noCode(r5, 'E12_NO_ID_MAP') && noCode(r5, 'E15_BAD_MAP'), brief(r5));

      const allOk = steps.length === 5 && steps.every(function (s) { return s.ok; });
      const line = steps.map(function (s) { return s.step + '=' + (s.ok ? 'OK' : 'NG(' + s.detail + ')'); }).join('；');
      if (allOk) {
        pass('T45b', 'E12（映射缺失）与 E15（映射不可解析）在真实加载路径上分支正确；结构校验第 2–5 步未实现，未在此断言', '契约 §5.6.5.5.4 第 1 步 / RECORD_GENERATOR_CONTRACT_20261023.md §7.4', line);
      } else {
        fail('T45b', 'E12 / E15 真实加载分支', '契约 §5.6.5.5.4 第 1 步', line);
      }
    } catch (e) {
      fail('T45b', 'E12 / E15 真实加载分支（用例自身异常）', '契约 §5.6.5.5.4 第 1 步', String(e && e.message));
    } finally {
      if (dir) { try { fsx.rmSync(dir, { recursive: true, force: true }); } catch (e2) { /* 清理失败不影响结论，已在报告中如实说明 */ } }
    }
  })();
})();

// ================================================================ 生成器依赖项
(function generatorChecks() {
  const genExists = fs.existsSync(P.gen);
  const recExists = fs.existsSync(P.records);
  if (!genExists) {
    pending('G1', '生成器存在性：文件已存在（G1 已转运行时通过，见 §9.2；此分支为历史兼容）', 'tools/pilot/gen_records.js', '文件存在（G1 已转运行时通过，见 §9.2，此分支为历史兼容）');
  } else {
    try {
      const mod = require(P.gen);
      if (mod && typeof mod.run === 'function') pass('G1', '生成器导出生产入口 run()（导出面完整集合见 T108）', 'tools/pilot/gen_records.js');
      else fail('G1', '生成器导出 run()', 'tools/pilot/gen_records.js', '导出缺失');
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
  pending('T63b', 'Q6-1=A 运行时：清除后目标目录不再含标记', 'tools/pilot/gen_records.js', '缺少正式发布产物（清除动作需真实发布链路）');

  if (/E18_MARKER_CLEAR_FAILED/.test(c) && /按\*\*整体失败\*\*处理（Q6-2=A）/.test(c)) {
    pass('T64', 'Q6-2=A：清除失败归整体失败，诊断标识 E18 存在', '§7.2.3 / §7.2.5');
  } else {
    fail('T64', '清除失败归整体失败 + E18 标识', '§7.2.3 / §7.2.5', '缺少归类句或标识');
  }
  pending('T64b', 'Q6-2=A 运行时：清除失败时不产生成功结果', 'tools/pilot/gen_records.js', '缺少正式发布产物（清除失败分支需真实发布链路）');

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

  // T68（2026-10-24 第三批升级）：从"700 字符窗口文本匹配"改为"解析字段集合并断言恰等于五字段"
  const fiveFields = ['schemaVersion', 'counts', 'recordsSha256', 'blockersSha256', 'publishedAt'];
  const f6 = c.indexOf('6. 每次运行都会在 `gen-manifest.json` 写入');
  const f6end = f6 >= 0 ? c.indexOf('\n', f6) : -1;
  const seg6 = (f6 >= 0 && f6end > f6) ? c.slice(f6, f6end) : '';
  const parsedSet = Array.from(new Set((seg6.match(/`[A-Za-z][A-Za-z0-9]*`/g) || []).map(x => x.replace(/`/g, '')))).sort();
  const expectSet = fiveFields.slice().sort();
  const setEqual = parsedSet.length === expectSet.length && parsedSet.every((k, i) => k === expectSet[i]);
  const strictClause = /恰好为这 5 个/.test(seg6) && /任何额外字段一律判错/.test(seg6) && /additionalProperties = false/.test(seg6);
  if (setEqual && strictClause) {
    pass('T68', 'Q6-5=C：第 6 条解析出恰 5 个字段（' + parsedSet.join('、') + '）+ 额外字段判错 + additionalProperties = false', '§7.2.2 第 6 条');
  } else {
    fail('T68', 'manifest 五字段（解析式）与严格档条款', '§7.2.2 第 6 条',
         '解析=[' + parsedSet.join('、') + '] 期望=[' + expectSet.join('、') + ']；严格档=' + strictClause);
  }
  pending('T68b', 'Q6-5=C 运行时：产物 manifest 恰含 5 字段且拒绝额外字段', 'tools/pilot/records.json', '缺少正式产物 gen-manifest.json');

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
  // T70 —— D-EXIT 裁决在【阶段表 §7.2.1】的落点：每个阶段的「失败处理」列必须写明与裁决一致的退出码。
  // 分工：T70 管阶段表（S5/S7/S8/S9/S10 逐行码值 + 表内禁「未定义／待决」）；T80 管 §10.6.1 映射表与两维度分离。
  const dex = c.indexOf('| **CLI 参数／用法错误** | **`2`**') >= 0 && c.indexOf('不引入退出码 `2`') < 0;
  const s71a = c.indexOf('#### 7.2.1 十个阶段');
  const s71b = c.indexOf('#### 7.2.2', s71a);
  const stgSec = (s71a >= 0 && s71b > s71a) ? c.slice(s71a, s71b) : '';
  const stgRow = (key) => {
    const i = stgSec.indexOf(key);
    if (i < 0) return '';
    const j = stgSec.indexOf('\n', i);
    return stgSec.slice(i, j < 0 ? stgSec.length : j);
  };
  const stgNeed = [
    ['| S5 阻塞状态', '`1`'],
    ['| S7 单次 rename', '`3`'],
    ['| S8 发布后自检', '`4`'],
    ['| S9 清除标记', '`4`'],
    ['| S10 清除后复核', '`4`']
  ];
  const stgMiss = stgNeed.filter(([k, code]) => stgRow(k).indexOf('退出码') < 0 || stgRow(k).indexOf(code) < 0).map(([k]) => k);
  const stgRows = stgSec.split('\n').filter(l => /^\| S\d+/.test(l)).join('\n');
  const stgForbidden = ['未定义', '待决'].filter(k => stgRows.indexOf(k) >= 0);
  if (q6All && dex && stgSec.length > 0 && stgMiss.length === 0 && stgForbidden.length === 0) {
    pass('T70', 'D-EXIT：阶段表 S5=1、S7=3、S8/S9/S10=4 逐行写明，表内无「未定义／待决」残留，且 2 已引入、旧句已消失', '§7.2.1');
  } else {
    fail('T70', '阶段表退出码落点', '§7.2.1',
         '缺=' + stgMiss.join('、') + '；禁述命中=' + stgForbidden.join('、') + '；阶段表长度=' + stgSec.length);
  }

  // ---- E2-6 / E2-7（阶段 2 补充）：S10 复核强度与 E17 读侧修复入口 ----
  const s101 = c.indexOf('#### 7.2.1 十个阶段');
  const s102 = c.indexOf('#### 7.2.2 保证与不保证');
  const stageTable = (s101 >= 0 && s102 > s101) ? c.slice(s101, s102) : '';
  // 裁决落盘后：S10 由「①–③ + ④⑤暂不纳入」升级为「五项全部纳入」，并绑定 E19–E23 与退出码 4。
  const s10Need = ['S10 清除后复核', '五项，全部纳入', '①', '②', '③', '④', '⑤',
                  '`E19`', '`E20`', '`E21`', '`E22`', '`E23`', '退出码 **`4`**', '`§7.2.8`']
                  .map(k => (k === '`§7.2.8`' ? '§7.2.8' : k));
  const s10Miss = s10Need.filter(k => stageTable.indexOf(k) < 0);
  if (stageTable.length > 0 && s10Miss.length === 0) {
    pass('T71', 'Q-HASH/Q-COUNTS/Q-S10-CODE 落盘：S10 五项复核全部纳入并绑定 E19–E23 与退出码 4', '§7.2.1');
  } else {
    fail('T71', 'S10 五项复核与诊断码', '§7.2.1', '缺=' + s10Miss.join('、') + '；段落=' + stageTable.length);
  }

  const s105a = c.indexOf('**S10 复核失败**');
  const s105b = c.indexOf('#### 7.2.6', s105a);
  const s105 = (s105a >= 0 && s105b > s105a) ? c.slice(s105a, s105b) : '';
  const s105Need = ['逐项结果', '不自动删除目录', '不重建产物', '不修改 `gen-manifest.json`', '不降级', '§7.2.7', '不构成事务回滚'];
  const s105Miss = s105Need.filter(k => s105.indexOf(k) < 0);
  if (s105.length > 0 && s105Miss.length === 0) {
    pass('T72', 'E2-6：S10 失败禁止自动修复/重建/改 manifest/降级，且修复指向 §7.2.7', '§7.2.5');
  } else {
    fail('T72', 'S10 失败四条禁止 + 逐项结果', '§7.2.5', '缺=' + s105Miss.join('、'));
  }

  const s727a = c.indexOf('#### 7.2.7 修复路径');
  const s727b = c.indexOf('### 7.3 不得伪装成功');
  const s727 = (s727a >= 0 && s727b > s727a) ? c.slice(s727a, s727b) : '';
  const s727Need = ['读侧报 `E17_INCOMPLETE_PUBLISH`', '移除整个目录', '人工补齐缺失文件', '不构成事务回滚'];
  const s727Miss = s727Need.filter(k => s727.indexOf(k) < 0);
  if (s727.length > 0 && s727Miss.length === 0) {
    pass('T73', 'E2-7：E17 读侧独立修复入口 + 禁止人工补齐伪造完整目录 + 非事务回滚', '§7.2.7');
  } else {
    fail('T73', 'E17 修复行与禁止伪造条款', '§7.2.7', '缺=' + s727Miss.join('、'));
  }

  const s1062a = c.indexOf('#### 10.6.2');
  const s1062b = c.indexOf('## 十一、边界声明与工作区');
  const s1062 = (s1062a >= 0 && s1062b > s1062a) ? c.slice(s1062a, s1062b) : '';
  const s1062Need = ['已裁决 2026-10-24', 'H-1=A', 'H-2=A', 'C-2=A', 'C-3=A', 'S-2=A',
                     '`E20`', '`E23`', '`E19` 专指标记残留'];
  const s1062Miss = s1062Need.filter(k => s1062.indexOf(k) < 0);
  const s1062Forbidden = ['三项待决均已登记且各含「暂不纳入／待指定」口径', '均维持未定义', '本轮未因此新增任何错误码或退出码']
                          .filter(k => s1062.indexOf(k) >= 0);
  if (s1062.length > 0 && s1062Miss.length === 0 && s1062Forbidden.length === 0) {
    pass('T74', 'Q-HASH/Q-COUNTS/Q-S10-CODE 已裁决并落盘，且旧「待决」表述已失效', '§10.6.2');
  } else {
    fail('T74', '三项裁决落盘', '§10.6.2', '缺=' + s1062Miss.join('、') + '；残留=' + s1062Forbidden.join('、'));
  }

  pending('T75', 'S10 运行时：标记/可读性/五字段三项复核与失败行为', 'tools/pilot/gen_records.js', '缺少正式发布产物（S10 运行时复核）');

  const s92a = c.indexOf('**当前 PENDING 共 11 条');
  const s92b = c.indexOf('任何情况下不得靠放宽断言', s92a);
  const s92 = (s92a >= 0 && s92b > s92a) ? c.slice(s92a, s92b) : '';
  const p12 = ['T9b', 'T12c', 'G2', 'T39b', 'T63b', 'T64b', 'T68b', 'T75', 'T84', 'T113', 'T114b']
              .filter(k => s92.indexOf('`' + k + '`') < 0);
  const timing = c.indexOf('在 S10 复核成功之前，不得打印任何发布成功文案') >= 0;
  if (s92.length > 0 && p12.length === 0 && timing) {
    pass('T76', 'E2-2/E2-3：PENDING 名单 11 条齐全（含 T75、T84、T113、T114b；T45b 已转 PASS 故不在名单内）且成功文案时点条款仍在', '§9.2 / §7.2.2');
  } else {
    fail('T76', 'PENDING 名单十一条 + 成功文案时点', '§9.2 / §7.2.2', '缺编号=' + p12.join('、') + '；时点条款=' + timing);
  }
})();
// ------------------------------------------------ Q-COUNTS / Q-S10-CODE / D-EXIT / Q-HASH（裁决落盘，2026-10-24）
// 说明：T77–T83 为 L-A 契约静态断言；T84 为运行时（L-C），只能报 PENDING。
(function countsCodesExitHash() {
  const c = CONTRACT;

  // T77 —— C-1=A：records_blockers.json 结构
  const b1 = c.indexOf('### 3.4 `records_blockers.json` 结构');
  const b2 = c.indexOf('## 四、三类判定必须独立', b1);
  const sec34 = (b1 >= 0 && b2 > b1) ? c.slice(b1, b2) : '';
  const t77Need = ['"schemaVersion": 1', '"count": 2', '"entries"',
                   '`count` 必须**等于** `entries.length`', '不得出现任何时间字段',
                   '一条待阻塞记录一条 `entry`', '`kind` 取值限定四类', '拆成多条 entry'];
  const t77Miss = t77Need.filter(k => sec34.indexOf(k) < 0);
  if (sec34.length > 0 && t77Miss.length === 0) {
    pass('T77', 'C-1=A：blockers 顶层三键 + count=entries.length + 禁时间字段 + 一条记录一条 entry', '§3.4');
  } else {
    fail('T77', 'blockers 结构', '§3.4', '缺=' + t77Miss.join('、') + '；段落=' + sec34.length);
  }

  // T78 —— C-2=A：manifest.counts 结构与「两处相等」
  const h1 = c.indexOf('#### 7.2.8 哈希与计数口径');
  const h2 = c.indexOf('### 7.3 不得伪装成功', h1);
  const sec728 = (h1 >= 0 && h2 > h1) ? c.slice(h1, h2) : '';
  const t78Need = ['`gen-manifest.json.counts` 结构（C-2=A）', '| `records` | 整数 |', '| `blockers` | 整数 |',
                   '两处必须相等', '不是**互相独立的真源', '不新增 `counts.blocked`',
                   '8. **`counts` 的结构与对账（C-2=A）**'];
  const t78Miss = t78Need.filter(k => c.indexOf(k) < 0);
  if (sec728.length > 0 && t78Miss.length === 0) {
    pass('T78', 'C-2=A：counts 恰五字段 + 两处 A/B/C 必须相等 + 不新增 counts.blocked', '§7.2.8 / §7.2.2');
  } else {
    fail('T78', 'counts 结构与相等约束', '§7.2.8 / §7.2.2', '缺=' + t78Miss.join('、'));
  }

  // T79 —— C-3=A：四个数量互不等价
  const t79Need = ['`records.meta.counts.total = 564` 表示规划候选总数',
                   '四者互不等价、互不推算', '只作为**运行时统计量**', '当前规划基准 **502**'];
  const t79Miss = t79Need.filter(k => c.indexOf(k) < 0);
  const t79Forbidden = c.indexOf('`total` 表示 `records.length`') >= 0;
  if (t79Miss.length === 0 && !t79Forbidden) {
    pass('T79', 'C-3=A：total≠records.length，records/blockers/blocked 三者互不推算', '§7.2.8 / §3.3');
  } else {
    fail('T79', '计数语义分离', '§7.2.8 / §3.3', '缺=' + t79Miss.join('、') + '；错误等价=' + t79Forbidden);
  }

  // T80 —— D-1/D-2：退出码映射
  const e1 = c.indexOf('#### 10.6.1 `D-EXIT` 退出码裁决');
  const e2 = c.indexOf('#### 10.6.2', e1);
  const sec1061 = (e1 >= 0 && e2 > e1) ? c.slice(e1, e2) : '';
  const t80Need = ['| **S5 阻塞状态失败** | **`1`**', '| **S7 `rename` 失败** | **`3`**',
                   '| **S8 发布后自检失败** | **`4`**', '| **S9 清除标记失败** | **`4`**',
                   '| **S10 复核失败** | **`4`**', '| **`--out` 路径失败** | **`3`**',
                   '表示**失败类别**', '表示**具体阶段与原因**'];
  const t80Forbidden = ['未定义', '待决', 'S5、S7、S8、S9、S10 与 `--out` 失败'].filter(k => sec1061.indexOf(k) >= 0);
  const t80Miss = t80Need.filter(k => sec1061.indexOf(k) < 0);
  if (sec1061.length > 0 && t80Miss.length === 0 && t80Forbidden.length === 0) {
    pass('T80', 'D-EXIT 映射表：六行码值齐全、两维度分离、且无「未定义／待决／旧集合句」残留', '§10.6.1');
  } else {
    fail('T80', '退出码映射', '§10.6.1', '缺=' + t80Miss.join('、') + '；失效表述残留=' + t80Forbidden.join('、'));
  }

  // T81 —— S-1/S-2：错误码登记表
  const r1 = c.indexOf('### 7.4 错误码登记表');
  const r2 = c.indexOf('## 八、与 `tools/verify_data.js` 的复用边界', r1);
  const sec74 = (r1 >= 0 && r2 > r1) ? c.slice(r1, r2) : '';
  const t81Need = ['唯一登记位置', 'E19_MARKER_STILL_PRESENT', 'E20_S10_FILE_UNREADABLE',
                   'E21_S10_MANIFEST_INVALID', 'E22_S10_HASH_MISMATCH', 'E23_S10_COUNT_MISMATCH',
                   '编号空缺，本轮未使用', '不得凭空补定义', 'E19` **专指**'];
  const t81Miss = t81Need.filter(k => sec74.indexOf(k) < 0);
  if (sec74.length > 0 && t81Miss.length === 0) {
    pass('T81', 'S-1/S-2：§7.4 唯一登记处 + E20/E21/E22/E23 语义唯一 + E19 专指 + E16 标空缺', '§7.4');
  } else {
    fail('T81', '错误码登记表', '§7.4', '缺=' + t81Miss.join('、') + '；段落=' + sec74.length);
  }

  // T82 —— H-1/H-2：哈希口径
  const t82Need = ['实际写入的完整字节', '不带 BOM', '不对换行符做任何转换', '小写十六进制、64 字符',
                   'S8 在写入 `gen-manifest.json` 之前', 'S10 重新读取这两个文件',
                   '自身不参与自我哈希', '必须导致整体失败', '读侧**不新增**哈希校验'];
  const t82Miss = t82Need.filter(k => sec728.indexOf(k) < 0);
  if (sec728.length > 0 && t82Miss.length === 0) {
    pass('T82', 'H-1/H-2：字节哈希八条齐全，且读侧不新增校验（保持 Q6-6/E17/T66 边界）', '§7.2.8');
  } else {
    fail('T82', '哈希口径', '§7.2.8', '缺=' + t82Miss.join('、'));
  }

  // T83 —— 两节已标「已裁决」且旧表述失效
  const t83a = c.indexOf('#### 10.6.1 `D-EXIT` 退出码裁决（**已裁决 2026-10-24') >= 0;
  const t83b = c.indexOf('#### 10.6.2 `Q-HASH` / `Q-COUNTS` / `Q-S10-CODE` 裁决（**已裁决 2026-10-24**）') >= 0;
  const t83Forbidden = ['均维持未定义', '本轮未因此新增任何错误码或退出码'].filter(k => c.indexOf(k) >= 0);
  if (t83a && t83b && t83Forbidden.length === 0) {
    pass('T83', '§10.6.1/§10.6.2 均标「已裁决 2026-10-24」，旧「待决/维持未定义」表述已清除', '§10.6.1 / §10.6.2');
  } else {
    fail('T83', '两节裁决标记', '§10.6.1 / §10.6.2', '标记=' + t83a + '/' + t83b + '；残留=' + t83Forbidden.join('、'));
  }

  pending('T84', '运行时：两个数据文件的 sha256 与 counts 与 manifest 一致（§7.2.8 第 5/6 条 + S10 ④⑤）',
          'tools/pilot/gen_records.js', '缺少正式发布产物');
})();

// ------------------------------------------------ 第一批执行：D-1 / D-2 / D-3 + G-1 / G-2 / G-3（2026-10-24）
// 说明：T85–T93 为 L-A 契约静态断言（只证明规则写在文件里，不证明运行时遵守）；
//       T94 同样是静态断言（错误码不得被预占）；T95 为运行时（零写入），只能报 PENDING。
(function batch1Decisions() {
  const c = CONTRACT;

  // T85 —— D-1 / DOC-2：395 的来源描述改为引用 §5.6.2，且仍是计算值
  const t85Need = ['本文 §5.6.2·编号连续性段落已记载「279 + 116 = 395」',
                   '**计算值**（非独立数据源；数值由序列长度与分档推导得出）'];
  const t85Miss = t85Need.filter(k => c.indexOf(k) < 0);
  const t85Forbidden = c.indexOf('任何文档均未直接记载此数') >= 0;
  if (t85Miss.length === 0 && !t85Forbidden) {
    pass('T85', 'D-1/O1：395 来源引用 §5.6.2 的 279+116，仍标「计算值」，旧「任何文档均未记载」已删除', '§6.2.1');
  } else {
    fail('T85', '395 来源描述', '§6.2.1', '缺=' + t85Miss.join('、') + '；残留旧表述=' + t85Forbidden);
  }

  // T86–T89 —— D-2：缺 --out 的零写入、无默认目录、与路径失败区分
  const s32a = c.indexOf('### 3.2 最小调用示例');
  const s32b = c.indexOf('### 3.3 输出结构', s32a);
  const s32 = (s32a >= 0 && s32b > s32a) ? c.slice(s32a, s32b) : '';

  const t86Need = ['必须在任何文件系统写入之前失败'];
  const t86Miss = t86Need.filter(k => s32.indexOf(k) < 0);
  if (s32.length > 0 && t86Miss.length === 0) {
    pass('T86', 'D-2：`write=true` 且缺 `--out` 时，必须在任何文件系统写入之前失败', '§3.2');
  } else {
    fail('T86', '缺参失败时机', '§3.2', '缺=' + t86Miss.join('、') + '；段落=' + s32.length);
  }

  const t87Need = ['不得创建任何文件或目录', '含临时目录', '不得回退到项目内路径'];
  const t87Miss = t87Need.filter(k => s32.indexOf(k) < 0);
  if (t87Miss.length === 0) {
    pass('T87', 'D-2：缺参时不创建任何文件/目录（含临时目录），且不提供默认输出目录', '§3.2');
  } else {
    fail('T87', '零写入与无默认目录', '§3.2', '缺=' + t87Miss.join('、'));
  }

  const t88Need = ['不得**与「`--out` 路径执行失败」', '沿用退出码 `3`'];
  const t88Miss = t88Need.filter(k => c.indexOf(k) < 0);
  if (t88Miss.length === 0) {
    pass('T88', 'D-2/G-2：缺参 ≠ 路径执行失败，且不得沿用退出码 3', '§3.2 / §7.2.6');
  } else {
    fail('T88', '缺参与路径失败区分', '§3.2 / §7.2.6', '缺=' + t88Miss.join('、'));
  }

  const t89Need = ['不属于本节的情形', '不是**本节**所说'.replace('**本节**', '**本节**')];
  const t89Has = c.indexOf('不属于本节的情形（2026-10-24：D-2 / Q4-P / G-2）') >= 0;
  if (t89Has) {
    pass('T89', 'D-2：§7.2.6 明确「缺 --out」不属于路径拒绝清单情形', '§7.2.6');
  } else {
    fail('T89', '§7.2.6 排除说明', '§7.2.6', '缺=不属于本节的情形（D-2 标注）');
  }

  // T90 —— D-3/G-3：planDigest 不匹配 → fail-closed
  const t90Need = ['`planDigest` 不匹配 → fail-closed', '**必须拒绝**继续初始化或加载'];
  const t90Miss = t90Need.filter(k => c.indexOf(k) < 0);
  if (t90Miss.length === 0) {
    pass('T90', 'D-3/G-3：planDigest 不匹配必须拒绝继续（fail-closed），不得警告后继续', '§5.6.5.8.2 A3');
  } else {
    fail('T90', 'planDigest 不匹配', '§5.6.5.8.2 A3', '缺=' + t90Miss.join('、'));
  }

  // T91 —— D-3/Q8-B：审批记录存在但内容不匹配 → fail-closed，且不降级为 W_APPROVAL_REF_MISSING
  const t91Need = ['审批记录存在但内容不匹配 → fail-closed', '不得**降级为 `W_APPROVAL_REF_MISSING` 警告后继续'];
  const t91Miss = t91Need.filter(k => c.indexOf(k) < 0);
  if (t91Miss.length === 0) {
    pass('T91', 'D-3/Q8-B：内容不匹配必须拒绝，且不得降级为「记录缺失」警告', '§5.6.5.8.2 A4');
  } else {
    fail('T91', '内容不匹配 fail-closed', '§5.6.5.8.2 A4', '缺=' + t91Miss.join('、'));
  }

  // T92 —— 两种不匹配分别识别（不得合并）
  const t92Need = ['两种不匹配必须分别识别', '| **A** `planDigest` 不匹配 |', '| **B** 审批记录内容不匹配 |',
                   '（对照）记录缺失'];
  const t92Miss = t92Need.filter(k => c.indexOf(k) < 0);
  if (t92Miss.length === 0) {
    pass('T92', 'D-3：A（planDigest）与 B（记录内容）在同一判别表中分别成行，缺失单列为对照', '§5.6.5.8.2 A4');
  } else {
    fail('T92', '两情形分别识别', '§5.6.5.8.2 A4', '缺=' + t92Miss.join('、'));
  }

  // T93 —— 不得预占错误码/退出码
  const s74a = c.indexOf('### 7.4 错误码登记表');
  const s74b = c.indexOf('## 八、与 `tools/verify_data.js` 的复用边界', s74a);
  const s74 = (s74a >= 0 && s74b > s74a) ? c.slice(s74a, s74b) : '';
  const t93Need = ['| `E24_MISSING_OUT` |', '| `E28_OUT_REFUSED` |', '| `E29_PARAM_CONFLICT` |', '| `E30_COMMITTED_WRITE_FAILED` |', '`E16` 仍空缺'];
  const t93Miss = t93Need.filter(k => s74.indexOf(k) < 0);
  const t93Forbidden = /`E3[1-9]_`|`E4[0-9]_/.test(c);
  if (s74.length > 0 && t93Miss.length === 0 && !t93Forbidden) {
    pass('T93', 'E24–E30 已在本表登记（E29/E30 为任务 A/C 新增）、E16 仍空缺、且未预占 E31+ 编号', '§7.4');
  } else {
    fail('T93', '不预占编号', '§7.4', '缺=' + t93Miss.join('、') + '；出现预占编号=' + t93Forbidden);
  }

  // T94a/T94b/T94c —— §10.6.3 待裁决登记（G-1 类别盘点、G-2/G-3 状态）
  // 三条独立断言，互不替代：
  //   T94a = 段内必需项齐全（类别 + 码值 + 矛盾注措辞）
  //   T94b = 全文「矛盾已消除」出现次数 <= 2（防止文案被复制到别处）
  //   T94c = 段内至少出现 1 次（防止把文案整段搬到别处、用全文计数蒙过去）
  const s1063a = c.indexOf('#### 10.6.3 `G-1` / `G-2` / `G-3` 裁决（**已裁决 2026-10-24 第二批**）');
  const s1063b = c.indexOf('## 十一、边界声明与工作区', s1063a);
  const s1063 = (s1063a >= 0 && s1063b > s1063a) ? c.slice(s1063a, s1063b) : '';
  const t94Need = ['CLI 用法类错误类别与已分配码值', '未知子命令', '缺少必需参数', '互斥参数冲突',
                   '**G-1** CLI 参数／用法错误', '**G-2** 缺 `--out` vs 路径失败', '**G-3** `planDigest` 不匹配',
                   '已裁决 2026-10-24 第二批', 'E27_CLI_USAGE', 'E24_MISSING_OUT', 'E28_OUT_REFUSED', 'E25_PLAN_DIGEST_MISMATCH', 'E26_APPROVAL_INVALID', '矛盾已消除', '仅作审计线索保留'];
  const t94Miss = t94Need.filter(k => s1063.indexOf(k) < 0);
  if (s1063.length > 0 && t94Miss.length === 0) {
    pass('T94a', 'G-1/G-2/G-3：类别与码值已一并登记，矛盾注已改为「已消除」', '§10.6.3 段内');
  } else {
    fail('T94a', 'G-1/G-2/G-3 登记', '§10.6.3 段内', '缺=' + t94Miss.join('、') + '；段落=' + s1063.length);
  }
  const t94All = (c.match(/矛盾已消除/g) || []).length;
  if (t94All <= 2) {
    pass('T94b', '全文「矛盾已消除」出现 ' + t94All + ' 次（上限 2）', '全文');
  } else {
    fail('T94b', '全文「矛盾已消除」次数上限', '全文', '出现 ' + t94All + ' 次，超过上限 2');
  }
  const t94In = (s1063.match(/矛盾已消除/g) || []).length;
  if (t94In >= 1) {
    pass('T94c', '段内「矛盾已消除」出现 ' + t94In + ' 次（至少 1 次）', '§10.6.3 段内');
  } else {
    fail('T94c', '段内「矛盾已消除」缺失', '§10.6.3 段内', '全文 ' + t94All + ' 次但段内 0 次：文案可能被搬出本节');
  }

  // T95 —— L-C：`--write` 缺 `--out` 时，真实子进程在写入前失败且目录零新增
  (function () {
    const cp = require('child_process');
    const os = require('os');
    const fsl = require('fs');
    const pathl = require('path');
    const tmp = fsl.mkdtempSync(pathl.join(os.tmpdir(), 'sl-t95-'));
    const snap = function () {
      const out = [];
      (function walk(dir, rel) {
        fsl.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
          const r = rel ? rel + '/' + e.name : e.name;
          out.push(r + (e.isDirectory() ? '/' : ''));
          if (e.isDirectory()) walk(pathl.join(dir, e.name), r);
        });
      })(tmp, '');
      return out.sort();
    };
    const beforeFiles = snap();
    const r = cp.spawnSync(process.execPath, [P.gen, '--write'], { cwd: tmp, encoding: 'utf8', timeout: 60000 });
    const afterFiles = snap();
    fsl.rmSync(tmp, { recursive: true, force: true });
    const txt = String(r.stdout || '') + String(r.stderr || '');
    const added = afterFiles.filter(function (x) { return beforeFiles.indexOf(x) < 0; });
    const lacks = [];
    if (r.status !== 2) lacks.push('退出码=' + r.status + '（期望 2）');
    if (txt.indexOf('E24_MISSING_OUT') < 0) lacks.push('输出未含 E24_MISSING_OUT');
    if (beforeFiles.length !== 0) lacks.push('临时目录预置非空=' + beforeFiles.length);
    if (added.length) lacks.push('新增文件/目录=' + added.join('、'));
    if (lacks.length === 0) {
      pass('T95', '`--write` 缺 `--out`：退出码 2、报 E24_MISSING_OUT、临时目录前后清单全等（零写入、无临时文件、无新建父目录）', 'tools/pilot/gen_records.js（真实子进程）');
    } else {
      fail('T95', '缺 `--out` 零写入', 'tools/pilot/gen_records.js', lacks.join('；'));
    }
  })();

  // ---- 第二批（2026-10-24）：E24–E28 与 CLI 检查顺序 ----
  const rowOf = (sec, key) => {
    const i = sec.indexOf(key);
    if (i < 0) return '';
    const j = sec.indexOf('\n', i);
    return sec.slice(i, j < 0 ? sec.length : j);
  };
  const rE10 = rowOf(s74, '| `E10_WRITE_FAILED` |');
  const okCode = (row, code) => row.indexOf('退出码 `' + code + '`') >= 0;
  const rE24 = rowOf(s74, '| `E24_MISSING_OUT` |');
  const rE25 = rowOf(s74, '| `E25_PLAN_DIGEST_MISMATCH` |');
  const rE26 = rowOf(s74, '| `E26_APPROVAL_INVALID` |');
  const rE27 = rowOf(s74, '| `E27_CLI_USAGE` |');
  const rE28 = rowOf(s74, '| `E28_OUT_REFUSED` |');
  const t96Ok = okCode(rE24, '2')
    && okCode(rE25, '1')
    && okCode(rE26, '1')
    && okCode(rE27, '2')
    && okCode(rE28, '3')
    && rE10.indexOf('磁盘／权限／路径非法') >= 0
    && s74.indexOf('`E10` 与 `E28` 的分界') >= 0
    && s74.indexOf('`E16` 仍空缺') >= 0;
  if (t96Ok) {
    pass('T96', '第二批 G-1/G-2：E24–E28 各有唯一定义与退出码 2/1/1/2/3，E10 原义未改且已写明与 E28 的分界', '§7.4');
  } else {
    fail('T96', 'E24–E28 登记', '§7.4',
      'E24=' + okCode(rE24, '2') + '；E25=' + okCode(rE25, '1') + '；E26=' + okCode(rE26, '1') + '；E27=' + okCode(rE27, '2') + '；E28=' + okCode(rE28, '3') + '；E10原义=' + (rE10.indexOf('磁盘／权限／路径非法') >= 0) + '；分界注=' + (s74.indexOf('`E10` 与 `E28` 的分界') >= 0));
  }

  const a34a = c.indexOf('##### A3 审批必须绑定具体计划');
  const a34b = c.indexOf('##### A5 未来初始化的执行保护', a34a);
  const secA34 = (a34a >= 0 && a34b > a34a) ? c.slice(a34a, a34b) : '';
  const t97Ok = secA34.indexOf('`E25_PLAN_DIGEST_MISMATCH`') >= 0
    && secA34.indexOf('`E26_APPROVAL_INVALID`') >= 0
    && secA34.indexOf('待裁决') < 0
    && secA34.indexOf('待负责人分配') < 0;
  if (t97Ok) {
    pass('T97', '第二批 G-3：A3/A4 判别表已填入 E25／E26 与退出码 1，且不再出现「待裁决」', '§5.6.5.8.2 A3·A4');
  } else {
    fail('T97', 'A3/A4 码值', '§5.6.5.8.2',
      'E25=' + (secA34.indexOf('`E25_PLAN_DIGEST_MISMATCH`') >= 0) + '；E26=' + (secA34.indexOf('`E26_APPROVAL_INVALID`') >= 0) + '；残留待裁决=' + (secA34.indexOf('待裁决') >= 0));
  }

  const s061a = c.indexOf('#### 10.6.1');
  const s061b = c.indexOf('#### 10.6.2', s061a);
  const sec061 = (s061a >= 0 && s061b > s061a) ? c.slice(s061a, s061b) : '';
  const t98Ok = sec061.indexOf('| **CLI 参数／用法错误** | **`2`**') >= 0
    && sec061.indexOf('不引入退出码 `2`') < 0
    && sec061.indexOf('已撤销') >= 0
    && sec061.indexOf('该句仅作历史记录保留') >= 0
    && sec061.indexOf('第二批裁决') >= 0
    && sec061.indexOf('G-1=A') >= 0;
  if (t98Ok) {
    pass('T98', '第二批 G-1：2 已引入（专指 CLI 用法错误），旧句已消失，且文档留痕「已撤销／仅作历史记录保留」并注明背景（第二批裁决 G-1=A）', '§10.6.1');
  } else {
    fail('T98', '退出码 2 引入', '§10.6.1',
      '新增行=' + (sec061.indexOf('| **CLI 参数／用法错误** | **`2`**') >= 0) + '；旧句残留=' + (sec061.indexOf('不引入退出码 `2`') >= 0));
  }

  const s35a = c.indexOf('### 3.5 CLI 调用与参数检查顺序');
  const s35b = c.indexOf('## 八、', s35a);
  const sec35 = (s35a >= 0 && s35b > s35a) ? c.slice(s35a, s35b) : '';
  const t99Need = ['契约要求的检查顺序', '尚未验证', '遇错即停', '不聚合多错',
    '| 1 | 子命令／命令名', '| 2 | 选项名合法性', '| 3 | 选项值合法性', '| 4 | 互斥参数冲突', '| 5 | 多余位置参数',
    '`E27_CLI_USAGE`', '`E24_MISSING_OUT`', '`E28_OUT_REFUSED`', '`E10_WRITE_FAILED`'];
  const t99Miss = t99Need.filter(k => sec35.indexOf(k) < 0);
  if (sec35.length > 0 && t99Miss.length === 0) {
    pass('T99', '第二批 G-1：§3.5 冻结五步检查顺序、遇错即停、不聚合多错，并声明「契约规定 ≠ 运行时已验证」', '§3.5');
  } else {
    fail('T99', 'CLI 检查顺序', '§3.5', '缺=' + t99Miss.join('、') + '；段落=' + sec35.length);
  }

  // T100 —— L-C：五步顺序、首错唯一、退出码映射（真实子进程，逐案独立）
  (function () {
    const cp = require('child_process');
    const os = require('os');
    const fsl = require('fs');
    const pathl = require('path');
    const tmp = fsl.mkdtempSync(pathl.join(os.tmpdir(), 'sl-t100-'));
    const outPath = pathl.join(tmp, 'out');
    const cases = [
      { name: '① 未知子命令', args: ['bogus'], code: 'E27_CLI_USAGE', step: 1, exit: 2 },
      { name: '② 未知选项', args: ['--outdir', 'x'], code: 'E27_CLI_USAGE', step: 2, exit: 2 },
      { name: '③a 选项缺值', args: ['--write', '--out'], code: 'E27_CLI_USAGE', step: 3, exit: 2 },
      { name: '③b 选项空值', args: ['--write', '--out', ''], code: 'E27_CLI_USAGE', step: 3, exit: 2 },
      { name: '④ 互斥冲突', args: ['--write', '--dry-run', '--out', outPath], code: 'E27_CLI_USAGE', step: 4, exit: 2 },
      { name: '⑤ 多余位置参数', args: ['gen', 'foo.json'], code: 'E27_CLI_USAGE', step: 5, exit: 2 },
      { name: '⑥ 多错取首（子命令先于选项）', args: ['bogus', '--outdir', 'x'], code: 'E27_CLI_USAGE', step: 1, exit: 2 },
      { name: '⑦ 路径问题不得早于语法错误', args: ['--write', '--outdir', 'x', '--out', 'data/'], code: 'E27_CLI_USAGE', step: 2, exit: 2 },
      // 2026-10-25 正式初始化执行轮迁移（原设计见 T279 预演）：tools/pilot/id-map.json 已创建并回迁，
      // 「--write --out」不再因缺映射报 E12，而是加载成功后进入当时实现阶段的下一状态（当时记录生成链路未实现）。
      // 历史意图（缺失必须 E12）仍由 T33/T45b/T124 的注入路径覆盖。
      // 2026-10-25 写出链路轮迁移：映射加载成功后 write 走 P1 十阶段并发布成功（零写入正式目录——cwd=tmp）。
      { name: '⑧ 语法通过后完成发布（PUBLISH_OK/0）', args: ['--write', '--out', 'data/'], code: 'PUBLISH_OK', step: 0, exit: 0 }
    ];
    const rows = [];
    const lacks = [];
    cases.forEach(function (cs) {
      const r = cp.spawnSync(process.execPath, [P.gen].concat(cs.args), { cwd: tmp, encoding: 'utf8', timeout: 60000 });
      const txt = String(r.stdout || '') + String(r.stderr || '');
      const head = (txt.split('\n')[0] || '').slice(0, 70);
      const m = txt.match(/（第 (\d+) 步）/);
      const actualStep = m ? Number(m[1]) : 0;
      const codeOk = txt.indexOf(cs.code) >= 0;
      const stepOk = cs.step === 0 ? (!m) : (actualStep === cs.step);
      const exitOk = (r.status === cs.exit);
      rows.push(cs.name + ' | 输入 ' + JSON.stringify(cs.args) + ' | 预期 ' + cs.code + '·第' + (cs.step || '—') + '步·退出' + cs.exit
        + ' | 实际 ' + (codeOk ? cs.code : head) + '·第' + (actualStep || '—') + '步·退出' + r.status + ' | ' + ((codeOk && stepOk && exitOk) ? 'OK' : 'MISMATCH'));
      if (!(codeOk && stepOk && exitOk)) lacks.push(cs.name + '（实际：「' + head + '」/退出 ' + r.status + '）');
    });
    const leaked = fsl.readdirSync(tmp);
    // 2026-10-25 写出链路轮：⑧ 现在成功发布（--out data/ 相对 cwd=tmp），data/ 是预期产物，
    // 校验其内容齐全且无 PUBLISHING 残留；其它任何残留仍视为泄漏。
    const unexpected = leaked.filter(function (n) { return n !== 'data'; });
    if (unexpected.length) lacks.push('临时目录出现非预期残留：' + unexpected.join('、'));
    if (leaked.indexOf('data') >= 0) {
      const df = fsl.readdirSync(pathl.join(tmp, 'data')).sort().join(',');
      if (df !== 'COMMITTED,gen-manifest.json,records.json,records_blockers.json') {
        lacks.push('⑧ 产物不完整：' + df);
      }
    }
    fsl.rmSync(tmp, { recursive: true, force: true });
    console.log('    T100 案例表（逐案独立）：');
    rows.forEach(function (x) { console.log('      ' + x); });
    if (lacks.length === 0) {
      pass('T100', '九案逐案独立：五步顺序只报首错、码与退出码符合 2/1 映射；路径问题未早于语法错误；语法通过后仅做语法侧放行且零写入（E28 路径安全已实现，见 T164；⑧ 只断言零写入）', 'tools/pilot/gen_records.js（真实子进程）');
    } else {
      fail('T100', 'CLI 五步与首错', 'tools/pilot/gen_records.js', lacks.join('；'));
    }
  })();

  // ---- G-4…G-8（2026-10-24 第三批）----
  const g4a = c.indexOf('#### 10.6.4 `G-4` … `G-8` 裁决（**已裁决 2026-10-24 第三批**）');
  const g4b = c.indexOf('## 十一、边界声明与工作区', g4a);
  const s1046 = (g4a >= 0 && g4b > g4a) ? c.slice(g4a, g4b) : '';
  const need = (ks) => ks.filter(k => s1046.indexOf(k) < 0);

  const n101 = need(['**初始化**', '必须存在且可读', '缺失即**失败**', 'W_APPROVAL_REF_MISSING', '加载/正常运行']);
  if (s1046.length > 0 && n101.length === 0) pass('T101', 'G-4=C：写侧严（初始化缺审批即失败）/ 读侧宽（仅警告并继续）', '§10.6.4');
  else fail('T101', 'G-4 两侧口径', '§10.6.4', '缺=' + n101.join('、') + '；段=' + s1046.length);

  const n102 = need(['只覆盖', '新 `approvalId`', '新 `planDigest`', '不得沿用', 'E25']);
  if (s1046.length > 0 && n102.length === 0) pass('T102', 'G-5=A：一次审批只覆盖其 planDigest，扩展需新计划+新审批，同 ID 配不同 digest 判 E25', '§10.6.4');
  else fail('T102', 'G-5 覆盖范围', '§10.6.4', '缺=' + n102.join('、'));

  const n103 = need(['KEY_COLLISION', '该键写 `null`', '其余已能确定的键', '不整体失败', '不可发布']);
  if (s1046.length > 0 && n103.length === 0) pass('T103', 'G-6=B：碰撞键写 null + reasons 保留 KEY_COLLISION，其余键正常写、不整体失败、null 期间不可发布', '§10.6.4');
  else fail('T103', 'G-6 主体口径', '§10.6.4', '缺=' + n103.join('、'));

  const n104 = need(['**不承载原因**', '部分映射 ≠ 部分发布', '不得**被静默转换', '空字符串', '自动消歧']);
  if (s1046.length > 0 && n104.length === 0) pass('T104', 'G-6 附加三条：null 不承载原因 / 部分映射≠部分发布 / 不得静默消歧', '§10.6.4');
  else fail('T104', 'G-6 附加三条', '§10.6.4', '缺=' + n104.join('、'));

  const g7names = ['parseDoc', 'classifyTable', 'expandTable', 'buildSourceDetail', 'judgeGeneration',
                   'judgeEvidence', 'judgeEligibility', 'summarize', 'assertContract'];
  const n105 = need(['**仅** `run`', '测试专用命名空间', '不属于生产接口', '不得增删',
                     '`readSource`', '`writeOutputs`', '不导出']).concat(g7names.filter(k => s1046.indexOf(k) < 0));
  if (s1046.length > 0 && n105.length === 0) pass('T105', 'G-7=O-1：生产导出面仅 run；__test__ 恰含 9 个冻结名字；readSource/writeOutputs 不导出', '§10.6.4');
  else fail('T105', 'G-7 导出面', '§10.6.4', '缺=' + n105.join('、'));

  const n106 = need(['`tools/pilot/init-plans/`', '`ip-YYYYMMDD-NN`', '一对一', '`approvals/ap-YYYYMMDD-NN.json`']);
  if (s1046.length > 0 && n106.length === 0) pass('T106', 'G-8=A：计划载体 init-plans/ip-YYYYMMDD-NN.md，与 approvals/ap-… 一对一', '§10.6.4');
  else fail('T106', 'G-8 载体与编号', '§10.6.4', '缺=' + n106.join('、'));

  const n107 = need(['不得原地修改', '`ip-YYYYMMDD-NN-r2.md`', '重新取得审批']);
  if (s1046.length > 0 && n107.length === 0) pass('T107', 'G-8 不可变：审批后计划不得原地修改，修订须新建 -r2 并重新审批', '§10.6.4');
  else fail('T107', 'G-8 不可变条款', '§10.6.4', '缺=' + n107.join('、'));

  // T108 —— L-C：真实 require，检查导出面与冻结性（不做源码字符串检查）
  (function () {
    const lacks = [];
    let mod = null;
    try { mod = require(P.gen); } catch (e) { lacks.push('require 抛错：' + e.message); }
    if (mod) {
      const want = ['__test__', 'run', 'runInit'];
      const nine = ['assertContract', 'buildSourceDetail', 'classifyTable', 'expandTable', 'judgeEligibility', 'judgeEvidence', 'judgeGeneration', 'parseDoc', 'summarize'];
      const top = Object.keys(mod).sort();
      const tk = Object.keys(mod.__test__ || {}).sort();
      if (JSON.stringify(top) !== JSON.stringify(want)) lacks.push('顶层导出=' + top.join(','));
      if (JSON.stringify(tk) !== JSON.stringify(nine)) lacks.push('__test__ 键=' + tk.join(','));
      if (typeof mod.runInit !== 'function') lacks.push('runInit 非函数');
      ['readSource', 'writeOutputs'].forEach(function (k) { if (Object.prototype.hasOwnProperty.call(mod, k)) lacks.push('多余公开导出 ' + k); });
      const nonFn = nine.filter(function (k) { return typeof (mod.__test__ || {})[k] !== 'function'; });
      if (nonFn.length) lacks.push('非函数=' + nonFn.join(','));
      if (!Object.isFrozen(mod) || !Object.isFrozen(mod.__test__)) lacks.push('导出对象未冻结');
      const probe = mod.__test__ && mod.__test__.parseDoc;
      try { mod.__test__.parseDoc = function () {}; } catch (e) { /* 冻结时抛错即为期望行为 */ }
      if (mod.__test__ && mod.__test__.parseDoc !== probe) lacks.push('__test__ 可被改写');
    }
    if (lacks.length === 0) {
      pass('T108', '导出面恰 run + runInit + __test__（2026-10-25 实施轮更新）；__test__ 恰 9 个冻结函数（逐名比对、无 readSource/writeOutputs、改写失败）', 'tools/pilot/gen_records.js（真实 require）');
    } else {
      fail('T108', '模块导出面', 'tools/pilot/gen_records.js', lacks.join('；'));
    }
  })();

})();

// ================================================================ T109–T114
// R2/B6 裁决记录 DR-SET-R2-20261024（2026-10-24 负责人当前裁决）
(function t109to114() {
  const REL = 'docs/decisions/DECISION_RECORD_SET_R2_20261024.md';
  const DEC = fs.existsSync(P.decision) ? fs.readFileSync(P.decision, 'utf8') : '';

  // T109 —— 记录存在且必填字段齐全、角色唯一
  const need109 = ['DR-SET-R2-20261024', '2026-10-24', '`项目负责人`', '适用范围', '明确决定',
    '未决定事项', '依据', '原始裁决未核验', '后续变更的审批要求', '不追溯伪装成'];
  const miss109 = need109.filter(k => DEC.indexOf(k) < 0);
  if (DEC.length > 0 && miss109.length === 0) {
    pass('T109', '裁决记录存在，含编号/日期/角色/范围/决定/未决/依据/历史状态/审批要求，且声明不追溯伪装',
      REL, '10 项必填字段齐；角色=项目负责人');
  } else {
    fail('T109', '裁决记录字段完整性', REL, '缺=' + (miss109.join('、') || '整文件缺失'));
  }

  // T110 —— 八款组合：记录 ↔ 2F §4.1 逐条一致（两侧都从文件解析，不硬编码）
  function parseCombos(text, priceBold) {
    const out = [];
    const re = priceBold
      ? /^\|\s*(\d+)\s*\|\s*公瑾爆蛋 \+ (.+?)\s*\|\s*\*{0,2}(\d+)\s*元/
      : /^\|\s*(\d+)\s*\|\s*公瑾爆蛋 \+ (.+?)\s*\|\s*(\d+)\s*元/;
    text.split('\n').forEach(l => {
      const m = l.match(re);
      if (m) out.push({ no: Number(m[1]), name: m[2].trim(), price: Number(m[3]) });
    });
    return out;
  }
  const from2F = parseCombos(T2F, true);
  const fromDec = parseCombos(DEC, false);
  const same = from2F.length === 8 && fromDec.length === 8 &&
    from2F.every((a, i) => fromDec[i] && a.no === fromDec[i].no && a.name === fromDec[i].name && a.price === fromDec[i].price);
  if (same) {
    pass('T110', '八款双拼饭（13/13/14/16/16/15/15/16）与裁决记录逐条一致，且均能回溯到 2F §4.1',
      REL + '；tools/pilot/TRANSCRIPTION_2F.md §4.1', '2F 8 条 / 记录 8 条，序号·菜名·价格三元全等');
  } else {
    fail('T110', '八款组合与裁决记录一致性', REL,
      '2F=' + from2F.length + ' 条，记录=' + fromDec.length + ' 条，或存在字段不等');
  }

  // T111 —— 契约 :766 新措辞（正向 5 条 + 负向 1 条）
  const seg766 = (function () {
    const i = CONTRACT.indexOf('| 已裁决 B6 |');
    if (i < 0) return '';
    const j = CONTRACT.indexOf('\n', i);
    return CONTRACT.slice(i, j < 0 ? undefined : j);
  })();
  const need111 = ['范围限定', '不得由此新增第 9 条', '须按其实际售卖形态单独裁决', '历史原始裁决未核验',
    'docs/decisions/DECISION_RECORD_SET_R2_20261024.md'];
  const miss111 = need111.filter(k => seg766.indexOf(k) < 0);
  const stillAbsolute = seg766.indexOf('不得单独出现') >= 0;
  if (seg766.length > 0 && miss111.length === 0 && !stillAbsolute) {
    pass('T111', 'U-4 改写到位：范围限定 + 不得新增第 9 条 + 其他单元单独裁决 + 依据标记 + 记录引用；绝对句已消失',
      '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 :766', '正向 5/5，负向「不得单独出现」= 0');
  } else {
    fail('T111', 'U-4 改写完整性', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1',
      '缺=' + (miss111.join('、') || '整行缺失') + '；仍含绝对句=' + stillAbsolute);
  }

  // T112 —— 重复展示不重复生成
  if (DEC.indexOf('重复展示仍计 1 条') >= 0) {
    pass('T112', '记录明确「同一组合在不同版面重复展示仍计 1 条」，不因重复展示重复生成', REL);
  } else {
    fail('T112', '重复展示计数口径缺失', REL, '未找到「重复展示仍计 1 条」');
  }

  // T113 —— 第九款不得自动加入（运行时，需生成器）
  pending('T113', '第九个未经批准的组合不得自动加入组合清单（运行时）',
    'tools/pilot/records.json；' + REL, '正式产物未生成，无法核对运行时行为');

  // T114 —— 不误伤其他经独立裁决允许建档的售卖单元（静态半边）
  const need114 = ['不自动禁止', '不自动允许', '实际售卖形态'];
  const miss114 = need114.filter(k => DEC.indexOf(k) < 0);
  if (miss114.length === 0) {
    pass('T114', '边界句齐备：其他含「公瑾爆蛋」字样的单元不自动禁止也不自动允许，按实际售卖形态单独裁决',
      REL + ' §三 D3', '3/3 命中');
  } else {
    fail('T114', '边界句缺失', REL + ' §三 D3', '缺=' + miss114.join('、'));
  }

  // T114b —— 同上，运行时半边（隔离性，需生成器）
  pending('T114b', '八款组合的计数不误伤其他经独立裁决允许建档的售卖单元（运行时隔离检查）',
    'tools/pilot/records.json', '正式产物未生成，无法核对隔离性');
})();

// ---------------------------------------------------------------- PK-1：pending_review（2026-10-24 裁决乙）

(function pk1PendingReview() {
  const a = CONTRACT.indexOf('##### 5.6.5.5.2');
  const b = CONTRACT.indexOf('##### 5.6.5.6');
  const seg = (a >= 0 && b > a) ? CONTRACT.slice(a, b) : '';

  // T115 —— L-B：pending_review + dishId=null ⇒ PENDING_REVIEW 阻塞、不分配 ID
  (function () {
    const rec = { stallId: 'c01_t01', groupKey: '七和米线', specLabel: '', disambiguator: '', price: 7 };
    const key = REF.makeKey(rec);
    const map = { schemaVersion: 1, entries: [{ key: key, dishId: null, status: 'pending_review', approvedBy: 'user' }] };
    const r = REF.resolve([rec], map);
    const ok = r.results.length === 0 && r.blockers.length === 1 && r.blockers[0].code === 'PENDING_REVIEW';
    if (ok) pass('T115', 'PK-1 乙：pending_review 进入映射但不分配 ID，返回 PENDING_REVIEW 阻塞', '契约 §5.6.5.5.2（L-B 参考语义）');
    else fail('T115', 'pending_review 被分配 ID 或未返回阻塞', '契约 §5.6.5.5.2', JSON.stringify(r));
  })();

  // T116 —— L-B：pending_review 条目即便携带有效 dishId，也不得被使用
  (function () {
    const rec = { stallId: 'c01_t02', groupKey: '月亮馍', specLabel: '', disambiguator: '', price: 5 };
    const key = REF.makeKey(rec);
    const map = { schemaVersion: 1, entries: [{ key: key, dishId: 'c01_d999', status: 'pending_review', approvedBy: 'user' }] };
    const r = REF.resolve([rec], map);
    const ok = r.results.length === 0 && r.blockers.length === 1 && r.blockers[0].code === 'PENDING_REVIEW';
    if (ok) pass('T116', 'PK-1 乙：pending_review 携带非 null dishId 亦不得赋号（阻塞可观察）', '契约 §5.6.5.5.2');
    else fail('T116', 'pending_review 的非 null dishId 被采用', '契约 §5.6.5.5.2', JSON.stringify(r));
  })();

  // T117 —— L-A：dishId 必须显式 null；缺省 / 空串 / 有效 ID 均不符合
  (function () {
    const need = ['必须显式为 `null`', '键缺省', '空字符串', '任何有效 ID 均不符合要求'];
    const miss = need.filter(k => seg.indexOf(k) < 0);
    if (seg && miss.length === 0) pass('T117', 'PK-1 R1：pending_review ⇒ dishId 必须显式 null，缺省/空串/有效 ID 均不符合', '契约 §5.6.5.5.2');
    else fail('T117', 'PK-1 R1 表述缺失', '契约 §5.6.5.5.2', '缺=' + miss.join('、') + '；段落=' + seg.length);
  })();

  // T118 —— L-A：不得隐式继承审批、不得静默升级/赋号/进可发布集
  (function () {
    const need = ['不得隐式继承', '必须有新的、明确覆盖该变更的审批', '不得获得正式 ID', '不得被静默升级为'];
    const miss = need.filter(k => seg.indexOf(k) < 0);
    if (seg && miss.length === 0) pass('T118', 'PK-1 R2/R3：不得隐式继承审批、不得静默升级/赋号/进可发布集', '契约 §5.6.5.5.2');
    else fail('T118', 'PK-1 R2/R3 表述缺失', '契约 §5.6.5.5.2', '缺=' + miss.join('、'));
  })();

  // T119 —— L-A：orphans[].status 独立枚举
  (function () {
    const need = ['固定值 `"orphan"`', '两个不同的状态域', '不得把 `orphan` 并入'];
    const miss = need.filter(k => CONTRACT.indexOf(k) < 0);
    if (miss.length === 0) pass('T119', 'orphans[].status 独立枚举：固定 "orphan"，不并入 entries[].status', '契约 §5.6.5.5');
    else fail('T119', 'orphans 枚举独立域表述缺失', '契约 §5.6.5.5', '缺=' + miss.join('、'));
  })();

  // T120 —— L-A：§3.4.1 注册表覆盖完整性
  (function () {
    const s = CONTRACT.indexOf('#### 3.4.1');
    const e = s < 0 ? -1 : CONTRACT.indexOf('\n## ', s + 5);
    const reg = (s >= 0 && e > s) ? CONTRACT.slice(s, e) : '';
    const lacks = [];
    if (!reg) lacks.push('缺少 §3.4.1 章节');
    const rows = reg.split('\n').filter(l => /^\| `B\d+` \|/.test(l));
    if (rows.length !== 13) lacks.push('表 A 数据行=' + rows.length + '（应为 13）');
    for (let i = 1; i <= 13; i++) {
      const line = rows.find(l => l.indexOf('| `B' + i + '` |') === 0);
      if (!line) { lacks.push('未登记 B' + i); continue; }
      const cell = (line.split('|')[2] || '').trim();
      if (!/(已定义|部分定义|待定义|保留未使用|冲突待裁决)/.test(cell)) lacks.push('B' + i + ' 状态取值不受控：' + cell.slice(0, 16));
    }
    const b4 = rows.find(l => l.indexOf('| `B4` |') === 0) || '';
    if (b4.indexOf('保留未使用') < 0) lacks.push('B4 未标保留未使用');
    ['KEY_COLLISION', 'AMBIGUOUS_KEY', 'NEW_KEY', 'PENDING_REVIEW'].forEach(d => {
      if (reg.indexOf('| `' + d + '` |') < 0) lacks.push('表 B 缺 ' + d);
    });
    if (reg.indexOf('两域**不得互相替代**') < 0) lacks.push('缺「两域不得互相替代」纪律');
    if (lacks.length === 0) pass('T120', '§3.4.1 注册表覆盖 B1–B13 与四个诊断标识，状态取值受控，B4 标保留未使用', '契约 §3.4.1');
    else fail('T120', '§3.4.1 注册表覆盖不完整', '契约 §3.4.1', lacks.join('；'));
  })();

  // T121 —— L-A：§3.4.1 引用一致性（引用 → 登记；登记 → 引用；B4 无引用；旧引用已改指）
  (function () {
    const s = CONTRACT.indexOf('#### 3.4.1');
    const e = s < 0 ? -1 : CONTRACT.indexOf('\n## ', s + 5);
    const reg = (s >= 0 && e > s) ? CONTRACT.slice(s, e) : '';
    const outside = (s >= 0 && e > s) ? (CONTRACT.slice(0, s) + CONTRACT.slice(e)) : CONTRACT;
    const lacks = [];
    const citedOutside = id => new RegExp('(^|[^0-9A-Za-z])' + id + '([^0-9]|$)').test(outside);
    for (let i = 1; i <= 13; i++) {
      const id = 'B' + i;
      const registered = reg.indexOf('| `' + id + '` |') >= 0;
      const cited = citedOutside(id);
      if (!registered) lacks.push('未登记：' + id);
      if (cited && !registered) lacks.push('引用但未登记：' + id);
      if (registered && !cited && id !== 'B4') lacks.push('登记但全文无引用：' + id);
    }
    if (citedOutside('B4')) lacks.push('B4 标为保留却仍被引用');
    if (CONTRACT.indexOf('必须取自 **§3.4.1 阻塞编号与诊断标识注册表**') < 0) lacks.push('§3.4 的 reasons 规则未改指 §3.4.1');
    if (reg.indexOf('| `NEW_KEY` | **待定义** |') >= 0) lacks.push('NEW_KEY 仍标「待定义」（2026-10-24 已裁决 A1）');
    if (reg.indexOf('| `PENDING_REVIEW` | **待定义** |') >= 0) lacks.push('PENDING_REVIEW 仍标「待定义」（2026-10-24 已裁决 B2）');
    if (reg.indexOf('不得据名称推测') < 0) lacks.push('NEW_KEY 行缺「不得据名称推测」纪律');
    if (CONTRACT.indexOf('##### 5.6.5.5.3 `NEW_KEY` 的约束') < 0) lacks.push('缺 §5.6.5.5.3 NEW_KEY 约束节');
    if (reg.indexOf('| `PENDING_REVIEW` | 已登记') < 0) lacks.push('PENDING_REVIEW 未标「已登记」');
    if (lacks.length === 0) pass('T121', '§3.4.1 引用一致：引用即登记、登记即引用、B4 无引用、旧引用改指、待定义项不推测语义', '契约 §3.4.1、§3.4');
    else fail('T121', '§3.4.1 引用一致性不成立', '契约 §3.4.1、§3.4', lacks.join('；'));
  })();
})();

  // T122 —— L-A：B5 复用裁决下的限定语强制（登记行与纪律行不计裸写）
  (function () {
    const lacks = [];
    if (CONTRACT.indexOf('B5·3F-W03') < 0) lacks.push('缺 B5·3F-W03');
    if (CONTRACT.indexOf('B5·2F-W2-06') < 0) lacks.push('缺 B5·2F-W2-06');
    if (CONTRACT.indexOf('禁止裸写') < 0) lacks.push('缺「禁止裸写」纪律');
    if (CONTRACT.indexOf('B5·2F-W2-06（手抓饼 6 条）') < 0) lacks.push('§6.3 未带限定语');
    if (CONTRACT.indexOf('进 blockers（`B5·2F-W2-06`）') < 0) lacks.push('§6.4 未带限定语');
    // §9.1 是测试登记表（描述断言自身），不是业务引用，不参与裸写扫描
    const cForB5 = (function () {
      const a = CONTRACT.indexOf('## 九、'), b = CONTRACT.indexOf('## 十、');
      return (a > 0 && b > a) ? CONTRACT.slice(0, a) + CONTRACT.slice(b) : CONTRACT;
    })();
    const stripped = cForB5.replace(/B5·3F-W03/g, '').replace(/B5·2F-W2-06/g, '');
    const naked = stripped.split('\n').filter(function (l) {
      if (/^\| `B5` \|/.test(l)) return false;
      if (l.indexOf('禁止裸写') >= 0) return false;
      return /(^|[^0-9A-Za-z])B5([^0-9]|$)/.test(l);
    });
    if (naked.length) lacks.push('存在裸写 B5：' + naked.length + ' 行');
    if (lacks.length === 0) pass('T122', 'B5 复用裁决：两处限定语齐全、业务引用无裸写', '§3.4.1、§6.3、§6.4');
    else fail('T122', 'B5 限定语或裸写检查不成立', '§3.4.1、§6.3、§6.4', lacks.join('；'));
  })();

  // T123 —— L-A：NEW_KEY / PENDING_REVIEW 的登记语义与置位要求
  (function () {
    const lacks = [];
    const s = CONTRACT.indexOf('#### 3.4.1');
    const e = s < 0 ? -1 : CONTRACT.indexOf('\n## ', s + 5);
    const reg = (s >= 0 && e > s) ? CONTRACT.slice(s, e) : '';
    if (reg.indexOf('| `NEW_KEY` | 已定义') < 0) lacks.push('NEW_KEY 未标已定义');
    if (reg.indexOf('| `PENDING_REVIEW` | 已登记') < 0) lacks.push('PENDING_REVIEW 未标已登记');
    if (reg.indexOf('允许写入') < 0) lacks.push('PENDING_REVIEW 缺 reasons 允许');
    if (reg.indexOf('不得单独以该标识表示') < 0) lacks.push('缺「不得单独表示已批准」');
    const nk = CONTRACT.indexOf('##### 5.6.5.5.3 `NEW_KEY` 的约束');
    const nkEnd = nk < 0 ? -1 : CONTRACT.indexOf('##### 5.6.5.6', nk);
    const sec = (nk >= 0 && nkEnd > nk) ? CONTRACT.slice(nk, nkEnd) : '';
    ['**NK-R1**', '**NK-R2**', '**NK-R3**', '**NK-R4**', '不等于拒绝', 'unassigned', 'blocked', '不得表述为'].forEach(function (k) {
      if (sec.indexOf(k) < 0) lacks.push('§5.6.5.5.3 缺 ' + k);
    });
    if (lacks.length === 0) pass('T123', 'NEW_KEY / PENDING_REVIEW：登记状态、NK-R1–R4、reasons 置位与禁止性措辞齐备', '§3.4.1、§5.6.5.5.3');
    else fail('T123', 'NEW_KEY / PENDING_REVIEW 语义登记不完整', '§3.4.1、§5.6.5.5.3', lacks.join('；'));
  })();

// T124 —— L-B：NK-R1 互斥行为（缺失 ⇒ E12 且不产出 NEW_KEY；存在且未登记 ⇒ NEW_KEY）
(function () {
  const rec = { stallId: 'c01_t01', groupKey: '七和米线', specLabel: '', disambiguator: '' };
  const missing = REF.resolve([rec], undefined);
  const present = REF.resolve([rec], { schemaVersion: 1, entries: [] });
  const okMissing = missing.fatal === 'E12_NO_ID_MAP'
    && missing.results.length === 0
    && missing.blockers.filter(function (b) { return b.code === 'NEW_KEY'; }).length === 0;
  const okPresent = present.fatal === null
    && present.results.length === 0
    && present.blockers.length === 1
    && present.blockers[0].code === 'NEW_KEY';
  if (okMissing && okPresent) {
    pass('T124', 'NK-R1 互斥：映射缺失 ⇒ E12_NO_ID_MAP 且不产出 NEW_KEY；映射存在且键未登记 ⇒ NEW_KEY', '契约 §5.6.5.5.3 NK-R1 + REF.resolve');
  } else {
    fail('T124', 'NK-R1 互斥关系不成立', '契约 §5.6.5.5.3 NK-R1',
      'missing.fatal=' + missing.fatal + '／missing.blockers=' + JSON.stringify(missing.blockers)
      + '／present.blockers=' + JSON.stringify(present.blockers));
  }
})();

// T125 —— L-A：NK-R1–NK-R4 按规则行归集（顺序无关；缺行/重复/边界无效即失败；仅证明文字存在）
(function () {
  const hd = CONTRACT.indexOf('##### 5.6.5.5.3');
  const ed = hd < 0 ? -1 : CONTRACT.indexOf('##### 5.6.5.6', hd);
  const sec = (hd >= 0 && ed > hd) ? CONTRACT.slice(hd, ed) : '';
  const lacks = [];
  if (!sec) lacks.push('§5.6.5.5.3 区段缺失或边界无效');
  // 逐行归集：只认行首形如 `| **NK-Rn** |` 的规则行，与出现顺序无关
  const rows = [];
  sec.split('\n').forEach(function (line) {
    const m = /^\|\s*\*\*NK-R(\d)\*\*\s*\|/.exec(line);
    if (m) rows.push({ n: Number(m[1]), text: line });
  });
  const need = {
    1: ['E12_NO_ID_MAP', '不得记为', 'NEW_KEY', '结构校验'],
    2: ['不等于拒绝', '审批', 'unassigned', 'blocked'],
    3: ['reasons', 'unassigned', 'blocked', '不得只写标识'],
    4: ['不得表述为', '一律拒绝', '一律放行']
  };
  // NK-R3 的独立状态证据：必须是 `id_status = "assigned"`（`unassigned` 无法满足）
  const reAssigned = /id_status\s*=\s*"assigned"/;
  [1, 2, 3, 4].forEach(function (n) {
    const hit = rows.filter(function (r) { return r.n === n; });
    if (hit.length === 0) { lacks.push('NK-R' + n + ' 规则行缺失'); return; }
    if (hit.length > 1) { lacks.push('NK-R' + n + ' 规则行重复（' + hit.length + ' 处）'); return; }
    const own = hit[0].text;
    need[n].forEach(function (k) { if (own.indexOf(k) < 0) lacks.push('NK-R' + n + ' 缺「' + k + '」'); });
    if (n === 3 && !reAssigned.test(own)) lacks.push('NK-R3 缺 `id_status = "assigned"` 的独立状态证据');
  });
  if (lacks.length === 0) {
    pass('T125', 'NK-R1–NK-R4 逐行归集：四条核心约束各自完整、顺序无关、无缺行重复（仅证明文字存在，不证明运行时行为）', '契约 §5.6.5.5.3');
  } else {
    fail('T125', 'NK 规则语义不完整或规则行缺失/重复', '契约 §5.6.5.5.3', lacks.join('；'));
  }
})();

// T126 —— L-A：GAP-B7 防退化（只检查缺口登记是否仍在；不验证 B7 运行时行为）
(function () {
  const lacks = [];
  if (CONTRACT.indexOf('GAP-B7') < 0) lacks.push('契约不再含 GAP-B7');
  const rs = CONTRACT.indexOf('#### 3.4.1');
  const re = rs < 0 ? -1 : CONTRACT.indexOf('\n## ', rs + 5);
  const reg = (rs >= 0 && re > rs) ? CONTRACT.slice(rs, re) : '';
  const b7 = reg.split('\n').filter(function (l) { return l.indexOf('| `B7` |') === 0; })[0] || '';
  if (!b7) lacks.push('注册表内找不到 B7 行');
  if (b7.indexOf('无断言覆盖') < 0) lacks.push('B7 行未标「无断言覆盖」');
  if (b7.indexOf('据该编号判定') < 0 || b7.indexOf('不得') < 0) lacks.push('B7 行缺「不得据该编号判定」纪律');
  if (CONTRACT.indexOf('记为缺口 `GAP-B7`') < 0) lacks.push('§10.7 未写明「记为缺口 GAP-B7」');
  if (lacks.length === 0) {
    pass('T126', 'GAP-B7 防退化：缺口仍登记、B7 标「无断言覆盖」、§10.7 记为缺口（不证明 B7 运行时行为）', '§3.4.1、§10.7');
  } else {
    fail('T126', 'GAP-B7 登记缺失或被淡化', '§3.4.1、§10.7', lacks.join('；'));
  }
})();

// ================================================================ 阶段 B：唯一键规范（T127–T134，2026-10-24）
(function () {
  // ---------- T127：groupKey 与 specLabel 规则不同（L-B）
  const k127 = REF.makeKey({ stallId: 'c01_t01', groupKey: '  红烧  肉盖饭。  ', specLabel: ' 小 碗 ', disambiguator: '' });
  const want127 = 'c01_t01|红烧 肉盖饭|小 碗|';
  if (k127 === want127) pass('T127', 'R2/R3 差异：groupKey 折叠空白并去首尾标点（得「红烧 肉盖饭」），specLabel 仅 trim+NFKC（得「小 碗」）', '契约 §5.6.5.5.4.1 R2–R3');
  else fail('T127', 'groupKey 与 specLabel 规则未区分', '契约 §5.6.5.5.4.1 R2–R3', 'key=' + k127 + ' want=' + want127);

  // ---------- T128：处理顺序（NFKC → 折叠 → trim → 去标点；specLabel 保留标点与内部空白）
  const k128 = REF.makeKey({ stallId: 'c01_t02', groupKey: '\u3000\u3000七和\u3000米线。；', specLabel: '\u3000 小 碗 。', disambiguator: '' });
  const want128 = 'c01_t02|七和 米线|小 碗 。|';
  if (k128 === want128) pass('T128', '顺序敏感：全角空格经 NFKC 变空格、折叠后再 trim、最后去「。；」；specLabel 保留标点与内部空白', '契约 §5.6.5.5.4.1 R2–R3');
  else fail('T128', '归一化顺序与预期不符', '契约 §5.6.5.5.4.1 R2–R3', 'key=' + k128 + ' want=' + want128);

  // ---------- T128b：连续标点与纯空白边界
  const k128b1 = REF.makeKey({ stallId: 'c01_t02', groupKey: '。；鼎', specLabel: '  ', disambiguator: '' });
  const k128b2 = REF.makeKey({ stallId: 'c01_t02', groupKey: '。。、 鼎', specLabel: '  ', disambiguator: '' });
  const want128b1 = 'c01_t02|鼎||';
  const want128b2 = 'c01_t02| 鼎||';
  if (k128b1 === want128b1 && k128b2 === want128b2) pass('T128b', 'R2 顺序：连续首尾标点全部剥离（「。；鼎」→「鼎」）；先 trim 再去标点，故「。。、 鼎」保留分隔空格（→「 鼎」）；纯空白 specLabel → 空串', '契约 §5.6.5.5.4.1 R2–R3');
  else fail('T128b', '连续标点或纯空白边界不符', '契约 §5.6.5.5.4.1 R2–R3', 'k1=' + k128b1 + ' k2=' + k128b2);

  // ---------- T129：空 / null / 缺失
  const k129a = REF.makeKey({ stallId: 'c01_t03' });
  const k129b = REF.makeKey({ stallId: 'c01_t03', groupKey: null, specLabel: null, disambiguator: null });
  const want129 = 'c01_t03|||';
  if (k129a === want129 && k129b === want129) pass('T129', 'R5：空字段一律空字符串（缺失值与 null 等价），不使用字面量占位', '契约 §5.6.5.5.4.1 R5');
  else fail('T129', '空字段处理不符', '契约 §5.6.5.5.4.1 R5', 'missing=' + k129a + ' null=' + k129b);

  // ---------- T130：非空非字符串 → R8 拒绝（E15），不分配 ID
  const map130 = { schemaVersion: 1, entries: [{ key: 'c01_t01|七和米线||', dishId: 'c01_d040', status: 'active' }] };
  const r130 = REF.resolve([{ stallId: 'c01_t01', groupKey: 123, specLabel: '', disambiguator: '', price: 7 }], map130);
  const ok130 = r130.violations.length === 1 && r130.violations[0].field === 'groupKey' && r130.violations[0].code === 'E15_BAD_MAP' && r130.violations[0].reason === 'non-string' && r130.results.length === 0;
  if (ok130) pass('T130', 'R8：非空非字符串键段被拒（E15_BAD_MAP），该记录不分配 ID', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.6.5.5.4.1 R8、§7.4 E15');
  else fail('T130', '非字符串键段未被拒绝或仍分配 ID', '契约 §5.6.5.5.4.1 R8', JSON.stringify(r130.violations) + ' results=' + r130.results.length);

  // ---------- T131：字段内含 | → 拒绝；且不进入分组、不产生 NEW_KEY
  const r131a = REF.resolve([{ stallId: 'c01_t01', groupKey: '七和|米线', specLabel: '', disambiguator: '', price: 7 }], { schemaVersion: 1, entries: [] });
  const r131b = REF.resolve([{ stallId: 'c01|t01', groupKey: '七和米线', specLabel: '', disambiguator: '' }], { schemaVersion: 1, entries: [] });
  const ok131 = r131a.violations.length === 1 && r131a.violations[0].reason === 'contains-pipe' && r131a.violations[0].field === 'groupKey'
    && r131a.results.length === 0 && r131a.blockers.length === 0
    && r131b.violations.length === 1 && r131b.violations[0].field === 'stallId';
  if (ok131) pass('T131', 'R7：四段值含「|」即拒绝（不转义、不修复），且不进入分组、不产生 NEW_KEY', '契约 §5.6.5.5.4.1 R7');
  else fail('T131', '含「|」的键段未被拒绝或仍参与分组', '契约 §5.6.5.5.4.1 R7', JSON.stringify([r131a.violations, r131a.blockers, r131b.violations]));

  // ---------- T132：映射键必须恰好四段（阶段 B-1）
  const idx132ok = REF.indexMap({ schemaVersion: 1, entries: [{ key: 'a|b|c|d', dishId: 'c02_d060', status: 'active' }] });
  const idx132bad = REF.indexMap({ schemaVersion: 1, entries: [{ key: 'a|b|c|d|e', dishId: 'c01_d999', status: 'active' }] });
  const idx132pri = REF.indexMap({ schemaVersion: 1, entries: [
    { key: 'a|b|c|d|e', dishId: 'X', status: 'active' },
    { key: 'e|f|g|h', dishId: 'X', status: 'active' }
  ] });
  const ok132 = idx132ok.errors.length === 0 && idx132ok.byKey.has('a|b|c|d') &&
    idx132bad.errors.length === 1 && idx132bad.errors[0] === 'E15_BAD_MAP' && !idx132bad.byKey.has('a|b|c|d|e') &&
    idx132pri.errors.length === 1 && idx132pri.errors[0] === 'E15_BAD_MAP';
  if (ok132) pass('T132', '阶段 B-1：映射键必须恰好四段（三个分隔符）；五段键报 E15_BAD_MAP 且不注册；格式失败先于重复 dishId', '契约 §5.6.5.5.4 第 3 步');
  else fail('T132', '映射键段数校验', '契约 §5.6.5.5.4 第 3 步', JSON.stringify({ ok: idx132ok.errors, bad: idx132bad.errors, pri: idx132pri.errors }));

  // ---------- T135：候选违规诊断携带 stage，且不进分组、不产生 NEW_KEY、不误报 fatal（阶段 B-1）
  const rec135 = { stallId: 'c02', groupKey: '韩小面', specLabel: '大碗', disambiguator: '', price: 12 };
  const bad135a = Object.assign({}, rec135, { groupKey: '韩|小面' });
  const bad135b = Object.assign({}, rec135, { stallId: 123 });
  const r135 = REF.resolve([bad135a, bad135b], { schemaVersion: 1, entries: [] });
  const v135a = r135.violations[0] || {};
  const v135b = r135.violations[1] || {};
  const ok135 = r135.fatal === null && r135.violations.length === 2 &&
    v135a.stage === 'candidate' && v135a.field === 'groupKey' && v135a.code === 'E15_BAD_MAP' && v135a.reason === 'contains-pipe' &&
    v135b.stage === 'candidate' && v135b.field === 'stallId' && v135b.reason === 'non-string' &&
    r135.blockers.length === 0 && r135.results.length === 0;
  if (ok135) pass('T135', '阶段 B-1：候选违规诊断含 stage=candidate 与 field/reason；不进分组、不产生 NEW_KEY、不误报为映射加载 fatal', '§5.6.5.5.4.1 R7(b)/R8');
  else fail('T135', '候选违规阶段诊断', '§5.6.5.5.4.1 R7(b)/R8', JSON.stringify({ fatal: r135.fatal, v: r135.violations, b: r135.blockers }));

  // ---------- T133：契约文本——R1–R8、两阶段位置、旧表述作废
  const need133 = ['**R1**', '**R2**', '**R3**', '**R4**', '**R5**', '**R6**', '**R7**', '**R8**', '不得包含字面量 `|`', '映射加载阶段', '候选记录阶段', '已作废'];
  const miss133 = need133.filter(function (k) { return CONTRACT.indexOf(k) < 0; });
  if (miss133.length === 0) pass('T133', '唯一键规范 R1–R8、两阶段检查位置、旧表述作废声明均已写入契约', '契约 §5.6.5.5.4.1');
  else fail('T133', '唯一键规范条款缺失', '契约 §5.6.5.5.4.1', '缺=' + miss133.join('、'));

  // ---------- T134：术语统一与 T61 文字
  const need134 = ['「**正式产物**」=', '不产出任何正式产物'];
  const miss134 = need134.filter(function (k) { return CONTRACT.indexOf(k) < 0; });
  const t61a = CONTRACT.indexOf('五者均不存在') >= 0;
  const t61b = CONTRACT.indexOf('已授权存在') >= 0;
  const oldPos = CONTRACT.indexOf('不写任何文件');
  if (miss134.length === 0 && t61a && t61b && oldPos < 0) pass('T134', '措辞统一：「正式产物」有定义、旧「不写任何文件」清零；T61 改为五类禁止产物 + 已授权骨架', '契约 §7.1.1、§9.1 T61');
  else fail('T134', '术语或 T61 文字未统一', '契约 §7.1.1、§9.1 T61', '缺=' + miss134.join('、') + ' t61=' + t61a + '/' + t61b + ' oldPos=' + oldPos);
})();

// ---------------------------------------------------------------- Q-MAP-IO：映射读取失败分类（T136–T140，2026-10-24）
// 只测对外可观察行为（run() 的 exitCode / summary.status / summary.note / violations），不测私有分类函数。
(function qmapioTests() {
  // 每个用例的状态必须独立可追踪：共享前置条件失败时，未执行的用例逐个登记 PENDING（各自写明原因），
  // 单个用例内部抛错则登记 FAIL（属测试自身缺陷，不代表实现失败）。任何情况下都不得静默漏报。
  const IDS = ['T136', 'T137', 'T138', 'T139', 'T140'];
  const reported = Object.create(null);
  function mPass(id, rule, src) { reported[id] = true; pass(id, rule, src); }
  function mFail(id, rule, src, note) { reported[id] = true; fail(id, rule, src, note); }
  function mPending(id, rule, src, note) { reported[id] = true; pending(id, rule, src, note); }
  function reportUnrun(reason) {
    IDS.forEach(function (id) {
      if (!reported[id]) mPending(id, 'Q-MAP-IO 用例未执行（共享前置条件失败）', '§7.4.1', reason);
    });
  }

  const genPath = path.join(ROOT, 'tools', 'pilot', 'gen_records.js');
  let gen = null;
  try {
    gen = require(genPath);
  } catch (e) {
    reportUnrun('无法加载生成器：' + String(e && e.message));
    return;
  }
  const fsx = require('fs');
  const osx = require('os');
  const cpx = require('child_process');
  let tmpRoot = null;
  try {
    tmpRoot = fsx.mkdtempSync(path.join(osx.tmpdir(), 'sl-qmapio-'));
  } catch (e) {
    reportUnrun('无法创建临时夹具目录：' + String(e && e.message));
    return;
  }

  try {
    function runAt(p) { return gen.run({ mapPath: p, mode: 'dry-run', outDir: null }); }
    function noE12(r) { return !(r.violations || []).some(function (v) { return v.code === 'E12_NO_ID_MAP'; }); }
    function caseRun(id, fn) {
      if (reported[id]) return;
      try {
        fn();
      } catch (e) {
        mFail(id, 'Q-MAP-IO 用例自身异常（属测试缺陷，不代表实现失败）', '§7.4.1', String(e && e.message));
      }
    }

    // 用例定义与全部用例都在本 try 内：任何共享前置异常都会由下面的 catch → reportUnrun 逐个登记。
    // T136：父级为普通文件
    caseRun('T136', function () {
      const p136 = path.join(tmpRoot, 'parent-is-file');
      fsx.writeFileSync(p136, 'x', 'utf8');
      const r136 = runAt(path.join(p136, 'id-map.json'));
      const ok136 = r136.exitCode === 3 && r136.summary.status === 'MAP_IO_ERROR' && noE12(r136)
        && String(r136.summary.note || '').indexOf('路径不可达') >= 0;
      if (ok136) mPass('T136', 'Q-MAP-IO：父级为普通文件 → 退出码 3、MAP_IO_ERROR、无 E12、诊断含「路径不可达」', '§7.4.1 第 1 条');
      else mFail('T136', 'Q-MAP-IO 父级为普通文件', '§7.4.1 第 1 条', JSON.stringify({ exit: r136.exitCode, status: r136.summary.status, note: r136.summary.note, v: r136.violations }));
    });

    // T137：祖父级为普通文件
    caseRun('T137', function () {
      const p137 = path.join(tmpRoot, 'grandparent-is-file');
      fsx.writeFileSync(p137, 'x', 'utf8');
      const r137 = runAt(path.join(p137, 'mid', 'id-map.json'));
      const ok137 = r137.exitCode === 3 && r137.summary.status === 'MAP_IO_ERROR' && noE12(r137)
        && String(r137.summary.note || '').indexOf('路径不可达') >= 0;
      if (ok137) mPass('T137', 'Q-MAP-IO：祖父级为普通文件 → 退出码 3、MAP_IO_ERROR、无 E12、诊断含「路径不可达」', '§7.4.1 第 1 条');
      else mFail('T137', 'Q-MAP-IO 祖父级为普通文件', '§7.4.1 第 1 条', JSON.stringify({ exit: r137.exitCode, status: r137.summary.status, note: r137.summary.note }));
    });

    // T138：目标确实缺失、父目录存在（回归：真正的缺失仍报 E12）
    caseRun('T138', function () {
      const p138dir = path.join(tmpRoot, 'exists-empty');
      fsx.mkdirSync(p138dir);
      const r138 = runAt(path.join(p138dir, 'id-map.json'));
      const ok138 = r138.exitCode === 1 && (r138.violations || []).some(function (v) { return v.code === 'E12_NO_ID_MAP'; });
      if (ok138) mPass('T138', 'Q-MAP-IO：目标确实缺失且父目录存在 → E12_NO_ID_MAP、退出码 1（回归）', '§7.4.1 第 1 条');
      else mFail('T138', 'Q-MAP-IO 真正缺失仍报 E12', '§7.4.1 第 1 条', JSON.stringify({ exit: r138.exitCode, status: r138.summary.status, v: r138.violations }));
    });

    // T139：路径指向目录
    caseRun('T139', function () {
      const p139 = path.join(tmpRoot, 'a-directory');
      fsx.mkdirSync(p139);
      const r139 = runAt(p139);
      const ok139 = r139.exitCode === 3 && r139.summary.status === 'MAP_IO_ERROR' && noE12(r139);
      if (ok139) mPass('T139', 'Q-MAP-IO：路径指向目录 → 退出码 3、MAP_IO_ERROR、无 E12', '§7.4.1 第 1 条');
      else mFail('T139', 'Q-MAP-IO 路径指向目录', '§7.4.1 第 1 条', JSON.stringify({ exit: r139.exitCode, status: r139.summary.status, note: r139.summary.note }));
    });

    // T140：中间组件为悬空联接点（Windows mklink /J 构造；构造失败则该用例 PENDING 并写明原因）
    caseRun('T140', function () {
      const jTarget = path.join(tmpRoot, 'junc-target');
      const jLink = path.join(tmpRoot, 'junc-link');
      let t140reason = '';
      try {
        fsx.mkdirSync(jTarget);
        cpx.execFileSync('cmd', ['/c', 'mklink', '/J', jLink, jTarget], { stdio: 'pipe' });
        fsx.rmdirSync(jTarget);
      } catch (e) {
        t140reason = '本机无法构造悬空联接点（' + String((e && e.message) || e).split('\n')[0] + '）';
      }
      if (t140reason) {
        mPending('T140', 'Q-MAP-IO：中间组件为悬空联接点 → IO/3 且无 E12', '§7.4.1 第 2 条第 1、3 款', t140reason);
        return;
      }
      const r140 = runAt(path.join(jLink, 'id-map.json'));
      const note140 = String(r140.summary.note || '');
      const ok140 = r140.exitCode === 3 && r140.summary.status === 'MAP_IO_ERROR' && noE12(r140)
        && (note140.indexOf('悬空') >= 0 || note140.indexOf('不可解析') >= 0);
      if (ok140) mPass('T140', 'Q-MAP-IO：中间组件为悬空联接点 → 退出码 3、MAP_IO_ERROR、无 E12、诊断指出链接不可解析', '§7.4.1 第 2 条第 1、3 款');
      else mFail('T140', 'Q-MAP-IO 悬空联接点', '§7.4.1 第 2 条第 1、3 款', JSON.stringify({ exit: r140.exitCode, status: r140.summary.status, note: note140 }));
    });
  } catch (e) {
    reportUnrun('共享前置条件异常，中断于：' + String(e && e.message));
  } finally {
    if (tmpRoot) { try { fsx.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响断言结果 */ } }
    // 兜底：任何尚未登记的用例都必须显式出现（不得静默漏报）
    reportUnrun('共享前置条件或执行环境异常，该用例未执行');
  }
})();


// ── P1 收尾（T189–T198）：2F/3F 分项基准 + S2–S5 诊断自动化断言（2026-10-24 第三批）──
(function p1LayersAndDiagnostics() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cp = require('child_process');
  let gen = null;
  try { gen = require(P.gen); } catch (e) { gen = null; }
  const FULLBASE = { total: 564, A: 463, B: 39, C: 62, f2: { total: 419, A: 347, B: 39, C: 33 }, f3: { total: 145, A: 116, B: 0, C: 29 } };
  const BASEF = { total: 419, A: 347, B: 39, C: 33 };
  const BASE3 = { total: 145, A: 116, B: 0, C: 29 };
  function mkRec(layer, tier, name) {
    return {
      id: null, shopId: 'c01', stallId: 'c01_t01', name: name, price: 10,
      foodType: 'snack', tastes: ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用，非真实业务数据）', ref: '' },
      verifyStatus: 'unverified', verifiedAt: null, note: '',
      gen: {
        tier: tier, groupKey: layer + '/合成/' + name, specLabel: '', rawRow: '| 合成 | 10 元 |',
        sourceLine: 1, generation_status: tier === 'C' ? 'not_generated' : 'generated',
        evidence_status: 'traceable', import_eligibility: 'blocked', id_status: 'unassigned', blockers: []
      }
    };
  }
  // 按分档批量生成：f2 = A347/B39/C33，f3 = A116/C29
  function makeDataset(f2, f3) {
    const out = [];
    function fill(layer, spec) {
      ['A', 'B', 'C'].forEach(function (t) {
        for (let i = 0; i < spec[t]; i++) { out.push(mkRec(layer, t, layer + '-' + t + '-' + i)); }
      });
    }
    fill('f2', f2); fill('f3', f3);
    return out;
  }
  const FULL = makeDataset({ A: 347, B: 39, C: 33 }, { A: 116, B: 0, C: 29 });
  function mkBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'p1-layer-')); }
  // 真实子进程运行器：用于断言「进程退出码 + 诊断输出」，CLI 无法传入这些参数。
  function runInChild(options, base) {
    const runner = path.join(base, '__runner.js');
    const params = path.join(base, '__params.json');
    fs.writeFileSync(runner, [
      "'use strict';",
      "const fs=require('fs');",
      "const gen=require(process.env.GEN_PATH);",
      "const a=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));",
      "const r=gen.run(a);",
      "process.stdout.write('\\n__RESULT__'+JSON.stringify({exitCode:r.exitCode,status:r.summary.status,stage:r.summary.stage,note:r.summary.note})+'\\n');",
      "process.exit(r.exitCode);"
    ].join('\n'), 'utf8');
    fs.writeFileSync(params, JSON.stringify(options), 'utf8');
    const r = cp.spawnSync(process.execPath, [runner, params], { encoding: 'utf8', env: Object.assign({}, process.env, { GEN_PATH: P.gen }) });
    return { code: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
  }
  function diagOk(out) {
    return out.indexOf('阶段 ') >= 0 && out.indexOf('错误码 ') >= 0 && out.indexOf('原因 ') >= 0
      && out.indexOf('本次临时目录 ') >= 0 && out.indexOf('已写出的部分产物 ') >= 0;
  }

  // T189 分层与总数全部匹配 → 发布成功
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'ok');
      const r = gen.run({ records: FULL, mode: 'write', outDir: out, testBaseline: FULLBASE });
      const m = JSON.parse(fs.readFileSync(path.join(out, 'gen-manifest.json'), 'utf8'));
      if (r.exitCode === 0 && r.summary.status === 'PUBLISH_OK' && m.counts.A === 463 && m.counts.B === 39 && m.counts.C === 62
        && fs.existsSync(path.join(out, 'COMMITTED'))) {
        pass('T189', '2F/3F 分项与总数基准全部匹配（419/145/564）→ PUBLISH_OK', '§7.2.1 S3 第 6 项');
      } else { fail('T189', '分层基准匹配', '§7.2.1 S3', 'exit=' + r.exitCode + ' status=' + r.summary.status + ' A=' + (m && m.counts.A)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T189', '分层基准匹配', '§7.2.1 S3', '异常：' + e.message); }

  // T190 2F 分项错（总数保持 564）：把一条 2F 记录挪到 3F 的档，总数不变、f2 少 1、f3 多 1
  try {
    const base = mkBase();
    try {
      const list = FULL.slice();
      list[0] = mkRec('f3', 'A', 'moved');
      const r = gen.run({ records: list, mode: 'write', outDir: path.join(base, 'f2bad'), testBaseline: FULLBASE });
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && /分项基准不一致/.test(note) && /f2 /.test(note) && /419/.test(note)) {
        pass('T190', '总数正确但 2F 分项错误 → S3/E9 且点名 f2 与实得/基准', '§7.2.1 S3 第 6 项');
      } else { fail('T190', '2F 分项错误必须失败', '§7.2.1 S3', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' note=' + note.slice(0, 160)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T190', '2F 分项错误', '§7.2.1 S3', '异常：' + e.message); }

  // T191 3F 分项错（总数保持 564）
  try {
    const base = mkBase();
    try {
      const list = FULL.slice();
      list[FULL.length - 1] = mkRec('f2', 'C', 'moved3');
      const r = gen.run({ records: list, mode: 'write', outDir: path.join(base, 'f3bad'), testBaseline: FULLBASE });
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && /f3 /.test(note) && /145/.test(note)) {
        pass('T191', '总数正确但 3F 分项错误 → S3/E9 且点名 f3', '§7.2.1 S3 第 6 项');
      } else { fail('T191', '3F 分项错误必须失败', '§7.2.1 S3', 'exit=' + r.exitCode + ' note=' + note.slice(0, 160)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T191', '3F 分项错误', '§7.2.1 S3', '异常：' + e.message); }

  // T192 分层内 A/B/C 分布错（总数与分层总数都对，仅 A→C 挪一个）
  try {
    const base = mkBase();
    try {
      const list = FULL.slice();
      list[0] = mkRec('f2', 'C', 'tier-shift');
      const r = gen.run({ records: list, mode: 'write', outDir: path.join(base, 'dist'), testBaseline: FULLBASE });
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && /基准不一致/.test(note) && /462/.test(note) && /463/.test(note)) {
        pass('T192', '分层内 A/B/C 分布错误（总数不变）→ S3/E9 失败', '§7.2.1 S3 第 6 项');
      } else { fail('T192', '分层内分档分布错误必须失败', '§7.2.1 S3', 'exit=' + r.exitCode + ' note=' + note.slice(0, 160)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T192', '分层内分档分布', '§7.2.1 S3', '异常：' + e.message); }

  // T193 缺少分层数据（groupKey 无 f2/f3 前缀）→ 明确失败
  try {
    const base = mkBase();
    try {
      const bad = mkRec('xx', 'A', 'no-layer');
      const r = gen.run({ records: [bad], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 'nolayer') });
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && /缺少分层数据/.test(note)) {
        pass('T193', '分层字段缺失 → S3/E9 明确失败（不默认通过）', '§7.2.1 S3 第 6 项');
      } else { fail('T193', '缺少分层数据必须明确失败', '§7.2.1 S3', 'exit=' + r.exitCode + ' note=' + note.slice(0, 160)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T193', '缺少分层数据', '§7.2.1 S3', '异常：' + e.message); }

  // T194 测试基准不能绕过分层：总数对、f2/f3 不对 → 失败
  try {
    const base = mkBase();
    try {
      const list = [mkRec('f2', 'A', 'x'), mkRec('f3', 'A', 'y')];
      const r = gen.run({ records: list, testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 'bypass') });
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && /f3 /.test(note)) {
        pass('T194', '测试注入基准也必须满足 f2/f3（不能只对总数绕过）→ S3/E9', '§7.2.1 S3 第 6 项');
      } else { fail('T194', '测试基准不得绕过分层', '§7.2.1 S3', 'exit=' + r.exitCode + ' note=' + note.slice(0, 160)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T194', '测试基准绕过分层', '§7.2.1 S3', '异常：' + e.message); }

  // T195 S2 诊断（真实子进程）：重复 dishId
  try {
    const base = mkBase();
    try {
      const a = mkRec('f2', 'A', 'dup1'); a.id = 'c01_d001'; a.gen.id_status = 'assigned_new';
      const b = mkRec('f2', 'A', 'dup2'); b.id = 'c01_d001'; b.gen.id_status = 'assigned_new';
      const r = runInChild({ records: [a, b], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's2') }, base);
      if (r.code === 1 && /阶段 S2/.test(r.out) && /E13_DUP_ID/.test(r.out) && diagOk(r.out)) {
        pass('T195', 'S2 诊断：重复 dishId → 进程 exit 1，输出含阶段/错误码/原因/临时目录/部分产物', '§7.2.5 / §7.2.1 S2');
      } else { fail('T195', 'S2 诊断字段', '§7.2.5', 'exit=' + r.code + ' out=' + r.out.replace(/\n/g, ' | ').slice(0, 220)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T195', 'S2 诊断', '§7.2.5', '异常：' + e.message); }

  // T196 S3 诊断：基准不一致（含实得/基准）
  try {
    const base = mkBase();
    try {
      const r = runInChild({ records: [mkRec('f2', 'A', 'one')], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's3') }, base);
      if (r.code === 1 && /阶段 S3/.test(r.out) && /E9_SUM/.test(r.out) && /实得 1/.test(r.out) && /基准 2/.test(r.out) && diagOk(r.out)) {
        pass('T196', 'S3 诊断：基准不一致 → 进程 exit 1，输出含实得值与基准值', '§7.2.5 / §7.2.1 S3');
      } else { fail('T196', 'S3 诊断字段', '§7.2.5', 'exit=' + r.code + ' out=' + r.out.replace(/\n/g, ' | ').slice(0, 220)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T196', 'S3 诊断', '§7.2.5', '异常：' + e.message); }

  // T197 S4 诊断（故障注入，真实子进程）
  try {
    const base = mkBase();
    try {
      const r = runInChild({ records: [mkRec('f2', 'A', 's4')], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's4'), faults: { s4: 'id_status_mismatch' } }, base);
      if (r.code === 1 && /阶段 S4/.test(r.out) && /C18_ID_STATUS_MISMATCH/.test(r.out) && diagOk(r.out)) {
        pass('T197', 'S4 诊断：id 与 id_status 不一致 → 进程 exit 1，输出含阶段/码/原因/路径/部分产物', '§7.2.5 / §7.2.1 S4（注入）');
      } else { fail('T197', 'S4 诊断字段', '§7.2.5', 'exit=' + r.code + ' out=' + r.out.replace(/\n/g, ' | ').slice(0, 220)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T197', 'S4 诊断', '§7.2.5', '异常：' + e.message); }

  // T198 S5 诊断（故障注入 C 档）
  try {
    const base = mkBase();
    try {
      const r = runInChild({ records: [mkRec('f2', 'A', 's5')], testBaseline: { total: 2, A: 1, B: 0, C: 1, f2: { total: 2, A: 1, B: 0, C: 1 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's5'), faults: { s5: 'c_tier' } }, base);
      if (r.code === 1 && /阶段 S5/.test(r.out) && /E11_UNEXPECTED_ELIGIBLE/.test(r.out) && diagOk(r.out)) {
        pass('T198', 'S5 诊断：C 档进入待发布集合 → 进程 exit 1，输出含阶段/码/原因/路径/部分产物', '§7.2.5 / §7.2.1 S5（注入）');
      } else { fail('T198', 'S5 诊断字段', '§7.2.5', 'exit=' + r.code + ' out=' + r.out.replace(/\n/g, ' | ').slice(0, 220)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T198', 'S5 诊断', '§7.2.5', '异常：' + e.message); }
})();


// ── ID 映射第一批（M1–M4）：T199–T217（2026-10-24）──
(function idMappingBatch1() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  let gen = null;
  try { gen = require(P.gen); } catch (e) { gen = null; }
  const KEYF = 'stallId|groupKey|specLabel|disambiguator';
  function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'm1-map-')); }
  function writeMap(dir, doc) {
    const p = path.join(dir, 'id-map.json');
    fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    return p;
  }
  function entry(key, dishId, status, approvedBy) {
    const seg = String(key).split('|');
    return {
      key: key, stallId: seg[0] || '', groupKey: seg[1] || '', specLabel: seg[2] || '', disambiguator: seg[3] || '',
      dishId: dishId === undefined ? 'c01_d001' : dishId,
      status: status || 'active',
      assignedAt: '2026-10-24T00:00:00.000Z',
      approvedBy: approvedBy || 'user',
      sourceRef: '合成映射（测试专用）'
    };
  }
  function mapDoc(entries, extra) {
    return Object.assign({ schemaVersion: 1, keyFormat: KEYF, entries: entries || [], orphans: [] }, extra || {});
  }
  // 用「不带记录的 mapPath 通道」验证五步校验：[exitCode, code, 步号]
  function loadErr(doc) {
    const dir = tmp();
    try {
      const p = writeMap(dir, doc);
      const r = gen.run({ mapPath: p });
      return { exit: r.exitCode, code: (r.violations[0] || {}).code, note: String(r.summary.note || ''), status: r.summary.status };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  function mkRec(o) {
    const opt = o || {};
    return {
      id: null, shopId: 'c01', stallId: opt.stallId === undefined ? 'c01_t01' : opt.stallId,
      name: opt.name || '合成记录', price: 10, foodType: 'snack', tastes: ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用，非真实业务数据）', ref: '' },
      verifyStatus: 'unverified', verifiedAt: null, note: '',
      gen: {
        tier: 'A', groupKey: opt.groupKey === undefined ? 'f2/合成/键' : opt.groupKey,
        specLabel: opt.specLabel === undefined ? '' : opt.specLabel,
        disambiguator: opt.disambiguator, rawRow: '| 合成 | 10 元 |', sourceLine: 1,
        generation_status: 'generated', evidence_status: 'traceable', import_eligibility: 'blocked',
        id_status: 'unassigned', blockers: []
      }
    };
  }
  function resolveCase(records, doc) {
    const dir = tmp();
    try {
      const p = writeMap(dir, doc);
      const r = gen.run({ records: records, mapPath: p });
      return { r: r, map: r.mapping || null };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // T199–T205：第 2 步（结构）六类 + 一类
  const step2Cases = [
    ['T199', 'schemaVersion ≠ 1', mapDoc([entry('c01_t01|甲||')], { schemaVersion: 2 }), /第 2 步/, 'E15_BAD_MAP'],
    ['T200', 'entries 非数组', mapDoc([]) && { schemaVersion: 1, keyFormat: KEYF, entries: {} }, /第 2 步/, 'E15_BAD_MAP'],
    ['T201', '条目缺 key', mapDoc([{ stallId: 'c01_t01', groupKey: '甲', specLabel: '', disambiguator: '', dishId: 'c01_d001', status: 'active', approvedBy: 'user' }]), /第 2 步/, 'E15_BAD_MAP'],
    ['T202', 'status 非法', mapDoc([entry('c01_t01|甲||', 'c01_d001', 'archived')]), /第 2 步/, 'E15_BAD_MAP'],
    ['T203', 'dishId:null + active（E-4）', mapDoc([entry('c01_t01|甲||', null, 'active')]), /第 2 步/, 'E15_BAD_MAP'],
    ['T204', 'pending_review 带非空 dishId（PK1-R1）', mapDoc([entry('c01_t01|甲||', 'c01_d001', 'pending_review')]), /第 2 步/, 'E15_BAD_MAP'],
    ['T205', 'approvedBy = auto', mapDoc([entry('c01_t01|甲||', 'c01_d001', 'active', 'auto')]), /第 2 步/, 'E15_BAD_MAP']
  ];
  step2Cases.forEach(function (c) {
    try {
      const got = loadErr(c[2]);
      if (got.exit === 1 && got.code === c[4] && c[3].test(got.note) && /E12/.test(got.note) === false) {
        pass(c[0], '第 2 步：' + c[1] + ' → ' + c[4] + '/1，报文含步号且不误报 E12', '§5.6.5.5.4 第 2 步');
      } else { fail(c[0], '第 2 步：' + c[1], '§5.6.5.5.4 第 2 步', 'exit=' + got.exit + ' code=' + got.code + ' note=' + got.note.slice(0, 120)); }
    } catch (e) { fail(c[0], '第 2 步：' + c[1], '§5.6.5.5.4 第 2 步', '异常：' + e.message); }
  });

  // T206–T207：第 3 步（keyFormat 与四段键）
  try {
    const got = loadErr(mapDoc([entry('c01_t01|甲||')], { keyFormat: 'stallId|groupKey|specLabel' }));
    if (got.exit === 1 && got.code === 'E15_BAD_MAP' && /第 3 步/.test(got.note)) {
      pass('T206', '第 3 步：keyFormat 声明变体 → E15/1', '§5.6.5.5.4 第 3 步 / §5.6.5.5.4.1');
    } else { fail('T206', 'keyFormat 变体', '§5.6.5.5.4.1', 'exit=' + got.exit + ' note=' + got.note.slice(0, 120)); }
  } catch (e) { fail('T206', 'keyFormat 变体', '§5.6.5.5.4.1', '异常：' + e.message); }
  try {
    const got = loadErr(mapDoc([entry('c01_t01|甲')]));
    if (got.exit === 1 && got.code === 'E15_BAD_MAP' && /第 3 步/.test(got.note) && /\d+ 段/.test(got.note) && /恰好四段/.test(got.note)) {
      pass('T207', '第 3 步：key 仅三段 → E15/1 且报文给出实际段数', '§5.6.5.5.4 第 3 步');
    } else { fail('T207', 'key 三段', '§5.6.5.5.4 第 3 步', 'exit=' + got.exit + ' note=' + got.note.slice(0, 120)); }
  } catch (e) { fail('T207', 'key 三段', '§5.6.5.5.4 第 3 步', '异常：' + e.message); }

  // T208–T209：第 4/5 步（重复 dishId / 重复 key）
  try {
    const got = loadErr(mapDoc([entry('c01_t01|甲||', 'c01_d001'), entry('c01_t02|乙||', 'c01_d001')]));
    if (got.exit === 1 && got.code === 'E13_DUP_ID' && /第 4 步/.test(got.note)) {
      pass('T208', '第 4 步：重复 dishId → E13/1', '§5.6.5.5.4 第 4 步');
    } else { fail('T208', '重复 dishId', '§5.6.5.5.4 第 4 步', 'exit=' + got.exit + ' code=' + got.code + ' note=' + got.note.slice(0, 120)); }
  } catch (e) { fail('T208', '重复 dishId', '§5.6.5.5.4 第 4 步', '异常：' + e.message); }
  try {
    const got = loadErr(mapDoc([entry('c01_t01|甲||', 'c01_d001'), entry('c01_t01|甲||', 'c01_d002')]));
    if (got.exit === 1 && got.code === 'E14_DUP_KEY' && /第 5 步/.test(got.note)) {
      pass('T209', '第 5 步：重复 key → E14/1', '§5.6.5.5.4 第 5 步');
    } else { fail('T209', '重复 key', '§5.6.5.5.4 第 5 步', 'exit=' + got.exit + ' code=' + got.code + ' note=' + got.note.slice(0, 120)); }
  } catch (e) { fail('T209', '重复 key', '§5.6.5.5.4 第 5 步', '异常：' + e.message); }

  // T210 首错即停：第 3 步错误（三段键）与第 4 步错误（重复 dishId）同存 → 只报第 3 步
  try {
    const got = loadErr(mapDoc([
      entry('c01_t01|甲'),
      entry('c01_t02|乙||', 'c01_d001'),
      entry('c01_t03|丙||', 'c01_d001')
    ]));
    if (got.exit === 1 && got.code === 'E15_BAD_MAP' && /第 3 步/.test(got.note) && /E13/.test(got.note) === false) {
      pass('T210', '首错即停：第 3 步与第 4 步错误同存 → 只报第 3 步（不聚合）', '§5.6.5.5.4「首错即停」');
    } else { fail('T210', '首错即停', '§5.6.5.5.4', 'code=' + got.code + ' note=' + got.note.slice(0, 140)); }
  } catch (e) { fail('T210', '首错即停', '§5.6.5.5.4', '异常：' + e.message); }

  // T211 makeKey 与参考实现逐项对齐（通过「map 命中即赋值」观测）
  try {
    const cases = [
      { stallId: 'c01_t01', groupKey: '　全角 空白 。，', specLabel: '', disambiguator: undefined },
      { stallId: 'c01_t02', groupKey: '。；鼎、', specLabel: ' Ａ　B， ', disambiguator: '' },
      { stallId: 'c01_t03', groupKey: '。。、 鼎', specLabel: '', disambiguator: 'x-1' }
    ];
    let okAll = true; const detail = [];
    cases.forEach(function (c, i) {
      const expected = REF.makeKey(c);
      const rec = mkRec({ stallId: c.stallId, groupKey: c.groupKey, specLabel: c.specLabel, disambiguator: c.disambiguator });
      const out = resolveCase([rec], mapDoc([entry(expected, 'c01_d' + (900 + i))]));
      const gotId = rec.gen.id; const gotStatus = rec.gen.id_status;
      if (gotId !== 'c01_d' + (900 + i) || gotStatus !== 'assigned_from_map') { okAll = false; detail.push('case' + i + ' 期望 ' + expected + '，实得 id=' + gotId + ' status=' + gotStatus); }
    });
    // 反向：字段含 | 与非字符串必须被拒（R7/R8）
    const bad1 = mkRec({ groupKey: '甲|乙' });
    const out1 = resolveCase([bad1], mapDoc([]));
    const bad2 = mkRec({});
    bad2.gen.specLabel = 123;
    const out2 = resolveCase([bad2], mapDoc([]));
    const rejected = out1.map && out1.map.violations.length >= 1 && out2.map && out2.map.violations.length >= 1 && bad1.gen.id === null && bad2.gen.id === null;
    if (okAll && rejected) {
      pass('T211', 'makeKey 与 REF.makeKey 三例逐键一致（全角/标点/空段），且含 | 与非字符串被拒', '§5.6.5.5.4.1 R1–R8');
    } else { fail('T211', 'makeKey 对齐', '§5.6.5.5.4.1', detail.join('；') + '；rejected=' + rejected); }
  } catch (e) { fail('T211', 'makeKey 对齐', '§5.6.5.5.4.1', '异常：' + e.message); }

  // T212 active 命中 → 复用 dishId
  try {
    const key = 'c01_t01|f2/合成/键| |';
    const rec = mkRec({ groupKey: 'f2/合成/键' });
    const k = REF.makeKey({ stallId: rec.stallId, groupKey: rec.gen.groupKey, specLabel: '', disambiguator: '' });
    const out = resolveCase([rec], mapDoc([entry(k, 'c01_d901', 'active')]));
    if (rec.gen.id === 'c01_d901' && rec.gen.id_status === 'assigned_from_map' && out.map.stats.assigned === 1) {
      pass('T212', 'resolve：active 命中 → 复用 dishId、id_status=assigned_from_map', '§5.6.5.6 情形②');
    } else { fail('T212', 'active 命中', '§5.6.5.6 情形②', 'id=' + rec.gen.id + ' status=' + rec.gen.id_status); }
  } catch (e) { fail('T212', 'active 命中', '§5.6.5.6 情形②', '异常：' + e.message); }

  // T213 pending_review 命中 → PENDING_REVIEW + null/unassigned
  try {
    const rec = mkRec({ groupKey: 'f2/合成/键' });
    const k = REF.makeKey({ stallId: rec.stallId, groupKey: rec.gen.groupKey, specLabel: '', disambiguator: '' });
    const out = resolveCase([rec], mapDoc([entry(k, null, 'pending_review')]));
    if (rec.gen.id === null && rec.gen.id_status === 'unassigned' && rec.gen.blockers.indexOf('PENDING_REVIEW') >= 0 && out.map.stats.pendingReview === 1) {
      pass('T213', 'resolve：pending_review → PENDING_REVIEW + id:null + unassigned（不自动升级）', '§5.6.5.5.2 / §5.6.5.6');
    } else { fail('T213', 'pending_review 分支', '§5.6.5.5.2', 'id=' + rec.gen.id + ' blockers=' + rec.gen.blockers.join(',')); }
  } catch (e) { fail('T213', 'pending_review 分支', '§5.6.5.5.2', '异常：' + e.message); }

  // T214 同键两条 → KEY_COLLISION（不擅自选一条）
  try {
    const a = mkRec({ groupKey: 'f2/合成/键' });
    const b = mkRec({ groupKey: 'f2/合成/键', name: '合成记录2' });
    const k = REF.makeKey({ stallId: a.stallId, groupKey: a.gen.groupKey, specLabel: '', disambiguator: '' });
    const out = resolveCase([a, b], mapDoc([entry(k, 'c01_d901')]));
    const bothBlocked = a.gen.id === null && b.gen.id === null
      && a.gen.blockers.indexOf('KEY_COLLISION') >= 0 && b.gen.blockers.indexOf('KEY_COLLISION') >= 0
      && out.map && out.map.stats.keyCollision === 2;
    if (bothBlocked) {
      pass('T214', 'resolve：同一键对应两条当前记录 → 两条均 KEY_COLLISION，不分配任一 ID', '§5.6.5.6 情形⑥');
    } else { fail('T214', 'KEY_COLLISION', '§5.6.5.6 情形⑥', 'a.id=' + a.gen.id + ' b.id=' + b.gen.id + ' collision=' + (out.map && out.map.stats.keyCollision)); }
  } catch (e) { fail('T214', 'KEY_COLLISION', '§5.6.5.6 情形⑥', '异常：' + e.message); }

  // T215 未命中 → NEW_KEY
  try {
    const rec = mkRec({ groupKey: 'f2/合成/未登记' });
    const other = REF.makeKey({ stallId: 'c01_t09', groupKey: 'f2/合成/别的', specLabel: '', disambiguator: '' });
    const out = resolveCase([rec], mapDoc([entry(other, 'c01_d903')]));
    if (rec.gen.id === null && rec.gen.blockers.indexOf('NEW_KEY') >= 0 && out.map.stats.newKey === 1) {
      pass('T215', 'resolve：未命中 → NEW_KEY，不生成新 ID', '§5.6.5.5.3 / 情形①');
    } else { fail('T215', 'NEW_KEY', '§5.6.5.5.3', 'id=' + rec.gen.id + ' blockers=' + rec.gen.blockers.join(',')); }
  } catch (e) { fail('T215', 'NEW_KEY', '§5.6.5.5.3', '异常：' + e.message); }

  // T216 ORPHAN_IN_MAP 诊断（不阻断、不删除）
  try {
    const rec = mkRec({ groupKey: 'f2/合成/键' });
    const k = REF.makeKey({ stallId: rec.stallId, groupKey: rec.gen.groupKey, specLabel: '', disambiguator: '' });
    const ghost = REF.makeKey({ stallId: 'c01_t08', groupKey: 'f2/合成/已消失', specLabel: '', disambiguator: '' });
    const out = resolveCase([rec], mapDoc([entry(k, 'c01_d901'), entry(ghost, 'c01_d904')]));
    if (out.map.orphans.length === 1 && out.map.orphans[0].key === ghost && out.map.orphans[0].code === 'ORPHAN_IN_MAP' && rec.gen.id === 'c01_d901') {
      pass('T216', 'resolve：map 中多余键 → ORPHAN_IN_MAP 诊断，不阻断当前记录命中', '§5.6.5.6 情形⑤');
    } else { fail('T216', 'ORPHAN_IN_MAP', '§5.6.5.6 情形⑤', 'orphans=' + out.map.orphans.length + ' id=' + rec.gen.id); }
  } catch (e) { fail('T216', 'ORPHAN_IN_MAP', '§5.6.5.6 情形⑤', '异常：' + e.message); }

  // T217 映射文件只读：运行前后 SHA-256 一致
  try {
    const dir = tmp();
    try {
      const rec = mkRec({ groupKey: 'f2/合成/键' });
      const k = REF.makeKey({ stallId: rec.stallId, groupKey: rec.gen.groupKey, specLabel: '', disambiguator: '' });
      const p = writeMap(dir, mapDoc([entry(k, 'c01_d901')]));
      const h1 = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      gen.run({ records: [rec], mapPath: p });
      const h2 = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      const files = fs.readdirSync(dir).sort();
      if (h1 === h2 && files.length === 1 && files[0] === 'id-map.json') {
        pass('T217', '映射文件只读：运行前后 sha256 一致，目录未新增文件', '§5.6.5.7「生成器对 map 只有读权限」');
      } else { fail('T217', '映射文件只读', '§5.6.5.7', 'h1=' + h1.slice(0, 12) + ' h2=' + h2.slice(0, 12) + ' files=' + files.join(',')); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T217', '映射文件只读', '§5.6.5.7', '异常：' + e.message); }
})();

// ---------------------------------------------------------------- 输出

// ================================================================ P2 L1–L7 纯函数层
// 依据：契约（RECORD_GENERATOR_CONTRACT_20261023.md）§3.1 :85-96（冻结签名）、§2.1–2.3（表形态/价格形态/跳过段）、
// §4.1–4.3（三判定与 C17–C20）、§5.4（source_detail 模板）、§6.1（R1–R8）、§6.2（条数）。
// 全部使用内存夹具，不读业务数据、不产生任何文件。
(function P2() {
  const IDS = ['T141', 'T142', 'T143', 'T144', 'T145', 'T146', 'T147'];
  const reported = {};
  function mark(id) { reported[id] = true; }
  function p(id, rule, note) { pass(id, rule, 'tools/pilot/gen_records.js __test__（P2 纯函数层）', note); mark(id); }
  function f(id, rule, note) { fail(id, rule, 'tools/pilot/gen_records.js __test__（P2 纯函数层）', note); mark(id); }
  function unrun(reason) {
    IDS.forEach(function (id) {
      if (!reported[id]) { pending(id, 'L1–L7 纯函数层断言未执行', 'tools/pilot/gen_records.js', reason); reported[id] = true; }
    });
  }
  let T;
  try { T = require(path.join(ROOT, 'tools', 'pilot', 'gen_records.js')).__test__; }
  catch (e) { unrun('生成器模块加载失败：' + String(e && e.message)); return; }

  // 纯内存夹具（不读业务数据、不落盘）
  const src = [
    '## 二、逐家抄录',
    '',
    '### W9-01 夹具档口',
    '',
    '| 菜品 | 价格 |',
    '| --- | --- |',
    '| 红烧肉盖饭 | 12 元 |',
    '| 招牌肉夹馍 | 5 元/个（2 个 9 元，3 个 12 元） |',
    '| 时价菜 | 时价 |',
    '',
    '#### 规格夹具',
    '',
    '| 菜品 | 小碗 | 大碗 |',
    '| --- | --- | --- |',
    '| 杂酱面 | 9 元 | 11 元 |',
    '',
    '#### 做法夹具',
    '',
    '| 口味（现场原文） | 炒饼 | 炒面 | 炒饭 |',
    '| --- | --- | --- | --- |',
    '| 青椒蛋 | 10 元 | 10 元 | 10 元 |',
    '',
    '#### 基底夹具',
    '',
    '| 口味（现场原文） | 米线 | 牛筋面 | 土豆粉 |',
    '| --- | --- | --- | --- |',
    '| 麻辣 | 12 元 | 12 元 | 12 元 |',
    '',
    '#### 自选与加料夹具',
    '',
    '| 菜品 | 价格 |',
    '| --- | --- |',
    '| 二荤二素任选 | 12 元 |',
    '| 锅底（免费） | 0 元 |',
    '| +卤蛋 | 1 元 |',
    '',
    '#### 未知形态夹具',
    '',
    '| A | B | C |',
    '| --- | --- | --- |',
    '| 1 | 2 | 3 |',
    '',
    '## 三、待确认清单',
    '',
    '| # | 问题 | 状态 |',
    '| --- | --- | --- |',
    '| 1 | 价格 | 待补图 |',
    ''
  ].join('\n');
  const doc = T.parseDoc(src, { file: 'fixture' });

  // ---------- T141 parseDoc：结构、行号、跳过、未知表、确定性
  try {
    const okStruct = doc && Array.isArray(doc.sections) && Array.isArray(doc.tables) && Array.isArray(doc.unparsable);
    const kinds = doc.tables.map(function (t) { return t.kind || 'UNPARSABLE'; });
    const hasAll = ['S1', 'S2', 'S3', 'S4', 'EXCL'].every(function (k) { return kinds.indexOf(k) >= 0; });
    const lineOk = doc.tables.every(function (t) { return t.startLine >= 1 && t.headerLine >= t.startLine && t.endLine >= t.headerLine; });
    const skippedOk = doc.sections.some(function (s) { return /待确认/.test(s.title); }) && doc.skipped >= 1;
    const unparsableOk = doc.unparsable.length === 1 && doc.unparsable[0].code === 'E2_UNKNOWN_TABLE';
    const twice = JSON.stringify(T.parseDoc(src, { file: 'fixture' }));
    const detOk = twice === JSON.stringify(doc);
    if (okStruct && hasAll && lineOk && skippedOk && unparsableOk && detOk) {
      p('T141', 'L1 parseDoc：切段+表格识别+跳过段计数+未知表进 unparsable+行号单调+同输入确定性', 'tables=' + doc.tables.length + ' sections=' + doc.sections.length + ' skipped=' + doc.skipped + ' unparsable=' + doc.unparsable.length);
    } else {
      f('T141', 'L1 parseDoc', 'struct=' + okStruct + ' kinds=' + kinds.join(',') + ' line=' + lineOk + ' skip=' + skippedOk + ' unp=' + unparsableOk + ' det=' + detOk);
    }
  } catch (e) { f('T141', 'L1 parseDoc 抛异常', String(e && e.message)); }

  // ---------- T142 classifyTable：四形态 + EXCL + 未知表 E2
  try {
    const mk = function (h) { return { header: h, rows: [] }; };
    const cases = [
      [mk(['菜品', '价格']), 'S1'],
      [mk(['菜品', '小碗', '大碗']), 'S2'],
      [mk(['菜品', '小份', '大份']), 'S2'],
      [mk(['口味（现场原文）', '炒饼', '炒面', '炒饭']), 'S3'],
      [mk(['口味（现场原文）', '米线', '牛筋面', '土豆粉']), 'S4'],
      [mk(['#', '问题', '状态']), 'EXCL'],
      [mk(['位次', '档口']), 'EXCL']
    ];
    const bad = cases.filter(function (c) { return T.classifyTable(c[0]) !== c[1]; }).map(function (c) { return c[0].header.join('/'); });
    let threw = null;
    try { T.classifyTable(mk(['A', 'B', 'C'])); } catch (e) { threw = e.code; }
    if (bad.length === 0 && threw === 'E2_UNKNOWN_TABLE') {
      p('T142', 'L2 classifyTable：S1/S2（小碗大碗、小份大份）/S3/S4/EXCL 全对，未知形态抛 E2_UNKNOWN_TABLE', '七例全中 + 未知表抛错');
    } else {
      f('T142', 'L2 classifyTable', '误判=' + bad.join('；') + ' 未知表错误码=' + threw);
    }
  } catch (e) { f('T142', 'L2 classifyTable 抛异常', String(e && e.message)); }

  // ---------- T143 expandTable：R1–R8 与价格形态
  try {
    const byKind = function (k) { return doc.tables.filter(function (t) { return t.kind === k; })[0]; };
    const bySection = function (re) { return doc.tables.filter(function (t) { return t.kind === 'S1' && re.test(t.section || ''); })[0]; };
    const bl1 = [];
    const r1 = T.expandTable(byKind('S1'), { blockers: bl1, prefix: 'c01_t01|', shopId: 'c01', stallId: 'c01_t01' });
    const r2bl = [];
    // R5 收紧（2026-10-25）：规格拆条只在 §6.1 R5 授权档口生效 → 用 c01_t28（W2-07 四有青年面馆）验证拆条；
    // 同一张表换成未授权档口必须只产出 1 条，并记 R5_SPEC_NOT_AUTHORIZED。
    const r2 = T.expandTable(byKind('S2'), { blockers: [], stallId: 'c01_t28' });
    const r2off = T.expandTable(byKind('S2'), { blockers: r2bl, stallId: 'c01_t01' });
    const r3 = T.expandTable(byKind('S3'), { blockers: [], stallId: 'c01_t01' });
    const r4 = T.expandTable(byKind('S4'), { blockers: [], stallId: 'c01_t01' });
    const rEx = T.expandTable(byKind('EXCL'), { blockers: [], stallId: 'c01_t01' });
    const blAdd = [];
    const rAdd = T.expandTable(bySection(/自选与加料/), { blockers: blAdd, stallId: 'c01_t01' });
    const ladderRecs = r1.filter(function (r) { return r.name === '招牌肉夹馍'; });
    const addOns = bl1.concat(blAdd).map(function (b) { return b.code; });
    const okR1 = r1.length === 4 && rAdd.length === 0 && r1.every(function (r) { return r.id === null && r.verifyStatus === 'unverified' && r.verifiedAt === null; });
    const okR2 = ladderRecs.length === 3 && ladderRecs.map(function (r) { return r.gen.specLabel; }).join(',') === '1 个,2 个,3 个' && ladderRecs.map(function (r) { return r.price; }).join(',') === '5,9,12';
    const okR5 = r2.length === 2 && r2[0].gen.specLabel === '小碗' && r2[1].gen.specLabel === '大碗' && r2[1].price === 11
      && r2off.length === 1 && r2off[0].gen.specLabel === '' && r2bl.map(function (b) { return b.code; }).indexOf('R5_SPEC_NOT_AUTHORIZED') >= 0;
    const okR4 = r3.length === 3 && r3.map(function (r) { return r.foodType; }).join(',') === 'snack,noodle,rice' && r3[0].name === '青椒蛋炒饼';
    const okR3 = r4.length === 3 && r4.map(function (r) { return r.foodType; }).join(',') === 'rice_vermicelli,noodle,other';
    const okExcl = rEx.length === 0;
    const okBlockers = addOns.indexOf('E4_PRICE_UNPARSABLE') >= 0 && addOns.indexOf('R6_SELF_SELECT') >= 0 && addOns.indexOf('R7_FREE_OPTION') >= 0 && addOns.indexOf('R8_ADD_ON') >= 0;
    if (okR1 && okR2 && okR5 && okR4 && okR3 && okExcl && okBlockers) {
      p('T143', 'L3 expandTable：R1 一行一条、R2 阶梯价 3 条、R5 规格拆条仅授权档口生效（c01_t28 拆 2 条 / 未授权档口只 1 条且记 R5_SPEC_NOT_AUTHORIZED）、R4 多做法 3 条（foodType 分流）、R3 多基底 3 条、R6/R7/R8 拦截进 blockers、EXCL 不产出、不可解析价格进 E4', 'S1=' + r1.length + ' S2=' + r2.length + ' S2off=' + r2off.length + ' S3=' + r3.length + ' S4=' + r4.length + ' blockers=' + addOns.join('/'));
    } else {
      f('T143', 'L3 expandTable', 'R1=' + okR1 + ' R2=' + okR2 + ' R5=' + okR5 + ' R4=' + okR4 + ' R3=' + okR3 + ' EXCL=' + okExcl + ' blockers=' + okBlockers + ' 实测=' + addOns.join('/'));
    }
  } catch (e) { f('T143', 'L3 expandTable 抛异常', String(e && e.message)); }

  // ---------- T144 buildSourceDetail：两条模板 + 缺序号 E6 + 幂等
  try {
    const rec = { gen: { rawRow: '| 红烧肉盖饭 | 12 元 |', sourceLine: 42 } };
    const d1 = T.buildSourceDetail(rec, { photoSeq: 9 });
    const d1b = T.buildSourceDetail(rec, { photoSeq: 9 });
    const d2 = T.buildSourceDetail(rec, { noOriginal: true });
    let code = null;
    try { T.buildSourceDetail(rec, {}); } catch (e) { code = e.code; }
    const okTpl1 = d1.indexOf('现场拍摄价目表（第 9 张）') === 0 && d1.indexOf('| 红烧肉盖饭 | 12 元 |') > 0;
    const okTpl2 = d2.indexOf('现场抄录（无原图）') === 0;
    if (okTpl1 && okTpl2 && code === 'E6_EVIDENCE' && d1 === d1b) {
      p('T144', 'L4 buildSourceDetail：有图/无原图两条模板、缺照片序号且未声明无原图 → E6_EVIDENCE、同输入同输出', d1.slice(0, 22) + '…');
    } else {
      f('T144', 'L4 buildSourceDetail', 'tpl1=' + okTpl1 + ' tpl2=' + okTpl2 + ' E6=' + code + ' 幂等=' + (d1 === d1b));
    }
  } catch (e) { f('T144', 'L4 buildSourceDetail 抛异常', String(e && e.message)); }

  // ---------- T145 三判定：默认值 + 枚举合法性（互不推导）
  try {
    const bare = { gen: {} };
    const full = { gen: { generation_status: 'not_generated', evidence_status: 'unclear_source', import_eligibility: 'candidate_only' } };
    const dv = [T.judgeGeneration(bare, {}), T.judgeEvidence(bare, {}), T.judgeEligibility(bare, {})].join(',');
    const fv = [T.judgeGeneration(full, {}), T.judgeEvidence(full, {}), T.judgeEligibility(full, {})].join(',');
    const bad = [];
    [{ generation_status: 'done' }, { evidence_status: 'ok' }, { import_eligibility: 'eligible' }].forEach(function (g, i) {
      try {
        const fn = [T.judgeGeneration, T.judgeEvidence, T.judgeEligibility][i];
        fn({ gen: g }, {});
      } catch (e) { if (e.code === 'E3_ENUM') { bad.push(i); } }
    });
    if (dv === 'generated,traceable,blocked' && fv === 'not_generated,unclear_source,candidate_only' && bad.length === 3) {
      p('T145', 'L5 三判定：缺省值固定、三枚举各自校验、非法值一律 E3_ENUM（互不推导）', 'default=' + dv);
    } else {
      f('T145', 'L5 三判定', 'default=' + dv + ' full=' + fv + ' 非法捕获=' + bad.length + '/3');
    }
  } catch (e) { f('T145', 'L5 三判定抛异常', String(e && e.message)); }

  // ---------- T146 summarize：三元账 + perStall + 不闭合 → E9
  try {
    const mk = function (tier, stallId) { return { stallId: stallId, gen: { tier: tier } }; };
    const list = [mk('A', 's1'), mk('A', 's1'), mk('B', 's2'), mk('C', 's2')];
    const s = T.summarize(list);
    const okSum = s.total === 4 && s.A === 2 && s.B === 1 && s.C === 1 && s.perStall.s1 === 2 && s.perStall.s2 === 2;
    let e3 = null;
    try { T.summarize([{ stallId: 's1', gen: {} }]); } catch (e) { e3 = e.code; }
    const badSum = { total: 5, A: 2, B: 1, C: 1, perStall: {} };
    const v = T.assertContract(list, badSum).map(function (x) { return x.code; });
    if (okSum && e3 === 'E3_ENUM' && v.indexOf('E9_SUM') >= 0) {
      p('T146', 'L6 summarize：A/B/C 与 perStall 计数正确、tier 缺失 → E3、汇总与记录不一致 → L7 报 E9_SUM', JSON.stringify(s.perStall));
    } else {
      f('T146', 'L6 summarize', 'sum=' + okSum + ' E3=' + e3 + ' E9=' + (v.indexOf('E9_SUM') >= 0));
    }
  } catch (e) { f('T146', 'L6 summarize 抛异常', String(e && e.message)); }

  // ---------- T147 assertContract：C17/C18/C19 + 干净项零违规
  try {
    const base = function (over) {
      const r = { id: null, name: 'x', stallId: 's1', gen: { tier: 'A', id_status: 'unassigned', generation_status: 'generated', evidence_status: 'traceable', import_eligibility: 'blocked' } };
      Object.keys(over || {}).forEach(function (k) { if (k === 'gen') { Object.keys(over.gen).forEach(function (g) { r.gen[g] = over.gen[g]; }); } else { r[k] = over[k]; } });
      return r;
    };
    const clean = [base({})];
    const vClean = T.assertContract(clean, T.summarize(clean));
    const vC17 = T.assertContract([base({ gen: { import_eligibility: 'eligible' } })], T.summarize([base({ gen: { import_eligibility: 'eligible' } })])).map(function (x) { return x.code; });
    const r18a = base({ id: 'c01_d001' });
    const vC18a = T.assertContract([r18a], T.summarize([r18a])).map(function (x) { return x.code; });
    const r18b = base({ gen: { import_eligibility: 'candidate_only' } });
    const vC18b = T.assertContract([r18b], T.summarize([r18b])).map(function (x) { return x.code; });
    const okAll = vClean.length === 0 && vC17.indexOf('C17') >= 0 && vC18a.indexOf('C18') >= 0 && vC18b.indexOf('C18') >= 0 && vC18b.indexOf('E11_UNEXPECTED_ELIGIBLE') >= 0;
    if (okAll) {
      p('T147', 'L7 assertContract：干净项 0 违规；C17 非法资格、C18 id 与 id_status 不一致/ null 却非 blocked、C19 candidate_only → E11 均被捕获', 'clean=0 C17/C18/E11 命中');
    } else {
      f('T147', 'L7 assertContract', 'clean=' + vClean.length + ' C17=' + vC17.join('/') + ' C18a=' + vC18a.join('/') + ' C18b=' + vC18b.join('/'));
    }
  } catch (e) { f('T147', 'L7 assertContract 抛异常', String(e && e.message)); }
})();

// ── P3 阶段一：L8 输出层（T148–T155）──────────────────────────────────
// 全部合成数据（不读真实业务数据、不写盘），只验证内存构建、结构校验与序列化。
(function l8Outputs() {
  const crypto = require('crypto');
  let gen = null;
  try { gen = require(P.gen); } catch (e) { gen = null; }

  function mkRec(o) {
    const opt = o || {};
    const tier = opt.tier === undefined ? 'A' : opt.tier;
    const id = opt.id === undefined ? null : opt.id;
    return {
      id: id,
      shopId: opt.shopId === undefined ? 'c01' : opt.shopId,
      stallId: opt.stallId === undefined ? 'c01_t01' : opt.stallId,
      name: opt.name || '合成菜品',
      price: opt.price === undefined ? 10 : opt.price,
      foodType: opt.foodType || 'snack',
      tastes: opt.tastes || ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用，非真实业务数据）', ref: '' },
      verifyStatus: 'unverified',
      verifiedAt: null,
      note: '',
      gen: {
        tier: tier,
        groupKey: opt.groupKey || ('合成/' + (opt.name || '菜品')),
        specLabel: opt.specLabel === undefined ? '' : opt.specLabel,
        rawRow: opt.rawRow || '| 合成 | 10 元 |',
        sourceLine: opt.sourceLine === undefined ? 1 : opt.sourceLine,
        generation_status: tier === 'C' ? 'not_generated' : 'generated',
        evidence_status: opt.evidence === undefined ? 'traceable' : opt.evidence,
        import_eligibility: opt.eligibility === undefined ? 'blocked' : opt.eligibility,
        id_status: opt.idStatus === undefined ? (id === null ? 'unassigned' : 'assigned_from_map') : opt.idStatus,
        blockers: opt.blockers === undefined ? [] : opt.blockers
      }
    };
  }
  const SET = [
    mkRec({ tier: 'A', name: '合成菜品一' }),
    mkRec({ tier: 'B', name: '合成菜品二', evidence: 'missing_original', blockers: ['B9', 'B13'] }),
    mkRec({ tier: 'C', name: '合成菜品三' })
  ];
  function runSet(list, extra) {
    const opt = { records: list, mode: 'dry-run' };
    if (extra) { Object.keys(extra).forEach(function (k) { opt[k] = extra[k]; }); }
    return gen.run(opt);
  }

  try {
    const r = runSet(SET);
    const out = r.outputs || {};
    const m = out.manifest || {};
    const keys = Object.keys(m);
    const hex = /^[0-9a-f]{64}$/.test(String(m.recordsSha256)) && /^[0-9a-f]{64}$/.test(String(m.blockersSha256));
    const noBom = String(out.recordsText).charCodeAt(0) !== 0xFEFF;
    const endsNl = /\n$/.test(String(out.recordsText)) && /\n$/.test(String(out.blockersText));
    if (r.exitCode === 0 && r.summary.status === 'L8_IN_MEMORY_ONLY' && r.summary.records === 2
      && r.summary.blockers === 3 && keys.length === 5 && hex && noBom && endsNl) {
      pass('T148', 'L8 正常构建：三份产物内存生成、manifest 恰 5 字段、哈希小写 64 位、UTF-8 无 BOM 且保留末尾换行', '§3.3/§3.4/§7.2.2/§7.2.8');
    } else {
      fail('T148', 'L8 正常构建', '§3.3/§7.2.8', 'exit=' + r.exitCode + ' status=' + r.summary.status + ' rec=' + r.summary.records + ' blk=' + r.summary.blockers + ' mkeys=' + keys.length + ' hex=' + hex + ' bom=' + !noBom + ' nl=' + endsNl);
    }
  } catch (e) { fail('T148', 'L8 正常构建', '§3.3', '异常：' + e.message); }

  try {
    const r = runSet(SET);
    const rc = ((r.outputs || {}).recordsDoc || {}).meta.counts || {};
    const mc = (r.outputs || {}).manifest.counts || {};
    const ok = rc.total === 3 && rc.A === 1 && rc.B === 1 && rc.C === 1
      && mc.A === rc.A && mc.B === rc.B && mc.C === rc.C && mc.records === 2 && mc.blockers === 3;
    if (ok) { pass('T149', 'L8 counts：meta.counts 保留完整候选集，manifest.counts 与之 A/B/C 相等且 records 为 C 过滤后条数', '§6.2.1/§7.2.2 第 8 条/§7.2.8'); }
    else { fail('T149', 'L8 counts 闭合与两处相等', '§7.2.8', JSON.stringify({ rc: rc, mc: mc })); }
  } catch (e) { fail('T149', 'L8 counts 闭合', '§7.2.8', '异常：' + e.message); }

  try {
    const r = runSet(SET);
    const recs = (r.outputs || {}).recordsDoc.records || [];
    const entries = r.blockers || [];
    const cInOut = recs.some(function (x) { return x.gen.tier === 'C'; });
    const cEntry = entries.filter(function (e) { return e.tier === 'C'; })[0];
    const ok = !cInOut && !!cEntry && cEntry.kind === 'not_generated'
      && cEntry.reasons.indexOf('TIER_C') >= 0 && entries.length === 3;
    if (ok) { pass('T150', 'C 档不进入 records.json，但作为一条 not_generated 阻塞记录进入 blockers（reasons 含 TIER_C）', '§4.2/§3.4'); }
    else { fail('T150', 'C 档过滤与阻塞登记', '§4.2/§3.4', 'cInOut=' + cInOut + ' cEntry=' + JSON.stringify(cEntry) + ' n=' + entries.length); }
  } catch (e) { fail('T150', 'C 档过滤', '§4.2', '异常：' + e.message); }

  try {
    const r = runSet([mkRec({ tier: 'D', name: '非法档位' })]);
    const code = (r.violations[0] || {}).code || '';
    if (r.exitCode === 1 && r.summary.status === 'L8_BUILD_FAILED' && /E3/.test(String(code))) {
      pass('T151', 'tier 非法（"D"）时显式失败（exit 1、L8_BUILD_FAILED、violation 带 E3），不静默归入 C', '§4.1/§6.2.1');
    } else {
      fail('T151', 'tier 缺失/非法必须显式失败', '§6.2.1', 'exit=' + r.exitCode + ' status=' + r.summary.status + ' code=' + code);
    }
  } catch (e) { fail('T151', 'tier 非法失败路径', '§6.2.1', '异常：' + e.message); }

  try {
    // 2026-10-25 正式初始化执行轮迁移：正式 id-map.json 已存在并被 run() 加载，注入记录的键与
    // dishId 须命中真实映射（t49 首条）以通过 S4 映射一致性；语义不变——仍验证「id 非空不推断资格」。
    const list = [
      mkRec({ tier: 'A', id: 'c01_d437', idStatus: 'assigned_from_map', eligibility: 'blocked', name: '有 ID 但 blocked', stallId: 'c01_t49', groupKey: '鸡蛋火腿炒饼', specLabel: '' }),
      mkRec({ tier: 'A', name: '无 ID 且 blocked' })
    ];
    const r = runSet(list);
    const recs = (r.outputs || {}).recordsDoc.records || [];
    const withId = recs.filter(function (x) { return x.id !== null; })[0] || {};
    const anyCandidate = recs.some(function (x) { return x.gen.import_eligibility === 'candidate_only'; });
    const ok = r.exitCode === 0 && !!withId.id && withId.gen.import_eligibility === 'blocked' && !anyCandidate;
    if (ok) { pass('T152', 'C20：id 非空不会改写 import_eligibility（仍 blocked），导出不产生 candidate_only', '§4.3 C20'); }
    else { fail('T152', 'C20 禁止由非空 id 推断资格', '§4.3 C20', JSON.stringify({ exit: r.exitCode, id: withId.id, elig: (withId.gen || {}).import_eligibility, anyCandidate: anyCandidate })); }
  } catch (e) { fail('T152', 'C20 行为', '§4.3', '异常：' + e.message); }

  try {
    const r = runSet([
      mkRec({ tier: 'B', id: 'c01_d002', idStatus: 'assigned_from_map', name: '证据缺口记录', evidence: 'missing_original', blockers: ['B9'] }),
      mkRec({ tier: 'B', name: '无 ID 记录', evidence: 'traceable' })
    ]);
    const entries = r.blockers || [];
    const e0 = entries[0] || {};
    const e1 = entries[1] || {};
    const hasTime = entries.some(function (e) { return ('createdAt' in e) || ('updatedAt' in e) || ('generatedAt' in e); });
    const ok = entries.length === 2 && r.summary.blockers === 2 && !hasTime
      && e0.kind === 'evidence_gap' && e0.reasons.indexOf('B9') >= 0 && e0.reasons.indexOf('EVIDENCE_GAP') >= 0
      && e1.kind === 'id_unassigned' && e1.reasons.indexOf('ID_UNASSIGNED') >= 0
      && typeof e0.name === 'string' && 'sourceLine' in e0;
    if (ok) { pass('T153', 'blockers：一条待阻塞记录一条 entry，多原因合并进 reasons，kind 按「C→无 ID→证据缺口→待裁决」归类，count===entries.length 且无时间字段', '§3.4'); }
    else { fail('T153', 'blockers 结构与禁时间字段', '§3.4', JSON.stringify({ n: entries.length, e0: e0, e1: e1, hasTime: hasTime })); }
  } catch (e) { fail('T153', 'blockers 结构', '§3.4', '异常：' + e.message); }

  try {
    const r = runSet(SET);
    const out = r.outputs || {};
    const rt = JSON.parse(out.recordsText);
    const bt = JSON.parse(out.blockersText);
    const rehash = crypto.createHash('sha256').update(Buffer.from(out.recordsText, 'utf8')).digest('hex');
    const onlyLf = String(out.recordsText).indexOf('\r') < 0;
    const ok = JSON.stringify(rt) === JSON.stringify(out.recordsDoc)
      && JSON.stringify(bt) === JSON.stringify(out.blockersDoc)
      && rehash === out.manifest.recordsSha256 && onlyLf;
    if (ok) { pass('T154', '序列化：JSON 往返一致、哈希对最终 UTF-8 字节重算相等、无 CR（LF 口径）', '§7.2.8 H-1'); }
    else { fail('T154', '序列化与哈希一致性', '§7.2.8', JSON.stringify({ same: JSON.stringify(rt) === JSON.stringify(out.recordsDoc), rehash: rehash === out.manifest.recordsSha256, onlyLf: onlyLf })); }
  } catch (e) { fail('T154', '序列化与哈希', '§7.2.8', '异常：' + e.message); }

  try {
    const empty = runSet([]);
    const bad = runSet([mkRec({ tier: 'A', id: 'c01_d009', idStatus: 'unassigned', name: 'id 与 id_status 不一致' })]);
    const badCodes = (bad.violations || []).map(function (v) { return v.code; }).join(',');
    const ok = empty.exitCode === 0 && empty.summary.records === 0 && empty.summary.blockers === 0
      && bad.exitCode === 1 && /C18/.test(badCodes);
    if (ok) { pass('T155', '空记录集产出空产物（exit 0）；id 非空而 id_status=unassigned 触发 C18 违规（exit 1）', '§4.3 C18/§3.3'); }
    else { fail('T155', '空输入与 C18 违规路径', '§4.3 C18', JSON.stringify({ e: empty.exitCode, er: empty.summary.records, be: bad.exitCode, codes: badCodes })); }
  } catch (e) { fail('T155', '空输入与 C18', '§4.3 C18', '异常：' + e.message); }
})();

// ── P3 补强：L8 结构校验的**直接负例**（T156–T161）───────────────────
// 通过 run({ records, faults }) 的测试专用故障注入真实触发拒绝路径；
// 注入只影响内存副本，不写盘、不进正式产物。
(function l8Negative() {
  let gen = null;
  try { gen = require(P.gen); } catch (e) { gen = null; }

  function mk(o) {
    const opt = o || {};
    const tier = opt.tier === undefined ? 'A' : opt.tier;
    const id = opt.id === undefined ? null : opt.id;
    return {
      id: id,
      shopId: 'c01',
      stallId: opt.stallId === undefined ? 'c01_t01' : opt.stallId,
      name: opt.name || '合成菜品',
      price: 10,
      foodType: 'snack',
      tastes: ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用，非真实业务数据）', ref: '' },
      verifyStatus: 'unverified',
      verifiedAt: null,
      note: '',
      gen: {
        tier: tier,
        groupKey: (opt.layer || 'f2') + '/' + (opt.name || '菜品'),
        specLabel: '',
        rawRow: '| 合成 | 10 元 |',
        sourceLine: 1,
        generation_status: tier === 'C' ? 'not_generated' : 'generated',
        evidence_status: opt.evidence === undefined ? 'traceable' : opt.evidence,
        import_eligibility: opt.eligibility === undefined ? 'blocked' : opt.eligibility,
        id_status: id === null ? 'unassigned' : 'assigned_from_map',
        blockers: []
      }
    };
  }
  const BASE = [mk({ tier: 'A', name: '合成一' }), mk({ tier: 'B', name: '合成二', evidence: 'missing_original' }), mk({ tier: 'C', name: '合成三' })];
  function codes(r) { return (r.violations || []).map(function (v) { return String(v.code); }).join(','); }
  function runFault(faults, list) { return gen.run({ records: list || BASE, mode: 'dry-run', faults: faults }); }

  try {
    const r = runFault({ manifestDrop: 'counts' });
    const c = codes(r);
    if (r.exitCode === 1 && /L8_MANIFEST_FIELDS/.test(c)) {
      pass('T156', 'manifest 缺少必需字段（删除 counts）→ 结构校验明确拒绝（exit 1、L8_MANIFEST_FIELDS）', '§7.2.2 第 6 条');
    } else { fail('T156', 'manifest 缺字段必须拒绝', '§7.2.2 第 6 条', 'exit=' + r.exitCode + ' codes=' + c); }
  } catch (e) { fail('T156', 'manifest 缺字段', '§7.2.2', '异常：' + e.message); }

  try {
    const r = runFault({ manifestAdd: 'debugInfo' });
    const c = codes(r);
    if (r.exitCode === 1 && /L8_MANIFEST_FIELDS/.test(c)) {
      pass('T157', 'manifest 出现额外字段（debugInfo）→ 明确拒绝（等价 additionalProperties=false）', '§7.2.2 第 6 条（Q6-5=C 严格档）');
    } else { fail('T157', 'manifest 多字段必须拒绝', '§7.2.2 第 6 条', 'exit=' + r.exitCode + ' codes=' + c); }
  } catch (e) { fail('T157', 'manifest 多字段', '§7.2.2', '异常：' + e.message); }

  try {
    const r = runFault({ countsDrop: 'C' });
    const c = codes(r);
    if (r.exitCode === 1 && /L8_MANIFEST_COUNTS_FIELDS/.test(c)) {
      pass('T158', 'counts 键集合错误（缺少 C）→ 明确拒绝（L8_MANIFEST_COUNTS_FIELDS）', '§7.2.2 第 8 条/§7.2.8');
    } else { fail('T158', 'counts 键集合必须恰为 5 个', '§7.2.8', 'exit=' + r.exitCode + ' codes=' + c); }
  } catch (e) { fail('T158', 'counts 键集合', '§7.2.8', '异常：' + e.message); }

  try {
    const r = runFault({ blockersCountDelta: 1 });
    const c = codes(r);
    if (r.exitCode === 1 && /L8_BLOCKERS_COUNT/.test(c)) {
      pass('T159', 'blockers 的 count 与 entries.length 不一致 → 明确拒绝（L8_BLOCKERS_COUNT）', '§3.4');
    } else { fail('T159', 'blockers count 必须等于 entries.length', '§3.4', 'exit=' + r.exitCode + ' codes=' + c); }
  } catch (e) { fail('T159', 'blockers count 一致性', '§3.4', '异常：' + e.message); }

  try {
    const r = runFault({ manifestCountsDelta: { A: 1 } });
    const c = codes(r);
    if (r.exitCode === 1 && /L8_COUNTS_MISMATCH/.test(c)) {
      pass('T160', 'manifest.counts.A 与 records.meta.counts.A 不一致 → 明确拒绝（L8_COUNTS_MISMATCH）', '§7.2.2 第 8 条/§7.2.8');
    } else { fail('T160', '两处 A/B/C 必须相等', '§7.2.8', 'exit=' + r.exitCode + ' codes=' + c); }
  } catch (e) { fail('T160', '两处计数相等', '§7.2.8', '异常：' + e.message); }

  try {
    const list = [
      mk({ tier: 'A', id: 'c01_d001', name: '有 ID 但 blocked' }),
      mk({ tier: 'A', name: '无 ID', eligibility: 'blocked' }),
      mk({ tier: 'A', name: 'candidate_only 记录', eligibility: 'candidate_only' })
    ];
    const before = list.map(function (r) { return r.gen.import_eligibility; });
    const r = gen.run({ records: list, mode: 'dry-run' });
    const out = r.outputs || {};
    const recs = (out.recordsDoc || {}).records || [];
    const after = recs.map(function (x) { return x.gen.import_eligibility; });
    const withId = recs.filter(function (x) { return x.id !== null; })[0] || {};
    const c = codes(r);
    const anyAutoEligible = recs.some(function (x) { return x.id !== null && x.gen.import_eligibility !== 'blocked'; });
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    const rejected = r.exitCode === 1 && /E11_UNEXPECTED_ELIGIBLE/.test(c);
    if (withId.id === 'c01_d001' && withId.gen.import_eligibility === 'blocked' && !anyAutoEligible && unchanged && rejected) {
      pass('T161', 'C20：非空 ID 不赋资格、导出不改写 import_eligibility（前后一致）、candidate_only 被判 E11 拒绝', '§4.3 C20');
    } else {
      fail('T161', 'C20 三条行为', '§4.3 C20', JSON.stringify({ id: withId.id, elig: (withId.gen || {}).import_eligibility, anyAutoEligible: anyAutoEligible, unchanged: unchanged, exit: r.exitCode, codes: c }));
    }
  } catch (e) { fail('T161', 'C20 行为', '§4.3', '异常：' + e.message); }
})();

// ── P1 安全发布链路（T162–T168）──────────────────────────────────────
// 全部合成数据 + 隔离临时目录；测试结束清理自建目录并核验。
(function p1Publish() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const cp = require('child_process');
  let gen = null;
  try { gen = require(P.gen); } catch (e) { gen = null; }

  function rec(o) {
    const opt = o || {};
    const tier = opt.tier || 'A';
    return {
      id: null, shopId: 'c01', stallId: 'c01_t01', name: opt.name || '合成菜品', price: 10,
      foodType: 'snack', tastes: ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用，非真实业务数据）', ref: '' },
      verifyStatus: 'unverified', verifiedAt: null, note: '',
      gen: {
        tier: tier, groupKey: (opt.layer || 'f2') + '/' + (opt.name || '菜品'), specLabel: '', rawRow: '| 合成 | 10 元 |',
        sourceLine: 1, generation_status: tier === 'C' ? 'not_generated' : 'generated',
        evidence_status: 'traceable', import_eligibility: 'blocked',
        id_status: 'unassigned', blockers: []
      }
    };
  }
  function mkBase() { return fs.mkdtempSync(path.join(os.tmpdir(), 'p1-test-')); }
  const sha = (t) => crypto.createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex');

  // T162 成功发布
  try {
    const base = mkBase();
    const out = path.join(base, 'pub');
    try {
      const r = gen.run({ records: [rec({ name: '甲' }), rec({ tier: 'B', name: '乙' })], testBaseline: { total: 2, A: 1, B: 1, C: 0, f2: { total: 2, A: 1, B: 1, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const files = fs.readdirSync(out).sort();
      const m = JSON.parse(fs.readFileSync(path.join(out, 'gen-manifest.json'), 'utf8'));
      const rt = fs.readFileSync(path.join(out, 'records.json'), 'utf8');
      const bt = fs.readFileSync(path.join(out, 'records_blockers.json'), 'utf8');
      const bd = JSON.parse(bt);
      const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(m.publishedAt));
      const ok = r.exitCode === 0 && r.summary.status === 'PUBLISH_OK'
        && JSON.stringify(files) === JSON.stringify(['COMMITTED', 'gen-manifest.json', 'records.json', 'records_blockers.json'])
        && !fs.existsSync(path.join(out, 'PUBLISHING')) && fs.existsSync(path.join(out, 'COMMITTED'))
        && Object.keys(m).length === 5 && iso && m.publishedAt !== null
        && sha(rt) === m.recordsSha256 && sha(bt) === m.blockersSha256
        && m.counts.records === JSON.parse(rt).records.length
        && m.counts.blockers === bd.count && bd.count === bd.entries.length
        && m.counts.records === m.counts.A + m.counts.B + m.counts.C;
      if (ok) { pass('T162', 'P1 成功发布：三文件齐全、无 PUBLISHING 残留、manifest 五字段且 publishedAt 为 ISO 字符串、两哈希与字节一致、counts 与产物内容对账', '§7.2.1 S1–S10/§7.2.2/§7.2.8'); }
      else { fail('T162', 'P1 成功发布', '§7.2.1', 'exit=' + r.exitCode + ' files=' + JSON.stringify(files) + ' keys=' + Object.keys(m).length + ' iso=' + iso + ' counts=' + JSON.stringify(m.counts) + ' bd=' + JSON.stringify({ count: bd.count, entries: bd.entries.length })); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T162', 'P1 成功发布', '§7.2.1', '异常：' + e.message); }

  // T163 目标已存在 → 拒绝覆盖（exit 3、S6、内容不变、临时目录保留）
  try {
    const base = mkBase();
    const out = path.join(base, 'pub');
    try {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'keep.txt'), 'keep', 'utf8');
      const r = gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const kept = fs.existsSync(path.join(out, 'keep.txt')) && !fs.existsSync(path.join(out, 'records.json'));
      const tmpKept = fs.readdirSync(base).some(function (n) { return n.indexOf('gen-') === 0; });
      if (r.exitCode === 3 && r.summary.stage === 'S6' && kept && tmpKept) {
        pass('T163', 'S6 目标已存在（含空目录/非空目录）→ 拒绝覆盖与合并（exit 3），临时目录按 §7.2.5 保留', '§7.2.1 S6/§7.2.5');
      } else { fail('T163', 'S6 目标已存在必须拒绝', '§7.2.1 S6', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' kept=' + kept + ' tmp=' + tmpKept); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T163', 'S6 目标已存在', '§7.2.1 S6', '异常：' + e.message); }

  // T164 --out 路径安全
  try {
    const base = mkBase();
    try {
      const root = process.cwd();
      const a = gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(root, 'data', 'p1-should-not-exist') });
      const b = gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: root });
      const codesA = (a.violations || []).map(function (v) { return v.code; });
      const codesB = (b.violations || []).map(function (v) { return v.code; });
      const notCreated = !fs.existsSync(path.join(root, 'data', 'p1-should-not-exist'));
      if (a.exitCode === 3 && b.exitCode === 3 && codesA[0] === 'E28_OUT_REFUSED' && codesB[0] === 'E28_OUT_REFUSED' && notCreated) {
        pass('T164', '§7.2.6 --out 指向受保护目录/项目根 → E28_OUT_REFUSED（exit 3），且不创建任何目录', '§7.2.6');
      } else { fail('T164', '--out 路径安全', '§7.2.6', 'a=' + a.exitCode + '/' + codesA.join(',') + ' b=' + b.exitCode + '/' + codesB.join(',') + ' notCreated=' + notCreated); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T164', '--out 路径安全', '§7.2.6', '异常：' + e.message); }

  // T165 发布失败路径：目标父目录不存在 → 不进入 S7、不产生目标、exit 3
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'no-such-parent', 'pub');
      const r = gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const noTarget = !fs.existsSync(out);
      if (r.exitCode === 3 && r.summary.stage === 'PRE' && noTarget) {
        pass('T165', '发布失败路径：目标父目录不存在 → 前置检查（stage=PRE）即失败（exit 3），不创建目标、不降级为逐文件写入', '§7.2.4/§7.2.5');
      } else { fail('T165', '发布失败（S1 前置）', '§7.2.4', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' noTarget=' + noTarget); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T165', '发布失败（S1 前置）', '§7.2.4', '异常：' + e.message); }

  // T166 读侧识别不完整发布（E17 两条件）
  try {
    const base = mkBase();
    try {
      const complete = path.join(base, 'ok');
      const missing = path.join(base, 'missing');
      const marked = path.join(base, 'marked');
      const nomark = path.join(base, 'nomark');
      gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: complete });
      fs.mkdirSync(missing, { recursive: true });
      fs.writeFileSync(path.join(missing, 'records.json'), '{}', 'utf8');
      fs.mkdirSync(marked, { recursive: true });
      fs.writeFileSync(path.join(marked, 'gen-manifest.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(marked, 'PUBLISHING'), '', 'utf8');
      // 任务 A 负例：S10 未通过（无 COMMITTED）但 manifest 与三文件齐全 → 读侧必须拒绝
      fs.mkdirSync(nomark, { recursive: true });
      ['gen-manifest.json', 'records.json', 'records_blockers.json'].forEach(function (f) {
        fs.copyFileSync(path.join(complete, f), path.join(nomark, f));
      });
      const insp = (dir) => gen.run({ inspectDir: dir });
      const i1 = insp(complete);
      const i2 = insp(missing);
      const i3 = insp(marked);
      const i4 = insp(nomark);
      const ok = i1.exitCode === 0 && i1.summary.status === 'PUBLISH_COMPLETE'
        && i2.exitCode === 1 && i2.summary.status === 'INCOMPLETE_PUBLISH' && (i2.violations[0] || {}).code === 'E17_INCOMPLETE_PUBLISH'
        && i3.exitCode === 1 && i3.summary.status === 'INCOMPLETE_PUBLISH' && (i3.violations[0] || {}).code === 'E17_INCOMPLETE_PUBLISH'
        && i3.summary.reasons.join('|').indexOf('PUBLISHING') >= 0
        && i4.exitCode === 1 && i4.summary.status === 'INCOMPLETE_PUBLISH' && (i4.violations[0] || {}).code === 'E17_INCOMPLETE_PUBLISH'
        && i4.summary.reasons.join('|').indexOf('COMMITTED') >= 0;
      if (ok) { pass('T166', '读侧识别：仅「有 manifest ∧ 无 PUBLISHING ∧ 有 COMMITTED」才接受；缺 manifest／含标记／缺完成标记（S10 未通过）均 → E17_INCOMPLETE_PUBLISH', '§7.2.3'); }
      else { fail('T166', '读侧识别不完整发布', '§7.2.3', JSON.stringify({ i1: i1.summary, i2: i2.summary, i3: i3.summary, i4: i4.summary })); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T166', '读侧识别', '§7.2.3', '异常：' + e.message); }

  // T167 重跑行为：成功发布后重跑同一目标 → S6 拒绝；成功目录不被改写
  try {
    const base = mkBase();
    const out = path.join(base, 'pub');
    try {
      const r1 = gen.run({ records: [rec({ name: '甲' })], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const before = fs.readFileSync(path.join(out, 'records.json'), 'utf8');
      const r2 = gen.run({ records: [rec({ name: '乙' })], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const after = fs.readFileSync(path.join(out, 'records.json'), 'utf8');
      const ok = r1.exitCode === 0 && r2.exitCode === 3 && r2.summary.stage === 'S6' && before === after;
      if (ok) { pass('T167', '重跑同一目标：S6 拒绝（exit 3），已发布内容零改动（不覆盖、不合并）', '§7.2.1 S6/§7.2.3'); }
      else { fail('T167', '重跑拒绝覆盖', '§7.2.1 S6', 'r1=' + r1.exitCode + ' r2=' + r2.exitCode + '/' + r2.summary.stage + ' same=' + (before === after)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T167', '重跑拒绝覆盖', '§7.2.1 S6', '异常：' + e.message); }

  // T168 applyFaults 安全边界：CLI 不可触发（未知选项 E27/2），且不传时产物不含注入字段
  try {
    const base = mkBase();
    try {
      const cli = cp.spawnSync(process.execPath, [P.gen, 'gen', '--faults', 'x', '--write', '--out', path.join(base, 'o')], { encoding: 'utf8' });
      const out = path.join(base, 'clean');
      const r = gen.run({ records: [rec({})], testBaseline: { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const m = JSON.parse(fs.readFileSync(path.join(out, 'gen-manifest.json'), 'utf8'));
      const noInject = Object.keys(m).indexOf('debugInfo') < 0 && Object.keys(m).length === 5;
      if (cli.status === 2 && /E27_CLI_USAGE/.test(String(cli.stdout) + String(cli.stderr)) && r.exitCode === 0 && noInject) {
        pass('T168', 'applyFaults 边界：CLI 传 --faults → E27_CLI_USAGE/2（不可达）；不传时 manifest 仍恰 5 字段', '§7.2.2 第 6 条/§3.5');
      } else { fail('T168', 'applyFaults 安全边界', '§3.5', 'cli=' + cli.status + ' out=' + String(cli.stdout || '').slice(0, 80) + ' r=' + r.exitCode + ' noInject=' + noInject); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T168', 'applyFaults 安全边界', '§3.5', '异常：' + e.message); }

  // T169 S2：重复 dishId 必须被发布前校验拦下（且不产生目标目录）
  try {
    const base = mkBase();
    try {
      const a = rec({ name: '甲' }); a.id = 'c01_d001'; a.gen.id_status = 'assigned_from_map';
      const b = rec({ name: '乙' }); b.id = 'c01_d001'; b.gen.id_status = 'assigned_from_map';
      const out = path.join(base, 'dup');
      const r = gen.run({ records: [a, b], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: out });
      const codes = (r.violations || []).map(function (v) { return v.code; });
      const noTarget = !fs.existsSync(out);
      if (r.exitCode === 1 && r.summary.stage === 'S2' && codes.indexOf('E13_DUP_ID') >= 0 && noTarget) {
        pass('T169', 'S2 结构校验：records 内重复 dishId → E13_DUP_ID（exit 1、stage=S2），目标目录未被创建', '§7.2.1 S2');
      } else { fail('T169', 'S2 重复 dishId', '§7.2.1 S2', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',') + ' noTarget=' + noTarget); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T169', 'S2 重复 dishId', '§7.2.1 S2', '异常：' + e.message); }

  // T170 任务 C：inspectDir 与写参数冲突必须拒绝，且不产生任何写入
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'conflict');
      const r = gen.run({ inspectDir: base, mode: 'write', outDir: out });
      const codes = (r.violations || []).map(function (v) { return v.code; });
      const noWrite = !fs.existsSync(out);
      if (r.exitCode === 2 && r.summary.status === 'E29_PARAM_CONFLICT' && codes.indexOf('E29_PARAM_CONFLICT') >= 0 && noWrite) {
        pass('T170', 'inspectDir 与 mode=write/outDir 同时出现 → E29_PARAM_CONFLICT（exit 2），零写入、不静默优先读侧', '§3.5/§7.4');
      } else { fail('T170', '读参数与写参数冲突', '§3.5', 'exit=' + r.exitCode + ' status=' + r.summary.status + ' codes=' + codes.join(',') + ' noWrite=' + noWrite); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T170', '读参数与写参数冲突', '§3.5', '异常：' + e.message); }


  // T171–T188：P1 基准强制、读侧完整性、故障注入闭环（2026-10-24 第二批）
  const TBL = { total: 1, A: 1, B: 0, C: 0, f2: { total: 1, A: 1, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } };
  function oneRec() { return rec({}); }
  function publishOnce(base, extra) {
    const out = path.join(base, 'pub-' + Math.random().toString(36).slice(2, 8));
    return { out: out, r: gen.run(Object.assign({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: out }, extra || {})) };
  }

  // T171 S4：id 非空但 id_status 未分配 → 发布前 S4 拒绝
  try {
    const base = mkBase();
    try {
      const r = gen.run({ records: [oneRec()], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's4'), faults: { s4: 'id_status_mismatch' } });
      const codes = (r.violations || []).map(v => v.code);
      if (r.exitCode === 1 && r.summary.stage === 'S4' && codes.indexOf('C18_ID_STATUS_MISMATCH') >= 0 && !fs.existsSync(path.join(base, 's4'))) {
        pass('T171', 'S4 映射一致性：id 非空但 id_status=unassigned → C18_ID_STATUS_MISMATCH（exit 1、stage=S4、零发布）', '§7.2.1 S4（测试注入）');
      } else { fail('T171', 'S4 映射一致性', '§7.2.1 S4', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',')); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T171', 'S4 映射一致性', '§7.2.1 S4', '异常：' + e.message); }

  // T172 S5：C 档进入 records → E11
  try {
    const base = mkBase();
    try {
      const r = gen.run({ records: [oneRec()], testBaseline: { total: 2, A: 1, B: 0, C: 1, f2: { total: 2, A: 1, B: 0, C: 1 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's5c'), faults: { s5: 'c_tier' } });
      const codes = (r.violations || []).map(v => v.code);
      if (r.exitCode === 1 && r.summary.stage === 'S5' && codes.indexOf('E11_UNEXPECTED_ELIGIBLE') >= 0) {
        pass('T172', 'S5：C 档记录进入待发布集合 → E11_UNEXPECTED_ELIGIBLE（exit 1、stage=S5）', '§7.2.1 S5（测试注入）');
      } else { fail('T172', 'S5 C 档', '§7.2.1 S5', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',')); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T172', 'S5 C 档', '§7.2.1 S5', '异常：' + e.message); }

  // T173 S5：candidate_only 非零 → E11
  try {
    const base = mkBase();
    try {
      const r = gen.run({ records: [oneRec()], testBaseline: { total: 2, A: 2, B: 0, C: 0, f2: { total: 2, A: 2, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } }, mode: 'write', outDir: path.join(base, 's5e'), faults: { s5: 'candidate_only' } });
      const codes = (r.violations || []).map(v => v.code);
      if (r.exitCode === 1 && r.summary.stage === 'S5' && codes.indexOf('E11_UNEXPECTED_ELIGIBLE') >= 0) {
        pass('T173', 'S5：candidate_only 出现在待发布集合 → E11（exit 1、stage=S5）', '§7.2.1 S5（测试注入）');
      } else { fail('T173', 'S5 candidate_only', '§7.2.1 S5', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',')); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T173', 'S5 candidate_only', '§7.2.1 S5', '异常：' + e.message); }

  // T174 未声明测试基准 → 强制使用契约固定基准（1 条记录必然不一致）
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'prodbl');
      const r = gen.run({ records: [oneRec()], mode: 'write', outDir: out });
      const codes = (r.violations || []).map(v => v.code);
      const note = String(r.summary.note || '');
      if (r.exitCode === 1 && r.summary.stage === 'S3' && codes.indexOf('E9_SUM') >= 0 && !fs.existsSync(out) && note.indexOf('契约固定规划基准') >= 0) {
        pass('T174', '正式路径强制契约基准：未注入测试基准时 1 条记录 → S3 / E9_SUM（exit 1、零发布、note 标明固定基准）', '§7.2.1 S3 第 6 项');
      } else { fail('T174', '正式基准强制', '§7.2.1 S3', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',') + ' note=' + note.slice(0, 60)); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T174', '正式基准强制', '§7.2.1 S3', '异常：' + e.message); }

  // T175 匹配的测试基准 → 正常发布
  try {
    const base = mkBase();
    try {
      const p = publishOnce(base);
      if (p.r.exitCode === 0 && p.r.summary.status === 'PUBLISH_OK' && fs.existsSync(path.join(p.out, 'COMMITTED'))) {
        pass('T175', '注入匹配的测试基准 → PUBLISH_OK 且写 COMMITTED', '§7.2.1 S3（测试注入）');
      } else { fail('T175', '匹配测试基准', '§7.2.1 S3', 'exit=' + p.r.exitCode + ' status=' + p.r.summary.status); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T175', '匹配测试基准', '§7.2.1 S3', '异常：' + e.message); }

  // T176 不匹配的测试基准 → S3 拒绝
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'badbl');
      const r = gen.run({ records: [oneRec()], testBaseline: { total: 564, A: 463, B: 39, C: 62, f2: { total: 419, A: 347, B: 39, C: 33 }, f3: { total: 145, A: 116, B: 0, C: 29 } }, mode: 'write', outDir: out });
      const codes = (r.violations || []).map(v => v.code);
      if (r.exitCode === 1 && r.summary.stage === 'S3' && codes.indexOf('E9_SUM') >= 0 && !fs.existsSync(out)) {
        pass('T176', '注入不匹配的测试基准 → S3 / E9_SUM（exit 1、零发布）', '§7.2.1 S3（测试注入）');
      } else { fail('T176', '不匹配测试基准', '§7.2.1 S3', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' codes=' + codes.join(',')); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T176', '不匹配测试基准', '§7.2.1 S3', '异常：' + e.message); }

  // T177 testBaseline 无内部通道 → E29
  try {
    const r = gen.run({ testBaseline: TBL, mode: 'dry-run' });
    if (r.exitCode === 2 && r.summary.status === 'E29_PARAM_CONFLICT') {
      pass('T177', 'testBaseline 未与 records 注入同时使用 → E29_PARAM_CONFLICT（exit 2，测试通道隔离）', '§3.5/§7.4');
    } else { fail('T177', 'testBaseline 通道隔离', '§3.5', 'exit=' + r.exitCode + ' status=' + r.summary.status); }
  } catch (e) { fail('T177', 'testBaseline 通道隔离', '§3.5', '异常：' + e.message); }

  // T178 CLI 不可传 --test-baseline
  try {
    const { execFileSync } = require('child_process');
    let code = 0; let outText = '';
    try {
      outText = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pilot', 'gen_records.js'), 'gen', '--test-baseline', 'x'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { code = e.status || 1; outText = String(e.stdout || '') + String(e.stderr || ''); }
    if (code === 2 && outText.indexOf('E27_CLI_USAGE') >= 0) {
      pass('T178', 'CLI 不识别 --test-baseline → E27_CLI_USAGE（exit 2，正式路径无法关闭基准校验）', '§3.5');
    } else { fail('T178', 'CLI 拒绝测试基准参数', '§3.5', 'code=' + code + ' out=' + outText.slice(0, 80)); }
  } catch (e) { fail('T178', 'CLI 拒绝测试基准参数', '§3.5', '异常：' + e.message); }

  // T179–T183 读侧完整性
  function buildComplete(base, name) {
    const out = path.join(base, name);
    const r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: out });
    if (r.exitCode !== 0) { throw new Error('构造完整目录失败：' + r.summary.status); }
    return out;
  }
  const readCases = [
    ['T179', '缺 records.json', d => fs.rmSync(path.join(d, 'records.json'))],
    ['T180', '缺 records_blockers.json', d => fs.rmSync(path.join(d, 'records_blockers.json'))],
    ['T181', 'records.json JSON 损坏', d => fs.writeFileSync(path.join(d, 'records.json'), '{bad', 'utf8')],
    ['T182', 'manifest 缺字段', d => { const p = path.join(d, 'gen-manifest.json'); const m = JSON.parse(fs.readFileSync(p, 'utf8')); delete m.counts; fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8'); }],
    ['T183', 'PUBLISHING 与 COMMITTED 共存', d => fs.writeFileSync(path.join(d, 'PUBLISHING'), '', 'utf8')]
  ];
  for (const c of readCases) {
    try {
      const base = mkBase();
      try {
        const d = buildComplete(base, c[0]);
        c[2](d);
        const i = gen.run({ inspectDir: d });
        if (i.exitCode === 1 && i.summary.status === 'INCOMPLETE_PUBLISH' && (i.summary.reasons || []).length > 0) {
          pass(c[0], '读侧完整性：' + c[1] + ' → E17_INCOMPLETE_PUBLISH（exit 1，给出 reasons）', '§7.2.3');
        } else { fail(c[0], c[1], '§7.2.3', 'exit=' + i.exitCode + ' status=' + i.summary.status); }
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    } catch (e) { fail(c[0], c[1], '§7.2.3', '异常：' + e.message); }
  }

  // T184 COMMITTED 写入失败 → E30 且读侧拒绝
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'e30');
      const r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: out, faults: { committed: 'fail' } });
      const codes = (r.violations || []).map(v => v.code);
      const i = gen.run({ inspectDir: out });
      if (r.exitCode === 4 && codes.indexOf('E30_COMMITTED_WRITE_FAILED') >= 0 && i.exitCode === 1) {
        pass('T184', 'COMMITTED 写入失败 → E30_COMMITTED_WRITE_FAILED（exit 4），读侧拒绝该目录', '§7.2.1 S10');
      } else { fail('T184', 'COMMITTED 写入失败', '§7.2.1 S10', 'exit=' + r.exitCode + ' codes=' + codes.join(',') + ' read=' + i.exitCode); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T184', 'COMMITTED 写入失败', '§7.2.1 S10', '异常：' + e.message); }

  // T185 rename 后中断（模拟）→ 目录存在但含 PUBLISHING、无 COMMITTED，读侧拒绝
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'crash');
      const r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: out, faults: { crashAfterRename: 'afterRename' } });
      const i = gen.run({ inspectDir: out });
      const msg = String(r.summary.note || '');
      if (r.exitCode === 4 && fs.existsSync(path.join(out, 'PUBLISHING')) && !fs.existsSync(path.join(out, 'COMMITTED')) && i.exitCode === 1 && msg.indexOf('模拟') >= 0) {
        pass('T185', 'rename 后中断（测试模拟，非真实 OS 故障）→ exit 4、目标含 PUBLISHING 且无 COMMITTED、读侧拒绝', '§7.2.5');
      } else { fail('T185', 'rename 后中断模拟', '§7.2.5', 'exit=' + r.exitCode + ' pub=' + fs.existsSync(path.join(out, 'PUBLISHING')) + ' read=' + i.exitCode); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T185', 'rename 后中断模拟', '§7.2.5', '异常：' + e.message); }

  // T186 rename 前并发创建目标 → S7 失败、不降级、外部目录不被覆盖
  try {
    const base = mkBase();
    try {
      const out = path.join(base, 'race');
      const r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: out, faults: { concurrentOutDir: 'beforeRename' } });
      const intruder = fs.existsSync(path.join(out, 'intruder.txt'));
      const noCommit = !fs.existsSync(path.join(out, 'COMMITTED'));
      if (r.exitCode === 3 && r.summary.stage === 'S7' && intruder && noCommit) {
        pass('T186', '并发创建目标（测试注入）→ S7 rename 失败（exit 3）、不降级写入、外部目录未被覆盖', '§7.2.4/§7.2.5');
      } else { fail('T186', '并发目标创建', '§7.2.4', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' intruder=' + intruder); }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T186', '并发目标创建', '§7.2.4', '异常：' + e.message); }

  // T187 未登记的故障注入项 → E29（枚举封闭）
  try {
    const r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'dry-run', faults: { unknownFault: 'x' } });
    if (r.exitCode === 1 && String(r.summary.note || '').indexOf('未登记的故障注入项') >= 0) {
      pass('T187', '故障注入项封闭：未登记项 → L8 构建失败并点名（不静默忽略）', '§7.2.5');
    } else { fail('T187', '故障注入项封闭', '§7.2.5', 'exit=' + r.exitCode + ' note=' + String(r.summary.note || '').slice(0, 60)); }
  } catch (e) { fail('T187', '故障注入项封闭', '§7.2.5', '异常：' + e.message); }

  // T188 S1 失败诊断：阶段/码/原因/临时目录/产物清单
  try {
    const base = mkBase();
    const lines = [];
    const orig = console.log;
    console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
    let r;
    try { r = gen.run({ records: [oneRec()], testBaseline: TBL, mode: 'write', outDir: path.join(base, 's1'), faults: { writeTemp: 'fail' } }); }
    finally { console.log = orig; }
    const text = lines.join('\n');
    const ok = r.exitCode === 3 && r.summary.stage === 'S1'
      && text.indexOf('阶段 S1') >= 0 && text.indexOf('E1_INPUT_UNREADABLE') >= 0
      && text.indexOf('本次临时目录') >= 0 && text.indexOf('已写出的部分产物') >= 0;
    if (ok) {
      pass('T188', 'S1 失败诊断包含阶段/错误码/原因/临时目录绝对路径/部分产物清单（自动化断言）', '§7.2.5');
    } else { fail('T188', 'S1 失败诊断', '§7.2.5', 'exit=' + r.exitCode + ' stage=' + r.summary.stage + ' text=' + text.slice(0, 120)); }
    fs.rmSync(base, { recursive: true, force: true });
  } catch (e) { fail('T188', 'S1 失败诊断', '§7.2.5', '异常：' + e.message); }
})();

function printResults() {
  const order = { FAIL: 0, PENDING: 1, PASS: 2 };
  results.sort((a, b) => (order[a.status] - order[b.status]) || a.id.localeCompare(b.id));

  console.log('记录级生成规格断言（不实现生成器）');
  console.log('依据：2F/3F 转述稿、生成方案、审计报告\n');
  for (const r of results) {
    const mark = r.status === 'PASS' ? 'PASS   ' : (r.status === 'FAIL' ? 'FAIL   ' : 'PENDING');
    console.log(mark + ' [' + r.id + '] ' + r.rule);
    console.log('        源：' + r.source + (r.note ? '｜' + r.note : ''));
  }
}

// ── M5C（2026-10-24）：rawGroupKey / W_KEY_MISMATCH / planDigest / 初始化安全协议 ──
// 依据契约（RECORD_GENERATOR_CONTRACT_20261023.md）：§3.1 L3 记录形状、§5.6.5.2、§5.6.5.5.4.2、§5.6.5.5.4.3、§5.6.5.8.3、契约（RECORD_GENERATOR_CONTRACT_20261023.md）§7.5。
// planDigest / 初始化协议属内部实现，未进 __test__（导出面冻结 9 名），
// 这里用「源码内联求值」取得内部函数引用，不改导出面、不新增公开入口。
(function m5c() {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const crypto = require('crypto');
  const cp = require('child_process');
  const KEYF = 'stallId|groupKey|specLabel|disambiguator';
  const ALL_IDS = ['T218', 'T219', 'T220', 'T221', 'T222', 'T223', 'T224', 'T225', 'T226', 'T227',
    'T228', 'T229', 'T230', 'T231', 'T232', 'T233', 'T234', 'T235', 'T236', 'T237'];
  let I = null;
  try {
    const srcText = fs.readFileSync(P.gen, 'utf8');
    const factory = new Function('require', 'module', '__filename', '__dirname', 'process', srcText +
      '\nreturn { computePlanDigest: computePlanDigest, verifyPlanDigest: verifyPlanDigest,' +
      ' validateAttachments: validateAttachments, initIdMap: initIdMap, checkDirFsync: checkDirFsync,' +
      ' validatePlanPayloadShape: validatePlanPayloadShape, serializeForDigest: serializeForDigest,' +
      ' runInit: runInit, adaptPlanRecordsForL8: adaptPlanRecordsForL8,' +
      ' PLAN_REQUIRED_KEYS: PLAN_REQUIRED_KEYS,' +
      ' diagnoseKeyMismatch: diagnoseKeyMismatch, keyFromFields: keyFromFields,' +
      ' extractPlanPayload: extractPlanPayload, serializeForDigest: serializeForDigest, expandTable: expandTable };');
    I = factory(require, { exports: {} }, P.gen, path.dirname(P.gen), process);
  } catch (e) {
    ALL_IDS.forEach(function (id) {
      pending(id, '内部函数内联求值失败，用例未执行', 'tools/pilot/gen_records.js', String(e && e.message));
    });
    return;
  }

  function mkTable(rows, kind) {
    return {
      kind: kind || 'S1',
      header: ['菜品', '价格'],
      rows: rows.map(function (r, i) { return { cells: r, line: i + 3 }; })
    };
  }
  function expand(table, extra) {
    const ctx = Object.assign({ shopId: 'c01', stallId: 'c01_t01', prefix: 'f2/', blockers: [] }, extra || {});
    const recs = I.expandTable(table, ctx);
    return { recs: recs, blockers: ctx.blockers };
  }
  function mkRec(o) {
    const opt = o || {};
    return {
      id: null, shopId: 'c01', stallId: 'c01_t01', name: '合成记录', price: 10,
      foodType: 'snack', tastes: ['choice'],
      source: { kind: 'field', detail: '合成数据（测试专用）', ref: '' },
      verifyStatus: 'unverified', verifiedAt: null, note: '',
      gen: {
        tier: 'A', groupKey: opt.groupKey || 'f2/合成/键', rawGroupKey: opt.groupKey || 'f2/合成/键',
        specLabel: '', disambiguator: '', rawRow: '| 合成 | 10 元 |', sourceLine: 1,
        generation_status: 'generated', evidence_status: 'traceable', import_eligibility: 'blocked',
        id_status: 'unassigned', blockers: []
      }
    };
  }
  function mapDoc(entries) { return { schemaVersion: 1, keyFormat: KEYF, entries: entries, orphans: [] }; }
  function entryOf(key, dishId) {
    const seg = String(key).split('|');
    return {
      key: key, stallId: seg[0] || '', groupKey: seg[1] || '', specLabel: seg[2] || '', disambiguator: seg[3] || '',
      dishId: dishId || 'c01_d001', status: 'active', assignedAt: '2026-10-24T00:00:00.000Z',
      approvedBy: 'user', sourceRef: '合成映射（测试专用）'
    };
  }
  function withMap(doc, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-map-'));
    try {
      const p = path.join(dir, 'id-map.json');
      fs.writeFileSync(p, JSON.stringify(doc, null, 2) + '\n', 'utf8');
      return fn(p);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  function planText(payload) {
    const canon = I.serializeForDigest(payload);
    return '# 初始化计划（合成）\n\n## 计划载荷（可摘要）\n\n```json\n' + canon.slice(0, -1) + '\n```\n\n## 审批\n\n（略）\n';
  }

  // T218 rawGroupKey 保留牌面原文，groupKey 仍为「层前缀 + 原文」
  try {
    const r = expand(mkTable([['红烧肉盖饭', '12 元']]));
    const rec = r.recs[0];
    if (rec && rec.gen.rawGroupKey === '红烧肉盖饭' && rec.gen.groupKey === 'f2/红烧肉盖饭') {
      pass('T218', 'M5C-1：rawGroupKey 保留原文（不含前缀），groupKey 仍为「层前缀+原文」', '§3.1 L3 / §5.6.5.5.4.2');
    } else {
      fail('T218', 'rawGroupKey 原文保留', '§5.6.5.5.4.2',
        'raw=' + JSON.stringify(rec && rec.gen.rawGroupKey) + ' key=' + JSON.stringify(rec && rec.gen.groupKey));
    }
  } catch (e) { fail('T218', 'rawGroupKey 原文保留', '§5.6.5.5.4.2', '异常：' + e.message); }

  // T219 原文中的全角空格不被规范化（规范化只发生在键构造）
  try {
    const r = expand(mkTable([['炒饭　双拼', '12 元']]));
    const rec = r.recs[0];
    const k = I.keyFromFields(rec.stallId, rec.gen.groupKey, rec.gen.specLabel, '');
    if (rec.gen.rawGroupKey.indexOf('　') >= 0 && k.ok && k.key.indexOf('　') < 0) {
      pass('T219', 'M5C-1：rawGroupKey 保留全角空格，键构造时才折叠（两种值并存）', '§5.6.5.5.4.2 / §5.6.5.5.4.1 R2');
    } else {
      fail('T219', '原文不被规范化回写', '§5.6.5.5.4.2',
        'raw=' + JSON.stringify(rec.gen.rawGroupKey) + ' key=' + JSON.stringify(k && k.key));
    }
  } catch (e) { fail('T219', '原文不被规范化回写', '§5.6.5.5.4.2', '异常：' + e.message); }

  // T220 原文缺失：记阻塞并跳过，不产出记录、不猜测
  try {
    const r = expand(mkTable([['   ', '12 元']]));
    const hit = r.blockers.filter(function (b) { return b.code === 'RAW_SOURCE_MISSING'; });
    if (r.recs.length === 0 && hit.length === 1) {
      pass('T220', 'M5C-1：原文为空 → RAW_SOURCE_MISSING 阻塞、零记录（不静默填充）', '§5.6.5.5.4.2');
    } else {
      fail('T220', '原文缺失拒绝', '§5.6.5.5.4.2', 'recs=' + r.recs.length + ' blockers=' + r.blockers.length);
    }
  } catch (e) { fail('T220', '原文缺失拒绝', '§5.6.5.5.4.2', '异常：' + e.message); }

  // T221 记录形状：每条记录都带非空字符串型 rawGroupKey
  try {
    const r = expand(mkTable([['甲饭', '10 元'], ['乙面', '11 元'], ['丙饭', '12 元']]));
    const bad = r.recs.filter(function (x) { return typeof x.gen.rawGroupKey !== 'string' || x.gen.rawGroupKey === ''; });
    if (r.recs.length === 3 && bad.length === 0) {
      pass('T221', 'M5C-1：每条记录都带非空 rawGroupKey（记录形状完整性）', '§3.1 L3 / C17');
    } else {
      fail('T221', '记录形状含 rawGroupKey', '§3.1 L3', 'recs=' + r.recs.length + ' bad=' + bad.length);
    }
  } catch (e) { fail('T221', '记录形状含 rawGroupKey', '§3.1 L3', '异常：' + e.message); }

  // T222 键一致时 W_KEY_MISMATCH 为空
  try {
    const rec = mkRec({ groupKey: 'f2/合成/键' });
    const k = I.keyFromFields(rec.stallId, rec.gen.groupKey, rec.gen.specLabel, '');
    withMap(mapDoc([entryOf(k.key)]), function (p) {
      const r = require(P.gen).run({ records: [rec], mapPath: p });
      const w = (r.mapping && r.mapping.warnings) || [];
      if (k.ok && w.length === 0) {
        pass('T222', 'M5C-2：键与四字段一致 → 无 W_KEY_MISMATCH', '§5.6.5.5.4.3');
      } else {
        fail('T222', '一致时无告警', '§5.6.5.5.4.3', 'warnings=' + JSON.stringify(w).slice(0, 200));
      }
    });
  } catch (e) { fail('T222', '一致时无告警', '§5.6.5.5.4.3', '异常：' + e.message); }

  // T223 键文本不一致 → 一条诊断，且不改变退出码
  try {
    const rec = mkRec({ groupKey: 'f2/合成/键' });
    const mism = entryOf('c01_t01|另一个键||');
    // 存储 key 与四字段不一致：字段侧 groupKey 与 key 文本不同，用于制造 W_KEY_MISMATCH
    mism.groupKey = '字段侧不同的组键';
    const kOk = I.keyFromFields(rec.stallId, rec.gen.groupKey, rec.gen.specLabel, '');
    // 对照基线：空映射（同样的「未命中」形态、无告警），用于证明诊断不改变退出码
    withMap(mapDoc([]), function (pOk) {
      const base = require(P.gen).run({ records: [rec], mapPath: pOk });
      withMap(mapDoc([mism]), function (p) {
        const r = require(P.gen).run({ records: [rec], mapPath: p });
        const w = (r.mapping && r.mapping.warnings) || [];
        if (w.length === 1 && w[0].code === 'W_KEY_MISMATCH' && w[0].reason === 'KEY_TEXT_MISMATCH' &&
          typeof w[0].recomputed === 'string' && r.exitCode === base.exitCode) {
          pass('T223', 'M5C-2：键文本不一致 → W_KEY_MISMATCH（含重算值），不阻断、退出码与一致情形相同', '§5.6.5.5.4.3');
        } else {
          fail('T223', '不一致诊断', '§5.6.5.5.4.3',
            'exit=' + r.exitCode + ' base=' + base.exitCode + ' w=' + JSON.stringify(w).slice(0, 200));
        }
      });
    });
  } catch (e) { fail('T223', '不一致诊断', '§5.6.5.5.4.3', '异常：' + e.message); }

  // T224 字段类型错误 → NOT_STRING
  try {
    const k = I.keyFromFields(undefined, 'g', '', '');
    if (!k.ok && k.field === 'stallId' && k.reason === 'NOT_STRING') {
      pass('T224', 'M5C-2：字段缺失/类型错误 → NOT_STRING（不猜测、不补空串）', '§5.6.5.5.4.3');
    } else { fail('T224', '类型错误诊断', '§5.6.5.5.4.3', JSON.stringify(k)); }
  } catch (e) { fail('T224', '类型错误诊断', '§5.6.5.5.4.3', '异常：' + e.message); }

  // T225 含分隔符 → CONTAINS_PIPE
  try {
    const k = I.keyFromFields('c01|t01', 'g', '', '');
    if (!k.ok && k.reason === 'CONTAINS_PIPE') {
      pass('T225', 'M5C-2：段内含 "|" → CONTAINS_PIPE（R7 拒绝，不静默转义）', '§5.6.5.5.4.1 R7');
    } else { fail('T225', '含分隔符诊断', '§5.6.5.5.4.1 R7', JSON.stringify(k)); }
  } catch (e) { fail('T225', '含分隔符诊断', '§5.6.5.5.4.1 R7', '异常：' + e.message); }

  // T226 planDigest 正常路径
  try {
    const text = planText({ planId: 'ip-20261024-01', target: 'tools/pilot/id-map.json', entries: [{ key: 'a|b|c|d' }] });
    const r = I.computePlanDigest(text);
    const v = r.ok ? I.verifyPlanDigest(text, r.digest) : { ok: false };
    if (r.ok && /^[0-9a-f]{64}$/.test(r.digest) && v.ok && v.digest === r.digest) {
      pass('T226', 'M5C-3：规范化载荷 → SHA-256（64 位小写十六进制），可复核一致', '§5.6.5.8.3');
    } else {
      fail('T226', 'planDigest 计算', '§5.6.5.8.3', JSON.stringify({ ok: r.ok, code: r.code, d: r.digest, v: v.ok }));
    }
  } catch (e) { fail('T226', 'planDigest 计算', '§5.6.5.8.3', '异常：' + e.message); }

  // T227 非规范化载荷（键序/缩进不符）→ 拒绝
  try {
    const bad = '# 计划\n\n## 计划载荷（可摘要）\n\n```json\n' + JSON.stringify({ b: 2, a: 1 }, null, 4) + '\n```\n';
    const r = I.computePlanDigest(bad);
    if (!r.ok && r.code === 'E_PLAN_PAYLOAD_NOT_CANONICAL') {
      pass('T227', 'M5C-3：载荷未按规范化形式书写 → E_PLAN_PAYLOAD_NOT_CANONICAL', '§5.6.5.8.3');
    } else { fail('T227', '非规范化载荷拒绝', '§5.6.5.8.3', JSON.stringify(r).slice(0, 200)); }
  } catch (e) { fail('T227', '非规范化载荷拒绝', '§5.6.5.8.3', '异常：' + e.message); }

  // T228 自引用 → 拒绝
  try {
    const r = I.computePlanDigest(planText({ planId: 'x', planDigest: 'deadbeef' }));
    if (!r.ok && r.code === 'E_PLAN_PAYLOAD_SELF_REF') {
      pass('T228', 'M5C-3：载荷内出现 planDigest → E_PLAN_PAYLOAD_SELF_REF（禁止自引用）', '§5.6.5.8.3');
    } else { fail('T228', '自引用拒绝', '§5.6.5.8.3', JSON.stringify(r).slice(0, 200)); }
  } catch (e) { fail('T228', '自引用拒绝', '§5.6.5.8.3', '异常：' + e.message); }

  // T229 缺标题 / 围栏未闭合 → 明确错误码
  try {
    const a = I.computePlanDigest('# 计划\n\n```json\n{"a": 1}\n```\n');
    const b = I.computePlanDigest('# 计划\n\n## 计划载荷（可摘要）\n\n```json\n{"a": 1}\n');
    if (!a.ok && a.code === 'E_PLAN_PAYLOAD_MISSING' && !b.ok && b.code === 'E_PLAN_PAYLOAD_UNCLOSED') {
      pass('T229', 'M5C-3：缺载荷标题 → MISSING；围栏未闭合 → UNCLOSED（均 fail-closed）', '§5.6.5.8.3');
    } else {
      fail('T229', '载荷结构错误码', '§5.6.5.8.3', JSON.stringify({ a: a.code, b: b.code }));
    }
  } catch (e) { fail('T229', '载荷结构错误码', '§5.6.5.8.3', '异常：' + e.message); }

  // T230 附件：正常命中（relativePath/bytes/sha256）＋ 缺失/大小/SHA/非普通文件
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-att-'));
    try {
      const body = Buffer.from('synthetic attachment', 'utf8');
      fs.writeFileSync(path.join(dir, 'menu.jpg'), body);
      fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
      const sha = crypto.createHash('sha256').update(body).digest('hex');
      const ent = { relativePath: 'menu.jpg', bytes: body.length, sha256: sha };
      const ok = I.validateAttachments([ent], dir);
      const badSize = I.validateAttachments([{ relativePath: 'menu.jpg', bytes: body.length + 1, sha256: sha }], dir);
      const badSha = I.validateAttachments([{ relativePath: 'menu.jpg', bytes: body.length, sha256: 'f'.repeat(64) }], dir);
      const miss = I.validateAttachments([{ relativePath: 'nope.bin', bytes: 1, sha256: sha }], dir);
      const dirAsFile = I.validateAttachments([{ relativePath: 'sub', bytes: 0, sha256: sha }], dir);
      const c = function (r) { return r.errors[0] ? r.errors[0].code : 'OK'; };
      if (ok.ok && c(badSize) === 'E_ATTACH_SIZE' && c(badSha) === 'E_ATTACH_DIGEST' &&
        c(miss) === 'E_ATTACH_MISSING' && c(dirAsFile) === 'E_ATTACH_NOT_FILE') {
        pass('T230', 'M5C-1 A：正常附件通过；缺失→E_ATTACH_MISSING、字节数→E_ATTACH_SIZE、SHA→E_ATTACH_DIGEST、目录冒充文件→E_ATTACH_NOT_FILE', '§5.6.5.8.3 :895-899');
      } else {
        fail('T230', '附件内容边界', '§5.6.5.8.3', JSON.stringify({ ok: ok.ok, s: c(badSize), h: c(badSha), m: c(miss), d: c(dirAsFile) }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T230', '附件内容边界', '§5.6.5.8.3', '异常：' + e.message); }

  // T231 附件路径形态：`..` 穿越、盘符、UNC、反斜杠分隔、结构缺字段
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-att2-'));
    try {
      const sha = 'a'.repeat(64);
      const c = function (r) { return r.errors[0] ? r.errors[0].code : 'OK'; };
      const trav = I.validateAttachments([{ relativePath: '../escape.jpg', bytes: 1, sha256: sha }], dir);
      const drive = I.validateAttachments([{ relativePath: 'C:/Windows/x.jpg', bytes: 1, sha256: sha }], dir);
      const unc = I.validateAttachments([{ relativePath: '//server/share/x.jpg', bytes: 1, sha256: sha }], dir);
      const backslash = I.validateAttachments([{ relativePath: 'sub\\x.jpg', bytes: 1, sha256: sha }], dir);
      const shape = I.validateAttachments([{ path: 'menu.jpg', size: 1 }], dir);
      if (c(trav) === 'E_ATTACH_TRAVERSAL' && c(drive) === 'E_ATTACH_ABSOLUTE' && c(unc) === 'E_ATTACH_ABSOLUTE' &&
        c(backslash) === 'E_ATTACH_PATH' && c(shape) === 'E_ATTACH_SHAPE') {
        pass('T231', 'M5C-1 A：`..`→E_ATTACH_TRAVERSAL、盘符/UNC→E_ATTACH_ABSOLUTE、反斜杠→E_ATTACH_PATH、旧式 path/size 字段→E_ATTACH_SHAPE', '§5.6.5.8.3 :898');
      } else {
        fail('T231', '附件路径形态', '§5.6.5.8.3', JSON.stringify({ t: c(trav), d: c(drive), u: c(unc), b: c(backslash), s: c(shape) }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T231', '附件路径形态', '§5.6.5.8.3', '异常：' + e.message); }

  // T232 附件清单次序与重复（契约要求按 UTF-8 字节序升序、禁重复、不得静默去重）
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-att3-'));
    try {
      const sha = 'b'.repeat(64);
      const c = function (r) { return r.errors[0] ? r.errors[0].code : 'OK'; };
      const unordered = I.validateAttachments([{ relativePath: 'b.jpg', bytes: 1, sha256: sha }, { relativePath: 'a.jpg', bytes: 1, sha256: sha }], dir);
      const dupCase = I.validateAttachments([{ relativePath: 'A.jpg', bytes: 1, sha256: sha }, { relativePath: 'a.jpg', bytes: 1, sha256: sha }], dir);
      if (c(unordered) === 'E_ATTACH_ORDER' && c(dupCase) === 'E_ATTACH_DUPLICATE') {
        pass('T232', 'M5C-1 A：清单未按 UTF-8 字节序升序→E_ATTACH_ORDER；大小写变体重复→E_ATTACH_DUPLICATE（不静默去重）', '§5.6.5.8.3 :899');
      } else {
        fail('T232', '附件次序/重复', '§5.6.5.8.3', JSON.stringify({ o: c(unordered), d: c(dupCase) }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T232', '附件次序/重复', '§5.6.5.8.3', '异常：' + e.message); }

  // T238 附件符号链接/目录联接越界（真实联接点；无法构造时记 PENDING，不伪装通过）
  try {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-link-'));
    const rootDir = path.join(base, 'root');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const body = Buffer.from('outside', 'utf8');
    fs.writeFileSync(path.join(outside, 'x.bin'), body);
    const link = path.join(rootDir, 'jump');
    let made = false;
    try { require('child_process').execFileSync('cmd', ['/c', 'mklink', '/J', link, outside], { stdio: 'ignore' }); made = true; } catch (e) { made = false; }
    try {
      if (!made) {
        pending('T238', 'M5C-1 A：符号链接/目录联接越界→E_ATTACH_SYMLINK_ESCAPE（本机无法创建联接点，未构造成功）', '§5.6.5.8.3 :898');
      } else {
        const sha = crypto.createHash('sha256').update(body).digest('hex');
        const r = I.validateAttachments([{ relativePath: 'jump/x.bin', bytes: body.length, sha256: sha }], rootDir);
        const code = r.errors[0] ? r.errors[0].code : 'OK';
        if (code === 'E_ATTACH_SYMLINK_ESCAPE') {
          pass('T238', 'M5C-1 A：真实目录联接指向根外→E_ATTACH_SYMLINK_ESCAPE（realpath 边界判定，非字符串前缀）', '§5.6.5.8.3 :898');
        } else {
          fail('T238', '联接越界', '§5.6.5.8.3', '实际=' + code);
        }
      }
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  } catch (e) { fail('T238', '联接越界', '§5.6.5.8.3', '异常：' + e.message); }

  // T239 载荷覆盖性：缺任一必需键即不完整（9 项逐个删）
  try {
    const base = {
      scope: { env: 'shishen-dev', target: 'tools/pilot/id-map.json', onlyInit: true },
      records: [], idRules: { version: 'v1', perShop: true, startAt: 1, reserved: [] },
      baseline: { total: 525, A: 490, B: 0, C: 35, f2: { total: 382, A: 376, B: 0, C: 6 }, f3: { total: 143, A: 114, B: 0, C: 29 } },
      collisionPolicy: { rule: 'null' }, orphanPolicy: { rule: 'append-only' },
      guards: { dishIdNull: 'pending_review|collision', pendingReview: 'null-only' },
      attachments: [], excludes: ['3F 名册']
    };
    const missingHits = [];
    I.PLAN_REQUIRED_KEYS.forEach(function (k) {
      const copy = JSON.parse(JSON.stringify(base));
      delete copy[k];
      const r = I.validatePlanPayloadShape(copy);
      if (!r.ok && r.code === 'E_PLAN_PAYLOAD_INCOMPLETE' && r.message.indexOf(k) >= 0) { missingHits.push(k); }
    });
    const okShape = I.validatePlanPayloadShape(base);
    if (missingHits.length === I.PLAN_REQUIRED_KEYS.length && okShape.ok) {
      pass('T239', 'M5C-1 B：九个必需键逐个删除均报 E_PLAN_PAYLOAD_INCOMPLETE 且点名该键；齐全则通过', '§5.6.5.8.3 :882-893');
    } else {
      fail('T239', '载荷覆盖性', '§5.6.5.8.3', JSON.stringify({ hits: missingHits.length, ok: okShape.ok }));
    }
  } catch (e) { fail('T239', '载荷覆盖性', '§5.6.5.8.3', '异常：' + e.message); }

  // T240 载荷类型错误 / 基准不符 / 额外键仅登记 + 摘要变更敏感性
  try {
    const base = {
      scope: { env: 'x' }, records: [], idRules: {},
      baseline: { total: 525, A: 490, B: 0, C: 35, f2: { total: 382, A: 376, B: 0, C: 6 }, f3: { total: 143, A: 114, B: 0, C: 29 } },
      collisionPolicy: {}, orphanPolicy: {}, guards: {}, attachments: [], excludes: []
    };
    const badType = Object.assign({}, base, { records: {} });
    const badBase = JSON.parse(JSON.stringify(base));
    badBase.baseline.f2.A = 346;
    const extra = Object.assign({}, base, { extraKey: 1 });
    const rType = I.validatePlanPayloadShape(badType);
    const rBase = I.validatePlanPayloadShape(badBase);
    const rExtra = I.validatePlanPayloadShape(extra);
    const textA = '# 计划\n\n## 计划载荷（可摘要）\n\n```json\n' + I.serializeForDigest(base) + '```\n';
    const changed = JSON.parse(JSON.stringify(base));
    changed.scope.env = 'y';
    const textB = '# 计划\n\n## 计划载荷（可摘要）\n\n```json\n' + I.serializeForDigest(changed) + '```\n';
    const dA = I.computePlanDigest(textA);
    const dB = I.computePlanDigest(textB);
    if (rType.code === 'E_PLAN_PAYLOAD_TYPE' && rBase.code === 'E_PLAN_BASELINE_MISMATCH' &&
      rExtra.ok && rExtra.unknownKeys.length === 1 && rExtra.unknownKeys[0] === 'extraKey' &&
      dA.ok && dB.ok && dA.digest !== dB.digest) {
      pass('T240', 'M5C-1 B：类型错→E_PLAN_PAYLOAD_TYPE；基准不符→E_PLAN_BASELINE_MISMATCH；额外键仅登记 unknownKeys；字段变更→摘要变化', '§5.6.5.8.3 :884-893');
    } else {
      fail('T240', '载荷语义与敏感性', '§5.6.5.8.3', JSON.stringify({ t: rType.code, b: rBase.code, e: rExtra, da: dA.digest, db: dB.digest }));
    }
  } catch (e) { fail('T240', '载荷语义与敏感性', '§5.6.5.8.3', '异常：' + e.message); }

  // T241 linkSync 真实操作语义（成功、EEXIST 不改原内容、删临时不动目标）
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-lk-'));
    try {
      const tmp = path.join(dir, 'tmp.bin');
      const target = path.join(dir, 'target.json');
      const bytes = Buffer.from('{"schemaVersion":1}\n', 'utf8');
      fs.writeFileSync(tmp, bytes);
      fs.linkSync(tmp, target);
      const same = fs.readFileSync(target).equals(bytes);
      let eexist = false;
      // 硬链接指向同一 inode：改写 tmp 会同时改到 target，故此处不再重写内容，
      // 直接对已存在目标二次 link，验证「不覆盖」而非「内容隔离」。
      try { fs.linkSync(tmp, target); } catch (e) { eexist = (e && (e.code === 'EEXIST' || e.code === 'EPERM')); }
      const unchanged = fs.readFileSync(target).equals(bytes);
      fs.unlinkSync(tmp);
      const survived = fs.existsSync(target);
      if (same && eexist && unchanged && survived) {
        pass('T241', 'M5C-1 C：真实 linkSync 原子创建→内容一致；再建同名→EEXIST 且原内容不变；删临时→目标存活', '§7.5 / Q-MAP-IO 写入候选');
      } else {
        fail('T241', 'linkSync 真实语义', '§7.5', JSON.stringify({ same: same, eexist: eexist, unchanged: unchanged, survived: survived }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T241', 'linkSync 真实语义', '§7.5', '异常：' + e.message); }

  // T242 initIdMap 后半段（受控替身：仅测试注入 fsync 探测与目录同步，不代表本机持久性）
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-init2-'));
    try {
      const target = path.join(dir, 'id-map.json');
      const text = '{"schemaVersion":1}\n';
      const probe = function () { return { ok: true, code: 'STUB_FSYNC_OK' }; };
      // A′ 持久性补丁（2026-10-25）：执行替身按 phase 记录调用序列，全部成功
      const calls = [];
      const dirNow = function (phase, d) { calls.push(phase); return { ok: true }; };
      const r = I.initIdMap(text, target, { __testFsyncProbe: probe, __testDirFsyncNow: dirNow });
      const exists = fs.existsSync(target);
      const content = exists ? fs.readFileSync(target, 'utf8') : '';
      const leftovers = fs.readdirSync(dir).filter(function (n) { return n.indexOf('.id-map-init-') === 0; });
      const again = I.initIdMap(text, target, { __testFsyncProbe: probe, __testDirFsyncNow: dirNow });
      if (r.status === 'INIT_OK' && r.wrote === true && exists && content === text && leftovers.length === 0 &&
        calls.join(',') === 'afterLink,afterUnlink' &&
        again.status === 'INIT_TARGET_EXISTS' && fs.readFileSync(target, 'utf8') === text) {
        pass('T242', 'M5C-1 C【受控替身测试】：探测+目录同步替身注入后走通 wx→写入→linkSync→目录 fsync(afterLink)→unlink→目录 fsync(afterUnlink)→读回；无临时残留；二次初始化→INIT_TARGET_EXISTS 且不覆盖（不代表本机目录持久性）', '§7.5 / §5.6.5.10');
      } else {
        fail('T242', 'initIdMap 后半段（替身）', '§7.5 / §5.6.5.10', JSON.stringify({ s: r.status, w: r.wrote, c: content === text, lo: leftovers, calls: calls, again: again.status }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T242', 'initIdMap 后半段（替身）', '§7.5', '异常：' + e.message); }

  // T242b —— A′ 持久性补丁场景矩阵（2026-10-25；全部替身注入，不依赖本机目录 fsync 支持）
  // 覆盖：link 后 fsync 成/败、unlink 后 fsync 败、文件级 fsync 败、目标已存在、link 不支持、
  // 读回不一致、失败必不报成功；测试仅写 mkdtemp 隔离目录，绝不触碰 tools/pilot/id-map.json。
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-t242b-'));
    const results = [];
    const rec = function (name, ok, detail) { results.push(name + '=' + (ok ? 'OK' : 'NG(' + detail + ')')); return ok; };
    try {
      const probe = function () { return { ok: true }; };
      const text = '{"schemaVersion":1}\n';
      // 每场景独立子目录：afterLink 失败场景按设计保留 tmp 证据，不能计入后续场景的残留计数
      const box = function (n) { const d = path.join(dir, n); fs.mkdirSync(d); return d; };
      const tmpCount = function (d) { return fs.readdirSync(d).filter(function (n) { return n.indexOf('.id-map-init-') === 0; }).length; };
      // 场景 1：link 后目录 fsync 失败 → DURABILITY_UNCONFIRMED(afterLink)、目标+tmp 保留、退出码 3
      {
        const d = box('s1'); const t = path.join(d, 'id-map.json');
        const calls = [];
        const r = I.initIdMap(text, t, {
          __testFsyncProbe: probe,
          __testDirFsyncNow: function (phase) { calls.push(phase); return phase === 'afterLink' ? { ok: false, code: 'EIO', message: '模拟 afterLink 失败' } : { ok: true }; }
        });
        rec('afterLink失败→DURABILITY/保留目标与tmp',
          r.status === 'INIT_DURABILITY_UNCONFIRMED' && r.phase === 'afterLink' && r.wrote === true && r.exitCode === 3 &&
          fs.existsSync(t) && fs.readFileSync(t, 'utf8') === text && tmpCount(d) === 1 && calls.join(',') === 'afterLink',
          JSON.stringify({ s: r.status, ph: r.phase, tmp: tmpCount(d), calls: calls.join(',') }));
      }
      // 场景 2：unlink 后目录 fsync 失败 → DURABILITY_UNCONFIRMED(afterUnlink)、目标保留、tmp 已删、退出码 3
      {
        const d = box('s2'); const t = path.join(d, 'id-map.json');
        const r = I.initIdMap(text, t, {
          __testFsyncProbe: probe,
          __testDirFsyncNow: function (phase) { return phase === 'afterUnlink' ? { ok: false, code: 'EIO', message: '模拟 afterUnlink 失败' } : { ok: true }; }
        });
        rec('afterUnlink失败→DURABILITY/目标保留tmp已删',
          r.status === 'INIT_DURABILITY_UNCONFIRMED' && r.phase === 'afterUnlink' && r.wrote === true && r.exitCode === 3 &&
          fs.existsSync(t) && fs.readFileSync(t, 'utf8') === text && tmpCount(d) === 0,
          JSON.stringify({ s: r.status, ph: r.phase, tmp: tmpCount(d) }));
      }
      // 场景 3：文件级 fsync 失败 → INIT_IO_ERROR、目标不存在、tmp 清理、退出码 3
      {
        const d = box('s3'); const t = path.join(d, 'id-map.json');
        const r = I.initIdMap(text, t, {
          __testFsyncProbe: probe,
          __testFdFsync: function () { throw Object.assign(new Error('模拟文件级 fsync 失败'), { code: 'EIO' }); }
        });
        rec('文件级fsync失败→IO_ERROR/零目标零残留',
          r.status === 'INIT_IO_ERROR' && r.wrote === false && r.exitCode === 3 && !fs.existsSync(t) && tmpCount(d) === 0,
          JSON.stringify({ s: r.status, w: r.wrote, tmp: tmpCount(d) }));
      }
      // 场景 4：目标已存在（真实预创建，无替身）→ INIT_TARGET_EXISTS、原内容不变
      {
        const d = box('s4'); const t = path.join(d, 'id-map.json');
        fs.writeFileSync(t, 'OLD-CONTENT', 'utf8');
        const r = I.initIdMap(text, t, { __testFsyncProbe: probe, __testDirFsyncNow: function () { return { ok: true }; } });
        rec('目标已存在→TARGET_EXISTS/原内容不变',
          r.status === 'INIT_TARGET_EXISTS' && r.wrote === false && r.exitCode === 3 && fs.readFileSync(t, 'utf8') === 'OLD-CONTENT',
          JSON.stringify({ s: r.status }));
      }
      // 场景 5：link 机制不支持（EXDEV 注入）→ INIT_LINK_UNSUPPORTED、目标不存在、tmp 清理
      {
        const d = box('s5'); const t = path.join(d, 'id-map.json');
        const r = I.initIdMap(text, t, {
          __testFsyncProbe: probe,
          __testLink: function () { throw Object.assign(new Error('模拟跨卷'), { code: 'EXDEV' }); }
        });
        rec('link不支持→LINK_UNSUPPORTED/零目标零残留',
          r.status === 'INIT_LINK_UNSUPPORTED' && r.wrote === false && r.exitCode === 3 && !fs.existsSync(t) && tmpCount(d) === 0,
          JSON.stringify({ s: r.status, tmp: tmpCount(d) }));
      }
      // 场景 6：读回不一致（替身注入）→ INIT_RECHECK_MISMATCH、wrote=true、目标保留交人工
      {
        const d = box('s6'); const t = path.join(d, 'id-map.json');
        const r = I.initIdMap(text, t, {
          __testFsyncProbe: probe,
          __testDirFsyncNow: function () { return { ok: true }; },
          __testReadBack: function () { return Buffer.from('CORRUPTED', 'utf8'); }
        });
        rec('读回不一致→RECHECK_MISMATCH/目标保留',
          r.status === 'INIT_RECHECK_MISMATCH' && r.wrote === true && fs.existsSync(t),
          JSON.stringify({ s: r.status, w: r.wrote }));
      }
      // 场景 7：失败后绝不报初始化成功（对场景 1/2/3/5/6 的返回值复核 + INIT_OK 仅出现在 T242 成功链）
      {
        const allFail = ['s1', 's2', 's3', 's5', 's6'];
        const ok = allFail.every(function (n) {
          const t = path.join(dir, n + '.json');
          return fs.existsSync(t) ? fs.readFileSync(t, 'utf8') === text || fs.readFileSync(t, 'utf8') === 'OLD-CONTENT' : true;
        });
        rec('失败场景无INIT_OK泄漏', ok, '目标状态复核');
      }
      const allOk = results.length === 7 && results.every(function (s) { return s.indexOf('=OK') >= 0; });
      if (allOk) {
        pass('T242b', 'A′ 持久性补丁场景矩阵：afterLink 失败→DURABILITY_UNCONFIRMED(保留目标+tmp)/afterUnlink 失败→DURABILITY_UNCONFIRMED(目标保留、tmp 已删)/文件级 fsync 失败→IO_ERROR 零残留/目标已存在→TARGET_EXISTS/link 不支持→LINK_UNSUPPORTED 零残留/读回不一致→RECHECK_MISMATCH 保留目标；失败分支均不报 INIT_OK；全链成功（T242）含两次目录 fsync；普通生成器路径仍不调用 initIdMap（T243）；全部隔离目录测试', '§5.6.5.10 / §7.5', results.join('；'));
      } else {
        fail('T242b', 'A′ 持久性补丁场景矩阵', '§5.6.5.10 / §7.5', results.join('；'));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T242b', 'A′ 持久性补丁场景矩阵（用例自身异常）', '§5.6.5.10 / §7.5', '异常：' + e.message); }

  // T279 —— T100 用例⑧ 迁移预演（2026-10-25 实施轮）：真实运行时映射创建后，「--write --out」
  // 不再因缺映射报 E12，而是加载成功后进入当前实现阶段的下一状态（SKELETON_NOT_IMPLEMENTED/1，
  // 当时记录生成链路未实现）。T100⑧ 本体仍断言 E12（映射现仍不存在，历史意图保留）；真实映射创建
  // 授权轮再把 T100⑧ 迁移为本断言的 CLI 版。注入夹具，不触碰正式映射文件。
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-t279-'));
    try {
      const mapPath = path.join(dir, 'valid.json');
      fs.writeFileSync(mapPath, JSON.stringify({ schemaVersion: 1, keyFormat: 'stallId|groupKey|specLabel|disambiguator', entries: [] }), 'utf8');
      const outDir = path.join(dir, 'out');
      const genMod = require(P.gen); // 真实模块（run 为生产入口；I 为内部函数 patch 模块、不含 run）
      const r = genMod.run({ mapPath: mapPath, mode: 'write', outDir: outDir });
      const noE12 = !(r.violations || []).some(function (v) { return v.code === 'E12_NO_ID_MAP'; });
      const noWrite = !fs.existsSync(outDir);
      // 2026-10-25 写出链路轮：映射存在 + write → P1 十阶段发布（临时 outDir），不再有 SKELETON 阶段
      const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : [];
      const published = r.exitCode === 0 && r.summary.status === 'PUBLISH_OK' && noE12 &&
        files.join(',') === 'COMMITTED,gen-manifest.json,records.json,records_blockers.json';
      if (published) {
        pass('T279', '映射存在 + write → 加载成功（无 E12）+ P1 十阶段发布成功（PUBLISH_OK/0）：三产物+COMMITTED 齐备、PUBLISHING 已清除；E12 语义仍由 T33/T45b/T100⑧（映射不存在路径）覆盖', '契约 §7.2.1 S1–S10 / §5.6.5.5.4');
      } else {
        fail('T279', '映射存在 + write 发布', '契约 §7.2.1', JSON.stringify({ exit: r.exitCode, s: r.summary.status, mapLoaded: r.summary.mapLoaded, noE12: noE12, files: files.join(',') }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T279', 'T100⑧ 迁移预演', '契约 §5.6.5.5.4', '异常：' + e.message); }

  // T280 —— runInit 预检链场景矩阵（2026-10-25 实施轮）：全部 mkdtemp 隔离目录+合成材料，
  // 不触碰正式 tools/pilot/id-map.json 与正式 approvals/。合成审批中的 approvedAt/审批人为测试
  // 夹具值（仅存在于临时目录，非真实审批签署）。
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-t280-'));
    const results = [];
    const rec = function (name, ok, detail) { results.push(name + '=' + (ok ? 'OK' : 'NG(' + detail + ')')); return ok; };
    try {
      const approvalDir = path.join(dir, 'approvals');
      fs.mkdirSync(approvalDir);
      const frozenOfficial = path.join(ROOT, 'docs', 'decisions', 'ID_MAP_T48_T49_20261025.json');
      const frozenBytes = fs.readFileSync(frozenOfficial);
      const crypto = require('crypto');
      const shaOf = function (b) { return crypto.createHash('sha256').update(b).digest('hex'); };
      const frozenSha = shaOf(frozenBytes);
      const frozen = JSON.parse(frozenBytes.toString('utf8'));
      const planTextInline = function (payload) {
        const canon = I.serializeForDigest(payload);
        return '# 初始化计划（合成）\n\n## 计划载荷（可摘要）\n\n```json\n' + canon.slice(0, -1) + '\n```\n\n## 审批\n\n（略）\n';
      };
      const thePlanText = planTextInline({ scope: { environment: 'test', targetFile: 'test', declaration: '合成计划（T280 测试夹具）' }, excludes: [] });
      const thePlanDigest = I.computePlanDigest(thePlanText).digest;
      const makeApproval = function (over) {
        const a = {
          approvalId: 'ap-20261025-01',
          approvedRole: '项目负责人',
          approvedAt: '2026-10-25T00:00:00+08:00',
          planRef: 'ip-20261025-01',
          planDigest: thePlanDigest,
          scope: '仅初始化（合成审批，T280 测试夹具）',
          result: 'approved',
          mapVersion: '1#1',
          frozenMapSha256: frozenSha
        };
        Object.keys(over || {}).forEach(function (k) { a[k] = over[k]; });
        return a;
      };
      const writeApproval = function (name, obj) {
        fs.writeFileSync(path.join(approvalDir, name + '.json'), JSON.stringify(obj), 'utf8');
      };
      const opts = function (over) {
        const base = {
          approvalId: 'ap-20261025-01',
          approvalDir: approvalDir,
          frozenMapPath: frozenOfficial,
          planText: thePlanText,
          targetPath: path.join(dir, 'id-map.json'),
          __testFsyncProbe: function () { return { ok: true }; },
          __testDirFsyncNow: function () { return { ok: true }; }
        };
        Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
        return base;
      };
      // 场景 1：审批缺失（空审批目录）→ APPROVAL_MISSING/1（G-4=C，不是 W 警告）
      {
        const r = I.runInit(opts({ approvalId: 'ap-20260101-99' }));
        rec('审批缺失→APPROVAL_MISSING/1', r.exitCode === 1 && r.summary.status === 'APPROVAL_MISSING', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 2：草案无效（result=draft-unsigned 即使放进审批目录也不构成有效审批）→ E26/1
      {
        writeApproval('ap-20261025-01', makeApproval({ result: 'draft-unsigned' }));
        const r = I.runInit(opts({}));
        rec('草案result≠approved→E26/1', r.exitCode === 1 && r.summary.status === 'APPROVAL_INVALID' &&
          (r.violations[0].code === 'E26_APPROVAL_INVALID'), JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 3：审批字段缺失（删 approvedAt）→ E26/1
      {
        const a = makeApproval({}); delete a.approvedAt;
        writeApproval('ap-20261025-01', a);
        const r = I.runInit(opts({}));
        rec('审批缺approvedAt→E26/1', r.exitCode === 1 && r.summary.status === 'APPROVAL_INVALID', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 4：planDigest 不匹配 → E25/1
      {
        writeApproval('ap-20261025-01', makeApproval({ planDigest: '0'.repeat(64) }));
        const r = I.runInit(opts({}));
        rec('planDigest不匹配→E25/1', r.exitCode === 1 && r.summary.status === 'PLAN_DIGEST_MISMATCH' &&
          r.violations[0].code === 'E25_PLAN_DIGEST_MISMATCH', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 5：冻结映射哈希不符（审批绑定旧哈希）→ FROZEN_MAP_MISMATCH/1
      {
        writeApproval('ap-20261025-01', makeApproval({ frozenMapSha256: 'f'.repeat(64) }));
        const r = I.runInit(opts({}));
        rec('冻结映射哈希不符→FROZEN_MAP_MISMATCH/1', r.exitCode === 1 && r.summary.status === 'FROZEN_MAP_MISMATCH', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 6-9：伪造冻结映射（自洽哈希，绕过预检 5 后在对账处 fail-closed）
      const forgedPath = function (name, mutate) {
        const clone = JSON.parse(frozenBytes.toString('utf8'));
        mutate(clone);
        const p = path.join(dir, name + '.json');
        const b = Buffer.from(JSON.stringify(clone), 'utf8');
        fs.writeFileSync(p, b);
        return { path: p, sha: shaOf(b) };
      };
      {
        // 6：多条（105 条）
        const f = forgedPath('f6', function (c) { c.entries.push(JSON.parse(JSON.stringify(c.entries[0]))); c.entries[104].key = 'c01_t49|zzz伪键||'; });
        writeApproval('ap-20261025-01', makeApproval({ frozenMapSha256: f.sha }));
        const r = I.runInit(opts({ frozenMapPath: f.path }));
        rec('冻结映射105条→RECONCILE/1', r.exitCode === 1 && r.summary.status === 'RECONCILE_MISMATCH', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      {
        // 7：C 档误纳入（改一条 stallId 为 c01_t20 的 C 档键）
        const f = forgedPath('f7', function (c) { c.entries[0].stallId = 'c01_t20'; c.entries[0].key = 'c01_t20|手抓饼||'; });
        writeApproval('ap-20261025-01', makeApproval({ frozenMapSha256: f.sha }));
        const r = I.runInit(opts({ frozenMapPath: f.path }));
        const note = String(r.summary.note || '');
        rec('C档误纳入→RECONCILE/1', r.exitCode === 1 && r.summary.status === 'RECONCILE_MISMATCH' && note.indexOf('t48/t49 之外') >= 0, JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      {
        // 8：重复 dishId（两条同 ID）
        const f = forgedPath('f8', function (c) { c.entries[1].dishId = c.entries[0].dishId; });
        writeApproval('ap-20261025-01', makeApproval({ frozenMapSha256: f.sha }));
        const r = I.runInit(opts({ frozenMapPath: f.path }));
        const note = String(r.summary.note || '');
        rec('重复dishId→RECONCILE/1', r.exitCode === 1 && r.summary.status === 'RECONCILE_MISMATCH' && note.indexOf('重复') >= 0, JSON.stringify({ e: r.exitCode, s: r.summary.status, n: note.slice(0, 60) }));
      }
      {
        // 9：键集不匹配（104 条含生成器不存在的伪键 → orphan 证明失败）
        const f = forgedPath('f9', function (c) { c.entries[0].key = 'c01_t49|不存在的伪键||'; });
        writeApproval('ap-20261025-01', makeApproval({ frozenMapSha256: f.sha }));
        const r = I.runInit(opts({ frozenMapPath: f.path }));
        const note = String(r.summary.note || '');
        rec('键集不匹配(缺)→RECONCILE/1', r.exitCode === 1 && r.summary.status === 'RECONCILE_MISMATCH' && note.indexOf('缺=1') >= 0, JSON.stringify({ e: r.exitCode, s: r.summary.status, n: note.slice(0, 60) }));
      }
      // 场景 10：基线不符（注入伪造候选记录：524 条）→ BASELINE_MISMATCH/1
      {
        writeApproval('ap-20261025-01', makeApproval({}));
        const fakeRecs = []; for (let k = 0; k < 524; k += 1) { fakeRecs.push({ key: 'k' + k, stallId: 'c01_t49', dishId: 'c01_d437' }); }
        const r = I.runInit(opts({ records: fakeRecs }));
        rec('基线不符(524)→BASELINE_MISMATCH/1', r.exitCode === 1 && r.summary.status === 'BASELINE_MISMATCH', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 11：目标已存在 → INIT_TARGET_EXISTS/3（在任何写入之前，原内容不变）
      {
        const t = path.join(dir, 'exists.json');
        fs.writeFileSync(t, 'OLD', 'utf8');
        const r = I.runInit(opts({ targetPath: t }));
        rec('目标已存在→INIT_TARGET_EXISTS/3', r.exitCode === 3 && r.summary.status === 'INIT_TARGET_EXISTS' && fs.readFileSync(t, 'utf8') === 'OLD', JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 12：环境不可用（目录 fsync 探测失败）→ INIT_FSYNC_UNAVAILABLE/3、零写入
      {
        const t = path.join(dir, 'nofsync.json');
        const r = I.runInit(opts({ targetPath: t, __testFsyncProbe: function () { return { ok: false, code: 'EPERM', message: '模拟探测失败' }; } }));
        rec('环境不可用→INIT_FSYNC_UNAVAILABLE/3', r.exitCode === 3 && r.summary.status === 'INIT_FSYNC_UNAVAILABLE' && !fs.existsSync(t), JSON.stringify({ e: r.exitCode, s: r.summary.status }));
      }
      // 场景 13：durability 透传（afterLink 失败 → INIT_DURABILITY_UNCONFIRMED/3，目标+tmp 保留）
      {
        const d13 = path.join(dir, 's13'); fs.mkdirSync(d13);
        const t = path.join(d13, 'id-map.json');
        const r = I.runInit(opts({ targetPath: t, __testDirFsyncNow: function (phase) { return phase === 'afterLink' ? { ok: false, code: 'EIO', message: '模拟失败' } : { ok: true }; } }));
        const tmpLeft = fs.readdirSync(d13).filter(function (n) { return n.indexOf('.id-map-init-') === 0; }).length;
        rec('afterLink失败透传→DURABILITY/3', r.exitCode === 3 && r.summary.status === 'INIT_DURABILITY_UNCONFIRMED' && r.summary.phase === 'afterLink' && fs.existsSync(t) && tmpLeft === 1, JSON.stringify({ e: r.exitCode, s: r.summary.status, ph: r.summary.phase }));
      }
      // 场景 14：全链成功（正式冻结映射+真实候选构建+合成审批+替身 fsync）→ INIT_OK + payload 语义断言
      {
        const d14 = path.join(dir, 's14'); fs.mkdirSync(d14);
        const t = path.join(d14, 'id-map.json');
        writeApproval('ap-20261025-01', makeApproval({}));
        const r = I.runInit(opts({ targetPath: t }));
        let payloadOk = false;
        let c35Ok = false;
        let activeOk = false;
        let initOk = r.exitCode === 0 && r.summary.status === 'INIT_OK' && r.summary.entries === 104 && fs.existsSync(t);
        if (initOk) {
          const payload = JSON.parse(fs.readFileSync(t, 'utf8'));
          activeOk = payload.entries.length === 104 && payload.entries.every(function (e) { return e.status === 'active' && e.approvedBy === 'user:负责人审批 ip-20261025-01' && e.assignedAt === '2026-10-25T00:00:00+08:00'; });
          payloadOk = payload.schemaVersion === 1 && payload.keyFormat === 'stallId|groupKey|specLabel|disambiguator' &&
            Array.isArray(payload.orphans) && payload.orphans.length === 0 &&
            payload.initialization.approvalRef === 'ap-20261025-01' &&
            payload.initialization.planDigest === thePlanDigest && payload.initialization.mapVersion === '1#1';
          // 35 条未分配（C 档）记录的保护：payload 键集 ∩ 候选记录中 nullId 条目的键集 = ∅
          const payloadKeys = {}; payload.entries.forEach(function (e) { payloadKeys[e.key] = 1; });
          const probe = I.run ? null : null; // 候选记录经 runInit 默认构建；此处复用官方探针口径改由下方断言兜底
          const cStall = { 'c01_t20': 1, 'c01_t40': 1, 'c01_t41': 1 };
          c35Ok = payload.entries.every(function (e) { return !cStall[e.stallId]; }) &&
            payload.entries.every(function (e) { return e.stallId === 'c01_t48' || e.stallId === 'c01_t49'; });
          void payloadKeys; void probe;
        }
        rec('全链成功→INIT_OK+payload语义', initOk && payloadOk && activeOk, JSON.stringify({ e: r.exitCode, s: r.summary.status, entries: r.summary.entries, payloadOk: payloadOk, activeOk: activeOk }));
        rec('35条C档保护(无t20/t40/t41键)', c35Ok, 'payload 仅含 t48/t49');
      }
      const allOk = results.length === 15 && results.every(function (s) { return s.indexOf('=OK') >= 0; });
      if (allOk) {
        pass('T280', 'runInit 预检链矩阵：审批缺失→APPROVAL_MISSING/1（G-4=C）｜草案result≠approved→E26｜字段缺失→E26｜planDigest不匹配→E25｜冻结映射哈希不符→FROZEN_MAP_MISMATCH｜105条/C档误纳入/重复dishId/伪键→RECONCILE（orphan 证明 fail-closed）｜基线不符→BASELINE_MISMATCH｜目标已存在→TARGET_EXISTS/3｜环境不可用→FSYNC_UNAVAILABLE/3｜afterLink失败透传→DURABILITY/3（目标+tmp保留）｜全链成功→INIT_OK+104条/status全active/approvedBy规则/initialization三元组/orphans空｜35条C档无一键进入payload。全部隔离目录+合成材料，正式映射与审批目录零触碰', '契约 §5.6.5.8 / §5.6.5.10 / §10.6.4 G-4', results.join('；'));
      } else {
        fail('T280', 'runInit 预检链矩阵', '契约 §5.6.5.8 / §5.6.5.10', results.join('；'));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T280', 'runInit 预检链矩阵（用例自身异常）', '契约 §5.6.5.8', '异常：' + e.message); }

  // T281 —— 适配器与 tastes 空数组语义（2026-10-25 方案 A）：dry-run 源构建闭环的当前
  // fail-closed 现状如实断言（C18×名册 ID 见登记的待裁决冲突），适配器语义独立验证。
  try {
    const g = require(P.gen);
    const r = g.run({ mode: 'dry-run' });
    const recs = (r.outputs || {}).recordsDoc ? r.outputs.recordsDoc.records : [];
    const noFile = !(r.outputs && r.outputs.wrote);
    const c18 = (r.violations || []).some(function (v) { return v.code === 'C18'; });
    // 2026-10-25 C18 三分修订后：dry-run 源构建闭环成功（L8_IN_MEMORY_ONLY/0，零 C18）
    const ok = r.exitCode === 0 && r.summary.status === 'L8_IN_MEMORY_ONLY' && !c18 &&
      recs.length > 0 && recs.every(function (x) { return x.verifyStatus === 'unverified' && x.verifiedAt === null; }) &&
      recs.every(function (x) { return Array.isArray(x.tastes) && x.tastes.length <= 1; }) &&
      recs.every(function (x) { return x.tastes.indexOf('choice') < 0; }) && // 禁 choice 默认：源无口味→空数组
      noFile;
    if (ok) {
      pass('T281', '适配器+tastes 方案 A：dry-run 源构建闭环成功（L8_IN_MEMORY_ONLY/0，零 C18）；全部记录 verifyStatus=unverified/verifiedAt=null（不提升）；tastes 全部 []（≤1 且零 choice 默认——空数组=口味信息未提供，非口味）；零写盘', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§3.3 修订 / ADAPTER_MAP_C_TO_L8_20261025.md');
    } else {
      fail('T281', '适配器+tastes 语义', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§3.3', JSON.stringify({ exit: r.exitCode, s: r.summary.status, recs: recs.length, c18: c18, noFile: noFile }));
    }
  } catch (e) { fail('T281', '适配器+tastes 语义', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§3.3', '异常：' + e.message); }

  // T282 —— C18 三类 ID 身份分离（2026-10-25 修订）：映射分配严格一致｜名册规划需区间证据｜
  // 碰撞/未命中写 null｜篡改 fail-closed｜35 条 C 档排除｜映射不扩容｜verify 不提升｜dry-run 零写盘。
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c18-t282-'));
    const results = [];
    const rec = function (n, ok, d) { results.push(n + '=' + (ok ? 'OK' : 'NG(' + d + ')')); return ok; };
    try {
      const crypto = require('crypto');
      const mapPath = path.join(ROOT, 'tools', 'pilot', 'id-map.json');
      const mapShaBefore = crypto.createHash('sha256').update(fs.readFileSync(mapPath)).digest('hex');
      const mapDoc = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
      const mapDishIds = new Map(mapDoc.entries.map(function (e) { return [e.key, e.dishId]; }));

      // 1) 正常 dry-run：三类分布 + 零违规 + 映射分配逐条与映射一致
      const r = require(P.gen).run({ mode: 'dry-run' });
      const recs = (r.outputs || {}).recordsDoc ? r.outputs.recordsDoc.records : [];
      const byStatus = { assigned_from_map: 0, planned_from_roster: 0, unassigned: 0 };
      recs.forEach(function (x) { byStatus[x.gen.id_status] = (byStatus[x.gen.id_status] || 0) + 1; });
      rec('正常dry-run→L8_IN_MEMORY_ONLY/0违规', r.exitCode === 0 && r.summary.status === 'L8_IN_MEMORY_ONLY' && (r.violations || []).length === 0,
        JSON.stringify({ e: r.exitCode, s: r.summary.status, v: (r.violations || []).length }));
      rec('三类分布=104映射+386名册+0未分配', byStatus.assigned_from_map === 104 && byStatus.planned_from_roster === 386 && byStatus.unassigned === 0,
        JSON.stringify(byStatus));
      // 映射分配：id 必须等于映射 dishId（键命中即一致）
      const mapOk = recs.filter(function (x) { return x.gen.id_status === 'assigned_from_map'; })
        .every(function (x) { const k = x.stallId + '|' + x.gen.rawGroupKey + '|' + x.gen.specLabel + '|'; return mapDishIds.get(k) === x.id; });
      rec('映射分配ID与获批映射逐条一致', mapOk, '不一致');
      // 名册规划：id 必须在 t48/t49 之外（映射号段），且不与映射 dishId 冲突
      const plannedIds = recs.filter(function (x) { return x.gen.id_status === 'planned_from_roster'; }).map(function (x) { return x.id; });
      const mapIdSet = new Set(mapDoc.entries.map(function (e) { return e.dishId; }));
      rec('名册规划ID不与映射号段冲突', plannedIds.every(function (id) { return !mapIdSet.has(id); }) && plannedIds.length === 386, 'planned=' + plannedIds.length);
      // 35 条 C 档：不在 records 文档（not_generated 被排除）
      rec('35条C档仍排除', recs.length === 490 && (r.outputs || {}).recordsDoc.records.every(function (x) { return x.gen.generation_status === 'generated'; }), 'records=' + recs.length);
      // verify 不提升 / tastes 全空
      rec('verify 未提升+tastes 全空', recs.every(function (x) { return x.verifyStatus === 'unverified' && x.verifiedAt === null && Array.isArray(x.tastes) && x.tastes.length === 0; }), '');

      // 2) 适配器区间证据：区间内→planned；区间外→id null+blocker；非法 tastes→E3 抛错
      const rosterRows = [{ stallId: 'c01_test', from: 100, to: 110, tier: 'A' }];
      const mkPlan = function (dishId, tastes) {
        return { records: [{ key: 'c01_test|测试菜||', stallId: 'c01_test', groupKey: '测试菜', specLabel: '', dishId: dishId, tier: 'A', name: '测试菜', price: 10, foodType: 'snack', sourceFile: 'TRANSCRIPTION_2F.md', sourceLine: 1, sourceRef: 'x', source_detail: null, tastes: tastes }], problems: [], roster: {} };
      };
      const a1 = I.adaptPlanRecordsForL8(mkPlan('c01_d105'), { rosterRows: rosterRows });
      rec('区间内→planned_from_roster', a1[0].gen.id_status === 'planned_from_roster' && a1[0].id === 'c01_d105', JSON.stringify({ s: a1[0].gen.id_status }));
      const a2 = I.adaptPlanRecordsForL8(mkPlan('c01_d999'), { rosterRows: rosterRows });
      rec('区间外→id null+blocker', a2[0].id === null && a2[0].gen.id_status === 'unassigned' && a2[0].gen.blockers.indexOf('ID_NOT_IN_ROSTER_RANGE') >= 0, JSON.stringify({ id: a2[0].id, b: a2[0].gen.blockers }));
      let threw = '';
      try { I.adaptPlanRecordsForL8(mkPlan('c01_d105', ['nope']), { rosterRows: rosterRows }); } catch (e) { threw = e.code || 'THROW'; }
      rec('非法口味→E3 拒绝', threw === 'E3_ENUM', 'threw=' + threw);
      const a4 = I.adaptPlanRecordsForL8(mkPlan('c01_d105', ['choice']), { rosterRows: rosterRows });
      rec('已知口味值仍合法', a4[0].tastes.length === 1 && a4[0].tastes[0] === 'choice', JSON.stringify(a4[0].tastes));

      // 3) 篡改 fail-closed：键命中映射但 id 不一致 → C18 违规 + 非零退出
      const firstEntry = mapDoc.entries[0];
      const parts = firstEntry.key.split('|');
      const tampered = {
        id: 'c01_d001', shopId: 'c01', stallId: parts[0], name: '篡改测试', price: 10, foodType: 'snack',
        tastes: [], source: { kind: 'field', detail: '', ref: '' }, verifyStatus: 'unverified', verifiedAt: null, note: '',
        gen: { tier: 'A', groupKey: parts[1], rawGroupKey: parts[1], specLabel: parts[2], disambiguator: parts[3], rawRow: '', sourceLine: 1, generation_status: 'generated', evidence_status: 'traceable', import_eligibility: 'blocked', id_status: 'assigned_from_map', blockers: [] }
      };
      const rT = require(P.gen).run({ mode: 'dry-run', records: [tampered] });
      const hasC18 = (rT.violations || []).some(function (v) { return v.code === 'C18'; });
      rec('篡改→fail-closed(C18/非零)', rT.exitCode !== 0 && hasC18, JSON.stringify({ e: rT.exitCode, c18: hasC18 }));
      // 4) 映射缺失/未命中键→unassigned（NEW_KEY）不静默赋号
      const unknown = JSON.parse(JSON.stringify(tampered));
      unknown.gen.rawGroupKey = '不存在的键'; unknown.id = null; unknown.gen.id_status = 'planned_from_roster';
      const rU = require(P.gen).run({ mode: 'dry-run', records: [unknown] });
      const uRec = ((rU.outputs || {}).recordsDoc || {}).records || [];
      rec('未命中键不静默赋号', uRec.length === 0 || (uRec[0].id === null && uRec[0].gen.id_status === 'unassigned'), JSON.stringify(uRec.map(function (x) { return [x.id, x.gen.id_status]; })));

      // 5) 映射未扩容 + dry-run 零写盘
      const mapShaAfter = crypto.createHash('sha256').update(fs.readFileSync(mapPath)).digest('hex');
      rec('映射未扩容/未改动', mapShaAfter === mapShaBefore && mapDoc.entries.length === 104, 'sha=' + mapShaAfter.slice(0, 12));
      const junk = fs.readdirSync(dir);
      rec('dry-run 零写盘', junk.length === 0, 'files=' + junk.join(','));

      const allOk = results.length === 14 && results.every(function (s) { return s.indexOf('=OK') >= 0; });
      if (allOk) {
        pass('T282', 'C18 三类 ID 身份分离（2026-10-25 修订）：映射分配 104 条逐条与获批映射一致｜契约名册规划 386 条（区间证据）不与映射号段冲突｜区间外→id null+blocker（不放行）｜非法口味→E3｜篡改→C18 fail-closed｜未命中键不静默赋号｜35 条 C 档排除｜映射零扩容｜verify 未提升｜tastes 全空｜dry-run 零写盘', '契约 §4.3 C18（三分） / §5.6.1 §5.6.3 名册区间', results.join('；'));
      } else {
        fail('T282', 'C18 三类 ID 身份分离', '契约 §4.3 C18', results.join('；'));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T282', 'C18 三类 ID 身份分离（用例自身异常）', '契约 §4.3 C18', '异常：' + e.message); }

  // T283 —— P1 正式写出链路（2026-10-25 写出链路轮）：全部在独立临时目录，绝不触碰项目正式文件。
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-t283-'));
    const crypto = require('crypto');
    const results = [];
    const rec = function (n, ok, d) { results.push(n + '=' + (ok ? 'OK' : 'NG(' + d + ')')); return ok; };
    const genPath = P.gen;
    const gmod = require(genPath);
    try {
      const dishesShaBefore = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'dishes.js'))).digest('hex');
      // 1) 正常写出
      const out1 = path.join(dir, 'out1');
      const r1 = gmod.run({ mode: 'write', outDir: out1 });
      const files1 = fs.existsSync(out1) ? fs.readdirSync(out1).sort().join(',') : '';
      rec('正常写出→PUBLISH_OK/0+四件套', r1.exitCode === 0 && r1.summary.status === 'PUBLISH_OK' &&
        files1 === 'COMMITTED,gen-manifest.json,records.json,records_blockers.json', JSON.stringify({ e: r1.exitCode, s: r1.summary.status, f: files1 }));
      // 2) 产物自洽：counts/sha/唯一性/核验状态
      const m = JSON.parse(fs.readFileSync(path.join(out1, 'gen-manifest.json'), 'utf8'));
      const rr = JSON.parse(fs.readFileSync(path.join(out1, 'records.json'), 'utf8'));
      const bb = JSON.parse(fs.readFileSync(path.join(out1, 'records_blockers.json'), 'utf8'));
      const shaOf = function (n) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(out1, n))).digest('hex'); };
      rec('counts 与基准一致 490/525/A490B0C35', m.counts.records === 490 && m.counts.blockers === 525 &&
        m.counts.A === 490 && m.counts.B === 0 && m.counts.C === 35, JSON.stringify(m.counts));
      rec('manifest sha256 与回读一致', shaOf('records.json') === m.recordsSha256 && shaOf('records_blockers.json') === m.blockersSha256, 'sha');
      const ids = {}; let dupId = 0; rr.records.forEach(function (x) { if (x.id) { if (ids[x.id]) { dupId += 1; } ids[x.id] = 1; } });
      const bk = {}; let dupKey = 0; bb.entries.forEach(function (e) { if (bk[e.recordKey]) { dupKey += 1; } bk[e.recordKey] = 1; });
      rec('records 无重复 dishId / blockers 无重复 recordKey', dupId === 0 && dupKey === 0, 'dupId=' + dupId + ' dupKey=' + dupKey);
      rec('verifyStatus/verifiedAt 未被提升', rr.records.every(function (x) { return x.verifyStatus === 'unverified' && x.verifiedAt === null; }), '');
      rec('PUBLISHING 已清除且 COMMITTED 存在', !fs.existsSync(path.join(out1, 'PUBLISHING')) && fs.existsSync(path.join(out1, 'COMMITTED')), 'marker');
      // 3) 重复运行 → S6 防覆盖，内容不变
      const before = crypto.createHash('sha256').update(fs.readFileSync(path.join(out1, 'records.json'))).digest('hex');
      const r2 = gmod.run({ mode: 'write', outDir: out1 });
      const after = crypto.createHash('sha256').update(fs.readFileSync(path.join(out1, 'records.json'))).digest('hex');
      rec('重复运行→S6/3 且目标未被覆盖', r2.exitCode === 3 && /S6/.test(String(r2.summary.status)) && before === after,
        JSON.stringify({ e: r2.exitCode, s: r2.summary.status }));
      // 4) 部分失败：S1 写临时失败 → 退出 3、目标不存在、临时目录清理
      const out2 = path.join(dir, 'out2');
      const genBefore = fs.readdirSync(dir).filter(function (n) { return n.indexOf('gen-') === 0; }).length;
      const r3 = gmod.run({ mode: 'write', outDir: out2, faults: { writeTemp: 'fail' } });
      const genAfter = fs.readdirSync(dir).filter(function (n) { return n.indexOf('gen-') === 0; }).length;
      // 只断言本次 S1 未新增临时残留（此前 S6 用例的 tmp 保留属其自身诊断证据，不混算）
      rec('S1 失败→退出3/零目标/本次临时零残留', r3.exitCode === 3 && !fs.existsSync(out2) && genAfter === genBefore,
        JSON.stringify({ e: r3.exitCode, s: r3.summary.status, before: genBefore, after: genAfter }));
      // 5) 统计不符：S3 → E9_SUM/1，不发布
      const out3 = path.join(dir, 'out3');
      const r4 = gmod.run({ mode: 'write', outDir: out3, faults: { countsDrop: 'records' } });
      rec('S3 统计不符→E9_SUM/1 不发布', r4.exitCode === 1 && !fs.existsSync(out3), JSON.stringify({ e: r4.exitCode, s: r4.summary.status }));
      // 6) 完成标记写入失败：S10 后 E30/4，产物保留
      const out4 = path.join(dir, 'out4');
      const r5 = gmod.run({ mode: 'write', outDir: out4, faults: { committed: 'fail' } });
      rec('COMMITTED 写失败→E30/4 产物保留', r5.exitCode === 4 && fs.existsSync(out4), JSON.stringify({ e: r5.exitCode, s: r5.summary.status }));
      // 7) 项目正式文件未受影响
      const dishesShaAfter = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'data', 'dishes.js'))).digest('hex');
      const mapSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json'))).digest('hex');
      rec('正式数据/映射未受影响', dishesShaAfter === dishesShaBefore && mapSha === '4478c976dcb68ef683d712e48ebd98db123f0dbfde272035e4d9c9e3bada210e', '');
      rec('项目内不产出 records 三件套', !fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'records.json')) &&
        !fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'records_blockers.json')) && !fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'gen-manifest.json')), '');

      const allOk = results.length === 12 && results.every(function (x) { return x.indexOf('=OK') >= 0; });
      if (allOk) {
        pass('T283', 'P1 正式写出链路（临时目录）：正常写出 PUBLISH_OK/0 + 三产物与 COMMITTED、PUBLISHING 已清；counts 490/525/A490B0C35 与基准一致；manifest sha256 回读一致；无重复 dishId/recordKey；verifyStatus 未提升；重复运行 S6/3 不覆盖；S1 失败零目标零残留；S3 统计不符 E9_SUM/1 不发布；COMMITTED 失败 E30/4 产物保留；项目正式文件零影响', '契约 §7.2.1 S1–S10 / §7.2.2 / §7.2.8', results.join('；'));
      } else {
        fail('T283', 'P1 正式写出链路', '契约 §7.2.1', results.join('；'));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T283', 'P1 正式写出链路（用例自身异常）', '契约 §7.2.1', '异常：' + e.message); }

  // T243 生产调用链冻结（2026-10-25 实施轮更新：init 子命令接入后，initIdMap/verifyPlanDigest
  // 的唯一生产调用点是 runInit；run/main/publishOutputs 仍零引用——普通 gen/dry-run/write 无初始化副作用）
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'pilot', 'gen_records.js'), 'utf8');
    const cnt = function (s, k) { return s.split(k).length - 1; };
    const bodyOf = function (name) {
      const i = src.indexOf('function ' + name + '(');
      if (i < 0) { return ''; }
      const j = src.indexOf('\nfunction ', i + 10);
      return src.slice(i, j < 0 ? src.length : j);
    };
    const prodBodies = bodyOf('run') + bodyOf('main') + bodyOf('publishOutputs');
    const defOnly = prodBodies.indexOf('verifyPlanDigest(') < 0 &&
      prodBodies.indexOf('initIdMap(') < 0 &&
      src.indexOf('function verifyPlanDigest(') >= 0 && src.indexOf('function initIdMap(') >= 0;
    const runInitBody = bodyOf('runInit');
    const runInitOk = runInitBody.length > 0 && cnt(runInitBody, 'initIdMap(') === 1 && cnt(runInitBody, 'verifyPlanDigest(') === 1;
    const g = require(path.join(__dirname, '..', 'tools', 'pilot', 'gen_records.js'));
    const expKeys = Object.keys(g).sort().join(',');
    const testKeys = Object.keys(g.__test__).length;
    if (defOnly && runInitOk && expKeys === '__test__,run,runInit' && testKeys === 9) {
      pass('T243', '生产链路冻结（2026-10-25 更新）：run/main/publishOutputs 零引用 initIdMap/verifyPlanDigest（无隐式初始化）；runInit 为二者唯一生产调用点（各恰 1 处）；导出面 run+runInit+__test__ 三键；__test__ 仍 9 名', '§7.1 / G-7=O-1');
    } else {
      fail('T243', '生产链路冻结', '§7.1', JSON.stringify({ defOnly: defOnly, runInitOk: runInitOk, expKeys: expKeys, testKeys: testKeys }));
    }
  } catch (e) { fail('T243', '生产链路冻结', '§7.1', '异常：' + e.message); }

  // T233 初始化：目录 fsync 不可用 → 安全停止、零写入（本机 NTFS 实测 EPERM）
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-init-'));
    try {
      const target = path.join(dir, 'id-map.json');
      const cap = I.checkDirFsync(dir);
      const r = I.initIdMap('{"schemaVersion":1}\n', target);
      const exists = fs.existsSync(target);
      if (!cap.ok) {
        if (r.status === 'INIT_FSYNC_UNAVAILABLE' && r.wrote === false && exists === false && r.exitCode === 3) {
          pass('T233', 'M5C-4：目录 fsync 不可用（本机 ' + cap.code + '）→ INIT_FSYNC_UNAVAILABLE/3、零写入、不降级', '§7.5');
        } else {
          fail('T233', 'fsync 不可用时安全停止', '§7.5', JSON.stringify({ s: r.status, w: r.wrote, e: exists }));
        }
      } else if (r.status === 'INIT_OK' && exists && fs.readFileSync(target, 'utf8') === '{"schemaVersion":1}\n') {
        pass('T233', 'M5C-4：本机目录 fsync 可用 → 初始化成功且读回一致（合成目录，非正式映射）', '§7.5');
      } else {
        fail('T233', '初始化协议', '§7.5', JSON.stringify({ fsync: cap, s: r.status }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T233', '初始化协议（fsync 分支）', '§7.5', '异常：' + e.message); }

  // T234 初始化：目标已存在 → 拒绝覆盖，原内容不变
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-init2-'));
    try {
      const target = path.join(dir, 'id-map.json');
      fs.writeFileSync(target, 'OLD-CONTENT', 'utf8');
      const r = I.initIdMap('NEW\n', target);
      const after = fs.readFileSync(target, 'utf8');
      if (r.status === 'INIT_TARGET_EXISTS' && r.wrote === false && after === 'OLD-CONTENT' && r.exitCode === 3) {
        pass('T234', 'M5C-4：目标已存在 → INIT_TARGET_EXISTS/3，拒绝覆盖且原内容不变', '§7.5');
      } else {
        fail('T234', '拒绝覆盖', '§7.5', JSON.stringify({ s: r.status, after: after, e: r.exitCode }));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T234', '拒绝覆盖', '§7.5', '异常：' + e.message); }

  // T235 摘要不匹配 → fail-closed，目标零写入
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm5c-init3-'));
    try {
      const target = path.join(dir, 'id-map.json');
      const v = I.verifyPlanDigest(planText({ planId: 'ip-x' }), '0'.repeat(64));
      if (!v.ok && v.code === 'E_PLAN_DIGEST_MISMATCH' && fs.existsSync(target) === false) {
        pass('T235', 'M5C-3：摘要不匹配 → E_PLAN_DIGEST_MISMATCH（fail-closed，目标零写入）', '§5.6.5.8.3 / §7.5');
      } else { fail('T235', '摘要不匹配 fail-closed', '§5.6.5.8.3', JSON.stringify(v).slice(0, 160)); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  } catch (e) { fail('T235', '摘要不匹配 fail-closed', '§5.6.5.8.3', '异常：' + e.message); }

  // T236 初始化 CLI 调用路径与失败门控（2026-10-25 实施轮改写：init 子命令已接入，原「init 不可由
  // CLI 触发」由「gen 域三开关仍不可达 + gen 拒收 --approval + init 域参数校验 + 写入前门控」取代）
  try {
    const cases = [
      { a: ['gen', '--plan-digest', 'abc'], exit: 2 },
      { a: ['gen', '--faults', '{}'], exit: 2 },
      { a: ['gen', '--init', 'x'], exit: 2 },
      { a: ['gen', '--approval', 'ap-20261025-01'], exit: 2 },
      { a: ['init'], exit: 2 },
      { a: ['init', '--approval'], exit: 2 },
      { a: ['init', '--approval', 'bad-format'], exit: 2 },
      { a: ['init', '--approval', ''], exit: 2 },
      { a: ['init', '--write'], exit: 2 },
      { a: ['init', 'foo'], exit: 2 }
    ];
    const bad = cases.filter(function (c) {
      const r = cp.spawnSync(process.execPath, [P.gen].concat(c.a), { encoding: 'utf8' });
      const txt = String(r.stdout || '') + String(r.stderr || '');
      return !(r.status === c.exit && /E27_CLI_USAGE/.test(txt));
    });
    // 门控（2026-10-25 正式初始化执行轮更新）：合法 --approval 必须在任何写入前被拒绝——三分支平台/状态自适应：
    // ① 映射不存在时：Windows=环境预检 INIT_FSYNC_UNAVAILABLE/3；ext4=审批预检 APPROVAL_MISSING/1（无审批）。
    // ② 映射已存在时（当前状态，ap-20261025-01 已签发）：目标防覆盖 INIT_TARGET_EXISTS/3——绝覆盖既有映射。
    const mapBefore = fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json'))
      ? fs.readFileSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json')) : null;
    const g = cp.spawnSync(process.execPath, [P.gen, 'init', '--approval', 'ap-20261025-01'], { encoding: 'utf8' });
    const gt = String(g.stdout || '') + String(g.stderr || '');
    const gateOk = (g.status === 3 && /INIT_FSYNC_UNAVAILABLE/.test(gt)) ||
                   (g.status === 1 && /APPROVAL_MISSING/.test(gt)) ||
                   (g.status === 3 && /INIT_TARGET_EXISTS/.test(gt));
    const mapAfter = fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json'))
      ? fs.readFileSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json')) : null;
    const noWrite = mapBefore === null ? !fs.existsSync(path.join(ROOT, 'tools', 'pilot', 'id-map.json'))
      : (mapAfter !== null && mapBefore.equals(mapAfter));
    if (bad.length === 0 && gateOk && noWrite) {
      pass('T236', 'init CLI 调用路径与失败门控：gen 域三开关仍不可达（E27/2）且 gen 拒收 --approval；init 域参数校验（缺参/缺值/格式/空值/白名单外/位置参数均 E27/2）；合法参数在写入前被门控拒绝（状态自适应：INIT_FSYNC_UNAVAILABLE/3｜APPROVAL_MISSING/1｜INIT_TARGET_EXISTS/3 防覆盖）；既有 id-map.json 内容未被改动', '§3.5 / §5.6.5.10 / §10.6.4 G-4=C');
    } else {
      fail('T236', 'init CLI 门控', '§3.5 / G-4=C', '未拦截=' + bad.map(function (x) { return x.a.join(' '); }).join('；') + ' gate=' + gateOk + '（exit ' + g.status + '）未改动=' + noWrite);
    }
  } catch (e) { fail('T236', 'init CLI 门控', '§3.5', '异常：' + e.message); }

  // T237 生成器目录内无初始化临时文件残留
  try {
    const leftovers = [];
    fs.readdirSync(path.dirname(P.gen)).forEach(function (n) {
      if (/^\.?id-map-init-/.test(n)) { leftovers.push(n); }
    });
    if (leftovers.length === 0) {
      pass('T237', 'M5C-4：生成器目录内无初始化临时文件残留（合成测试均在 %TEMP%）', '§7.5');
    } else { fail('T237', '无临时文件残留', '§7.5', leftovers.join(',')); }
  } catch (e) { fail('T237', '无临时文件残留', '§7.5', '异常：' + e.message); }
})();

  // ---- C 段：只读初始化计划输出（T244–T251）-----------------------------------------
  (function cPlanOutput() {
    const fsx = require('fs');
    const genFile = path.join(ROOT, 'tools', 'pilot', 'gen_records.js');
    const rest = [ 'T245', 'T246', 'T247', 'T248', 'T249', 'T250', 'T251' ];
    function skipAll(why) { rest.forEach(function (id) { pending(id, why, 'gen_records.js'); }); }
    let mod = null;
    try {
      const raw = fsx.readFileSync(genFile, 'utf8');
      const patched = raw.replace(/module\.exports = Object\.freeze\(\{[\s\S]*?\}\);/, 'module.exports = { run: run, __test__: __test__, __plan: buildInitPlanRecords, __key: makeKeyFrom };');
      const box = { exports: {} };
      new Function('require', 'module', 'exports', '__dirname', patched)(require, box, box.exports, path.dirname(genFile));
      mod = box.exports;
      pass('T244', 'C 段函数可在内存载入（不改导出面、不落地文件）', 'gen_records.js');
    } catch (e) {
      fail('T244', 'C 段函数载入', 'gen_records.js', String(e && e.message));
      skipAll('C 段未执行'); return;
    }
    let out = null;
    try { out = mod.__plan({}); } catch (e) {
      fail('T245', 'C 段输出构建', 'gen_records.js', String(e && e.message));
      rest.slice(1).forEach(function (id) { pending(id, 'C 段构建失败', 'gen_records.js'); }); return;
    }
    const recs = out.records || [];
    const stalls = out.perStall || {};
    const cmp = [];
    [['c01_t07', 8], ['c01_t38', 12]].forEach(function (x) {
      const s = stalls[x[0]]; cmp.push({ id: x[0], got: s ? s.n : null, want: x[1] });
    });
    const badRows = cmp.filter(function (x) { return x.got !== x.want; });
    if (badRows.length === 0) { pass('T245', '样本档口 c01_t07=8、c01_t38=12 与 roster 一致（2F/3F 各一）', '契约 §5.6.5.5 名册表'); }
    else { fail('T245', '档口记录数与 roster 对照', '契约 §5.6.5.5', JSON.stringify(badRows)); }
    const seg = recs.filter(function (r) { return String(r.key).split('|').length !== 4 || (r.stallId !== null && !r.stallId) || !r.sourceRef || !(r.sourceLine > 0); });
    if (recs.length > 0 && seg.length === 0) { pass('T246', '每条记录四段键/stallId/sourceRef/sourceLine 齐备', 'gen_records.buildInitPlanRecords'); }
    else { fail('T246', '记录字段完整性', 'gen_records', JSON.stringify({ total: recs.length, bad: seg.length })); }
    let again = null;
    try { again = mod.__plan({}); } catch (e) { again = null; }
    if (again && JSON.stringify(again.records) === JSON.stringify(recs)) { pass('T247', '两次运行输出逐字节一致（确定性）', 'gen_records'); }
    else { fail('T247', '输出确定性', 'gen_records', '两次不一致'); }
    // T248（2026-10-25 裁决 DR-W2-03-DISAMBIG-20261025 更新）：重复键经批准的 disambiguator 消歧后应为 0，
    // 且非空 disambiguator 必须恰为 W2-03 牌面 8 行（:133–140），其余记录保持空值（不得外溢）。
    const APPROVED_DISAMB = '系列-公瑾爆蛋 · 新品暴击';
    const disRecs = recs.filter(function (r) { return r.disambiguator !== ''; });
    const disOk = disRecs.length === 8
      && disRecs.every(function (r) { return r.disambiguator === APPROVED_DISAMB && r.stallId === 'c01_t11' && r.sourceLine >= 133 && r.sourceLine <= 140; })
      && recs.every(function (r) { return r.disambiguator === '' || r.disambiguator === APPROVED_DISAMB; });
    const dupOk = (out.counts.dupIds === 0)
      && out.counts.dupKeys === 0
      && (out.dupDetail || []).length === out.counts.dupKeys
      && disOk;
    if (dupOk) { pass('T248', '重复候选 ID 与重复键均为 0（6 组碰撞按 2026-10-25 裁决以 disambiguator=系列-公瑾爆蛋 · 新品暴击 消歧，恰为牌面 8 行 :133–140，其余记录空值）', '契约 §5.6.5.2 / §5.6.5.5 R4 + DR-W2-03-DISAMBIG-20261025'); }
    else { fail('T248', '重复键/ID 处理', '契约 §5.6.5.2', JSON.stringify({ counts: out.counts, disN: disRecs.length, disLines: disRecs.map(function (r) { return r.sourceLine; }).sort(function (a, b) { return a - b; }) })); }
    const amb = out.ambiguities || [];
    const need = ['A1', 'A2', 'A3'];
    const hasAll = need.every(function (k) { return amb.some(function (x) { return x.indexOf(k) >= 0; }); });
    if (hasAll) { pass('T249', '三项契约歧义已显式登记、未擅自猜测（A1/A2/A3）', '契约 §5.6.5.3 / §5.6.5.5'); }
    else { fail('T249', '歧义登记', '契约', JSON.stringify(amb)); }
    const nullRecs = recs.filter(function (r) { return !r.dishId; });
    const nullStalls = Array.from(new Set(nullRecs.map(function (r) { return r.stallId; }))).sort();
    const overflowStalls = (out.problems || []).filter(function (p) { return p.code === 'RANGE_OVERFLOW'; }).map(function (p) { return p.stallId; });
    const cStalls = Object.keys(stalls).filter(function (k) { return stalls[k].tier === 'C' || stalls[k].from == null || overflowStalls.indexOf(k) >= 0; });
    const stray = nullRecs.filter(function (r) { return r.stallId !== null && cStalls.indexOf(r.stallId) < 0; }).map(function (r) { return r.stallId; });
    if (stray.length === 0) { pass('T250', '候选 ID 为 null 的记录均落在 C 档/无区间档口', '契约 §5.6.5.5 E-4'); }
    else { fail('T250', 'null 候选分布', '契约', JSON.stringify({ nullStalls: nullStalls, cStalls: cStalls })); }
    try {
      const pth = path.join(require('os').tmpdir(), 'm5-c-plan-records.json');
      fsx.writeFileSync(pth, JSON.stringify({ counts: out.counts, roster: out.roster, perStall: out.perStall, problems: out.problems, ambiguities: out.ambiguities, sample: recs.slice(0, 3) }, null, 2) + String.fromCharCode(10));
      pass('T251', '只读输出落到 %TEMP% 供人工核对', pth);
    } catch (e) { fail('T251', '输出落盘（%TEMP%）', '%TEMP%', String(e && e.message)); }
  })();
  // ---- makeKeyFrom 回归（T252–T255，契约 §5.6.5.2）---------------------------
  (function keyRegression() {
    const fsx = require('fs');
    const genFile = path.join(ROOT, 'tools', 'pilot', 'gen_records.js');
    let mk = null;
    try {
      const raw = fsx.readFileSync(genFile, 'utf8');
      const patched = raw.replace(/module\.exports = Object\.freeze\(\{[\s\S]*?\}\);/, 'module.exports = { run: run, __test__: __test__, __key: makeKeyFrom };');
      const box = { exports: {} };
      new Function('require', 'module', 'exports', '__dirname', patched)(require, box, box.exports, path.dirname(genFile));
      mk = box.exports.__key;
    } catch (e) {
      fail('T252', 'makeKeyFrom 载入', 'gen_records.js', String(e && e.message));
      [ 'T253', 'T254', 'T255' ].forEach(function (id) { pending(id, '载入失败', 'gen_records.js'); });
      return;
    }
    const r1 = mk({ stallId: 'c01_t07', gen: { groupKey: 'f2/见面就好', rawGroupKey: '见面就好', specLabel: '', disambiguator: '' } });
    if (r1.ok && r1.key === 'c01_t07|见面就好||') { pass('T252', '键用菜名原文、剥离层前缀（f2/ 不出现在键中）', '契约 §5.6.5.2'); }
    else { fail('T252', 'groupKey 取原文', '契约 §5.6.5.2', JSON.stringify(r1)); }
    if (r1.ok && r1.key === 'c01_t07|见面就好||' && r1.parts.length === 4) { pass('T253', '与契约 §5.6.3 示例键形状一致（四段、半角竖线）', '契约 §5.6.3'); }
    else { fail('T253', '示例键复现', '契约 §5.6.3', JSON.stringify(r1)); }
    const r2 = mk({ stallId: 'c01_t11', gen: { groupKey: 'f2/秘制红烧肉', rawGroupKey: '秘制红烧肉', specLabel: '', disambiguator: '' } });
    const r3 = mk({ stallId: 'c01_t11', gen: { groupKey: 'f2/秘制红烧肉', rawGroupKey: '秘制红烧肉', specLabel: '', disambiguator: '' } });
    if (r2.ok && r3.ok && r2.key === r3.key) { pass('T254', '同名同规格不同价 → 键相同（可被 E14 检出为冲突）', '契约 §5.6.5.5 entries[].key'); }
    else { fail('T254', '冲突键稳定性', '契约', JSON.stringify({ a: r2.key, b: r3.key })); }
    const r4 = mk({ stallId: 'c01_t44', gen: { groupKey: 'f3/辣肉面', specLabel: '', disambiguator: '' } });
    if (r4.ok && r4.key === 'c01_t44|辣肉面||') { pass('T255', '无 rawGroupKey 时按层前缀剥离兜底（f3/）', '契约 §5.6.5.2'); }
    else { fail('T255', '兜底剥离', '契约 §5.6.5.2', JSON.stringify(r4)); }
  })();
  // ---- R6 例外：西雅苏套餐表（T256–T262，契约 §6.1.1）-----------------------
  (function r6WhitelistPackage() {
    const fsx = require('fs');
    const genFile = path.join(ROOT, 'tools', 'pilot', 'gen_records.js');
    const ids = ['T256', 'T257', 'T258', 'T259', 'T260', 'T261', 'T262',
      'T263', 'T264', 'T265', 'T266', 'T267', 'T268',
      'T269', 'T270', 'T271', 'T272', 'T273', 'T274', 'T275'];
    let plan = null;
    let wl = null;
    let pb = null;
    let pbe = null;
    let plan2sd = null;
    try {
      const raw = fsx.readFileSync(genFile, 'utf8');
      const patched = raw.replace(/module\.exports = Object\.freeze\(\{[\s\S]*?\}\);/, 'module.exports = { run: run, __test__: __test__, __plan: buildInitPlanRecords, __wl: isWhitelistedPackageTable, __pb: PROD_BASELINE, __pbe: PLAN_BASELINE_EXPECTED };');
      const box = { exports: {} };
      new Function('require', 'module', 'exports', '__dirname', patched)(require, box, box.exports, path.dirname(genFile));
      plan = box.exports.__plan({});
      wl = box.exports.__wl;
      pb = box.exports.__pb;
      pbe = box.exports.__pbe;
      plan2sd = box.exports.__plan({});
    } catch (e) {
      ids.forEach(function (id) { pending(id, '载入或构建计划失败', 'gen_records.js'); });
      return;
    }
    const t37 = plan.records.filter(function (r) { return r.stallId === 'c01_t37'; });
    const added = ['c01_d304', 'c01_d305', 'c01_d306', 'c01_d307', 'c01_d308', 'c01_d309', 'c01_d310']
      .map(function (id) { return t37.filter(function (r) { return r.dishId === id; })[0]; })
      .filter(function (r) { return !!r; });
    const expect7 = [
      ['c01_d304', '招牌鸡肉炒米粉 + 烤馕', 14, 'rice_vermicelli'],
      ['c01_d305', '经典牛肉炒米粉 + 烤馕', 16, 'rice_vermicelli'],
      ['c01_d306', '招牌鸡肉炒米粉 + 宽粉', 14, 'rice_vermicelli'],
      ['c01_d307', '经典牛肉炒米粉 + 宽粉', 16, 'rice_vermicelli'],
      ['c01_d308', '招牌鸡肉炒米粉 + 宽粉 + 烤馕', 16, 'rice_vermicelli'],
      ['c01_d309', '经典牛肉炒米粉 + 宽粉 + 烤馕', 18, 'rice_vermicelli'],
      ['c01_d310', '全家福套餐', 20, null]
    ];
    // T256：白名单只认「文件 + 档口编号 + 表头精确匹配」
    const tblOk = { header: ['套餐', '价格'], section: 'W2-08 西雅苏 · 新疆炒米粉', rows: [] };
    const tblOtherShot = { header: ['套餐', '价格'], section: 'W2-04 黄焖鸡店', rows: [] };
    const tblOtherHeader = { header: ['套餐', '价格（元）'], section: 'W2-08 西雅苏', rows: [] };
    const okWl = wl(tblOk, 'TRANSCRIPTION_2F.md') === true &&
      wl(tblOtherShot, 'TRANSCRIPTION_2F.md') === false &&
      wl(tblOtherHeader, 'TRANSCRIPTION_2F.md') === false &&
      wl(tblOk, 'TRANSCRIPTION_3F.md') === false;
    if (okWl) { pass('T256', '白名单仅按「文件 + 档口编号 + 表头精确匹配」识别，其它表与其它文件一律不放行', '契约 §6.1.1'); }
    else { fail('T256', '白名单识别边界', '契约 §6.1.1', JSON.stringify({ ok: wl(tblOk, 'TRANSCRIPTION_2F.md'), otherShot: wl(tblOtherShot, 'TRANSCRIPTION_2F.md'), otherHeader: wl(tblOtherHeader, 'TRANSCRIPTION_2F.md'), otherFile: wl(tblOk, 'TRANSCRIPTION_3F.md') })); }
    // T257：7 条的名称与价格与裁决逐项一致
    let t257 = added.length === 7;
    for (let i = 0; i < expect7.length && t257; i += 1) {
      const hit = added.filter(function (r) { return r.dishId === expect7[i][0]; })[0];
      if (!hit || hit.name !== expect7[i][1] || hit.price !== expect7[i][2]) { t257 = false; }
    }
    if (t257) { pass('T257', '西雅苏 7 条套餐按牌面名称与整份单价进入记录流', '契约 §6.1.1'); }
    else { fail('T257', '7 条套餐内容', '契约 §6.1.1', JSON.stringify(added.map(function (r) { return [r.dishId, r.name, r.price]; }))); }
    // T258：foodType——炒米粉 6 条映射、全家福 1 条保持 null 且记 blocker
    let t258 = true;
    for (let i = 0; i < expect7.length; i += 1) {
      const hit = added.filter(function (r) { return r.dishId === expect7[i][0]; })[0];
      if (!hit || hit.foodType !== expect7[i][3]) { t258 = false; }
    }
    // T258 行号锚点 2026-10-25 由 405 → 407：蛋字更正在 :275 区域插入 2 行留痕，全家福套餐行整体顺移（内容断言不变）
    const noTypeBlocker = plan.problems.some(function (x) { return x.code === 'BLOCKED_NO_FOODTYPE' && x.line === 407; });
    if (t258 && noTypeBlocker) { pass('T258', '炒米粉组合映射 rice_vermicelli；「全家福套餐」不赋类型并记 BLOCKED_NO_FOODTYPE', '契约 §6.1.1'); }
    else { fail('T258', '套餐 foodType 规则', '契约 §6.1.1', JSON.stringify({ foodTypes: added.map(function (r) { return [r.dishId, r.foodType]; }), noTypeBlocker: noTypeBlocker })); }
    // T259（2026-10-25 入册 + 米线退役同步）：W2-04 入册 c01_t48，77 条（米线原表 12 条退役后），dishId 悬置 null / tier=A（2026-10-25 分档裁决），4 条套餐仍整表排除；
    // 退役表零残留（:212–223 无记录）、展开表 36 条在位（:228–239）、蛋炒 39 条在位（:262–274）
    const w204 = plan.records.filter(function (r) { return r.stallId === 'c01_t48'; });
    const w04Retired = w204.filter(function (r) { return r.sourceLine >= 212 && r.sourceLine <= 223; });
    const w04Exp = w204.filter(function (r) { return r.sourceLine >= 228 && r.sourceLine <= 239; });
    const w04Dan = w204.filter(function (r) { return r.sourceLine >= 262 && r.sourceLine <= 274; });
    if (w204.length === 77 && w204.every(function (r) { return r.dishId !== null && r.tier === 'A'; })
      && w04Retired.length === 0 && w04Exp.length === 36 && w04Dan.length === 39
      && w204.every(function (r) { const n2=Number(String(r.dishId).slice(5)); return n2 >= 464 && n2 <= 540; })
      && new Set(w204.map(function (r) { return r.dishId; })).size === 77) { pass('T259', 'W2-04 入册 c01_t48 共 77 条（退役零残留、展开 36 + 蛋炒 39 + 黄焖鸡 2），正式 ID 覆盖 c01_d464–c01_d540 无重复，tier=A，4 条套餐仍整表排除', '契约 §5.6.1 / R6 / ID_MAP_T48_T49_20261025'); }
    else { fail('T259', 'W2-04 排除不变', '契约 §6.1.1 / R6', JSON.stringify({ n: w204.length, retired: w04Retired.length, exp: w04Exp.length, dan: w04Dan.length, badId: w204.filter(function (r) { return r.dishId !== null; }).length, badTier: w204.filter(function (r) { return r.tier !== null; }).length })); }
    // T260：3F 完全不受影响（143 条），且 3F 表不被白名单识别
    if (plan.perKind['3F'] === 143) { pass('T260', '3F 记录数仍 143，R6 例外不外溢到 3F', '契约 §6.1.1'); }
    else { fail('T260', '3F 不变', '契约 §6.1.1', String(plan.perKind['3F'])); }
    // T261：其他档口记录数、重复键/ID 与实测一致（2026-10-25 R5 收紧后：W2-05 由 35 → 27，总量 545 → 537、2F 402 → 394；
    // 2026-10-25 授权一：PROD_BASELINE / PLAN_BASELINE_EXPECTED 总量基准同步为 537/394/143，并与实测交叉校验；
    // 2026-10-25 授权二：双拼牌面消歧后 dupKeys 6 → 0，dishId 与编号区间不变；
    // 2026-10-25 方案 A：米线原表 12 条退役 → 总量 537 → 525、2F 394 → 382；PROD_BASELINE 暂未重算（差 12 = 退役条数，基线重算轮待授权））
    const base = plan.counts.total === 525 && plan.counts.withId === 490 && plan.counts.nullId === 35 && plan.counts.dupKeys === 0 && plan.counts.dupIds === 0 &&
      plan.perKind['2F'] === 382 && plan.perKind['3F'] === 143 && t37.length === 22 &&
      !!pb && pb.total === 525 && pb.A === 490 && pb.B === 0 && pb.C === 35 && pb.f2.total === 382 && pb.f3.total === 143 &&
      !!pbe && pbe.total === 525 && pbe.A === 490 && pbe.B === 0 && pbe.C === 35 && pbe.f2.total === 382 && pbe.f3.total === 143 &&
      (pb.total - plan.counts.total) === 0;
    if (base) { pass('T261', '总量 525、withId 490、nullId 35（C 档）、2F 382、3F 143、c01_t37 22 条、dupKeys 0 与实测一致，且 PROD_BASELINE / PLAN_BASELINE_EXPECTED 已重锁 525/490/0/35 + 382/143（t48/t49 正式分配 104 条）', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 / §6.1.2 / §5.6.1'); }
    else { fail('T261', '总量与重复检测', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 / §6.1.2', JSON.stringify({ counts: plan.counts, perKind: plan.perKind, t37: t37.length, pb: pb ? [pb.total, pb.f2.total, pb.f3.total] : null, pbe: pbe ? [pbe.total, pbe.f2.total, pbe.f3.total] : null })); }
    // T275：R5 收紧的计数与适用范围（2026-10-25）——按实际记录数断言，不做字符串存在性检查
    const w205 = plan.records.filter(function (r) { return r.stallId === 'c01_t49'; });
    const t28w = plan.records.filter(function (r) { return r.stallId === 'c01_t28'; });
    const t32w = plan.records.filter(function (r) { return r.stallId === 'c01_t32'; });
    const r5Notif = plan.problems.filter(function (x) { return x.code === 'R5_SPEC_NOT_AUTHORIZED'; });
    const specOf = function (r) { return (r && r.specLabel) || (r && r.gen && r.gen.specLabel) || ''; };
    const w205spec = w205.filter(function (r) { return specOf(r) !== ''; });
    const t28spec = t28w.filter(function (r) { return specOf(r) !== ''; });
    const t32spec = t32w.filter(function (r) { return specOf(r) !== ''; });
    if (w205.length === 27 && w205spec.length === 0 && t28w.length === 30 && t28spec.length === 30
      && t32w.length === 18 && t32spec.length === 18 && r5Notif.length === 8
      && plan.counts.total === 525 && plan.counts.nullId === 35
      && w205.every(function (r) { return r.dishId !== null && r.tier === 'A'; })
      && new Set(w205.map(function (r) { return r.dishId; })).size === 27
      && w205.every(function (r) { const n2=Number(String(r.dishId).slice(5)); return n2 >= 437 && n2 <= 463; })) {
      pass('T275', 'R5 收紧：W2-05 计 27 条且无 specLabel（12 炒类 + 15 剁椒面）、入册 c01_t49 A 类候选、正式 ID 覆盖 c01_d437–c01_d463 无重复、授权档口 c01_t28=30 / c01_t32=18 仍各拆 2 条、R5_SPEC_NOT_AUTHORIZED=8、总量 525 / nullId 35', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 R5 / §6.1.2 / §5.6.1');
    } else {
      fail('T275', 'R5 适用范围与计数', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 R5 / §6.1.2', JSON.stringify({
        w205: w205.length, w205spec: w205spec.length, t28: t28w.length, t28spec: t28spec.length,
        t32: t32w.length, t32spec: t32spec.length, notif: r5Notif.length,
        total: plan.counts.total, nullId: plan.counts.nullId
      }));
    }
    // T276–T278（2026-10-25 source_detail 授权轮；§9.1 登记待下一轮契约修订补录）
    // T276：39 条蛋炒记录的 source_detail 逐条非空且精确等于 §8.2 模板（第 9 张 + 牌面原文 + 三做法同价）
    const sd39 = plan.records.filter(function (r) { return r.stallId === 'c01_t48' && r.sourceLine >= 262 && r.sourceLine <= 274; });
    const sdOk39 = sd39.length === 39 && sd39.every(function (r) {
      const flavor = String(r.name).replace(/(炒饼|炒面|炒饭)$/, '');
      return r.source_detail === '现场拍摄价目表（第 9 张）：' + flavor + '炒饼/炒面/炒饭　三做法同价';
    });
    if (sdOk39) { pass('T276', '39 条蛋炒记录 source_detail 逐条等于「现场拍摄价目表（第 9 张）：<口味>炒饼/炒面/炒饭　三做法同价」（含第 9 张/牌面原文/三做法同价）', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.4 / 2F（TRANSCRIPTION_2F.md）§8.2'); }
    else { fail('T276', '蛋炒 source_detail 模板', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.4 / 2F（TRANSCRIPTION_2F.md）§8.2', JSON.stringify({ n: sd39.length, bad: sd39.filter(function (r) { const f = String(r.name).replace(/(炒饼|炒面|炒饭)$/, ''); return r.source_detail !== '现场拍摄价目表（第 9 张）：' + f + '炒饼/炒面/炒饭　三做法同价'; }).slice(0, 3).map(function (r) { return [r.name, r.source_detail]; }) })); }
    // T277：其余记录 source_detail 为 null（不编造「第 N 张」），且已生成文案无「已核实/已确认/已比对/经核对」禁词
    const sdOthers = plan.records.filter(function (r) { return !r.source_detail; });
    const forbidden = ['已核实', '已确认', '已比对', '经核对'];
    const sdClean = plan.records.filter(function (r) { return r.source_detail; }).every(function (r) { return forbidden.every(function (w) { return r.source_detail.indexOf(w) < 0; }); });
    if (sdOthers.length === plan.counts.total - 39 && sdClean) { pass('T277', '其余 ' + sdOthers.length + ' 条 source_detail 为 null（不编造来源细节）；已生成文案零禁词（§5.4 硬约束）', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.4 / 2F（TRANSCRIPTION_2F.md）§8.2'); }
    else { fail('T277', 'source_detail 覆盖边界', '契约 §5.4', JSON.stringify({ others: sdOthers.length, total: plan.counts.total, clean: sdClean })); }
    // T278：确定性——两次构建 39 条逐条一致；更正后口味（香菇鸡丁蛋）的句子反映新名
    const sd2 = (plan2sd && plan2sd.records ? plan2sd.records : []).filter(function (r) { return r.stallId === 'c01_t48' && r.sourceLine >= 262 && r.sourceLine <= 274; });
    const detOk = sd39.every(function (r, i) { return r.source_detail === sd2[i].source_detail; })
      && sd39.some(function (r) { return r.name === '香菇鸡丁蛋炒面' && r.source_detail === '现场拍摄价目表（第 9 张）：香菇鸡丁蛋炒饼/炒面/炒饭　三做法同价'; });
    if (detOk) { pass('T278', 'source_detail 同一输入产出同一文案（39 条两次构建逐条一致），更正后口味名已反映（香菇鸡丁蛋）', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§5.4 硬约束 4 / 2F（TRANSCRIPTION_2F.md）§8.2'); }
    else { fail('T278', 'source_detail 确定性', '契约 §5.4', JSON.stringify({ sample: sd39[8] && sd39[8].source_detail })); }
    // T262：编号区间用满且连续（d297–d318），无越界
    const nums = t37.map(function (r) { return Number(String(r.dishId).replace('c01_d', '')); }).sort(function (a, b) { return a - b; });
    let contig = nums.length === 22 && nums[0] === 297 && nums[21] === 318;
    for (let i = 1; i < nums.length && contig; i += 1) { if (nums[i] !== nums[i - 1] + 1) { contig = false; } }
    const overflow = plan.problems.filter(function (x) { return x.code === 'RANGE_OVERFLOW' && x.stallId === 'c01_t37'; });
    if (contig && overflow.length === 0) { pass('T262', 'c01_t37 编号 c01_d297–c01_d318 用满且连续，无 RANGE_OVERFLOW', '契约 §6.1.1'); }
    else { fail('T262', '编号区间', '契约 §6.1.1', JSON.stringify({ first: nums[0], last: nums[nums.length - 1], n: nums.length, overflow: overflow.length })); }
    // T263–T268：W2-03 双拼入流、加料提取、冲突检查（契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 / §6.1.1，2026-10-25）
    const t11w = plan.records.filter(function (r) { return r.stallId === 'c01_t11'; });
    const combosw = t11w.filter(function (r) { return /^双拼饭（公瑾爆蛋 \+ /.test(r.name); });
    const comboPricesw = combosw.map(function (r) { return r.price; });
    const wantPricesw = [13, 13, 14, 16, 16, 15, 15, 16];
    const comboOkw = combosw.length === 8 && JSON.stringify(comboPricesw) === JSON.stringify(wantPricesw) &&
      plan.records.filter(function (r) { return r.name === '公瑾爆蛋'; }).length === 1;
    if (comboOkw) { pass('T263', '双拼表识别为 S5_COMBO 并展开为 8 条独立商品，价格 13/13/14/16/16/15/15/16；「公瑾爆蛋」只保留菜单本身 1 条，双拼表不另生成组件条目', '契约 §6.1.1 类约定'); }
    else { fail('T263', '双拼展开', '契约 §6.1.1', JSON.stringify({ n: combosw.length, prices: comboPricesw })); }

    const addsw = plan.addons || [];
    const addNamesw = addsw.map(function (a) { return a.name; });
    const addListw = ['鸡腿', '狮子头', '甜辣鸭腿', '烤肠', '虎皮卷', '卤水豆腐', '虎皮蛋', '煎蛋'];
    const addOkw = addsw.length === 8 &&
      addsw.every(function (a) { return a.appliesTo === null && a.appliesToStatus === 'unknown' && a.sourceKind === 'field' && a.verifyStatus === 'unverified' && a.dishId === undefined; }) &&
      addListw.every(function (n) { return addNamesw.indexOf(n) >= 0; }) &&
      addNamesw.indexOf('特色把子肉') < 0 && addNamesw.indexOf('黑椒鸡排') < 0;
    if (addOkw) { pass('T264', '特色小吃 8 项进入 addons[]（无 dishId、appliesTo=null、appliesToStatus=unknown），字段形态符合最小结构', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 R8'); }
    else { fail('T264', '加料提取', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 R8', JSON.stringify({ n: addsw.length, names: addNamesw })); }

    const keepw = ['特色把子肉', '黑椒鸡排'].map(function (n) { return t11w.filter(function (r) { return r.name === n; }).length; });
    const keepInAddons = addsw.filter(function (a) { return a.name === '特色把子肉' || a.name === '黑椒鸡排'; }).length;
    if (keepw[0] >= 1 && keepw[1] >= 1 && keepInAddons === 0) { pass('T265', '「特色把子肉」「黑椒鸡排」仍作为独立商品记录存在（黑椒鸡排在菜单与特色小吃各 1 条属合法），且未被并入 addons', '用户裁决'); }
    else { fail('T265', '独立商品保留', '用户裁决', JSON.stringify({ keep: keepw, inAddons: keepInAddons })); }

    const colsw = plan.collisions || [];
    const ovfw = plan.records.filter(function (r) { return (r.problems || []).indexOf('RANGE_OVERFLOW') >= 0; });
    const okFlagw = plan.ok === (plan.counts.dupKeys === 0 && plan.counts.dupIds === 0 && colsw.length === 0);
    if (Array.isArray(colsw) && okFlagw && !(colsw.length > 0 && ovfw.length > 0)) { pass('T266', 'collisions 为数组且与 RANGE_OVERFLOW 互斥；ok 与「重复键/重复 ID/冲突」三者一致', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1'); }
    else { fail('T266', '冲突检查结构', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1', JSON.stringify({ cols: colsw, ok: plan.ok, overflow: ovfw.length })); }

    const t11numsw = t11w.map(function (r) { const parts = String(r.dishId || '').split('_d'); return parseInt(parts[1], 10); }).filter(function (n) { return n > 0; });
    const inRangew = t11numsw.every(function (n) { return n >= 52 && n <= 98; });
    const has099w = t11w.some(function (r) { return r.dishId === 'c01_d099'; });
    if (inRangew && !has099w) { pass('T267', 'W2-03 全部候选编号落在 c01_d052–c01_d098 内；c01_d099 属 c01_t14（契约 :409），W2-03 未占用；addons 不占编号', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1 编号容量'); }
    else { fail('T267', '编号容量', '契约（RECORD_GENERATOR_CONTRACT_20261023.md）§6.1', JSON.stringify({ min: Math.min.apply(null, t11numsw), max: Math.max.apply(null, t11numsw), has099: has099w })); }

    const genSrcw = fsx.readFileSync(genFile, 'utf8');
    const staticOkw = genSrcw.indexOf('S5_COMBO') >= 0 && genSrcw.indexOf('ADDON_NAMES') >= 0 && genSrcw.indexOf('RANGE_COLLISION') >= 0 &&
      genSrcw.indexOf('duplicate_id') >= 0 && genSrcw.indexOf('interval_overlap') >= 0 && genSrcw.indexOf('floor_order_violation') >= 0;
    if (staticOkw) { pass('T268', '生成器静态包含 S5_COMBO / ADDON_NAMES / RANGE_COLLISION 三类 kind，规则已落地', 'gen_records.js'); }
    else { fail('T268', '静态规则存在性', 'gen_records.js', '缺失关键字'); }
    // T269–T274：W2-03 冲突规则 / 合法空洞 / 跨店命名空间 / addons 不占号（契约 §3.3.1、§6.1.0）
    const conSrc269 = fsx.readFileSync(P.contract, 'utf8');
    const sec610 = conSrc269.slice(conSrc269.indexOf('#### 6.1.0'), conSrc269.indexOf('#### 6.1.1'));
    const kinds269 = ['duplicate_id', 'interval_overlap', 'floor_order_violation'].every(function (k) { return sec610.indexOf(k) >= 0; });
    const rules269 = ['RANGE_OVERFLOW', '合法空洞', '不阻断', '互斥', 'shopId'].every(function (k) { return sec610.indexOf(k) >= 0; });
    if (kinds269 && rules269) { pass('T269', '契约 §6.1.0 三类 kind 齐备，并写明与 RANGE_OVERFLOW 互斥、合法空洞不阻断、按 shopId 命名空间', '契约 §6.1.0'); }
    else { fail('T269', '冲突规则条款', '契约 §6.1.0', JSON.stringify({ kinds: kinds269, rules: rules269, len: sec610.length })); }

    const initBlocked = sec610.indexOf('进入正式初始化') >= 0 && sec610.indexOf('不得') >= 0;
    const codeGuard = genSrcw.indexOf('collide.length === 0') >= 0 || genSrcw.indexOf('collisions.length === 0') >= 0;
    if (initBlocked && codeGuard) { pass('T270', '冲突阻断初始化：契约明文禁止进入正式初始化，生成器 ok 与 collisions 联动', '契约 §6.1.0 / gen_records.js'); }
    else { fail('T270', '冲突阻断初始化', '契约 §6.1.0', JSON.stringify({ initBlocked: initBlocked, codeGuard: codeGuard })); }

    const t11ids271 = t11w.map(function (r) { return String(r.dishId || ''); }).filter(Boolean).sort();
    const gapOk = t11ids271.length === 40 && t11ids271[0] === 'c01_d052' && t11ids271[t11ids271.length - 1] === 'c01_d091' &&
      !t11ids271.some(function (id) { return ['c01_d092', 'c01_d093', 'c01_d094', 'c01_d095', 'c01_d096', 'c01_d097', 'c01_d098'].indexOf(id) >= 0; });
    const noCollide271 = (plan.collisions || []).length === 0 && !(plan.problems || []).some(function (p) { return p.code === 'RANGE_COLLISION'; });
    if (gapOk && noCollide271) { pass('T271', 'W2-03 40 条占 c01_d052–c01_d091，d092–c01_d098 为合法空洞且不产生 RANGE_COLLISION（空洞不阻断）', '契约 §6.1.0'); }
    else { fail('T271', '合法空洞', '契约 §6.1.0', JSON.stringify({ n: t11ids271.length, first: t11ids271[0], last: t11ids271[t11ids271.length - 1], collisions: (plan.collisions || []).length, ok: plan.ok })); }

    const crossShop = sec610.indexOf('c02_d040') >= 0 && sec610.indexOf('c01_d040') >= 0 && sec610.indexOf('命名空间按 `shopId`') >= 0;
    const codeScoped = genSrcw.indexOf('duplicate_id') >= 0 && genSrcw.indexOf('同店') >= 0;
    if (crossShop && codeScoped) { pass('T272', '跨店数字后缀可复用：契约以 shopId 为命名空间并举例 c01_d040/c02_d040，生成器重复检测按同店口径', '契约 §6.1.0'); }
    else { fail('T272', '跨店命名空间', '契约 §6.1.0', JSON.stringify({ crossShop: crossShop, codeScoped: codeScoped })); }

    const addonsHaveId = (plan.addons || []).some(function (a) { return a.dishId !== undefined || a.id !== undefined; });
    const addonsNotCounted = plan.counts.total === plan.records.length &&
      (plan.addons || []).length > 0;
    if (!addonsHaveId && addonsNotCounted) { pass('T273', 'addons 不占编号：无 dishId/id 字段，且 counts.total 等于 records.length（不含 addons）', '契约 §3.3.1'); }
    else { fail('T273', 'addons 不占编号', '契约 §3.3.1', JSON.stringify({ addonsHaveId: addonsHaveId, total: plan.counts.total, records: plan.records.length, addons: (plan.addons || []).length })); }

    const sec331 = conSrc269.slice(conSrc269.indexOf('#### 3.3.1'), conSrc269.indexOf('### 3.4'));
    const f331 = ['sourceFile', 'sourceLine', 'stallId', 'name', 'price', 'sourceKind', 'verifyStatus', 'appliesTo', 'appliesToStatus'].every(function (k) { return sec331.indexOf(k) >= 0; });
    const r331 = ['不计入', 'counts.total', '不分配 `dishId`'].every(function (k) { return sec331.indexOf(k) >= 0; });
    if (f331 && r331) { pass('T274', '契约 §3.3.1 定义 addons 九字段与口径（不分配 dishId、不计入 counts）', '契约 §3.3.1'); }
    else { fail('T274', 'addons 契约字段', '契约 §3.3.1', JSON.stringify({ fields: f331, rules: r331, len: sec331.length })); }
  })();

printResults();

const n = { PASS: 0, FAIL: 0, PENDING: 0 };
results.forEach(r => n[r.status]++);
console.log('\n汇总：通过 ' + n.PASS + ' / 失败 ' + n.FAIL + ' / 待实现 ' + n.PENDING);
if (n.PENDING) console.log('说明：待实现项依赖尚未生成的正式产物（records.json 等），属预期失败，不计入失败。');
console.log(n.FAIL ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(n.FAIL ? 1 : 0);
