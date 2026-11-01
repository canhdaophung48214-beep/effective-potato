#!/usr/bin/env node
/**
 * build_pilot_dataset.js
 * ================================================================
 * 从采集 CSV 生成云函数用的真实批次数据集模块（唯一数据源）。
 *
 * 为什么需要它（S2.1 / 问题 N1 + N5）：
 *   S2 时 cloudfunctions/seed/index.js 里的 PILOT_* 常量是照计划文档手抄的，
 *   结果与 tools/pilot/batch1_min/*.csv 有 8/12 条不一致（菜名少了「（素）」/「（荤）」、
 *   c02_d062 与 c02_d065 的口味互换），source.detail 也另写了一套文案。
 *   于是「本地验收基准」和「云端要写入的数据」不是同一份数据。
 *   本脚本把 CSV 变成唯一真源：pilot-data.js 由它生成，测试再把它与 CSV 对账。
 *
 * 用法：
 *   node tools/pilot/build_pilot_dataset.js            # 只打印解析结果与差异（不写文件）
 *   node tools/pilot/build_pilot_dataset.js --write    # 生成 cloudfunctions/seed/pilot-data.js
 *   node tools/pilot/build_pilot_dataset.js --dir <采集目录> [--write]
 *
 * 只读取 CSV，不访问云端、不改 data/、不改页面。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DIR = path.join(ROOT, 'tools', 'pilot', 'batch1_min');
const TARGET = path.join(ROOT, 'cloudfunctions', 'seed', 'pilot-data.js');

/* 与 tools/import_data.js 的 CSV 解析保持同样的严格度（RFC4180：BOM/引号/逗号/换行） */
function parseCsv(text) {
  const src = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') {
      if (field !== '') throw new Error('CSV 格式错误：双引号只能出现在字段开头');
      inQuotes = true; i += 1; continue;
    }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(function (r) { return r.length && !(r.length === 1 && r[0].trim() === ''); });
}

function toObjects(text, tableName) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (cells, idx) {
    const o = { __row: idx + 2 };
    header.forEach(function (h, i) { o[h] = (cells[i] === undefined ? '' : cells[i]).trim(); });
    return o;
  }).filter(function (o) {
    /* 模板示例行（ex_ 前缀）与空行一律跳过 */
    const id = o.shop_id || o.floor_id || o.stall_id || o.dish_id || '';
    if (!id) return false;
    return id.indexOf('ex_') !== 0;
  });
}

function sourceOf(row) {
  return {
    kind: row.source_kind || '',
    detail: row.source_detail || '',
    ref: row.source_ref || ''
  };
}

const TASTE_VALUES = ['light', 'mild_spicy', 'spicy', 'choice'];
const FOOD_TYPES = ['rice', 'noodle', 'rice_noodle', 'rice_vermicelli', 'dumpling', 'malatang', 'snack', 'other'];
const SIDE_VALUES = ['east', 'south', 'west', 'north', ''];
const NO_STATUS_VALUES = ['has', 'none', 'unverified'];

function build(dir) {
  const shops = toObjects(fs.readFileSync(path.join(dir, 'shops.csv'), 'utf8'), 'shops');
  const floors = toObjects(fs.readFileSync(path.join(dir, 'floors.csv'), 'utf8'), 'floors');
  const stalls = toObjects(fs.readFileSync(path.join(dir, 'stalls.csv'), 'utf8'), 'stalls');
  const dishes = toObjects(fs.readFileSync(path.join(dir, 'dishes.csv'), 'utf8'), 'dishes');

  const errors = [];

  const restaurants = shops.map(function (s) {
    const fs_ = floors.filter(function (f) { return f.shop_id === s.shop_id; })
      .map(function (f) {
        return {
          id: f.floor_id,
          label: f.floor_label,
          source: sourceOf(f),
          __row: f.__row
        };
      });
    const row = {
      _id: s.shop_id,
      name: s.shop_name,
      area: s.area,
      building: s.building || '',
      location: s.location || '',
      source: sourceOf(s),
      floors: fs_,
      __row: s.__row
    };
    if (!row.source.kind) errors.push('shops 第 ' + s.__row + ' 行缺 source_kind');
    if (!row.source.detail) errors.push('shops 第 ' + s.__row + ' 行缺 source_detail');
    return row;
  });

  const stallsOut = stalls.map(function (t) {
    const row = {
      _id: t.stall_id,
      restaurantId: t.shop_id,
      floorId: t.floor_id || '',
      name: t.stall_name,
      side: t.side || '',
      noStatus: t.no_status || 'unverified',
      no: t.no || '',
      source: sourceOf(t),
      __row: t.__row
    };
    if (SIDE_VALUES.indexOf(row.side) === -1) errors.push('stalls 第 ' + t.__row + ' 行 side 非法：' + row.side);
    if (NO_STATUS_VALUES.indexOf(row.noStatus) === -1) errors.push('stalls 第 ' + t.__row + ' 行 no_status 非法：' + row.noStatus);
    if (row.noStatus === 'has' && !row.no) errors.push('stalls 第 ' + t.__row + ' 行 no_status=has 但没写 no');
    if (!row.source.kind) errors.push('stalls 第 ' + t.__row + ' 行缺 source_kind');
    if (!row.source.detail) errors.push('stalls 第 ' + t.__row + ' 行缺 source_detail');
    return row;
  });

  const dishesOut = dishes.map(function (d) {
    const tastes = String(d.tastes || '').split(/[|,、;；]/).map(function (x) { return x.trim(); }).filter(Boolean);
    const row = {
      _id: d.dish_id,
      name: d.dish_name,
      price: Number(d.price),
      foodType: d.food_type,
      restaurantId: d.shop_id,
      stallId: d.stall_id,
      tastes: tastes,
      source: sourceOf(d),
      __row: d.__row
    };
    if (String(d.record_type || '') !== '菜品') errors.push('dishes 第 ' + d.__row + ' 行 record_type 不是「菜品」：' + d.record_type);
    if (!isFinite(row.price) || row.price <= 0) errors.push('dishes 第 ' + d.__row + ' 行 price 非法：' + d.price);
    if (tastes.length > 1) errors.push('dishes 第 ' + d.__row + ' 行 tastes 最多一个（契约 :332 为 string[0..1]）：' + d.tastes);
    else if (tastes.length === 1 && TASTE_VALUES.indexOf(tastes[0]) === -1) errors.push('dishes 第 ' + d.__row + ' 行 tastes 非法：' + tastes[0]);
    if (FOOD_TYPES.indexOf(row.foodType) === -1) errors.push('dishes 第 ' + d.__row + ' 行 food_type 非法：' + row.foodType);
    if (!row.source.kind) errors.push('dishes 第 ' + d.__row + ' 行缺 source_kind');
    if (!row.source.detail) errors.push('dishes 第 ' + d.__row + ' 行缺 source_detail');
    return row;
  });

  /* 关联完整性：窗口要挂在本批次的店铺上、菜品要挂在本批次的窗口上 */
  const shopIds = restaurants.map(function (r) { return r._id; });
  const stallById = {};
  stallsOut.forEach(function (t) {
    if (shopIds.indexOf(t.restaurantId) === -1) errors.push('窗口 ' + t._id + ' 的 shop_id 不在本批次店铺里：' + t.restaurantId);
    const shop = restaurants.filter(function (r) { return r._id === t.restaurantId; })[0];
    if (shop && t.floorId && !shop.floors.some(function (f) { return f.id === t.floorId; })) {
      errors.push('窗口 ' + t._id + ' 的 floor_id 不在该店铺楼层里：' + t.floorId);
    }
    stallById[t._id] = t;
  });
  dishesOut.forEach(function (d) {
    const t = stallById[d.stallId];
    if (!t) errors.push('菜品 ' + d._id + ' 的 stall_id 不存在：' + d.stallId);
    else if (t.restaurantId !== d.restaurantId) errors.push('菜品 ' + d._id + ' 的 shop_id 与窗口归属不一致');
  });

  return { restaurants: restaurants, stalls: stallsOut, dishes: dishesOut, errors: errors };
}

function renderModule(data) {
  const body = [
    '/* 由 tools/pilot/build_pilot_dataset.js 从采集 CSV 生成，请勿手工编辑。',
    ' * 数据源：tools/pilot/batch1_min/{shops,floors,stalls,dishes}.csv',
    ' * 生成时间：' + new Date().toISOString(),
    ' * 记录数：店铺 ' + data.restaurants.length + ' / 窗口 ' + data.stalls.length + ' / 菜品 ' + data.dishes.length,
    ' * 每条记录自带 source（kind/detail/ref），与 CSV 逐行一致。',
    ' */',
    "'use strict';",
    '',
    'module.exports = {',
    '  BATCH_ID: ' + JSON.stringify('pilot_c02_batch1_20261022') + ',',
    '  RESTAURANTS: ' + JSON.stringify(data.restaurants, null, 2).replace(/\n/g, '\n  ') + ',',
    '  STALLS: ' + JSON.stringify(data.stalls, null, 2).replace(/\n/g, '\n  ') + ',',
    '  DISHES: ' + JSON.stringify(data.dishes, null, 2).replace(/\n/g, '\n  ') + ',',
    '  SHEET: { shops: ' + data.restaurants.length + ', stalls: ' + data.stalls.length + ', dishes: ' + data.dishes.length + ' }',
    '};',
    ''
  ].join('\n');
  return body;
}

function parseArgs(argv) {
  const opts = { dir: DEFAULT_DIR, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') opts.write = true;
    else if (a === '--dir') { opts.dir = path.resolve(argv[++i] || ''); }
    else if (a.indexOf('--dir=') === 0) { opts.dir = path.resolve(a.slice(6)); }
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv || []);
  let data;
  try {
    data = build(opts.dir);
  } catch (err) {
    console.error('读取 CSV 失败：' + (err && err.message));
    return 2;
  }
  console.log('数据源目录：' + opts.dir);
  console.log('解析结果：店铺 ' + data.restaurants.length + ' / 窗口 ' + data.stalls.length + ' / 菜品 ' + data.dishes.length);
  if (data.errors.length) {
    console.error('发现 ' + data.errors.length + ' 个问题：');
    data.errors.forEach(function (e) { console.error('  - ' + e); });
    console.error('未写入任何文件。');
    return 1;
  }
  data.dishes.forEach(function (d) {
    console.log('  ' + d._id + '  ' + d.name + '  ¥' + d.price + '  ' + (d.tastes.length ? d.tastes[0] : '（口味未提供）') + '  source=' + d.source.kind);
  });
  const text = renderModule(data);
  if (opts.write) {
    fs.writeFileSync(TARGET, text, 'utf8');
    console.log('\n已生成：' + TARGET + '（' + Buffer.byteLength(text, 'utf8') + ' 字节）');
  } else {
    console.log('\n未加 --write，只做解析检查，没有写任何文件。');
  }
  return 0;
}

module.exports = {
  build: build,
  renderModule: renderModule,
  parseCsv: parseCsv,
  DEFAULT_DIR: DEFAULT_DIR,
  TARGET: TARGET
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
