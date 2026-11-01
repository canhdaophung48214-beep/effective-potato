'use strict';
const fs = require('fs'); const path = require('path');
const RAW = path.join(__dirname, '_raw');
const records = JSON.parse(fs.readFileSync(path.join(RAW, 'records.json'), 'utf8')).records;
const ents = JSON.parse(fs.readFileSync(path.join(RAW, 'blockers.json'), 'utf8')).entries;
const byAdapter = new Map(records.map(r => [r._adapterKey, r]));
const stripPrefix = (k) => { const p = String(k).split('|'); p[1] = p[1].replace(/^f[23]\//, ''); return p.join('|'); };
let ok = 0, miss = [];
for (const e of ents) { const k = stripPrefix(e.recordKey); if (byAdapter.has(k)) ok++; else miss.push(e.kind); }
console.log('join ok =', ok, '/', ents.length, ' miss kinds =', JSON.stringify(miss.slice(0, 5)));
const tally = (a, f) => a.reduce((m, x) => { const k = String(f(x)); m[k] = (m[k] || 0) + 1; return m; }, {});
const A = ents.filter(e => e.kind === 'blocked_by_decision');
const C = ents.filter(e => e.kind === 'not_generated');
const ar = A.map(e => byAdapter.get(stripPrefix(e.recordKey)));
console.log('foodType null in A =', ar.filter(r => r.foodType === null).length, ' set =', ar.filter(r => r.foodType).length);
console.log('foodType dist =', JSON.stringify(tally(ar, r => r.foodType)));
console.log('specLabel dist =', JSON.stringify(tally(ar, r => r.gen.specLabel)));
console.log('disambiguator nonempty =', ar.filter(r => r.gen.disambiguator).length, ' sample =', JSON.stringify(ar.filter(r => r.gen.disambiguator).slice(0, 2).map(r => [r._adapterKey, r.name, r.price])));
console.log('t48 spec =', JSON.stringify(tally(ar.filter(r => r.stallId === 'c01_t48'), r => r.gen.specLabel)));
console.log('t49 spec =', JSON.stringify(tally(ar.filter(r => r.stallId === 'c01_t49'), r => r.gen.specLabel)));
console.log('--- 6 t48 samples (assigned) ---');
ar.filter(r => r.stallId === 'c01_t48').slice(0, 6).forEach(r => console.log(JSON.stringify([r.id, r.name, r.gen.specLabel, r.price, r.foodType, JSON.stringify(r.tastes), r.gen.id_status])));
console.log('--- 4 t49 samples ---');
ar.filter(r => r.stallId === 'c01_t49').slice(0, 4).forEach(r => console.log(JSON.stringify([r.id, r.name, r.gen.specLabel, r.price, r.foodType, r.gen.id_status])));
console.log('--- planned_from_roster samples by stall ---');
for (const st of ['c01_t07','c01_t11','c01_t16','c01_t17','c01_t28','c01_t32','c01_t37','c01_t38','c01_t39','c01_t42','c01_t43','c01_t44','c01_t45','c01_t46','c01_t47','c01_t09','c01_t14','c01_t15','c01_t19','c01_t21','c01_t35']) {
  const s = ar.filter(r => r.stallId === st).slice(0, 2);
  console.log(st, JSON.stringify(s.map(r => [r.id, r.name, r.gen.specLabel, r.price, r.foodType])));
}
console.log('--- price extremes ---');
console.log(JSON.stringify(ar.slice().sort((a,b)=>a.price-b.price).slice(0,3).map(r=>[r.id,r.stallId,r.name,r.price])));
console.log(JSON.stringify(ar.slice().sort((a,b)=>b.price-a.price).slice(0,3).map(r=>[r.id,r.stallId,r.name,r.price])));
console.log('--- C entries by stall ---');
console.log(JSON.stringify(tally(C, e => e.stallId)));
for (const e of C.slice(0, 8)) console.log(JSON.stringify([e.recordKey, e.sourceLine]));
