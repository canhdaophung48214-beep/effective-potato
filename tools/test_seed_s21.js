#!/usr/bin/env node
/**
 * test_seed_s21.js —— S2.1 专项：N1/N2/N3/N4/N5 的回归锁
 * ================================================================
 * 这一组测试只锁「S2.1 修掉的那几个问题别再回来」：
 *   N1 云端批次常量必须由采集 CSV 生成，不允许另有一套口径
 *   N2 回滚没有事务 —— 静态锁住这个事实，并要求文件头如实声明
 *   N3 部分删除后可以续做，但「存在的记录被改过」仍然整批阻断
 *   N4 remove() 返回 0 时记为 already-absent，不得计入 deleted
 *   N5 source 逐条跟着 CSV 走，不再统一写一句文案
 *
 * 全部在内存假 DB 上跑，不连云端、不写云库、不碰 data/ 与 pages/。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'cloudfunctions', 'seed', 'index.js');
const PILOT_DATA_FILE = path.join(ROOT, 'cloudfunctions', 'seed', 'pilot-data.js');
const PILOT_DIR = path.join(ROOT, 'tools', 'pilot', 'batch1_min');

const builder = require(path.join(__dirname, 'pilot', 'build_pilot_dataset.js'));

let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  console.log('  FAIL  ' + name + (extra ? ' —— ' + extra : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, '期望 ' + e + '，实际 ' + a);
}

/* ---------------- 假 DB（可控 remove 行为） ---------------- */
function makeDb() {
  const state = { removeMode: 'normal', store: new Map() };
  function coll(name) {
    if (!state.store.has(name)) state.store.set(name, new Map());
    const map = state.store.get(name);
    return {
      count: async function () { return { total: map.size }; },
      add: async function (arg) {
        const doc = Object.assign({ _id: arg.data._id }, arg.data);
        map.set(doc._id, doc);
        return { _id: doc._id };
      },
      doc: function (id) {
        return {
          get: async function () {
            if (!map.has(id)) { const e = new Error('document does not exist'); e.errCode = -1; throw e; }
            return { data: map.get(id) };
          },
          set: async function (arg) {
            map.set(id, Object.assign({ _id: id }, arg.data));
            return {};
          },
          remove: async function () {
            if (state.removeMode === 'ghost') return { stats: { removed: 0 } };
            const had = map.has(id);
            if (had) map.delete(id);
            return { stats: { removed: had ? 1 : 0 } };
          }
        };
      },
      where: function () { return { count: async function () { return { total: map.size }; } }; }
    };
  }
  return {
    state: state,
    reset: function () {
      state.store.clear();
      state.removeMode = 'normal';
    },
    collection: coll,
    createCollection: async function () { return {}; },
    serverDate: function () { return new Date(0); }
  };
}

const db = makeDb();
const ctx = { current: { OPENID: 'fake_admin_001', ENV: 'test-env' } };

function loadSeed() {
  const src = fs.readFileSync(SEED_FILE, 'utf8');
  const fakeCloud = {
    init: function () {},
    DYNAMIC_CURRENT_ENV: 'DYNAMIC_CURRENT_ENV',
    getWXContext: function () { return ctx.current; },
    database: function () { return db; }
  };
  const m = { exports: {} };
  const fn = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
  fn(m.exports, function (id) {
    if (id === 'wx-server-sdk') return fakeCloud;
    if (id.charAt(0) === '.') return require(path.resolve(path.dirname(SEED_FILE), id));
    return require(id);
  }, m, SEED_FILE, path.dirname(SEED_FILE));
  return { api: m.exports, src: src };
}

process.env.ADMIN_OPENIDS = 'fake_admin_001';
const loaded = loadSeed();
const api = loaded.api;
const T = api.__test__;
const BATCH = T.PILOT_BATCH_ID;

/* 把 CSV 重新解析一遍，作为「真源」 */
const fromCsv = builder.build(PILOT_DIR);

function strip(row) {
  const out = Object.assign({}, row);
  delete out.__row;
  if (Array.isArray(out.floors)) out.floors = out.floors.map(strip);
  return out;
}

/* ================================================================
   N1：云端批次常量必须等于从 CSV 生成的结果
   ================================================================ */
function runN1() {
  const mod = require(PILOT_DATA_FILE);
  eq('N1-1 pilot-data.BATCH_ID 与 CSV 目录约定一致', mod.BATCH_ID, BATCH);
  eq('N1-2 pilot-data 店铺 == CSV', mod.RESTAURANTS.map(strip), fromCsv.restaurants.map(strip));
  eq('N1-3 pilot-data 窗口 == CSV', mod.STALLS.map(strip), fromCsv.stalls.map(strip));
  eq('N1-4 pilot-data 菜品 == CSV', mod.DISHES.map(strip), fromCsv.dishes.map(strip));

  eq('N1-5 seed 里的 PILOT_DISHES 与 CSV 同名同价同口味',
    T.PILOT_DISHES.map(function (d) { return [d._id, d.name, d.price, d.foodType, d.tastes[0]]; }),
    fromCsv.dishes.map(function (d) { return [d._id, d.name, d.price, d.foodType, d.tastes[0]]; }));

  eq('N8 pilot-data 保留 __row 供溯源（SHEET 用），seed 载入后剥离',
    mod.DISHES.every(function (d) { return typeof d.__row === 'number' && d.__row > 0; }), true);
  ok('N1-7 seed 载入后也不带 __row',
    JSON.stringify(T.PILOT_DISHES).indexOf('__row') === -1);

  /* 反向证明：如果以后有人手改 pilot-data.js，这条会立刻红 */
  const rendered = builder.renderModule(fromCsv);
  ok('N1-8 pilot-data.js 可由生成器逐字节重现（除生成时间戳）',
    rendered.replace(/生成时间：.*/, '') === fs.readFileSync(PILOT_DATA_FILE, 'utf8').replace(/生成时间：.*/, ''));
}

/* ================================================================
   N5：source 逐条跟着 CSV 走
   ================================================================ */
function runN5() {
  eq('N5-1 菜品 source 逐条等于 CSV',
    T.PILOT_DISHES.map(function (d) { return T.pilotMeta(d).source; }),
    fromCsv.dishes.map(function (d) { return d.source; }));

  eq('N5-2 店铺 source 等于 CSV',
    T.pilotMeta(T.PILOT_RESTAURANTS[0]).source,
    fromCsv.restaurants[0].source);

  eq('N5-3 窗口 source 等于 CSV',
    T.pilotMeta(T.PILOT_STALLS[0]).source,
    fromCsv.stalls[0].source);

  const meta = T.pilotMeta(T.PILOT_DISHES[0]);
  eq('N5-4 真实批次元数据固定形态',
    [meta.dataClass, meta.verifyStatus, meta.verifiedAt],
    ['field_unverified', 'unverified', null]);
  ok('N5-5 source.kind === field', meta.source.kind === 'field');
  ok('N5-6 demo 批次元数据未受影响',
    T.demoMeta().dataClass === 'demo' && T.demoMeta().verifyStatus === 'demo' &&
    T.demoMeta().verifiedAt === null);
}

/* ================================================================
   N2：没有事务 —— 静态锁 + 文件头如实声明
   ================================================================ */
function runN2() {
  const src = loaded.src;
  /* 只认「真的调用了」，注释里提到事务名字不算调用 */
  const callsTx = /(db\.(startTransaction|runTransaction)\s*\(|\.runTransaction\s*\(\s*async)/.test(src);
  ok('N2-1 seed 里没有真正的事务调用（注释提及不算）', callsTx === false);
  ok('N2-2 文件头如实写明「没有使用数据库事务」',
    src.indexOf('没有使用数据库事务') !== -1);
  ok('N2-3 文件头写明「不保证」原子性',
    /不保证的是/.test(src) && /要么全删/.test(src));
  ok('N2-4 文件头写明 TOCTOU 仍然存在', src.indexOf('TOCTOU') !== -1);
  ok('N2-5 逐条删除前有复核（driftReasons 在 actionRollback 内被调用）',
    /const drift = driftReasons\(/.test(src));
}

/* ================================================================
   N3 / N4：续做、already-absent、删前漂移
   ================================================================ */
async function call(event) {
  return api.main(event);
}

function ids(name) {
  const map = db.state.store.get(name);
  return map ? Array.from(map.keys()) : [];
}

async function runN3N4() {
  /* 先写入，再人为删掉 7 条模拟「删到一半」 */
  db.reset();
  ctx.current = { OPENID: 'fake_admin_001', ENV: 'test-env' };
  const wr = await call({ action: 'write', batchId: BATCH });
  eq('N3-1 写入 14 条全部 created', wr.done.length, 14);
  eq('N3-1b 三集合落库条数',
    [ids('restaurants').length, ids('stalls').length, ids('dishes').length], [1, 1, 12]);

  const dishIds = T.PILOT_DISHES.map(function (d) { return d._id; });
  const half = dishIds.slice(0, 7);
  half.forEach(function (id) { db.state.store.get('dishes').delete(id); });

  const rb = await call({ action: 'rollback', batchId: BATCH });
  ok('N3-2 已删掉一半后仍可继续（不再永久阻断）', rb.ok === true,
    JSON.stringify(rb.blockers).slice(0, 300));
  eq('N3-3 已删的被记为 absent', rb.absent.slice().sort(), half.slice().sort());
  eq('N3-4 只删剩下的 7 条', rb.deleted.length, 7);
  eq('N3-5 三集合最终清空',
    [ids('restaurants').length, ids('stalls').length, ids('dishes').length], [0, 0, 0]);
  eq('N3-6 删后核验 remaining=0', rb.remainingCount, 0);

  /* N4：remove 返回 removed:0（并发下文档已被别人删掉） */
  db.reset();
  await call({ action: 'write', batchId: BATCH });
  db.state.removeMode = 'ghost';
  const rb2 = await call({ action: 'rollback', batchId: BATCH });
  eq('N4-1 remove 返回 0 时 deleted 为空', rb2.deleted, []);
  eq('N4-2 全部记为 already-absent', rb2.alreadyAbsent.slice().sort(),
    T.PILOT_RESTAURANTS.concat(T.PILOT_STALLS, T.PILOT_DISHES).map(function (r) { return r._id; }).sort());
  ok('N4-3 already-absent 数量 == 14', rb2.alreadyAbsent.length === 14, '实际 ' + rb2.alreadyAbsent.length);
  ok('N4-4 结果里区分 already-absent 与 removed',
    rb2.results.every(function (r) { return r.action === 'already-absent'; }));

  /* 删前逐条复核：写入后改一条，然后删到中途时它才被改（这里直接改成漂移状态） */
  db.reset();
  await call({ action: 'write', batchId: BATCH });
  const target = db.state.store.get('dishes').get(dishIds[3]);
  target.price = 999;
  db.state.store.get('dishes').set(dishIds[3], target);
  const rb3 = await call({ action: 'rollback', batchId: BATCH });
  ok('N3-7 存在被改过的记录 → 整批阻断', rb3.ok === false);
  eq('N3-8 一条都没删', rb3.deleted, []);
  ok('N3-9 阻断原因点名 contentHash',
    /contentHash/.test(JSON.stringify(rb3.blockers)), JSON.stringify(rb3.blockers).slice(0, 200));
}

/* ================================================================
   跑
   ================================================================ */
(async function () {
  console.log('=== S2.1 专项：N1 / N2 / N3 / N4 / N5 ===');
  runN1();
  runN5();
  runN2();
  try {
    await runN3N4();
  } catch (err) {
    fail++;
    console.log('  FAIL  N3/N4 执行抛错：' + (err && err.message));
  }
  console.log('');
  console.log('通过: ' + pass);
  console.log('失败: ' + fail);
  if (fail === 0) console.log('全部通过 ✅');
  process.exit(fail === 0 ? 0 : 1);
})();
