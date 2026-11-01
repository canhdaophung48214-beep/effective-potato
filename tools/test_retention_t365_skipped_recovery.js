const assert = require('assert');
const { fixture } = require('./retention_t363_fixture');
async function run() {
  const f = fixture(); f.seed('real-zero', false); f.h.state.docs.submissions[0].rev = 0;
  const first = await f.T.purgePayload({ now: f.now, requestId: 't365-zero' });
  assert.equal(first.skipped, 1); assert.equal(first.code, 'PURGE_DEFERRED');
  assert.equal(f.row('real-zero').rev, 1); assert(f.row('real-zero').payload);
  const logs = f.batch('t365-zero'); const original = JSON.stringify(logs);
  const prepare = logs.find(x => x.result.stats.phase === 'prepare');
  const reason = logs.find(x => x.result.stats.phase === 'complete').result.stats.deferredReasons[0];
  assert.strictEqual(prepare.result.stats.selectedEvidence[0].rev, 0);
  assert.strictEqual(reason.revBefore, 0); assert.strictEqual(reason.revAfter, 1);
  const resolved = await f.T.resolveDeferredBatch({ batchId: 't365-zero' }); assert(resolved.ok);
  const scan = await f.T.reconcileBatches({ eventType: 'retention_purge', resumable: true });
  assert(scan.ok); assert.equal(scan.counts.resolvedDeferred, 1); assert.equal(scan.counts.outcomes.DEFERRED, 1);
  assert.equal(JSON.stringify(f.batch('t365-zero').filter(x => x.result.stats.phase !== 'resolution')), original);
  const next = await f.T.purgePayload({ now: new Date(f.now.getTime() + 61000), requestId: 't365-zero-new' });
  assert(next.ok); assert.equal(next.purged, 1); assert.strictEqual(f.row('real-zero').payload, null);
  assert.equal((await f.T.resolveDeferredBatch({ batchId: 't365-zero' })).code, 'ALREADY_RESOLVED');
  for (const rev of [undefined, null, -1, 0.5]) {
    const g = fixture(); g.seed('invalid', false); g.h.state.docs.submissions[0].rev = rev;
    await g.T.purgePayload({ now: g.now, requestId: 'invalid' });
    assert(!(await g.T.resolveDeferredBatch({ batchId: 'invalid' })).ok); assert(g.row('invalid').payload);
  }
  console.log('PASS T365 real skipped 0→1, strict resolve, immutable outcome, retry and invalid versions');
}
run().catch(e => { console.error(e); process.exitCode = 1; });
