'use strict';

const fs = require('fs');
const path = require('path');
/**
 * tools/pilot/gen_records.js —— 记录级生成器的**最小骨架**（2026-10-24 受控实施）
 *
 * 本文件当前**只**实现两件事：
 *   1) 契约 §3.5 的 CLI 五步语法校验（顺序：子命令 → 选项名 → 选项值 → 互斥 → 多余位置参数）；
 *   2) 一个**明确返回非成功**的 `run()`，用于让 T95/T100/T108 具备可测对象。
 *
 * 明确**未实现**（不得据本文件推断已具备能力）：
 *   - 读取转述稿、解析表格、展开候选、判定 gen/evidence/eligibility、汇总、契约断言；
 *   - 写出 `records.json` / `records_blockers.json` / `gen-manifest.json`；
 *   - `id-map.json` 的读取/初始化、编号分配、PUBLISHING 标记与发布流程；
 *   - 路径安全检查（`E28_OUT_REFUSED`）。**注意**：语法检查通过后它们全部落到 `run()`，
 *     而 `run()` 在本阶段一律返回「未实现」，因此不会产生任何写盘副作用。
 *
 * 导出面（G-7=O-1，契约 §10.6.4）：生产入口只有 `run`；测试专用命名空间 `__test__` 恰含 9 个冻结名字。
 */


// ── 规划基准（§7.2.1 S3 第 6 项）：正式生成路径强制使用，不得硬编码运行时实测值 ──
// 总量基准 2026-10-25 由负责人授权从 545/402/143 → 537/394/143 → 525/382/143（米线退役）三级更正；A/B/C 同日重锁为实测 490/0/35（2F 376/0/6、3F 114/0/29）——分档裁决完成；
// A/B/C 分档暂不锁定：以下 463/39/62 等为旧规划值，未按实测重算，分档裁决前不得据其放行。
const PROD_BASELINE = Object.freeze({
  total: 525, A: 490, B: 0, C: 35,
  f2: Object.freeze({ total: 382, A: 376, B: 0, C: 6 }),
  f3: Object.freeze({ total: 143, A: 114, B: 0, C: 29 })
});
// ── R5 规格拆条授权清单（契约 §6.1 R5 只列 W2-07、W2-09）──
// 依据：`docs/RECORD_GENERATOR_CONTRACT_20261023.md` §6.1 R5 行的明确清单；
// W2-07 四有青年面馆 = 2F西⑯ = c01_t28；W2-09 老马家·博山水饺 = 2F西⑳ = c01_t32。
// 未列入的档口（如 W2-05 炒粉炒面炒饼）即使表头出现「小份/大份」，也按单条记录计，不自动拆条。
const R5_SPEC_STALLS = Object.freeze(['c01_t28', 'c01_t32']);
// ── W2-03 公瑾爆蛋双拼牌面消歧（契约 §5.6.5.5.4.1 R4 / §10.7 消歧四项核实，2026-10-25 负责人裁决）──
// 依据：docs/decisions/DECISION_RECORD_W2-03_COMBO_DISAMBIG_20261025.md（人工审批记录，引负责人
// 2026-10-25 现场补录口述「与公瑾爆蛋双拼的分别是…」）。生成器只把审批通过的 系列值 应用到
// 审批通过的牌面行，不按价格/行号/排列自行推断（契约明令禁止）。
const COMBO_DISAMBIG_TABLES = Object.freeze([
  Object.freeze({
    file: 'TRANSCRIPTION_2F.md',
    shot: 'W2-03',
    boardTitle: '公瑾爆蛋 · 新品暴击',
    disambiguator: '系列-公瑾爆蛋 · 新品暴击'
  })
]);
// 识别方式：表头行上方（跳过空行）最近的加粗小标题即牌面原文；与白名单 boardTitle 精确一致才应用。
function comboDisambigFor(table, file, rawLines) {
  const hit = COMBO_DISAMBIG_TABLES.find(function (w) {
    return w.file === file && new RegExp('\\b' + w.shot + '\\b').test(String(table.section || ''));
  });
  if (!hit) { return ''; }
  for (let i = (table.startLine || 1) - 2; i >= 0; i -= 1) {
    const t = String(rawLines[i] == null ? '' : rawLines[i]).trim();
    if (!t) { continue; }
    const m = /^\*\*(.+?)\*\*[:：]?\s*$/.exec(t);
    if (!m) { return ''; }
    return m[1].trim() === hit.boardTitle ? hit.disambiguator : '';
  }
  return '';
}
// ── source_detail 照片映射白名单（契约 §5.4 / 转录稿 2F §8.2，2026-10-25 授权轮）──
// 只为「第 N 张」有直接证据（照片映射 confirmed）的表生成 source_detail；
// 映射未确认的档口一律 source_detail=null，不得编造「第 N 张」（§5.4 硬约束 / E6 精神）。
const SOURCE_DETAIL_PHOTO_MAP = Object.freeze([
  Object.freeze({
    file: 'TRANSCRIPTION_2F.md',
    shot: 'W2-04',
    kind: 'S3',
    headerAfter0: Object.freeze(['炒饼', '炒面', '炒饭']),
    photoSeq: 9,
    groupNote: '三做法同价'
  })
]);
function sourceDetailCtxFor(table, file) {
  const hit = SOURCE_DETAIL_PHOTO_MAP.find(function (w) {
    return w.file === file && w.kind === (table.kind || '') && new RegExp('\\b' + w.shot + '\\b').test(String(table.section || ''));
  });
  if (!hit) { return null; }
  const header = (table.header || []).map(stripMd);
  if (header.length !== hit.headerAfter0.length + 1) { return null; }
  for (let i = 0; i < hit.headerAfter0.length; i += 1) {
    if (header[i + 1] !== hit.headerAfter0[i]) { return null; }
  }
  const flavorByLine = {};
  (table.rows || []).forEach(function (row) {
    flavorByLine[row.line] = stripMd((row.cells || [])[0] || '');
  });
  return {
    photoSeq: hit.photoSeq,
    groupNote: hit.groupNote,
    prepSuffix: hit.headerAfter0.join('/'),
    flavorAt: function (line) { return flavorByLine[line] || ''; }
  };
}
// ── 退役表黑名单（2026-10-25 方案 A 裁决）：原表已被展开表取代，保留原文、不再生成记录 ──
const RETIRED_TABLES = Object.freeze([
  Object.freeze({ file: 'TRANSCRIPTION_2F.md', shot: 'W2-04', kind: 'S1', firstCell: '经典过桥米线' })
]);
function retiredTableFor(table, file) {
  return RETIRED_TABLES.find(function (w) {
    if (w.file !== file || w.kind !== (table.kind || '')) { return false; }
    if (!new RegExp('\\b' + w.shot + '\\b').test(String(table.section || ''))) { return false; }
    const first = stripMd((table.rows && table.rows[0] && table.rows[0].cells || [])[0] || '');
    return first === w.firstCell;
  });
}
const TEST_BASELINE_KEYS = ['total', 'A', 'B', 'C'];
const TEST_BASELINE_LAYERS = ['f2', 'f3'];
const BY_SOURCE = Object.freeze(['f2', 'f3']);
// ── 测试专用故障注入项（§7.2.5 表；CLI 不可达）──
const FAULT_ENUM = Object.freeze({
  manifestDrop: null, manifestAdd: null, countsDrop: null, countsAdd: null,
  blockersCountDelta: null, manifestCountsDelta: null,
  s4: ['id_status_mismatch'],
  s5: ['c_tier', 'candidate_only'],
  writeTemp: ['fail'],
  concurrentOutDir: ['beforeRename'],
  crashAfterRename: ['afterRename'],
  committed: ['fail']
});
const EXIT = Object.freeze({ OK: 0, VIOLATION: 1, USAGE: 2, IO: 3 });

const SUBCOMMAND = 'gen';

// 契约 §3.5「合法选项白名单」：闭合且最小
const OPTION_WHITELIST = Object.freeze({
  '--write': Object.freeze({ takesValue: false }),
  '--dry-run': Object.freeze({ takesValue: false }),
  '--out': Object.freeze({ takesValue: true })
});

// 初始化子命令（2026-10-25 实施轮）：显式独立入口，与 gen 互不通用。
// 普通 gen/dry-run/write 永不隐式触发初始化（T243 断言）；init 的唯一选项是
// --approval（审批记录编号，格式契约 §5.6.5.8.2 A4），缺失即在写入前失败。
const INIT_SUBCOMMAND = 'init';
const INIT_OPTION_WHITELIST = Object.freeze({
  '--approval': Object.freeze({ takesValue: true })
});

const CODE = Object.freeze({
  USAGE: 'E27_CLI_USAGE',
  MISSING_OUT: 'E24_MISSING_OUT',
  SKELETON: 'SKELETON_NOT_IMPLEMENTED'
});

function usageError(code, step, detail) {
  return { ok: false, exitCode: EXIT.USAGE, code: code, step: step, detail: detail };
}

/**
 * 契约 §3.5 五步校验（命中即停、只报首个、不聚合）。
 * @returns {{ok:true, mode:'write'|'dry-run', outDir:string|null}
 *          |{ok:false, exitCode:number, code:string, step:number, detail:string}}
 */
function parseArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  let i = 0;

  // ── 第 1 步：子命令 ────────────────────────────────────────────────
  let subcommand = SUBCOMMAND;
  if (i < args.length && args[i].indexOf('--') !== 0) {
    if (args[i] !== SUBCOMMAND && args[i] !== INIT_SUBCOMMAND) {
      return usageError(CODE.USAGE, 1, '未知子命令：' + JSON.stringify(args[i]) + '（合法子命令为 gen（可省略）与 init）');
    }
    subcommand = args[i];
    i += 1; // 显式给出子命令
  }
  const subcommandSlotEnd = i; // 子命令槽之后出现的非 -- token 才算位置参数
  // 选项白名单按子命令选取，两组互不通用（init 下 --write/--dry-run/--out 均为未知选项）
  const whitelist = subcommand === INIT_SUBCOMMAND ? INIT_OPTION_WHITELIST : OPTION_WHITELIST;

  // ── 第 2 步：选项名合法性（先整体扫描，任何未知选项即失败）──────────
  for (let k = 0; k < args.length; k += 1) {
    const tok = args[k];
    if (tok.indexOf('--') === 0 && !Object.prototype.hasOwnProperty.call(whitelist, tok)) {
      const legal = subcommand === INIT_SUBCOMMAND ? '--approval' : '--write / --dry-run / --out';
      return usageError(CODE.USAGE, 2, '未知选项：' + JSON.stringify(tok) + '（' + subcommand + ' 的合法选项仅 ' + legal + '）');
    }
  }

  // ── 第 3 步：选项值合法性（`--out` 必须携带非空值）──────────────────
  const seen = [];
  let outValues = 0;
  let outDir = null;
  let approvalId = null;
  for (let k = 0; k < args.length; k += 1) {
    const tok = args[k];
    if (tok.indexOf('--') !== 0) continue;
    seen.push(tok);
    if (!whitelist[tok].takesValue) continue;
    const next = args[k + 1];
    if (typeof next === 'undefined' || next.indexOf('--') === 0) {
      return usageError(CODE.USAGE, 3, '选项值缺失：' + tok + ' 需要且必须携带一个非空路径值');
    }
    if (next === '') {
      return usageError(CODE.USAGE, 3, '选项值为空：' + tok + ' 不接受空字符串');
    }
    if (tok === '--approval') { approvalId = next; } else { outValues += 1; outDir = next; }
    k += 1;
  }
  // init：--approval 必填且格式为 ap-YYYYMMDD-NN（契约 §5.6.5.8.2 A4）；缺审批引用的 init 在写入前失败
  if (subcommand === INIT_SUBCOMMAND && (approvalId === null || !/^ap-[0-9]{8}-[0-9]{2}$/.test(approvalId))) {
    return usageError(CODE.USAGE, 3, 'init 需要 --approval ap-YYYYMMDD-NN（审批记录编号，必填，缺审批引用不得初始化）');
  }
  const write = subcommand === INIT_SUBCOMMAND ? false : seen.indexOf('--write') >= 0;
  const dryRun = subcommand === INIT_SUBCOMMAND ? false : seen.indexOf('--dry-run') >= 0;
  if (write && outValues === 0) {
    return usageError(CODE.MISSING_OUT, 3, '缺少必需参数：--write 需要 --out <非空路径>（写入前失败、零写入）');
  }

  // ── 第 4 步：互斥冲突 ─────────────────────────────────────────────
  if (write && dryRun) {
    return usageError(CODE.USAGE, 4, '互斥参数冲突：--write 与 --dry-run 不得同时出现');
  }

  // ── 第 5 步：多余位置参数 ─────────────────────────────────────────
  const positional = [];
  for (let k = subcommandSlotEnd; k < args.length; k += 1) {
    const tok = args[k];
    if (tok.indexOf('--') === 0) {
      if (whitelist[tok] && whitelist[tok].takesValue) k += 1; // 跳过其值
      continue;
    }
    positional.push(tok);
  }
  if (positional.length > 0) {
    return usageError(CODE.USAGE, 5, '多余位置参数：' + positional.map(function (p) { return JSON.stringify(p); }).join('、') + '（本 CLI 不接受位置参数）');
  }

  return { ok: true, subcommand: subcommand, mode: write ? 'write' : 'dry-run', outDir: outDir, approvalId: approvalId };
}

/**
 * 生产入口（占位）。**一律返回非成功**，不写任何文件。
 * @returns {{exitCode:number, summary:object, violations:Array, blockers:Array}}
 */
// 生产默认映射路径（契约 §5.6.5.7；仅 run() 内部使用，CLI 不可指定）
const DEFAULT_MAP_PATH = path.join(__dirname, 'id-map.json');

// ---- Q-MAP-IO：映射读取失败的只读分类（契约 §7.4 第 1、2 条）----
// 能力边界（不得省略）：① 目录枚举只代表「探测时刻」的条目快照，不构成存在性/不存在性证明；
// ② lstat/stat/readdir 的结果仅对探测时刻有效，无法排除并发修改（mtime 比对只能发现明显变化）；
// ③ 名称折叠仅用于「发现歧义」，不用于判定存在；任何无法确认的情形一律归 IO/3（fail-closed）；
// ④ 不使用 realpath，不创建链接做能力探测，不按 process.platform 推断文件系统类型。
const MAX_PATH_DEPTH = 64;
const MAX_DIR_ENTRIES = 10000;

function splitPathSegments(p) {
  const abs = path.resolve(p);
  const root = path.parse(abs).root;
  const rest = abs.slice(root.length);
  const parts = rest.split(path.sep).filter(function (s) { return s.length > 0; });
  return { root: root, parts: parts };
}

function nameAmbiguity(name) {
  if (!name) return 'empty';
  if (/[. ]$/.test(name)) return 'trailing-dot-or-space';
  const stem = name.split('.')[0].toUpperCase();
  if (/^(CON|NUL|PRN|AUX|COM[1-9]|LPT[1-9])$/.test(stem)) return 'reserved-device-name';
  if (name.indexOf('~') >= 0 && /^[^.]{1,7}~\d(\.[^.]{0,3})?$/.test(name)) return 'short-name-shape';
  if (/[\u0000-\u001F\u007F]/.test(name)) return 'control-char';
  try {
    if (Buffer.from(name, 'utf8').toString('utf8') !== name) return 'invalid-encoding';
  } catch (e) { return 'invalid-encoding'; }
  return null;
}

function arbitrateMissing(parentDir, seg, isLast) {
  const amb = nameAmbiguity(seg);
  if (amb) return { cls: 'INDETERMINATE', detail: '名称语义歧义（' + amb + '）：' + seg };
  let before = null;
  let after = null;
  let entries = null;
  try { before = fs.statSync(parentDir); } catch (e) { before = null; }
  try { entries = fs.readdirSync(parentDir, { withFileTypes: true }); }
  catch (e) { return { cls: 'INDETERMINATE', detail: '父目录枚举失败（' + String(e && e.code) + '）' }; }
  if (entries.length > MAX_DIR_ENTRIES) {
    return { cls: 'INDETERMINATE', detail: '父目录条目数超过上限 ' + MAX_DIR_ENTRIES };
  }
  const names = entries.map(function (d) { return d.name; });
  if (names.indexOf(seg) >= 0) {
    const p = path.join(parentDir, seg);
    try {
      fs.readlinkSync(p);
      return { cls: 'UNREACHABLE_LINK', detail: '组件 ' + seg + ' 在枚举中存在但为不可解析链接' };
    } catch (e2) {
      return { cls: 'INDETERMINATE', detail: '组件 ' + seg + ' 在枚举中存在但 lstat 报缺失（结果矛盾）' };
    }
  }
  const segLower = seg.toLowerCase();
  const segNfkc = seg.normalize('NFKC');
  const folded = names.filter(function (n) { return n.toLowerCase() === segLower; });
  const nfkcEq = names.filter(function (n) { return n.normalize('NFKC') === segNfkc; });
  if (folded.length > 0 || nfkcEq.length > 0) {
    return { cls: 'INDETERMINATE', detail: '存在大小写或 Unicode 等价名称（' + (folded[0] || nfkcEq[0]) + '）：' + seg };
  }
  try { after = fs.statSync(parentDir); } catch (e3) { after = null; }
  if (before && after && before.mtimeMs !== after.mtimeMs) {
    return { cls: 'INDETERMINATE', detail: '验证期间父目录发生变化（mtime 不一致）' };
  }
  return { cls: 'MISSING', detail: '首个不存在组件：' + seg + (isLast ? '（目标本身）' : '（中间目录）') };
}

function classifyPath(mapPath) {
  const segs = splitPathSegments(mapPath);
  let cur = segs.root;
  for (let i = 0; i < segs.parts.length; i += 1) {
    if (i > MAX_PATH_DEPTH) return { cls: 'INDETERMINATE', detail: '路径深度超过上限 ' + MAX_PATH_DEPTH };
    const seg = segs.parts[i];
    const isLast = (i === segs.parts.length - 1);
    const next = path.join(cur, seg);
    let st = null;
    try {
      st = fs.lstatSync(next);
    } catch (e) {
      if (e && e.code === 'ENOENT') return arbitrateMissing(cur, seg, isLast);
      return { cls: 'INDETERMINATE', detail: '组件 ' + seg + ' 探测失败（' + String(e && e.code) + '）' };
    }
    let resolved = st;
    if (st.isSymbolicLink()) {
      try {
        resolved = fs.statSync(next);
      } catch (e2) {
        return { cls: 'UNREACHABLE_LINK', detail: '组件 ' + seg + ' 是不可解析的链接/联接点' };
      }
    }
    if (!resolved.isDirectory()) {
      if (isLast) return { cls: 'INDETERMINATE', detail: '目标路径存在但不是可读文件（' + seg + '）' };
      return { cls: 'UNREACHABLE', detail: '组件 ' + seg + ' 不是目录' };
    }
    cur = next;
  }
  return { cls: 'INDETERMINATE', detail: '路径全部组件存在但读取仍失败，原因无法归因' };
}

function ioMessage(mapPath, c) {
  const prefix = (c.cls === 'UNREACHABLE' || c.cls === 'UNREACHABLE_LINK') ? '路径不可达：' : '';
  return '映射文件无法读取（' + mapPath + '）：' + prefix + c.detail + '；按 Q-MAP-IO 归为 IO 失败（不得据此创建或修补映射）';
}

// 真实映射加载：只做「读取 + JSON 解析」两件事。
// 契约 §5.6.5.5.4 的五个校验步骤本轮**不实现**（C1 授权边界）。

// ── ID 映射辅助层（2026-10-24 M1–M4）：§5.6.5.5.4 结构校验、§5.6.5.5.4.1 R1–R8 键构造、§5.6.5.6 九类情形解析 ──
const KEY_LITERAL = 'stallId|groupKey|specLabel|disambiguator';
const KEY_PUNCT = /^[。，,、；;]+|[。，,、；;]+$/g;
function normGroupKey(v) {
  // R2：NFKC → 折叠连续空白为单个 ASCII 空格 → trim → 去首尾 。，,、；;
  return String(v).normalize('NFKC').replace(/\s+/g, ' ').trim().replace(KEY_PUNCT, '');
}
function normSpecLabel(v) {
  // R3：先 trim，再 NFKC；不折叠内部空白、不去标点
  return String(v).trim().normalize('NFKC');
}
function rawKeyPart(v, field) {
  // R5/R7/R8：缺失或 null → 空字符串；非空非字符串 → E15；含半角 | → E15（不转义、不猜测分段）
  if (v === undefined || v === null) { return { ok: true, value: '' }; }
  if (typeof v !== 'string') { return { ok: false, field: field, reason: '非字符串值不得静默转换（R8）' }; }
  if (v.indexOf('|') >= 0) { return { ok: false, field: field, reason: '字段含半角竖线 |（R7）' }; }
  return { ok: true, value: v };
}
function makeKeyFrom(record) {
  const g = (record && record.gen) || {};
  const parts = [];
  const rawStall = rawKeyPart(record && record.stallId, 'stallId');
  if (!rawStall.ok) { return { ok: false, field: rawStall.field, reason: rawStall.reason }; }
  parts.push(rawStall.value);                       // R1：原样
  // §5.6.5.2：键的 groupKey 必须是『该行菜名原文』，不得带层前缀（f2/ / f3/）。
  const groupSrc = (g.rawGroupKey != null) ? g.rawGroupKey : String(g.groupKey == null ? '' : g.groupKey).replace(/^f[23]\//, '');
  const rawGroup = rawKeyPart(groupSrc, 'groupKey');
  if (!rawGroup.ok) { return { ok: false, field: rawGroup.field, reason: rawGroup.reason }; }
  parts.push(normGroupKey(rawGroup.value));         // R2
  const rawSpec = rawKeyPart(g.specLabel, 'specLabel');
  if (!rawSpec.ok) { return { ok: false, field: rawSpec.field, reason: rawSpec.reason }; }
  parts.push(normSpecLabel(rawSpec.value));         // R3
  const rawDis = rawKeyPart(g.disambiguator, 'disambiguator');
  if (!rawDis.ok) { return { ok: false, field: rawDis.field, reason: rawDis.reason }; }
  parts.push(rawDis.value);                         // R4：原样（只来自审批）
  return { ok: true, key: parts.join('|'), parts: parts };   // R6：半角 | 连接，不二次归一化
}
function mapError(code, message, step) { return { code: code, message: message, step: step }; }
function validateMapStructure(map) {
  // §5.6.5.5.4 第 2 步：schemaVersion / entries 容器 / 条目结构 / status / approvedBy / dishId / orphans
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    return mapError('E15_BAD_MAP', '映射必须是 JSON 对象', 2);
  }
  if (map.schemaVersion !== 1) {
    return mapError('E15_BAD_MAP', 'schemaVersion 必须为 1（实际 ' + JSON.stringify(map.schemaVersion) + '），不做自动迁移', 2);
  }
  if (!Array.isArray(map.entries)) { return mapError('E15_BAD_MAP', 'entries 必须是数组', 2); }
  for (let i = 0; i < map.entries.length; i += 1) {
    const e = map.entries[i];
    const at = 'entries[' + i + ']';
    if (e === null || typeof e !== 'object' || Array.isArray(e)) { return mapError('E15_BAD_MAP', at + ' 必须是对象', 2); }
    if (typeof e.key !== 'string' || e.key.length === 0) { return mapError('E15_BAD_MAP', at + '.key 必须是非空字符串', 2); }
    const fields = ['stallId', 'groupKey', 'specLabel', 'disambiguator'];
    for (let k = 0; k < fields.length; k += 1) {
      const r = rawKeyPart(e[fields[k]], fields[k]);
      if (!r.ok) { return mapError('E15_BAD_MAP', at + '.' + r.field + ' ' + r.reason, 2); }
    }
    if (!('dishId' in e)) { return mapError('E15_BAD_MAP', at + '.dishId 缺失（必须显式给出字符串或 null）', 2); }
    if (e.dishId !== null && (typeof e.dishId !== 'string' || e.dishId.length === 0)) {
      return mapError('E15_BAD_MAP', at + '.dishId 必须是非空字符串或显式 null', 2);
    }
    if (e.status !== 'active' && e.status !== 'pending_review') {
      return mapError('E15_BAD_MAP', at + '.status 只能是 active 或 pending_review', 2);
    }
    if (e.dishId === null && e.status === 'active') {
      return mapError('E15_BAD_MAP', at + ' 出现 dishId:null 与 status:active 的非法组合（E-4）', 2);
    }
    if (e.status === 'pending_review' && e.dishId !== null) {
      return mapError('E15_BAD_MAP', at + ' pending_review 必须 dishId:null（PK1-R1）', 2);
    }
    if (typeof e.approvedBy !== 'string' || e.approvedBy.length === 0) {
      return mapError('E15_BAD_MAP', at + '.approvedBy 必须是非空字符串', 2);
    }
    if (e.approvedBy === 'auto') { return mapError('E15_BAD_MAP', at + '.approvedBy 不得为 auto（§5.6.5.5）', 2); }
  }
  if (map.orphans !== undefined) {
    if (!Array.isArray(map.orphans)) { return mapError('E15_BAD_MAP', 'orphans 若存在必须是数组', 2); }
    for (let i = 0; i < map.orphans.length; i += 1) {
      const o = map.orphans[i];
      if (o === null || typeof o !== 'object' || Array.isArray(o)) { return mapError('E15_BAD_MAP', 'orphans[' + i + '] 必须是对象', 2); }
      if (typeof o.key !== 'string' || o.key.length === 0) { return mapError('E15_BAD_MAP', 'orphans[' + i + '].key 必须是非空字符串', 2); }
      if (o.status !== 'orphan') { return mapError('E15_BAD_MAP', 'orphans[' + i + '].status 固定为 "orphan"（独立状态域）', 2); }
    }
  }
  // 第 3 步：keyFormat 固定字面量 + 每条键恰好四段
  if (map.keyFormat !== KEY_LITERAL) {
    return mapError('E15_BAD_MAP', 'keyFormat 必须是固定字面量 "' + KEY_LITERAL + '"（实际 ' + JSON.stringify(map.keyFormat) + '）', 3);
  }
  for (let i = 0; i < map.entries.length; i += 1) {
    const parts = map.entries[i].key.split('|');
    if (parts.length !== 4) {
      return mapError('E15_BAD_MAP', 'entries[' + i + '].key 必须恰好四段（实际 ' + parts.length + ' 段）', 3);
    }
  }
  // 第 4 步：重复 dishId（null 不参与）
  const ids = Object.create(null);
  for (let i = 0; i < map.entries.length; i += 1) {
    const id = map.entries[i].dishId;
    if (id === null) { continue; }
    if (ids[id] !== undefined) { return mapError('E13_DUP_ID', '重复 dishId：' + id + '（entries[' + ids[id] + '] 与 entries[' + i + ']）', 4); }
    ids[id] = i;
  }
  // 第 5 步：重复 key
  const keys = Object.create(null);
  for (let i = 0; i < map.entries.length; i += 1) {
    const key = map.entries[i].key;
    if (keys[key] !== undefined) { return mapError('E14_DUP_KEY', '重复 key：' + key + '（entries[' + keys[key] + '] 与 entries[' + i + ']）', 5); }
    keys[key] = i;
  }
  return null;
}
function resolveRecords(records, map) {
  // §5.6.5.6 九类情形（只做内存解析，不写 map、不删孤儿、不生成 ID）
  const byKey = new Map();
  (map.entries || []).forEach(function (e) {
    if (!byKey.has(e.key)) { byKey.set(e.key, []); }
    byKey.get(e.key).push(e);
  });
  const seen = new Set();
  const violations = [];
  const stats = { assigned: 0, plannedFromRoster: 0, newKey: 0, pendingReview: 0, keyCollision: 0, unconstructible: 0 };
  // 映射中全部 dishId（用于 planned_from_roster 的冲突检测：不得占用映射已用号）
  const mapDishIds = new Set();
  (map.entries || []).forEach(function (e) { if (e.dishId) { mapDishIds.add(e.dishId); } });
  // 情形⑥：同一个键对应多条**当前记录** → KEY_COLLISION（先统计键出现次数，再逐条判定）
  const keyCount = Object.create(null);
  records.forEach(function (rec) {
    const mk0 = makeKeyFrom(rec);
    if (mk0.ok) { keyCount[mk0.key] = (keyCount[mk0.key] || 0) + 1; }
  });
  records.forEach(function (rec) {
    rec.gen = rec.gen || {};
    rec.gen.blockers = rec.gen.blockers || [];
    function block(code) {
      if (rec.gen.blockers.indexOf(code) < 0) { rec.gen.blockers.push(code); }
      // 契约 G-6=B / PK1-R1：碰撞/待审/不可构造/未命中键的 dishId 必须写 null——仅针对
      // 适配器预置的 planned_from_roster（名册规划候选号）；其它来源的 id 不动，以保持
      // 既有 C18 对抗性断言（id 非空 + unassigned 必须被检出）与 S2 重复 ID 检测能力。
      if (rec.gen.id_status === 'planned_from_roster') { rec.id = null; }
      rec.gen.id = null;
      rec.gen.id_status = 'unassigned';
    }
    const mk = makeKeyFrom(rec);
    if (!mk.ok) {
      stats.unconstructible += 1;
      violations.push({ code: 'E15_BAD_MAP', stage: 'candidate', message: '候选键构造失败：' + mk.field + ' ' + mk.reason, field: mk.field });
      block('KEY_UNCONSTRUCTIBLE');
      return;
    }
    seen.add(mk.key);
    if ((keyCount[mk.key] || 0) > 1) { stats.keyCollision += 1; block('KEY_COLLISION'); return; }
    const hits = byKey.get(mk.key) || [];
    if (hits.length > 1) { stats.keyCollision += 1; block('KEY_COLLISION'); return; }
    if (hits.length === 1) {
      const e = hits[0];
      if (e.status === 'active' && typeof e.dishId === 'string' && e.dishId) {
        // C18 第 2 类：映射分配的 ID 必须与获批映射一致；不一致（含疑似篡改）→ fail-closed，
        // 不得回退为 NEW_KEY、不得静默改号。
        if (rec.id !== null && rec.id !== undefined && rec.id !== e.dishId) {
          stats.newKey += 0;
          violations.push({ code: 'ID_MAP_MISMATCH', stage: 'resolve', message: '记录 id 与映射 dishId 不一致：' + rec.id + ' ≠ ' + e.dishId + '（key=' + mk.key + '）' });
          block('ID_MAP_MISMATCH');
          return;
        }
        stats.assigned += 1;
        rec.gen.id = e.dishId;
        rec.gen.id_status = 'assigned_from_map';
        return;
      }
      stats.pendingReview += 1;
      block('PENDING_REVIEW');
      return;
    }
    stats.newKey += 1;
    // C18 第 3 类：契约名册规划候选 ID（§5.6.1/§5.6.3 逐档口区间确定性派生）——须满足
    // ① 档口区间成员（由适配器验证后置 status）② 不与映射任何 dishId 冲突 ③ 全局唯一。
    if (rec.id !== null && rec.id !== undefined && rec.gen.id_status === 'planned_from_roster') {
      if (mapDishIds.has(rec.id)) {
        violations.push({ code: 'ID_CONFLICT', stage: 'resolve', message: '名册规划 ID 与映射已用号冲突：' + rec.id });
        block('ID_CONFLICT');
        return;
      }
      stats.plannedFromRoster += 1;
      rec.gen.id = rec.id;
      rec.gen.id_status = 'planned_from_roster';
      return;
    }
    block('NEW_KEY');
  });
  const orphans = [];
  (map.entries || []).forEach(function (e) {
    if (!seen.has(e.key)) { orphans.push({ key: e.key, dishId: e.dishId, code: 'ORPHAN_IN_MAP' }); }
  });
  return { resolved: true, stats: stats, violations: violations, orphans: orphans };
}

function loadMap(mapPath) {
  let raw = null;
  try {
    raw = fs.readFileSync(mapPath, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      // ENOENT 不直接等于「文件不存在」：按 Q-MAP-IO 做只读逐组件验证后再归类。
      const c = classifyPath(mapPath);
      if (c.cls === 'MISSING') {
        return {
          ok: false,
          exitCode: EXIT.VIOLATION,
          status: 'NO_ID_MAP',
          code: 'E12_NO_ID_MAP',
          message: '缺少 id-map.json（' + mapPath + '）：' + c.detail + '；拒绝开始编号，需先单独批准建档',
          ambiguity: null
        };
      }
      return {
        ok: false,
        exitCode: EXIT.IO,
        status: 'MAP_IO_ERROR',
        code: null,
        message: ioMessage(mapPath, c),
        ambiguity: null
      };
    }
    // 其他文件系统错误（EISDIR / EACCES / EPERM / ELOOP …）：一律 IO 类失败（退出码 3），
    // 不绑定专用错误码、不伪装成 E12、不降级写出、不创建或修补映射。
    return {
      ok: false,
      exitCode: EXIT.IO,
      status: 'MAP_IO_ERROR',
      code: null,
      message: '映射文件无法读取（' + mapPath + '）：' + String(e && e.code) + '；按 Q-MAP-IO 归为 IO 失败（不得据此创建或修补映射）',
      ambiguity: null
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      exitCode: EXIT.VIOLATION,
      status: 'BAD_ID_MAP',
      code: 'E15_BAD_MAP',
      message: 'id-map.json 解析失败（' + mapPath + '）：' + String(e && e.message),
      ambiguity: null
    };
  }
  // §5.6.5.5.4 第 2–5 步：首错即停、只报首个、不静默修复
  const structErr = validateMapStructure(parsed);
  if (structErr) {
    return {
      ok: false,
      exitCode: EXIT.VIOLATION,
      status: 'BAD_ID_MAP',
      code: structErr.code,
      message: 'id-map.json 第 ' + structErr.step + ' 步校验失败：' + structErr.message,
      mapStep: structErr.step,
      ambiguity: null
    };
  }
  // M5C-2：加载成功后做一次键一致性诊断（第一阶段：仅诊断，不阻断、不改退出码）。
  return { ok: true, exitCode: EXIT.OK, status: 'MAP_LOADED', code: null, map: parsed, message: '',
    warnings: diagnoseKeyMismatch(parsed), ambiguity: null };
}

function run(options) {
  const opts = options || {};
  const injected = (typeof opts.mapPath === 'string' && opts.mapPath) ? opts.mapPath : null;
  const mapPath = injected || DEFAULT_MAP_PATH;
  const mode = opts.mode || 'dry-run';
  // 测试专用：testBaseline 仅允许随内部 records 注入通道出现；CLI 无此参数。
  if (opts.testBaseline !== undefined && !Array.isArray(opts.records)) {
    return {
      exitCode: EXIT.USAGE,
      summary: { status: 'E29_PARAM_CONFLICT', mode: mode, outDir: opts.outDir || null, records: 0,
        note: 'testBaseline 只能与内部 records 注入同时使用（CLI 不可达）' },
      violations: [{ code: 'E29_PARAM_CONFLICT', message: 'testBaseline 仅测试通道可用' }], blockers: []
    };
  }
  let baseline = null;
  try { baseline = resolveBaseline(opts.testBaseline); } catch (e) {
    return {
      exitCode: EXIT.USAGE,
      summary: { status: 'E29_PARAM_CONFLICT', mode: mode, outDir: opts.outDir || null, records: 0,
        note: String((e && e.message) || e) },
      violations: [{ code: 'E29_PARAM_CONFLICT', message: String((e && e.message) || e) }], blockers: []
    };
  }
  const outDir = opts.outDir || null;
  const loaded = loadMap(mapPath);

  // 任务 C：读参数与任何写参数冲突时必须拒绝（不得静默优先执行读侧）
  if (typeof opts.inspectDir === 'string' && opts.inspectDir) {
    const conflicts = [];
    if (mode === 'write') { conflicts.push('mode=write'); }
    if (opts.outDir) { conflicts.push('outDir'); }
    if (opts.records) { conflicts.push('records'); }
    if (conflicts.length > 0) {
      return {
        exitCode: EXIT.USAGE,
        summary: {
          status: 'E29_PARAM_CONFLICT', mode: mode, outDir: opts.outDir || null, records: 0,
          note: 'inspectDir 与写参数不可同时使用：' + conflicts.join('、') + '（未创建、未修改任何文件）'
        },
        violations: [{ code: 'E29_PARAM_CONFLICT', message: '读参数与写参数冲突：' + conflicts.join('、') }],
        blockers: []
      };
    }
  }

  // §7.2.3 读侧入口：只读检查某个发布目录是否完整（不写盘、CLI 不可达）。
  if (typeof opts.inspectDir === 'string' && opts.inspectDir) {
    const info = inspectPublished(opts.inspectDir);
    return {
      exitCode: info.complete ? EXIT.OK : EXIT.VIOLATION,
      summary: {
        status: info.complete ? 'PUBLISH_COMPLETE' : 'INCOMPLETE_PUBLISH',
        mode: mode, outDir: path.resolve(opts.inspectDir), records: 0,
        code: info.code, reasons: info.reasons, note: info.reasons.join('；')
      },
      violations: info.code ? [{ code: info.code, message: info.reasons.join('；') }] : [],
      blockers: []
    };
  }

  // 注入记录时（内部测试通道）不因缺少 id-map.json 提前返回：L8 构建不需要映射。
  if (!loaded.ok && !Array.isArray(opts.records)) {
    return {
      exitCode: loaded.exitCode,
      summary: {
        status: loaded.status,
        mode: mode,
        outDir: outDir,
        mapPath: mapPath,
        mapPathInjected: injected !== null,
        records: 0,
        note: loaded.message,
        ambiguity: loaded.ambiguity
      },
      violations: loaded.code ? [{ code: loaded.code, message: loaded.message }] : [],
      blockers: []
    };
  }

  // L8（2026-10-25 适配器轮）：记录来源两通道——① 注入数组（测试通道，CLI 不可达）；
  // ② 生产源构建：dry-run 且映射加载成功时，buildInitPlanRecords（C 段，不改其模型）→
  // adaptPlanRecordsForL8（§3.3 适配，映射表 ADAPTER_MAP_C_TO_L8_20261025.md）→ 同一 L8
  // 内存闭环。write 模式的写出/发布（P1 十阶段）仍未实现——fail-closed 落到 SKELETON。
  const injectedRecords = Array.isArray(opts.records) ? opts.records : null;
  // 2026-10-25 写出链路轮：生产源构建对 dry-run 与 write 同等开放（同一 L8 闭环；
  // write 继续走既有 P1 十阶段 publishOutputs，不另造机制）。映射不可用时维持 E12 拒绝。
  if (injectedRecords !== null || loaded.ok) {
    let sourceRecords = injectedRecords;
    if (sourceRecords === null) {
      try {
        const plan = buildInitPlanRecords({});
        // 名册区间证据（C18 第 3 类）：与 C 段同一契约文本；只在内存读取，不写盘。
        const contractText = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'RECORD_GENERATOR_CONTRACT_20261023.md'), 'utf8');
        const roster = parseRosterRows(contractText);
        sourceRecords = adaptPlanRecordsForL8(plan, { rosterRows: [].concat(roster.f2 || [], roster.f3 || []) });
      }
      catch (e) {
        return {
          exitCode: EXIT.VIOLATION,
          summary: {
            status: 'SOURCE_BUILD_FAILED', mode: mode, outDir: outDir, mapPath: mapPath,
            mapPathInjected: injected !== null, mapLoaded: loaded.ok, records: 0,
            note: '源记录构建/适配失败：' + String((e && e.message) || e)
          },
          violations: [{ code: (e && e.code) || 'SOURCE_BUILD_ERROR', message: String((e && e.message) || e) }],
          blockers: []
        };
      }
    }
    let mapping = null;
    if (loaded.ok) {
      mapping = resolveRecords(sourceRecords, loaded.map);
      mapping.warnings = loaded.warnings || [];
    }
    let built = null;
    try {
      built = buildOutputs(sourceRecords, { sources: opts.sources, contractVersion: opts.contractVersion, faults: opts.faults });
    } catch (e) {
      return {
        exitCode: EXIT.VIOLATION,
        summary: {
          status: 'L8_BUILD_FAILED',
          mode: mode,
          outDir: outDir,
          mapPath: mapPath,
          mapPathInjected: injected !== null,
          mapLoaded: loaded.ok,
          records: 0,
          note: 'L8 内存构建失败：' + String((e && e.message) || e)
        },
        violations: [{ code: (e && e.code) || 'L8_BUILD_ERROR', message: String((e && e.message) || e) }],
        blockers: []
      };
    }
    // P1：写模式下先做「缺 --out」判定（§3.2 / §3.5：任何写盘之前失败、退出码 2、零写入）
    if (mode === 'write') {
      if (!outDir) {
        return {
          exitCode: EXIT.USAGE,
          summary: {
            status: 'E24_MISSING_OUT', mode: mode, outDir: null, mapPath: mapPath,
            mapPathInjected: injected !== null, mapLoaded: loaded.ok, records: 0,
            note: '--write 必须显式提供非空 --out；已在任何文件系统写入之前失败'
          },
          violations: [{ code: 'E24_MISSING_OUT', message: '--write 缺少 --out（零写入）' }],
          blockers: []
        };
      }
      built.baseline = opts.testBaseline ? baseline : null;
      const pub = publishOutputs(built, outDir, { repoRoot: opts.repoRoot, faults: opts.faults });
      const okPub = pub.exitCode === EXIT.OK;
      return {
        exitCode: pub.exitCode,
        summary: {
          status: okPub ? 'PUBLISH_OK' : ('PUBLISH_FAILED_' + pub.stage),
          mode: mode,
          outDir: pub.outDir,
          mapPath: mapPath,
          mapPathInjected: injected !== null,
          mapLoaded: loaded.ok,
          records: built.recordsDoc.records.length,
          blockers: built.blockersDoc.count,
          counts: built.manifest.counts,
          stage: pub.stage,
          publishedAt: pub.publishedAt,
          tmpDir: pub.tmpDir,
          note: pub.message
        },
        violations: (pub.codes || []).map(function (c) { return { code: c, message: pub.message }; }),
        blockers: built.blockersDoc.entries,
        outputs: built,
        publish: pub,
        mapping: mapping
      };
    }

    const failed = built.violations.length > 0;
    return {
      exitCode: failed ? EXIT.VIOLATION : EXIT.OK,
      summary: {
        status: failed ? 'L8_VALIDATION_FAILED' : 'L8_IN_MEMORY_ONLY',
        mode: mode,
        outDir: outDir,
        mapPath: mapPath,
        mapPathInjected: injected !== null,
        mapLoaded: loaded.ok,
        records: built.recordsDoc.records.length,
        blockers: built.blockersDoc.count,
        counts: built.manifest.counts,
        note: 'L8 只在内存中构建并序列化三份产物；未写盘、未发布（P1 未授权）'
      },
      violations: built.violations,
      blockers: built.blockersDoc.entries,
      outputs: built,
      mapping: mapping
    };
  }

  // 读取与解析成功 ≠ 生成可用：完整生成流程仍未实现，必须如实报告未实现状态。
  return {
    exitCode: EXIT.VIOLATION,
    summary: {
      status: 'SKELETON_NOT_IMPLEMENTED',
      mode: mode,
      outDir: outDir,
      mapPath: mapPath,
      mapPathInjected: injected !== null,
      mapLoaded: loaded.ok,
      // M5C-2：键一致性诊断在此路径同样可见（仅诊断，不改变状态与退出码）。
      warnings: (loaded.warnings || []),
      records: 0,
      note: '映射已成功读取并通过第 1–5 步校验；但记录生成链路（记录来源解析、写出与发布）仍未实现（C1 授权边界）；注入 records 时可在内存完成 §5.6.5.6 解析'
    },
    violations: [
      {
        code: CODE.SKELETON,
        message: '记录级生成流程尚未实现（映射读取已打通，本轮不实现完整生成器）'
      }
    ],
    blockers: []
  };
}

// ── L1–L7 纯函数层（P2，2026-10-24）──────────────────────────────────
// 依据契约：§2.1（S1–S4 形态）、§2.2（价格六形态）、§2.3（跳过段）、§3.1（签名）、
// §3.3（记录结构）、§4.1–4.3（三判定与 C17–C20）、§5.4（source_detail 模板）、
// §6.1（R1–R8 展开）、§6.2/§6.2.1（条数与口径）、§6.3（阻塞分类）。
// 全部无 IO：不接受路径、不读文件、不写文件。
const ENUM = Object.freeze({
  generation: Object.freeze(['generated', 'not_generated']),
  evidence: Object.freeze(['traceable', 'missing_original', 'unclear_source']),
  eligibility: Object.freeze(['blocked', 'candidate_only'])
});
const ID_STATUS = Object.freeze(['assigned_from_map', 'planned_from_roster', 'assigned_new', 'unassigned']);
const TIERS = Object.freeze(['A', 'B', 'C']);
const ERR = Object.freeze({
  E2: 'E2_UNKNOWN_TABLE',
  E3: 'E3_ENUM',
  E4: 'E4_PRICE_UNPARSABLE',
  E6: 'E6_EVIDENCE',
  E9: 'E9_SUM',
  E11: 'E11_UNEXPECTED_ELIGIBLE'
});
// §2.3：不得作为记录源的段落（按标题关键词识别，命中即整段跳过并计数）
const SKIP_TITLE_RE = /名册|拍到的|待确认|裁决|口径|证据缺口|source_detail\s*规则|统计口径/;

function pureError(code, message, extra) {
  const e = new Error(code + '：' + message);
  e.code = code;
  if (extra) { Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); }
  return e;
}
function stripMd(s) { return String(s == null ? '' : s).replace(/\*\*/g, '').trim(); }

// L1 解析：按 ## / ### 切段；识别表格并记录行号；未知形态进 unparsable（不中断）
function parseDoc(text, meta) {
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  const sections = [];
  const tables = [];
  const unparsable = [];
  let skipped = 0;
  let curSection = '';
  let curSkip = false;

  function isRow(l) { return /^\s*\|/.test(l); }
  function isSep(l) { return /^\s*\|?[\s:\-|]+\|?\s*$/.test(l) && l.indexOf('-') >= 0; }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      curSection = h[2].trim();
      curSkip = SKIP_TITLE_RE.test(curSection);
      sections.push({ level: h[1].length, title: curSection, line: i + 1 });
      if (curSkip) { skipped += 1; }
      continue;
    }
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        if (!isRow(lines[j])) { break; }
        if (isSep(lines[j])) { continue; }
        rows.push({ cells: splitRow(lines[j]), line: j + 1 });
      }
      const table = {
        section: curSection,
        sectionSkipped: curSkip,
        header: header,
        rows: rows,
        startLine: i + 1,
        headerLine: i + 1,
        endLine: j
      };
      let kind = null;
      try { kind = classifyTable(table); } catch (e) { unparsable.push({ table: table, code: e.code, message: e.message }); }
      table.kind = kind;
      tables.push(table);
      i = j - 1;
    }
  }
  return { sections: sections, tables: tables, skipped: skipped, unparsable: unparsable, meta: meta || null };
}

function splitRow(line) {
  let s = String(line).trim();
  if (s.charAt(0) === '|') { s = s.slice(1); }
  if (s.charAt(s.length - 1) === '|') { s = s.slice(0, -1); }
  return s.split('|').map(function (c) { return c.trim(); });
}

// L2 归类：S1/S2/S3/S4/EXCL；未知 → E2_UNKNOWN_TABLE
function classifyTable(table) {
  const h = (table.header || []).map(stripMd);
  const joined = h.join('|');
  if (h.length < 2) { throw pureError(ERR.E2, '列数不足：' + joined); }
  if (/位次|名册|档口编号/.test(joined)) { return 'EXCL'; }
  if (/待确认|问题.*状态|状态.*解除条件/.test(joined)) { return 'EXCL'; }
  if (/套餐/.test(joined)) { return 'EXCL'; }
  // W2-03 双拼组合表（§6.1.1 类比）：四列且首列「拼法/组合」、次列「价格」
  if (h.length >= 3 && /双拼组成/.test(h[1]) && /价格/.test(h[2])) { return 'S5_COMBO'; }
  if (h.length === 3 && /小碗/.test(h[1]) && /大碗/.test(h[2])) { return 'S2'; }
  if (h.length === 3 && /小份/.test(h[1]) && /大份/.test(h[2])) { return 'S2'; }
  if (/口味/.test(h[0])) {
    if (h.slice(1).some(function (x) { return /炒饼|炒面|炒饭/.test(x); })) { return 'S3'; }
    if (h.slice(1).some(function (x) { return /米线|牛筋面|土豆粉/.test(x); })) { return 'S4'; }
  }
  if (h.length === 2 && (/菜品/.test(h[0]) || /^价格$/.test(h[1]) || /项目/.test(h[0]))) { return 'S1'; }
  throw pureError(ERR.E2, '未知表形态：' + joined, { header: h });
}

// §2.2 价格六形态：返回 [{price, specLabel}] 或 null（不可解析）
function parsePriceCell(cell) {
  const s = stripMd(cell);
  if (!/\d/.test(s)) { return null; }
  const ladder = /^(\d+(?:\.\d+)?)\s*元?[^（(]*[（(]\s*2\s*个\s*(\d+(?:\.\d+)?)\s*元?[，,、]\s*3\s*个\s*(\d+(?:\.\d+)?)\s*元?[）)]/.exec(s);
  if (ladder) {
    return [
      { price: Number(ladder[1]), specLabel: '1 个' },
      { price: Number(ladder[2]), specLabel: '2 个' },
      { price: Number(ladder[3]), specLabel: '3 个' }
    ];
  }
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  if (!m) { return null; }
  const spec = /[（(]\s*(小份|大份|小碗|大碗)\s*[）)]/.exec(s);
  return [{ price: Number(m[1]), specLabel: spec ? spec[1] : '' }];
}

// R6 例外（契约 §6.1.1，2026-10-25 裁决）：西雅苏套餐表的**表级白名单**。
// 识别只依据「文件 + 档口编号 + 表头精确匹配」，不得以菜名、楼层或价格范围推定其他表适用。
const R6_PACKAGE_WHITELIST = Object.freeze([
  Object.freeze({ file: 'TRANSCRIPTION_2F.md', shot: 'W2-08', header: Object.freeze(['套餐', '价格']) })
]);
// 套餐 `foodType` 映射：只在牌面名称给出主食类型时生效；无依据不得猜测。
const PACKAGE_FOODTYPE_RULES = Object.freeze([
  Object.freeze({ re: /炒米粉/, foodType: 'rice_vermicelli' })
]);

function isWhitelistedPackageTable(table, file) {
  const h = (table.header || []).map(stripMd);
  return R6_PACKAGE_WHITELIST.some(function (w) {
    if (w.file !== file) { return false; }
    if (h.length !== w.header.length) { return false; }
    for (let i = 0; i < h.length; i += 1) { if (h[i] !== w.header[i]) { return false; } }
    return new RegExp('\\b' + w.shot + '\\b').test(String(table.section || ''));
  });
}

function packageFoodTypeOf(name) {
  for (let i = 0; i < PACKAGE_FOODTYPE_RULES.length; i += 1) {
    if (PACKAGE_FOODTYPE_RULES[i].re.test(String(name))) { return PACKAGE_FOODTYPE_RULES[i].foodType; }
  }
  return null;
}

// 只对白名单表调用：按牌面名称逐行生成单条记录，不拆组件、不合并、不改名。
function expandPackageTable(table, ctx) {
  const c = ctx || {};
  const sink = c.blockers || [];
  const stallId = c.stallId || '';
  const prefix = c.prefix || '';
  const out = [];
  (table.rows || []).forEach(function (row) {
    const cells = (row.cells || []).map(stripMd);
    const raw = '| ' + cells.join(' | ') + ' |';
    const name = cells[0];
    if (!name) {
      sink.push({ code: 'RAW_SOURCE_MISSING', line: row.line, raw: raw, note: '首列原文为空，无法保留 rawGroupKey（不得猜测，不生成记录）' });
      return;
    }
    const parsed = parsePriceCell(cells[1]);
    if (!parsed || parsed.length !== 1) {
      sink.push({ code: 'PACKAGE_PRICE_NOT_SINGLE', line: row.line, raw: raw, note: '套餐例外要求单一整份价；阶梯价/双价/不可解析不构成例外（§6.1.1）' });
      return;
    }
    const ft = packageFoodTypeOf(name);
    if (!ft) {
      sink.push({ code: 'BLOCKED_NO_FOODTYPE', line: row.line, raw: raw, note: '牌面无主食类型依据，不得猜测；foodType 保持 null（§6.1.1）' });
    }
    out.push({
      id: null,
      shopId: c.shopId || null,
      stallId: stallId || null,
      name: name,
      price: parsed[0].price,
      foodType: ft,
      tastes: [],
      source: { kind: 'field', detail: '', ref: '' },
      verifyStatus: 'unverified',
      verifiedAt: null,
      note: '',
      gen: {
        tier: null,
        groupKey: prefix + name,
        rawGroupKey: name,
        specLabel: '',
        rawRow: raw,
        sourceLine: row.line,
        generation_status: 'generated',
        evidence_status: 'traceable',
        import_eligibility: 'blocked',
        blockers: ft ? [] : ['BLOCKED_NO_FOODTYPE']
      }
    });
  });
  return out;
}

const COL_FOODTYPE = Object.freeze({
  炒饼: 'snack', 炒面: 'noodle', 炒饭: 'rice',
  米线: 'rice_vermicelli', 砂锅米线: 'rice_vermicelli', 牛筋面: 'noodle', 土豆粉: 'other'
});

// L3 展开：R1–R8；价格不可解析 → 进 ctx.blockers，不产出记录
function expandTable(table, ctx) {
  const c = ctx || {};
  const sink = c.blockers || [];
  const stallId = c.stallId || '';
  const prefix = c.prefix || '';
  const kind = table.kind || classifyTable(table);
  const out = [];
  if (kind === 'EXCL') { return out; }
  const header = (table.header || []).map(stripMd);
  // W2-03「特色小吃」：名单内 8 项为加料，转 addons[]（不进 records、不占号）
  const ADDON_NAMES = ['鸡腿', '狮子头', '甜辣鸭腿', '烤肠', '虎皮卷', '卤水豆腐', '虎皮蛋', '煎蛋'];
  const addonSink = c.addons || null;
  function emitAddon(name, price, rawRow, line) {
    if (!addonSink) { return; }
    addonSink.push({
      sourceFile: c.sourceFile || '', sourceLine: line, stallId: stallId || null,
      name: name, price: price, sourceKind: 'field', verifyStatus: 'unverified',
      appliesTo: null, appliesToStatus: 'unknown', rawRow: rawRow
    });
  }

  function baseRecord(name, price, specLabel, rawRow, line, foodType) {
    return {
      id: null,
      shopId: c.shopId || null,
      stallId: stallId || null,
      name: name,
      price: price,
      foodType: foodType || null,
      tastes: [],
      source: { kind: 'field', detail: '', ref: '' },
      verifyStatus: 'unverified',
      verifiedAt: null,
      note: '',
      gen: {
        tier: null,
        // M5C-1（契约 §3.1 L3 记录形状 / §5.6.5.5.4.2）：原文与规范化值分离保存。
        // groupKey 保持既有「层前缀 + 原文」形态（§3.3 依它分层）；rawGroupKey 存不含前缀的牌面原文。
        // 两者都不得被规范化回写；只有构造映射键时才做 NFKC / 空白折叠 / 去首尾标点（R1–R8）。
        groupKey: prefix + name,
        rawGroupKey: name,
        specLabel: specLabel || '',
        rawRow: rawRow,
        sourceLine: line,
        generation_status: 'generated',
        evidence_status: 'traceable',
        import_eligibility: 'blocked',
        blockers: []
      }
    };
  }
  function emit(rec, row) { out.push(rec); void row; }

  table.rows.forEach(function (row) {
    const cells = row.cells.map(stripMd);
    const raw = '| ' + cells.join(' | ') + ' |';
    const first = cells[0];
    // M5C-1：stripMd 已 trim，首列为空即「原文缺失」。不得静默填充/猜测，
    // 显式记为阻塞项并跳过该行，不产出带空原文的记录。
    if (!first) {
      sink.push({ code: 'RAW_SOURCE_MISSING', line: row.line, raw: raw, note: '首列原文为空，无法保留 rawGroupKey（不得猜测，不生成记录）' });
      return;
    }
    // R6：自选组合整行不录
    if (/选\s*\d|任选|X\s*选/.test(first)) {
      sink.push({ code: 'R6_SELF_SELECT', line: row.line, raw: raw, note: '自选组合，整行不录（§6.1 R6）' });
      return;
    }
    // R7：免费项只录主品 → 只跳过「锅底/免费」这类附赠行
    if (/锅底|免费/.test(first) && !/\d/.test(first)) {
      sink.push({ code: 'R7_FREE_OPTION', line: row.line, raw: raw, note: '免费可选项，只录主品（§6.1 R7）' });
      return;
    }
    // R8：加料区（首列以 + 开头，或表头含「加料」）
    if (/^\+/.test(first) || /加料/.test(header.join('|'))) {
      sink.push({ code: 'R8_ADD_ON', line: row.line, raw: raw, note: '加料区整行不录（§6.1 R8）' });
      return;
    }

    if (kind === 'S1' && c.stallId === 'c01_t11' && ADDON_NAMES.indexOf(first) >= 0) {
      const pa = parsePriceCell(cells[1]);
      if (!pa || pa.length !== 1) {
        sink.push({ code: ERR.E4, line: row.line, raw: cells[1] === undefined ? '' : cells[1], note: '加料价格不可解析（§2.2）' });
        return;
      }
      emitAddon(first, pa[0].price, raw, row.line);
      return;
    }
    if (kind === 'S1') {
      const parsed = parsePriceCell(cells[1]);
      if (!parsed) {
        sink.push({ code: ERR.E4, line: row.line, raw: cells[1] === undefined ? '' : cells[1], note: '价格不可解析，硬失败（§2.2）' });
        return;
      }
      parsed.forEach(function (p) { emit(baseRecord(first, p.price, p.specLabel, raw, row.line, null), row); });
      return;
    }
    if (kind === 'S5_COMBO') {
      // 表头形如 `# | 双拼组成 | 价格 | 备注`：名称在第 2 列、价格在第 3 列
      const composed = stripMd(cells[1] || '').replace(/^公瑾爆蛋\s*\+\s*/, '');
      const pc = parsePriceCell(cells[2]);
      if (!composed || !pc || pc.length !== 1) {
        sink.push({ code: ERR.E4, line: row.line, raw: cells[2] === undefined ? '' : cells[2], note: '双拼价格不可解析（§2.2）' });
        return;
      }
      // 命名沿用 §6.1.1 类约定：整体为一个商品，不拆组件（不生成「公瑾爆蛋」单条）
      emit(baseRecord('双拼饭（公瑾爆蛋 + ' + composed + '）', pc[0].price, '', raw, row.line, 'rice'), row);
      return;
    }
    if (kind === 'S2') {
      // R5 收紧（2026-10-25）：只有 §6.1 R5 明确授权的档口才按规格拆条。
      // 未授权档口（如 W2-05）即使表头是「小份/大份」，也按单条记录计，价格取第一列（小份），
      // 并在 problems 中登记未记录的另一档价格，供人工复核；不得静默丢价，也不得自动拆条。
      const r5Authorized = R5_SPEC_STALLS.indexOf(c.stallId) >= 0;
      if (!r5Authorized) {
        const p1 = parsePriceCell(cells[1]);
        const p2 = parsePriceCell(cells[2]);
        if (!p1) {
          sink.push({ code: ERR.E4, line: row.line, raw: cells[1] === undefined ? '' : cells[1], note: '价格不可解析，硬失败（§2.2）' });
          return;
        }
        // 单条记录：价格取第一列（小份/小碗）。另一列价格不写入记录，但必须留痕，供人工复核。
        emit(baseRecord(first, p1[0].price, '', raw, row.line, null), row);
        if (!p2) {
          sink.push({
            code: ERR.E4, line: row.line, raw: cells[2] === undefined ? '' : cells[2],
            note: '「' + (header[2] || '第二列') + '」价格不可解析（§2.2）：本条只记录「'
              + (header[1] || '第一列') + '」' + p1[0].price + '（R5 未授权拆条）'
          });
        } else {
          sink.push({
            code: 'R5_SPEC_NOT_AUTHORIZED', line: row.line, raw: raw,
            note: '档口未列入 §6.1 R5 授权清单：按单条记录计（价格取「' + (header[1] || '第一列')
              + '」' + p1[0].price + '），「' + (header[2] || '第二列') + '」' + p2[0].price + ' 未记录'
          });
        }
        return;
      }
      for (let k = 1; k <= 2; k += 1) {
        const parsed = parsePriceCell(cells[k]);
        if (!parsed) {
          sink.push({ code: ERR.E4, line: row.line, raw: cells[k] === undefined ? '' : cells[k], note: '价格不可解析，硬失败（§2.2）' });
          return;
        }
        emit(baseRecord(first, parsed[0].price, header[k] || parsed[0].specLabel, raw, row.line, null), row);
      }
      return;
    }
    if (kind === 'S3' || kind === 'S4') {
      for (let k = 1; k < header.length; k += 1) {
        const col = header[k];
        const parsed = parsePriceCell(cells[k]);
        if (!parsed) {
          sink.push({ code: ERR.E4, line: row.line, raw: cells[k] === undefined ? '' : cells[k], note: '价格不可解析，硬失败（§2.2）' });
          return;
        }
        const name = first + col;
        emit(baseRecord(name, parsed[0].price, col, raw, row.line, COL_FOODTYPE[col] || null), row);
      }
    }
  });
  return out;
}

// L4 证据：§5.4 模板；幂等；缺照片序号且非「无原图」→ E6
function buildSourceDetail(record, ctx) {
  const c = ctx || {};
  const gen = (record && record.gen) || {};
  const rawText = c.rawText || gen.rawRow || '';
  const groupNote = c.groupNote || '';
  const photoSeq = c.photoSeq;
  const noOriginal = c.noOriginal === true;
  if (!noOriginal && (photoSeq === undefined || photoSeq === null || photoSeq === '')) {
    throw pureError(ERR.E6, '缺照片序号且未声明「无原图」', { sourceLine: gen.sourceLine });
  }
  const head = noOriginal ? '现场抄录（无原图）' : ('现场拍摄价目表（第 ' + photoSeq + ' 张）');
  const text = head + '：' + rawText + (groupNote ? '　' + groupNote : '');
  return text;
}

function checkEnum(kind, value) {
  const list = ENUM[kind];
  if (list.indexOf(value) < 0) { throw pureError(ERR.E3, kind + ' 枚举非法：' + String(value)); }
  return value;
}

// L5 三判定（互不推导）
function judgeGeneration(record, ctx) {
  void ctx;
  const g = (record && record.gen) || {};
  const value = g.generation_status === undefined ? 'generated' : g.generation_status;
  return checkEnum('generation', value);
}
function judgeEvidence(record, ctx) {
  void ctx;
  const g = (record && record.gen) || {};
  const value = g.evidence_status === undefined ? 'traceable' : g.evidence_status;
  return checkEnum('evidence', value);
}
function judgeEligibility(record, ctx) {
  void ctx;
  const g = (record && record.gen) || {};
  const value = g.import_eligibility === undefined ? 'blocked' : g.import_eligibility;
  return checkEnum('eligibility', value);
}

// L6 汇总：{total, A, B, C, perStall}；不闭合 → E9
function summarize(records) {
  const list = records || [];
  const out = { total: list.length, A: 0, B: 0, C: 0, perStall: {}, noSource: 0,
    f2: { total: 0, A: 0, B: 0, C: 0 }, f3: { total: 0, A: 0, B: 0, C: 0 } };
  list.forEach(function (r) {
    const g = (r && r.gen) || {};
    const tier = g.tier;
    if (TIERS.indexOf(tier) >= 0) { out[tier] += 1; }
    else { throw pureError(ERR.E3, 'tier 缺失或非法：' + String(tier), { record: (r && r.name) || '' }); }
    const sid = r.stallId || '';
    out.perStall[sid] = (out.perStall[sid] || 0) + 1;
    // 分层归属：gen.groupKey 形如 `f2/<窗口>/<组>`（§3.3 示例）。无法归属即计入 noSource，由 S3 明确失败。
    const layer = String(g.groupKey || '').split('/')[0];
    if (BY_SOURCE.indexOf(layer) >= 0) {
      out[layer].total += 1;
      out[layer][tier] += 1;
    } else {
      out.noSource += 1;
    }
  });
  if (out.A + out.B + out.C !== out.total) {
    throw pureError(ERR.E9, '三元账不闭合：A+B+C=' + (out.A + out.B + out.C) + ' total=' + out.total);
  }
  return out;
}

// L7 校验：C17–C20 + 条数断言（§10.7 纪律：其余编号不得作为判据）
function assertContract(records, summary) {
  const list = records || [];
  const violations = [];
  function push(code, message, extra) {
    const v = { code: code, message: message };
    if (extra) { Object.keys(extra).forEach(function (k) { v[k] = extra[k]; }); }
    violations.push(v);
  }
  let candidateOnly = 0;
  list.forEach(function (r) {
    const g = (r && r.gen) || {};
    // C17：只允许 blocked / candidate_only
    if (ENUM.eligibility.indexOf(g.import_eligibility) < 0) {
      push('C17', '导入资格出现非法值：' + String(g.import_eligibility), { record: r.name });
    }
    if (g.import_eligibility === 'candidate_only') { candidateOnly += 1; }
    // C18：id_status='unassigned' ⇔ id===null；id===null ⇒ blocked
    const unassigned = g.id_status === 'unassigned';
    const isNull = r.id === null;
    if (unassigned !== isNull) {
      push('C18', 'id_status 与 id 不一致', { record: r.name, id_status: g.id_status, id: r.id });
    }
    if (isNull && g.import_eligibility !== 'blocked') {
      push('C18', 'id 为 null 但导入资格不是 blocked', { record: r.name });
    }
    // C18 第 3 类：planned_from_roster 仅表示「ID 身份由契约名册区间确定」，不得获得导入资格
    if (g.id_status === 'planned_from_roster' && g.import_eligibility !== 'blocked') {
      push('C18', 'planned_from_roster 不得具备导入资格（名册规划 ≠ 正式分配 ≠ 可发布）', { record: r.name, eligibility: g.import_eligibility });
    }
    if (ID_STATUS.indexOf(g.id_status) < 0) {
      push('C18', 'id_status 枚举非法：' + String(g.id_status), { record: r.name });
    }
  });
  // C19：当前阶段 candidate_only 必须为 0
  if (candidateOnly > 0) {
    push(ERR.E11, 'candidate_only 条数应为 0，实际 ' + candidateOnly + '（放行须来自显式阻塞解除裁决）');
  }
  // 条数断言：summary 与记录一致且闭合
  const s = summary || {};
  if (s.total !== list.length || s.A + s.B + s.C !== s.total) {
    push(ERR.E9, '汇总与记录不一致：summary.total=' + String(s.total) + ' records=' + list.length);
  }
  return violations;
}

// ── L8 输出层（P3 阶段一，2026-10-24）────────────────────────────────
// 依据：§3.3（records.json 结构）、§3.4（blockers 结构：一条记录一条 entry、
// count===entries.length、禁时间字段）、§7.2.2 第 6/8 条（manifest 恰 5 字段、
// counts 结构）、§7.2.8（哈希与计数口径）、§4.2（A/B/C、C 档不进 records）、
// §4.3（C17–C20）。本轮只做内存构建 + 结构校验 + 序列化准备（含 SHA-256）；
// 不写盘、不实现 P1（目录 rename / PUBLISHING / 回滚），不产出正式产物。
// 注：下列 `L8_*` 是**内部断言标签**，不是契约错误码，也不会写入任何产物。
const crypto = require('crypto');
const SCHEMA_VERSION = 1;
const MANIFEST_FIELDS = Object.freeze(['schemaVersion', 'counts', 'recordsSha256', 'blockersSha256', 'publishedAt']);
const MANIFEST_COUNT_KEYS = Object.freeze(['records', 'blockers', 'A', 'B', 'C']);

// 4.1：tier 未赋值/非法必须显式失败，不得静默当作 C
function assertTierAssigned(records) {
  (records || []).forEach(function (r) {
    const g = (r && r.gen) || {};
    if (TIERS.indexOf(g.tier) < 0) {
      throw pureError(ERR.E3, 'tier 缺失或非法：' + String(g.tier), { record: (r && r.name) || '' });
    }
  });
}

// 4.1/4.2：C 档不进 records.json；过滤只看 tier，绝不看 id 或 import_eligibility
function selectRecordsForOutput(records) {
  return (records || []).filter(function (r) { return r.gen.tier !== 'C'; });
}

function blockerKindOf(record) {
  const g = record.gen || {};
  if (g.tier === 'C') { return 'not_generated'; }
  if (record.id === null) { return 'id_unassigned'; }
  if (g.evidence_status !== 'traceable') { return 'evidence_gap'; }
  return 'blocked_by_decision';
}

// §3.4：一条待阻塞记录一条 entry，多原因进 reasons
function buildBlockerList(records) {
  const entries = [];
  (records || []).forEach(function (r) {
    const g = r.gen || {};
    if (g.import_eligibility !== 'blocked') { return; }
    const reasons = [];
    (g.blockers || []).forEach(function (x) { if (reasons.indexOf(x) < 0) { reasons.push(x); } });
    if (g.tier === 'C' && reasons.indexOf('TIER_C') < 0) { reasons.push('TIER_C'); }
    if (r.id === null && reasons.indexOf('ID_UNASSIGNED') < 0) { reasons.push('ID_UNASSIGNED'); }
    if (g.evidence_status !== 'traceable' && reasons.indexOf('EVIDENCE_GAP') < 0) { reasons.push('EVIDENCE_GAP'); }
    entries.push({
      // 契约 §5.6.5.5：四段键 stallId|groupKey|specLabel|disambiguator（2026-10-25 修正：原实现漏第 4 段，
      // 导致已消歧记录（W2-03 组合系列）在 blockers 中键塌缩、S2 误报 E14_DUP_KEY）
      recordKey: String(r.stallId || '') + '|' + String(g.groupKey || '') + '|' + String(g.specLabel || '') + '|' + String(g.disambiguator || ''),
      stallId: r.stallId === undefined ? null : r.stallId,
      name: r.name,
      tier: g.tier,
      sourceLine: g.sourceLine === undefined ? null : g.sourceLine,
      rawRow: g.rawRow === undefined ? '' : g.rawRow,
      kind: blockerKindOf(r),
      reasons: reasons
    });
  });
  return { schemaVersion: SCHEMA_VERSION, count: entries.length, entries: entries };
}

// §7.2.8：UTF-8 无 BOM、不转换换行、保留末尾换行；哈希对最终字节
function serializeJson(value) { return JSON.stringify(value, null, 2) + '\n'; }
function sha256Hex(text) { return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'); }

function validateOutputShape(recordsDoc, blockersDoc, manifest) {
  const out = [];
  if (blockersDoc.count !== blockersDoc.entries.length) {
    out.push({ code: 'L8_BLOCKERS_COUNT', message: 'count 与 entries.length 不一致' });
  }
  ['generatedAt', 'createdAt', 'updatedAt'].forEach(function (k) {
    blockersDoc.entries.forEach(function (e) {
      if (Object.prototype.hasOwnProperty.call(e, k)) {
        out.push({ code: 'L8_BLOCKERS_TIME_FIELD', message: 'blockers entry 出现时间字段 ' + k });
      }
    });
  });
  const keys = Object.keys(manifest);
  if (keys.length !== MANIFEST_FIELDS.length || MANIFEST_FIELDS.some(function (k) { return keys.indexOf(k) < 0; })) {
    out.push({ code: 'L8_MANIFEST_FIELDS', message: 'manifest 字段集合必须恰为 5 个，实际=' + keys.join(',') });
  }
  const ck = Object.keys(manifest.counts || {});
  if (ck.length !== MANIFEST_COUNT_KEYS.length || MANIFEST_COUNT_KEYS.some(function (k) { return ck.indexOf(k) < 0; })) {
    out.push({ code: 'L8_MANIFEST_COUNTS_FIELDS', message: 'counts 字段集合必须恰为 5 个，实际=' + ck.join(',') });
  }
  const mc = manifest.counts || {};
  const rc = (recordsDoc.meta || {}).counts || {};
  ['A', 'B', 'C'].forEach(function (k) {
    if (mc[k] !== rc[k]) { out.push({ code: 'L8_COUNTS_MISMATCH', message: 'manifest.counts.' + k + ' ≠ records.meta.counts.' + k }); }
  });
  if (mc.records !== recordsDoc.records.length) {
    out.push({ code: 'L8_COUNTS_RECORDS', message: 'manifest.counts.records ≠ records.length' });
  }
  if (mc.blockers !== blockersDoc.entries.length) {
    out.push({ code: 'L8_COUNTS_BLOCKERS', message: 'manifest.counts.blockers ≠ entries.length' });
  }
  recordsDoc.records.forEach(function (r) {
    if (r.gen && r.gen.tier === 'C') { out.push({ code: 'L8_C_TIER_IN_OUTPUT', message: 'C 档记录进入 records.json：' + r.name }); }
  });
  return out;
}

function resolveBaseline(testBaseline) {
  if (testBaseline === undefined || testBaseline === null) { return PROD_BASELINE; }
  if (typeof testBaseline !== 'object') { throw pureError('E29_PARAM_CONFLICT', 'testBaseline 必须是对象'); }
  const out = {};
  for (const k of TEST_BASELINE_KEYS) {
    if (typeof testBaseline[k] !== 'number' || !isFinite(testBaseline[k])) {
      throw pureError('E29_PARAM_CONFLICT', 'testBaseline.' + k + ' 必须是有限数字');
    }
    out[k] = testBaseline[k];
  }
  // 任务 A：测试基准必须同时声明 f2/f3，否则可用「只给总数」绕过分层校验。
  for (const layer of TEST_BASELINE_LAYERS) {
    const v = testBaseline[layer];
    if (!v || typeof v !== 'object') { throw pureError('E29_PARAM_CONFLICT', 'testBaseline.' + layer + ' 必须是对象（含 total/A/B/C）'); }
    out[layer] = {};
    for (const k of TEST_BASELINE_KEYS) {
      if (typeof v[k] !== 'number' || !isFinite(v[k])) {
        throw pureError('E29_PARAM_CONFLICT', 'testBaseline.' + layer + '.' + k + ' 必须是有限数字');
      }
      out[layer][k] = v[k];
    }
  }
  return out;
}

function assertFaults(faults) {
  const f = faults || {};
  Object.keys(f).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(FAULT_ENUM, k)) {
      throw pureError('E29_PARAM_CONFLICT', '未登记的故障注入项：' + k);
    }
    const allowed = FAULT_ENUM[k];
    if (allowed && allowed.indexOf(f[k]) < 0) {
      throw pureError('E29_PARAM_CONFLICT', '故障注入项 ' + k + ' 的取值非法：' + String(f[k]));
    }
  });
}

// **测试专用故障注入**（P3 补强，2026-10-24）：仅当调用方显式传入 `opts.faults` 时生效，
// 用于让 L8 结构校验的负例被真实触发。CLI 不可达；不传即完全无效；不写盘、不进正式产物。
function applyFaults(recordsDoc, blockersDoc, manifest, faults, summary) {
  const f = faults || {};
  assertFaults(f);
  function pushRecord(rec, tier) {
    const t = tier || 'A';
    recordsDoc.records.push(rec);
    recordsDoc.meta.counts.total += 1;
    recordsDoc.meta.counts[t] = (recordsDoc.meta.counts[t] || 0) + 1;
    manifest.counts.records += 1;
    manifest.counts[t] = (manifest.counts[t] || 0) + 1;
    // 注入记录按 f2 合成数据归属，使分层基准与总数保持一致（仅测试通道可达）。
    if (summary && summary.f2) { summary.f2.total += 1; summary.f2[t] = (summary.f2[t] || 0) + 1; }
  }
  if (f.s4 === 'id_status_mismatch') {
    pushRecord({ id: 'FAULT-DUP-ID', name: '注入-映射不一致', price: 1, foodType: 'snack',
      id_status: 'unassigned', import_eligibility: 'blocked', gen: { tier: 'A', groupKey: 'f2/注入-映射不一致' } }, 'A');
  }
  if (f.s5 === 'c_tier') {
    pushRecord({ id: null, name: '注入-C档', price: 1, foodType: 'snack',
      id_status: 'unassigned', import_eligibility: 'blocked', gen: { tier: 'C', groupKey: 'f2/注入-C档' } }, 'C');
  }
  if (f.s5 === 'candidate_only') {
    pushRecord({ id: null, name: '注入-候选', price: 1, foodType: 'snack',
      id_status: 'unassigned', import_eligibility: 'blocked', gen: { tier: 'A', import_eligibility: 'candidate_only', groupKey: 'f2/注入-候选' } }, 'A');
  }
  if (f.manifestDrop) { delete manifest[f.manifestDrop]; }
  if (f.manifestAdd) { manifest[f.manifestAdd] = 'fault-injected'; }
  if (f.countsDrop) { delete manifest.counts[f.countsDrop]; }
  if (f.countsAdd) { manifest.counts[f.countsAdd] = 0; }
  if (typeof f.blockersCountDelta === 'number') { blockersDoc.count += f.blockersCountDelta; }
  if (f.manifestCountsDelta) {
    Object.keys(f.manifestCountsDelta).forEach(function (k) {
      manifest.counts[k] = (manifest.counts[k] || 0) + f.manifestCountsDelta[k];
    });
  }
  return { recordsDoc: recordsDoc, blockersDoc: blockersDoc, manifest: manifest };
}

// L8 主入口：同一份内存结果产出三份文档，避免重复计算导致计数漂移
function buildOutputs(records, opts) {
  const options = opts || {};
  const list = records || [];
  assertTierAssigned(list);
  const summary = summarize(list);
  const violations = assertContract(list, summary);
  const kept = selectRecordsForOutput(list);
  const blockersDoc = buildBlockerList(list);
  const recordsDoc = {
    meta: {
      generatedBy: 'gen_records',
      contractVersion: options.contractVersion || '2026-10-23',
      sources: options.sources || {},
      counts: { total: summary.total, A: summary.A, B: summary.B, C: summary.C }
    },
    records: kept
  };
  let recordsText = serializeJson(recordsDoc);
  let blockersText = serializeJson(blockersDoc);
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    counts: { records: kept.length, blockers: blockersDoc.count, A: summary.A, B: summary.B, C: summary.C },
    recordsSha256: sha256Hex(recordsText),
    blockersSha256: sha256Hex(blockersText),
    publishedAt: null
  };
  // 故障注入只影响内存副本与本次断言，且在校验之前施加（负例因此可被真实拒绝）。
  if (options.faults) {
    applyFaults(recordsDoc, blockersDoc, manifest, options.faults, summary);
    recordsText = serializeJson(recordsDoc);
    blockersText = serializeJson(blockersDoc);
    manifest.recordsSha256 = sha256Hex(recordsText);
    manifest.blockersSha256 = sha256Hex(blockersText);
  }
  return {
    recordsDoc: recordsDoc,
    blockersDoc: blockersDoc,
    manifest: manifest,
    recordsText: recordsText,
    blockersText: blockersText,
    summary: summary,
    violations: violations.concat(validateOutputShape(recordsDoc, blockersDoc, manifest))
  };
}

// ── P1 安全发布链路（§7.2.1 S1–S10，2026-10-24）──────────────────────
// 依据：§7.2.1（十阶段）、§7.2.2（保证/不保证）、§7.2.3（PUBLISHING 与 E17）、
// §7.2.4（EXDEV 不得降级）、§7.2.5（诊断保留/清理）、§7.2.6（--out 安全）、
// §7.2.7（人工修复边界）、§7.2.8（哈希字节口径）。
// 边界：不做多文件事务（§7.2.2 第 1 条只保证单次 rename 的可见性）。
const PROTECTED_OUT_TOP = Object.freeze(['data', 'pages', 'utils', 'cloudfunctions', 'config', 'tools']);
const MARKER = 'PUBLISHING';
// 任务 A：只有完成 S10 全部复核的目录才写入本标记；读侧必须见到它才接受。
const COMMITTED = 'COMMITTED';
const OUT_FILES = Object.freeze(['records.json', 'records_blockers.json', 'gen-manifest.json']);

// §7.2.6 + §3.5：语法全过之后才做路径检查；拒绝受保护目录/项目根/已存在目标
function assertSafeOutDir(outDir, repoRoot) {
  const abs = path.resolve(outDir);
  const root = path.resolve(repoRoot);
  if (abs === root) { return { ok: false, code: 'E28_OUT_REFUSED', message: '--out 不得指向项目根目录' }; }
  const rel = path.relative(root, abs);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    const top = rel.split(path.sep)[0];
    if (PROTECTED_OUT_TOP.indexOf(top) >= 0) {
      return { ok: false, code: 'E28_OUT_REFUSED', message: '--out 指向受保护目录：' + top };
    }
    const second = rel.split(path.sep).slice(0, 2).join('/');
    if (second === 'tools/templates' || second === 'tools/pilot') {
      return { ok: false, code: 'E28_OUT_REFUSED', message: '--out 指向受保护目录：' + second };
    }
  }
  return { ok: true };
}

// §7.2.3 读侧：缺 manifest、含 PUBLISHING 或**缺完成标记** → E17
function inspectPublished(dir) {
  const abs = path.resolve(dir);
  const reasons = [];
  if (!fs.existsSync(abs)) { return { complete: false, code: 'E17_INCOMPLETE_PUBLISH', reasons: ['目录不存在'] }; }
  const texts = {};
  for (const f of OUT_FILES) {
    const p = path.join(abs, f);
    if (!fs.existsSync(p)) { reasons.push('缺 ' + f); continue; }
    try { texts[f] = fs.readFileSync(p, 'utf8'); } catch (e) {
      reasons.push(f + ' 不可读取（' + String((e && e.code) || (e && e.message) || e) + '）');
    }
  }
  if (fs.existsSync(path.join(abs, MARKER))) { reasons.push('含 PUBLISHING 标记'); }
  if (!fs.existsSync(path.join(abs, COMMITTED))) { reasons.push('缺 COMMITTED 完成标记（未通过 S10 复核）'); }
  if (reasons.length === 0) {
    let mt = null;
    try { mt = JSON.parse(texts['gen-manifest.json']); } catch (e) { reasons.push('gen-manifest.json 不是合法 JSON'); }
    try { JSON.parse(texts['records.json']); } catch (e) { reasons.push('records.json 不是合法 JSON'); }
    try { JSON.parse(texts['records_blockers.json']); } catch (e) { reasons.push('records_blockers.json 不是合法 JSON'); }
    if (mt) {
      const keys = Object.keys(mt).sort().join(',');
      const want = MANIFEST_FIELDS.slice().sort().join(',');
      if (keys !== want) { reasons.push('gen-manifest.json 字段集合不符（应为 ' + want + '）'); }
      const ck = Object.keys(mt.counts || {}).sort().join(',');
      const wantCk = MANIFEST_COUNT_KEYS.slice().sort().join(',');
      if (ck !== wantCk) { reasons.push('gen-manifest.json.counts 字段集合不符（应为 ' + wantCk + '）'); }
      if (typeof mt.schemaVersion !== 'number') { reasons.push('gen-manifest.json.schemaVersion 类型非法'); }
      if (typeof mt.recordsSha256 !== 'string' || typeof mt.blockersSha256 !== 'string') { reasons.push('gen-manifest.json 哈希字段类型非法'); }
      if (typeof mt.publishedAt !== 'string') { reasons.push('gen-manifest.json.publishedAt 类型非法'); }
    }
  }
  // 读侧不校验哈希：H-2=A 冻结结论（完整性只到「存在、可读、可解析、结构合规」）
  return { complete: reasons.length === 0, code: reasons.length ? 'E17_INCOMPLETE_PUBLISH' : null, reasons: reasons };
}

// S2–S5：发布前逐项校验（在 S1 写出临时产物之后、S6 之前）。
// 返回 null 表示通过；否则返回 { stage, codes, note }。
function validatePrePublish(built) {
  let rd; let bd; let mt;
  try {
    rd = JSON.parse(built.recordsText);
    bd = JSON.parse(built.blockersText);
    mt = JSON.parse(serializeJson(built.manifest));
  } catch (e) { return { stage: 'S2', codes: ['E15_BAD_MAP'], note: '产物 JSON 不可解析' }; }
  // S2 结构：dishId 唯一、recordKey 唯一（记录级无独立 key 字段，键唯一性按 blockers.recordKey 判定）
  const seenId = Object.create(null);
  for (const r of rd.records) {
    if (r.id === null || r.id === undefined) { continue; }
    if (seenId[r.id]) { return { stage: 'S2', codes: ['E13_DUP_ID'], note: '重复 dishId：' + r.id }; }
    seenId[r.id] = 1;
  }
  const seenKey = Object.create(null);
  for (const e of bd.entries) {
    if (seenKey[e.recordKey]) { return { stage: 'S2', codes: ['E14_DUP_KEY'], note: '重复 recordKey：' + e.recordKey }; }
    seenKey[e.recordKey] = 1;
  }
  // S3 六项对账（结构项）。基准项（394/143/537，2026-10-25 实测校正）见 §7.2.1 说明：只在显式声明 baseline 时比对。
  const c = rd.meta && rd.meta.counts;
  const m = mt.counts || {};
  if (!c || typeof c.total !== 'number') { return { stage: 'S3', codes: ['E9_SUM'], note: 'records.meta.counts 缺失' }; }
  if (c.A + c.B + c.C !== c.total) { return { stage: 'S3', codes: ['E9_SUM'], note: 'A+B+C≠total' }; }
  if (m.records !== rd.records.length) { return { stage: 'S3', codes: ['E23_S10_COUNT_MISMATCH'], note: 'manifest.counts.records≠records.length' }; }
  if (m.blockers !== bd.entries.length || bd.count !== bd.entries.length) {
    return { stage: 'S3', codes: ['E23_S10_COUNT_MISMATCH'], note: 'blockers 计数与 entries.length 不一致' };
  }
  if (m.A !== c.A || m.B !== c.B || m.C !== c.C) { return { stage: 'S3', codes: ['E23_S10_COUNT_MISMATCH'], note: 'manifest 与 meta 的 A/B/C 不一致' }; }
  const b = built.baseline || PROD_BASELINE;
  if (c.total !== b.total || c.A !== b.A || c.B !== b.B || c.C !== b.C) {
    return {
      stage: 'S3', codes: ['E9_SUM'],
      note: '与基准不一致（S3 第 6 项）：实得 ' + c.total + '/' + c.A + '/' + c.B + '/' + c.C
        + '，基准 ' + b.total + '/' + b.A + '/' + b.B + '/' + b.C
        + (built.baseline ? '（测试注入基准）' : '（契约固定规划基准）')
    };
  }
  // 任务 A：2F / 3F 分项基准（§3.2 summary.f2/f3 口径；实际值由真实输入计算后与基准比较）
  const sum = built.summary || null;
  if (!sum || typeof sum.f2 !== 'object' || typeof sum.f3 !== 'object') {
    return { stage: 'S3', codes: ['E9_SUM'], note: '缺少分层统计（summary.f2/f3），无法完成分项基准校验' };
  }
  if (sum.noSource > 0) {
    return { stage: 'S3', codes: ['E9_SUM'], note: '缺少分层数据：' + sum.noSource + ' 条记录的 gen.groupKey 无 f2/f3 前缀，分项基准无法校验' };
  }
  const layerDiff = [];
  for (const layer of BY_SOURCE) {
    const act = sum[layer]; const exp = b[layer];
    if (!exp) { return { stage: 'S3', codes: ['E9_SUM'], note: '基准缺少 ' + layer + ' 分项（不得跳过分层校验）' }; }
    const bad = ['total', 'A', 'B', 'C'].filter(k => act[k] !== exp[k]);
    if (bad.length > 0) {
      layerDiff.push(layer + ' 实得 ' + act.total + '/' + act.A + '/' + act.B + '/' + act.C
        + '，基准 ' + exp.total + '/' + exp.A + '/' + exp.B + '/' + exp.C + '（不一致项：' + bad.join(',') + '）');
    }
  }
  if (layerDiff.length > 0) {
    return { stage: 'S3', codes: ['E9_SUM'], note: '分项基准不一致（S3 第 6 项 2F/3F）：' + layerDiff.join('；') };
  }
  // S4 映射一致性：id 非空 ⇔ id_status 为已分配；id 为空 ⇒ 不得为已分配
  for (const r of rd.records) {
    const st = (r.gen && r.gen.id_status) || '';
    const hasId = r.id !== null && r.id !== undefined;
    // 2026-10-25 C18 三分同步：id 非空允许 assigned_from_map（映射分配）/planned_from_roster
    // （契约名册区间规划的候选 ID，不获发布资格但身份可证）/assigned_new；id 为空必须 unassigned。
    if (hasId && st !== 'assigned_from_map' && st !== 'planned_from_roster' && st !== 'assigned_new') {
      return { stage: 'S4', codes: ['C18_ID_STATUS_MISMATCH'], note: 'id 非空但 id_status=' + st };
    }
    if (!hasId && (st === 'assigned_from_map' || st === 'planned_from_roster' || st === 'assigned_new')) {
      return { stage: 'S4', codes: ['C18_ID_STATUS_MISMATCH'], note: 'id 为空但 id_status=' + st };
    }
  }
  // S5 阻塞与候选口径：C 档不得进入 records（A+B 才进，见 §3.3）；不得出现 candidate_only
  for (const r of rd.records) {
    const g = r.gen || {};
    if (g.tier === 'C') { return { stage: 'S5', codes: ['E11_UNEXPECTED_ELIGIBLE'], note: 'C 档进入 records' }; }
    if (g.import_eligibility === 'candidate_only') { return { stage: 'S5', codes: ['E11_UNEXPECTED_ELIGIBLE'], note: '出现 candidate_only' }; }
  }
  return null;
}

function rmDirQuiet(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 保留诊断，不阻断报告 */ }
}

// §7.2.5：清理本次临时目录之前，先输出阶段/码/原因/路径/部分产物清单。
function printDiagnostics(lines) {
  if (!lines || !lines.length) { return; }
  try {
    console.log('— 发布诊断（清理前）—');
    lines.forEach(function (l) { console.log('  ' + l); });
  } catch (e) { /* 输出失败不得阻断清理与返回 */ }
}

// S1–S10：任一阶段失败即止，按 §7.2.5 保留/清理诊断
function publishOutputs(built, outDir, opts) {
  const options = opts || {};
  const startedAt = Date.now();
  const abs = path.resolve(outDir);
  const parent = path.dirname(abs);
  const repoRoot = options.repoRoot || path.join(__dirname, '..', '..');
  const result = { outDir: abs, stage: 'S0', codes: [], message: '', tmpDir: null, publishedAt: null };

  // --out 路径安全（在创建任何文件之前；属前置检查，不属任何 S 阶段）
  const safe = assertSafeOutDir(abs, repoRoot);
  if (!safe.ok) {
    result.stage = 'PRE'; result.codes = [safe.code]; result.message = safe.message; result.exitCode = EXIT.IO;
    return result;
  }
  // §7.2.4：临时目录必须与目标同卷
  if (path.parse(parent).root !== path.parse(abs).root) {
    result.stage = 'PRE'; result.message = '临时目录与目标不在同一卷（EXDEV 前置检查失败），未进入 S1';
    result.exitCode = EXIT.IO; return result;
  }
  if (!fs.existsSync(parent)) {
    result.stage = 'PRE'; result.message = '目标父目录不存在：' + parent + '（未进入 S1）'; result.exitCode = EXIT.IO; return result;
  }

  const pf = options.faults || null;

  // S1 临时生成
  const tmp = path.join(parent, 'gen-' + process.pid + '-' + startedAt);
  result.tmpDir = tmp;
  try {
    fs.mkdirSync(tmp, { recursive: false });
    if (pf && pf.writeTemp === 'fail') { throw Object.assign(new Error('测试注入 writeTemp=fail'), { code: 'E1_INPUT_UNREADABLE' }); }
    const manifest = built.manifest;
    manifest.publishedAt = new Date().toISOString();  // 发布时机赋值（§7.2.2 第 6 条 / H-1）
    const manifestText = serializeJson(manifest);
    fs.writeFileSync(path.join(tmp, 'records.json'), built.recordsText, { encoding: 'utf8' });
    fs.writeFileSync(path.join(tmp, 'records_blockers.json'), built.blockersText, { encoding: 'utf8' });
    fs.writeFileSync(path.join(tmp, 'gen-manifest.json'), manifestText, { encoding: 'utf8' });
    fs.writeFileSync(path.join(tmp, MARKER), '', { encoding: 'utf8' });  // 最后引入零字节标记
    result.publishedAt = manifest.publishedAt;
  } catch (e) {
    result.stage = 'S1'; result.message = '临时目录生成失败：' + String(e && e.message);
    result.codes = ['E1_INPUT_UNREADABLE']; result.exitCode = EXIT.IO;
    result.diagnostics = ['阶段 S1', '错误码 E1_INPUT_UNREADABLE', '原因 ' + String(e && e.message),
      '本次临时目录 ' + tmp, '已写出的部分产物 ' + (function () {
        try { return fs.readdirSync(tmp).join(', ') || '（无）'; } catch (x) { return '（不可枚举）'; }
      })()];
    printDiagnostics(result.diagnostics);
    rmDirQuiet(tmp);
    return result;
  }

  // S2–S5：逐项校验（结构 / 六项对账 / 映射一致 / 阻塞口径）
  const pre = validatePrePublish(built);
  if (pre) {
    result.stage = pre.stage; result.codes = pre.codes; result.message = '发布前校验未通过：' + pre.note;
    result.exitCode = EXIT.VIOLATION;
    result.diagnostics = ['阶段 ' + pre.stage, '错误码 ' + pre.codes.join(','), '原因 ' + pre.note,
      '本次临时目录 ' + tmp, '已写出的部分产物 ' + OUT_FILES.concat([MARKER]).join(', ')];
    printDiagnostics(result.diagnostics);
    fs.rmSync(tmp, { recursive: true, force: true });
    result.diagnostics.push('已清理本次临时目录（不触碰其他目录与历史诊断）');
    return result;
  }

  // S6 目标必须不存在（含空目录）
  if (fs.existsSync(abs)) {
    result.stage = 'S6'; result.message = '目标目录已存在，拒绝覆盖/合并：' + abs;
    result.exitCode = EXIT.IO; return result;  // 临时目录按 §7.2.5 保留
  }

  if (pf && pf.concurrentOutDir === 'beforeRename') {
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, 'intruder.txt'), 'x', 'utf8');
  }

  // S7 单次目录 rename
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    result.stage = 'S7';
    result.codes = [String((e && e.code) || '')];
    result.message = 'rename 失败（' + String((e && e.code) || e && e.message) + '）：临时目录已保留 ' + tmp
      + (fs.existsSync(abs) ? '；目标路径当前存在，完整性按 §7.2.3 判定' : '；目标路径未被本次运行创建');
    result.exitCode = EXIT.IO; return result;
  }

  if (pf && pf.crashAfterRename === 'afterRename') {
    result.stage = 'S7-中断'; result.codes = ['SIMULATED_INTERRUPTION'];
    result.message = '模拟 rename 之后进程中断（测试注入，非真实 OS 故障）：目录已存在且含 PUBLISHING，未写 COMMITTED';
    result.exitCode = 4; return result;
  }

  // S8 发布后自检：读回三文件、重算两个数据文件哈希、核对条数
  try {
    for (const f of OUT_FILES) {
      if (!fs.existsSync(path.join(abs, f))) { throw Object.assign(new Error('缺文件 ' + f), { code: 'E20_S10_FILE_UNREADABLE' }); }
    }
    const rt = fs.readFileSync(path.join(abs, 'records.json'), 'utf8');
    const bt = fs.readFileSync(path.join(abs, 'records_blockers.json'), 'utf8');
    const mt = JSON.parse(fs.readFileSync(path.join(abs, 'gen-manifest.json'), 'utf8'));
    if (sha256Hex(rt) !== mt.recordsSha256 || sha256Hex(bt) !== mt.blockersSha256) {
      throw Object.assign(new Error('哈希不一致'), { code: 'E22_S10_HASH_MISMATCH' });
    }
    const rd = JSON.parse(rt);
    const bd = JSON.parse(bt);
    if (mt.counts.records !== rd.records.length || mt.counts.blockers !== bd.entries.length
      || mt.counts.A !== rd.meta.counts.A || mt.counts.B !== rd.meta.counts.B || mt.counts.C !== rd.meta.counts.C) {
      throw Object.assign(new Error('计数不一致'), { code: 'E23_S10_COUNT_MISMATCH' });
    }
  } catch (e) {
    result.stage = 'S8'; result.codes = [(e && e.code) || 'S8_SELF_CHECK_FAILED'];
    result.message = '发布后自检不通过：' + String(e && e.message) + '；目录已存在但自检未通过，保留供人工处理';
    result.exitCode = 4; return result;
  }

  // S9 清除标记（S8 通过之后）
  try {
    fs.unlinkSync(path.join(abs, MARKER));
  } catch (e) {
    result.stage = 'S9'; result.codes = ['E18_MARKER_CLEAR_FAILED'];
    result.message = 'PUBLISHING 标记清除失败：' + abs; result.exitCode = 4; return result;
  }

  // S10 清除后复核（五项）
  const s10 = [];
  if (fs.existsSync(path.join(abs, MARKER))) { s10.push('E19_MARKER_STILL_PRESENT'); }
  const readable = {};
  for (const f of OUT_FILES) {
    try { readable[f] = fs.readFileSync(path.join(abs, f), 'utf8'); } catch (e) { s10.push('E20_S10_FILE_UNREADABLE'); }
  }
  try {
    const mt = JSON.parse(readable['gen-manifest.json']);
    const keys = Object.keys(mt).sort().join(',');
    const want = MANIFEST_FIELDS.slice().sort().join(',');
    const ck = Object.keys(mt.counts || {}).sort().join(',');
    const wantCk = MANIFEST_COUNT_KEYS.slice().sort().join(',');
    if (keys !== want || ck !== wantCk || typeof mt.schemaVersion !== 'number'
      || typeof mt.recordsSha256 !== 'string' || typeof mt.blockersSha256 !== 'string'
      || typeof mt.publishedAt !== 'string') { s10.push('E21_S10_MANIFEST_INVALID'); }
    if (sha256Hex(readable['records.json']) !== mt.recordsSha256
      || sha256Hex(readable['records_blockers.json']) !== mt.blockersSha256) { s10.push('E22_S10_HASH_MISMATCH'); }
    const rd = JSON.parse(readable['records.json']);
    const bd = JSON.parse(readable['records_blockers.json']);
    if (mt.counts.records !== rd.records.length || mt.counts.blockers !== bd.entries.length
      || mt.counts.A !== rd.meta.counts.A || mt.counts.B !== rd.meta.counts.B || mt.counts.C !== rd.meta.counts.C) {
      s10.push('E23_S10_COUNT_MISMATCH');
    }
  } catch (e) { s10.push('E21_S10_MANIFEST_INVALID'); }
  if (s10.length > 0) {
    result.stage = 'S10'; result.codes = s10;
    result.message = 'S10 复核失败（目录保留）：' + s10.join(','); result.exitCode = 4; return result;
  }

  // S10 全部通过后才写完成标记（任务 A）：读侧只接受带此标记的目录
  if (pf && pf.committed === 'fail') {
    result.stage = 'S10'; result.codes = ['E30_COMMITTED_WRITE_FAILED'];
    result.message = '完成标记写入失败（测试注入，目录保留、读侧会拒绝）';
    result.exitCode = 4; return result;
  }
  try {
    fs.writeFileSync(path.join(abs, COMMITTED), '', { encoding: 'utf8' });
  } catch (e) {
    result.stage = 'S10'; result.codes = ['E30_COMMITTED_WRITE_FAILED'];
    result.message = '完成标记写入失败（目录保留，读侧会拒绝该目录）：' + abs;
    result.exitCode = 4; return result;
  }

  result.stage = 'S10'; result.exitCode = EXIT.OK;
  result.message = '发布成功（S8 自检 + S9 清除 + S10 复核均通过）';
  return result;
}

// ── M5C-2 键一致性诊断（契约 §5.6.5.10.1 W_KEY_MISMATCH）────────────
// 由四字段独立重算键（不复用 makeKeyFrom 的记录形状），与存储的 entries[].key 比对。
// 第一阶段：只产出诊断，不改 ID、不阻断、不改变退出码。
const KEY_MISMATCH_PUNCT = /^[。，,、；;]+|[。，,、；;]+$/g;
function keyFromFields(stallId, groupKey, specLabel, disambiguator) {
  const fields = [
    ['stallId', stallId],
    ['groupKey', groupKey],
    ['specLabel', specLabel],
    ['disambiguator', disambiguator]
  ];
  const parts = [];
  for (let i = 0; i < fields.length; i += 1) {
    const name = fields[i][0];
    const v = fields[i][1];
    if (typeof v !== 'string') { return { ok: false, field: name, reason: 'NOT_STRING' }; }
    if (v.indexOf('|') >= 0) { return { ok: false, field: name, reason: 'CONTAINS_PIPE' }; }
    if (i === 0) {
      if (v.length === 0) { return { ok: false, field: name, reason: 'EMPTY' }; }
      parts.push(v);                                   // R1：stallId 原样
    } else if (i === 1) {
      parts.push(v.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(KEY_MISMATCH_PUNCT, '')); // R2
    } else if (i === 2) {
      parts.push(v.trim().normalize('NFKC'));          // R3：先 trim 再 NFKC，不折叠不去标点
    } else {
      parts.push(v);                                   // R6：disambiguator 原样
    }
  }
  return { ok: true, key: parts.join('|') };
}
function diagnoseKeyMismatch(map) {
  const warnings = [];
  if (!map || !Array.isArray(map.entries)) { return warnings; }
  map.entries.forEach(function (e, idx) {
    if (!e || typeof e.key !== 'string') { return; }
    const r = keyFromFields(e.stallId, e.groupKey, e.specLabel, e.disambiguator);
    if (!r.ok) {
      warnings.push({ code: 'W_KEY_MISMATCH', entry: idx, key: e.key, reason: r.reason, field: r.field });
      return;
    }
    if (r.key !== e.key) {
      warnings.push({ code: 'W_KEY_MISMATCH', entry: idx, key: e.key, reason: 'KEY_TEXT_MISMATCH',
        recomputed: r.key, message: '存储键与四字段重算结果不一致' });
    }
  });
  return warnings;
}

// ── M5C-3 planDigest 规范化（契约 §5.6.5.8.3）──────────────────────
const PLAN_PAYLOAD_HEADING = '## 计划载荷（可摘要）';
// ── 计划载荷语义覆盖（契约 §5.6.5.8.3 :882-893）──────────────────────
// 区分两件事：对给定 JSON 求摘要（parseAndNormalizePayload）与「这份 JSON 是否
// 完整表达契约要求的计划」（validatePlanPayloadShape）。缺项即载荷不完整，审批不得通过。
const PLAN_REQUIRED_KEYS = Object.freeze(['scope', 'records', 'idRules', 'baseline',
  'collisionPolicy', 'orphanPolicy', 'guards', 'attachments', 'excludes']);
const PLAN_BASELINE_EXPECTED = Object.freeze({
  total: 525, A: 490, B: 0, C: 35,
  f2: { total: 382, A: 376, B: 0, C: 6 },
  f3: { total: 143, A: 114, B: 0, C: 29 }
});
const PLAN_KEY_TYPES = Object.freeze({
  scope: 'object', records: 'array', idRules: 'object', baseline: 'object',
  collisionPolicy: 'object', orphanPolicy: 'object', guards: 'object',
  attachments: 'array', excludes: 'array'
});
function shapeTypeOf(v) {
  if (Array.isArray(v)) { return 'array'; }
  if (v === null) { return 'null'; }
  return typeof v;
}
function sameBaselineBucket(actual, exp) {
  if (!actual || typeof actual !== 'object') { return false; }
  const keys = ['total', 'A', 'B', 'C'];
  for (let i = 0; i < keys.length; i += 1) {
    if (actual[keys[i]] !== exp[keys[i]]) { return false; }
  }
  return true;
}
function validatePlanPayloadShape(payload) {
  const obj = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : null;
  if (!obj) { return { ok: false, code: 'E_PLAN_PAYLOAD_SHAPE', message: '载荷必须是 JSON 对象' }; }
  const missing = PLAN_REQUIRED_KEYS.filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(obj, k);
  });
  if (missing.length > 0) {
    return { ok: false, code: 'E_PLAN_PAYLOAD_INCOMPLETE', message: '载荷缺少必需键：' + missing.join('、') };
  }
  const badTypes = [];
  PLAN_REQUIRED_KEYS.forEach(function (k) {
    const want = PLAN_KEY_TYPES[k];
    if (want && shapeTypeOf(obj[k]) !== want) { badTypes.push(k + '（应为 ' + want + '，实为 ' + shapeTypeOf(obj[k]) + '）'); }
  });
  if (badTypes.length > 0) {
    return { ok: false, code: 'E_PLAN_PAYLOAD_TYPE', message: '载荷字段类型不符：' + badTypes.join('；') };
  }
  const b = obj.baseline;
  if (!sameBaselineBucket(b, PLAN_BASELINE_EXPECTED) ||
      !sameBaselineBucket(b.f2, PLAN_BASELINE_EXPECTED.f2) ||
      !sameBaselineBucket(b.f3, PLAN_BASELINE_EXPECTED.f3)) {
    return { ok: false, code: 'E_PLAN_BASELINE_MISMATCH', message: '载荷 baseline 与固定规划基准（总量 525、2F 382、3F 143；A/B/C 490/0/35 为 2026-10-25 分档裁决重锁）不一致' };
  }
  const attBad = [];
  obj.attachments.forEach(function (a, i) {
    const t = shapeTypeOf(a);
    if (t !== 'object') { attBad.push('attachments[' + i + '] 应为对象'); return; }
    if (typeof a.relativePath !== 'string' || a.relativePath.length === 0) { attBad.push('attachments[' + i + '].relativePath 必须为非空字符串'); }
    if (typeof a.bytes !== 'number' || !isFinite(a.bytes) || a.bytes < 0) { attBad.push('attachments[' + i + '].bytes 必须为非负数字'); }
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) { attBad.push('attachments[' + i + '].sha256 必须为 64 位小写 hex'); }
  });
  if (attBad.length > 0) {
    return { ok: false, code: 'E_PLAN_ATTACH_SHAPE', message: '载荷附件清单结构不符：' + attBad.join('；') };
  }
  const unknown = Object.keys(obj).filter(function (k) { return PLAN_REQUIRED_KEYS.indexOf(k) < 0; });
  return { ok: true, unknownKeys: unknown };
}

function extractPlanPayload(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = src.split('\n');
  const h = lines.findIndex(function (l) { return l.trim() === PLAN_PAYLOAD_HEADING; });
  if (h < 0) { return { ok: false, code: 'E_PLAN_PAYLOAD_MISSING', message: '缺少载荷标题：' + PLAN_PAYLOAD_HEADING }; }
  let start = -1;
  for (let i = h + 1; i < lines.length; i += 1) {
    if (/^```json\s*$/.test(lines[i].trim())) { start = i + 1; break; }
    if (/^##\s/.test(lines[i])) { break; }
  }
  if (start < 0) { return { ok: false, code: 'E_PLAN_PAYLOAD_MISSING', message: '载荷标题后没有 ```json 围栏块' }; }
  let end = -1;
  for (let i = start; i < lines.length; i += 1) {
    if (/^```\s*$/.test(lines[i].trim())) { end = i; break; }
  }
  if (end < 0) { return { ok: false, code: 'E_PLAN_PAYLOAD_UNCLOSED', message: '载荷围栏块未闭合' }; }
  const body = lines.slice(start, end).join('\n');
  return { ok: true, body: body, lineStart: start + 1, lineEnd: end };
}
function utf8KeyCompare(a, b) {
  return Buffer.compare(Buffer.from(String(a), 'utf8'), Buffer.from(String(b), 'utf8'));
}
function normalizeForDigest(value) {
  if (value === null) { return null; }
  if (Array.isArray(value)) { return value.map(normalizeForDigest); }
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value).filter(function (k) { return value[k] !== undefined; })
      .sort(utf8KeyCompare)
      .forEach(function (k) { out[k] = normalizeForDigest(value[k]); });
    return out;
  }
  if (typeof value === 'number') {
    if (!isFinite(value)) { throw new TypeError('载荷含非有限数值，无法规范化'); }
    return value === 0 ? 0 : value;   // 契约 §5.6.5.8.3 第 3 步：-0 归一为 0
  }
  return value;
}
function serializeForDigest(value) { return JSON.stringify(normalizeForDigest(value), null, 2) + '\n'; }
function parseAndNormalizePayload(text) {
  const ex = extractPlanPayload(text);
  if (!ex.ok) { return ex; }
  let parsed = null;
  try { parsed = JSON.parse(ex.body); }
  catch (e) { return { ok: false, code: 'E_PLAN_PAYLOAD_PARSE', message: '载荷不是合法 JSON：' + String(e && e.message) }; }
  const canon = serializeForDigest(parsed);
  if (canon !== ex.body + '\n') {
    return { ok: false, code: 'E_PLAN_PAYLOAD_NOT_CANONICAL', message: '载荷块未按规范化形式书写（键序/缩进/末尾换行不符）' };
  }
  if (Object.prototype.hasOwnProperty.call(parsed, 'planDigest')) {
    return { ok: false, code: 'E_PLAN_PAYLOAD_SELF_REF', message: '载荷内不得出现 planDigest（禁止自引用）' };
  }
  const shape = validatePlanPayloadShape(parsed);
  return { ok: true, payload: parsed, canonical: canon, shape: shape.ok ? { ok: true, unknownKeys: shape.unknownKeys } : shape };
}
function computePlanDigest(text) {
  const r = parseAndNormalizePayload(text);
  if (!r.ok) { return r; }
  return { ok: true, payload: r.payload, digest: sha256Hex(Buffer.from(r.canonical, 'utf8')) };
}
function verifyPlanDigest(text, expected) {
  const r = computePlanDigest(text);
  if (!r.ok) { return r; }
  if (typeof expected !== 'string' || expected.length === 0) {
    return { ok: false, code: 'E_PLAN_DIGEST_MISSING', message: '缺少待比对的 planDigest' };
  }
  if (r.digest !== expected.toLowerCase()) {
    return { ok: false, code: 'E_PLAN_DIGEST_MISMATCH', message: '摘要不匹配：' + r.digest + ' ≠ ' + expected };
  }
  return { ok: true, digest: r.digest };
}
function validateAttachments(attachments, rootDir) {
  // 契约 §5.6.5.8.3 :895-899：attachments=[{relativePath,bytes,sha256}]，
  // relativePath 一律相对项目根、统一 / 分隔；禁绝对/盘符/UNC/`..`/重复/越界符号链接；
  // 清单按 relativePath 的 UTF-8 字节序升序；附件缺失即拒绝。
  const list = Array.isArray(attachments) ? attachments : null;
  const errs = [];
  if (list === null) { return { ok: false, errors: [{ code: 'E_ATTACH_SHAPE', message: 'attachments 必须是数组' }] }; }
  const root = path.resolve(rootDir || process.cwd());
  let realRoot = null;
  try { realRoot = fs.realpathSync(root); } catch (e) { void e; realRoot = root; }
  // 清单级不变量预检（次序 / 重复）：契约 §5.6.5.8.3 只规定「必须升序」「禁止重复」，
  // 未规定与其他错误之间的优先级；清单本身不合法时先报，避免被「文件不存在」掩盖。
  const pre = [];
  const seenPre = Object.create(null);
  let prevPre = null;
  for (let pi = 0; pi < list.length; pi += 1) {
    const pa = list[pi];
    if (!pa || typeof pa !== 'object' || Array.isArray(pa)) { continue; }
    const prp = pa.relativePath;
    if (typeof prp !== 'string' || prp.length === 0) { continue; }
    if (prevPre !== null && utf8KeyCompare(prevPre, prp) >= 0) {
      pre.push({ code: 'E_ATTACH_ORDER', message: 'attachments[' + pi + '].relativePath 未按 UTF-8 字节序升序：' + prevPre + ' → ' + prp });
    }
    prevPre = prp;
    const preDupKey = process.platform === 'win32' ? prp.toLowerCase() : prp;
    if (seenPre[preDupKey]) { pre.push({ code: 'E_ATTACH_DUPLICATE', message: 'attachments[' + pi + '].relativePath 重复：' + prp }); }
    seenPre[preDupKey] = true;
  }
  if (pre.length > 0) { return { ok: false, errors: pre }; }
  const seen = Object.create(null);
  let prev = null;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    const at = 'attachments[' + i + ']';
    if (!a || typeof a !== 'object' || Array.isArray(a)) { errs.push({ code: 'E_ATTACH_SHAPE', message: at + ' 必须是对象 {relativePath,bytes,sha256}' }); continue; }
    const rp = a.relativePath;
    if (typeof rp !== 'string' || rp.length === 0) { errs.push({ code: 'E_ATTACH_SHAPE', message: at + '.relativePath 必须为非空字符串' }); continue; }
    if (typeof a.bytes !== 'number' || !isFinite(a.bytes) || a.bytes < 0) { errs.push({ code: 'E_ATTACH_SHAPE', message: at + '.bytes 必须为非负数字' }); continue; }
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) { errs.push({ code: 'E_ATTACH_SHAPE', message: at + '.sha256 必须为 64 位小写 hex' }); continue; }
    // 顺序：清单本身必须是 UTF-8 字节序升序（契约硬要求）
    if (prev !== null && utf8KeyCompare(prev, rp) >= 0) {
      errs.push({ code: 'E_ATTACH_ORDER', message: at + '.relativePath 未按 UTF-8 字节序升序：' + prev + ' → ' + rp });
      continue;
    }
    prev = rp;
    // 重复（Windows 路径大小写不敏感 → 折叠比较，不得静默去重）
    const dupKey = process.platform === 'win32' ? rp.toLowerCase() : rp;
    if (seen[dupKey]) { errs.push({ code: 'E_ATTACH_DUPLICATE', message: at + '.relativePath 重复：' + rp }); continue; }
    seen[dupKey] = true;
    // 路径形态：绝对 / 盘符 / UNC / 反斜杠分隔（统一要求 /）
    if (rp.indexOf('\\') >= 0) { errs.push({ code: 'E_ATTACH_PATH', message: at + '.relativePath 必须使用 / 分隔：' + rp }); continue; }
    if (path.isAbsolute(rp) || /^[A-Za-z]:/.test(rp) || /^\/\//.test(rp)) {
      errs.push({ code: 'E_ATTACH_ABSOLUTE', message: at + '.relativePath 不得为绝对/盘符/UNC 路径：' + rp }); continue;
    }
    const abs = path.resolve(root, rp);
    const rel = path.relative(root, abs);
    if (rel === '' || rel === '..' || rel.indexOf('..' + path.sep) === 0 || path.isAbsolute(rel)) {
      errs.push({ code: 'E_ATTACH_TRAVERSAL', message: at + '.relativePath 越出项目根：' + rp }); continue;
    }
    let lst = null;
    try { lst = fs.lstatSync(abs); }
    catch (e) { errs.push({ code: 'E_ATTACH_MISSING', message: at + ' 附件不存在：' + rp }); continue; }
    let st = lst;
    try {
      st = fs.statSync(abs);
      const realAbs = fs.realpathSync(abs);           // 任一上级为联接/符号链接时此处会解析到真实路径
      const realRel = path.relative(realRoot, realAbs);
      if (realRel === '' || realRel === '..' || realRel.indexOf('..' + path.sep) === 0 || path.isAbsolute(realRel)) {
        errs.push({ code: 'E_ATTACH_SYMLINK_ESCAPE', message: at + ' 真实路径越出项目根：' + rp + ' → ' + realAbs }); continue;
      }
    } catch (e) { errs.push({ code: 'E_ATTACH_MISSING', message: at + ' 附件无法解析：' + rp }); continue; }
    if (!st.isFile()) { errs.push({ code: 'E_ATTACH_NOT_FILE', message: at + ' 不是普通文件（目录或设备）：' + rp }); continue; }
    if (a.bytes !== st.size) { errs.push({ code: 'E_ATTACH_SIZE', message: at + ' 字节数不符：声明 ' + a.bytes + '，实际 ' + st.size }); continue; }
    const actual = sha256Hex(fs.readFileSync(abs));
    if (actual !== a.sha256) { errs.push({ code: 'E_ATTACH_DIGEST', message: at + ' SHA-256 不符：声明 ' + a.sha256 + '，实际 ' + actual }); }
  }
  return { ok: errs.length === 0, errors: errs };
}

// ── M5C-4 初始化安全协议（契约 §7.5）────────────────────────────────
// 目录级 fsync：不可用即安全停止，禁止静默降级、禁止改用 rename 覆盖目标。
function checkDirFsync(dir) {
  let fd = -1;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: (e && e.code) || 'UNKNOWN', message: '目录级 fsync 不可用：' + String((e && e.code) || e) };
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch (e2) { void e2; } }
  }
}
// A′ 持久性补丁（2026-10-25）：实际执行目录 fsync。与 checkDirFsync 的能力探测共用同一
// 原语，但语义不同——这里的失败必须改变 initIdMap 的返回状态（INIT_DURABILITY_UNCONFIRMED），
// 不得把「探测成功」当作「同步成功」。__testDirFsyncNow 仅测试注入通道（按 phase 分别模拟
// afterLink/afterUnlink 成败），生产路径（run/main/publishOutputs）一律不传。
function fsyncDirNow(dir, phase, opts) {
  const o = opts || {};
  if (typeof o.__testDirFsyncNow === 'function') {
    try { return o.__testDirFsyncNow(phase, dir); }
    catch (e) { return { ok: false, code: 'TEST_INJECT_THROW', message: '目录 fsync（' + phase + '）测试替身异常：' + String(e && e.message) }; }
  }
  return checkDirFsync(dir);
}
function initIdMap(payloadText, targetPath, opts) {
  const o = opts || {};
  const target = path.resolve(targetPath);
  const dir = path.dirname(target);
  // 防覆盖优先：目标已存在即拒绝，任何能力探测之前先判定（两者都不写盘）。
  try { fs.lstatSync(target); return { exitCode: EXIT.IO, status: 'INIT_TARGET_EXISTS', code: null, message: '目标已存在，拒绝覆盖：' + target, wrote: false }; }
  catch (e) { if (!e || e.code !== 'ENOENT') { return { exitCode: EXIT.IO, status: 'INIT_IO_ERROR', code: null, message: '目标探测失败：' + String(e && e.code), wrote: false }; } }
  // 受控替身入口：**仅测试可用**。run()/main()/publishOutputs 等生产路径一律不传该参数，
  // 因此它不能用来证明「本机目录 fsync 可用」，也不能用来宣称初始化链路已通过。
  const fsyncCheck = (typeof o.__testFsyncProbe === 'function') ? o.__testFsyncProbe() : checkDirFsync(dir);
  if (!fsyncCheck.ok) {
    return { exitCode: EXIT.IO, status: 'INIT_FSYNC_UNAVAILABLE', code: 'INIT_FSYNC_UNAVAILABLE',
      message: fsyncCheck.message + '；按 §7.5 安全停止，不降级、不宣称持久性', wrote: false };
  }
  const tmp = path.join(dir, '.id-map-init-' + process.pid + '-' + Date.now() + '.tmp');
  const bytes = Buffer.from(String(payloadText), 'utf8');
  try {
    const fd = fs.openSync(tmp, 'wx');
    // __testFdFsync 仅测试注入通道（模拟文件级 fsync 失败）；生产路径不传。
    const fdFsync = (typeof o.__testFdFsync === 'function') ? o.__testFdFsync : fs.fsyncSync;
    try { fs.writeFileSync(fd, bytes); fdFsync(fd); } finally { fs.closeSync(fd); }
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { void e2; }
    return { exitCode: EXIT.IO, status: 'INIT_IO_ERROR', code: null, message: '临时文件写入失败：' + String(e && e.code), wrote: false };
  }
  // __testLink 仅测试注入通道（模拟 linkSync 机制失败）；生产路径不传。
  const doLink = (typeof o.__testLink === 'function') ? o.__testLink : fs.linkSync;
  try {
    doLink(tmp, target);                // 防覆盖：目标已存在必 EEXIST
  } catch (e) {
    const code = (e && e.code) || '';
    try { fs.unlinkSync(tmp); } catch (e2) { void e2; }
    if (code === 'EEXIST') { return { exitCode: EXIT.IO, status: 'INIT_TARGET_EXISTS', code: null, message: '并发发现目标已存在，拒绝覆盖（未改动目标）', wrote: false }; }
    return { exitCode: EXIT.IO, status: 'INIT_LINK_UNSUPPORTED', code: null, message: '硬链接方式不可用（' + code + '）；按 §7.5 禁止降级为 rename/直接写目标', wrote: false };
  }
  // A′ 持久性补丁（2026-10-25）：link 成功后实际同步父目录；失败不得继续、不得宣称成功，
  // 保留目标与临时文件供人工核查（tmp 与 target 同 inode，可人工比对内容）。
  const afterLink = fsyncDirNow(dir, 'afterLink', o);
  if (!afterLink.ok) {
    return { exitCode: EXIT.IO, status: 'INIT_DURABILITY_UNCONFIRMED', code: null,
      message: afterLink.message + '；目标已创建且内容已文件级 fsync，但 link 目录项持久性未确认——保留目标与临时文件，不自动删除、不重试',
      wrote: true, phase: 'afterLink', tmpPath: tmp };
  }
  try { fs.unlinkSync(tmp); } catch (e) { void e; }
  // A′ 持久性补丁（2026-10-25）：unlink 成功后再次同步父目录（tmp 目录项删除的持久化）。
  const afterUnlink = fsyncDirNow(dir, 'afterUnlink', o);
  if (!afterUnlink.ok) {
    return { exitCode: EXIT.IO, status: 'INIT_DURABILITY_UNCONFIRMED', code: null,
      message: afterUnlink.message + '；目标已创建、link 目录项已同步，但 unlink 目录项删除未确认（临时文件可能残留）——保留目标，不自动删除、不重试',
      wrote: true, phase: 'afterUnlink', tmpPath: tmp };
  }
  // __testReadBack 仅测试注入通道（模拟读回不一致）；生产路径不传。
  const back = (typeof o.__testReadBack === 'function') ? o.__testReadBack(target) : fs.readFileSync(target);
  if (!back.equals(bytes)) {
    return { exitCode: EXIT.IO, status: 'INIT_RECHECK_MISMATCH', code: null,
      message: '初始化后读回不一致（保留目标可供人工核查，未自动删除）', wrote: true, digest: sha256Hex(back) };
  }
  return { exitCode: EXIT.OK, status: 'INIT_OK', code: null, message: '初始化完成并读回校验一致', wrote: true, target: target, digest: sha256Hex(back) };
}

// ── 冻结映射 → 运行时 payload 的确定性转换器（首版仅 104 条，2026-10-25）──────────
// 首版语义（技术负责人 2026-10-25 批准）：冻结映射 status='assigned_unverified' 是
// **分配/核实域**状态；转换为运行时 'active'（**条目生命周期域**）——active 仅表示
// ID 映射条目处于生成器可用状态，**不代表菜品已核实、来源可信或允许发布**；records
// 层 verifyStatus 仍全量 unverified，两个状态域不得互相推导（防混淆硬约束）。
function buildInitPayloadFromFrozen(frozen, approval, approvalId) {
  const entries = frozen.entries.map(function (e) {
    return {
      approvedBy: 'user:负责人审批 ' + approval.planRef,
      assignedAt: approval.approvedAt,
      disambiguator: e.disambiguator,
      dishId: e.dishId,
      groupKey: e.groupKey,
      key: e.key,
      sourceRef: e.sourceRef,
      specLabel: e.specLabel,
      stallId: e.stallId,
      status: 'active'
    };
  }).sort(function (a, b) {
    return Buffer.compare(Buffer.from(a.key, 'utf8'), Buffer.from(b.key, 'utf8'));
  });
  return {
    entries: entries,
    generatedAt: approval.approvedAt, // 单一时间源：审批记录（转换可复现，不取执行机器时钟）
    initialization: {
      approvalRef: approvalId,
      planDigest: String(approval.planDigest).toLowerCase(),
      mapVersion: approval.mapVersion
    },
    keyFormat: KEY_LITERAL,
    orphans: [],
    schemaVersion: 1
  };
}

// 确定性序列化：键序由构造顺序保证（buildInitPayloadFromFrozen 按契约 §5.6.5.8.3
// 的 UTF-8 字节序书写对象键；entries 已按 key 字节序排序）——同输入必得同字节。
function canonicalJsonStringify(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

// ── runInit：显式 init 子命令的生产分派目标（2026-10-25 实施轮）──────────────
// 门控纪律：① run()/main()/publishOutputs() 永不调用 initIdMap（T243 断言），普通
// gen/dry-run/write 无任何初始化副作用；② 九步预检全部通过前零写入；③ 审批记录必须
// 真实存在且 result==='approved'（G-4=C：缺失即校验类失败/退出码 1；未签署草案
// result 恒非 approved，即使复制进正式目录也不构成有效审批）；④ 唯一写盘点是
// initIdMap（A′ 两阶段目录 fsync + 读回核验）。
// 测试注入面（CLI 不可达，与既有「仅测试通道」注入同纪律）：approvalDir / targetPath /
// frozenMapPath / planText / records / __test* 替身——CLI 仅传 approvalId，全部默认正式路径。
// ── C 段计划条目（平铺）→ L8 §3.3 记录域适配器（2026-10-25 负责人方案 A）──────────
// 不修改 C 段源构建器；映射表见 docs/decisions/ADAPTER_MAP_C_TO_L8_20261025.md。
// 关键语义：tastes: [] =「口味信息未提供」（不是口味；不匹配任何具体口味筛选；
// 禁止 choice 作为未知默认）；verifyStatus 恒 'unverified'/verifiedAt 恒 null（不从
// 映射 active 推导可信度）；原始映射 key 不变；blockers 如实关联源域 problems。
const ADAPTER_TASTES = Object.freeze(['light', 'mild_spicy', 'spicy', 'choice']);
function adaptPlanRecordsForL8(plan, opts) {
  const o = opts || {};
  const byStall = Object.create(null);
  (plan.problems || []).forEach(function (p) {
    const sid = p.stallId || '';
    if (!sid) { return; }
    (byStall[sid] = byStall[sid] || []).push(p.code || p.kind || 'SOURCE_PROBLEM');
  });
  // C18 第 3 类证据：逐档口名册区间（§5.6.1/§5.6.3 契约表，由 run() 经 parseRosterRows 提供）。
  // 区间缺失（from/to=null）→ 无法证明 → 不放行。
  const ranges = Object.create(null);
  const rosterRows = Array.isArray(o.rosterRows) ? o.rosterRows : [];
  rosterRows.forEach(function (st) {
    if (st && st.stallId) { ranges[st.stallId] = { from: st.from, to: st.to, tier: st.tier }; }
  });
  const numOf = function (id) {
    const m = String(id || '').match(/d(\d+)$/);
    return m ? parseInt(m[1], 10) : null;
  };
  return plan.records.map(function (r) {
    if (r.tastes !== undefined && r.tastes !== null) {
      if (!Array.isArray(r.tastes) || r.tastes.length > 1 ||
          r.tastes.some(function (t) { return ADAPTER_TASTES.indexOf(t) < 0; })) {
        const e = new Error('tastes 非法（允许 [] 或恰 1 个已知值 light/mild_spicy/spicy/choice）：' + JSON.stringify(r.tastes));
        e.code = 'E3_ENUM';
        throw e;
      }
    }
    const prefix = /3F/.test(r.sourceFile || '') ? 'f3/' : 'f2/';
    // 预置 id_status（resolveRecords 命中映射时会改写为 assigned_from_map 并校验一致性）：
    // 有 dishId 且能由该档口名册区间证明 → planned_from_roster；无法证明 → 保持 unassigned
    // （保留非空 id 会触发 C18 fail-closed，这是有意为之：证据缺失必须显式失败）。
    const rg = ranges[r.stallId];
    const n = r.dishId ? numOf(r.dishId) : null;
    const inRange = !!(rg && rg.from != null && rg.to != null && n !== null && n >= rg.from && n <= rg.to);
    const plannedId = r.dishId && inRange ? r.dishId : null;
    if (r.dishId && !inRange) {
      (byStall[r.stallId] = byStall[r.stallId] || []).push('ID_NOT_IN_ROSTER_RANGE');
    }
    return {
      id: plannedId,
      shopId: 'c01',
      stallId: r.stallId,
      name: r.name,
      price: r.price,
      foodType: r.foodType,
      tastes: r.tastes === undefined || r.tastes === null ? [] : r.tastes.slice(),
      source: { kind: 'field', detail: r.source_detail || '', ref: r.sourceRef || '' },
      verifyStatus: 'unverified',
      verifiedAt: null,
      note: '',
      gen: {
        tier: r.tier,
        groupKey: prefix + r.groupKey,
        rawGroupKey: r.groupKey,
        specLabel: r.specLabel || '',
        disambiguator: r.disambiguator || '',
        rawRow: r.rawRow || '',
        sourceLine: r.sourceLine,
        generation_status: r.tier === 'C' ? 'not_generated' : 'generated',
        evidence_status: r.tier === 'C' ? 'unclear_source' : 'traceable',
        import_eligibility: 'blocked',
        id_status: plannedId ? 'planned_from_roster' : 'unassigned',
        blockers: (byStall[r.stallId] || []).slice()
      },
      _adapterKey: r.key
    };
  });
}

function runInit(options) {
  const o = options || {};
  const approvalId = o.approvalId;
  if (typeof approvalId !== 'string' || !/^ap-[0-9]{8}-[0-9]{2}$/.test(approvalId)) {
    return {
      exitCode: EXIT.USAGE, summary: { status: CODE.USAGE, approvalId: String(approvalId || null), note: 'init 需要 --approval ap-YYYYMMDD-NN（写入前失败、零写入）' },
      violations: [{ code: CODE.USAGE, message: '审批编号缺失或格式非法' }], blockers: []
    };
  }
  const targetPath = (typeof o.targetPath === 'string' && o.targetPath) ? o.targetPath : DEFAULT_MAP_PATH;
  const approvalDir = (typeof o.approvalDir === 'string' && o.approvalDir) ? o.approvalDir : path.join(__dirname, 'approvals');
  const frozenMapPath = (typeof o.frozenMapPath === 'string' && o.frozenMapPath)
    ? o.frozenMapPath : path.join(__dirname, '..', '..', 'docs', 'decisions', 'ID_MAP_T48_T49_20261025.json');
  const planPath = path.join(__dirname, 'init-plans', 'ip-20261025-01.md');
  let planText = null;
  if (o.planText != null) { planText = String(o.planText); }
  else {
    try { planText = fs.readFileSync(planPath, 'utf8'); }
    catch (e) {
      return {
        exitCode: EXIT.VIOLATION, summary: { status: 'PLAN_FILE_MISSING', approvalId: approvalId, target: path.resolve(targetPath), note: '初始化计划文件缺失：' + planPath },
        violations: [{ code: null, message: '初始化计划文件缺失：' + planPath }], blockers: []
      };
    }
  }
  const reject = function (status, code, message, exitCode) {
    return {
      exitCode: exitCode === undefined ? EXIT.VIOLATION : exitCode,
      summary: { status: status, approvalId: approvalId, target: path.resolve(targetPath), note: message },
      violations: [{ code: code, message: message }], blockers: []
    };
  };

  // 预检 1（目标防覆盖）：目标已存在即停止，任何写入之前（§5.6.5.8.2 A5 / 情形⑨）
  try { fs.lstatSync(targetPath); return reject('INIT_TARGET_EXISTS', null, '目标已存在，拒绝覆盖（未做任何写入）', EXIT.IO); }
  catch (e) { if (!e || e.code !== 'ENOENT') { return reject('INIT_IO_ERROR', null, '目标探测失败：' + String(e && e.code), EXIT.IO); } }

  // 预检 2（执行环境）：目录 fsync 能力，写入前（§5.6.5.10 Q-4 fail-closed；Windows 正式路径必停于此）
  const dir = path.dirname(path.resolve(targetPath));
  const fsyncCheck = (typeof o.__testFsyncProbe === 'function') ? o.__testFsyncProbe() : checkDirFsync(dir);
  if (!fsyncCheck.ok) {
    return reject('INIT_FSYNC_UNAVAILABLE', 'INIT_FSYNC_UNAVAILABLE', fsyncCheck.message + '；按 §5.6.5.10 Q-4 fail-closed，不降级、不写入（A′：执行环境须为支持目录 fsync 的文件系统）', EXIT.IO);
  }

  // 预检 3（审批记录）：缺失 = 校验类失败/退出码 1（G-4=C，不得以 W 警告代替）；
  // 存在但字段不满足 = E26（草案 result≠approved 不构成有效审批）
  const approvalPath = path.join(approvalDir, approvalId + '.json');
  let approval = null;
  try { approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8')); }
  catch (e) { return reject('APPROVAL_MISSING', null, '审批记录缺失或不可解析：' + approvalPath + '（G-4=C：初始化侧缺失即失败，不得伪造、补造或推定已获批准）', EXIT.VIOLATION); }
  const needFields = ['approvedRole', 'scope', 'planRef', 'planDigest', 'result', 'approvedAt', 'mapVersion', 'frozenMapSha256'];
  const missFields = needFields.filter(function (k) {
    const v = approval[k];
    return v === undefined || v === null || v === '';
  });
  if (missFields.length > 0 || approval.approvedRole !== '项目负责人' || approval.result !== 'approved' || approval.approvalId !== approvalId) {
    return reject('APPROVAL_INVALID', 'E26_APPROVAL_INVALID',
      '审批记录存在但内容不满足要求' + (missFields.length ? '（缺失字段：' + missFields.join('、') + '）' : '') +
      (approval.result !== undefined && approval.result !== 'approved' ? '（result=' + JSON.stringify(approval.result) + '：未签署草案不构成有效审批）' : '') +
      (approval.approvedRole !== undefined && approval.approvedRole !== '项目负责人' ? '（approvedRole 非法）' : '') +
      (approval.approvalId !== undefined && approval.approvalId !== approvalId ? '（approvalId 不匹配）' : ''), EXIT.VIOLATION);
  }

  // 预检 4（planDigest 绑定）：审批摘要必须与当前计划复算一致（E25；fail-closed，不得按旧批准放行）
  const vd = verifyPlanDigest(planText, approval.planDigest);
  if (!vd.ok) { return reject('PLAN_DIGEST_MISMATCH', 'E25_PLAN_DIGEST_MISMATCH', vd.message, EXIT.VIOLATION); }

  // 预检 5（冻结映射完整性）：与审批绑定的哈希一致（冻结映射变化即拒绝）
  let frozen = null;
  let frozenBytes = null;
  try { frozenBytes = fs.readFileSync(frozenMapPath); frozen = JSON.parse(frozenBytes.toString('utf8')); }
  catch (e) { return reject('FROZEN_MAP_UNREADABLE', null, '冻结映射缺失或不可解析：' + frozenMapPath, EXIT.VIOLATION); }
  const frozenSha = sha256Hex(frozenBytes);
  if (typeof approval.frozenMapSha256 !== 'string' || approval.frozenMapSha256.toLowerCase() !== frozenSha) {
    return reject('FROZEN_MAP_MISMATCH', null, '冻结映射与审批绑定哈希不一致（实测 sha256=' + frozenSha + '）：冻结映射可能已变化，拒绝初始化', EXIT.VIOLATION);
  }

  // 预检 6（对账 + 基线）：orphan 证明、唯一性、区间、C 档保护、生成器实测与基线一致
  const plan = Array.isArray(o.records) ? { records: o.records } : buildInitPlanRecords({});
  const recs = plan.records;
  const withIds = recs.filter(function (r) { return r.dishId; });
  const t49Recs = recs.filter(function (r) { return r.stallId === 'c01_t49'; });
  const t48Recs = recs.filter(function (r) { return r.stallId === 'c01_t48'; });
  const idSeen = Object.create(null);
  let dupIdCount = 0;
  withIds.forEach(function (r) { if (idSeen[r.dishId]) { dupIdCount += 1; } idSeen[r.dishId] = 1; });
  if (recs.length !== 525 || withIds.length !== 490 || (recs.length - withIds.length) !== 35 ||
      dupIdCount !== 0 || t49Recs.length !== 27 || t48Recs.length !== 77) {
    return reject('BASELINE_MISMATCH', null,
      '生成器实测与基线不符（基线 525/490/35/dupIds 0/t49 27/t48 77）：total=' + recs.length +
      ' withId=' + withIds.length + ' dupId=' + dupIdCount + ' t49=' + t49Recs.length + ' t48=' + t48Recs.length, EXIT.VIOLATION);
  }
  if (!Array.isArray(frozen.entries) || frozen.entries.length !== 104) {
    return reject('RECONCILE_MISMATCH', null, '冻结映射条目数 ≠ 104（实测 ' + (Array.isArray(frozen.entries) ? frozen.entries.length : '非数组') + '）', EXIT.VIOLATION);
  }
  const frozenKeys = Object.create(null);
  const frozenIds = Object.create(null);
  let fDupKey = 0;
  let fDupId = 0;
  frozen.entries.forEach(function (e) {
    if (frozenKeys[e.key]) { fDupKey += 1; } frozenKeys[e.key] = 1;
    if (e.dishId) { if (frozenIds[e.dishId]) { fDupId += 1; } frozenIds[e.dishId] = 1; }
  });
  if (fDupKey !== 0 || fDupId !== 0) {
    return reject('RECONCILE_MISMATCH', null, '冻结映射存在重复键/重复 ID：dupKey=' + fDupKey + ' dupId=' + fDupId, EXIT.VIOLATION);
  }
  const foreign = frozen.entries.filter(function (e) { return e.stallId !== 'c01_t48' && e.stallId !== 'c01_t49'; });
  if (foreign.length > 0) {
    return reject('RECONCILE_MISMATCH', null, '冻结映射含 t48/t49 之外的条目（首版仅允许 104 条，C 档与 35 条未分配记录不得纳入）：' + foreign.slice(0, 3).map(function (e) { return e.key; }).join('、'), EXIT.VIOLATION);
  }
  const genKeys = Object.create(null);
  t49Recs.concat(t48Recs).forEach(function (r) { genKeys[r.key] = r; });
  const missKeys = [];
  const extraKeys = [];
  const diffIds = [];
  frozen.entries.forEach(function (e) {
    if (!genKeys[e.key]) { missKeys.push(e.key); }
    else if (genKeys[e.key].dishId !== e.dishId) { diffIds.push(e.key); }
  });
  Object.keys(genKeys).forEach(function (k) { if (!frozenKeys[k]) { extraKeys.push(k); } });
  if (missKeys.length > 0 || extraKeys.length > 0 || diffIds.length > 0) {
    return reject('RECONCILE_MISMATCH', null, '对账失败（orphan 证明不成立）：冻结映射缺=' + missKeys.length + ' 多=' + extraKeys.length + ' ID不一致=' + diffIds.length +
      (missKeys.length ? '；缺：' + missKeys.slice(0, 3).join('、') : '') +
      (extraKeys.length ? '；多：' + extraKeys.slice(0, 3).join('、') : '') +
      (diffIds.length ? '；异：' + diffIds.slice(0, 3).join('、') : ''), EXIT.VIOLATION);
  }
  const num = function (s) { return parseInt(String(s).match(/d(\d+)$/)[1], 10); };
  const t49Nums = frozen.entries.filter(function (e) { return e.stallId === 'c01_t49'; }).map(function (e) { return num(e.dishId); });
  const t48Nums = frozen.entries.filter(function (e) { return e.stallId === 'c01_t48'; }).map(function (e) { return num(e.dishId); });
  if (t49Nums.length !== 27 || Math.min.apply(null, t49Nums) !== 437 || Math.max.apply(null, t49Nums) !== 463 ||
      t48Nums.length !== 77 || Math.min.apply(null, t48Nums) !== 464 || Math.max.apply(null, t48Nums) !== 540) {
    return reject('RECONCILE_MISMATCH', null, '区间断言失败（基线 t49=27×d437–463、t48=77×d464–d540）：t49=' + t49Nums.length + ' t48=' + t48Nums.length, EXIT.VIOLATION);
  }

  // 预检 7（转换 + 结构校验）：确定性 payload；validateMapStructure 五步（E13/E14/E15）
  const payloadObj = buildInitPayloadFromFrozen(frozen, approval, approvalId);
  const structErr = validateMapStructure(payloadObj);
  if (structErr) { return reject('BAD_PAYLOAD', structErr.code, 'payload 第 ' + structErr.step + ' 步校验失败：' + structErr.message, EXIT.VIOLATION); }
  const payloadText = canonicalJsonStringify(payloadObj);

  // 预检 8（唯一写盘点）：initIdMap（A′ 两阶段目录 fsync + 防覆盖 + 读回核验；测试替身透传）
  const init = initIdMap(payloadText, targetPath, o);
  return {
    exitCode: init.exitCode,
    summary: {
      status: init.status, approvalId: approvalId, target: (init.target || path.resolve(targetPath)),
      phase: init.phase || null, wrote: init.wrote === true,
      digest: init.digest || null,
      payloadSha256: sha256Hex(Buffer.from(payloadText, 'utf8')),
      entries: 104, mapVersion: approval.mapVersion, note: init.message
    },
    violations: init.code ? [{ code: init.code, message: init.message }] : [],
    blockers: []
  };
}

// ── C 段：只读「初始化计划」输出（契约 §5.6.5.8 九项；不写任何文件）──────────
// 只读输出：不创建 id-map.json、不分配正式 ID、不写 records/清单/审批。
// 未决事项见 ambiguities（A1 groupKey 取值 / A2 assignedAt·approvedBy / A3 dishId=null 的 status）。
function parseRosterRows(contractText) {
  const doc = parseDoc(contractText, { file: 'contract' });
  const out = { f2: [], f3: [], tables: 0, problems: [] };
  doc.tables.forEach(function (t) {
    const h = (t.header || []).map(stripMd);
    const col = function (needle) {
      for (let i = 0; i < h.length; i += 1) { if (h[i].indexOf(needle) >= 0) { return i; } }
      return -1;
    };
    const cSid = col('stallId');
    const cCount = col('记录数');
    const isF2 = h.some(function (x) { return x.indexOf('名册位次') >= 0; }) && cSid >= 0 && cCount >= 0;
    const isF3 = h.some(function (x) { return x.indexOf('3F 编号') >= 0; }) && cSid >= 0 && cCount >= 0;
    if (!isF2 && !isF3) { return; }
    out.tables += 1;
    const cName = isF2 ? col('名册原文') : col('招牌原文');
    const cShot = isF2 ? col('已拍编号') : 0;
    const cTier = col('档');
    const cRange = col('dishId');
    t.rows.forEach(function (row) {
      const c = row.cells.map(stripMd);
      const sidCell = c[cSid] || '';
      const m = sidCell.match(/c01_t\d+/);
      if (!m) { out.problems.push({ code: 'ROSTER_ROW_NO_STALL', line: row.line }); return; }
      const rng = cRange >= 0 ? String(c[cRange] || '').match(/c01_d(\d+)[^0-9]+c01_d(\d+)/) : null;
      const shotRaw = cShot >= 0 ? String(c[cShot] || '').trim() : '';
      out[isF2 ? 'f2' : 'f3'].push({
        kind: isF2 ? '2F' : '3F',
        roster: String(c[0] || '').trim(),
        name: cName >= 0 ? String(c[cName] || '').trim() : '',
        stallId: m[0],
        shot: isF2 ? (/^W2-\d+$/.test(shotRaw) ? shotRaw : '') : (/^W\d{2}$/.test(shotRaw) ? shotRaw : ''),
        count: cCount >= 0 && /^\d+$/.test(String(c[cCount] || '').trim()) ? Number(String(c[cCount]).trim()) : null,
        tier: cTier >= 0 && /^[ABC]$/.test(String(c[cTier] || '').trim()) ? String(c[cTier]).trim() : null,
        from: rng ? Number(rng[1]) : null,
        to: rng ? Number(rng[2]) : null,
        line: row.line
      });
    });
  });
  return out;
}

function buildInitPlanRecords(options) {
  const addons = [];
  const o = options || {};
  const root = o.root || __dirname;
  const read = function (rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); };
  const contractText = o.contractText != null ? o.contractText : read('../../docs/RECORD_GENERATOR_CONTRACT_20261023.md');
  const t2 = o.text2F != null ? o.text2F : read('TRANSCRIPTION_2F.md');
  const t3 = o.text3F != null ? o.text3F : read('TRANSCRIPTION_3F.md');
  const roster = parseRosterRows(contractText);
  const ambiguities = [
    'A1 键的 groupKey：§5.6.3 示例用牌面原文，而 makeKeyFrom() 读 gen.groupKey（含层前缀）；本输出按牌面原文构造，二者待裁决',
    'A2 计划条目是否必须携带 assignedAt / approvedBy：初始化前尚未产生，本输出不产出（缺项）',
    'A3 dishId=null 的计划条目应取何种 status：E-4 禁止 active，pending_review 语义为已建档未批准，计划阶段是否可用待裁决',
    'A4 W2-03「双拼组成」表（2F §4.1）是否属契约允许的记录来源形态：该表为组合说明而非价目行，本输出不将其转为菜品记录，待裁决',
    'A5 W2-03 双拼牌面 3 组同名价格冲突（秘制红烧肉 15/16、红烧鸡翅根 13/12、黑椒鸡排 14/13）：已按 2026-10-25 裁决以 disambiguator 区分商品并保留双方原价与来源，现行价待现场核实，不得把「不同价格」解释为「现行价已确定」',
    'A6 source_detail 仅对照片映射已确认的表生成（当前仅 W2-04 蛋炒 39 条，第 9 张，契约 §5.4 / 2F §8.2 模板）；其余记录因「第 N 张」未确认置 null，不编造来源细节，待照片映射或组说明裁决后补齐'
  ];
  const byShot = {};
  roster.f2.concat(roster.f3).forEach(function (r) { if (r.shot) { byShot[r.kind + ':' + r.shot] = r; } });
  const records = [];
  const perStall = {};
  const problems = [];
  function take(doc, file, kind) {
    const parsed = parseDoc(doc, { file: file });
    const rawLines = String(doc).split(/\r?\n/);
    const re = kind === '3F' ? /(W\d{2})/ : /(W2-\d+)/;
    parsed.tables.forEach(function (table) {
      const mm = re.exec(table.section || '');
      if (!mm) { return; }
      if (retiredTableFor(table, file)) {
        problems.push({ code: 'TABLE_SKIPPED', file: file, section: table.section, line: table.startLine, note: '原表已被展开表取代（2026-10-25 方案 A 裁决），保留原文不生成记录' });
        return;
      }
      const row = byShot[kind + ':' + mm[1]];
      if (!row) {
        if (kind === '2F' && (mm[1] === 'W2-04' || mm[1] === 'W2-05')) {
          const sink2 = [];
          let recs2 = [];
          try {
            recs2 = expandTable(table, { shopId: 'c01', stallId: null, prefix: '', blockers: sink2 });
          } catch (e) {
            problems.push({ code: 'TABLE_SKIPPED', file: file, section: table.section, line: table.startLine, note: String((e && e.code) || (e && e.message)) });
            return;
          }
          sink2.forEach(function (x) { problems.push({ code: x.code, file: file, line: x.line, note: x.note }); });
          const st2 = perStall['NO_STALL:' + mm[1]] || (perStall['NO_STALL:' + mm[1]] = { stallId: null, kind: row ? row.kind : '2F', tier: null, from: null, to: null, expected: null, n: 0 });
          const sdCtx = sourceDetailCtxFor(table, file);
          recs2.forEach(function (r) {
            st2.n += 1;
            let sd = null;
            if (sdCtx) {
              const flavor = sdCtx.flavorAt(r.gen.sourceLine);
              if (flavor) {
                sd = buildSourceDetail(r, { rawText: flavor + sdCtx.prepSuffix, groupNote: sdCtx.groupNote, photoSeq: sdCtx.photoSeq });
              }
            }
            records.push({
              key: 'NO_STALL:' + mm[1] + '|' + String(r.gen.rawGroupKey == null ? '' : r.gen.rawGroupKey) + '|' + String(r.gen.specLabel || '') + '|',
              stallId: null, groupKey: r.gen.rawGroupKey, specLabel: r.gen.specLabel || '', disambiguator: '',
              dishId: null, tier: null,
              sourceFile: file, sourceSection: table.section, sourceLine: r.gen.sourceLine,
              sourceRef: file + '#' + (table.section || '').slice(0, 5) + ' 第 ' + r.gen.sourceLine + ' 行',
              source_detail: sd,
              name: r.name, price: r.price, foodType: r.foodType
            });
          });
          problems.push({ code: 'BLOCKED_NO_ROSTER', file: file, shot: mm[1], line: table.startLine, note: '名册无对应项：stallId/dishId 均为 null（§5.6.4）' });
          return;
        }
        problems.push({ code: 'ROSTER_NOT_FOUND', file: file, shot: mm[1], line: table.startLine });
        return;
      }
      const sink = [];
      let recs = [];
      const pkgWhitelisted = isWhitelistedPackageTable(table, file);
      try {
        recs = pkgWhitelisted
          ? expandPackageTable(table, { shopId: 'c01', stallId: row.stallId, prefix: '', blockers: sink, addons: addons, sourceFile: file })
          : expandTable(table, { shopId: 'c01', stallId: row.stallId, prefix: '', blockers: sink, addons: addons, sourceFile: file });
      } catch (e) {
        problems.push({ code: 'TABLE_SKIPPED', file: file, section: table.section, line: table.startLine, note: String((e && e.code) || (e && e.message)) });
        return;
      }
      sink.forEach(function (x) { problems.push({ code: x.code, file: file, line: x.line, note: x.note }); });
      const disamb = comboDisambigFor(table, file, rawLines);
      const sdCtx = sourceDetailCtxFor(table, file);
      recs.forEach(function (r) {
        const st = perStall[row.stallId] || (perStall[row.stallId] = { stallId: row.stallId, kind: row.kind, tier: row.tier, from: row.from, to: row.to, expected: row.count, n: 0 });
        st.n += 1;
        const seq = st.from == null ? null : st.from + st.n - 1;
        const overflow = seq != null && st.to != null && seq > st.to;
        if (overflow) { problems.push({ code: 'RANGE_OVERFLOW', file: file, stallId: st.stallId, line: r.gen.sourceLine, note: '实际记录数超出名册区间' }); }
        const candidate = (st.tier === 'C' || seq == null || overflow) ? null : ('c01_d' + String(seq).padStart(3, '0'));
        let sd = null;
        if (sdCtx) {
          const flavor = sdCtx.flavorAt(r.gen.sourceLine);
          if (flavor) { sd = buildSourceDetail(r, { rawText: flavor + sdCtx.prepSuffix, groupNote: sdCtx.groupNote, photoSeq: sdCtx.photoSeq }); }
        }
        records.push({
          key: (function () {
            const mk = makeKeyFrom({ stallId: row.stallId, gen: { rawGroupKey: r.gen.rawGroupKey, specLabel: r.gen.specLabel || '', disambiguator: disamb } });
            return mk.ok ? mk.key : ('UNCONSTRUCTIBLE:' + row.stallId + ':' + r.gen.sourceLine);
          })(),
          stallId: row.stallId, groupKey: r.gen.rawGroupKey, specLabel: r.gen.specLabel || '', disambiguator: disamb,
          dishId: candidate, tier: st.tier,
          sourceFile: file, sourceSection: table.section, sourceLine: r.gen.sourceLine,
          sourceRef: file + '#' + (table.section || '').slice(0, 5) + ' 第 ' + r.gen.sourceLine + ' 行',
          source_detail: sd,
          name: r.name, price: r.price, foodType: r.foodType
        });
      });
    });
  }
  take(t2, 'TRANSCRIPTION_2F.md', '2F');
  take(t3, 'TRANSCRIPTION_3F.md', '3F');
  const km = {};
  records.forEach(function (r) { km[r.key] = (km[r.key] || 0) + 1; });
  const im = {};
  records.forEach(function (r) { if (r.dishId) { im[r.dishId] = (im[r.dishId] || 0) + 1; } });
  const dupKeys = Object.keys(km).filter(function (k) { return km[k] > 1; });
  const dupIds = Object.keys(im).filter(function (k) { return im[k] > 1; });
  const dupDetail = dupKeys.map(function (k) {
    return { key: k, n: km[k], sample: records.filter(function (r) { return r.key === k; }).map(function (r) { return { file: r.sourceFile, line: r.sourceLine, name: r.name, price: r.price, specLabel: r.specLabel }; }) };
  });
  // W2-03 第二阶段：RANGE_COLLISION 三项（§6.1 新增规则，2026-10-25）
  const collide = [];
  Object.keys(im).filter(function (k) { return im[k] > 1; }).forEach(function (k) {
    collide.push({ code: 'RANGE_COLLISION', kind: 'duplicate_id', file: '', stallId: null, line: null, dishId: k, note: '同店完整 dishId 重复：' + k + ' 出现 ' + im[k] + ' 次' });
  });
  const rngStalls = Object.keys(perStall).map(function (k) { return perStall[k]; }).filter(function (s) { return s.from != null && s.to != null; });
  const sorted = rngStalls.slice().sort(function (a, b) { return a.from - b.from; });
  for (let ci = 1; ci < sorted.length; ci += 1) {
    const prev = sorted[ci - 1]; const cur = sorted[ci];
    if (cur.from <= prev.to) {
      collide.push({ code: 'RANGE_COLLISION', kind: 'interval_overlap', file: '', stallId: cur.stallId, line: null, dishId: null, note: '区间相交：' + prev.stallId + ' d' + prev.from + '-d' + prev.to + ' 与 ' + cur.stallId + ' d' + cur.from + '-d' + cur.to });
    }
  }
  const stallNo = function (id) { return parseInt(String(id).replace(/[^0-9]/g, ''), 10); };
  const f2r = rngStalls.filter(function (s) { const n = stallNo(s.stallId); return n >= 1 && n <= 37; });
  const f3r = rngStalls.filter(function (s) { const n = stallNo(s.stallId); return n >= 38 && n <= 47; });
  if (f2r.length && f3r.length) {
    const e2 = Math.max.apply(null, f2r.map(function (s) { return s.to; }));
    const s3 = Math.min.apply(null, f3r.map(function (s) { return s.from; }));
    if (e2 >= s3) {
      collide.push({ code: 'RANGE_COLLISION', kind: 'floor_order_violation', file: '', stallId: null, line: null, dishId: null, note: '跨楼层顺序违规：2F 末位 d' + e2 + ' ≥ 3F 起点 d' + s3 });
    }
  }
  collide.forEach(function (x) { problems.push(x); });
  const rosterExpected = {};
  roster.f2.concat(roster.f3).forEach(function (r) { if (r.count != null) { rosterExpected[r.stallId] = r.count; } });
  const perKind = { '2F': records.filter(function (r) { return r.sourceFile === 'TRANSCRIPTION_2F.md'; }).length, '3F': records.filter(function (r) { return r.sourceFile === 'TRANSCRIPTION_3F.md'; }).length };
  return {
    ok: dupKeys.length === 0 && dupIds.length === 0 && collide.length === 0,
    records: records, perStall: perStall, perKind: perKind, rosterExpected: rosterExpected,
    roster: { f2: roster.f2.length, f3: roster.f3.length, tables: roster.tables },
    counts: { total: records.length, withId: records.filter(function (r) { return !!r.dishId; }).length, nullId: records.filter(function (r) { return !r.dishId; }).length, dupKeys: dupKeys.length, dupIds: dupIds.length },
    dupDetail: dupDetail, problems: problems, ambiguities: ambiguities,
    addons: addons, collisions: collide };
}

// ── 测试专用命名空间：恰 9 个冻结名字（G-7=O-1）──────────────────────
const __test__ = Object.freeze({
  parseDoc: parseDoc,
  classifyTable: classifyTable,
  expandTable: expandTable,
  buildSourceDetail: buildSourceDetail,
  judgeGeneration: judgeGeneration,
  judgeEvidence: judgeEvidence,
  judgeEligibility: judgeEligibility,
  summarize: summarize,
  assertContract: assertContract
});

function main(argv) {
  const parsed = parseArgv(argv);
  if (!parsed.ok) {
    process.stdout.write(parsed.code + '（第 ' + parsed.step + ' 步）' + parsed.detail + '\n');
    process.exit(parsed.exitCode);
  }
  // init 是显式独立子命令；普通 gen/dry-run/write 分派不变、无初始化副作用
  const result = parsed.subcommand === INIT_SUBCOMMAND
    ? runInit({ approvalId: parsed.approvalId })
    : run({ mode: parsed.mode, outDir: parsed.outDir });
  process.stdout.write('run() status=' + result.summary.status + ' mode=' + (result.summary.mode || (parsed.subcommand === INIT_SUBCOMMAND ? 'init' : parsed.mode)) + ' outDir=' + String(result.summary.outDir || result.summary.target || '') + '\n');
  result.violations.forEach(function (v) { process.stdout.write('violation ' + v.code + '：' + v.message + '\n'); });
  process.exit(result.exitCode);
}

module.exports = Object.freeze({ run: run, runInit: runInit, __test__: __test__ });

if (require.main === module) {
  main(process.argv.slice(2));
}
