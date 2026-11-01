'use strict';
const fs = require('fs'); const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const c = fs.readFileSync(path.join(PROJ, 'docs/RECORD_GENERATOR_CONTRACT_20261023.md'), 'utf8').split(/\r?\n/);
const g = (n, lim) => { const h = c.map((l, i) => [i + 1, l]).filter(([i, l]) => l.indexOf(n) >= 0).slice(0, lim || 6); console.log('== ' + n + ' (' + h.length + ')'); h.forEach(([i, l]) => console.log(i + '| ' + l.trim().slice(0, 170))); };
for (const k of ['TIER_C', 'ID_UNASSIGNED', 'EVIDENCE_GAP', 'excluded_by_decision', 'NEW_KEY']) g(k, 4);
// data/ 里是否有 c01 命名空间
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const dataFiles = walk(path.join(PROJ, 'data'));
let c01 = [];
for (const f of dataFiles) { const t = fs.readFileSync(f, 'utf8'); if (t.indexOf('c01') >= 0) c01.push(path.basename(f) + ':' + (t.match(/c01/g) || []).length); }
console.log('data/ 文件数=' + dataFiles.length + ' 含 c01 的：' + JSON.stringify(c01));
console.log('data/ 文件：' + JSON.stringify(dataFiles.map(f => path.basename(f))));
const ns = JSON.parse(fs.readFileSync(path.join(PROJ, 'docs/decisions/C02_NAMESPACE_CONDITIONAL_APPROVAL_20261026.json'), 'utf8'));
console.log('C02 审批 keys=' + JSON.stringify(Object.keys(ns)));
console.log(JSON.stringify(ns).slice(0, 900));
