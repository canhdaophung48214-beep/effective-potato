/**
 * retention —— UGC 保留期本地准备：到期状态标记。
 *
 * 本函数不包含 triggers 配置，不能因提交本代码而自动运行。部署前必须由负责人
 * 在云环境显式确认每项策略参数；缺少或未确认任一参数时，入口失败关闭且不读写数据。
 *
 * mark 标记到期 pending；recover/recoverPending 补齐标记审计。
 * purge 在独立阶段清理超过 30 天的终态正文，并补齐清理审计。
 * reconcile 只读、按批次日志核对 prepare/complete；截断窗口不作全局结论。
 * 日志轮转与云端触发器仍不在本入口实现。
 *
 * 环境变量（均必填、无默认值）：
 *   UGC_RETENTION_POLICY_STATUS=confirmed
 *   UGC_RETENTION_MARK_AFTER_DAYS=29（已裁决，其他值拒绝）
 *   UGC_RETENTION_BATCH_LIMIT=<负责人确认的 1-100 正整数>
 *   UGC_RETENTION_CONFIRMED_BY=<确认记录标识，非空>
 *   UGC_RETENTION_TRIGGER_TOKEN=<高熵维护令牌；只在触发器事件中传入>
 */

'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COL = Object.freeze({
  SUBMISSIONS: 'submissions',
  LOGS: 'upload_logs'
});

const STATUS = Object.freeze({
  PENDING: 'pending',
  EXPIRED: 'expired'
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MARK_AFTER_DAYS = 29;
const PURGE_AFTER_DAYS = 30;
const MAX_BATCH_LIMIT = 100;
const PURGE_STATES = Object.freeze(['approved', 'rejected', 'expired']);
// See UGC_MVP_DESIGN_FINAL §3.5.2: equality is already a suspected orphan.
const RECONCILE_GRACE_MS = 10 * 60 * 1000;
const RECONCILE_PAGE_SIZE = 50;
const RECONCILE_MAX_ROWS = 500;
// Continuations are diagnostics only; purge never accepts a caller supplied scan token.
const RECONCILE_TOKEN_MAX_CHARS = 2 * 1024 * 1024;
const PURGE_AUDIT_GATE_TIMEOUT_MS = 5000;
const PURGE_ROW_LEASE_MS = 30 * 1000;
const OFFLINE_PURGE_SIMULATION = Symbol('retention-offline-purge-simulation');

function fail(code, message, extra) {
  return Object.assign({ ok: false, code: code, message: message || '' }, extra || {});
}

function parsePositiveInteger(raw, max) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < 1 || (max && value > max)) return null;
  return value;
}

function readPolicy() {
  if (process.env.UGC_RETENTION_POLICY_STATUS !== 'confirmed') {
    return { error: fail('RETENTION_NOT_CONFIRMED', '保留期策略尚未由负责人确认') };
  }

  const markAfterDays = parsePositiveInteger(process.env.UGC_RETENTION_MARK_AFTER_DAYS);
  const batchLimit = parsePositiveInteger(process.env.UGC_RETENTION_BATCH_LIMIT, MAX_BATCH_LIMIT);
  const confirmedBy = typeof process.env.UGC_RETENTION_CONFIRMED_BY === 'string'
    ? process.env.UGC_RETENTION_CONFIRMED_BY.trim()
    : '';
  if (markAfterDays !== MARK_AFTER_DAYS || !batchLimit || !confirmedBy) {
    return { error: fail('RETENTION_CONFIG_INVALID', '已确认的保留期策略参数不完整或不合法') };
  }
  return { policy: { markAfterDays: markAfterDays, batchLimit: batchLimit, confirmedBy: confirmedBy } };
}

function makeCutoff(now, markAfterDays) {
  return new Date(now.getTime() - markAfterDays * DAY_MS);
}

function hasValidMaintenanceToken(value) {
  const expected = process.env.UGC_RETENTION_TRIGGER_TOKEN;
  if (typeof expected !== 'string' || !expected.trim() || typeof value !== 'string') return false;
  const expectedBuffer = Buffer.from(expected.trim(), 'utf8');
  const actualBuffer = Buffer.from(value, 'utf8');
  return expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function writeRunLog(result, phase, code, submissionId, eventId) {
  const data = {
    schemaVersion: 1,
    event: 'retention_mark',
    action: 'retention_mark',
    submissionId: submissionId || null,
    day: result.day || result.now.toISOString().slice(0, 10),
    result: { code: code },
    errorCode: '',
    actor: { role: 'system', openidHash: null },
    at: db.serverDate(),
    rev: 1
  };
  // The eight-field long-term projection is separate from the complete runtime log.
  if (eventId) data._id = eventId;
  if (phase !== 'record') {
    data.result.stats = result.operation === 'recoverPending' ? {
      phase: phase, operation: 'recoverPending', batchId: result.batchId,
      selected: result.selected, recovered: result.recovered, deferred: result.deferred,
      conflicts: result.conflicts, failed: result.failed, unprocessed: result.unprocessed
    } : {
      phase: phase,
      operation: result.operation || 'mark',
      batchId: result.batchId,
      marked: result.marked,
      skipped: result.skipped,
      conflicts: result.conflicts,
      failed: result.failed,
      auditFailed: !!result.auditFailed,
      attempts: result.attempts,
      selected: result.selected,
      markedAudited: result.markedAudited,
      auditFailedCount: result.auditFailedCount,
      unprocessed: result.unprocessed
    };
  }
  return db.collection(COL.LOGS).add({ data: data });
}

function recordEventId(id, nextRev) {
  return 'retention_mark_' + crypto.createHash('sha256')
    .update(String(id) + '\0' + String(nextRev)).digest('hex');
}

const RECOVERY_RETRY_MS = 60 * 1000;

async function deferAudit(row, now) {
  const audit = row && row.retention && row.retention.audit;
  if (!audit || audit.state !== 'pending' || !Number.isSafeInteger(row.rev) ||
      row.rev >= Number.MAX_SAFE_INTEGER) return false;
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: row._id, status: row.status, rev: row.rev,
        'retention.audit.eventId': audit.eventId, 'retention.audit.state': 'pending' })
      .update({ data: { retention: Object.assign({}, row.retention,
        { audit: Object.assign({}, audit, { retryAfter: new Date(now.getTime() + RECOVERY_RETRY_MS) }) }),
        rev: row.rev + 1 } });
    return !!(updated && updated.stats && updated.stats.updated === 1);
  } catch (err) { return false; }
}

async function recoverAudit(submissionId) {
  if (typeof submissionId !== 'string' || !submissionId.trim()) return fail('INVALID_SUBMISSION_ID', '缺少投稿 ID');
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
  catch (err) { return fail('DATABASE_ERROR', '无法读取待补审计记录'); }
  const retention = row && row.retention;
  const audit = retention && retention.audit;
  if (!audit) return fail('NO_PENDING_AUDIT', '该投稿没有待补审计标记');
  if (audit.state === 'complete') return { ok: true, code: 'ALREADY_RECOVERED' };
  if (audit.state !== 'pending' || !Number.isSafeInteger(row.rev) ||
      row.rev >= Number.MAX_SAFE_INTEGER || !Number.isInteger(audit.markedRev) ||
      audit.eventId !== recordEventId(row._id, audit.markedRev) || !/^\d{4}-\d{2}-\d{2}$/.test(audit.day)) {
    return fail('AUDIT_STATE_INVALID', '待补审计标记与投稿状态不一致');
  }
  try {
    await writeRunLog({ day: audit.day }, 'record', 'OK', row._id, audit.eventId);
  } catch (err) {
    // A lost acknowledgement can mean the append succeeded. Confirm by stable _id.
    let existing;
    try { existing = (await db.collection(COL.LOGS).doc(audit.eventId).get()).data; }
    catch (readErr) { return fail('LOG_FAILED', '逐条审计尚未确认写入', { logged: false }); }
    if (!existing || existing.event !== 'retention_mark' || existing.submissionId !== row._id) {
      return fail('AUDIT_STATE_INVALID', '审计 ID 已被其他内容占用');
    }
    if (existing._id !== audit.eventId || existing.action !== 'retention_mark' ||
        existing.day !== audit.day || existing.rev !== 1 ||
        !existing.actor || existing.actor.role !== 'system' || existing.actor.openidHash !== null ||
        !existing.result || existing.result.code !== 'OK') {
      return fail('AUDIT_STATE_INVALID', '已有审计内容与待补标记不一致');
    }
  }
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: row._id, status: row.status, rev: row.rev,
        'retention.audit.eventId': audit.eventId, 'retention.audit.state': 'pending' })
      .update({ data: { retention: Object.assign({}, retention,
        { audit: Object.assign({}, audit, { state: 'complete' }) }), rev: row.rev + 1 } });
    if (!updated || !updated.stats || updated.stats.updated !== 1) {
      let latest;
      try { latest = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
      catch (err) { return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除'); }
      if (latest && Number.isInteger(latest.rev) && latest.rev >= row.rev + 1 &&
          latest.retention && latest.retention.audit &&
          latest.retention.audit.eventId === audit.eventId && latest.retention.audit.state === 'complete') {
        return { ok: true, code: 'ALREADY_RECOVERED', submissionId: row._id, rev: latest.rev };
      }
      return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除');
    }
  } catch (err) { return fail('DATABASE_ERROR', '审计已存在，但待补标记清除失败'); }
  return { ok: true, code: 'OK', submissionId: row._id, rev: row.rev + 1 };
}

async function recoverPending(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
  const limit = config.policy.batchLimit;
  let rows;
  try {
    const response = await db.collection(COL.SUBMISSIONS)
      .where({ 'retention.audit.state': 'pending' })
      .orderBy('retention.audit.retryAfter', 'asc')
      .orderBy('createdAt', 'asc')
      .orderBy('_id', 'asc')
      .limit(limit).get();
    rows = response && Array.isArray(response.data) ? response.data : [];
  } catch (err) {
    return fail('DATABASE_ERROR', '读取待补审计队列失败',
      { selected: 0, recovered: 0, deferred: 0, conflicts: 0, failed: 0 });
  }
  const result = { selected: rows.length, recovered: 0, deferred: 0,
    conflicts: 0, failed: 0, unprocessed: rows.length,
    hasMore: rows.length === limit, nextEligibleAt: null, now: now,
    operation: 'recoverPending', batchId: options && options.requestId || crypto.randomBytes(16).toString('hex') };
  try { await writeRunLog(result, 'prepare', 'PREPARE', null); }
  catch (err) { return fail('LOG_FAILED', '恢复批次准备审计失败，未处理记录',
    { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
      unprocessed: rows.length, logged: false }); }
  for (const row of rows) {
    const retryAfter = row && row.retention && row.retention.audit && row.retention.audit.retryAfter;
    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) {
      result.deferred++;
      if (!result.nextEligibleAt || new Date(retryAfter) < new Date(result.nextEligibleAt)) {
        result.nextEligibleAt = new Date(retryAfter).toISOString();
      }
      continue;
    }
    const outcome = await recoverAudit(row._id);
    if (outcome.ok && outcome.code === 'OK') result.recovered++;
    else if (outcome.ok || outcome.code === 'STATE_CONFLICT' || outcome.code === 'NO_PENDING_AUDIT') {
      result.conflicts++;
    } else {
      result.failed++;
      const deferred = await deferAudit(row, now);
      if (!deferred) result.retrySchedulingFailed = true;
    }
  }
  result.unprocessed = result.selected - result.recovered - result.deferred - result.conflicts - result.failed;
  const completion = result.failed || result.retrySchedulingFailed ? 'PARTIAL' :
    (result.deferred || result.conflicts ? 'DEFERRED' : 'COMPLETE');
  try { await writeRunLog(result, 'complete', completion, null); }
  catch (err) { return fail('LOG_FAILED', '恢复批次已执行，收尾审计未确认写入',
    Object.assign({ logged: false }, result)); }
  // Every selected row belongs to exactly one class. Completed and deferred rows
  // leave the head of the next eligible batch; failed rows receive a retry delay.
  return Object.assign({ ok: result.failed === 0, code: result.failed ? 'RECOVERY_PARTIAL' : 'OK',
    complete: completion === 'COMPLETE' }, result);
}

function purgeEventId(id, rev) {
  return 'retention_purge_' + crypto.createHash('sha256')
    .update(String(id) + '\0' + String(rev)).digest('hex');
}

function purgeBatchLogId(batchId, phase) {
  return 'retention_purge_batch_' + phase + '_' + crypto.createHash('sha256')
    .update(String(batchId)).digest('hex');
}

function purgeEvidence(rows) {
  const key = scanTokenKey();
  if (!key) return null;
  return rows.map(function (row) {
    return { id: row._id, rev: row.rev, status: row.status,
      payloadProof: crypto.createHmac('sha256', key)
        .update(JSON.stringify(row.payload)).digest('hex') };
  });
}

function evidenceDigest(manifest) {
  const key = scanTokenKey();
  return key && Array.isArray(manifest) ? crypto.createHmac('sha256', key)
    .update(JSON.stringify(manifest)).digest('hex') : null;
}

function deferredResolutionSeal(stats) {
  const key = scanTokenKey();
  if (!key) return null;
  const copy = Object.assign({}, stats);
  delete copy.seal;
  return crypto.createHmac('sha256', key).update(JSON.stringify(copy)).digest('hex');
}

async function writePurgeLog(result, phase, code, submissionId, eventId) {
  const data = {
    schemaVersion: 1, event: 'retention_purge', action: 'retention_purge',
    submissionId: submissionId || null, day: result.day || result.now.toISOString().slice(0, 10),
    result: { code: code }, errorCode: '',
    actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1
  };
  if (eventId) data._id = eventId;
  if (phase !== 'record') data.result.stats = result.operation === 'recoverPurgePending' ? {
    phase: phase, operation: 'recoverPurgePending', batchId: result.batchId,
    selected: result.selected, recovered: result.recovered, deferred: result.deferred,
    conflicts: result.conflicts, failed: result.failed, unprocessed: result.unprocessed
  } : {
    phase: phase, operation: result.operation || 'purge',
    batchId: result.batchId, selected: result.selected,
    purged: result.purged, purgedAudited: result.purgedAudited,
    auditFailedCount: result.auditFailedCount, deferredAudit: result.deferredAudit,
    deferredRetry: result.deferredRetry, conflicts: result.conflicts,
    failed: result.failed, skipped: result.skipped, unprocessed: result.unprocessed,
    needsMark: result.needsMark
  };
  if (phase !== 'record' && result.notStartedReason) {
    data.result.stats.notStartedReason = result.notStartedReason;
    data.result.stats.zeroBusinessWrites = result.zeroBusinessWrites === true;
  }
  if (phase === 'complete' && result.retryableReasons) {
    data.result.stats.retryableReasons = result.retryableReasons;
    data.result.stats.retryableDigest = evidenceDigest(result.retryableReasons);
    data.result.stats.retryAfter = result.retryAfter;
  }
  if (phase === 'complete' && result.deferredReasons) {
    data.result.stats.deferredReasons = result.deferredReasons;
    data.result.stats.deferredDigest = evidenceDigest(result.deferredReasons);
  }
  if (phase !== 'record' && (result.operation || 'purge') === 'purge') {
    data._id = purgeBatchLogId(result.batchId, phase);
    if (phase === 'prepare' && result.selectedEvidence) {
      data.result.stats.selectedEvidence = result.selectedEvidence;
      data.result.stats.evidenceDigest = evidenceDigest(result.selectedEvidence);
    }
  }
  return db.collection(COL.LOGS).add({ data: data });
}

async function recoverPurgeAudit(submissionId) {
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
  catch (err) { return fail('DATABASE_ERROR', '读取待补清理审计失败'); }
  const purge = row && row.retention && row.retention.purge;
  if (!purge) return fail('NO_PENDING_PURGE_AUDIT', '没有待补清理审计标记');
  if (purge.state === 'complete') return { ok: true, code: 'ALREADY_RECOVERED' };
  if (purge.state !== 'pending' || !Number.isSafeInteger(row.rev) ||
      row.rev >= Number.MAX_SAFE_INTEGER || !Number.isInteger(purge.purgedRev) ||
      purge.eventId !== purgeEventId(row._id, purge.purgedRev) || row.payload !== null ||
      !/^\d{4}-\d{2}-\d{2}$/.test(purge.day)) {
    return fail('PURGE_AUDIT_STATE_INVALID', '清理状态与待补审计标记不一致');
  }
  try { await writePurgeLog({ day: purge.day }, 'record', 'OK', row._id, purge.eventId); }
  catch (err) {
    let existing;
    try { existing = (await db.collection(COL.LOGS).doc(purge.eventId).get()).data; }
    catch (readErr) { return fail('LOG_FAILED', '清理逐条审计尚未确认落库'); }
    if (!existing || existing._id !== purge.eventId || existing.event !== 'retention_purge' ||
        existing.action !== 'retention_purge' || existing.submissionId !== row._id ||
        existing.day !== purge.day || existing.rev !== 1 ||
        !existing.actor || existing.actor.role !== 'system' || existing.actor.openidHash !== null ||
        !existing.result || existing.result.code !== 'OK') {
      return fail('PURGE_AUDIT_STATE_INVALID', '已有清理审计内容不匹配');
    }
  }
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: row._id, status: row.status, rev: row.rev,
        'retention.purge.eventId': purge.eventId, 'retention.purge.state': 'pending' })
      .update({ data: { 'retention.purge.state': 'complete', rev: row.rev + 1 } });
    if (updated && updated.stats && updated.stats.updated === 1) {
      return { ok: true, code: 'OK', rev: row.rev + 1 };
    }
    const latest = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data;
    if (latest && Number.isInteger(latest.rev) && latest.rev >= row.rev + 1 &&
        latest.retention && latest.retention.purge &&
        latest.retention.purge.eventId === purge.eventId && latest.retention.purge.state === 'complete') {
      return { ok: true, code: 'ALREADY_RECOVERED', rev: latest.rev };
    }
    return fail('STATE_CONFLICT', '清理审计已存在，待补标记尚未确认完成');
  } catch (err) { return fail('DATABASE_ERROR', '清理审计已存在，待补标记更新失败'); }
}

async function deferPurge(row, now) {
  const purge = row.retention && row.retention.purge || {};
  if (purge.state === 'complete' || !Number.isSafeInteger(row.rev) ||
      row.rev >= Number.MAX_SAFE_INTEGER) return false;
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: row._id, status: row.status, rev: row.rev })
      .update({ data: { 'retention.purge.retryAfter': new Date(now.getTime() + RECOVERY_RETRY_MS),
        rev: row.rev + 1 } });
    return !!(updated && updated.stats && updated.stats.updated === 1);
  } catch (err) { return false; }
}

// The lock and the payload live in the same submission document. A successful
// takeover changes both rev and fencingToken, so a stale owner cannot match
// the later payload update. This does not serialize the global upload_logs scan.
async function acquirePurgeLease(row, now, owner) {
  if (!row || PURGE_STATES.indexOf(row.status) === -1 ||
      !Number.isSafeInteger(row.rev) || row.rev < 1 ||
      row.rev >= Number.MAX_SAFE_INTEGER ||
      typeof owner !== 'string' || !/^[0-9a-f]{32}$/.test(owner) ||
      !(now instanceof Date) || Number.isNaN(now.getTime())) {
    return fail('LOCK_STATE_INVALID', '清理行锁参数无效');
  }
  const previous = row.retention && row.retention.purge && row.retention.purge.lock;
  if (previous && (!['held', 'released'].includes(previous.state) ||
      !/^[0-9a-f]{32}$/.test(previous.owner) ||
      !Number.isSafeInteger(previous.fencingToken) || previous.fencingToken < 1 ||
      Number.isNaN(new Date(previous.leaseExpiresAt).getTime()))) {
    return fail('LOCK_STATE_INVALID', '已有清理行锁不合法');
  }
  const previousToken = previous && previous.fencingToken || 0;
  if (!Number.isSafeInteger(previousToken) || previousToken < 0 ||
      previousToken === Number.MAX_SAFE_INTEGER) return fail('LOCK_STATE_INVALID', '清理行锁世代无效');
  if (previous && previous.state === 'held' &&
      new Date(previous.leaseExpiresAt).getTime() > now.getTime()) {
    return fail('LOCK_BUSY', '清理行锁仍由其他实例持有');
  }
  const lock = { state: 'held', owner: owner, fencingToken: previousToken + 1,
    leaseExpiresAt: new Date(now.getTime() + PURGE_ROW_LEASE_MS) };
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: row._id, status: row.status, rev: row.rev, payload: _.neq(null) })
      .update({ data: { 'retention.purge.lock': lock, rev: row.rev + 1 } });
    if (!updated || !updated.stats || updated.stats.updated !== 1) {
      return fail('STATE_CONFLICT', '清理行锁获取时投稿已变化');
    }
    return { ok: true, code: 'OK', lock: lock, rev: row.rev + 1 };
  } catch (err) { return fail('DATABASE_ERROR', '清理行锁获取失败'); }
}

async function changePurgeLease(id, owner, fencingToken, now, state) {
  if (typeof id !== 'string' || !id || !/^[0-9a-f]{32}$/.test(owner) ||
      !Number.isSafeInteger(fencingToken) || fencingToken < 1 ||
      !(now instanceof Date) || Number.isNaN(now.getTime()) ||
      !['held', 'released'].includes(state)) return fail('LOCK_STATE_INVALID', '清理行锁参数无效');
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(id).get()).data; }
  catch (err) { return fail('DATABASE_ERROR', '读取清理行锁失败'); }
  const lock = row && row.retention && row.retention.purge && row.retention.purge.lock;
  if (!row || !Number.isSafeInteger(row.rev) || row.rev >= Number.MAX_SAFE_INTEGER) {
    return fail('LOCK_STATE_INVALID', '清理行锁版本无效');
  }
  if (state === 'released' && lock && lock.state === 'released' &&
      lock.owner === owner && lock.fencingToken === fencingToken) {
    return { ok: true, code: 'ALREADY_RELEASED', rev: row.rev, lock: lock };
  }
  if (!lock || lock.state !== 'held' || lock.owner !== owner ||
      lock.fencingToken !== fencingToken) return fail('LOCK_LOST', '清理行锁已被接管');
  if (state === 'held' && new Date(lock.leaseExpiresAt).getTime() <= now.getTime()) {
    return fail('LOCK_EXPIRED', '清理行锁租约已到期');
  }
  const nextLock = Object.assign({}, lock, { state: state,
    leaseExpiresAt: state === 'held' ? new Date(now.getTime() + PURGE_ROW_LEASE_MS) : now });
  try {
    const updated = await db.collection(COL.SUBMISSIONS)
      .where({ _id: id, rev: row.rev, 'retention.purge.lock.owner': owner,
        'retention.purge.lock.fencingToken': fencingToken,
        'retention.purge.lock.state': 'held' })
      .update({ data: { 'retention.purge.lock': nextLock, rev: row.rev + 1 } });
    return updated && updated.stats && updated.stats.updated === 1 ?
      { ok: true, code: 'OK', rev: row.rev + 1, lock: nextLock } :
      fail('STATE_CONFLICT', '清理行锁更新时投稿已变化');
  } catch (err) { return fail('DATABASE_ERROR', '清理行锁更新失败'); }
}

function renewPurgeLease(id, owner, fencingToken, now) {
  return changePurgeLease(id, owner, fencingToken, now, 'held');
}

function releasePurgeLease(id, owner, fencingToken, now) {
  return changePurgeLease(id, owner, fencingToken, now, 'released');
}

// Confirm an ambiguous release acknowledgement by reading the same document.
// A changed fencing token is never treated as our release succeeding.
async function recoverPurgeLease(id, owner, fencingToken, now) {
  const first = await releasePurgeLease(id, owner, fencingToken, now);
  if (first.ok || first.code === 'LOCK_LOST' || first.code === 'LOCK_STATE_INVALID') return first;
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(id).get()).data; }
  catch (err) { return fail('LOCK_RELEASE_UNCONFIRMED', '无法确认行锁释放结果'); }
  const lock = row && row.retention && row.retention.purge && row.retention.purge.lock;
  if (lock && lock.owner === owner && lock.fencingToken === fencingToken &&
      lock.state === 'released') {
    return { ok: true, code: 'ALREADY_RELEASED', rev: row.rev, lock: lock };
  }
  if (!lock || lock.owner !== owner || lock.fencingToken !== fencingToken) {
    return fail('LOCK_LOST', '行锁已被其他实例接管，旧实例不得写入');
  }
  return fail('LOCK_RELEASE_UNCONFIRMED', '行锁仍为持有状态，等待后续恢复');
}

async function recoverExpiredPurgeLease(id, now) {
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(id).get()).data; }
  catch (err) { return fail('DATABASE_ERROR', '无法读取待恢复行锁'); }
  const lock = row && row.retention && row.retention.purge && row.retention.purge.lock;
  if (!lock) return fail('LOCK_STATE_INVALID', '没有可恢复的行锁');
  if (lock.state === 'released') return { ok: true, code: 'ALREADY_RELEASED', rev: row.rev };
  if (lock.state !== 'held' || Number.isNaN(new Date(lock.leaseExpiresAt).getTime())) {
    return fail('LOCK_STATE_INVALID', '行锁状态不合法');
  }
  if (new Date(lock.leaseExpiresAt).getTime() > now.getTime()) {
    return fail('LOCK_BUSY', '租约尚未到期');
  }
  return recoverPurgeLease(id, lock.owner, lock.fencingToken, now);
}

async function reconcileAfterRepair() {
  let scan = await reconcileBatches({ eventType: 'retention_purge', resumable: true });
  for (let page = 1; page < 20 && scan && scan.nextContinuation; page++) {
    scan = await reconcileBatches({ eventType: 'retention_purge',
      continuation: scan.nextContinuation });
  }
  return scan;
}

async function discoverPurgeBatches(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const input = options || {};
  const batchRef = input.batchRef;
  const cursor = input.cursor || '';
  const limit = input.limit === undefined ? 100 : input.limit;
  if (typeof batchRef !== 'string' || !/^[0-9a-f]{24}$/.test(batchRef) ||
      typeof cursor !== 'string' || cursor.length > 128 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return fail('INVALID_DISCOVERY_OPTIONS', '批次发现参数无效');
  }
  let rows;
  try {
    const filter = { event: 'retention_purge' };
    if (cursor) filter._id = _.gt(cursor);
    const response = await db.collection(COL.LOGS).where(filter)
      .orderBy('_id', 'asc').limit(limit + 1).get();
    rows = response && response.data;
    if (!Array.isArray(rows)) throw new Error('missing data');
  } catch (err) { return fail('DATABASE_ERROR', '批次发现只读查询失败'); }
  const truncated = rows.length > limit;
  const page = rows.slice(0, limit);
  const matches = [];
  for (const log of page) {
    if (!log || !log.result || !log.result.stats ||
        log.result.stats.phase !== 'complete') continue;
    const info = batchLogInfo(log, 'retention_purge');
    if (!info || info.invalid || info.operation !== 'purge') continue;
    const ref = crypto.createHash('sha256').update('retention_purge\0purge\0' +
      info.batchId).digest('hex').slice(0, 24);
    if (ref !== batchRef) continue;
    let prepare;
    try { prepare = (await db.collection(COL.LOGS)
      .doc(purgeBatchLogId(info.batchId, 'prepare')).get()).data; }
    catch (err) { prepare = null; }
    const evidence = prepare && prepare.result && prepare.result.stats;
    const repairable = !!(evidence && Array.isArray(evidence.selectedEvidence) &&
      evidence.evidenceDigest === evidenceDigest(evidence.selectedEvidence));
    matches.push({ batchRef: ref, batchId: info.batchId, operation: 'purge',
      outcome: batchOutcome(info.completeCode), reasonCode: info.completeCode ===
        'DEFERRED_RETRYABLE' ? 'RETRYABLE_DEFERRED' : info.completeCode,
      createdAt: info.at.toISOString(), unresolvedCount: info.stats.selected -
        (info.stats.purgedAudited || 0), repairable: repairable,
      blockedReason: repairable ? 'REQUIRES_RECORD_RECHECK' : 'MISSING_IMMUTABLE_EVIDENCE' });
  }
  if (matches.length > 1) return fail('DISCOVERY_AMBIGUOUS', '批次引用不唯一');
  return { ok: true, code: matches.length ? 'FOUND' : 'NOT_FOUND_IN_PAGE',
    batches: matches, scanned: page.length, truncated: truncated,
    nextCursor: truncated && page.length ? page[page.length - 1]._id : null,
    completeScan: !truncated && !cursor };
}

async function repairPurgeBatch(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const batchId = options && options.batchId;
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(batchId)) {
    return fail('INVALID_BATCH_ID', '批次 ID 无效');
  }
  const prepareId = purgeBatchLogId(batchId, 'prepare');
  const completeId = purgeBatchLogId(batchId, 'complete');
  const repairId = purgeBatchLogId(batchId, 'repair');
  let prepare;
  let complete;
  let existing;
  try { prepare = (await db.collection(COL.LOGS).doc(prepareId).get()).data; }
  catch (err) { return fail('REPAIR_EVIDENCE_MISSING', '缺少稳定的批次准备证据'); }
  try { complete = (await db.collection(COL.LOGS).doc(completeId).get()).data; }
  catch (err) { return fail('REPAIR_EVIDENCE_MISSING', '缺少稳定的批次结束证据'); }
  try { existing = (await db.collection(COL.LOGS).doc(repairId).get()).data; }
  catch (err) { existing = null; }
  const pre = batchLogInfo(prepare, 'retention_purge');
  const end = batchLogInfo(complete, 'retention_purge');
  const manifest = pre && pre.stats && pre.stats.selectedEvidence;
  if (!pre || !end || pre.invalid || end.invalid || pre.phase !== 'prepare' ||
      end.phase !== 'complete' || pre.operation !== 'purge' || end.operation !== 'purge' ||
      pre.batchId !== batchId || end.batchId !== batchId ||
      !['PARTIAL', 'FAILED', 'DEFERRED_RETRYABLE'].includes(end.completeCode) ||
      pre.stats.selected !== end.stats.selected || !validCompleteCounts(end.stats) ||
      pre.day !== end.day || end.at.getTime() < pre.at.getTime() ||
      !Array.isArray(manifest) || manifest.length !== pre.stats.selected ||
      manifest.length > MAX_BATCH_LIMIT || !manifest.length ||
      pre.stats.evidenceDigest !== evidenceDigest(manifest) ||
      new Set(manifest.map(function (item) { return item && item.id; })).size !== manifest.length) {
    return fail('REPAIR_EVIDENCE_INVALID', '原始批次证据无法闭合');
  }
  if (existing) {
    const actual = batchLogInfo(existing, 'retention_purge');
    if (!actual || actual.invalid || actual.phase !== 'repair' ||
        actual.stats.prepareId !== prepareId || actual.stats.completeId !== completeId ||
        actual.stats.evidenceDigest !== pre.stats.evidenceDigest ||
        (end.completeCode === 'DEFERRED_RETRYABLE' &&
          actual.stats.retryableDigest !== end.stats.retryableDigest) ||
        actual.stats.selected !== manifest.length ||
        actual.stats.repairOperator !== 'system') {
      return fail('REPAIR_EVENT_CONFLICT', '稳定修复事件 ID 已被不符内容占用');
    }
    const scan = await reconcileAfterRepair();
    if (!scan || scan.ok !== true || scan.completeScan !== true || scan.code !== 'OK') {
      return fail('REPAIR_PENDING_RECONCILE', '历史修复事件存在，但完整对账尚未通过',
        { eventId: repairId, reconcileCode: scan && scan.code });
    }
    return { ok: true, code: 'ALREADY_REPAIRED', eventId: repairId };
  }
  const now = options && options.now instanceof Date ? options.now : new Date();
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间无效');
  if (end.completeCode === 'DEFERRED_RETRYABLE' &&
      (!Array.isArray(end.stats.retryableReasons) ||
       end.stats.retryableDigest !== evidenceDigest(end.stats.retryableReasons) ||
       end.stats.retryableReasons.length !== end.stats.deferredRetry + end.stats.conflicts ||
       new Set(end.stats.retryableReasons.map(function (x) { return x && x.id; })).size !==
         end.stats.retryableReasons.length ||
       !end.stats.retryableReasons.every(function (x) {
         return x && ['RETRY_AFTER', 'CAS_UNMATCHED'].includes(x.reasonCode) &&
           manifest.some(function (item) { return item.id === x.id; }) &&
           Number.isFinite(new Date(x.retryAfter).getTime());
       }) ||
       !Number.isFinite(new Date(end.stats.retryAfter).getTime()) ||
       new Date(end.stats.retryAfter).getTime() > now.getTime())) {
    return fail('REPAIR_RETRY_NOT_READY', '延期批次缺少可用证据或尚未到重试时间');
  }
  let confirmedAudited = 0;
  let confirmedUntouched = 0;
  for (const item of manifest) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        !Number.isSafeInteger(item.rev) || item.rev < 1 ||
        !PURGE_STATES.includes(item.status) || !/^[0-9a-f]{64}$/.test(item.payloadProof)) {
      return fail('REPAIR_EVIDENCE_INVALID', '选中记录证据无效');
    }
    let row;
    try { row = (await db.collection(COL.SUBMISSIONS).doc(item.id).get()).data; }
    catch (err) { return fail('REPAIR_EVIDENCE_MISSING', '无法读取选中记录'); }
    if (!row || row._id !== item.id) return fail('REPAIR_EVIDENCE_MISSING', '选中记录不存在');
    if (row.payload === null) {
      let purge = row.retention && row.retention.purge;
      if (purge && purge.lock && purge.lock.state === 'held') {
        const released = await recoverExpiredPurgeLease(item.id, now);
        if (!released.ok) return fail('REPAIR_LOCK_UNCONFIRMED', '清理行锁尚未安全释放');
        try { row = (await db.collection(COL.SUBMISSIONS).doc(item.id).get()).data; }
        catch (err) { return fail('REPAIR_EVIDENCE_MISSING', '无法复核行锁状态'); }
        purge = row && row.retention && row.retention.purge;
      }
      if (!purge || purge.state !== 'complete' || !purge.lock ||
          purge.lock.state !== 'released' ||
          !Number.isSafeInteger(purge.purgedRev) || purge.purgedRev < 1 ||
          !validUtcDay(purge.day) ||
          purge.eventId !== purgeEventId(item.id, purge.purgedRev)) {
        return fail('REPAIR_EVIDENCE_INCOMPLETE', '清理审计或行锁尚未完成');
      }
      let record;
      try { record = (await db.collection(COL.LOGS).doc(purge.eventId).get()).data; }
      catch (err) { return fail('REPAIR_EVIDENCE_MISSING', '缺少逐条清理日志'); }
      if (!record || record._id !== purge.eventId || record.event !== 'retention_purge' ||
          record.action !== 'retention_purge' || record.submissionId !== item.id ||
          record.day !== purge.day || record.schemaVersion !== 1 || record.rev !== 1 ||
          !record.actor || record.actor.role !== 'system' || record.actor.openidHash !== null ||
          !record.result || record.result.code !== 'OK') {
        return fail('REPAIR_EVIDENCE_INVALID', '逐条清理日志不匹配');
      }
      confirmedAudited++;
    } else {
      const proof = purgeEvidence([row]);
      if (!proof || row.rev !== item.rev || row.status !== item.status ||
          proof[0].payloadProof !== item.payloadProof ||
          row.retention && row.retention.audit && row.retention.audit.state === 'pending' ||
          row.retention && row.retention.purge && row.retention.purge.lock &&
            row.retention.purge.lock.state === 'held' ||
          row.retention && row.retention.purge && row.retention.purge.state === 'pending') {
        return fail('REPAIR_EVIDENCE_INCOMPLETE', '未清正文记录已变化，不能证明安全重试');
      }
      if (end.completeCode === 'DEFERRED_RETRYABLE' &&
          !end.stats.retryableReasons.some(function (reason) { return reason.id === item.id; })) {
        return fail('REPAIR_EVIDENCE_INCOMPLETE', '未清记录缺少延期原因');
      }
      confirmedUntouched++;
    }
  }
  const stats = { phase: 'repair', operation: 'purge', batchId: batchId,
    selected: manifest.length, prepareId: prepareId, completeId: completeId,
    evidenceDigest: pre.stats.evidenceDigest, confirmedAudited: confirmedAudited,
    confirmedUntouched: confirmedUntouched, repairReason: 'VERIFIED_SELECTED_RECORDS',
    repairOperator: 'system' };
  if (end.completeCode === 'DEFERRED_RETRYABLE') {
    stats.retryableDigest = end.stats.retryableDigest;
  }
  const repairLog = { _id: repairId, schemaVersion: 1, event: 'retention_purge',
    action: 'retention_purge', submissionId: null, day: now.toISOString().slice(0, 10),
    result: { code: 'REPAIR_CONFIRMED', stats: stats }, errorCode: '',
    actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1 };
  try { await db.collection(COL.LOGS).add({ data: repairLog }); }
  catch (err) {
    try { existing = (await db.collection(COL.LOGS).doc(repairId).get()).data; }
    catch (readErr) { return fail('REPAIR_LOG_UNCONFIRMED', '修复日志写入未确认'); }
    const actual = batchLogInfo(existing, 'retention_purge');
    if (!actual || actual.invalid || JSON.stringify(actual.stats) !== JSON.stringify(stats)) {
      return fail('REPAIR_EVENT_CONFLICT', '修复日志回执不确定且内容不匹配');
    }
  }
  // A receipt alone never lifts the gate: rerun a complete, bounded scan.
  const scan = await reconcileAfterRepair();
  if (!scan || scan.ok !== true || scan.completeScan !== true || scan.code !== 'OK') {
    return fail('REPAIR_PENDING_RECONCILE', '修复事件已追加，但完整对账尚未通过',
      { eventId: repairId, reconcileCode: scan && scan.code });
  }
  return { ok: true, code: existing ? 'ALREADY_REPAIRED' : 'REPAIRED',
    eventId: repairId, confirmedAudited: confirmedAudited,
    confirmedUntouched: confirmedUntouched };
}

function exactDocumentAbsent(err) {
  // wx-server-sdk doc.get: the code alone is shared with unrelated failures.
  return !!(err && err.errCode === -1 &&
    /^(document does not exist|document not found)$/i.test(String(err.message || '').trim()));
}

function requeueAttemptId(batchId, id) {
  return 'retention_retry_' + crypto.createHash('sha256')
    .update(batchId + '\0' + id).digest('hex');
}

async function ensureDeferredAttempt(batchId, item, row, now) {
  const nextBatchId = requeueAttemptId(batchId, item.id);
  const stats = { operation: 'requeueDeferred', batchId: nextBatchId, sourceBatchId: batchId,
    submissionId: item.id, originalRev: item.rev, observedRev: row.rev,
    status: row.status, payloadProof: purgeEvidence([row])[0].payloadProof,
    createdAt: now.toISOString() };
  stats.seal = deferredResolutionSeal(stats);
  const eventId = nextBatchId;
  let existing;
  try { existing = (await db.collection(COL.LOGS).doc(eventId).get()).data; }
  catch (err) { if (!exactDocumentAbsent(err)) return null; }
  const valid = function (log) { const x = log && log.result && log.result.stats;
    return !!(log && log._id === eventId && log.event === 'retention_deferred_attempt' &&
      validAttemptMetadata(log, item.id) && log.result.code === 'REQUEUED_CURRENT_REV' &&
      x && x.batchId === nextBatchId && x.sourceBatchId === batchId &&
      x.submissionId === item.id && x.originalRev === item.rev && x.observedRev === row.rev &&
      x.status === row.status && x.payloadProof === stats.payloadProof &&
      x.seal === deferredResolutionSeal(x)); };
  if (!existing) {
    const log = { _id: eventId, schemaVersion: 1, event: 'retention_deferred_attempt',
      action: 'retention_deferred_attempt', submissionId: item.id,
      day: now.toISOString().slice(0, 10), result: { code: 'REQUEUED_CURRENT_REV', stats },
      errorCode: '', actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1 };
    try { await db.collection(COL.LOGS).add({ data: log }); existing = log; }
    catch (err) {
      try { existing = (await db.collection(COL.LOGS).doc(eventId).get()).data; }
      catch (readErr) { return null; }
    }
  }
  return valid(existing) ? { eventId, batchId: nextBatchId } : null;
}

function validAttemptMetadata(log, id) {
  return !!(log && log.schemaVersion === 1 && log.action === 'retention_deferred_attempt' &&
    log.submissionId === id && log.rev === 1 && validUtcDay(log.day) &&
    Number.isFinite(new Date(log.at).getTime()) && log.actor &&
    log.actor.role === 'system' && log.actor.openidHash === null);
}

async function resolutionAttemptsValid(stats) {
  for (const item of stats.items || []) {
    if (item.reasonCode !== 'REQUEUED_CURRENT_REV') continue;
    let log;
    try { log = (await db.collection(COL.LOGS).doc(item.evidenceRef).get()).data; }
    catch (err) { return false; }
    const x = log && log.result && log.result.stats;
    if (!x || log._id !== requeueAttemptId(stats.batchId, item.submissionId) ||
        log.event !== 'retention_deferred_attempt' || !validAttemptMetadata(log, item.submissionId) || log.result.code !== 'REQUEUED_CURRENT_REV' ||
        x.sourceBatchId !== stats.batchId || x.batchId !== item.nextBatchId ||
        x.submissionId !== item.submissionId || x.observedRev !== item.observedRev ||
        x.originalRev !== item.originalRev || x.seal !== deferredResolutionSeal(x)) return false;
  }
  return true;
}

async function retryDeferredAttempt(options, hooks) {
  if (!hooks || hooks[OFFLINE_PURGE_SIMULATION] !== true) {
    return fail('PURGE_GLOBAL_FENCE_UNVERIFIED', '跨文档全局审计屏障尚未验证');
  }
  const batchId = options && options.batchId;
  const id = options && options.submissionId;
  if (typeof batchId !== 'string' || typeof id !== 'string') return fail('BLOCKED_UNCERTAIN', '缺少重试引用');
  let resolution, attempt, row;
  try {
    resolution = (await db.collection(COL.LOGS).doc(purgeBatchLogId(batchId, 'deferred_resolution')).get()).data;
    attempt = (await db.collection(COL.LOGS).doc(requeueAttemptId(batchId, id)).get()).data;
    row = (await db.collection(COL.SUBMISSIONS).doc(id).get()).data;
  } catch (err) { return fail('BLOCKED_UNCERTAIN', '重试证据读取不确定'); }
  const info = resolution && batchLogInfo(resolution, 'retention_purge');
  const item = info && !info.invalid && info.stats.items.find(function (x) {
    return x.submissionId === id && x.reasonCode === 'REQUEUED_CURRENT_REV'; });
  const stats = attempt && attempt.result && attempt.result.stats;
  if (!item || !stats || !await resolutionAttemptsValid(info.stats) || !row ||
      row.rev !== stats.observedRev || row.status !== stats.status ||
      purgeEvidence([row])[0].payloadProof !== stats.payloadProof) {
    return fail('BLOCKED_UNCERTAIN', '重试当前版本与凭证不一致');
  }
  try {
    const existing = (await db.collection(COL.LOGS).doc(purgeBatchLogId(stats.batchId, 'prepare')).get()).data;
    if (existing) return fail('ATTEMPT_ALREADY_STARTED', '该重试已开始，须核对原尝试');
  } catch (err) { if (!exactDocumentAbsent(err)) return fail('BLOCKED_UNCERTAIN', '重试状态读取不确定'); }
  return purgePayload({ now: options.now, requestId: stats.batchId, retrySubmissionId: id, retryEvidence: stats }, hooks);
}

async function disposeDeferredBatch(options) {
  const result = await resolveDeferredBatch(Object.assign({}, options, { disposition: true }));
  return result.ok ? result : Object.assign({}, result, { reasonCode: result.code,
    code: 'BLOCKED_UNCERTAIN', resolutionState: 'BLOCKED_UNCERTAIN' });
}

async function resolveDeferredBatch(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const batchId = options && options.batchId;
  if (typeof batchId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(batchId)) {
    return fail('INVALID_BATCH_ID', '批次 ID 无效');
  }
  const prepareId = purgeBatchLogId(batchId, 'prepare');
  const completeId = purgeBatchLogId(batchId, 'complete');
  const resolutionId = purgeBatchLogId(batchId, 'deferred_resolution');
  let prepare, complete, existing;
  try { prepare = (await db.collection(COL.LOGS).doc(prepareId).get()).data;
    complete = (await db.collection(COL.LOGS).doc(completeId).get()).data; }
  catch (err) { return fail('DEFERRED_MANIFEST_MISSING', '原批次日志或清单不存在'); }
  try { existing = (await db.collection(COL.LOGS).doc(resolutionId).get()).data; }
  catch (err) {
    if (options && options.disposition && !exactDocumentAbsent(err)) {
      return fail('DEFERRED_LOG_UNCONFIRMED', '恢复凭证读取结果不确定');
    }
    existing = null;
  }
  const pre = batchLogInfo(prepare, 'retention_purge');
  const end = batchLogInfo(complete, 'retention_purge');
  const manifest = pre && pre.stats && pre.stats.selectedEvidence;
  const reasons = end && end.stats && end.stats.deferredReasons;
  if (!pre || !end || pre.invalid || end.invalid || pre.phase !== 'prepare' ||
      end.phase !== 'complete' || end.completeCode !== 'DEFERRED' ||
      pre.batchId !== batchId || end.batchId !== batchId ||
      !validCompleteCounts(end.stats) || pre.stats.selected !== end.stats.selected ||
      !Array.isArray(manifest) || !manifest.length || manifest.length !== end.stats.selected ||
      pre.stats.evidenceDigest !== evidenceDigest(manifest) ||
      !Array.isArray(reasons) || reasons.length !== end.stats.deferredAudit +
        end.stats.deferredRetry + end.stats.skipped + end.stats.conflicts ||
      end.stats.deferredDigest !== evidenceDigest(reasons) ||
      new Set(reasons.map(function (x) { return x && x.id; })).size !== reasons.length ||
      end.stats.failed !== 0 || end.stats.auditFailedCount !== 0 || end.stats.unprocessed !== 0) {
    return fail('DEFERRED_EVIDENCE_INVALID', '延期批次证据不完整');
  }
  const now = options && options.now instanceof Date ? options.now : new Date();
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '恢复时间无效');
  if (existing) {
    const info = batchLogInfo(existing, 'retention_purge');
    if (!info || info.invalid || info.phase !== 'resolution' ||
        info.stats.prepareId !== prepareId || info.stats.completeId !== completeId ||
        info.stats.manifestHash !== pre.stats.evidenceDigest ||
        info.stats.deferredDigest !== end.stats.deferredDigest) {
      return fail('DEFERRED_RESOLUTION_CONFLICT', '原恢复凭证不匹配');
    }
    if (!await resolutionAttemptsValid(info.stats)) return fail('DEFERRED_LOG_UNCONFIRMED', '重试凭证未验证');
    const checked = await reconcileAfterRepair();
    return checked && checked.ok && checked.completeScan ?
      { ok: true, code: 'ALREADY_RESOLVED', eventId: resolutionId } :
      fail('DEFERRED_RECONCILE_BLOCKED', '恢复凭证存在，但完整对账未通过');
  }
  const items = [];
  for (const item of manifest) {
    if (!item || typeof item.id !== 'string' || !item.id ||
        !Number.isSafeInteger(item.rev) || item.rev < 0 ||
        !/^[0-9a-f]{64}$/.test(item.payloadProof)) {
      return fail('DEFERRED_EVIDENCE_INVALID', '选中记录证据无效');
    }
    const deferredReason = reasons.find(function (x) { return x.id === item.id; });
    let row;
    try { row = (await db.collection(COL.SUBMISSIONS).doc(item.id).get()).data; }
    catch (err) {
      if (deferredReason && options && options.disposition && exactDocumentAbsent(err)) {
        items.push({ submissionId: item.id, originalRev: item.rev, observedRev: null, observedStatus: null,
          confirmedAbsent: true, reasonCode: 'RECORD_ABSENT', recoveryAction: 'confirmedExactDocumentNotFound',
          evidenceRef: completeId });
        continue;
      }
      return fail('DEFERRED_RECORD_MISSING', '无法重新读取选中记录');
    }
    if (options && options.disposition && deferredReason && row && row._id === item.id) {
      if (deferredReason.reasonCode === 'AUDIT_PENDING') {
        const audit = row.retention && row.retention.audit;
        let record;
        try { record = (await db.collection(COL.LOGS).doc(deferredReason.auditEventId).get()).data; }
        catch (err) { return fail('DEFERRED_AUDIT_MISSING', '待补审计缺少逐条日志'); }
        if (!audit || audit.state !== 'complete' || audit.eventId !== deferredReason.auditEventId ||
            !Number.isSafeInteger(audit.markedRev) || audit.eventId !== recordEventId(item.id, audit.markedRev) ||
            !record || record._id !== audit.eventId || record.submissionId !== item.id ||
            record.event !== 'retention_mark' || record.action !== 'retention_mark' ||
            record.day !== audit.day || record.rev !== 1 || !record.actor ||
            record.actor.role !== 'system' || record.actor.openidHash !== null ||
            !record.result || record.result.code !== 'OK') return fail('DEFERRED_AUDIT_MISSING', '逐条审计证据不匹配');
      }
      if (!Number.isSafeInteger(row.rev) || row.rev < 0) return fail('DEFERRED_REV_CONFLICT', '当前版本无效');
      const pending = row.retention && row.retention.audit && row.retention.audit.state === 'pending';
      const purge = row.retention && row.retention.purge;
      if (pending || purge && (purge.state === 'pending' || purge.lock && purge.lock.state === 'held')) {
        return fail('DEFERRED_RECORD_CHANGED', '待补审计或行锁尚未解决');
      }
      let disposition;
      let attempt;
      if (row.payload === null) disposition = 'ALREADY_CLEARED';
      else if (row.status === STATUS.PENDING) disposition = 'NO_LONGER_ELIGIBLE';
      else if (row.rev >= 1 && row.rev < Number.MAX_SAFE_INTEGER &&
          PURGE_STATES.includes(row.status) && row.payload !== undefined &&
          Number.isFinite(new Date(row.createdAt).getTime()) &&
          new Date(row.createdAt).getTime() < makeCutoff(now, PURGE_AFTER_DAYS).getTime()) {
        disposition = 'REQUEUED_CURRENT_REV';
        attempt = await ensureDeferredAttempt(batchId, item, row, now);
        if (!attempt) return fail('DEFERRED_LOG_UNCONFIRMED', '重试凭证未确认');
      }
      if (!disposition) return fail('DEFERRED_RECORD_CHANGED', '无法确认当前记录处置');
      items.push(Object.assign({ submissionId: item.id, originalRev: item.rev,
        observedRev: row.rev, observedStatus: row.status, reasonCode: disposition,
        recoveryAction: disposition === 'REQUEUED_CURRENT_REV' ? 'guardedPurgeNewBatch' : 'terminalDisposition',
        evidenceRef: attempt ? attempt.eventId : completeId },
        attempt ? { nextBatchId: attempt.batchId } : {}));
      continue;
    }
    if (!row || row._id !== item.id || row.status !== item.status) {
      return fail('DEFERRED_RECORD_CHANGED', '记录状态变化无法解释');
    }
    const reason = reasons.find(function (x) { return x.id === item.id; });
    if (row.payload === null) {
      if (reason) return fail('DEFERRED_RECORD_CHANGED', '延期记录的正文状态发生变化');
      const purge = row.retention && row.retention.purge;
      let record;
      try { record = purge && (await db.collection(COL.LOGS).doc(purge.eventId).get()).data; }
      catch (err) { return fail('DEFERRED_AUDIT_MISSING', '缺少已清记录的逐条日志'); }
      if (!purge || purge.state !== 'complete' || !purge.lock ||
          purge.lock.state !== 'released' || !record || record.submissionId !== item.id ||
          purge.purgedRev !== item.rev + 2 || row.rev !== item.rev + 4 ||
          purge.eventId !== purgeEventId(item.id, purge.purgedRev) ||
          record.event !== 'retention_purge' || record.action !== 'retention_purge' ||
          record.day !== purge.day || record.rev !== 1 || !record.actor ||
          record.actor.role !== 'system' || record.actor.openidHash !== null ||
          !record.result || record.result.code !== 'OK') {
        return fail('DEFERRED_AUDIT_MISSING', '已清记录的审计或行锁未完成');
      }
      items.push({ submissionId: item.id, originalRev: item.rev,
        observedRev: row.rev, reasonCode: 'ALREADY_AUDITED',
        recoveryAction: 'verifyPurgeAudit', evidenceRef: purge.eventId });
      continue;
    }
    if (!reason || reason.originalRev !== item.rev ||
        purgeEvidence([row])[0].payloadProof !== item.payloadProof ||
        row.retention && row.retention.audit && row.retention.audit.state === 'pending' ||
        row.retention && row.retention.purge && row.retention.purge.lock &&
          row.retention.purge.lock.state === 'held') {
      return fail('DEFERRED_RECORD_CHANGED', '延期记录证据无法解释');
    }
    let expectedRev = item.rev;
    let evidenceRef = completeId;
    if (reason.reasonCode === 'AUDIT_PENDING') {
      expectedRev = item.rev + 2;
      const audit = row.retention && row.retention.audit;
      let auditLog;
      try { auditLog = audit && (await db.collection(COL.LOGS).doc(reason.auditEventId).get()).data; }
      catch (err) { return fail('DEFERRED_AUDIT_MISSING', '审计补记日志不存在'); }
      if (!audit || audit.state !== 'complete' || audit.eventId !== reason.auditEventId ||
          !Number.isSafeInteger(audit.markedRev) ||
          audit.eventId !== recordEventId(item.id, audit.markedRev) ||
          reason.observedRev !== item.rev + 1 ||
          !auditLog || auditLog._id !== reason.auditEventId ||
          auditLog.submissionId !== item.id || auditLog.event !== 'retention_mark' ||
          auditLog.action !== 'retention_mark' || auditLog.day !== audit.day ||
          auditLog.rev !== 1 || !auditLog.actor || auditLog.actor.role !== 'system' ||
          auditLog.actor.openidHash !== null || !auditLog.result ||
          auditLog.result.code !== 'OK') {
        return fail('DEFERRED_AUDIT_MISSING', '审计补记证据不匹配');
      }
      evidenceRef = reason.auditEventId;
    } else if (reason.reasonCode === 'SKIPPED_RECHECK') {
      expectedRev = item.rev + 1;
    } else if (reason.reasonCode === 'LOCK_BUSY') {
      expectedRev = item.rev + 1;
      const lock = row.retention && row.retention.purge && row.retention.purge.lock;
      if (!lock || lock.state !== 'released' ||
          lock.fencingToken !== reason.fencingToken) {
        return fail('DEFERRED_LOCK_UNCONFIRMED', '行锁释放没有得到确认');
      }
    } else if (reason.reasonCode === 'RETRY_AFTER' || reason.reasonCode === 'CAS_UNMATCHED') {
      if (!Number.isFinite(new Date(reason.retryAfter).getTime()) ||
          new Date(reason.retryAfter).getTime() > now.getTime()) {
        return fail('DEFERRED_RETRY_NOT_READY', '延期时间尚未到达');
      }
    } else return fail('DEFERRED_EVIDENCE_INVALID', '延期原因不受支持');
    if (row.rev !== expectedRev || reason.observedRev !== undefined &&
        reason.observedRev !== item.rev && reason.observedRev !== item.rev + 1) {
      return fail('DEFERRED_REV_CONFLICT', '当前版本与恢复证据不一致');
    }
    items.push({ submissionId: item.id, originalRev: item.rev,
      observedRev: row.rev, reasonCode: reason.reasonCode,
      recoveryAction: reason.recoveryAction || 'recheckSubmission', evidenceRef: evidenceRef });
  }
  const batchRef = crypto.createHash('sha256').update('retention_purge\0purge\0' +
    batchId).digest('hex').slice(0, 24);
  const stats = { phase: 'resolution', operation: 'purge', batchId: batchId,
    batchRef: batchRef, selected: manifest.length, originalOutcome: 'DEFERRED',
    prepareId: prepareId, completeId: completeId,
    manifestHash: pre.stats.evidenceDigest, deferredDigest: end.stats.deferredDigest,
    unresolvedCount: 0, createdAt: now.toISOString(), items: items };
  stats.seal = deferredResolutionSeal(stats);
  const log = { _id: resolutionId, schemaVersion: 1, event: 'retention_purge',
    action: 'retention_purge', submissionId: null, day: now.toISOString().slice(0, 10),
    result: { code: 'DEFERRED_RESOLUTION', stats: stats }, errorCode: '',
    actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1 };
  let reused = false;
  try { await db.collection(COL.LOGS).add({ data: log }); }
  catch (err) {
    let confirmed;
    try { confirmed = (await db.collection(COL.LOGS).doc(resolutionId).get()).data; }
    catch (readErr) { return fail('DEFERRED_LOG_UNCONFIRMED', '恢复事件写入结果不确定'); }
    const info = batchLogInfo(confirmed, 'retention_purge');
    if (!info || info.invalid || info.phase !== 'resolution' ||
        info.batchId !== batchId || info.stats.prepareId !== prepareId ||
        info.stats.completeId !== completeId ||
        info.stats.manifestHash !== pre.stats.evidenceDigest ||
        info.stats.deferredDigest !== end.stats.deferredDigest ||
        info.stats.batchRef !== batchRef) {
      return fail('DEFERRED_RESOLUTION_CONFLICT', '恢复事件回执内容不匹配');
    }
    reused = true;
  }
  const checked = await reconcileAfterRepair();
  return checked && checked.ok && checked.completeScan ?
    { ok: true, code: reused ? 'ALREADY_RESOLVED' : 'RESOLVED_DEFERRED', eventId: resolutionId,
      batchRef: batchRef, unresolvedCount: 0 } :
    fail('DEFERRED_RECONCILE_BLOCKED', '恢复事件已追加，但完整对账未通过',
      { eventId: resolutionId, reconcileCode: checked && checked.code });
}

async function deferLatestPurge(id, now) {
  try {
    const row = (await db.collection(COL.SUBMISSIONS).doc(id).get()).data;
    return !!(row && row.payload !== null && await deferPurge(row, now));
  } catch (err) { return false; }
}

async function recoverPurgePending(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const now = options && options.now instanceof Date ? options.now : new Date();
  let rows;
  try {
    const response = await db.collection(COL.SUBMISSIONS)
      .where({ 'retention.purge.state': 'pending' })
      .orderBy('retention.purge.retryAfter', 'asc').orderBy('createdAt', 'asc')
      .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
    rows = response && Array.isArray(response.data) ? response.data : [];
  } catch (err) { return fail('DATABASE_ERROR', '读取待补清理审计队列失败'); }
  const result = { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
    unprocessed: rows.length, now: now, operation: 'recoverPurgePending',
    batchId: options && options.requestId || crypto.randomBytes(16).toString('hex') };
  // Empty internal recovery checks do not create an extra batch for each purge call.
  if (rows.length) {
    try { await writePurgeLog(result, 'prepare', 'PREPARE', null); }
    catch (err) { return fail('LOG_FAILED', '清理审计恢复准备日志失败，未处理记录',
      { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
        unprocessed: rows.length, logged: false }); }
  }
  for (const row of rows) {
    const retryAfter = row.retention && row.retention.purge && row.retention.purge.retryAfter;
    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) { result.deferred++; continue; }
    const outcome = await recoverPurgeAudit(row._id);
    if (outcome.ok && outcome.code === 'OK') result.recovered++;
    else if (outcome.ok || outcome.code === 'STATE_CONFLICT') result.conflicts++;
    else {
      result.failed++;
      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
    }
  }
  result.unprocessed = result.selected - result.recovered - result.deferred - result.conflicts - result.failed;
  const completion = result.failed || result.retrySchedulingFailed ? 'PARTIAL' :
    (result.deferred || result.conflicts ? 'DEFERRED' : 'COMPLETE');
  if (rows.length) {
    try { await writePurgeLog(result, 'complete', completion, null); }
    catch (err) { return fail('LOG_FAILED', '清理审计恢复已执行，收尾日志未确认写入',
      Object.assign({ logged: false }, result)); }
  }
  return Object.assign({ ok: result.failed === 0,
    code: result.failed ? 'RECOVERY_PARTIAL' : 'OK', complete: completion === 'COMPLETE' }, result);
}

function completeAuditReconcile(result, eventType) {
  if (!result || result.ok !== true || result.code !== 'OK' ||
      result.eventType !== eventType || result.completeScan !== true ||
      result.truncated !== false || result.nextCursor !== null ||
      !Number.isSafeInteger(result.scanned) || result.scanned < 0 ||
      !Number.isSafeInteger(result.pages) || result.pages < 1 ||
      !result.counts || !result.counts.outcomes || !Array.isArray(result.batches)) return false;
  const counts = result.counts;
  const statusKeys = ['closed', 'pairedWindow', 'suspectedOrphan', 'running',
    'completeWithoutPrepare', 'duplicate', 'countMismatch', 'invalidLogs', 'unmatchedWindow'];
  const outcomeKeys = ['OK', 'PARTIAL', 'FAILED', 'DEFERRED', 'DEFERRED_NOT_STARTED',
    'DEFERRED_RETRYABLE'];
  if (!statusKeys.every(function (key) { return validCount(counts[key]); }) ||
      !outcomeKeys.every(function (key) { return validCount(counts.outcomes[key]); }) ||
      !validCount(counts.repaired) || !validCount(counts.unresolvedFailure) ||
      !validCount(counts.resolvedDeferred)) return false;
  if (statusKeys.slice(1).some(function (key) { return counts[key] !== 0; }) ||
      counts.resolvedDeferred !== counts.outcomes.DEFERRED || counts.unresolvedFailure !== 0 ||
      counts.repaired !== counts.outcomes.PARTIAL + counts.outcomes.FAILED +
        counts.outcomes.DEFERRED_RETRYABLE ||
      counts.closed !== counts.outcomes.OK + counts.outcomes.DEFERRED_NOT_STARTED +
        counts.repaired + counts.resolvedDeferred ||
      counts.closed !== result.batches.length) return false;
  return result.batches.every(function (batch) {
    return batch && batch.status === 'closed' &&
      ((batch.completeCode === 'COMPLETE' && batch.outcome === 'OK') ||
       (batch.completeCode === 'DEFERRED_NOT_STARTED' && batch.outcome === 'DEFERRED_NOT_STARTED') ||
       (['PARTIAL', 'FAILED', 'DEFERRED_RETRYABLE'].includes(batch.outcome) &&
        batch.repairStatus === 'confirmed') ||
       (batch.outcome === 'DEFERRED' && batch.resolutionState === 'RESOLVED_DEFERRED'));
  });
}

async function checkPurgeAuditGate(testHooks) {
  // The optional second argument of purgePayload is available only through __test__.
  // exports.main never passes caller data into these hooks.
  const reconcile = testHooks && testHooks.reconcile || reconcileBatches;
  const timeoutMs = testHooks && Number.isSafeInteger(testHooks.timeoutMs) &&
    testHooks.timeoutMs > 0 ? testHooks.timeoutMs : PURGE_AUDIT_GATE_TIMEOUT_MS;
  for (const eventType of ['retention_mark', 'retention_purge']) {
    let timer;
    let result;
    try {
      result = await Promise.race([
        Promise.resolve().then(function () { return reconcile({ eventType: eventType, now: new Date() }); }),
        new Promise(function (_, reject) {
          timer = setTimeout(function () { reject(new Error('AUDIT_GATE_TIMEOUT')); }, timeoutMs);
        })
      ]);
    } catch (err) {
      return fail('AUDIT_GATE_BLOCKED', '审计对账未能完成', {
        eventType: eventType,
        reason: err && err.message === 'AUDIT_GATE_TIMEOUT' ? 'TIMEOUT' : 'RECONCILE_ERROR'
      });
    } finally { if (timer) clearTimeout(timer); }
    if (!completeAuditReconcile(result, eventType)) {
      return fail('AUDIT_GATE_BLOCKED', '审计对账未能证明完整', {
        eventType: eventType, reason: 'INCOMPLETE_OR_ANOMALOUS'
      });
    }
  }
  return { ok: true, code: 'OK' };
}

async function purgePayload(options, testHooks) {
  if (!testHooks || testHooks[OFFLINE_PURGE_SIMULATION] !== true) {
    return fail('PURGE_GLOBAL_FENCE_UNVERIFIED', '跨文档全局审计屏障尚未验证，正文清理失败关闭');
  }
  const config = readPolicy();
  if (config.error) return config.error;
  const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
  const cutoff = makeCutoff(now, PURGE_AFTER_DAYS);
  let auditRecovery;
  try { auditRecovery = await recoverPurgePending({ now: now }); }
  catch (err) { return fail('AUDIT_GATE_BLOCKED', '清理审计恢复中断', { reason: 'RECOVERY_ERROR' }); }
  if (auditRecovery && auditRecovery.code === 'DATABASE_ERROR') {
    return fail('DATABASE_ERROR', '清理审计恢复队列读取失败');
  }
  if (!auditRecovery || auditRecovery.ok !== true || auditRecovery.code !== 'OK' ||
      auditRecovery.failed || auditRecovery.deferred || auditRecovery.unprocessed ||
      auditRecovery.retrySchedulingFailed) {
    return fail('AUDIT_GATE_BLOCKED', '清理审计恢复未完成', { reason: 'RECOVERY_INCOMPLETE',
      auditRecovery: auditRecovery });
  }
  const auditGate = await checkPurgeAuditGate(testHooks);
  if (!auditGate.ok) return Object.assign({ auditRecovery: auditRecovery }, auditGate);
  let needsMark;
  let rows;
  try {
    const pending = await db.collection(COL.SUBMISSIONS)
      .where({ status: STATUS.PENDING, createdAt: _.lt(cutoff) }).count();
    needsMark = pending.total;
    const candidateFilter = { status: _.in(PURGE_STATES), createdAt: _.lt(cutoff), payload: _.neq(null) };
    if (options && options.retrySubmissionId) candidateFilter._id = options.retrySubmissionId;
    const response = await db.collection(COL.SUBMISSIONS)
      .where(candidateFilter)
      .orderBy('retention.purge.retryAfter', 'asc').orderBy('createdAt', 'asc')
      .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
    rows = response && Array.isArray(response.data) ? response.data : [];
  } catch (err) { return fail('DATABASE_ERROR', '读取到期正文候选失败'); }
  if (options && options.retryEvidence) {
    const expected = options.retryEvidence;
    if (rows.length !== 1 || rows[0]._id !== expected.submissionId ||
        rows[0].rev !== expected.observedRev || rows[0].status !== expected.status ||
        purgeEvidence(rows)[0].payloadProof !== expected.payloadProof) {
      return fail('BLOCKED_UNCERTAIN', '重试扫描版本与凭证不一致');
    }
  }
  const result = { now: now, batchId: options && options.requestId || crypto.randomBytes(16).toString('hex'),
    selected: rows.length, needsMark: needsMark, purged: 0, purgedAudited: 0,
    auditFailedCount: 0, deferredAudit: 0, deferredRetry: 0,
    skipped: 0, conflicts: 0, failed: 0, unprocessed: rows.length,
    auditRecovery: auditRecovery, lockBusy: 0, selectedEvidence: purgeEvidence(rows),
    safeDeferred: [], blockedDeferred: [] };
  if (!result.selectedEvidence) return fail('AUDIT_EVIDENCE_UNAVAILABLE', '无法生成批次选中记录证据');
  try { await writePurgeLog(result, 'prepare', 'PREPARE', null); }
  catch (err) { return fail('LOG_FAILED', '清理批次准备审计失败，未清正文',
    { selected: rows.length, needsMark: needsMark, purged: 0, logged: false }); }
  for (const row of rows) {
    const retryAfter = row.retention && row.retention.purge && row.retention.purge.retryAfter;
    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) {
      result.deferredRetry++;
      result.safeDeferred.push({ id: row._id, reasonCode: 'RETRY_AFTER',
        originalRev: row.rev, observedRev: row.rev,
        retryAfter: new Date(retryAfter).toISOString() });
      continue;
    }
    if (row.retention && row.retention.audit && row.retention.audit.state === 'pending') {
      result.deferredAudit++;
      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
      else result.blockedDeferred.push({ id: row._id, reasonCode: 'AUDIT_PENDING',
        originalRev: row.rev, observedRev: row.rev + 1,
        auditEventId: row.retention.audit.eventId || null,
        recoveryAction: 'recoverPending' });
      continue;
    }
    if (PURGE_STATES.indexOf(row.status) === -1 || row.payload === null ||
        !Number.isSafeInteger(row.rev) || row.rev < 1 || row.rev >= Number.MAX_SAFE_INTEGER) {
      result.skipped++;
      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
      else result.blockedDeferred.push({ id: row._id, reasonCode: 'SKIPPED_RECHECK',
        originalRev: row.rev, observedRev: row.rev + 1,
        revBefore: row.rev, revAfter: row.rev + 1,
        recoveryAction: 'recheckSubmission' });
      continue;
    }
    const owner = crypto.randomBytes(16).toString('hex');
    const acquired = await acquirePurgeLease(row, now, owner);
    if (!acquired.ok) {
      if (acquired.code === 'LOCK_BUSY') {
        result.deferredRetry++; result.lockBusy++;
        const lock = row.retention && row.retention.purge && row.retention.purge.lock;
        result.blockedDeferred.push({ id: row._id, reasonCode: 'LOCK_BUSY',
          originalRev: row.rev, observedRev: row.rev,
          fencingToken: lock && lock.fencingToken || null,
          recoveryAction: 'confirmLeaseRelease' });
      }
      else if (acquired.code === 'STATE_CONFLICT') {
        result.conflicts++;
        let latest;
        try { latest = (await db.collection(COL.SUBMISSIONS).doc(row._id).get()).data; }
        catch (err) { latest = null; }
        const proof = latest && purgeEvidence([latest]);
        if (proof && latest.rev === row.rev && latest.status === row.status &&
            proof[0].payloadProof === result.selectedEvidence.find(function (x) {
              return x.id === row._id;
            }).payloadProof) {
          result.safeDeferred.push({ id: row._id, reasonCode: 'CAS_UNMATCHED',
            originalRev: row.rev, observedRev: row.rev,
            retryAfter: new Date(now.getTime() + RECOVERY_RETRY_MS).toISOString() });
        }
      }
      else {
        result.failed++;
        if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
      }
      continue;
    }
    const token = acquired.lock.fencingToken;
    if (testHooks && testHooks.afterLockAcquired) {
      try { await testHooks.afterLockAcquired(row, acquired); }
      catch (err) {
        result.failed++;
         if (!(await recoverPurgeLease(row._id, owner, token, now)).ok) {
          result.retrySchedulingFailed = true;
        }
        continue;
      }
    }
    const nextRev = acquired.rev + 1;
    const eventId = purgeEventId(row._id, nextRev);
    let updated;
    try {
      updated = await db.collection(COL.SUBMISSIONS)
        .where({ _id: row._id, status: row.status, rev: acquired.rev, payload: _.neq(null),
          'retention.purge.lock.state': 'held',
          'retention.purge.lock.owner': owner,
          'retention.purge.lock.fencingToken': token })
        .update({ data: { payload: null, payloadRedactedAt: db.serverDate(),
          'retention.purge.state': 'pending', 'retention.purge.eventId': eventId,
          'retention.purge.purgedRev': nextRev,
          'retention.purge.day': now.toISOString().slice(0, 10),
          'retention.purge.retryAfter': new Date(0),
          updatedAt: db.serverDate(), rev: nextRev } });
    } catch (err) {
      result.failed++;
       if (!(await recoverPurgeLease(row._id, owner, token, now)).ok ||
          !await deferLatestPurge(row._id, now)) result.retrySchedulingFailed = true;
      continue;
    }
    if (!updated || !updated.stats || updated.stats.updated !== 1) {
      result.conflicts++;
       if (!(await recoverPurgeLease(row._id, owner, token, now)).ok) {
        result.retrySchedulingFailed = true;
      }
      continue;
    }
    result.purged++;
    const outcome = await recoverPurgeAudit(row._id);
    if (outcome.ok) result.purgedAudited++;
    else result.auditFailedCount++;
    if (!(await recoverPurgeLease(row._id, owner, token, now)).ok) {
      result.retrySchedulingFailed = true;
    }
  }
  result.unprocessed = result.selected - result.purgedAudited - result.auditFailedCount -
    result.deferredAudit - result.deferredRetry - result.skipped - result.conflicts - result.failed;
  const hasFailure = result.failed || result.auditFailedCount || !auditRecovery.ok || result.retrySchedulingFailed;
  const hasDeferred = result.deferredAudit || result.deferredRetry || result.skipped ||
    result.conflicts || auditRecovery.deferred;
  // A batch containing only pre-acquisition LOCK_BUSY has not changed any
  // submission. Its append-only receipt remains visible but cannot poison
  // the global audit gate after the other owner releases its lease.
  const notStarted = result.selected > 0 && result.lockBusy === result.selected &&
    result.deferredRetry === result.selected && result.purged === 0 &&
    result.deferredAudit === 0 && result.skipped === 0 && result.conflicts === 0 &&
    result.failed === 0 && result.unprocessed === 0 && !result.retrySchedulingFailed &&
    auditRecovery.selected === 0 && auditRecovery.recovered === 0;
  if (notStarted) { result.notStartedReason = 'LOCK_BUSY'; result.zeroBusinessWrites = true; }
  const retryable = !hasFailure && !notStarted && result.safeDeferred.length > 0 &&
    result.safeDeferred.length === result.deferredRetry + result.conflicts &&
    result.deferredAudit === 0 && result.skipped === 0 && result.failed === 0 &&
    result.auditFailedCount === 0 && result.unprocessed === 0 &&
    result.lockBusy === 0 && auditRecovery.selected === 0;
  if (retryable) {
    result.retryableReasons = result.safeDeferred;
    result.retryAfter = new Date(Math.max.apply(null, result.safeDeferred.map(function (x) {
      return new Date(x.retryAfter).getTime();
    }))).toISOString();
  }
  if (hasDeferred && !notStarted && !retryable && !hasFailure) {
    result.deferredReasons = result.safeDeferred.concat(result.blockedDeferred);
  }
  const complete = hasFailure ? 'PARTIAL' :
    (notStarted ? 'DEFERRED_NOT_STARTED' :
      (retryable ? 'DEFERRED_RETRYABLE' : (hasDeferred ? 'DEFERRED' : 'COMPLETE')));
  try { await writePurgeLog(result, 'complete', complete, null); }
  catch (err) { return fail('LOG_FAILED', '正文处理后批次审计收尾失败', Object.assign({ logged: false }, result)); }
  return Object.assign({ ok: complete === 'COMPLETE', complete: complete === 'COMPLETE',
    code: complete === 'COMPLETE' ? 'OK' :
      (hasFailure ? 'PURGE_PARTIAL' :
        (notStarted ? 'PURGE_NOT_STARTED' : 'PURGE_DEFERRED')),
    cutoff: cutoff.toISOString() }, result);
}

async function markExpired(options) {
  const config = readPolicy();
  if (config.error) return config.error;

  const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
  const policy = config.policy;
  const cutoff = makeCutoff(now, policy.markAfterDays);
  let rows;
  try {
    const res = await db.collection(COL.SUBMISSIONS)
      .where({ status: STATUS.PENDING, createdAt: _.lt(cutoff) })
      .orderBy('createdAt', 'asc')
      .orderBy('_id', 'asc')
      .limit(policy.batchLimit)
      .get();
    rows = (res && Array.isArray(res.data)) ? res.data : [];
  } catch (err) {
    return fail('DATABASE_ERROR', '读取待标记投稿失败', { marked: 0, skipped: 0,
      conflicts: 0, failed: 0, selected: 0, markedAudited: 0, auditFailedCount: 0, unprocessed: 0 });
  }

  let marked = 0;
  let skipped = 0;
  let conflicts = 0;
  let failed = 0;
  let auditFailed = false;
  let auditFailedCount = 0;
  let unprocessed = 0;
  const result = { marked: 0, skipped: 0, conflicts: 0, failed: 0,
    attempts: rows.length, selected: rows.length, markedAudited: 0,
    auditFailedCount: 0, unprocessed: rows.length, now: now,
    batchId: (options && options.requestId) || crypto.randomBytes(16).toString('hex') };
  try {
    await writeRunLog(result, 'prepare', 'PREPARE', null);
  } catch (err) {
    return fail('LOG_FAILED', '批次准备审计写入失败，未更改投稿', {
      marked: 0, skipped: 0, conflicts: 0, failed: 0, logged: false,
      selected: rows.length, markedAudited: 0, auditFailedCount: 0, unprocessed: rows.length
    });
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.status !== STATUS.PENDING || !Number.isSafeInteger(row.rev) ||
        row.rev < 1 || row.rev >= Number.MAX_SAFE_INTEGER) {
      skipped++;
      continue;
    }
    let updated;
    try {
      const res = await db.collection(COL.SUBMISSIONS)
        .where({ _id: row._id, status: STATUS.PENDING, rev: row.rev })
        .update({
          data: {
            status: STATUS.EXPIRED,
            retention: {
              markedAt: db.serverDate(),
              policyConfirmedBy: policy.confirmedBy,
              audit: { state: 'pending', markedRev: row.rev + 1,
                eventId: recordEventId(row._id, row.rev + 1),
                day: now.toISOString().slice(0, 10), retryAfter: new Date(0) }
            },
            updatedAt: db.serverDate(),
            rev: row.rev + 1
          }
        });
      updated = res && res.stats && res.stats.updated === 1;
    } catch (err) {
      failed++;
      continue;
    }
    if (updated) {
      marked++;
      result.marked = marked;
      const recovered = await recoverAudit(row._id);
      if (!recovered.ok) {
        auditFailed = true;
        auditFailedCount++;
        break;
      }
    } else conflicts++;
  }

  unprocessed = rows.length - marked - skipped - conflicts - failed;
  Object.assign(result, { marked: marked, skipped: skipped, conflicts: conflicts,
    failed: failed, auditFailed: auditFailed, auditFailedCount: auditFailedCount,
    markedAudited: marked - auditFailedCount, unprocessed: unprocessed });
  const completion = failed || auditFailed || unprocessed ? (marked > 0 ? 'PARTIAL' : 'FAILED') :
    (conflicts || skipped ? 'DEFERRED' : 'COMPLETE');
  try {
    await writeRunLog(result, 'complete', completion, null);
  } catch (err) {
    return fail('LOG_FAILED', '到期标记已执行，但运行审计日志写入失败', {
      marked: marked,
      skipped: skipped,
      conflicts: conflicts,
      failed: failed,
      selected: rows.length, markedAudited: result.markedAudited,
      auditFailedCount: auditFailedCount, unprocessed: unprocessed,
      logged: false
    });
  }

  if (auditFailed) {
    return fail('LOG_FAILED', '状态已标记，但逐条审计写入失败；批次已记录部分成功', {
      marked: marked, skipped: skipped, conflicts: conflicts, failed: failed,
      selected: rows.length, markedAudited: result.markedAudited,
      auditFailedCount: auditFailedCount, unprocessed: unprocessed, logged: false
    });
  }

  return {
    ok: failed === 0,
    code: failed === 0 ? 'OK' : 'DATABASE_ERROR',
    complete: completion === 'COMPLETE',
    marked: marked,
    skipped: skipped,
    conflicts: conflicts,
    failed: failed,
    selected: rows.length, markedAudited: result.markedAudited,
    auditFailedCount: auditFailedCount, unprocessed: unprocessed,
    cutoff: cutoff.toISOString()
  };
}

function validUtcDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const parsed = new Date(day + 'T00:00:00.000Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }

function validCompleteCounts(stats) {
  if (!validCount(stats.selected)) return false;
  if (stats.operation === 'mark') {
    const keys = ['markedAudited', 'auditFailedCount', 'skipped', 'conflicts', 'failed', 'unprocessed'];
    return keys.every(function (key) { return validCount(stats[key]); }) &&
      stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0) &&
      stats.marked === stats.markedAudited + stats.auditFailedCount;
  }
  if (stats.operation === 'purge') {
    const keys = ['purgedAudited', 'auditFailedCount', 'deferredAudit', 'deferredRetry',
      'skipped', 'conflicts', 'failed', 'unprocessed'];
    return keys.every(function (key) { return validCount(stats[key]); }) &&
      stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0) &&
      stats.purged === stats.purgedAudited + stats.auditFailedCount;
  }
  const keys = ['recovered', 'deferred', 'conflicts', 'failed', 'unprocessed'];
  return keys.every(function (key) { return validCount(stats[key]); }) &&
    stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0);
}

function batchOutcome(code) {
  if (code === 'COMPLETE') return 'OK';
  if (['PARTIAL', 'FAILED', 'DEFERRED', 'DEFERRED_NOT_STARTED',
    'DEFERRED_RETRYABLE'].includes(code)) return code;
  return null;
}

function hasFailedResults(stats) {
  return stats.failed > 0 || stats.unprocessed > 0 ||
    ((stats.operation === 'mark' || stats.operation === 'purge') && stats.auditFailedCount > 0);
}

function batchLogInfo(log, eventType) {
  const stats = log.result && log.result.stats;
  if (log.submissionId !== null) {
    if (stats && (stats.phase === 'prepare' || stats.phase === 'complete')) return { invalid: true };
    if (typeof log.submissionId === 'string' && log.submissionId) return null;
    return { invalid: true };
  } // Per-record events are not batches.
  if (!stats || !['prepare', 'complete', 'repair', 'resolution'].includes(stats.phase)) return { invalid: true };
  const operation = stats.operation || (eventType === 'retention_mark' ? 'mark' : 'purge');
  const validOperation = eventType === 'retention_mark' ?
    ['mark', 'recoverPending'].indexOf(operation) !== -1 :
    ['purge', 'recoverPurgePending'].indexOf(operation) !== -1;
  const at = log.at instanceof Date ? log.at : new Date(log.at);
  if (!validOperation || typeof stats.batchId !== 'string' ||
      !/^[A-Za-z0-9:_-]{1,128}$/.test(stats.batchId) ||
      !validUtcDay(log.day) || Number.isNaN(at.getTime()) ||
      log.schemaVersion !== 1 || log.action !== eventType || log.rev !== 1 ||
      !log.actor || log.actor.role !== 'system' || log.actor.openidHash !== null ||
      !log.result ||
      typeof log.result.code !== 'string' || !validCount(stats.selected) ||
      (stats.phase === 'prepare' && log.result.code !== 'PREPARE') ||
      (stats.phase === 'repair' && (eventType !== 'retention_purge' ||
        operation !== 'purge' || log.result.code !== 'REPAIR_CONFIRMED' ||
        typeof stats.prepareId !== 'string' || typeof stats.completeId !== 'string' ||
        !/^[0-9a-f]{64}$/.test(stats.evidenceDigest) ||
        typeof stats.repairReason !== 'string' || !stats.repairReason ||
        typeof stats.repairOperator !== 'string' || !stats.repairOperator ||
        !validCount(stats.confirmedAudited) || !validCount(stats.confirmedUntouched) ||
        (stats.retryableDigest !== undefined && !/^[0-9a-f]{64}$/.test(stats.retryableDigest)) ||
        stats.selected !== stats.confirmedAudited + stats.confirmedUntouched)) ||
      (stats.phase === 'resolution' && (eventType !== 'retention_purge' ||
        operation !== 'purge' || log.result.code !== 'DEFERRED_RESOLUTION' ||
        log._id !== purgeBatchLogId(stats.batchId, 'deferred_resolution') ||
        stats.originalOutcome !== 'DEFERRED' || stats.unresolvedCount !== 0 ||
        typeof stats.batchRef !== 'string' || !/^[0-9a-f]{24}$/.test(stats.batchRef) ||
        typeof stats.prepareId !== 'string' || typeof stats.completeId !== 'string' ||
        !/^[0-9a-f]{64}$/.test(stats.manifestHash) ||
        !/^[0-9a-f]{64}$/.test(stats.deferredDigest) ||
        !Array.isArray(stats.items) || stats.items.length !== stats.selected ||
        !stats.items.every(function (item) { return item &&
          typeof item.submissionId === 'string' && item.submissionId &&
          Number.isSafeInteger(item.originalRev) && item.originalRev >= 0 &&
          (Number.isSafeInteger(item.observedRev) && item.observedRev >= 0 ||
            item.reasonCode === 'RECORD_ABSENT' && item.observedRev === null &&
            item.confirmedAbsent === true && item.recoveryAction === 'confirmedExactDocumentNotFound') &&
          typeof item.reasonCode === 'string' && typeof item.recoveryAction === 'string' &&
          typeof item.evidenceRef === 'string'; }) ||
        !validUtcDay(String(stats.createdAt).slice(0, 10)) ||
        stats.seal !== deferredResolutionSeal(stats))) ||
      (stats.phase === 'complete' && !['COMPLETE', 'PARTIAL', 'FAILED', 'DEFERRED',
        'DEFERRED_NOT_STARTED', 'DEFERRED_RETRYABLE'].includes(log.result.code))) {
    return { invalid: true };
  }
  return { operation: operation, batchId: stats.batchId, phase: stats.phase, logId: log._id,
    at: at, day: log.day, completeCode: log.result.code,
    stats: Object.assign({}, stats, { operation: operation }) };
}

function scanTokenKey() {
  const secret = process.env.UGC_RETENTION_TRIGGER_TOKEN;
  return typeof secret === 'string' && secret.trim() ?
    crypto.createHash('sha256').update('retention-reconcile-v1\0' + secret.trim()).digest() : null;
}

function sealScanState(state) {
  const key = scanTokenKey();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
  if (body.length > RECONCILE_TOKEN_MAX_CHARS) return null;
  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return body + '.' + signature;
}

function openScanState(token, eventType) {
  const key = scanTokenKey();
  if (!key || typeof token !== 'string' || token.length > RECONCILE_TOKEN_MAX_CHARS + 64) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const actual = Buffer.from(parts[1], 'base64url');
  if (actual.toString('base64url') !== parts[1] ||
      Buffer.from(parts[0], 'base64url').toString('base64url') !== parts[0]) return null;
  const expected = crypto.createHmac('sha256', key).update(parts[0]).digest();
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  let state;
  try { state = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
  catch (err) { return null; }
  if (!state || state.version !== 1 || state.eventType !== eventType ||
      typeof state.scanId !== 'string' || !/^[0-9a-f]{32}$/.test(state.scanId) ||
      !validCount(state.initialCount) ||
      typeof state.cursor !== 'string' || !state.cursor || state.cursor.length > 128 ||
      typeof state.upperId !== 'string' || !state.upperId || state.upperId.length > 128 ||
      state.cursor > state.upperId || !Number.isSafeInteger(state.scanned) || state.scanned < 1 ||
      !Number.isSafeInteger(state.pages) || state.pages < 1 || !validCount(state.invalidLogs) ||
      !Array.isArray(state.entries) || Number.isNaN(new Date(state.now).getTime())) return null;
  return state;
}

// Read-only, bounded scan. Unmatched halves are not called orphans when a window is truncated.
async function reconcileBatches(options) {
  const config = readPolicy();
  if (config.error) return config.error;
  const input = options || {};
  const eventType = input.eventType;
  if (eventType !== 'retention_mark' && eventType !== 'retention_purge') {
    return fail('INVALID_EVENT', '请选择 retention_mark 或 retention_purge');
  }
  const resumable = input.resumable === true || input.continuation !== undefined;
  const previous = input.continuation === undefined ? null :
    openScanState(input.continuation, eventType);
  if (input.continuation !== undefined && !previous) {
    return fail('INVALID_SCAN_CONTINUATION', '对账续扫凭据无效');
  }
  const now = previous ? new Date(previous.now) :
    (input.now instanceof Date ? new Date(input.now.getTime()) : new Date());
  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
  const pageSize = input.pageSize === undefined ? RECONCILE_PAGE_SIZE : input.pageSize;
  const maxRows = input.maxRows === undefined ? RECONCILE_MAX_ROWS : input.maxRows;
  const startCursor = previous ? previous.cursor : (input.cursor === undefined ? '' : input.cursor);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > RECONCILE_PAGE_SIZE ||
      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > RECONCILE_MAX_ROWS ||
      typeof startCursor !== 'string' || startCursor.length > 128 ||
      (resumable && !previous && startCursor) || (previous && input.cursor !== undefined)) {
    return fail('INVALID_SCAN_OPTIONS', '对账扫描参数不合法');
  }
  let cursor = startCursor;
  const logs = [];
  let pages = 0;
  let truncated = false;
  let reachedUpper = false;
  let upperId = previous ? previous.upperId : null;
  const scanId = previous ? previous.scanId : crypto.randomBytes(16).toString('hex');
  let initialCount = previous ? previous.initialCount : null;
  try {
    if (resumable && !previous) {
      const baseline = await db.collection(COL.LOGS).where({ event: eventType }).count();
      if (!baseline || !validCount(baseline.total)) {
        return fail('RECONCILE_RESULT_INVALID', '审计扫描基数无效',
          { scanned: 0, truncated: true, completeScan: false });
      }
      initialCount = baseline.total;
      const top = await db.collection(COL.LOGS).where({ event: eventType })
        .orderBy('_id', 'desc').limit(1).get();
      if (!top || !Array.isArray(top.data) ||
          (top.data.length && (typeof top.data[0]._id !== 'string' || !top.data[0]._id))) {
        return fail('RECONCILE_RESULT_INVALID', '审计扫描水位无效',
          { scanned: 0, truncated: true, completeScan: false });
      }
      upperId = top.data.length ? top.data[0]._id : null;
    }
    while (logs.length < maxRows) {
      const take = Math.min(pageSize, maxRows - logs.length);
      const filter = { event: eventType };
      if (cursor) filter._id = _.gt(cursor);
      const response = await db.collection(COL.LOGS).where(filter)
        .orderBy('_id', 'asc').limit(take).get();
      if (!response || !Array.isArray(response.data)) {
        return fail('RECONCILE_RESULT_INVALID', '审计查询结果缺失',
          { scanned: logs.length, truncated: true, completeScan: false });
      }
      const rows = response.data;
      pages++;
      for (const row of rows) {
        if (!row || typeof row._id !== 'string' || row._id <= cursor) {
          return fail('UNSTABLE_SCAN', '对账分页顺序无效', { scanned: logs.length, truncated: true });
        }
        if (resumable && row._id > upperId) { reachedUpper = true; break; }
        cursor = row._id;
        logs.push(row);
        if (resumable && cursor === upperId) { reachedUpper = true; break; }
      }
      if (reachedUpper || rows.length < take) break;
      if (logs.length === maxRows) {
        const filterNext = { event: eventType, _id: _.gt(cursor) };
        const probe = await db.collection(COL.LOGS).where(filterNext).orderBy('_id', 'asc').limit(1).get();
        if (!probe || !Array.isArray(probe.data)) {
          return fail('RECONCILE_RESULT_INVALID', '审计续页结果缺失',
            { scanned: logs.length, truncated: true, completeScan: false });
        }
        truncated = resumable ? !!(probe.data.length && probe.data[0]._id <= upperId) :
          !!probe.data.length;
        break;
      }
    }
  } catch (err) {
    return fail('DATABASE_ERROR', '对账只读扫描中断',
      { scanned: logs.length, nextCursor: cursor || null, truncated: true, completeScan: false });
  }
  if (resumable && !truncated) {
    let finalCount;
    try { finalCount = await db.collection(COL.LOGS).where({ event: eventType }).count(); }
    catch (err) { return fail('DATABASE_ERROR', '审计扫描末尾复核失败',
      { scanned: logs.length, truncated: true, completeScan: false }); }
    if (!finalCount || !validCount(finalCount.total) || finalCount.total !== initialCount) {
      return fail('SCAN_CHANGED', '扫描期间审计日志总数发生变化，须重新开始',
        { scanned: logs.length + (previous ? previous.scanned : 0),
          truncated: true, completeScan: false, nextContinuation: null,
          scanScope: { scanId: scanId, scanStartedAt: now.toISOString(),
            highWaterMark: upperId, initialCount: initialCount,
            observedCount: finalCount && finalCount.total } });
    }
  }
  const groups = new Map();
  let invalidLogs = previous ? previous.invalidLogs : 0;
  const entries = previous ? previous.entries.slice() : [];
  for (const log of logs) {
    const info = batchLogInfo(log, eventType);
    if (!info) continue;
    if (info.invalid || info.at.getTime() > now.getTime() ||
        info.phase === 'resolution' && !await resolutionAttemptsValid(info.stats)) { invalidLogs++; continue; }
    if (resumable) {
      const digest = crypto.createHash('sha256').update(eventType + '\0' + info.operation +
        '\0' + info.batchId).digest('hex');
      const projected = { phase: info.phase, operation: info.operation, batchId: digest };
      const countKeys = ['selected', 'marked', 'markedAudited', 'auditFailedCount',
        'skipped', 'conflicts', 'failed', 'unprocessed', 'recovered', 'deferred',
        'purged', 'purgedAudited', 'deferredAudit', 'deferredRetry', 'needsMark'];
      let invalidProjection = false;
      for (const key of countKeys) {
        if (Object.prototype.hasOwnProperty.call(info.stats, key)) {
          if (!validCount(info.stats[key])) { invalidProjection = true; break; }
          projected[key] = info.stats[key];
        }
      }
      if (invalidProjection) { invalidLogs++; continue; }
      if (info.phase === 'prepare' && eventType === 'retention_purge' &&
          Array.isArray(info.stats.selectedEvidence)) {
        projected.evidenceDigest = info.stats.evidenceDigest;
        projected.selectedEvidenceCount = info.stats.selectedEvidence.length;
      }
      if (info.phase === 'repair') {
        for (const key of ['prepareId', 'completeId', 'evidenceDigest', 'repairReason',
          'repairOperator', 'confirmedAudited', 'confirmedUntouched',
          'retryableDigest']) projected[key] = info.stats[key];
      }
      if (info.phase === 'resolution') {
        for (const key of ['batchRef', 'prepareId', 'completeId', 'manifestHash',
          'deferredDigest', 'unresolvedCount', 'originalOutcome', 'createdAt']) {
          projected[key] = info.stats[key];
        }
        projected.resolutionValidated = true;
      }
      if (info.phase === 'complete' && info.completeCode === 'DEFERRED') {
        projected.deferredDigest = info.stats.deferredDigest;
      }
      if (info.completeCode === 'DEFERRED_RETRYABLE') {
        projected.retryableDigest = info.stats.retryableDigest;
        projected.retryAfter = info.stats.retryAfter;
        projected.retryableCount = Array.isArray(info.stats.retryableReasons) ?
          info.stats.retryableReasons.length : -1;
      }
      if (info.completeCode === 'DEFERRED_NOT_STARTED') {
        projected.notStartedReason = info.stats.notStartedReason;
        projected.zeroBusinessWrites = info.stats.zeroBusinessWrites;
      }
      info.batchId = digest;
      info.stats = projected;
    }
    entries.push(info);
  }
  for (const info of entries) {
    if (!(info.at instanceof Date)) info.at = new Date(info.at);
    const key = info.operation + '\0' + info.batchId;
    if (!groups.has(key)) groups.set(key, { operation: info.operation, batchId: info.batchId,
      prepare: [], complete: [], repair: [], resolution: [] });
    groups.get(key)[info.phase].push(info);
  }
  const completeScan = !truncated && (resumable || !startCursor);
  const counts = { closed: 0, pairedWindow: 0, suspectedOrphan: 0, running: 0, completeWithoutPrepare: 0,
    duplicate: 0, countMismatch: 0, invalidLogs: invalidLogs, unmatchedWindow: 0,
    repaired: 0, unresolvedFailure: 0, resolvedDeferred: 0,
    outcomes: { OK: 0, PARTIAL: 0, FAILED: 0, DEFERRED: 0,
      DEFERRED_NOT_STARTED: 0, DEFERRED_RETRYABLE: 0 } };
  const batches = [];
  for (const group of groups.values()) {
    let status;
    if (group.prepare.length > 1 || group.complete.length > 1 ||
        group.repair.length > 1 || group.resolution.length > 1) status = 'duplicate';
    else if (!group.prepare.length || !group.complete.length) {
      if (!completeScan) status = 'unmatchedWindow';
      else if (!group.prepare.length) status = 'completeWithoutPrepare';
      else status = now.getTime() - group.prepare[0].at.getTime() >= RECONCILE_GRACE_MS ?
        'suspectedOrphan' : 'running';
    } else if (group.prepare[0].day !== group.complete[0].day ||
        group.prepare[0].stats.selected !== group.complete[0].stats.selected ||
        group.complete[0].at.getTime() < group.prepare[0].at.getTime() ||
        !validCompleteCounts(group.complete[0].stats) ||
        (['COMPLETE', 'DEFERRED', 'DEFERRED_NOT_STARTED',
          'DEFERRED_RETRYABLE'].includes(group.complete[0].completeCode) &&
          hasFailedResults(group.complete[0].stats))) status = 'countMismatch';
    else if (group.complete[0].completeCode === 'DEFERRED_NOT_STARTED' &&
        (eventType !== 'retention_purge' || group.complete[0].stats.operation !== 'purge' ||
          group.complete[0].stats.notStartedReason !== 'LOCK_BUSY' ||
          group.complete[0].stats.zeroBusinessWrites !== true ||
          group.complete[0].stats.selected < 1 ||
          group.complete[0].stats.deferredRetry !== group.complete[0].stats.selected ||
          group.complete[0].stats.purged !== 0 ||
          group.complete[0].stats.purgedAudited !== 0 ||
          group.complete[0].stats.auditFailedCount !== 0 ||
          group.complete[0].stats.deferredAudit !== 0 ||
          group.complete[0].stats.skipped !== 0 ||
          group.complete[0].stats.conflicts !== 0 ||
          group.complete[0].stats.failed !== 0 ||
          group.complete[0].stats.unprocessed !== 0)) status = 'countMismatch';
    else if (group.complete[0].completeCode === 'DEFERRED_RETRYABLE' &&
        (eventType !== 'retention_purge' || group.complete[0].stats.operation !== 'purge' ||
          !/^[0-9a-f]{64}$/.test(group.complete[0].stats.retryableDigest) ||
          !Number.isFinite(new Date(group.complete[0].stats.retryAfter).getTime()) ||
          (resumable ? group.complete[0].stats.retryableCount !==
            group.complete[0].stats.deferredRetry + group.complete[0].stats.conflicts :
            !Array.isArray(group.complete[0].stats.retryableReasons) ||
            group.complete[0].stats.retryableReasons.length !==
              group.complete[0].stats.deferredRetry + group.complete[0].stats.conflicts ||
            evidenceDigest(group.complete[0].stats.retryableReasons) !==
              group.complete[0].stats.retryableDigest) ||
          group.complete[0].stats.deferredAudit !== 0 ||
          group.complete[0].stats.skipped !== 0 || group.complete[0].stats.failed !== 0 ||
          group.complete[0].stats.auditFailedCount !== 0)) status = 'countMismatch';
    else status = completeScan ? 'closed' : 'pairedWindow';
    counts[status]++;
    const complete = group.complete.length === 1 ? group.complete[0] : null;
    const outcome = complete && (status === 'closed' || status === 'pairedWindow') ?
      batchOutcome(complete.completeCode) : null;
    if (outcome) counts.outcomes[outcome]++;
    const prepare = group.prepare.length === 1 ? group.prepare[0] : null;
    const repair = group.repair.length === 1 ? group.repair[0] : null;
    const repaired = !!(repair && prepare && complete && status === 'closed' &&
      ['PARTIAL', 'FAILED', 'DEFERRED_RETRYABLE'].includes(outcome) &&
      repair.stats.prepareId === prepare.logId && repair.stats.completeId === complete.logId &&
      repair.stats.evidenceDigest === prepare.stats.evidenceDigest &&
      (outcome !== 'DEFERRED_RETRYABLE' ||
        repair.stats.retryableDigest === complete.stats.retryableDigest) &&
      (resumable ? (prepare.stats.selectedEvidenceCount === prepare.stats.selected &&
        /^[0-9a-f]{64}$/.test(prepare.stats.evidenceDigest)) :
        evidenceDigest(prepare.stats.selectedEvidence) === repair.stats.evidenceDigest) &&
      repair.stats.selected === prepare.stats.selected);
    if (repaired) counts.repaired++;
    else if (['PARTIAL', 'FAILED', 'DEFERRED_RETRYABLE'].includes(outcome)) counts.unresolvedFailure++;
    if (repair && !repaired) counts.invalidLogs++;
    const batchRef = resumable ? group.batchId.slice(0, 24) :
      crypto.createHash('sha256').update(eventType + '\0' + group.operation +
        '\0' + group.batchId).digest('hex').slice(0, 24);
    const resolution = group.resolution.length === 1 ? group.resolution[0] : null;
    const resolvedDeferred = !!(resolution && status === 'closed' && outcome === 'DEFERRED' &&
      prepare && complete && resolution.stats.prepareId === prepare.logId &&
      resolution.stats.completeId === complete.logId &&
      resolution.stats.manifestHash === prepare.stats.evidenceDigest &&
      resolution.stats.deferredDigest === complete.stats.deferredDigest &&
      resolution.stats.batchRef === batchRef && resolution.stats.selected === prepare.stats.selected &&
      resolution.stats.unresolvedCount === 0 &&
      (resumable ? resolution.stats.resolutionValidated === true :
        evidenceDigest(prepare.stats.selectedEvidence) === resolution.stats.manifestHash));
    if (resolvedDeferred) counts.resolvedDeferred++;
    if (resolution && !resolvedDeferred) counts.invalidLogs++;
    batches.push({ batchRef: batchRef, operation: group.operation, status: status,
      completeCode: complete ? complete.completeCode : null, outcome: outcome,
      repairStatus: repaired ? 'confirmed' : (repair ? 'invalid' : null),
      resolutionState: resolvedDeferred ? 'RESOLVED_DEFERRED' :
        (resolution ? 'BLOCKED_UNCERTAIN' : (outcome === 'DEFERRED' ? 'UNRESOLVED_DEFERRED' : null)) });
  }
  const hasAnomaly = invalidLogs || counts.suspectedOrphan ||
    counts.completeWithoutPrepare || counts.duplicate || counts.countMismatch ||
    counts.unresolvedFailure;
  const hasDeferred = counts.outcomes.DEFERRED > counts.resolvedDeferred;
  return { ok: !hasAnomaly && !hasDeferred && completeScan,
    code: completeScan ? (hasAnomaly ? 'RECONCILE_ANOMALIES' :
      (hasDeferred ? 'RECONCILE_DEFERRED' : 'OK')) : 'SCAN_TRUNCATED',
    eventType: eventType,
    scanned: logs.length + (previous ? previous.scanned : 0),
    pages: pages + (previous ? previous.pages : 0), truncated: truncated, completeScan: completeScan,
    nextCursor: truncated ? cursor : null, thresholdMs: RECONCILE_GRACE_MS,
    scanScope: resumable ? { scanId: scanId, scanStartedAt: now.toISOString(),
      highWaterMark: upperId, upperId: upperId, capturedAt: now.toISOString(),
      cursor: truncated ? cursor : null, pages: pages + (previous ? previous.pages : 0),
      scanned: logs.length + (previous ? previous.scanned : 0),
      completeScan: completeScan, initialCount: initialCount,
      consistency: 'KEYSPACE_WATERMARK_COUNT_CHECK_NOT_ATOMIC' } : null,
    nextContinuation: resumable && truncated ? sealScanState({ version: 1, eventType: eventType,
      now: now.toISOString(), upperId: upperId, cursor: cursor,
      scanId: scanId, initialCount: initialCount,
      scanned: logs.length + (previous ? previous.scanned : 0),
      pages: pages + (previous ? previous.pages : 0), invalidLogs: invalidLogs,
      entries: entries }) : null,
    counts: counts, batches: batches };
}

exports.main = async function (event, context) {
  if (!event || ['mark', 'recover', 'recoverPending', 'purge', 'reconcile',
    'repairPurgeBatch', 'resolveDeferredBatch', 'disposeDeferredBatch', 'retryDeferredAttempt', 'discoverPurgeBatches'].indexOf(event.action) === -1) {
    return fail('INVALID_ACTION', '仅支持维护令牌保护的保留期动作');
  }
  if (!hasValidMaintenanceToken(event.maintenanceToken)) {
    return fail('FORBIDDEN', '维护令牌无效或未配置');
  }
  if (event.action === 'reconcile') return reconcileBatches({ eventType: event.eventType,
    pageSize: event.pageSize, maxRows: event.maxRows, cursor: event.cursor,
    resumable: event.resumable, continuation: event.continuation });
  if (event.action === 'recover') return recoverAudit(event.submissionId);
  if (event.action === 'recoverPending') return recoverPending();
  if (event.action === 'repairPurgeBatch') return repairPurgeBatch({ batchId: event.batchId });
  if (event.action === 'retryDeferredAttempt') return retryDeferredAttempt({ batchId: event.batchId, submissionId: event.submissionId });
  if (event.action === 'disposeDeferredBatch') return disposeDeferredBatch({ batchId: event.batchId });
  if (event.action === 'resolveDeferredBatch') return resolveDeferredBatch({ batchId: event.batchId });
  if (event.action === 'discoverPurgeBatches') return discoverPurgeBatches({
    batchRef: event.batchRef, cursor: event.cursor, limit: event.limit });
  if (event.action === 'purge') {
    return fail('PURGE_GLOBAL_FENCE_UNVERIFIED', '跨文档全局审计屏障尚未验证，正文清理入口失败关闭');
  }
  return markExpired({ requestId: context && context.request_id });
};

exports.__test__ = {
  makeCutoff: makeCutoff,
  readPolicy: readPolicy,
  markExpired: markExpired,
  recoverAudit: recoverAudit,
  recoverPending: recoverPending,
  // Only the in-process test export can construct the private simulation flag.
  // main and all ordinary calls to purgePayload stay closed.
  purgePayload: function (options, hooks) {
    return purgePayload(options, Object.assign({}, hooks,
      { [OFFLINE_PURGE_SIMULATION]: true }));
  },
  recoverPurgePending: recoverPurgePending,
  recoverPurgeAudit: recoverPurgeAudit,
  reconcileBatches: reconcileBatches,
  acquirePurgeLease: acquirePurgeLease,
  renewPurgeLease: renewPurgeLease,
  releasePurgeLease: releasePurgeLease,
  recoverPurgeLease: recoverPurgeLease,
  recoverExpiredPurgeLease: recoverExpiredPurgeLease,
  repairPurgeBatch: repairPurgeBatch,
  resolveDeferredBatch: resolveDeferredBatch,
  disposeDeferredBatch: disposeDeferredBatch,
  retryDeferredAttempt: function (options, hooks) { return retryDeferredAttempt(options,
    Object.assign({}, hooks, { [OFFLINE_PURGE_SIMULATION]: true })); },
  discoverPurgeBatches: discoverPurgeBatches
};
