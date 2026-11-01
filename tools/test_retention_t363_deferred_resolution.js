'use strict';
const crypto = require('crypto');
const { fixture } = require('./retention_t363_fixture');
let pass = 0, fail = 0;
function check(name, okay) { console.log((okay ? 'PASS ' : 'FAIL ') + name); okay ? pass++ : fail++; }
function digest(value) {
  const key = crypto.createHash('sha256').update('retention-reconcile-v1\0offline-t363-secret').digest();
  return crypto.createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
}
function batchId(id, phase) { return 'retention_purge_batch_' + phase + '_' +
  crypto.createHash('sha256').update(id).digest('hex'); }
function addHistoricalSkipped(f, id) {
  const row = f.h.state.docs.submissions.find(x => x._id === id);
  const batch = 't363-skipped-historical';
  const manifest = [{ id, rev: 1, status: 'expired', payloadProof: digest(row.payload) }];
  const reasons = [{ id, reasonCode: 'SKIPPED_RECHECK', originalRev: 1,
    observedRev: 2, recoveryAction: 'recheckSubmission' }];
  row.rev = 2;
  row.retention = { purge: { retryAfter: new Date(f.now.getTime() + 60000) } };
  const base = { operation: 'purge', batchId: batch, selected: 1, purged: 0,
    purgedAudited: 0, auditFailedCount: 0, deferredAudit: 0, deferredRetry: 0,
    skipped: 1, conflicts: 0, failed: 0, unprocessed: 0, needsMark: 0 };
  for (const phase of ['prepare', 'complete']) {
    const stats = Object.assign({ phase }, base, phase === 'prepare' ?
      { selectedEvidence: manifest, evidenceDigest: digest(manifest) } :
      { deferredReasons: reasons, deferredDigest: digest(reasons) });
    f.h.seed('upload_logs', { _id: batchId(batch, phase), schemaVersion: 1,
      event: 'retention_purge', action: 'retention_purge', submissionId: null,
      day: f.now.toISOString().slice(0, 10), result: { code: phase === 'prepare' ? 'PREPARE' : 'DEFERRED', stats },
      errorCode: '', actor: { role: 'system', openidHash: null },
      at: new Date(f.now.getTime() - (phase === 'prepare' ? 2 : 1)), rev: 1 });
  }
  return batch;
}

async function run() {
  const f = fixture();
  f.seed('skipped-record', false);
  const batch = addHistoricalSkipped(f, 'skipped-record');
  const original = JSON.stringify(f.batch(batch));
  const result = await f.T.resolveDeferredBatch({ batchId: batch });
  const scan = await f.T.reconcileBatches({ eventType: 'retention_purge', resumable: true });
  check('D1 历史 skipped 清单逐条复读后追加恢复凭证', result.ok &&
    result.code === 'RESOLVED_DEFERRED' && f.batch(batch).some(x => x.result.code === 'DEFERRED_RESOLUTION'));
  check('D2 对账保留原 DEFERRED 并派生 RESOLVED_DEFERRED', scan.ok &&
    scan.counts.outcomes.DEFERRED === 1 && scan.counts.resolvedDeferred === 1 &&
    scan.batches[0].resolutionState === 'RESOLVED_DEFERRED');
  check('D3 原始 prepare/complete 字节保持不变',
    JSON.stringify(f.batch(batch).filter(x => x.result.stats.phase !== 'resolution')) === original);
  const repeat = await f.T.resolveDeferredBatch({ batchId: batch });
  check('D4 重复恢复不重复追加', repeat.ok && repeat.code === 'ALREADY_RESOLVED' &&
    f.batch(batch).filter(x => x.result.code === 'DEFERRED_RESOLUTION').length === 1);
  const next = await f.T.purgePayload({ now: new Date(f.now.getTime() + 61000), requestId: 't363-new' });
  check('D5 新批次使用不同 ID 并正常清理', next.ok && next.purged === 1 &&
    f.row('skipped-record').payload === null && f.batch('t363-new').length === 2);
  const g = fixture();
  g.seed('skipped-drift', false);
  const driftBatch = addHistoricalSkipped(g, 'skipped-drift');
  g.h.state.docs.submissions[0].rev++;
  const drift = await g.T.resolveDeferredBatch({ batchId: driftBatch });
  check('D6 未清记录 rev 漂移拒绝追加并保持正文', !drift.ok &&
    drift.code === 'DEFERRED_REV_CONFLICT' && g.row('skipped-drift').payload.text === 'private-skipped-drift' &&
    !g.batch(driftBatch).some(x => x.result.code === 'DEFERRED_RESOLUTION'));
  const publicPurge = await f.fn.main({ action: 'purge', maintenanceToken: 'offline-t363-secret' }, {});
  check('D7 生产 purge 仍失败关闭', publicPurge.code === 'PURGE_GLOBAL_FENCE_UNVERIFIED');
  const mixed = fixture();
  mixed.seed('mixed-audit', true);
  mixed.seed('mixed-clean', false);
  const firstMixed = await mixed.T.purgePayload({ now: mixed.now, requestId: 't363-mixed' });
  await mixed.T.recoverPending({ now: new Date(mixed.now.getTime() + 1000) });
  const resolvedMixed = await mixed.T.resolveDeferredBatch({ batchId: 't363-mixed' });
  check('D8 混合批次已清记录逐条日志与 rev 均须核验',
    firstMixed.code === 'PURGE_DEFERRED' && firstMixed.purged === 1 &&
    resolvedMixed.ok && mixed.row('mixed-clean').payload === null);
  console.log('T3.6.3 deferred resolution: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
