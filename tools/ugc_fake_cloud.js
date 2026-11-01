/**
 * 离线测试用的假云开发（wx-server-sdk）实现。
 *
 * 只实现 submit / review 两个云函数真正用到的 API：
 *   cloud.init / cloud.DYNAMIC_CURRENT_ENV / cloud.getWXContext() / cloud.database()
 *   db.command.gte / db.serverDate()
 *   collection(name).add({data})
 *   collection(name).doc(id).get()
 *   collection(name).where(cond).count() / .limit(n).get() / .orderBy(f,dir).limit(n).get() / .update({data})
 *
 * 所有失败注入、调用计数都留在 harness 上，测试用它们证明“没有谎报成功”“没有写不该写的集合”。
 *
 * 注意：本文件只是测试替身，不代表云端真实行为；测试结论必须标注“本地模拟”。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function getPath(obj, dotted) {
  const parts = String(dotted).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function matchValue(actual, expected) {
  if (expected && typeof expected === 'object' && expected.__op === 'gte') {
    const a = actual instanceof Date ? actual.getTime() : new Date(actual).getTime();
    const b = expected.value instanceof Date ? expected.value.getTime() : new Date(expected.value).getTime();
    return a >= b;
  }
  if (expected && typeof expected === 'object' && expected.__op === 'lt') {
    const a = actual instanceof Date ? actual.getTime() : new Date(actual).getTime();
    const b = expected.value instanceof Date ? expected.value.getTime() : new Date(expected.value).getTime();
    return a < b;
  }
  if (expected && typeof expected === 'object' && expected.__op === 'in') return expected.values.indexOf(actual) !== -1;
  if (expected && typeof expected === 'object' && expected.__op === 'neq') return actual !== expected.value;
  if (expected && typeof expected === 'object' && expected.__op === 'gt') return actual > expected.value;
  return actual === expected;
}

function applyData(row, data, cloneValue) {
  Object.keys(data).forEach(function (key) {
    if (key.indexOf('.') === -1) { row[key] = cloneValue(data[key]); return; }
    const parts = key.split('.');
    let target = row;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = cloneValue(data[key]);
  });
}

function matches(doc, cond) {
  const keys = Object.keys(cond || {});
  for (let i = 0; i < keys.length; i++) {
    if (!matchValue(getPath(doc, keys[i]), cond[keys[i]])) return false;
  }
  return true;
}

function createHarness() {
  const state = {
    docs: Object.create(null),
    seq: 0,
    context: { OPENID: '' },
    fail: null,
    afterWriteFail: null,
    calls: Object.create(null),
    touched: Object.create(null),
    removeCalls: 0,
    updateCalls: 0,
    forceUpdateZero: false,
    beforeUpdate: null
  };

  function bucket(name) {
    if (!state.docs[name]) state.docs[name] = [];
    if (!state.calls[name]) state.calls[name] = [];
    state.touched[name] = (state.touched[name] || 0) + 1;
    return state.docs[name];
  }

  function maybeFail(name, op) {
    state.calls[name].push(op);
    if (state.fail && state.fail.collection === name && state.fail.op === op &&
        (!state.fail.atCall || state.calls[name].filter(function (call) { return call === op; }).length === state.fail.atCall)) {
      const err = new Error('FAKE_DB_FAIL:' + name + '.' + op);
      err.errCode = -500001;
      throw err;
    }
  }

  function maybeFailAfterWrite(name, op) {
    const fault = state.afterWriteFail;
    if (fault && fault.collection === name && fault.op === op &&
        state.calls[name].filter(function (call) { return call === op; }).length === fault.atCall) {
      const err = new Error('FAKE_ACK_LOST:' + name + '.' + op);
      err.errCode = -500002;
      throw err;
    }
  }

  const command = {
    gte: function (value) { return { __op: 'gte', value: value }; },
    lt: function (value) { return { __op: 'lt', value: value }; },
    in: function (values) { return { __op: 'in', values: values }; },
    neq: function (value) { return { __op: 'neq', value: value }; },
    gt: function (value) { return { __op: 'gt', value: value }; }
  };

  function query(name, cond) {
    const rows = bucket(name);
    const chain = {
      _cond: cond || {},
      _limit: null,
      _order: [],
      count: function () {
        maybeFail(name, 'count');
        const n = rows.filter(function (d) { return matches(d, chain._cond); }).length;
        return Promise.resolve({ total: n });
      },
      limit: function (n) { chain._limit = n; return chain; },
      orderBy: function (field, dir) { chain._order.push({ field: field, dir: dir }); return chain; },
      get: function () {
        maybeFail(name, 'get');
        let out = rows.filter(function (d) { return matches(d, chain._cond); });
        if (chain._order.length) {
          out = out.slice().sort(function (a, b) {
            for (let i = 0; i < chain._order.length; i++) {
              const order = chain._order[i];
              const av = getPath(a, order.field);
              const bv = getPath(b, order.field);
              const at = av instanceof Date ? av.getTime() : av;
              const bt = bv instanceof Date ? bv.getTime() : bv;
              if (at === undefined && bt !== undefined) return -1;
              if (bt === undefined && at !== undefined) return 1;
              if (at !== bt) return (at > bt ? 1 : -1) * (order.dir === 'desc' ? -1 : 1);
            }
            return 0;
          });
        }
        if (chain._limit !== null) out = out.slice(0, chain._limit);
        return Promise.resolve({ data: out.map(function (d) { return clone(d); }) });
      },
      update: function (payload) {
        if (state.beforeUpdate) state.beforeUpdate(rows, chain._cond);
        maybeFail(name, 'update');
        state.updateCalls++;
        let updated = 0;
        for (let i = 0; i < rows.length; i++) {
          if (!state.forceUpdateZero && matches(rows[i], chain._cond)) {
            applyData(rows[i], payload.data, clone);
            updated++;
          }
        }
        maybeFailAfterWrite(name, 'update');
        return Promise.resolve({ stats: { updated: updated } });
      },
      remove: function () {
        state.removeCalls++;
        return Promise.resolve({ stats: { removed: 0 } });
      }
    };
    return chain;
  }

  const collection = function (name) {
    const rows = bucket(name);
    return {
      add: function (payload) {
        maybeFail(name, 'add');
        if (payload.data && payload.data._id && rows.some(function (row) { return row._id === payload.data._id; })) {
          const err = new Error('FAKE_DUPLICATE_ID:' + payload.data._id);
          err.errCode = -501001;
          throw err;
        }
        state.seq++;
        const doc = clone(payload.data);
        doc._id = doc._id || ('fake_id_' + state.seq);
        rows.push(doc);
        maybeFailAfterWrite(name, 'add');
        return Promise.resolve({ _id: doc._id });
      },
      doc: function (id) {
        return {
          get: function () {
            maybeFail(name, 'get');
            const found = rows.filter(function (d) { return d._id === id; })[0];
            if (!found) {
              const err = new Error('document does not exist');
              err.errCode = -1;
              return Promise.reject(err);
            }
            return Promise.resolve({ data: clone(found) });
          },
          update: function (payload) {
            maybeFail(name, 'update');
            state.updateCalls++;
            const found = rows.filter(function (d) { return d._id === id; })[0];
            if (!found) return Promise.resolve({ stats: { updated: 0 } });
            if (state.forceUpdateZero) return Promise.resolve({ stats: { updated: 0 } });
            applyData(found, payload.data, clone);
            return Promise.resolve({ stats: { updated: 1 } });
          }
        };
      },
      where: function (cond) { return query(name, cond); }
    };
  };

  const db = {
    command: command,
    serverDate: function () { return new Date(); },
    collection: collection
  };

  const cloud = {
    DYNAMIC_CURRENT_ENV: 'fake-dynamic-env',
    init: function () { /* noop */ },
    getWXContext: function () { return state.context; },
    database: function () { return db; },
    openapi: {
      security: {
        msgSecCheck: function () {
          const err = new Error('OPENAPI_NOT_AVAILABLE_IN_TEST');
          err.code = 'API_UNAVAILABLE';
          return Promise.reject(err);
        }
      }
    }
  };

  function clone(v) {
    if (v === null || v === undefined) return v;
    if (v instanceof Date) return new Date(v.getTime());
    if (Array.isArray(v)) return v.map(clone);
    if (typeof v === 'object') {
      const out = {};
      Object.keys(v).forEach(function (k) { out[k] = clone(v[k]); });
      return out;
    }
    return v;
  }

  return {
    cloud: cloud,
    db: db,
    state: state,
    setOpenid: function (openid) { state.context = { OPENID: openid }; },
    setFail: function (fail) { state.fail = fail; },
    clearFail: function () { state.fail = null; },
    setAfterWriteFail: function (fail) { state.afterWriteFail = fail; },
    clearAfterWriteFail: function () { state.afterWriteFail = null; },
    setForceUpdateZero: function (v) { state.forceUpdateZero = !!v; },
    setBeforeUpdate: function (fn) { state.beforeUpdate = fn; },
    reset: function () {
      state.docs = Object.create(null);
      state.calls = Object.create(null);
      state.touched = Object.create(null);
      state.seq = 0;
      state.removeCalls = 0;
      state.updateCalls = 0;
      state.fail = null;
      state.afterWriteFail = null;
      state.forceUpdateZero = false;
      state.beforeUpdate = null;
    },
    seed: function (name, doc) {
      if (!state.docs[name]) state.docs[name] = [];
      state.docs[name].push(clone(doc));
    },
    docs: function (name) { return (state.docs[name] || []).map(clone); },
    calls: function (name) { return (state.calls[name] || []).slice(); },
    touchedCollections: function () { return Object.keys(state.touched); },
    removeCalls: function () { return state.removeCalls; },
    updateCalls: function () { return state.updateCalls; },
    loadFunction: function (relPath) {
      const abs = path.join(ROOT, relPath);
      const src = fs.readFileSync(abs, 'utf8');
      const mod = { exports: {} };
      const fakeRequire = function (id) {
        if (id === 'wx-server-sdk') return cloud;
        if (id === 'crypto') return require('crypto');
        throw new Error('unexpected require in cloud function: ' + id);
      };
      // eslint-disable-next-line no-new-func
      const factory = new Function('exports', 'require', 'module', '__filename', '__dirname', src);
      factory(mod.exports, fakeRequire, mod, abs, path.dirname(abs));
      return mod.exports;
    },
    readSource: function (relPath) {
      return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    }
  };
}

module.exports = {
  createHarness: createHarness,
  ROOT: ROOT
};
