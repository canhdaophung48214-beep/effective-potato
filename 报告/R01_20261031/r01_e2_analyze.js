
// R01-E2：foodType / tastes 缺失证据恢复分析（只读 evidence，不改正式数据）
// 输入：_raw/joined.json（R01-B 产出的 525 条阻塞清单）+ tools/pilot/TRANSCRIPTION_2F|3F.md
// 输出：R01_E2_tastes_evidence.csv / R01_E2_foodType_evidence.csv / R01_E2_缺失交集统计.json
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\25975\\Desktop\\食神寻味小程序开发';
const PROJ = path.join(ROOT, '项目');
const OUT = path.join(ROOT, '报告', 'R01_20261031');
const PILOT = path.join(PROJ, 'tools', 'pilot');

const J = JSON.parse(fs.readFileSync(path.join(OUT, '_raw', 'joined.json'), 'utf8'));
const TX = {
  'TRANSCRIPTION_2F.md': fs.readFileSync(path.join(PILOT, 'TRANSCRIPTION_2F.md'), 'utf8').split(/\r?\n/),
  'TRANSCRIPTION_3F.md': fs.readFileSync(path.join(PILOT, 'TRANSCRIPTION_3F.md'), 'utf8').split(/\r?\n/)
};

const TASTE_CN = { light: '清淡', mild_spicy: '微辣', spicy: '麻辣', choice: '可选辣度' };
const FT_CN = { rice: '饭类', noodle: '面类', rice_noodle: '米线类', rice_vermicelli: '粉类', dumpling: '饺子馄饨类', malatang: '麻辣烫 / 冒菜类', snack: '面点小吃类', other: '其他' };

// ---------- 行内括注口味（一对一，字母级证据） ----------
// 只认「该行菜品名自带的括注」；不认菜名本身含的辣字
const INLINE = [
  { re: /不辣/, val: 'light', conf: '中', why: '牌面括注「不辣」；按 TASTE_LABEL 最近义项取 light（清淡），枚举语义等价性需负责人确认' },
  { re: /香而不辣/, val: 'light', conf: '低', why: '牌面括注「香而不辣」；描述性文字，取 light 属候选，需负责人确认' },
  { re: /微辣/, val: 'mild_spicy', conf: '高', why: '牌面括注「微辣」与枚举 mild_spicy（微辣）逐字一致' },
  { re: /辣度适中/, val: 'mild_spicy', conf: '中', why: '牌面括注「辣度适中」；枚举无「适中」值，候选 mild_spicy 需负责人确认' },
  { re: /爆辣|重辣|特辣|变态辣/, val: 'spicy', conf: '中', why: '牌面括注最高辣度；枚举无对应值，候选 spicy 需负责人确认' },
  { re: /^辣$/, val: 'spicy', conf: '中', why: '牌面括注「（辣）」；枚举 spicy 标签为「麻辣」，是否等同需负责人确认' }
];

// 菜名辣味词（间接证据，规则 1 禁止据名推断 → 一律 B）
const NAME_SPICE = /麻辣|香辣|酸辣|甜辣|甜辣|辣|椒麻|藤椒|剁椒|泡椒|双椒|尖椒|小米辣|胡辣/;

// 主食词 → 枚举（仅间接线索，规则 3 禁止凭经验推断 → 一律 B）
const FT_WORDS = [
  { re: /麻辣烫|冒菜|麻辣拌/, ft: 'malatang' },
  { re: /米线/, ft: 'rice_noodle' },
  { re: /米粉|粉丝|宽粉|土豆粉|粉/, ft: 'rice_vermicelli' },
  { re: /水饺|饺子|馄饨|小笼包|烧麦|蒸饺|锅贴/, ft: 'dumpling' },
  { re: /面(?!包)|拉面|捞面|拌面|汤面|刀削面|炒面|挂面|凉面/, ft: 'noodle' },
  { re: /盖浇饭|蛋包饭|拌饭|双拼饭|炒饭|焖饭|饭/, ft: 'rice' },
  { re: /粥/, ft: 'other' },
  { re: /饼|馍|馕|烧饼|火烧|包子|花卷|油条|馒头|凉皮|寿司|饭团/, ft: 'snack' }
];

function secBounds(lines, line) {
  // 返回该行所在 ###/## 小节范围 [start, end]（1-based）
  let start = 1;
  for (let i = line - 1; i >= 0; i--) if (/^#{2,4} /.test(lines[i])) { start = i + 1; break; }
  let end = lines.length;
  for (let i = line; i < lines.length; i++) if (/^#{2,4} /.test(lines[i])) { end = i; break; }
  return [start, end];
}
function blockBounds(lines, line) {
  // 以「只有加粗的整行」为块边界，返回 [start, end]
  const isBold = (s) => /^\*\*[^*]+\*\*/.test(s.trim());
  let start = 1;
  for (let i = line - 1; i >= 0; i--) if (isBold(lines[i]) || /^#{2,4} /.test(lines[i])) { start = i + 1; break; }
  let end = lines.length;
  for (let i = line; i < lines.length; i++) if (isBold(lines[i]) || /^#{2,4} /.test(lines[i])) { end = i; break; }
  return [start, end];
}

const CAT = { A: 'A 有明确原始证据可恢复', B: 'B 间接证据需负责人确认', C: 'C 无足够证据保持未知', D: 'D 冲突需人工裁决' };

function tasteOf(r) {
  const lines = TX[r.sourceFile] || [];
  const ln = r.sourceLine;
  const text = (lines[ln - 1] || '').trim();
  const out = { cat: 'C', cand: '', conf: '—', why: '', ev: r.sourceFile + ':' + ln, quote: text, extra: '' };

  // 组合行：名称以「 / 」并列多个变体/单品、单价相同 → 口味不能定为单值
  if (/\s\/\s/.test(r.name)) {
    const seg = r.name.split('/');
    const spicySeg = seg.filter(s => NAME_SPICE.test(s));
    const plainSeg = seg.filter(s => !NAME_SPICE.test(s));
    if (spicySeg.length && plainSeg.length) {
      out.cat = 'D'; out.cand = '（不能定为单值：并列变体含辣/不辣两类）'; out.conf = '—';
      out.why = '同一行以「 / 」并列多个变体（含辣味变体与非辣味变体）、单价相同；口味不能定为单值，需负责人裁决是否拆条或取 choice';
      return out;
    }
    out.cat = 'B'; out.cand = '（组合行，含多个单品/变体，口味需逐品拆分）'; out.conf = '低';
    out.why = '一行并列多个单品单价格（组合行），无法为整体定单一口味；需负责人裁决拆分方式';
    return out;
  }

  // A：行内括注（必须该行确实带括注，且不是表头）
  if (/[（(]/.test(text) && !/^\|?\s*(菜品|项目|口味)/.test(text)) {
    for (const rule of INLINE) {
      const m = text.match(/[（(]([^）)]{0,12})[）)]/);
      if (m && rule.re.test(m[1])) {
        out.cat = 'A'; out.cand = rule.val + '（' + TASTE_CN[rule.val] + '）'; out.conf = rule.conf; out.why = rule.why;
        out.ev = r.sourceFile + ':' + ln;
        return out;
      }
    }
  }

  // B-1：同块存在「口味选项」行（作用域需负责人确认）
  const [bs, be] = blockBounds(lines, ln);
  const [ss, se] = secBounds(lines, ln);
  const legendLine = [];
  for (let i = bs - 1; i < be && i < lines.length; i++) {
    const t = (lines[i] || '').trim();
    if (/^\|/.test(t)) continue;
    if (/口味[:：（]/.test(t) && !/现场原文/.test(t) && (i + 1 !== ln || t.includes(r.name.replace(/[（(].*$/, '').trim()))) {
      // 菜品专属口味行（同一行写明「X 元（口味：…）」）只对该菜名生效
      if (/元/.test(t) && !t.includes(r.name.replace(/[（(].*$/, '').trim())) continue;
      legendLine.push(i + 1);
    }
  }
  if (legendLine.length) {
    out.cat = 'B'; out.cand = 'choice（可选辣度）';
    out.conf = '低';
    out.why = '同块存在口味选项行（' + r.sourceFile + ':' + legendLine[0] + '），牌面给出多档辣度/风味；该选项行是否覆盖本条菜品未经负责人确认，按规则 2 不得自动置 choice';
    out.ev = r.sourceFile + ':' + legendLine[0];
    out.extra = (lines[legendLine[0] - 1] || '').trim();
    return out;
  }

  // B-2：菜名辣味词（间接）
  if (NAME_SPICE.test(r.name)) {
    out.cat = 'B'; out.cand = '（按菜名辣味词推测的枚举值，仅供审查）'; out.conf = '低';
    out.why = '仅菜名字面含辣味词，牌面无该菜品辣度标注；按规则 1 不得据名推断口味，须负责人确认';
    return out;
  }

  // C：组合行（多品并列单价格）
  if (/\s\/\s/.test(r.name)) { out.cat = 'B'; out.cand = '（组合行，含多个单品，口味需逐品拆分）'; out.conf = '低'; out.why = '一行并列多个单品单价格（组合行），无法为整体定单一口味'; return out; }

  out.why = '牌面无口味/辣度标注，菜名亦无辣味线索；按规则 1、2 保持未知';
  return out;
}

function ftOf(r) {
  const lines = TX[r.sourceFile] || [];
  const ln = r.sourceLine;
  const text = (lines[ln - 1] || '').trim();
  const out = { cat: 'C', cand: '', conf: '—', why: '', ev: r.sourceFile + ':' + ln, quote: text };
  // D：名称含 ≥2 类主食词
  const hits = FT_WORDS.filter(w => w.re.test(r.name));
  const kinds = Array.from(new Set(hits.map(h => h.ft)));
  if (kinds.length >= 2) {
    out.cat = 'D'; out.cand = kinds.join(' / ') + '（多义）'; out.conf = '—';
    out.why = '菜名同时含两类及以上主食词（' + kinds.map(k => FT_CN[k]).join('、') + '），主食类型不唯一，需负责人裁决';
    return out;
  }
  if (kinds.length === 1) {
    out.cat = 'B'; out.cand = kinds[0] + '（' + FT_CN[kinds[0]] + '）'; out.conf = '中';
    out.why = '牌面无主食类型字段，仅菜名字面含主食词；按规则 3 不得凭经验推断 foodType，须负责人确认映射';
    return out;
  }
  out.why = '牌面无主食类型字段，菜名亦无主食词；无法判定，保持 null（BLOCKED_NO_FOODTYPE）';
  return out;
}

function csv(v) { const s = v === undefined || v === null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function row(cells) { return cells.map(csv).join(','); }

const eaters = { tastes: [], foodType: [] };
const stats = { tastes: { A: 0, B: 0, C: 0, D: 0 }, foodType: { A: 0, B: 0, C: 0, D: 0 } };
const candDist = { tastes: {}, foodType: {} };
const byStall = { tastes: {}, foodType: {} };

for (const r of J) {
  const base = {
    recordKey: r.recordKey, dishId: r.dishId || '', tier: r.tier,
    shop: r.shopName, floor: r.floor, stall: r.stallName, roster: r.roster, shot: r.shot,
    name: r.name, spec: r.specLabel || '', price: r.price
  };
  if (r.tastes === '[]') {
    const t = tasteOf(r);
    stats.tastes[t.cat]++;
    candDist.tastes[t.cand || '（无候选）'] = (candDist.tastes[t.cand || '（无候选）'] || 0) + 1;
    byStall.tastes[r.stallId + ' ' + r.stallName] = byStall.tastes[r.stallId + ' ' + r.stallName] || { A: 0, B: 0, C: 0, D: 0 };
    byStall.tastes[r.stallId + ' ' + r.stallName][t.cat]++;
    eaters.tastes.push([base.recordKey, base.dishId, base.tier, base.shop, base.floor, base.stall, base.roster + ' / ' + base.shot, base.name, base.spec, base.price,
      'tastes', '[]', t.cand || '—', t.cat, CAT[t.cat], t.why, t.conf, t.ev, t.quote, t.extra || '', t.cat === 'A' ? '可直接恢复（候选值待落盘授权）' : (t.cat === 'B' || t.cat === 'D' ? '是' : '否')]);
  }
  if (r.foodType === '（null）') {
    const f = ftOf(r);
    stats.foodType[f.cat]++;
    candDist.foodType[f.cand || '（无候选）'] = (candDist.foodType[f.cand || '（无候选）'] || 0) + 1;
    byStall.foodType[r.stallId + ' ' + r.stallName] = byStall.foodType[r.stallId + ' ' + r.stallName] || { A: 0, B: 0, C: 0, D: 0 };
    byStall.foodType[r.stallId + ' ' + r.stallName][f.cat]++;
    eaters.foodType.push([base.recordKey, base.dishId, base.tier, base.shop, base.floor, base.stall, base.roster + ' / ' + base.shot, base.name, base.spec, base.price,
      'foodType', 'null', f.cand || '—', f.cat, CAT[f.cat], f.why, f.conf, f.ev, f.quote, '', f.cat === 'A' ? '可直接恢复' : (f.cat === 'B' || f.cat === 'D' ? '是' : '否')]);
  }
}

const HEAD = ['record_key', 'dish_id', 'tier', 'shop', 'floor', 'stall', 'roster_shot', 'dish_name', 'spec', 'price', 'missing_field', 'current_value', 'candidate_value_审查用', 'category', 'category_label', 'reason', 'confidence', 'evidence_file_line', 'source_quote', 'related_legend_line', 'needs_owner_decision'];
fs.writeFileSync(path.join(OUT, 'R01_E2_tastes_evidence.csv'), '\ufeff' + [row(HEAD)].concat(eaters.tastes.map(row)).join('\r\n') + '\r\n', 'utf8');
fs.writeFileSync(path.join(OUT, 'R01_E2_foodType_evidence.csv'), '\ufeff' + [row(HEAD)].concat(eaters.foodType.map(row)).join('\r\n') + '\r\n', 'utf8');


// ---------- 档口级独立「口味」行：作用域未决，登记为潜在来源 ----------
const scopeLegends = [];
const dishScopedLegends = [];
for (const [file, lines] of Object.entries(TX)) {
  lines.forEach((t, i) => {
    const s2 = t.trim();
    if (!/口味[:：（]/.test(s2) || /^\|/.test(s2) || /现场原文/.test(s2)) return;
    const [ss, se] = secBounds(lines, i + 1);
    const rowsInSec = J.filter(r => r.sourceFile === file && r.sourceLine >= ss && r.sourceLine <= se && r.tastes === '[]');
    if (!rowsInSec.length) return;
    const rec = { file, line: i + 1, text: s2, section_first_line: ss, section_last_line: se, records_missing_tastes_in_section: rowsInSec.length, stalls: Array.from(new Set(rowsInSec.map(r => r.stallName))) };
    if (/元/.test(s2)) dishScopedLegends.push(rec); else scopeLegends.push(rec);
  });
}

const overlap = J.filter(r => r.foodType === '（null）' && r.tastes === '[]').length;
const onlyTastes = J.filter(r => r.foodType !== '（null）' && r.tastes === '[]').length;

const json = {
  schema_version: 1,
  generated_at: '2026-10-31',
  task: 'R01-E2 foodType / tastes 数据缺失证据恢复分析',
  inputs: { blockers: '_raw/joined.json（525 条）', transcription: ['tools/pilot/TRANSCRIPTION_2F.md', 'tools/pilot/TRANSCRIPTION_3F.md'], contract: 'docs/RECORD_GENERATOR_CONTRACT_20261023.md' },
  totals: { records: J.length, blocked_a: J.filter(r => r.tier === 'A').length, blocked_c: J.filter(r => r.tier === 'C').length, missing_foodType: stats.foodType.A + stats.foodType.B + stats.foodType.C + stats.foodType.D, missing_tastes: stats.tastes.A + stats.tastes.B + stats.tastes.C + stats.tastes.D },
  classification: {
    definition: { A: '有明确原始证据，可以恢复', B: '有间接证据，但需要负责人确认', C: '没有足够证据，必须保持未知', D: '存在冲突，需要人工裁决' },
    tastes: stats.tastes, foodType: stats.foodType
  },
  overlap: {
    both_missing: overlap,
    only_foodType_missing: stats.foodType.A + stats.foodType.B + stats.foodType.C + stats.foodType.D - overlap,
    only_tastes_missing: onlyTastes,
    note: 'foodType 缺失集合是 tastes 缺失集合的真子集：368 ⊂ 490，差集 122 条为 foodType 已由列映射/套餐规则赋值的记录'
  },
  cross_tab: (function () {
    const t = {};
    for (const r of J) {
      if (r.tastes !== '[]') continue;
      const a = tasteOf(r).cat;
      t[a] = t[a] || { A: 0, B: 0, C: 0, D: 0 };
      if (r.foodType === '（null）') t[a][ftOf(r).cat]++;
      else t[a]['已赋值'] = (t[a]['已赋值'] || 0) + 1;
    }
    return t;
  })(),
  candidate_distribution: { tastes: candDist.tastes, foodType: candDist.foodType },
  by_stall: byStall,
  pending_scope_legends: scopeLegends,
  dish_scoped_legends: dishScopedLegends,
  sum_check: {
    tastes_sum: stats.tastes.A + stats.tastes.B + stats.tastes.C + stats.tastes.D,
    foodType_sum: stats.foodType.A + stats.foodType.B + stats.foodType.C + stats.foodType.D,
    csv_rows: { tastes: eaters.tastes.length, foodType: eaters.foodType.length }
  }
};
fs.writeFileSync(path.join(OUT, 'R01_E2_缺失交集统计.json'), JSON.stringify(json, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({ totals: json.totals, classification: json.classification, overlap: json.overlap, cross_tab: json.cross_tab, cand_tastes: candDist.tastes, cand_foodType: candDist.foodType, rows: json.sum_check }, null, 1));
