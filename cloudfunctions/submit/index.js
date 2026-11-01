/**
 * submit —— UGC MVP 阶段 B：私有纠错投稿
 *
 * 边界（任何一条被破坏都算实现错误）：
 *   1. 只写两个集合：submissions / upload_logs。集合名是下面 COL 里的冻结常量，
 *      入参不参与集合名选择。
 *   2. 不信任客户端身份：提交人只取 cloud.getWXContext().OPENID，入参里的
 *      openid / role / isAdmin 一律丢弃（并记 denied）。
 *   3. 状态由服务端决定：客户端传 status / review / verifyStatus 等键直接拒绝，
 *      落库恒为 pending。
 *   4. 不自动赋 dishId：target.dishId 只能由客户端显式提供、且必须指向云端已存在的
 *      非演示菜品；缺失时写 null。绝不从 data/dishes.js、候选 ID 或冻结映射反查。
 *   5. 不抬升可信度：dataClass 恒 user_submission、verifyStatus 恒 unverified、
 *      verifiedAt 恒 null、importEligibility 恒 blocked。
 *   6. 失败关闭：数据库读失败、内容安全不可用、日志写失败都不会被包装成成功。
 *   7. 日志不写明文 openid、不写用户正文全文、不写任何令牌。
 *
 * 依赖的环境变量（云函数控制台配置，不写在代码里）：
 *   UGC_LOG_SALT   必填。审计日志里 openid 的 HMAC 盐；缺失 → 拒绝所有请求。
 *   ADMIN_OPENIDS  本函数不使用；管理员白名单只属于 review 云函数。
 *
 * 返回：{ ok, code, httpStatus, message, ... }，前端只按 code 显示文案。
 */

'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/* ================================================================
   冻结常量
   ================================================================ */
const COL = Object.freeze({
  SUBMISSIONS: 'submissions',
  LOGS: 'upload_logs',
  DISHES: 'dishes',
  STALLS: 'stalls',
  SHOPS: 'restaurants'
});

const KINDS = Object.freeze(['price_fix', 'info_fix']);
const TARGET_KEYS = Object.freeze(['dishId', 'stallId', 'shopId']);
const PAYLOAD_KEYS = Object.freeze(['price', 'nameSuggestion', 'note']);

/* 客户端一旦带上这些键，说明它在试图指定服务端字段或身份，直接拒绝。 */
const RESERVED_KEYS = Object.freeze([
  'status', 'review', 'reviewerOpenid', 'verifyStatus', 'verifiedAt',
  'importEligibility', 'dataClass', 'submitter', 'dedupe', 'security',
  'createdAt', 'updatedAt', 'rev', 'openid', 'openId', 'role', 'isAdmin',
  'schemaVersion', 'reopenOf', 'dishId', '_id', '_openid', 'updatedBy'
]);

const LIMITS = Object.freeze({
  BODY_BYTES: 8 * 1024,
  NOTE_MIN: 1,
  NOTE_MAX: 100,
  NAME_MIN: 1,
  NAME_MAX: 20,
  PRICE_MAX_WARN: 100,
  SECURITY_TIMEOUT_MS: 4000,
  SECURITY_ATTEMPTS: 2
});

const RATE = Object.freeze({
  DAY_MAX: 10,
  DAY_MS: 24 * 60 * 60 * 1000,
  WINDOW_MAX: 3,
  WINDOW_MS: 5 * 60 * 1000
});

/* 目标 ID 形状：真实批次（c02 / c02_t02 / c02_d060）。
   形状不符会在 validateBody 阶段即返回 INVALID_FIELD（见下方 ID_RE 使用处），
   不会进入 resolveTarget；因此演示数据（s01 / d01）在云端得到的是 INVALID_FIELD，
   而不是 TARGET_NOT_FOUND 或 TARGET_IS_DEMO。 */
const ID_RE = Object.freeze({
  shopId: /^c\d{2}$/,
  stallId: /^c\d{2}_t\d{2}$/,
  dishId: /^c\d{2}_d\d{3}$/
});

const CLIENT_TOKEN_RE = /^[0-9a-f]{32}$/;

/* 不可见字符与零宽字符：正文里出现即判非法，避免用隐藏字符绕过审核。 */
const INVISIBLE_RE = /[\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/* 内容安全处置（与 docs/UGC_MVP_DESIGN_FINAL_20261026.md §7.4 一致） */
const SECURITY_STATES = Object.freeze(['pass', 'review', 'risk', 'error']);

/* ================================================================
   小工具
   ================================================================ */
function nowMs() {
  return Date.now();
}

function byteLength(value) {
  let text;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch (e) {
    text = '';
  }
  return Buffer.byteLength(text || '', 'utf8');
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/* 返回 { ok, value, reason }；reason 只用于内部测试与日志，不回显给前端。 */
function normalizeText(raw, min, max) {
  if (typeof raw !== 'string') return { ok: false, reason: 'NOT_STRING' };
  if (INVISIBLE_RE.test(raw) || CONTROL_RE.test(raw)) return { ok: false, reason: 'INVISIBLE' };
  const normalized = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!normalized) return { ok: false, reason: 'BLANK' };
  const length = Array.from(normalized).length;
  if (length < min) return { ok: false, reason: 'TOO_SHORT' };
  if (length > max) return { ok: false, reason: 'TOO_LONG' };
  return { ok: true, value: normalized };
}

function fail(code, httpStatus, message, extra) {
  return Object.assign({
    ok: false,
    code: code,
    httpStatus: httpStatus,
    message: message || ''
  }, extra || {});
}

/* 内容安全结果归一：只认官方 suggest 三值；任何其它组合都判 error（不放行）。 */
function classifySecurity(res) {
  if (!res || typeof res !== 'object') {
    return { state: 'error', labels: [], errcode: 'EMPTY_RESPONSE' };
  }
  const errCode = (res.errCode !== undefined) ? res.errCode : res.errcode;
  if (errCode !== undefined && errCode !== null && String(errCode) !== '0') {
    return { state: 'error', labels: [], errcode: String(errCode) };
  }
  const result = isPlainObject(res.result) ? res.result : {};
  const suggest = String(result.suggest || '').toLowerCase();
  const labels = Array.isArray(result.label) ? result.label.slice(0, 10) : [];
  if (suggest === 'pass') return { state: 'pass', labels: labels, errcode: '0' };
  if (suggest === 'review') return { state: 'review', labels: labels, errcode: '0' };
  if (suggest === 'risk' || suggest === 'risky') return { state: 'risk', labels: labels, errcode: '0' };
  return { state: 'error', labels: labels, errcode: 'UNKNOWN_SUGGEST' };
}

function buildDedupeKey(dishId, note, price) {
  const a = dishId || '';
  const b = note || '';
  const c = (price === null || price === undefined) ? '' : String(price);
  return a + '|' + b + '|' + c;
}

function getSalt() {
  const raw = process.env.UGC_LOG_SALT;
  return (typeof raw === 'string' && raw.trim()) ? raw.trim() : '';
}

function hashOpenid(openid, salt) {
  return crypto.createHmac('sha256', salt).update(String(openid), 'utf8').digest('hex').slice(0, 32);
}

/* ================================================================
   数据库小工具
   ================================================================ */
function isNotFound(err) {
  const code = err && (err.errCode !== undefined ? err.errCode : err.code);
  const msg = String((err && (err.errMsg || err.message)) || '');
  return code === -1 || code === 'DATABASE_DOCUMENT_NOT_FOUND' || code === -502005 ||
    /does not exist|not exist|not found|cannot find document/i.test(msg);
}

async function getDocOrNull(collectionName, id) {
  try {
    const res = await db.collection(collectionName).doc(id).get();
    return (res && res.data) ? res.data : null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

async function countWhere(collectionName, condition) {
  const res = await db.collection(collectionName).where(condition).count();
  return (res && typeof res.total === 'number') ? res.total : 0;
}

async function findOne(collectionName, condition) {
  const res = await db.collection(collectionName).where(condition).limit(1).get();
  const rows = (res && Array.isArray(res.data)) ? res.data : [];
  return rows.length ? rows[0] : null;
}

/* ================================================================
   审计日志（只追加）
   ================================================================ */
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
      role: entry.role || 'submitter'
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

/* ================================================================
   内容安全：cloud.openapi.security.msgSecCheck（无需 AppSecret）
   ----------------------------------------------------------------
   - 传输层可注入（离线测试用），默认走 openapi；openapi 不可用时判 error。
   - 单次 4s 超时、最多 2 次；两次都失败 → state=error，绝不判 pass。
   ================================================================ */
let securityTransport = null;
/* 只供离线测试缩短超时等待；生产运行时不调用，默认值即契约值 4s。 */
let securityTimeoutMs = LIMITS.SECURITY_TIMEOUT_MS;

function setSecurityTransport(fn) {
  securityTransport = (typeof fn === 'function') ? fn : null;
}

function setSecurityTimeout(ms) {
  const n = Number(ms);
  securityTimeoutMs = (isFinite(n) && n > 0) ? n : LIMITS.SECURITY_TIMEOUT_MS;
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    let settled = false;
    const timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      const err = new Error('SECURITY_TIMEOUT');
      err.code = 'SECURITY_TIMEOUT';
      reject(err);
    }, ms);
    Promise.resolve(promise).then(function (v) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    }, function (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function callSecurityOnce(payload) {
  if (securityTransport) return securityTransport(payload);
  const api = cloud.openapi && cloud.openapi.security && cloud.openapi.security.msgSecCheck;
  if (typeof api !== 'function') {
    const err = new Error('API_UNAVAILABLE');
    err.code = 'API_UNAVAILABLE';
    throw err;
  }
  return api.call(cloud.openapi.security, payload);
}

/* 返回 { state, labels, errcode, attempts, latencyMs } */
async function runSecurityCheck(text, openid) {
  const startedAt = nowMs();
  let lastErr = null;
  for (let attempt = 1; attempt <= LIMITS.SECURITY_ATTEMPTS; attempt++) {
    try {
      const res = await withTimeout(callSecurityOnce({
        content: text,
        version: 2,
        scene: 1,
        openid: openid
      }), securityTimeoutMs);
      const classified = classifySecurity(res);
      classified.attempts = attempt;
      classified.latencyMs = nowMs() - startedAt;
      return classified;
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    state: 'error',
    labels: [],
    errcode: String((lastErr && (lastErr.code || lastErr.errCode || lastErr.message)) || 'SECURITY_CALL_FAILED'),
    attempts: LIMITS.SECURITY_ATTEMPTS,
    latencyMs: nowMs() - startedAt
  };
}

/* ================================================================
   请求校验
   ================================================================ */
function collectReservedKeys(event) {
  const hit = [];
  const topKeys = Object.keys(event || {});
  for (let i = 0; i < topKeys.length; i++) {
    if (RESERVED_KEYS.indexOf(topKeys[i]) !== -1) hit.push(topKeys[i]);
  }
  if (isPlainObject(event && event.payload)) {
    const payloadKeys = Object.keys(event.payload);
    for (let j = 0; j < payloadKeys.length; j++) {
      if (RESERVED_KEYS.indexOf(payloadKeys[j]) !== -1) hit.push('payload.' + payloadKeys[j]);
      else if (PAYLOAD_KEYS.indexOf(payloadKeys[j]) === -1) hit.push('payload.' + payloadKeys[j]);
    }
  }
  if (isPlainObject(event && event.target)) {
    const targetKeys = Object.keys(event.target);
    for (let k = 0; k < targetKeys.length; k++) {
      if (TARGET_KEYS.indexOf(targetKeys[k]) === -1) hit.push('target.' + targetKeys[k]);
    }
  }
  return hit;
}

/* 校验 kind / target / payload；返回 { ok, reason, code, value } */
function validateBody(event) {
  if (!isPlainObject(event)) return { ok: false, code: 'INVALID_FIELD', reason: 'NOT_OBJECT' };

  const kind = event.kind;
  if (KINDS.indexOf(kind) === -1) return { ok: false, code: 'INVALID_FIELD', reason: 'KIND' };

  if (event.clientToken === undefined || event.clientToken === null) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'CLIENT_TOKEN_MISSING' };
  }
  if (typeof event.clientToken !== 'string' || !CLIENT_TOKEN_RE.test(event.clientToken)) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'CLIENT_TOKEN' };
  }

  if (!isPlainObject(event.target)) return { ok: false, code: 'INVALID_FIELD', reason: 'TARGET' };
  const target = event.target;
  const shopId = (target.shopId === undefined || target.shopId === null) ? '' : target.shopId;
  const stallId = (target.stallId === undefined || target.stallId === null) ? '' : target.stallId;
  const dishIdRaw = (target.dishId === undefined || target.dishId === null) ? '' : target.dishId;

  if (typeof shopId !== 'string' || !ID_RE.shopId.test(shopId)) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'SHOP_ID' };
  }
  if (typeof stallId !== 'string' || !ID_RE.stallId.test(stallId)) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'STALL_ID' };
  }
  if (dishIdRaw !== '' && (typeof dishIdRaw !== 'string' || !ID_RE.dishId.test(dishIdRaw))) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'DISH_ID' };
  }

  if (!isPlainObject(event.payload)) return { ok: false, code: 'INVALID_FIELD', reason: 'PAYLOAD' };
  const payload = event.payload;

  let price = null;
  if (payload.price !== undefined && payload.price !== null) {
    if (typeof payload.price !== 'number' || !isFinite(payload.price) || payload.price <= 0) {
      return { ok: false, code: 'INVALID_PRICE', reason: 'PRICE' };
    }
    if (Math.round(payload.price * 10) !== payload.price * 10) {
      return { ok: false, code: 'INVALID_PRICE', reason: 'PRICE_DECIMALS' };
    }
    price = payload.price;
  }

  let note = null;
  if (payload.note !== undefined && payload.note !== null) {
    const rn = normalizeText(payload.note, LIMITS.NOTE_MIN, LIMITS.NOTE_MAX);
    if (!rn.ok) return { ok: false, code: 'INVALID_NOTE', reason: rn.reason };
    note = rn.value;
  }

  let nameSuggestion = null;
  if (payload.nameSuggestion !== undefined && payload.nameSuggestion !== null) {
    const rs = normalizeText(payload.nameSuggestion, LIMITS.NAME_MIN, LIMITS.NAME_MAX);
    if (!rs.ok) return { ok: false, code: 'INVALID_NAME', reason: rs.reason };
    nameSuggestion = rs.value;
  }

  if (kind === 'price_fix' && price === null) {
    return { ok: false, code: 'INVALID_PRICE', reason: 'PRICE_REQUIRED' };
  }
  if (kind === 'info_fix' && note === null && nameSuggestion === null) {
    return { ok: false, code: 'INVALID_FIELD', reason: 'NO_CONTENT' };
  }

  const warnings = [];
  if (price !== null && price > LIMITS.PRICE_MAX_WARN) warnings.push('PRICE_ABOVE_100');

  return {
    ok: true,
    value: {
      kind: kind,
      clientToken: event.clientToken,
      target: { shopId: shopId, stallId: stallId, dishId: dishIdRaw || null },
      payload: { price: price, nameSuggestion: nameSuggestion, note: note },
      warnings: warnings
    }
  };
}

/* ================================================================
   目标一致性（服务端独立读库复算）
   ================================================================ */
/* 投稿准入的验证状态（P3）：目标必须是 field_unverified，且记录自带的
   verifyStatus 只能是 unverified。历史数据没有该字段时按「未标状态」放行，
   不因此拒绝；一旦显式标成 verified / expired 等，说明该记录已经离开
   「待核实」阶段，纠错投稿不再适用，统一 422。 */
function inadmissibleVerifyStatus(doc) {
  const raw = doc ? doc.verifyStatus : undefined;
  if (raw === undefined || raw === null) return null;
  const vs = String(raw).trim();
  if (!vs || vs === 'unverified') return null;
  return vs;
}

async function resolveTarget(target) {
  if (target.dishId) {
    const dish = await getDocOrNull(COL.DISHES, target.dishId);
    if (!dish) return { ok: false, code: 'TARGET_NOT_FOUND', httpStatus: 404 };
    if (dish.dataClass === 'demo') return { ok: false, code: 'TARGET_IS_DEMO', httpStatus: 422 };
    if (dish.dataClass !== 'field_unverified') {
      return { ok: false, code: 'TARGET_NOT_VERIFIABLE', httpStatus: 422, reason: 'DATACLASS_NOT_FIELD_UNVERIFIED' };
    }
    const badVerify = inadmissibleVerifyStatus(dish);
    if (badVerify) {
      return { ok: false, code: 'TARGET_NOT_VERIFIABLE', httpStatus: 422, reason: 'VERIFYSTATUS_NOT_UNVERIFIED', verifyStatus: badVerify };
    }
    const dishShop = dish.restaurantId || dish.shopId || '';
    if (String(dish.stallId || '') !== target.stallId || String(dishShop) !== target.shopId) {
      return { ok: false, code: 'TARGET_MISMATCH', httpStatus: 409 };
    }
    return { ok: true };
  }

  const stall = await getDocOrNull(COL.STALLS, target.stallId);
  if (!stall) return { ok: false, code: 'TARGET_NOT_FOUND', httpStatus: 404 };
  if (stall.dataClass === 'demo') return { ok: false, code: 'TARGET_IS_DEMO', httpStatus: 422 };
  if (stall.dataClass !== 'field_unverified') {
    return { ok: false, code: 'TARGET_NOT_VERIFIABLE', httpStatus: 422, reason: 'DATACLASS_NOT_FIELD_UNVERIFIED' };
  }
  const badStallVerify = inadmissibleVerifyStatus(stall);
  if (badStallVerify) {
    return { ok: false, code: 'TARGET_NOT_VERIFIABLE', httpStatus: 422, reason: 'VERIFYSTATUS_NOT_UNVERIFIED', verifyStatus: badStallVerify };
  }
  if (String(stall.restaurantId || stall.shopId || '') !== target.shopId) {
    return { ok: false, code: 'TARGET_MISMATCH', httpStatus: 409 };
  }
  return { ok: true };
}

/* ================================================================
   入口
   ================================================================ */
exports.main = async function (event, context) {
  const startedAt = nowMs();
  const requestId = (context && context.request_id) || '';
  const action = (event && event.action) || '';

  if (action !== 'submit') {
    return fail('INVALID_ACTION', 400, '只支持 submit');
  }

  const wx = cloud.getWXContext() || {};
  const openid = (typeof wx.OPENID === 'string') ? wx.OPENID.trim() : '';
  if (!openid) return fail('NO_OPENID', 401, '缺少服务端身份');

  if (!getSalt()) {
    /* 配置缺失时不写任何记录（日志也必须能脱敏），并如实报错。 */
    return fail('INTERNAL', 500, '审计盐未配置');
  }

  if (byteLength(event) > LIMITS.BODY_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', 413, '请求体超过 8KB');
  }

  /* 图片：本阶段不支持，任何非空数组都拒绝。 */
  if (event.photos !== undefined) {
    if (!Array.isArray(event.photos) || event.photos.length !== 0) {
      return fail('PHOTO_NOT_SUPPORTED', 400, '本版本不支持图片');
    }
  }

  const reserved = collectReservedKeys(event);
  if (reserved.length) {
    try {
      await writeLog({
        action: 'denied', openid: openid, requestId: requestId,
        note: 'reserved_field', errorCode: 'RESERVED_FIELD'
      });
    } catch (e) { /* 日志失败不改变拒绝结论 */ }
    return fail('RESERVED_FIELD', 400, '含保留字段', { fields: reserved.slice(0, 8) });
  }

  const body = validateBody(event);
  if (!body.ok) return fail(body.code, 400, body.reason);

  const value = body.value;

  /* 目标读取失败（数据库异常）如实报 500，不降级。 */
  let targetCheck;
  try {
    targetCheck = await resolveTarget(value.target);
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '目标校验失败');
  }
  if (!targetCheck.ok) {
    const extra = {};
    if (targetCheck.reason) extra.reason = targetCheck.reason;
    if (targetCheck.verifyStatus) extra.verifyStatus = targetCheck.verifyStatus;
    return fail(targetCheck.code, targetCheck.httpStatus, targetCheck.code, extra);
  }

  /* 幂等：同一 openid + clientToken 只产生一条记录。 */
  let existing;
  try {
    existing = await findOne(COL.SUBMISSIONS, {
      'submitter.openid': openid,
      clientToken: value.clientToken
    });
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '查询失败');
  }
  if (existing) {
    return {
      ok: true,
      code: 'OK',
      httpStatus: 200,
      submissionId: existing._id,
      status: existing.status,
      idempotent: true
    };
  }

  /* 待审去重 */
  const dedupeKey = buildDedupeKey(value.target.dishId, value.payload.note, value.payload.price);
  let dup;
  try {
    dup = await findOne(COL.SUBMISSIONS, { 'dedupe.key': dedupeKey, status: 'pending' });
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '查询失败');
  }
  if (dup) {
    return fail('DUPLICATE', 409, '已有相同待审投稿', { dupOf: dup._id });
  }

  /* 限流：数据库计数为准（内存计数只作快速拒绝，不作为唯一依据）。 */
  const sinceDay = new Date(nowMs() - RATE.DAY_MS);
  const sinceWindow = new Date(nowMs() - RATE.WINDOW_MS);
  let dayCount;
  let windowCount;
  try {
    dayCount = await countWhere(COL.SUBMISSIONS, {
      'submitter.openid': openid,
      createdAt: _.gte(sinceDay)
    });
    windowCount = await countWhere(COL.SUBMISSIONS, {
      'submitter.openid': openid,
      createdAt: _.gte(sinceWindow)
    });
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '限流查询失败');
  }
  if (dayCount >= RATE.DAY_MAX || windowCount >= RATE.WINDOW_MAX) {
    try {
      await writeLog({
        action: 'throttle', openid: openid, requestId: requestId,
        note: 'day=' + dayCount + ',window=' + windowCount, errorCode: 'RATE_LIMITED'
      });
    } catch (e) { /* 忽略 */ }
    const retryAfter = dayCount >= RATE.DAY_MAX
      ? Math.max(1, Math.ceil((RATE.DAY_MS - (nowMs() - sinceDay.getTime())) / 1000))
      : Math.ceil(RATE.WINDOW_MS / 1000);
    return fail('RATE_LIMITED', 429, '提交过于频繁', { retryAfter: retryAfter });
  }

  /* 内容安全：只有存在文本时才调用；无文本按 skipped 记，不算“接口故障被当通过”。 */
  const securityText = [value.payload.note || '', value.payload.nameSuggestion || '']
    .filter(function (s) { return !!s; }).join('\n');
  let security;
  if (!securityText) {
    security = { state: 'pass', labels: [], errcode: 'SKIPPED_NO_TEXT', attempts: 0, latencyMs: 0, skipped: true };
  } else {
    security = await runSecurityCheck(securityText, openid);
  }

  if (security.state === 'error') {
    try {
      await writeLog({
        action: 'security_call', openid: openid, requestId: requestId,
        errorCode: security.errcode,
        note: 'state=error,attempts=' + security.attempts + ',latencyMs=' + security.latencyMs
      });
    } catch (e) { /* 忽略 */ }
  }

  const doc = {
    schemaVersion: 1,
    clientToken: value.clientToken,
    kind: value.kind,
    target: value.target,
    payload: value.payload,
    photos: [],
    security: {
      state: security.state,
      labels: security.labels || [],
      provider: 'msg_sec_check',
      version: 2,
      checkedAt: db.serverDate(),
      rid: security.errcode || '',
      attempts: security.attempts || 0,
      latencyMs: security.latencyMs || 0,
      skipped: !!security.skipped
    },
    status: 'pending',
    review: null,
    submitter: { openid: openid },
    dedupe: { key: dedupeKey, dupOf: null },
    dataClass: 'user_submission',
    verifyStatus: 'unverified',
    verifiedAt: null,
    importEligibility: 'blocked',
    reopenOf: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
    rev: 1
  };

  let added;
  try {
    added = await db.collection(COL.SUBMISSIONS).add({ data: doc });
  } catch (err) {
    return fail('DATABASE_ERROR', 500, '落库失败');
  }
  const submissionId = added && added._id;
  if (!submissionId) return fail('INTERNAL', 500, '落库未返回 ID');

  try {
    await writeLog({
      action: 'submit',
      submissionId: submissionId,
      openid: openid,
      requestId: requestId,
      note: 'kind=' + value.kind + ',security=' + security.state + ',target=' + (value.target.dishId || value.target.stallId)
    });
  } catch (err) {
    /* 记录已落库但审计失败：不谎报成功，返回 500 并提示可幂等重试。 */
    return fail('LOG_FAILED', 500, '审计日志写入失败', { submissionId: submissionId });
  }

  return {
    ok: true,
    code: 'OK',
    httpStatus: 200,
    submissionId: submissionId,
    status: 'pending',
    securityState: security.state,
    idempotent: false,
    warnings: value.warnings
  };
};

/* 仅供离线测试 require（不参与云函数运行） */
exports.__test__ = {
  COL: COL,
  KINDS: KINDS,
  TARGET_KEYS: TARGET_KEYS,
  PAYLOAD_KEYS: PAYLOAD_KEYS,
  RESERVED_KEYS: RESERVED_KEYS,
  LIMITS: LIMITS,
  RATE: RATE,
  SECURITY_STATES: SECURITY_STATES,
  normalizeText: normalizeText,
  classifySecurity: classifySecurity,
  buildDedupeKey: buildDedupeKey,
  validateBody: validateBody,
  inadmissibleVerifyStatus: inadmissibleVerifyStatus,
  collectReservedKeys: collectReservedKeys,
  hashOpenid: hashOpenid,
  byteLength: byteLength,
  setSecurityTransport: setSecurityTransport,
  setSecurityTimeout: setSecurityTimeout
};
