/**
 * test_seed_pilot.js —— cloudfunctions/seed 的「真实批次」（S2）离线测试
 *
 * 目的：用**内存假数据库**驱动真实入口 exports.main，锁死六件事
 *   1. 演示批次行为一字不变（写 8 条 demo、幂等、verify、cleanup）
 *   2. 真实批次只能写 c02 白名单那 14 条，元数据必须是
 *      dataClass=field_unverified / verifyStatus=unverified / verifiedAt=null / source.kind=field
 *   3. 两套批次互不串：demo 批次不写 c02，真实批次不写 s01*；demo cleanup 删不掉真实记录
 *   4. 错误/未知批次一律拒绝，且拒绝发生在任何写入之前
 *   5. 回滚必须先预览（rollbackPlan），执行时再复核一遍
 *   6. 记录被改过 / 批次不符 / 存在额外关联 / 批次不完整 → 整批停止，一条都不删
 *
 * 不连云端、不写云库：database() 全部替换为内存实现。
 * 用法：node tools/test_seed_pilot.js    退出码 0 = 全过，1 = 有失败
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

/* ================================================================
   内存假数据库
   ================================================================ */
const store = new Map();     /* collection -> Map(id -> doc) */
const dbCalls = [];

function resetDb() {
  store.clear();
  dbCalls.length = 0;
}

function coll(name) {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function makeDb() {
  function guard(op, extra) {
    dbCalls.push(Object.assign({ op: op }, extra || {}));
  }

  function chain(name) {
    return {
      doc: function (id) {
        guard('doc', { collection: name, id: id });
        return {
          get: function () {
            guard('get', { collection: name, id: id });
            const d = coll(name).get(id);
            if (!d) {
              const err = new Error('document not exist');
              err.errCode = -502005;
              return Promise.reject(err);
            }
            return Promise.resolve({ data: clone(d) });
          },
          remove: function () {
            guard('remove', { collection: name, id: id });
            coll(name).delete(id);
            return Promise.resolve({ stats: { removed: 1 } });
          }
        };
      },
      add: function (arg) {
        const doc = arg && arg.data ? arg.data : {};
        guard('add', { collection: name, id: doc._id });
        coll(name).set(doc._id, clone(doc));
        return Promise.resolve({ _id: doc._id });
      },
      where: function (cond) {
        guard('where', { collection: name, cond: cond });
        return {
          count: function () {
            guard('count', { collection: name, cond: cond });
            let n = 0;
            const keys = Object.keys(cond || {});
            coll(name).forEach(function (d) {
              const hit = keys.every(function (k) { return d[k] === cond[k]; });
              if (hit) n++;
            });
            return Promise.resolve({ total: n });
          }
        };
      }
    };
  }

  return {
    collection: function (name) {
      guard('collection', { collection: name });
      return chain(name);
    },
    createCollection: function (name) {
      guard('createCollection', { collection: name });
      coll(name);
      return Promise.resolve({});
    },
    serverDate: function () { return new Date(0); }
  };
}

function loadSeed() {
  const src = fs.readFileSync(SEED_FILE, 'utf8');
  const fakeCloud = {
    init: function () {},
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    getWXContext: function () { return ctx.current; },
    database: function () { return makeDb(); }
  };
  const module = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  fn(module.exports, function (id) {
    if (id === 'wx-server-sdk') return fakeCloud;
    /* 相对路径要按 seed 目录解析（seed 现在 require './pilot-data'） */
    if (id.charAt(0) === '.') return require(path.resolve(path.dirname(SEED_FILE), id));
    return require(id);
  }, module, SEED_FILE, path.dirname(SEED_FILE));
  return { api: module.exports, src: src };
}

const ctx = { current: {} };
const loaded = loadSeed();
const api = loaded.api;
const T = api.__test__ || {};
const SRC = loaded.src;
const main = api.main;

const DEMO_BATCH = 'seed-s01-20261022';
const PILOT_BATCH = 'pilot_c02_batch1_20261022';
const FAKE_ADMIN = 'fake_admin_pilot_001';
const FAKE_OTHER = 'fake_other_pilot_999';

const DEMO_IDS = ['s01', 's01_t1', 's01_t2', 's01_t3', 'd01', 'd02', 'd03', 'd39'];
const PILOT_IDS = ['c02', 'c02_t02']
  .concat(T.PILOT_DISHES.map(function (d) { return d._id; }));
const PILOT_DISH_IDS = T.PILOT_DISHES.map(function (d) { return d._id; });

const ORIGINAL_ENV = process.env.ADMIN_OPENIDS;

function asAdmin() {
  process.env.ADMIN_OPENIDS = FAKE_ADMIN;
  ctx.current = { OPENID: FAKE_ADMIN, ENV: 'test-env' };
}

async function call(event) {
  asAdmin();
  return await main(event);
}

/* 取某集合里的全部 id（按 id 排序，便于断言） */
function idsOf(collection) {
  const map = store.get(collection);
  const out = [];
  if (map) map.forEach(function (d, id) { out.push(id); });
  return out.sort();
}

function docOf(collection, id) {
  const map = store.get(collection);
  return map ? map.get(id) : undefined;
}

/* ================================================================
   A. 演示批次：行为必须与 S2 之前完全一致
   ================================================================ */
async function runA() {
  resetDb();

  const plan0 = await call({ action: 'plan', batchId: DEMO_BATCH });
  ok('A1 空库 plan 应成功', plan0.ok === true, JSON.stringify(plan0).slice(0, 200));
  eq('A2 空库 plan 报 8 条待创建', plan0.creates.slice().sort(), DEMO_IDS.slice().sort());
  eq('A3 plan 的 dataset 是 demo', plan0.dataset, 'demo');
  ok('A4 plan 不写库', idsOf('restaurants').length === 0 && idsOf('dishes').length === 0);

  const w0 = await call({ action: 'write', batchId: DEMO_BATCH });
  ok('A5 演示批次写入成功', w0.ok === true, JSON.stringify(w0.failed));
  eq('A6 写入 8 条', w0.done.slice().sort(), DEMO_IDS.slice().sort());
  eq('A7 三个集合条数 1/3/4',
    [idsOf('restaurants').length, idsOf('stalls').length, idsOf('dishes').length], [1, 3, 4]);

  const d01 = docOf('dishes', 'd01');
  eq('A8 演示记录 dataClass=demo', d01.dataClass, 'demo');
  eq('A9 演示记录 verifyStatus=demo', d01.verifyStatus, 'demo');
  eq('A10 演示记录 verifiedAt=null', d01.verifiedAt, null);
  eq('A11 演示记录 source.kind=demo', d01.source && d01.source.kind, 'demo');
  eq('A12 演示记录 batchId 是演示批次', d01.batchId, DEMO_BATCH);

  const plan1 = await call({ action: 'plan', batchId: DEMO_BATCH });
  eq('A13 重复 plan 全部 identical', plan1.identical.slice().sort(), DEMO_IDS.slice().sort());

  const w1 = await call({ action: 'write', batchId: DEMO_BATCH });
  eq('A14 重复写入全部 skipped（幂等）', w1.done.slice().sort(), DEMO_IDS.slice().sort());
  ok('A15 重复写入没有新增', idsOf('dishes').length === 4);

  const v = await call({ action: 'verify', batchId: DEMO_BATCH });
  ok('A16 演示批次 verify 通过', v.ok === true, JSON.stringify(v.diffs).slice(0, 300));
  ok('A17 verify 检查 8 条', v.checked === 8, '实际 ' + v.checked);
  eq('A18 verify.summary.dataset=demo', v.summary.dataset, 'demo');
  eq('A19 verify.summary.offClassCount=0', v.summary.offClassCount, 0);

  const c = await call({ action: 'cleanup', batchId: DEMO_BATCH });
  ok('A20 演示 cleanup 成功', c.ok === true, JSON.stringify(c.failed));
  eq('A21 cleanup 删掉 8 条', c.deleted.slice().sort(), DEMO_IDS.slice().sort());
  eq('A22 cleanup 后无残留', c.remainingCount, 0);
}

/* ================================================================
   B. 真实批次写入：白名单 + 元数据
   ================================================================ */
async function runB() {
  resetDb();

  const plan0 = await call({ action: 'plan', batchId: PILOT_BATCH });
  ok('B1 真实批次 plan 成功', plan0.ok === true, JSON.stringify(plan0).slice(0, 200));
  eq('B2 plan 报 14 条待创建', plan0.creates.slice().sort(), PILOT_IDS.slice().sort());
  eq('B3 plan 的 dataset 是 pilot', plan0.dataset, 'pilot');
  ok('B4 plan 不写库', idsOf('dishes').length === 0);

  const w = await call({ action: 'write', batchId: PILOT_BATCH });
  ok('B5 真实批次写入成功', w.ok === true, JSON.stringify(w.failed));
  eq('B6 写入 14 条', w.done.slice().sort(), PILOT_IDS.slice().sort());
  eq('B7 三集合条数 1/1/12',
    [idsOf('restaurants').length, idsOf('stalls').length, idsOf('dishes').length], [1, 1, 12]);
  eq('B8 没有写进任何演示 id', idsOf('restaurants').indexOf('s01'), -1);

  const shop = docOf('restaurants', 'c02');
  eq('B9 店铺 dataClass=field_unverified', shop.dataClass, 'field_unverified');
  eq('B10 店铺 verifyStatus=unverified', shop.verifyStatus, 'unverified');
  eq('B11 店铺 verifiedAt=null', shop.verifiedAt, null);
  eq('B12 店铺 source.kind=field', shop.source && shop.source.kind, 'field');
  eq('B13 店铺 batchId 是本批次', shop.batchId, PILOT_BATCH);

  const dish = docOf('dishes', 'c02_d060');
  eq('B14 菜品 dataClass=field_unverified', dish.dataClass, 'field_unverified');
  eq('B15 菜品 verifiedAt=null', dish.verifiedAt, null);
  eq('B16 菜品 tastes 单值', dish.tastes, ['spicy']);
  eq('B17 菜品 price 是数字', typeof dish.price, 'number');
  eq('B18 菜品 stallId 指向本窗口', dish.stallId, 'c02_t02');

  const choiceDish = docOf('dishes', 'c02_d068');
  eq('B19 choice 味值被接受', choiceDish.tastes, ['choice']);
  eq('B19b 杂酱面辣度为香辣', docOf('dishes', 'c02_d061').tastes, ['spicy']);

  const w2 = await call({ action: 'write', batchId: PILOT_BATCH });
  eq('B20 重复写入全部 skipped（幂等）', w2.done.slice().sort(), PILOT_IDS.slice().sort());
  ok('B21 重复写入没有新增', idsOf('dishes').length === 12);

  const plan1 = await call({ action: 'plan', batchId: PILOT_BATCH });
  eq('B22 重复 plan 全部 identical', plan1.identical.slice().sort(), PILOT_IDS.slice().sort());

  const v = await call({ action: 'verify', batchId: PILOT_BATCH });
  ok('B23 真实批次 verify 通过', v.ok === true, JSON.stringify(v.diffs).slice(0, 400));
  ok('B24 verify 检查 14 条', v.checked === 14, '实际 ' + v.checked);
  eq('B25 verify.summary.dataset=pilot', v.summary.dataset, 'pilot');
  eq('B26 verify.summary.expectedDataClass', v.summary.expectedDataClass, 'field_unverified');
  eq('B27 verify.summary.offClassCount=0', v.summary.offClassCount, 0);
  eq('B28 verify 统计 1 店/1 窗/12 菜',
    [v.summary.restaurants, v.summary.stalls, v.summary.dishes], [1, 1, 12]);
}

/* ================================================================
   C. 两套批次互不串
   ================================================================ */
async function runC() {
  /* C1：只有真实记录时，demo cleanup 一条也不能删 */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const before = idsOf('dishes').length;

  const c = await call({ action: 'cleanup', batchId: DEMO_BATCH });
  eq('C1 demo cleanup 一条都没删', c.deleted, []);
  ok('C2 demo cleanup 未触碰真实记录', idsOf('dishes').length === before,
    '改前 ' + before + ' 改后 ' + idsOf('dishes').length);
  ok('C3 真实记录仍带 field_unverified',
    docOf('dishes', 'c02_d060').dataClass === 'field_unverified');

  /* C4：cleanup 不接受真实批次 */
  const c2 = await call({ action: 'cleanup', batchId: PILOT_BATCH });
  ok('C4 cleanup 拒绝真实批次', c2.ok === false && /rollback/.test(String(c2.message)),
    JSON.stringify(c2).slice(0, 200));
  ok('C5 被拒后记录仍在', idsOf('dishes').length === before);

  /* C6：真实批次不写演示 id */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  eq('C6 真实批次库里没有 s01', idsOf('restaurants').indexOf('s01'), -1);

  /* C7：演示批次不写 c02 */
  resetDb();
  await call({ action: 'write', batchId: DEMO_BATCH });
  eq('C7 演示批次库里没有 c02', idsOf('restaurants').indexOf('c02'), -1);
}

/* ================================================================
   D. 错误 / 未知批次一律拒绝，且拒绝发生在写入之前
   ================================================================ */
async function runD() {
  resetDb();

  const wrongPilot = 'pilot_c02_batch1_20261023';   /* 格式合法但不是本批次 */
  const p1 = await call({ action: 'plan', batchId: wrongPilot });
  ok('D1 未知真实批次 plan 被拒', p1.ok === false && /未知批次/.test(String(p1.message)),
    JSON.stringify(p1).slice(0, 200));

  const w1 = await call({ action: 'write', batchId: wrongPilot });
  ok('D2 未知真实批次 write 被拒', w1.ok === false && /未知批次/.test(String(w1.message)));
  eq('D3 被拒时一条都没写', idsOf('dishes').length + idsOf('restaurants').length, 0);

  const bad = ['', 'seed-', 'pilot_', 'drop-all', 'seed-s01-2026'];
  let rejected = 0;
  for (let i = 0; i < bad.length; i++) {
    const r = await call({ action: 'write', batchId: bad[i] });
    if (r.ok === false && /batchId 不合法/.test(String(r.message))) rejected++;
  }
  eq('D4 五种非法批次号全部被格式校验拦下', rejected, bad.length);

  const rb = await call({ action: 'rollbackPlan', batchId: DEMO_BATCH });
  ok('D5 rollbackPlan 拒绝演示批次', rb.ok === false && /未知批次/.test(String(rb.message)));
  const rb2 = await call({ action: 'rollback', batchId: DEMO_BATCH });
  ok('D6 rollback 拒绝演示批次', rb2.ok === false && /未知批次/.test(String(rb2.message)));
}

/* ================================================================
   E. 鉴权：真实批次的删除入口同样受闸门保护
   ================================================================ */
async function runE() {
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const before = idsOf('dishes').length;

  /* 未配置 ADMIN_OPENIDS */
  delete process.env.ADMIN_OPENIDS;
  ctx.current = { OPENID: FAKE_ADMIN, ENV: 'test-env' };
  const r1 = await main({ action: 'rollback', batchId: PILOT_BATCH });
  ok('E1 未配置白名单时 rollback 被拒', r1.code === 'FORBIDDEN', JSON.stringify(r1).slice(0, 160));
  ok('E2 被拒时零删除', idsOf('dishes').length === before);

  /* 非管理员 */
  process.env.ADMIN_OPENIDS = FAKE_ADMIN;
  ctx.current = { OPENID: FAKE_OTHER, ENV: 'test-env' };
  const r2 = await main({ action: 'rollback', batchId: PILOT_BATCH });
  ok('E3 非管理员 rollback 被拒', r2.code === 'FORBIDDEN' && r2.reason === 'NOT_ADMIN');
  ok('E4 被拒时零删除（第二次）', idsOf('dishes').length === before);

  asAdmin();
}

/* ================================================================
   F. 回滚预览 → 执行 → 再执行
   ================================================================ */
async function runF() {
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });

  const plan = await call({ action: 'rollbackPlan', batchId: PILOT_BATCH });
  ok('F1 回滚预览成功', plan.ok === true, JSON.stringify(plan.blockers).slice(0, 300));
  eq('F2 预览列出 14 条待删', plan.wouldDelete.slice().sort(), PILOT_IDS.slice().sort());
  eq('F3 预览没有缺失', plan.missing, []);
  eq('F4 预览没有阻断', plan.blockers, []);
  ok('F5 预览不删任何东西',
    idsOf('dishes').length === 12 && idsOf('stalls').length === 1 && idsOf('restaurants').length === 1);

  const rb = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('F6 回滚执行成功', rb.ok === true, JSON.stringify(rb.failed).slice(0, 300));
  eq('F7 删掉 14 条', rb.deleted.slice().sort(), PILOT_IDS.slice().sort());
  eq('F8 删后核验 remaining=0', rb.remainingCount, 0);
  eq('F9 三集合清空',
    [idsOf('restaurants').length, idsOf('stalls').length, idsOf('dishes').length], [0, 0, 0]);

  const rb2 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  /* S2.1 起：全部已不存在 ≠ 失败，但也绝不能报「删掉了 N 条」 */
  ok('F10 二次回滚标记为 no-op（不谎报删除）', rb2.noop === true && rb2.ok === true,
    JSON.stringify({ ok: rb2.ok, noop: rb2.noop, message: rb2.message }).slice(0, 200));
  eq('F11 二次回滚删除 0 条', rb2.deleted, []);
  eq('F12 二次回滚把 14 条都记为缺席', rb2.absent.slice().sort(), PILOT_IDS.slice().sort());
  ok('F12b 二次回滚有明确提示', /已经全部不存在/.test(String(rb2.message)), JSON.stringify(rb2.message));
}

/* ================================================================
   G. 冲突场景必须整批停止（一条都不删）
   ================================================================ */
async function runG() {
  /* G-1 记录被改过（price 变了 → contentHash 不一致） */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const tampered = docOf('dishes', 'c02_d063');
  tampered.price = 999;
  store.get('dishes').set('c02_d063', tampered);

  const p1 = await call({ action: 'rollbackPlan', batchId: PILOT_BATCH });
  ok('G1 记录被改过 → 预览报阻断', p1.ok === false && p1.blockers.length === 1,
    JSON.stringify(p1.blockers).slice(0, 300));
  eq('G2 预览不给待删清单', p1.wouldDelete, []);
  ok('G3 阻断原因点名 contentHash',
    /contentHash/.test(JSON.stringify(p1.blockers)), JSON.stringify(p1.blockers).slice(0, 200));

  const r1 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G4 记录被改过 → 回滚拒绝执行', r1.ok === false && /未通过/.test(String(r1.message)),
    JSON.stringify(r1).slice(0, 200));
  eq('G5 一条都没删', r1.deleted, []);
  ok('G6 14 条记录仍在', idsOf('dishes').length === 12 &&
    idsOf('stalls').length === 1 && idsOf('restaurants').length === 1);

  /* G-2 batchId 被改成别的 */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const moved = docOf('dishes', 'c02_d064');
  moved.batchId = 'pilot_c02_batch1_20261023';
  store.get('dishes').set('c02_d064', moved);
  const r2 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G7 batchId 不符 → 回滚拒绝执行', r2.ok === false);
  ok('G8 阻断原因点名 batchId', /batchId/.test(JSON.stringify(r2.blockers)));
  eq('G9 一条都没删（batchId 场景）', r2.deleted, []);

  /* G-3 dataClass 被改成 demo（不是我们写的分类） */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const wrongClass = docOf('dishes', 'c02_d065');
  wrongClass.dataClass = 'demo';
  store.get('dishes').set('c02_d065', wrongClass);
  const r3 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G10 dataClass 不符 → 回滚拒绝执行', r3.ok === false);
  ok('G11 阻断原因点名 dataClass', /dataClass/.test(JSON.stringify(r3.blockers)));
  eq('G12 一条都没删（dataClass 场景）', r3.deleted, []);

  /* G-4 缺少一条（批次不完整）
     S2.1 起语义变更：缺席不再阻断（缺席的记录删不了别人的数据），
     但只删「仍然存在且六项全对」的那些，并且缺席要如实记进 absent 而不是 deleted。 */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  store.get('dishes').delete('c02_d066');
  const r4 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G13 缺席不阻断 → 回滚可以继续（可续做）', r4.ok === true, JSON.stringify(r4.blockers).slice(0, 300));
  eq('G14 缺席那条被记为 absent', r4.absent, ['c02_d066']);
  eq('G14b 缺席那条不进 deleted', r4.deleted.indexOf('c02_d066'), -1);
  eq('G15 只删剩下的 13 条', r4.deleted.length, 13);
  eq('G16 删后三集合清空', [idsOf('restaurants').length, idsOf('stalls').length, idsOf('dishes').length], [0, 0, 0]);
  const r4b = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G16b 再跑一次是 no-op（不谎报删除）', r4b.noop === true && r4b.deleted.length === 0);

  /* G-5 额外关联：同一窗口下多出一条不在白名单的菜 */
  resetDb();
  await call({ action: 'write', batchId: PILOT_BATCH });
  const extra = clone(docOf('dishes', 'c02_d067'));
  extra._id = 'c02_d999';
  extra.name = '别人加的菜';
  store.get('dishes').set('c02_d999', extra);
  const r5 = await call({ action: 'rollback', batchId: PILOT_BATCH });
  ok('G17 存在额外关联 → 回滚拒绝执行', r5.ok === false,
    JSON.stringify(r5.blockers).slice(0, 300));
  ok('G18 阻断原因点名窗口/店铺菜品数',
    /窗口下菜品数|店铺下菜品数/.test(JSON.stringify(r5.blockers)),
    JSON.stringify(r5.blockers).slice(0, 300));
  eq('G19 一条都没删（额外关联场景）', r5.deleted, []);
  ok('G20 那条外来记录也还在', idsOf('dishes').indexOf('c02_d999') !== -1);
}

/* ================================================================
   H. 静态约束未被削弱
   ================================================================ */
function runH() {
  ok('H1 仍然没有 where().remove()', !/\.where\s*\([^)]*\)\s*\.remove\s*\(/.test(SRC));
  ok('H2 仍然不把入参当集合名', !/event\s*\.\s*collection/.test(SRC));
  ok('H3 demo cleanup 的 dataClass 锁仍在',
    /dataClass\s*!==\s*'demo'\s*\|\|\s*existing\.batchId\s*!==\s*batchId/.test(SRC));
  ok('H4 删除只走 doc(_id).remove()',
    /\.doc\(\s*item\.id\s*\)\.remove\(\)/.test(SRC) && /\.doc\(\s*id\s*\)\.remove\(\)/.test(SRC));
  ok('H5 闸门仍在 action 白名单之前',
    SRC.indexOf('checkAdmin(wx.OPENID)') < SRC.indexOf('actions.indexOf(action)'));
  eq('H6 真实批次白名单是 14 条', PILOT_IDS.length, 14);
  eq('H7 真实批次不含任何演示 id',
    PILOT_IDS.filter(function (id) { return DEMO_IDS.indexOf(id) !== -1; }), []);
  eq('H8 演示白名单仍是 8 条',
    DEMO_IDS.filter(function (id) { return id.length > 0; }).length, 8);
  ok('H9 PILOT 批次号常量未被改写', T.PILOT_BATCH_ID === PILOT_BATCH);
  eq('H10 TASTE 枚举含 choice', T.PILOT_DISHES.some(function (d) {
    return d.tastes[0] === 'choice';
  }), true);
  ok('H11 datasetFor 对未知批次返回 null',
    T.datasetFor('pilot_c02_batch1_20261023') === null &&
    T.datasetFor(DEMO_BATCH) !== null &&
    T.datasetFor(PILOT_BATCH) !== null);
}

/* ================================================================
   I. P4：真实批次缺证据时整批拒写（stub 注入缺证据副本）
   ================================================================ */

function loadSeedWith(pilotStub) {
  const src = fs.readFileSync(SEED_FILE, 'utf8');
  const fakeCloud = {
    init: function () {},
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    getWXContext: function () { return ctx.current; },
    database: function () { return makeDb(); }
  };
  const module = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  fn(module.exports, function (id) {
    if (id === 'wx-server-sdk') return fakeCloud;
    if (id === './pilot-data') return pilotStub;
    if (id.charAt(0) === '.') return require(path.resolve(path.dirname(SEED_FILE), id));
    return require(id);
  }, module, SEED_FILE, path.dirname(SEED_FILE));
  return module.exports;
}

async function runI() {
  const clone = function (v) { return JSON.parse(JSON.stringify(v)); };

  /* I1–I3：纯函数层 */
  const dsReal = { key: 'pilot', restaurants: T.PILOT_RESTAURANTS, stalls: T.PILOT_STALLS, dishes: T.PILOT_DISHES };
  eq('I1 真实 pilot 数据集没有缺证据项', T.pilotEvidenceProblems(dsReal), []);

  const dsBad = clone(dsReal);
  dsBad.dishes[0].source.detail = '';
  const probs = T.pilotEvidenceProblems(dsBad);
  eq('I2 缺 detail 的菜品被点名 1 条', probs.length, 1);
  ok('I3 点名的就是缺证据那条菜', String(probs[0].id) === 'c02_d060' || String(probs[0].id) === 'c02_d071');
  ok('I4 阻止项写明集合与原因', String(probs[0].collection).indexOf('dishes') !== -1 &&
    String(probs[0].reasons.join(',')).indexOf('缺 source_detail') !== -1);

  /* I5–I8：行为层 —— 用缺证据副本替换 pilot-data，走真实 main */
  const pilotFile = path.join(path.dirname(SEED_FILE), 'pilot-data.js');
  const stub = clone(require(pilotFile));
  stub.DISHES[0].source.detail = '';
  const stubApi = loadSeedWith(stub);

  resetDb();
  process.env.ADMIN_OPENIDS = FAKE_ADMIN;
  ctx.current = { OPENID: FAKE_ADMIN, ENV: 'test-env' };

  const writePlan = await stubApi.main({ action: 'write', batchId: PILOT_BATCH });
  ok('I5 缺证据时 write 失败', writePlan.ok === false);
  ok('I6 失败原因写明整批拒写', String(writePlan.message).indexOf('拒写') !== -1);
  eq('I7 记录下被阻止的条目', (writePlan.blockers || []).length, 1);
  eq('I8 拒写后一条文档都没写', idsOf('restaurants').concat(idsOf('stalls'), idsOf('dishes')).length, 0);

  /* I9：证据齐全的真实数据仍可写（回归保护） */
  resetDb();
  const okPlan = await call({ action: 'write', batchId: PILOT_BATCH });
  ok('I9 证据齐全时 write 仍成功', okPlan.ok === true, JSON.stringify(okPlan).slice(0, 200));
  eq('I10 真实批次仍写 14 条', idsOf('restaurants').concat(idsOf('stalls'), idsOf('dishes')).length, 14);
}

/* ================================================================
   汇总
   ================================================================ */
(async function () {
  try {
    await runA();
    await runB();
    await runC();
    await runD();
    await runE();
    await runF();
    await runG();
    runH();
    await runI();
  } finally {
    if (ORIGINAL_ENV === undefined) delete process.env.ADMIN_OPENIDS;
    else process.env.ADMIN_OPENIDS = ORIGINAL_ENV;
  }

  console.log('==== test_seed_pilot 结果 ====');
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
})();
