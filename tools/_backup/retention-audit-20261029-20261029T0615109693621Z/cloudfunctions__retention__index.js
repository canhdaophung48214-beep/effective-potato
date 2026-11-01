/**
 * retention —— UGC 保留期本地准备：到期状态标记。
 *
 * 本函数不包含 triggers 配置，不能因提交本代码而自动运行。部署前必须由负责人
 * 在云环境显式确认每项策略参数；缺少或未确认任一参数时，入口失败关闭且不读写数据。
 *
 * 本轮只有 mark 动作：将超过已确认标记期限的 pending 投稿置为 expired。
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

async function writeRunLog(result, phase, code, submissionId) {
  const data = {
    schemaVersion: 1,
    event: 'retention_mark',
    action: 'retention_mark',
    submissionId: submissionId || null,
    day: result.now.toISOString().slice(0, 10),
    result: { code: code },
    errorCode: '',
    actor: { role: 'system' }
  };
  // A record event is exactly the approved eight-field logical projection.
  // Batch rows carry operational counters separately and are not record summaries.
  if (phase !== 'record') {
    data.result.stats = {
      phase: phase,
      batchId: result.batchId,
      marked: result.marked,
      skipped: result.skipped,
      conflicts: result.conflicts,
      failed: result.failed,
      auditFailed: !!result.auditFailed,
      attempts: result.attempts
    };
    data.at = db.serverDate();
  }
  return db.collection(COL.LOGS).add({ data: data });
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
    return fail('DATABASE_ERROR', '读取待标记投稿失败', { marked: 0, skipped: 0, conflicts: 0 });
  }

  let marked = 0;
  let skipped = 0;
  let conflicts = 0;
  let failed = 0;
  let auditFailed = false;
  const result = { marked: 0, skipped: 0, conflicts: 0, failed: 0,
    attempts: rows.length, now: now,
    batchId: (options && options.requestId) || crypto.randomBytes(16).toString('hex') };
  try {
    await writeRunLog(result, 'prepare', 'PREPARE', null);
  } catch (err) {
    return fail('LOG_FAILED', '批次准备审计写入失败，未更改投稿', {
      marked: 0, skipped: 0, conflicts: 0, failed: 0, logged: false
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
              policyConfirmedBy: policy.confirmedBy
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
      try { await writeRunLog(result, 'record', 'OK', row._id); }
      catch (err) {
        auditFailed = true;
        break;
      }
    } else conflicts++;
  }

  Object.assign(result, { marked: marked, skipped: skipped, conflicts: conflicts,
    failed: failed, auditFailed: auditFailed });
  const completion = failed === 0 && !auditFailed ? 'COMPLETE' : (marked > 0 ? 'PARTIAL' : 'FAILED');
  try {
    await writeRunLog(result, 'complete', completion, null);
  } catch (err) {
    return fail('LOG_FAILED', '到期标记已执行，但运行审计日志写入失败', {
      marked: marked,
      skipped: skipped,
      conflicts: conflicts,
      failed: failed,
      logged: false
    });
  }

  if (auditFailed) {
    return fail('LOG_FAILED', '状态已标记，但逐条审计写入失败；批次已记录部分成功', {
      marked: marked, skipped: skipped, conflicts: conflicts, failed: failed, logged: false
    });
  }

  return {
    ok: failed === 0,
    code: failed === 0 ? 'OK' : 'DATABASE_ERROR',
    marked: marked,
    skipped: skipped,
    conflicts: conflicts,
    failed: failed,
    cutoff: cutoff.toISOString()
  };
}

exports.main = async function (event, context) {
  if (!event || event.action !== 'mark') {
    return fail('INVALID_ACTION', '仅支持由已配置触发器调用的 mark 动作');
  }
  if (!hasValidMaintenanceToken(event.maintenanceToken)) {
    return fail('FORBIDDEN', '维护令牌无效或未配置');
  }
  return markExpired({ requestId: context && context.request_id });
};

exports.__test__ = {
  makeCutoff: makeCutoff,
  readPolicy: readPolicy,
  markExpired: markExpired
};
