'use strict';
// R01-A 探针：只读调用现有生成器 run({mode:'dry-run'})，把内存产物落到 R01 独立目录。
// 不写项目任何文件；生成器 dry-run 本身零写盘（契约 §3.2）。
const fs = require('fs');
const path = require('path');
const PROJ = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目";
const OUT = "C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\报告\\R01_20261031";
const RAW = path.join(OUT, '_raw');
fs.mkdirSync(RAW, { recursive: true });

const gen = require(path.join(PROJ, 'tools', 'pilot', 'gen_records.js'));
const res = gen.run({ mode: 'dry-run' });

const dump = {
  capturedAt: new Date().toISOString(),
  summary: res.summary,
  exitCode: res.exitCode,
  violations: res.violations,
  blockerCount: res.summary.blockers,
  counts: res.summary.counts,
  recordCount: res.outputs.recordsDoc.records.length,
  recordsMeta: res.outputs.recordsDoc.meta,
  manifest: res.outputs.manifest
};
fs.writeFileSync(path.join(RAW, 'summary.json'), JSON.stringify(dump, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(RAW, 'records.json'), JSON.stringify(res.outputs.recordsDoc, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(RAW, 'blockers.json'), JSON.stringify(res.outputs.blockersDoc, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(RAW, 'gen_manifest.json'), JSON.stringify(res.outputs.manifest, null, 2) + '\n', 'utf8');

// id-map 独立统计（只读）
const mapPath = path.join(PROJ, 'tools', 'pilot', 'id-map.json');
const raw = fs.readFileSync(mapPath, 'utf8');
const map = JSON.parse(raw);
fs.writeFileSync(path.join(RAW, 'idmap_probe.json'), JSON.stringify({
  bytes: Buffer.byteLength(raw, 'utf8'),
  topKeys: Object.keys(map),
  sample: JSON.stringify(map).slice(0, 600)
}, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({
  status: res.summary.status,
  records: res.summary.records,
  blockers: res.summary.blockers,
  counts: res.summary.counts,
  violations: res.violations.length,
  meta: res.outputs.recordsDoc.meta
}, null, 2));
