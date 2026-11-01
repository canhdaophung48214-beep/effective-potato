'use strict';

const crypto = require('crypto');
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-30T12:00:00.000Z');
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
function batch(id, code, stats) {
  for (const phase of ['prepare', 'complete']) {
    const complete = phase === 'complete';
    h.seed('upload_logs', { _id: id + '_' + phase, schemaVersion: 1,
      event: 'retention_mark', action: 'retention_mark', submissionId: null,
      day: '2026-10-30', at: new Date(now.getTime() - (complete ? 500 : 1000)),
      rev: 1, actor: { role: 'system', openidHash: null }, result: {
        code: complete ? code : 'PREPARE',
        stats: Object.assign({ phase: phase, operation: 'mark', batchId: id,
          selected: 1, marked: 0, markedAudited: 0, auditFailedCount: 0,
          skipped: 0, conflicts: 0, failed: complete ? 1 : 0,
          unprocessed: complete ? 0 : 1 }, complete ? stats : {}) } });
  }
}
function eventId(id, rev) {
  return 'retention_mark_' + crypto.createHash('sha256')
    .update(id + '\0' + rev).digest('hex');
}
function scan() { return T.reconcileBatches({ eventType: 'retention_mark', now: now }); }
async function run() {
  setup();
  batch('failed_old', 'FAILED');
  const originals = JSON.stringify(h.docs('upload_logs'));
  const failed = await scan();
  check('H1 无逐条关联证据的历史 FAILED 仍为异常', failed.ok === false &&
    failed.code === 'RECONCILE_ANOMALIES' && failed.counts.outcomes.FAILED === 1 &&
    failed.batches[0].outcome === 'FAILED');
  const denied = await fn.main({ action: 'repair', maintenanceToken: 'offline-secret',
    batchId: 'failed_old', force: true });
  check('H2 无 force/ignore-history 绕过入口且原始日志不变',
    denied.code === 'INVALID_ACTION' && JSON.stringify(h.docs('upload_logs')) === originals &&
    h.updateCalls() === 0 && h.removeCalls() === 0);

  setup();
  batch('partial_old', 'PARTIAL', { marked: 1, markedAudited: 0,
    auditFailedCount: 1, failed: 0 });
  const id = 'record-with-marker';
  h.seed('submissions', { _id: id, status: 'expired', rev: 2,
    createdAt: new Date(now.getTime() - 31 * 86400000), payload: { text: 'private' },
    retention: { audit: { state: 'pending', markedRev: 2,
      eventId: eventId(id, 2), day: '2026-10-30', retryAfter: new Date(0) } } });
  const originalTwo = JSON.stringify(h.docs('upload_logs'));
  const pre = await scan();
  const recovered = await T.recoverAudit(id);
  const repeated = await T.recoverAudit(id);
  const post = await scan();
  const all = h.docs('upload_logs');
  check('H3 待补逐条审计能恢复且稳定事件 ID 不重复',
    pre.code === 'RECONCILE_ANOMALIES' && recovered.code === 'OK' &&
    repeated.code === 'ALREADY_RECOVERED' && recovered.rev === 3 &&
    all.filter(function (x) { return x.submissionId === id; }).length === 1);
  check('H4 逐条恢复不伪造历史 PARTIAL 已修复', post.ok === false &&
    post.code === 'RECONCILE_ANOMALIES' && post.counts.outcomes.PARTIAL === 1 &&
    post.batches[0].outcome === 'PARTIAL' &&
    JSON.stringify(all.slice(0, 2)) === originalTwo);
  check('H5 修复尝试仍不清正文或改写原始批次',
    h.docs('submissions')[0].payload.text === 'private' &&
    h.docs('submissions')[0].rev === 3 && h.removeCalls() === 0 &&
    all.slice(0, 2).every(function (x) { return x.result.code !== 'COMPLETE'; }));

  setup();
  batch('failed_no_marker', 'FAILED');
  h.seed('submissions', { _id: 'unrecoverable', status: 'approved', rev: 1,
    createdAt: new Date(now.getTime() - 31 * 86400000), payload: { text: 'private' } });
  const noEvidence = await T.recoverAudit('unrecoverable');
  const again = await scan();
  check('H6 缺失原始关联证据的记录不能凭 batchId 人工补成功',
    noEvidence.code === 'NO_PENDING_AUDIT' && again.code === 'RECONCILE_ANOMALIES' &&
    h.docs('submissions')[0].payload.text === 'private' &&
    h.docs('upload_logs').length === 2);

  setup();
  batch('partial_retry', 'PARTIAL', { marked: 1, markedAudited: 0,
    auditFailedCount: 1, failed: 0 });
  h.seed('submissions', { _id: 'retry-record', status: 'expired', rev: 2,
    createdAt: new Date(now.getTime() - 31 * 86400000), payload: { text: 'private' },
    retention: { audit: { state: 'pending', markedRev: 2,
      eventId: eventId('retry-record', 2), day: '2026-10-30', retryAfter: new Date(0) } } });
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
  const failedWrite = await T.recoverAudit('retry-record');
  h.clearFail();
  const retryWrite = await T.recoverAudit('retry-record');
  const afterRetry = await scan();
  check('H7 逐条补记日志失败后可重试且不重复写原批次',
    failedWrite.code === 'LOG_FAILED' && retryWrite.code === 'OK' &&
    h.docs('upload_logs').length === 3 && h.docs('submissions')[0].rev === 3 &&
    afterRetry.code === 'RECONCILE_ANOMALIES' && afterRetry.counts.outcomes.PARTIAL === 1);

  console.log('T3.6 repair: ' + pass + ' PASS / ' + fail + ' FAIL; positive historical repair PENDING');
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
