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
function batch(id) { return h.docs('upload_logs').find(x => x.result.stats &&
  x.result.stats.batchId === id && x.result.stats.phase === 'complete'); }
function repairs() { return h.docs('upload_logs').filter(x => x.result.code === 'REPAIR_CONFIRMED'); }
async function makePartial(id, batchId) {
  reset(); seed(id);
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  const result = await T.purgePayload({ now, requestId: batchId });
  h.clearFail();
  return result;
}
async function run() {
  let partial = await makePartial('repair-partial', 'repair-partial-batch');
  const before = JSON.stringify(h.docs('upload_logs'));
  const tooEarly = await T.repairPurgeBatch({ batchId: 'repair-partial-batch', now });
  check('H1 缺少逐条审计时不得追加修复事件，原 PARTIAL 仍阻断',
    partial.code === 'PURGE_PARTIAL' && tooEarly.code === 'REPAIR_EVIDENCE_INCOMPLETE' &&
    repairs().length === 0 && JSON.stringify(h.docs('upload_logs')) === before && row('repair-partial').payload === null);
  const recovered = await T.recoverPurgePending({ now: new Date(now.getTime() + 61000) });
  const fixed = await T.repairPurgeBatch({ batchId: 'repair-partial-batch',
    now: new Date(now.getTime() + 62000) });
  const reconciled = await T.reconcileBatches({ eventType: 'retention_purge' });
  check('H2 PARTIAL 逐条审计补齐后追加稳定修复事件，重新完整对账成功',
    recovered.recovered === 1 && fixed.code === 'REPAIRED' && fixed.ok &&
    repairs().length === 1 && reconciled.ok && reconciled.counts.outcomes.PARTIAL === 1 &&
    reconciled.counts.repaired === 1 && reconciled.batches.some(x => x.repairStatus === 'confirmed'));
  seed('after-repair');
  const afterRepairPurge = await T.purgePayload({ now: new Date(now.getTime() + 63000) });
  check('H2b 已证实修复并重新对账后，新候选可进入本地清理路径',
    afterRepairPurge.ok && afterRepairPurge.purged === 1 && row('after-repair').payload === null);
  let page = await T.reconcileBatches({ eventType: 'retention_purge',
    resumable: true, pageSize: 1, maxRows: 1 });
  let privateContinuation = false;
  for (let n = 0; n < 20 && page.nextContinuation; n++) {
    const decoded = Buffer.from(page.nextContinuation.split('.')[0], 'base64url').toString('utf8');
    if (decoded.includes('repair-partial') || decoded.includes('"selectedEvidence":')) {
      privateContinuation = true;
    }
    page = await T.reconcileBatches({ eventType: 'retention_purge',
      continuation: page.nextContinuation, pageSize: 1, maxRows: 1 });
  }
  check('H2c 修复批次跨页续扫完整，续扫凭据不含选中投稿 ID',
    page.ok && page.completeScan && !privateContinuation && page.counts.repaired === 1);
  const original = batch('repair-partial-batch');
  check('H3 原 PARTIAL 日志保持原样，修复事件不含正文与令牌',
    original.result.code === 'PARTIAL' && repairs()[0].result.stats.repairOperator === 'system' &&
    repairs()[0].result.stats.prepareId && repairs()[0].result.stats.completeId &&
    !JSON.stringify(repairs()[0]).includes('private-repair-partial') &&
    !JSON.stringify(repairs()[0]).includes('offline-secret'));
  const rev = row('repair-partial').rev;
  const repeat = await T.repairPurgeBatch({ batchId: 'repair-partial-batch' });
  check('H4 重复修复幂等，不改投稿版本，不重复追加事件',
    repeat.code === 'ALREADY_REPAIRED' && repairs().length === 1 && row('repair-partial').rev === rev);
  h.state.docs.submissions[0].rev++;
  h.state.docs.submissions[0].status = 'rejected';
  const afterChange = await T.repairPurgeBatch({ batchId: 'repair-partial-batch' });
  check('H4b 修复后投稿出现新版本，重复调用仍只确认原追加事件',
    afterChange.code === 'ALREADY_REPAIRED' && repairs().length === 1 &&
    row('repair-partial').rev === rev + 1);

  partial = await makePartial('repair-failed', 'repair-failed-batch');
  await T.recoverPurgePending({ now: new Date(now.getTime() + 61000) });
  // Synthetic immutable historical FAILED fixture: code is set before the repair action.
  h.state.docs.upload_logs.find(x => x.result.stats &&
    x.result.stats.batchId === 'repair-failed-batch' &&
    x.result.stats.phase === 'complete').result.code = 'FAILED';
  const failedRepair = await T.repairPurgeBatch({ batchId: 'repair-failed-batch' });
  const failedReconcile = await T.reconcileBatches({ eventType: 'retention_purge' });
  check('H5 证据完整的 FAILED 历史样例可追加修复，原 FAILED 仍保留',
    partial.code === 'PURGE_PARTIAL' && failedRepair.ok &&
    batch('repair-failed-batch').result.code === 'FAILED' &&
    failedReconcile.ok && failedReconcile.counts.outcomes.FAILED === 1 && failedReconcile.counts.repaired === 1);

  partial = await makePartial('repair-write-fail', 'repair-write-fail-batch');
  await T.recoverPurgePending({ now: new Date(now.getTime() + 61000) });
  const nextAdd = h.state.calls.upload_logs.filter(x => x === 'add').length + 1;
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: nextAdd });
  const failedWrite = await T.repairPurgeBatch({ batchId: 'repair-write-fail-batch' });
  h.clearFail();
  const retried = await T.repairPurgeBatch({ batchId: 'repair-write-fail-batch' });
  check('H6 修复事件写入失败不谎报成功，重跑使用同一稳定 eventId',
    partial.code === 'PURGE_PARTIAL' && failedWrite.code === 'REPAIR_LOG_UNCONFIRMED' &&
    retried.ok && repairs().length === 1 && row('repair-write-fail').payload === null);

  partial = await makePartial('repair-ack-loss', 'repair-ack-loss-batch');
  await T.recoverPurgePending({ now: new Date(now.getTime() + 61000) });
  const nextAck = h.state.calls.upload_logs.filter(x => x === 'add').length + 1;
  h.setAfterWriteFail({ collection: 'upload_logs', op: 'add', atCall: nextAck });
  const ambiguousRepair = await T.repairPurgeBatch({ batchId: 'repair-ack-loss-batch' });
  h.clearAfterWriteFail();
  check('H6b 修复事件已落库但回执丢失时按稳定 ID 确认，仅有一条事件',
    partial.code === 'PURGE_PARTIAL' && ambiguousRepair.ok &&
    repairs().length === 1 && row('repair-ack-loss').payload === null);

  reset(); seed('old');
  h.seed('upload_logs', { _id: 'old-prepare', schemaVersion: 1, event: 'retention_purge',
    action: 'retention_purge', submissionId: null, day: '2026-10-30', at: now, rev: 1,
    actor: { role: 'system', openidHash: null },
    result: { code: 'PREPARE', stats: { phase: 'prepare', operation: 'purge',
      batchId: 'old-batch', selected: 1 } } });
  const old = await T.repairPurgeBatch({ batchId: 'old-batch' });
  check('H7 缺少稳定准备/结束日志的旧批次保持阻断，不能伪造成功',
    old.code === 'REPAIR_EVIDENCE_MISSING' && repairs().length === 0 &&
    row('old').payload.text === 'private-old');
  const beforeTouch = h.touchedCollections().length;
  const forbidden = await fn.main({ action: 'repairPurgeBatch', batchId: 'old-batch' }, {});
  check('H8 无令牌修复在读库前拒绝', forbidden.code === 'FORBIDDEN' &&
    h.touchedCollections().length === beforeTouch);
  console.log('T3.6.1 repair: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
