'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const root = path.resolve(__dirname, '..');
const records = require('../mini/data/history-records.json');
const model = require('../mini/lib/menu-model.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test('loads 39 unique historical records', () => {
  assert.equal(records.length, 39);
  assert.equal(new Set(records.map((item) => item.id)).size, 39);
});

test('never exposes a current price or generic price field', () => {
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.hasOwn(value, 'price'), false);
    Object.values(value).forEach(walk);
  }
  records.forEach((item) => {
    assert.equal(item.currentEffectivePrice.validity, 'UNKNOWN');
    assert.strictEqual(item.currentEffectivePrice.amount, null);
  });
  walk(model.buildList(records));
});

test('search and preparation filters use existing names only', () => {
  assert(model.buildList(records, { query: '牛肉' }).every((item) => item.name.includes('牛肉')));
  assert(model.buildList(records, { preparation: '炒饭' }).every((item) => item.name.endsWith('炒饭')));
});

test('historical amount sorting does not relabel it as current price', () => {
  const asc = model.buildList(records, { sort: 'historical-asc' });
  assert(asc[0].historicalAmount <= asc.at(-1).historicalAmount);
  assert(asc.every((item) => item.currentPriceText === '当前价格未知'));
});

test('detail keeps evidence and unknown state', () => {
  const detail = model.getDetail(records, records[0].id);
  assert.equal(detail.id, records[0].id);
  assert.equal(detail.currentPriceText, '当前价格未知');
  assert(detail.sourceText.includes('TRANSCRIPTION_2F.md'));
  assert.equal(detail.transactionQuote, false);
});

test('empty search returns an empty collection', () => {
  assert.deepStrictEqual(model.buildList(records, { query: '不存在的菜名' }), []);
});

test('historical amount range filter is deterministic', () => {
  const low = model.buildList(records, { historicalMin: 10, historicalMax: 12 });
  assert(low.length > 0);
  assert(low.every((item) => item.historicalAmount >= 10 && item.historicalAmount <= 12));
  const high = model.buildList(records, { historicalMin: 13, historicalMax: 15 });
  assert(high.length > 0);
  assert(high.every((item) => item.historicalAmount >= 13 && item.historicalAmount <= 15));
});

test('active filter count ignores default values', () => {
  assert.equal(model.countActiveFilters({}), 0);
  assert.equal(model.countActiveFilters({ historicalMin: 10, historicalMax: 12 }), 1);
});

test('detail exposes unknown fields without inference', () => {
  const detail = model.getDetail(records, records[0].id);
  assert.equal(detail.floorText, '2 楼（来源关联，未现场核验）');
  assert.equal(detail.windowText, '未知');
  assert.equal(detail.tasteText, '未知');
});

test('three pages and shared components exist', () => {
  const required = [
    'mini/pages/home/index.wxml', 'mini/pages/menu/index.wxml', 'mini/pages/detail/index.wxml',
    'mini/components/search-bar/index.wxml', 'mini/components/dish-card/index.wxml',
    'mini/components/history-notice/index.wxml'
  ];
  required.forEach((rel) => assert(fs.existsSync(path.join(root, rel)), rel));
});

test('runtime pages use a CommonJS data module instead of requiring JSON', () => {
  ['home', 'menu', 'detail'].forEach((page) => {
    const source = fs.readFileSync(path.join(root, `mini/pages/${page}/index.js`), 'utf8');
    assert(source.includes("history-records.js"));
    assert(!source.includes("history-records.json"));
  });
});

test('visible copy contains safety notices and no fabricated claims', () => {
  const files = fs.readdirSync(path.join(root, 'mini'), { recursive: true })
    .filter((name) => name.endsWith('.wxml'))
    .map((name) => fs.readFileSync(path.join(root, 'mini', name), 'utf8'));
  const text = files.join('\n');
  assert(text.includes('历史菜单'));
  assert(text.includes('当前价格'));
  ['下单', '购买', '评分', '口味：', '窗口号'].forEach((word) => assert(!text.includes(word), word));
});

test('home small cards only bind name and historical price', () => {
  const card = fs.readFileSync(path.join(root, 'mini/components/dish-card/index.wxml'), 'utf8');
  const minimal = card.match(/<!-- MINIMAL_START -->([\s\S]*?)<!-- MINIMAL_END -->/);
  assert(minimal);
  assert(minimal[1].includes('item.name'));
  assert(minimal[1].includes('item.historicalPriceText'));
  ['currentPriceText', 'tags', 'parentNotice', 'sourceText'].forEach((field) => assert(!minimal[1].includes(field)));
});

test('list uses one fixed category row and a bottom filter sheet', () => {
  const wxml = fs.readFileSync(path.join(root, 'mini/pages/menu/index.wxml'), 'utf8');
  const pageSource = fs.readFileSync(path.join(root, 'mini/pages/menu/index.js'), 'utf8');
  const combined = `${wxml}\n${pageSource}`;
  assert(!wxml.includes('<scroll-view'));
  ['全部', '炒饭', '炒面', '炒饼', '筛选'].forEach((label) => assert(combined.includes(label)));
  ['filter-mask', 'filter-sheet', '重置', '确认'].forEach((token) => assert(wxml.includes(token)));
  ['默认排序', '历史金额升序', '历史金额降序'].forEach((label) => assert(combined.includes(label)));
});

test('interactive controls declare at least 88rpx hit areas', () => {
  const wxss = fs.readFileSync(path.join(root, 'mini/app.wxss'), 'utf8') +
    fs.readFileSync(path.join(root, 'mini/pages/menu/index.wxss'), 'utf8');
  assert(wxss.includes('min-height:88rpx'));
  for (const className of ['category-button', 'sort-button', 'sheet-action']) {
    assert(wxss.includes(`.${className}`));
  }
});

test('menu controller opens closes resets and confirms filter state', () => {
  const file = path.join(root, 'mini/pages/menu/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) { definition = value; },
    require: createRequire(file),
    wx: { navigateTo() {} }
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  };
  page.onLoad({});
  assert.equal(page.data.items.length, 39);
  page.openFilter();
  assert.equal(page.data.filterOpen, true);
  page.selectRange({ currentTarget: { dataset: { value: 'low' } } });
  page.confirmFilter();
  assert.equal(page.data.filterOpen, false);
  assert.equal(page.data.filterCount, 1);
  assert(page.data.items.every((item) => item.historicalAmount >= 10 && item.historicalAmount <= 12));
  page.openFilter();
  page.resetFilter();
  page.confirmFilter();
  assert.equal(page.data.filterCount, 0);
  assert.equal(page.data.items.length, 39);
  page.openFilter();
  page.closeFilter();
  assert.equal(page.data.filterOpen, false);
});

test('menu controller switches category and cycles all sort labels', () => {
  const file = path.join(root, 'mini/pages/menu/index.js');
  let definition;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page(value) { definition = value; },
    require: createRequire(file),
    wx: { navigateTo() {} }
  });
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); }
  };
  page.onLoad({});
  page.selectType({ currentTarget: { dataset: { value: '炒饭' } } });
  assert(page.data.items.every((item) => item.name.endsWith('炒饭')));
  page.cycleSort();
  assert.equal(page.data.sortLabel, '历史金额升序');
  page.cycleSort();
  assert.equal(page.data.sortLabel, '历史金额降序');
  page.cycleSort();
  assert.equal(page.data.sortLabel, '默认排序');
});

test('responsive and long-text safeguards are present', () => {
  const wxss = fs.readFileSync(path.join(root, 'mini/app.wxss'), 'utf8') +
    fs.readdirSync(path.join(root, 'mini/pages'), { recursive: true })
      .filter((name) => name.endsWith('.wxss'))
      .map((name) => fs.readFileSync(path.join(root, 'mini/pages', name), 'utf8')).join('\n');
  assert(wxss.includes('grid-template-columns:repeat(2,minmax(0,1fr))'));
  assert(wxss.includes('overflow-wrap:anywhere'));
  assert(wxss.includes('env(safe-area-inset-bottom)'));
});

console.log(`RESULT ${passed} PASS / 0 FAIL`);
