/** Independent offline T8 coverage. Never writes project data or formal outputs. */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');
const GEN = path.join(__dirname, 'pilot', 'gen_records.js');
const results = [];
function record(id, ok, detail) {
  results.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + detail);
}
function pending(id, detail) {
  results.push({ id, status: 'PENDING', detail });
  console.log('PENDING ' + id + ' ' + detail);
}
function load(fsImpl) {
  const source = fs.readFileSync(GEN, 'utf8');
  const factory = new Function('require', 'module', '__filename', '__dirname', 'process', source +
    '\nreturn { validateAttachments, checkDirFsync, initIdMap, run };');
  const localRequire = name => name === 'fs' ? fsImpl : require(name);
  return factory(localRequire, { exports: {} }, GEN, path.dirname(GEN), process);
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted && c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row);
      row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new Error('CSV 引号未闭合');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function codes(result) { return result.errors.map(e => e.code); }

// T230: the real evidence manifest is read only. Missing/drifted evidence is not a generator regression.
try {
  const manifest = path.join(ROOT, 'evidence', 'PHOTO_MANIFEST_20261025.csv');
  if (!fs.existsSync(manifest)) {
    ['T230-A', 'T230-B', 'T230-C'].forEach(id => pending(id, '真实证据清单不存在'));
  } else {
    const rows = parseCsv(fs.readFileSync(manifest, 'utf8'));
    const header = rows.shift();
    const ix = Object.fromEntries(header.map((name, i) => [name, i]));
    const expected = ['photo_id', 'archive_path', 'bytes', 'sha256'];
    if (expected.some(k => ix[k] === undefined) || rows.length !== 35) {
      ['T230-A', 'T230-B', 'T230-C'].forEach(id => pending(id, '清单结构/行数偏离 35 条基线'));
    } else {
      const raw = rows.map(row => ({ photoId: row[ix.photo_id], relativePath: row[ix.archive_path],
        bytes: Number(row[ix.bytes]), sha256: row[ix.sha256] }));
      const sorted = raw.slice().sort((a, b) => Buffer.compare(Buffer.from(a.relativePath), Buffer.from(b.relativePath)));
      const unique = sorted.filter((a, i) => i === 0 || a.relativePath !== sorted[i - 1].relativePath);
      const total = unique.reduce((sum, a) => sum + a.bytes, 0);
      const evidenceReady = unique.length === 34 && total === 16118613 && unique.every(a => fs.existsSync(path.join(ROOT, a.relativePath)));
      if (!evidenceReady) {
        ['T230-A', 'T230-B', 'T230-C'].forEach(id => pending(id, '34 个归档件或 16118613 字节基线缺失/漂移'));
      } else {
        const I = load(fs);
        const project = a => ({ relativePath: a.relativePath, bytes: a.bytes, sha256: a.sha256 });
        const good = I.validateAttachments(unique.map(project), ROOT);
        record('T230-A', good.ok && good.errors.length === 0, '真实 34 件排序去重后通过 bytes/sha256 校验；errors=' + codes(good).join(','));
        const original = I.validateAttachments(raw.map(project), ROOT);
        record('T230-B', !original.ok && codes(original)[0] === 'E_ATTACH_ORDER' && original.errors.length >= 2,
          '原序必须拒绝；errors=' + codes(original).join(','));
        const duplicatePair = sorted.filter(a => sorted.filter(b => b.relativePath === a.relativePath).length > 1).map(a => a.photoId).sort();
        const dup = I.validateAttachments(sorted.map(project), ROOT);
        record('T230-C', !dup.ok && codes(dup).includes('E_ATTACH_ORDER') && codes(dup).includes('E_ATTACH_DUPLICATE') &&
          JSON.stringify(duplicatePair) === JSON.stringify(['3F-06', '3F-07']),
        '排序未去重必须同时报 ORDER/DUPLICATE；重复照片=' + duplicatePair.join(','));
      }
    }
  }
} catch (e) { record('T230', false, '测试异常：' + e.stack); }

// T243: observe write operations, not source text. The injected record channel remains in memory.
try {
  const writes = [];
  const watched = new Set(['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'linkSync', 'unlinkSync', 'rmSync']);
  const proxy = new Proxy(fs, { get(target, key) {
    const value = target[key];
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (watched.has(key) || (key === 'openSync' && /[wax+]/.test(String(args[1])))) writes.push({ method: key, path: String(args[0]) });
      return value.apply(target, args);
    };
  } });
  const I = load(proxy);
  const map = path.join(ROOT, 'tools', 'pilot', 'id-map.json');
  const before = fs.existsSync(map) ? fs.readFileSync(map) : null;
  const beforeMtime = fs.existsSync(map) ? fs.statSync(map).mtimeMs : null;
  const r = I.run({ mode: 'dry-run', records: [] });
  const after = fs.existsSync(map) ? fs.readFileSync(map) : null;
  const afterMtime = fs.existsSync(map) ? fs.statSync(map).mtimeMs : null;
  const noMapWrite = writes.every(x => !/id-map\.json$|\.id-map-init-/i.test(x.path));
  record('T243-A', r.summary.status === 'L8_IN_MEMORY_ONLY' && writes.length === 0 && noMapWrite &&
    ((before === null && after === null) || (before && after && before.equals(after) && beforeMtime === afterMtime)),
  'dry-run 注入通道无写操作、无映射变化；status=' + r.summary.status + ' writes=' + writes.length);
} catch (e) { record('T243-A', false, '测试异常：' + e.stack); }

// T233: directory fsync is replaced only for a controlled control-flow test.
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't8-fsync-'));
  try {
    const proxy = new Proxy(fs, { get(target, key) {
      if (key === 'fsyncSync') return fd => fs.fstatSync(fd).isDirectory() ? undefined : fs.fsyncSync(fd);
      return target[key];
    } });
    const I = load(proxy);
    const target = path.join(dir, 'id-map.json');
    const body = '{"schemaVersion":1}\n';
    const cap = I.checkDirFsync(dir);
    const first = I.initIdMap(body, target);
    const second = I.initIdMap('different', target);
    record('T233-A', cap.ok && first.status === 'INIT_OK' && first.wrote === true && first.exitCode === 0 &&
      second.status === 'INIT_TARGET_EXISTS' && fs.readFileSync(target, 'utf8') === body &&
      JSON.stringify(fs.readdirSync(dir)) === JSON.stringify(['id-map.json']),
    '目录 fsync 代理 no-op；仅验证控制流及真实文件读写，不证明 NTFS 持久性；first=' + first.status + ' second=' + second.status);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
} catch (e) { record('T233-A', false, '测试异常：' + e.stack); }

pending('T242-REAL', '真实掉电恢复无法用本机进程内单测证明；需独立故障实验');
const count = Object.fromEntries(['PASS', 'FAIL', 'PENDING'].map(s => [s, results.filter(r => r.status === s).length]));
console.log('汇总：PASS ' + count.PASS + ' / FAIL ' + count.FAIL + ' / PENDING ' + count.PENDING);
if (count.FAIL) process.exitCode = 1;
