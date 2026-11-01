#!/usr/bin/env node
'use strict';

/**
 * 安全数据导入：CSV 表格 → 校验 → 预览 → （只有显式 --write 才）写入隔离目录
 *
 * 设计边界（本文件的六条硬规则）：
 *   1. 默认只预览。不带 --write 时只读文件、只打印，绝不创建、修改、删除任何文件。
 *   2. 只新增，不覆盖。与现有 id 冲突的整条记录被拒绝；不静默覆盖演示数据。
 *   3. 写入目标必须显式给出（--out <目录>），且与 data/ 隔离。
 *      本工具永远不会写 data/shops.js、data/dishes.js 或任何 pages/、utils/ 下的文件。
 *      这条现在由 assertSafeOutDir() 真正强制（A2 之前只是文件头的承诺）。
 *   4. 导入记录一律 unverified。CSV 里写 verify_status=verified 无效，只作为错误被拒绝。
 *   5. 增量追加只支持「给已有店铺补菜品」。给已有店铺补楼层/窗口需要 patch 格式，本轮显式拒绝。
 *   6. 证据文件必须真实存在。只要填了 evidence_file，就按「相对 CSV 目录」解析并检查；
 *      写成绝对路径也可以。加 --require-evidence 则**逐项**要求每条记录都有
 *      collector / collect_date（合法日期）/ evidence_file（真实文件），缺一项就拒。
 *
 * 校验不复制规则：全部交给 tools/verify_data.js 的 validateDataset()，
 * 本文件只负责「把 CSV 变成记录」和「安全落盘」。
 *
 * 用法：
 *   node tools/import_data.js                              预览（读 tools/templates）
 *   node tools/import_data.js --dir <CSV目录>               预览自定义目录
 *   node tools/import_data.js --dir <CSV目录> --no-require-evidence
 *                                                          关闭证据文件存在性检查（不推荐）
 *   node tools/import_data.js --write --out <输出目录>      校验通过后写入隔离目录
 *   node tools/import_data.js --all                        显示全部问题（默认只显示前 20 条）
 *
 * 退出码：
 *   0 = 无拒绝、校验通过（dry-run 也返回 0）
 *   1 = 存在被拒绝的记录或校验错误（含 CSV 格式错误、证据文件缺失）
 *   2 = 用法错误（例如 --write 却没有给 --out，或 --out 指向受保护目录）
 *   3 = 写入阶段失败（已回滚或部分回滚，具体在输出里写明）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const verify = require('./verify_data');
const provenance = require('../data/provenance');
const { SHOPS } = require('../data/shops');
const { DISHES } = require('../data/dishes');

const TEMPLATE_DIR = path.join(__dirname, 'templates');

/* 模板示例行的 id 前缀。以它开头的一律视为「格式示例」，跳过而不导入 */
const EXAMPLE_ID_PREFIX = 'ex_';

/* 记录类型：模型目前只能表达「菜品」，其余显式拒绝，不偷偷当成普通菜 */
const RECORD_TYPE_DISH = '菜品';
const RECORD_TYPES_UNSUPPORTED = ['套餐', '加料', '店铺规则'];

const EXIT = { OK: 0, INVALID: 1, USAGE: 2, WRITE_FAILED: 3 };

/* 证据三件套：四张表都必须能填（A2 之前只有 shops / dishes 有） */
const EVIDENCE_COLUMNS = ['collector', 'collect_date', 'evidence_file'];

/* 绝不允许作为 --out 的目录（相对 ROOT）：写进去就等于在改运行时数据或源码 */
const PROTECTED_DIRS = ['data', 'pages', 'utils', 'cloudfunctions', 'tools', 'assets', 'config', 'design', 'docs'];

/* ------------------------------------------------------------------
   表结构定义
   ------------------------------------------------------------------ */

const SCHEMAS = {
  shops: {
    file: 'shops.csv',
    label: '店铺',
    key: 'shop_id',
    columns: [
      'shop_id', 'shop_name', 'area', 'building', 'location',
      'source_kind', 'source_detail', 'source_ref',
      'collector', 'collect_date', 'evidence_file'
    ]
  },
  floors: {
    file: 'floors.csv',
    label: '楼层',
    key: 'floor_id',
    columns: [
      'shop_id', 'floor_id', 'floor_label',
      'source_kind', 'source_detail', 'source_ref',
      'collector', 'collect_date', 'evidence_file'
    ]
  },
  stalls: {
    file: 'stalls.csv',
    label: '窗口',
    key: 'stall_id',
    columns: [
      'shop_id', 'floor_id', 'stall_id', 'stall_name',
      'side', 'no_status', 'no',
      'source_kind', 'source_detail', 'source_ref',
      'collector', 'collect_date', 'evidence_file'
    ]
  },
  dishes: {
    file: 'dishes.csv',
    label: '菜品',
    key: 'dish_id',
    columns: [
      'dish_id', 'dish_name', 'record_type', 'shop_id', 'stall_id',
      'price', 'food_type', 'tastes',
      'source_kind', 'source_detail', 'source_ref',
      'collector', 'collect_date', 'evidence_file'
    ]
  }
};

/* 不允许出现在 CSV 里的列：可信度状态只能由程序决定 */
const FORBIDDEN_COLUMNS = ['verify_status', 'verifyStatus', 'verified_at', 'verifiedAt'];

/* ------------------------------------------------------------------
   投稿端目标 ID 形状校验（P1，opt-in）
   ------------------------------------------------------------------
   与 cloudfunctions/submit/index.js 的 ID_RE 保持一致：
     shop  c\d{2}          stall c\d{2}_t\d{2}      dish c\d{2}_d\d{3}
   默认不启用；--check-submit-ids 打开后，任何「能通过导入、但在投稿端一定过不了
   形状校验」的 ID 会被拦下，避免导入成功却永远无法被纠错投稿命中。
   只读：不生成 ID、不改 ID、不写文件。
   ------------------------------------------------------------------ */

const SUBMIT_ID_RE = Object.freeze({
  shopId: /^c\d{2}$/,
  stallId: /^c\d{2}_t\d{2}$/,
  dishId: /^c\d{2}_d\d{3}$/
});

/**
 * @param {{shops?:Array, stalls?:Array, dishes?:Array}} tables 原始 CSV 记录（字段为 shop_id / stall_id / dish_id）
 * @param {{checkSubmitIds?:boolean}} opts 只有 checkSubmitIds === true 时才校验
 * @return {string[]} 问题描述；空数组表示通过或未启用
 */
function checkSubmitIds(tables, opts) {
  if (!opts || opts.checkSubmitIds !== true) return [];
  const problems = [];
  const shops = (tables && tables.shops) || [];
  const stalls = (tables && tables.stalls) || [];
  const dishes = (tables && tables.dishes) || [];
  /* readTable 之后字段已归一化为 camelCase，但直接传原始表时仍是 snake_case，两种都读 */
  function field(r, camel, snake) {
    return r[camel] !== undefined ? r[camel] : r[snake];
  }
  shops.forEach(function (r) {
    const id = field(r, 'shopId', 'shop_id');
    if (!SUBMIT_ID_RE.shopId.test(String(id || ''))) {
      problems.push('shop_id 形状不合投稿约束：' + JSON.stringify(id) + '（应为 c + 两位数字，如 c02）');
    }
  });
  stalls.forEach(function (r) {
    const id = field(r, 'stallId', 'stall_id');
    if (!SUBMIT_ID_RE.stallId.test(String(id || ''))) {
      problems.push('stall_id 形状不合投稿约束：' + JSON.stringify(id) + '（应为 c + 两位数字 + _t + 两位数字，如 c02_t02）');
    }
  });
  dishes.forEach(function (r) {
    const id = field(r, 'dishId', 'dish_id');
    if (!SUBMIT_ID_RE.dishId.test(String(id || ''))) {
      problems.push('dish_id 形状不合投稿约束：' + JSON.stringify(id) + '（应为 c + 两位数字 + _d + 三位数字，如 c02_d060）');
    }
  });
  return problems;
}

/* ------------------------------------------------------------------
   CSV 解析（RFC 4180 子集：BOM / 引号 / 字段内逗号 / 字段内换行 / CRLF）
   绝不用 split(',')
   ------------------------------------------------------------------ */

/**
 * @param {string} text 原始 CSV 文本
 * @return {string[][]} 行 × 列的二维数组，首行是表头
 */
function parseCsv(text) {
  if (typeof text !== 'string') {
    throw new Error('CSV 内容必须是字符串');
  }
  let s = text;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); /* 去掉 UTF-8 BOM */

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let fieldStarted = false;

  while (i < s.length) {
    const ch = s[i];

    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"') {
      if (fieldStarted) {
        throw new Error('CSV 格式错误：双引号只能出现在字段开头（第 ' + (rows.length + 1) + ' 行附近）');
      }
      inQuotes = true; fieldStarted = true; i += 1; continue;
    }

    if (ch === ',') {
      row.push(field); field = ''; fieldStarted = false; i += 1; continue;
    }

    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && s[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = []; field = ''; fieldStarted = false; i += 1; continue;
    }

    field += ch; fieldStarted = true; i += 1;
  }

  if (inQuotes) throw new Error('CSV 格式错误：双引号未闭合');

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  /* 丢掉完全空白的行（末尾换行、空行），但保留「有空字段」的行 */
  return rows.filter(function (r) {
    return r.some(function (cell) { return String(cell).trim() !== ''; });
  });
}

/**
 * 表头 + 数据行 → 记录数组。列顺序无关，靠表头名字取值。
 * @return {{records: object[], errors: string[], warnings: string[]}}
 */
function rowsToRecords(rows, schema) {
  const errors = [];
  const warnings = [];
  const records = [];

  if (!rows.length) {
    errors.push(schema.file + '：文件为空（至少要有一行表头）');
    return { records: records, errors: errors, warnings: warnings };
  }

  const header = rows[0].map(function (h) { return String(h).trim(); });

  /* 表头去重 */
  const seen = {};
  header.forEach(function (h) {
    if (seen[h]) warnings.push(schema.file + '：表头列 ' + h + ' 重复，后一列被忽略');
    seen[h] = true;
  });

  /* 必填列必须存在 */
  schema.columns.forEach(function (col) {
    if (header.indexOf(col) === -1) {
      errors.push(schema.file + '：缺少必需列 ' + col);
    }
  });

  /* 状态列禁止出现 */
  FORBIDDEN_COLUMNS.forEach(function (col) {
    if (header.indexOf(col) !== -1) {
      errors.push(schema.file + '：不允许 ' + col + ' 列 —— 核验状态由程序决定，导入一律 unverified');
    }
  });

  /* 未知列只警告，不影响导入 */
  header.forEach(function (h) {
    if (h && schema.columns.indexOf(h) === -1) {
      warnings.push(schema.file + '：未知列 ' + h + ' 被忽略');
    }
  });

  if (errors.length) return { records: records, errors: errors, warnings: warnings };

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const rec = { __row: r + 1, __file: schema.file };
    header.forEach(function (h, idx) {
      if (!h) return;
      rec[h] = idx < cells.length ? String(cells[idx]) : '';
    });
    if (cells.length > header.length) {
      warnings.push(schema.file + '：第 ' + (r + 1) + ' 行有 ' + (cells.length - header.length) + ' 个多余字段，已忽略');
    }
    records.push(rec);
  }

  return { records: records, errors: errors, warnings: warnings };
}

/* ------------------------------------------------------------------
   读表
   ------------------------------------------------------------------ */

function readTable(dir, schema) {
  const file = path.join(dir, schema.file);
  if (!fs.existsSync(file)) {
    return {
      records: [],
      errors: ['缺少文件：' + schema.file + '（目录 ' + dir + '）'],
      warnings: [],
      sha256: '',
      missing: true
    };
  }
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const parsed = rowsToRecords(parseCsv(text), schema);
  parsed.sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  parsed.missing = false;
  return parsed;
}

/* ------------------------------------------------------------------
   记录构造
   ------------------------------------------------------------------ */

function isExampleId(id) {
  return String(id || '').toLowerCase().indexOf(EXAMPLE_ID_PREFIX) === 0;
}

function isNonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function trim(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/* 来源：只接受白名单里的值；demo 不允许通过导入制造 */
function buildSource(rec) {
  const kind = trim(rec.source_kind) || 'unknown';
  const allowed = provenance.KIND_VALUES;
  if (allowed.indexOf(kind) === -1) {
    return { error: '来源类型 ' + JSON.stringify(kind) + ' 不在允许值 ' + allowed.join('/') };
  }
  if (kind === 'demo') {
    return { error: '来源类型 demo 不允许通过导入创建（演示数据只能在 data/ 里手写）' };
  }
  return {
    source: provenance.makeSource(kind, trim(rec.source_detail), trim(rec.source_ref))
  };
}

/* 导入记录统一 unverified：状态与时间都由程序决定，不接受 CSV 指定 */
function metaOf(rec) {
  const s = buildSource(rec);
  if (s.error) return { error: s.error };
  return {
    meta: {
      source: s.source,
      verifyStatus: provenance.VERIFY_STATUS.UNVERIFIED,
      verifiedAt: null
    }
  };
}

function evidenceOf(rec) {
  return {
    collector: trim(rec.collector),
    collectDate: trim(rec.collect_date),
    evidenceFile: trim(rec.evidence_file)
  };
}

/* 证据路径解析：绝对路径直接用；相对路径只按 CSV 目录解析（不猜别的地方） */
function resolveEvidencePath(csvDir, file) {
  const raw = String(file || '').trim();
  if (!raw) return { exists: false, path: '' };
  const target = path.isAbsolute(raw) ? raw : path.resolve(csvDir, raw);
  let exists = false;
  try { exists = fs.statSync(target).isFile(); } catch (e) { exists = false; }
  return { exists: exists, path: target };
}

/* 增量追加暂不支持的两种情形，共用同一段可读解释 */
function patchHint(what, shopId) {
  return '给已有店铺（' + shopId + '）追加' + what + '需要 patch 格式（只描述新增部分），本轮尚未实现；'
    + '当前做法是「一家食堂一次采全、整套导入」，或等后续新增 patch 通道';
}

/* ------------------------------------------------------------------
   主体：CSV 表格 → 待写入记录 + 拒绝 / 跳过清单
   ------------------------------------------------------------------ */

function buildImport(tables, existing, opts) {
  const options = opts || {};
  const csvDir = options.dir ? path.resolve(options.dir) : '';
  const requireEvidence = options.requireEvidence === true;
  const rejected = [];
  const skipped = [];
  const warnings = [];
  const evidence = [];

  const newShops = [];
  const newDishes = [];
  const shopById = {};
  const floorIds = [];
  const stallIds = [];

  function reject(table, rec, reason) {
    rejected.push({
      table: table,
      file: rec.__file,
      row: rec.__row,
      id: trim(rec[SCHEMAS[table].key]) || '(缺少 id)',
      reason: reason
    });
  }

  /* 证据一律记在清单里（模型里没有位置存这三项），四张表都收。
     返回非空字符串表示这条记录在证据上不合格，调用方据此拒绝整条记录。

     --require-evidence 下三件套**逐项**校验（F1 之前的实现只判断「三项是否全空」，
     于是「只填了 evidence_file」也能通过，采集人和采集日期实际上没人管）：
       1) collector 必须非空
       2) collect_date 必须非空，且是合法日期（复用 provenance.isValidDateString，
          与数据层 verifiedAt 共用同一套「格式 + 真实日历日 + 不晚于今天」规则，
          避免两处规则不一致）
       3) evidence_file 必须非空，且文件真实存在

     普通预览模式：仍然允许三项全空；但**填了** collect_date 就必须是合法日期，
     填了 evidence_file 就必须真实存在（规范 §4 明确要求这两个字段一旦填写就要合规）。 */
  function checkEvidence(table, id, rec) {
    const ev = evidenceOf(rec);
    const hasAny = !!(ev.collector || ev.collectDate || ev.evidenceFile);
    if (!hasAny) {
      return requireEvidence
        ? '缺少证据：--require-evidence 要求每条记录都填 collector / collect_date / evidence_file（本条三项全空）'
        : '';
    }

    /* F1：逐项检查，缺哪项点名哪项。检查全部通过之后才进证据清单——
       否则被拒的记录也会出现在 manifest 的 evidence 数组里，清单就不可信了。 */
    if (requireEvidence) {
      const missing = [];
      if (!ev.collector) missing.push('collector（采集人）');
      if (!ev.collectDate) missing.push('collect_date（采集日期）');
      if (!ev.evidenceFile) missing.push('evidence_file（证据照片）');
      if (missing.length) {
        return '缺少证据字段：' + missing.join('、')
          + '（--require-evidence 要求三项逐项填写，缺一不可）';
      }
    }

    /* 填了日期就必须合法：把错值当「没填」放过，等于默许脏数据进库 */
    if (ev.collectDate && !provenance.isValidDateString(ev.collectDate)) {
      return 'collect_date 格式非法：' + JSON.stringify(ev.collectDate)
        + '（必须是 YYYY-MM-DD，且是真实存在的日期、不晚于今天）';
    }

    evidence.push(Object.assign({ table: table, id: id, row: rec.__row, file: rec.__file }, ev));

    if (!ev.evidenceFile) {
      return requireEvidence ? '缺少 evidence_file：--require-evidence 要求每条记录都有对应照片' : '';
    }
    if (!csvDir) {
      warnings.push(table + ' ' + id + '：未提供 CSV 目录，跳过 evidence_file 存在性检查');
      return '';
    }
    const resolved = resolveEvidencePath(csvDir, ev.evidenceFile);
    if (!resolved.exists) {
      return '证据文件不存在：' + ev.evidenceFile + '（按相对 CSV 目录解析为 ' + resolved.path + '）';
    }
    return '';
  }

  /* ---------- 1. 店铺 ---------- */
  tables.shops.forEach(function (rec) {
    const id = trim(rec.shop_id);
    if (isExampleId(id)) { skipped.push({ table: 'shops', row: rec.__row, id: id, reason: '模板示例行（' + EXAMPLE_ID_PREFIX + ' 前缀）' }); return; }
    if (existing.shopIds[id] || shopById[id]) { reject('shops', rec, '店铺 id 与现有数据或本次导入内重复：' + id); return; }
    const m = metaOf(rec);
    if (m.error) { reject('shops', rec, m.error); return; }
    const evErr = checkEvidence('shops', id, rec);
    if (evErr) { reject('shops', rec, evErr); return; }

    const shop = {
      id: id,
      name: trim(rec.shop_name),
      area: trim(rec.area),
      building: trim(rec.building),
      location: trim(rec.location),
      floors: [],
      stalls: [],
      source: m.meta.source,
      verifyStatus: m.meta.verifyStatus,
      verifiedAt: null
    };
    shopById[id] = shop;
    newShops.push(shop);
  });

  /* ---------- 2. 楼层 ---------- */
  tables.floors.forEach(function (rec) {
    const id = trim(rec.floor_id);
    const shopId = trim(rec.shop_id);
    if (isExampleId(id) || isExampleId(shopId)) { skipped.push({ table: 'floors', row: rec.__row, id: id, reason: '模板示例行' }); return; }
    const shop = shopById[shopId];
    if (!shop) {
      if (existing.shopIds[shopId]) { reject('floors', rec, patchHint('楼层', shopId)); return; }
      reject('floors', rec, '楼层只能挂在本次新增的店铺或现有店铺下，店铺 ' + JSON.stringify(shopId) + ' 两边都找不到');
      return;
    }
    if (existing.floorIds[id] || floorIds.indexOf(id) !== -1) { reject('floors', rec, '楼层 id 与现有数据或本次导入内重复：' + id); return; }
    const m = metaOf(rec);
    if (m.error) { reject('floors', rec, m.error); return; }
    const evErr = checkEvidence('floors', id, rec);
    if (evErr) { reject('floors', rec, evErr); return; }

    const floor = {
      id: id,
      label: trim(rec.floor_label),
      shopId: shopId,
      source: m.meta.source,
      verifyStatus: m.meta.verifyStatus,
      verifiedAt: null,
      __row: rec.__row,
      __file: rec.__file
    };
    shop.floors.push(floor);
    floorIds.push(id);
  });

  /* ---------- 3. 窗口 ---------- */
  tables.stalls.forEach(function (rec) {
    const id = trim(rec.stall_id);
    const shopId = trim(rec.shop_id);
    if (isExampleId(id) || isExampleId(shopId)) { skipped.push({ table: 'stalls', row: rec.__row, id: id, reason: '模板示例行' }); return; }
    const shop = shopById[shopId];
    if (!shop) {
      if (existing.shopIds[shopId]) { reject('stalls', rec, patchHint('窗口', shopId)); return; }
      reject('stalls', rec, '窗口只能挂在本次新增的店铺或现有店铺下，店铺 ' + JSON.stringify(shopId) + ' 两边都找不到');
      return;
    }
    if (existing.stallIds[id] || stallIds.indexOf(id) !== -1) { reject('stalls', rec, '窗口 id 与现有数据或本次导入内重复：' + id); return; }
    const m = metaOf(rec);
    if (m.error) { reject('stalls', rec, m.error); return; }
    const evErr = checkEvidence('stalls', id, rec);
    if (evErr) { reject('stalls', rec, evErr); return; }

    const stall = {
      id: id,
      floorId: trim(rec.floor_id),
      name: trim(rec.stall_name),
      source: m.meta.source,
      verifyStatus: m.meta.verifyStatus,
      verifiedAt: null,
      __row: rec.__row,
      __file: rec.__file
    };
    const side = trim(rec.side);
    if (side) stall.side = side;
    const noStatus = trim(rec.no_status);
    if (noStatus) stall.noStatus = noStatus;
    const no = trim(rec.no);
    if (no) stall.no = no;

    shop.stalls.push(stall);
    stallIds.push(id);
  });

  /* ---------- 4. 菜品 ---------- */
  tables.dishes.forEach(function (rec) {
    const id = trim(rec.dish_id);
    const shopId = trim(rec.shop_id);
    if (isExampleId(id) || isExampleId(shopId)) { skipped.push({ table: 'dishes', row: rec.__row, id: id, reason: '模板示例行' }); return; }

    const recordType = trim(rec.record_type) || RECORD_TYPE_DISH;
    if (RECORD_TYPES_UNSUPPORTED.indexOf(recordType) !== -1) {
      reject('dishes', rec, '记录类型「' + recordType + '」当前数据模型不支持，不能当成普通菜品导入（需先扩展模型）');
      return;
    }
    if (recordType !== RECORD_TYPE_DISH) {
      reject('dishes', rec, '记录类型 ' + JSON.stringify(recordType) + ' 不是「' + RECORD_TYPE_DISH + '」');
      return;
    }

    if (existing.dishIds[id] || newDishes.some(function (d) { return d.id === id; })) {
      reject('dishes', rec, '菜品 id 与现有数据或本次导入内重复：' + id);
      return;
    }
    const m = metaOf(rec);
    if (m.error) { reject('dishes', rec, m.error); return; }
    const evErr = checkEvidence('dishes', id, rec);
    if (evErr) { reject('dishes', rec, evErr); return; }

    /* 归属：本次新增店铺（整套）或已有店铺（增量补菜）都允许；其余一律拒 */
    const isNewShop = shopById[shopId] !== undefined;
    const isExistingShop = existing.shopIds[shopId] === true;
    if (!isNewShop && !isExistingShop) {
      reject('dishes', rec, 'shop_id 既不是本次新增店铺，也不在现有数据里：' + JSON.stringify(shopId));
      return;
    }
    const stallId = trim(rec.stall_id);
    if (isExistingShop && existing.stallShop[stallId] !== shopId) {
      reject('dishes', rec, '给已有店铺补菜时，stall_id 必须是该店铺已有的窗口；收到 ' + JSON.stringify(stallId));
      return;
    }

    /* 价格：保持字符串原样交给校验器判断，先做一次可读的预检 */
    const priceText = trim(rec.price);
    const price = Number(priceText);
    if (priceText === '' || !isFinite(price)) {
      reject('dishes', rec, '价格不是数字：' + JSON.stringify(priceText));
      return;
    }

    /* 口味：只接受单值（规约 1：辣度是互斥单值） */
    const taste = trim(rec.tastes);
    if (taste.indexOf('|') !== -1 || taste.indexOf(',') !== -1 || taste.indexOf('、') !== -1) {
      reject('dishes', rec, '口味必须是单个值，收到 ' + JSON.stringify(taste));
      return;
    }

    newDishes.push({
      id: id,
      name: trim(rec.dish_name),
      price: price,
      foodType: trim(rec.food_type),
      shopId: shopId,
      stallId: stallId,
      tastes: taste ? [taste] : [],
      source: m.meta.source,
      verifyStatus: m.meta.verifyStatus,
      verifiedAt: null,
      __row: rec.__row,
      __file: rec.__file
    });
  });

  /* ---------- 5. 归属自检（给出比校验器更早、更直白的原因）---------- */
  const floorIdSet = {};
  const stallIdSet = {};
  newShops.forEach(function (shop) {
    shop.floors.forEach(function (f) { floorIdSet[f.id] = shop.id; });
    shop.stalls.forEach(function (s) { stallIdSet[s.id] = shop.id; });
  });

  newShops.forEach(function (shop) {
    shop.stalls.forEach(function (stall) {
      const at = { __file: stall.__file, __row: stall.__row, stall_id: stall.id };
      if (shop.floors.length === 0) {
        if (stall.floorId !== '') {
          reject('stalls', at,
            '该店铺在本次导入里没有楼层，窗口的 floor_id 必须留空，收到 ' + JSON.stringify(stall.floorId));
        }
        return;
      }
      if (floorIdSet[stall.floorId] !== shop.id) {
        reject('stalls', at, '窗口的 floor_id 不属于该店铺：' + JSON.stringify(stall.floorId));
      }
    });
  });

  newDishes.forEach(function (dish) {
    const at = { __file: dish.__file, __row: dish.__row, dish_id: dish.id };
    /* 已有店铺的归属在第 4 段按 stallShop 校验过，这里只管本次新增店铺 */
    if (existing.shopIds[dish.shopId] === true) return;
    if (shopById[dish.shopId] === undefined) {
      reject('dishes', at, 'shop_id 不在本次导入的新增店铺里：' + JSON.stringify(dish.shopId));
      return;
    }
    if (stallIdSet[dish.stallId] !== dish.shopId) {
      reject('dishes', at, 'stall_id 不属于该店铺（或不在本次导入内）：' + JSON.stringify(dish.stallId));
    }
  });

  /* 被拒绝的记录不再进入待写入集合，避免「有拒绝还写进去一半」 */
  const rejectedShopIds = {};
  const rejectedStallIds = {};
  const rejectedDishIds = {};
  rejected.forEach(function (r) {
    if (r.table === 'shops') rejectedShopIds[r.id] = true;
    if (r.table === 'stalls') rejectedStallIds[r.id] = true;
    if (r.table === 'dishes') rejectedDishIds[r.id] = true;
  });

  const finalShops = newShops.filter(function (s) { return !rejectedShopIds[s.id]; });
  const finalDishes = newDishes.filter(function (d) { return !rejectedDishIds[d.id]; });

  return {
    shops: finalShops,
    dishes: finalDishes,
    rejected: rejected,
    skipped: skipped,
    warnings: warnings,
    evidence: evidence
  };
}

/* ------------------------------------------------------------------
   现有 id 索引（只读，来自 data/）
   ------------------------------------------------------------------ */

function indexExisting() {
  const shopIds = {};
  const floorIds = {};
  const stallIds = {};
  const dishIds = {};
  /* 增量补菜需要知道「这个窗口属于哪家店」「这家店有没有楼层」 */
  const stallShop = {};
  const shopHasFloors = {};

  SHOPS.forEach(function (shop) {
    shopIds[shop.id] = true;
    shopHasFloors[shop.id] = (shop.floors || []).length > 0;
    (shop.floors || []).forEach(function (f) { floorIds[f.id] = true; });
    (shop.stalls || []).forEach(function (s) {
      stallIds[s.id] = true;
      stallShop[s.id] = shop.id;
    });
  });
  DISHES.forEach(function (d) { dishIds[d.id] = true; });

  return {
    shopIds: shopIds,
    floorIds: floorIds,
    stallIds: stallIds,
    dishIds: dishIds,
    stallShop: stallShop,
    shopHasFloors: shopHasFloors
  };
}

/* ------------------------------------------------------------------
   校验：全部复用 tools/verify_data.js，不复制规则
   ------------------------------------------------------------------ */

function validateNew(built, opts) {
  return verify.validateDataset(
    { shops: built.shops, dishes: built.dishes },
    { declaredDemo: false, checkJoin: false, today: opts.today }
  );
}

function validateMerged(built, opts) {
  return verify.validateDataset(
    { shops: SHOPS.concat(built.shops), dishes: DISHES.concat(built.dishes) },
    { declaredDemo: false, checkJoin: false, today: opts.today }
  );
}

/* 合并校验里只关心「本次新增的 id」引发的错误；演示数据本身是干净的基线 */
function errorsOfNew(result, built) {
  const ids = {};
  built.shops.forEach(function (s) {
    ids[s.id] = true;
    (s.floors || []).forEach(function (f) { ids[f.id] = true; });
    (s.stalls || []).forEach(function (s2) { ids[s2.id] = true; });
  });
  built.dishes.forEach(function (d) { ids[d.id] = true; });

  return result.errors.filter(function (e) { return ids[e.id] === true; });
}

/* ------------------------------------------------------------------
   写入（原子、可回滚）
   ------------------------------------------------------------------ */

function buildPayload(built, sources) {
  const generatedAt = new Date().toISOString();
  const head = {
    schema: 'shanli-import-v1',
    generatedAt: generatedAt,
    demo: false,
    note: '由 tools/import_data.js 生成。所有记录一律 unverified，未经人工核验不得当作已核实信息展示。'
  };

  return {
    'shops.json': JSON.stringify(Object.assign({}, head, {
      shops: built.shops.map(function (s) {
        return {
          id: s.id, name: s.name, area: s.area, building: s.building, location: s.location,
          floors: s.floors.map(function (f) {
            return { id: f.id, label: f.label, shopId: f.shopId, source: f.source, verifyStatus: f.verifyStatus, verifiedAt: f.verifiedAt };
          }),
          stalls: s.stalls.map(function (t) {
            const o = { id: t.id, floorId: t.floorId, name: t.name, source: t.source, verifyStatus: t.verifyStatus, verifiedAt: t.verifiedAt };
            if (t.side) o.side = t.side;
            if (t.noStatus) o.noStatus = t.noStatus;
            if (t.no) o.no = t.no;
            return o;
          }),
          source: s.source, verifyStatus: s.verifyStatus, verifiedAt: s.verifiedAt
        };
      })
    }), null, 2) + '\n',

    'dishes.json': JSON.stringify(Object.assign({}, head, {
      dishes: built.dishes.map(function (d) {
        return {
          id: d.id, name: d.name, price: d.price, foodType: d.foodType,
          shopId: d.shopId, stallId: d.stallId, tastes: d.tastes,
          source: d.source, verifyStatus: d.verifyStatus, verifiedAt: d.verifiedAt
        };
      })
    }), null, 2) + '\n',

    'manifest.json': JSON.stringify(Object.assign({}, head, {
      counts: {
        shops: built.shops.length,
        floors: built.shops.reduce(function (a, s) { return a + s.floors.length; }, 0),
        stalls: built.shops.reduce(function (a, s) { return a + s.stalls.length; }, 0),
        dishes: built.dishes.length
      },
      skipped: built.skipped,
      rejected: built.rejected,
      sourceFiles: sources,
      /* 证据链：模型里没有位置存这三项，只能留在 manifest 供人工审核 */
      evidence: built.evidence,
      evidenceNote: 'collector / collect_date / evidence_file 三项当前数据模型无法存放，只记录在本清单中，'
        + '不写入 shops/dishes 数据，也不构成 verified 依据。'
    }), null, 2) + '\n'
  };
}

/**
 * 写入：先写临时目录，全部成功后再逐个 rename 到目标目录。
 * 任一环节失败 → 删除临时目录，并**把已经 rename 出去的文件反向删除**，
 * 再把本次新建的空目录删掉。返回 object 说明实际回滚结果，绝不谎报。
 */
function writePayload(outDir, payload) {
  const names = Object.keys(payload);
  const renamed = [];
  let createdOutDir = false;
  let createdTmpDir = '';

  if (fs.existsSync(outDir)) {
    const clash = names.filter(function (n) { return fs.existsSync(path.join(outDir, n)); });
    if (clash.length) {
      const err = new Error('目标目录已存在同名文件：' + clash.join(', ') + '（默认不覆盖，请换一个目录或手动清理）');
      err.code = 'EEXIST_TARGET';
      /* stage='precheck'：一个字节都还没写，因此下面没有「回滚」这回事 */
      err.stage = 'precheck';
      err.rollback = { renamed: [], removed: [], leftover: [], outDirRemoved: false, complete: true };
      throw err;
    }
  } else {
    fs.mkdirSync(outDir, { recursive: true });
    createdOutDir = true;
  }

  const tmpDir = path.join(outDir, '.import-tmp-' + process.pid + '-' + Date.now());
  fs.mkdirSync(tmpDir);
  createdTmpDir = tmpDir;

  try {
    names.forEach(function (n) {
      fs.writeFileSync(path.join(tmpDir, n), payload[n], 'utf8');
    });
    names.forEach(function (n) {
      fs.renameSync(path.join(tmpDir, n), path.join(outDir, n));
      renamed.push(n);
    });
  } catch (e) {
    /* 反向删除：把已经落地的文件撤掉，目标目录恢复原样 */
    const removed = [];
    const leftover = [];
    renamed.slice().reverse().forEach(function (n) {
      const target = path.join(outDir, n);
      try { fs.rmSync(target, { force: true }); removed.push(n); } catch (e2) { leftover.push(n); }
    });
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e3) { /* 临时目录清理失败不影响判断 */ }
    createdTmpDir = '';

    let outDirRemoved = false;
    if (createdOutDir) {
      try { fs.rmdirSync(outDir); outDirRemoved = true; } catch (e4) { outDirRemoved = false; }
    }

    e.rollback = {
      renamed: renamed.slice(),
      removed: removed,
      leftover: leftover,
      outDirRemoved: outDirRemoved,
      complete: leftover.length === 0 && (createdOutDir === outDirRemoved || !createdOutDir)
    };
    throw e;
  } finally {
    if (createdTmpDir) {
      try { fs.rmSync(createdTmpDir, { recursive: true, force: true }); } catch (e5) { /* 忽略 */ }
    }
  }
}

/* 写后复核：把刚写下的文件读回来，再走一遍同一套校验 */
function verifyWritten(outDir, opts) {
  const shopsFile = path.join(outDir, 'shops.json');
  const dishesFile = path.join(outDir, 'dishes.json');
  const shopsJson = JSON.parse(fs.readFileSync(shopsFile, 'utf8'));
  const dishesJson = JSON.parse(fs.readFileSync(dishesFile, 'utf8'));

  const shops = shopsJson.shops || [];
  const dishes = dishesJson.dishes || [];

  const solo = verify.validateDataset(
    { shops: shops, dishes: dishes },
    { declaredDemo: false, checkJoin: false, today: opts.today }
  );
  const merged = verify.validateDataset(
    { shops: SHOPS.concat(shops), dishes: DISHES.concat(dishes) },
    { declaredDemo: false, checkJoin: false, today: opts.today }
  );

  return { shops: shops, dishes: dishes, solo: solo, merged: merged };
}

/* ------------------------------------------------------------------
   报告
   ------------------------------------------------------------------ */

function countShopsDetail(built) {
  return {
    shops: built.shops.length,
    floors: built.shops.reduce(function (a, s) { return a + s.floors.length; }, 0),
    stalls: built.shops.reduce(function (a, s) { return a + s.stalls.length; }, 0),
    dishes: built.dishes.length
  };
}

/**
 * 打印导入报告。
 *
 * options.ok === false 时必须传入：表示「数据校验通过，但本次写入没有成功」。
 * 此时绝不打印任何「成功」断言（✅ 导入完成 / ✅ 预览通过），
 * 只给一句如实的失败说明，把真正的错误留给调用方随后打印。
 *
 * options.reason: 'write-failed' | 'verify-failed'，仅用于把失败说明写准。
 */
function printImportReport(ctx, options) {
  const opts = options || {};
  const ok = opts.ok !== false;
  const reason = opts.reason || '';
  const out = ctx.out || console.log;
  const built = ctx.built;
  const counts = countShopsDetail(built);

  out('===== CSV 导入 · tools/import_data.js =====');
  out('模式：' + (ctx.write ? '写入（--write）' : '预览（dry-run，不写任何文件）'));
  out('CSV 目录：' + ctx.dir);
  out('读取：' + ctx.readCounts);

  if (built.skipped.length) {
    out('');
    out('跳过 ' + built.skipped.length + ' 条（不计入导入，也不报错）：');
    built.skipped.forEach(function (s) {
      out('  · ' + s.table + ' 第 ' + s.row + ' 行 · ' + s.id + '　原因：' + s.reason);
    });
  }

  if (built.rejected.length) {
    out('');
    out('拒绝 ' + built.rejected.length + ' 条：');
    built.rejected.forEach(function (r) {
      out('  ✗ ' + r.table + ' 第 ' + r.row + ' 行 · ' + r.id + '　原因：' + r.reason);
    });
  }

  out('');
  out('准备新增：店铺 ' + counts.shops + ' / 楼层 ' + counts.floors +
    ' / 窗口 ' + counts.stalls + ' / 菜品 ' + counts.dishes);

  ['solo', 'merged'].forEach(function (key) {
    const r = ctx[key];
    const label = key === 'solo' ? '新增记录单独校验' : '与现有数据合并后校验';
    const errs = key === 'merged' ? errorsOfNew(r, built) : r.errors;
    out(label + '：' + r.errors.length + ' 错误 / ' + r.warnings.length + ' 警告' +
      (key === 'merged' ? '（其中属于本次新增的 ' + errs.length + ' 条）' : ''));
    errs.slice(0, ctx.showAll ? errs.length : 20).forEach(function (e) {
      out('  ✗ [' + e.rule + '] ' + e.table + ' ' + e.id + ' → ' + e.field + ' = ' + e.value + '　' + e.reason);
    });
    if (!ctx.showAll && errs.length > 20) {
      out('  …… 其余 ' + (errs.length - 20) + ' 条未显示（加 --all 查看全部）');
    }

    /* 警告必须逐条打出来：D5「价格异常需人工复核」只有显示出来才有意义 */
    if (key === 'solo' && r.warnings.length) {
      r.warnings.slice(0, ctx.showAll ? r.warnings.length : 20).forEach(function (wn) {
        out('  ! [' + wn.rule + '] ' + wn.table + ' ' + wn.id + ' → ' + wn.field +
          ' = ' + wn.value + '　' + wn.reason);
      });
      if (!ctx.showAll && r.warnings.length > 20) {
        out('  …… 其余 ' + (r.warnings.length - 20) + ' 条警告未显示（加 --all 查看全部）');
      }
    }
  });

  if (ctx.written) {
    out('');
    out('已写入：' + ctx.outDir);
    out('写后复核：读回 ' + ctx.written.shops.length + ' 店铺 / ' + ctx.written.dishes.length +
      ' 菜品，单独校验 ' + ctx.written.solo.errors.length + ' 错误，合并校验新增部分 ' +
      errorsOfNew(ctx.written.merged, built).length + ' 错误');
  }

  out('');
  const fatal = built.rejected.length > 0 ||
    (ctx.solo.errors.length > 0) || (errorsOfNew(ctx.merged, built).length > 0);

  if (fatal) {
    out('❌ 存在拒绝或校验错误：本次 ' + (ctx.write ? '未写入' : '不可写入') + '，需要先修数据');
  } else if (!ok) {
    /* 数据没问题，但写入环节失败：这里只能说「没有写入成功」，不能说成功 */
    if (reason === 'verify-failed') {
      out('⚠ 数据已写入，但写后复核未通过：这些文件不可直接使用');
    } else {
      out('⚠ 数据校验通过，但本次写入没有成功：目标目录没有留下可用的导入结果');
    }
  } else if (ctx.write) {
    out('✅ 导入完成（全部记录为 unverified，未改动 data/ 下任何文件）');
  } else {
    out('✅ 预览通过：' + (counts.shops + counts.dishes > 0 ? '可以加 --write --out <目录> 写入' : '没有可导入的新记录（当前只有模板示例行）'));
  }
}

/* ------------------------------------------------------------------
   输出目录护栏（M3）：--out 绝不能落在 data/ 或源码目录里
   ------------------------------------------------------------------ */

/* 取真实路径；目标还不存在时，取最近存在祖先的真实路径再拼回剩余部分（能识别 junction/symlink） */
function realPathLoose(p) {
  const abs = path.resolve(p);
  let cur = abs;
  const tail = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  let base = cur;
  try { base = fs.realpathSync(cur); } catch (e) { base = cur; }
  return tail.length ? path.join.apply(path, [base].concat(tail)) : base;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  return rel.indexOf('..') !== 0 && !path.isAbsolute(rel);
}

function assertSafeOutDir(outDir, csvDir) {
  const problems = [];
  if (!outDir) return { ok: false, out: '', problems: ['未给出 --out'] };

  const out = realPathLoose(outDir);
  const root = realPathLoose(ROOT);

  if (out === root) problems.push('不能是整个项目根目录');
  if (isInside(root, out)) problems.push('不能是项目目录的上级目录（会连带覆盖项目）');

  PROTECTED_DIRS.forEach(function (name) {
    const guard = realPathLoose(path.join(root, name));
    if (out === guard) problems.push('不能是受保护目录 ' + name + '/');
    else if (isInside(out, guard)) problems.push('不能写在受保护目录 ' + name + '/ 里面');
  });

  if (csvDir) {
    const csv = realPathLoose(csvDir);
    if (out === csv) problems.push('不能与 CSV 输入目录相同（会污染原始数据）');
    if (isInside(csv, out)) problems.push('不能是 CSV 输入目录的上级目录');
  }

  return { ok: problems.length === 0, out: out, problems: problems };
}

/* ------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------ */

function parseArgs(argv) {
  const opts = {
    dir: TEMPLATE_DIR,
    write: false,
    out: '',
    showAll: false,
    requireEvidence: false,
    checkSubmitIds: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') { opts.write = true; continue; }
    if (a === '--all') { opts.showAll = true; continue; }
    if (a === '--require-evidence') { opts.requireEvidence = true; continue; }
    if (a === '--no-require-evidence') { opts.requireEvidence = false; continue; }
    if (a === '--check-submit-ids') { opts.checkSubmitIds = true; continue; }
    if (a === '--dir') {
      opts.dir = argv[i + 1] ? path.resolve(argv[i + 1]) : '';
      i += 1; continue;
    }
    if (a === '--out') {
      opts.out = argv[i + 1] ? path.resolve(argv[i + 1]) : '';
      i += 1; continue;
    }
    throw new Error('未知参数：' + a);
  }
  return opts;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv || []);
  } catch (e) {
    console.error('用法错误：' + e.message);
    console.error('用法：node tools/import_data.js [--dir <CSV目录>] [--write --out <输出目录>] [--all] [--check-submit-ids]');
    return EXIT.USAGE;
  }

  if (opts.write && !opts.out) {
    console.error('用法错误：--write 必须同时给出 --out <输出目录>（本工具不会自动写进 data/）');
    return EXIT.USAGE;
  }

  /* 输出目录护栏：给了 --out 就立刻检查，不等写到一半再发现 */
  if (opts.out) {
    const safe = assertSafeOutDir(opts.out, opts.dir);
    if (!safe.ok) {
      console.error('用法错误：--out 指向了受保护的目录，已拒绝写入');
      safe.problems.forEach(function (p) { console.error('  · ' + p); });
      console.error('请换一个项目之外的空目录，例如 %TEMP%\\sl-import-out');
      return EXIT.USAGE;
    }
  }

  /* 读四张表 */
  const tables = {};
  const tableErrors = [];
  const warnings = [];
  const sources = {};
  let readCounts = [];

  Object.keys(SCHEMAS).forEach(function (name) {
    const schema = SCHEMAS[name];
    const t = readTable(opts.dir, schema);
    tables[name] = t.records;
    t.errors.forEach(function (e) { tableErrors.push(e); });
    t.warnings.forEach(function (w) { warnings.push(w); });
    sources[schema.file] = t.sha256;
    readCounts.push(schema.label + ' ' + t.records.length + ' 行');
  });

  if (tableErrors.length) {
    console.error('❌ CSV 读取失败：');
    tableErrors.forEach(function (e) { console.error('  · ' + e); });
    return EXIT.INVALID;
  }

  /* P1：可选的目标 ID 形状校验，必须在任何构建/写入之前失败退出 */
  const idProblems = checkSubmitIds(tables, opts);
  if (idProblems.length) {
    console.error('❌ 投稿 ID 形状校验未通过（--check-submit-ids）：');
    idProblems.forEach(function (p) { console.error('  · ' + p); });
    console.error('  说明：这些 ID 能通过导入，但投稿端会先返回 INVALID_FIELD，永远到不了目标校验。');
    return EXIT.INVALID;
  }

  const existing = indexExisting();
  const built = buildImport(tables, existing, { dir: opts.dir, requireEvidence: opts.requireEvidence });
  built.warnings = built.warnings.concat(warnings);

  const ctx = {
    dir: opts.dir,
    write: opts.write,
    showAll: opts.showAll,
    readCounts: readCounts.join(' / '),
    built: built,
    solo: validateNew(built, {}),
    merged: validateMerged(built, {}),
    outDir: opts.out,
    requireEvidence: opts.requireEvidence
  };

  const fatal = built.rejected.length > 0 ||
    ctx.solo.errors.length > 0 ||
    errorsOfNew(ctx.merged, built).length > 0;

  if (opts.write) {
    if (fatal) {
      printImportReport(ctx);
      return EXIT.INVALID;
    }
    const payload = buildPayload(built, sources);
    try {
      writePayload(opts.out, payload);
    } catch (e) {
      /* 写入失败：报告必须说明「本次没有写入成功」，不能沿用成功文案 */
      printImportReport(ctx, { ok: false, reason: 'write-failed' });
      console.error('');
      const rb = e.rollback;
      if (e.stage === 'precheck') {
        /* 还没开始写就被覆盖保护拦下：这不是「回滚」，是「压根没动过目标目录」 */
        console.error('❌ 写入前即被覆盖保护拦下，目标目录一个字没动：' + e.message);
        console.error('  换一个 --out 目录，或先手动清理上面这些同名文件再重跑。');
      } else if (rb && rb.complete === true) {
        console.error('❌ 写入过程中失败，已完整回滚（目标目录没有留下本次写入的文件）：' + e.message);
      } else if (rb && rb.complete === false) {
        console.error('❌ 写入失败，回滚不完整，需要人工清理：' + e.message);
        if ((rb.leftover || []).length) {
          console.error('  残留文件：' + rb.leftover.join('、') + '（所在目录 ' + opts.out + '）');
        }
        if ((rb.renamed || []).length) {
          console.error('  本次曾经落地的文件：' + rb.renamed.join('、'));
        }
        console.error('  请确认上面这些文件是否还存在，必要时手工删除后再重跑。');
      } else {
        /* 拿不到回滚信息时不得替它宣称「已回滚」 */
        console.error('❌ 写入失败，回滚状态未知（写入过程未返回回滚信息）：' + e.message);
        console.error('  请人工检查目标目录 ' + opts.out + ' 是否残留：' + Object.keys(payload).join('、'));
        console.error('  确认干净后再重跑；若残留不完整，删掉这些文件即可。');
      }
      return EXIT.WRITE_FAILED;
    }
    const written = verifyWritten(opts.out, {});
    ctx.written = written;
    if (written.solo.errors.length || errorsOfNew(written.merged, built).length) {
      printImportReport(ctx, { ok: false, reason: 'verify-failed' });
      console.error('');
      console.error('❌ 写后复核失败：写入的文件未能通过校验，请删除 ' + opts.out + ' 后重新导入');
      return EXIT.WRITE_FAILED;
    }
    printImportReport(ctx);
    return EXIT.OK;
  }

  printImportReport(ctx);
  return fatal ? EXIT.INVALID : EXIT.OK;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  parseCsv: parseCsv,
  rowsToRecords: rowsToRecords,
  readTable: readTable,
  buildImport: buildImport,
  indexExisting: indexExisting,
  validateNew: validateNew,
  validateMerged: validateMerged,
  errorsOfNew: errorsOfNew,
  buildPayload: buildPayload,
  writePayload: writePayload,
  verifyWritten: verifyWritten,
  printImportReport: printImportReport,
  assertSafeOutDir: assertSafeOutDir,
  resolveEvidencePath: resolveEvidencePath,
  realPathLoose: realPathLoose,
  main: main,
  parseArgs: parseArgs,
  SCHEMAS: SCHEMAS,
  SUBMIT_ID_RE: SUBMIT_ID_RE,
  checkSubmitIds: checkSubmitIds,
  TEMPLATE_DIR: TEMPLATE_DIR,
  EXAMPLE_ID_PREFIX: EXAMPLE_ID_PREFIX,
  FORBIDDEN_COLUMNS: FORBIDDEN_COLUMNS,
  EVIDENCE_COLUMNS: EVIDENCE_COLUMNS,
  PROTECTED_DIRS: PROTECTED_DIRS,
  EXIT: EXIT
};
