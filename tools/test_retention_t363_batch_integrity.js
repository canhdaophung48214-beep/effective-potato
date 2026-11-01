'use strict';
const crypto = require('crypto');
const { fixture } = require('./retention_t363_fixture');
let pass = 0, fail = 0;
function check(name, okay) { console.log((okay ? 'PASS ' : 'FAIL ') + name); okay ? pass++ : fail++; }
async function deferredAudit(id, batch) {
  const f = fixture();
  f.seed(id, true);
  await f.T.purgePayload({ now: f.now, requestId: batch });
  return f;
}
async function recover(f) {
  return f.T.recoverPending({ now: new Date(f.now.getTime() + 1000) });
}
function original(f, batch) { return f.h.state.docs.upload_logs.find(x =>
  x.result && x.result.stats && x.result.stats.batchId === batch &&
  x.result.stats.phase === 'prepare'); }

async function run() {
  const missing = await deferredAudit('missing-manifest', 't363-missing');
  await recover(missing);
  delete original(missing, 't363-missing').result.stats.selectedEvidence;
  const noManifest = await missing.T.resolveDeferredBatch({ batchId: 't363-missing' });
  check('I1 原批次清单缺失拒绝自动恢复', !noManifest.ok &&
    noManifest.code === 'DEFERRED_EVIDENCE_INVALID' && missing.row('missing-manifest').payload !== null);

  const uncertain = await deferredAudit('uncertain', 't363-uncertain');
  await recover(uncertain);
  const end = uncertain.h.state.docs.upload_logs.find(x => x.result && x.result.stats &&
    x.result.stats.batchId === 't363-uncertain' && x.result.stats.phase === 'complete');
  end.result.stats.failed = 1;
  const badCounts = await uncertain.T.resolveDeferredBatch({ batchId: 't363-uncertain' });
  check('I2 不确定写入或失败计数不能解除旧批次', !badCounts.ok &&
    badCounts.code === 'DEFERRED_EVIDENCE_INVALID' && uncertain.row('uncertain').payload !== null);

  const forged = await deferredAudit('forged', 't363-forged');
  await recover(forged);
  const good = await forged.T.resolveDeferredBatch({ batchId: 't363-forged' });
  const log = forged.h.state.docs.upload_logs.find(x => x.result &&
    x.result.code === 'DEFERRED_RESOLUTION');
  log.result.stats.items[0].observedRev += 1;
  const scan = await forged.T.reconcileBatches({ eventType: 'retention_purge', resumable: true });
  const body = JSON.stringify(forged.row('forged').payload), rev = forged.row('forged').rev;
  const blocked = await forged.T.purgePayload({ now: new Date(forged.now.getTime() + 61000),
    requestId: 't363-forged-next' });
  check('I3 伪造凭证密封校验失败并维持全局阻断', good.ok &&
    scan.code === 'RECONCILE_ANOMALIES' && scan.counts.invalidLogs > 0 &&
    blocked.code === 'AUDIT_GATE_BLOCKED' && JSON.stringify(forged.row('forged').payload) === body &&
    forged.row('forged').rev === rev);
  check('I4 阻断不写虚假成功批次', !forged.batch('t363-forged-next').length);

  const unresolved = await deferredAudit('unresolved', 't363-unresolved');
  await recover(unresolved);
  await unresolved.T.resolveDeferredBatch({ batchId: 't363-unresolved' });
  const unresolvedStats = unresolved.h.state.docs.upload_logs.find(x => x.result &&
    x.result.code === 'DEFERRED_RESOLUTION').result.stats;
  unresolvedStats.unresolvedCount = 1;
  const signedBody = Object.assign({}, unresolvedStats);
  delete signedBody.seal;
  const key = crypto.createHash('sha256').update('retention-reconcile-v1\0offline-t363-secret').digest();
  unresolvedStats.seal = crypto.createHmac('sha256', key)
    .update(JSON.stringify(signedBody)).digest('hex');
  const badResolution = await unresolved.T.reconcileBatches({ eventType: 'retention_purge', resumable: true });
  check('I5 unresolvedCount 非零不能被派生为已解决', !badResolution.ok &&
    badResolution.counts.resolvedDeferred === 0 && badResolution.counts.invalidLogs > 0);

  const interrupted = await deferredAudit('interrupted', 't363-interrupted');
  await recover(interrupted);
  const nextAdd = interrupted.h.calls('upload_logs').filter(x => x === 'add').length + 1;
  interrupted.h.setFail({ collection: 'upload_logs', op: 'add', atCall: nextAdd });
  const first = await interrupted.T.resolveDeferredBatch({ batchId: 't363-interrupted' });
  interrupted.h.clearFail();
  const retry = await interrupted.T.resolveDeferredBatch({ batchId: 't363-interrupted' });
  check('I6 恢复日志写入失败后重试可继续且不重复', !first.ok &&
    first.code === 'DEFERRED_LOG_UNCONFIRMED' && retry.ok &&
    interrupted.batch('t363-interrupted').filter(x => x.result.code === 'DEFERRED_RESOLUTION').length === 1);

  const auth = fixture();
  const callsBefore = JSON.stringify(auth.h.calls('upload_logs'));
  const denied = await auth.fn.main({ action: 'resolveDeferredBatch', batchId: 'any' }, {});
  check('I7 无维护令牌在审计查询前拒绝', denied.code === 'FORBIDDEN' &&
    JSON.stringify(auth.h.calls('upload_logs')) === callsBefore);

  const gate = fixture();
  gate.seed('gate-shape', false);
  const rejected = await gate.T.purgePayload({ now: gate.now, requestId: 't363-gate-shape' }, {
    reconcile: async () => ({ ok: true, code: 'OK' }) });
  check('I8 不能只信任 ok=true 而绕过完整对账结构',
    rejected.code === 'AUDIT_GATE_BLOCKED' && gate.row('gate-shape').payload.text === 'private-gate-shape' &&
    gate.row('gate-shape').rev === 1 && gate.batch('t363-gate-shape').length === 0);

  const badAudit = await deferredAudit('audit-log-invalid', 't363-audit-invalid');
  await recover(badAudit);
  badAudit.h.state.docs.upload_logs.find(x => x.event === 'retention_mark' &&
    x.submissionId === 'audit-log-invalid').actor.role = 'admin';
  const badAuditResult = await badAudit.T.resolveDeferredBatch({ batchId: 't363-audit-invalid' });
  check('I9 逐条审计角色被篡改时不能补写延期恢复凭证', !badAuditResult.ok &&
    badAuditResult.code === 'DEFERRED_AUDIT_MISSING' && badAudit.row('audit-log-invalid').payload !== null &&
    !badAudit.batch('t363-audit-invalid').some(x => x.result.code === 'DEFERRED_RESOLUTION'));

  const concurrent = await deferredAudit('two-instances', 't363-concurrent');
  await recover(concurrent);
  const secondFn = concurrent.h.loadFunction('cloudfunctions/retention/index.js');
  const both = await Promise.all([
    concurrent.T.resolveDeferredBatch({ batchId: 't363-concurrent', now: concurrent.now }),
    secondFn.__test__.resolveDeferredBatch({ batchId: 't363-concurrent',
      now: new Date(concurrent.now.getTime() + 1000) })
  ]);
  check('I10 两独立实例并发只追加一条稳定凭证且都可复核',
    both.every(x => x.ok) && concurrent.batch('t363-concurrent')
      .filter(x => x.result.code === 'DEFERRED_RESOLUTION').length === 1);

  console.log('T3.6.3 batch integrity: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
