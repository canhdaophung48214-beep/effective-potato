'use strict';

// Offline recovery queue tests. The fake database does not prove cloud atomicity.
const crypto = require('crypto');
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-28T12:00:00Z');
let pass = 0;
let fail = 0;

function check(name, condition) {
  console.log((condition ? 'PASS ' : 'FAIL ') + name);
  if (condition) pass++; else fail++;
}
function setup(limit) {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = String(limit);
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
}
function seed(id, retryAfter) {
  const eventId = 'retention_mark_' + crypto.createHash('sha256').update(id + '\0' + '2').digest('hex');
  h.seed('submissions', {
    _id: id, createdAt: new Date('2026-01-01T00:00:00Z'), status: 'expired', rev: 2,
    payload: { note: 'must remain' }, verifyStatus: 'unverified',
    retention: { markedAt: new Date('2026-02-01T00:00:00Z'), policyConfirmedBy: 'offline-test',
      audit: { state: 'pending', markedRev: 2, eventId: eventId, day: '2026-02-01',
        retryAfter: retryAfter === undefined ? new Date(0) : retryAfter } }
  });
}
function doc(id) { return h.docs('submissions').find(function (row) { return row._id === id; }); }
function logs(id) { return h.docs('upload_logs').filter(function (row) { return row.submissionId === id; }); }
function conserved(result) {
  return result.selected === result.recovered + result.deferred + result.conflicts + result.failed;
}

async function run() {
  setup(2);
  let r = await T.recoverPending({ now: now });
  check('R1 空队列正常完成', r.ok && r.selected === 0 && conserved(r));

  setup(1);
  seed('a'); seed('b'); seed('c');
  const pages = [];
  for (let i = 0; i < 3; i++) pages.push(await T.recoverPending({ now: now }));
  check('R2 有界批次跨三次调用持续推进', pages.every(function (x) {
    return x.selected === 1 && x.recovered === 1 && conserved(x);
  }) && ['a', 'b', 'c'].every(function (id) { return doc(id).retention.audit.state === 'complete'; }));
  r = await T.recoverPending({ now: now });
  check('R3 连续运行不重复写逐条事件', r.selected === 0 &&
    ['a', 'b', 'c'].every(function (id) { return logs(id).length === 1; }));

  setup(1);
  seed('fail_first'); seed('later');
  // First add is now the recovery batch prepare; fail the per-record add.
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  const first = await T.recoverPending({ now: now });
  h.clearFail();
  const second = await T.recoverPending({ now: now });
  const third = await T.recoverPending({ now: now });
  const fourth = await T.recoverPending({ now: new Date(now.getTime() + 61000) });
  check('R4 日志失败延后重试，后续记录不饥饿', first.failed === 1 &&
    second.recovered === 1 && doc('later').retention.audit.state === 'complete' &&
    third.deferred === 1 && fourth.recovered === 1 && conserved(first) &&
    conserved(second) && conserved(third) && conserved(fourth) &&
    logs('fail_first').length === 1 && logs('later').length === 1);

  setup(1);
  seed('rev_race');
  h.setBeforeUpdate(function (rows) { rows[0].rev = 3; h.setBeforeUpdate(null); });
  const conflict = await T.recoverPending({ now: now });
  const retry = await T.recoverPending({ now: now });
  check('R5 rev 冲突后重试不重复日志或覆盖新版本', conflict.conflicts === 1 &&
    retry.recovered === 1 && doc('rev_race').rev === 4 && logs('rev_race').length === 1 &&
    conserved(conflict) && conserved(retry));

  setup(1);
  seed('interrupted');
  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
  const interrupted = await T.recoverPending({ now: now });
  h.clearFail();
  const restartedInstance = h.loadFunction('cloudfunctions/retention/index.js');
  const resumed = await restartedInstance.__test__.recoverPending({ now: new Date(now.getTime() + 61000) });
  check('R6 日志已写但状态确认中断后可续跑', interrupted.failed === 1 &&
    resumed.recovered === 1 && doc('interrupted').retention.audit.state === 'complete' &&
    logs('interrupted').length === 1 && conserved(interrupted) && conserved(resumed));

  setup(1);
  seed('two_instances');
  const other = h.loadFunction('cloudfunctions/retention/index.js');
  const both = await Promise.all([T.recoverPending({ now: now }), other.__test__.recoverPending({ now: now })]);
  check('R7 两个函数实例共享假 DB 时单条日志', both.every(conserved) &&
    both[0].recovered + both[1].recovered === 1 && logs('two_instances').length === 1 &&
    doc('two_instances').retention.audit.state === 'complete');
  check('R8 恢复不清正文或更改准入状态',
    doc('two_instances').payload.note === 'must remain' && doc('two_instances').verifyStatus === 'unverified');

  setup(1);
  seed('schedule_failure');
  h.setFail({ collection: 'submissions', op: 'update' });
  const schedulingFailed = await T.recoverPending({ now: now });
  const pendingSurvived = doc('schedule_failure').retention.audit.state === 'pending';
  h.clearFail();
  const retried = await h.loadFunction('cloudfunctions/retention/index.js').__test__.recoverPending({ now: now });
  check('R8b 延后排程写入也失败时，原待补标记仍可在下次发现',
    schedulingFailed.failed === 1 && schedulingFailed.retrySchedulingFailed === true && pendingSurvived &&
    doc('schedule_failure').retention.audit.state === 'complete' && retried.recovered === 1 &&
    logs('schedule_failure').length === 1 && conserved(schedulingFailed) && conserved(retried));

  setup(1);
  seed('legacy_without_retry_after');
  delete h.state.docs.submissions[0].retention.audit.retryAfter;
  const legacy = await T.recoverPending({ now: now });
  check('R11 旧待补标记缺 retryAfter 仍能自动发现', legacy.recovered === 1 &&
    conserved(legacy) && logs('legacy_without_retry_after').length === 1);

  const schema = require('../config/cloud/schema.submissions.json');
  const index = schema.indexes.find(function (item) { return item.name === 'ix_retention_audit_queue'; });
  check('R12 本地索引草案覆盖状态筛选与稳定排序', !!index &&
    index.keys.map(function (item) { return item.field; }).join(',') ===
      'retention.audit.state,retention.audit.retryAfter,createdAt,_id' &&
    schema._meta.status === 'pending_admin_console_verification');

  r = await fn.main({ action: 'recoverPending' }, {});
  check('R9 未授权自动恢复被拒绝', r.code === 'FORBIDDEN');
  r = await fn.main({ action: 'recoverPending', maintenanceToken: 'offline-token' }, {});
  check('R10 授权入口可调用且空队列正常返回', r.code === 'OK' && r.selected === 0);

  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
