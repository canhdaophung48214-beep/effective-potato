#!/usr/bin/env node
'use strict';

/**
 * tools/import_data.js 专项测试
 *
 * 对应阶段三第 2 步的 13 条测试要求：
 *   A1  合法 CSV 正确解析
 *   A2  中文 / 字段内逗号 / 双引号 / 换行
 *   A3  缺少必填字段被拒绝
 *   A4  非法价格、非法枚举被拒绝
 *   A5  重复 ID 被拒绝
 *   A6  不存在的店铺 / 窗口、错误归属被拒绝
 *   A7  默认 dry-run 不改变任何文件
 *   A8  没有 --write 时绝不写入
 *   A9  与现有 ID 冲突时不覆盖
 *   A10 任一错误存在时，不发生部分写入
 *   A11 导入数据不会被标记为 verified
 *   A12 写入后能再次通过数据校验
 *   A13 校验前后原演示数据完全不变
 *
 * 所有写入都发生在系统临时目录（os.tmpdir + mkdtemp），
 * 真实项目文件只被读取、被取哈希比对，不会被修改。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const importer = require('./import_data');
const verify = require('./verify_data');

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-import-test-'));
const created = [TMP_ROOT];

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    passed += 1;
    return true;
  }
  failed += 1;
  failures.push(name + (detail ? '　→ ' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '　→ ' + detail : ''));
  return false;
}

function eq(name, actual, expected) {
  return ok(name, actual === expected, '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

function section(title) {
  console.log('\n── ' + title + ' ──');
}

/* ------------------------------------------------------------------
   夹具工具
   ------------------------------------------------------------------ */

let seq = 0;

function newDir(tag) {
  seq += 1;
  const dir = path.join(TMP_ROOT, (tag || 'dir') + '-' + seq);
  fs.mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/* 一个正确的 CSV 写出器：把含逗号/引号/换行的字段正确加引号 */
function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/* rows 可以是数组（按列顺序）或对象（按表头名取值） */
function writeCsv(dir, name, header, rows) {
  const lines = [header.map(csvCell).join(',')];
  rows.forEach(function (r) {
    const cells = Array.isArray(r) ? r : header.map(function (h) { return r[h]; });
    lines.push(cells.map(csvCell).join(','));
  });
  fs.writeFileSync(path.join(dir, name), lines.join('\r\n') + '\r\n', 'utf8');
}

const SHOP_HEADER = ['shop_id', 'shop_name', 'area', 'building', 'location',
  'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'];
const FLOOR_HEADER = ['shop_id', 'floor_id', 'floor_label', 'source_kind', 'source_detail', 'source_ref',
  'collector', 'collect_date', 'evidence_file'];
const STALL_HEADER = ['shop_id', 'floor_id', 'stall_id', 'stall_name', 'side', 'no_status', 'no',
  'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'];
const DISH_HEADER = ['dish_id', 'dish_name', 'record_type', 'shop_id', 'stall_id', 'price', 'food_type', 'tastes',
  'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'];

function shopRow(over) {
  const r = {
    shop_id: 'c01', shop_name: '一号食堂（测试夹具）', area: 'campus', building: '西区食堂群',
    location: '西校区（测试）', source_kind: 'field', source_detail: '本人到场看到门头',
    source_ref: 'img/c01_menu.jpg', collector: '测试员', collect_date: '2026-10-20',
    evidence_file: 'img/c01_menu.jpg'
  };
  return Object.assign(r, over || {});
}

function floorRow(over) {
  const r = {
    shop_id: 'c01', floor_id: 'c01_f1', floor_label: '1 楼',
    source_kind: 'field', source_detail: '楼层指引牌', source_ref: 'img/c01_f1.jpg',
    collector: '测试员', collect_date: '2026-10-20', evidence_file: 'img/c01_f1.jpg'
  };
  return Object.assign(r, over || {});
}

function stallRow(over) {
  const r = {
    shop_id: 'c01', floor_id: 'c01_f1', stall_id: 'c01_t1', stall_name: '兰州拉面',
    side: 'east', no_status: 'has', no: '3',
    source_kind: 'field', source_detail: '窗口挂牌', source_ref: 'img/c01_t1.jpg',
    collector: '测试员', collect_date: '2026-10-20', evidence_file: 'img/c01_t1.jpg'
  };
  return Object.assign(r, over || {});
}

function dishRow(over) {
  const r = { dish_id: 'c01_d01', dish_name: '牛肉面（小碗）', record_type: '菜品', shop_id: 'c01', stall_id: 'c01_t1', price: '10', food_type: 'noodle', tastes: 'light', source_kind: 'field', source_detail: '菜单牌拍照', source_ref: 'img/c01_menu.jpg', collector: '测试员', collect_date: '2026-10-20', evidence_file: 'img/c01_menu.jpg' };
  return Object.assign(r, over || {});
}

function makeCsvDir(opts) {
  const o = opts || {};
  const dir = newDir('csv');
  writeCsv(dir, 'shops.csv', SHOP_HEADER, o.shops || [shopRow()]);
  writeCsv(dir, 'floors.csv', FLOOR_HEADER, o.floors || [floorRow()]);
  writeCsv(dir, 'stalls.csv', STALL_HEADER, o.stalls || [stallRow()]);
  writeCsv(dir, 'dishes.csv', DISH_HEADER, o.dishes || [dishRow()]);
  makeEvidenceFiles(dir, o.evidenceFiles);
  return dir;
}

/* 证据文件存在性检查是硬规则，所以夹具必须真的把照片文件造出来 */
function makeEvidenceFiles(dir, names) {
  const list = names || ['img/c01_menu.jpg', 'img/c01_f1.jpg', 'img/c01_t1.jpg'];
  list.forEach(function (rel) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target)) fs.writeFileSync(target, 'fixture-image', 'utf8');
  });
  return dir;
}

function runCli(args) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'import_data.js')].concat(args), { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

function readTables(dir) {
  const tables = {};
  Object.keys(importer.SCHEMAS).forEach(function (name) {
    tables[name] = importer.readTable(dir, importer.SCHEMAS[name]).records;
  });
  return tables;
}

function build(dir) {
  const tables = readTables(dir);
  return importer.buildImport(tables, importer.indexExisting());
}

function get(obj, keyPath) {
  return keyPath.split('.').reduce(function (a, k) { return a === undefined || a === null ? a : a[k]; }, obj);
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

const WATCHED = [
  'data/shops.js', 'data/dishes.js', 'data/provenance.js', 'data/index.js',
  'utils/matcher.js', 'pages/index/index.js', 'pages/index/index.wxml',
  'pages/index/index.wxss', 'tools/verify_data.js'
];

function snapshot() {
  const m = {};
  WATCHED.forEach(function (rel) { m[rel] = sha256File(path.join(ROOT, rel)); });
  return m;
}

function sameSnapshot(a, b) {
  return WATCHED.every(function (rel) { return a[rel] === b[rel]; });
}

/* ================================================================
   A1 / A2. CSV 解析
   ================================================================ */

section('A1 CSV 基础解析');

(function () {
  const rows = importer.parseCsv('a,b,c\n1,2,3\n4,5,6\n');
  eq('普通三行', rows.length, 3);
  eq('单元格取值', rows[1][1], '2');
  eq('末尾换行不产生空行', rows[2].length, 3);

  const bom = importer.parseCsv('\uFEFFshop_id,shop_name\nc01,一号食堂\n');
  eq('BOM 被剔除', bom[0][0], 'shop_id');
  eq('中文读取正常', bom[1][1], '一号食堂');

  const crlf = importer.parseCsv('a,b\r\n1,2\r\n');
  eq('CRLF 行数', crlf.length, 2);
  eq('CRLF 取值', crlf[1][0], '1');

  const emptyTail = importer.parseCsv('a,b\n1,2\n\n\n');
  eq('尾部空行被忽略', emptyTail.length, 2);

  const emptyCell = importer.parseCsv('a,b,c\n1,,3\n');
  eq('中间空字段保留为空串', emptyCell[1][1], '');
})();

section('A2 中文 / 逗号 / 双引号 / 换行');

(function () {
  const text = 'dish_id,dish_name,note\r\n' +
    'c01_d01,"牛肉面（大碗，加面）","含逗号"\r\n' +
    'c01_d02,"他说""要辣""","含转义双引号"\r\n' +
    'c01_d03,"第一行\n第二行","含换行"\r\n';
  const rows = importer.parseCsv(text);
  eq('三行记录 + 表头', rows.length, 4);
  eq('字段内逗号原样保留', rows[1][1], '牛肉面（大碗，加面）');
  eq('转义双引号还原', rows[2][1], '他说"要辣"');
  eq('字段内换行原样保留', rows[3][1], '第一行\n第二行');
  eq('换行字段不影响后续列', rows[3][2], '含换行');

  let threw = false;
  try { importer.parseCsv('a,b\n"未闭合,2\n'); } catch (e) { threw = true; }
  ok('引号未闭合会报错', threw);

  let threw2 = false;
  try { importer.parseCsv('a,b\nx"y,2\n'); } catch (e) { threw2 = true; }
  ok('字段中间出现裸引号会报错（不静默改内容）', threw2);

  const recs = importer.rowsToRecords(importer.parseCsv(
    'shop_id,shop_name,area,building,location,source_kind,source_detail,source_ref,collector,collect_date,evidence_file\n' +
    'c09,"店名, 带逗号",campus,楼,位置,field,说明,,"人",2026-10-20,\n'), importer.SCHEMAS.shops);
  eq('表头映射正确', recs.records[0].shop_name, '店名, 带逗号');
  eq('缺列检查通过（无错误）', recs.errors.length, 0);
})();

/* ================================================================
   A1 合法数据全流程
   ================================================================ */

section('A1 合法 CSV 导入构建');

(function () {
  const dir = makeCsvDir();
  const built = build(dir);
  eq('无拒绝', built.rejected.length, 0);
  eq('无跳过', built.skipped.length, 0);
  eq('新增店铺 1', built.shops.length, 1);
  eq('楼层挂到店铺下', built.shops[0].floors.length, 1);
  eq('窗口挂到店铺下', built.shops[0].stalls.length, 1);
  eq('新增菜品 1', built.dishes.length, 1);
  eq('价格转成数字', built.dishes[0].price, 10);
  eq('口味是单元素数组', built.dishes[0].tastes.length, 1);
  eq('窗口方位保留', built.shops[0].stalls[0].side, 'east');
  eq('窗口编号保留', built.shops[0].stalls[0].no, '3');

  const solo = importer.validateNew(built, {});
  eq('新增记录单独校验 0 错误', solo.errors.length, 0);
  const merged = importer.validateMerged(built, {});
  eq('合并后新增部分 0 错误', importer.errorsOfNew(merged, built).length, 0);

  eq('证据三件套被记录（四张表都收）', built.evidence.length, 4);
  eq('证据覆盖四张表', built.evidence.map(function (e) { return e.table; }).sort().join(','), 'dishes,floors,shops,stalls');
  eq('证据采集人', built.evidence[0].collector, '测试员');
})();

/* ================================================================
   A3. 缺必填字段
   ================================================================ */

section('A3 缺少必填字段');

(function () {
  const dir = makeCsvDir({ shops: [shopRow({ shop_name: '' })] });
  const built = build(dir);
  const errs = importer.validateNew(built, {}).errors;
  ok('空店铺名被 S1 拦截', errs.some(function (e) { return e.rule === 'S1'; }));
})();

(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ dish_name: '' })] });
  const built = build(dir);
  const errs = importer.validateNew(built, {}).errors;
  ok('空菜名被 D1 拦截', errs.some(function (e) { return e.rule === 'D1'; }));
})();

(function () {
  /* 契约 :332 为 string[0..1]：CSV 口味留空 → tastes: []，不再是 D7 错误。 */
  const dir = makeCsvDir({ dishes: [dishRow({ tastes: '' })] });
  const built = build(dir);
  const errs = importer.validateNew(built, {}).errors;
  const d7 = errs.filter(function (e) { return e.rule === 'D7'; }).length;
  ok('空口味可导入且 tastes 为空数组',
    d7 === 0 && built.dishes[0].tastes.length === 0, 'D7=' + d7);
})();

(function () {
  /* 表头缺列 → 整表读取失败，不会当成空值放过去 */
  const dir = newDir('csv-missing-col');
  writeCsv(dir, 'shops.csv', SHOP_HEADER.filter(function (c) { return c !== 'shop_name'; }), [['c01', 'campus', '楼', '位置', 'field', '说明', '', '', '', '']]);
  const r = importer.readTable(dir, importer.SCHEMAS.shops);
  ok('缺列在读取阶段就报错', r.errors.length > 0 && r.errors[0].indexOf('shop_name') !== -1);
})();

/* ================================================================
   A4. 非法价格 / 非法枚举
   ================================================================ */

section('A4 非法价格与枚举');

[
  ['价格是字符串', '十元', 'pre'],
  ['价格负数', '-1', 'D5'],
  ['价格 0', '0', 'D5'],
  ['价格两位小数', '12.55', 'D5']
].forEach(function (c) {
  const dir = makeCsvDir({ dishes: [dishRow({ price: c[1] })] });
  const built = build(dir);
  if (c[2] === 'pre') {
    ok(c[0] + ' 被拒绝', built.rejected.length === 1);
  } else {
    const errs = importer.validateNew(built, {}).errors;
    ok(c[0] + ' 被 ' + c[2] + ' 拦截', errs.some(function (e) { return e.rule === c[2]; }));
  }
});

/* A3 决策：101 元不再判错，但必须留下 D5「需人工复核」警告 */
(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ price: '101' })] });
  const built = build(dir);
  const res = importer.validateNew(built, {});
  eq('101 元不再判错', res.errors.length, 0);
  ok('101 元出 D5 复核警告',
    res.warnings.some(function (wn) { return wn.rule === 'D5'; }));
  eq('101 元仍只有 1 条菜品待写', built.dishes.length, 1);
})();

/* 复核警告必须出现在 CLI 输出里，否则人工复核无从下手 */
(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ price: '101' })] });
  const outDir = path.join(newDir('out-review'), 'out');
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('高价菜品仍可写入（不判错）', r.status, 0);
  ok('输出里出现复核警告', r.out.indexOf('人工复核') !== -1);
  ok('警告带规则号 D5', r.out.indexOf('[D5]') !== -1);
  const dishesJson = JSON.parse(fs.readFileSync(path.join(outDir, 'dishes.json'), 'utf8'));
  eq('写入的仍是 unverified', dishesJson.dishes[0].verifyStatus, 'unverified');
  eq('写入的 verifiedAt 仍是 null', dishesJson.dishes[0].verifiedAt, null);
})();

[
  ['foodType 非法', { food_type: 'noodles' }, 'D6'],
  ['foodType 写成 all', { food_type: 'all' }, 'D6'],
  ['tastes 非法', { tastes: '超辣' }, 'D7'],
  ['side 非法', {}, 'T4'],
  ['no_status 非法', {}, 'T5']
].forEach(function (c) {
  if (c[1].food_type || c[1].tastes) {
    const dir = makeCsvDir({ dishes: [dishRow(c[1])] });
    const errs = importer.validateNew(build(dir), {}).errors;
    ok(c[0] + ' 被 ' + c[2] + ' 拦截', errs.some(function (e) { return e.rule === c[2]; }));
    return;
  }
  const over = c[2] === 'T4' ? { side: 'up' } : { no_status: 'maybe' };
  const dir = makeCsvDir({ stalls: [stallRow(over)] });
  const errs = importer.validateNew(build(dir), {}).errors;
  ok(c[0] + ' 被 ' + c[2] + ' 拦截', errs.some(function (e) { return e.rule === c[2]; }));
});

(function () {
  /* 口味写了多值 → 导入阶段就拒绝（规约 1：辣度互斥单值） */
  const dir = makeCsvDir({ dishes: [dishRow({ tastes: 'light|spicy' })] });
  const built = build(dir);
  ok('多口味被导入阶段拒绝', built.rejected.some(function (r) { return r.reason.indexOf('口味必须是单个值') !== -1; }));
})();

(function () {
  /* 套餐 / 加料 / 店铺规则：模型不支持，必须拒绝而不是当普通菜塞进去 */
  ['套餐', '加料', '店铺规则'].forEach(function (t) {
    const dir = makeCsvDir({ dishes: [dishRow({ record_type: t })] });
    const built = build(dir);
    ok('记录类型「' + t + '」被拒绝', built.rejected.some(function (r) { return r.reason.indexOf('不支持') !== -1; }), JSON.stringify(built.rejected));
    eq('记录类型「' + t + '」不会进入待写入', built.dishes.length, 0);
  });
})();

/* ================================================================
   A5. 重复 ID
   ================================================================ */

section('A5 重复 ID');

(function () {
  const dir = makeCsvDir({ dishes: [dishRow(), dishRow({ dish_name: '另一道菜' })] });
  const built = build(dir);
  ok('同表内菜品 id 重复被拒', built.rejected.some(function (r) { return r.reason.indexOf('菜品 id') !== -1; }));
})();

(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ dish_id: 'd01' })] });
  const built = build(dir);
  ok('与现有演示菜品 id 冲突被拒', built.rejected.some(function (r) { return r.reason.indexOf('菜品 id') !== -1; }));
})();

(function () {
  const dir = makeCsvDir({ shops: [shopRow({ shop_id: 's01' })] });
  const built = build(dir);
  ok('与现有店铺 id 冲突被拒', built.rejected.some(function (r) { return r.reason.indexOf('店铺 id') !== -1; }));
})();

(function () {
  const dir = makeCsvDir({ floors: [floorRow({ floor_id: 's01_f1' })] });
  const built = build(dir);
  ok('与现有楼层 id 冲突被拒', built.rejected.some(function (r) { return r.reason.indexOf('楼层 id') !== -1; }));
})();

/* ================================================================
   A6. 关联与归属
   ================================================================ */

section('A6 关联错误');

(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ shop_id: 'c99' })] });
  const built = build(dir);
  ok('不存在的 shop_id 被拒', built.rejected.some(function (r) { return r.reason.indexOf('shop_id') !== -1; }));
})();

(function () {
  const dir = makeCsvDir({ dishes: [dishRow({ stall_id: 'c01_t9' })] });
  const built = build(dir);
  ok('不存在的 stall_id 被拒', built.rejected.some(function (r) { return r.reason.indexOf('stall_id') !== -1; }));
})();

(function () {
  /* 菜品挂到另一家新店的窗口上 → 跨店归属错误 */
  const dir = makeCsvDir({
    shops: [shopRow(), shopRow({ shop_id: 'c02', shop_name: '二号食堂' })],
    floors: [floorRow(), floorRow({ shop_id: 'c02', floor_id: 'c02_f1' })],
    stalls: [stallRow(), stallRow({ shop_id: 'c02', floor_id: 'c02_f1', stall_id: 'c02_t1' })],
    dishes: [dishRow({ stall_id: 'c02_t1' })]
  });
  const built = build(dir);
  ok('跨店 stall_id 被拒', built.rejected.some(function (r) { return r.reason.indexOf('stall_id 不属于该店铺') !== -1; }));
})();

(function () {
  /* 楼层挂到现有演示店铺下 → 不允许（不改动现有数据） */
  const dir = makeCsvDir({ floors: [floorRow({ shop_id: 's01', floor_id: 's01_f9' })] });
  const built = build(dir);
  ok('楼层不允许挂到现有店铺', built.rejected.some(function (r) {
    return r.reason.indexOf('追加楼层需要 patch 格式') !== -1;
  }));
})();

(function () {
  /* 无楼层店铺的窗口 floorId 必须留空 */
  const dir = makeCsvDir({ floors: [], stalls: [stallRow({ floor_id: 'c01_f1' })] });
  const built = build(dir);
  ok('无楼层却给了 floor_id 被拒', built.rejected.some(function (r) { return r.reason.indexOf('floor_id 必须留空') !== -1; }));
})();

/* ================================================================
   A7 / A8. dry-run 与不写入
   ================================================================ */

section('A7 / A8 预览不写文件');

(function () {
  const before = snapshot();
  const dir = makeCsvDir();
  const outDir = path.join(newDir('out-a7'), 'out');
  const r = runCli(['--dir', dir, '--out', outDir]);
  eq('dry-run 退出码 0', r.status, 0);
  ok('dry-run 输出包含「预览」', r.out.indexOf('预览（dry-run') !== -1);
  ok('dry-run 提示了写入命令', r.out.indexOf('--write --out') !== -1);
  ok('dry-run 没有创建输出目录', !fs.existsSync(outDir));
  ok('dry-run 没有改动任何被监视文件', sameSnapshot(before, snapshot()));
})();

(function () {
  /* 只给 --out 不给 --write，同样不写 */
  const dir = makeCsvDir();
  const outDir = path.join(newDir('out-a8'), 'out');
  const r = runCli(['--dir', dir, '--out', outDir]);
  eq('没有 --write 时退出码 0', r.status, 0);
  ok('没有 --write 时不创建目录', !fs.existsSync(outDir));
})();

(function () {
  /* --write 但不给 --out → 用法错误 */
  const dir = makeCsvDir();
  const r = runCli(['--dir', dir, '--write']);
  eq('--write 缺 --out 退出码 2', r.status, 2);
  ok('提示必须给 --out', r.out.indexOf('--out') !== -1);
})();

/* ================================================================
   A9 / A10 / A11 / A12 / A13. 写入行为
   ================================================================ */

section('A9–A13 写入');

(function () {
  const before = snapshot();
  const dir = makeCsvDir();
  const outDir = path.join(newDir('out-write'), 'out');
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('写入退出码 0', r.status, 0);
  ok('写入成功提示', r.out.indexOf('导入完成') !== -1);

  ['shops.json', 'dishes.json', 'manifest.json'].forEach(function (f) {
    ok('产出 ' + f, fs.existsSync(path.join(outDir, f)));
  });
  ok('没有留下临时目录', fs.readdirSync(outDir).every(function (n) { return n.indexOf('.import-tmp-') === -1; }));

  /* A11：不会被标记为 verified */
  const shopsJson = JSON.parse(fs.readFileSync(path.join(outDir, 'shops.json'), 'utf8'));
  const dishesJson = JSON.parse(fs.readFileSync(path.join(outDir, 'dishes.json'), 'utf8'));
  const all = [].concat(shopsJson.shops, shopsJson.shops[0].floors, shopsJson.shops[0].stalls, dishesJson.dishes);
  ok('所有导入记录都是 unverified', all.every(function (x) { return x.verifyStatus === 'unverified'; }));
  ok('verifiedAt 一律为 null', all.every(function (x) { return x.verifiedAt === null; }));
  ok('不存在 verified 记录', all.every(function (x) { return x.verifyStatus !== 'verified'; }));
  eq('文件里声明 demo:false', dishesJson.demo, false);

  /* A12：写后复核 */
  const w = importer.verifyWritten(outDir, {});
  eq('读回店铺数', w.shops.length, 1);
  eq('读回菜品数', w.dishes.length, 1);
  eq('写后单独校验 0 错误', w.solo.errors.length, 0);
  eq('写后合并校验新增部分 0 错误', importer.errorsOfNew(w.merged, { shops: w.shops, dishes: w.dishes }).length, 0);

  /* A13：演示数据未变 */
  ok('写入过程没有改动 data/ 与页面文件', sameSnapshot(before, snapshot()));

  /* A9：二次写入不覆盖 */
  const second = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('目标已存在时退出码 3', second.status, 3);
  ok('提示不覆盖', second.out.indexOf('不覆盖') !== -1);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  eq('原产物未被覆盖（仍是 1 道菜）', manifest.counts.dishes, 1);
})();

section('A10 有错误时不发生部分写入');

(function () {
  const dir = makeCsvDir({ dishes: [dishRow(), dishRow({ dish_id: 'c01_d02', price: '12.55' })] });
  const outDir = path.join(newDir('out-partial'), 'out');
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('有校验错误时退出码 1', r.status, 1);
  ok('没有创建任何输出文件', !fs.existsSync(outDir));
  ok('输出说明了不可写入', r.out.indexOf('不可写入') !== -1 || r.out.indexOf('未写入') !== -1);
})();

(function () {
  /* 一条被拒绝 + 一条合法 → 整批不写 */
  const dir = makeCsvDir({ dishes: [dishRow(), dishRow({ dish_id: 'c01_d02', record_type: '套餐' })] });
  const outDir = path.join(newDir('out-reject'), 'out');
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('有拒绝时退出码 1', r.status, 1);
  ok('有拒绝时不写文件', !fs.existsSync(outDir));
})();

/* ================================================================
   附加：模板本身
   ================================================================ */

section('模板文件');

(function () {
  const before = snapshot();
  const r = runCli([]);
  eq('模板预览退出码 0', r.status, 0);
  ok('模板里的示例行全部被跳过', r.out.indexOf('跳过 7 条') !== -1);
  ok('模板不产生任何可导入记录', r.out.indexOf('准备新增：店铺 0 / 楼层 0 / 窗口 0 / 菜品 0') !== -1);
  ok('预览模板不改动项目文件', sameSnapshot(before, snapshot()));
})();

(function () {
  /* CSV 里出现 verify_status 列 → 整表拒收，状态只能由程序决定 */
  const dir = makeCsvDir();
  const p = path.join(dir, 'shops.csv');
  const text = fs.readFileSync(p, 'utf8').replace('shop_id,shop_name', 'shop_id,verify_status,shop_name');
  fs.writeFileSync(p, text.replace(/^(c01,)/m, '$1verified,'), 'utf8');
  const r = importer.readTable(dir, importer.SCHEMAS.shops);
  ok('禁止 verify_status 列', r.errors.some(function (e) { return e.indexOf('verify_status') !== -1; }));
})();

/* ================================================================
   A14 安全边界
   M1 增量补菜 / M2 写入失败真回滚 / M3 --out 护栏 / M5 证据必须存在
   ================================================================ */

function buildWith(dir, opts) {
  const tables = readTables(dir);
  return importer.buildImport(tables, importer.indexExisting(), Object.assign({ dir: dir }, opts || {}));
}

section('A14 增量补菜（M1）');

(function () {
  /* 给已有演示店铺 s01 的已有窗口 s01_t1 补一道菜 */
  const dir = makeCsvDir({ shops: [], floors: [], stalls: [], dishes: [dishRow({ shop_id: 's01', stall_id: 's01_t1' })] });
  const built = buildWith(dir);
  eq('补菜无拒绝', built.rejected.length, 0);
  eq('补菜产出 1 道', built.dishes.length, 1);
  eq('补菜不新增店铺', built.shops.length, 0);
  eq('补菜后合并校验 0 错误', importer.validateMerged(built, {}).errors.length, 0);
  eq('补菜的 shopId 指向已有店铺', built.dishes[0].shopId, 's01');
})();

(function () {
  /* 窗口必须属于该店铺 */
  const dir = makeCsvDir({ shops: [], floors: [], stalls: [], dishes: [dishRow({ shop_id: 's01', stall_id: 's02_t1' })] });
  const built = buildWith(dir);
  ok('跨店窗口被拒', built.rejected.some(function (r) {
    return r.reason.indexOf('必须是该店铺已有的窗口') !== -1;
  }));
  eq('被拒后没有待写入菜品', built.dishes.length, 0);
})();

(function () {
  const dir = makeCsvDir({ shops: [], floors: [], stalls: [], dishes: [dishRow({ shop_id: 'zzz', stall_id: 'zzz_t1' })] });
  const built = buildWith(dir);
  ok('不存在的店铺被拒', built.rejected.some(function (r) {
    return r.reason.indexOf('既不是本次新增店铺，也不在现有数据里') !== -1;
  }));
})();

(function () {
  /* 给已有店铺加楼层/窗口 → 明确拒绝并给出后续方案 */
  const f = buildWith(makeCsvDir({ shops: [], floors: [floorRow({ shop_id: 's01', floor_id: 's01_f9' })], stalls: [], dishes: [] }));
  ok('追加楼层被拒并说明 patch 方案', f.rejected.some(function (r) {
    return r.reason.indexOf('追加楼层需要 patch 格式') !== -1;
  }));
  const s = buildWith(makeCsvDir({ shops: [], floors: [], stalls: [stallRow({ shop_id: 's01', stall_id: 's01_t9' })], dishes: [] }));
  ok('追加窗口被拒并说明 patch 方案', s.rejected.some(function (r) {
    return r.reason.indexOf('追加窗口需要 patch 格式') !== -1;
  }));
})();

section('A14 证据文件必须存在（M5）');

(function () {
  const dir = makeCsvDir({ evidenceFiles: [] }); /* 故意不造照片文件 */
  const built = buildWith(dir);
  ok('证据文件缺失被拒', built.rejected.some(function (r) {
    return r.reason.indexOf('证据文件不存在') !== -1;
  }));
  const cli = runCli(['--dir', dir]);
  eq('CLI 也拒绝（退出码 1）', cli.status, 1);
})();

(function () {
  /* 绝对路径也接受 */
  const dir = makeCsvDir();
  const abs = path.join(dir, 'img', 'c01_menu.jpg');
  const built = buildWith(makeCsvDir({ dishes: [dishRow({ evidence_file: abs })] }));
  eq('绝对路径证据可用', built.rejected.length, 0);
})();

(function () {
  /* --require-evidence：每条都必须有证据 */
  const dir = makeCsvDir({ shops: [shopRow({ collector: '', collect_date: '', evidence_file: '' })] });
  const strict = buildWith(dir, { requireEvidence: true });
  ok('严格模式拒绝缺证据的记录', strict.rejected.some(function (r) {
    return r.reason.indexOf('缺少证据') !== -1;
  }));
  const loose = buildWith(dir);
  eq('非严格模式不因缺证据拒绝', loose.rejected.length, 0);
})();

(function () {
  /* 四张表的证据都要进 manifest */
  const built = buildWith(makeCsvDir());
  const tables = built.evidence.map(function (e) { return e.table; }).sort().join(',');
  eq('证据覆盖四张表', tables, 'dishes,floors,shops,stalls');
  ok('证据带行号', built.evidence.every(function (e) { return typeof e.row === 'number' && e.row >= 2; }));
})();

section('A14 --out 护栏（M3）');

/* 守卫用例故意让 CLI 指向真实 data/ 与 pages/。
   如果护栏本身回归，CLI 会真的写进去——这里扫一遍并删除，
   保证测试失败时不会把产物留在受保护目录里。 */
const GUARD_ARTIFACTS = ['shops.json', 'dishes.json', 'manifest.json'];
function sweepProtectedDir(name) {
  const dir = path.join(ROOT, name);
  const leftovers = [];
  GUARD_ARTIFACTS.forEach(function (f) {
    const fp = path.join(dir, f);
    if (fs.existsSync(fp)) { leftovers.push(f); fs.rmSync(fp, { force: true }); }
  });
  return leftovers;
}

(function () {
  ok('拒绝 data/', !importer.assertSafeOutDir(path.join(ROOT, 'data')).ok);
  ok('拒绝 data/ 子目录', !importer.assertSafeOutDir(path.join(ROOT, 'data', 'nested')).ok);
  ok('拒绝项目根', !importer.assertSafeOutDir(ROOT).ok);
  ok('拒绝 pages/', !importer.assertSafeOutDir(path.join(ROOT, 'pages', 'index')).ok);
  ok('拒绝 utils/', !importer.assertSafeOutDir(path.join(ROOT, 'utils')).ok);
  ok('拒绝项目上级目录', !importer.assertSafeOutDir(path.dirname(ROOT)).ok);
  ok('允许项目外的临时目录', importer.assertSafeOutDir(path.join(TMP_ROOT, 'safe-out')).ok);
})();

(function () {
  const before = snapshot();
  const dir = makeCsvDir();
  const r1 = runCli(['--dir', dir, '--write', '--out', path.join(ROOT, 'data')]);
  eq('--out data/ 退出码 2', r1.status, 2);
  ok('提示受保护目录', r1.out.indexOf('受保护') !== -1);
  ok('没有写进 data/', sameSnapshot(before, snapshot()));
  eq('data/ 里没有残留导入产物', sweepProtectedDir('data').length, 0);

  const r2 = runCli(['--dir', dir, '--write', '--out', dir]);
  eq('--out 与 CSV 目录相同 → 退出码 2', r2.status, 2);

  const r3 = runCli(['--dir', dir, '--write', '--out', path.join(ROOT, 'pages')]);
  eq('--out pages/ 退出码 2', r3.status, 2);
  eq('pages/ 里没有残留导入产物', sweepProtectedDir('pages').length, 0);
})();

section('A14 写入失败真回滚（M2）');

(function () {
  const outDir = path.join(newDir('out-fail'), 'out');
  const realRename = fs.renameSync;
  let calls = 0;
  fs.renameSync = function (a, b) {
    calls += 1;
    if (calls === 2) {
      const e = new Error('模拟磁盘错误');
      e.code = 'EIO';
      throw e;
    }
    return realRename(a, b);
  };
  let caught = null;
  try {
    importer.writePayload(outDir, { 'a.json': '{"a":1}', 'b.json': '{"b":1}', 'c.json': '{"c":1}' });
  } catch (e) {
    caught = e;
  } finally {
    fs.renameSync = realRename;
  }

  ok('写入失败抛出错误', caught && caught.code === 'EIO');
  eq('记录到 1 个已落地文件', caught && caught.rollback.renamed.length, 1);
  eq('已落地文件被反向删除', caught && caught.rollback.removed.length, 1);
  ok('回滚标记为完整', caught && caught.rollback.complete === true);
  ok('目标目录没有残留文件', !fs.existsSync(outDir));
})();

(function () {
  const outDir = path.join(newDir('out-eexist'), 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'b.json'), '原有内容', 'utf8');
  let caught = null;
  try {
    importer.writePayload(outDir, { 'a.json': '{"a":1}', 'b.json': '{"b":2}' });
  } catch (e) {
    caught = e;
  }
  eq('同名文件 → EEXIST_TARGET', caught && caught.code, 'EEXIST_TARGET');
  eq('原有文件没被覆盖', fs.readFileSync(path.join(outDir, 'b.json'), 'utf8'), '原有内容');
  eq('没有写入 a.json', fs.existsSync(path.join(outDir, 'a.json')), false);
})();

section('A14 拒绝项带真实行号（P3-1）');

(function () {
  const dir = makeCsvDir({ dishes: [dishRow(), dishRow({ dish_id: 'c01_d02', stall_id: 'c01_t9' })] });
  const built = buildWith(dir);
  const bad = built.rejected.filter(function (r) { return r.id === 'c01_d02'; })[0];
  ok('归属错误不再是「第 0 行」', !!bad && bad.row >= 2, bad ? '行号 ' + bad.row : '没有拒绝项');
  ok('拒绝项带文件与行号', !!bad && bad.file === 'dishes.csv' && bad.row >= 2);
})();

/* ================================================================
   A15 --require-evidence 逐项强制采集三件套（F1）
   ================================================================ */

function strictWith(dir) {
  return buildWith(dir, { requireEvidence: true });
}

section('A15 严格模式：三件套逐项校验');

(function () {
  /* 正向：三项齐全 + 证据真实存在 → 通过 */
  const built = strictWith(makeCsvDir());
  eq('三件套齐全 → 无拒绝', built.rejected.length, 0);
  eq('三件套齐全 → 店铺与菜品各 1 条进入导入', built.shops.length + built.dishes.length, 2);
  eq('三件套齐全 → 证据清单齐全', built.evidence.length, 4);
})();

(function () {
  /* 单独缺 collector：只留 collect_date + evidence_file */
  const dir = makeCsvDir({ dishes: [dishRow({ collector: '' })] });
  const built = strictWith(dir);
  const bad = built.rejected.filter(function (r) { return r.id === 'c01_d01'; })[0];
  ok('单独缺 collector 被拒', !!bad);
  ok('缺 collector 的提示点名该字段', !!bad && bad.reason.indexOf('collector') !== -1, bad ? bad.reason : '没有拒绝项');
  ok('缺 collector 的提示不含其它字段', !!bad && bad.reason.indexOf('collect_date') === -1, bad ? bad.reason : '');
  eq('缺 collector 时该条不进导入', built.dishes.length, 0);
})();

(function () {
  /* 单独缺 collect_date */
  const built = strictWith(makeCsvDir({ stalls: [stallRow({ collect_date: '' })] }));
  const bad = built.rejected.filter(function (r) { return r.id === 'c01_t1'; })[0];
  ok('单独缺 collect_date 被拒', !!bad);
  ok('缺 collect_date 的提示点名该字段', !!bad && bad.reason.indexOf('collect_date') !== -1, bad ? bad.reason : '');
  /* buildImport 不单独返回 floors/stalls（它们挂在 shop 上），因此改校验证据清单里没有该条 */
  ok('缺 collect_date 时该条未进入证据清单', !built.evidence.some(function (e) { return e.id === 'c01_t1'; }));
})();

(function () {
  /* 单独缺 evidence_file（保留 collector / collect_date） */
  const built = strictWith(makeCsvDir({ floors: [floorRow({ evidence_file: '' })] }));
  const bad = built.rejected.filter(function (r) { return r.id === 'c01_f1'; })[0];
  ok('单独缺 evidence_file 被拒', !!bad);
  ok('缺 evidence_file 的提示点名该字段', !!bad && bad.reason.indexOf('evidence_file') !== -1, bad ? bad.reason : '');
  ok('缺 evidence_file 时该条未进入证据清单', !built.evidence.some(function (e) { return e.id === 'c01_f1'; }));
})();

(function () {
  /* 日期格式非法：非真实日历日 / 单位数月日 / 斜杠格式 */
  ['2026-02-30', '2026-13-01', '2026-4-1', '2026/10/20', '20261020'].forEach(function (bad) {
    const built = strictWith(makeCsvDir({ dishes: [dishRow({ collect_date: bad })] }));
    const hit = built.rejected.filter(function (r) { return r.id === 'c01_d01'; })[0];
    ok('collect_date 非法被拒：' + bad, !!hit && hit.reason.indexOf('collect_date 格式非法') !== -1,
      hit ? hit.reason : '没有拒绝项');
  });
})();

(function () {
  /* 三项全空（原有行为不能回退） */
  const built = strictWith(makeCsvDir({ shops: [shopRow({ collector: '', collect_date: '', evidence_file: '' })] }));
  ok('三项全空仍被拒且提示「缺少证据」', built.rejected.some(function (r) {
    return r.reason.indexOf('缺少证据') !== -1;
  }));
})();

section('A15 普通预览模式不因三件套不全而拒绝');

(function () {
  /* 单独缺 collector：普通预览允许 */
  const built = buildWith(makeCsvDir({ dishes: [dishRow({ collector: '' })] }));
  eq('普通模式：缺 collector 不拒绝', built.rejected.length, 0);
  eq('普通模式：仍能导入 1 道菜', built.dishes.length, 1);
})();

(function () {
  const built = buildWith(makeCsvDir({ stalls: [stallRow({ collect_date: '', collector: '' })] }));
  eq('普通模式：collector 与 collect_date 都留空也不拒绝', built.rejected.length, 0);
})();

(function () {
  /* 但填了错日期，普通模式也要拒（规范 §4.1 要求一旦填写即须合法） */
  const built = buildWith(makeCsvDir({ dishes: [dishRow({ collect_date: '2026-02-30' })] }));
  ok('普通模式：填了非法日期仍被拒', built.rejected.some(function (r) {
    return r.reason.indexOf('collect_date 格式非法') !== -1;
  }));
})();

(function () {
  /* 模板示例行不得因严格模式产生误报 */
  const built = strictWith(path.join(__dirname, 'templates'));
  eq('模板示例行在严格模式下不产生拒绝', built.rejected.length, 0);
  eq('模板示例行全部被跳过', built.skipped.length, 7);
})();

(function () {
  /* 证据路径与目录安全不回退：严格模式下缺文件仍然拒 */
  const built = strictWith(makeCsvDir({ evidenceFiles: [] }));
  ok('严格模式：证据文件缺失仍被拒', built.rejected.some(function (r) {
    return r.reason.indexOf('证据文件不存在') !== -1;
  }));
  ok('严格模式：拒绝 data/ 的护栏未变', !importer.assertSafeOutDir(path.join(ROOT, 'data')).ok);
})();

(function () {
  /* CLI 端到端：严格模式退出码 1；普通模式退出码 0 */
  const strictDir = makeCsvDir({ dishes: [dishRow({ collector: '' })] });
  const r1 = runCli(['--dir', strictDir, '--require-evidence']);
  eq('CLI 严格模式缺 collector → 退出码 1', r1.status, 1);
  ok('CLI 输出点名 collector', r1.out.indexOf('collector') !== -1);

  const r2 = runCli(['--dir', strictDir]);
  eq('CLI 普通模式同样数据 → 退出码 0', r2.status, 0);
})();

/* ================================================================
   A16 失败路径不得打印成功文案
   ================================================================ */

section('A16 失败路径不打印成功文案');

(function () {
  /* ① 正常写入：成功文案必须出现 */
  const dir = makeCsvDir();
  const outDir = path.join(newDir('a16-ok'), 'out');
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('正常写入退出码 0', r.status, 0);
  ok('正常写入有成功文案', r.out.indexOf('✅ 导入完成') !== -1);
  ok('正常写入不出现失败文案', r.out.indexOf('写入失败') === -1);
})();

(function () {
  /* ② 目标目录已有同名文件：退出码仍是 3，但绝不能出现成功文案 */
  const dir = makeCsvDir();
  const outDir = path.join(newDir('a16-exists'), 'out');
  const first = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('首次写入成功', first.status, 0);
  const second = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('重复写入退出码 3', second.status, 3);
  ok('重复写入不出现「✅ 导入完成」', second.out.indexOf('✅ 导入完成') === -1);
  ok('重复写入不出现「✅ 预览通过」', second.out.indexOf('✅ 预览通过') === -1);
  ok('重复写入明确说明没有写入成功', second.out.indexOf('本次写入没有成功') !== -1);
  ok('重复写入仍说明不覆盖', second.out.indexOf('不覆盖') !== -1);
  /* 覆盖保护是在写入之前就拦下的，不能说成「回滚」 */
  ok('重复写入文案是「写入前即被覆盖保护拦下」', second.out.indexOf('写入前即被覆盖保护拦下') !== -1);
  ok('重复写入不说「已完整回滚」', second.out.indexOf('已完整回滚') === -1);
  ok('重复写入不说「回滚」二字', second.out.indexOf('回滚') === -1);
  ok('重复写入说明目标目录没被动过', second.out.indexOf('目标目录一个字没动') !== -1);
})();

(function () {
  /* ③ 目标目录里已有一个与产物同名的目录 → 命中覆盖保护，仍不得出现成功文案 */
  const dir = makeCsvDir();
  const outDir = path.join(newDir('a16-mid'), 'out');
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'shops.json'));
  const r = runCli(['--dir', dir, '--write', '--out', outDir]);
  eq('同名目录占位时退出码 3', r.status, 3);
  ok('同名目录占位时不出现「✅ 导入完成」', r.out.indexOf('✅ 导入完成') === -1);
  ok('同名目录占位时明确说明没有写入成功', r.out.indexOf('本次写入没有成功') !== -1);
  ok('同名目录占位时归为「写入前被拦下」', r.out.indexOf('写入前即被覆盖保护拦下') !== -1);
  ok('同名目录占位时不说「回滚」', r.out.indexOf('回滚') === -1);
  ok('同名目录占位时后没有留下 dishes.json', !fs.existsSync(path.join(outDir, 'dishes.json')));
  ok('同名目录占位时没有留下临时目录', fs.readdirSync(outDir).every(function (n) { return n.indexOf('.import-tmp-') === -1; }));
})();

(function () {
  /* ③b 真正的中途失败：第 2 次 rename 抛 EIO，走真实 main → 真实 catch → 真实回滚 */
  const dir = makeCsvDir();
  const outDir = path.join(newDir('a16-eio'), 'out');
  const realRename = fs.renameSync;
  const realLog = console.log;
  const realErr = console.error;
  const lines = [];
  let calls = 0;
  let code = null;

  fs.renameSync = function (a, b) {
    calls += 1;
    if (calls === 2) { const e = new Error('模拟磁盘错误'); e.code = 'EIO'; throw e; }
    return realRename(a, b);
  };
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  console.error = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try {
    code = importer.main(['--dir', dir, '--write', '--out', outDir]);
  } finally {
    fs.renameSync = realRename;
    console.log = realLog;
    console.error = realErr;
  }

  const text = lines.join('\n');
  eq('中途失败 main 返回 3', code, 3);
  ok('中途失败不出现「✅ 导入完成」', text.indexOf('✅ 导入完成') === -1);
  ok('中途失败不出现「✅ 预览通过」', text.indexOf('✅ 预览通过') === -1);
  ok('中途失败说明本次写入没有成功', text.indexOf('本次写入没有成功') !== -1);
  ok('中途失败如实报告回滚结论', /已完整回滚|回滚不完整|回滚状态未知/.test(text));
  ok('中途失败后目标目录已清理', !fs.existsSync(outDir));
})();

(function () {
  /* ④ 写后复核失败 / ⑤ 报告函数的成功态语义（直接调用，构造最小 ctx） */
  const lines = [];
  const ctx = {
    out: function (s) { lines.push(s); },
    write: true,
    dir: 'C:\\fake\\csv',
    readCounts: '1 / 1 / 1 / 1',
    built: { skipped: [], rejected: [], shops: [{ id: 'c01', floors: [], stalls: [] }], dishes: [{ id: 'c01_d01' }] },
    solo: { errors: [], warnings: [] },
    merged: { errors: [], warnings: [] },
    outDir: 'C:\\fake\\out',
    requireEvidence: false
  };

  lines.length = 0;
  importer.printImportReport(ctx);
  ok('未传 options 时按成功处理', lines.join('\n').indexOf('✅ 导入完成') !== -1);

  lines.length = 0;
  importer.printImportReport(ctx, { ok: false, reason: 'write-failed' });
  const t1 = lines.join('\n');
  ok('ok:false 时没有「✅ 导入完成」', t1.indexOf('✅ 导入完成') === -1);
  ok('ok:false 时没有「✅ 预览通过」', t1.indexOf('✅ 预览通过') === -1);
  ok('ok:false 时说明写入没有成功', t1.indexOf('本次写入没有成功') !== -1);
  ok('ok:false 时不说「已回滚」', t1.indexOf('已回滚') === -1 && t1.indexOf('已完整回滚') === -1);

  lines.length = 0;
  importer.printImportReport(ctx, { ok: false, reason: 'verify-failed' });
  const t2 = lines.join('\n');
  ok('写后复核失败时没有成功文案', t2.indexOf('✅') === -1);
  ok('写后复核失败时点名复核未通过', t2.indexOf('写后复核未通过') !== -1);

  lines.length = 0;
  importer.printImportReport(ctx, { ok: false });
  ok('ok:false 且无 reason 时也走失败分支', lines.join('\n').indexOf('✅') === -1);
})();

(function () {
  /* 回滚结论必须三分支：完整 / 不完整 / 未知，且拿不到回滚信息时不得宣称「已回滚」 */
  const src = fs.readFileSync(path.join(__dirname, 'import_data.js'), 'utf8');
  ok('存在「已完整回滚」分支', src.indexOf('已完整回滚') !== -1);
  ok('存在「回滚不完整」分支', src.indexOf('回滚不完整') !== -1);
  ok('存在「回滚状态未知」分支', src.indexOf('回滚状态未知') !== -1);
  ok('完整回滚判定要求 rb 存在且 complete === true',
    src.indexOf('if (rb && rb.complete === true)') !== -1);
  ok('未知分支要求列出可能的残留文件名', src.indexOf('Object.keys(payload)') !== -1);
})();

/* ================================================================
   B. 投稿可接受的 ID 形状（P1/P2 补丁）+ 演示数据不得变成可投稿状态
   ================================================================ */

function validShapeRows() {
  return {
    shops: [shopRow({ shop_id: 'c02', shop_name: '第二食堂（测试夹具）' })],
    floors: [floorRow({ shop_id: 'c02', floor_id: 'c02_f2', floor_label: '2 楼' })],
    stalls: [stallRow({ shop_id: 'c02', floor_id: 'c02_f2', stall_id: 'c02_t02', stall_name: '韩小面' })],
    dishes: [dishRow({ dish_id: 'c02_d060', dish_name: '重庆小面（素）', shop_id: 'c02', stall_id: 'c02_t02', price: '7' })]
  };
}

section('B1 合法 c-格式 + --check-submit-ids 放行');
(function () {
  const dir = makeCsvDir(validShapeRows());
  const r = runCli(['--dir', dir, '--check-submit-ids']);
  eq('合法形状退出码 0', r.status, 0);
  ok('合法形状不出现「投稿 ID 形状校验未通过」', r.out.indexOf('投稿 ID 形状校验未通过') === -1);
  ok('合法形状仍给出预览结论', r.out.indexOf('预览通过') !== -1);
})();

section('B2 非法形状被 --check-submit-ids 在构建前拦下');
(function () {
  const dir = makeCsvDir(); // 默认夹具 c01 / c01_t1 / c01_d01，投稿端一定过不了
  const r = runCli(['--dir', dir, '--check-submit-ids']);
  eq('非法形状退出码 1', r.status, 1);
  ok('点名 stall_id', r.out.indexOf('stall_id') !== -1);
  ok('点名 dish_id', r.out.indexOf('dish_id') !== -1);
  ok('解释为什么导入能过而投稿过不了', r.out.indexOf('INVALID_FIELD') !== -1);
  ok('没有打印成功结论', r.out.indexOf('✅ 预览通过') === -1 && r.out.indexOf('✅ 导入完成') === -1);

  /* c01 本身是合法店铺形状，所以单独构造一个 s01 才能证明 shop_id 也被检查 */
  const shopRows = validShapeRows();
  shopRows.shops = [shopRow({ shop_id: 's01', shop_name: '旧命名店铺' })];
  const r2 = runCli(['--dir', makeCsvDir(shopRows), '--check-submit-ids']);
  eq('旧命名 shop_id 退出码 1', r2.status, 1);
  ok('点名 shop_id', r2.out.indexOf('shop_id') !== -1);
})();

section('B3 不带开关时保持原行为（opt-in，不影响既有流程）');
(function () {
  const dir = makeCsvDir();
  eq('默认退出码 0', runCli(['--dir', dir]).status, 0);
  eq('合法夹具默认退出码 0', runCli(['--dir', makeCsvDir(validShapeRows())]).status, 0);
})();

section('B4 候选内重复 ID 与形状校验是两件事，都会拦');
(function () {
  const rows = validShapeRows();
  rows.dishes = rows.dishes.concat([
    dishRow({ dish_id: 'c02_d060', dish_name: '重复行', shop_id: 'c02', stall_id: 'c02_t02', price: '8' })
  ]);
  const r = runCli(['--dir', makeCsvDir(rows), '--check-submit-ids']);
  eq('重复 ID 退出码 1', r.status, 1);
  ok('重复被点名', r.out.indexOf('重复') !== -1);
})();

section('B5 证据文件缺失：有没有开关都必须拦（硬规则）');
(function () {
  const rows = validShapeRows();
  rows.dishes[0] = dishRow({
    dish_id: 'c02_d060', dish_name: '重庆小面（素）', shop_id: 'c02', stall_id: 'c02_t02',
    price: '7', evidence_file: 'img/not-exist-dish.jpg'
  });
  const dir = makeCsvDir(rows);
  const plain = runCli(['--dir', dir]);
  eq('默认模式退出码 1', plain.status, 1);
  ok('默认模式点名证据文件不存在', plain.out.indexOf('证据文件不存在') !== -1);
  const withFlag = runCli(['--dir', dir, '--check-submit-ids']);
  eq('带形状开关仍是 1', withFlag.status, 1);
  ok('带开关也点名证据文件', withFlag.out.indexOf('证据文件不存在') !== -1);
})();

section('B6 导入产物里没有可投稿状态字段（演示数据无法借此变成可投稿）');
(function () {
  const outDir = path.join(newDir('b6'), 'out');
  const r = runCli(['--dir', makeCsvDir(validShapeRows()), '--write', '--out', outDir, '--check-submit-ids']);
  eq('写入退出码 0', r.status, 0);
  const dishesFile = path.join(outDir, 'dishes.json');
  ok('生成了 dishes.json', fs.existsSync(dishesFile));
  const parsed = JSON.parse(fs.readFileSync(dishesFile, 'utf8'));
  ok('dishes.json 有 dishes 数组', Array.isArray(parsed.dishes) && parsed.dishes.length === 1);
  const d = parsed.dishes[0];
  ok('导入结果没有 dataClass 字段', d.dataClass === undefined && parsed.dataClass === undefined);
  eq('导入结果一律 unverified', d.verifyStatus, 'unverified');
  eq('导入结果 verifiedAt 为空', d.verifiedAt, null);
  ok('导入结果没有 importEligibility 字段', d.importEligibility === undefined);
  const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  ok('manifest 明确证据不构成 verified 依据', String(manifest.evidenceNote).indexOf('不构成 verified 依据') !== -1);
})();

/* ================================================================
   汇总
   ================================================================ */

try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* 忽略清理失败 */ }

console.log('\n========================================');
if (failed) {
  console.log('通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  console.log('失败清单：');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('\n❌ 有 ' + failed + ' 项未通过');
  process.exitCode = 1;
} else {
  console.log('通过 ' + passed + ' 项，失败 0 项');
  console.log('\n✅ 全部通过');
  process.exitCode = 0;
}
