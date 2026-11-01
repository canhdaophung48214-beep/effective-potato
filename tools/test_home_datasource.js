// tools/test_home_datasource.js
//
// 首页数据源测试（G1-c）。核心不是"能不能显示"，而是四条边界：
//   1. 云端失败 / 为空时，必须回退演示数据，并在页面上说明"_现在是演示数据_"；
//   2. 演示数据与真实数据不能混进同一个列表；
//   3. 只有真实且编号合法的菜品，才允许进入投稿目标流程；
//   4. 不重复查询、不因云端失败清空界面、不把 unverified 升级成 verified。
//
// 运行：node tools/test_home_datasource.js   （Windows / Node 24/26 均可）
const fs = require('fs');
const path = require('path');

const PROJECT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(PROJECT, rel), 'utf8');

/* ---------------------------------------------------------------- 计时器替身 */
// 页面用 setTimeout 做"云端 6 秒先回退"和"整页 8 秒兜底"。这里全部接管，
// 测试可以精确把某个毫秒级定时器"拨到点"，不用真的等。
const timers = [];
let timerId = 1;

function installTimers() {
  timers.length = 0;
  timerId = 1;
  global.setTimeout = function (fn, ms) {
    const t = { id: timerId++, fn: fn, ms: ms || 0, fired: false, cancelled: false };
    timers.push(t);
    return t.id;
  };
  global.clearTimeout = function (id) {
    const t = timers.filter((x) => x.id === id)[0];
    if (t) t.cancelled = true;
  };
}

/* 按毫秒顺序把"到点"的定时器逐个执行，跳过已取消的 */
function flushTimersUpTo(maxMs) {
  let guard = 0;
  while (guard < 60) {
    guard += 1;
    const due = timers
      .filter((t) => !t.fired && !t.cancelled && t.ms <= maxMs)
      .sort((a, b) => a.ms - b.ms)[0];
    if (!due) break;
    due.fired = true;
    due.fn();
  }
}

/* 让已经 resolve 的 Promise 链跑完（microtask 队列） */
async function drainMicrotasks(rounds) {
  const n = rounds || 8;
  for (let i = 0; i < n; i += 1) await Promise.resolve();
}

/* ---------------------------------------------------------------- 页面加载 */
// 页面模块在 require 时调用 Page({...})。这里把页面定义抓下来，再手工造实例：
// 不依赖微信运行时，也不让页面去碰真实 wx.cloud。
const captured = {};
global.Page = function (def) { Object.assign(captured, def); };
global.getApp = function () { return {}; };
global.getCurrentPages = function () { return []; };
global.wx = undefined;

installTimers();
delete require.cache[require.resolve(path.join(PROJECT, 'pages/index/index.js'))];
require(path.join(PROJECT, 'pages/index/index.js'));

function newPage() {
  const inst = {};
  Object.keys(captured).forEach((k) => {
    if (k === 'data') return;
    inst[k] = captured[k];
  });
  inst.data = JSON.parse(JSON.stringify(captured.data));

  inst.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((key) => {
      const parts = key.split('.');
      let cur = inst.data;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = patch[key];
    });
    if (typeof cb === 'function') cb();
  };
  return inst;
}

/* ---------------------------------------------------------------- 测试夹具 */
function cloudShop(overrides) {
  const base = {
    id: 'c02',
    name: '三餐',
    area: 'campus',
    building: '第三餐厅',
    location: '三餐 · 2 楼最西侧',
    floors: [{ id: 'c02_f2', label: '2 楼' }],
    stalls: [
      {
        id: 'c02_t02',
        name: '韩小面',
        floorId: 'c02_f2',
        side: 'west',
        noStatus: 'unverified',
        no: '',
        source: { kind: 'field', detail: '门头与价目表照片；方位 west 未核实' }
      }
    ]
  };
  return Object.assign(base, overrides || {});
}

function cloudDishes() {
  const names = [
    '重庆小面（素）', '杂酱面（素）', '招牌豌杂面（素）', '酸菜面（素）',
    '牛肉面（荤）', '干拌小面（素）', '干拌杂酱面（素）', '干拌豌杂面（素）',
    '清汤小面（可拼）', '清汤杂酱面（可拼）', '清汤豌杂面（可拼）', '麻酱凉面'
  ];
  const prices = [7, 9, 11, 8, 15, 7, 9, 11, 7, 9, 11, 8];
  return names.map((name, i) => ({
    id: 'c02_d' + ('00' + (60 + i)).slice(-3),
    name: name,
    price: prices[i],
    foodType: 'noodle',
    shopId: 'c02',
    stallId: 'c02_t02',
    tastes: ['spicy'],
    verifyStatus: 'unverified',
    verifiedAt: null,
    source: { kind: 'field', detail: '价目表照片' }
  }));
}

function cloudPayload() {
  return { shops: [cloudShop()], dishes: cloudDishes() };
}

/* ---------------------------------------------------------------- 断言工具 */
let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass += 1; console.log('PASS ' + name); }
  else { failures.push(name + (detail === undefined ? '' : ' —— ' + detail)); console.log('FAIL ' + name + (detail === undefined ? '' : ' —— ' + detail)); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, '实际 ' + JSON.stringify(actual) + '，期望 ' + JSON.stringify(expected));
}
function section(title) { console.log('\n--- ' + title + ' ---'); }

/* ================================================================ A 初始态 */
section('A. 初始数据状态');
{
  const page = newPage();
  eq('A1 初始 dataSource 是 unknown（还不知道能不能读到云端）', page.data.dataSource, 'unknown');
  eq('A2 初始没有回退提示', page.data.dataNoticeText, '');
  eq('A3 初始状态是 loading', page.data.dataState, 'loading');
}

/* ================================================================ B 没有云能力 */
section('B. 没有 wx.cloud 时：用演示数据并明确说明');
let localPage;
{
  localPage = newPage();
  localPage.onLoad({});
  flushTimersUpTo(20000);
  eq('B1 数据源落成 local', localPage.data.dataSource, 'local');
  eq('B2 加载状态是 ready', localPage.data.dataState, 'ready');
  ok('B3 有"当前是演示数据"的回退提示', String(localPage.data.dataNoticeText).indexOf('演示数据') >= 0, localPage.data.dataNoticeText);
  eq('B4 列表是 45 道演示菜品', localPage.matched.length, 45);
  ok('B5 演示列表里没有真实编号（c02_d060 这类）', localPage.matched.every((d) => !/^c\d{2}/.test(d.id)));
  eq('B6 演示菜品的核实文案是「演示信息」', localPage.matched[0].verifyText, '演示信息');
}

/* ================================================================ C 云端成功 */
// C 之后都要等 Promise（真实数据是异步读取的），统一放进 main() 里跑；
// 这样文件本身仍是 CommonJS，不触发 "require + top-level await" 的歧义错误。
async function main() {
section('C. 云端读取成功：显示真实数据、不混入演示数据');
async function loadWithCloud(loader) {
  const page = newPage();
  page._cloudLoader = loader;
  page.onLoad({});
  await drainMicrotasks(12);
  flushTimersUpTo(0);
  return page;
}

{
  const page = await loadWithCloud(function () { return Promise.resolve(cloudPayload()); });
  eq('C1 数据源落成 cloud', page.data.dataSource, 'cloud');
  eq('C2 列出 12 道真实菜品', page.matched.length, 12);
  ok('C3 全部是 c02_d 编号', page.matched.every((d) => /^c02_d\d{3}$/.test(d.id)));
  ok('C4 没有任何演示编号', page.matched.every((d) => !/^d\d{2}$/.test(d.id)));
  eq('C5 真实数据没有回退提示', page.data.dataNoticeText, '');
  ok('C6 状态文案按真实数据汇总（12 道待核实）', String(page.data.dataStatusText).indexOf('待核实 12 道') >= 0, page.data.dataStatusText);
  eq('C7 12 道菜都还是待核实', page.matched.filter((d) => d.verifyText === '待核实').length, 12);
}

/* ================================================================ D 云端失败回退 */
section('D. 云端失败：回退演示数据，界面不清空');
{
  const page = await loadWithCloud(function () { return Promise.reject(new Error('boom')); });
  eq('D1 数据源回退到 local', page.data.dataSource, 'local');
  eq('D2 没有变成错误态', page.data.dataState, 'ready');
  eq('D3 列表仍有 45 道演示菜品', page.matched.length, 45);
  ok('D4 明确说明"加载失败…当前展示的是演示数据"', String(page.data.dataNoticeText).indexOf('失败') >= 0 && String(page.data.dataNoticeText).indexOf('演示数据') >= 0, page.data.dataNoticeText);
  eq('D5 错误文案为空（不是错误页）', page.data.dataErrorText, '');
}

/* ================================================================ E 云端为空 */
section('E. 云端返回空数据：安全回退，不展示"零条真实数据"');
{
  const page = await loadWithCloud(function () { return Promise.resolve({ shops: [], dishes: [] }); });
  eq('E1 数据源回退到 local', page.data.dataSource, 'local');
  eq('E2 列表回到 45 道演示菜品', page.matched.length, 45);
  ok('E3 提示"云端还没有可展示的真实数据"', String(page.data.dataNoticeText).indexOf('云端') >= 0, page.data.dataNoticeText);
}

/* ================================================================ F 云端全是演示记录 */
section('F. 云端数据被适配层拒收：不得当成真实数据');
{
  const demoDish = cloudDishes()[0];
  demoDish.dataClass = 'demo';
  const page = await loadWithCloud(function () {
    return Promise.resolve({ shops: [cloudShop()], dishes: [demoDish] });
  });
  eq('F1 数据源回退到 local', page.data.dataSource, 'local');
  eq('F2 列表是演示数据 45 道', page.matched.length, 45);
  ok('F3 有回退提示', String(page.data.dataNoticeText).length > 0);
}

/* ================================================================ G 缓存与重试 */
section('G. 不重复查询：成功一次之后不再打数据库');
{
  let calls = 0;
  const page = newPage();
  page._cloudLoader = function () { calls += 1; return Promise.resolve(cloudPayload()); };
  page.onLoad({});
  await drainMicrotasks(12);
  eq('G1 首次加载只查询 1 次', calls, 1);

  const again = page.loadRawDataset();
  eq('G2 再次调用返回已缓存的数据（同步对象，不是 Promise）', typeof again.then, 'undefined');
  eq('G3 数据源仍是 cloud', again.source, 'cloud');

  page.onRetry();
  await drainMicrotasks(12);
  eq('G4 点重试也不会重新查询', calls, 1);
  eq('G5 重试后仍是 12 道真实菜品', page.matched.length, 12);
}

/* ================================================================ H 云端超时 */
section('H. 云端 6 秒不返回：先回退演示数据，而不是把整页推成错误');
{
  const page = newPage();
  page._cloudLoader = function () { return new Promise(function () { /* 永不 resolve */ }); };
  page.onLoad({});
  await drainMicrotasks(6);
  eq('H1 等待期间仍是 loading', page.data.dataState, 'loading');
  flushTimersUpTo(6000);
  await drainMicrotasks(10);
  eq('H2 6 秒后回退到 local', page.data.dataSource, 'local');
  eq('H3 状态是 ready 而不是 error', page.data.dataState, 'ready');
  eq('H4 仍有 45 道演示菜品可看', page.matched.length, 45);
  ok('H5 有回退提示', String(page.data.dataNoticeText).indexOf('演示数据') >= 0);
}

/* ================================================================ I 展示矛盾 */
section('I. 位置重复与"未核实方位"的展示修正');
{
  const adapter = require(path.join(PROJECT, 'utils/b1Adapter.js'));
  const view = adapter.normalizeAdaptedDataset(cloudPayload());
  const shop = view.ALL_SHOPS[0];
  const label = String(shop.location || '');
  eq('I1 位置里的"2 楼"只出现一次', label.split('2 楼').length - 1, 1);
  ok('I2 位置里没有"西面"（来源只写了未核实）', label.indexOf('西面') === -1, label);
  ok('I3 楼层名没有被拼两次', label.indexOf('2 楼 2 楼') === -1 && label.indexOf('2 楼 · 2 楼') === -1, label);
  eq('I4 渲染用的方位值为空（不把 west 当事实）', shop.stalls[0].side, '');
  ok('I5 修正动作留下了可追溯的备注', view.notes.some((n) => n.kind === 'side_suppressed'));
  eq('I6 真出现重复时才会去重（单次出现原样保留）', adapter.dedupeLocationText('三餐 · 2 楼 · 2 楼', ['2 楼']), '三餐 · 2 楼');
  const dupView = adapter.normalizeAdaptedDataset({
    shops: [cloudShop({ location: '三餐 · 2 楼 · 2 楼' })],
    dishes: cloudPayload().dishes
  });
  ok('I6b 去重时留下可追溯备注', dupView.notes.some((n) => n.kind === 'location_deduped'));

  const page = await loadWithCloud(function () { return Promise.resolve(cloudPayload()); });
  const pageShop = page.raw.shops[0];
  ok('I7 页面实际使用的店铺位置同样不带"西面"', String(pageShop.location).indexOf('西面') === -1, pageShop.location);

  /* 云端真实集合旁边还留着演示店铺时，不能把它算进「X 家店」 */
  const withDemo = adapter.normalizeAdaptedDataset({
    shops: [
      cloudShop(),
      Object.assign(cloudShop({ id: 's01', name: '一号食堂', location: '演示位置' }), { dataClass: 'demo' })
    ],
    dishes: cloudPayload().dishes
  });
  eq('I8 演示店铺被整店剔除（不参与"X 家店"计数）', withDemo.ALL_SHOPS.length, 1);
  ok('I8b 剔除动作可追溯', withDemo.dropped.some((d) => d.kind === 'shop' && d.id === 's01'));

  const dishLoc = String(withDemo.ALL_DISHES[0].location || '');
  eq('I9 菜品位置里"2 楼"只出现一次', dishLoc.split('2 楼').length - 1, 1);
  ok('I10 菜品位置上没有"西面"（来源只写未核实）', dishLoc.indexOf('西面') === -1, dishLoc);
  ok('I11 菜品位置清洗留痕', withDemo.notes.some((n) => n.kind === 'location_cleaned'));

  /* 云端真实写入的来源说明是长句：「方位 … 非餐厅负责人签字，照片未独立证明」 */
  const cloudWording = adapter.normalizeAdaptedDataset({
    shops: [cloudShop({
      stalls: [{
        id: 'c02_t02',
        name: '韩小面',
        floorId: 'c02_f2',
        side: 'west',
        source: {
          kind: 'field',
          detail: '2026-10-22 现场拍摄韩小面价目表；档口名与价格有照片支持；方位 west 来自项目负责人 2026-10-26 提供的现场信息，非餐厅负责人签字，照片未独立证明'
        }
      }]
    })],
    dishes: cloudPayload().dishes
  });
  eq('I12 云端长句写法同样抑制方位', cloudWording.ALL_SHOPS[0].stalls[0].side, '');
  ok('I13 抑制后菜单位置里不出现"西面"', String(cloudWording.ALL_DISHES[0].location).indexOf('西面') === -1, cloudWording.ALL_DISHES[0].location);
}

/* ================================================================ J 投稿目标 */
section('J. 只有真实且编号合法的菜品才能进投稿');
{
  const page = await loadWithCloud(function () { return Promise.resolve(cloudPayload()); });
  const adapter = require(path.join(PROJECT, 'utils/b1Adapter.js'));
  const real = page.matched.filter((d) => adapter.isRealTarget(d));
  eq('J1 12 道真实菜品全部可投稿', real.length, 12);
  ok('J2 真实菜品的三个编号都能过适配层校验', real.every((d) =>
    adapter.SHOP_ID_RE.test(d.shopId) && adapter.STALL_ID_RE.test(d.stallId) && adapter.DISH_ID_RE.test(d.id)));

  const demo = { id: 'd05', shopId: 's01', stallId: 's01_t2' };
  ok('J3 演示编号不能进投稿', adapter.isRealTarget(demo) === false);
  ok('J4 演示列表里没有任何一条能进投稿', localPage.matched.every((d) => adapter.isRealTarget(d) === false));
}

/* ================================================================ K 可信度不升级 */
section('K. 真实数据仍保持待核实（不因"来自云端"就升级）');
{
  const page = await loadWithCloud(function () { return Promise.resolve(cloudPayload()); });
  const dish = page.matched[0];
  eq('K1 verifyStatus 仍是 unverified', dish.verifyStatus, 'unverified');
  eq('K2 verifyText 仍是待核实', dish.verifyText, '待核实');
  ok('K3 没有任何菜品被标成已核实', page.matched.every((d) => d.verifyText !== '已核实'));
}

/* ================================================================ L 静态边界 */
section('L. 静态边界：首页只读、不写、不上传');
{
  const src = read('pages/index/index.js');
  ok('L1 使用统一的云端只读入口 loadCloudDataset', src.indexOf('loadCloudDataset') >= 0);
  ok('L2 没有直接写数据库（add/update/remove/set）', !/\.(add|update|remove|set)\s*\(/.test(src.replace(/setData\s*\(/g, '')));
  ok('L3 没有 writeFile / setStorage', src.indexOf('writeFile') === -1 && src.indexOf('setStorage') === -1);
  ok('L4 没有 wx.request', src.indexOf('wx.request') === -1);
  ok('L5 没有硬编码密钥', !/appsecret|access_token|secretKey/i.test(src));

  const wxml = read('pages/index/index.wxml');
  ok('L6 横幅按 cloud / local / 未知三分支', wxml.indexOf("dataSource === 'cloud'") >= 0 && wxml.indexOf("dataSource === 'local'") >= 0);
  ok('L7 回退提示有独立展示位', wxml.indexOf('dataNoticeText') >= 0);
  ok('L8 真实数据横幅带"待核实"字样', wxml.indexOf('全部待核实') >= 0);

  const wxss = read('pages/index/index.wxss');
  ok('L9 真实数据有独立样式类', wxss.indexOf('.demo-badge-real') >= 0);
}

}

/* ---------------------------------------------------------------- 汇总 */
main().then(function () {
  console.log('\n=== 汇总 ===');
  console.log('PASS ' + pass + ' / FAIL ' + failures.length + ' / TOTAL ' + (pass + failures.length));
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exitCode = failures.length ? 1 : 0;
}).catch(function (err) {
  console.error('测试自身异常：' + (err && err.stack ? err.stack : err));
  process.exitCode = 2;
});
