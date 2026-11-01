#!/usr/bin/env node
/**
 * 只读数据校验：检查 data/shops.js 与 data/dishes.js 是否满足本项目的既有数据约束。
 *
 * 三条硬约束（本工具的边界）：
 *   1. 只读。本脚本只 require 数据模块 + 读文件，不写任何文件、不改任何数据。
 *   2. 只报告，不修复。发现问题不降级、不补默认值、不改写枚举。
 *   3. 规则只来自现有代码与数据文件注释；代码里没有明确规定的地方，
 *      一律只报「警告」并在报告里注明依据，不擅自发明规则。
 *
 * 规则清单（编号即报告里的 rule 字段）：
 *   S1 店铺必填 id/name/area          data/shops.js:7-21
 *   S2 area 枚举                        data/index.js:23-26
 *   S3 店铺 id 唯一                     data/index.js:52-55（shopMap 以 id 为键，重复会静默覆盖）
 *   F1 楼层必填 id/label                data/shops.js:13-15
 *   F2 楼层 id 全局唯一                 data/shops.js:15（楼层 id 直接用于筛选）
 *   F3 楼层 shopId 与所属店铺一致        data/provenance.js:344-347
 *   T1 窗口必填 id/name                data/index.js:144-151
 *   T2 窗口 id 全局唯一                 data/dishes.js:12（dish.stallId 直接引用）
 *   T3 窗口 floorId 归属正确            data/shops.js:16-18
 *   T4 窗口 side 枚举                   data/index.js:64-65
 *   T5 窗口 noStatus 枚举               data/index.js:66-68
 *   T6 noStatus === 'has' 必须给编号     data/index.js:133-141
 *   D1 菜品必填字段                     data/dishes.js:7-13
 *   D2 菜品 id 唯一                     data/dishes.js:7
 *   D3 dish.shopId 存在                 data/index.js:116
 *   D4 dish.stallId 属于该店铺           data/dishes.js:12
 *   D5 价格为有限正数、最多一位小数；超过 100 元只报「复核警告」，不判错（A3 决策）
 *   D6 foodType ∈ 八枚举                data/dishes.js:15-23
 *   D7 tastes 0..1 个且为合法枚举       docs/RECORD_GENERATOR_CONTRACT_20261023.md:332（含 choice 可选辣度）
 *   D8 自然键重复（shopId+stallId+name+price）
 *   P1 verifyStatus 枚举                data/provenance.js:31
 *   P2 source 结构                      data/provenance.js:115-123
 *   P3 demo 一致性（演示优先）           data/provenance.js:381-396
 *   P4 verified/expired 的证据要求       data/provenance.js:233-239
 *   P5 verifiedAt 格式/日历/不晚于今天    data/provenance.js:149-180
 *   P6 演示数据集出现非 demo 状态（依据 data/shops.js:2-5、data/dishes.js:2-4 的声明）
 *   J1 join 后展示字段必须齐全           data/index.js:209-292
 *   J3/J4 店铺没有窗口 / 没有菜品（警告）  data/index.js:293-374
 *
 * 用法：
 *   node tools/verify_data.js          报告前 20 条错误
 *   node tools/verify_data.js --all    报告全部错误
 *
 * 退出码：0 = 无错误（允许有警告）；1 = 存在错误
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* 数据模块：require 即只读加载，模块内部不产生副作用 */
const { SHOPS } = require('../data/shops');
const { DISHES } = require('../data/dishes');
const provenance = require('../data/provenance');
const dataLayer = require('../data/index');

/* ================================================================
   枚举：一律从现有代码取键，避免「校验工具里有第二套枚举」导致规则漂移
   ================================================================ */

const AREA_VALUES = Object.keys(dataLayer.AREA_LABEL);            /* campus / offsite */
const TASTE_VALUES = Object.keys(dataLayer.TASTE_LABEL);          /* light / mild_spicy / spicy / choice */
const FOOD_TYPE_VALUES = Object.keys(dataLayer.FOOD_TYPE_LABEL);  /* 八种，无 'all' */
const SIDE_VALUES = dataLayer.SIDE_ORDER.slice();                 /* east / south / west / north */
const NO_STATUS_VALUES = [
  dataLayer.STALL_NO_STATUS.HAS,
  dataLayer.STALL_NO_STATUS.NONE,
  dataLayer.STALL_NO_STATUS.UNVERIFIED
];

const V = provenance.VERIFY_STATUS;
const STATUS_VALUES = [V.DEMO, V.UNVERIFIED, V.VERIFIED, V.EXPIRED];
const KIND_VALUES = provenance.KIND_VALUES;
const EVIDENCE_KINDS = provenance.EVIDENCE_KINDS;
/* data/provenance.js 内部的 REF_REQUIRED_KINDS 未导出，这里按同一份定义复述；
   规则变化时会在 P4 的测试里暴露（realData 断言 + 反例）。 */
const REF_REQUIRED_KINDS = ['web'];

const PRICE_MAX = 100;   /* 人工复核阈值：超过它只报警告、不判错。A3 决策已取消固定最高价 */

/* ================================================================
   小工具
   ================================================================ */

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isFinitePositive(v) {
  return typeof v === 'number' && isFinite(v) && v > 0;
}

function hasAtMostOneDecimal(v) {
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
}

function fmt(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}

function listOf(v) {
  return v === undefined ? 'undefined' : '[' + v.join(' / ') + ']';
}

/* ================================================================
   校验主体
   ================================================================ */

/**
 * 校验一份数据集。纯函数，不读文件、不写文件，便于测试注入坏数据。
 *
 * @param {object} dataset { shops, dishes }
 * @param {object} options { today, declaredDemo, checkJoin }
 *        today        校验基准日（默认今天），用于 verifiedAt 不能是未来
 *        declaredDemo 该数据集是否自称「演示数据」（默认 false）
 *        checkJoin    是否核对 join 后的展示字段（默认 false，见 J1）
 *
 *        checkJoin 的语义边界（重要）：J1 拿的是**仓库当前数据层**
 *        （data/index.js 的 ALL_DISHES）去 join，不是拿你传进来的 dataset。
 *        所以它只能回答「仓库里现存的数据 join 之后字段齐不齐」；
 *        若把「只有新增记录、尚未合并进 data/」的数据直接传进来再开 checkJoin，
 *        每条新增菜品都会报 J1「join 后找不到该菜品」——这是用法错误，
 *        不是新增数据有问题。校验新增记录请用 checkJoin: false
 *        （tools/import_data.js 内部就是这么做的）。
 * @return {{errors:Array, warnings:Array, stats:object}}
 */
function validateDataset(dataset, options) {
  const opts = options || {};
  const shops = (dataset && dataset.shops) || [];
  const dishes = (dataset && dataset.dishes) || [];
  const today = opts.today || provenance.todayString();
  const declaredDemo = opts.declaredDemo === true;

  const errors = [];
  const warnings = [];

  function err(rule, table, id, field, value, reason) {
    errors.push({ rule: rule, table: table, id: String(id), field: field, value: fmt(value), reason: reason });
  }
  function warn(rule, table, id, field, value, reason) {
    warnings.push({ rule: rule, table: table, id: String(id), field: field, value: fmt(value), reason: reason });
  }

  const stat = {
    shops: shops.length,
    floors: 0,
    stalls: 0,
    dishes: dishes.length
  };

  /* ---------- 店铺 / 楼层 / 窗口 ---------- */

  const shopIds = {};
  const floorIds = {};
  const stallIds = {};
  const shopById = {};

  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i] || {};
    const sid = isNonEmptyString(shop.id) ? shop.id : '(缺少 id 的店铺 #' + (i + 1) + ')';

    /* S1 必填 */
    if (!isNonEmptyString(shop.id)) err('S1', 'shop', sid, 'id', shop.id, '店铺必须有非空字符串 id');
    if (!isNonEmptyString(shop.name)) err('S1', 'shop', sid, 'name', shop.name, '店铺必须有非空字符串 name');
    if (!isNonEmptyString(shop.area)) err('S1', 'shop', sid, 'area', shop.area, '店铺必须有 area');

    /* S2 area 枚举 */
    if (isNonEmptyString(shop.area) && AREA_VALUES.indexOf(shop.area) === -1) {
      err('S2', 'shop', sid, 'area', shop.area, '不属于允许值 ' + listOf(AREA_VALUES));
    }

    /* S3 id 唯一 */
    if (isNonEmptyString(shop.id)) {
      if (shopIds[shop.id]) {
        err('S3', 'shop', sid, 'id', shop.id, '店铺 id 重复（shopMap 以 id 为键，重复会静默覆盖前一条）');
      } else {
        shopIds[shop.id] = true;
        shopById[shop.id] = shop;
      }
    }

    const floors = Array.isArray(shop.floors) ? shop.floors : [];
    const stalls = Array.isArray(shop.stalls) ? shop.stalls : [];
    stat.floors += floors.length;
    stat.stalls += stalls.length;

    const floorIdSet = {};
    for (let j = 0; j < floors.length; j++) {
      const floor = floors[j] || {};
      const fid = isNonEmptyString(floor.id) ? floor.id : '(缺少 id 的楼层 @' + sid + ' #' + (j + 1) + ')';

      if (!isNonEmptyString(floor.id)) err('F1', 'floor', fid, 'id', floor.id, '楼层必须有非空字符串 id');
      if (!isNonEmptyString(floor.label)) err('F1', 'floor', fid, 'label', floor.label, '楼层必须有非空字符串 label');

      if (isNonEmptyString(floor.id)) {
        if (floorIds[floor.id]) {
          err('F2', 'floor', fid, 'id', floor.id, '楼层 id 全局重复（级联按 floorId 全局比对）');
        } else {
          floorIds[floor.id] = true;
          floorIdSet[floor.id] = true;
        }
      }

      if (floor.shopId !== undefined && isNonEmptyString(floor.shopId) && floor.shopId !== shop.id) {
        err('F3', 'floor', fid, 'shopId', floor.shopId, '楼层 shopId 与所属店铺 ' + fmt(shop.id) + ' 不一致');
      }
    }

    if (!stalls.length) {
      warn('J3', 'shop', sid, 'stalls', '[]', '店铺没有配置任何窗口／档口，前端选到该店时窗口级为空');
    }

    for (let k = 0; k < stalls.length; k++) {
      const stall = stalls[k] || {};
      const tid = isNonEmptyString(stall.id) ? stall.id : '(缺少 id 的窗口 @' + sid + ' #' + (k + 1) + ')';

      /* T1 必填 */
      if (!isNonEmptyString(stall.id)) err('T1', 'stall', tid, 'id', stall.id, '窗口必须有非空字符串 id');
      if (!isNonEmptyString(stall.name)) err('T1', 'stall', tid, 'name', stall.name, '窗口必须有非空字符串 name');

      /* T2 唯一 */
      if (isNonEmptyString(stall.id)) {
        if (stallIds[stall.id]) {
          err('T2', 'stall', tid, 'id', stall.id, '窗口 id 全局重复');
        } else {
          stallIds[stall.id] = true;
        }
      }

      /* T3 floorId 归属 */
      const fid2 = stall.floorId;
      if (floors.length === 0) {
        if (fid2 !== undefined && fid2 !== null && fid2 !== '') {
          err('T3', 'stall', tid, 'floorId', fid2,
            '该店铺 floors 为空（无楼层划分），窗口 floorId 必须为空');
        }
      } else {
        if (!isNonEmptyString(fid2)) {
          err('T3', 'stall', tid, 'floorId', fid2,
            '该店铺有楼层划分，窗口必须指向其中一个楼层 id');
        } else if (!floorIdSet[fid2]) {
          err('T3', 'stall', tid, 'floorId', fid2,
            '窗口 floorId 不属于所属店铺 ' + fmt(shop.id) + ' 的楼层 ' + listOf(Object.keys(floorIdSet)));
        }
      }

      /* T4 side 枚举（可选字段，缺省合法） */
      if (stall.side !== undefined && stall.side !== null && stall.side !== '') {
        if (SIDE_VALUES.indexOf(stall.side) === -1) {
          err('T4', 'stall', tid, 'side', stall.side, '方位不在 ' + listOf(SIDE_VALUES) + ' 内（缺省表示未采集）');
        }
      }

      /* T5 noStatus 枚举（可选字段，缺省按 unverified 处理） */
      if (stall.noStatus !== undefined && stall.noStatus !== null && stall.noStatus !== '') {
        if (NO_STATUS_VALUES.indexOf(stall.noStatus) === -1) {
          err('T5', 'stall', tid, 'noStatus', stall.noStatus, '编号状态不在 ' + listOf(NO_STATUS_VALUES) + ' 内');
        }
      }

      /* T6 has 必须给编号；非 has 不该带编号 */
      const hasNo = stall.no !== undefined && stall.no !== null && String(stall.no).trim() !== '';
      if (stall.noStatus === dataLayer.STALL_NO_STATUS.HAS && !hasNo) {
        err('T6', 'stall', tid, 'no', stall.no,
          'noStatus 声明有编号却没给 no —— 前端会静默降级为「尚未核实」，等于数据丢失');
      }
      if (stall.noStatus !== undefined && stall.noStatus !== dataLayer.STALL_NO_STATUS.HAS && hasNo) {
        warn('T6', 'stall', tid, 'no', stall.no,
          'noStatus 不是 has 却带了编号；前端只在 has 时读取 no，该值不会显示（依据 data/index.js:133）');
      }
    }
  }

  /* ---------- 菜品 ---------- */

  const dishIds = {};
  const naturalKeys = {};

  for (let i = 0; i < dishes.length; i++) {
    const dish = dishes[i] || {};
    const did = isNonEmptyString(dish.id) ? dish.id : '(缺少 id 的菜品 #' + (i + 1) + ')';

    /* D1 必填 */
    if (!isNonEmptyString(dish.id)) err('D1', 'dish', did, 'id', dish.id, '菜品必须有非空字符串 id');
    if (!isNonEmptyString(dish.name)) err('D1', 'dish', did, 'name', dish.name, '菜品必须有非空字符串 name');
    if (dish.price === undefined || dish.price === null) {
      err('D1', 'dish', did, 'price', dish.price, '菜品必须给出 price（缺价格时预算筛选会静默漏掉这道菜）');
    }
    if (!isNonEmptyString(dish.foodType)) err('D1', 'dish', did, 'foodType', dish.foodType, '菜品必须有 foodType');
    if (!isNonEmptyString(dish.shopId)) err('D1', 'dish', did, 'shopId', dish.shopId, '菜品必须有 shopId');
    if (!isNonEmptyString(dish.stallId)) err('D1', 'dish', did, 'stallId', dish.stallId, '菜品必须有 stallId');

    /* D2 id 唯一 */
    if (isNonEmptyString(dish.id)) {
      if (dishIds[dish.id]) err('D2', 'dish', did, 'id', dish.id, '菜品 id 重复');
      else dishIds[dish.id] = true;
    }

    /* D3 shopId 存在 */
    const shop = isNonEmptyString(dish.shopId) ? shopById[dish.shopId] : null;
    if (isNonEmptyString(dish.shopId) && !shop) {
      err('D3', 'dish', did, 'shopId', dish.shopId, '指向不存在的店铺');
    }

    /* D4 stallId 属于该店铺 */
    if (shop && isNonEmptyString(dish.stallId)) {
      const stalls = Array.isArray(shop.stalls) ? shop.stalls : [];
      let found = null;
      for (let k = 0; k < stalls.length; k++) {
        if (stalls[k] && stalls[k].id === dish.stallId) { found = stalls[k]; break; }
      }
      if (!found) {
        err('D4', 'dish', did, 'stallId', dish.stallId,
          '窗口不属于菜品指向的店铺 ' + fmt(dish.shopId) + '（跨店串用会让级联筛选失效）');
      }
    }

    /* D5 价格 */
    if (dish.price !== undefined && dish.price !== null) {
      if (typeof dish.price !== 'number') {
        err('D5', 'dish', did, 'price', dish.price, '价格必须是数字，不能是字符串（"12元"/"12-15" 都要先拆）');
      } else if (!isFinitePositive(dish.price)) {
        err('D5', 'dish', did, 'price', dish.price, '价格必须是有限正数');
      } else {
        if (!hasAtMostOneDecimal(dish.price)) {
          err('D5', 'dish', did, 'price', dish.price, '价格最多一位小数');
        }
        if (dish.price > PRICE_MAX) {
          warn('D5', 'dish', did, 'price', dish.price,
            '价格高于 ¥' + PRICE_MAX + '，属异常价格，需人工复核（不自动判错）');
        }
      }
    }

    /* D6 foodType 枚举 */
    if (isNonEmptyString(dish.foodType) && FOOD_TYPE_VALUES.indexOf(dish.foodType) === -1) {
      err('D6', 'dish', did, 'foodType', dish.foodType, '不属于允许的八种主食类型 ' + listOf(FOOD_TYPE_VALUES) +
        "（'all' 只能出现在筛选器里）");
    }

    /* D7 tastes */
    if (!Array.isArray(dish.tastes)) {
      err('D7', 'dish', did, 'tastes', dish.tastes, '口味必须是数组（现行规约：单元素）');
    } else if (dish.tastes.length > 1) {
      err('D7', 'dish', did, 'tastes', dish.tastes,
        '口味数组最多 1 个（契约 docs/RECORD_GENERATOR_CONTRACT_20261023.md:332 为 string[0..1]：' +
        '辣度是同一维度的互斥档位，[] 表示口味信息未提供）');
    } else if (dish.tastes.length === 1 && TASTE_VALUES.indexOf(dish.tastes[0]) === -1) {
      err('D7', 'dish', did, 'tastes', dish.tastes, '口味值不在 ' + listOf(TASTE_VALUES) + ' 内');
    }

    /* D8 自然键重复 */
    if (isNonEmptyString(dish.shopId) && isNonEmptyString(dish.stallId) &&
      isNonEmptyString(dish.name) && typeof dish.price === 'number') {
      const key = [dish.shopId, dish.stallId, dish.name, dish.price].join('|');
      if (naturalKeys[key]) {
        err('D8', 'dish', did, 'name+price', key,
          '与 ' + naturalKeys[key] + ' 的自然键完全相同（同一窗口同名同价应合并为一条）');
      } else {
        naturalKeys[key] = dish.id;
      }
    }

    /* ---------- 可信度元数据 ---------- */

    /* P1 状态枚举 */
    const status = dish.verifyStatus;
    if (STATUS_VALUES.indexOf(status) === -1) {
      err('P1', 'dish', did, 'verifyStatus', status, '不属于 ' + listOf(STATUS_VALUES));
    }

    /* P2 来源结构 */
    const source = dish.source;
    let kind = '';
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      err('P2', 'dish', did, 'source', source, '缺少 source 对象（无论真假都必须写来源）');
    } else if (KIND_VALUES.indexOf(source.kind) === -1) {
      err('P2', 'dish', did, 'source.kind', source.kind, '来源类型不在 ' + listOf(KIND_VALUES) + ' 内');
    } else {
      kind = source.kind;
    }

    /* P3 demo 一致性 */
    if (kind === 'demo' && status !== V.DEMO) {
      err('P3', 'dish', did, 'verifyStatus', status,
        '来源是演示数据却标成 ' + fmt(status) + '（演示优先：任一 demo 必须整体为 demo）');
    }
    if (kind === 'demo' && dish.verifiedAt !== null && dish.verifiedAt !== undefined) {
      err('P3', 'dish', did, 'verifiedAt', dish.verifiedAt, '演示数据不得带核实时间');
    }

    /* P4 verified / expired 的证据要求 */
    if (status === V.VERIFIED || status === V.EXPIRED) {
      if (kind && EVIDENCE_KINDS.indexOf(kind) === -1) {
        err('P4', 'dish', did, 'source.kind', kind,
          'verified/expired 必须来自证据型来源 ' + listOf(EVIDENCE_KINDS));
      }
      if (!source || !isNonEmptyString(source.detail)) {
        err('P4', 'dish', did, 'source.detail', source && source.detail, 'verified/expired 必须写清来源说明');
      }
      if (kind && REF_REQUIRED_KINDS.indexOf(kind) !== -1 && !isNonEmptyString(source && source.ref)) {
        err('P4', 'dish', did, 'source.ref', source && source.ref, '来源类型 ' + fmt(kind) + ' 必须带 ref');
      }
    }

    /* P5 verifiedAt */
    if (status === V.VERIFIED || status === V.EXPIRED) {
      if (!provenance.isValidDateString(dish.verifiedAt, today)) {
        err('P5', 'dish', did, 'verifiedAt', dish.verifiedAt,
          '必须是合法且不晚于 ' + today + ' 的 YYYY-MM-DD');
      }
    } else if (dish.verifiedAt !== null && dish.verifiedAt !== undefined) {
      err('P5', 'dish', did, 'verifiedAt', dish.verifiedAt,
        '未核实状态（' + fmt(status) + '）不得带核实时间');
    }

    /* P6 演示数据集出现非 demo */
    if (declaredDemo && (status === V.UNVERIFIED || status === V.VERIFIED || status === V.EXPIRED)) {
      err('P6', 'dish', did, 'verifyStatus', status,
        '该数据集在 data/dishes.js:2-4 声明为【演示数据】，出现非 demo 状态即错标');
    }
  }

  /* ---------- 店铺/楼层/窗口 的可信度（同一套 P 规则） ---------- */

  function checkMeta(record, table, id, declaredDemoHere) {
    const status = record.verifyStatus;
    if (STATUS_VALUES.indexOf(status) === -1) {
      err('P1', table, id, 'verifyStatus', status, '不属于 ' + listOf(STATUS_VALUES));
    }
    const source = record.source;
    let kind = '';
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      err('P2', table, id, 'source', source, '缺少 source 对象');
    } else if (KIND_VALUES.indexOf(source.kind) === -1) {
      err('P2', table, id, 'source.kind', source.kind, '来源类型不在 ' + listOf(KIND_VALUES) + ' 内');
    } else {
      kind = source.kind;
    }
    if (kind === 'demo' && status !== V.DEMO) {
      err('P3', table, id, 'verifyStatus', status, '来源是演示数据却标成 ' + fmt(status));
    }
    if (kind === 'demo' && record.verifiedAt !== null && record.verifiedAt !== undefined) {
      err('P3', table, id, 'verifiedAt', record.verifiedAt, '演示数据不得带核实时间');
    }
    if (status === V.VERIFIED || status === V.EXPIRED) {
      if (kind && EVIDENCE_KINDS.indexOf(kind) === -1) {
        err('P4', table, id, 'source.kind', kind, 'verified/expired 必须来自证据型来源');
      }
      if (!source || !isNonEmptyString(source.detail)) {
        err('P4', table, id, 'source.detail', source && source.detail, 'verified/expired 必须写清来源说明');
      }
      if (kind && REF_REQUIRED_KINDS.indexOf(kind) !== -1 && !isNonEmptyString(source && source.ref)) {
        err('P4', table, id, 'source.ref', source && source.ref, '来源类型 ' + fmt(kind) + ' 必须带 ref');
      }
      if (!provenance.isValidDateString(record.verifiedAt, today)) {
        err('P5', table, id, 'verifiedAt', record.verifiedAt,
          '必须是合法且不晚于 ' + today + ' 的 YYYY-MM-DD');
      }
    } else if (record.verifiedAt !== null && record.verifiedAt !== undefined) {
      err('P5', table, id, 'verifiedAt', record.verifiedAt, '未核实状态不得带核实时间');
    }
    /* P6 只针对「合法的非 demo 状态」；状态缺失/非法由 P1 报告，避免同一根因重复计错 */
    if (declaredDemoHere
      && (status === V.UNVERIFIED || status === V.VERIFIED || status === V.EXPIRED)) {
      err('P6', table, id, 'verifyStatus', status, '演示数据集出现非 demo 状态即错标');
    }
  }

  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i] || {};
    const sid = isNonEmptyString(shop.id) ? shop.id : '(缺少 id 的店铺 #' + (i + 1) + ')';
    checkMeta(shop, 'shop', sid, declaredDemo);

    const floors = Array.isArray(shop.floors) ? shop.floors : [];
    const stalls = Array.isArray(shop.stalls) ? shop.stalls : [];
    for (let j = 0; j < floors.length; j++) {
      const f = floors[j] || {};
      checkMeta(f, 'floor', isNonEmptyString(f.id) ? f.id : '(缺少 id 的楼层)', declaredDemo);
    }
    for (let k = 0; k < stalls.length; k++) {
      const s = stalls[k] || {};
      checkMeta(s, 'stall', isNonEmptyString(s.id) ? s.id : '(缺少 id 的窗口)', declaredDemo);
    }
  }

  /* ---------- J1：join 后的展示字段必须齐全 ---------- */

  const dishesPerShop = {};
  for (let i = 0; i < dishes.length; i++) {
    const d = dishes[i] || {};
    if (isNonEmptyString(d.shopId)) {
      dishesPerShop[d.shopId] = (dishesPerShop[d.shopId] || 0) + 1;
    }
  }
  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i] || {};
    if (!isNonEmptyString(shop.id)) continue;
    if (!dishesPerShop[shop.id]) {
      warn('J4', 'shop', shop.id, 'dishes', 0, '店铺没有任何菜品，选到该店时会显示空态');
    }
  }

  /* 只在真正跑真实数据时做 join 断言（测试注入的假数据集没有 join 结果） */
  const joinInfo = [];
  if (opts.checkJoin === true && Array.isArray(dataLayer.ALL_DISHES)) {
    const byId = {};
    for (let i = 0; i < dataLayer.ALL_DISHES.length; i++) {
      const d = dataLayer.ALL_DISHES[i];
      byId[d.id] = d;
    }
    for (let i = 0; i < dishes.length; i++) {
      const raw = dishes[i] || {};
      if (!isNonEmptyString(raw.id)) continue;
      const joined = byId[raw.id];
      if (!joined) {
        err('J1', 'dish', raw.id, 'id', raw.id, 'join 后找不到该菜品（data/index.js:209-292）');
        continue;
      }
      if (!isNonEmptyString(joined.stallName)) {
        err('J1', 'dish', raw.id, 'stallName', joined.stallName, 'join 后窗口名为空，卡片会少一行');
      }
      if (!isNonEmptyString(joined.foodTypeText)) {
        err('J1', 'dish', raw.id, 'foodTypeText', joined.foodTypeText, 'join 后主食类型中文为空');
      }
      if (!isNonEmptyString(joined.areaText)) {
        err('J1', 'dish', raw.id, 'areaText', joined.areaText, 'join 后区域中文为空（店铺 area 可能有误）');
      }
      if (!isNonEmptyString(joined.location)) {
        err('J1', 'dish', raw.id, 'location', joined.location, 'join 后位置文本为空（店铺 location 缺失）');
      }
      joinInfo.push(raw.id);
    }
  }

  return { errors: errors, warnings: warnings, stats: stat, joinChecked: joinInfo.length };
}

/* ================================================================
   报告
   ================================================================ */

const RULE_ORDER = ['S1', 'S2', 'S3', 'F1', 'F2', 'F3', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6',
  'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8',
  'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'J1', 'J3', 'J4'];

function sortIssues(list) {
  return list.slice().sort(function (a, b) {
    const ra = RULE_ORDER.indexOf(a.rule);
    const rb = RULE_ORDER.indexOf(b.rule);
    if (ra !== rb) return ra - rb;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });
}

function formatIssue(item) {
  return '  [' + item.rule + '] ' + item.table + ' ' + item.id +
    ' → 字段 ' + item.field + ' = ' + item.value + '　原因：' + item.reason;
}

function buildReport(result) {
  const errors = sortIssues(result.errors);
  const warnings = sortIssues(result.warnings);
  const lines = [];

  lines.push('===== 只读数据校验 · tools/verify_data.js =====');
  lines.push('数据集：' + result.stats.shops + ' 店铺 / ' + result.stats.floors + ' 楼层 / ' +
    result.stats.stalls + ' 窗口 / ' + result.stats.dishes + ' 菜品' +
    (result.joinChecked ? '（已核对 join 结果 ' + result.joinChecked + ' 条）' : ''));
  lines.push('');

  return { errors: errors, warnings: warnings, lines: lines };
}

function printReport(result, showAll) {
  const report = buildReport(result);
  const limit = showAll ? report.errors.length : 20;

  report.lines.forEach(function (l) { console.log(l); });

  if (report.errors.length) {
    console.log('错误 ' + report.errors.length + ' 条：');
    for (let i = 0; i < Math.min(limit, report.errors.length); i++) {
      console.log(formatIssue(report.errors[i]));
    }
    if (report.errors.length > limit) {
      console.log('  …… 其余 ' + (report.errors.length - limit) + ' 条未显示（加 --all 查看全部）');
    }
    console.log('');
  }

  if (report.warnings.length) {
    console.log('警告 ' + report.warnings.length + ' 条（不影响退出码）：');
    for (let i = 0; i < Math.min(limit, report.warnings.length); i++) {
      console.log(formatIssue(report.warnings[i]));
    }
    if (report.warnings.length > limit) {
      console.log('  …… 其余 ' + (report.warnings.length - limit) + ' 条未显示（加 --all 查看全部）');
    }
    console.log('');
  }

  /* 按规则汇总，方便一眼看出哪类问题集中 */
  const byRule = {};
  report.errors.forEach(function (e) { byRule[e.rule] = (byRule[e.rule] || 0) + 1; });
  const ruleKeys = Object.keys(byRule);
  if (ruleKeys.length) {
    console.log('按规则汇总：' + ruleKeys.map(function (k) { return k + '×' + byRule[k]; }).join('，'));
    console.log('');
  }

  if (!report.errors.length) {
    console.log('✅ 无错误' + (report.warnings.length ? '（有 ' + report.warnings.length + ' 条警告，见上）' : '') + '，数据符合现有约束');
  } else {
    console.log('❌ 校验未通过：' + report.errors.length + ' 条错误，' + report.warnings.length + ' 条警告');
  }
}

function exitCodeFor(result) {
  return result.errors.length ? 1 : 0;
}

/* ================================================================
   入口
   ================================================================ */

function main(argv) {
  const showAll = (argv || []).indexOf('--all') !== -1;
  const result = validateDataset(
    { shops: SHOPS, dishes: DISHES },
    { declaredDemo: true, checkJoin: true }
  );
  printReport(result, showAll);
  return exitCodeFor(result);
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  validateDataset: validateDataset,
  printReport: printReport,
  exitCodeFor: exitCodeFor,
  AREA_VALUES: AREA_VALUES,
  TASTE_VALUES: TASTE_VALUES,
  FOOD_TYPE_VALUES: FOOD_TYPE_VALUES,
  SIDE_VALUES: SIDE_VALUES,
  NO_STATUS_VALUES: NO_STATUS_VALUES,
  STATUS_VALUES: STATUS_VALUES,
  PRICE_MAX: PRICE_MAX,
  ROOT: ROOT
};
