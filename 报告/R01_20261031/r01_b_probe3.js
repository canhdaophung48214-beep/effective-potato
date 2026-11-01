'use strict';
const fs = require('fs'); const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const rd = p => fs.readFileSync(path.join(PROJ, p), 'utf8');
const c = rd('docs/RECORD_GENERATOR_CONTRACT_20261023.md').split(/\r?\n/);
const show = (from, to, tag) => {
  console.log('===== ' + tag + ' (' + from + '-' + to + ') =====');
  for (let i = from - 1; i < to && i < c.length; i++) console.log((i + 1) + '| ' + c[i].slice(0, 210));
};
const g = (needle, limit) => c.map((l, i) => [i + 1, l]).filter(([i, l]) => l.indexOf(needle) >= 0).slice(0, limit || 8).map(([i, l]) => i + '| ' + l.slice(0, 180));
console.log('--- 全局阻塞 B1 ---');
console.log(g('全局阻塞').join('\n'));
console.log('--- B1/B2/B3/B8 ---');
console.log(g('B8').join('\n'));
const rb = rd('docs/RAW_DATA_BLOCKERS_20261023.md');
const rbl = rb.split(/\r?\n/);
console.log('--- RAW_DATA_BLOCKERS first 60 lines (total ' + rbl.length + ') ---');
for (let i = 0; i < 60 && i < rbl.length; i++) console.log((i + 1) + '| ' + rbl[i].slice(0, 190));
