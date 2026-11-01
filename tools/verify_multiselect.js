/**
 * 阶段 3 专项：多选筛选 + 每店独立位置条件 + 方位 / 窗口编号三态
 *
 *   node tools/verify_multiselect.js
 *
 * 设计原则（和 regression.js 一致）：
 *   1. 内核判断一律和一份**独立实现**对账，不自己验自己
 *   2. 真实数据只用来验「演示数据下应该是什么样」，不往数据里塞任何值
 *   3. 方位 / 编号三态 / 无楼层这些当前数据里没有的东西，用**合成夹具**验证，
 *      夹具写在测试里，不进 data/ 目录 —— 绝不伪造真实餐厅数据
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const P = (p) => path.join(ROOT, p);

const {
  ALL_DISHES,
  ALL_SHOPS,
  SIDE_LABEL,
  STALL_NO_STATUS,
  describeStall
} = require(P('data/index.js'));
const M = require(P('utils/matcher.js'));

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
  check(actual === expected, name, '实际 ' + JSON.stringify(actual) + ' / 期望 ' + JSON.stringify(expected));
}

function skipped(name, why) {
  skip++;
  console.log('  SKIP  ' + name + '  → ' + why);
}

function group(title) {
  console.log('\n===== ' + title + ' =====');
}

/* ---------------- 页面测试替身（同 regression.js 的做法） ---------------- */

const PAGE_PATH = P('pages/index/index.js');

function makePage() {
  let cfg = null;
  const origPage = global.Page;

  global.Page = function (c) { cfg = c; };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  global.Page = origPage;

  if (!cfg) throw new Error('页面文件没有调用 Page()');

  const inst = {};
  Object.keys(cfg).forEach(function (k) { inst[k] = cfg[k]; });
  inst.data = JSON.parse(JSON.stringify(cfg.data));

  const toasts = [];
  global.wx = {
    showToast(o) { toasts.push((o && o.title) || ''); }
  };

  inst.setData = function (patch, cb) {
    const keys = Object.keys(patch);
    for (let i = 0; i < keys.length; i++) this.data[keys[i]] = patch[keys[i]];
    if (typeof cb === 'function') cb.call(this);
  };

  inst.__toasts = toasts;
  inst.__toastCount = function () { return toasts.length; };
  inst.onLoad();
  return inst;
}

function ev(value) { return { currentTarget: { dataset: { value: value } } }; }
function evShop(shopId, value) {
  const ds = { shopId: shopId };
  if (value !== undefined) ds.value = value;
  return { currentTarget: { dataset: ds } };
}

/* ---------------- 独立实现 ---------------- */

function pickSet(v) {
  const out = [];
  (v || []).forEach(function (x) {
    if (x === undefined || x === null || x === '' || x === 'all') return;
    if (out.indexOf(x) === -1) out.push(x);
  });
  return out;
}

/** 阶段 3 的独立实现：餐厅多选 + 每店独立条件 + 多值类型 / 口味 */
function refMulti(dishes, cond) {
  const c = cond || {};
  const scopes = (c.shops || []).filter(function (s) { return s && s.shopId && s.shopId !== 'all'; });

  return dishes.filter(function (d) {
    if (c.area && c.area !== 'all' && d.area !== c.area) return false;

    if (scopes.length) {
      let hit = false;
      for (let i = 0; i < scopes.length; i++) {
        const s = scopes[i];
        if (d.shopId !== s.shopId) continue;

        const fl = pickSet(s.floorIds);
        const st = pickSet(s.stallIds);
        const sd = pickSet(s.sides);

        if (fl.length && fl.indexOf(d.floorId) === -1) continue;
        if (st.length && st.indexOf(d.stallId) === -1) continue;
        if (sd.length && sd.indexOf(d.side || '') === -1) continue;

        hit = true;
        break;
      }
      if (!hit) return false;
    } else {
      if (c.shopId && c.shopId !== 'all' && d.shopId !== c.shopId) return false;
      if (c.floorId && c.floorId !== 'all' && d.floorId !== c.floorId) return false;
      if (c.stallId && c.stallId !== 'all' && d.stallId !== c.stallId) return false;
    }

    const fts = Array.isArray(c.foodTypes) ? pickSet(c.foodTypes)
      : (c.foodType && c.foodType !== 'all' ? [c.foodType] : []);
    if (fts.length && fts.indexOf(d.foodType) === -1) return false;

    if (c.budget && d.price > c.budget) return false;

    const ts = Array.isArray(c.tastes) ? pickSet(c.tastes)
      : (c.taste && c.taste !== 'all' ? [c.taste] : []);
    if (ts.length) {
      const dt = d.tastes || [];
      let hit2 = false;
      for (let i = 0; i < dt.length; i++) if (ts.indexOf(dt[i]) !== -1) hit2 = true;
      if (!hit2) return false;
    }

    return true;
  });
}

/** 阶段 1 / 2 的旧独立实现，用来证明旧口径没被改坏 */
function refLegacy(dishes, c) {
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

const sig = (list) => list.map(function (d) { return d.id; }).sort().join(',');
const shopOf = (id) => ALL_SHOPS.filter(function (s) { return s.id === id; })[0];

/* ================================================================
   合成夹具：方位 + 编号三态 + 无楼层 / 无编号的餐厅
   只存在于测试内存里，绝不写进 data/
   ================================================================ */
function buildFixture() {
  const shops = [
    {
      id: 'fx1', name: '虚构甲餐厅', area: 'campus',
      floors: [{ id: 'fx1_f1', label: '1 楼' }, { id: 'fx1_f2', label: '2 楼' }],
      stalls: [
        /* 有编号 + 东面 */
        { id: 'fx1_t1', floorId: 'fx1_f1', name: '面食档', side: 'east', noStatus: 'has', no: '1' },
        /* 确认无编号 + 西面 */
        { id: 'fx1_t2', floorId: 'fx1_f2', name: '热菜档', side: 'west', noStatus: 'none' }
      ]
    },
    {
      id: 'fx2', name: '虚构乙餐厅', area: 'campus',
      /* 没有楼层划分的餐厅 */
      floors: [],
      stalls: [
        { id: 'fx2_t1', floorId: '', name: '主食档', side: 'south', noStatus: 'none' }
      ]
    },
    {
      id: 'fx3', name: '虚构丙餐厅', area: 'campus',
      floors: [{ id: 'fx3_f2', label: '2 楼' }],
      /* 方位完全未采集的餐厅 */
      stalls: [
        { id: 'fx3_t1', floorId: 'fx3_f2', name: '烧烤档', noStatus: 'unverified' }
      ]
    }
  ];

  const dishSpecs = [
    { id: 'fx_d1', name: '阳春面', price: 8, foodType: 'noodle', shopId: 'fx1', stallId: 'fx1_t1', tastes: ['light'] },
    { id: 'fx_d2', name: '盖浇饭', price: 12, foodType: 'rice', shopId: 'fx1', stallId: 'fx1_t2', tastes: ['spicy'] },
    { id: 'fx_d3', name: '馒头', price: 2, foodType: 'snack', shopId: 'fx2', stallId: 'fx2_t1', tastes: ['light'] },
    { id: 'fx_d4', name: '烤串', price: 18, foodType: 'other', shopId: 'fx3', stallId: 'fx3_t1', tastes: ['spicy'] }
  ];

  const dishes = dishSpecs.map(function (d) {
    const shop = shops.filter(function (s) { return s.id === d.shopId; })[0] || {};
    const stall = (shop.stalls || []).filter(function (t) { return t.id === d.stallId; })[0];
    const info = describeStall(stall);
    const floor = (shop.floors || []).filter(function (f) { return f.id === info.floorId; })[0];

    return Object.assign({}, d, {
      area: shop.area || '',
      floorId: info.floorId,
      floorText: floor ? floor.label : '',
      side: info.side,
      sideText: info.sideText,
      stallNoStatus: info.noStatus,
      stallLabel: info.label
    });
  });

  return { shops: shops, dishes: dishes };
}

const FX = buildFixture();

/* ================================================================
   G1 窗口编号三态：空字符串不再同时承担两种含义
   ================================================================ */
group('G1 窗口编号三态（has / none / unverified）');

{
  const has = describeStall({ id: 'x', name: '面食档', noStatus: 'has', no: '7' });
  eq(has.noStatus, STALL_NO_STATUS.HAS, 'has：状态保留为 has');
  eq(has.no, '7', 'has：编号取到 7');
  eq(has.noText, '7 号窗口', 'has：只有这一种情况才生成「N 号窗口」');
  eq(has.label, '7 号窗口', 'has：展示名用编号');

  const none = describeStall({ id: 'y', name: '热菜档', noStatus: 'none' });
  eq(none.noStatus, STALL_NO_STATUS.NONE, 'none：状态是「确认无编号」');
  eq(none.no, '', 'none：不带编号');
  eq(none.noText, '', 'none：不生成任何编号文字');
  eq(none.label, '热菜档', 'none：展示名用店名');

  const unv = describeStall({ id: 'z', name: '烧烤档' });
  eq(unv.noStatus, STALL_NO_STATUS.UNVERIFIED, '缺省字段 = 编号尚未核实，不是「确认无编号」');
  eq(unv.noText, '', 'unverified：不生成编号文字');
  check(unv.noStatus !== none.noStatus, '「尚未核实」和「确认无编号」是两个不同的状态值');

  const claim = describeStall({ id: 'w', name: '某档', noStatus: 'has' });
  eq(claim.noStatus, STALL_NO_STATUS.UNVERIFIED, '说 has 却没给编号 → 降级为 unverified，不补默认号');
  eq(claim.noText, '', '降级后同样不生成编号文字');

  const illegal = describeStall({ id: 'v', name: '某档', noStatus: 'whatever', no: '9' });
  eq(illegal.noStatus, STALL_NO_STATUS.UNVERIFIED, '非法状态值 → unverified');
  eq(illegal.noText, '', '非法状态值不读取 no 字段');

  const empty = describeStall({ id: 'u', noStatus: 'none' });
  eq(empty.label, '未命名店铺', '连店名都没有时显示「未命名店铺」，不拿编号占位');

  const gone = describeStall(undefined);
  eq(gone.noStatus, STALL_NO_STATUS.UNVERIFIED, '窗口记录不存在 → unverified');
  eq(gone.label, '', '窗口记录不存在 → 不生成展示名');
}

/* ================================================================
   G2 真实数据：方位尚未采集，所以一处都不该出现
   ================================================================ */
group('G2 真实数据里没有方位，就没有方位筛选');

{
  const withSide = ALL_DISHES.filter(function (d) { return !!d.side; });
  eq(withSide.length, 0, '真实菜品里 side 全部为空（本轮没有导入任何方位数据）');

  const shopsWithSide = ALL_SHOPS.filter(function (s) { return s.hasSide; });
  eq(shopsWithSide.length, 0, '12 家店里没有任何一家提供方位候选');
  eq(ALL_SHOPS.filter(function (s) { return (s.stallSideOptions || []).length; }).length, 0,
    'stallSideOptions 全部为空数组 → 界面不会渲染方位这一行');

  const noTextAnywhere = ALL_DISHES.filter(function (d) { return !!d.stallNoText; });
  eq(noTextAnywhere.length, 0, '没有一条菜凭空生成「N 号窗口」文字');

  const badStatus = ALL_DISHES.filter(function (d) {
    return d.stallNoStatus !== 'has' && d.stallNoStatus !== 'none' && d.stallNoStatus !== 'unverified';
  });
  eq(badStatus.length, 0, '每条菜的 stallNoStatus 都落在三态之内');

  const unverified = ALL_SHOP_STALLS_UNVERIFIED();
  check(unverified === true, '演示数据的 24 个窗口全部是「尚未核实」（不是「确认无编号」）');
}

function ALL_SHOP_STALLS_UNVERIFIED() {
  let total = 0;
  let unv = 0;
  ALL_SHOPS.forEach(function (s) {
    (s.stallList || []).forEach(function (t) {
      total++;
      if (t.noStatus === 'unverified') unv++;
    });
  });
  return total === 24 && unv === 24;
}

/* ================================================================
   G3 数据层：楼层仍从窗口反查，无楼层餐厅不制造假楼层
   ================================================================ */
group('G3 数据结构：楼层 / 店铺候选只来自真实数据');

{
  const s05 = shopOf('s05');
  eq((s05.floors || []).length, 0, 's05 确实没有楼层配置');
  eq(s05.hasFloors, false, 's05 hasFloors = false');
  check((s05.stallList || []).length > 0, 's05 仍然有店铺记录（无楼层 ≠ 无店铺）');

  const s01 = shopOf('s01');
  eq(s01.stallList.length, s01.stalls.length, 'stallList 与 stalls 数量一致（规范化不增不减）');
  check(s01.stallList.every(function (t) { return !!t.floorId; }), 's01 每个店铺都挂在真实楼层上');

  const loc = ALL_DISHES.filter(function (d) { return d.sideText === ''; });
  eq(loc.length, ALL_DISHES.length, '方位为空时 location 不会多出一段分隔符');
  check(ALL_DISHES.every(function (d) { return d.location.indexOf('undefined') === -1; }),
    'location 里没有 undefined');
}

/* ================================================================
   G4 matcher：餐厅多选 + 每店独立条件
   ================================================================ */
group('G4 餐厅多选：不同餐厅「或」，每家店内部各自「与」');

{
  const s01 = shopOf('s01');
  const s03 = shopOf('s03');
  const f1 = s01.floors[0].id;
  const s3f = s03.floors[s03.floors.length - 1].id;

  /* 单店 */
  const one = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01' }] });
  check(sig(one) === sig(refMulti(ALL_DISHES, { shops: [{ shopId: 's01' }] })), '单店：与独立实现一致');
  check(one.length > 0 && one.every(function (d) { return d.shopId === 's01'; }), '单店：结果只含该店菜品');

  /* 两家店 OR = 并集 */
  const two = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01' }, { shopId: 's03' }] });
  const union = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01' }] })
    .concat(M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's03' }] }));
  eq(sig(two), sig(union), '两家店：结果等于两店各自结果之并');

  /* 两店独立楼层 */
  const cond = {
    shops: [
      { shopId: 's01', floorIds: [f1] },
      { shopId: 's03', floorIds: [s3f] }
    ]
  };
  const mixed = M.filterDishes(ALL_DISHES, cond);
  eq(sig(mixed), sig(refMulti(ALL_DISHES, cond)), '两店不同楼层：与独立实现一致');
  check(mixed.every(function (d) {
    if (d.shopId === 's01') return d.floorId === f1;
    if (d.shopId === 's03') return d.floorId === s3f;
    return false;
  }), '两店不同楼层：结果里不存在串店 / 串楼层的菜');

  /* 跨店串用必须是空集：把 s03 的楼层塞进 s01 的条件里 */
  const cross = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', floorIds: [s3f] }] });
  eq(cross.length, 0, '把 s03 的楼层塞进 s01 的条件 → 空集（跨店不串用）');

  /* 组内 OR：两个楼层之和 */
  const bothFloors = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', floorIds: s01.floors.map(function (f) { return f.id; }) }] });
  const sumFloors = s01.floors.reduce(function (n, f) {
    return n + M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', floorIds: [f.id] }] }).length;
  }, 0);
  eq(bothFloors.length, sumFloors, '同店多楼层：组内「或」，等于各楼层之和');

  /* 组间 AND：楼层 + 店铺 */
  const stallId = s01.stallList[2].id;
  const floorOfStall = s01.stallList[2].floorId;
  const andCond = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', floorIds: [floorOfStall], stallIds: [stallId] }] });
  eq(sig(andCond), sig(M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', stallIds: [stallId] }] })),
    '同店「楼层 + 店铺」：楼层是店铺所属楼层时不缩小结果（组间与、组内或）');
  check(andCond.every(function (d) { return d.stallId === stallId; }), '同店「楼层 + 店铺」：店铺条件真的生效');

  /* 空数组 = 不限 */
  const emptyArr = M.filterDishes(ALL_DISHES, { shops: [{ shopId: 's01', floorIds: [], stallIds: [], sides: [] }] });
  eq(sig(emptyArr), sig(one), '某家店三组都是空数组 = 这家店不限位置条件');
}

/* ================================================================
   G5 matcher：「不限」只有一种写法
   ================================================================ */
group('G5 「不限」的写法与降级行为');

{
  const base = M.filterDishes(ALL_DISHES, {}).length;
  eq(base, ALL_DISHES.length, '空条件返回全部');

  eq(M.filterDishes(ALL_DISHES, { shops: [] }).length, base, 'shops 为空数组 = 不限餐厅');
  eq(M.filterDishes(ALL_DISHES, { shops: [{ shopId: 'all' }] }).length, base,
    'shops 里只有「不限」条目 = 不限餐厅（不会筛成空集）');
  eq(M.filterDishes(ALL_DISHES, { shops: [null, {}, { shopId: '' }] }).length, base,
    'shops 里全是非法条目 = 不限餐厅');

  eq(M.filterDishes(ALL_DISHES, { foodTypes: ['all'] }).length, base, 'foodTypes 里混入 all → 被丢弃 = 不限');
  eq(M.filterDishes(ALL_DISHES, { foodTypes: [] }).length, base, 'foodTypes 空数组 = 不限');
  eq(M.filterDishes(ALL_DISHES, { tastes: ['all'] }).length, base, 'tastes 里混入 all → 被丢弃 = 不限');

  const oneType = M.filterDishes(ALL_DISHES, { foodTypes: ['rice'] }).length;
  const dupType = M.filterDishes(ALL_DISHES, { foodTypes: ['rice', 'rice'] }).length;
  eq(dupType, oneType, '重复值不会放大结果');

  /* 旧字段仍然单独可用 */
  const legacy = M.filterDishes(ALL_DISHES, { foodType: 'rice', taste: 'spicy', shopId: 's01' });
  eq(sig(legacy), sig(refLegacy(ALL_DISHES, { foodType: 'rice', taste: 'spicy', shopId: 's01' })),
    '旧单值字段单独使用时行为不变');
}

/* ================================================================
   G6 类型 / 口味多选：组内「或」，与预算「与」
   ================================================================ */
group('G6 主食类型 / 口味多选');

{
  const rice = M.filterDishes(ALL_DISHES, { foodTypes: ['rice'] });
  const noodle = M.filterDishes(ALL_DISHES, { foodTypes: ['noodle'] });
  const both = M.filterDishes(ALL_DISHES, { foodTypes: ['rice', 'noodle'] });
  eq(both.length, rice.length + noodle.length, '类型多选 = 两个单选的并集');
  check(both.every(function (d) { return d.foodType === 'rice' || d.foodType === 'noodle'; }), '结果只含这两个类型');

  const light = M.filterDishes(ALL_DISHES, { tastes: ['light'] });
  const spicy = M.filterDishes(ALL_DISHES, { tastes: ['spicy'] });
  const bothTaste = M.filterDishes(ALL_DISHES, { tastes: ['light', 'spicy'] });
  eq(bothTaste.length, light.length + spicy.length, '口味多选 = 两个单选的并集');

  /* 预算 AND 类型 */
  const compose = M.filterDishes(ALL_DISHES, { foodTypes: ['rice', 'noodle'], budget: 15 });
  check(compose.every(function (d) {
    return (d.foodType === 'rice' || d.foodType === 'noodle') && d.price <= 15;
  }), '类型与预算之间是「与」');
  eq(sig(compose), sig(refMulti(ALL_DISHES, { foodTypes: ['rice', 'noodle'], budget: 15 })), '组合结果与独立实现一致');

  /* 类型 + 口味 + 预算 + 餐厅 全组交叉 */
  const full = {
    area: 'campus',
    shops: [{ shopId: 's01', sides: [] }, { shopId: 's05' }],
    foodTypes: ['rice', 'noodle', 'snack'],
    tastes: ['light', 'mild_spicy'],
    budget: 15
  };
  eq(sig(M.filterDishes(ALL_DISHES, full)), sig(refMulti(ALL_DISHES, full)), '四组条件交叉：与独立实现一致');
}

/* ================================================================
   G7 穷举对账：餐厅多选的各种组合
   ================================================================ */
group('G7 穷举对账（多选口径）');

{
  let combos = 0;
  let mismatch = 0;
  const samples = [];

  ALL_SHOPS.forEach(function (shop) {
    const floorSets = [[]].concat((shop.floors || []).map(function (f) { return [f.id]; }));
    const stallSets = [[]].concat((shop.stallList || []).map(function (t) { return [t.id]; }));

    [[], ['campus'], ['offsite']].forEach(function (areaArr) {
      [0, 10, 15, 20].forEach(function (budget) {
        [{}, { foodTypes: ['rice', 'noodle'] }, { tastes: ['light', 'spicy'] }].forEach(function (extra) {
          floorSets.forEach(function (fl) {
            stallSets.forEach(function (st) {
              /* 每两轮把同店加进一个多店条件里，覆盖「或」的组合 */
              const shops = Math.random() < 0.5
                ? [{ shopId: shop.id, floorIds: fl, stallIds: st }]
                : [{ shopId: shop.id, floorIds: fl, stallIds: st },
                   { shopId: ALL_SHOPS[(ALL_SHOPS.indexOf(shop) + 3) % ALL_SHOPS.length].id }];

              const cond = Object.assign({
                area: areaArr[0] || 'all',
                shops: shops,
                budget: budget
              }, extra);

              combos++;
              const got = sig(M.filterDishes(ALL_DISHES, cond));
              const want = sig(refMulti(ALL_DISHES, cond));
              if (got !== want) {
                mismatch++;
                if (samples.length < 3) samples.push(JSON.stringify(cond));
              }
            });
          });
        });
      });
    });
  });

  check(combos > 1000, '多选组合数足够大', combos + ' 种');
  eq(mismatch, 0, '多选组合全部与独立实现一致' + (samples.length ? '，例: ' + samples.join(' | ') : ''));
}

/* ================================================================
   G8 旧口径护栏：不因为加了多选就改变单值语义
   ================================================================ */
group('G8 旧口径护栏（104 组单值组合 & 随机 300 组）');

{
  let mismatch = 0;
  let n = 0;

  ALL_SHOPS.forEach(function (shop) {
    const floorOpts = ['all'].concat((shop.floors || []).map(function (f) { return f.id; }));
    const typeOpts = ['all', 'rice', 'noodle', 'malatang'];
    [0, 10, 15, 20].forEach(function (budget) {
      const fl = floorOpts[n % floorOpts.length];
      const ft = typeOpts[n % typeOpts.length];
      const cond = { area: shop.area, shopId: shop.id, floorId: fl, foodType: ft, budget: budget };
      n++;
      if (sig(M.filterDishes(ALL_DISHES, cond)) !== sig(refLegacy(ALL_DISHES, cond))) mismatch++;
    });
  });

  for (let i = 0; i < 300; i++) {
    const shop = ALL_SHOPS[Math.floor(Math.random() * ALL_SHOPS.length)];
    const floorId = Math.random() < 0.5 ? 'all'
      : ((shop.floors || []).length ? shop.floors[Math.floor(Math.random() * shop.floors.length)].id : 'all');
    const stallId = Math.random() < 0.5 ? 'all'
      : ((shop.stalls || []).length ? shop.stalls[Math.floor(Math.random() * shop.stalls.length)].id : 'all');
    const cond = {
      area: ['all', 'campus', 'offsite'][Math.floor(Math.random() * 3)],
      shopId: shop.id,
      floorId: floorId,
      stallId: stallId,
      foodType: ['all', 'rice', 'noodle', 'snack', 'other'][Math.floor(Math.random() * 5)],
      budget: [0, 10, 15, 20][Math.floor(Math.random() * 4)],
      taste: ['all', 'light', 'mild_spicy', 'spicy'][Math.floor(Math.random() * 4)]
    };
    n++;
    if (sig(M.filterDishes(ALL_DISHES, cond)) !== sig(refLegacy(ALL_DISHES, cond))) mismatch++;
  }

  eq(mismatch, 0, '旧单值口径 ' + n + ' 组全部与旧独立实现一致');
}

/* ================================================================
   G9 方位过滤（合成夹具）
   ================================================================ */
group('G9 方位筛选只在数据有方位时生效');

{
  const east = M.filterDishes(FX.dishes, { shops: [{ shopId: 'fx1', sides: ['east'] }] });
  eq(east.length, 1, 'fx1 东面 = 1 道（合成夹具）');
  eq(east[0].id, 'fx_d1', '命中的是正确的菜');

  const twoSides = M.filterDishes(FX.dishes, { shops: [{ shopId: 'fx1', sides: ['east', 'west'] }] });
  eq(twoSides.length, 2, '方位组内「或」：东面 + 西面 = 2 道');

  const noSide = M.filterDishes(FX.dishes, { shops: [{ shopId: 'fx3', sides: ['east'] }] });
  eq(noSide.length, 0, '没有方位数据的餐厅按方位筛 → 空集，不会瞎命中');

  const andStall = M.filterDishes(FX.dishes, { shops: [{ shopId: 'fx1', sides: ['east'], stallIds: ['fx1_t2'] }] });
  eq(andStall.length, 0, '同店「方位 + 店铺」冲突时为「与」→ 空集');

  check(FX.dishes.filter(function (d) { return d.id === 'fx_d1'; })[0].sideText === '东面',
    '方位中文由 SIDE_LABEL 统一给出');
  check(!!SIDE_LABEL.east && !!SIDE_LABEL.south && !!SIDE_LABEL.west && !!SIDE_LABEL.north,
    '东南西北四个方位的展示文案齐全');
}

/* ================================================================
   G10 页面：餐厅多选 / 每店独立 / 默认折叠
   ================================================================ */
group('G10 页面状态：多选、独立、默认折叠');

{
  let p = makePage();
  eq(p.data.selectedShops.length, 0, '初始没有选中任何餐厅');
  eq(Object.keys(p.data.shopFilters).length, 0, '初始没有任何每店条件');
  eq(p.data.restaurantOptions.length, 0, '未选区域时没有餐厅候选');

  p.onSelectArea(ev('campus'));
  eq(p.data.restaurantOptions.length, 6, '选校内后餐厅候选 = 6 家');
  eq(p.data.restaurantOptions.filter(function (o) { return o.selected; }).length, 0, '候选全部未选中');

  /* 选中一家 */
  p.onToggleShop(evShop('s01'));
  eq(p.data.selectedShops.length, 1, '选中一家');
  eq(p.data.selectedShops[0], 's01', '记录的是 s01');
  eq(p.data.expandedShops.s01, false, '新选中的餐厅默认折叠');
  const v1 = p.data.shopViews[0];
  eq(v1.id, 's01', 'shopViews 出现该店');
  eq(v1.expanded, false, '视图里也是折叠状态');
  eq(v1.floorChips.length, 3, '楼层 chip = 不限 + 2 层');
  eq(v1.floorChips[0].on, true, '默认「不限楼层」是选中的');
  eq(v1.stallChips.length, 4, '店铺 chip = 不限 + 3 个店铺');
  eq(v1.sideChips.length, 0, '真实数据没有方位 → 方位 chip 为空（整行不渲染）');
  eq(v1.summary, '未设置条件', '折叠摘要初始为「未设置条件」');

  /* 每家店独立设置 */
  p.onToggleShop(evShop('s03'));
  eq(p.data.selectedShops.length, 2, '可以同时选两家');
  eq(Object.keys(p.data.shopFilters).length, 2, '两家各有自己的条件槽');

  const s01f = shopOf('s01').floors[0].id;
  const s03f = shopOf('s03').floors[1].id;
  p.onToggleFloor(evShop('s01', s01f));
  p.onToggleFloor(evShop('s03', s03f));

  const f01 = p.data.shopFilters.s01;
  const f03 = p.data.shopFilters.s03;
  eq(f01.floorIds.length, 1, 's01 只记了自己那层');
  eq(f01.floorIds[0], s01f, 's01 记的是 s01 的楼层');
  eq(f03.floorIds.length, 1, 's03 只记了自己那层');
  eq(f03.floorIds[0], s03f, 's03 记的是 s03 的楼层');
  check(f01.floorIds[0] !== f03.floorIds[0], '两家店的楼层互不相同（没有被复制）');

  /* 页面结果 = 内核结果 */
  const pageSig = sig(p.matched);
  const coreSig = sig(M.filterDishes(ALL_DISHES, {
    shops: [
      { shopId: 's01', floorIds: [s01f], stallIds: [], sides: [] },
      { shopId: 's03', floorIds: [s03f], stallIds: [], sides: [] }
    ]
  }));
  eq(pageSig, coreSig, '页面的匹配结果与直接调用内核一致');
  check(p.matched.every(function (d) {
    if (d.shopId === 's01') return d.floorId === s01f;
    if (d.shopId === 's03') return d.floorId === s03f;
    return false;
  }), '页面结果没有跨店串用楼层');

  /* 取消一家，另一家条件必须原样保留 */
  const before = JSON.stringify(p.data.shopFilters.s01);
  p.onToggleShop(evShop('s03'));
  eq(p.data.selectedShops.length, 1, '取消后只剩一家');
  eq(p.data.selectedShops[0], 's01', '留下的是 s01');
  eq(JSON.stringify(p.data.shopFilters.s01), before, '取消 s03 之后 s01 的条件逐字节不变');
  eq(p.data.shopFilters.s03, undefined, '不存在 s03 的孤儿条件');
  eq(p.data.expandedShops.s03, undefined, '不存在 s03 的孤儿折叠状态');

  /* 折叠 / 展开不重算筛选 */
  const countBefore = p.data.matchedCount;
  const condBefore = p.data.conditionText;
  p.onToggleShopConfig(evShop('s01'));
  eq(p.data.shopViews[0].expanded, true, '点标题可以展开');
  eq(p.data.matchedCount, countBefore, '展开不会改变匹配数量');
  eq(p.data.conditionText, condBefore, '展开不会改变条件摘要');
  p.onToggleShopConfig(evShop('s01'));
  eq(p.data.shopViews[0].expanded, false, '再点一次收起');

  /* 换区域清空全部 */
  p.onSelectArea(ev('offsite'));
  eq(p.data.selectedShops.length, 0, '换区域后餐厅选择清空');
  eq(Object.keys(p.data.shopFilters).length, 0, '换区域后每店条件清空');
  eq(p.data.restaurantOptions.length, 6, '校外商家候选 = 6 家');

  /* s05：没有楼层划分 */
  p.onToggleShop(evShop('s05'));
  const v5 = p.data.shopViews[0];
  eq(v5.hasFloor, false, 's05 hasFloor = false');
  eq(v5.floorChips.length, 0, 's05 没有楼层 chip（不制造假楼层）');
  check(/没有楼层划分/.test(v5.floorHint), 's05 给出「没有楼层划分」提示', v5.floorHint);
  check(v5.stallChips.length > 1, 's05 可以直接选店铺', v5.stallChips.length + ' 项');
}

/* ================================================================
   G11 页面：类型 / 口味多选与重置
   ================================================================ */
group('G11 类型与口味多选、重置');

{
  let p = makePage();

  p.onToggleFoodType(ev('rice'));
  eq(p.data.foodTypes.length, 1, '选中一个类型');
  eq(p.data.foodTypeChips.filter(function (c) { return c.on; }).length, 1, '只有一个 chip 点亮');
  eq(p.data.foodTypeChips[0].on, false, '「不限类型」不再点亮');

  p.onToggleFoodType(ev('noodle'));
  eq(p.data.foodTypes.length, 2, '可以再选一个');
  eq(sig(p.matched), sig(M.filterDishes(ALL_DISHES, { foodTypes: ['rice', 'noodle'] })), '两类结果 = 内核结果');

  p.onToggleFoodType(ev('rice'));
  eq(p.data.foodTypes.length, 1, '再点一次取消该类型');

  p.onToggleFoodType(ev('all'));
  eq(p.data.foodTypes.length, 0, '「不限类型」清空这一组');
  eq(p.data.foodTypeChips[0].on, true, '「不限类型」重新点亮');

  p.onToggleTaste(ev('light'));
  p.onToggleTaste(ev('mild_spicy'));
  eq(p.data.tastes.length, 2, '口味也可以多选');
  eq(sig(p.matched), sig(M.filterDishes(ALL_DISHES, { tastes: ['light', 'mild_spicy'] })), '口味多选结果 = 内核结果');
  p.onToggleTaste(ev('all'));
  eq(p.data.tastes.length, 0, '「不限」清空口味组');

  /* 重置 */
  p.onSelectArea(ev('campus'));
  p.onToggleShop(evShop('s01'));
  p.onToggleFloor(evShop('s01', shopOf('s01').floors[0].id));
  p.onSelectBudget(ev(15));
  p.onToggleFoodType(ev('rice'));
  p.onToggleTaste(ev('spicy'));
  p.onViewAll();
  p.onSelectSort(ev('priceAsc'));

  p.onReset();
  eq(p.data.area, 'all', '重置 area');
  eq(p.data.selectedShops.length, 0, '重置 selectedShops');
  eq(Object.keys(p.data.shopFilters).length, 0, '重置 shopFilters');
  eq(Object.keys(p.data.expandedShops).length, 0, '重置 expandedShops');
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
  eq(p.data.shopViews.length, 0, '重置后位置配置清空');
  eq(p.data.conditionText, '不限区域 · 不限预算 · 不限类型 · 不限口味', '重置后摘要回到默认文案');
  eq(p.data.foodTypeChips[0].on, true, '重置后「不限类型」点亮');
}

/* ================================================================
   G12 摘要文案
   ================================================================ */
group('G12 条件摘要能表达「多家店各自的条件」');

{
  const p = makePage();
  p.onSelectArea(ev('campus'));
  p.onToggleShop(evShop('s01'));
  p.onToggleShop(evShop('s03'));
  p.onToggleFloor(evShop('s01', shopOf('s01').floors[0].id));
  p.onToggleFloor(evShop('s03', shopOf('s03').floors[1].id));
  p.onToggleFoodType(ev('rice'));
  p.onToggleFoodType(ev('noodle'));

  const text = p.data.conditionText;
  check(text.indexOf('校内食堂') > -1, '摘要含区域', text);
  check(text.indexOf('一号食堂') > -1, '摘要含第一家店名');
  check(text.indexOf('三号食堂') > -1, '摘要含第二家店名');
  check(text.indexOf(' + ') > -1, '两家店之间用 + 连接');
  check(/一号食堂\((.*?)楼/.test(text), '括号里带该店自己的楼层');
  check(text.indexOf('饭类/面类') > -1, '多类型用 / 连接');
  check(text.indexOf('不限口味') > -1, '没选口味时保留占位');
  check(text !== '不限区域 · 不限预算 · 不限类型 · 不限口味', '摘要不再等于默认文案');

  /* 只选一家时不出现 + */
  p.onToggleShop(evShop('s03'));
  eq(p.data.conditionText.indexOf(' + '), -1, '只剩一家时不再出现 +');
}

/* ================================================================
   G13 推荐 / 排序 / 空结果 不受影响
   ================================================================ */
group('G13 随机推荐、排序、空结果照旧');

{
  const p = makePage();
  p.onSelectArea(ev('campus'));
  p.onToggleShop(evShop('s01'));
  p.onToggleShop(evShop('s03'));

  const pool = p.matched;
  const poolIds = pool.map(function (d) { return d.id; });
  let bad = 0;
  for (let i = 0; i < 200; i++) {
    p.onRandomDish();
    const d = p.data.pickedDish;
    if (!d || poolIds.indexOf(d.id) === -1) bad++;
  }
  eq(bad, 0, '200 次随机选菜全部落在多选条件的池子里');

  let badShop = 0;
  for (let i = 0; i < 100; i++) {
    p.onRandomShop();
    const s = p.data.pickedShop;
    if (!s || ['s01', 's03'].indexOf(s.id) === -1) badShop++;
  }
  eq(badShop, 0, '100 次随机选店只落在已选的两家店里');

  p.onViewAll();
  p.onSelectSort(ev('priceAsc'));
  const asc = p.data.listDishes;
  let ascOk = true;
  for (let i = 1; i < asc.length; i++) if (asc[i - 1].price > asc[i].price) ascOk = false;
  check(ascOk, '排序在多选结果上仍然单调');
  eq(asc.length, p.matched.length, '排序不改变集合大小');

  /* 空结果：同一家店同时选两个互相冲突的店铺 */
  const p2 = makePage();
  p2.onSelectArea(ev('campus'));
  p2.onToggleShop(evShop('s01'));
  const stalls = shopOf('s01').stallList;
  p2.onToggleStall(evShop('s01', stalls[0].id));
  p2.onToggleStall(evShop('s01', stalls[1].id));
  const restricted = p2.matched.every(function (d) {
    return d.stallId === stalls[0].id || d.stallId === stalls[1].id;
  });
  check(restricted, '同店多店铺 = 组内「或」，不会互相抵消成空集');

  const p3 = makePage();
  p3.onToggleFoodType(ev('rice'));
  p3.onSelectBudget(ev(10));
  p3.onToggleTaste(ev('mild_spicy'));
  if (p3.data.matchedCount === 0) {
    const t0 = p3.__toastCount();
    p3.onViewAll();
    eq(p3.__toastCount(), t0 + 1, '空结果点「查看全部」只提示');
    eq(p3.data.mode, 'none', '空结果不切换 mode');
  } else {
    skipped('空结果按钮行为', '这组条件在演示数据里不为空，已由 regression.js R11 覆盖');
  }
}

/* ================================================================
   G14 WXML / 页面结构
   ================================================================ */
group('G14 页面结构：不写死编号，方位按数据渲染');

{
  const wxmlRaw = fs.readFileSync(P('pages/index/index.wxml'), 'utf8');
  /* 注释里说明规则是允许的，这里只检查真正会被渲染的模板代码 */
  const wxml = wxmlRaw.replace(/<!--[\s\S]*?-->/g, '');
  const jsText = fs.readFileSync(P('pages/index/index.js'), 'utf8');

  eq(/号窗口/.test(wxml), false, '渲染出来的模板里没有任何写死的「N 号窗口」');
  check(/wx:for="\{\{shopViews\}\}"/.test(wxml), '每店配置块由 shopViews 驱动');
  check(/item\.hasSide/.test(wxml), '方位块由数据字段 hasSide 控制显隐');
  check(/item\.floorChips\.length/.test(wxml), '楼层块由真实楼层数量控制显隐');
  check(/item\.stallChips\.length/.test(wxml), '店铺块由真实店铺数量控制显隐');
  check(/onToggleShop\b/.test(wxml), '餐厅多选走 onToggleShop');
  check(/onToggleShopConfig/.test(wxml), '折叠走 onToggleShopConfig');
  check(/scroll-view class="type-scroll"/.test(wxml), '预算与类型都用横向滚动容器');

  const taps = (wxml.match(/bindtap="(\w+)"/g) || []).map(function (s) { return s.replace(/bindtap="|"/g, ''); });
  const missing = taps.filter(function (fn) { return jsText.indexOf(fn) === -1; });
  eq(missing.length, 0, 'bindtap 全部有实现' + (missing.length ? '，缺: ' + missing.join(',') : '，共 ' + taps.length + ' 个'));

  /* 预算仍然单选 */
  check(/onSelectBudget/.test(jsText) && !/budget:\s*\[/.test(jsText), '预算仍然是单值');
  /* 八个主食类型枚举都还在 */
  ['rice', 'noodle', 'rice_noodle', 'rice_vermicelli', 'dumpling', 'malatang', 'snack', 'other']
    .forEach(function (t) {
      check(jsText.indexOf("'" + t + "'") > -1, '枚举保留: ' + t);
    });
}

/* ---------------- 汇总 ---------------- */

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项，跳过 ' + skip + ' 项');
if (fail) {
  console.log('失败清单：');
  failures.forEach(function (f) { console.log('  · ' + f); });
  console.log('========================================');
  process.exit(1);
} else {
  console.log('全部通过（SKIP 项是数据里暂时不存在的场景，不代表已通过）');
  console.log('========================================');
}
