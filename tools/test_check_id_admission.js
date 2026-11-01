/**
 * check_id_admission.js 的测试（本地、只读、确定性）
 *
 * 用法：node tools/test_check_id_admission.js
 * 退出码：0 全部通过 / 1 有用例失败
 *
 * 全部夹具写在系统临时目录，跑完即删；不触碰仓库任何数据。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const VALIDATOR = path.join(__dirname, 'check_id_admission.js');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'shishen-admission-'));

let pass = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log('[PASS] ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' :: ' + detail : ''));
    console.log('[FAIL] ' + name + (detail ? ' :: ' + detail : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected=' + JSON.stringify(expected) + ' actual=' + JSON.stringify(actual));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return file;
}

function csv(header, rows) {
  return [header.join(',')].concat(rows.map(function (r) { return header.map(function (h) { return r[h]; }).join(','); })).join('\n') + '\n';
}

const SHOP_H = ['shop_id', 'shop_name'];
const STALL_H = ['shop_id', 'stall_id', 'stall_name'];
const DISH_H = ['dish_id', 'dish_name', 'shop_id', 'stall_id', 'price'];

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/* 默认夹具：四个来源互不重叠，命名空间都在批准 scope 内，应当 0 冲突 */
function buildFixture(mutate) {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, 'root-'));
  const m = mutate || {};

  const frozen = write(path.join(root, 'docs', 'decisions', 'TEST_MAP.json'), JSON.stringify({
    note: '测试用冻结决策文件', entries: [{ dishId: 'c07_d100', stallId: 'c07_t01' }]
  }, null, 2));

  write(path.join(root, 'tools', 'pilot', 'id-map.json'), JSON.stringify({
    schemaVersion: 1,
    initialization: { approvalRef: 'ap-test-01', planDigest: 'PD-TEST-1', mapVersion: '1#1' },
    entries: [
      { dishId: 'c07_d100', stallId: 'c07_t01', status: 'active', key: 'c07_t01|x|y|' },
      { dishId: 'c07_d101', stallId: 'c07_t01', status: 'active', key: 'c07_t01|x|z|' }
    ]
  }, null, 2));

  write(path.join(root, 'tools', 'pilot', 'approvals', 'ap-test-01.json'), JSON.stringify({
    approvalId: 'ap-test-01',
    frozenMapRef: path.relative(root, frozen).replace(/\\/g, '/'),
    frozenMapSha256: m.frozenSha || sha(frozen),
    frozenMapBytes: fs.statSync(frozen).size,
    planDigest: m.planDigest || 'PD-TEST-1',
    mapVersion: m.mapVersion || '1#1',
    scope: m.scope || '本次批准范围：c07_d100–c07_d199、c10_d100–c10_d199、c11_d100–c11_d199、c12_d100–c12_d199'
  }, null, 2));

  write(path.join(root, 'tools', 'pilot', 'batch1', 'shops.csv'), csv(SHOP_H, [{ shop_id: 'c10', shop_name: '十号' }]));
  write(path.join(root, 'tools', 'pilot', 'batch1', 'stalls.csv'), csv(STALL_H, [{ shop_id: 'c10', stall_id: 'c10_t01', stall_name: '档口' }]));
  write(path.join(root, 'tools', 'pilot', 'batch1', 'dishes.csv'), csv(DISH_H, (m.batch1Dishes || [
    { dish_id: 'c10_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }
  ])));

  write(path.join(root, 'tools', 'pilot', 'batch1_min', 'shops.csv'), csv(SHOP_H, [{ shop_id: 'c11', shop_name: '十一号' }]));
  write(path.join(root, 'tools', 'pilot', 'batch1_min', 'stalls.csv'), csv(STALL_H, [{ shop_id: 'c11', stall_id: 'c11_t01', stall_name: '档口' }]));
  write(path.join(root, 'tools', 'pilot', 'batch1_min', 'dishes.csv'), csv(DISH_H, [
    { dish_id: 'c11_d100', dish_name: '乙', shop_id: 'c11', stall_id: 'c11_t01', price: '8' }
  ]));

  const pilot = m.pilot || {
    BATCH_ID: 'pilot_test_batch',
    RESTAURANTS: [{ _id: 'c11', source: { kind: 'field', detail: '现场' } }],
    STALLS: [{ _id: 'c11_t01', restaurantId: 'c11' }],
    DISHES: [{ _id: 'c11_d100', name: '乙', price: 8, restaurantId: 'c11', stallId: 'c11_t01' }],
    SHEET: []
  };
  write(path.join(root, 'cloudfunctions', 'seed', 'pilot-data.js'),
    'module.exports = ' + JSON.stringify(pilot, null, 2) + ';\n');

  /* 命名空间条件批准登记（可选夹具）：只写入 docs/decisions/，与正式审批目录分开 */
  if (m.registry) {
    write(path.join(root, 'docs', 'decisions', 'NAMESPACE_APPROVALS_TEST.json'), JSON.stringify({
      schemaVersion: 1,
      registryKind: 'pilot-namespace-approvals',
      entries: m.registry
    }, null, 2));
  }

  return root;
}

function run(root, extra) {
  const r = spawnSync(process.execPath, [VALIDATOR, '--root', root].concat(extra || []), { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

try {
  console.log('== A. 干净夹具：0 冲突、退出码 0 ==');
  (function () {
    const root = buildFixture();
    const r = run(root);
    eq('A1 退出码 0', r.status, 0);
    ok('A2 输出「未发现冲突」', r.out.indexOf('未发现冲突') !== -1);
    ok('A3 没有把运行时副本与冻结文件混为一谈', r.out.indexOf('不是同一份') !== -1);
    const r2 = run(root);
    eq('A4 确定性：两次运行结果一致', r2.out.replace(/SHA-256 前 16 位：[0-9a-f]+/, 'H'), r.out.replace(/SHA-256 前 16 位：[0-9a-f]+/, 'H'));
  })();

  console.log('== B. 冲突检测 ==');
  (function () {
    const dup = buildFixture({
      batch1Dishes: [
        { dish_id: 'c10_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' },
        { dish_id: 'c10_d100', dish_name: '甲-2', shop_id: 'c10', stall_id: 'c10_t01', price: '8' }
      ]
    });
    const rDup = run(dup);
    eq('B1 源内重复退出码 1', rDup.status, 1);
    ok('B2 报出 DUP_IN_SOURCE', rDup.out.indexOf('DUP_IN_SOURCE') !== -1);

    const badShape = buildFixture({
      batch1Dishes: [{ dish_id: 'c10_d99', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    const rShape = run(badShape);
    eq('B3 形状不合规退出码 1', rShape.status, 1);
    ok('B4 报出 ID_SHAPE', rShape.out.indexOf('ID_SHAPE') !== -1);

    const cross = buildFixture({
      batch1Dishes: [{ dish_id: 'c07_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    const rCross = run(cross);
    eq('B5 撞进冻结映射退出码 1', rCross.status, 1);
    ok('B6 报出 CROSS_SOURCE', rCross.out.indexOf('CROSS_SOURCE') !== -1);
    ok('B7 同时报出号段重叠', rCross.out.indexOf('RANGE_OVERLAP') !== -1);

    const ns = buildFixture({ scope: '本次只批准 c07_d100–c07_d199' });
    const rNs = run(ns);
    eq('B8 未批准命名空间退出码 1', rNs.status, 1);
    ok('B9 报出 NS_UNAPPROVED', rNs.out.indexOf('NS_UNAPPROVED') !== -1);

    const badHash = buildFixture({ frozenSha: 'deadbeef' });
    const rHash = run(badHash);
    eq('B10 冻结哈希不符退出码 1', rHash.status, 1);
    ok('B11 报出 FROZEN_HASH_MISMATCH', rHash.out.indexOf('FROZEN_HASH_MISMATCH') !== -1);

    const badDigest = buildFixture({ planDigest: 'PD-OTHER' });
    const rDigest = run(badDigest);
    eq('B12 planDigest 不符退出码 1', rDigest.status, 1);
    ok('B13 报出 PLAN_DIGEST_MISMATCH', rDigest.out.indexOf('PLAN_DIGEST_MISMATCH') !== -1);

    const drift = buildFixture({
      pilot: {
        BATCH_ID: 'pilot_test_batch',
        RESTAURANTS: [{ _id: 'c11', source: { kind: 'field', detail: '现场' } }],
        STALLS: [{ _id: 'c11_t01', restaurantId: 'c11' }],
        DISHES: [{ _id: 'c11_d100', name: '乙-改名', price: 8, restaurantId: 'c11', stallId: 'c11_t01' }],
        SHEET: []
      }
    });
    const rDrift = run(drift);
    eq('B14 pilot 与 batch1_min 漂移退出码 1', rDrift.status, 1);
    ok('B15 报出 PILOT_MIN_DRIFT', rDrift.out.indexOf('PILOT_MIN_DRIFT') !== -1);
  })();

  console.log('== C. 输入缺失与参数 ==');
  (function () {
    const emptyRoot = fs.mkdtempSync(path.join(TMP_ROOT, 'empty-'));
    const r = run(emptyRoot);
    eq('C1 缺输入退出码 2', r.status, 2);
    ok('C2 列出缺失项', r.out.indexOf('输入缺失') !== -1);

    const root = buildFixture();
    const rJson = run(root, ['--json']);
    eq('C3 --json 干净夹具退出码 0', rJson.status, 0);
    let parsed = null;
    try { parsed = JSON.parse(rJson.out); } catch (e) { parsed = null; }
    ok('C4 --json 输出可解析', parsed !== null && Array.isArray(parsed.conflicts));
    eq('C5 --json 冲突为空数组', parsed && parsed.conflicts.length, 0);

    const conf = buildFixture({ scope: '只批准 c07' });
    const rJson2 = run(conf, ['--json']);
    const parsed2 = JSON.parse(rJson2.out);
    ok('C6 --json 冲突带 code', parsed2.conflicts.every(function (c) { return typeof c.code === 'string'; }));

    const rBadArg = spawnSync(process.execPath, [VALIDATOR, '--nope'], { encoding: 'utf8' });
    eq('C7 未知参数退出码 2', rBadArg.status, 2);
    eq('C8 未知参数不写 stdout', (rBadArg.stdout || '').trim(), '');
  })();

  console.log('== D. 只读与不修复 ==');
  (function () {
    const root = buildFixture({
      batch1Dishes: [{ dish_id: 'c10_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' },
        { dish_id: 'c10_d100', dish_name: '甲-2', shop_id: 'c10', stall_id: 'c10_t01', price: '8' }]
    });
    const before = sha(path.join(root, 'tools', 'pilot', 'batch1', 'dishes.csv'));
    const beforeMap = sha(path.join(root, 'tools', 'pilot', 'id-map.json'));
    const r = run(root);
    eq('D1 冲突场景退出码 1', r.status, 1);
    eq('D2 未改 CSV', sha(path.join(root, 'tools', 'pilot', 'batch1', 'dishes.csv')), before);
    eq('D3 未改 id-map', sha(path.join(root, 'tools', 'pilot', 'id-map.json')), beforeMap);
    ok('D4 不打印自动修复动作', !/已修复|已重编号|已批准/i.test(r.out));
    ok('D5 输出自称只读检查', r.out.indexOf('check_id_admission（只读）') !== -1);
  })();

  console.log('== F. 命名空间有条件批准（只清对应前缀，不扩散） ==');
  (function () {
    const C13 = { prefix: 'c13', status: 'conditional', approvalRef: 'ap-test-c13', batches: ['batch1'], scope: '仅 c13 试点候选' };

    const covered = buildFixture({
      registry: [C13],
      batch1Dishes: [{ dish_id: 'c13_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    const rCovered = run(covered);
    eq('F1 条件批准覆盖 c13 后 0 冲突', rCovered.status, 0);
    ok('F2 输出标注 NS_CONDITIONAL', rCovered.out.indexOf('NS_CONDITIONAL c13') !== -1);
    ok('F3 不再报 c13 未批准', rCovered.out.indexOf('命名空间 c13 未获正式批准') === -1);

    const mixed = buildFixture({
      registry: [C13],
      batch1Dishes: [
        { dish_id: 'c13_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' },
        { dish_id: 'c14_d100', dish_name: '乙', shop_id: 'c10', stall_id: 'c10_t01', price: '8' }
      ]
    });
    const rMixed = run(mixed, ['--json']);
    eq('F4 c13 已覆盖仍因 c14 退出码 1', rMixed.status, 1);
    const jMixed = JSON.parse(rMixed.out);
    eq('F5 只报 1 条冲突', jMixed.conflicts.length, 1);
    eq('F6 冲突前缀是 c14', jMixed.conflicts[0].namespace, 'c14');
    ok('F7 冲突带记录清单', jMixed.conflicts[0].records.dishes.count === 1 && jMixed.conflicts[0].records.dishes.min === 'c14_d100');
    ok('F8 冲突带引用位置（文件 + 行号）', jMixed.conflicts[0].references.some(function (r) {
      return /batch1\/dishes\.csv$/.test(r.file) && Array.isArray(r.lines) && r.lines.length === 2;
    }));
    ok('F9 冲突带依赖关系', Array.isArray(jMixed.conflicts[0].dependencies) && jMixed.conflicts[0].dependencies.length >= 3);

    const wrongBatch = buildFixture({
      registry: [{ prefix: 'c13', status: 'conditional', approvalRef: 'ap-test-c13', batches: ['pilot'] }],
      batch1Dishes: [{ dish_id: 'c13_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    const rWrong = run(wrongBatch);
    eq('F10 批次不覆盖仍告警', rWrong.status, 1);
    ok('F11 依赖里说明批次不覆盖', rWrong.out.indexOf('适用批次') !== -1 || rWrong.out.indexOf('c13') !== -1);

    const revoked = buildFixture({
      registry: [{ prefix: 'c13', status: 'revoked', approvalRef: 'ap-test-c13', batches: ['batch1'] }],
      batch1Dishes: [{ dish_id: 'c13_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    const rRevoked = run(revoked);
    eq('F12 非 conditional 状态不清告警', rRevoked.status, 1);
    ok('F13 revoked 被识别', rRevoked.out.indexOf('NS_UNAPPROVED') !== -1);

    const noRegistry = buildFixture({
      batch1Dishes: [{ dish_id: 'c13_d100', dish_name: '甲', shop_id: 'c10', stall_id: 'c10_t01', price: '7' }]
    });
    eq('F14 无登记仍告警（回归）', run(noRegistry).status, 1);
  })();

  console.log('== E. 静态边界 ==');
  (function () {
    const src = fs.readFileSync(VALIDATOR, 'utf8');
    ok('E1 不写文件', !/writeFileSync|renameSync|rmSync|mkdirSync|appendFileSync/.test(src));
    ok('E2 不写 Git 命令', !/execSync|spawnSync\([^)]*(git|sh|cmd)/.test(src));
    ok('E3 不调用云开发', !/wx-server-sdk|cloud\.callFunction|database\(\)/.test(src));
    ok('E4 不自动生成或修复 ID', !/randomUUID|padStart\(\s*4|generateId/i.test(src));
    ok('E5 退出码语义唯一来源：冲突 1 / 输入缺失 2', /return result\.conflicts\.length \? 1 : 0/.test(src));
  })();
} finally {
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (e) { /* 清理失败不影响结论 */ }
}

console.log('');
console.log('========================================');
if (failed) {
  console.log('通过 ' + pass + ' 项，失败 ' + failed + ' 项');
  failures.forEach(function (f) { console.log('  - ' + f); });
  console.log('\n❌ 有 ' + failed + ' 项未通过');
  process.exitCode = 1;
} else {
  console.log('通过 ' + pass + ' 项，失败 0 项');
  console.log('\n✅ 全部通过');
  process.exitCode = 0;
}
