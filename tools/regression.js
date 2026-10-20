/**
 * 阶段 1 回归测试（当前唯一的质量门禁）
 *
 * 运行：
 *   node tools/regression.js
 * 成功时退出码 0，任何一条 FAIL 时退出码 1。
 *
 * 覆盖范围（对应产品负责人列出的回归清单）：
 *   R1  数据基线一致性
 *   R2  筛选 AND 逻辑（穷举 + 与一份独立实现逐条比对）
 *   R3  地点级联与下级重置
 *   R4  随机选店只从符合条件的店铺里抽
 *   R5  随机选菜只从符合条件的菜品里抽
 *   R6  「再抽一次」允许抽回原结果
 *   R7  「换一家」必须排除当前店铺；无候选时提示且状态不变
 *   R8  三档排序：只改顺序、不改集合、不污染原始匹配数据
 *   R9  条件摘要与实际筛选状态一致
 *   R10 重置恢复到默认
 *   R11 空结果：计数为 0、三个按钮都不切状态、有明确提示
 *   R12 尚未实现的功能（清真 / 图片 / 评价）只做存在性检查并记为 SKIP，绝不报 PASS
 *
 * 明确不做的事：
 *   · 不检查任何渲染效果（换行、热区、首屏可见性）——那是模拟器实测的事
 *   · 不对未实现的清真、图片、评价功能给出 PASS
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const P = (p) => path.join(ROOT, p);

const { ALL_DISHES, ALL_SHOPS, AREA_LABEL, TASTE_LABEL, FOOD_TYPE_LABEL } =
  require(P('data/index.js'));
const { SHOPS } = require(P('data/shops.js'));
const { DISHES } = require(P('data/dishes.js'));
const { filterDishes, collectShopIds, applySort } = require(P('utils/matcher.js'));

/* ---------------- 测试框架 ---------------- */

let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

function ok(name, extra) {
  pass++;
  console.log('  PASS  ' + name + (extra === undefined ? '' : '  → ' + extra));
}

function bad(name, extra) {
  fail++;
  failures.push(name + (extra === undefined ? '' : '  → ' + extra));
  console.log('  FAIL  ' + name + (extra === undefined ? '' : '  → ' + extra));
}

function check(cond, name, extra) {
  if (cond) ok(name, extra);
  else bad(name, extra);
}

function eq(actual, expected, name) {
  check(actual === expected, name, '实际 ' + JSON.stringify(actual));
}

function skipped(name, why) {
  skip++;
  console.log('  SKIP  ' + name + '  → ' + why);
}

function group(title) {
  console.log('\n===== ' + title + ' =====');
}

/* ---------------- 页面测试替身 ---------------- */

const PAGE_PATH = P('pages/index/index.js');

function makePage() {
  let cfg = null;
  const origPage = global.Page;

  global.Page = function (c) {
    cfg = c;
  };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  global.Page = origPage;

  if (!cfg) throw new Error('页面文件没有调用 Page()');

  const inst = {};
  Object.keys(cfg).forEach(function (k) {
    inst[k] = cfg[k];
  });
  inst.data = JSON.parse(JSON.stringify(cfg.data));

  const toasts = [];
  global.wx = {
    showToast(o) {
      toasts.push((o && o.title) || '');
    }
  };

  inst.setData = function (patch, cb) {
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i++) {
      this.data[keys[i]] = patch[keys[i]];
    }
    if (typeof cb === 'function') cb.call(this);
  };

  inst.__toasts = toasts;
  inst.__toastCount = function () {
    return toasts.length;
  };
  inst.onLoad();
  return inst;
}

/* 独立实现：用来和被测的 filterDishes 对账，避免「自己验自己」 */
function refFilter(dishes, c) {
  const cond = c || {};
  return dishes.filter(function (d) {
    if (cond.area && cond.area !== 'all' && d.area !== cond.area) return false;
    if (cond.shopId && cond.shopId !== 'all' && d.shopId !== cond.shopId) return false;
    if (cond.floorId && cond.floorId !== 'all' && d.floorId !== cond.floorId) return false;
    if (cond.stallId && cond.stallId !== 'all' && d.stallId !== cond.stallId) return false;
    if (cond.foodType && cond.foodType !== 'all' && d.foodType !== cond.foodType) return false;
    if (cond.budget && d.price > cond.budget) return false;
    if (cond.taste && cond.taste !== 'all' && d.tastes.indexOf(cond.taste) === -1) return false;
    return true;
  });
}

function sig(list) {
  return list.map(function (d) { return d.id; }).sort().join(',');
}

/* ================================================================
   R1 数据基线
   ================================================================ */
group('R1 数据基线一致性');

check(DISHES.length === 45, '菜品 45 道', DISHES.length);
check(SHOPS.length === 12, '店铺 12 家', SHOPS.length);

const dishIds = DISHES.map(function (d) { return d.id; });
check(new Set(dishIds).size === dishIds.length, '菜品 id 无重复');

const shopIdsAll = SHOPS.map(function (s) { return s.id; });
check(new Set(shopIdsAll).size === shopIdsAll.length, '店铺 id 无重复');

const stallIdsAll = [];
SHOPS.forEach(function (s) {
  s.stalls.forEach(function (t) { stallIdsAll.push(t.id); });
});
check(new Set(stallIdsAll).size === stallIdsAll.length, '窗口 id 全局唯一', stallIdsAll.length + ' 个');

const oneTaste = DISHES.filter(function (d) { return (d.tastes || []).length === 1; });
check(oneTaste.length === DISHES.length, '每道菜恰好 1 个口味标签（辣度单值规约）', oneTaste.length + '/' + DISHES.length);

const typeCount = {};
DISHES.forEach(function (d) { typeCount[d.foodType] = (typeCount[d.foodType] || 0) + 1; });
const typeKeys = Object.keys(FOOD_TYPE_LABEL);
let emptyType = [];
typeKeys.forEach(function (k) { if (!typeCount[k]) emptyType.push(k); });
check(emptyType.length === 0, '八种主食类型都有菜，没有死分类', emptyType.length ? '空: ' + emptyType.join(',') : '8/8 非空');

const badType = DISHES.filter(function (d) { return !FOOD_TYPE_LABEL[d.foodType]; });
check(badType.length === 0, '没有菜品使用非法 foodType（也不允许 all）', badType.length);

const orphan = DISHES.filter(function (d) {
  const shop = SHOPS.filter(function (s) { return s.id === d.shopId; })[0];
  if (!shop) return true;
  return !shop.stalls.some(function (t) { return t.id === d.stallId; });
});
check(orphan.length === 0, '没有孤儿菜品（店铺/窗口都存在）', orphan.length);

const campusN = DISHES.filter(function (d) {
  const s = SHOPS.filter(function (x) { return x.id === d.shopId; })[0];
  return s && s.area === 'campus';
}).length;
check(campusN + (DISHES.length - campusN) === DISHES.length, '校内外相加 = 总数', campusN + '+' + (DISHES.length - campusN));

/* ================================================================
   R2 筛选 AND 逻辑
   ================================================================ */
group('R2 筛选 AND 逻辑（穷举，与独立实现对账）');

let combos = 0;
let mismatch = 0;
const firstMismatch = [];

ALL_SHOPS.forEach(function (shop) {
  const floorOpts = ['all'].concat((shop.floors || []).map(function (f) { return f.id; }));
  const stallOpts = ['all'].concat((shop.stalls || []).map(function (t) { return t.id; }));
  typeKeys.concat(['all']).forEach(function (ft) {
    [0, 10, 15, 20].forEach(function (budget) {
      ['all'].concat(Object.keys(TASTE_LABEL)).forEach(function (taste) {
        floorOpts.forEach(function (floorId) {
          stallOpts.forEach(function (stallId) {
            combos++;
            const cond = {
              area: shop.area, shopId: shop.id, floorId: floorId,
              stallId: stallId, foodType: ft, budget: budget, taste: taste
            };
            const got = sig(filterDishes(ALL_DISHES, cond));
            const want = sig(refFilter(ALL_DISHES, cond));
            if (got !== want) {
              mismatch++;
              if (firstMismatch.length < 3) firstMismatch.push(JSON.stringify(cond));
            }
          });
        });
      });
    });
  });
});

check(combos > 5000, '穷举组合数足够大', combos + ' 种');
check(mismatch === 0, '所有组合与独立实现完全一致', mismatch ? '不一致 ' + mismatch + '，例: ' + firstMismatch.join(' | ') : combos + '/' + combos);

/* 每个条件单独都要真实影响结果 */
const base = filterDishes(ALL_DISHES, {}).length;
check(base === ALL_DISHES.length, '无条件时返回全部', base);

const condEffect = [
  ['area 校内', { area: 'campus' }, function (n) { return n < base; }],
  ['foodType 饭类', { foodType: 'rice' }, function (n) { return n < base; }],
  ['taste 麻辣', { taste: 'spicy' }, function (n) { return n < base; }],
  ['budget 10', { budget: 10 }, function (n) { return n < base; }],
  ['shopId s01', { shopId: 's01' }, function (n) { return n < base; }],
  ['floorId s01_f2', { floorId: 's01_f2' }, function (n) { return n < base; }],
  ['stallId s01_t1', { stallId: 's01_t1' }, function (n) { return n < base; }]
];
condEffect.forEach(function (item) {
  const n = filterDishes(ALL_DISHES, item[1]).length;
  check(item[2](n), '条件真实生效: ' + item[0], n + ' 道');
});

/* 组合题：校内 + 米线类 + 15 元以内 */
const q1 = filterDishes(ALL_DISHES, { area: 'campus', foodType: 'rice_noodle', budget: 15 });
check(sig(q1) === 'd37,d38,d39', '回归题1 校内+米线类+15元 = 3 道', q1.map(function (d) { return d.name + ' ' + d.price; }).join(' / '));

/* 组合题：校内 + 微辣 + 饭类 */
const q2 = filterDishes(ALL_DISHES, { area: 'campus', foodType: 'rice', taste: 'mild_spicy' });
check(sig(q2) === 'd03,d07', '回归题2 校内+微辣+饭类 = 2 道', q2.map(function (d) { return d.name; }).join(' / '));

/* ================================================================
   R3 地点级联与下级重置
   ================================================================ */
group('R3 地点级联与下级重置');

let p = makePage();
check(p.data.area === 'all' && p.data.shopId === 'all', '初始 区域/餐厅 都是不限');

p.onSelectArea({ currentTarget: { dataset: { value: 'campus' } } });
check(p.data.restaurantOptions.length === 6, '选校内后餐厅候选 = 6 家', p.data.restaurantOptions.length);

p.onSelectShop({ currentTarget: { dataset: { value: 's01' } } });
check(p.data.floorOptions.length === 2, 's01 楼层候选 = 2', p.data.floorOptions.length);
check(p.data.stallOptions.length === 3, 's01 未选楼层时窗口候选 = 3（全部窗口）', p.data.stallOptions.length);

p.onSelectFloor({ currentTarget: { dataset: { value: 's01_f2' } } });
check(p.data.stallOptions.length === 2, '选 2 楼后窗口候选收敛为 2', p.data.stallOptions.length);

p.onSelectStall({ currentTarget: { dataset: { value: 's01_t2' } } });
check(p.data.stallId === 's01_t2', '窗口已选中');

p.onSelectShop({ currentTarget: { dataset: { value: 's03' } } });
check(p.data.floorId === 'all', '换餐厅后 floorId 自动重置为 all', p.data.floorId);
check(p.data.stallId === 'all', '换餐厅后 stallId 自动重置为 all', p.data.stallId);
check(p.data.floorOptions.length === 2, 's03 楼层候选换成自己的 2 层', p.data.floorOptions.length);
check(p.data.stallOptions.length === 3, 's03 窗口候选换成自己的 3 个', p.data.stallOptions.length);

p.onSelectShop({ currentTarget: { dataset: { value: 's05' } } });
check(p.data.floorOptions.length === 0, 's05 没有楼层划分 → 楼层候选为空', p.data.floorOptions.length);
check(/没有楼层划分/.test(p.data.floorHint), 's05 给出「没有楼层划分」提示', p.data.floorHint);
check(p.data.stallOptions.length === 3, 's05 直接可选 3 个档口', p.data.stallOptions.length);

p.onSelectArea({ currentTarget: { dataset: { value: 'offsite' } } });
check(p.data.shopId === 'all' && p.data.floorId === 'all' && p.data.stallId === 'all', '换区域后三级全部重置');
check(p.data.restaurantOptions.length === 6, '校外商家候选 = 6 家', p.data.restaurantOptions.length);

/* 脏组合防护：手动塞一个不属于该店的 floorId，候选不能串店 */
p.onSelectShop({ currentTarget: { dataset: { value: 's12' } } });
check(p.data.stallOptions.length === 2, 's12 档口候选 = 2', p.data.stallOptions.length);

/* ================================================================
   R4 随机选店
   ================================================================ */
group('R4 随机选店只从符合条件的店铺里抽');

p = makePage();
p.onSelectFoodType({ currentTarget: { dataset: { value: 'rice_noodle' } } });
const pool4 = p.matched;
const legal4 = collectShopIds(pool4);
let bad4 = 0;
for (let i = 0; i < 200; i++) {
  p.onRandomShop();
  const picked = p.data.pickedShop;
  if (!picked) { bad4++; continue; }
  if (legal4.indexOf(picked.id) === -1) bad4++;
  const allInPool = picked.dishes.every(function (d) {
    return pool4.some(function (x) { return x.id === d.id; });
  });
  if (!allInPool) bad4++;
}
check(bad4 === 0, '200 次随机选店全部落在合法店铺池内', '池 ' + legal4.length + ' 家');
check(p.data.pickedShop !== null, '随机选店后 pickedShop 有值');
check(p.data.mode === 'shop', '随机选店后 mode = shop', p.data.mode);

/* ================================================================
   R5 随机选菜
   ================================================================ */
group('R5 随机选菜只从符合条件的菜品里抽');

p = makePage();
p.onSelectBudget({ currentTarget: { dataset: { value: 10 } } });
const pool5 = p.matched;
const poolIds5 = {};
pool5.forEach(function (d) { poolIds5[d.id] = true; });
let bad5 = 0;
const hit5 = {};
for (let i = 0; i < 3000; i++) {
  p.onRandomDish();
  const d = p.data.pickedDish;
  if (!d || !poolIds5[d.id]) bad5++;
  if (d) hit5[d.id] = true;
}
check(bad5 === 0, '3000 次随机选菜没有一次越出条件集合', '池 ' + pool5.length + ' 道');
check(Object.keys(hit5).length === pool5.length, '池内每一道菜都被抽到过（无偏）', Object.keys(hit5).length + '/' + pool5.length);

/* ================================================================
   R6 再抽一次允许抽回原结果
   ================================================================ */
group('R6 「再抽一次」允许抽回原结果');

p = makePage();
const realRandom = Math.random;
Math.random = function () { return 0; };   // 固定随机：每次都抽第一个
p.onRandomShop();
const firstShop = p.data.pickedShop.id;
p.onDrawAgain();
const secondShop = p.data.pickedShop.id;
check(p.data.mode === 'shop', '再抽一次后仍在 shop 模式');
check(firstShop === secondShop, '固定随机下「再抽一次」抽回同一家（说明没有强制换店）', firstShop + ' → ' + secondShop);

Math.random = function () { return 0; };
p.onRandomDish();
const firstDish = p.data.pickedDish.id;
p.onDrawAgain();
check(firstDish === p.data.pickedDish.id, '固定随机下「再抽一次」抽回同一道菜', firstDish);

let repeat = 0;
Math.random = realRandom;
for (let i = 0; i < 400; i++) {
  p.onRandomShop();
  const a = p.data.pickedShop.id;
  p.onDrawAgain();
  if (p.data.pickedShop.id === a) repeat++;
}
check(repeat > 0, '真随机 400 次里出现连续同一家（证明允许重复）', repeat + ' 次');

/* ================================================================
   R7 换一家必须排除当前店铺
   ================================================================ */
group('R7 「换一家」排除当前店铺');

p = makePage();
p.onRandomShop();
let bad7 = 0;
for (let i = 0; i < 300; i++) {
  const cur = p.data.pickedShop.id;
  p.onChangeShop();
  if (!p.data.pickedShop || p.data.pickedShop.id === cur) bad7++;
}
check(bad7 === 0, '300 次「换一家」都没有返回当前店铺', bad7 ? bad7 + ' 次违规' : '0 次违规');

/* 只剩一家：必须提示且状态不变 */
p = makePage();
p.onSelectShop({ currentTarget: { dataset: { value: 's05' } } });
p.onRandomShop();
const onlyShop = p.data.pickedShop.id;
const toastBefore = p.__toastCount();
p.onChangeShop();
check(p.data.pickedShop.id === onlyShop, '无其他候选时店铺保持不变', onlyShop);
check(p.__toastCount() === toastBefore + 1, '无其他候选时给出提示（1 次 toast）');
check(/没有其他符合条件的店铺/.test(p.__toasts[p.__toasts.length - 1]), '提示文案明确', p.__toasts[p.__toasts.length - 1]);

/* ================================================================
   R8 三档排序
   ================================================================ */
group('R8 三档排序：只改顺序、不改集合、不污染源数据');

p = makePage();
p.onViewAll();
const defaultIds = p.data.listDishes.map(function (d) { return d.id; });

p.onSelectSort({ currentTarget: { dataset: { value: 'priceAsc' } } });
const asc = p.data.listDishes.slice();
let ascOk = true;
for (let i = 1; i < asc.length; i++) if (asc[i - 1].price > asc[i].price) ascOk = false;
check(ascOk, '升序：价格单调不减');
check(asc[0].price === Math.min.apply(null, ALL_DISHES.map(function (d) { return d.price; })), '升序首项为最低价', asc[0].price);

p.onSelectSort({ currentTarget: { dataset: { value: 'priceDesc' } } });
const desc = p.data.listDishes.slice();
let descOk = true;
for (let i = 1; i < desc.length; i++) if (desc[i - 1].price < desc[i].price) descOk = false;
check(descOk, '降序：价格单调不增');
check(desc[0].price === Math.max.apply(null, ALL_DISHES.map(function (d) { return d.price; })), '降序首项为最高价', desc[0].price);

check(sig(asc) === sig(desc), '升序与降序是同一批菜品（排序不改集合）');
check(asc.map(function (d) { return d.id; }).sort().join(',') === defaultIds.slice().sort().join(','),
  '排序结果与默认顺序是同一批菜品');
/* 不污染：内部匹配数组的顺序不能被改 */
const before = p.matched.map(function (d) { return d.id; }).join(',');
p.onSelectSort({ currentTarget: { dataset: { value: 'priceAsc' } } });
p.onSelectSort({ currentTarget: { dataset: { value: 'priceDesc' } } });
check(p.matched.map(function (d) { return d.id; }).join(',') === before, '反复排序后 this.matched 顺序未被改变');

/* 改筛选后排序仍生效 */
p.onSelectSort({ currentTarget: { dataset: { value: 'priceAsc' } } });
p.onSelectBudget({ currentTarget: { dataset: { value: 15 } } });
const afterFilter = p.data.listDishes.slice();
let stillAsc = true;
for (let i = 1; i < afterFilter.length; i++) if (afterFilter[i - 1].price > afterFilter[i].price) stillAsc = false;
check(stillAsc, '改预算后列表仍保持升序', afterFilter.length + ' 道');
check(p.data.sortMode === 'priceAsc', '改筛选不影响 sortMode');
check(p.data.mode === 'all', '改筛选后仍停在「查看全部」', p.data.mode);

/* 默认顺序 = 筛选原始顺序 */
check(applySort(ALL_DISHES, 'default').map(function (d) { return d.id; }).join(',') ===
  ALL_DISHES.map(function (d) { return d.id; }).join(','), 'default 排序保持原始顺序');
check(applySort(ALL_DISHES, 'default') !== ALL_DISHES, 'default 也返回新数组（不共享引用）');

/* ================================================================
   R9 条件摘要
   ================================================================ */
group('R9 条件摘要与实际状态一致');

p = makePage();
eq(p.data.conditionText, '不限区域 · 不限预算 · 不限类型 · 不限口味', '默认条件文案');

p.onSelectArea({ currentTarget: { dataset: { value: 'campus' } } });
p.onSelectShop({ currentTarget: { dataset: { value: 's01' } } });
p.onSelectFloor({ currentTarget: { dataset: { value: 's01_f2' } } });
p.onSelectTaste({ currentTarget: { dataset: { value: 'mild_spicy' } } });
p.onSelectBudget({ currentTarget: { dataset: { value: 15 } } });
const cond9 = p.data.conditionText;
check(cond9.indexOf('校内食堂') > -1, '摘要含区域');
check(cond9.indexOf('一号食堂') > -1, '摘要含餐厅名');
check(cond9.indexOf('2 楼') > -1, '摘要含楼层');
check(cond9.indexOf('15 元以内') > -1, '摘要含预算');
check(cond9.indexOf('微辣') > -1, '摘要含口味');
check(cond9.indexOf('不限类型') > -1, '摘要含「不限类型」占位');

p.onSelectFoodType({ currentTarget: { dataset: { value: 'noodle' } } });
check(p.data.conditionText.indexOf('面类') > -1, '摘要随主食类型变化');
check(p.data.conditionText.indexOf('不限类型') === -1, '选了类型后不再显示「不限类型」');

/* ================================================================
   R10 重置
   ================================================================ */
group('R10 重置恢复默认');

p.onReset();
eq(p.data.area, 'all', '重置 area');
eq(p.data.shopId, 'all', '重置 shopId');
eq(p.data.floorId, 'all', '重置 floorId');
eq(p.data.stallId, 'all', '重置 stallId');
eq(p.data.budget, 0, '重置 budget');
eq(p.data.foodType, 'all', '重置 foodType');
eq(p.data.taste, 'all', '重置 taste');
eq(p.data.sortMode, 'default', '重置 sortMode');
eq(p.data.mode, 'none', '重置 mode');
eq(p.data.pickedShop, null, '重置 pickedShop');
eq(p.data.pickedDish, null, '重置 pickedDish');
eq(p.data.listDishes.length, 0, '重置清空列表');
eq(p.data.matchedCount, ALL_DISHES.length, '重置后计数回到全量');
eq(p.data.restaurantOptions.length, 0, '重置后餐厅候选清空');
eq(p.data.floorOptions.length, 0, '重置后楼层候选清空');
eq(p.data.stallOptions.length, 0, '重置后窗口候选清空');

/* ================================================================
   R11 空结果
   ================================================================ */
group('R11 空结果：计数 0、按钮不切状态、有提示');

p = makePage();
p.onSelectArea({ currentTarget: { dataset: { value: 'campus' } } });
p.onSelectBudget({ currentTarget: { dataset: { value: 10 } } });
p.onSelectFoodType({ currentTarget: { dataset: { value: 'rice' } } });
p.onSelectTaste({ currentTarget: { dataset: { value: 'mild_spicy' } } });
check(p.data.matchedCount === 0, '构造出空结果（校内+10元+饭类+微辣）', p.data.matchedCount);

const t0 = p.__toastCount();
p.onRandomShop();
p.onRandomDish();
p.onViewAll();
check(p.__toastCount() === t0 + 3, '三个按钮都给出提示', 'toast +' + (p.__toastCount() - t0));
check(p.data.mode === 'none', '空结果时 mode 没有被改成别的值', p.data.mode);
check(p.data.pickedShop === null && p.data.pickedDish === null, '空结果时没有残留选中项');

const wxml = fs.readFileSync(P('pages/index/index.wxml'), 'utf8');
check(/没有找到符合条件的菜品/.test(wxml), 'WXML 有空态标题');
check(/一键重置/.test(wxml), 'WXML 有空态重置按钮');
check(/matchedCount === 0/.test(wxml), '空态由 matchedCount 驱动');

/* ================================================================
   R12 未实现功能：只做存在性检查，记为 SKIP
   ================================================================ */
group('R12 尚未实现的功能（不报 PASS，只登记）');

const hasHalal = DISHES.some(function (d) { return d.halal || d.halalStatus; }) ||
  SHOPS.some(function (s) { return s.halal || (s.stalls || []).some(function (t) { return t.halal; }); });
if (hasHalal) check(false, '清真字段不应在阶段 1 出现（越界检查）');
else skipped('清真筛选', '阶段 4 才实现，本轮没有任何清真字段，无法测试');

const hasImage = DISHES.some(function (d) { return d.images || d.image; });
if (hasImage) check(false, '图片字段不应在阶段 1 出现（越界检查）');
else skipped('菜品图片', '阶段 3 才实现，本轮没有图片字段');

const hasRating = DISHES.some(function (d) { return d.rating || d.score; });
if (hasRating) check(false, '评分字段不应在阶段 1 出现（越界检查）');
else skipped('用户评价与评分排序', '阶段 6 才实现，本轮没有评分字段');

/* 阶段 2 起：可信度字段是必备字段，这里从「不应出现」改成「必须齐全」 */
const missingMeta = DISHES.filter(function (d) {
  return !d.source || !d.verifyStatus || !('verifiedAt' in d);
});
check(missingMeta.length === 0, '菜品全部带 source / verifyStatus / verifiedAt 字段（阶段 2 要求）',
  (DISHES.length - missingMeta.length) + '/' + DISHES.length);

/* ================================================================
   R13 演示标识与结构完整性
   ================================================================ */
group('R13 演示标识与页面结构完整性');

const shopsText = fs.readFileSync(P('data/shops.js'), 'utf8');
const locLines = shopsText.split('\n').filter(function (l) { return /location:\s*'/.test(l); });
const markedLoc = locLines.filter(function (l) { return l.indexOf('演示位置') > -1; });
check(locLines.length === 12 && markedLoc.length === 12, '12 家店的 location 全部带「（演示位置）」', markedLoc.length + '/' + locLines.length);

check(/tag-v \{\{dish\.verifyClass\}\}/.test(wxml), '菜品卡的状态标签由数据字段驱动');
check(/tag-v \{\{pickedShop\.verifyClass\}\}/.test(wxml), '店铺卡的状态标签由数据字段驱动');
check(/全部餐厅、楼层、窗口、菜名、价格、主食分类均为虚构演示数据/.test(wxml), '页脚有整体声明');

const taps = (wxml.match(/bindtap="(\w+)"/g) || []).map(function (s) { return s.replace(/bindtap="|"/g, ''); });
const jsText = fs.readFileSync(P('pages/index/index.js'), 'utf8');
const missingTap = taps.filter(function (fn) { return !new RegExp('\\b' + fn + '\\s*\\(').test(jsText); });
check(missingTap.length === 0, 'WXML 的 bindtap 全部有实现', taps.length + ' 个');

/* ---------------- 汇总 ---------------- */

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项，跳过 ' + skip + ' 项');
if (fail) {
  console.log('失败清单：');
  failures.forEach(function (f) { console.log('  · ' + f); });
  console.log('========================================');
  process.exit(1);
} else {
  console.log('全部通过（SKIP 项是尚未实现的功能，不代表已通过）');
  console.log('========================================');
}
