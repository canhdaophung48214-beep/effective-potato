/**
 * 本地模拟测试：cloudfunctions/retention 的到期标记入口。
 *
 * 此测试只覆盖“标记到期”，不清除投稿正文、不创建触发器，也不验证云端行为。
 * 所有保留期数值均由测试显式注入，生产环境未确认配置时必须失败关闭。
 */
'use strict';

const { createHarness } = require('./ugc_fake_cloud');

const h = createHarness();
const fn = h.loadFunction('cloudfunctions/retention/index.js');
const T = fn.__test__;

let pass = 0;
let failCount = 0;
const failures = [];

function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log('[PASS] ' + name);
    return;
  }
  failCount++;
  failures.push(name + (detail ? ' :: ' + detail : ''));
  console.log('[FAIL] ' + name + (detail ? ' :: ' + detail : ''));
}

function eq(name, actual, expected) {
  ok(name, actual === expected,
    'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

function clearPolicy() {
  delete process.env.UGC_RETENTION_POLICY_STATUS;
  delete process.env.UGC_RETENTION_MARK_AFTER_DAYS;
  delete process.env.UGC_RETENTION_BATCH_LIMIT;
  delete process.env.UGC_RETENTION_CONFIRMED_BY;
  delete process.env.UGC_RETENTION_TRIGGER_TOKEN;
}

function setConfirmedPolicy(overrides) {
  const values = Object.assign({
    status: 'confirmed',
    markAfterDays: '29',
    batchLimit: '10',
    confirmedBy: 'owner-confirmation-required',
    triggerToken: 'local-retention-trigger-token'
  }, overrides || {});
  process.env.UGC_RETENTION_POLICY_STATUS = values.status;
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = values.markAfterDays;
  process.env.UGC_RETENTION_BATCH_LIMIT = values.batchLimit;
  process.env.UGC_RETENTION_CONFIRMED_BY = values.confirmedBy;
  process.env.UGC_RETENTION_TRIGGER_TOKEN = values.triggerToken;
}

function prepare(overrides) {
  h.reset();
  clearPolicy();
  if (overrides !== false) setConfirmedPolicy(overrides);
}

function seedSubmission(overrides) {
  const now = new Date('2026-10-28T12:00:00.000Z');
  const doc = Object.assign({
    _id: 'submission_' + (h.docs('submissions').length + 1),
    status: 'pending',
    payload: { note: '待审核正文' },
    submitter: { openid: 'fake_user_001' },
    createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    rev: 1
  }, overrides || {});
  h.seed('submissions', doc);
  return doc;
}

function docById(id) {
  return h.docs('submissions').filter(function (doc) { return doc._id === id; })[0];
}

async function main() {
  const now = new Date('2026-10-28T12:00:00.000Z');

  console.log('== A. 配置门禁 ==');
  prepare(false);
  let r = await T.markExpired({ now: now });
  eq('A1 缺少确认状态时拒绝执行', r.code, 'RETENTION_NOT_CONFIRMED');
  eq('A2 配置未确认时不访问投稿集合', h.calls('submissions').length, 0);

  prepare({ status: 'pending_confirmation' });
  r = await T.markExpired({ now: now });
  eq('A3 待确认状态拒绝执行', r.code, 'RETENTION_NOT_CONFIRMED');

  prepare({ markAfterDays: '0' });
  r = await T.markExpired({ now: now });
  eq('A4 非法天数拒绝执行', r.code, 'RETENTION_CONFIG_INVALID');

  prepare({ markAfterDays: '30' });
  r = await T.markExpired({ now: now });
  eq('A4b 已裁决 29 天不能被配置覆盖', r.code, 'RETENTION_CONFIG_INVALID');

  prepare({ batchLimit: '0' });
  r = await T.markExpired({ now: now });
  eq('A5 非法批次上限拒绝执行', r.code, 'RETENTION_CONFIG_INVALID');

  prepare({ confirmedBy: '' });
  r = await T.markExpired({ now: now });
  eq('A6 缺少确认人拒绝执行', r.code, 'RETENTION_CONFIG_INVALID');

  console.log('== A2. 维护入口门禁 ==');
  prepare();
  r = await fn.main({ action: 'other' }, {});
  eq('A7 非 mark 动作拒绝', r.code, 'INVALID_ACTION');
  r = await fn.main({ action: 'mark' }, {});
  eq('A8 缺少维护令牌拒绝', r.code, 'FORBIDDEN');
  r = await fn.main({ action: 'mark', maintenanceToken: 'local-retention-trigger-token' }, {});
  eq('A9 正确维护令牌可调用', r.code, 'OK');

  console.log('== B. 到期标记 ==');
  prepare();
  const overdue = seedSubmission({ _id: 'overdue' });
  seedSubmission({
    _id: 'boundary',
    createdAt: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000)
  });
  seedSubmission({
    _id: 'approved',
    status: 'approved',
    createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)
  });
  seedSubmission({
    _id: 'already_redacted',
    payload: null,
    createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000)
  });
  r = await T.markExpired({ now: now, requestId: 'local-test-run' });
  eq('B1 已确认配置可执行', r.code, 'OK');
  eq('B2 空正文也计入，到期标记两条', r.marked, 2);
  eq('B3 状态改为 expired', docById(overdue._id).status, 'expired');
  eq('B4 rev 递增', docById(overdue._id).rev, 2);
  ok('B5 标记任务不清除投稿正文', JSON.stringify(docById(overdue._id).payload) === JSON.stringify(overdue.payload));
  eq('B6 刚好第 29 天不提前标记', docById('boundary').status, 'pending');
  eq('B7 已处理状态不被覆盖', docById('approved').status, 'approved');
  eq('B8 空 payload 的 pending 仍标记 expired', docById('already_redacted').status, 'expired');
  ok('B9 写入最小化运行审计行', h.docs('upload_logs').some(function (log) {
    return log.event === 'retention_mark' && log.result && log.result.stats &&
      log.result.stats.marked === 2;
  }));
  ok('B10 运行审计行不含投稿人 openid', JSON.stringify(h.docs('upload_logs')).indexOf('fake_user_001') === -1);
  ok('B11 批次 prepare 与 complete 都留痕', ['prepare', 'complete'].every(function (phase) {
    return h.docs('upload_logs').some(function (log) { return log.result && log.result.stats && log.result.stats.phase === phase; });
  }));
  ok('B11b prepare/complete 共享非空批次 ID', (function () {
    const batches = h.docs('upload_logs').filter(function (log) { return log.result && log.result.stats; });
    return batches.length === 2 && !!batches[0].result.stats.batchId &&
      batches[0].result.stats.batchId === batches[1].result.stats.batchId;
  })());
  ok('B12 每条成功状态更新有独立事件', ['overdue', 'already_redacted'].every(function (id) {
    return h.docs('upload_logs').some(function (log) { return log.submissionId === id && log.result.code === 'OK'; });
  }));
  ok('B13 系统审计省略 openidHash', h.docs('upload_logs').every(function (log) {
    return log.actor && log.actor.role === 'system' && !Object.prototype.hasOwnProperty.call(log.actor, 'openidHash');
  }));
  ok('B14 逐条标记事件仅含八个逻辑字段', h.docs('upload_logs').filter(function (log) {
    return log.submissionId !== null;
  }).every(function (log) {
    return Object.keys(log).sort().join(',') === '_id,action,actor,day,errorCode,event,result,schemaVersion,submissionId' &&
      Object.keys(log.result).join(',') === 'code' && Object.keys(log.actor).join(',') === 'role';
  }));

  console.log('== C. 可重跑与失败关闭 ==');
  r = await T.markExpired({ now: now, requestId: 'local-test-rerun' });
  eq('C1 重跑不重复标记', r.marked, 0);
  eq('C2 重跑不再次递增 rev', docById(overdue._id).rev, 2);
  eq('C2b 重跑后仍有 prepare/complete 两条批次事件', h.docs('upload_logs').filter(function (log) {
    return log.result && log.result.stats && log.result.stats.phase === 'complete';
  }).length, 2);

  prepare();
  seedSubmission({ _id: 'write_failure' });
  h.setFail({ collection: 'submissions', op: 'update' });
  r = await T.markExpired({ now: now });
  eq('C3 状态写入失败如实返回数据库错误', r.code, 'DATABASE_ERROR');
  eq('C4 写入失败不谎报已标记数', r.marked, 0);
  eq('C5 写入失败保留原状态', docById('write_failure').status, 'pending');
  eq('C6 完整失败批次有 FAILED 终态', h.docs('upload_logs').filter(function (log) {
    return log.result && log.result.code === 'FAILED';
  }).length, 1);

  console.log('== D. 查询、批次与并发 ==');
  prepare({ batchLimit: '2' });
  seedSubmission({ _id: 'old_approved', status: 'approved', createdAt: new Date('2026-01-01T00:00:00Z') });
  seedSubmission({ _id: 'old_rejected', status: 'rejected', createdAt: new Date('2026-01-02T00:00:00Z') });
  seedSubmission({ _id: 'pending_z', createdAt: new Date('2026-01-03T00:00:00Z') });
  seedSubmission({ _id: 'pending_a', createdAt: new Date('2026-01-03T00:00:00Z') });
  seedSubmission({ _id: 'pending_later', createdAt: new Date('2026-01-04T00:00:00Z') });
  r = await T.markExpired({ now: now });
  eq('D1 已审核记录不占两条批次名额', r.marked, 2);
  eq('D2 同一创建时间按 _id 升序，a 先处理', docById('pending_a').status, 'expired');
  eq('D3 同一创建时间按 _id 升序，z 也处理', docById('pending_z').status, 'expired');
  eq('D4 第三条 pending 留到下一批', docById('pending_later').status, 'pending');
  r = await T.markExpired({ now: now });
  eq('D5 下批继续处理，不被已审核旧记录饿死', docById('pending_later').status, 'expired');

  prepare({ batchLimit: '1' });
  seedSubmission({ _id: 'tie_z', createdAt: new Date('2026-01-03T00:00:00Z') });
  seedSubmission({ _id: 'tie_a', createdAt: new Date('2026-01-03T00:00:00Z') });
  r = await T.markExpired({ now: now });
  eq('D5a 同时刻跨批按 _id 稳定排序', docById('tie_a').status, 'expired');
  eq('D5b 同时刻另一条留待下一批', docById('tie_z').status, 'pending');

  prepare();
  seedSubmission({ _id: 'raced' });
  h.setBeforeUpdate(function (rows) {
    rows[0].status = 'approved'; rows[0].rev = 2;
    h.setBeforeUpdate(null);
  });
  r = await T.markExpired({ now: now });
  eq('D6 并发审核获胜时版本条件阻止覆盖', docById('raced').status, 'approved');
  eq('D7 并发变更按冲突计数', r.conflicts, 1);
  eq('D8 并发冲突不伪造逐条标记事件', h.docs('upload_logs').filter(function (log) { return log.submissionId === 'raced'; }).length, 0);

  prepare();
  seedSubmission({ _id: 'bad_first', createdAt: new Date('2026-01-01T00:00:00Z') });
  seedSubmission({ _id: 'good_second', createdAt: new Date('2026-01-02T00:00:00Z') });
  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
  r = await T.markExpired({ now: now });
  eq('D9 单条写失败不阻断下一条', docById('good_second').status, 'expired');
  eq('D10 部分成功明确返回错误', r.code, 'DATABASE_ERROR');
  eq('D11 部分成功统计为 1/1', String(r.marked) + '/' + String(r.failed), '1/1');
  eq('D12 部分成功批次审计为 PARTIAL', h.docs('upload_logs').filter(function (log) { return log.result.code === 'PARTIAL'; }).length, 1);

  prepare();
  seedSubmission({ _id: 'read_failure' });
  h.setFail({ collection: 'submissions', op: 'get' });
  r = await T.markExpired({ now: now });
  eq('D13 查询失败返回数据库错误', r.code, 'DATABASE_ERROR');
  eq('D14 查询失败零状态写入', h.state.updateCalls, 0);

  prepare();
  seedSubmission({ _id: 'log_failure' });
  h.setFail({ collection: 'upload_logs', op: 'add' });
  r = await T.markExpired({ now: now });
  eq('D15 prepare 审计失败时不更新状态', docById('log_failure').status, 'pending');
  eq('D16 prepare 审计失败返回 LOG_FAILED', r.code, 'LOG_FAILED');

  prepare();
  seedSubmission({ _id: 'record_log_failure' });
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
  r = await T.markExpired({ now: now });
  eq('D17 逐条审计失败如实返回 LOG_FAILED', r.code, 'LOG_FAILED');
  eq('D18 逐条审计失败不能伪称状态未更新', docById('record_log_failure').status, 'expired');
  eq('D19 逐条审计失败标明已更新数量', r.marked, 1);
  eq('D19b 逐条审计失败仍写 PARTIAL 批次尾', h.docs('upload_logs').filter(function (log) {
    return log.result && log.result.code === 'PARTIAL' && log.result.stats.auditFailed === true;
  }).length, 1);

  prepare();
  seedSubmission({ _id: 'complete_log_failure' });
  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 3 });
  r = await T.markExpired({ now: now });
  eq('D20 complete 审计失败如实返回 LOG_FAILED', r.code, 'LOG_FAILED');
  eq('D21 complete 审计失败保留成功计数', r.marked, 1);

  console.log('== E. 缺陷回归与失败后续跑 ==');
  prepare({ batchLimit: '1' });
  seedSubmission({ _id: 'empty_only', payload: null, rev: 7 });
  r = await T.markExpired({ now: now });
  ok('E1 空正文单独到期仍标记且只记一次逐条事件', r.marked === 1 &&
    docById('empty_only').status === 'expired' && docById('empty_only').rev === 8 &&
    docById('empty_only').payload === null && h.docs('upload_logs').filter(function (log) {
      return log.submissionId === 'empty_only' && log.result.code === 'OK';
    }).length === 1);

  prepare({ batchLimit: '1' });
  seedSubmission({ _id: 'older_approved', status: 'approved', createdAt: new Date('2026-01-01T00:00:00Z') });
  seedSubmission({ _id: 'eligible_pending', createdAt: new Date('2026-01-02T00:00:00Z') });
  let selectedCondition;
  const originalCollection = h.db.collection;
  h.db.collection = function (name) {
    const collection = originalCollection(name);
    if (name !== 'submissions') return collection;
    const originalWhere = collection.where;
    collection.where = function (condition) {
      if (condition && condition.createdAt) selectedCondition = condition;
      return originalWhere(condition);
    };
    return collection;
  };
  try { r = await T.markExpired({ now: now }); }
  finally { h.db.collection = originalCollection; }
  ok('E2 查询先过滤 pending 再限批', !!selectedCondition &&
    selectedCondition.status === 'pending' && selectedCondition.createdAt.__op === 'lt' &&
    r.marked === 1 && docById('eligible_pending').status === 'expired');

  prepare();
  seedSubmission({ _id: 'changed_pending' });
  h.setBeforeUpdate(function (rows) {
    rows[0].rev = 2;
    h.setBeforeUpdate(null);
  });
  const firstConflict = await T.markExpired({ now: now });
  const secondAttempt = await T.markExpired({ now: now });
  ok('E3 并发版本变化后重跑只标记一次', firstConflict.conflicts === 1 &&
    firstConflict.marked === 0 && secondAttempt.marked === 1 &&
    docById('changed_pending').rev === 3 &&
    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'changed_pending'; }).length === 1);

  prepare();
  seedSubmission({ _id: 'retry_failed_first', createdAt: new Date('2026-01-01T00:00:00Z') });
  seedSubmission({ _id: 'retry_succeeded_second', createdAt: new Date('2026-01-02T00:00:00Z') });
  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
  const partial = await T.markExpired({ now: now });
  h.clearFail();
  const recovered = await T.markExpired({ now: now });
  ok('E4 单条更新失败后重跑只补未完成记录', partial.code === 'DATABASE_ERROR' &&
    partial.marked === 1 && partial.failed === 1 && recovered.marked === 1 &&
    docById('retry_failed_first').status === 'expired' &&
    docById('retry_succeeded_second').rev === 2 &&
    ['retry_failed_first', 'retry_succeeded_second'].every(function (id) {
      return h.docs('upload_logs').filter(function (log) { return log.submissionId === id; }).length === 1;
    }));

  console.log('');
  console.log('---- 汇总 ----');
  console.log('PASS ' + pass + ' / FAIL ' + failCount);
  if (failCount > 0) {
    console.log('失败用例：');
    failures.forEach(function (failure) { console.log(' - ' + failure); });
    process.exitCode = 1;
  } else {
    console.log('RESULT: OK（本地模拟，未验证云端真实行为）');
  }
}

main().catch(function (err) {
  console.error('测试脚本自身异常：', err && err.stack || err);
  process.exitCode = 1;
});
