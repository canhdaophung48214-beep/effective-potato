'use strict';
const fs = require('fs'); const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const raw = fs.readFileSync(path.join(PROJ, 'docs/RECORD_GENERATOR_CONTRACT_20261023.md'), 'utf8');
const c = raw.split(/\r?\n/);
for (let i = 194; i < 300; i++) console.log((i + 1) + '| ' + c[i].slice(0, 200));
// roster tables
function table(startLine) {
  const rows = [];
  for (let i = startLine - 1; i < c.length; i++) {
    const l = c[i];
    if (!/^\s*\|/.test(l)) { if (rows.length) break; else continue; }
    rows.push(l);
  }
  return rows.map(r => r.split('|').slice(1, -1).map(s => s.trim()));
}
const t2 = table(423).filter(r => r.length >= 6 && !/^-+$/.test(r[0].replace(/\s/g, '')) && r[0] !== '名册位次');
const t3 = table(495).filter(r => r.length >= 5 && !/^-+$/.test(r[0].replace(/\s/g, '')) && r[0] !== '3F 编号');
console.log('===== 2F roster rows: ' + t2.length + ' =====');
console.log(JSON.stringify(t2));
console.log('===== 3F roster rows: ' + t3.length + ' =====');
console.log(JSON.stringify(t3));
