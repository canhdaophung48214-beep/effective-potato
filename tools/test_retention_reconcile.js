'use strict';
const crypto = require('crypto');
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-29T12:00:00.000Z');
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
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
}
function log(id, batchId, phase, at, overrides) {
  const stats = Object.assign({ phase: phase, operation: 'mark', batchId: batchId,
    selected: 1, marked: phase === 'prepare' ? 0 : 1,
    markedAudited: phase === 'prepare' ? 0 : 1, auditFailedCount: 0,
    skipped: 0, conflicts: 0, failed: 0, unprocessed: phase === 'prepare' ? 1 : 0 },
  overrides && overrides.stats);
  const row = Object.assign({ _id: id, schemaVersion: 1, event: 'retention_mark',
    action: 'retention_mark', submissionId: null, day: '2026-10-29',
    at: at, rev: 1, actor: { role: 'system', openidHash: null },
    result: { code: phase === 'prepare' ? 'PREPARE' : 'COMPLETE', stats: stats },
    errorCode: '' }, overrides || {});
  h.seed('upload_logs', row);
}
async function scan(options) {
  return T.reconcileBatches(Object.assign({ eventType: 'retention_mark', now: now }, options || {}));
}
function oneStatus(result, expected) {
  return result.batches.length === 1 && result.batches[0].status === expected &&
    result.counts[expected] === 1;
}
async function run() {
  setup();
  log('a1', 'closed', 'prepare', new Date(now - 1000));
  log('a2', 'closed', 'complete', new Date(now - 500));
  let r = await scan();
  check('C1 正常 prepare/complete 同批闭合且成功口径兼容', r.ok && r.code === 'OK' &&
    oneStatus(r, 'closed') && r.scanned === 2 && r.batches[0].completeCode === 'COMPLETE' &&
    r.batches[0].outcome === 'OK' && r.counts.outcomes.OK === 1);
  check('C1b 只输出哈希引用，不回传原始批次 ID',
    /^[0-9a-f]{24}$/.test(r.batches[0].batchRef) &&
    !JSON.stringify(r).includes('"batchId":"closed"'));

  setup(); log('b1', 'orphan', 'prepare', new Date(now - 600000));
  r = await scan();
  check('C2 恰好十分钟为疑似孤儿，异常码与分类一致',
    r.ok === false && r.code === 'RECONCILE_ANOMALIES' &&
    oneStatus(r, 'suspectedOrphan') && r.counts.suspectedOrphan === 1);
  setup(); log('b2', 'running', 'prepare', new Date(now - 599999));
  r = await scan();
  check('C3 未满十分钟仍是运行中', oneStatus(r, 'running') && r.counts.suspectedOrphan === 0);

  setup(); log('c1', 'missing_prepare', 'complete', new Date(now - 1000));
  r = await scan();
  check('C4 complete 无 prepare 是异常', oneStatus(r, 'completeWithoutPrepare'));
  setup();
  log('d1', 'duplicate_prepare', 'prepare', new Date(now - 1000));
  log('d2', 'duplicate_prepare', 'prepare', new Date(now - 900));
  log('d3', 'duplicate_complete', 'prepare', new Date(now - 1000));
  log('d4', 'duplicate_complete', 'complete', new Date(now - 900));
  log('d5', 'duplicate_complete', 'complete', new Date(now - 800));
  r = await scan({ pageSize: 2 });
  check('C5 重复 prepare 与重复 complete 分别发现', r.counts.duplicate === 2 && r.pages >= 3);

  setup();
  log('e1', 'bad_count', 'prepare', new Date(now - 1000));
  log('e2', 'bad_count', 'complete', new Date(now - 900),
    { stats: { phase: 'complete', operation: 'mark', batchId: 'bad_count', selected: 2,
      marked: 1, markedAudited: 1, auditFailedCount: 0, skipped: 0,
      conflicts: 0, failed: 0, unprocessed: 0 } });
  r = await scan();
  check('C6 计数不守恒或首尾选中数变化被发现', oneStatus(r, 'countMismatch'));

  setup();
  log('f1', '', 'prepare', new Date(now - 1000));
  log('f2', 'bad_time', 'prepare', new Date('bad'));
  log('f3', 'bad_day', 'prepare', new Date(now - 1000), { day: '2026-02-30' });
  log('f4', 'missing_field', 'prepare', new Date(now - 1000), { submissionId: undefined });
  r = await scan();
  check('C7 无效 ID、日期、时间及必填关联字段计入异常', r.counts.invalidLogs === 4 && !r.ok);

  setup();
  log('f5', 'at_boundary', 'prepare', new Date(now));
  r = await scan();
  check('C7b 日志时间恰等于对账时间允许进入批次',
    r.counts.invalidLogs === 0 && oneStatus(r, 'running'));
  setup();
  log('f6', 'future_at', 'prepare', new Date(now.getTime() + 1));
  r = await scan();
  check('C7c 未来日志拒绝并计入 invalidLogs',
    r.ok === false && r.code === 'RECONCILE_ANOMALIES' &&
    r.counts.invalidLogs === 1 && r.batches.length === 0);

  setup();
  log('g1', 'page_a', 'prepare', new Date(now - 1000));
  log('g2', 'page_a', 'complete', new Date(now - 900));
  log('g3', 'page_b', 'prepare', new Date(now - 800));
  log('g4', 'page_b', 'complete', new Date(now - 700));
  log('g5', 'page_c', 'prepare', new Date(now - 600));
  log('g6', 'page_c', 'complete', new Date(now - 500));
  r = await scan({ pageSize: 2 });
  check('C8 多页扫描稳定推进，完整结果三批闭合', r.scanned === 6 && r.pages >= 3 &&
    r.counts.closed === 3 && !r.truncated && r.completeScan);
  const pairedPartial = await scan({ pageSize: 2, maxRows: 2 });
  check('C8b 截断窗口内已配对也不冒充全局闭合', pairedPartial.truncated &&
    pairedPartial.counts.pairedWindow === 1 && pairedPartial.counts.closed === 0);
  const partial = await scan({ pageSize: 1, maxRows: 1 });
  check('C9 截断窗口明确非成功且可继续，不误判孤儿',
    partial.ok === false && partial.code === 'SCAN_TRUNCATED' &&
    partial.truncated === true && partial.completeScan === false &&
    typeof partial.nextCursor === 'string' && partial.nextCursor === 'g1' &&
    partial.counts.unmatchedWindow === 1 &&
    partial.counts.suspectedOrphan === 0);
  const continued = await scan({ cursor: partial.nextCursor, pageSize: 1, maxRows: 2 });
  check('C10 续页为局部窗口，缺配对不能冒充全局结论',
    !continued.completeScan && continued.counts.unmatchedWindow >= 1);

  setup();
  log('h1', 'interrupted', 'prepare', new Date(now - 1000));
  log('h2', 'interrupted', 'complete', new Date(now - 900));
  h.setFail({ collection: 'upload_logs', op: 'get', atCall: 2 });
  r = await scan({ pageSize: 1 }); h.clearFail();
  check('C11 第二页读取故障不返回假完整结论', r.code === 'DATABASE_ERROR' &&
    r.scanned === 1 && r.truncated && !r.completeScan);

  setup();
  r = await fn.main({ action: 'reconcile', eventType: 'retention_mark' }, {});
  check('C12 无令牌在读取日志前拒绝', r.code === 'FORBIDDEN' &&
    h.calls('upload_logs').length === 0 && h.calls('submissions').length === 0);

  setup();
  log('i1', 'private_batch', 'prepare', new Date(now - 1000),
    { note: 'private-body', actor: { role: 'system', openidHash: 'private-openid' } });
  const before = JSON.stringify(h.state.docs);
  const updates = h.state.updateCalls, removes = h.state.removeCalls;
  const adds = h.calls('upload_logs').filter(function (x) { return x === 'add'; }).length;
  r = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
    maintenanceToken: 'offline-secret' }, {});
  check('C13 鉴权后对账只读，不更改投稿或审计日志',
    JSON.stringify(h.state.docs) === before && h.state.updateCalls === updates &&
    h.state.removeCalls === removes && h.calls('upload_logs').filter(function (x) { return x === 'add'; }).length === adds);
  check('C14 返回值不含正文、身份、令牌',
    !/private-body|private-openid|offline-secret/.test(JSON.stringify(r)));

  setup();
  r = await T.recoverPending({ now: now });
  const recoveryLogs = h.docs('upload_logs').filter(function (x) {
    return x.result && x.result.stats && x.result.stats.operation === 'recoverPending';
  });
  check('C15 R1 恢复批次沿用 prepare/complete，计数闭合', recoveryLogs.length === 2 &&
    recoveryLogs[0].result.stats.phase === 'prepare' &&
    recoveryLogs[1].result.stats.phase === 'complete' &&
    recoveryLogs[0].result.stats.batchId === recoveryLogs[1].result.stats.batchId &&
    recoveryLogs[1].result.stats.selected === recoveryLogs[1].result.stats.recovered +
    recoveryLogs[1].result.stats.deferred + recoveryLogs[1].result.stats.conflicts +
    recoveryLogs[1].result.stats.failed + recoveryLogs[1].result.stats.unprocessed);

  setup();
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
  r = await T.recoverPending({ now: now }); h.clearFail();
  check('C16 恢复 prepare 失败时未处理业务记录', r.code === 'LOG_FAILED' &&
    r.unprocessed === r.selected && h.state.updateCalls === 0);

  setup();
  const purgeNow = new Date();
  const eventId = 'retention_purge_' + crypto.createHash('sha256').update('purge1\0' + '2').digest('hex');
  h.seed('submissions', { _id: 'purge1', status: 'approved', rev: 2, payload: null,
    createdAt: new Date(purgeNow.getTime() - 32 * 86400000), verifyStatus: 'unverified',
    retention: { purge: { state: 'pending', purgedRev: 2, eventId: eventId,
      day: purgeNow.toISOString().slice(0, 10), retryAfter: new Date(0) } } });
  r = await T.recoverPurgePending({ now: purgeNow });
  const purgeLogs = h.docs('upload_logs').filter(function (x) {
    return x.result && x.result.stats && x.result.stats.operation === 'recoverPurgePending';
  });
  check('C17 T-2 恢复批次有准备和完成，正文仍为空', r.recovered === 1 &&
    purgeLogs.length === 2 && purgeLogs[0].result.stats.phase === 'prepare' &&
    purgeLogs[1].result.stats.phase === 'complete' &&
    h.docs('submissions')[0].payload === null);
  const reconcileNow = new Date();
  const purgeReconciled = await T.reconcileBatches({ eventType: 'retention_purge', now: reconcileNow });
  check('C17b 清理恢复批次可被同一对账入口识别',
    purgeLogs.length === 2 && purgeLogs.every(function (x) {
      return x.at instanceof Date && x.at.getTime() <= reconcileNow.getTime();
    }) && purgeReconciled.ok === true && purgeReconciled.code === 'OK' &&
    purgeReconciled.counts.closed === 1 && purgeReconciled.counts.invalidLogs === 0);

  setup();
  log('j1', 'invalid_actor', 'prepare', new Date(now - 1000),
    { actor: { role: 'system', openidHash: 'invented' } });
  log('j2', 'wrong_submission', 'prepare', new Date(now - 1000), { submissionId: 'user-id' });
  r = await scan();
  check('C19 系统身份字段和批次投稿 ID 不合规可检测且不回显',
    r.counts.invalidLogs === 2 && !JSON.stringify(r).includes('user-id'));

  setup();
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  r = await T.recoverPending({ now: now }); h.clearFail();
  check('C20 恢复 complete 写入失败不得谎报闭合', r.code === 'LOG_FAILED' &&
    r.logged === false && h.docs('upload_logs').length === 1 &&
    h.docs('upload_logs')[0].result.stats.phase === 'prepare');

  setup();
  log('k1', 'partial_batch', 'prepare', new Date(now - 1000),
    { stats: { selected: 2, unprocessed: 2 } });
  log('k2', 'partial_batch', 'complete', new Date(now - 900),
    { stats: { selected: 2, marked: 1, markedAudited: 1, failed: 1 } });
  h.state.docs.upload_logs[1].result.code = 'PARTIAL';
  r = await scan();
  check('C21 PARTIAL 计数闭合仍不得报告正常成功', r.ok === false &&
    r.code === 'RECONCILE_ANOMALIES' && oneStatus(r, 'closed') &&
    r.batches[0].completeCode === 'PARTIAL' && r.batches[0].outcome === 'PARTIAL' &&
    r.counts.outcomes.PARTIAL === 1 && r.counts.outcomes.OK === 0);

  setup();
  log('l1', 'failed_batch', 'prepare', new Date(now - 1000));
  log('l2', 'failed_batch', 'complete', new Date(now - 900),
    { stats: { marked: 0, markedAudited: 0, failed: 1 } });
  h.state.docs.upload_logs[1].result.code = 'FAILED';
  r = await scan();
  check('C22 FAILED 计数闭合仍不得报告正常成功', r.ok === false &&
    r.code === 'RECONCILE_ANOMALIES' && oneStatus(r, 'closed') &&
    r.batches[0].completeCode === 'FAILED' && r.batches[0].outcome === 'FAILED' &&
    r.counts.outcomes.FAILED === 1 && r.counts.outcomes.OK === 0);

  setup();
  const recoverStats = { operation: 'recoverPending', selected: 1, recovered: 0,
    deferred: 1, conflicts: 0, failed: 0, unprocessed: 0 };
  log('m1', 'deferred_batch', 'prepare', new Date(now - 1000),
    { stats: Object.assign({}, recoverStats, { deferred: 0, unprocessed: 1 }) });
  log('m2', 'deferred_batch', 'complete', new Date(now - 900), { stats: recoverStats });
  h.state.docs.upload_logs[1].result.code = 'DEFERRED';
  r = await scan();
  check('C23 DEFERRED 与失败和正常成功分别表达', r.ok === false &&
    r.code === 'RECONCILE_DEFERRED' && oneStatus(r, 'closed') &&
    r.batches[0].outcome === 'DEFERRED' && r.counts.outcomes.DEFERRED === 1);

  setup();
  log('n1', 'false_success', 'prepare', new Date(now - 1000));
  log('n2', 'false_success', 'complete', new Date(now - 900),
    { stats: { marked: 0, markedAudited: 0, failed: 1 } });
  r = await scan();
  check('C24 COMPLETE 与失败计数矛盾时归计数异常，不宣称 OK',
    r.ok === false && r.code === 'RECONCILE_ANOMALIES' &&
    oneStatus(r, 'countMismatch') && r.batches[0].outcome === null &&
    r.counts.outcomes.OK === 0);

  setup();
  const purgeStats = { operation: 'purge', selected: 1, purged: 0,
    purgedAudited: 0, auditFailedCount: 0, deferredAudit: 0,
    deferredRetry: 0, skipped: 0, conflicts: 0, failed: 1, unprocessed: 0 };
  log('o1', 'purge_partial', 'prepare', new Date(now - 1000),
    { event: 'retention_purge', action: 'retention_purge',
      stats: Object.assign({}, purgeStats, { failed: 0, unprocessed: 1 }) });
  log('o2', 'purge_partial', 'complete', new Date(now - 900),
    { event: 'retention_purge', action: 'retention_purge', stats: purgeStats });
  h.state.docs.upload_logs[1].result.code = 'PARTIAL';
  r = await T.reconcileBatches({ eventType: 'retention_purge', now: now });
  check('C25 T-2 清理部分失败也保留 PARTIAL 结果', r.ok === false &&
    r.code === 'RECONCILE_ANOMALIES' && oneStatus(r, 'closed') &&
    r.batches[0].outcome === 'PARTIAL' && r.counts.outcomes.PARTIAL === 1);

  const schema = require('../config/cloud/schema.upload_logs.json');
  check('C18 索引仅为本地草案且日志仍禁止更新/删除',
    schema._meta.status === 'pending_admin_console_verification' &&
    schema.indexes.some(function (x) { return x.name === 'ix_retention_reconcile_event_id'; }) &&
    schema.appendOnly.forbidden.indexOf('collection.update') !== -1);

  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
