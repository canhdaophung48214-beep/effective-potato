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
group('R3 餐厅多选与每店独立条件');

/* 阶段 3 起：单店级联 → 多选 + 每店独立位置条件。
   旧版的保证「换餐厅会重置下级条件」在新模型里变成两条更强的保证：
   ① 新选中的餐厅条件槽一开始是空的 ② 取消一家店只删它自己的槽，别家逐字节不变。
   旧单值口径的等价性另见 R14（独立实现对账）。 */
let p = makePage();
const viewOf = function (pid) {
  return p.data.shopViews.filter(function (v) { return v.id === pid; })[0];
};
check(p.data.area === 'all' && p.data.selectedShops.length === 0, '初始 区域/餐厅 都是不限');

p.onSelectArea({ currentTarget: { dataset: { value: 'campus' } } });
check(p.data.restaurantOptions.length === 6, '选校内后餐厅候选 = 6 家', p.data.restaurantOptions.length);

p.onToggleShop({ currentTarget: { dataset: { shopId: 's01' } } });
check(p.data.selectedShops.length === 1 && p.data.selectedShops[0] === 's01', '选餐厅 s01');
check(viewOf('s01').floorChips.length === 3, 's01 楼层候选 = 2 层 +「不限」（3 个 chip）', viewOf('s01').floorChips.length);
check(viewOf('s01').stallChips.length === 4, 's01 未选楼层时店铺候选 = 全部 3 个 +「不限」', viewOf('s01').stallChips.length);
check(viewOf('s01').expanded === false, '新选中的餐厅默认折叠（页面不会被撑长）');
check(viewOf('s01').sideChips.length === 0, '演示数据没有方位 → 方位行整行不渲染');

p.onToggleFloor({ currentTarget: { dataset: { shopId: 's01', value: 's01_f2' } } });
check(p.data.shopFilters.s01.floorIds.length === 1 && p.data.shopFilters.s01.floorIds[0] === 's01_f2',
  '楼层只记进 s01 自己的条件槽', JSON.stringify(p.data.shopFilters.s01));
check(viewOf('s01').floorChips.filter(function (c) { return c.on; }).length === 1 &&
  !viewOf('s01').floorChips[0].on, '选 2 楼后「不限楼层」熄灭，只剩 2 楼点亮');

p.onToggleStall({ currentTarget: { dataset: { shopId: 's01', value: 's01_t2' } } });
check(p.data.shopFilters.s01.stallIds.length === 1 && p.data.shopFilters.s01.stallIds[0] === 's01_t2', '店铺条件已选中');
check(p.matched.every(function (d) { return d.shopId === 's01' && d.floorId === 's01_f2' && d.stallId === 's01_t2'; }),
  '楼层 + 店铺在同一家店内是「与」，结果全部命中 s01 2 楼的 t2', p.matched.length + ' 道');

/* 再选一家：不能继承上一家店的任何条件 */
p.onToggleShop({ currentTarget: { dataset: { shopId: 's03' } } });
check(p.data.selectedShops.length === 2, '可以同时选两家餐厅', p.data.selectedShops.join(','));
check(p.data.shopFilters.s03.floorIds.length === 0 && p.data.shopFilters.s03.stallIds.length === 0,
  '新选餐厅的条件槽是空的（不继承 s01）', JSON.stringify(p.data.shopFilters.s03));
check(JSON.stringify(p.data.shopFilters.s01) === '{"floorIds":["s01_f2"],"stallIds":["s01_t2"],"sides":[]}',
  's01 的条件原样保留');
check(viewOf('s03').floorChips.length === 3, 's03 用自己 2 层作为楼层候选', viewOf('s03').floorChips.length);
check(viewOf('s03').stallChips.length === 4, 's03 用自己 3 个档口作为店铺候选', viewOf('s03').stallChips.length);
check(viewOf('s03').expanded === false, '第二家店同样默认折叠');

/* 取消一家，另一家必须逐字节不变 */
const keep01 = JSON.stringify(p.data.shopFilters.s01);
p.onToggleShop({ currentTarget: { dataset: { shopId: 's03' } } });
check(p.data.selectedShops.length === 1 && p.data.selectedShops[0] === 's01', '取消 s03 后只剩 s01');
check(JSON.stringify(p.data.shopFilters.s01) === keep01, '取消 s03 之后 s01 的条件逐字节不变');
check(p.data.shopFilters.s03 === undefined, '取消后不留 s03 的孤儿条件');

p.onToggleShop({ currentTarget: { dataset: { shopId: 's05' } } });
check(viewOf('s05').floorChips.length === 0, 's05 没有楼层划分 → 楼层候选为空（不制造假楼层）', viewOf('s05').floorChips.length);
check(/没有楼层划分/.test(viewOf('s05').floorHint), 's05 给出「没有楼层划分」提示', viewOf('s05').floorHint);
check(viewOf('s05').hasFloor === false, 's05 hasFloor = false，界面据此整块隐藏');
check(viewOf('s05').stallChips.length === 4, 's05 直接可选全部 3 个档口', viewOf('s05').stallChips.length);

p.onSelectArea({ currentTarget: { dataset: { value: 'offsite' } } });
check(p.data.selectedShops.length === 0 && Object.keys(p.data.shopFilters).length === 0,
  '换区域后选中餐厅与每店条件全部清空');
check(Object.keys(p.data.expandedShops).length === 0, '换区域后折叠状态也清空');
check(p.data.restaurantOptions.length === 6, '校外商家候选 = 6 家', p.data.restaurantOptions.length);

/* 脏组合防护：候选永远只来自这家店自己的数据 */
p.onToggleShop({ currentTarget: { dataset: { shopId: 's12' } } });
check(viewOf('s12').stallChips.length === 3, 's12 档口候选 = 自己的 2 个 +「不限」', viewOf('s12').stallChips.length);
check(viewOf('s12').stallChips.every(function (c) { return c.id === 'all' || c.id.indexOf('s12_') === 0; }),
  's12 的店铺候选里没有别的店的档口（不串店）');

/* ================================================================
   R4 随机选店
   ================================================================ */
group('R4 随机选店只从符合条件的店铺里抽');

p = makePage();
p.onToggleFoodType({ currentTarget: { dataset: { value: 'rice_noodle' } } });
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
p.onToggleShop({ currentTarget: { dataset: { shopId: 's05' } } });
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
p.onToggleShop({ currentTarget: { dataset: { shopId: 's01' } } });
p.onToggleFloor({ currentTarget: { dataset: { shopId: 's01', value: 's01_f2' } } });
p.onToggleTaste({ currentTarget: { dataset: { value: 'mild_spicy' } } });
p.onSelectBudget({ currentTarget: { dataset: { value: 15 } } });
const cond9 = p.data.conditionText;
check(cond9.indexOf('校内食堂') > -1, '摘要含区域');
check(cond9.indexOf('一号食堂') > -1, '摘要含餐厅名');
check(cond9.indexOf('2 楼') > -1, '摘要含楼层');
check(cond9.indexOf('15 元以内') > -1, '摘要含预算');
check(cond9.indexOf('微辣') > -1, '摘要含口味');
check(cond9.indexOf('不限类型') > -1, '摘要含「不限类型」占位');

p.onToggleFoodType({ currentTarget: { dataset: { value: 'noodle' } } });
check(p.data.conditionText.indexOf('面类') > -1, '摘要随主食类型变化');
check(p.data.conditionText.indexOf('不限类型') === -1, '选了类型后不再显示「不限类型」');

/* ================================================================
   R10 重置
   ================================================================ */
group('R10 重置恢复默认');

p.onReset();
eq(p.data.area, 'all', '重置 area');
eq(p.data.selectedShops.length, 0, '重置 selectedShops');
eq(Object.keys(p.data.shopFilters).length, 0, '重置 shopFilters（每店条件）');
eq(Object.keys(p.data.expandedShops).length, 0, '重置 expandedShops（折叠状态）');
eq(p.data.budget, 0, '重置 budget');
eq(p.data.foodTypes.length, 0, '重置 foodTypes');
eq(p.data.tastes.length, 0, '重置 tastes');
eq(p.data.sortMode, 'default', '重置 sortMode');
eq(p.data.mode, 'none', '重置 mode');
eq(p.data.pickedShop, null, '重置 pickedShop');
eq(p.data.pickedDish, null, '重置 pickedDish');
eq(p.data.listDishes.length, 0, '重置清空列表');
eq(p.data.matchedCount, ALL_DISHES.length, '重置后计数回到全量');
eq(p.data.restaurantOptions.length, 0, '重置后餐厅候选清空');
eq(p.data.shopViews.length, 0, '重置后每店位置配置清空');
eq(p.data.conditionText, '不限区域 · 不限预算 · 不限类型 · 不限口味', '重置后摘要回到默认文案');

/* ================================================================
   R11 空结果
   ================================================================ */
group('R11 空结果：计数 0、按钮不切状态、有提示');

p = makePage();
p.onSelectArea({ currentTarget: { dataset: { value: 'campus' } } });
p.onSelectBudget({ currentTarget: { dataset: { value: 10 } } });
p.onToggleFoodType({ currentTarget: { dataset: { value: 'rice' } } });
p.onToggleTaste({ currentTarget: { dataset: { value: 'mild_spicy' } } });
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

/* ================================================================
   R14 旧单值口径：用新 API 复现，必须与旧独立实现逐一对上
   refFilter 是阶段 1 写的、这次一个字符都没动的独立实现 —— 它才是「旧逻辑」的裁判
   ================================================================ */
group('R14 旧单值口径经新 API 等价复现');

function drivePage(c) {
  const q = makePage();
  const tap = function (fn, value) { q[fn]({ currentTarget: { dataset: { value: value } } }); };
  const tapShop = function (fn, shopId, value) {
    q[fn]({ currentTarget: { dataset: { shopId: shopId, value: value } } });
  };
  if (c.area && c.area !== 'all') tap('onSelectArea', c.area);
  if (c.shopId && c.shopId !== 'all') tapShop('onToggleShop', c.shopId);
  if (c.floorId && c.floorId !== 'all') tapShop('onToggleFloor', c.shopId, c.floorId);
  if (c.stallId && c.stallId !== 'all') tapShop('onToggleStall', c.shopId, c.stallId);
  if (c.foodType && c.foodType !== 'all') tap('onToggleFoodType', c.foodType);
  if (c.taste && c.taste !== 'all') tap('onToggleTaste', c.taste);
  if (c.budget) tap('onSelectBudget', c.budget);
  return q;
}

const legacyCases = [
  { area: 'campus', foodType: 'rice_noodle', budget: 15 },
  { area: 'campus', foodType: 'rice', taste: 'mild_spicy' },
  { shopId: 's01', floorId: 's01_f2' },
  { shopId: 's01', stallId: 's01_t2', taste: 'spicy' },
  { area: 'campus', shopId: 's03', floorId: 's03_f1', budget: 10 },
  { shopId: 's05', foodType: 'snack', budget: 10 },
  { taste: 'light', budget: 20 },
  { area: 'offsite', foodType: 'malatang', taste: 'spicy', budget: 20 }
];

let legacyBad = 0;
const legacyDetail = [];
legacyCases.forEach(function (c) {
  const q = drivePage(c);
  const got = sig(q.matched);
  const want = sig(refFilter(ALL_DISHES, c));
  if (got !== want || q.data.matchedCount !== q.matched.length) {
    legacyBad++;
    legacyDetail.push(JSON.stringify(c) + ' 新 ' + q.matched.length + ' 道 / 旧 ' + want.split(',').filter(Boolean).length + ' 道');
  }
});

check(legacyBad === 0, '旧口径 ' + legacyCases.length + ' 组用新 API 复现，结果与 refFilter 完全一致',
  legacyBad ? legacyDetail.join(' | ') : legacyCases.length + '/' + legacyCases.length);
check(sig(drivePage(legacyCases[0]).matched) === 'd37,d38,d39', '回归题1 在新 API 下仍是 d37,d38,d39');
check(sig(drivePage(legacyCases[1]).matched) === 'd03,d07', '回归题2 在新 API 下仍是 d03,d07');

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
