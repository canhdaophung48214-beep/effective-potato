'use strict';
// R01-B 构建：把生成器内存产物 + 名册 + 转录稿拼成 525 条阻塞清单（只读输入，输出仅落 R01 目录）
const fs = require('fs');
const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const RAW = path.join(__dirname, '_raw');
const records = JSON.parse(fs.readFileSync(path.join(RAW, 'records.json'), 'utf8')).records;
const blockers = JSON.parse(fs.readFileSync(path.join(RAW, 'blockers.json'), 'utf8'));
const ents = blockers.entries;
const rd = p => fs.readFileSync(path.join(PROJ, p), 'utf8');

// ---- 名册 ----
const CL = rd('docs/RECORD_GENERATOR_CONTRACT_20261023.md').split(/\r?\n/);
function table(startLine) {
  const rows = [];
  for (let i = startLine - 1; i < CL.length; i++) {
    const l = CL[i];
    if (!/^\s*\|/.test(l)) break;
    rows.push(l);
  }
  return rows.map(r => r.split('|').slice(1, -1).map(s => s.trim()));
}
const isSep = c => /^-+:?$/.test(c.replace(/\s/g, ''));
const ROSTER = {};
for (const [line, kind] of [[423, '2F'], [495, '3F']]) {
  for (const r of table(line)) {
    if (isSep(r[0])) continue;
    if (r[0] === '名册位次' || r[0] === '3F 编号') continue;
    const sid = (r[kind === '2F' ? 2 : 2] || '').replace(/[\x60]/g, '');
    if (!/^c01_t\d\d$/.test(sid)) continue;
    ROSTER[sid] = kind === '2F'
      ? { floor: '2 楼', floorId: 'c01_f2', roster: r[0], name: r[1], shot: r[3], countDoc: r[4], tierDoc: r[5], rangeDoc: r[6] }
      : { floor: '3 楼', floorId: 'c01_f3', roster: r[0], name: r[1], shot: r[0], countDoc: r[3], tierDoc: r[4], rangeDoc: r[5] };
  }
}
const TRAN = { '2 楼': rd('tools/pilot/TRANSCRIPTION_2F.md').split(/\r?\n/), '3 楼': rd('tools/pilot/TRANSCRIPTION_3F.md').split(/\r?\n/), '2F': rd('tools/pilot/TRANSCRIPTION_2F.md').split(/\r?\n/), '3F': rd('tools/pilot/TRANSCRIPTION_3F.md').split(/\r?\n/) };

// ---- 记录索引 ----
const keyOf = r => r.stallId + '|' + r.gen.rawGroupKey + '|' + r.gen.specLabel + '|' + r.gen.disambiguator;
const recByKey = new Map();
for (const r of records) {
  const k = keyOf(r);
  if (recByKey.has(k)) throw new Error('重复记录键：' + k);
  recByKey.set(k, r);
}
const stripPrefix = k => { const i = String(k).indexOf('|'); return String(k).slice(0, i) + '|' + String(k).slice(i + 1).replace(/^f[23]\//, ''); };

const C_CODES = { c01_t20: 'B5·2F-W2-06', c01_t40: 'B5·3F-W03', c01_t41: 'B11' };
const C_WHY = {
  c01_t20: { miss: '计价口径未决（B5·2F-W2-06：手抓饼「元/张 vs 元/套」）；负责人 2026-10-25 之前已裁定「先跳过暂不录入」；dishId 未分配（C 档不占号）', next: '由负责人裁决手抓饼计价口径与是否录入，再决定 tier 与 dishId 分配' },
  c01_t40: { miss: '3F W03「二荤二素任你选」自选组合性质未裁决（B5·3F-W03）；3F 导览牌/门头照/楼层指引照缺失（B1/B2/B3）；dishId 未分配', next: '由负责人裁决自选组合是否属 R6 排除项；同时补拍 3F 导览牌与门头照' },
  c01_t41: { miss: '3F W04「12 元/份」含义未确认（B11：一份的商品构成与价格范围）；3F 导览牌/门头照/楼层指引照缺失（B1/B2/B3）；dishId 未分配', next: '由负责人确认「12 元/份」口径（是否可拆成多条、单价如何表达）' }
};

const rows = [];
ents.forEach((e, idx) => {
  const key = stripPrefix(e.recordKey);
  const r = recByKey.get(key) || null;
  const st = ROSTER[e.stallId] || { floor: '未知', floorId: '未知', roster: '—（名册外）', name: '—', shot: '—', countDoc: '—', tierDoc: '—', rangeDoc: '—' };
  const floorKey = st.floor === '2 楼' ? '2F' : st.floor === '3 楼' ? '3F' : '2F';
  const file = 'TRANSCRIPTION_' + floorKey + '.md';
  const tline = (TRAN[st.floor] || [])[e.sourceLine - 1] || '';
  const quote = tline.trim().slice(0, 120);
  const nameHit = quote.indexOf(String(e.name).slice(0, 4)) >= 0;
  const isA = e.kind === 'blocked_by_decision';
  const row = {
    seq: idx + 1,
    recordKey: e.recordKey,
    stableKey: key,
    kind: e.kind,
    reasons: (e.reasons || []).join('+') || '（空）',
    tier: e.tier,
    shopId: r ? r.shopId : 'c01',
    shopName: '服务楼',
    floor: st.floor,
    floorId: st.floorId,
    stallId: e.stallId,
    stallName: st.name,
    roster: st.roster,
    shot: st.shot,
    name: e.name,
    specLabel: r ? r.gen.specLabel : '（C 档无规格字段）',
    price: r ? r.price : '（未生成，不可推测）',
    foodType: r ? (r.foodType === null ? '（null）' : r.foodType) : '（未生成，不可推测）',
    tastes: r ? '[' + (r.tastes || []).join(' ') + ']' : '（未生成，不可推测）',
    dishId: r && r.id ? r.id : '（null，未分配）',
    generation_status: r ? r.gen.generation_status : 'not_generated',
    evidence_status: r ? r.gen.evidence_status : 'unclear_source',
    import_eligibility: r ? r.gen.import_eligibility : 'blocked',
    id_status: r ? r.gen.id_status : 'unassigned',
    sourceFile: file,
    sourceLine: e.sourceLine,
    rawRow: e.rawRow ? e.rawRow : '（空）',
    quote: quote ? (nameHit ? quote : '（行号未命中菜名，需人工核对）' + quote) : '（转录稿该行为空）',
    missing: '',
    available: '',
    next: '',
    needOwner: 'Y',
    contractRef: ''
  };
  if (isA) {
    const idSrc = r.gen.id_status === 'assigned_from_map';
    row.contractRef = '§4.2 A 候选行（:290）；§5.6.4 四条硬约束；C19（:315）';
    if (idSrc) {
      row.missing = '导入准入裁决缺失：ap-20261025-01 的 scope 仅「初始化 id-map（首版 104 条）」，明文排除「生成记录产物 / 导入 CSV」；全局阻塞 B1/B2/B3/B8 未解除；entry.reasons 为空，无阻塞编号级证据';
      row.available = file + ' 第 ' + e.sourceLine + ' 行转录稿；冻结 dishId ' + r.id + '（审批 ap-20261025-01，mapVersion 1#1，frozenMapSha256 4064287…；' + st.rangeDoc + '）';
      row.next = '由负责人签发「导入准入裁决」（放行范围 + B1/B2/B3/B8 处置口径 + 是否修订 C19）；执行侧不得自行放行';
    } else {
      row.missing = '正式 dishId 分配裁决缺失（当前 dishId 取自名册区间规划值 ' + st.rangeDoc + '，非审批下发）；导入准入裁决缺失；全局阻塞 B1/B2/B3/B8 未解除；entry.reasons 为空';
      row.available = file + ' 第 ' + e.sourceLine + ' 行转录稿；名册冻结区间 ' + st.rangeDoc + '（' + st.roster + ' ' + st.name + '，名册记录数 ' + st.countDoc + '，档 ' + st.tierDoc + '）';
      row.next = '① 先补 dishId 正式分配裁决（形式同 ap-20261025-01）；② 再签发导入准入裁决；两步都必须由负责人作出';
    }
  } else {
    const w = C_WHY[e.stallId] || { miss: '未登记原因', next: '待裁决' };
    row.contractRef = '§4.2 C 留待确认行（:292）；§6.3/§6.4 要求写 ' + (C_CODES[e.stallId] || 'B 编号') + '；§3.4.1 表 B（reasons 只能取登记标识）';
    row.missing = w.miss;
    row.available = '3F/2F 转录稿第 ' + e.sourceLine + ' 行原文（仅文本证据，无原图）；' + file;
    row.next = w.next;
  }
  rows.push(row);
});

// ---- 对账 ----
const tally = (a, f) => a.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const f2 = rows.filter(r => r.floor === '2 楼'), f3 = rows.filter(r => r.floor === '3 楼');
const stats = {
  total: rows.length,
  kind: tally(rows, r => r.kind),
  tier: tally(rows, r => r.tier),
  floor: tally(rows, r => r.floor),
  floorTier: tally(rows, r => r.floor + '|' + r.tier),
  stall: tally(rows, r => r.stallId + '|' + r.stallName + '|' + r.floor + '|' + r.tier),
  reasons: tally(rows, r => r.reasons),
  idStatus: tally(rows.filter(r => r.kind === 'blocked_by_decision'), r => r.id_status),
  quoteHit: rows.filter(r => r.quote.indexOf('未命中') < 0 && r.quote.indexOf('为空') < 0).length,
  quoteMiss: rows.filter(r => r.quote.indexOf('未命中') >= 0).length,
  quoteEmpty: rows.filter(r => r.quote.indexOf('为空') >= 0).length,
  rawRowEmpty: rows.filter(r => r.rawRow === '（空）').length,
  foodTypeNull: records.filter(r => r.foodType === null).length,
  nameNeRawGroupKey: records.filter(r => r.name !== r.gen.rawGroupKey).length,
  rosterUnmapped: rows.filter(r => r.roster === '—（名册外）').length,
  CStalls: tally(rows.filter(r => r.kind === 'not_generated'), r => r.stallId + '|' + r.stallName),
  recon: { f2: f2.length, f2A: f2.filter(r => r.tier === 'A').length, f2C: f2.filter(r => r.tier === 'C').length, f3: f3.length, f3A: f3.filter(r => r.tier === 'A').length, f3C: f3.filter(r => r.tier === 'C').length }
};
if (stats.total !== 525) throw new Error('总数≠525：' + stats.total);
if (stats.recon.f2 !== 382 || stats.recon.f3 !== 143 || stats.recon.f2A !== 376 || stats.recon.f3A !== 114) throw new Error('分层对账失败：' + JSON.stringify(stats.recon));

// ---- CSV ----
const COLS = ['seq', 'recordKey', 'stableKey', 'kind', 'reasons', 'tier', 'shopId', 'shopName', 'floor', 'floorId', 'stallId', 'stallName', 'roster', 'shot', 'name', 'specLabel', 'price', 'foodType', 'tastes', 'dishId', 'generation_status', 'evidence_status', 'import_eligibility', 'id_status', 'sourceFile', 'sourceLine', 'rawRow', 'quote', 'missing', 'available', 'next', 'needOwner', 'contractRef'];
const HEAD = { seq: '序号', recordKey: '记录键(生成器原格式)', stableKey: '稳定键(去档位前缀)', kind: '阻塞类型', reasons: '阻塞原因编号', tier: '档位', shopId: '店铺ID', shopName: '店铺', floor: '楼层', floorId: '楼层ID', stallId: '档口ID', stallName: '档口名', roster: '名册位次', shot: '采集批次编号', name: '菜品名', specLabel: '规格', price: '价格', foodType: '菜品类型', tastes: '口味', dishId: 'dishId', generation_status: 'generation_status', evidence_status: 'evidence_status', import_eligibility: 'import_eligibility', id_status: 'id_status', sourceFile: '来源文件', sourceLine: '源行号', rawRow: '原始行(rawRow)', quote: '转录稿原文(该行)', missing: '缺失的证据', available: '现有可用来源', next: '建议下一步', needOwner: '需负责人决定', contractRef: '契约依据' };
const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = [COLS.map(c => HEAD[c]).join(',')].concat(rows.map(r => COLS.map(c => esc(r[c])).join(','))).join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, 'R01_525条数据阻塞清单.csv'), csv, 'utf8');
fs.writeFileSync(path.join(RAW, 'joined.json'), JSON.stringify(rows, null, 1) + '\n', 'utf8');
fs.writeFileSync(path.join(RAW, 'stats_b.json'), JSON.stringify(stats, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(stats, null, 1));
console.log('CSV bytes =', Buffer.byteLength(csv, 'utf8'));
