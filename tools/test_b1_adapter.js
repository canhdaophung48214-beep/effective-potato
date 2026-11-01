/**
 * B1 适配层测试：纯离线，只用本地 `pilot-data.js` 与构造的坏数据。
 *
 * 覆盖：
 *   A. 真实 B1 数据的计数、ID 形状、字段映射
 *   B. 可信度不被升级（verifyStatus 全部 unverified、verifiedAt 全 null）
 *   C. 演示数据被拒收，不会混进 B1 视图
 *   D. 投稿入口需要的三个 ID 都在，且形状与 submit 正则一致
 *   E. 纯函数性：不改入参、可重复、顺序稳定
 *   F. 坏数据被准确拒收（形状 / 价格 / 类型 / 口味 / 引用）
 *   G. 静态边界：适配层不碰 wx / 云函数 / 网络
 */

'use strict';

const fs = require('fs');
const path = require('path');

const pilot = require('../cloudfunctions/seed_b1/pilot-data');
const adapter = require('../utils/b1Adapter');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('PASS ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, 'actual=' + a + ' expected=' + e);
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

const input = {
  restaurants: pilot.RESTAURANTS,
  stalls: pilot.STALLS,
  dishes: pilot.DISHES
};

/* ---------------------------------------------------------------- A */
section('A. 真实 B1 数据的形状与映射');

const raw = adapter.toRawDataset(input);
eq('A1 店铺数', raw.counts.shops, 1);
eq('A2 档口数', raw.counts.stalls, 1);
eq('A3 菜品数', raw.counts.dishes, 12);
eq('A4 无拒收', raw.skipped.length, 0);
ok('A5 店铺 id 保持 c02', !!raw.shopsRaw[0] && raw.shopsRaw[0].id === 'c02', raw.shopsRaw[0] && raw.shopsRaw[0].id);
ok('A5b pilot 数据本身不带 dataClass，适配层也不补',
  raw.shopsRaw[0] && raw.shopsRaw[0].dataClass === undefined &&
  raw.dishesRaw[0] && raw.dishesRaw[0].dataClass === undefined);
ok('A6 档口挂在店铺 stalls 上', raw.shopsRaw[0].stalls.length === 1);
ok('A7 档口 id 保持 c02_t02', raw.shopsRaw[0].stalls[0].id === 'c02_t02');
ok('A8 楼层来自餐厅文档', raw.shopsRaw[0].floors.length === 1 && raw.shopsRaw[0].floors[0].id === 'c02_f2');
ok('A9 菜品 shopId 由 restaurantId 映射',
  raw.dishesRaw.every(function (d) { return d.shopId === 'c02'; }));
ok('A10 菜品 stallId 保持', raw.dishesRaw.every(function (d) { return d.stallId === 'c02_t02'; }));
eq('A11 菜品顺序与输入一致',
  raw.dishesRaw.map(function (d) { return d.id; }),
  pilot.DISHES.map(function (d) { return d._id; }));

/* ---------------------------------------------------------------- B */
section('B. 可信度：不升级、不编造');

const view = adapter.buildB1View(input);
eq('B1 视图菜品数', view.ALL_DISHES.length, 12);
ok('B2 全部 unverified', view.ALL_DISHES.every(function (d) { return d.verifyStatus === 'unverified'; }),
  view.ALL_DISHES.map(function (d) { return d.verifyStatus; }).join(','));
ok('B3 verifiedAt 全为 null', view.ALL_DISHES.every(function (d) { return d.verifiedAt === null; }));
ok('B4 没有任何「已核实」文案',
  view.ALL_DISHES.every(function (d) { return d.verifyText.indexOf('已核实') === -1; }));
ok('B5 状态总览 dish 全 unverified',
  view.DATA_STATUS_SUMMARY.dish.unverified === 12,
  JSON.stringify(view.DATA_STATUS_SUMMARY.dish));
ok('B6 页面文案不出现 verified 字样',
  JSON.stringify(view.ALL_DISHES).toLowerCase().indexOf('"verified"') === -1);

/* ---------------------------------------------------------------- C */
section('C. 演示数据必须被拒收');

const demoInput = {
  restaurants: [{ _id: 'c08', name: '演示店', dataClass: 'demo', source: { kind: 'demo', detail: 'x', ref: '' } }],
  stalls: [{ _id: 'c08_t01', restaurantId: 'c08', name: '演示档口', dataClass: 'demo', source: { kind: 'demo', detail: 'x', ref: '' } }],
  dishes: [{ _id: 'c08_d001', restaurantId: 'c08', stallId: 'c08_t01', name: '演示菜', price: 12, foodType: 'rice', tastes: ['light'], dataClass: 'demo', source: { kind: 'demo', detail: 'x', ref: '' } }]
};
const demoRaw = adapter.toRawDataset(demoInput);
eq('C1 演示店铺 0 条进入', demoRaw.counts.shops, 0);
eq('C2 演示档口 0 条进入', demoRaw.counts.stalls, 0);
eq('C3 演示菜品 0 条进入', demoRaw.counts.dishes, 0);
eq('C4 三条全部记入 skipped', demoRaw.skipped.length, 3);
ok('C5 拒收原因是 DATA_CLASS',
  demoRaw.skipped.every(function (s) { return s.reason === adapter.SKIP.DATA_CLASS; }),
  JSON.stringify(demoRaw.skipped));
ok('C5b 旧式演示 ID 同样被拒（形状层）',
  adapter.toRawDataset({
    restaurants: [{ _id: 's01', name: '一号食堂', dataClass: 'demo', source: { kind: 'demo', detail: 'x', ref: '' } }],
    stalls: [],
    dishes: []
  }).skipped.map(function (s) { return s.reason; }).join(',') === adapter.SKIP.SHOP_ID);
const demoView = adapter.buildB1View(demoInput);
eq('C6 演示视图无菜品', demoView.ALL_DISHES.length, 0);
ok('C7 演示视图不产生「已验证」', demoView.DATA_STATUS_SUMMARY.dish.verified === 0);
const noClassRaw = adapter.toRawDataset({
  restaurants: [{ _id: 'c09', name: '测试店', source: { kind: 'field', detail: 'x', ref: '' } }],
  stalls: [],
  dishes: []
});
eq('C8 未标注 dataClass 的记录被接受', noClassRaw.counts.shops, 1);
ok('C9 且不被补上 dataClass', noClassRaw.shopsRaw[0].dataClass === undefined);

/* ---------------------------------------------------------------- D */
section('D. 投稿入口需要的字段');

ok('D1 每道菜都有 shopId 且形状合法',
  view.ALL_DISHES.every(function (d) { return adapter.SHOP_ID_RE.test(d.shopId); }));
ok('D2 每道菜都有 stallId 且形状合法',
  view.ALL_DISHES.every(function (d) { return adapter.STALL_ID_RE.test(d.stallId); }));
ok('D3 每道菜都有 dishId 且形状合法',
  view.ALL_DISHES.every(function (d) { return adapter.DISH_ID_RE.test(d.id); }));
eq('D4 首道菜的三元组', [
  view.ALL_DISHES[0].shopId, view.ALL_DISHES[0].stallId, view.ALL_DISHES[0].id
], ['c02', 'c02_t02', 'c02_d060']);

/* ---------------------------------------------------------------- E */
section('E. 字段映射与展示文案');

const d060 = view.ALL_DISHES[0];
eq('E1 名称', d060.name, '重庆小面（素）');
eq('E2 价格', d060.price, 7);
eq('E3 口味中文', d060.tasteText, '麻辣');
eq('E4 主食类型中文', d060.foodTypeText, '面类');
eq('E5 店铺名', d060.shopName, '三餐');
eq('E6 档口展示名', d060.stallLabel, '韩小面');
eq('E7 楼层文字', d060.floorText, '2 楼');
ok('E8 location 不含 undefined/null/重复分隔',
  d060.location.indexOf('undefined') === -1 &&
  d060.location.indexOf('null') === -1 &&
  d060.location.indexOf('· ·') === -1,
  d060.location);
ok('E9 来源文字原样保留（含「未独立证明」）',
  d060.sourceDetail.indexOf('未独立证明') !== -1,
  d060.sourceDetail);
eq('E10 来源类型', d060.sourceKind, 'field');

/* ---------------------------------------------------------------- F */
section('F. 坏数据被准确拒收');

function bad(over) {
  const base = {
    _id: 'c09_d001', restaurantId: 'c09', stallId: 'c09_t01', name: '测试菜',
    price: 9, foodType: 'noodle', tastes: ['spicy'], dataClass: 'field_unverified',
    source: { kind: 'field', detail: '构造的坏数据', ref: '' }
  };
  return Object.assign(base, over);
}
const shopOk = { _id: 'c09', name: '测试店', dataClass: 'field_unverified', source: { kind: 'field', detail: 'x', ref: '' }, floors: [] };
const stallOk = { _id: 'c09_t01', restaurantId: 'c09', name: '测试档口', dataClass: 'field_unverified', source: { kind: 'field', detail: 'x', ref: '' } };

function reasonOf(dishes, shops, stalls) {
  const r = adapter.toRawDataset({
    restaurants: shops || [shopOk],
    stalls: stalls || [stallOk],
    dishes: dishes
  });
  return r.skipped.map(function (s) { return s.reason; });
}

eq('F1 旧式 ID s01 被拒', reasonOf([bad({ _id: 's01' })]), [adapter.SKIP.DISH_ID]);
eq('F2 字符串价格被拒', reasonOf([bad({ price: '9 元' })]), [adapter.SKIP.PRICE]);
eq('F3 负价格被拒', reasonOf([bad({ price: -1 })]), [adapter.SKIP.PRICE]);
eq('F4 未知主食类型被拒', reasonOf([bad({ foodType: 'pizza' })]), [adapter.SKIP.FOOD_TYPE]);
eq('F5 空口味被拒', reasonOf([bad({ tastes: [] })]), [adapter.SKIP.TASTES]);
eq('F6 店铺引用不存在被拒', reasonOf([bad({ restaurantId: 'c77' })]), [adapter.SKIP.SHOP_REF]);
eq('F7 档口引用不存在被拒', reasonOf([bad({ stallId: 'c09_t99' })]), [adapter.SKIP.STALL_REF]);
const dup = adapter.toRawDataset({
  restaurants: [shopOk],
  stalls: [stallOk],
  dishes: [bad({}), bad({})]
});
eq('F8 重复 ID 只收第一条', dup.counts.dishes, 1);
eq('F9 重复 ID 记入 skipped', dup.skipped.map(function (s) { return s.reason; }), [adapter.SKIP.DUPLICATE_ID]);
eq('F10 空名字被拒', reasonOf([bad({ name: '  ' })]), [adapter.SKIP.NAME]);

/* ---------------------------------------------------------------- G */
section('G. 纯函数性');

const frozen = JSON.parse(JSON.stringify(input));
deepFreeze(frozen);
function deepFreeze(o) {
  if (!o || typeof o !== 'object') return o;
  Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
  Object.freeze(o);
  return o;
}
let threw = null;
try { adapter.buildB1View(frozen); } catch (e) { threw = e; }
ok('G1 不改入参（冻结对象也不报错）', threw === null, threw && threw.message);
eq('G2 两次调用结果一致',
  JSON.stringify(adapter.buildB1View(input).ALL_DISHES),
  JSON.stringify(adapter.buildB1View(input).ALL_DISHES));
ok('G3 两次调用不是同一个数组',
  adapter.buildB1View(input).ALL_DISHES !== adapter.buildB1View(input).ALL_DISHES);

/* ---------------------------------------------------------------- H */
section('H. 静态边界');

// 静态边界只看"代码"：注释里提到 cloudRepo/wx 不算违规，否则文档越写清楚越容易误报。
const rawSrc = fs.readFileSync(path.join(__dirname, '..', 'utils', 'b1Adapter.js'), 'utf8');
const src = rawSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:\/])\/\/[^\n]*/g, '$1');
ok('H1 不引用 wx', src.indexOf('wx.') === -1);
ok('H2 不引用 callFunction', src.indexOf('callFunction') === -1);
ok('H3 不调用 cloudRepo 的接口', src.indexOf('cloudRepo.') === -1);
ok('H4 不引用 cloud.database', src.indexOf('cloud.database') === -1);
ok('H5 不含网络请求', src.indexOf('request(') === -1);
ok('H6 不写入任何存储', src.indexOf('setStorage') === -1);
ok('H7 不写文件', src.indexOf('writeFile') === -1);
ok('H8 排除注释后代码长度合理（防空扫描）', src.trim().length > 2000, src.trim().length);

/* ---------------------------------------------------------------- 汇总 */
console.log('\n=== 汇总 ===');
console.log('PASS ' + pass + ' / FAIL ' + fail + ' / TOTAL ' + (pass + fail));
if (fail) {
  console.log('失败项：');
  failures.forEach(function (f) { console.log('  - ' + f); });
}
process.exitCode = fail ? 1 : 0;
