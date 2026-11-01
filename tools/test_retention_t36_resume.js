'use strict';

const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const T = h.loadFunction('cloudfunctions/retention/index.js').__test__;
const now = new Date('2026-10-30T12:00:00.000Z');
let pass = 0, fail = 0;
function check(name, condition) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (condition) pass++; else fail++;
}
function setup(n) {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
  for (let i = 0; i < n; i++) {
    const id = String(i).padStart(5, '0');
    h.seed('upload_logs', { _id: id, event: 'retention_mark',
      action: 'retention_mark', submissionId: 'synthetic-' + id,
      at: new Date(now.getTime() - 1000), result: { code: 'OK' } });
  }
}
function scan(options) {
  return T.reconcileBatches(Object.assign({ eventType: 'retention_mark', now: now,
    resumable: true }, options || {}));
}
async function finish(first) {
  let result = first, calls = 1;
  while (result.nextContinuation && calls < 10) {
    result = await scan({ continuation: result.nextContinuation });
    calls++;
  }
  return { result: result, calls: calls };
}
async function run() {
  for (const total of [499, 500, 501, 1001]) {
    setup(total);
    const first = await scan();
    const done = await finish(first);
    check('S' + total + ' 原范围完整续扫且准确计数',
      done.result.ok === true && done.result.completeScan === true &&
      done.result.scanned === total && done.result.scanScope.scanned === total &&
      done.result.scanScope.initialCount === total &&
      done.calls === Math.ceil(total / 500));
    if (total > 500) {
      check('S' + total + ' 中间页绝不称完整', first.ok === false &&
        first.completeScan === false && first.scanScope.completeScan === false &&
        first.scanScope.cursor === String(499).padStart(5, '0'));
      const replay = await scan({ continuation: first.nextContinuation });
      check('S' + total + ' 同一断点重复执行不重复计数', replay.scanned ===
        Math.min(total, 1000) && replay.scanScope.scanId === first.scanScope.scanId);
    }
  }

  setup(501);
  const first = await scan();
  h.seed('upload_logs', { _id: '00000a', event: 'retention_mark',
    action: 'retention_mark', submissionId: 'late-small-id',
    at: new Date(now.getTime() + 1000), result: { code: 'OK' } });
  const changedSmall = await scan({ continuation: first.nextContinuation });
  check('S1 中途新增更小 _id 被基数复核发现，禁止完整结论',
    changedSmall.code === 'SCAN_CHANGED' && changedSmall.ok === false &&
    changedSmall.completeScan === false && changedSmall.nextContinuation === null &&
    changedSmall.scanScope.observedCount === 502);

  setup(501);
  const firstLarge = await scan();
  h.seed('upload_logs', { _id: 'zzzzz', event: 'retention_mark',
    action: 'retention_mark', submissionId: 'late-large-id',
    at: new Date(now.getTime() + 1000), result: { code: 'OK' } });
  const changedLarge = await scan({ continuation: firstLarge.nextContinuation });
  check('S2 中途新增更大 _id 同样作废扫描', changedLarge.code === 'SCAN_CHANGED' &&
    changedLarge.completeScan === false && changedLarge.scanScope.observedCount === 502);

  setup(501);
  const stable = await scan();
  const otherInstance = h.loadFunction('cloudfunctions/retention/index.js').__test__;
  const resumed = await otherInstance.reconcileBatches({ eventType: 'retention_mark',
    continuation: stable.nextContinuation });
  check('S3 新实例使用原 scanId/水位/时间而非从头重扫', resumed.ok === true &&
    resumed.scanned === 501 && resumed.scanScope.pages > stable.scanScope.pages &&
    resumed.scanScope.scanId === stable.scanScope.scanId &&
    resumed.scanScope.highWaterMark === stable.scanScope.highWaterMark &&
    resumed.scanScope.scanStartedAt === stable.scanScope.scanStartedAt);
  const damaged = stable.nextContinuation.slice(0, -1) + 'X';
  const callsBefore = h.calls('upload_logs').length;
  const invalid = await scan({ continuation: damaged });
  check('S4 损坏凭据读库前拒绝', invalid.code === 'INVALID_SCAN_CONTINUATION' &&
    h.calls('upload_logs').length === callsBefore);

  setup(501);
  const interruptedFirst = await scan();
  const countCalls = h.calls('upload_logs').filter(function (x) { return x === 'count'; }).length;
  h.setFail({ collection: 'upload_logs', op: 'count', atCall: countCalls + 1 });
  const interrupted = await scan({ continuation: interruptedFirst.nextContinuation });
  h.clearFail();
  const recovered = await scan({ continuation: interruptedFirst.nextContinuation });
  check('S5 末尾复核中断不能成功，原断点可重试', interrupted.ok === false &&
    interrupted.completeScan === false && recovered.ok === true && recovered.scanned === 501);

  setup(501);
  const firstMissing = await scan();
  h.state.docs.upload_logs.pop();
  const missing = await scan({ continuation: firstMissing.nextContinuation });
  check('S6 原范围内日志消失会失败关闭', missing.code === 'SCAN_CHANGED' &&
    missing.completeScan === false);
  check('S7 全部续扫均未写入业务或审计集合',
    h.updateCalls() === 0 && h.removeCalls() === 0);
  console.log('T3.6 resume: ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
