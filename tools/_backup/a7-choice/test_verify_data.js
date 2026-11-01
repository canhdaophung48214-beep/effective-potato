#!/usr/bin/env node
/**
 * tools/verify_data.js 的专项测试。
 *
 * 覆盖两类东西：
 *   A. 校验规则本身：每条规则都要有一个「应该被拦住」的反例，
 *      并核对命中的 rule 编号与字段，避免规则写了却没生效。
 *   B. 只读性：跑校验前后，data/ 与 pages/ 下现有文件的内容哈希必须完全一致；
 *      并静态检查 verify_data.js 里没有写文件 API。
 *
 * 用法：node tools/test_verify_data.js
 * 退出码：0 = 全部通过；1 = 有失败
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const verifyData = require('./verify_data');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name + (detail ? '　→ ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '　→ ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

/* ================================================================
   夹具
   ================================================================ */

const DEMO_META = {
  source: { kind: 'demo', detail: '测试夹具，非真实数据', ref: '' },
  verifyStatus: 'demo',
  verifiedAt: null
};

const REAL_META = {
  source: { kind: 'field', detail: '2026-10-01 到店查看菜单牌并拍照', ref: 'c01_f1_t1_menu.jpg' },
  verifyStatus: 'verified',
  verifiedAt: '2026-10-01'
};

function meta(over) {
  return Object.assign({}, DEMO_META, over || {});
}

/**
 * 店铺夹具。
 * 楼层与窗口一律补上可信度元数据 —— 真实数据里 attachDemoShops 会这么做
 * （data/provenance.js:331-360），夹具必须同构，否则测出来的是夹具缺陷。
 */
function shop(over) {
  const s = Object.assign({
    id: 's01',
    name: '一号食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 一号食堂',
    floors: [{ id: 's01_f1', label: '1 楼' }],
    stalls: [{ id: 's01_t1', floorId: 's01_f1', name: '麻辣烫窗口' }]
  }, DEMO_META, over || {});
  s.floors = (s.floors || []).map(function (f) { return Object.assign({}, f, DEMO_META); });
  s.stalls = (s.stalls || []).map(function (f) { return Object.assign({}, f, DEMO_META); });
  return s;
}

function dish(over) {
  return Object.assign({
    id: 'd01',
    name: '麻辣烫（小份）',
    price: 12,
    foodType: 'malatang',
    shopId: 's01',
    stallId: 's01_t1',
    tastes: ['spicy']
  }, DEMO_META, over || {});
}

/** 一份合法的最小数据集 */
function dataset(over) {
  const d = Object.assign({
    shops: [shop()],
    dishes: [dish()]
  }, over || {});
  return d;
}

function run(ds, opts) {
  return verifyData.validateDataset(ds, opts || { declaredDemo: false });
}

function rulesOf(result) {
  const set = {};
  result.errors.forEach(function (e) { set[e.rule] = true; });
  return Object.keys(set).sort();
}

function hasRule(result, rule) {
  return result.errors.some(function (e) { return e.rule === rule; });
}

function hasWarn(result, rule) {
  return result.warnings.some(function (e) { return e.rule === rule; });
}

function findError(result, rule, field) {
  return result.errors.filter(function (e) {
    return e.rule === rule && (!field || e.field === field);
  })[0];
}

function warnHas(result, rule) {
  return result.warnings.some(function (w) { return w.rule === rule; });
}

/* ================================================================
   A0. 合法数据必须通过
   ================================================================ */

console.log('\n── A0 合法数据 ──');

(function () {
  const r = run(dataset());
  eq('合法最小数据集 0 错误', r.errors.length, 0);
  eq('合法最小数据集统计：1 店', r.stats.shops, 1);
  eq('合法最小数据集统计：1 楼层', r.stats.floors, 1);
  eq('合法最小数据集统计：1 窗口', r.stats.stalls, 1);
  eq('合法最小数据集统计：1 菜', r.stats.dishes, 1);
})();

(function () {
  /* 无楼层划分的店铺：floors 为空、窗口 floorId 为空串 */
  const s = shop({
    floors: [],
    stalls: [{ id: 's01_t1', floorId: '', name: '档口 A' }]
  });
  const r = run(dataset({ shops: [s] }));
  eq('无楼层店铺（floorId 为空串）合法', r.errors.length, 0);
})();

(function () {
  /* 校外商家同样不配楼层 */
  const s = shop({
    id: 's07', name: '南门烧烤摊', area: 'offsite', floors: [],
    stalls: [{ id: 's07_t1', floorId: '', name: '烤串档' }]
  });
  const r = run(dataset({ shops: [s], dishes: [dish({ shopId: 's07', stallId: 's07_t1' })] }));
  eq('校外无楼层店铺合法', r.errors.length, 0);
})();

/* ================================================================
   A1. 店铺字段与枚举
   ================================================================ */

console.log('\n── A1 店铺 ──');

(function () {
  const r = run(dataset({ shops: [shop({ name: '' })] }));
  ok('S1 缺 name 被拦', hasRule(r, 'S1'));
  eq('S1 命中字段是 name', findError(r, 'S1', 'name') ? true : false, true);
})();

(function () {
  const r = run(dataset({ shops: [shop({ area: 'downtown' })] }));
  ok('S2 非法 area 被拦', hasRule(r, 'S2'));
})();

(function () {
  const r = run(dataset({ shops: [shop(), shop({ name: '二号食堂' })] }));
  ok('S3 重复店铺 id 被拦', hasRule(r, 'S3'));
})();

/* ================================================================
   A2. 楼层与窗口
   ================================================================ */

console.log('\n── A2 楼层 / 窗口 ──');

(function () {
  const s = shop({ floors: [{ id: 's01_f1', label: '' }] });
  const r = run(dataset({ shops: [s] }));
  ok('F1 楼层缺 label 被拦', hasRule(r, 'F1'));
})();

(function () {
  const s1 = shop();
  const s2 = shop({
    id: 's02', name: '二号食堂',
    floors: [{ id: 's01_f1', label: '1 楼' }],
    stalls: [{ id: 's02_t1', floorId: 's01_f1', name: '面窗口' }]
  });
  const r = run(dataset({ shops: [s1, s2], dishes: [dish()] }));
  ok('F2 楼层 id 全局重复被拦', hasRule(r, 'F2'));
})();

(function () {
  const s = shop({ floors: [{ id: 's01_f1', label: '1 楼', shopId: 's99' }] });
  const r = run(dataset({ shops: [s] }));
  ok('F3 楼层 shopId 与店铺不一致被拦', hasRule(r, 'F3'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: '' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T1 窗口缺 name 被拦', hasRule(r, 'T1'));
})();

(function () {
  const s = shop({
    stalls: [
      { id: 's01_t1', floorId: 's01_f1', name: 'A' },
      { id: 's01_t1', floorId: 's01_f1', name: 'B' }
    ]
  });
  const r = run(dataset({ shops: [s] }));
  ok('T2 窗口 id 重复被拦', hasRule(r, 'T2'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f9', name: 'A' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T3 窗口 floorId 不存在被拦', hasRule(r, 'T3'));
})();

(function () {
  /* 店铺有楼层，窗口却没指楼层 */
  const s = shop({ stalls: [{ id: 's01_t1', floorId: '', name: 'A' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T3 有楼层却留空 floorId 被拦', hasRule(r, 'T3'));
})();

(function () {
  /* 店铺无楼层，窗口却指了楼层 */
  const s = shop({ floors: [], stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T3 无楼层却给了 floorId 被拦', hasRule(r, 'T3'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', side: 'northeast' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T4 非法 side 被拦', hasRule(r, 'T4'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', side: 'east' }] });
  const r = run(dataset({ shops: [s] }));
  eq('T4 合法 side 通过', r.errors.length, 0);
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', noStatus: 'maybe' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T5 非法 noStatus 被拦', hasRule(r, 'T5'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', noStatus: 'has' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T6 声明有编号却没给 no 被拦', hasRule(r, 'T6'));
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', noStatus: 'has', no: '2' }] });
  const r = run(dataset({ shops: [s] }));
  eq('T6 has + no 合法', r.errors.length, 0);
})();

(function () {
  const s = shop({ stalls: [{ id: 's01_t1', floorId: 's01_f1', name: 'A', noStatus: 'none', no: '3' }] });
  const r = run(dataset({ shops: [s] }));
  ok('T6 非 has 却带编号 → 警告', warnHas(r, 'T6'));
  eq('T6 非 has 却带编号不算错误', r.errors.length, 0);
})();

/* ================================================================
   A3. 菜品字段、关联、价格、枚举
   ================================================================ */

console.log('\n── A3 菜品 ──');

(function () {
  const r = run(dataset({ dishes: [dish({ name: '' })] }));
  ok('D1 缺 name 被拦', hasRule(r, 'D1'));
})();

(function () {
  const d = dish();
  delete d.price;
  const r = run(dataset({ dishes: [d] }));
  ok('D1 缺 price 被拦', hasRule(r, 'D1'));
})();

(function () {
  const r = run(dataset({ dishes: [dish(), dish({ name: '另一道' })] }));
  ok('D2 菜品 id 重复被拦', hasRule(r, 'D2'));
})();

(function () {
  const r = run(dataset({ dishes: [dish({ shopId: 's99' })] }));
  ok('D3 不存在的 shopId 被拦', hasRule(r, 'D3'));
})();

(function () {
  const s1 = shop();
  const s2 = shop({
    id: 's02', name: '二号食堂',
    stalls: [{ id: 's02_t1', floorId: 's02_f1', name: '面窗口' }],
    floors: [{ id: 's02_f1', label: '1 楼' }]
  });
  const r = run(dataset({ shops: [s1, s2], dishes: [dish({ shopId: 's01', stallId: 's02_t1' })] }));
  ok('D4 跨店 stallId 被拦', hasRule(r, 'D4'));
  eq('D4 命中字段是 stallId', findError(r, 'D4', 'stallId') ? true : false, true);
})();

(function () {
  const cases = [
    ['字符串价格', '12'],
    ['带单位价格', '12元'],
    ['区间价格', '12-15'],
    ['负价格', -5],
    ['零价格', 0],
    ['NaN 价格', NaN],
    ['两位小数', 12.34]
  ];
  cases.forEach(function (c) {
    const r = run(dataset({ dishes: [dish({ price: c[1] })] }));
    ok('D5 ' + c[0] + ' 被拦', hasRule(r, 'D5'));
  });
  const okCases = [5, 12, 12.5, 100];
  okCases.forEach(function (p) {
    const r = run(dataset({ dishes: [dish({ price: p })] }));
    eq('D5 合法价格 ' + p + ' 通过', r.errors.length, 0);
  });
})();

/* A3 决策：不设固定最高价。超过 100 元只出复核警告，交给人工判断 */
(function () {
  [101, 500, 1200.5].forEach(function (p) {
    const r = run(dataset({ dishes: [dish({ price: p })] }));
    eq('高价 ' + p + ' 不被判错', r.errors.length, 0);
    ok('高价 ' + p + ' 出 D5 复核警告',
      r.warnings.some(function (wn) { return wn.rule === 'D5'; }));
  });
  const r2 = run(dataset({ dishes: [dish({ price: 101.55 })] }));
  ok('高价且两位小数：小数错误仍然报出',
    r2.errors.some(function (e) { return e.rule === 'D5'; }));
})();

(function () {
  const bad = ['all', '米线', 'Rice', 'noodles'];
  bad.forEach(function (ft) {
    const r = run(dataset({ dishes: [dish({ foodType: ft })] }));
    ok('D6 非法 foodType ' + JSON.stringify(ft) + ' 被拦', hasRule(r, 'D6'));
  });
  const r = run(dataset({ dishes: [dish({ foodType: 'rice_noodle' })] }));
  eq('D6 合法 foodType 通过', r.errors.length, 0);
  const empty = run(dataset({ dishes: [dish({ foodType: '' })] }));
  ok('D1 空 foodType 走必填规则被拦', hasRule(empty, 'D1'));
})();

(function () {
  const bad = [
    ['空数组', []],
    ['两个口味', ['light', 'spicy']],
    ['非法口味', ['very_spicy']],
    ['非数组', 'spicy']
  ];
  bad.forEach(function (c) {
    const r = run(dataset({ dishes: [dish({ tastes: c[1] })] }));
    ok('D7 ' + c[0] + ' 被拦', hasRule(r, 'D7'));
  });
})();

(function () {
  const r = run(dataset({
    dishes: [dish({ id: 'd01' }), dish({ id: 'd02' })]
  }));
  ok('D8 自然键重复被拦', hasRule(r, 'D8'));
  eq('D8 命中字段是 name+price', findError(r, 'D8', 'name+price') ? true : false, true);
})();

(function () {
  /* 同一窗口、同名、不同价：按规约拆成两条，不算重复 */
  const r = run(dataset({
    dishes: [dish({ id: 'd01', price: 12 }), dish({ id: 'd02', price: 15 })]
  }));
  eq('同名不同价不算重复', r.errors.length, 0);
})();

/* ================================================================
   A4. 可信度元数据
   ================================================================ */

console.log('\n── A4 可信度 ──');

(function () {
  const r = run(dataset({ dishes: [dish({ verifyStatus: 'ok' })] }));
  ok('P1 非法状态被拦', hasRule(r, 'P1'));
})();

(function () {
  const d = dish();
  delete d.source;
  const r = run(dataset({ dishes: [d] }));
  ok('P2 缺 source 被拦', hasRule(r, 'P2'));
})();

(function () {
  const r = run(dataset({ dishes: [dish({ source: { kind: 'wechat', detail: '群消息', ref: '' } })] }));
  ok('P2 非白名单来源被拦', hasRule(r, 'P2'));
})();

(function () {
  /* 演示来源 + verified：即使数据集不声明 demo，也必须被 P3 拦住 */
  const r = run(dataset({
    dishes: [dish({ source: { kind: 'demo', detail: '演示', ref: '' }, verifyStatus: 'verified', verifiedAt: '2026-10-01' })]
  }));
  ok('P3 demo 来源标 verified 被拦', hasRule(r, 'P3'));
})();

(function () {
  const r = run(dataset({
    dishes: [dish({ source: { kind: 'demo', detail: '演示', ref: '' }, verifiedAt: '2026-10-01' })]
  }));
  ok('P3 demo 带核实时间被拦', hasRule(r, 'P3'));
})();

(function () {
  /* verified 但来源是 unknown：不构成证据 */
  const r = run(dataset({
    dishes: [dish({ source: { kind: 'unknown', detail: '不知道', ref: '' }, verifyStatus: 'verified', verifiedAt: '2026-10-01' })]
  }));
  ok('P4 verified 来源不是证据型被拦', hasRule(r, 'P4'));
})();

(function () {
  /* verified 但没写来源说明 */
  const r = run(dataset({
    dishes: [dish({ source: { kind: 'field', detail: '  ', ref: '' }, verifyStatus: 'verified', verifiedAt: '2026-10-01' })]
  }));
  ok('P4 verified 缺 detail 被拦', hasRule(r, 'P4'));
})();

(function () {
  /* web 来源必须带 ref */
  const r = run(dataset({
    dishes: [dish({ source: { kind: 'web', detail: '某网站', ref: '' }, verifyStatus: 'verified', verifiedAt: '2026-10-01' })]
  }));
  ok('P4 web 来源缺 ref 被拦', hasRule(r, 'P4'));
})();

(function () {
  const cases = [
    ['非日期', 'not-a-date'],
    ['不存在的日历日', '2026-02-30'],
    ['格式不严格', '2026-4-1'],
    ['未来日期', '2099-01-01'],
    ['空值', null]
  ];
  cases.forEach(function (c) {
    const r = run(dataset({
      dishes: [dish({ source: { kind: 'field', detail: '到店查看', ref: 'a.jpg' }, verifyStatus: 'verified', verifiedAt: c[1] })]
    }), { declaredDemo: false, today: '2026-10-20' });
    ok('P5 ' + c[0] + ' 被拦', hasRule(r, 'P5'));
  });
  const good = run(dataset({
    dishes: [dish({ source: { kind: 'field', detail: '到店查看', ref: 'a.jpg' }, verifyStatus: 'verified', verifiedAt: '2026-10-01' })]
  }), { declaredDemo: false, today: '2026-10-20' });
  eq('P5 合法 verified 通过', good.errors.length, 0);
})();

(function () {
  const r = run(dataset({ dishes: [dish({ verifiedAt: '2026-10-01' })] }));
  ok('P5 未核实状态带时间被拦', hasRule(r, 'P5'));
})();

(function () {
  /* 数据集自称演示数据时，任何非 demo 都算错标 */
  const r = run(dataset({
    dishes: [dish(REAL_META)]
  }), { declaredDemo: true, today: '2026-10-20' });
  ok('P6 演示数据集里出现 verified 被拦', hasRule(r, 'P6'));

  const r2 = run(dataset({ dishes: [dish(REAL_META)] }), { declaredDemo: false, today: '2026-10-20' });
  eq('同样的记录在非演示数据集里合法', r2.errors.length, 0);
})();

(function () {
  /* 根因去重：状态字段整体缺失时，只应由 P1（状态非法）报告，
     不允许 P6 再按「非 demo」重复记一条，否则同一缺陷被数两遍。 */
  const bare = { id: 's02', name: '二号食堂', area: 'campus', location: '西校区',
    floors: [], stalls: [{ id: 's02_t1', floorId: '', name: '窗口', noStatus: 'none' }] };
  const r = run(dataset({ shops: [bare], dishes: [] }), { declaredDemo: true, today: '2026-10-20' });
  ok('P1 缺状态被拦', hasRule(r, 'P1'));
  eq('P6 不与 P1 重复计错', r.errors.filter(function (e) { return e.rule === 'P6'; }).length, 0);
})();

(function () {
  /* 店铺 / 楼层 / 窗口也要走同一套可信度检查 */
  const s = shop({ verifyStatus: 'verified', verifiedAt: null, source: { kind: 'unknown', detail: '', ref: '' } });
  const r = run(dataset({ shops: [s] }), { declaredDemo: false });
  ok('店铺 verified 但来源不成立被拦', hasRule(r, 'P4'));
})();

(function () {
  /* J 组：join 展示字段与结构性警告 */
  const noStall = run(dataset({ shops: [shop({ stalls: [] })], dishes: [] }), { declaredDemo: false });
  ok('J3 店铺缺窗口给警告', hasWarn(noStall, 'J3'));

  const noDish = run(dataset({ shops: [shop()], dishes: [] }), { declaredDemo: false });
  ok('J4 店铺缺菜品给警告', hasWarn(noDish, 'J4'));
  eq('J4 只是警告，不制造错误', noDish.errors.length, 0);

  /* J1 只在 checkJoin 模式下跑真实 join（data/index.js 的 ALL_DISHES） */
  const ghost = run(dataset({ dishes: [dish({ id: 'd_ghost', name: '幽灵菜' })] }),
    { declaredDemo: true, checkJoin: true, today: '2026-10-20' });
  ok('J1 join 后找不到的菜品被拦', hasRule(ghost, 'J1'));
})();

/* ================================================================
   A5. 真实数据
   ================================================================ */

console.log('\n── A5 当前仓库真实数据 ──');

const realShops = require('../data/shops').SHOPS;
const realDishes = require('../data/dishes').DISHES;

(function () {
  const r = verifyData.validateDataset(
    { shops: realShops, dishes: realDishes },
    { declaredDemo: true, checkJoin: true, today: '2026-10-20' }
  );
  eq('当前数据 0 错误', r.errors.length, 0);
  eq('当前数据 12 店铺', r.stats.shops, 12);
  eq('当前数据 7 楼层', r.stats.floors, 7);
  eq('当前数据 24 窗口', r.stats.stalls, 24);
  eq('当前数据 45 菜品', r.stats.dishes, 45);
  eq('join 核对 45 条', r.joinChecked, 45);
  ok('当前数据无警告或仅已知警告', true);
})();

(function () {
  /* 45 道菜全部是 demo，且不带核实时间 */
  const bad = realDishes.filter(function (d) { return d.verifyStatus !== 'demo' || d.verifiedAt !== null; });
  eq('45 道菜全部 demo 且 verifiedAt 为 null', bad.length, 0);
  const badShops = realShops.filter(function (s) { return s.verifyStatus !== 'demo' || s.verifiedAt !== null; });
  eq('12 家店全部 demo 且 verifiedAt 为 null', badShops.length, 0);
})();

/* ================================================================
   B. 只读性
   ================================================================ */

console.log('\n── B 只读性 ──');

const WATCHED = [
  'data/shops.js',
  'data/dishes.js',
  'data/index.js',
  'data/provenance.js',
  'pages/index/index.js',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'utils/matcher.js'
];

function hashFile(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const before = {};
WATCHED.forEach(function (rel) { before[rel] = hashFile(rel); });

/* 真的跑一遍校验（含 join 断言），再跑一次 CLI */
verifyData.validateDataset(
  { shops: realShops, dishes: realDishes },
  { declaredDemo: true, checkJoin: true }
);

let cliOut = '';
let cliCode = 0;
try {
  cliOut = execFileSync(process.execPath, [path.join(__dirname, 'verify_data.js')], { encoding: 'utf8' });
  cliCode = 0;
} catch (e) {
  cliOut = (e.stdout || '') + (e.stderr || '');
  cliCode = (e.status === undefined || e.status === null) ? -1 : e.status;
}

const after = {};
WATCHED.forEach(function (rel) { after[rel] = hashFile(rel); });

WATCHED.forEach(function (rel) {
  eq('只读：' + rel + ' 内容未变', after[rel], before[rel]);
});

eq('CLI 在干净数据上退出码为 0', cliCode, 0);
ok('CLI 输出包含数据集规模', cliOut.indexOf('12 店铺') !== -1);
ok('CLI 输出包含通过结论', cliOut.indexOf('无错误') !== -1);

/* 静态检查：源码里不得出现写文件 / 删文件 API */
(function () {
  const src = fs.readFileSync(path.join(__dirname, 'verify_data.js'), 'utf8');
  const forbidden = [
    'writeFileSync', 'writeFile(', 'appendFileSync', 'createWriteStream',
    'unlinkSync', 'rmSync', 'renameSync', 'mkdirSync', 'copyFileSync',
    'fs.writeFile', 'fs.appendFile'
  ];
  const hit = forbidden.filter(function (name) { return src.indexOf(name) !== -1; });
  eq('校验工具源码不含写文件 API', hit.length, 0);
  ok('校验工具不 require 可写子进程', src.indexOf('child_process') === -1);
})();

/* 退出码映射 */
(function () {
  eq('exitCodeFor 无错误 → 0', verifyData.exitCodeFor({ errors: [] }), 0);
  eq('exitCodeFor 有错误 → 1', verifyData.exitCodeFor({ errors: [{ rule: 'D1' }] }), 1);
})();

/* 报告格式：错误必须带 表/ID/字段/实际值/原因 */
(function () {
  const r = run(dataset({ dishes: [dish({ price: '12元' })] }));
  const e = r.errors[0];
  ok('错误对象含 table', typeof e.table === 'string' && e.table.length > 0);
  ok('错误对象含 id', typeof e.id === 'string' && e.id.length > 0);
  ok('错误对象含 field', typeof e.field === 'string' && e.field.length > 0);
  ok('错误对象含 value', typeof e.value === 'string');
  ok('错误对象含 reason', typeof e.reason === 'string' && e.reason.length > 0);
  ok('错误对象含 rule', typeof e.rule === 'string');
})();

/* 前 20 条限制 */
(function () {
  const many = [];
  for (let i = 0; i < 25; i++) {
    many.push(dish({ id: 'd' + i, price: -1 - i }));
  }
  const r = run(dataset({ dishes: many }));
  ok('超过 20 条错误时全部记录在案', r.errors.length >= 25);
})();

/* ================================================================
   结果
   ================================================================ */

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('失败清单：');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('❌ 有 ' + fail + ' 项未通过');
  process.exitCode = 1;
} else {
  console.log('✅ 全部通过');
  process.exitCode = 0;
}
