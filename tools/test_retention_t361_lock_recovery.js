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
function seed(id) { h.seed('submissions', { _id: id, status: 'approved', rev: 1,
  createdAt: new Date(now.getTime() - 31 * 86400000), payload: { text: 'private-' + id } }); }
function row(id) { return h.docs('submissions').find(x => x._id === id); }
async function run() {
  reset(); seed('normal');
  const ownerA = 'a'.repeat(32), ownerB = 'b'.repeat(32);
  const acquired = await T.acquirePurgeLease(row('normal'), now, ownerA);
  const released = await T.releasePurgeLease('normal', ownerA, acquired.lock.fencingToken,
    new Date(now.getTime() + 1000));
  const confirmed = await T.recoverPurgeLease('normal', ownerA, acquired.lock.fencingToken,
    new Date(now.getTime() + 2000));
  check('L1 正常释放后重复确认幂等，rev 不再递增',
    released.ok && confirmed.code === 'ALREADY_RELEASED' && row('normal').rev === 3 &&
    row('normal').payload.text === 'private-normal');

  reset(); seed('expired');
  const old = await T.acquirePurgeLease(row('expired'), now, ownerA);
  const busy = await T.recoverExpiredPurgeLease('expired', new Date(now.getTime() + 1000));
  const expired = await T.recoverExpiredPurgeLease('expired', new Date(now.getTime() + 31000));
  const again = await T.recoverExpiredPurgeLease('expired', new Date(now.getTime() + 32000));
  check('L2 未到期不释放；到期条件释放；再次恢复幂等',
    old.ok && busy.code === 'LOCK_BUSY' && expired.ok &&
    again.code === 'ALREADY_RELEASED' && row('expired').rev === 3 &&
    row('expired').payload.text === 'private-expired');

  reset(); seed('takeover');
  const first = await T.acquirePurgeLease(row('takeover'), now, ownerA);
  const second = await T.acquirePurgeLease(row('takeover'),
    new Date(now.getTime() + 31000), ownerB);
  const staleRelease = await T.recoverPurgeLease('takeover', ownerA, first.lock.fencingToken,
    new Date(now.getTime() + 32000));
  const staleWrite = await T.releasePurgeLease('takeover', ownerA, first.lock.fencingToken,
    new Date(now.getTime() + 32000));
  check('L3 新持有者接管后旧 token 既不能恢复释放也不能写入',
    first.ok && second.ok && staleRelease.code === 'LOCK_LOST' &&
    staleWrite.code === 'LOCK_LOST' && row('takeover').rev === 3 &&
    row('takeover').retention.purge.lock.owner === ownerB &&
    row('takeover').payload.text === 'private-takeover');

  reset(); seed('release-fail');
  h.setFail({ collection: 'submissions', op: 'update', atCall: 4 });
  const failedRelease = await T.purgePayload({ now, requestId: 'release-fail-batch' });
  h.clearFail();
  const beforeRepairRev = row('release-fail').rev;
  check('L4 清正文成功、释放失败：保留 PARTIAL、pending 依据与持有锁',
    failedRelease.code === 'PURGE_PARTIAL' && failedRelease.purged === 1 &&
    row('release-fail').payload === null && row('release-fail').retention.purge.lock.state === 'held' &&
    h.docs('upload_logs').some(x => x.result.code === 'PARTIAL') &&
    !h.docs('upload_logs').some(x => x.result.code === 'REPAIR_CONFIRMED'));
  const tooEarly = await T.recoverExpiredPurgeLease('release-fail', new Date(now.getTime() + 1000));
  const release = await T.recoverExpiredPurgeLease('release-fail', new Date(now.getTime() + 31000));
  const repaired = await T.repairPurgeBatch({ batchId: 'release-fail-batch',
    now: new Date(now.getTime() + 32000) });
  check('L5 租约过期确认释放后有证据修复批次，正文不重复清理',
    tooEarly.code === 'LOCK_BUSY' && release.ok && repaired.ok &&
    row('release-fail').payload === null && row('release-fail').rev === beforeRepairRev + 1 &&
    h.docs('upload_logs').filter(x => x.submissionId === 'release-fail').length === 1);
  const againPurge = await T.purgePayload({ now: new Date(now.getTime() + 33000) });
  check('L6 修复后重跑不重复写正文或逐条日志，旧 PARTIAL 原样保留',
    againPurge.ok && againPurge.purged === 0 && row('release-fail').payload === null &&
    h.docs('upload_logs').some(x => x.result.code === 'PARTIAL') &&
    h.docs('upload_logs').filter(x => x.submissionId === 'release-fail').length === 1);

  reset(); seed('ack-loss');
  h.setAfterWriteFail({ collection: 'submissions', op: 'update', atCall: 4 });
  const ambiguous = await T.purgePayload({ now, requestId: 'ack-loss-batch' });
  h.clearAfterWriteFail();
  const ackLock = row('ack-loss').retention.purge.lock;
  const confirmedAgain = await T.recoverPurgeLease('ack-loss', ackLock.owner,
    ackLock.fencingToken, new Date(now.getTime() + 1000));
  check('L6b 释放已落库但回执丢失时重新点读确认，不重复更新或谎报失败',
    ambiguous.ok && ambiguous.purged === 1 && ackLock.state === 'released' &&
    row('ack-loss').rev === 5 && confirmedAgain.code === 'ALREADY_RELEASED' &&
    h.docs('upload_logs').filter(x => x.submissionId === 'ack-loss').length === 1 &&
    !h.docs('upload_logs').some(x => x.result.code === 'PARTIAL'));

  reset(); seed('crashed');
  const crashed = await T.acquirePurgeLease(row('crashed'), now, ownerA);
  const stateBefore = JSON.stringify(row('crashed').payload), revBefore = row('crashed').rev;
  const recovery = await T.recoverExpiredPurgeLease('crashed', new Date(now.getTime() + 31000));
  check('L7 取得锁后进程中断，到期恢复不清正文且只递增释放 rev',
    crashed.ok && recovery.ok && row('crashed').rev === revBefore + 1 &&
    JSON.stringify(row('crashed').payload) === stateBefore &&
    h.docs('upload_logs').length === 0 && h.state.removeCalls === 0);
  console.log('T3.6.1 lock recovery: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
