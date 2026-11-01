/* 客户端契约静态测试：投稿页 / 审核页 ↔ submit / review 云函数
 *
 * 只做源码级静态核对，不连云端、不写文件、不依赖开发者工具。
 * 覆盖：事件处理器占位、调用名、动作名、错误码文案覆盖、限额一致性、入口与分享约束。
 *
 * 运行：node tools/test_ugc_client_contract.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let pass = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log('\n== ' + name + ' ==');
}

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('  PASS ' + name);
  } else {
    failures.push((currentSection ? currentSection + ' / ' : '') + name + (detail ? ' :: ' + detail : ''));
    console.log('  FAIL ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

/* ---------- 解析工具 ---------- */

function wxmlHandlers(src) {
  const out = [];
  const re = /bind(?:tap|input|change|blur|confirm|submit)="([A-Za-z0-9_]+)"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return uniq(out);
}

function jsHasFunction(src, name) {
  return new RegExp('(^|[\\s{,])' + name + '\\s*\\(').test(src);
}

function extractList(src, constName) {
  const re = new RegExp('const ' + constName + ' = Object\\.freeze\\(\\[([^\\]]*)\\]\\)');
  const m = src.match(re);
  if (!m) return null;
  return m[1].split(',').map(function (s) { return s.trim().replace(/^'|'$/g, ''); }).filter(Boolean);
}

function extractFailCodes(src) {
  const out = [];
  const re = /fail\('([A-Z_]+)'/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return uniq(out);
}

function extractNumber(src, key) {
  const m = src.match(new RegExp(key + ':\\s*(\\d+)'));
  return m ? Number(m[1]) : null;
}

/* ---------- 数据源 ---------- */

const ugc = require(path.join(ROOT, 'config/ugc.js'));
const submitFn = read('cloudfunctions/submit/index.js');
const reviewFn = read('cloudfunctions/review/index.js');
const submitJs = read('pages/submit/submit.js');
const submitWxml = read('pages/submit/submit.wxml');
const reviewJs = read('pages/review/review.js');
const reviewWxml = read('pages/review/review.wxml');
const appJson = JSON.parse(read('app.json'));

/* ---------- A. 投稿页 ↔ submit ---------- */
section('A. 投稿页 ↔ submit 契约');

const submitHandlers = wxmlHandlers(submitWxml);
submitHandlers.forEach(function (h) {
  ok('A. handler 存在: ' + h, jsHasFunction(submitJs, h));
});

eq('A. 调用名取自 config.ugc.FUNCTIONS.SUBMIT', ugc.FUNCTIONS.SUBMIT, 'submit');
ok('A. 页面使用 FUNCTIONS.SUBMIT 调用', /ugc\.FUNCTIONS\.SUBMIT/.test(submitJs));
ok('A. 页面发送 action=submit', /action:\s*'submit'/.test(submitJs));
ok('A. 页面发送 clientToken', /clientToken/.test(submitJs));
ok('A. 页面发送 target 三个键', /target:\s*\{\s*shopId:\s*shopId,\s*stallId:\s*stallId,\s*dishId:\s*dishId\s*\|\|\s*null\s*\}/.test(submitJs));
ok('A. 页面发送 payload', /payload:\s*payload/.test(submitJs));

/* 保留字段：页面源码不得出现这些服务端字段赋值 */
const reserved = ['status', 'review', 'reviewerOpenid', 'verifyStatus', 'verifiedAt',
  'importEligibility', 'dataClass', 'submitter', 'dedupe', 'security',
  'createdAt', 'updatedAt', 'rev', 'openid', 'openId', 'role', 'isAdmin',
  'schemaVersion', 'reopenOf', '_id', '_openid', 'updatedBy'];
reserved.forEach(function (k) {
  const re = new RegExp('(^|[^A-Za-z0-9_.])' + k + '\\s*:');
  ok('A. 无保留字段: ' + k, !re.test(submitJs));
});

/* clientToken 形状：32 位十六进制生成 + 服务端正则 */
ok('A. 客户端生成 32 位十六进制 token', /i\s*<\s*32;/.test(submitJs) && /toString\(16\)/.test(submitJs));
ok('A. 服务端校验 clientToken 形状', /CLIENT_TOKEN_RE\s*=\s*\/\^\[0-9a-f\]\{32\}\$\//.test(submitFn));

/* 限额一致性 */
const srvNoteMax = extractNumber(submitFn, 'NOTE_MAX');
const srvNameMax = extractNumber(submitFn, 'NAME_MAX');
const cliNoteMax = extractNumber(submitJs, 'NOTE_MAX');
const cliNameMax = extractNumber(submitJs, 'NAME_MAX');
eq('A. note 上限一致', cliNoteMax, srvNoteMax);
eq('A. name 上限一致', cliNameMax, srvNameMax);
const maxlength = (submitWxml.match(/maxlength="(\d+)"/) || [])[1];
eq('A. textarea maxlength 与 NOTE_MAX 一致', Number(maxlength), srvNoteMax);

/* 价格规则：最多一位小数 */
ok('A. 客户端价格规则为最多一位小数', /\\d\+\(\\.\\d\)\?/.test(submitJs));
ok('A. 服务端校验价格小数位', /decimals|小数位|PRICE_DECIMALS/.test(submitFn));

/* 错误分支 */
ok('A. 处理 RATE_LIMITED retryAfter', /RATE_LIMITED/.test(submitJs) && /retryAfter/.test(submitJs));
ok('A. 处理 DUPLICATE', /DUPLICATE/.test(submitJs));
ok('A. 处理 LOG_FAILED 且提示勿重复提交', /LOG_FAILED/.test(submitJs) && /勿重复提交/.test(submitJs));
ok('A. 区分 securityState risk/review', /securityState/.test(submitJs) && /risk/.test(submitJs) && /review/.test(submitJs));
ok('A. 无 wx.setStorage/setStorageSync 调用', !/wx\.setStorage|wx\.setStorageSync/.test(submitJs));

/* 入口参数与演示数据边界 */
ok('A. onLoad 校验链接参数形状', /okShop/.test(submitJs) && /okStall/.test(submitJs) && /okDish/.test(submitJs));
ok('A. 坏参数丢弃并提示', /bad|链接里的菜品编号不正确|okShop \|\|/.test(submitJs));
ok('A. 演示数据给出明确提示而非格式错误', /演示数据，暂不支持纠错/.test(submitJs));
ok('A. 演示编号正则存在', /DEMO_SHOP_RE/.test(submitJs) && /DEMO_STALL_RE/.test(submitJs) && /DEMO_DISH_RE/.test(submitJs));

/* ---------- B. 审核页 ↔ review ---------- */
section('B. 审核页 ↔ review 契约');

wxmlHandlers(reviewWxml).forEach(function (h) {
  ok('B. handler 存在: ' + h, jsHasFunction(reviewJs, h));
});

const reviewActions = extractList(reviewFn, 'ACTIONS') || [];
const pageCalls = uniq((reviewJs.match(/call\('([a-z]+)'/g) || []).map(function (s) {
  return s.replace(/call\('/, '').replace(/'$/, '');
}));
pageCalls.forEach(function (a) {
  ok('B. 动作在服务端白名单: ' + a, reviewActions.indexOf(a) !== -1);
});
ok('B. 页面先调 session 再 list', reviewJs.indexOf("call('session')") !== -1 && reviewJs.indexOf("call('list')") !== -1);
ok('B. approve 携带 expectedRev', /approve'[\s\S]{0,120}expectedRev:\s*rev/.test(reviewJs));
ok('B. reject 携带 expectedRev 与 reasonCode', /reject'[\s\S]{0,200}expectedRev:\s*rev[\s\S]{0,200}reasonCode:/.test(reviewJs));

const reasons = extractList(reviewFn, 'REASON_CODES') || [];
const usedReason = (reviewJs.match(/reasonCode:\s*'([a-z_]+)'/) || [])[1];
ok('B. 页面使用的驳回原因在服务端白名单: ' + usedReason, reasons.indexOf(usedReason) !== -1);
ok('B. STATE_CONFLICT 后自动刷新', /STATE_CONFLICT/.test(reviewJs) && /res\.code === 'STATE_CONFLICT'/.test(reviewJs));
ok('B. SECURITY_UNAVAILABLE 提示不能通过', /SECURITY_UNAVAILABLE/.test(reviewJs) && /不能通过/.test(reviewJs));
ok('B. 审核页未定义 onShareAppMessage', !/\n\s*onShareAppMessage\s*\(/.test(reviewJs));
ok('B. 审核页不写 storage', !/setStorage|getStorage/.test(reviewJs));

/* ---------- C. 入口与注册 ---------- */
section('C. 页面注册与入口边界');

ok('C. submit 页已在 app.json 注册', appJson.pages.indexOf('pages/submit/submit') !== -1);
ok('C. review 页已在 app.json 注册', appJson.pages.indexOf('pages/review/review') !== -1);
const tabBar = (appJson.tabBar && appJson.tabBar.list) || [];
const tabText = JSON.stringify(tabBar);
ok('C. 审核页不在 tabBar', tabText.indexOf('review') === -1);
ok('C. 投稿页不在 tabBar', tabText.indexOf('submit') === -1);
ok('C. 审核页无分享（wxml 无 button open-type=share）', !/open-type="share"/.test(reviewWxml));

/* 入口事实：首页菜品卡片 → /pages/submit/submit，参数经 encodeURIComponent；
   审核页仍为零入口（不进导航、不进 tabBar）。 */
const indexJs = read('pages/index/index.js');
const indexWxml = read('pages/index/index.wxml');

ok('C. 首页存在投稿入口 navigateTo', /navigateTo\(\{[\s\S]{0,120}\/pages\/submit\/submit/.test(indexJs));
ok('C. 入口带 shopId/stallId 参数', /shopId=' \+ encodeURIComponent\(shopId\)/.test(indexJs) && /stallId=' \+ encodeURIComponent\(stallId\)/.test(indexJs));
ok('C. 入口可选带 dishId', /if \(dishId\) query\.push\('dishId=' \+ encodeURIComponent\(dishId\)\)/.test(indexJs));
ok('C. 入口前校验 shopId 与 stallId', /if \(!shopId \|\| !stallId\)/.test(indexJs));
ok('C. 卡片暴露真实编号 data 属性', /data-shop-id="\{\{dish\.shopId\}\}"/.test(indexWxml) && /data-stall-id="\{\{dish\.stallId\}\}"/.test(indexWxml) && /data-dish-id="\{\{dish\.id\}\}"/.test(indexWxml));
ok('C. 卡片绑定 onSubmitDish', /bindtap="onSubmitDish"/.test(indexWxml) && /onSubmitDish\s*\(/.test(indexJs));

const reviewNav = (reviewJs.match(/navigateTo\(/g) || []).length;
eq('C. 审核页仍为零入口（navigateTo=0）', reviewNav, 0);

/* ---------- D. 错误码文案覆盖 ---------- */
section('D. 错误码文案覆盖');

const serverCodes = uniq(extractFailCodes(submitFn).concat(extractFailCodes(reviewFn)));
serverCodes.forEach(function (code) {
  ok('D. 有中文文案: ' + code, Object.prototype.hasOwnProperty.call(ugc.ERROR_TEXT, code));
});
ok('D. textOf 回退存在', /操作失败/.test(ugc.textOf('__UNKNOWN__')));

/* ---------- 汇总 ---------- */
console.log('\n----------------------------------------');
console.log('PASS ' + pass + ' / FAIL ' + failures.length + ' / TOTAL ' + (pass + failures.length));
if (failures.length) {
  console.log('FAILURES:');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('RESULT: FAIL');
  process.exitCode = 1;
} else {
  console.log('RESULT: OK');
  process.exitCode = 0;
}
