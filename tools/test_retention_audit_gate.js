'use strict';
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-28T12:00:00.000Z');
const dayMs = 86400000;
let pass = 0, fail = 0;
function check(name, condition) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (condition) pass++; else fail++;
}
function setup() {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
}
function candidate(id) {
  h.seed('submissions', { _id: id, status: 'approved', rev: 1,
    createdAt: new Date(now.getTime() - 31 * dayMs), payload: { note: 'private-body-' + id },
    verifyStatus: 'unverified' });
}
function payloadBytes(id) {
  const row = h.docs('submissions').find(function (x) { return x._id === id; });
  return Buffer.from(JSON.stringify(row.payload), 'utf8');
}
function stillPrivate(id, before, logCount) {
  const row = h.docs('submissions').find(function (x) { return x._id === id; });
  return Buffer.compare(payloadBytes(id), before) === 0 && row.rev === 1 &&
    row.payloadRedactedAt === undefined && h.state.updateCalls === 0 &&
    h.docs('upload_logs').length === logCount;
}
function batch(eventType, code, id) {
  const mark = eventType === 'retention_mark';
  for (const phase of ['prepare', 'complete']) {
    const complete = phase === 'complete';
    const stats = mark ? {
      phase: phase, operation: 'mark', batchId: id, selected: 1,
      marked: 0, markedAudited: 0, auditFailedCount: 0, skipped: 0,
      conflicts: 0, failed: complete && code !== 'COMPLETE' ? 1 : 0,
      unprocessed: complete ? (code === 'COMPLETE' ? 1 : 0) : 1
    } : {
      phase: phase, operation: 'purge', batchId: id, selected: 1,
      purged: 0, purgedAudited: 0, auditFailedCount: 0, deferredAudit: 0,
      deferredRetry: 0, skipped: 0, conflicts: 0,
      failed: complete && code !== 'COMPLETE' ? 1 : 0,
      unprocessed: complete ? (code === 'COMPLETE' ? 1 : 0) : 1, needsMark: 0
    };
    // A successful complete with one selected row must close a real outcome.
    if (complete && code === 'COMPLETE') {
      if (mark) { stats.marked = 1; stats.markedAudited = 1; }
      else { stats.purged = 1; stats.purgedAudited = 1; }
      stats.unprocessed = 0;
    }
    h.seed('upload_logs', { _id: id + '_' + phase, schemaVersion: 1,
      event: eventType, action: eventType, submissionId: null,
      day: '2026-10-28', at: new Date(now.getTime() - (complete ? 900 : 1000)),
      rev: 1, actor: { role: 'system', openidHash: null }, errorCode: '',
      result: { code: complete ? code : 'PREPARE', stats: stats } });
  }
}
async function blocked(id, hooks) {
  const before = payloadBytes(id);
  const logCount = h.docs('upload_logs').length;
  const result = await T.purgePayload({ now: now }, hooks);
  return { result: result, intact: stillPrivate(id, before, logCount) };
}
async function run() {
  setup(); candidate('normal'); batch('retention_mark', 'COMPLETE', 'normal_batch');
  let result = await T.purgePayload({ now: now });
  check('G-A 完整 OK 对账允许清正文', result.ok === true && result.purged === 1 &&
    h.docs('submissions')[0].payload === null);

  setup(); candidate('partial'); batch('retention_mark', 'PARTIAL', 'partial_batch');
  let scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
  let attempt = await blocked('partial');
  check('G-B PARTIAL 即使 closed=1 也拦截且正文逐字节不变',
    scan.counts.closed === 1 && scan.counts.outcomes.PARTIAL === 1 &&
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('failed'); batch('retention_purge', 'FAILED', 'failed_batch');
  scan = await T.reconcileBatches({ eventType: 'retention_purge', now: new Date() });
  attempt = await blocked('failed');
  check('G-C FAILED 即使 closed=1 也拦截且不写虚假 complete',
    scan.counts.closed === 1 && scan.counts.outcomes.FAILED === 1 &&
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('anomaly');
  h.seed('upload_logs', { _id: 'orphan', schemaVersion: 1, event: 'retention_mark',
    action: 'retention_mark', submissionId: null, day: '2026-10-28',
    at: new Date(now.getTime() - 1000), rev: 1,
    actor: { role: 'system', openidHash: null }, errorCode: '',
    result: { code: 'PREPARE', stats: { phase: 'prepare', operation: 'mark',
      batchId: 'orphan', selected: 1, marked: 0, markedAudited: 0,
      auditFailedCount: 0, skipped: 0, conflicts: 0, failed: 0, unprocessed: 1 } } });
  attempt = await blocked('anomaly');
  check('G-D RECONCILE_ANOMALIES / 疑似孤儿 prepare 拦截',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('running_prepare');
  const recent = new Date();
  h.seed('upload_logs', { _id: 'recent_prepare', schemaVersion: 1,
    event: 'retention_mark', action: 'retention_mark', submissionId: null,
    day: recent.toISOString().slice(0, 10), at: recent, rev: 1,
    actor: { role: 'system', openidHash: null }, errorCode: '',
    result: { code: 'PREPARE', stats: { phase: 'prepare', operation: 'mark',
      batchId: 'running_prepare', selected: 1, marked: 0, markedAudited: 0,
      auditFailedCount: 0, skipped: 0, conflicts: 0, failed: 0, unprocessed: 1 } } });
  scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
  attempt = await blocked('running_prepare');
  check('G-D2 未超阈值的运行中 prepare 即使对账 ok=true 也拦截',
    scan.ok === true && scan.counts.running === 1 &&
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('incomplete');
  attempt = await blocked('incomplete', { reconcile: async function (options) {
    const actual = await T.reconcileBatches(options);
    return Object.assign({}, actual, { completeScan: false });
  } });
  check('G-E completeScan=false 即使 ok=true 也拦截',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('truncated');
  attempt = await blocked('truncated', { reconcile: async function (options) {
    const actual = await T.reconcileBatches(options);
    return Object.assign({}, actual, { truncated: true, nextCursor: 'cursor' });
  } });
  check('G-F 截断结果即使 ok=true 也拦截',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('real_truncation');
  for (let i = 0; i < 501; i++) {
    h.seed('upload_logs', { _id: 'single_' + String(i).padStart(4, '0'),
      schemaVersion: 1, event: 'retention_mark', action: 'retention_mark',
      submissionId: 'synthetic_' + i, day: '2026-10-28',
      at: new Date(now.getTime() - 1000), rev: 1,
      actor: { role: 'system', openidHash: null }, errorCode: '', result: { code: 'OK' } });
  }
  scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
  attempt = await blocked('real_truncation');
  check('G-F2 实际 501 条只读扫描截断阻断正文清理',
    scan.code === 'SCAN_TRUNCATED' && scan.truncated === true &&
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('timeout');
  attempt = await blocked('timeout', { reconcile: function () { return new Promise(function () {}); }, timeoutMs: 5 });
  check('G-G 对账超时拦截', attempt.result.reason === 'TIMEOUT' && attempt.intact);

  setup(); candidate('missing');
  attempt = await blocked('missing', { reconcile: async function () { return undefined; } });
  check('G-H 对账结果缺失拦截', attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('malformed');
  attempt = await blocked('malformed', { reconcile: async function (options) {
    const actual = await T.reconcileBatches(options);
    return Object.assign({}, actual, { counts: undefined });
  } });
  check('G-H2 对账计数结构不完整拦截',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('bad_outcome'); batch('retention_mark', 'PARTIAL', 'bad_outcome_batch');
  attempt = await blocked('bad_outcome', { reconcile: async function (options) {
    const actual = await T.reconcileBatches(options);
    return Object.assign({}, actual, { ok: true, code: 'OK' });
  } });
  check('G-I 返回码伪装 OK 仍检查 outcomes 中 PARTIAL',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('retry');
  attempt = await blocked('retry', { reconcile: async function () { throw new Error('offline fault'); } });
  const retry = await T.purgePayload({ now: now });
  check('G-J 短暂对账故障后重试成功才清正文',
    attempt.result.reason === 'RECONCILE_ERROR' && attempt.intact &&
    retry.ok === true && retry.purged === 1 && h.docs('submissions')[0].payload === null);

  setup(); candidate('invalid_db');
  const originalCollection = h.db.collection;
  h.db.collection = function (name) {
    const coll = originalCollection(name);
    if (name !== 'upload_logs') return coll;
    return { where: function () { return { orderBy: function () { return this; },
      limit: function () { return this; }, get: async function () { return undefined; } }; } };
  };
  attempt = await blocked('invalid_db');
  h.db.collection = originalCollection;
  check('G-K 数据库对账响应缺失不按空日志放行',
    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);

  setup(); candidate('public_entry'); batch('retention_mark', 'FAILED', 'entry_batch');
  const before = payloadBytes('public_entry'), logCount = h.docs('upload_logs').length;
  result = await fn.main({ action: 'purge', maintenanceToken: 'offline-token' }, {});
  check('G-L 维护入口在全局屏障未验证时失败关闭',
    result.code === 'PURGE_GLOBAL_FENCE_UNVERIFIED' &&
    stillPrivate('public_entry', before, logCount));

  setup(); candidate('unauthorized');
  const raw = payloadBytes('unauthorized');
  result = await fn.main({ action: 'purge' }, {});
  check('G-M 无令牌拒绝且不查询或更新正文', result.code === 'FORBIDDEN' &&
    Buffer.compare(payloadBytes('unauthorized'), raw) === 0 && h.state.updateCalls === 0 &&
    h.calls('upload_logs').length === 0);

  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
