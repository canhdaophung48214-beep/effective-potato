/**
 * 【演示数据】餐厅 / 商家名录（三级地点结构）
 *
 * ⚠️ 重要声明：以下全部是虚构的演示名称，不对应山东理工大学或周边任何真实餐厅、
 *    真实楼层、真实窗口。它们只用于跑通功能，正式上线前必须整体替换。
 *
 * 字段说明：
 *   id        餐厅唯一标识，菜品通过 shopId 关联
 *   name      餐厅 / 商家名称（演示名）
 *   area      就餐区域：'campus' = 校内食堂，'offsite' = 校外周边
 *   building  所属建筑 / 片区（演示）
 *   location  位置描述（演示）
 *   floors    该餐厅真实配置的楼层。**空数组表示这家没有楼层划分**，
 *             页面会自动跳过楼层这一级，不会强迫用户选楼层。
 *             楼层 id 全局唯一，格式 shopId_fN，方便直接拿去做筛选。
 *   stalls    该餐厅配置的窗口 / 档口。每个窗口属于一个楼层（floorId）。
 *             如果这家没有楼层划分，floorId 留空字符串 ''。
 *             校外商家同样用 stalls 表达「档口 / 区域」，但不配楼层。
 *
 * 换成真实数据的做法：只改这个文件，把 id / name / building / location /
 * floors / stalls 换成真实值即可，页面代码一行都不用动。
 */
const SHOPS_RAW = [
  /* ==================== 校内食堂（演示） ==================== */
  {
    id: 's01',
    name: '一号食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 一号食堂（演示位置）',
    floors: [
      { id: 's01_f1', label: '1 楼' },
      { id: 's01_f2', label: '2 楼' }
    ],
    stalls: [
      { id: 's01_t1', floorId: 's01_f1', name: '1 号窗口' },
      { id: 's01_t2', floorId: 's01_f2', name: '2 号窗口' },
      { id: 's01_t3', floorId: 's01_f2', name: '5 号窗口' }
    ]
  },
  {
    id: 's02',
    name: '二号食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 二号食堂（演示位置）',
    floors: [
      { id: 's02_f1', label: '1 楼' }
    ],
    stalls: [
      { id: 's02_t1', floorId: 's02_f1', name: '1 号窗口' },
      { id: 's02_t2', floorId: 's02_f1', name: '9 号窗口' }
    ]
  },
  {
    id: 's03',
    name: '三号食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 三号食堂（演示位置）',
    floors: [
      { id: 's03_f1', label: '1 楼' },
      { id: 's03_f2', label: '2 楼' }
    ],
    stalls: [
      { id: 's03_t1', floorId: 's03_f1', name: '1 号窗口' },
      { id: 's03_t2', floorId: 's03_f1', name: '3 号窗口' },
      { id: 's03_t3', floorId: 's03_f2', name: '7 号窗口' }
    ]
  },
  {
    id: 's04',
    name: '清真食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 清真食堂（演示位置）',
    floors: [
      { id: 's04_f1', label: '1 楼' }
    ],
    stalls: [
      { id: 's04_t1', floorId: 's04_f1', name: '1 号窗口' },
      { id: 's04_t2', floorId: 's04_f1', name: '2 号窗口' },
      { id: 's04_t3', floorId: 's04_f1', name: '3 号窗口' }
    ]
  },
  {
    /* 这家故意不配楼层，用来验证「没有楼层划分的餐厅不能被强制要求选楼层」 */
    id: 's05',
    name: '东区食堂',
    area: 'campus',
    building: '东区',
    location: '东校区 · 东区食堂（演示位置）',
    floors: [],
    stalls: [
      { id: 's05_t1', floorId: '', name: '基本灶' },
      { id: 's05_t2', floorId: '', name: '面食档' },
      { id: 's05_t3', floorId: '', name: '川档' }
    ]
  },
  {
    id: 's06',
    name: '教工食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 教工食堂（演示位置）',
    floors: [
      { id: 's06_f1', label: '1 楼' }
    ],
    stalls: [
      { id: 's06_t1', floorId: 's06_f1', name: '热菜窗口' }
    ]
  },

  /* ==================== 校外周边（演示） ====================
     校外没有楼层概念，floors 一律为空数组，只用 stalls 表达档口 / 区域 */
  {
    id: 's07',
    name: '南门烧烤摊',
    area: 'offsite',
    building: '南门沿街',
    location: '西校区南门 · 沿街（演示位置）',
    floors: [],
    stalls: [
      { id: 's07_t1', floorId: '', name: '烧烤区' },
      { id: 's07_t2', floorId: '', name: '主食区' }
    ]
  },
  {
    id: 's08',
    name: '西门卤肉饭',
    area: 'offsite',
    building: '西门沿街',
    location: '西校区西门 · 沿街（演示位置）',
    floors: [],
    stalls: [
      { id: 's08_t1', floorId: '', name: '前台' }
    ]
  },
  {
    id: 's09',
    name: '北门川菜馆',
    area: 'offsite',
    building: '北门小吃街',
    location: '西校区北门 · 小吃街（演示位置）',
    floors: [],
    stalls: [
      { id: 's09_t1', floorId: '', name: '散座' },
      { id: 's09_t2', floorId: '', name: '外带档' }
    ]
  },
  {
    id: 's10',
    name: '东门牛肉面',
    area: 'offsite',
    building: '东门沿街',
    location: '东校区东门（演示位置）',
    floors: [],
    stalls: [
      { id: 's10_t1', floorId: '', name: '出餐口' }
    ]
  },
  {
    id: 's11',
    name: '黄焖鸡店',
    area: 'offsite',
    building: '南门沿街',
    location: '西校区南门（演示位置）',
    floors: [],
    stalls: [
      { id: 's11_t1', floorId: '', name: '出餐口' }
    ]
  },
  {
    id: 's12',
    name: '小吃店',
    area: 'offsite',
    building: '西门沿街',
    location: '西校区西门（演示位置）',
    floors: [],
    stalls: [
      { id: 's12_t1', floorId: '', name: '前台' },
      { id: 's12_t2', floorId: '', name: '蒸煮档' }
    ]
  }
];

/* ------------------------------------------------------------------
   可信度字段注入
   餐厅、楼层、窗口三层各自带 source / verifyStatus / verifiedAt，
   本阶段全部是课程演示数据，因此统一标为 demo，且 verifiedAt 一律为 null
   （演示不是核实，不给它编造一个核实时间）。
   将来换成真实数据时，只要在对应记录里显式写 verifyStatus，attachDemoShops
   会原样保留，不会被这里的默认值覆盖。
   ------------------------------------------------------------------ */
const { attachDemoShops } = require('./provenance');
const SHOPS = attachDemoShops(SHOPS_RAW);

module.exports = { SHOPS };
