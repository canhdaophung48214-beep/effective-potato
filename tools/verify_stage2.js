/* 阶段二验收脚本：驱动真实页面文件 + 真实数据，覆盖 10 项回归 + 结构断言 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const P = (p) => path.join(ROOT, p);

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; failures.push(name + (extra ? '  → ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
function section(t) { console.log('\n===== ' + t + ' ====='); }

/* ---------------- 装载数据层 ---------------- */
const D = require(P('data/index.js'));
const M = require(P('utils/matcher.js'));
const { ALL_SHOPS, ALL_DISHES, AREA_LABEL, TASTE_LABEL, FOOD_TYPE_LABEL } = D;

const toasts = [];
global.wx = {
  showToast(o) { toasts.push((o && o.title) || ''); },
  showLoading() {}, hideLoading() {}
};

/* ---------------- 装载页面 ---------------- */
let cfg = null;
global.Page = function (c) { cfg = c; };
require(P('pages/index/index.js'));

function makePage() {
  const inst = Object.create(null);
  Object.keys(cfg).forEach((k) => {
    inst[k] = (k === 'data') ? JSON.parse(JSON.stringify(cfg.data)) : cfg[k];
  });
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => { inst.data[k] = patch[k]; });
    if (typeof cb === 'function') cb();
  };
  return inst;
}
function ev(value) { return { currentTarget: { dataset: { value: value } } }; }

/* ================================================================
   结构断言（数据规约）
   ================================================================ */
section('A. 数据规约');
ok('菜品总数 45 道', ALL_DISHES.length === 45, String(ALL_DISHES.length));
ok('店铺总数 12 家', ALL_SHOPS.length === 12, String(ALL_SHOPS.length));

const idSet = new Set();
let dupId = 0;
ALL_DISHES.forEach((d) => { if (idSet.has(d.id)) dupId++; idSet.add(d.id); });
ok('菜品 id 唯一', dupId === 0, 'dup=' + dupId);

const badTaste = ALL_DISHES.filter((d) => !Array.isArray(d.tastes) || d.tastes.length > 1);
ok('每道菜最多 1 个辣度标签（0..1，契约 :332）', badTaste.length === 0,
  badTaste.length ? badTaste.map((d) => d.name + ':' + d.tastes).join(', ') : (ALL_DISHES.length - badTaste.length) + '/' + ALL_DISHES.length);

const noDemoLoc = ALL_SHOPS.filter((s) => !/（演示位置）/.test(s.location));
ok('12 家店铺 location 全部带（演示位置）', noDemoLoc.length === 0,
  noDemoLoc.length ? noDemoLoc.map((s) => s.name).join(', ') : '12/12');

const types = Object.keys(FOOD_TYPE_LABEL);
ok('FOOD_TYPE_LABEL 有 8 个具体类型', types.length === 8, types.join('/'));

const emptyType = types.filter((t) => !ALL_DISHES.some((d) => d.foodType === t));
ok('8 个类型都有菜', emptyType.length === 0, emptyType.join(',') || '全非空');

const emptyCross = [];
types.forEach((t) => {
  ['campus', 'offsite'].forEach((a) => {
    const n = ALL_DISHES.filter((d) => d.foodType === t && d.area === a).length;
    if (!n) emptyCross.push(t + '@' + a);
  });
});
ok('8 类型 × 校内外 全部非空', emptyCross.length === 0, emptyCross.join(',') || '16/16');

const RAW_DISHES = require(P('data/dishes.js'));
const rawList = RAW_DISHES.DISHES || RAW_DISHES.ALL_DISHES || RAW_DISHES.default || [];
ok('原始菜品数据不存 floorId（楼层由窗口反查）',
  rawList.length > 0 && rawList.every((d) => d.floorId === undefined),
  rawList.length + ' 条原始记录');
ok('join 层才出现 floorId（单一真源）',
  ALL_DISHES.every((d) => typeof d.floorId === 'string'));

/* ================================================================
   排序内核
   ================================================================ */
section('B. applySort');
const src = ALL_DISHES.slice();
const srcOrder = src.map((d) => d.id).join(',');
const asc = M.applySort(src, 'priceAsc');
const desc = M.applySort(src, 'priceDesc');
const def = M.applySort(src, 'default');
ok('升序首项为最低价', asc[0].price === Math.min.apply(null, src.map((d) => d.price)), asc[0].price + ' 元');
ok('降序首项为最高价', desc[0].price === Math.max.apply(null, src.map((d) => d.price)), desc[0].price + ' 元');
ok('升序整体不递减', asc.every((d, i) => i === 0 || asc[i - 1].price <= d.price));
ok('降序整体不递增', desc.every((d, i) => i === 0 || desc[i - 1].price >= d.price));
ok('排序不修改原数组（slice 保护）', src.map((d) => d.id).join(',') === srcOrder);
ok('返回的是新数组不是同一个引用', asc !== src && desc !== src && def !== src);
ok('默认顺序保持原样', def.map((d) => d.id).join(',') === srcOrder);
ok('排序不丢菜不增菜', asc.length === src.length && desc.length === src.length);

/* ================================================================
   页面：回归 1 / 2
   ================================================================ */
section('C. 回归 1：校内 + 米线类 + 15 元以内');
{
  const p = makePage(); p.onLoad();
  p.onSelectArea(ev('campus'));
  p.onToggleFoodType(ev('rice_noodle'));
  p.onSelectBudget(ev(15));
  const names = p.matched.map((d) => d.name + '(' + d.price + ')');
  ok('匹配 3 道', p.matched.length === 3, names.join(' / '));
  ok('全部是校内', p.matched.every((d) => d.area === 'campus'));
  ok('全部 ≤15 元', p.matched.every((d) => d.price <= 15));
  ok('全部是米线类', p.matched.every((d) => d.foodType === 'rice_noodle'));
  ok('matchedCount 与集合一致', p.data.matchedCount === p.matched.length);
  ok('条件摘要含三项', /校内食堂/.test(p.data.conditionText) &&
    /15 元以内/.test(p.data.conditionText) && /米线类/.test(p.data.conditionText), p.data.conditionText);
}

section('D. 回归 2：校内 + 微辣 + 饭类');
{
  const p = makePage(); p.onLoad();
  p.onSelectArea(ev('campus'));
  p.onToggleTaste(ev('mild_spicy'));
  p.onToggleFoodType(ev('rice'));
  const expect = ALL_DISHES.filter((d) => d.area === 'campus' &&
    d.tastes.indexOf('mild_spicy') >= 0 && d.foodType === 'rice');
  ok('页面结果 = 独立实现结果', p.matched.length === expect.length,
    '页面 ' + p.matched.length + ' / 独立 ' + expect.length);
  ok('非空', p.matched.length > 0, p.matched.map((d) => d.name).join(' / '));
  ok('全部满足三个条件', p.matched.every((d) => d.area === 'campus' &&
    d.tastes.indexOf('mild_spicy') >= 0 && d.foodType === 'rice'));
}

/* ================================================================
   回归 3：换餐厅后下级重置
   ================================================================ */
section('E. 回归 3：换餐厅 / 取消餐厅 → 另一家的位置条件不受影响');
{
  const p = makePage(); p.onLoad();
  const viewOf = (id) => p.data.shopViews.filter((v) => v.id === id)[0];
  const tapShop = (fn, shopId, value) =>
    p[fn]({ currentTarget: { dataset: { shopId: shopId, value: value } } });

  p.onSelectArea(ev('campus'));
  p.onToggleShop({ currentTarget: { dataset: { shopId: 's01' } } });
  ok('s01 出现 2 个楼层（+「不限」共 3 个 chip）', viewOf('s01').floorChips.length === 3,
    viewOf('s01').floorChips.map((f) => f.label).join('/'));
  const f2 = viewOf('s01').floorChips[2].id;
  tapShop('onToggleFloor', 's01', f2);
  ok('选楼层后店铺候选收敛到该层', viewOf('s01').stallChips.length === 3,
    viewOf('s01').stallChips.map((s) => s.label).join('/'));
  tapShop('onToggleStall', 's01', viewOf('s01').stallChips[1].id);
  ok('店铺已选中', p.data.shopFilters.s01.stallIds.length === 1, p.data.shopFilters.s01.stallIds.join(','));

  p.onToggleShop({ currentTarget: { dataset: { shopId: 's03' } } });
  ok('新选餐厅的条件槽是空的（等价于旧版「换店即重置」）',
    p.data.shopFilters.s03.floorIds.length === 0 && p.data.shopFilters.s03.stallIds.length === 0);
  ok('s01 的楼层 / 店铺条件原样保留',
    p.data.shopFilters.s01.floorIds.length === 1 && p.data.shopFilters.s01.stallIds.length === 1,
    JSON.stringify(p.data.shopFilters.s01));
  ok('楼层候选换成 s03 自己的 2 层', viewOf('s03').floorChips.length === 3,
    viewOf('s03').floorChips.map((f) => f.label).join('/'));
  ok('店铺候选换成 s03 自己的档口',
    viewOf('s03').stallChips.every((s) => s.id === 'all' || s.id.indexOf('s03_') === 0),
    viewOf('s03').stallChips.map((s) => s.label).join('/'));

  p.onSelectArea(ev('offsite'));
  ok('换区域后选中餐厅与每店条件全清',
    p.data.selectedShops.length === 0 && Object.keys(p.data.shopFilters).length === 0);
}

/* ================================================================
   回归 4：改筛选后排序仍生效
   ================================================================ */
section('F. 回归 4：修改筛选后排序仍然生效');
{
  const p = makePage(); p.onLoad();
  p.onSelectSort(ev('priceAsc'));
  p.onViewAll();
  ok('查看全部时按升序', p.data.listDishes.every((d, i) => i === 0 ||
    p.data.listDishes[i - 1].price <= d.price));

  p.onSelectArea(ev('campus'));
  ok('改筛选后 sortMode 仍是 priceAsc', p.data.sortMode === 'priceAsc');
  ok('改筛选后列表仍按升序', p.data.listDishes.every((d, i) => i === 0 ||
    p.data.listDishes[i - 1].price <= d.price),
    p.data.listDishes.slice(0, 5).map((d) => d.price).join(',') + '…');
  ok('列表内容仍与筛选结果一致', p.data.listDishes.length === p.matched.length);

  p.onSelectSort(ev('priceDesc'));
  ok('切到降序立刻生效', p.data.listDishes.every((d, i) => i === 0 ||
    p.data.listDishes[i - 1].price >= d.price));

  p.onSelectBudget(ev(10));
  ok('再改预算，降序依旧保持', p.data.listDishes.every((d, i) => i === 0 ||
    p.data.listDishes[i - 1].price >= d.price));
  ok('排序没有污染 matched', p.matched.length === p.data.listDishes.length);

  p.onReset();
  ok('重置后 sortMode 回 default', p.data.sortMode === 'default');
}

/* ================================================================
   回归 5：再抽一次允许抽回原结果
   ================================================================ */
section('G. 回归 5：再抽一次允许抽回同一家 / 同一道');
{
  const p = makePage(); p.onLoad();
  const realRandom = Math.random;
  try {
    /* 固定 random 值，两次抽取必然相同；若仍有强制换店，第二次会被改成别人 */
    Math.random = function () { return 0; };
    p.onRandomShop();
    const first = p.data.pickedShop.id;
    p.onDrawAgain();
    const second = p.data.pickedShop.id;
    ok('random 固定时「再抽一次」抽回同一家', first === second, first + ' / ' + second);

    p.onRandomDish();
    const d1 = p.data.pickedDish.id;
    p.onDrawAgain();
    const d2 = p.data.pickedDish.id;
    ok('random 固定时「再抽一次」抽回同一道菜', d1 === d2, d1 + ' / ' + d2);
  } finally {
    Math.random = realRandom;
  }

  /* 真随机下也应该能连续两次拿到同一家（说明没有被强制换店） */
  const p2 = makePage(); p2.onLoad();
  let repeat = 0;
  let prev = null;
  for (let i = 0; i < 400; i++) {
    if (prev) p2.onDrawAgain(); else p2.onRandomShop();
    const cur = p2.data.pickedShop.id;
    if (prev && cur === prev) repeat++;
    prev = cur;
  }
  ok('400 次里出现过「连续同一家」（未被强制换店）', repeat > 0, '连续重复 ' + repeat + ' 次');
}

/* ================================================================
   回归 6：换一家不会返回当前店铺
   ================================================================ */
section('H. 回归 6：换一家一定不是当前这家');
{
  const p = makePage(); p.onLoad();
  p.onRandomShop();
  let bad = 0;
  let tried = 0;
  for (let i = 0; i < 300; i++) {
    const before = p.data.pickedShop.id;
    p.onChangeShop();
    tried++;
    if (p.data.pickedShop.id === before) bad++;
  }
  ok('300 次「换一家」从未返回原店铺', bad === 0, '异常 ' + bad + ' / ' + tried);
  ok('换一家后仍是符合条件的店铺',
    M.collectShopIds(p.matched).indexOf(p.data.pickedShop.id) >= 0,
    p.data.pickedShop.id);
}

/* ================================================================
   回归 7：没有其他候选店铺时提示
   ================================================================ */
section('I. 回归 7：只有一个候选店铺时提示、不静默返回');
{
  const p = makePage(); p.onLoad();
  p.onSelectArea(ev('campus'));
  p.onToggleShop({ currentTarget: { dataset: { shopId: 's05' } } });
  p.onRandomShop();
  const before = p.data.pickedShop.id;
  toasts.length = 0;
  p.onChangeShop();
  ok('弹出了提示', toasts.length === 1, toasts.join(' | '));
  ok('提示文案说明没有其他店铺', /没有其他符合条件/.test(toasts[0] || ''), toasts[0]);
  ok('仍然停在这一家，没有静默替换', p.data.pickedShop.id === before, before);
}

/* ================================================================
   回归 8：空结果
   ================================================================ */
section('J. 回归 8：没有符合条件菜品时的空状态');
{
  const p = makePage(); p.onLoad();
  /* 找一个真实存在的空组合 */
  let empty = null;
  ['campus', 'offsite'].forEach((a) => {
    [10, 15, 20].forEach((b) => {
      types.forEach((t) => {
        ['light', 'mild_spicy', 'spicy'].forEach((ta) => {
          if (empty) return;
          if (!M.filterDishes(ALL_DISHES, { area: a, budget: b, foodType: t, taste: ta }).length) {
            empty = { a: a, b: b, t: t, ta: ta };
          }
        });
      });
    });
  });
  ok('数据里确实存在空组合', !!empty, empty ? JSON.stringify(empty) : '无');

  if (empty) {
    p.onSelectArea(ev(empty.a));
    p.onToggleFoodType(ev(empty.t));
    p.onSelectBudget(ev(empty.b));
    p.onToggleTaste(ev(empty.ta));
    ok('matchedCount 归零', p.data.matchedCount === 0);

    toasts.length = 0;
    p.onViewAll();
    ok('空结果点「查看全部」只提示不切状态', p.data.mode === 'none' && toasts.length === 1, toasts[0]);
    toasts.length = 0;
    p.onRandomShop();
    ok('空结果点「随机选一家」只提示', p.data.mode === 'none' && toasts.length === 1, toasts[0]);
    toasts.length = 0;
    p.onRandomDish();
    ok('空结果点「随机选一道菜」只提示', p.data.mode === 'none' && toasts.length === 1, toasts[0]);
  }
}

/* ================================================================
   回归 9：重置
   ================================================================ */
section('K. 回归 9：重置恢复全部默认值');
{
  const p = makePage(); p.onLoad();
  p.onSelectArea(ev('offsite'));
  p.onToggleShop({ currentTarget: { dataset: { shopId: 's09' } } });
  p.onToggleStall({ currentTarget: { dataset: { shopId: 's09', value: 's09_t2' } } });
  p.onSelectBudget(ev(20));
  p.onToggleFoodType(ev('malatang'));
  p.onToggleTaste(ev('spicy'));
  p.onSelectSort(ev('priceDesc'));
  p.onViewAll();

  p.onReset();
  ok('area 回 all', p.data.area === 'all');
  ok('选中的餐厅清空、每店条件清空',
    p.data.selectedShops.length === 0 && Object.keys(p.data.shopFilters).length === 0);
  ok('budget 回 0', p.data.budget === 0);
  ok('foodTypes 清空', p.data.foodTypes.length === 0);
  ok('tastes 清空', p.data.tastes.length === 0);
  ok('sortMode 回 default', p.data.sortMode === 'default');
  ok('mode 回 none 且清空结果', p.data.mode === 'none' &&
    p.data.pickedShop === null && p.data.pickedDish === null && p.data.listDishes.length === 0);
  ok('matchedCount 回到全量 45', p.data.matchedCount === 45, String(p.data.matchedCount));
}

/* ================================================================
   回归 10：逐项演示标识
   ================================================================ */
section('L. 回归 10：演示标识覆盖');
{
  const wxml = fs.readFileSync(P('pages/index/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(P('pages/index/index.wxss'), 'utf8');

  ok('菜品卡的状态标签由数据字段驱动', /tag-v \{\{dish\.verifyClass\}\}/.test(wxml));
  ok('店铺卡的状态标签由数据字段驱动', /tag-v \{\{pickedShop\.verifyClass\}\}/.test(wxml));
  ok('页脚仍有全局声明', /虚构演示数据/.test(wxml));
  ok('wxss 定义了 .tag-v 基类', /\.tag-v\s*[,{]/.test(wxss));
  ok('wxss 定义了四种状态类', ['.v-demo', '.v-unverified', '.v-verified', '.v-expired'].every((c) => new RegExp('\\.' + c.slice(1) + '\\s*[,{]').test(wxss)));
  ok('菜品卡位置行会显示（演示位置）', ALL_DISHES.every((d) => /（演示位置）/.test(d.location)));
}

/* ================================================================
   结构断言：WXML 类与事件
   ================================================================ */
section('M. WXML 与页面配置一致性');
{
  const wxml = fs.readFileSync(P('pages/index/index.wxml'), 'utf8');
  const wxss = fs.readFileSync(P('pages/index/index.wxss'), 'utf8');

  const staticPart = wxml.replace(/\{\{[\s\S]*?\}\}/g, ' ');
  const classAttrs = staticPart.match(/class="[^"]*"/g) || [];
  const classes = new Set();
  classAttrs.forEach((a) => {
    a.replace(/class="|"/g, '').split(/\s+/).forEach((c) => { if (c) classes.add(c); });
  });

  const conditional = ['chip-on', 'tag-v', 'tag-type', 'tag-area', 'tag-taste',
    'v-demo', 'v-unverified', 'v-verified', 'v-expired',
    'btn-primary', 'btn-secondary', 'btn-ghost', 'empty-btn', 'tap-hover', 'btn-small'];
  conditional.forEach((c) => classes.add(c));

  const missing = [];
  classes.forEach((c) => {
    const re = new RegExp('\\.' + c.replace(/-/g, '\\-') + '\\s*[,{]');
    if (!re.test(wxss)) missing.push(c);
  });
  ok('WXML 用到的 class 全部有样式', missing.length === 0,
    missing.length ? '缺: ' + missing.join(',') : classes.size + ' 个类全部命中');

  const handlers = new Set();
  (wxml.match(/bindtap="[^"]*"/g) || []).forEach((h) => {
    handlers.add(h.replace(/bindtap="|"/g, ''));
  });
  const noImpl = [];
  handlers.forEach((h) => { if (typeof cfg[h] !== 'function') noImpl.push(h); });
  ok('bindtap 全部有实现', noImpl.length === 0,
    noImpl.length ? '缺: ' + noImpl.join(',') : handlers.size + ' 个事件全部命中');

  ok('存在「再抽一次」入口', /再抽一次/.test(wxml));
  ok('存在「换一家」入口', /换一家/.test(wxml));
  ok('存在三个排序选项', /默认顺序/.test(wxml) === false
    ? /\{\{sortOptions\}\}/.test(wxml) && cfg.data.sortOptions.length === 3
    : true, cfg.data.sortOptions.map((s) => s.label).join('/'));
  ok('结果区有本次条件摘要', /result-cond/.test(wxml) && /本次条件/.test(wxml));
}

/* ================================================================
   汇总
   ================================================================ */
console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('失败清单：');
  failures.forEach((f) => console.log('  - ' + f));
} else {
  console.log('全部通过');
}
console.log('========================================');
process.exit(fail ? 1 : 0);
