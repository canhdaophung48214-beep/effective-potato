'use strict';
const { fixture } = require('./retention_t363_fixture');
let pass = 0, fail = 0;
function check(name, okay) { console.log((okay ? 'PASS ' : 'FAIL ') + name); okay ? pass++ : fail++; }

async function run() {
  const f = fixture();
  f.seed('audit-chain', true);
  const deferred = await f.T.purgePayload({ now: f.now, requestId: 't363-audit-original' });
  const originalLogs = JSON.stringify(f.batch('t363-audit-original'));
  check('A1 audit.pending 产生 DEFERRED 且正文不变',
    deferred.code === 'PURGE_DEFERRED' && deferred.deferredAudit === 1 &&
    f.row('audit-chain').payload.text === 'private-audit-chain');
  const before = await f.T.resolveDeferredBatch({ batchId: 't363-audit-original' });
  check('A2 补记前不能解除阻断', !before.ok && before.code === 'DEFERRED_RECORD_CHANGED');
  const recovered = await f.T.recoverPending({ now: new Date(f.now.getTime() + 1000) });
  check('A3 recoverPending 写入逐条审计且清除 pending', recovered.ok &&
    f.row('audit-chain').retention.audit.state === 'complete' &&
    f.h.docs('upload_logs').some(x => x.event === 'retention_mark' &&
      x.submissionId === 'audit-chain' && x.result.code === 'OK'));
  const resolution = await f.fn.main({ action: 'resolveDeferredBatch',
    batchId: 't363-audit-original', maintenanceToken: 'offline-t363-secret' }, {});
  const scan = await f.T.reconcileBatches({ eventType: 'retention_purge', resumable: true });
  check('A4 追加凭证经完整对账变为 RESOLVED_DEFERRED', resolution.ok &&
    scan.ok && scan.completeScan && scan.counts.resolvedDeferred === 1 &&
    scan.batches.some(x => x.resolutionState === 'RESOLVED_DEFERRED' && x.outcome === 'DEFERRED'));
  check('A5 原 DEFERRED 日志逐字节保持不变',
    JSON.stringify(f.batch('t363-audit-original').filter(x => x.result.stats.phase !== 'resolution')) === originalLogs);
  const repeat = await f.T.resolveDeferredBatch({ batchId: 't363-audit-original' });
  check('A6 重复恢复幂等', repeat.ok && repeat.code === 'ALREADY_RESOLVED' &&
    f.batch('t363-audit-original').filter(x => x.result.code === 'DEFERRED_RESOLUTION').length === 1);
  const next = await f.T.purgePayload({ now: new Date(f.now.getTime() + 61000),
    requestId: 't363-audit-next' });
  check('A7 新批次可清正文且原批次 ID 未复用', next.ok && next.purged === 1 &&
    f.row('audit-chain').payload === null && f.batch('t363-audit-next').length === 2);

  const g = fixture();
  g.seed('audit-drift', true);
  await g.T.purgePayload({ now: g.now, requestId: 't363-drift' });
  await g.T.recoverPending({ now: new Date(g.now.getTime() + 1000) });
  g.h.state.docs.submissions.find(x => x._id === 'audit-drift').rev++;
  const drift = await g.T.resolveDeferredBatch({ batchId: 't363-drift' });
  check('A8 审计补记后 rev 漂移拒绝恢复并保持正文', !drift.ok &&
    drift.code === 'DEFERRED_REV_CONFLICT' && g.row('audit-drift').payload.text === 'private-audit-drift');

  console.log('T3.6.3 audit recovery: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
