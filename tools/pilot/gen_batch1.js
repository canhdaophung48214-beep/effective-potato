/**
 * 首批真实单品采集 · CSV 生成器（Batch 1）
 *
 * 用途：把 `tools/pilot/TRANSCRIPTION_DRAFT.md` 里已确认的 3 店 / 7 窗口 / 82 道单品
 *       写成 import_data.js 认的四张表（shops / floors / stalls / dishes）。
 *
 * 数据来源：
 *   · c01 服务楼 2 楼西区：产品负责人 2026-10-22 现场口述（source_kind = field）
 *   · c02 三餐 2 楼最西侧：现场价目表照片（source_kind = field）
 *   · c03 四餐 2 楼南门：现场价目表照片（source_kind = field）
 *
 * 刻意不写入（「没看清的先不写入」）：
 *   · 面發發「豇豆肉碎面」（第 7 项字迹存疑）
 *   · 泰卤「泰式咖喱鸡」「春浓茄丁」（名称存疑）
 *   · 全部加料 / 卤味（32 项，另 4 项未标价）、全部套餐（3 项）
 *
 * 辣度规则（与 data/dishes.js 规约 1 一致）：
 *   · 菜名含「麻辣」→ spicy；含「辣」但不含「麻辣」→ mild_spicy
 *   · 其余 → choice（辣度可自选；用户已说明「大部分可以自主选择」）
 *
 * 运行：node tools/pilot/gen_batch1.js
 * 只写 tools/pilot/batch1/ 下的四张 CSV，不碰 data/ 与云端。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'batch1');
const COLLECT_DATE = '2026-10-22';
const COLLECTOR = '产品负责人';

/* ---------------- 三店七窗的结构 ---------------- */

const SHOPS = [
  {
    id: 'c01',
    name: '服务楼',
    building: '服务楼',
    location: '服务楼 · 2 楼西区',
    detail: '2026-10-22 现场查看三个窗口的价目表，价格与菜名由现场人员口述整理',
    floors: [{ id: 'c01_f2', label: '2 楼' }],
    stalls: [
      { id: 'c01_t01', floorId: 'c01_f2', name: '猪脚饭 · 面', side: 'west' },
      { id: 'c01_t02', floorId: 'c01_f2', name: '月亮馍 · 杂粮煎饼', side: 'west' },
      { id: 'c01_t03', floorId: 'c01_f2', name: '朱家小馆', side: 'west' }
    ]
  },
  {
    id: 'c02',
    name: '三餐',
    building: '第三餐厅',
    location: '三餐 · 2 楼最西侧',
    detail: '2026-10-22 现场拍摄三个窗口的价目表照片',
    floors: [{ id: 'c02_f2', label: '2 楼' }],
    stalls: [
      { id: 'c02_t01', floorId: 'c02_f2', name: '面發發小館 · 羊杂面', side: 'west' },
      { id: 'c02_t02', floorId: 'c02_f2', name: '韩小面', side: 'west' },
      { id: 'c02_t03', floorId: 'c02_f2', name: '校园铁板牛排 · 意面披萨', side: 'west' }
    ]
  },
  {
    id: 'c03',
    name: '四餐',
    building: '第四餐厅',
    location: '四餐 · 2 楼南门正门口',
    detail: '2026-10-22 现场拍摄窗口价目表照片',
    floors: [{ id: 'c03_f2', label: '2 楼' }],
    stalls: [
      { id: 'c03_t01', floorId: 'c03_f2', name: '卤大姨 · 泰卤干饭局', side: 'south' }
    ]
  }
];

/* ---------------- 82 道单品（菜名, 价格） ---------------- */

const DISHES = [
  /* c01_t01 猪脚饭 · 面：8 */
  ['c01_t01', '招牌猪脚饭', 15, 'rice'],
  ['c01_t01', '红烧肉盖饭', 15, 'rice'],
  ['c01_t01', '台式卤肉饭', 13, 'rice'],
  ['c01_t01', '辣子鸡盖饭', 13, 'rice'],
  ['c01_t01', '蜜汁叉烧饭', 13, 'rice'],
  ['c01_t01', '香辣鸡杂饭', 13, 'rice'],
  ['c01_t01', '卤肉面', 12, 'noodle'],
  ['c01_t01', '肉酱拌面', 12, 'noodle'],

  /* c01_t02 月亮馍 · 杂粮煎饼：8（价格随加的蛋白不同，按规约拆行） */
  ['c01_t02', '月亮馍（加烤肠）', 5, 'snack'],
  ['c01_t02', '月亮馍（加煎蛋）', 5, 'snack'],
  ['c01_t02', '月亮馍（加辣条）', 5, 'snack'],
  ['c01_t02', '月亮馍（加鸡柳）', 6.5, 'snack'],
  ['c01_t02', '月亮馍（加里脊）', 6.5, 'snack'],
  ['c01_t02', '月亮馍（加肉松）', 6.5, 'snack'],
  ['c01_t02', '杂粮煎饼（加鸡蛋脆饼）', 5, 'snack'],
  ['c01_t02', '杂粮煎饼（加鸡蛋油条）', 5, 'snack'],

  /* c01_t03 朱家小馆：23 */
  ['c01_t03', '特色羊杂面', 11, 'noodle'],
  ['c01_t03', '辣肉面', 11, 'noodle'],
  ['c01_t03', '鸡柳面', 12, 'noodle'],
  ['c01_t03', '猪排面', 13, 'noodle'],
  ['c01_t03', '卤肉面', 14, 'noodle'],
  ['c01_t03', '筋头巴脑牛肉面', 14, 'noodle'],
  ['c01_t03', '肉燥汤面', 9, 'noodle'],
  ['c01_t03', '酸豆角汤面', 9, 'noodle'],
  ['c01_t03', '酸菜汤面', 9, 'noodle'],
  ['c01_t03', '清汤面', 7, 'noodle'],
  ['c01_t03', '辣肉拌面', 11, 'noodle'],
  ['c01_t03', '鸡柳麻辣拌面', 12, 'noodle'],
  ['c01_t03', '猪排麻酱面', 13, 'noodle'],
  ['c01_t03', '麻酱鸡丝面', 10, 'noodle'],
  ['c01_t03', '麻酱肉燥面', 10, 'noodle'],
  ['c01_t03', '麻酱酸豆角面', 10, 'noodle'],
  ['c01_t03', '麻酱酸菜面', 10, 'noodle'],
  ['c01_t03', '猪排麻辣面', 13, 'noodle'],
  ['c01_t03', '麻辣拌面', 9, 'noodle'],
  ['c01_t03', '混合炸酱面', 10, 'noodle'],
  ['c01_t03', '鸡蛋炸酱面', 9, 'noodle'],
  ['c01_t03', '招牌炸酱面', 10, 'noodle'],
  ['c01_t03', '辣番茄鸡蛋拌面', 10, 'noodle'],

  /* c02_t01 面發發小館 · 羊杂面：20（原 21，去掉字迹存疑的「豇豆肉碎面」） */
  ['c02_t01', '特色羊杂面', 11, 'noodle'],
  ['c02_t01', '辣肉汤面', 11, 'noodle'],
  ['c02_t01', '小苏肉汤面', 11, 'noodle'],
  ['c02_t01', '卤肉汤面', 11, 'noodle'],
  ['c02_t01', '肉臊汤面', 10, 'noodle'],
  ['c02_t01', '老坛酸菜汤面', 9, 'noodle'],
  ['c02_t01', '清汤面', 7, 'noodle'],
  ['c02_t01', '辣肉拌面', 11, 'noodle'],
  ['c02_t01', '小苏肉拌面', 11, 'noodle'],
  ['c02_t01', '麻辣鸡丝拌面', 11, 'noodle'],
  ['c02_t01', '肉臊拌面', 10, 'noodle'],
  ['c02_t01', '豇豆拌面', 9, 'noodle'],
  ['c02_t01', '老坛酸菜拌面', 9, 'noodle'],
  ['c02_t01', '火腿拌面', 9, 'noodle'],
  ['c02_t01', '麻辣拌面', 7, 'noodle'],
  ['c02_t01', '麻汁拌面', 7, 'noodle'],
  ['c02_t01', '招牌炸酱面', 10, 'noodle'],
  ['c02_t01', '肉酱炸酱面', 10, 'noodle'],
  ['c02_t01', '鸡蛋炸酱面', 9, 'noodle'],
  ['c02_t01', '双拼炸酱面', 10, 'noodle'],

  /* c02_t02 韩小面：12 */
  ['c02_t02', '重庆小面（素）', 7, 'noodle'],
  ['c02_t02', '杂酱面（素）', 9, 'noodle'],
  ['c02_t02', '招牌豌杂面（素）', 11, 'noodle'],
  ['c02_t02', '酸菜面（素）', 8, 'noodle'],
  ['c02_t02', '牛肉面（荤）', 15, 'noodle'],
  ['c02_t02', '干拌小面（素）', 7, 'noodle'],
  ['c02_t02', '干拌杂酱面（素）', 9, 'noodle'],
  ['c02_t02', '干拌豌杂面（素）', 11, 'noodle'],
  ['c02_t02', '清汤小面', 7, 'noodle'],
  ['c02_t02', '清汤杂酱面', 9, 'noodle'],
  ['c02_t02', '清汤豌杂面', 11, 'noodle'],
  ['c02_t02', '麻酱凉面', 8, 'noodle'],

  /* c02_t03 校园铁板牛排 · 意面披萨：3（三个套餐按 record_type 规则不录） */
  ['c02_t03', '德式烤肠意大利面', 9.9, 'noodle'],
  ['c02_t03', '培根意大利面', 9.9, 'noodle'],
  ['c02_t03', '虾仁意大利面', 9.9, 'noodle'],

  /* c03_t01 卤大姨 · 泰卤干饭局：8（原 10，去掉名称存疑的「泰式咖喱鸡」「春浓茄丁」） */
  ['c03_t01', '泰式榴莲鸡', 13, 'rice'],
  ['c03_t01', '招牌红烧肉', 14, 'rice'],
  ['c03_t01', '黄金脆皮鸡', 18, 'rice'],
  ['c03_t01', '麻辣干锅鸡', 18, 'rice'],
  ['c03_t01', '青柠黑椒鸡丁', 18, 'rice'],
  ['c03_t01', '辣条鸡丁', 18, 'rice'],
  ['c03_t01', '贵妃荔枝鸡', 18, 'rice'],
  ['c03_t01', '巴西烤肉饭', 12, 'rice']
];

/* ---------------- 辣度推断（可审计的规则，不凭印象） ---------------- */

function tasteOf(name) {
  if (name.indexOf('麻辣') !== -1) return 'spicy';
  if (name.indexOf('辣') !== -1) return 'mild_spicy';
  return 'choice';
}

/* ---------------- CSV 输出 ---------------- */

function cell(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
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

  const shopRows = [];
  const floorRows = [];
  const stallRows = [];
  SHOPS.forEach(function (s) {
    shopRows.push([
      s.id, s.name, 'campus', s.building, s.location,
      'field', s.detail, '',
      COLLECTOR, COLLECT_DATE, 'img/' + s.id + '_sign.jpg'
    ]);
    s.floors.forEach(function (f) {
      floorRows.push([
        s.id, f.id, f.label,
        'field', s.detail, '',
        COLLECTOR, COLLECT_DATE, 'img/' + f.id + '_floor.jpg'
      ]);
    });
    s.stalls.forEach(function (t) {
      stallRows.push([
        s.id, t.floorId, t.id, t.name,
        t.side || '', 'unverified', '',
        'field', s.detail, '',
        COLLECTOR, COLLECT_DATE, 'img/' + t.id + '_menu.jpg'
      ]);
    });
  });

  const dishRows = DISHES.map(function (d, i) {
    const stallId = d[0];
    const shopId = stallId.split('_')[0];
    const seq = String(i + 1).padStart(3, '0');
    const dishId = shopId + '_d' + seq;
    return [
      dishId, d[1], '菜品', shopId, stallId, d[2], d[3], tasteOf(d[1]),
      'field', '2026-10-22 现场价目表抄录', '',
      COLLECTOR, COLLECT_DATE, 'img/' + stallId + '_menu.jpg'
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
  console.log('  shops.csv   ' + n1 + ' 行');
  console.log('  floors.csv  ' + n2 + ' 行');
  console.log('  stalls.csv  ' + n3 + ' 行');
  console.log('  dishes.csv  ' + n4 + ' 行（菜品 ' + n4 + ' 道）');

  const tally = {};
  dishRows.forEach(function (r) { tally[r[7]] = (tally[r[7]] || 0) + 1; });
  console.log('  口味分布：' + Object.keys(tally).map(function (k) { return k + ' ' + tally[k]; }).join(' / '));
}

main();
