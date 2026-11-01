/**
 * tools/test_index_state.js —— 首页（pages/index/index.js）加载状态机的离线测试
 *
 * 完全离线：不 require wx 真对象、不连云环境、不开开发者工具、不需要网络。
 * 做法：用假的 global.Page 把页面配置抓出来，再用假的 setData 造出页面实例，
 *       然后直接驱动真实的 pages/index/index.js —— 测的是上线那份代码，不是复刻。
 *
 * 运行：node tools/test_index_state.js
 * 退出码：0 = 全通过，1 = 有 FAIL
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ================================================================
   测试脚手架
   ================================================================ */

let pass = 0;
let fail = 0;
const failures = [];

/* 未处理 rejection 的记录器：S21 用它证明"失败处理自己抛错"时
   不会有 Promise 悄悄漏到全局 */
const unhandled = [];
process.on('unhandledRejection', function (err) {
  unhandled.push(err);
});

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

/* 冲掉 Promise 微任务：setTimeout 0 之后，本轮所有微任务必定跑完 */
function flush() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

/**
 * 可控时钟：替换页面的 _setLoadTimer / _clearLoadTimer。
 * 测试不用真等 8 秒，只 tick() 一下就能把超时触发；
 * 同时能断言"定时器到底有没有被清掉"（pending）。
 */
function makeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();

  return {
    set: function (fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + (ms || 0), fn: fn });
      return id;
    },
    clear: function (id) {
      timers.delete(id);
    },
    tick: function (ms) {
      now += ms;
      const due = [];
      timers.forEach(function (t, id) {
        if (t.at <= now) due.push({ id: id, t: t });
      });
      due.sort(function (a, b) { return a.t.at - b.t.at; });
      due.forEach(function (item) {
        if (!timers.has(item.id)) return;
        timers.delete(item.id);
        item.t.fn();
      });
    },
    pending: function () {
      return timers.size;
    }
  };
}

/* 手动控制 resolve/reject 的 Promise，用来制造"挂起"与"迟到返回" */
function deferred() {
  let resolve, reject;
  const promise = new Promise(function (res, rej) {
    resolve = res;
    reject = rej;
  });
  return { promise: promise, resolve: resolve, reject: reject };
}

/* ================================================================
   造页面实例
   ================================================================ */

/* wx 只需要 showToast；页面其它 wx 调用在被测路径里不会触发。
   toastCalls 记下每一次提示，用来断言"在途上限"有没有给用户反馈。 */
const toastCalls = [];
global.wx = {
  showToast: function (opts) {
    toastCalls.push(opts || {});
  }
};

let captured = null;
global.Page = function (config) {
  captured = config;
};

require(path.join(ROOT, 'pages', 'index', 'index.js'));

if (!captured) {
  console.error('未能捕获 Page 配置，页面文件可能没有调用 Page()');
  process.exit(1);
}

/**
 * 新建一个页面实例。
 * @param {boolean} withCount 是否统计 setData 次数（给 after-unload 用）
 */
function makePage(withCount) {
  const page = Object.create(captured);
  page.data = JSON.parse(JSON.stringify(captured.data));

  page.__setDataCount = 0;
  page.__stateTrace = [];
  page.__clock = makeClock();

  page.setData = function (patch, cb) {
    page.__setDataCount++;
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'dataState')) {
      page.__stateTrace.push(patch.dataState);
    }
    Object.assign(this.data, patch);
    if (typeof cb === 'function') cb();
  };

  /* 用可控时钟顶掉真实 setTimeout：测试既不用真等，也不会留下活表 */
  page._setLoadTimer = function (fn, ms) {
    return page.__clock.set(fn, ms);
  };
  page._clearLoadTimer = function (id) {
    page.__clock.clear(id);
  };

  return page;
}

/* 一份干净可辨认的数据集，方便断言"到底用的是哪一份"。
   阶段 3-3.4 起页面会先过 utils/datasetGuard.js 的结构校验，
   所以夹具本身必须是**结构合法**的（这不影响任何断言的严格程度：
   夹具该像真数据，畸形数据由 S17-S19 专门喂进去）。 */
function datasetOf(shopId, shopName, dishCount) {
  const dishes = [];
  for (let i = 0; i < (dishCount || 0); i++) {
    dishes.push({
      id: 'z' + i,
      name: '菜' + i,
      price: 10,
      foodType: 'other',
      shopId: shopId,
      stallId: '',
      tastes: ['light']
    });
  }
  return {
    source: 'local',
    shops: [{ id: shopId, name: shopName, area: 'campus', floors: [], stalls: [] }],
    dishes: dishes,
    statusText: shopName
  };
}

function totalStalls(dataset) {
  return dataset.ALL_SHOPS.reduce(function (n, s) {
    return n + (s.stalls ? s.stalls.length : 0);
  }, 0);
}

/* ================================================================
   S1 初始状态
   ================================================================ */

async function S1_initial() {
  console.log('\n── S1 初始状态（尚未 onLoad） ─────────────────────────');

  const page = makePage();
  checkEqual('S1 dataState 初始为 loading', page.data.dataState, 'loading');
  checkEqual('S1 加载前来源未知', page.data.dataSource, 'unknown');
  checkEqual('S1 dataErrorText 初始为空串', page.data.dataErrorText, '');
  checkEqual('S1 raw 尚未准备好', page.raw, undefined);

  /* refresh() 在数据未就绪时必须是安全的空操作，不能拿未初始化数据算 */
  let threw = false;
  try { page.refresh(); } catch (e) { threw = true; }
  check('S1 数据未就绪时 refresh() 不抛错', !threw);
  checkEqual('S1 数据未就绪时 matchedCount 保持 0', page.data.matchedCount, 0);
}

/* ================================================================
   S2 本地初始化成功
   ================================================================ */

async function S2_ready() {
  console.log('\n── S2 本地初始化成功 ─────────────────────────────────');

  const page = makePage();
  page.onLoad();
  /* 本地数据是同步模块：loading 与 ready 在同一拍内先后发出，
     所以这里断言的是"先经过 loading 再到 ready"这条轨迹，而不是跨拍的中间态。 */
  checkEqual('S2 onLoad 期间状态轨迹先 loading', page.__stateTrace[0], 'loading');
  checkEqual('S2 onLoad 返回时已是 ready（同步路径）', page.data.dataState, 'ready');

  await flush();

  checkEqual('S2 加载完成进入 ready', page.data.dataState, 'ready');
  checkEqual('S2 数据源仍为 local', page.data.dataSource, 'local');
  checkEqual('S2 错误文案清空', page.data.dataErrorText, '');

  /* 数据完整性：不能被"异步化"弄少 */
  checkEqual('S2 店铺 12 家', page.raw.shops.length, 12);
  checkEqual('S2 窗口 24 个', page.raw.shops.reduce(function (n, s) {
    return n + (s.stalls ? s.stalls.length : 0);
  }, 0), 24);
  checkEqual('S2 菜品 45 道', page.raw.dishes.length, 45);
  checkEqual('S2 shopMap 建了 12 个 key', Object.keys(page.shopMap).length, 12);
  checkEqual('S2 默认条件下命中 45 道', page.data.matchedCount, 45);

  checkEqual('S2 状态变化轨迹 loading → ready', page.__stateTrace, ['loading', 'ready']);
  check('S2 dataSource 从未出现 cloud', page.data.dataSource !== 'cloud');
}

/* ================================================================
   S3 初始化失败 → error
   ================================================================ */

async function S3_error() {
  console.log('\n── S3 初始化失败进入 error ───────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();
  checkEqual('S3 前置：已处于 ready', page.data.dataState, 'ready');

  const beforeDishes = page.raw.dishes.length;
  const beforeMatched = page.data.matchedCount;

  /* 唯一的"数据来源"接缝换成会抛错的实现 */
  page.loadRawDataset = function () { throw new Error('模拟数据源不可用'); };

  await page.beginLoad();

  checkEqual('S3 进入 error', page.data.dataState, 'error');
  check('S3 给出了中性错误文案', page.data.dataErrorText.length > 0, page.data.dataErrorText);
  check('S3 文案不出现"云端"字样', page.data.dataErrorText.indexOf('云端') < 0);
  check('S3 原始错误留在实例上便于排查', String(page._loadError).indexOf('模拟数据源不可用') >= 0);

  /* 不能为了造错误态把已有数据清空 */
  checkEqual('S3 失败后已有数据保留（45 道）', page.raw.dishes.length, beforeDishes);
  checkEqual('S3 失败后命中数保留', page.data.matchedCount, beforeMatched);
  checkEqual('S3 失败后 shopMap 保留', Object.keys(page.shopMap).length, 12);
}

/* ================================================================
   S4 重试恢复
   ================================================================ */

async function S4_retry() {
  console.log('\n── S4 重试后恢复 ready ───────────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();

  page.loadRawDataset = function () { throw new Error('第一次失败'); };
  await page.beginLoad();
  checkEqual('S4 前置：error', page.data.dataState, 'error');

  /* 恢复真实实现 → 点重试。
     同步路径下 loading 与 ready 同一拍发出，所以要断言轨迹而不是中间态。 */
  delete page.loadRawDataset;
  const traceLenBefore = page.__stateTrace.length;
  page.onRetry();
  const retryTrace = page.__stateTrace.slice(traceLenBefore);
  checkEqual('S4 重试确实重新走了一遍 loading → ready', retryTrace, ['loading', 'ready']);

  await flush();
  checkEqual('S4 重试后回到 ready', page.data.dataState, 'ready');
  checkEqual('S4 重试后错误文案清空', page.data.dataErrorText, '');
  checkEqual('S4 重试后数据仍是 45 道', page.raw.dishes.length, 45);
  checkEqual('S4 重试后数据源仍是 local', page.data.dataSource, 'local');
}

/* ================================================================
   S5 重试不重复触发
   ================================================================ */

async function S5_no_duplicate() {
  console.log('\n── S5 并发重试只跑一次 ───────────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();

  /* 用挂起的 thenable 制造"加载真的还没结束"，才能测到并发拦截；
     本地同步数据瞬间完成，没有可拦截的窗口。 */
  let calls = 0;
  let release = null;
  page.loadRawDataset = function () {
    calls++;
    return new Promise(function (resolve) {
      release = function () {
        resolve({ source: 'local', shops: [], dishes: [], statusText: '' });
      };
    });
  };

  const inflight = page.beginLoad();
  page.onRetry();   /* 加载进行中：必须被挡住 */
  page.onRetry();
  checkEqual('S5 加载中连点两次 → 只执行 1 次初始化', calls, 1);

  release();
  await inflight;
  await flush();

  checkEqual('S5 最终仍是 ready', page.data.dataState, 'ready');
  checkEqual('S5 加载结束后再点重试才允许再跑一次', calls, 1);
}

/* ================================================================
   S6 旧加载不覆盖新状态
   ================================================================ */

async function S6_stale() {
  console.log('\n── S6 旧结果不能覆盖新状态 ───────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();

  let resolveFirst = null;
  let n = 0;

  page.loadRawDataset = function () {
    n++;
    if (n === 1) {
      /* 第一轮：挂起，稍后才返回"旧数据" */
      return new Promise(function (resolve) {
        resolveFirst = function () {
          resolve({ source: 'local', shops: [], dishes: [], statusText: '' });
        };
      });
    }
    /* 第二轮：立刻返回一份可辨认的数据 */
    return {
      source: 'local',
      shops: [{ id: 'x1', name: '新数据店', area: 'campus', floors: [], stalls: [] }],
      dishes: [],
      statusText: '新数据'
    };
  };

  const first = page.beginLoad();
  const second = page.beginLoad();

  await second;
  await flush();
  checkEqual('S6 第二轮先完成：进入 ready', page.data.dataState, 'ready');
  checkEqual('S6 当前数据来自第二轮', page.raw.shops.length, 1);
  check('S6 当前数据来自第二轮（店名）', page.raw.shops[0].name === '新数据店');

  /* 现在让第一轮才返回：它已经过期，必须被丢弃 */
  resolveFirst();
  await first;
  await flush();

  checkEqual('S6 过期结果被丢弃：仍是 1 家店', page.raw.shops.length, 1);
  check('S6 过期结果被丢弃：店名没被改回', page.raw.shops[0].name === '新数据店');
  checkEqual('S6 状态没被旧加载改成 error', page.data.dataState, 'ready');
}

/* ================================================================
   S7 卸载后不再 setData
   ================================================================ */

async function S7_unload() {
  console.log('\n── S7 页面卸载后不 setData ───────────────────────────');

  const page = makePage(true);
  page.onLoad();
  await flush();

  page.onUnload();
  const countBefore = page.__setDataCount;

  await page.beginLoad();
  await flush();

  checkEqual('S7 卸载后 beginLoad 不再调用 setData', page.__setDataCount, countBefore);
  checkEqual('S7 卸载后 dataState 停在上次的值', page.data.dataState, 'ready');
}

/* ================================================================
   S8 状态机字段都被真实使用
   ================================================================ */

async function S8_fields_used() {
  console.log('\n── S8 状态字段确实被逻辑使用 ─────────────────────────');

  const wxml = require('fs').readFileSync(path.join(ROOT, 'pages', 'index', 'index.wxml'), 'utf8');
  check('S8 WXML 引用了 dataState', wxml.indexOf('dataState') >= 0);
  check('S8 WXML 有 loading 分支', wxml.indexOf("dataState === 'loading'") >= 0);
  check('S8 WXML 有 error 分支', wxml.indexOf("dataState === 'error'") >= 0);
  check('S8 WXML 有 ready 分支', wxml.indexOf("dataState === 'ready'") >= 0);
  check('S8 WXML 的重试按钮绑定了 onRetry', wxml.indexOf('bindtap="onRetry"') >= 0);

  const js = require('fs').readFileSync(path.join(ROOT, 'pages', 'index', 'index.js'), 'utf8');
  check('S8 JS 里 dataSource 由 raw.source 赋值', js.indexOf('dataSource: self.raw.source') >= 0 || js.indexOf('dataSource: this.raw.source') >= 0);
  check('S8 JS 里没有把 dataSource 写死成 cloud', js.indexOf('dataSource: \'cloud\'') < 0);
  check('S8 首页通过统一只读入口加载云端数据', js.indexOf("require('../../utils/cloudRepo')") >= 0 &&
    js.indexOf('loadCloudDataset({ db: wx.cloud.database() })') >= 0);
  check('S8 首页没有直接写数据库', !/\.(add|update|remove|set)\s*\(/.test(js.replace(/setData\s*\(/g, '')));

  /* onRetry 必须是真事件处理函数：调用它要真的重新走一遍加载 */
  const page = makePage();
  page.onLoad();
  await flush();
  let called = 0;
  page.loadRawDataset = function () {
    called++;
    return { source: 'local', shops: [], dishes: [], statusText: '' };
  };
  page.onRetry();
  await flush();
  checkEqual('S8 onRetry 真的重新执行了初始化', called, 1);
}

/* ================================================================
   S9 Promise reject（真进 .catch 分支）
   ================================================================ */

async function S9_async_reject() {
  console.log('\n── S9 异步 reject 分支 ───────────────────────────────');

  const page = makePage(true);
  /* 先成功一轮，留一份"旧数据"用来验证失败后不清空 */
  page.onLoad();
  await flush();
  checkEqual('S9 先有一轮成功数据', page.data.matchedCount, 45);

  const beforeText = page.data.dataStatusText;
  page.loadRawDataset = function () {
    return Promise.reject(new Error('模拟网络中断'));
  };
  page.onRetry();
  await flush();

  checkEqual('S9 reject 后进入 error', page.data.dataState, 'error');
  check('S9 error 文案含「重试」', page.data.dataErrorText.indexOf('重试') >= 0, page.data.dataErrorText);
  check('S9 error 文案不含「云端」', page.data.dataErrorText.indexOf('云端') < 0);
  checkEqual('S9 锁已释放', page._loading, false);
  check('S9 原始错误被记录', String(page._loadError).indexOf('模拟网络中断') >= 0, String(page._loadError));
  checkEqual('S9 失败时不清空已有数据（店）', page.raw.shops.length, 12);
  checkEqual('S9 失败时不清空已有数据（菜）', page.raw.dishes.length, 45);
  checkEqual('S9 状态文案没被改动', page.data.dataStatusText, beforeText);
  checkEqual('S9 状态轨迹 loading→error', page.__stateTrace.slice(-2), ['loading', 'error']);
}

/* ================================================================
   S10 请求挂起 → 超时 → 可重试
   ================================================================ */

async function S10_timeout() {
  console.log('\n── S10 挂起超时后放锁并允许重试 ──────────────────────');

  const page = makePage();
  const timeout = page.getLoadTimeoutMs();
  check('S10 超时常量是正数', typeof timeout === 'number' && timeout > 0, String(timeout));

  const d = deferred();
  let starts = 0;
  page.loadRawDataset = function () {
    starts++;
    return d.promise;   /* 永远不返回 */
  };
  page.onLoad();
  await flush();

  checkEqual('S10 挂起时停在 loading', page.data.dataState, 'loading');
  checkEqual('S10 挂起时锁是占用的', page._loading, true);
  checkEqual('S10 挂起期间定时器在跑', page.__clock.pending(), 1);

  /* 连点重试：挡在锁上，不该开第二轮 */
  page.onRetry();
  page.onRetry();
  await flush();
  checkEqual('S10 挂起期间连点重试不叠加', starts, 1);

  page.__clock.tick(timeout);
  await flush();
  checkEqual('S10 超时后进入 error', page.data.dataState, 'error');
  check('S10 超时文案说明停止等待', page.data.dataErrorText.indexOf('停止等待') >= 0, page.data.dataErrorText);
  check('S10 超时文案含「重试」', page.data.dataErrorText.indexOf('重试') >= 0);
  checkEqual('S10 超时后锁被释放', page._loading, false);
  checkEqual('S10 超时后定时器已清空', page.__clock.pending(), 0);

  /* 换回正常同步数据源，重试必须真的能跑起来 */
  page.loadRawDataset = function () {
    starts++;
    return { source: 'local', shops: [], dishes: [], statusText: '' };
  };
  page.onRetry();
  await flush();
  checkEqual('S10 超时后重试能启动新请求', starts, 2);
  checkEqual('S10 重试后恢复 ready', page.data.dataState, 'ready');
  checkEqual('S10 重试后错误文案被清空', page.data.dataErrorText, '');
}

/* ================================================================
   S11 旧请求迟到：不覆盖新请求
   ================================================================ */

async function S11_late_arrival() {
  console.log('\n── S11 超时后重试，旧请求迟到不覆盖 ──────────────────');

  const page = makePage();
  const timeout = page.getLoadTimeoutMs();
  const d = deferred();

  page.loadRawDataset = function () { return d.promise; };
  page.onLoad();
  await flush();

  page.__clock.tick(timeout);
  await flush();
  checkEqual('S11 超时进入 error', page.data.dataState, 'error');

  /* 重试：这次给一份可辨认的新数据 */
  page.loadRawDataset = function () { return datasetOf('n1', '新店', 3); };
  page.onRetry();
  await flush();
  checkEqual('S11 重试成功', page.data.dataState, 'ready');
  checkEqual('S11 重试后数据是新的', page.raw.shops.length, 1);
  checkEqual('S11 重试后菜品数 3', page.raw.dishes.length, 3);

  /* 旧请求现在才 resolve：必须被丢弃 */
  d.resolve(datasetOf('old', '旧店', 99));
  await flush();
  checkEqual('S11 旧 resolve 不覆盖状态', page.data.dataState, 'ready');
  checkEqual('S11 旧 resolve 不覆盖店铺', page.raw.shops.length, 1);
  check('S11 旧 resolve 不覆盖店名', page.raw.shops[0].name === '新店');
  checkEqual('S11 旧 resolve 不覆盖菜品', page.raw.dishes.length, 3);

  /* 再来一轮：旧请求迟到 reject 也不能把页面拖回 error */
  const page2 = makePage();
  const d2 = deferred();
  page2.loadRawDataset = function () { return d2.promise; };
  page2.onLoad();
  await flush();
  page2.__clock.tick(timeout);
  await flush();
  page2.loadRawDataset = function () { return datasetOf('n2', '另一家', 2); };
  page2.onRetry();
  await flush();

  d2.reject(new Error('迟到的失败'));
  await flush();
  checkEqual('S11 迟到的 reject 不改变状态', page2.data.dataState, 'ready');
  check('S11 迟到的 reject 不写入错误文案', page2.data.dataErrorText === '');
  checkEqual('S11 迟到的 reject 不影响数据', page2.raw.dishes.length, 2);
}

/* ================================================================
   S12 同步请求顶掉异步请求时的锁归属
   ================================================================ */

async function S12_sync_over_async() {
  console.log('\n── S12 同步请求顶掉异步请求 ──────────────────────────');

  const page = makePage();
  const timeout = page.getLoadTimeoutMs();
  const a = deferred();

  let n = 0;
  page.loadRawDataset = function () {
    n++;
    if (n === 1) return a.promise;              /* A：挂起的异步 */
    return datasetOf('b1', 'B 店', 5);          /* B：同步 */
  };

  page.onLoad();             /* A：挂起的异步请求 */
  await flush();
  checkEqual('S12 A 挂起中', page.data.dataState, 'loading');
  checkEqual('S12 A 占着锁', page._loading, true);

  page.beginLoad();          /* B：同步，立刻完成，成为最新一轮 */
  await flush();
  checkEqual('S12 B 完成后 ready', page.data.dataState, 'ready');
  checkEqual('S12 数据来自 B', page.raw.dishes.length, 5);
  check('S12 店名来自 B', page.raw.shops[0].name === 'B 店');
  checkEqual('S12 锁归最新一轮，已释放', page._loading, false);

  /* A 的迟到结果不能改任何东西 */
  a.resolve(datasetOf('a1', 'A 店', 77));
  await flush();
  check('S12 A 迟到后店名仍是 B', page.raw.shops[0].name === 'B 店');
  checkEqual('S12 A 迟到后菜品仍是 B 的 5 道', page.raw.dishes.length, 5);
  checkEqual('S12 A 迟到后状态仍 ready', page.data.dataState, 'ready');

  /* A 的定时器到点：它的 settle 已经过期，不许再动状态 */
  page.__clock.tick(timeout * 2);
  await flush();
  checkEqual('S12 A 的定时器不把页面改成 error', page.data.dataState, 'ready');
  checkEqual('S12 A 定时器触发后没有残留', page.__clock.pending(), 0);
}

/* ================================================================
   S13 来源缺失不得默认为 local
   ================================================================ */

async function S13_unknown_source() {
  console.log('\n── S13 来源缺失落到 unknown ──────────────────────────');

  const page = makePage();
  page.loadRawDataset = function () {
    /* 故意不给 source */
    return { shops: [], dishes: [], statusText: '来源未知的一份数据' };
  };
  page.onLoad();
  await flush();

  checkEqual('S13 来源缺失时 dataSource = unknown', page.data.dataSource, 'unknown');
  check('S13 没有被标成 local', page.data.dataSource !== 'local');
  check('S13 没有被标成 demo', page.data.dataSource !== 'demo');
  checkEqual('S13 raw.source 也是 unknown', page.raw.source, 'unknown');

  /* 空串、纯空白、非字符串也一样 */
  const cases = ['', '   ', null, undefined, 123, {}];
  const seen = [];
  cases.forEach(function (val) {
    const p = makePage();
    p.applyDataset({ source: val, shops: [], dishes: [] });
    seen.push(p.raw.source);
  });
  checkEqual('S13 空串/空白/null/数字/对象一律 unknown', seen, ['unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);

  /* WXML 必须在 unknown 时换成告示，而不是继续打"演示数据"横幅 */
  const wxml = require('fs').readFileSync(path.join(ROOT, 'pages', 'index', 'index.wxml'), 'utf8');
  check('S13 WXML 仅 local 显示演示横幅',
    /class="demo-badge"\s+wx:elif="\{\{dataSource === 'local'\}\}"/.test(wxml));
  check('S13 WXML 真实来源有独立横幅', wxml.indexOf("dataSource === 'cloud'") >= 0);
  check('S13 WXML 有来源未知的告示', wxml.indexOf('数据来源未知') >= 0);
}

/* ================================================================
   S14 明确 local 时行为不变
   ================================================================ */

async function S14_local_unchanged() {
  console.log('\n── S14 明确 local 来源仍然照常加载 ───────────────────');

  const page = makePage();
  page.onLoad();
  await flush();

  checkEqual('S14 状态 ready', page.data.dataState, 'ready');
  checkEqual('S14 来源 local', page.data.dataSource, 'local');
  checkEqual('S14 12 家店', page.raw.shops.length, 12);
  checkEqual('S14 24 个窗口', totalStalls({ ALL_SHOPS: page.raw.shops }), 24);
  checkEqual('S14 45 道菜', page.raw.dishes.length, 45);
  checkEqual('S14 命中 45 道', page.data.matchedCount, 45);
  checkEqual('S14 没有残留的加载锁', page._loading, false);
  checkEqual('S14 同步路径不留定时器', page.__clock.pending(), 0);
}

/* ================================================================
   S15 卸载后超时不 setData
   ================================================================ */

async function S15_unload_timeout() {
  console.log('\n── S15 卸载后超时不 setData ──────────────────────────');

  const page = makePage(true);
  const timeout = page.getLoadTimeoutMs();
  const d = deferred();

  page.loadRawDataset = function () { return d.promise; };
  page.onLoad();
  await flush();

  page.onUnload();
  const countBefore = page.__setDataCount;

  page.__clock.tick(timeout);
  await flush();

  checkEqual('S15 卸载后超时不调用 setData', page.__setDataCount, countBefore);
  checkEqual('S15 卸载后状态不变成 error（停在上次值）', page.data.dataState, 'loading');
  checkEqual('S15 卸载后锁已收敛', page._loading, false);

  /* 卸载后迟到的 resolve 也不许 setData */
  d.resolve(datasetOf('late', '卸载后才来', 9));
  await flush();
  checkEqual('S15 卸载后迟到 resolve 也不 setData', page.__setDataCount, countBefore);
  checkEqual('S15 卸载后不会把数据装进去', page.data.matchedCount, 0);
}

/* ================================================================
   S16 成功/失败之后定时器不得再改变状态
   ================================================================ */

async function S16_timeout_cleanup() {
  console.log('\n── S16 定时器清理：不再二次改变状态 ──────────────────');

  /* 16a：异步成功 → 定时器必须被清掉，之后 tick 也没事 */
  const page = makePage();
  const timeout = page.getLoadTimeoutMs();
  const d = deferred();

  page.loadRawDataset = function () { return d.promise; };
  page.onLoad();
  await flush();
  checkEqual('S16a 异步加载中有一个定时器', page.__clock.pending(), 1);

  d.resolve(datasetOf('ok1', '成功店', 4));
  await flush();
  checkEqual('S16a 成功后进入 ready', page.data.dataState, 'ready');
  checkEqual('S16a 成功后定时器已清空', page.__clock.pending(), 0);

  page.__clock.tick(timeout * 3);
  await flush();
  checkEqual('S16a 事后 tick 不改状态', page.data.dataState, 'ready');

  /* 16b：同步路径压根不该开表 */
  const page2 = makePage();
  page2.onLoad();
  await flush();
  checkEqual('S16b 同步路径全程没有定时器', page2.__clock.pending(), 0);

  /* 16c：失败一次之后 tick 也不该再改文案 */
  const page3 = makePage();
  const timeout3 = page3.getLoadTimeoutMs();
  page3.loadRawDataset = function () { return Promise.reject(new Error('第一次就失败')); };
  page3.onLoad();
  await flush();
  const textAfterFail = page3.data.dataErrorText;
  checkEqual('S16c 失败后锁已释放', page3._loading, false);
  checkEqual('S16c 失败后定时器已清空', page3.__clock.pending(), 0);

  page3.__clock.tick(timeout3 * 3);
  await flush();
  checkEqual('S16c 事后 tick 不改失败文案', page3.data.dataErrorText, textAfterFail);
  checkEqual('S16c 事后 tick 不改状态', page3.data.dataState, 'error');
}

/* ================================================================
   阶段 3-3.4：数据校验 / 异常收敛 / 在途请求治理
   ================================================================ */

/* S17 shops 是对象而不是数组 */
async function S17_shops_not_array() {
  console.log('\n── S17 shops 不是数组 ────────────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();
  checkEqual('S17 前置：本地数据已就绪', page.data.dataState, 'ready');
  const dishesBefore = page.raw.dishes.length;
  const shopsBefore = page.raw.shops.length;

  page.loadRawDataset = function () {
    return { source: 'local', shops: { s01: {} }, dishes: [], statusText: '坏数据' };
  };
  page.onRetry();
  await flush();

  checkEqual('S17 进入 error，不停在 loading', page.data.dataState, 'error');
  check('S17 文案可读且带「重试」', page.data.dataErrorText.indexOf('重试') >= 0, page.data.dataErrorText);
  checkEqual('S17 旧菜品没被覆盖', page.raw.dishes.length, dishesBefore);
  checkEqual('S17 旧店铺没被覆盖', page.raw.shops.length, shopsBefore);
  checkEqual('S17 锁已释放', page._loading, false);
  check('S17 原始原因记在 _loadError', !!page._loadError && page._loadError.indexOf('shops') >= 0, page._loadError);
  checkEqual('S17 定时器已清', page.__clock.pending(), 0);
}

/* S18 dishes 是对象而不是数组 */
async function S18_dishes_not_array() {
  console.log('\n── S18 dishes 不是数组 ───────────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();
  const before = {
    dishes: page.raw.dishes.length,
    shops: page.raw.shops.length,
    matched: page.data.matchedCount
  };

  page.loadRawDataset = function () {
    return { source: 'local', shops: [], dishes: { d01: {} }, statusText: '坏数据' };
  };
  page.onRetry();
  await flush();

  checkEqual('S18 进入 error', page.data.dataState, 'error');
  checkEqual('S18 旧菜品数量不变', page.raw.dishes.length, before.dishes);
  checkEqual('S18 旧店铺数量不变', page.raw.shops.length, before.shops);
  checkEqual('S18 命中数不变（列表没被清空）', page.data.matchedCount, before.matched);
  check('S18 原因点名 dishes', !!page._loadError && page._loadError.indexOf('dishes') >= 0, page._loadError);
}

/* S19 单条记录的关键字段类型错误 */
async function S19_bad_record() {
  console.log('\n── S19 单条记录字段类型错误 ───────────────────────────');

  const cases = [
    { label: 'price 是字符串', dish: { price: '12' }, hint: 'price' },
    { label: 'tastes 是字符串', dish: { tastes: 'light' }, hint: 'tastes' },
    { label: 'shopId 缺失', dish: { shopId: undefined }, hint: 'shopId' },
    { label: 'foodType 是数字', dish: { foodType: 7 }, hint: 'foodType' }
  ];

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const page = makePage();
    page.onLoad();
    await flush();
    const dishesBefore = page.raw.dishes.length;

    page.loadRawDataset = function () {
      const dish = Object.assign({
        id: 'bad1', name: '坏菜', price: 10, foodType: 'other', shopId: 's01', tastes: []
      }, c.dish);
      /* 只有该用例显式想测"缺失"时才删字段（undefined 在 Object.assign 里不生效） */
      if (Object.prototype.hasOwnProperty.call(c.dish, 'shopId')) delete dish.shopId;
      return {
        source: 'local',
        shops: [{ id: 's01', name: '一号食堂', area: 'campus', floors: [], stalls: [] }],
        dishes: [dish],
        statusText: '坏记录'
      };
    };
    page.onRetry();
    await flush();

    check('S19 ' + c.label + ' → 拒绝应用并进 error', page.data.dataState === 'error', page.data.dataState);
    checkEqual('S19 ' + c.label + ' → 旧数据保留', page.raw.dishes.length, dishesBefore);
    check('S19 ' + c.label + ' → 错误点名 ' + c.hint,
      !!page._loadError && page._loadError.indexOf(c.hint) >= 0, page._loadError);
  }

  /* 顶层形状也要挡：null / 数组 / 字符串 */
  const page = makePage();
  page.onLoad();
  await flush();
  const shapes = [null, [], 'str', 42];
  const seen = [];
  shapes.forEach(function (shape) {
    page.loadRawDataset = function () { return shape; };
    page.onRetry();
    seen.push(page.data.dataState);
  });
  await flush();
  checkEqual('S19 顶层非对象一律 error', seen, ['error', 'error', 'error', 'error']);
}

/* S20 应用 / 刷新步骤抛错 → error 且锁释放 */
async function S20_refresh_throws() {
  console.log('\n── S20 刷新步骤抛错 ──────────────────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();
  checkEqual('S20 前置：ready', page.data.dataState, 'ready');

  page.refresh = function () { throw new Error('模拟刷新炸了'); };
  page.loadRawDataset = function () { return datasetOf('r1', '刷新店', 3); };
  page.onRetry();
  await flush();

  checkEqual('S20 处理步骤抛错也收敛到 error', page.data.dataState, 'error');
  checkEqual('S20 锁已释放', page._loading, false);
  checkEqual('S20 定时器已清', page.__clock.pending(), 0);
  check('S20 原始原因（刷新）被保留', !!page._loadError && page._loadError.indexOf('刷新炸了') >= 0, page._loadError);
  check('S20 处理错误另记一份', !!page._settleError && page._settleError.indexOf('刷新炸了') >= 0, page._settleError);

  /* 再点重试还能正常恢复（refresh 已还原） */
  delete page.refresh;
  page.loadRawDataset = function () { return datasetOf('r2', '恢复店', 2); };
  page.onRetry();
  await flush();
  checkEqual('S20 重试后可恢复 ready', page.data.dataState, 'ready');
}

/* S21 error 态 setData 抛错：不递归、不产生未处理 rejection */
async function S21_setdata_throws() {
  console.log('\n── S21 失败态 setData 自己抛错 ───────────────────────');

  const page = makePage();
  page.onLoad();
  await flush();
  page.__setDataCount = 0;

  /* 只让"写 error 态"的那次 setData 抛错，模拟实例已半销毁 */
  page.setData = function (patch) {
    page.__setDataCount++;
    if (patch && patch.dataState === 'error') {
      throw new Error('setData 也被销毁了');
    }
    Object.assign(this.data, patch);
  };

  const unhandledBefore = unhandled.length;
  page.loadRawDataset = function () { throw new Error('数据源原始错误'); };
  /* onRetry 是真实入口：它不返回 Promise，所以"有没有漏 rejection"
     只能靠全局 unhandledRejection 记录器来证明 */
  const p = page.beginLoad();
  check('S21 beginLoad 返回 Promise', !!p && typeof p.then === 'function');
  let rejected = false;
  if (p && typeof p.then === 'function') {
    p.then(function () {}, function () { rejected = true; });
  }
  page.onRetry();
  await flush();
  await flush();

  check('S21 没有把异常抛给调用方', !rejected);
  checkEqual('S21 没有产生未处理 rejection', unhandled.length, unhandledBefore);
  checkEqual('S21 锁仍然释放了', page._loading, false);
  check('S21 原始加载错误没有被 setData 的错误覆盖',
    page._loadError === '数据源原始错误', page._loadError);
  check('S21 setData 的失败单独记下',
    !!page._setDataError && page._setDataError.indexOf('setData') >= 0, page._setDataError);
}

/* S22 超时后连续重试：在途请求不会无上限累积 */
async function S22_inflight_cap() {
  console.log('\n── S22 在途请求上限 ──────────────────────────────────');

  const page = makePage();
  const d1 = deferred();
  let current = d1;
  page.loadRawDataset = function () { return current.promise; };
  page.onLoad();
  await flush();
  checkEqual('S22 首个请求在途计数 = 1', page.getInflightCount(), 1);

  page.__clock.tick(page.getLoadTimeoutMs());
  await flush();
  checkEqual('S22 第一次超时进 error', page.data.dataState, 'error');
  checkEqual('S22 超时释放了加载锁', page._loading, false);
  checkEqual('S22 超时不减在途计数（请求还在跑）', page.getInflightCount(), 1);

  const d2 = deferred();
  current = d2;
  page.onRetry();
  await flush();
  checkEqual('S22 第二次请求在途计数 = 2', page.getInflightCount(), 2);

  page.__clock.tick(page.getLoadTimeoutMs());
  await flush();
  checkEqual('S22 第二次超时仍进 error', page.data.dataState, 'error');

  const seqBefore = page._loadSeq;
  page.onRetry();
  await flush();
  checkEqual('S22 第三次重试被上限挡下（没有开新轮次）', page._loadSeq, seqBefore);
  checkEqual('S22 在途计数停在 2，没有继续累积', page.getInflightCount(), 2);
  check('S22 上限就是 LOAD_INFLIGHT_MAX=2 的语义', page.getInflightCount() === 2);

  /* 底层终于结束一个：配额还回来，重试重新可用。
     恢复后换成同步 provider —— 模拟"这一轮真的拿到了好数据" */
  page.loadRawDataset = function () { return datasetOf('ok1', '恢复店', 2); };
  d1.resolve({ source: 'local', shops: [], dishes: [] });
  await flush();
  checkEqual('S22 真正结束后配额还回 1', page.getInflightCount(), 1);

  const seqBefore2 = page._loadSeq;
  page.onRetry();
  await flush();
  checkEqual('S22 配额恢复后重试能开新轮次', page._loadSeq, seqBefore2 + 1);
  checkEqual('S22 重试后回到 ready', page.data.dataState, 'ready');

  /* 收尾：把还挂着的那条也放掉，别让测试进程留活引用 */
  d2.reject(new Error('收尾'));
  await flush();
  await flush();
}

/* S23 达到上限时的用户反馈 */
async function S23_busy_feedback() {
  console.log('\n── S23 达到上限的反馈与恢复 ──────────────────────────');

  const page = makePage();
  const d1 = deferred();
  const d2 = deferred();
  let current = d1;
  page.loadRawDataset = function () { return current.promise; };
  page.onLoad();
  await flush();
  page.__clock.tick(page.getLoadTimeoutMs());
  await flush();

  current = d2;
  page.onRetry();
  await flush();
  page.__clock.tick(page.getLoadTimeoutMs());
  await flush();
  checkEqual('S23 前置：两个请求都超时、都还在途', page.getInflightCount(), 2);

  toastCalls.length = 0;
  const stateBefore = page.data.dataState;
  page.onRetry();
  await flush();
  checkEqual('S23 达到上限时给出一次 toast', toastCalls.length, 1);
  check('S23 toast 文案说明还在等待',
    !!toastCalls[0].title && toastCalls[0].title.indexOf('等待') >= 0, toastCalls[0].title);
  checkEqual('S23 提示不把页面推成 loading', page.data.dataState, stateBefore);
  checkEqual('S23 提示不动在途计数', page.getInflightCount(), 2);

  /* 可恢复：某个请求真正结束后，重试立刻可用 */
  page.loadRawDataset = function () { return datasetOf('ok3', '恢复店', 1); };
  d1.resolve({ source: 'local', shops: [], dishes: [] });
  await flush();
  const seqBefore = page._loadSeq;
  page.onRetry();
  await flush();
  checkEqual('S23 恢复后重试真的启动', page._loadSeq, seqBefore + 1);
  checkEqual('S23 恢复后状态 ready', page.data.dataState, 'ready');

  d2.reject(new Error('收尾'));
  await flush();
  await flush();
}

/* S24 旧请求迟到不覆盖新请求的数据 */
async function S24_stale_dataset() {
  console.log('\n── S24 迟到结果不覆盖新数据 ──────────────────────────');

  const page = makePage();
  const d = deferred();
  page.loadRawDataset = function () { return d.promise; };
  page.onLoad();
  await flush();

  /* 同步的新一轮把异步那轮顶掉 */
  page.loadRawDataset = function () { return datasetOf('new', '新店', 2); };
  page.beginLoad();
  await flush();
  checkEqual('S24 新请求已生效', page.raw.shops[0].id, 'new');

  /* 旧请求现在才回来 */
  d.resolve(datasetOf('old', '旧店', 99));
  await flush();
  await flush();

  checkEqual('S24 旧结果没有覆盖店铺', page.raw.shops[0].id, 'new');
  checkEqual('S24 旧结果没有覆盖菜品数', page.raw.dishes.length, 2);
  checkEqual('S24 状态仍是 ready（没被旧轮次改成 error/loading）', page.data.dataState, 'ready');
}

/* S25 卸载：计时器清理与在途状态 */
async function S25_unload_inflight() {
  console.log('\n── S25 卸载后的定时器与在途状态 ──────────────────────');

  const page = makePage(true);
  const d = deferred();
  page.loadRawDataset = function () { return d.promise; };
  page.onLoad();
  await flush();
  const setDataBefore = page.__setDataCount;
  checkEqual('S25 前置：在途 1 个', page.getInflightCount(), 1);

  page.onUnload();
  checkEqual('S25 标了卸载', page._alive, false);

  page.__clock.tick(page.getLoadTimeoutMs());
  await flush();
  checkEqual('S25 卸载后超时不 setData', page.__setDataCount, setDataBefore);
  checkEqual('S25 卸载后定时器已清', page.__clock.pending(), 0);
  checkEqual('S25 不假装请求已结束', page.getInflightCount(), 1);

  d.resolve(datasetOf('late', '迟到店', 1));
  await flush();
  await flush();
  checkEqual('S25 迟到结束时配额归还', page.getInflightCount(), 0);
  checkEqual('S25 仍然没有 setData', page.__setDataCount, setDataBefore);
}

/* S26 校验器本身：本地真实数据必须全部通过 */
async function S26_guard_on_local() {
  console.log('\n── S26 本地数据通过结构校验 ──────────────────────────');

  const guard = require(path.join(ROOT, 'utils', 'datasetGuard.js'));
  const dataIndex = require(path.join(ROOT, 'data', 'index.js'));

  const raw = { source: 'local', shops: dataIndex.ALL_SHOPS, dishes: dataIndex.ALL_DISHES };
  const res = guard.validateDataset(raw);
  check('S26 12 店 / 45 菜全部通过校验', res.ok,
    res.ok ? '' : JSON.stringify(res.errors.slice(0, 3)));

  checkEqual('S26 校验不改数据量', [dataIndex.ALL_SHOPS.length, dataIndex.ALL_DISHES.length], [12, 45]);
  checkEqual('S26 店铺 floors/stalls 原样',
    [dataIndex.ALL_SHOPS[0].id, dataIndex.ALL_SHOPS[0].stalls.length], ['s01', 3]);

  /* 明确 local 的数据照常加载，展示行为不变 */
  const page = makePage();
  page.onLoad();
  await flush();
  checkEqual('S26 local 仍是 12 家店', page.raw.shops.length, 12);
  checkEqual('S26 local 仍是 24 个窗口', totalStalls({ ALL_SHOPS: page.raw.shops }), 24);
  checkEqual('S26 local 仍是 45 道菜', page.raw.dishes.length, 45);
  checkEqual('S26 local 来源仍是 local', page.data.dataSource, 'local');

  /* 未知来源不算结构畸形（S13 的语义不能被打架） */
  const unknown = guard.validateDataset({ shops: [], dishes: [] });
  check('S26 缺 source 仍算结构合法', unknown.ok);
}

/* ================================================================
   跑
   ================================================================ */

(async function main() {
  console.log('首页加载状态机测试（pages/index/index.js）');

  await S1_initial();
  await S2_ready();
  await S3_error();
  await S4_retry();
  await S5_no_duplicate();
  await S6_stale();
  await S7_unload();
  await S8_fields_used();
  await S9_async_reject();
  await S10_timeout();
  await S11_late_arrival();
  await S12_sync_over_async();
  await S13_unknown_source();
  await S14_local_unchanged();
  await S15_unload_timeout();
  await S16_timeout_cleanup();
  await S17_shops_not_array();
  await S18_dishes_not_array();
  await S19_bad_record();
  await S20_refresh_throws();
  await S21_setdata_throws();
  await S22_inflight_cap();
  await S23_busy_feedback();
  await S24_stale_dataset();
  await S25_unload_inflight();
  await S26_guard_on_local();

  console.log('\n────────────────────────────────────────────────');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) {
    console.log('失败明细：');
    failures.forEach(function (f) { console.log('  - ' + f); });
    process.exit(1);
  }
  console.log('全部通过');
})().catch(function (e) {
  console.error('测试脚本自身异常：' + ((e && e.stack) || e));
  process.exit(1);
});
