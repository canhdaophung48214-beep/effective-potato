'use strict';
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-30T12:00:00.000Z');
let pass = 0, fail = 0;
function check(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (ok) pass++; else fail++; }
function reset() {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
}
function seed(id) {
  h.seed('submissions', { _id: id, status: 'approved', rev: 1,
    createdAt: new Date(now.getTime() - 31 * 86400000),
    payload: { text: 'private-' + id } });
}
function row(id) { return h.docs('submissions').find(x => x._id === id); }
function snapshots() { return JSON.stringify(h.docs('upload_logs')); }
async function run() {
  reset(); seed('busy');
  const owner = 'a'.repeat(32);
  const held = await T.acquirePurgeLease(row('busy'), now, owner);
  const payloadBefore = JSON.stringify(row('busy').payload);
  const revBefore = row('busy').rev;
  const first = await T.purgePayload({ now: new Date(now.getTime() + 1000) });
  check('D1 LOCK_BUSY 仅追加准备与未开始回执，不写业务正文或 rev',
    held.ok && first.code === 'PURGE_NOT_STARTED' && first.purged === 0 &&
    first.notStartedReason === 'LOCK_BUSY' && first.zeroBusinessWrites === true &&
    row('busy').rev === revBefore && JSON.stringify(row('busy').payload) === payloadBefore);
  const receipt = h.docs('upload_logs').find(x => x.result.code === 'DEFERRED_NOT_STARTED');
  check('D2 明确事件保留原因和零写入证据，不伪装 COMPLETE',
    receipt && receipt.result.stats.notStartedReason === 'LOCK_BUSY' &&
    receipt.result.stats.zeroBusinessWrites === true &&
    !h.docs('upload_logs').some(x => x.result.code === 'COMPLETE'));
  const checked = await T.reconcileBatches({ eventType: 'retention_purge' });
  check('D3 完整对账保留未开始结果，且不把它当作历史失败',
    checked.ok && checked.code === 'OK' && checked.counts.outcomes.DEFERRED_NOT_STARTED === 1 &&
    checked.batches[0].outcome === 'DEFERRED_NOT_STARTED');
  const released = await T.releasePurgeLease('busy', owner, held.lock.fencingToken,
    new Date(now.getTime() + 2000));
  const second = await T.purgePayload({ now: new Date(now.getTime() + 3000) });
  check('D4 释放后重试可清理，旧未开始事件仍留存',
    released.ok && second.ok && second.purged === 1 && row('busy').payload === null &&
    h.docs('upload_logs').some(x => x.result.code === 'DEFERRED_NOT_STARTED'));
  const third = await T.purgePayload({ now: new Date(now.getTime() + 4000) });
  check('D5 重复执行不再清正文或重复逐条日志',
    third.purged === 0 && h.docs('upload_logs').filter(x => x.submissionId === 'busy').length === 1);

  reset(); seed('a_good'); seed('z_busy');
  const busyLease = await T.acquirePurgeLease(row('z_busy'), now, owner);
  const mixed = await T.purgePayload({ now: new Date(now.getTime() + 1000) });
  const mixedReconcile = await T.reconcileBatches({ eventType: 'retention_purge' });
  check('D6 部分清理后遇 LOCK_BUSY 保留阻断，不能冒充零写入',
    busyLease.ok && mixed.purged === 1 && mixed.deferredRetry === 1 &&
    mixed.code === 'PURGE_DEFERRED' && mixedReconcile.code === 'RECONCILE_DEFERRED' &&
    row('a_good').payload === null && row('z_busy').payload.text === 'private-z_busy');
  const before = JSON.stringify(row('z_busy').payload), beforeRev = row('z_busy').rev;
  await T.releasePurgeLease('z_busy', owner, busyLease.lock.fencingToken,
    new Date(now.getTime() + 2000));
  const blocked = await T.purgePayload({ now: new Date(now.getTime() + 3000) });
  check('D7 有业务写入的 DEFERRED 即使锁释放也继续阻断',
    blocked.code === 'AUDIT_GATE_BLOCKED' && JSON.stringify(row('z_busy').payload) === before &&
    row('z_busy').rev === beforeRev + 1);

  reset(); seed('tampered');
  const held2 = await T.acquirePurgeLease(row('tampered'), now, owner);
  await T.purgePayload({ now: new Date(now.getTime() + 1000) });
  const forged = h.state.docs.upload_logs.find(x => x.result.code === 'DEFERRED_NOT_STARTED');
  forged.result.stats.purged = 1;
  const invalid = await T.reconcileBatches({ eventType: 'retention_purge' });
  check('D8 零写入证据与实际计数矛盾则阻断',
    held2.ok && !invalid.ok && invalid.code === 'RECONCILE_ANOMALIES' &&
    row('tampered').payload.text === 'private-tampered');
  check('D9 对账只读，历史日志未被更新或删除',
    h.state.removeCalls === 0 && h.state.updateCalls === 1 && snapshots().includes('DEFERRED_NOT_STARTED'));
  console.log('T3.6.1 deferred: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
