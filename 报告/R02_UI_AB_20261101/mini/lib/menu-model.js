'use strict';

function toView(record) {
  return {
    id: record.id,
    name: record.name,
    historicalAmount: record.historicalMenuPrice.amount,
    historicalPriceText: `历史菜单价 ${record.historicalMenuPrice.rawExpression}`,
    currentPriceText: '当前价格未知',
    preparation: ['炒饭', '炒面', '炒饼'].find((type) => record.name.endsWith(type)) || '其他',
    sourceText: record.display.sourceText,
    parentNotice: record.display.parentNotice,
    historyNotice: record.display.historyNotice,
    floorText: record.parentEvidence.floor && record.parentEvidence.floor.label
      ? `${record.parentEvidence.floor.label.replace(/\s+/g, ' ')}（来源关联，未现场核验）`
      : '未知',
    windowText: record.parentEvidence.stall && record.parentEvidence.stall.windowNumber
      ? String(record.parentEvidence.stall.windowNumber)
      : '未知',
    tasteText: '未知',
    transactionQuote: false
  };
}

function buildList(records, options = {}) {
  const query = String(options.query || '').trim();
  const preparation = options.preparation || '全部';
  const minimum = Number.isFinite(options.historicalMin) ? options.historicalMin : -Infinity;
  const maximum = Number.isFinite(options.historicalMax) ? options.historicalMax : Infinity;
  const list = records.map(toView).filter((item) => {
    const queryMatch = !query || item.name.includes(query);
    const typeMatch = preparation === '全部' || item.preparation === preparation;
    const amountMatch = item.historicalAmount >= minimum && item.historicalAmount <= maximum;
    return queryMatch && typeMatch && amountMatch;
  });
  if (options.sort === 'historical-asc') list.sort((a, b) => a.historicalAmount - b.historicalAmount || a.id.localeCompare(b.id));
  if (options.sort === 'historical-desc') list.sort((a, b) => b.historicalAmount - a.historicalAmount || a.id.localeCompare(b.id));
  return list;
}

function countActiveFilters(options = {}) {
  return Number(Number.isFinite(options.historicalMin) || Number.isFinite(options.historicalMax));
}

function getDetail(records, id) {
  const record = records.find((item) => item.id === id) || records[0];
  return record ? toView(record) : null;
}

module.exports = { buildList, getDetail, countActiveFilters };
