/* ================================================================
   阶段 2 专项测试：数据可信度体系（provenance）
   ----------------------------------------------------------------
   用法：node tools/verify_provenance.js
   检查范围：
     G1 字段完整性（45 菜 / 12 店 / 9 楼层 / 24 窗口）
     G2 标记规则（当前全部 demo、无伪造时间）
     G3 关联透传（菜品 → 店铺 / 楼层 / 窗口四层合成）
     G4 最弱一环合成（含过期优先）
     G5 边界用例（verified 缺时间、非法状态、无来源、demo 带时间）
     G6 状态统计与摘要一致性
     G7 页面绑定（WXML / WXSS / index.js）
     G8 回归护栏（筛选、排序不受可信度字段影响）
   ================================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const P = function (rel) { return path.join(ROOT, rel); };

const {
  VERIFY_STATUS,
  VERIFY_LABEL,
  VERIFY_CLASS,
  SOURCE_KIND,
  SOURCE_KIND_LABEL,
  DEMO_SOURCE,
  normalizeMeta,
  decorate,
  weakest,
  makeSource,
  countByStatus,
  isValidDateString,
  todayString,
  attachDemo
} = require(P('data/provenance'));

/* STATUS_VALUES 是模块内部常量，不对外导出；测试自己从 VERIFY_STATUS 推导同一份白名单 */
const STATUS_VALUES = Object.keys(VERIFY_STATUS).map(function (k) { return VERIFY_STATUS[k]; });

const {
  ALL_DISHES,
  ALL_SHOPS,
  DATA_STATUS_SUMMARY
} = require(P('data/index'));

/* 固定基准日：所有与日期相关的用例都以它为「今天」，结果不随运行日期漂移 */
const TODAY = '2026-10-20';
const OPTS = { today: TODAY };

const { filterDishes, applySort } = require(P('utils/matcher'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  OK   ' + name);
  } else {
    fail++;
    const line = name + (extra ? '  → ' + extra : '');
    failures.push(line);
    console.log('  FAIL ' + name + (extra ? '  → ' + extra : ''));
  }
}

function section(title) {
  console.log('\n' + title);
}

/* ================================================================
   G1 字段完整性
   ================================================================ */
section('G1 字段完整性');

/* 从原始数据出发，逐层收集需要检查的记录 */
const rawShops = require(P('data/shops')).SHOPS;
const rawDishes = require(P('data/dishes')).DISHES;

const shopRecords = [];
const floorRecords = [];
const stallRecords = [];

rawShops.forEach(function (shop) {
  shopRecords.push({ level: 'shop', id: shop.id, rec: shop });
  (shop.floors || []).forEach(function (f) {
    floorRecords.push({ level: 'floor', id: f.id, rec: f });
  });
  (shop.stalls || []).forEach(function (t) {
    stallRecords.push({ level: 'stall', id: t.id, rec: t });
  });
});

const dishRecords = rawDishes.map(function (d) { return { level: 'dish', id: d.id, rec: d }; });

ok('原始店铺 12 家', shopRecords.length === 12, '实际 ' + shopRecords.length);
ok('原始窗口 24 个', stallRecords.length === 24, '实际 ' + stallRecords.length);
ok('原始楼层 7 个（5 家店有楼层：2+1+2+1+1）', floorRecords.length === 7, '实际 ' + floorRecords.length);
ok('原始菜品 45 道', dishRecords.length === 45, '实际 ' + dishRecords.length);

const allRecords = dishRecords.concat(shopRecords, floorRecords, stallRecords);

/* 每个层级都要有这套字段，缺一不可 */
function checkMetaShape(list, label) {
  const bad = list.filter(function (item) {
    const r = item.rec;
    return !(r.source && typeof r.source === 'object') ||
      typeof r.source.kind !== 'string' ||
      typeof r.source.detail !== 'string' ||
      Object.prototype.hasOwnProperty.call(r, 'verifiedAt') === false ||
      STATUS_VALUES.indexOf(r.verifyStatus) === -1;
  });
  ok(label + ' 全部具备 source / verifyStatus / verifiedAt', bad.length === 0,
    bad.length ? '缺字段: ' + bad.slice(0, 3).map(function (b) { return b.id; }).join(',') : list.length + ' 条');
}

checkMetaShape(dishRecords, '菜品');
checkMetaShape(shopRecords, '店铺');
checkMetaShape(floorRecords, '楼层');
checkMetaShape(stallRecords, '窗口');

/* source.kind 必须在白名单里 */
const validKinds = Object.keys(SOURCE_KIND).map(function (k) { return SOURCE_KIND[k]; });
const badKind = allRecords.filter(function (item) {
  return validKinds.indexOf(item.rec.source.kind) === -1;
});
ok('source.kind 全部是白名单值', badKind.length === 0,
  badKind.length ? badKind[0].id + '=' + badKind[0].rec.source.kind : validKinds.length + ' 种合法来源');

/* source.detail 不能为空 —— 只有类型没有说明等于没来源 */
const emptyDetail = allRecords.filter(function (item) {
  return !item.rec.source.detail || !item.rec.source.detail.trim();
});
ok('source.detail 没有空说明', emptyDetail.length === 0,
  emptyDetail.length ? '空说明: ' + emptyDetail[0].id : allRecords.length + ' 条都有说明');

/* 楼层 / 窗口带 parentShopId 便于反查 */
const orphanFloor = floorRecords.filter(function (f) { return !f.rec.shopId; });
const orphanStall = stallRecords.filter(function (t) { return !t.rec.shopId; });
ok('楼层都记录了所属店铺', orphanFloor.length === 0, '缺 ' + orphanFloor.length);
ok('窗口都记录了所属店铺', orphanStall.length === 0, '缺 ' + orphanStall.length);

/* ================================================================
   G2 标记规则
   ================================================================ */
section('G2 标记规则');

const notDemo = allRecords.filter(function (item) { return item.rec.verifyStatus !== 'demo'; });
ok('现有 88 条记录全部标记为 demo（45 菜 + 12 店 + 7 楼层 + 24 窗口）',
  notDemo.length === 0 && allRecords.length === 88,
  notDemo.length ? '非 demo: ' + notDemo.slice(0, 3).map(function (x) { return x.id; }).join(',') : allRecords.length + ' 条全 demo');

const fakeTime = allRecords.filter(function (item) { return item.rec.verifiedAt !== null; });
ok('没有任何伪造的核实时间（demo 的 verifiedAt 一律 null）', fakeTime.length === 0,
  fakeTime.length ? '有时间的: ' + fakeTime[0].id + '=' + fakeTime[0].rec.verifiedAt : '全部 null');

/* 来源必须指向「演示」，不能出现声称真实的来源 */
const demoSource = allRecords.filter(function (item) { return item.rec.source.kind !== SOURCE_KIND.DEMO; });
ok('全部来源类型为 demo（没有声称真实的来源）', demoSource.length === 0,
  demoSource.length ? '异常: ' + demoSource[0].id + '=' + demoSource[0].rec.source.kind : '12 店 / 45 菜 / 24 窗口 / 9 楼层一致');

/* verifyText / verifyClass 由状态推导，不能各写各的 */
const labelMismatch = allRecords.filter(function (item) {
  const r = item.rec;
  return r.verifyText !== VERIFY_LABEL[r.verifyStatus] || r.verifyClass !== VERIFY_CLASS[r.verifyStatus];
});
ok('verifyText / verifyClass 与状态一一对应', labelMismatch.length === 0,
  labelMismatch.length ? labelMismatch[0].id : '四种状态映射全部一致');

/* ================================================================
   G3 关联透传：菜品合成四层
   ================================================================ */
section('G3 关联透传（菜品 → 店铺 / 楼层 / 窗口）');

const layerBad = [];
const levelBad = [];

ALL_DISHES.forEach(function (dish) {
  const layers = dish.verifyLayers || [];
  const levels = layers.map(function (l) { return l.level; });

  /* 有楼层的店应有 dish/shop/stall/floor 四层；无楼层的店只有三层 */
  const needFloor = layers.length === 4;
  const needThree = layers.length === 3;
  if (!needFloor && !needThree) levelBad.push(dish.id + '(层数 ' + layers.length + ')');

  if (levels.indexOf('dish') === -1 || levels.indexOf('shop') === -1 || levels.indexOf('stall') === -1) {
    layerBad.push(dish.id);
  }
  if (needFloor && levels.indexOf('floor') === -1) layerBad.push(dish.id + '(缺 floor)');
});

ok('每道菜的合成层都包含 dish / shop / stall', layerBad.length === 0,
  layerBad.length ? layerBad.slice(0, 5).join(',') : '45 道全部包含');
ok('层数为 3（无楼层店）或 4（有楼层店）', levelBad.length === 0,
  levelBad.length ? levelBad.join(',') : '45 道全部合规');

/* 楼层数量应与店铺数据一致：5 家有楼层 → 对应菜品应为 4 层 */
const shopsWithFloor = rawShops.filter(function (s) { return (s.floors || []).length > 0; }).map(function (s) { return s.id; });
const fourLayer = ALL_DISHES.filter(function (d) { return d.verifyLayers.length === 4; });
const threeLayer = ALL_DISHES.filter(function (d) { return d.verifyLayers.length === 3; });
ok('有楼层店铺的菜品是 4 层，无楼层店铺的菜品是 3 层',
  fourLayer.every(function (d) { return shopsWithFloor.indexOf(d.shopId) > -1; }) &&
  threeLayer.every(function (d) { return shopsWithFloor.indexOf(d.shopId) === -1; }),
  '4 层 ' + fourLayer.length + ' 道 / 3 层 ' + threeLayer.length + ' 道');

/* 透传字段必须真的到页面层 */
const missingPassthrough = ALL_DISHES.filter(function (d) {
  return !d.verifyStatus || !d.verifyText || !d.verifyClass || !d.sourceKindText;
});
ok('菜品卡可直接用的状态字段已透传', missingPassthrough.length === 0,
  missingPassthrough.length ? missingPassthrough[0].id : '45 道齐全');

const missingShopPass = ALL_SHOPS.filter(function (s) {
  return !s.verifyStatus || !s.verifyText || !s.verifyClass || !s.sourceDetail;
});
ok('店铺卡可直接用的状态字段已透传', missingShopPass.length === 0,
  missingShopPass.length ? missingShopPass[0].id : '12 家齐全');

/* 每层都带上自己的 id 与状态，便于「哪一层不可信」回溯 */
const layerNoId = [];
ALL_DISHES.forEach(function (dish) {
  dish.verifyLayers.forEach(function (l) {
    if (!l.id || !l.level || !l.status || !l.text) layerNoId.push(dish.id + '/' + l.level);
  });
});
ok('每一层都带 level / id / status / text', layerNoId.length === 0,
  layerNoId.length ? layerNoId.slice(0, 3).join(',') : '可回溯到具体楼层 / 窗口');

/* ================================================================
   G4 最弱一环合成
   ================================================================ */
section('G4 最弱一环合成');

/* weakest(layers) 读的是「装饰后」的记录：需要 verifyStatus / metaLevel / source，
   返回的是 { status, level, id, verifiedAt, source, note } */
function layer(level, status, time, kind) {
  return {
    metaLevel: level,
    id: level + '_x',
    verifyStatus: status,
    verifyText: VERIFY_LABEL[status],
    verifyClass: VERIFY_CLASS[status],
    verifiedAt: time === undefined ? null : time,
    source: makeSource(kind || (status === 'demo' ? SOURCE_KIND.DEMO : SOURCE_KIND.FIELD), '测试用来源', '')
  };
}

ok('全 verified → verified',
  weakest([layer('dish', 'verified', '2026-10-01'), layer('stall', 'verified', '2026-10-01')]).status === 'verified');

ok('菜品 verified + 窗口 unverified → unverified（取最弱）',
  weakest([layer('dish', 'verified', '2026-10-01'), layer('stall', 'unverified')]).status === 'unverified');

ok('菜品 verified + 店铺 demo → demo',
  weakest([layer('dish', 'verified', '2026-10-01'), layer('shop', 'demo')]).status === 'demo');

ok('任一层 expired → 整体 expired（优先级最高）',
  weakest([layer('dish', 'verified', '2026-10-01'), layer('stall', 'verified', '2026-10-01'), layer('shop', 'expired')]).status === 'expired');

{
  const r = weakest([layer('dish', 'verified', '2026-10-01'), layer('stall', 'unverified')]);
  ok('最弱环节不是菜品本身时，note 说明是哪一层拖低的',
    /窗口|楼层|店铺/.test(r.note || ''), r.note || '(空)');
}

{
  const r = weakest([layer('dish', 'verified', '2026-10-01'), layer('stall', 'verified', '2026-10-01')]);
  ok('全部已核实时 note 为空（不给用户多余噪音）', !r.note, r.note || '(空)');
}

/* ================================================================
   G5 边界用例
   ================================================================ */
section('G5 边界用例');

{
  const r = normalizeMeta({ verifyStatus: 'verified' });
  ok('verified 但没有核实时间 → 降级 unverified（不伪造时间）', r.verifyStatus === 'unverified', r.verifyStatus);
  ok('降级后 verifiedAt 仍是 null', r.verifiedAt === null, String(r.verifiedAt));
}

{
  const r = normalizeMeta({
    verifyStatus: 'verified',
    verifiedAt: '2026-10-01',
    source: makeSource(SOURCE_KIND.MERCHANT, '店家当面确认', '')
  }, { today: TODAY });
  ok('verified 且日期合法 → 保留 verified', r.verifyStatus === 'verified', r.verifyStatus);
}

{
  const r = normalizeMeta({ verifyStatus: 'not_a_status' });
  ok('非法状态 → unverified（不因写错字段就变可信）', r.verifyStatus === 'unverified', r.verifyStatus);
}

{
  const r = normalizeMeta({});
  ok('完全没有可信度字段 → unverified', r.verifyStatus === 'unverified', r.verifyStatus);
}

{
  const r = normalizeMeta({ verifyStatus: 'demo', verifiedAt: '2026-10-01' });
  ok('demo 即使写了时间也清空（演示数据不可能「已核实」）', r.verifiedAt === null, String(r.verifiedAt));
}

{
  const r = normalizeMeta({ verifyStatus: 'unverified' });
  ok('来源缺失 → source.kind 为 unknown', r.source.kind === SOURCE_KIND.UNKNOWN, r.source.kind);
}

{
  const r = normalizeMeta({
    verifyStatus: 'expired',
    verifiedAt: '2026-03-01',
    source: makeSource(SOURCE_KIND.FIELD, '上一学期实地看过', '')
  }, { today: TODAY });
  ok('expired 保留最后一次核实时间（用于判断过期多久）', r.verifyStatus === 'expired' && r.verifiedAt === '2026-03-01',
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = decorate(normalizeMeta({ verifyStatus: 'unverified', source: makeSource(SOURCE_KIND.USER, '学生投稿，未审核', '') }), 'dish');
  ok('decorate 输出带 text/class/tip 三件套',
    !!r.verifyText && !!r.verifyClass && !!r.verifyTip, r.verifyText + '/' + r.verifyClass);
  ok('decorate 保留原始 source 对象（供最弱一环使用）', !!r.source && r.source.kind === SOURCE_KIND.USER, r.source && r.source.kind);
}

{
  const r = decorate(normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2026-10-01' }), 'stall');
  ok('metaLevel 记录层级', r.metaLevel === 'stall', r.metaLevel);
}

/* ================================================================
   G6 统计与摘要一致性
   ================================================================ */
section('G6 状态统计与摘要');

const recountDish = countByStatus(ALL_DISHES);
ok('菜品状态统计与逐条重算一致',
  recountDish.demo === DATA_STATUS_SUMMARY.dish.demo &&
  recountDish.unverified === DATA_STATUS_SUMMARY.dish.unverified &&
  recountDish.verified === DATA_STATUS_SUMMARY.dish.verified &&
  recountDish.expired === DATA_STATUS_SUMMARY.dish.expired,
  JSON.stringify(DATA_STATUS_SUMMARY.dish));

ok('摘要里的菜品总数等于真实菜品数',
  DATA_STATUS_SUMMARY.dishTotal === ALL_DISHES.length, DATA_STATUS_SUMMARY.dishTotal + '/' + ALL_DISHES.length);

ok('摘要里的店铺总数等于真实店铺数',
  DATA_STATUS_SUMMARY.shopTotal === ALL_SHOPS.length, DATA_STATUS_SUMMARY.shopTotal + '/' + ALL_SHOPS.length);

ok('当前 45 道菜全部是 demo', DATA_STATUS_SUMMARY.dish.demo === 45 &&
  DATA_STATUS_SUMMARY.dish.unverified === 0 &&
  DATA_STATUS_SUMMARY.dish.verified === 0 &&
  DATA_STATUS_SUMMARY.dish.expired === 0,
  JSON.stringify(DATA_STATUS_SUMMARY.dish));

ok('当前 12 家店全部是 demo', DATA_STATUS_SUMMARY.shop.demo === 12, JSON.stringify(DATA_STATUS_SUMMARY.shop));

ok('店铺统计与逐条重算一致',
  countByStatus(ALL_SHOPS).demo === DATA_STATUS_SUMMARY.shop.demo, JSON.stringify(DATA_STATUS_SUMMARY.shop));

/* ================================================================
   G7 页面绑定
   ================================================================ */
section('G7 页面绑定');

const wxml = fs.readFileSync(P('pages/index/index.wxml'), 'utf8');
const wxss = fs.readFileSync(P('pages/index/index.wxss'), 'utf8');
const jsText = fs.readFileSync(P('pages/index/index.js'), 'utf8');

ok('菜品卡状态标签绑定 {{dish.verifyClass}}', /class="tag tag-v \{\{dish\.verifyClass\}\}"/.test(wxml));
ok('菜品卡状态文字绑定 {{dish.verifyText}}', /\{\{dish\.verifyText\}\}/.test(wxml));
ok('店铺卡状态标签绑定 {{pickedShop.verifyClass}}', /class="tag tag-v \{\{pickedShop\.verifyClass\}\}"/.test(wxml));
ok('店铺卡展示来源说明 {{pickedShop.sourceDetail}}', /\{\{pickedShop\.sourceDetail\}\}/.test(wxml));
ok('面板展示数据状态一行 {{dataStatusText}}', /\{\{dataStatusText\}\}/.test(wxml));
ok('页面 JS 计算 dataStatusText（不写死数字）', /buildDataStatusText\s*\(/.test(jsText));
ok('页面 JS 从 data/index 取 DATA_STATUS_SUMMARY', /DATA_STATUS_SUMMARY/.test(jsText));
ok('drawShop 透传了 verifyStatus', /verifyStatus:\s*shop\.verifyStatus/.test(jsText));
ok('drawShop 透传了 sourceDetail', /sourceDetail:\s*shop\.sourceDetail/.test(jsText));
ok('四种状态样式都在 wxss 里', ['v-demo', 'v-unverified', 'v-verified', 'v-expired']
  .every(function (c) { return new RegExp('\\.' + c + '\\s*[,{]').test(wxss); }));
ok('已删除旧的一次性标签 .tag-demo', !/\.tag-demo\s*[,{]/.test(wxss));
ok('已删除旧的一次性提示 .shop-demo', !/\.shop-demo\s*[,{]/.test(wxss));
ok('三个原有标签保留（类型 / 区域 / 口味）',
  /tag-type/.test(wxml) && /tag-area/.test(wxml) && /tag-taste/.test(wxml));
ok('页脚全局演示声明保留', /虚构演示数据/.test(wxml));

/* 数据状态文案必须真的来自数据，不能是一句固定话术 */
const expectText = '共 ' + DATA_STATUS_SUMMARY.dishTotal + ' 道菜 · ' + DATA_STATUS_SUMMARY.shopTotal +
  ' 家店：演示信息 ' + DATA_STATUS_SUMMARY.dish.demo + ' 道';
ok('状态文案格式由数据拼接（模板里出现拼接逻辑）',
  /s\.dishTotal/.test(jsText) && /s\.dish\.demo/.test(jsText), expectText);

/* ================================================================
   G8 回归护栏：可信度字段不影响业务
   ================================================================ */
section('G8 回归护栏');

const base = filterDishes(ALL_DISHES, { area: 'campus', budget: '15', taste: 'all', foodType: 'all' });
const stripped = ALL_DISHES.map(function (d) {
  return {
    id: d.id, name: d.name, price: d.price, shopId: d.shopId, stallId: d.stallId,
    floorId: d.floorId, foodType: d.foodType, tastes: d.tastes, area: d.area
  };
});
const strippedResult = filterDishes(stripped, { area: 'campus', budget: '15', taste: 'all', foodType: 'all' });
ok('筛选中途不读取可信度字段（加字段前后结果一致）',
  base.map(function (d) { return d.id; }).join(',') === strippedResult.map(function (d) { return d.id; }).join(','),
  base.length + ' 道');

const noCond = filterDishes(ALL_DISHES, {});
ok('不传条件时返回全部 45 道', noCond.length === 45, noCond.length + ' 道');

const asc = applySort(base, 'priceAsc');
const desc = applySort(base, 'priceDesc');
const ascOk = asc.every(function (d, i) { return i === 0 || asc[i - 1].price <= d.price; });
const descOk = desc.every(function (d, i) { return i === 0 || desc[i - 1].price >= d.price; });
ok('三档排序在带可信度字段的数据上仍然有序', ascOk && descOk, '升序 ' + asc.length + ' / 降序 ' + desc.length);

ok('排序不污染原数组', base.length === asc.length && base !== asc);

/* ================================================================
   G9 反例测试：不合法的可信度声明必须被降级
   ----------------------------------------------------------------
   全部断言实际返回值（verifyStatus / verifiedAt / source.kind），
   不检查源码里有没有某个字符串。
   基准日固定为 TODAY，避免结果随运行日期变化。
   ================================================================ */
section('G9 反例：来源类型校验');

{
  const r = normalizeMeta({
    verifyStatus: 'verified',
    verifiedAt: '2026-10-01',
    source: { kind: 'blog', detail: '某博客文章', ref: 'https://example.com/a' }
  }, OPTS);
  ok('1. 白名单外的 source.kind + verified → 降级 unverified',
    r.verifyStatus === 'unverified', r.verifyStatus);
  ok('1b. 非法来源类型被改成 unknown（不保留为可信来源）',
    r.source.kind === 'unknown', r.source.kind);
  ok('1c. 降级后不保留核实时间', r.verifiedAt === null, String(r.verifiedAt));
}

{
  const r = normalizeMeta({
    verifyStatus: 'verified',
    verifiedAt: '2026-10-01',
    source: makeSource(SOURCE_KIND.UNKNOWN, '不知道从哪来的', '')
  }, OPTS);
  ok('2. unknown 来源 + verified → 降级 unverified', r.verifyStatus === 'unverified', r.verifyStatus);
}

{
  const r = normalizeMeta({
    verifyStatus: 'verified',
    verifiedAt: '2026-10-01',
    source: makeSource(SOURCE_KIND.DEMO, '演示数据', '')
  }, OPTS);
  ok('3. demo 来源 + verified → 强制 demo', r.verifyStatus === 'demo', r.verifyStatus);
  ok('3b. demo 来源的核实时间被清空', r.verifiedAt === null, String(r.verifiedAt));
}

{
  const r = normalizeMeta({
    verifyStatus: 'unverified',
    source: makeSource(SOURCE_KIND.OFFICIAL, '后勤公示', 'https://example.com/notice')
  }, OPTS);
  ok('3c. 只有来源、没有状态声明 → 不会自动升级为 verified', r.verifyStatus === 'unverified', r.verifyStatus);
}

section('G9 反例：核实日期校验');

{
  const r = normalizeMeta({ verifyStatus: 'verified', verifiedAt: 'not-a-date', source: makeSource(SOURCE_KIND.MERCHANT, '店家确认', '') }, OPTS);
  ok('4. verified + verifiedAt: not-a-date → 降级', r.verifyStatus === 'unverified' && r.verifiedAt === null,
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2026-02-30', source: makeSource(SOURCE_KIND.MERCHANT, '店家确认', '') }, OPTS);
  ok('5. verified + 2026-02-30（不存在的日历日）→ 降级', r.verifyStatus === 'unverified' && r.verifiedAt === null,
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2027-01-01', source: makeSource(SOURCE_KIND.MERCHANT, '店家确认', '') }, OPTS);
  ok('6. verified + 未来日期 → 降级', r.verifyStatus === 'unverified' && r.verifiedAt === null,
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = normalizeMeta({ verifyStatus: 'expired', source: makeSource(SOURCE_KIND.FIELD, '上学期看过', '') }, OPTS);
  ok('7. expired + 缺日期 → 降级', r.verifyStatus === 'unverified' && r.verifiedAt === null,
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = normalizeMeta({ verifyStatus: 'expired', verifiedAt: '2026-13-01', source: makeSource(SOURCE_KIND.FIELD, '上学期看过', '') }, OPTS);
  ok('8. expired + 无效日期（13 月）→ 降级', r.verifyStatus === 'unverified' && r.verifiedAt === null,
    r.verifyStatus + '/' + r.verifiedAt);
}

{
  const r = normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2026-10-01', source: makeSource(SOURCE_KIND.WEB, '校园网页面', '') }, OPTS);
  ok('9. web 来源缺少 ref → 降级', r.verifyStatus === 'unverified', r.verifyStatus);
}

{
  const r1 = normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2026-10-01', source: makeSource(SOURCE_KIND.MERCHANT, '', '') }, OPTS);
  const r2 = normalizeMeta({ verifyStatus: 'verified', verifiedAt: '2026-10-01', source: makeSource(SOURCE_KIND.MERCHANT, '   ', '') }, OPTS);
  ok('10. source.detail 为空串 → 降级', r1.verifyStatus === 'unverified', r1.verifyStatus);
  ok('10b. source.detail 全是空白 → 同样降级', r2.verifyStatus === 'unverified', r2.verifyStatus);
}

{
  /* 年份边界：2026 不是闰年，2 月 29 日不存在；2024 是闰年 */
  ok('日期工具：2026-02-29 非法（非闰年）', isValidDateString('2026-02-29', TODAY) === false);
  ok('日期工具：2024-02-29 合法（闰年）', isValidDateString('2024-02-29', TODAY) === true);
  ok('日期工具：2026-04-31 非法（4 月没有 31 日）', isValidDateString('2026-04-31', TODAY) === false);
  ok('日期工具：2026-4-1 格式不合法（必须两位月日）', isValidDateString('2026-4-1', TODAY) === false);
  ok('日期工具：今天本身合法（不算未来）', isValidDateString(TODAY, TODAY) === true);
  ok('日期工具：todayString() 返回 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(todayString()), todayString());
}

section('G9 反例：已有字段的记录仍要校验');

{
  /* 这条记录「已经有 verifyStatus」，旧实现会直接跳过校验原样放行 */
  const input = [{
    id: 'x1',
    verifyStatus: 'verified',
    verifiedAt: 'not-a-date',
    source: { kind: 'blog', detail: '来路不明' }
  }];
  const out = attachDemo(input, 'dish');
  ok('11. attachDemo 不会因为已有 verifyStatus 就跳过校验',
    out[0].verifyStatus === 'unverified', out[0].verifyStatus);
  ok('11b. 降级后派生字段同步更新（verifyText 跟着变）', out[0].verifyText === '待核实', out[0].verifyText);
  ok('11c. 原有的业务字段未被破坏（id 保持）', out[0].id === 'x1', out[0].id);
}

{
  const input = [{ id: 'x2', name: '测试菜', price: 9, verifyStatus: 'verified', verifiedAt: '2026-10-05', source: { kind: 'merchant', detail: '店家当面确认' } }];
  const out = attachDemo(input, 'dish');
  ok('12. 合法的真实来源与合法日期不会被误降级',
    out[0].verifyStatus === 'verified' && out[0].verifiedAt === '2026-10-05', out[0].verifyStatus + '/' + out[0].verifiedAt);
  ok('12b. 业务字段完整保留', out[0].name === '测试菜' && out[0].price === 9, out[0].name + '/' + out[0].price);
  ok('12c. 来源说明被保留', out[0].sourceDetail === '店家当面确认', out[0].sourceDetail);
}

{
  const input = [{ id: 'x3', verifyStatus: 'verified', verifiedAt: '2026-10-01', source: { kind: 'web', detail: '校园网', ref: 'https://example.com/notice' } }];
  const out = attachDemo(input, 'floor');
  ok('12d. web + 有 ref + 有说明 → 保留 verified', out[0].verifyStatus === 'verified' && out[0].verifiedAt === '2026-10-01',
    out[0].verifyStatus + '/' + out[0].verifiedAt);
}

{
  const input = [{ id: 'x4', verifyStatus: 'expired', verifiedAt: '2025-09-01', source: { kind: 'field', detail: '去年实地看过' } }];
  const out = attachDemo(input, 'stall');
  ok('12e. expired + 合法历史日期 → 保留 expired', out[0].verifyStatus === 'expired' && out[0].verifiedAt === '2025-09-01',
    out[0].verifyStatus + '/' + out[0].verifiedAt);
}

{
  /* 二次规范化必须幂等：走两遍不能把记录越改越弱或越改越强 */
  const once = attachDemo([{ id: 'x5', verifyStatus: 'verified', verifiedAt: '2026-10-05', source: { kind: 'official', detail: '后勤公示' } }], 'shop')[0];
  const twice = attachDemo([once], 'shop')[0];
  ok('12f. 反复规范化结果稳定（幂等）',
    once.verifyStatus === twice.verifyStatus && once.verifiedAt === twice.verifiedAt &&
    once.sourceKind === twice.sourceKind,
    once.verifyStatus + '→' + twice.verifyStatus);
}

{
  /* 纯业务数据（无任何可信度字段）必须按演示处理，不能被当成 unverified 混进真实数据 */
  const out = attachDemo([{ id: 'x6', name: '演示菜' }], 'dish');
  ok('12g. 没有任何可信度字段的业务数据按 demo 处理', out[0].verifyStatus === 'demo', out[0].verifyStatus);
  ok('12h. 演示数据没有核实时间', out[0].verifiedAt === null, String(out[0].verifiedAt));
}

section('G9 当前数据与四层合成');

{
  const allDemo = ALL_DISHES.every(function (d) { return d.verifyStatus === 'demo' && d.verifiedAt === null; }) &&
    ALL_SHOPS.every(function (s) { return s.verifyStatus === 'demo' && s.verifiedAt === null; });
  ok('13. 45 道菜 + 12 家店仍全部 demo 且 verifiedAt 为 null', allDemo,
    ALL_DISHES.length + ' 菜 / ' + ALL_SHOPS.length + ' 店');
}

{
  const V = function (level, status, time, kind, detail, ref) {
    return {
      metaLevel: level, id: level + '_1', verifyStatus: status,
      verifiedAt: time === undefined ? null : time,
      source: makeSource(kind || (status === 'demo' ? SOURCE_KIND.DEMO : SOURCE_KIND.FIELD), detail || '测试来源', ref || '')
    };
  };

  const full = [
    V('dish', 'verified', '2026-10-01', SOURCE_KIND.FIELD),
    V('stall', 'verified', '2026-10-01', SOURCE_KIND.MERCHANT),
    V('floor', 'verified', '2026-10-01', SOURCE_KIND.OFFICIAL),
    V('shop', 'verified', '2026-10-01', SOURCE_KIND.OFFICIAL)
  ];
  ok('14. 四层全 verified → verified', weakest(full).status === 'verified');

  const stallWeak = full.slice();
  stallWeak[1] = V('stall', 'unverified');
  const r = weakest(stallWeak);
  ok('14b. 窗口待核实 → 整体 unverified', r.status === 'unverified', r.status);
  ok('14c. 说明里点名是窗口拖低的', /窗口/.test(r.note || ''), r.note || '(空)');

  const floorDemo = full.slice();
  floorDemo[2] = V('floor', 'demo');
  ok('14d. 楼层是演示数据 → 整体 demo', weakest(floorDemo).status === 'demo', weakest(floorDemo).status);

  const shopExpired = full.slice();
  shopExpired[3] = V('shop', 'expired', '2025-06-01');
  ok('14e. 店铺已过期 → 整体 expired（优先于其它层）', weakest(shopExpired).status === 'expired', weakest(shopExpired).status);
}

/* ---------------- 汇总 ---------------- */

console.log('\n========================================');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) {
  console.log('失败清单：');
  failures.forEach(function (f) { console.log('  · ' + f); });
  console.log('========================================');
  process.exit(1);
} else {
  console.log('全部通过');
  console.log('========================================');
}
