/**
 * review —— UGC MVP 阶段 B：审核端（管理员唯一入口）
 *
 * 边界（任何一条被破坏都算实现错误）：
 *   1. 身份只取服务端上下文 cloud.getWXContext().OPENID。入参里的 openid / role /
 *      isAdmin 一律不读；白名单来自环境变量 ADMIN_OPENIDS，未配置即拒绝（fail-closed）。
 *   2. 鉴权闸门在 action 白名单之前：非管理员连“有哪些 action”都探不到，也不碰数据库。
 *   3. 只写两个集合：submissions / upload_logs。状态迁移只经本函数，
 *      客户端拿不到任何 update / remove 接口。
 *   4. approved 只表示“运营者采纳建议”，不表示事实已核实，更不表示允许公开：
 *      本函数不写 dishes / id-map / records，不改 verifyStatus（恒 unverified）。
 *   5. 审计只追加：upload_logs 只有 add，没有 update/remove 路径。
 *   6. 失败关闭：数据库异常、日志写失败、rev 不匹配都会如实返回错误，不谎报成功。
 *
 * 环境变量：
 *   ADMIN_OPENIDS  必填。逗号/空格/分号分隔的 OPENID 白名单；只读 process.env，不缓存。
 *   UGC_LOG_SALT   必填。审计日志 openid 的 HMAC 盐；缺失 → 变更类操作拒绝。
 *
 * 动作：
 *   session  鉴权探针，不读任何数据
 *   list     pending 队列（最多 20 条，按 createdAt 升序）
 *   detail   查看单条（管理员看全部；投稿人只能看自己的，越权与不存在统一 404）
 *   approve  pending → approved（需 expectedRev；security.state 必须 pass/review）
 *   reject   pending → rejected（需 expectedRev + reasonCode）
 *   delete   用户数据删除请求：清空正文、置 rejected(user_deleted)、保留匿名审计行
 */

'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const COL = Object.freeze({
  SUBMISSIONS: 'submissions',
  LOGS: 'upload_logs'
});

const ACTIONS = Object.freeze(['session', 'list', 'detail', 'approve', 'reject', 'delete']);

const STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired'
});

/* 驳回理由码：固定枚举，前端只显示码对应文案；管理员手写理由另存 reasonText。 */
const REASON_CODES = Object.freeze([
  'inaccurate',
  'duplicate',
  'insufficient_evidence',
  'out_of_scope',
  'user_deleted',
  'security_unavailable',
  'revoked',
  'other'
]);

const STATUS_VALUES = Object.freeze([STATUS.PENDING, STATUS.APPROVED, STATUS.REJECTED, STATUS.EXPIRED]);

/* 允许被采纳的安全状态：risk / error 一律禁止通过（接口故障不得当通过）。 */
const APPROVABLE_SECURITY = Object.freeze(['pass', 'review']);

const LIST_LIMIT = 20;
const REASON_TEXT_MAX = 100;

/* ================================================================
   鉴权（与 cloudfunctions/seed/index.js:255-285 同一范式）
   ================================================================ */
function parseAdminOpenIds(raw) {
  if (typeof raw !== 'string') return [];
  const out = [];
  const parts = raw.split(/[\s,;，；]+/);
  for (let i = 0; i < parts.length; i++) {
    const id = parts[i].trim();
    if (id && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

function checkAdmin(openid) {
  const admins = parseAdminOpenIds(process.env.ADMIN_OPENIDS);
  const actor = (typeof openid === 'string') ? openid.trim() : '';
  if (!admins.length) return { ok: false, reason: 'ADMIN_OPENIDS_NOT_CONFIGURED' };
  if (!actor) return { ok: false, reason: 'NO_OPENID' };
  if (admins.indexOf(actor) === -1) return { ok: false, reason: 'NOT_ADMIN' };
  return { ok: true, reason: '' };
}

function getSalt() {
  const raw = process.env.UGC_LOG_SALT;
  return (typeof raw === 'string' && raw.trim()) ? raw.trim() : '';
}

function hashOpenid(openid, salt) {
  return crypto.createHmac('sha256', salt).update(String(openid), 'utf8').digest('hex').slice(0, 32);
}

/* ================================================================
   返回
   ================================================================ */
function fail(code, httpStatus, message, extra) {
  return Object.assign({
    ok: false,
    code: code,
    httpStatus: httpStatus,
    message: message || ''
  }, extra || {});
}

/* 对外视图：不返回 submitter.openid（管理员也不需要），不返回集合名/字段清单。 */
function safeView(doc) {
  if (!doc) return null;
  return {
    submissionId: doc._id,
    kind: doc.kind || '',
    target: doc.target || {},
    payload: doc.payload || {},
    security: doc.security || {},
    status: doc.status || '',
    review: doc.review || null,
    dataClass: doc.dataClass || '',
    verifyStatus: doc.verifyStatus || '',
    importEligibility: doc.importEligibility || '',
    createdAt: doc.createdAt || null,
    updatedAt: doc.updatedAt || null,
    rev: doc.rev
  };
}

/* ================================================================
   数据库
   ================================================================ */
function isNotFound(err) {
  const code = err && (err.errCode !== undefined ? err.errCode : err.code);
  const msg = String((err && (err.errMsg || err.message)) || '');
  return code === -1 || code === 'DATABASE_DOCUMENT_NOT_FOUND' || code === -502005 ||
    /does not exist|not exist|not found|cannot find document/i.test(msg);
}

async function getDocOrNull(id) {
  try {
    const res = await db.collection(COL.SUBMISSIONS).doc(id).get();
    return (res && res.data) ? res.data : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

const LOG_EVENTS = Object.freeze([
  'submit', 'denied', 'throttle', 'security_call',
  'review_approve', 'review_reject', 'alarm', 'delete_request'
]);

async function writeLog(entry) {
  const salt = getSalt();
  if (!salt) throw new Error('UGC_LOG_SALT_NOT_CONFIGURED');
  const event = LOG_EVENTS.indexOf(entry.action) !== -1 ? entry.action : 'denied';
  const data = {
    schemaVersion: 1,
    event: event,
    action: entry.action,
    submissionId: entry.submissionId || null,
    target: entry.submissionId
      ? { collection: COL.SUBMISSIONS, id: entry.submissionId }
      : null,
    actor: {
      openidHash: hashOpenid(entry.openid || '', salt),
      role: entry.role || 'admin'
    },
    result: {
      code: entry.errorCode || 'OK',
      stats: null,
      attempts: entry.attempts || 0
    },
    errorCode: entry.errorCode || '',
    note: entry.note || '',
    day: new Date().toISOString().slice(0, 10),
    at: db.serverDate(),
    requestId: entry.requestId || '',
    rev: 1
  };
  if (entry.before || entry.after) {
    data.before = entry.before || null;
    data.after = entry.after || null;
  }
  return db.collection(COL.LOGS).add({ data: data });
}

/* 带 rev 乐观锁的状态迁移：where 同时匹配 _id 与 rev，updated!==1 视为冲突。 */
async function transition(submissionId, expectedRev, data) {
  const res = await db.collection(COL.SUBMISSIONS)
    .where({ _id: submissionId, rev: expectedRev })
    .update({ data: data });
  const updated = (res && res.stats && typeof res.stats.updated === 'number') ? res.stats.updated : 0;
  return updated === 1;
}

function isReasonCode(v) {
  return typeof v === 'string' && REASON_CODES.indexOf(v) !== -1;
}

/* ================================================================
   动作
   ================================================================ */
async function doList(openid, requestId) {
  let res;
  try {
    res = await db.collection(COL.SUBMISSIONS)
      .where({ status: STATUS.PENDING })
      .orderBy('createdAt', 'asc')
      .limit(LIST_LIMIT)
      .get();
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '读取待审队列失败');
  }
  const rows = (res && Array.isArray(res.data)) ? res.data : [];
  return {
    ok: true,
    code: 'OK',
    httpStatus: 200,
    items: rows.slice(0, LIST_LIMIT).map(function (row) {
      return {
        submissionId: row._id,
        kind: row.kind || '',
        target: row.target || {},
        payload: row.payload || {},
        security: row.security || {},
        createdAt: row.createdAt || null,
        rev: row.rev
      };
    })
  };
}

async function doDetail(openid, requestId, event) {
  const submissionId = (event && event.submissionId) || '';
  if (typeof submissionId !== 'string' || !submissionId) {
    return fail('INVALID_FIELD', 400, '缺少 submissionId');
  }
  let doc;
  try {
    doc = await getDocOrNull(submissionId);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '读取失败');
  }
  /* 只有管理员能走到这里（闸门已保证），因此管理员可查看全部记录；
     不存在的记录统一 404，不区分细节（避免枚举）。 */
  if (!doc) return fail('NOT_FOUND', 404, '不存在');
  return { ok: true, code: 'OK', httpStatus: 200, item: safeView(doc) };
}

async function doApprove(openid, requestId, event) {
  const submissionId = (event && event.submissionId) || '';
  const expectedRev = event && event.expectedRev;
  if (typeof submissionId !== 'string' || !submissionId) {
    return fail('INVALID_FIELD', 400, '缺少 submissionId');
  }
  if (!Number.isInteger(expectedRev) || expectedRev < 1) {
    return fail('INVALID_FIELD', 400, 'expectedRev 必须是正整数');
  }

  let doc;
  try {
    doc = await getDocOrNull(submissionId);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '读取失败');
  }
  if (!doc) return fail('NOT_FOUND', 404, '不存在');
  if (doc.rev !== expectedRev) return fail('STATE_CONFLICT', 409, '版本不一致，请刷新');
  if (doc.status !== STATUS.PENDING) return fail('STATE_CONFLICT', 409, '该记录已不在待审状态');

  const securityState = (doc.security && doc.security.state) || 'error';
  if (APPROVABLE_SECURITY.indexOf(securityState) === -1) {
    return fail('SECURITY_UNAVAILABLE', 503, '内容安全未完成，不能通过', { securityState: securityState });
  }

  const nextRev = expectedRev + 1;
  const patch = {
    status: STATUS.APPROVED,
    review: {
      decision: 'approve',
      byOpenidHash: hashOpenid(openid, getSalt()),
      at: db.serverDate(),
      reasonCode: 'accepted',
      reasonText: '',
      edits: null
    },
    updatedAt: db.serverDate(),
    rev: nextRev
  };

  let ok;
  try {
    ok = await transition(submissionId, expectedRev, patch);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '状态迁移失败');
  }
  if (!ok) return fail('STATE_CONFLICT', 409, '版本或状态已变化，请刷新');

  try {
    await writeLog({
      action: 'review_approve',
      submissionId: submissionId,
      openid: openid,
      requestId: requestId,
      before: { status: STATUS.PENDING, rev: expectedRev },
      after: { status: STATUS.APPROVED, rev: nextRev },
      note: 'securityState=' + securityState
    });
  } catch (err) {
    try {
      await writeLog({
        action: 'alarm', submissionId: submissionId, openid: openid,
        requestId: requestId, errorCode: 'LOG_FAILED', note: 'after approve'
      });
    } catch (e2) { /* 忽略：已经无法写日志 */ }
    return fail('LOG_FAILED', 500, '审计日志写入失败，状态已变更', {
      submissionId: submissionId, status: STATUS.APPROVED, rev: nextRev, logged: false
    });
  }

  return {
    ok: true, code: 'OK', httpStatus: 200,
    submissionId: submissionId, status: STATUS.APPROVED, rev: nextRev
  };
}

async function doReject(openid, requestId, event) {
  const submissionId = (event && event.submissionId) || '';
  const expectedRev = event && event.expectedRev;
  const reasonCode = event && event.reasonCode;
  if (typeof submissionId !== 'string' || !submissionId) {
    return fail('INVALID_FIELD', 400, '缺少 submissionId');
  }
  if (!Number.isInteger(expectedRev) || expectedRev < 1) {
    return fail('INVALID_FIELD', 400, 'expectedRev 必须是正整数');
  }
  if (!isReasonCode(reasonCode)) return fail('INVALID_FIELD', 400, 'reasonCode 不合法');

  let reasonText = '';
  if (event.reasonText !== undefined && event.reasonText !== null) {
    if (typeof event.reasonText !== 'string') return fail('INVALID_FIELD', 400, 'reasonText 必须是字符串');
    const trimmed = event.reasonText.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (Array.from(trimmed).length > REASON_TEXT_MAX) {
      return fail('INVALID_FIELD', 400, 'reasonText 超过 100 字');
    }
    reasonText = trimmed;
  }

  let doc;
  try {
    doc = await getDocOrNull(submissionId);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '读取失败');
  }
  if (!doc) return fail('NOT_FOUND', 404, '不存在');
  if (doc.rev !== expectedRev) return fail('STATE_CONFLICT', 409, '版本不一致，请刷新');
  if (doc.status !== STATUS.PENDING) return fail('STATE_CONFLICT', 409, '该记录已不在待审状态');

  const nextRev = expectedRev + 1;
  const patch = {
    status: STATUS.REJECTED,
    review: {
      decision: 'reject',
      byOpenidHash: hashOpenid(openid, getSalt()),
      at: db.serverDate(),
      reasonCode: reasonCode,
      reasonText: reasonText,
      edits: null
    },
    updatedAt: db.serverDate(),
    rev: nextRev
  };

  let ok;
  try {
    ok = await transition(submissionId, expectedRev, patch);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '状态迁移失败');
  }
  if (!ok) return fail('STATE_CONFLICT', 409, '版本或状态已变化，请刷新');

  try {
    await writeLog({
      action: 'review_reject',
      submissionId: submissionId,
      openid: openid,
      requestId: requestId,
      before: { status: STATUS.PENDING, rev: expectedRev },
      after: { status: STATUS.REJECTED, rev: nextRev },
      errorCode: reasonCode,
      note: 'reasonCode=' + reasonCode
    });
  } catch (err) {
    try {
      await writeLog({
        action: 'alarm', submissionId: submissionId, openid: openid,
        requestId: requestId, errorCode: 'LOG_FAILED', note: 'after reject'
      });
    } catch (e2) { /* 忽略 */ }
    return fail('LOG_FAILED', 500, '审计日志写入失败，状态已变更', {
      submissionId: submissionId, status: STATUS.REJECTED, rev: nextRev, logged: false
    });
  }

  return {
    ok: true, code: 'OK', httpStatus: 200,
    submissionId: submissionId, status: STATUS.REJECTED, rev: nextRev
  };
}

/* 用户数据删除请求：清空正文与身份、置 rejected(user_deleted)，保留匿名审计行。 */
async function doDelete(openid, requestId, event) {
  const submissionId = (event && event.submissionId) || '';
  if (typeof submissionId !== 'string' || !submissionId) {
    return fail('INVALID_FIELD', 400, '缺少 submissionId');
  }
  let doc;
  try {
    doc = await getDocOrNull(submissionId);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '读取失败');
  }
  if (!doc) return fail('NOT_FOUND', 404, '不存在');
  if (doc.status === STATUS.REJECTED && doc.review && doc.review.reasonCode === 'user_deleted') {
    return { ok: true, code: 'OK', httpStatus: 200, submissionId: submissionId, idempotent: true };
  }

  const expectedRev = doc.rev;
  const nextRev = expectedRev + 1;
  const patch = {
    status: STATUS.REJECTED,
    payload: null,
    payloadRedactedAt: db.serverDate(),
    submitter: { openid: 'deleted' },
    review: {
      decision: 'reject',
      byOpenidHash: hashOpenid(openid, getSalt()),
      at: db.serverDate(),
      reasonCode: 'user_deleted',
      reasonText: '',
      edits: null
    },
    updatedAt: db.serverDate(),
    rev: nextRev
  };

  let ok;
  try {
    ok = await transition(submissionId, expectedRev, patch);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '删除失败');
  }
  if (!ok) return fail('STATE_CONFLICT', 409, '状态已变化，请刷新');

  try {
    await writeLog({
      action: 'delete_request',
      submissionId: submissionId,
      openid: openid,
      requestId: requestId,
      before: { status: doc.status, rev: expectedRev },
      after: { status: STATUS.REJECTED, rev: nextRev },
      errorCode: 'user_deleted',
      note: 'payload_redacted'
    });
  } catch (err) {
    return fail('LOG_FAILED', 500, '删除已完成但审计日志写入失败', {
      submissionId: submissionId, status: STATUS.REJECTED, rev: nextRev, logged: false
    });
  }

  return {
    ok: true, code: 'OK', httpStatus: 200,
    submissionId: submissionId, status: STATUS.REJECTED, redacted: true, rev: nextRev
  };
}

/* ================================================================
   入口
   ================================================================ */
exports.main = async function (event, context) {
  const startedAt = Date.now();
  const requestId = (context && context.request_id) || '';
  const action = String((event && event.action) || '');
  const wx = cloud.getWXContext() || {};
  const openid = (typeof wx.OPENID === 'string') ? wx.OPENID.trim() : '';

  /* 闸门先于 action 白名单：非管理员连有哪些动作都探不到，且零数据库调用。 */
  const gate = checkAdmin(openid);
  if (!gate.ok) {
    return fail('FORBIDDEN', 403, '无权限', { reason: gate.reason });
  }

  if (ACTIONS.indexOf(action) === -1) {
    return fail('INVALID_ACTION', 400, '不支持的动作');
  }

  /* 变更类动作需要审计盐；缺失时不做任何状态变更。 */
  if (action === 'approve' || action === 'reject' || action === 'delete') {
    if (!getSalt()) return fail('INTERNAL', 500, '审计盐未配置');
  }

  if (action === 'session') {
    return { ok: true, code: 'OK', httpStatus: 200, role: 'admin' };
  }
  if (action === 'list') return doList(openid, requestId);
  if (action === 'detail') return doDetail(openid, requestId, event);
  if (action === 'approve') return doApprove(openid, requestId, event);
  if (action === 'reject') return doReject(openid, requestId, event);
  return doDelete(openid, requestId, event);
};

/* 仅供离线测试 require（不参与云函数运行） */
exports.__test__ = {
  COL: COL,
  ACTIONS: ACTIONS,
  STATUS: STATUS,
  STATUS_VALUES: STATUS_VALUES,
  REASON_CODES: REASON_CODES,
  APPROVABLE_SECURITY: APPROVABLE_SECURITY,
  parseAdminOpenIds: parseAdminOpenIds,
  checkAdmin: checkAdmin,
  safeView: safeView,
  hashOpenid: hashOpenid,
  isReasonCode: isReasonCode
};
