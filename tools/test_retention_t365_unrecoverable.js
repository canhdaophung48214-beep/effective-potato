const assert = require('assert');
const { fixture } = require('./retention_t363_fixture');
async function setup(id) { const f = fixture(); f.seed(id, false); f.h.state.docs.submissions[0].rev = 0;
  await f.T.purgePayload({ now: f.now, requestId: id }); return f; }
async function run() {
  for (const disposition of ['RECORD_ABSENT', 'ALREADY_CLEARED', 'NO_LONGER_ELIGIBLE', 'REQUEUED_CURRENT_REV']) {
    const f = await setup(disposition); const original = JSON.stringify(f.batch(disposition));
    const row = f.h.state.docs.submissions[0];
    if (disposition === 'RECORD_ABSENT') f.h.state.docs.submissions.splice(0, 1);
    if (disposition === 'ALREADY_CLEARED') { row.payload = null; row.rev++; }
    if (disposition === 'NO_LONGER_ELIGIBLE') { row.status = 'pending'; row.rev++; }
    if (disposition === 'REQUEUED_CURRENT_REV') row.rev += 3;
    const observedBefore = JSON.stringify(f.h.docs('submissions'));
    const result = await f.fn.main({ action: 'disposeDeferredBatch', batchId: disposition,
      maintenanceToken: 'offline-t363-secret' }); assert(result.ok, JSON.stringify(result));
    const resolution = f.batch(disposition).find(x => x.result.stats.phase === 'resolution');
    const item = resolution.result.stats.items[0]; assert.equal(item.reasonCode, disposition);
    assert.equal(JSON.stringify(f.batch(disposition).filter(x => x.result.stats.phase !== 'resolution')), original);
    assert((await f.T.disposeDeferredBatch({ batchId: disposition })).ok);
    assert((await f.T.reconcileBatches({ eventType: 'retention_purge' })).ok);
    assert.equal(JSON.stringify(f.h.docs('submissions')), observedBefore);
    if (disposition === 'RECORD_ABSENT') assert.strictEqual(item.observedRev, null);
    if (disposition === 'REQUEUED_CURRENT_REV') {
      assert(item.nextBatchId && item.nextBatchId !== disposition);
      const publicRetry = await f.fn.main({ action: 'retryDeferredAttempt', batchId: disposition,
        submissionId: disposition, maintenanceToken: 'offline-t363-secret' });
      assert.equal(publicRetry.code, 'PURGE_GLOBAL_FENCE_UNVERIFIED');
      const retry = await f.T.retryDeferredAttempt({ batchId: disposition, submissionId: disposition,
        now: new Date(f.now.getTime() + 61000) }); assert(retry.ok, JSON.stringify(retry));
      assert.equal(retry.purged, 1); assert.strictEqual(f.row(disposition).payload, null);
      assert.equal(f.batch(item.nextBatchId).filter(x => x.event === 'retention_purge').length, 2);
    }
    if (disposition === 'NO_LONGER_ELIGIBLE') {
      assert.equal((await f.T.purgePayload({ now: new Date(f.now.getTime()+61000), requestId: 'pending-scan' })).purged, 0);
      assert.equal(JSON.stringify(f.h.docs('submissions')), observedBefore);
      row.status = 'expired'; row.rev++;
      const retry = await f.T.purgePayload({ now: new Date(f.now.getTime()+62000), requestId: 'reentered' });
      assert.equal(retry.purged, 1); assert.strictEqual(f.row(disposition).payload, null);
    }
  }
  const uncertain = await setup('read-error'); const readBefore = JSON.stringify(uncertain.h.docs('submissions')); uncertain.h.setFail({ collection: 'submissions', op: 'get' });
  assert.equal((await uncertain.T.disposeDeferredBatch({ batchId: 'read-error' })).code, 'BLOCKED_UNCERTAIN');
  assert.equal(JSON.stringify(uncertain.h.docs('submissions')), readBefore);
  assert(!uncertain.batch('read-error').some(x => x.result.stats.phase === 'resolution'));
  const missing = fixture(); assert.equal((await missing.T.disposeDeferredBatch({ batchId: 'missing' })).code, 'BLOCKED_UNCERTAIN');
  const forged = await setup('forged'); forged.h.state.docs.submissions[0].rev++;
  assert((await forged.T.disposeDeferredBatch({ batchId: 'forged' })).ok);
  const event = forged.h.state.docs.upload_logs.find(x => x.event === 'retention_deferred_attempt');
  event.result.stats.observedRev++;
  assert(!(await forged.T.reconcileBatches({ eventType: 'retention_purge' })).ok);
  assert(!(await forged.T.retryDeferredAttempt({ batchId: 'forged', submissionId: 'forged' })).ok);
  const drift = await setup('drift'); assert((await drift.T.disposeDeferredBatch({ batchId: 'drift' })).ok);
  drift.h.state.docs.submissions[0].rev++;
  assert.equal((await drift.T.retryDeferredAttempt({ batchId: 'drift', submissionId: 'drift' })).code, 'BLOCKED_UNCERTAIN');
  assert(drift.row('drift').payload);
  const auth = fixture(); assert.equal((await auth.fn.main({ action: 'disposeDeferredBatch', batchId: 'x' })).code, 'FORBIDDEN');
  console.log('PASS T365 terminal dispositions, authenticated retry, pending reentry, uncertainty, forged attempt and drift');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
