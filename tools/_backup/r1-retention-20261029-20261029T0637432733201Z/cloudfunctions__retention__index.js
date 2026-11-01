/**
 * retention —— UGC 保留期本地准备：到期状态标记。
 *
 * 本函数不包含 triggers 配置，不能因提交本代码而自动运行。部署前必须由负责人
 * 在云环境显式确认每项策略参数；缺少或未确认任一参数时，入口失败关闭且不读写数据。
 *
 * mark 标记到期 pending；recover 按投稿 ID 补齐已标记记录的逐条审计。
 * 正文清除与审计日志轮转是独立的不可逆流程，不在本入口实现。
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
const MAX_BATCH_LIMIT = 100;

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
    data.result.stats = {
      phase: phase,
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

async function recoverAudit(submissionId) {
  if (typeof submissionId !== 'string' || !submissionId.trim()) return fail('INVALID_SUBMISSION_ID', '缺少投稿 ID');
  let row;
  try { row = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
  catch (err) { return fail('DATABASE_ERROR', '无法读取待补审计记录'); }
  const retention = row && row.retention;
  const audit = retention && retention.audit;
  if (!audit) return fail('NO_PENDING_AUDIT', '该投稿没有待补审计标记');
  if (audit.state === 'complete') return { ok: true, code: 'ALREADY_RECOVERED' };
  if (audit.state !== 'pending' || !Number.isInteger(audit.markedRev) ||
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
        { audit: Object.assign({}, audit, { state: 'complete' }) }) } });
    if (!updated || !updated.stats || updated.stats.updated !== 1) {
      let latest;
      try { latest = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
      catch (err) { return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除'); }
      if (latest && latest.retention && latest.retention.audit &&
          latest.retention.audit.eventId === audit.eventId && latest.retention.audit.state === 'complete') {
        return { ok: true, code: 'ALREADY_RECOVERED', submissionId: row._id };
      }
      return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除');
    }
  } catch (err) { return fail('DATABASE_ERROR', '审计已存在，但待补标记清除失败'); }
  return { ok: true, code: 'OK', submissionId: row._id };
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
    auditFailedCount: 0, unprocessed: 0, now: now,
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
    if (!row || row.status !== STATUS.PENDING || !Number.isInteger(row.rev) || row.rev < 1) {
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
                day: now.toISOString().slice(0, 10) }
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
  const completion = failed === 0 && !auditFailed && unprocessed === 0 ? 'COMPLETE' : (marked > 0 ? 'PARTIAL' : 'FAILED');
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
    marked: marked,
    skipped: skipped,
    conflicts: conflicts,
    failed: failed,
    selected: rows.length, markedAudited: result.markedAudited,
    auditFailedCount: auditFailedCount, unprocessed: unprocessed,
    cutoff: cutoff.toISOString()
  };
}

exports.main = async function (event, context) {
  if (!event || (event.action !== 'mark' && event.action !== 'recover')) {
    return fail('INVALID_ACTION', '仅支持维护令牌保护的 mark/recover 动作');
  }
  if (!hasValidMaintenanceToken(event.maintenanceToken)) {
    return fail('FORBIDDEN', '维护令牌无效或未配置');
  }
  if (event.action === 'recover') return recoverAudit(event.submissionId);
  return markExpired({ requestId: context && context.request_id });
};

exports.__test__ = {
  makeCutoff: makeCutoff,
  readPolicy: readPolicy,
  markExpired: markExpired,
  recoverAudit: recoverAudit
};
