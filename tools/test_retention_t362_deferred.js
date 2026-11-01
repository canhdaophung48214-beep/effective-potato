'use strict';
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness(), fn = h.loadFunction('cloudfunctions/retention/index.js'), T = fn.__test__;
const now = new Date('2026-10-30T12:00:00Z'), day = 86400000;
let pass = 0, fail = 0;
function check(n, x) { console.log((x ? 'PASS ' : 'FAIL ') + n); x ? pass++ : fail++; }
function reset() { h.reset(); Object.assign(process.env, { UGC_RETENTION_POLICY_STATUS: 'confirmed',
  UGC_RETENTION_MARK_AFTER_DAYS: '29', UGC_RETENTION_BATCH_LIMIT: '10',
  UGC_RETENTION_CONFIRMED_BY: 'offline-test', UGC_RETENTION_TRIGGER_TOKEN: 'offline-secret' }); }
function seed(id, status, retry) { h.seed('submissions', { _id: id, status: status || 'approved', rev: 1,
  createdAt: new Date(now.getTime() - 31 * day), payload: { text: 'private-' + id },
  retention: retry ? { purge: { retryAfter: retry } } : undefined }); }
function row(id) { return h.docs('submissions').find(x => x._id === id); }
async function run() {
  reset(); seed('pending', 'pending'); seed('approved');
  const mix = await T.purgePayload({ now, requestId: 'needs-mark' });
  const repeat = await T.purgePayload({ now: new Date(now.getTime() + 1000) });
  check('D1 needsMark 独立统计，pending 不清且不阻断已审记录',
    mix.needsMark === 1 && mix.ok && mix.purged === 1 &&
    row('pending').payload.text === 'private-pending' && repeat.code === 'OK');

  reset(); seed('retry', 'approved', new Date(now.getTime() + 60000));
  const original = JSON.stringify(row('retry'));
  const deferred = await T.purgePayload({ now, requestId: 'retry-batch' });
  const early = await T.repairPurgeBatch({ batchId: 'retry-batch', now });
  check('D2 未到 retryAfter 的记录零写入、批次可观测但暂阻断',
    deferred.code === 'PURGE_DEFERRED' &&
    h.docs('upload_logs').some(x => x.result.code === 'DEFERRED_RETRYABLE') &&
    early.code === 'REPAIR_RETRY_NOT_READY' && JSON.stringify(row('retry')) === original);
  const fixed = await T.repairPurgeBatch({ batchId: 'retry-batch',
    now: new Date(now.getTime() + 61000) });
  const cleaned = await T.purgePayload({ now: new Date(now.getTime() + 62000) });
  check('D3 到期后追加修复并完整对账，历史 DEFERRED_RETRYABLE 保留',
    fixed.ok && cleaned.ok && cleaned.purged === 1 && row('retry').payload === null &&
    h.docs('upload_logs').some(x => x.result.code === 'DEFERRED_RETRYABLE'));

  reset(); seed('conflict'); h.setForceUpdateZero(true);
  const conflict = await T.purgePayload({ now, requestId: 'cas-batch' });
  h.setForceUpdateZero(false);
  check('D4 CAS 明确未匹配且复读版本/正文未变可列为可重试',
    conflict.conflicts === 1 && conflict.purged === 0 && row('conflict').rev === 1 &&
    row('conflict').payload.text === 'private-conflict' &&
    h.docs('upload_logs').some(x => x.result.code === 'DEFERRED_RETRYABLE'));
  const fixedConflict = await T.repairPurgeBatch({ batchId: 'cas-batch',
    now: new Date(now.getTime() + 61000) });
  const retried = await T.purgePayload({ now: new Date(now.getTime() + 62000) });
  check('D5 CAS 冲突证据经复核后可重试', fixedConflict.ok && retried.ok &&
    retried.purged === 1 && row('conflict').payload === null);

  reset(); seed('audit'); h.state.docs.submissions[0].retention = { audit: { state: 'pending' } };
  const blocked = await T.purgePayload({ now, requestId: 'audit-blocked' });
  const second = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
  check('D6 audit.pending 引起实际退避更新，保持全局阻断',
    blocked.deferredAudit === 1 && blocked.code === 'PURGE_DEFERRED' &&
    second.code === 'AUDIT_GATE_BLOCKED' && row('audit').payload.text === 'private-audit');

  reset(); seed('uncertain'); h.setAfterWriteFail({ collection: 'submissions', op: 'update', atCall: 1 });
  const uncertain = await T.purgePayload({ now, requestId: 'uncertain-batch' });
  h.clearAfterWriteFail();
  const uncertainAgain = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
  check('D7 写入回执不确定不能归为可重试 DEFERRED',
    uncertain.code === 'PURGE_PARTIAL' && uncertainAgain.code === 'AUDIT_GATE_BLOCKED' &&
    row('uncertain').payload.text === 'private-uncertain');
  console.log('T3.6.2 deferred: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
