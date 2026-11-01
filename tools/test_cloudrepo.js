/**
 * tools/test_cloudrepo.js —— utils/cloudRepo.js 的离线测试
 *
 * 完全离线：不 require wx、不连云环境、不需要开发者工具、不需要网络。
 * 云端查询用「假取数函数」模拟，分页、失败、重复、越界全部由本文件自己造。
 *
 * 运行：node tools/test_cloudrepo.js
 * 退出码：0 = 全通过（允许 WARN），1 = 有 FAIL
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const repo = require(path.join(ROOT, 'utils', 'cloudRepo.js'));
const dataIndex = require(path.join(ROOT, 'data', 'index.js'));

/* ================================================================
   测试脚手架
   ================================================================ */

let pass = 0;
let fail = 0;
let warn = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name + (extra ? '  → ' + extra : ''));
  } else {
    fail++;
    failures.push(name + (extra ? '  → ' + extra : ''));
    console.log('  FAIL  ' + name + (extra ? '  → ' + extra : ''));
  }
}

function checkEqual(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, ok, ok ? '' : '期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
}

function warnCheck(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    warn++;
    console.log('  WARN  ' + name + (extra ? '  → ' + extra : ''));
  }
}

function section(title) {
  console.log('');
  console.log('── ' + title + ' ' + '─'.repeat(Math.max(0, 56 - title.length)));
}

async function expectThrow(name, fn, expectedCode) {
  try {
    await fn();
    check(name, false, '期望抛出 ' + expectedCode + '，实际没有抛错');
    return null;
  } catch (err) {
    const ok = err && err.code === expectedCode;
    check(name, ok, ok ? expectedCode : '期望 code=' + expectedCode + '，实际 code=' + (err && err.code) + ' / ' + (err && err.message));
    return err;
  }
}

/* ================================================================
   假数据构造（形状与 cloudfunctions/seed/index.js 写入的一致）
   ================================================================ */

const DEMO_SOURCE = Object.freeze({ kind: 'demo', detail: '非真实商家、楼层、窗口与菜品', ref: '' });

function meta(extra) {
  return Object.assign({
    dataClass: 'demo',
    verifyStatus: 'demo',
    verifiedAt: null,
    source: DEMO_SOURCE
  }, extra || {});
}

function restaurantDoc(id, extra) {
  return Object.assign({
    _id: id,
    name: id + ' 号食堂',
    area: 'campus',
    building: '测试楼',
    location: '测试位置 · ' + id,
    floors: [{ id: id + '_f1', label: '1 楼', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE }]
  }, meta(), extra || {});
}

function stallDoc(id, restaurantId, extra) {
  return Object.assign({
    _id: id,
    restaurantId: restaurantId,
    floorId: restaurantId + '_f1',
    name: id + ' 窗口',
    side: '',
    noStatus: 'unverified',
    no: ''
  }, meta(), extra || {});
}

function dishDoc(id, restaurantId, stallId, extra) {
  return Object.assign({
    _id: id,
    name: id + ' 菜',
    price: 10,
    foodType: 'rice',
    restaurantId: restaurantId,
    stallId: stallId,
    tastes: ['light']
  }, meta(), extra || {});
}

function byId(a, b) {
  if (a._id === b._id) return 0;
  return a._id < b._id ? -1 : 1;
}

/**
 * 游标分页假取数函数：严格模拟「orderBy('_id','asc') + where(_id > lastId)」。
 * options.failAt   第 N 次调用抛错（1 起）
 * options.frozen   true 时游标不前进（永远返回同一页，用来测 STUCK_CURSOR）
 */
function makeCursorFetch(docs, options) {
  const opt = options || {};
  const sorted = docs.slice().sort(byId);
  let calls = 0;

  const fn = async function (params) {
    calls++;
    if (opt.failAt && calls === opt.failAt) {
      const err = new Error('mock network failure');
      err.code = 'MOCK_NETWORK';
      throw err;
    }
    if (opt.frozen) {
      return { list: sorted.slice(0, params.limit) };
    }
    let from = 0;
    if (params.lastId !== null && params.lastId !== undefined) {
      const idx = sorted.findIndex(function (d) { return d._id > params.lastId; });
      from = (idx === -1) ? sorted.length : idx;
    }
    return { list: sorted.slice(from, from + params.limit) };
  };
  fn.calls = function () { return calls; };
  return fn;
}

/** 一个能让三步取数各自用不同假数据的 fetchPage（按集合名分派） */
function makeDispatchFetch(map, options) {
  const opt = options || {};
  let calls = 0;
  const fns = {};
  Object.keys(map).forEach(function (k) { fns[k] = makeCursorFetch(map[k], opt); });

  const fn = async function (params) {
    calls++;
    if (opt.failAtGlobal && calls === opt.failAtGlobal) {
      const err = new Error('mock global failure');
      throw err;
    }
    return fns[params.collection](params);
  };
  fn.calls = function () { return calls; };
  return fn;
}

/** 把本地数据「翻译成」云端文档形状，用于兼容性比对 */
function localToCloudDocs() {
  const restaurants = dataIndex.ALL_SHOPS.map(function (shop) {
    return {
      _id: shop.id,
      name: shop.name,
      area: shop.area,
      building: shop.building,
      location: shop.location,
      floors: (shop.floors || []).map(function (f) {
        return { id: f.id, label: f.label, verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE };
      }),
      dataClass: 'demo', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE
    };
  });

  const stalls = [];
  dataIndex.ALL_SHOPS.forEach(function (shop) {
    (shop.stallList || []).forEach(function (st) {
      stalls.push({
        _id: st.id,
        restaurantId: shop.id,
        floorId: st.floorId || '',
        name: st.name,
        side: st.side || '',
        noStatus: st.noStatus,
        no: st.no || '',
        dataClass: 'demo', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE
      });
    });
  });

  const dishes = dataIndex.ALL_DISHES.map(function (d) {
    return {
      _id: d.id,
      name: d.name,
      price: d.price,
      foodType: d.foodType,
      restaurantId: d.shopId,
      stallId: d.stallId,
      tastes: d.tastes.slice(),
      dataClass: 'demo', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE
    };
  });

  return { restaurants: restaurants, stalls: stalls, dishes: dishes };
}

/** 确定性洗牌（不用 Math.random，结果可复现） */
function deterministicShuffle(list, seed) {
  const out = list.slice();
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return out;
}

/* ================================================================
   主流程
   ================================================================ */

async function main() {
  console.log('utils/cloudRepo.js 离线测试');
  console.log('模块导出：' + Object.keys(repo).sort().join(', '));

  /* ---------------------------------------------------------------
     A. 基本形态：空集合 / 单页 / 多页 / 末页不足 / 参数默认值
     --------------------------------------------------------------- */
  section('A. 分页：空集合 / 单页 / 多页 / 末页不足');

  /* A1 三类集合均为空 */
  {
    const fetchPage = makeDispatchFetch({ restaurants: [], stalls: [], dishes: [] });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    check('A1 三类集合全空：不抛错', true);
    checkEqual('A1 菜品列表为空数组', res.dataset.ALL_DISHES, []);
    checkEqual('A1 店铺列表为空数组', res.dataset.ALL_SHOPS, []);
    checkEqual('A1 计数全 0', res.meta.counts, { restaurants: 0, stalls: 0, dishes: 0 });
    checkEqual('A1 无诊断', res.diagnostics, []);
    check('A1 每类集合各读了 1 页', res.meta.pages.restaurants === 1 && res.meta.pages.stalls === 1 && res.meta.pages.dishes === 1);
  }

  /* A2 单页读完（数据量 < pageSize） */
  {
    const r = [restaurantDoc('s01')];
    const st = [stallDoc('s01_t1', 's01')];
    const d = [dishDoc('d01', 's01', 's01_t1')];
    const fetchPage = makeDispatchFetch({ restaurants: r, stalls: st, dishes: d });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage, pageSize: 20 });
    check('A2 单页读取：店铺 1 家', res.meta.counts.restaurants === 1);
    check('A2 单页读取：窗口 1 个已装配', res.shops[0].stalls.length === 1);
    check('A2 单页读取：菜品 1 道', res.dataset.ALL_DISHES.length === 1);
    checkEqual('A2 每集合 1 页', res.meta.pages, { restaurants: 1, stalls: 1, dishes: 1 });
  }

  /* A3 多页读取（45 条 / 每页 20 → 3 页） */
  {
    const docs = [];
    for (let i = 1; i <= 45; i++) docs.push(dishDoc('d' + String(i).padStart(2, '0'), 's01', 's01_t1'));
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01')],
      stalls: [stallDoc('s01_t1', 's01')],
      dishes: docs
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage, pageSize: 20 });
    check('A3 多页：45 条全部读回', res.meta.counts.dishes === 45);
    check('A3 多页：菜品分 3 页', res.meta.pages.dishes === 3, '实际 ' + res.meta.pages.dishes);
  }

  /* A4 最后一页不足 pageSize（25 条 / 每页 10 → 10+10+5） */
  {
    const docs = [];
    for (let i = 1; i <= 25; i++) docs.push(dishDoc('d' + String(i).padStart(2, '0'), 's01', 's01_t1'));
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01')],
      stalls: [stallDoc('s01_t1', 's01')],
      dishes: docs
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage, pageSize: 10 });
    check('A4 末页不足：25 条全部读回', res.meta.counts.dishes === 25);
    check('A4 末页不足：共 3 页（10/10/5）', res.meta.pages.dishes === 3, '实际 ' + res.meta.pages.dishes);
  }

  /* A5 fetchAll 直接调用 + 默认参数 */
  {
    const docs = [dishDoc('d01', 's01', 's01_t1')];
    const fetchPage = makeCursorFetch(docs);
    const r = await repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage });
    check('A5 fetchAll 默认 pageSize = ' + repo.DEFAULT_PAGE_SIZE, repo.DEFAULT_PAGE_SIZE === 20);
    check('A5 fetchAll 默认 maxPages = ' + repo.DEFAULT_MAX_PAGES, repo.DEFAULT_MAX_PAGES === 50);
    check('A5 fetchAll 返回 complete = true', r.complete === true);
    check('A5 fetchAll 返回 1 条', r.list.length === 1);
  }

  /* ---------------------------------------------------------------
     B. 分页异常：重复 / 超页 / 取数失败 / 游标卡死 / 白名单
     --------------------------------------------------------------- */
  section('B. 分页异常与保护');

  /* B1 同一记录重复出现（用重叠页模拟：第一页 a,b 第二页 b,c） */
  {
    const a = dishDoc('d01', 's01', 's01_t1');
    const b = dishDoc('d02', 's01', 's01_t1');
    const c = dishDoc('d03', 's01', 's01_t1');
    let call = 0;
    const fetchPage = async function () {
      call++;
      if (call === 1) return { list: [a, b] };
      if (call === 2) return { list: [b, c] };
      return { list: [] };
    };
    const r = await repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage, pageSize: 2 });
    checkEqual('B1 去重后保留 3 条', r.list.map(function (x) { return x._id; }), ['d01', 'd02', 'd03']);
    check('B1 重复记录被记录 1 次', r.duplicates.length === 1, '实际 ' + r.duplicates.length);
    checkEqual('B1 重复的是 d02', r.duplicates[0].id, 'd02');
  }

  /* B2 超过最大页数：25 条 / 每页 5 / 最多 3 页 */
  {
    const docs = [];
    for (let i = 1; i <= 25; i++) docs.push(dishDoc('d' + String(i).padStart(2, '0'), 's01', 's01_t1'));
    const fetchPage = makeCursorFetch(docs);
    const err = await expectThrow(
      'B2 超页抛 TOO_MANY_PAGES（不返回截断数据）',
      function () { return repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage, pageSize: 5, maxPages: 3 }); },
      repo.ERROR_CODE.TOO_MANY_PAGES
    );
    check('B2 错误里带上已读条数与游标', !!err && err.detail && err.detail.fetched === 15, err && err.detail ? 'fetched=' + err.detail.fetched : 'no detail');
    check('B2 错误信息明确说明可能仍有剩余', !!err && /仍有剩余|截断/.test(err.message));
  }

  /* B3 最后一页不足时不算超限（14 条 / 每页 5 / 最多 3 页 → 5+5+4）
   *
   * 注意：15 条 / 每页 5 / 最多 3 页 是**故意**会抛 TOO_MANY_PAGES 的
   * —— 三页全满时，"正好读完"和"还有第 4 页"从数据层看无法区分，
   * 所以必须按"可能仍有剩余"处理（B2 已断言）。这里验证的是另一种情况：
   * 末页不足时不应误报。 */
  {
    const docs = [];
    for (let i = 1; i <= 14; i++) docs.push(dishDoc('d' + String(i).padStart(2, '0'), 's01', 's01_t1'));
    const fetchPage = makeCursorFetch(docs);
    const r = await repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage, pageSize: 5, maxPages: 3 });
    check('B3 末页不足时正好触到上限也不误报（14 条 → 5+5+4）', r.list.length === 14, '实际 ' + r.list.length);
    check('B3 用了 3 页', r.pages === 3, '实际 ' + r.pages);
  }

  /* B4 取数失败：第 2 页抛错 */
  {
    const docs = [];
    for (let i = 1; i <= 30; i++) docs.push(dishDoc('d' + String(i).padStart(2, '0'), 's01', 's01_t1'));
    const fetchPage = makeCursorFetch(docs, { failAt: 2 });
    const err = await expectThrow(
      'B4 第 2 页失败抛 FETCH_FAILED',
      function () { return repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage, pageSize: 5 }); },
      repo.ERROR_CODE.FETCH_FAILED
    );
    check('B4 错误带 collection / page / cause', !!err && err.detail.collection === 'dishes' && err.detail.page === 2 && !!err.detail.cause);
    check('B4 错误信息保留原始 message', !!err && /mock network failure/.test(err.message));
  }

  /* B5 loadCloudDataset 里的失败不降级成本地数据 */
  {
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01')],
      stalls: [stallDoc('s01_t1', 's01')],
      dishes: [dishDoc('d01', 's01', 's01_t1')]
    }, { failAtGlobal: 3 });
    let threw = false;
    try {
      await repo.loadCloudDataset({ fetchPage: fetchPage });
    } catch (e) {
      threw = true;
    }
    check('B5 读取失败时 loadCloudDataset 抛错（不返回本地数据）', threw);
  }

  /* B6 游标不前进 */
  {
    const docs = [dishDoc('d01', 's01', 's01_t1'), dishDoc('d02', 's01', 's01_t1')];
    const fetchPage = makeCursorFetch(docs, { frozen: true });
    await expectThrow(
      'B6 游标卡死抛 STUCK_CURSOR',
      function () { return repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage, pageSize: 2 }); },
      repo.ERROR_CODE.STUCK_CURSOR
    );
  }

  /* B7 集合白名单 */
  {
    await expectThrow(
      'B7 非白名单集合抛 BAD_COLLECTION',
      function () { return repo.fetchAll({ collection: 'users', fetchPage: async function () { return { list: [] }; } }); },
      repo.ERROR_CODE.BAD_COLLECTION
    );
    await expectThrow(
      'B7 空集合名同样被拒绝',
      function () { return repo.fetchAll({ collection: '', fetchPage: async function () { return { list: [] }; } }); },
      repo.ERROR_CODE.BAD_COLLECTION
    );
    checkEqual('B7 白名单恰好是三个集合', repo.ALLOWED_COLLECTIONS, ['restaurants', 'stalls', 'dishes']);
  }

  /* B8 缺 fetchPage / 缺 db */
  {
    await expectThrow(
      'B8 fetchAll 缺 fetchPage 抛 BAD_ARGS',
      function () { return repo.fetchAll({ collection: 'dishes' }); },
      repo.ERROR_CODE.BAD_ARGS
    );
    await expectThrow(
      'B8 loadCloudDataset 既无 fetchPage 也无 db 抛 BAD_ARGS',
      function () { return repo.loadCloudDataset({}); },
      repo.ERROR_CODE.BAD_ARGS
    );
  }

  /* B9 记录缺少 _id */
  {
    const fetchPage = async function () { return { list: [{ name: '没有 id 的记录' }] }; };
    await expectThrow(
      'B9 记录缺 _id 抛 BAD_DOC',
      function () { return repo.fetchAll({ collection: 'dishes', fetchPage: fetchPage }); },
      repo.ERROR_CODE.BAD_DOC
    );
  }

  /* ---------------------------------------------------------------
     C. 字段映射
     --------------------------------------------------------------- */
  section('C. 字段映射与关联');

  {
    const shopDoc = restaurantDoc('s01');
    const adapted = repo.adaptRestaurant(shopDoc);
    checkEqual('C1 _id → id（店铺）', adapted.id, 's01');
    check('C1 楼层保留 id / label', adapted.floors.length === 1 && adapted.floors[0].id === 's01_f1' && adapted.floors[0].label === '1 楼');
    check('C1 店铺 stalls 初始为空（装配交给 loadCloudDataset）', adapted.stalls.length === 0);
    check('C1 楼层保留可信度', adapted.floors[0].verifyStatus === 'demo');
  }

  {
    const d = repo.adaptDish(dishDoc('d01', 's01', 's01_t1'));
    checkEqual('C2 _id → id（菜品）', d.id, 'd01');
    checkEqual('C2 restaurantId → shopId', d.shopId, 's01');
    checkEqual('C2 stallId 原样', d.stallId, 's01_t1');
    checkEqual('C2 价格原样', d.price, 10);
    checkEqual('C2 口味数组是拷贝（不改入参）', d.tastes, ['light']);
  }

  {
    const st = repo.adaptStall(stallDoc('s01_t1', 's01'));
    checkEqual('C3 窗口 _id → id', st.id, 's01_t1');
    checkEqual('C3 窗口保留 restaurantId（装配用）', st.restaurantId, 's01');
    checkEqual('C3 窗口保留 noStatus', st.noStatus, 'unverified');
  }

  /* C4 缺失 restaurantId：不猜、不补 */
  {
    const broken = dishDoc('d99', '', '');
    const adapted = repo.adaptDish(broken);
    checkEqual('C4 缺 restaurantId → shopId 为空串（不按名字猜）', adapted.shopId, '');
    checkEqual('C4 缺 stallId → stallId 为空串', adapted.stallId, '');
  }

  /* C5 孤儿菜品 / 孤儿窗口都会进诊断，且不会被硬挂到别的店 */
  {
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01')],
      stalls: [stallDoc('s01_t1', 's01'), stallDoc('x_t9', 's99')],
      dishes: [dishDoc('d01', 's01', 's01_t1'), dishDoc('d88', 's88', 'x_t9')]
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const codes = res.diagnostics.map(function (x) { return x.code; });
    check('C5 孤儿窗口产生 ORPHAN_STALL 诊断', codes.indexOf(repo.DIAG_CODE.ORPHAN_STALL) >= 0);
    check('C5 孤儿菜品产生 ORPHAN_DISH 诊断', codes.indexOf(repo.DIAG_CODE.ORPHAN_DISH) >= 0);
    checkEqual('C5 只装配了属于 s01 的那个窗口', res.shops[0].stalls.map(function (s) { return s.id; }), ['s01_t1']);
    const orphanDish = res.dataset.ALL_DISHES.filter(function (x) { return x.id === 'd88'; })[0];
    check('C5 孤儿菜品仍保留在列表里（可诊断，不静默丢弃）', !!orphanDish);
    checkEqual('C5 孤儿菜品店名回退「未知店铺」', orphanDish && orphanDish.shopName, '未知店铺');
  }

  /* C6 菜品指向不存在的窗口 / 指向别人家的窗口 */
  {
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01'), restaurantDoc('s02')],
      stalls: [stallDoc('s01_t1', 's01'), stallDoc('s02_t1', 's02')],
      dishes: [dishDoc('d01', 's01', 's01_t1'), dishDoc('d02', 's01', 'no_such_t'), dishDoc('d03', 's01', 's02_t1')]
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const codes = res.diagnostics.map(function (x) { return x.code + ':' + x.id; });
    check('C6 stallId 不存在 → STALL_NOT_FOUND', codes.indexOf('STALL_NOT_FOUND:d02') >= 0);
    check('C6 窗口属于别家店 → STALL_SHOP_MISMATCH', codes.indexOf('STALL_SHOP_MISMATCH:d03') >= 0);

    const d02 = res.dataset.ALL_DISHES.filter(function (x) { return x.id === 'd02'; })[0];
    checkEqual('C6 不存在的窗口不被伪造（stallName 为空）', d02.stallName, '');
    const d03 = res.dataset.ALL_DISHES.filter(function (x) { return x.id === 'd03'; })[0];
    checkEqual('C6 串店窗口不被当成有效关系（店名仍是 s01 的）', d03.shopId, 's01');
  }

  /* C7 楼层引用不到 */
  {
    const bad = stallDoc('s01_t1', 's01', { floorId: 's01_f9' });
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01')],
      stalls: [bad],
      dishes: [dishDoc('d01', 's01', 's01_t1')]
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    check('C7 floorId 不存在 → FLOOR_NOT_FOUND 诊断',
      res.diagnostics.some(function (x) { return x.code === repo.DIAG_CODE.FLOOR_NOT_FOUND; }));
    checkEqual('C7 楼层文字留空（不编造）', res.dataset.ALL_DISHES[0].floorText, '');
  }

  /* ---------------------------------------------------------------
     D. 可信度：保留 + 不升级
     --------------------------------------------------------------- */
  section('D. 可信度元数据');

  {
    const src = { kind: 'official', detail: '食堂公告栏拍摄', ref: '' };
    /* 注意：楼层也必须一起换成非 demo。
       菜品卡片的可信度是「菜品 + 窗口 + 楼层 + 店铺」四层取最弱一环，
       只要楼层还是 demo，整道菜就仍然是 demo —— 这是阶段 2 的既定规则，不是 bug。 */
    const shopWithMeta = restaurantDoc('s01', {
      verifyStatus: 'unverified',
      source: src,
      floors: [{ id: 's01_f1', label: '1 楼', verifyStatus: 'unverified', verifiedAt: null, source: src }]
    });
    const fetchPage = makeDispatchFetch({
      restaurants: [shopWithMeta],
      stalls: [stallDoc('s01_t1', 's01', { verifyStatus: 'unverified', source: src })],
      dishes: [dishDoc('d01', 's01', 's01_t1', { verifyStatus: 'unverified', source: src })]
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const dish = res.dataset.ALL_DISHES[0];
    checkEqual('D1 verifyStatus 原样保留', dish.verifyStatus, 'unverified');
    checkEqual('D1 source.kind 原样保留', dish.sourceKind, 'official');
    checkEqual('D1 source.detail 原样保留', dish.sourceDetail, '食堂公告栏拍摄');
    check('D1 verifiedAt 为 null 时不伪造日期', dish.verifiedAt === null);
  }

  /* D2 演示数据不会被云端字段"升级"成已核实 */
  {
    const fake = { kind: 'demo', detail: '课程演示数据', ref: '' };
    const fetchPage = makeDispatchFetch({
      restaurants: [restaurantDoc('s01', { dataClass: 'demo', verifyStatus: 'verified', verifiedAt: '2026-10-01', source: fake })],
      stalls: [stallDoc('s01_t1', 's01', { dataClass: 'demo', verifyStatus: 'verified', verifiedAt: '2026-10-01', source: fake })],
      dishes: [dishDoc('d01', 's01', 's01_t1', { dataClass: 'demo', verifyStatus: 'verified', verifiedAt: '2026-10-01', source: fake })]
    });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const dish = res.dataset.ALL_DISHES[0];
    checkEqual('D2 声称 verified 但来源是 demo → 最终仍是 demo', dish.verifyStatus, 'demo');
    check('D2 演示数据的 verifiedAt 被清空', dish.verifiedAt === null);
  }

  /* D3 缺核验信息不会被升级为已核实 */
  {
    const bare = { _id: 'd01', name: '裸数据', price: 9, foodType: 'rice', restaurantId: 's01', stallId: 's01_t1', tastes: ['light'] };
    const bareShop = { _id: 's01', name: '裸店', area: 'campus', floors: [], stalls: [] };
    const bareStall = { _id: 's01_t1', restaurantId: 's01', floorId: '', name: '档口' };
    const fetchPage = makeDispatchFetch({ restaurants: [bareShop], stalls: [bareStall], dishes: [bare] });
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const dish = res.dataset.ALL_DISHES[0];
    checkEqual('D3 完全没写 verifyStatus → 判定为 unverified', dish.verifyStatus, 'unverified');
    check('D3 同时 verifiedAt 保持 null', dish.verifiedAt === null);
  }

  /* ---------------------------------------------------------------
     E. 默认顺序兼容（阶段 3-2 的核心要求）
     --------------------------------------------------------------- */
  section('E. 默认顺序：本地兼容 + 新 ID 稳定');

  const cloudDocs = localToCloudDocs();
  const localShopIds = dataIndex.ALL_SHOPS.map(function (s) { return s.id; });
  const localDishIds = dataIndex.ALL_DISHES.map(function (d) { return d.id; });

  /* E1 顺序表本身与本地数据一致（防止表写错） */
  {
    checkEqual('E1 店铺顺序表与本地数据一致', repo.LOCAL_SHOP_ORDER.slice(), localShopIds);
    checkEqual('E1 菜品顺序表与本地数据一致', repo.LOCAL_DISH_ORDER.slice(), localDishIds);
    const localStallIds = [];
    dataIndex.ALL_SHOPS.forEach(function (s) {
      (s.stallList || []).forEach(function (st) { localStallIds.push(st.id); });
    });
    checkEqual('E1 窗口顺序表与本地数据一致', repo.LOCAL_STALL_ORDER.slice(), localStallIds);
  }

  /* E2 输入顺序打乱后，输出顺序仍等于本地顺序 */
  {
    const shuffled = {
      restaurants: deterministicShuffle(cloudDocs.restaurants, 7),
      stalls: deterministicShuffle(cloudDocs.stalls, 11),
      dishes: deterministicShuffle(cloudDocs.dishes, 13)
    };
    const fetchPage = makeDispatchFetch(shuffled);
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage, pageSize: 7 });
    checkEqual('E2 打乱输入后店铺顺序 = 本地顺序', res.dataset.ALL_SHOPS.map(function (s) { return s.id; }), localShopIds);
    checkEqual('E2 打乱输入后菜品顺序 = 本地顺序', res.dataset.ALL_DISHES.map(function (d) { return d.id; }), localDishIds);
  }

  /* E3 两次不同打乱 → 结果完全一致 */
  {
    const a = await repo.loadCloudDataset({
      fetchPage: makeDispatchFetch({
        restaurants: deterministicShuffle(cloudDocs.restaurants, 21),
        stalls: deterministicShuffle(cloudDocs.stalls, 22),
        dishes: deterministicShuffle(cloudDocs.dishes, 23)
      }, {}),
      pageSize: 9
    });
    const b = await repo.loadCloudDataset({
      fetchPage: makeDispatchFetch({
        restaurants: deterministicShuffle(cloudDocs.restaurants, 91),
        stalls: deterministicShuffle(cloudDocs.stalls, 92),
        dishes: deterministicShuffle(cloudDocs.dishes, 93)
      }, {}),
      pageSize: 4
    });
    checkEqual('E3 两种输入顺序 → 菜品顺序一致',
      a.dataset.ALL_DISHES.map(function (d) { return d.id; }),
      b.dataset.ALL_DISHES.map(function (d) { return d.id; }));
    checkEqual('E3 两种输入顺序 → 菜品内容一致',
      JSON.stringify(a.dataset.ALL_DISHES), JSON.stringify(b.dataset.ALL_DISHES));
  }

  /* E4 新 ID 排在已有映射记录之后 */
  {
    const withNew = {
      restaurants: cloudDocs.restaurants.concat([restaurantDoc('s99')]),
      stalls: cloudDocs.stalls.concat([stallDoc('s99_t1', 's99')]),
      dishes: cloudDocs.dishes.concat([
        dishDoc('d99', 's01', 's01_t1'),
        dishDoc('d00', 's01', 's01_t1')
      ])
    };
    const res = await repo.loadCloudDataset({ fetchPage: makeDispatchFetch(withNew) });
    const dishIds = res.dataset.ALL_DISHES.map(function (d) { return d.id; });
    checkEqual('E4 新菜品排在最后（新 ID 之间按字典序 d00 < d99）',
      dishIds.slice(-2), ['d00', 'd99']);
    check('E4 已有 45 道菜的相对顺序未变', JSON.stringify(dishIds.slice(0, 45)) === JSON.stringify(localDishIds));
    checkEqual('E4 新店铺排在最后', res.dataset.ALL_SHOPS.map(function (s) { return s.id; }).slice(-1), ['s99']);
  }

  /* E5 新 ID 顺序与输入顺序无关 */
  {
    const base = {
      restaurants: cloudDocs.restaurants.concat([restaurantDoc('s99')]),
      stalls: cloudDocs.stalls.concat([stallDoc('s99_t1', 's99')]),
      dishes: cloudDocs.dishes.concat([dishDoc('d99', 's01', 's01_t1'), dishDoc('d00', 's01', 's01_t1')])
    };
    const a = await repo.loadCloudDataset({
      fetchPage: makeDispatchFetch({ restaurants: base.restaurants.slice().reverse(), stalls: base.stalls.slice().reverse(), dishes: base.dishes.slice().reverse() })
    });
    const b = await repo.loadCloudDataset({ fetchPage: makeDispatchFetch(base) });
    checkEqual('E5 输入正序 / 倒序 → 菜品 id 序列一致',
      a.dataset.ALL_DISHES.map(function (d) { return d.id; }),
      b.dataset.ALL_DISHES.map(function (d) { return d.id; }));
  }

  /* E6 变长 ID 的字典序边界：把当前行为写死在测试里 */
  {
    const base = {
      restaurants: cloudDocs.restaurants,
      stalls: cloudDocs.stalls,
      dishes: cloudDocs.dishes.concat([
        dishDoc('d100', 's01', 's01_t1'),
        dishDoc('d99', 's01', 's01_t1')
      ])
    };
    const res = await repo.loadCloudDataset({ fetchPage: makeDispatchFetch(base) });
    const ids = res.dataset.ALL_DISHES.map(function (d) { return d.id; });
    checkEqual('E6 两个新 ID 都排在 45 道之后', ids.slice(-2), ['d100', 'd99']);
    check("E6 当前是字符串字典序：'d100' 小于 'd99'", 'd100' < 'd99');
    /* 这条不是"觉得对"，而是把已知边界钉住：将来若改成数值序，这里会立刻红 */
    checkEqual('E6 45 道老菜不动', ids.slice(0, 45), localDishIds);
  }

  /* E7 每家店内部的窗口顺序也必须等于本地（不只是全局） */
  {
    const shuffled = {
      restaurants: deterministicShuffle(cloudDocs.restaurants.slice(), 7),
      stalls: deterministicShuffle(cloudDocs.stalls.slice(), 11),
      dishes: deterministicShuffle(cloudDocs.dishes.slice(), 13)
    };
    const res = await repo.loadCloudDataset({ fetchPage: makeDispatchFetch(shuffled) });

    const localPerShop = {};
    dataIndex.ALL_SHOPS.forEach(function (s) {
      localPerShop[s.id] = s.stalls.map(function (t) { return t.id; });
    });

    const bad = [];
    res.dataset.ALL_SHOPS.forEach(function (s) {
      const got = s.stalls.map(function (t) { return t.id; });
      if (JSON.stringify(got) !== JSON.stringify(localPerShop[s.id])) {
        bad.push(s.id + ' → ' + got.join(','));
      }
    });
    checkEqual('E7 打乱输入后每家店的窗口顺序 = 本地', bad, []);

    let stallTotal = 0;
    res.dataset.ALL_SHOPS.forEach(function (s) { stallTotal += s.stalls.length; });
    checkEqual('E7 覆盖全部 24 个窗口', stallTotal, 24);
  }

  /* E8 sortByLocalOrder 不得原地修改调用方数组 */
  {
    const index = {};
    repo.LOCAL_DISH_ORDER.forEach(function (id, i) { index[id] = i; });

    const input = [{ id: 'd05' }, { id: 'd01' }, { id: 'zz' }];
    const before = JSON.stringify(input);
    const out = repo.sortByLocalOrder(input, index);

    checkEqual('E8 输入数组未被原地修改', JSON.stringify(input), before);
    check('E8 返回的是新数组', out !== input);
    checkEqual('E8 返回结果已排序', out.map(function (d) { return d.id; }), ['d01', 'd05', 'zz']);
    check('E8 sortByLocalOrder 可从模块外部调用', typeof repo.sortByLocalOrder === 'function');
  }

  /* ---------------------------------------------------------------
     F. 复用 buildDataset（等价性证明）
     --------------------------------------------------------------- */
  section('F. 复用 buildDataset');

  {
    const fetchPage = makeDispatchFetch(cloudDocs);
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage, pageSize: 11 });
    const direct = dataIndex.buildDataset(res.shops, res.dishes);
    checkEqual('F1 loadCloudDataset 的结果 == 直接调用 buildDataset',
      JSON.stringify(res.dataset.ALL_DISHES), JSON.stringify(direct.ALL_DISHES));
    checkEqual('F1 店铺也一样',
      JSON.stringify(res.dataset.ALL_SHOPS), JSON.stringify(direct.ALL_SHOPS));
    check('F1 45 道菜全在', res.dataset.ALL_DISHES.length === 45);
    check('F1 12 家店全在', res.dataset.ALL_SHOPS.length === 12);
  }

  /* F2 适配 + 拼装后，展示字段与本地完全一致（证明翻译没丢东西） */
  {
    const fetchPage = makeDispatchFetch(cloudDocs);
    const res = await repo.loadCloudDataset({ fetchPage: fetchPage });
    const fields = ['name', 'price', 'tasteText', 'foodTypeText', 'areaText', 'shopName',
      'floorText', 'stallName', 'stallLabel', 'location', 'verifyStatus'];
    let mismatch = null;
    for (let i = 0; i < localDishIds.length; i++) {
      const local = dataIndex.ALL_DISHES[i];
      const cloud = res.dataset.ALL_DISHES[i];
      for (let j = 0; j < fields.length; j++) {
        if (JSON.stringify(local[fields[j]]) !== JSON.stringify(cloud[fields[j]])) {
          mismatch = mismatch || (local.id + '.' + fields[j] + ' 本地=' + local[fields[j]] + ' 云端=' + cloud[fields[j]]);
        }
      }
    }
    check('F2 45 道菜的 11 个展示字段与本地逐字段一致', mismatch === null, mismatch || '');
  }

  /* ---------------------------------------------------------------
     G. 与微信运行时解耦
     --------------------------------------------------------------- */
  section('G. 模块加载与 wx 解耦');

  /* G1 模块被 require 时不得访问 wx */
  {
    const modPath = path.join(ROOT, 'utils', 'cloudRepo.js');
    const before = Object.prototype.hasOwnProperty.call(global, 'wx');
    const oldWx = global.wx;
    let touched = false;
    global.wx = new Proxy({}, {
      get: function () { touched = true; throw new Error('模块加载阶段访问了 wx'); }
    });
    delete require.cache[require.resolve(modPath)];
    let loaded = false;
    try {
      require(modPath);
      loaded = true;
    } catch (e) {
      loaded = false;
    }
    if (before) global.wx = oldWx; else delete global.wx;
    require(modPath); /* 还原干净的模块实例 */
    check('G1 require 时未访问 wx', loaded && touched === false);
  }

  /* G2 注入假 db（wx 形态）也能工作：证明是"注入了才碰" */
  {
    const docs = localToCloudDocs();
    const all = []
      .concat(docs.restaurants.map(function (d) { return { c: 'restaurants', d: d }; }))
      .concat(docs.stalls.map(function (d) { return { c: 'stalls', d: d }; }))
      .concat(docs.dishes.map(function (d) { return { c: 'dishes', d: d }; }));

    const fakeDb = {
      command: { gt: function (v) { return { __gt: v }; } },
      collection: function (name) {
        const state = { name: name, lastId: null, limit: 20 };
        const chain = {
          where: function (w) { state.lastId = w && w._id && w._id.__gt; return chain; },
          orderBy: function () { return chain; },
          limit: function (n) { state.limit = n; return chain; },
          get: async function () {
            const pool = all.filter(function (x) { return x.c === state.name; })
              .map(function (x) { return x.d; })
              .sort(byId);
            let from = 0;
            if (state.lastId !== null && state.lastId !== undefined) {
              const idx = pool.findIndex(function (d) { return d._id > state.lastId; });
              from = idx === -1 ? pool.length : idx;
            }
            return { data: pool.slice(from, from + state.limit) };
          }
        };
        return chain;
      }
    };

    const res = await repo.loadCloudDataset({ db: fakeDb, pageSize: 6 });
    check('G2 传入 db 时走 makeWxFetcher，读到 45 道菜', res.dataset.ALL_DISHES.length === 45);
    checkEqual('G2 顺带验证顺序仍与本地一致', res.dataset.ALL_DISHES.map(function (d) { return d.id; }), localDishIds);
    await expectThrow(
      'G2 makeWxFetcher 拒绝非法 db',
      function () { return repo.loadCloudDataset({ db: {} }); },
      repo.ERROR_CODE.BAD_ARGS
    );
  }

  /* G3 本模块没有写操作（导出面里不存在写方法） */
  {
    const names = Object.keys(repo);
    const writeish = names.filter(function (n) { return /^(write|add|set|delete|remove|update|drop|create)/i.test(n); });
    checkEqual('G3 导出里没有任何写方法', writeish, []);
  }

  /* ---------------------------------------------------------------
     H. 不修改入参
     --------------------------------------------------------------- */
  section('H. 纯函数性质');

  {
    const shops = [restaurantDoc('s01')];
    const dishes = [dishDoc('d02', 's01', 's01_t1'), dishDoc('d01', 's01', 's01_t1')];
    const before = JSON.stringify({ shops: shops, dishes: dishes });
    const fetchPage = makeDispatchFetch({ restaurants: shops, stalls: [stallDoc('s01_t1', 's01')], dishes: dishes });
    await repo.loadCloudDataset({ fetchPage: fetchPage });
    check('H1 原始文档在适配过程后未被修改', JSON.stringify({ shops: shops, dishes: dishes }) === before);
  }

  {
    const d1 = repo.adaptDish(dishDoc('d05', 's01', 's01_t1'));
    const d2 = repo.adaptDish(dishDoc('d05', 's01', 's01_t1'));
    check('H2 同一文档适配两次得到相同结果（幂等）', JSON.stringify(d1) === JSON.stringify(d2));
  }

  /* ---------------------------------------------------------------
     汇总
     --------------------------------------------------------------- */
  console.log('');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项' + (warn ? '，警告 ' + warn + ' 项' : ''));
  if (fail === 0) {
    console.log('全部通过' + (warn ? '（WARN 项不阻塞，但需要人工确认）' : ''));
    process.exit(0);
  } else {
    console.log('失败明细：');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error('');
  console.error('测试脚本自身异常：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
