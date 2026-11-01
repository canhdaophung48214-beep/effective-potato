/**
 * 本地模拟测试：cloudfunctions/review（管理员审核）
 *
 * 结论口径：本文件里的“通过”只代表**本地模拟**行为符合契约；
 * 不代表云端集合权限、管理员名单、审计日志或部署已经验证。
 *
 * 运行：node tools/test_ugc_review.js
 */
'use strict';

const { createHarness } = require('./ugc_fake_cloud');

const h = createHarness();
const SALT = 'test_salt_for_local_ugc_review';
const ADMIN = 'fake_admin_001';
const ADMIN2 = 'fake_admin_002';
const USER = 'fake_user_001';

process.env.UGC_LOG_SALT = SALT;
process.env.ADMIN_OPENIDS = ADMIN + ',' + ADMIN2;

const fn = h.loadFunction('cloudfunctions/review/index.js');
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

function prepare(openid) {
  h.reset();
  h.setOpenid(openid === undefined ? ADMIN : openid);
  process.env.ADMIN_OPENIDS = ADMIN + ',' + ADMIN2;
  process.env.UGC_LOG_SALT = SALT;
}

function seedSubmission(over) {
  const doc = Object.assign({
    _id: 'sub_1',
    kind: 'price_fix',
    target: { shopId: 'c02', stallId: 'c02_t02', dishId: 'c02_d060' },
    payload: { price: 12, nameSuggestion: null, note: '价目表显示 12 元' },
    photos: [],
    security: { state: 'pass', labels: [], provider: 'msg_sec_check', version: 2, attempts: 1, latencyMs: 30, skipped: false },
    status: 'pending',
    review: null,
    submitter: { openid: USER },
    dedupe: { key: 'c02_d060|价目表显示 12 元|12', dupOf: null },
    dataClass: 'user_submission',
    verifyStatus: 'unverified',
    verifiedAt: null,
    importEligibility: 'blocked',
    reopenOf: null,
    createdAt: new Date(Date.now() - 120000),
    updatedAt: new Date(Date.now() - 120000),
    rev: 1
  }, over || {});
  h.seed('submissions', doc);
  return doc;
}

function docById(id) {
  return h.docs('submissions').filter(function (d) { return d._id === id; })[0];
}

async function main() {
  console.log('== A. 静态边界（源码扫描） ==');
  const src = h.readSource('cloudfunctions/review/index.js');
  ok('A1 只声明两个集合', /SUBMISSIONS: 'submissions'/.test(src) && /LOGS: 'upload_logs'/.test(src));
  const collectionArgs = (src.match(/db\.collection\([^)]*\)/g) || []).map(function (s) {
    return s.replace(/^db\.collection\(/, '').replace(/\)$/, '').trim();
  });
  ok('A2 只按冻结常量访问两个集合', collectionArgs.length > 0 && collectionArgs.every(function (a) {
    return /^COL\.(SUBMISSIONS|LOGS)$/.test(a);
  }));
  ok('A2b 只依赖 crypto 与 wx-server-sdk', (src.match(/require\('[^']+'\)/g) || []).every(function (s) {
    return s === "require('crypto')" || s === "require('wx-server-sdk')";
  }));
  ok('A2c 不读写生成器产物或冻结映射', !/records\.json|records_blockers|gen-manifest|id-map|ID_MAP/.test(src.split('*/').slice(1).join('*/')));
  ok('A3 不读取客户端身份字段', !/event\.(openid|openId|role|isAdmin|reviewerOpenid)/.test(src));
  ok('A4 不写 verified 状态', !/verifyStatus:\s*'verified'/.test(src));
  ok('A5 日志只 add（源码内仅一处 collection(COL.LOGS)）', (src.match(/collection\(COL\.LOGS\)/g) || []).length === 1);
  ok('A6 无 collection(COL.LOGS) 上的 update/remove', !/collection\(COL\.LOGS\)[\s\S]{0,80}(\.update\(|\.remove\()/.test(src));

  /* 路由与索引配置：只断言“配置没有把审核页暴露成可索引/可点进”，
     搜索索引排除不等于访问控制（访问控制见 B 段）。 */
  const fs = require('fs');
  const appJson = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  const sitemap = JSON.parse(fs.readFileSync('sitemap.json', 'utf8'));
  ok('A7 app.json 注册了投稿页与审核页', appJson.pages.indexOf('pages/submit/submit') !== -1 && appJson.pages.indexOf('pages/review/review') !== -1);
  const tabPages = (appJson.tabBar && appJson.tabBar.list ? appJson.tabBar.list : []).map(function (t) { return t.pagePath; });
  ok('A8 tabBar 不含审核页与投稿页', tabPages.indexOf('pages/review/review') === -1 && tabPages.indexOf('pages/submit/submit') === -1);
  const rules = sitemap.rules || [];
  const reviewIdx = rules.findIndex(function (r) { return r.page === 'pages/review/review' && r.action === 'disallow'; });
  const submitIdx = rules.findIndex(function (r) { return r.page === 'pages/submit/submit' && r.action === 'disallow'; });
  const allowAllIdx = rules.findIndex(function (r) { return r.action === 'allow' && r.page === '*'; });
  ok('A9 sitemap 显式 disallow 审核页', reviewIdx !== -1);
  ok('A10 disallow 规则位于 allow * 之前', reviewIdx !== -1 && allowAllIdx !== -1 && reviewIdx < allowAllIdx);
  ok('A11 sitemap 也排除投稿页', submitIdx !== -1 && allowAllIdx !== -1 && submitIdx < allowAllIdx);
  ok('A12 sitemap 无命中审核页的 allow 规则', !rules.some(function (r) {
    return r.action === 'allow' && typeof r.page === 'string' && /review/.test(r.page);
  }));

  const reviewPage = h.readSource('pages/review/review.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  ok('A13 审核页不缓存身份/列表', !/setStorage|getStorage/.test(reviewPage));
  ok('A14 审核页不本地判定管理员', !/isAdmin|role\s*[:=]\s*['"]admin['"]/.test(reviewPage));
  ok('A15 审核页无分享入口', !/onShareAppMessage|onShareTimeline/.test(reviewPage));

  console.log('== B. 鉴权闸门（fail-closed） ==');
  prepare();
  delete process.env.ADMIN_OPENIDS;
  let r = await fn.main({ action: 'list' }, {});
  eq('B1 未配置管理员时拒绝', r.code, 'FORBIDDEN');
  eq('B1b 拒绝原因可审计', r.reason, 'ADMIN_OPENIDS_NOT_CONFIGURED');
  eq('B1c 拒绝时零数据库调用', h.calls('submissions').length, 0);
  prepare('fake_other_001');
  r = await fn.main({ action: 'list' }, {});
  eq('B2 非管理员拒绝', r.code, 'FORBIDDEN');
  eq('B2b 非管理员原因', r.reason, 'NOT_ADMIN');
  eq('B2c 非管理员零数据库调用', h.calls('submissions').length, 0);
  prepare('');
  r = await fn.main({ action: 'list' }, {});
  eq('B3 空 openid 拒绝', r.reason, 'NO_OPENID');
  prepare('fake_other_001');
  r = await fn.main({ action: 'approve', submissionId: 'x', expectedRev: 1 }, {});
  eq('B4 普通用户改状态被拒（403 而非动作错误）', r.code, 'FORBIDDEN');
  prepare();
  const parsed = T.parseAdminOpenIds(' a1, a2; a1\n a3 ，a4 ');
  eq('B5 管理员名单解析去重', parsed.length, 4);
  ok('B6 解析保留顺序', parsed[0] === 'a1' && parsed[1] === 'a2' && parsed[2] === 'a3' && parsed[3] === 'a4');

  console.log('== C. 动作白名单与 session ==');
  prepare();
  r = await fn.main({ action: 'hack' }, {});
  eq('C1 管理员未知动作拒绝', r.code, 'INVALID_ACTION');
  r = await fn.main({ action: 'session' }, {});
  eq('C2 管理员 session 通过', r.ok, true);
  eq('C3 session 返回角色', r.role, 'admin');
  eq('C4 session 不读数据库', h.calls('submissions').length, 0);

  console.log('== D. 队列与详情 ==');
  prepare();
  for (let i = 0; i < 25; i++) {
    seedSubmission({
      _id: 'p_' + i,
      createdAt: new Date(Date.now() - 100000 + i * 10)
    });
  }
  h.seed('submissions', { _id: 'appr', status: 'approved', rev: 2, submitter: { openid: USER }, createdAt: new Date() });
  r = await fn.main({ action: 'list' }, {});
  eq('D1 list 成功', r.ok, true);
  eq('D2 只返回 pending', r.items.every(function (it) { return true; }), true);
  eq('D3 最多 20 条', r.items.length, 20);
  ok('D4 按 createdAt 升序', (function () {
    for (let i = 1; i < r.items.length; i++) {
      if (new Date(r.items[i].createdAt) < new Date(r.items[i - 1].createdAt)) return false;
    }
    return true;
  })());
  ok('D5 列表不含 submitter/openid', r.items.every(function (it) {
    return it.submitter === undefined && JSON.stringify(it).indexOf(USER) === -1;
  }));

  prepare();
  seedSubmission();
  r = await fn.main({ action: 'detail', submissionId: 'sub_1' }, {});
  eq('D6 管理员可查看任意投稿', r.ok, true);
  eq('D7 detail 返回 submissionId', r.item.submissionId, 'sub_1');
  r = await fn.main({ action: 'detail' }, {});
  eq('D8 缺 id 拒绝', r.code, 'INVALID_FIELD');
  r = await fn.main({ action: 'detail', submissionId: 'nope' }, {});
  eq('D9 不存在统一 404', r.code, 'NOT_FOUND');

  console.log('== E. approve 状态迁移 ==');
  prepare();
  seedSubmission();
  r = await fn.main({ action: 'approve', submissionId: 'sub_1' }, {});
  eq('E1 缺 expectedRev 拒绝', r.code, 'INVALID_FIELD');
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 9 }, {});
  eq('E2 rev 不一致拒绝', r.code, 'STATE_CONFLICT');
  prepare();
  seedSubmission({ security: { state: 'error' } });
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('E3 内容安全故障不许通过', r.code, 'SECURITY_UNAVAILABLE');
  eq('E3b 返回具体安全状态', r.securityState, 'error');
  prepare();
  seedSubmission({ security: { state: 'risk' } });
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('E4 明确风险不许通过', r.code, 'SECURITY_UNAVAILABLE');
  prepare();
  seedSubmission({ security: { state: 'review', labels: [20001] } });
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('E5 需复核允许通过', r.ok, true);
  eq('E5b rev 递增', r.rev, 2);

  prepare();
  seedSubmission();
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('E6 正常通过', r.ok, true);
  eq('E7 状态为 approved', r.status, 'approved');
  const d6 = docById('sub_1');
  eq('E8 落库状态 approved', d6.status, 'approved');
  eq('E9 review.decision', d6.review.decision, 'approve');
  ok('E10 管理员身份只存摘要', d6.review.byOpenidHash.length === 32 && d6.review.byOpenidHash !== ADMIN);
  eq('E11 通过不改 verifyStatus', d6.verifyStatus, 'unverified');
  eq('E12 通过不改 importEligibility', d6.importEligibility, 'blocked');
  eq('E13 通过不写菜品库', h.calls('dishes').length, 0);
  ok('E14 审计日志 event=review_approve', h.docs('upload_logs').some(function (l) { return l.event === 'review_approve'; }));
  ok('E15 审计日志角色 admin', h.docs('upload_logs').every(function (l) { return l.actor.role === 'admin'; }));
  ok('E16 审计日志无 openid 明文', JSON.stringify(h.docs('upload_logs')).indexOf(ADMIN) === -1);
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 2 }, {});
  eq('E17 重复通过被拒', r.code, 'STATE_CONFLICT');

  prepare();
  seedSubmission();
  h.setForceUpdateZero(true);
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('E18 并发更新 0 行视为冲突', r.code, 'STATE_CONFLICT');

  console.log('== F. reject ==');
  prepare();
  seedSubmission();
  r = await fn.main({ action: 'reject', submissionId: 'sub_1', expectedRev: 1, reasonCode: 'bogus' }, {});
  eq('F1 非法理由码拒绝', r.code, 'INVALID_FIELD');
  r = await fn.main({ action: 'reject', submissionId: 'sub_1', expectedRev: 1, reasonCode: 'expired' }, {});
  eq('F1b 人工 reject 不可冒充系统 expire', r.code, 'INVALID_FIELD');
  r = await fn.main({ action: 'expire', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('F1c 人工接口没有 expire 动作', r.code, 'INVALID_ACTION');
  r = await fn.main({ action: 'reject', submissionId: 'sub_1', expectedRev: 1, reasonCode: 'inaccurate', reasonText: '字'.repeat(101) }, {});
  eq('F2 理由超 100 字拒绝', r.code, 'INVALID_FIELD');
  r = await fn.main({ action: 'reject', submissionId: 'sub_1', expectedRev: 1, reasonCode: 'inaccurate', reasonText: '  价格  不符  ' }, {});
  eq('F3 正常驳回', r.ok, true);
  const dF = docById('sub_1');
  eq('F4 落库 rejected', dF.status, 'rejected');
  eq('F5 理由码落库', dF.review.reasonCode, 'inaccurate');
  eq('F6 理由文本归一', dF.review.reasonText, '价格 不符');
  ok('F7 审计日志带理由码', h.docs('upload_logs').some(function (l) {
    return l.event === 'review_reject' && l.errorCode === 'inaccurate';
  }));

  console.log('== G. delete（用户数据删除请求） ==');
  prepare();
  r = await fn.main({ action: 'delete', submissionId: 'nope' }, {});
  eq('G1 不存在返回 404', r.code, 'NOT_FOUND');
  seedSubmission();
  r = await fn.main({ action: 'delete', submissionId: 'sub_1' }, {});
  eq('G2 删除成功', r.ok, true);
  const dG = docById('sub_1');
  eq('G3 正文被清空', dG.payload, null);
  eq('G4 身份被匿名化', dG.submitter.openid, 'deleted');
  eq('G5 状态置 rejected', dG.status, 'rejected');
  eq('G6 理由码 user_deleted', dG.review.reasonCode, 'user_deleted');
  ok('G7 审计日志 event=delete_request', h.docs('upload_logs').some(function (l) { return l.event === 'delete_request'; }));
  r = await fn.main({ action: 'delete', submissionId: 'sub_1' }, {});
  eq('G8 重复删除幂等', r.idempotent, true);

  console.log('== H. 日志失败与实际状态一致性 ==');
  prepare();
  seedSubmission();
  h.setFail({ collection: 'upload_logs', op: 'add' });
  r = await fn.main({ action: 'approve', submissionId: 'sub_1', expectedRev: 1 }, {});
  eq('H1 日志失败返回 LOG_FAILED', r.code, 'LOG_FAILED');
  eq('H2 明确告知状态已变更', r.logged, false);
  eq('H3 返回真实新状态', r.status, 'approved');
  eq('H4 记录确实已变更', docById('sub_1').status, 'approved');
  ok('H5 尝试写 alarm 行', h.calls('upload_logs').filter(function (op) { return op === 'add'; }).length >= 2);
  h.clearFail();

  console.log('== I. 只追加与副作用 ==');
  ok('I1 全程无 remove 调用', h.removeCalls() === 0);
  ok('I2 upload_logs 无 update/remove', h.calls('upload_logs').every(function (op) {
    return op === 'add';
  }));
  eq('I3 审核不写菜品库', h.calls('dishes').length, 0);
  ok('I4 审计日志含 schemaVersion/event/day', h.docs('upload_logs').every(function (l) {
    return l.schemaVersion === 1 && typeof l.event === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.day);
  }));

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
