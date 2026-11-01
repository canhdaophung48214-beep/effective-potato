'use strict';
const fs = require('fs'); const path = require('path');
const RAW = path.join(__dirname, '_raw');
const records = JSON.parse(fs.readFileSync(path.join(RAW, 'records.json'), 'utf8')).records;
const ents = JSON.parse(fs.readFileSync(path.join(RAW, 'blockers.json'), 'utf8')).entries;
const strip = (k) => { const i = String(k).indexOf('|'); const rest = String(k).slice(i + 1); return String(k).slice(0, i) + '|' + rest.replace(/^f[23]\//, ''); };
const keyOf = r => r.stallId + '|' + r.gen.rawGroupKey + '|' + r.gen.specLabel + '|' + r.gen.disambiguator;
const m = new Map(); for (const r of records) { const k = keyOf(r); if (m.has(k)) console.log('DUP adapter key', k); m.set(k, r); }
let ok = 0; const miss = [];
for (const e of ents) { const k = strip(e.recordKey); if (m.has(k)) ok++; else miss.push(e); }
console.log('join(rawGroupKey) ok =', ok, 'miss =', miss.length, JSON.stringify(miss.reduce((a, e) => { a[e.kind] = (a[e.kind] || 0) + 1; return a; }, {})));
for (const e of miss.filter(x => x.kind === 'blocked_by_decision').slice(0, 6)) {
  const cands = records.filter(r => r.stallId === e.stallId && r.name === e.name);
  console.log('MISS', JSON.stringify(e.recordKey), '| name', e.name, '| cands', cands.length, JSON.stringify(cands.map(r => [r._adapterKey, r.gen.rawGroupKey, r.gen.specLabel, r.gen.disambiguator])));
}
for (const e of miss.filter(x => x.kind === 'not_generated').slice(0, 3)) console.log('MISS_C', JSON.stringify(e.recordKey));
