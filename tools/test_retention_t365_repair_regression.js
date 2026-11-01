const assert = require('assert');
const { fixture } = require('./retention_t363_fixture');
async function zero(id) { const f = fixture(); f.seed(id, false); f.h.state.docs.submissions[0].rev = 0;
  await f.T.purgePayload({ now: f.now, requestId: id }); return f; }
async function run() {
  const audit = fixture(); audit.seed('audit', true);
  await audit.T.purgePayload({ now: audit.now, requestId: 'audit' });
  audit.h.state.docs.submissions[0].retention.audit.state = 'complete';
  assert.equal((await audit.T.disposeDeferredBatch({ batchId: 'audit' })).code, 'BLOCKED_UNCERTAIN');
  assert(audit.row('audit').payload);
  const missing = await zero('missing-attempt');
  assert((await missing.T.disposeDeferredBatch({ batchId: 'missing-attempt' })).ok);
  missing.h.state.docs.upload_logs = missing.h.state.docs.upload_logs.filter(x => x.event !== 'retention_deferred_attempt');
  assert(!(await missing.T.reconcileBatches({ eventType: 'retention_purge', resumable: true })).ok);
  for (const field of ['actor', 'action']) {
    const metadata = await zero('tampered-' + field);
    assert((await metadata.T.disposeDeferredBatch({ batchId: 'tampered-' + field })).ok);
    const attempt = metadata.h.state.docs.upload_logs.find(x => x.event === 'retention_deferred_attempt');
    if (field === 'actor') attempt.actor.role = 'admin';
    else attempt.action = 'forged_action';
    assert(!(await metadata.T.reconcileBatches({ eventType: 'retention_purge' })).ok);
    assert(!(await metadata.T.retryDeferredAttempt({ batchId: 'tampered-' + field,
      submissionId: 'tampered-' + field })).ok);
  }
  const sealed = await zero('forged-resolution');
  assert((await sealed.T.disposeDeferredBatch({ batchId: 'forged-resolution' })).ok);
  sealed.h.state.docs.upload_logs.find(x => x.result.code === 'DEFERRED_RESOLUTION').result.stats.items[0].reasonCode = 'RECORD_ABSENT';
  assert(!(await sealed.T.reconcileBatches({ eventType: 'retention_purge' })).ok);
  const uncertain = await zero('uncertain-write'); uncertain.h.setFail({ collection: 'upload_logs', op: 'add' });
  assert.equal((await uncertain.T.disposeDeferredBatch({ batchId: 'uncertain-write' })).code, 'BLOCKED_UNCERTAIN');
  assert(uncertain.row('uncertain-write').payload);
  const missingManifest = await zero('missing-manifest');
  delete missingManifest.h.state.docs.upload_logs.find(x => x.result.stats.phase === 'prepare').result.stats.selectedEvidence;
  assert.equal((await missingManifest.T.disposeDeferredBatch({ batchId: 'missing-manifest' })).code, 'BLOCKED_UNCERTAIN');
  const noGate = await zero('gate'); assert((await noGate.T.disposeDeferredBatch({ batchId: 'gate' })).ok);
  noGate.seed('unresolved-audit', true);
  const guarded = await noGate.T.retryDeferredAttempt({ batchId: 'gate', submissionId: 'gate', now: new Date(noGate.now.getTime()+61000) }, { reconcile: async () => ({ok:false, completeScan:false}) });
  assert(!guarded.ok); assert(noGate.row('gate').payload);
  console.log('PASS T365 audit proof, absent attempt, forged resolution, uncertain writes, missing manifest, guarded retry');
}
run().catch(e => { console.error(e.stdout ? e.stdout.toString() : e); process.exitCode = 1; });
