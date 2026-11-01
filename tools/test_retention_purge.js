'use strict';
const { createHarness } = require('./ugc_fake_cloud');
const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;
const now = new Date('2026-10-28T12:00:00Z');
const day = 86400000;
let pass = 0, fail = 0;
function check(name, value) { console.log((value ? 'PASS ' : 'FAIL ') + name); if (value) pass++; else fail++; }
function setup(limit) {
  h.reset();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = String(limit || 10);
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
}
function seed(id, status, age, payload) {
  h.seed('submissions', { _id: id, status: status, rev: 1,
    createdAt: new Date(now.getTime() - age), updatedAt: new Date(now.getTime() - age),
    payload: payload === undefined ? { note: 'private-body-' + id } : payload,
    verifyStatus: 'unverified', source: { kind: 'user' }, review: { decision: status } });
}
function doc(id) { return h.docs('submissions').find(function (row) { return row._id === id; }); }
function logs(id) { return h.docs('upload_logs').filter(function (row) { return row.event === 'retention_purge' && row.submissionId === id; }); }
function closed(r) { return r.selected === r.purgedAudited + r.auditFailedCount +
  r.deferredAudit + r.deferredRetry + r.skipped + r.conflicts + r.failed &&
  r.purged === r.purgedAudited + r.auditFailedCount; }

async function run() {
  setup();
  seed('young', 'approved', 30 * day - 1);
  seed('exact', 'rejected', 30 * day);
  seed('approved', 'approved', 30 * day + 1);
  seed('rejected', 'rejected', 31 * day);
  seed('expired', 'expired', 32 * day);
  let r = await T.purgePayload({ now: now });
  check('P1 严格 30 天边界：整点与未到期不清，超时才清',
    doc('young').payload !== null && doc('exact').payload !== null &&
    ['approved', 'rejected', 'expired'].every(function (id) { return doc(id).payload === null; }) &&
    r.purged === 3 && closed(r));
  check('P2 保留外壳、审核状态、来源和准入状态',
    ['approved', 'rejected', 'expired'].every(function (id) {
      const row = doc(id); return row.status === id && row.rev === 5 &&
        row.payloadRedactedAt instanceof Date && row.verifyStatus === 'unverified' &&
        row.source.kind === 'user' && row.review.decision === id;
    }));
  r = await T.purgePayload({ now: now });
  check('P3 重跑已清正文不重复转换或写逐条日志', r.purged === 0 && r.selected === 0 &&
    ['approved', 'rejected', 'expired'].every(function (id) { return logs(id).length === 1; }));
  check('P4 清理日志不含正文或身份字段',
    JSON.stringify(h.docs('upload_logs')).indexOf('private-body') === -1 &&
    h.docs('upload_logs').every(function (log) { return log.actor.openidHash === null; }));

  setup(); seed('pending', 'pending', 32 * day);
  r = await T.purgePayload({ now: now });
  check('P5 超期 pending 只报告需标记，不清正文', r.needsMark === 1 &&
    r.code === 'OK' && r.purged === 0 && r.selected === 0 &&
    doc('pending').payload !== null && doc('pending').status === 'pending');
  setup(); seed('pending', 'pending', 32 * day);
  await T.markExpired({ now: now });
  r = await T.purgePayload({ now: now });
  check('P6 经既有状态转换和审计完成后才清正文',
    doc('pending').status === 'expired' && doc('pending').retention.audit.state === 'complete' &&
    doc('pending').payload === null && r.purged === 1);

  setup(); seed('mark_failed', 'pending', 32 * day);
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  await T.markExpired({ now: now }); h.clearFail();
  r = await T.purgePayload({ now: now });
  check('P7 T-1 失败批次和待补审计阻断正文清理', r.code === 'AUDIT_GATE_BLOCKED' &&
    doc('mark_failed').payload !== null && doc('mark_failed').retention.audit.state === 'pending');
  await T.recoverAudit('mark_failed');
  r = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
  check('P8 逐条审计已恢复但历史 PARTIAL 批次仍禁止清理',
    r.code === 'AUDIT_GATE_BLOCKED' && doc('mark_failed').payload !== null &&
    doc('mark_failed').retention.audit.state === 'complete');

  setup(); seed('race', 'approved', 31 * day);
  h.setBeforeUpdate(function (rows) { rows[0].status = 'rejected'; rows[0].rev = 2; h.setBeforeUpdate(null); });
  const conflict = await T.purgePayload({ now: now });
  const retry = await T.purgePayload({ now: now });
  check('P9 并发状态和 rev 变化不被覆盖，冲突批次未审清前继续阻断',
    conflict.conflicts === 1 && conflict.purged === 0 && conflict.complete === false &&
    conflict.code === 'PURGE_DEFERRED' &&
    retry.code === 'AUDIT_GATE_BLOCKED' && doc('race').payload !== null &&
    doc('race').status === 'rejected' && doc('race').rev === 2 && closed(conflict));

  setup(1); seed('bad', 'approved', 40 * day); seed('good', 'rejected', 39 * day);
  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
  const failed = await T.purgePayload({ now: now }); h.clearFail();
  const advanced = await T.purgePayload({ now: now });
  const delayed = await T.purgePayload({ now: now });
  const resumed = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
  check('P10 写入失败留退避标记，PARTIAL 批次阻断后续正文清理', failed.failed === 1 &&
    [advanced, delayed, resumed].every(function (x) { return x.code === 'AUDIT_GATE_BLOCKED'; }) &&
    doc('bad').payload !== null && doc('good').payload !== null &&
    doc('bad').retention.purge.retryAfter > now && closed(failed));

  setup(); seed('log_failure', 'approved', 31 * day);
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  const auditFailure = await T.purgePayload({ now: now }); h.clearFail();
  const afterFailure = await h.loadFunction('cloudfunctions/retention/index.js').__test__.purgePayload({ now: now });
  check('P11 逐条审计失败后标记留存，重启实例自动补记且不重复清正文',
    auditFailure.code === 'PURGE_PARTIAL' && auditFailure.auditFailedCount === 1 &&
    afterFailure.code === 'AUDIT_GATE_BLOCKED' && afterFailure.auditRecovery.recovered === 1 &&
    doc('log_failure').retention.purge.state === 'complete' &&
    doc('log_failure').rev === 5 && logs('log_failure').length === 1 && closed(auditFailure));

  setup(); seed('prepare_failure', 'approved', 31 * day);
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
  r = await T.purgePayload({ now: now });
  check('P12 批次 prepare 日志失败零正文写入', r.code === 'LOG_FAILED' && doc('prepare_failure').payload !== null);
  h.clearFail(); r = await T.purgePayload({ now: now });
  check('P13 prepare 失败后重试可完成', r.purged === 1 && doc('prepare_failure').payload === null);

  setup(); seed('concurrent', 'approved', 31 * day);
  const other = h.loadFunction('cloudfunctions/retention/index.js');
  const both = await Promise.all([T.purgePayload({ now: now }), other.__test__.purgePayload({ now: now })]);
  check('P14 两函数实例共享假 DB 时单次有效清理',
    both[0].purged + both[1].purged === 1 && logs('concurrent').length === 1 &&
    doc('concurrent').payload === null && both.every(closed));

  r = await fn.main({ action: 'purge' }, {});
  check('P15 无维护令牌被拒绝', r.code === 'FORBIDDEN');
  const schema = require('../config/cloud/schema.submissions.json');
  const auditSchema = require('../config/cloud/schema.upload_logs.json');
  check('P16 本地索引与事件草案已声明且未冒充云端生效',
    schema.indexes.some(function (x) { return x.name === 'ix_retention_purge_candidates'; }) &&
    schema.indexes.some(function (x) { return x.name === 'ix_retention_purge_audit_queue'; }) &&
    auditSchema.fields.event.enum.indexOf('retention_purge') !== -1 &&
    schema._meta.status === 'pending_admin_console_verification');

  setup(); seed('complete_log_failure', 'approved', 31 * day);
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 3 });
  const incompleteBatch = await T.purgePayload({ now: now });
  h.clearFail();
  const retriedBatch = await T.purgePayload({ now: now });
  check('P17 批次 complete 日志失败后孤儿 prepare 阻断重跑，逐条事件不重复',
    incompleteBatch.code === 'LOG_FAILED' && incompleteBatch.logged === false &&
    doc('complete_log_failure').payload === null && retriedBatch.code === 'AUDIT_GATE_BLOCKED' &&
    logs('complete_log_failure').length === 1 && closed(incompleteBatch));

  setup(1); seed('invalid_rev', 'approved', 40 * day); seed('behind_invalid', 'rejected', 39 * day);
  h.state.docs.submissions[0].rev = 0;
  const invalid = await T.purgePayload({ now: now });
  const progressed = await T.purgePayload({ now: now });
  check('P18 异常版本记录退避，DEFERRED 批次未审清前阻断后续正文清理', invalid.skipped === 1 &&
    progressed.code === 'AUDIT_GATE_BLOCKED' && doc('invalid_rev').payload !== null &&
    doc('behind_invalid').payload !== null && closed(invalid));
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) process.exitCode = 1;
}
run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
