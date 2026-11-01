'use strict';
const fs = require('fs'); const path = require('path');
const RAW = path.join(__dirname, '_raw');
const recs = JSON.parse(fs.readFileSync(path.join(RAW, 'records.json'), 'utf8')).records;
const joined = JSON.parse(fs.readFileSync(path.join(RAW, 'joined.json'), 'utf8'));
console.log('records meta =', JSON.stringify(JSON.parse(fs.readFileSync(path.join(RAW, 'records.json'), 'utf8')).meta));
console.log('sample record t07 =', JSON.stringify(recs.find(r => r.stallId === 'c01_t07')));
console.log('sample record t48 =', JSON.stringify(recs.find(r => r.stallId === 'c01_t48')));
const bo = JSON.parse(fs.readFileSync(path.join(RAW, 'blockers.json'), 'utf8'));
console.log('C entry sample =', JSON.stringify(bo.entries.find(e => e.stallId === 'c01_t20')));
// 每档口首条（按稳定键排序）
const byStall = new Map();
for (const r of recs) { if (!byStall.has(r.stallId)) byStall.set(r.stallId, []); byStall.get(r.stallId).push(r); }
const firsts = [];
for (const [sid, list] of byStall) { list.sort((a, b) => a.id < b.id ? -1 : 1); firsts.push([sid, list[0].id, list[0].name]); }
console.log('stall firsts =', JSON.stringify(firsts));
