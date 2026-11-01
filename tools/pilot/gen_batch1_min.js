/**
 * 最小样板（B 方案）· 1 店 1 层 1 窗口 12 道
 *
 * 目的：用**已经拍到的真实照片**跑通「CSV → 校验 → 预览 → 写入项目外目录」整条链路，
 *       证明工具链可用，而不是等 9 张照片补全。
 *
 * 选这一窗口的原因：韩小面那张照片同时拍到了**门头招牌**（韩小面 · 招牌豌杂面 · 重庆风味）
 * 和完整的**价目表**，因此同一张照片可以同时给店铺行、楼层行、窗口行、菜品行当证据。
 * 这不是造假：照片本身就包含这三类信息；缺的是「楼层指引牌」这种独立照片，
 * 已在 source_detail 里写明「楼层依据＝窗口门头照」，并在待补清单里保留补拍项。
 *
 * 菜品 id 与 `tools/pilot/batch1/gen_batch1.js` 里同一窗口的 id **完全一致**
 * （c02_d060 ~ c02_d071），这样最小样板通过后，正式批次可以直接替换，不会产生两套 id。
 *
 * 运行：node tools/pilot/gen_batch1_min.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'batch1_min');
const SRC_IMG = path.join(__dirname, 'batch1', 'img');
const COLLECT_DATE = '2026-10-22';
const COLLECTOR = '产品负责人';

/* 证据＝同一张真实照片；三种角色在同一份说明里讲清楚 */
const PHOTO = 'img/c02_t02_menu.jpg';
const DETAIL_SHOP = '2026-10-22 现场拍摄韩小面门头（招牌含「重庆风味」）与价目表；楼层由同一张照片可见，未单独拍楼层指引牌';
const DETAIL_FLOOR = '楼层依据：窗口门头照可见该窗口位于三楼层的第二层（未单独拍指引牌，见待补清单）';
const DETAIL_STALL = '2026-10-22 现场拍摄韩小面价目表（含汤面 / 拌面 / 清汤 / 小吃四栏与店长提示）';
const DETAIL_DISH = '2026-10-22 现场价目表抄录';

/* 12 道菜：菜名、价格、主食类型、口味（麻辣→spicy，含辣→mild_spicy，其余→choice） */
const DISHES = [
  ['c02_d060', '重庆小面（素）', 7, 'noodle', 'spicy'],
  ['c02_d061', '杂酱面（素）', 9, 'noodle', 'choice'],
  ['c02_d062', '招牌豌杂面（素）', 11, 'noodle', 'choice'],
  ['c02_d063', '酸菜面（素）', 8, 'noodle', 'choice'],
  ['c02_d064', '牛肉面（荤）', 15, 'noodle', 'choice'],
  ['c02_d065', '干拌小面（素）', 7, 'noodle', 'spicy'],
  ['c02_d066', '干拌杂酱面（素）', 9, 'noodle', 'choice'],
  ['c02_d067', '干拌豌杂面（素）', 11, 'noodle', 'choice'],
  ['c02_d068', '清汤小面', 7, 'noodle', 'choice'],
  ['c02_d069', '清汤杂酱面', 9, 'noodle', 'choice'],
  ['c02_d070', '清汤豌杂面', 11, 'noodle', 'choice'],
  ['c02_d071', '麻酱凉面', 8, 'noodle', 'choice']
];

function cell(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function writeCsv(file, header, rows) {
  const lines = [header.map(cell).join(',')];
  rows.forEach(function (r) { lines.push(r.map(cell).join(',')); });
  fs.writeFileSync(path.join(OUT_DIR, file), lines.join('\n') + '\n', 'utf8');
  return rows.length;
}

function main() {
  fs.mkdirSync(path.join(OUT_DIR, 'img'), { recursive: true });
  const src = path.join(SRC_IMG, 'c02_t02_menu.jpg');
  if (!fs.existsSync(src)) {
    console.error('缺少源照片：' + src + '（先跑 gen_batch1.js 或手动放入）');
    process.exit(2);
  }
  fs.copyFileSync(src, path.join(OUT_DIR, 'img', 'c02_t02_menu.jpg'));

  const shopRows = [[
    'c02', '三餐', 'campus', '第三餐厅', '三餐 · 2 楼最西侧',
    'field', DETAIL_SHOP, '', COLLECTOR, COLLECT_DATE, PHOTO
  ]];
  const floorRows = [[
    'c02', 'c02_f2', '2 楼',
    'field', DETAIL_FLOOR, '', COLLECTOR, COLLECT_DATE, PHOTO
  ]];
  const stallRows = [[
    'c02', 'c02_f2', 'c02_t02', '韩小面',
    'west', 'unverified', '',
    'field', DETAIL_STALL, '', COLLECTOR, COLLECT_DATE, PHOTO
  ]];
  const dishRows = DISHES.map(function (d) {
    return [
      d[0], d[1], '菜品', 'c02', 'c02_t02', d[2], d[3], d[4],
      'field', DETAIL_DISH, '', COLLECTOR, COLLECT_DATE, PHOTO
    ];
  });

  const n1 = writeCsv('shops.csv',
    ['shop_id', 'shop_name', 'area', 'building', 'location', 'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'],
    shopRows);
  const n2 = writeCsv('floors.csv',
    ['shop_id', 'floor_id', 'floor_label', 'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'],
    floorRows);
  const n3 = writeCsv('stalls.csv',
    ['shop_id', 'floor_id', 'stall_id', 'stall_name', 'side', 'no_status', 'no', 'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'],
    stallRows);
  const n4 = writeCsv('dishes.csv',
    ['dish_id', 'dish_name', 'record_type', 'shop_id', 'stall_id', 'price', 'food_type', 'tastes', 'source_kind', 'source_detail', 'source_ref', 'collector', 'collect_date', 'evidence_file'],
    dishRows);

  console.log('已写入 ' + OUT_DIR);
  console.log('  店铺 ' + n1 + ' / 楼层 ' + n2 + ' / 窗口 ' + n3 + ' / 菜品 ' + n4);
  const tally = {};
  dishRows.forEach(function (r) { tally[r[7]] = (tally[r[7]] || 0) + 1; });
  console.log('  口味：' + Object.keys(tally).map(function (k) { return k + ' ' + tally[k]; }).join(' / '));
}

main();
