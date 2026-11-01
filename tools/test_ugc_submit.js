/**
 * 本地模拟测试：cloudfunctions/submit（私有纠错投稿）
 *
 * 结论口径：本文件里的“通过”只代表**本地模拟**行为符合契约；
 * 不代表云端集合权限、内容安全接口、索引或部署已经验证。
 *
 * 运行：node tools/test_ugc_submit.js
 */
'use strict';

const assert = require('assert');
const { createHarness } = require('./ugc_fake_cloud');

const h = createHarness();
const SALT = 'test_salt_for_local_ugc_submit';
process.env.UGC_LOG_SALT = SALT;

const fn = h.loadFunction('cloudfunctions/submit/index.js');
const T = fn.__test__;

let pass = 0;
let failCount = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('[PASS] ' + name);
  } else {
    failCount++;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('[FAIL] ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

const OPENID = 'fake_user_001';
const TOKEN = '0123456789abcdef0123456789abcdef';
const TOKEN2 = 'fedcba9876543210fedcba9876543210';

function baseEvent(over, payloadOver) {
  const ev = {
    action: 'submit',
    kind: 'price_fix',
    clientToken: TOKEN,
    target: { shopId: 'c02', stallId: 'c02_t02', dishId: 'c02_d060' },
    payload: Object.assign({ price: 12, note: '价目表显示 12 元' }, payloadOver || {})
  };
  return Object.assign(ev, over || {});
}

function seedTargets() {
  h.seed('dishes', {
    _id: 'c02_d060', name: '招牌面', price: 12, foodType: '主食',
    stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'field_unverified'
  });
  h.seed('stalls', {
    _id: 'c02_t02', name: '韩小面', restaurantId: 'c02', dataClass: 'field_unverified'
  });
}

function prepare(openid) {
  h.reset();
  h.setOpenid(openid === undefined ? OPENID : openid);
  process.env.UGC_LOG_SALT = SALT;
  T.setSecurityTransport(function () {
    return { errCode: 0, errMsg: 'ok', result: { suggest: 'pass', label: 100 } };
  });
  seedTargets();
}

async function main() {
  console.log('== A. 静态边界（源码扫描） ==');
  const src = h.readSource('cloudfunctions/submit/index.js');
  ok('A1 不引用生成器产物或冻结映射', !/records\.json|records_blockers|gen-manifest|id-map|ID_MAP/i.test(src));
  ok('A2 不读取本地演示数据源', !/require\([^)]*data\//.test(src) && src.indexOf('readFileSync') === -1);
  ok('A3 只声明两个写入集合', /SUBMISSIONS: 'submissions'/.test(src) && /LOGS: 'upload_logs'/.test(src));
  ok('A4 落库字段写死 unverified', /verifyStatus: 'unverified'/.test(src) && /verifiedAt: null/.test(src));
  ok('A5 不提供数据库 update/remove 调用路径', !/collection\([^)]*\)\s*\.\s*(update|remove)\(/.test(src));

  /* 前端只提交纠错：不采集身份、不收图片、不留本地缓存 */
  const pageSrc = h.readSource('pages/submit/submit.js');
  ok('A6 投稿页不调用身份/定位/相册接口', !/wx\.login|getUserProfile|getPhoneNumber|getLocation|chooseImage|chooseMedia|getUserInfo/.test(pageSrc));
  ok('A7 投稿页不写本地缓存', !/setStorage|setStorageSync|getStorage/.test(pageSrc));
  const cfgSrc = h.readSource('config/ugc.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('A8 保留期限未写死（配置项待确认）', /status:\s*'pending_confirmation'/.test(cfgSrc) && !/days:\s*90\b/.test(cfgSrc) && !/90\s*天/.test(cfgSrc));

  console.log('== B. 入口与身份 ==');
  prepare();
  let r = await fn.main({ action: 'publish' }, {});
  eq('B1 非 submit 动作拒绝', r.code, 'INVALID_ACTION');
  prepare(null);
  r = await fn.main(baseEvent(), {});
  eq('B2 缺 openid 拒绝', r.code, 'NO_OPENID');
  prepare();
  delete process.env.UGC_LOG_SALT;
  r = await fn.main(baseEvent(), {});
  eq('B3 审计盐未配置时拒绝', r.code, 'INTERNAL');
  process.env.UGC_LOG_SALT = SALT;
  ok('B3b 拒绝时不落库', h.docs('submissions').length === 0);

  console.log('== C. 保留字段（客户端不能指定身份/状态） ==');
  const reservedCases = [
    ['status', 'approved'], ['reviewerOpenid', 'x'], ['verifyStatus', 'verified'],
    ['role', 'admin'], ['openid', 'someone'], ['isAdmin', true],
    ['dishId', 'c02_d061'], ['review', { decision: 'approve' }]
  ];
  for (let i = 0; i < reservedCases.length; i++) {
    prepare();
    const ev = baseEvent();
    ev[reservedCases[i][0]] = reservedCases[i][1];
    r = await fn.main(ev, {});
    eq('C' + (i + 1) + ' 顶层 ' + reservedCases[i][0] + ' 被拒', r.code, 'RESERVED_FIELD');
  }
  prepare();
  r = await fn.main(baseEvent({}, { extra: 1 }), {});
  eq('C9 payload 非白名单键被拒', r.code, 'RESERVED_FIELD');
  prepare();
  const badTarget = baseEvent();
  badTarget.target.extra = 'x';
  r = await fn.main(badTarget, {});
  eq('C10 target 非白名单键被拒', r.code, 'RESERVED_FIELD');

  console.log('== D. 请求体校验 ==');
  const badBodies = [
    ['D1 kind 非法', baseEvent({ kind: 'other' }), 'INVALID_FIELD'],
    ['D2 clientToken 非 32 hex', baseEvent({ clientToken: 'ABC' }), 'INVALID_FIELD'],
    ['D3 缺 clientToken', baseEvent({ clientToken: undefined }), 'INVALID_FIELD'],
    ['D4 shopId 形状不符', baseEvent({ target: { shopId: 's01', stallId: 'c02_t02', dishId: '' } }), 'INVALID_FIELD'],
    ['D5 stallId 形状不符', baseEvent({ target: { shopId: 'c02', stallId: 'c02_t2', dishId: '' } }), 'INVALID_FIELD'],
    ['D6 dishId 形状不符', baseEvent({ target: { shopId: 'c02', stallId: 'c02_t02', dishId: 'd01' } }), 'INVALID_FIELD'],
    ['D7 price 两位小数', baseEvent({}, { price: 12.34 }), 'INVALID_PRICE'],
    ['D8 price 非正数', baseEvent({}, { price: 0 }), 'INVALID_PRICE'],
    ['D9 price 为字符串', baseEvent({}, { price: '12' }), 'INVALID_PRICE'],
    ['D10 note 空白', baseEvent({}, { note: '   ' }), 'INVALID_NOTE'],
    ['D11 note 超 100 字', baseEvent({}, { note: '字'.repeat(101) }), 'INVALID_NOTE'],
    ['D12 note 含零宽字符', baseEvent({}, { note: '正常\u200b内容' }), 'INVALID_NOTE'],
    ['D13 nameSuggestion 超 20 字', baseEvent({ kind: 'info_fix', payload: { nameSuggestion: '名'.repeat(21) } }), 'INVALID_NAME'],
    ['D14 price_fix 缺 price', baseEvent({ payload: { note: '只写说明' } }), 'INVALID_PRICE'],
    ['D15 info_fix 无任何内容', baseEvent({ kind: 'info_fix', payload: {} }), 'INVALID_FIELD']
  ];
  for (let i = 0; i < badBodies.length; i++) {
    prepare();
    r = await fn.main(badBodies[i][1], {});
    eq(badBodies[i][0], r.code, badBodies[i][2]);
  }

  console.log('== E. 请求体大小与图片 ==');
  prepare();
  r = await fn.main(baseEvent({}, { note: '字'.repeat(9000) }), {});
  eq('E1 超大请求体拒绝', r.code, 'PAYLOAD_TOO_LARGE');
  prepare();
  r = await fn.main(baseEvent({ photos: ['a.jpg'] }), {});
  eq('E2 任何图片都拒绝', r.code, 'PHOTO_NOT_SUPPORTED');
  prepare();
  r = await fn.main(baseEvent({ photos: [] }), {});
  eq('E3 空图片数组允许', r.ok, true);

  console.log('== F. 目标校验 ==');
  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'demo' });
  r = await fn.main(baseEvent(), {});
  eq('F1 演示数据不可投稿', r.code, 'TARGET_IS_DEMO');
  prepare();
  h.reset();
  h.setOpenid(OPENID);
  r = await fn.main(baseEvent(), {});
  eq('F2 目标不存在', r.code, 'TARGET_NOT_FOUND');
  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t09', restaurantId: 'c02', dataClass: 'field_unverified' });
  r = await fn.main(baseEvent(), {});
  eq('F3 档口不一致', r.code, 'TARGET_MISMATCH');
  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'verified' });
  r = await fn.main(baseEvent(), {});
  eq('F4 非待核实数据不可投稿', r.code, 'TARGET_NOT_VERIFIABLE');
  eq('F4b 非待核实数据原因可区分', r.reason, 'DATACLASS_NOT_FIELD_UNVERIFIED');

  console.log('== F2. P3：field_unverified 但 verifyStatus 已离开待核实 ==');
  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'field_unverified', verifyStatus: 'verified' });
  r = await fn.main(baseEvent(), {});
  eq('F5 已核实记录不可投稿', r.code, 'TARGET_NOT_VERIFIABLE');
  eq('F6 已核实记录 422', r.httpStatus, 422);
  eq('F7 原因标注 VERIFYSTATUS_NOT_UNVERIFIED', r.reason, 'VERIFYSTATUS_NOT_UNVERIFIED');
  eq('F8 回传当前 verifyStatus 供排查', r.verifyStatus, 'verified');
  ok('F9 被拒时不落库', h.docs('submissions').length === 0);

  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'field_unverified', verifyStatus: 'expired' });
  r = await fn.main(baseEvent(), {});
  eq('F10 已过期记录不可投稿', r.code, 'TARGET_NOT_VERIFIABLE');
  eq('F11 已过期记录原因一致', r.reason, 'VERIFYSTATUS_NOT_UNVERIFIED');

  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('dishes', { _id: 'c02_d060', stallId: 'c02_t02', restaurantId: 'c02', dataClass: 'field_unverified', verifyStatus: 'unverified' });
  r = await fn.main(baseEvent(), {});
  eq('F12 显式 unverified 允许投稿', r.ok, true);

  prepare();
  h.reset();
  h.setOpenid(OPENID);
  h.seed('stalls', { _id: 'c02_t02', name: '韩小面', restaurantId: 'c02', dataClass: 'field_unverified', verifyStatus: 'verified' });
  r = await fn.main(baseEvent({ target: { shopId: 'c02', stallId: 'c02_t02', dishId: '' } }), {});
  eq('F13 档口级目标同样按 verifyStatus 拒绝', r.code, 'TARGET_NOT_VERIFIABLE');
  eq('F14 档口级拒绝原因一致', r.reason, 'VERIFYSTATUS_NOT_UNVERIFIED');

  prepare();
  r = await fn.main(baseEvent(), {});
  eq('F15 正常目标通过', r.ok, true);

  console.log('== G. 落库字段与“不自动赋 dishId” ==');
  prepare();
  const evNoDish = baseEvent({ target: { shopId: 'c02', stallId: 'c02_t02', dishId: '' } });
  r = await fn.main(evNoDish, {});
  eq('G1 无 dishId 也允许（档口级纠错）', r.ok, true);
  const doc1 = h.docs('submissions')[0];
  eq('G2 dishId 保持 null', doc1.target.dishId, null);
  eq('G3 状态恒 pending', doc1.status, 'pending');
  eq('G4 dataClass 固定', doc1.dataClass, 'user_submission');
  eq('G5 verifyStatus 固定 unverified', doc1.verifyStatus, 'unverified');
  eq('G6 verifiedAt 为 null', doc1.verifiedAt, null);
  eq('G7 importEligibility 固定 blocked', doc1.importEligibility, 'blocked');
  eq('G8 rev 初始为 1', doc1.rev, 1);
  eq('G9 photos 恒为空数组', Array.isArray(doc1.photos) && doc1.photos.length, 0);
  ok('G10 存储 submitter.openid 为服务端身份', doc1.submitter.openid === OPENID);
  ok('G11 不写 openid 明文到日志', (function () {
    const logs = h.docs('upload_logs');
    const text = JSON.stringify(logs);
    return logs.length > 0 && text.indexOf(OPENID) === -1;
  })());
  ok('G12 日志不写正文全文', JSON.stringify(h.docs('upload_logs')).indexOf('价目表显示 12 元') === -1);
  ok('G13 只写入两个集合', h.touchedCollections().every(function (c) {
    return h.calls(c).indexOf('add') === -1 || c === 'submissions' || c === 'upload_logs';
  }));
  ok('G14 其它集合只读不写', ['dishes', 'stalls'].every(function (c) {
    return h.calls(c).every(function (op) { return op === 'get'; });
  }));

  console.log('== H. 幂等与去重 ==');
  prepare();
  const e1 = baseEvent();
  const a1 = await fn.main(e1, {});
  const a2 = await fn.main(e1, {});
  eq('H1 同令牌第一次创建', a1.idempotent, false);
  eq('H2 同令牌重试幂等', a2.idempotent, true);
  eq('H3 幂等不新增记录', h.docs('submissions').length, 1);
  prepare();
  await fn.main(baseEvent(), {});
  const dup = await fn.main(baseEvent({ clientToken: TOKEN2 }), {});
  eq('H4 同内容待审去重', dup.code, 'DUPLICATE');
  ok('H5 去重返回 dupOf', typeof dup.dupOf === 'string' && dup.dupOf.length > 0);
  eq('H6 去重不新增记录', h.docs('submissions').length, 1);

  console.log('== I. 限流 ==');
  prepare();
  const now = Date.now();
  for (let i = 0; i < 3; i++) {
    h.seed('submissions', {
      _id: 'old_' + i, clientToken: 'a'.repeat(32), status: 'pending',
      submitter: { openid: OPENID }, createdAt: new Date(now - 60000)
    });
  }
  r = await fn.main(baseEvent({ clientToken: 'b'.repeat(32) }), {});
  eq('I1 五分钟内第 4 条被限流', r.code, 'RATE_LIMITED');
  ok('I2 返回 retryAfter', typeof r.retryAfter === 'number' && r.retryAfter >= 1);
  prepare();
  for (let i = 0; i < 10; i++) {
    h.seed('submissions', {
      _id: 'day_' + i, clientToken: 'c'.repeat(32), status: 'rejected',
      submitter: { openid: OPENID }, createdAt: new Date(now - 3600000)
    });
  }
  r = await fn.main(baseEvent({ clientToken: 'd'.repeat(32) }), {});
  eq('I3 24 小时内第 11 条被限流', r.code, 'RATE_LIMITED');

  console.log('== J. 内容安全四种结果 ==');
  const securityCases = [
    ['pass', { errCode: 0, result: { suggest: 'pass' } }, 'pass'],
    ['review', { errCode: 0, result: { suggest: 'review', label: 20001 } }, 'review'],
    ['risk', { errCode: 0, result: { suggest: 'risky' } }, 'risk'],
    ['errcode', { errCode: 87014, errMsg: 'risky' }, 'error']
  ];
  for (let i = 0; i < securityCases.length; i++) {
    prepare();
    T.setSecurityTransport(function () { return securityCases[i][1]; });
    r = await fn.main(baseEvent(), {});
    const doc = h.docs('submissions')[0];
    eq('J' + (i + 1) + ' ' + securityCases[i][0] + ' 落库状态', doc.security.state, securityCases[i][2]);
    if (securityCases[i][2] === 'error') {
      eq('J' + (i + 1) + 'b 接口故障仍为 pending', doc.status, 'pending');
      ok('J' + (i + 1) + 'c 故障写安全日志', h.docs('upload_logs').some(function (l) { return l.event === 'security_call'; }));
    }
  }
  prepare();
  T.setSecurityTransport(function () { const e = new Error('timeout'); e.code = 'SECURITY_TIMEOUT'; return Promise.reject(e); });
  r = await fn.main(baseEvent(), {});
  eq('J5 抛异常判 error（不当通过）', h.docs('submissions')[0].security.state, 'error');
  /* 超时分支：调用挂起不返回，必须在 2 次 × 短超时后判 error，绝不判 pass */
  prepare();
  T.setSecurityTimeout(20);
  T.setSecurityTransport(function () { return new Promise(function () {}); });
  const startedAt = Date.now();
  r = await fn.main(baseEvent(), {});
  const hangDoc = h.docs('submissions')[0];
  eq('J5b 调用挂起按超时判 error', hangDoc.security.state, 'error');
  eq('J5c 挂起重试次数为 2', hangDoc.security.attempts, 2);
  ok('J5d 超时后仍为 pending', hangDoc.status === 'pending' && r && r.ok === true);
  ok('J5e 超时未阻塞过久', (Date.now() - startedAt) < 2000);
  T.setSecurityTimeout(4000);
  T.setSecurityTransport(null);
  prepare();
  r = await fn.main(baseEvent({ payload: { price: 9 } }), {});
  const skipDoc = h.docs('submissions')[0];
  eq('J6 无文本时跳过检测', skipDoc.security.skipped, true);
  eq('J7 跳过仍记 pass 且降级标注', skipDoc.security.state, 'pass');

  console.log('== K. 数据库失败不谎报成功 ==');
  prepare();
  h.setFail({ collection: 'submissions', op: 'add' });
  r = await fn.main(baseEvent(), {});
  eq('K1 落库失败返回 DATABASE_ERROR', r.code, 'DATABASE_ERROR');
  ok('K2 落库失败不返回成功', r.ok === false);
  prepare();
  h.setFail({ collection: 'dishes', op: 'get' });
  r = await fn.main(baseEvent(), {});
  eq('K3 目标读取失败返回 DATABASE_ERROR', r.code, 'DATABASE_ERROR');
  prepare();
  h.setFail({ collection: 'submissions', op: 'count' });
  r = await fn.main(baseEvent(), {});
  eq('K4 限流计数失败返回 DATABASE_ERROR', r.code, 'DATABASE_ERROR');

  console.log('== L. 审计日志失败如实上报 ==');
  prepare();
  h.setFail({ collection: 'upload_logs', op: 'add' });
  r = await fn.main(baseEvent(), {});
  eq('L1 日志失败返回 LOG_FAILED', r.code, 'LOG_FAILED');
  ok('L2 已落库记录仍存在（不谎报）', h.docs('submissions').length === 1);
  ok('L3 返回中说明记录已写入', typeof r.submissionId === 'string' && r.submissionId.length > 0);

  console.log('== M. 幂等性不因日志失败丢失 ==');
  prepare();
  const m1 = await fn.main(baseEvent(), {});
  ok('M1 首次成功', m1.ok === true);
  h.clearFail();
  const m2 = await fn.main(baseEvent(), {});
  eq('M2 重试幂等返回同一条', m2.idempotent, true);
  eq('M3 不重复落库', h.docs('submissions').length, 1);

  console.log('== N. 校验顺序：形状先于查库（P2 与源码一致） ==');
  prepare();
  r = await fn.main(baseEvent({ target: { shopId: 'c02', stallId: 'c02_t02', dishId: 'd01' } }), {});
  eq('N1 旧命名 dishId 返回 INVALID_FIELD', r.code, 'INVALID_FIELD');
  ok('N2 指出是 dishId（message=DISH_ID）', String(r.message) === 'DISH_ID');
  eq('N3 形状不符时一次数据库都没读', h.calls('dishes').length, 0);

  prepare();
  r = await fn.main(baseEvent({ target: { shopId: 's01', stallId: 'c02_t02', dishId: 'c02_d060' } }), {});
  eq('N4 旧命名 shopId 返回 INVALID_FIELD', r.code, 'INVALID_FIELD');
  eq('N5 形状不符时同样不读库', h.calls('dishes').length, 0);

  prepare();
  r = await fn.main(baseEvent({ target: { shopId: 'c02', stallId: 'c02_t02', dishId: 'c02_d999' } }), {});
  eq('N6 形状合法但不存在才查库并报 TARGET_NOT_FOUND', r.code, 'TARGET_NOT_FOUND');
  eq('N7 此时确实读过 dishes', h.calls('dishes').length > 0, true);
  ok('N8 注释已改为与真实顺序一致',
    h.readSource('cloudfunctions/submit/index.js').indexOf('形状不符会在 validateBody 阶段即返回 INVALID_FIELD') !== -1);

  console.log('');
  console.log('---- 汇总 ----');
  console.log('PASS ' + pass + ' / FAIL ' + failCount);
  if (failCount > 0) {
    console.log('失败用例：');
    failures.forEach(function (f) { console.log(' - ' + f); });
    process.exitCode = 1;
  } else {
    console.log('RESULT: OK（本地模拟，未验证云端真实行为）');
  }
}

main().catch(function (err) {
  console.error('测试脚本自身异常：', err && err.stack || err);
  process.exitCode = 1;
});
