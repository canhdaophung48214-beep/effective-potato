/**
 * test_seed_auth.js —— cloudfunctions/seed 入口鉴权的离线测试（A0-3）
 *
 * 目的：锁死三件事
 *   1. ADMIN_OPENIDS 缺失 / 空串 / 纯空白 / 只有分隔符 → 拒绝所有调用（fail-closed）
 *   2. 身份只取 cloud.getWXContext().OPENID，不信任入参里的 openid
 *   3. 鉴权发生在任何数据库读写与集合创建之前（被拒时零 DB 调用）
 *
 * 做法：不连云端。用假 wx-server-sdk 载入 seed/index.js，假 getWXContext 可逐条改写，
 *      假 database() 把每次调用记进数组；另有一个「一碰就抛错」的模式，用来证明
 *      被拒绝时根本没有碰到数据库。
 *
 * 安全：本文件里的 openid 全是**假的占位串**（形如 fake_admin_001），
 *      不代表任何真实用户；输出只打印数量与用例名，不打印白名单内容。
 *
 * 用法：node tools/test_seed_auth.js
 * 退出码：0 = 全部通过；1 = 有失败项
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(ROOT, 'cloudfunctions', 'seed', 'index.js');

/* 假身份（占位串，非真实 OPENID） */
const FAKE_ADMIN = 'fake_admin_001';
const FAKE_OTHER = 'fake_other_999';
const FAKE_PREFIX = 'fake_admin_00';

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
   假 SDK：getWXContext 可变、database 记录调用且可切换「一碰就抛」
   ================================================================ */
const ctx = { current: {} };
const dbCalls = [];
const dbState = { mode: 'record' };   /* 'record' | 'throw' */

function makeDb() {
  function guard(op, extra) {
    if (dbState.mode === 'throw') {
      throw new Error('被拒绝的调用不应触碰数据库：' + op);
    }
    dbCalls.push(Object.assign({ op: op }, extra || {}));
  }

  function chain(collection) {
    return {
      doc: function (id) {
        guard('doc', { collection: collection, id: id });
        return {
          get: function () {
            guard('get', { collection: collection, id: id });
            const err = new Error('document not exist');
            err.errCode = -502005;
            return Promise.reject(err);
          },
          remove: function () {
            guard('remove', { collection: collection, id: id });
            return Promise.resolve({ stats: { removed: 1 } });
          },
          update: function () {
            guard('update', { collection: collection, id: id });
            return Promise.resolve({});
          }
        };
      },
      add: function () {
        guard('add', { collection: collection });
        return Promise.resolve({ _id: 'added' });
      },
      where: function () {
        guard('where', { collection: collection });
        return {
          count: function () {
            guard('count', { collection: collection });
            return Promise.resolve({ total: 0 });
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
    if (id.charAt(0) === '.') return require(path.resolve(path.dirname(SEED_FILE), id));
    return require(id);
  }, module, SEED_FILE, path.dirname(SEED_FILE));

  return { api: module.exports, src: src };
}

const loaded = loadSeed();
const api = loaded.api;
const T = api.__test__ || {};
const SRC = loaded.src;
const MAIN_SRC = SRC.slice(SRC.indexOf('exports.main'));

const main = api.main;
const parseAdminOpenIds = T.parseAdminOpenIds;
const checkAdmin = T.checkAdmin;

function reset() {
  dbCalls.length = 0;
  dbState.mode = 'record';
  ctx.current = {};
  delete process.env.ADMIN_OPENIDS;
}

function setAdmins(value) {
  if (value === undefined) delete process.env.ADMIN_OPENIDS;
  else process.env.ADMIN_OPENIDS = value;
}

const ORIGINAL_ENV = process.env.ADMIN_OPENIDS;

const ACTIONS = ['ensure', 'plan', 'write', 'verify', 'cleanup'];
const VALID_BATCH = 'seed-s01-20261022';

/* ================================================================
   A. parseAdminOpenIds 解析
   ================================================================ */
if (typeof parseAdminOpenIds === 'function') {
  eq('A1 逗号分隔', parseAdminOpenIds('a1,a2'), ['a1', 'a2']);
  eq('A2 空格分隔', parseAdminOpenIds('a1 a2'), ['a1', 'a2']);
  eq('A3 分号与中文标点混排', parseAdminOpenIds('a1;a2，a3；a4'), ['a1', 'a2', 'a3', 'a4']);
  eq('A4 空串 → 空数组', parseAdminOpenIds(''), []);
  eq('A5 纯空白 → 空数组', parseAdminOpenIds('   \t\n '), []);
  eq('A6 undefined → 空数组', parseAdminOpenIds(undefined), []);
  eq('A7 非字符串（数字）→ 空数组', parseAdminOpenIds(123), []);
  eq('A8 重复值去重', parseAdminOpenIds('a1,a1, a1'), ['a1']);
  eq('A9 大小写不归一（OPENID 区分大小写）', parseAdminOpenIds('AbC,abc'), ['AbC', 'abc']);
} else {
  ok('A0 parseAdminOpenIds 已导出', false, '缺少 __test__.parseAdminOpenIds');
}

/* ================================================================
   B. ADMIN_OPENIDS 未配置 / 空 / 只有分隔符 → 拒绝所有调用
   ================================================================ */
async function runB() {
  reset();
  setAdmins(undefined);
  for (let i = 0; i < ACTIONS.length; i++) {
    reset();
    setAdmins(undefined);
    ctx.current = { OPENID: FAKE_ADMIN, ENV: 'env' };
    const res = await main({ action: ACTIONS[i], batchId: VALID_BATCH });
    ok('B1 未配置 ADMIN_OPENIDS 时拒绝 ' + ACTIONS[i],
      !!res && res.ok === false && res.code === 'FORBIDDEN',
      JSON.stringify(res));
  }

  const variants = [
    { name: '空串', value: '' },
    { name: '纯空白', value: '   ' },
    { name: '只有分隔符', value: ',,;;' },
    { name: '换行与制表符', value: '\n\t\r' }
  ];
  for (let i = 0; i < variants.length; i++) {
    reset();
    setAdmins(variants[i].value);
    ctx.current = { OPENID: FAKE_ADMIN, ENV: 'env' };
    const res = await main({ action: 'plan', batchId: VALID_BATCH });
    ok('B2 变量' + variants[i].name + '时拒绝',
      !!res && res.code === 'FORBIDDEN' && res.reason === 'ADMIN_OPENIDS_NOT_CONFIGURED',
      JSON.stringify(res));
  }

  reset();
  setAdmins('');
  ctx.current = { OPENID: FAKE_ADMIN };
  const res0 = await main({ action: 'ensure' });
  ok('B3 空配置时 ensure 也被拒（fail-closed，无降级分支）',
    !!res0 && res0.code === 'FORBIDDEN', JSON.stringify(res0));
  ok('B4 被拒时不回显 checked 之外的假成功', !!res0 && res0.ok === false && res0.checked === 0);
}

/* ================================================================
   C. 白名单已配但调用者没有 OPENID
   ================================================================ */
async function runC() {
  const contexts = [
    { name: 'OPENID 为 undefined', ctxValue: {} },
    { name: 'OPENID 为空串', ctxValue: { OPENID: '' } },
    { name: 'OPENID 为纯空白', ctxValue: { OPENID: '   ' } }
  ];
  for (let i = 0; i < contexts.length; i++) {
    reset();
    setAdmins(FAKE_ADMIN);
    ctx.current = contexts[i].ctxValue;
    const res = await main({ action: 'verify' });
    ok('C ' + contexts[i].name + ' → 拒绝',
      !!res && res.code === 'FORBIDDEN' && res.reason === 'NO_OPENID',
      JSON.stringify(res));
  }
}

/* ================================================================
   D. 非管理员（含前缀攻击与大小写变体）
   ================================================================ */
async function runD() {
  const cases = [
    { name: '不在白名单内', id: FAKE_OTHER },
    { name: '只是管理员 ID 的前缀', id: FAKE_PREFIX },
    { name: '管理员 ID 的大小写变体', id: FAKE_ADMIN.toUpperCase() }
  ];
  for (let i = 0; i < cases.length; i++) {
    reset();
    setAdmins(FAKE_ADMIN);
    ctx.current = { OPENID: cases[i].id, ENV: 'env' };
    const res = await main({ action: 'cleanup', batchId: VALID_BATCH });
    ok('D ' + cases[i].name + ' → 拒绝',
      !!res && res.code === 'FORBIDDEN' && res.reason === 'NOT_ADMIN',
      JSON.stringify(res));
    ok('D ' + cases[i].name + ' → 零数据库调用', dbCalls.length === 0,
      '实际调用 ' + dbCalls.length + ' 次');
  }
}

/* ================================================================
   E. 管理员：五个 action 都要放行（不被鉴权挡住）
   ================================================================ */
async function runE() {
  for (let i = 0; i < ACTIONS.length; i++) {
    reset();
    setAdmins(FAKE_ADMIN);
    ctx.current = { OPENID: FAKE_ADMIN, ENV: 'env' };
    const res = await main({ action: ACTIONS[i], batchId: VALID_BATCH });
    ok('E 管理员调用 ' + ACTIONS[i] + ' 不被鉴权拦截',
      !!res && res.code !== 'FORBIDDEN',
      JSON.stringify(res).slice(0, 200));
  }

  /* 放行后仍应带上留痕用的 actorOpenId */
  reset();
  setAdmins(FAKE_ADMIN);
  ctx.current = { OPENID: FAKE_ADMIN, ENV: 'env' };
  const res2 = await main({ action: 'verify' });
  ok('E6 放行路径仍记录 actorOpenId 用于留痕', res2 && res2.actorOpenId === FAKE_ADMIN);
}

/* ================================================================
   F. 未知 action：闸门在 action 白名单校验之前
   ================================================================ */
async function runF() {
  reset();
  setAdmins(FAKE_ADMIN);
  ctx.current = { OPENID: FAKE_OTHER };
  const denied = await main({ action: 'dropAll' });
  ok('F1 非管理员 + 未知 action → FORBIDDEN（探不到 action 是否存在）',
    !!denied && denied.code === 'FORBIDDEN', JSON.stringify(denied));

  reset();
  setAdmins(FAKE_ADMIN);
  ctx.current = { OPENID: FAKE_ADMIN };
  const admin = await main({ action: 'dropAll' });
  ok('F2 管理员 + 未知 action → 不支持的 action',
    !!admin && admin.ok === false && /不支持的 action/.test(String(admin.message)),
    JSON.stringify(admin));
}

/* ================================================================
   G. 顺序性：被拒路径绝不触碰数据库（假 db 一碰就抛）
   ================================================================ */
async function runG() {
  reset();
  setAdmins(undefined);
  dbState.mode = 'throw';
  let thrown = null;
  let res = null;
  try {
    res = await main({ action: 'cleanup', batchId: VALID_BATCH });
  } catch (err) {
    thrown = err;
  }
  ok('G1 未配置时调用 cleanup 不抛错（说明没进数据库）', thrown === null,
    thrown ? String(thrown.message) : '');
  ok('G2 返回 FORBIDDEN 且为零调用', !!res && res.code === 'FORBIDDEN' && dbCalls.length === 0);
  ok('G3 拒绝响应带 elapsedMs（结构完整）', !!res && typeof res.elapsedMs === 'number');
  dbState.mode = 'record';
}

/* ================================================================
   H. 原有的数据约束未被削弱
   ================================================================ */
function runH() {
  eq('H1 集合名仍是冻结的三个', T.COLLECTION_NAMES, ['restaurants', 'stalls', 'dishes']);
  ok('H2 COL 仍不可改写', Object.isFrozen(T.COL) === true);
  const ids = [].concat(
    (T.ID_WHITELIST_UNUSED || []),
    (T.EXPECTED_RESTAURANTS || []).map(function (r) { return r._id; }),
    (T.EXPECTED_STALLS || []).map(function (s) { return s._id; }),
    (T.EXPECTED_DISHES || []).map(function (d) { return d._id; })
  );
  eq('H3 记录白名单仍是 8 条固定 _id', ids,
    ['s01', 's01_t1', 's01_t2', 's01_t3', 'd01', 'd02', 'd03', 'd39']);
  ok('H4 cleanup 三重锁（dataClass + batchId）仍在',
    /dataClass\s*!==\s*'demo'\s*\|\|\s*existing\.batchId\s*!==\s*batchId/.test(SRC));
  ok('H5 仍然没有 where().remove()', !/\.where\s*\([^)]*\)\s*\.remove\s*\(/.test(SRC));
  ok('H6 仍然不把入参当集合名', !/event\s*\.\s*collection/.test(SRC));
  ok('H7 contentHash 冲突保护仍在（已存在且不同 → conflict，不覆盖）',
    /action: 'conflict'/.test(SRC) && /contentHashOf\(existing\)\s*===\s*spec\.record\.contentHash/.test(SRC));
}

/* ================================================================
   I. 静态顺序：闸门先于 action 校验与全部 action 分发
   ================================================================ */
function runI() {
  const gate = MAIN_SRC.indexOf('checkAdmin(wx.OPENID)');
  ok('I0 入口里能找到鉴权闸门', gate > -1);
  ok('I1 闸门先于 action 白名单校验', gate > -1 && gate < MAIN_SRC.indexOf('actions.indexOf(action)'));
  ok('I2 闸门先于所有 action 分发', gate > -1 &&
    ['actionEnsure(', 'actionPlan(', 'actionWrite(', 'actionVerify(', 'actionCleanup(']
      .every(function (fn) {
        const at = MAIN_SRC.indexOf(fn);
        return at === -1 || gate < at;
      }));
}

/* ================================================================
   J. 拒绝响应不泄露白名单、不回显身份
   ================================================================ */
async function runJ() {
  reset();
  setAdmins(FAKE_ADMIN + ',' + FAKE_OTHER);
  ctx.current = { OPENID: 'nobody_at_all' };
  const res = await main({ action: 'plan', batchId: VALID_BATCH });
  const text = JSON.stringify(res);
  ok('J1 拒绝响应不含任何白名单 openid',
    text.indexOf(FAKE_ADMIN) === -1 && text.indexOf(FAKE_OTHER) === -1, text);
  ok('J2 拒绝响应不含 actorOpenId 字段', Object.prototype.hasOwnProperty.call(res, 'actorOpenId') === false);
}

/* ================================================================
   汇总
   ================================================================ */
(async function () {
  try {
    await runB();
    await runC();
    await runD();
    await runE();
    await runF();
    await runG();
    runH();
    runI();
    await runJ();
  } finally {
    if (ORIGINAL_ENV === undefined) delete process.env.ADMIN_OPENIDS;
    else process.env.ADMIN_OPENIDS = ORIGINAL_ENV;
  }

  console.log('==== test_seed_auth 结果 ====');
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
