'use strict';

const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-30T12:00:00.000Z');
let passed = 0, failed = 0;

function check(name, condition) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (condition) passed++; else failed++;
}

function setup(total) {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
  for (let i = 0; i < total; i++) {
    const id = String(i).padStart(5, '0');
    const row = { _id: id, event: 'retention_mark', action: 'retention_mark',
      submissionId: 'synthetic-' + id, at: new Date(now.getTime() - 1000),
      result: { code: 'OK' } };
    if (i === 0 || i === total - 1) {
      const phase = i === 0 ? 'prepare' : 'complete';
      row.schemaVersion = 1;
      row.submissionId = null;
      row.day = '2026-10-30';
      row.rev = 1;
      row.actor = { role: 'system', openidHash: null };
      row.result = { code: phase === 'prepare' ? 'PREPARE' : 'COMPLETE',
        stats: { phase: phase, operation: 'mark', batchId: 'batch-one', selected: 1,
          marked: phase === 'prepare' ? 0 : 1,
          markedAudited: phase === 'prepare' ? 0 : 1, auditFailedCount: 0,
          skipped: 0, conflicts: 0, failed: 0,
          unprocessed: phase === 'prepare' ? 1 : 0 } };
    }
    h.seed('upload_logs', row);
  }
}

async function scan(input) {
  return T.reconcileBatches(Object.assign({ eventType: 'retention_mark', now: now,
    resumable: true }, input || {}));
}

async function run() {
  for (const total of [499, 500, 501, 1001]) {
    setup(total);
    if (total > 500) h.state.docs.upload_logs[0].result.stats.unexpectedPrivate = 'private-body';
    let result = await scan();
    let steps = 1;
    let intermediateSafe = !result.completeScan && result.ok === false;
    const firstToken = result.nextContinuation;
    while (result.nextContinuation && steps < 10) {
      result = await scan({ continuation: result.nextContinuation });
      steps++;
      if (result.nextContinuation) intermediateSafe = intermediateSafe &&
        !result.completeScan && result.ok === false;
    }
    check(total + ' 条跨页汇总且最终闭合', result.ok === true && result.completeScan === true &&
      result.scanned === total && result.batches.length === 1 &&
      result.counts.closed === 1 && result.counts.outcomes.OK === 1 &&
      result.scanScope && result.scanScope.upperId === String(total - 1).padStart(5, '0') &&
      result.scanScope.consistency === 'KEYSPACE_WATERMARK_COUNT_CHECK_NOT_ATOMIC' &&
      /^[0-9a-f]{32}$/.test(result.scanScope.scanId) &&
      result.scanScope.scanned === total && result.scanScope.completeScan === true &&
      steps === Math.ceil(total / 500));
    if (total > 500) {
      check(total + ' 条未扫完时保持失败关闭', intermediateSafe && !!firstToken);
      const tokenPayload = Buffer.from(firstToken.split('.')[0], 'base64url').toString('utf8');
      check(total + ' 条续扫凭据不含原始批次或身份',
        !/batch-one|synthetic-|offline-secret|private-body/.test(tokenPayload));
      const repeated = await scan({ continuation: firstToken });
      check(total + ' 条重复续扫幂等', repeated.scanned === Math.min(total, 1000) &&
        repeated.pages > 0 && h.updateCalls() === 0);
      const broken = firstToken.slice(0, -1) + (firstToken.endsWith('A') ? 'B' : 'A');
      const before = h.calls('upload_logs').length;
      const rejected = await scan({ continuation: broken });
      check(total + ' 条损坏游标在读取前拒绝', rejected.code === 'INVALID_SCAN_CONTINUATION' &&
        h.calls('upload_logs').length === before);
    }
  }
  setup(501);
  const first = await scan();
  h.setFail({ collection: 'upload_logs', op: 'get', atCall: h.calls('upload_logs').filter(
    function (x) { return x === 'get'; }).length + 1 });
  const interrupted = await scan({ continuation: first.nextContinuation });
  h.clearFail();
  const resumed = await scan({ continuation: first.nextContinuation });
  check('查询中断可从原凭据重试', interrupted.ok === false &&
    interrupted.completeScan === false && resumed.ok === true && resumed.scanned === 501);
  const restarted = h.loadFunction('cloudfunctions/retention/index.js');
  const afterRestart = await restarted.__test__.reconcileBatches({
    eventType: 'retention_mark', continuation: first.nextContinuation });
  check('新函数实例使用同一凭据继续扫描', afterRestart.ok === true &&
    afterRestart.scanned === 501 && afterRestart.counts.closed === 1);
  const concurrent = await Promise.all([scan({ continuation: first.nextContinuation }),
    restarted.__test__.reconcileBatches({ eventType: 'retention_mark',
      continuation: first.nextContinuation })]);
  check('两实例只读续扫得到相同结果', concurrent.every(function (x) {
    return x.ok === true && x.scanned === 501 && x.counts.closed === 1;
  }) && h.updateCalls() === 0);

  setup(501);
  const watermark = await scan();
  h.seed('upload_logs', { _id: '00499a', schemaVersion: 1,
    event: 'retention_mark', action: 'retention_mark', submissionId: null,
    day: '2026-10-30', at: new Date(now.getTime() + 1000), rev: 1,
    actor: { role: 'system', openidHash: null }, result: { code: 'PREPARE',
      stats: { phase: 'prepare', operation: 'mark', batchId: 'late-batch', selected: 1 } } });
  const late = await scan({ continuation: watermark.nextContinuation });
  check('扫描中插入水位内日志使原扫描作废', late.ok === false &&
    late.code === 'SCAN_CHANGED' && late.completeScan === false &&
    late.scanScope.observedCount === late.scanScope.initialCount + 1 &&
    late.scanned === 502);

  setup(501);
  const frozen = await scan();
  h.seed('upload_logs', { _id: 'zzzzz', event: 'retention_mark',
    action: 'retention_mark', submissionId: 'later',
    at: new Date(now.getTime() + 1000), result: { code: 'OK' } });
  const snapshot = await scan({ continuation: frozen.nextContinuation });
  check('高水位之外的新日志也使原扫描作废', snapshot.scanned === 501 &&
    snapshot.ok === false && snapshot.code === 'SCAN_CHANGED' &&
    snapshot.completeScan === false && snapshot.nextContinuation === null);
  const before = h.calls('upload_logs').length;
  const denied = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
    resumable: true, maintenanceToken: 'wrong' });
  check('未授权调用不访问审计集合', denied.code === 'FORBIDDEN' &&
    h.calls('upload_logs').length === before);
  setup(501);
  const liveAt = new Date(Date.now() - 1000);
  h.state.docs.upload_logs.forEach(function (row) {
    row.at = liveAt;
    if (row.submissionId === null) row.day = liveAt.toISOString().slice(0, 10);
  });
  const authorizedFirst = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
    resumable: true, maintenanceToken: 'offline-secret' });
  const authorizedFinal = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
    continuation: authorizedFirst.nextContinuation, maintenanceToken: 'offline-secret' });
  check('鉴权入口可跨次续扫', authorizedFirst.code === 'SCAN_TRUNCATED' &&
    authorizedFinal.ok === true && authorizedFinal.scanned === 501);
  check('续扫全程只读', h.updateCalls() === 0 && h.removeCalls() === 0);
  setup(0);
  const empty = await scan();
  check('空日志窗口正常闭合且不伪造批次', empty.ok === true &&
    empty.scanned === 0 && empty.counts.closed === 0 && empty.scanScope.upperId === null);
  console.log('T3.4 resume: ' + passed + ' PASS, ' + failed + ' FAIL');
  if (failed) process.exitCode = 1;
}

run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
