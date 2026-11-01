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
function seed(id) {
  h.seed('submissions', { _id: id, status: 'approved', rev: 1,
    createdAt: new Date(now.getTime() - 31 * 86400000),
    payload: { text: 'private-' + id }, verifyStatus: 'unverified' });
}
function row(id) { return h.docs('submissions').find(function (x) { return x._id === id; }); }
function logs(id) { return h.docs('upload_logs').filter(function (x) { return x.submissionId === id; }); }
function bytes(id) { return Buffer.from(JSON.stringify(row(id).payload)); }

async function run() {
  setup(); seed('public');
  const before = bytes('public');
  const denied = await fn.main({ action: 'purge', maintenanceToken: 'offline-secret' }, {});
  check('C1 外部清理入口因全局屏障未验证而在读写前关闭',
    denied.code === 'PURGE_GLOBAL_FENCE_UNVERIFIED' && row('public').rev === 1 &&
    Buffer.compare(before, bytes('public')) === 0 && h.touchedCollections().length === 0);
  const unauthorized = await fn.main({ action: 'purge' }, {});
  check('C2 无令牌仍先被拒绝', unauthorized.code === 'FORBIDDEN' &&
    h.touchedCollections().length === 0);

  setup(); seed('lease');
  const ownerA = 'a'.repeat(32), ownerB = 'b'.repeat(32);
  const instanceB = h.loadFunction('cloudfunctions/retention/index.js').__test__;
  const first = await T.acquirePurgeLease(row('lease'), now, ownerA);
  const busy = await instanceB.acquirePurgeLease(row('lease'), new Date(now.getTime() + 1000), ownerB);
  const second = await instanceB.acquirePurgeLease(row('lease'),
    new Date(now.getTime() + 31000), ownerB);
  check('C3 行锁持久、活租约拒绝第二实例、过期可接管且世代递增',
    first.ok && busy.code === 'LOCK_BUSY' && second.ok &&
    second.lock.fencingToken === first.lock.fencingToken + 1 && row('lease').rev === 3);
  const staleRelease = await T.releasePurgeLease('lease', ownerA, first.lock.fencingToken,
    new Date(now.getTime() + 31000));
  const staleRenew = await T.renewPurgeLease('lease', ownerA, first.lock.fencingToken,
    new Date(now.getTime() + 31000));
  check('C4 旧实例复活无法续租或释放新实例行锁',
    staleRelease.code === 'LOCK_LOST' && staleRenew.code === 'LOCK_LOST' &&
    row('lease').retention.purge.lock.owner === ownerB && row('lease').rev === 3);
  const renewed = await instanceB.renewPurgeLease('lease', ownerB, second.lock.fencingToken,
    new Date(now.getTime() + 32000));
  const released = await instanceB.releasePurgeLease('lease', ownerB, second.lock.fencingToken,
    new Date(now.getTime() + 33000));
  check('C5 续租和条件释放分别递增 rev，释放保留 fencingToken',
    renewed.ok && renewed.rev === 4 && released.ok && released.rev === 5 &&
    row('lease').retention.purge.lock.state === 'released' &&
    row('lease').retention.purge.lock.fencingToken === second.lock.fencingToken);
  check('C6 行锁操作不写正文或逐条审计',
    row('lease').payload.text === 'private-lease' && logs('lease').length === 0);

  setup(); seed('rev_race');
  const revBefore = bytes('rev_race');
  const changedRev = await T.purgePayload({ now: now }, { afterLockAcquired: async function () {
    h.state.docs.submissions[0].rev++;
  } });
  check('C7 其他流程改 rev 后旧实例不能清正文',
    changedRev.conflicts === 1 && changedRev.purged === 0 && changedRev.complete === false &&
    Buffer.compare(revBefore, bytes('rev_race')) === 0 &&
    logs('rev_race').length === 0 &&
    h.docs('upload_logs').every(function (x) {
      return !x.result || x.result.code !== 'COMPLETE';
    }));

  setup(); seed('takeover');
  const takeoverBefore = bytes('takeover');
  const takeover = await T.purgePayload({ now: now }, { afterLockAcquired: async function () {
    const current = row('takeover');
    const next = await instanceB.acquirePurgeLease(current,
      new Date(now.getTime() + 31000), ownerB);
    if (!next.ok) throw new Error('takeover failed');
  } });
  check('C8 新实例接管后旧实例条件更新失败且正文逐字节不变',
    takeover.conflicts === 1 && takeover.purged === 0 &&
    Buffer.compare(takeoverBefore, bytes('takeover')) === 0 &&
    row('takeover').retention.purge.lock.owner === ownerB && logs('takeover').length === 0);

  setup(); seed('positive');
  const positive = await T.purgePayload({ now: now });
  const once = row('positive');
  const again = await T.purgePayload({ now: now });
  check('C9 本地无异常路径仍可清正文，锁释放且重跑幂等',
    positive.ok && positive.complete === true && positive.purged === 1 &&
    once.payload === null && once.rev === 5 &&
    once.retention.purge.lock.state === 'released' && logs('positive').length === 1 &&
    again.purged === 0 && row('positive').rev === 5);

  setup(); seed('two_instances');
  const other = h.loadFunction('cloudfunctions/retention/index.js').__test__;
  const both = await Promise.all([T.purgePayload({ now: now }), other.purgePayload({ now: now })]);
  check('C10 两个独立实例共享假库时最多一次正文清理',
    both.reduce(function (sum, x) { return sum + (x.purged || 0); }, 0) === 1 &&
    row('two_instances').payload === null && logs('two_instances').length === 1);

  setup();
  const markId = 'defer-audit';
  const auditId = 'retention_mark_' + crypto.createHash('sha256')
    .update(markId + '\0' + 2).digest('hex');
  h.seed('submissions', { _id: markId, status: 'expired', rev: 2,
    createdAt: new Date(now.getTime() - 31 * 86400000), payload: { text: 'private' },
    retention: { audit: { state: 'pending', markedRev: 2,
      eventId: auditId, day: '2026-10-30', retryAfter: new Date(0) } } });
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  const deferredMark = await T.recoverPending({ now: now });
  h.clearFail();
  check('C11 标记审计退避更新旧 rev 条件并递增新 rev',
    deferredMark.failed === 1 && row(markId).rev === 3 &&
    row(markId).retention.audit.state === 'pending' &&
    row(markId).retention.audit.retryAfter > now);

  setup(); seed('defer-purge');
  h.state.docs.submissions[0].retention = { audit: { state: 'pending' } };
  const deferredPurge = await T.purgePayload({ now: now });
  check('C12 单条 audit.pending 只退避该记录并递增 rev，不清正文',
    deferredPurge.deferredAudit === 1 && deferredPurge.complete === false &&
    row('defer-purge').rev === 2 && row('defer-purge').payload.text === 'private-defer-purge');

  setup();
  const purgeId = 'recover-purge';
  const purgeEventId = 'retention_purge_' + crypto.createHash('sha256')
    .update(purgeId + '\0' + 2).digest('hex');
  h.seed('submissions', { _id: purgeId, status: 'approved', rev: 2,
    createdAt: new Date(now.getTime() - 31 * 86400000), payload: null,
    retention: { purge: { state: 'pending', purgedRev: 2,
      eventId: purgeEventId, day: '2026-10-30', retryAfter: new Date(0) } } });
  const recoveredPurge = await T.recoverPurgePending({ now: now });
  check('C13 清理审计确认递增 rev 且保持正文为空',
    recoveredPurge.recovered === 1 && recoveredPurge.complete === true &&
    row(purgeId).rev === 3 && row(purgeId).retention.purge.state === 'complete' &&
    row(purgeId).payload === null && logs(purgeId).length === 1);

  setup(); seed('interrupted-lock');
  const interruption = await T.purgePayload({ now: now }, { afterLockAcquired: function () {
    throw new Error('offline simulated interruption');
  } });
  check('C14 获取锁后中断不清正文、不写虚假成功日志并释放锁',
    interruption.failed === 1 && interruption.complete === false &&
    row('interrupted-lock').payload.text === 'private-interrupted-lock' &&
    row('interrupted-lock').retention.purge.lock.state === 'released' &&
    logs('interrupted-lock').length === 0 &&
    h.docs('upload_logs').every(function (x) {
      return !x.result || x.result.code !== 'COMPLETE';
    }));

  setup(); seed('fence-change');
  const fenceBefore = bytes('fence-change');
  const fenceChanged = await T.purgePayload({ now: now }, { afterLockAcquired: function () {
    h.state.docs.submissions[0].retention.purge.lock.fencingToken++;
  } });
  check('C15 fencingToken 变化即使 rev 未变也阻断旧写入',
    fenceChanged.conflicts === 1 && fenceChanged.complete === false &&
    Buffer.compare(fenceBefore, bytes('fence-change')) === 0 &&
    logs('fence-change').length === 0);

  console.log('T3.6 concurrency: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
