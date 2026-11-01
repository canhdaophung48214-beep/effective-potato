/**
 * verify_seed.js —— cloudfunctions/seed 的离线自检（第 ① 层）
 *
 * 目的：拦住「seed 里写死的期望数据」和「data/*.js 里的真实来源」之间的漂移。
 * 如果哪天 data/shops.js 或 data/dishes.js 改了 s01 的窗口名、菜品价格，
 * 这个脚本会立刻报红，而不是等到云端写入后才发现两边不一致。
 *
 * 做法：不启动云环境，只把 seed/index.js 用假的 wx-server-sdk 载入，
 * 取出 __test__ 里的常量，逐条与 data/ 对照。
 *
 * 用法：node tools/verify_seed.js
 * 退出码：0 = 全部通过；1 = 有失败项
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'cloudfunctions', 'seed', 'index.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push({ name: name, detail: detail === undefined ? '' : detail });
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected),
    '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

function noThrow(name, fn) {
  try {
    const value = fn();
    ok(name, true);
    return value;
  } catch (err) {
    ok(name, false, String((err && err.message) || err));
    return null;
  }
}

/* ================================================================
   1. 载入 seed（假的 wx-server-sdk）
   ================================================================ */
function loadSeed() {
  const src = fs.readFileSync(SEED_FILE, 'utf8');
  const fakeCloud = {
    init: function () {},
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    database: function () {
      return {
        collection: function () { throw new Error('离线自检不应真的访问数据库'); },
        createCollection: function () { throw new Error('离线自检不应真的建集合'); },
        serverDate: function () { return new Date(0); }
      };
    },
    getWXContext: function () { return {}; }
  };

  const module = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  fn(module.exports, function (id) {
    if (id === 'wx-server-sdk') return fakeCloud;
    if (id.charAt(0) === '.') return require(path.resolve(path.dirname(SEED_FILE), id));
    return require(id);
  }, module, SEED_FILE, path.dirname(SEED_FILE));

  return { api: module.exports, src: src };
}

const loaded = noThrow('seed/index.js 能在假 SDK 下正常载入', loadSeed);
if (!loaded || !loaded.api || !loaded.api.__test__) {
  console.log('无法载入 seed 的 __test__ 导出，后续检查全部跳过');
  failures.push({ name: '载入 seed/index.js', detail: '缺少 __test__ 导出' });
}
const T = (loaded && loaded.api && loaded.api.__test__) || {};
const SEED_SRC = (loaded && loaded.src) || '';

/* ================================================================
   2. 来源数据
   ================================================================ */
const shopsModule = require(path.join(ROOT, 'data', 'shops.js'));
const dishesModule = require(path.join(ROOT, 'data', 'dishes.js'));
const SHOPS = shopsModule.SHOPS || shopsModule;
const DISHES = dishesModule.DISHES || dishesModule;

const s01 = SHOPS.filter(function (s) { return s.id === 's01'; })[0];
const s01Dishes = DISHES.filter(function (d) { return d.shopId === 's01'; });

ok('data/shops.js 里能找到 s01', !!s01);

/* ================================================================
   3. 白名单与集合名
   ================================================================ */
eq('集合名恰好三个且顺序固定', T.COLLECTION_NAMES, ['restaurants', 'stalls', 'dishes']);
eq('集合名常量不可被改写（Object.freeze）', Object.isFrozen(T.COL), true);
eq('集合名不是从入参读的（源码里没有 event.collection）', /event\s*\.\s*collection/.test(SEED_SRC), false);

/* ================================================================
   4. 期望数据 vs data/ 来源（防漂移核心）
   ================================================================ */
const R = T.EXPECTED_RESTAURANTS || [];
const S = T.EXPECTED_STALLS || [];
const D = T.EXPECTED_DISHES || [];

eq('期望店铺数 = 1', R.length, 1);
eq('期望窗口数 = 3', S.length, 3);
eq('期望菜品数 = 4（s01 实际只有 4 道）', D.length, 4);
eq('data/ 里 s01 的菜品数也是 4', s01Dishes.length, 4);

if (s01) {
  eq('店铺 _id 与 data 的 id 一致', R[0] && R[0]._id, s01.id);
  eq('店铺 name 一致', R[0] && R[0].name, s01.name);
  eq('店铺 area 一致', R[0] && R[0].area, s01.area);
  eq('店铺 building 一致', R[0] && R[0].building, s01.building);
  eq('店铺 location 一致', R[0] && R[0].location, s01.location);
  eq('楼层 id 一致', (R[0].floors || []).map(function (f) { return f.id; }),
    s01.floors.map(function (f) { return f.id; }));
  eq('楼层 label 一致', (R[0].floors || []).map(function (f) { return f.label; }),
    s01.floors.map(function (f) { return f.label; }));

  /* 窗口逐个对照 data/shops.js 的 stalls */
  const byId = {};
  s01.stalls.forEach(function (st) { byId[st.id] = st; });
  S.forEach(function (st) {
    const src = byId[st._id];
    ok('窗口 ' + st._id + ' 在 data 中存在', !!src);
    if (!src) return;
    eq('窗口 ' + st._id + ' name 一致', st.name, src.name);
    eq('窗口 ' + st._id + ' floorId 一致', st.floorId, src.floorId);
    eq('窗口 ' + st._id + ' restaurantId 指向 s01', st.restaurantId, 's01');
  });
  eq('窗口 _id 集合与 data 一致', S.map(function (st) { return st._id; }).sort(),
    s01.stalls.map(function (st) { return st.id; }).sort());
}

/* 菜品逐个对照 data/dishes.js */
const dishById = {};
DISHES.forEach(function (d) { dishById[d.id] = d; });
D.forEach(function (d) {
  const src = dishById[d._id];
  ok('菜品 ' + d._id + ' 在 data 中存在', !!src);
  if (!src) return;
  eq('菜品 ' + d._id + ' name 一致', d.name, src.name);
  eq('菜品 ' + d._id + ' price 一致', d.price, src.price);
  eq('菜品 ' + d._id + ' foodType 一致', d.foodType, src.foodType);
  eq('菜品 ' + d._id + ' tastes 一致', d.tastes, src.tastes);
  eq('菜品 ' + d._id + ' stallId 一致', d.stallId, src.stallId);
  eq('菜品 ' + d._id + ' restaurantId = data 的 shopId', d.restaurantId, src.shopId);
});

eq('菜品 _id 集合与 data 里 s01 的菜品一致', D.map(function (d) { return d._id; }).sort(),
  s01Dishes.map(function (d) { return d.id; }).sort());

/* 8 条 id 全局不重复 */
const allIds = R.map(function (r) { return r._id; })
  .concat(S.map(function (s) { return s._id; }))
  .concat(D.map(function (d) { return d._id; }));
eq('共 8 条记录', allIds.length, 8);
eq('8 条 _id 无重复', new Set(allIds).size, 8);

/* ================================================================
   5. 元数据：全部演示、核实时间为空
   ================================================================ */
eq('DEMO_SOURCE.kind = demo', T.DEMO_SOURCE && T.DEMO_SOURCE.kind, 'demo');
eq('DEMO_SOURCE 无外部链接', T.DEMO_SOURCE && T.DEMO_SOURCE.ref, '');

const specs = noThrow('buildSpecs 可以运行', function () {
  return T.buildSpecs('seed-s01-20261022');
}) || [];
eq('buildSpecs 生成 8 条', specs.length, 8);

const badMeta = specs.filter(function (sp) {
  const r = sp.record;
  return r.dataClass !== 'demo' || r.verifyStatus !== 'demo' ||
    r.verifiedAt !== null || !r.source || r.source.kind !== 'demo' ||
    r.batchId !== 'seed-s01-20261022';
});
eq('8 条记录全部 dataClass/verifyStatus=demo、verifiedAt=null、source.kind=demo、batchId 已写', badMeta.length, 0);

const wrongCollection = specs.filter(function (sp) {
  return T.COLLECTION_NAMES.indexOf(sp.collection) === -1;
});
eq('所有记录只落在白名单集合里', wrongCollection.length, 0);

const hashMissing = specs.filter(function (sp) { return !/^[0-9a-f]{64}$/.test(sp.record.contentHash || ''); });
eq('每条记录都带 64 位 contentHash', hashMissing.length, 0);

/* ================================================================
   6. contentHash 的稳定性与敏感性
   ================================================================ */
const sample = specs[0] && specs[0].record;
if (sample) {
  const h1 = T.contentHashOf(sample);
  const h2 = T.contentHashOf(Object.assign({}, sample, { createdAt: new Date(1), updatedAt: new Date(2), rev: 9 }));
  eq('contentHash 不受 createdAt/updatedAt/rev 影响', h1, h2);

  const h3 = T.contentHashOf(Object.assign({}, sample, { name: sample.name + 'X' }));
  ok('contentHash 会因业务字段变化而改变', h1 !== h3);

  const reordered = {};
  Object.keys(sample).reverse().forEach(function (k) { reordered[k] = sample[k]; });
  eq('contentHash 与键顺序无关', T.contentHashOf(reordered), h1);
}

/* ================================================================
   6b. verify 的比对基准（云端真跑时曾在这里误报 8 条假差异）
   ================================================================ */
if (sample && T.diffDocs) {
  /* 模拟云端读回来的样子：业务数据 + 服务端补的时间戳 + _id */
  const storedLike = Object.assign({}, sample, {
    _id: sample._id,
    createdAt: new Date(0),
    updatedAt: new Date(0)
  });
  eq('写入格式的记录与「云端读回格式」比对应无差异',
    (T.diffDocs(sample, storedLike, '', []) || []).map(function (x) { return x.field; }), []);

  const tampered = Object.assign({}, storedLike, { price: (sample.price || 0) + 1 });
  const tDiff = (T.diffDocs(sample, tampered, '', []) || []).map(function (x) { return x.field; });
  eq('价格被改动应报出 price 一项差异', tDiff, ['price']);

  /* 关键回归：EXPECTED_* 只有业务字段，verify 必须先 withMeta 再比 */
  const rawOnly = T.EXPECTED_DISHES && T.EXPECTED_DISHES[0];
  if (rawOnly) {
    const fullExpected = T.withMeta(rawOnly, 'seed-s01-20261022');
    const fakeStored = Object.assign({}, fullExpected, { createdAt: new Date(0), updatedAt: new Date(0) });
    eq('先 withMeta 再比对不会把 dataClass/source 误报成差异',
      (T.diffDocs(fullExpected, fakeStored, '', []) || []).length, 0);
    eq('直接拿裸业务字段去比会误报（这正是当初的 bug，此处锁死必须 withMeta）',
      (T.diffDocs(rawOnly, fakeStored, '', []) || []).length > 0, true);
  }
}

/* ================================================================
   7. batchId 校验
   ================================================================ */const re = T.BATCH_RE;
if (re) {
  ok('接受 seed-s01-20261022', re.test('seed-s01-20261022'));
  ok('拒绝 seed-s01', !re.test('seed-s01'));
  ok('拒绝 seed-s01-2026-10-22', !re.test('seed-s01-2026-10-22'));
  ok('拒绝空串', !re.test(''));
  ok('拒绝含空格的批次号', !re.test('seed-s01-20261022 '));
}

/* ================================================================
   8. 静态安全扫描（防止危险写法被加进来）
   ================================================================ */
const dangerous = [
  { name: 'where().remove()', re: /\.where\s*\([^)]*\)\s*\.remove\s*\(/ },
  { name: 'dropCollection', re: /dropCollection/ },
  { name: 'setCollectionPermission', re: /setCollectionPermission/ },
  { name: 'db.collection(event', re: /collection\s*\(\s*event/ }
];
dangerous.forEach(function (item) {
  ok('源码里没有 ' + item.name, !item.re.test(SEED_SRC));
});

const removeCalls = (SEED_SRC.match(/\.remove\s*\(/g) || []).length;
ok('remove 调用全部是 doc(_id).remove() 形式', !/\bcollection\s*\([^)]*\)\s*\.remove\s*\(/.test(SEED_SRC),
  'remove 出现 ' + removeCalls + ' 次');

ok('清理前会校验 dataClass 与 batchId', /dataClass\s*!==\s*'demo'\s*\|\|\s*existing\.batchId\s*!==\s*batchId/.test(SEED_SRC));

/* ================================================================
   9. 汇总
   ================================================================ */
console.log('==== verify_seed 结果 ====');
console.log('通过: ' + pass);
console.log('失败: ' + fail);
if (fail) {
  failures.forEach(function (f) {
    console.log('  FAIL  ' + f.name + (f.detail ? ' —— ' + f.detail : ''));
  });
  process.exitCode = 1;
} else {
  console.log('全部通过 ✅');
  process.exitCode = 0;
}
