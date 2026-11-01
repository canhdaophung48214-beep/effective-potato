/**
 * 数据访问层：把「店铺表 + 菜品表」拼成页面直接能用的扁平结构。
 *
 * 为什么要这一层：
 *   页面里只需要关心「一道菜长什么样」，不用每次都去 shopId / stallId / foodType 里查名字。
 *   以后把演示数据换成接口时，只要保证这里导出的字段不变，页面代码一行都不用改。
 *
 * 阶段 3-1 重构说明：
 *   原来「拼装」这段逻辑写死在模块顶层，直接吃 require 进来的 SHOPS / DISHES 常量，
 *   因此只能有一份数据集，无法喂给它别的数据（云端读回来的、测试造的假数据都不行）。
 *   现在把拼装抽成纯函数 buildDataset(shopsRaw, dishesRaw)：
 *     - 不读全局、不写全局、不碰 wx / 云环境，只依赖入参与模块内的枚举表；
 *     - 不改动入参（只用 map / 局部变量，不 mutate）；
 *     - 返回 { ALL_SHOPS, ALL_DISHES, DATA_STATUS_SUMMARY } 三件套。
 *   本地默认实例仍然是「用 SHOPS / DISHES 调一次」，所以导出的字段、顺序、行为完全不变。
 */

const { SHOPS } = require('./shops');
const { DISHES } = require('./dishes');
const {
  VERIFY_STATUS,
  VERIFY_LABEL,
  VERIFY_CLASS,
  VERIFY_TIP,
  SOURCE_KIND_LABEL,
  normalizeMeta,
  decorate,
  weakest,
  countByStatus
} = require('./provenance');

/* 枚举 → 中文，页面上要显示的文案统一放这里 */
const AREA_LABEL = {
  campus: '校内食堂',
  offsite: '校外周边'
};

const TASTE_LABEL = {
  light: '清淡',
  mild_spicy: '微辣',
  spicy: '麻辣',
  /* 可选辣度：菜品本身不固定辣度，点单时由顾客选。
     筛选语义见 utils/matcher.js 的 hasAnyTaste —— 用户选任何一档都算命中。 */
  choice: '可选辣度'
};

/**
 * 主食类型枚举 → 中文
 * 注意：这里没有 'all'。'all' 是筛选器专用的「不限」值，不是真实的菜品类型。
 *       菜品数据里写了 'all' 属于数据错误，下面的 join 会把它的类型文字变成空字符串，
 *       方便一眼看出数据填错了。
 */
const FOOD_TYPE_LABEL = {
  rice: '饭类',
  noodle: '面类',
  rice_noodle: '米线类',
  rice_vermicelli: '粉类',
  dumpling: '饺子馄饨类',
  malatang: '麻辣烫 / 冒菜类',
  snack: '面点小吃类',
  other: '其他'
};

/* ================================================================
   阶段 3：店铺方位 + 窗口编号状态
   ================================================================

   方位（店铺在餐厅里朝哪一面）与窗口编号都是**可选字段**，
   数据里没采集就一律留空，绝不在这里补默认值：

     stalls[i].side:     'east' | 'south' | 'west' | 'north'
                         缺省 / 空串 = 方位未采集
     stalls[i].noStatus: 'has' | 'none' | 'unverified'
                         缺省 = 'unverified'
     stalls[i].no:       窗口编号，只有 noStatus === 'has' 时才会被读取

   为什么编号要三态而不是一个空字符串：
     「确认这家餐厅不编号」（none）和「编号还没核实」（unverified）
     是两件事。用一个空字符串同时表示，界面上就分不清「真的没有 3 号窗口」
     和「3 号窗口还没去核实」，也会让后面补数据时无法区分哪些是待办。
   ================================================================ */

const SIDE_LABEL = {
  east: '东面',
  south: '南面',
  west: '西面',
  north: '北面'
};

/* 方位展示顺序：固定，不随数据插入顺序抖动 */
const SIDE_ORDER = ['east', 'south', 'west', 'north'];

const STALL_NO_STATUS = {
  HAS: 'has',              /* 已核实：有编号，编号在 no 字段 */
  NONE: 'none',            /* 已确认：这家餐厅的窗口不编号 */
  UNVERIFIED: 'unverified' /* 尚未核实（字段缺省时的默认值） */
};

/* 小工具：在数组里按 id 找一个元素 */
function findById(list, id) {
  if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/**
 * 把一个窗口 / 档口记录规范化成页面能直接用的展示信息。
 *
 * 三条硬规则：
 *   1. 只有 noStatus === 'has' 且确实给了编号，才会生成「N 号窗口」这段文字。
 *      其余情况 noText 恒为空串 —— 界面永远不会凭空出现一个编号。
 *   2. 声称有编号却没给编号值，降级成「尚未核实」，而不是补一个默认号。
 *   3. 没有店名时显示「未命名店铺」，也不拿编号占位。
 *
 * @param {object} stall 店铺表里的窗口记录，可以是 undefined
 * @return {object} { id, floorId, name, label, side, sideText, noStatus, no, noText }
 */
function describeStall(stall) {
  if (!stall) {
    return {
      id: '', floorId: '', name: '', label: '',
      side: '', sideText: '',
      noStatus: STALL_NO_STATUS.UNVERIFIED, no: '', noText: ''
    };
  }

  const rawStatus = stall.noStatus;
  let noStatus = (rawStatus === STALL_NO_STATUS.HAS ||
    rawStatus === STALL_NO_STATUS.NONE ||
    rawStatus === STALL_NO_STATUS.UNVERIFIED)
    ? rawStatus
    : STALL_NO_STATUS.UNVERIFIED;

  const rawNo = (stall.no === undefined || stall.no === null) ? '' : String(stall.no).trim();
  let no = '';
  let noText = '';

  if (noStatus === STALL_NO_STATUS.HAS) {
    if (rawNo) {
      no = rawNo;
      noText = rawNo + ' 号窗口';
    } else {
      /* 说有编号却没给值：按「尚未核实」处理，不编一个 */
      noStatus = STALL_NO_STATUS.UNVERIFIED;
    }
  }

  const side = SIDE_LABEL[stall.side] ? stall.side : '';
  const name = stall.name || '';

  return {
    id: stall.id,
    floorId: stall.floorId || '',
    name: name,
    /* 展示用名称：有已核实编号就显示编号，否则显示店名，都没有就说未命名 */
    label: noText || name || '未命名店铺',
    side: side,
    sideText: SIDE_LABEL[side] || '',
    noStatus: noStatus,
    no: no,
    noText: noText
  };
}

/**
 * 把一条记录规范化成「可信度层级」
 * @param {object} record 店铺 / 楼层 / 窗口 / 菜品
 * @param {string} level  shop | floor | stall | dish
 */
function layerOf(record, level) {
  const meta = normalizeMeta(record);
  const flat = decorate(meta, level);
  flat.id = (record && record.id) || '';
  /* weakest() 要读原始来源对象，这里带上一份 */
  flat.source = meta.source;
  return flat;
}

/**
 * 把一条记录的层级状态合成成页面字段。
 * 菜品卡片展示的是「菜品 + 窗口 + 楼层 + 店铺」里最弱的那一层，
 * 同时保留最弱那一层的来源，便于追溯到底是哪一环没有核实依据。
 */
function buildVerify(layers) {
  const w = weakest(layers);
  return {
    verifyStatus: w.status,
    verifyText: VERIFY_LABEL[w.status] || '待核实',
    verifyClass: VERIFY_CLASS[w.status] || VERIFY_CLASS.unverified,
    verifyTip: VERIFY_TIP[w.status] || '',
    verifiedAt: w.verifiedAt,
    verifyLevel: w.level,
    verifyNote: w.note,
    sourceKind: w.source.kind,
    sourceKindText: SOURCE_KIND_LABEL[w.source.kind] || SOURCE_KIND_LABEL.unknown,
    sourceDetail: w.source.detail,
    sourceRef: w.source.ref,
    verifyLayers: layers.map(function (l) {
      return {
        level: l.metaLevel,
        id: l.id,
        status: l.verifyStatus,
        text: VERIFY_LABEL[l.verifyStatus] || '待核实'
      };
    })
  };
}

/**
 * 纯函数：把「店铺原始表 + 菜品原始表」拼成页面直接能用的扁平结构。
 *
 * 这里**不再直接引用** SHOPS / DISHES 常量，只认入参。目的：
 *   1. 本地演示数据、云端读回来的数据、测试造的假数据，都走同一段拼装逻辑，
 *      不会出现「本地能拼对、换个数据源字段就丢」的两套代码；
 *   2. 可以离线测：构造几行假数据就能断言输出，不需要页面、不需要 wx、不需要云环境。
 *
 * 约定（与改造前逐字一致，不要改动）：
 *   - 输出顺序 = 入参顺序。ALL_DISHES 跟 dishes 数组同序，ALL_SHOPS 跟 shops 数组同序。
 *     页面「默认顺序」就靠这个顺序，不是按 id 排序。
 *   - 找不到店铺时，菜品仍然保留，店名回退成「未知店铺」、区域为空。
 *   - 找不到窗口时，窗口相关字段全为空 / 未核实，不编造。
 *   - 不修改入参对象，也不缓存任何结果（每次返回全新对象）。
 *
 * @param {Array} shopsRaw  店铺表（需含 id / name / area / floors / stalls / 可信度元数据）
 * @param {Array} dishesRaw 菜品表（需含 id / name / price / shopId / stallId / foodType / tastes）
 * @return {{ALL_SHOPS: Array, ALL_DISHES: Array, DATA_STATUS_SUMMARY: object}}
 */
function buildDataset(shopsRaw, dishesRaw) {
  const shops = Array.isArray(shopsRaw) ? shopsRaw : [];
  const dishes = Array.isArray(dishesRaw) ? dishesRaw : [];

  /* 建索引：shopId → 店铺对象 */
  const shopMap = {};
  for (let i = 0; i < shops.length; i++) {
    shopMap[shops[i].id] = shops[i];
  }

  /* 扁平菜品列表：已含区域、店铺名、楼层、窗口、位置、口味中文、主食类型中文
   *
   * 关键点：菜品表里只存 stallId 和 foodType，楼层 / 窗口名 / 类型中文都在这里查出来补上，
   *        所以换数据时不会出现「店铺表改了、菜品表里的窗口文字没改」这种不一致。
   */
  const ALL_DISHES = dishes.map(function (dish) {
    const shop = shopMap[dish.shopId] || {};
    const tastes = dish.tastes || [];

    /* 窗口 / 档口（含编号三态与方位，见 describeStall） */
    const stall = findById(shop.stalls, dish.stallId);
    const stallInfo = describeStall(stall);
    const stallName = stallInfo.name;
    /* 窗口所属楼层（没有楼层划分时为空字符串） */
    const floorId = stallInfo.floorId;
    const floor = floorId ? findById(shop.floors, floorId) : null;
    const floorText = floor ? floor.label : '';

    /* 位置：店铺位置 + 楼层 + 方位，例如「西校区 · 一号食堂 · 2 楼 · 东面」
       方位没采集时整段不出现，不会留下多余的分隔符 */
    const baseLocation = shop.location || '';
    const sideText = stallInfo.sideText;
    const locationText = [baseLocation, floorText, sideText]
      .filter(function (part) { return !!part; })
      .join(' · ');

    /* 可信度：菜品 → 窗口 → 楼层 → 店铺 四层合成，取最弱一环 */
    const layers = [layerOf(dish, 'dish'), layerOf(shop, 'shop')];
    if (stall) layers.push(layerOf(stall, 'stall'));
    if (floor) layers.push(layerOf(floor, 'floor'));
    const verify = buildVerify(layers);

    return {
      id: dish.id,
      name: dish.name,
      price: dish.price,
      tastes: tastes,
      tasteText: tastes.map(function (t) { return TASTE_LABEL[t] || t; }).join(' · '),

      /* 主食类型 */
      foodType: dish.foodType || 'other',
      foodTypeText: FOOD_TYPE_LABEL[dish.foodType] || '',

      /* 区域 */
      area: shop.area || '',
      areaText: AREA_LABEL[shop.area] || '',

      /* 餐厅 / 商家 */
      shopId: dish.shopId,
      shopName: shop.name || '未知店铺',
      building: shop.building || '',

      /* 地点三级 */
      floorId: floorId,
      floorText: floorText,
      stallId: dish.stallId || '',
      stallName: stallName,

      /* 窗口编号三态（阶段 3）：只有 'has' 时 noText 才有内容 */
      stallNoStatus: stallInfo.noStatus,
      stallNoText: stallInfo.noText,

      /* 方位（阶段 3）：数据未采集时为空串 */
      side: stallInfo.side,
      sideText: sideText,

      /* 兼容旧字段：卡片模板里用的 stall 就是窗口 / 档口名；
         stallLabel 是「有编号显示编号、没编号显示店名」的展示名 */
      stall: stallName,
      stallLabel: stallInfo.label,
      location: locationText,

      /* 可信度（扁平字段，页面直接用） */
      verifyStatus: verify.verifyStatus,
      verifyText: verify.verifyText,
      verifyClass: verify.verifyClass,
      verifyTip: verify.verifyTip,
      verifiedAt: verify.verifiedAt,
      verifyLevel: verify.verifyLevel,
      verifyNote: verify.verifyNote,
      sourceKind: verify.sourceKind,
      sourceKindText: verify.sourceKindText,
      sourceDetail: verify.sourceDetail,
      sourceRef: verify.sourceRef,
      verifyLayers: verify.verifyLayers
    };
  });

  /* 店铺列表 + 楼层 / 窗口配置 + 每家的菜品数量 */
  const ALL_SHOPS = shops.map(function (shop) {
    let count = 0;
    for (let i = 0; i < dishes.length; i++) {
      if (dishes[i].shopId === shop.id) count++;
    }
    const floors = shop.floors || [];
    const stalls = shop.stalls || [];

    /* 窗口 / 档口规范化：编号三态 + 方位 + 展示名 */
    const stallList = stalls.map(describeStall);

    /* 方位候选：**只由该店真实出现过的 side 去重得出**。
       数据里一个方位都没有时这里就是空数组，
       页面拿到空数组就不会渲染方位这一整行 —— 不会出现「东面但一家店都没标」的假选项 */
    const sideSeen = {};
    for (let i = 0; i < stallList.length; i++) {
      if (stallList[i].side) sideSeen[stallList[i].side] = true;
    }
    const stallSideOptions = SIDE_ORDER
      .filter(function (v) { return sideSeen[v]; })
      .map(function (v) { return { value: v, label: SIDE_LABEL[v] }; });

    /* 编号状态汇总：让页面能一句话说清「这家店的窗口到底有没有编号」 */
    let noHas = 0;
    let noNone = 0;
    let noUnverified = 0;
    for (let i = 0; i < stallList.length; i++) {
      const st = stallList[i].noStatus;
      if (st === STALL_NO_STATUS.HAS) noHas++;
      else if (st === STALL_NO_STATUS.NONE) noNone++;
      else noUnverified++;
    }

    /* 店铺卡片展示的可信度：店铺 + 它的楼层 + 它的窗口，取最弱一环 */
    const layers = [layerOf(shop, 'shop')];
    for (let i = 0; i < floors.length; i++) layers.push(layerOf(floors[i], 'floor'));
    for (let i = 0; i < stalls.length; i++) layers.push(layerOf(stalls[i], 'stall'));
    const verify = buildVerify(layers);

    return {
      id: shop.id,
      name: shop.name,
      area: shop.area,
      areaText: AREA_LABEL[shop.area] || '',
      building: shop.building || '',
      location: shop.location || '',
      floors: floors,
      stalls: stalls,
      hasFloors: floors.length > 0,
      dishCount: count,

      /* 阶段 3：位置配置用 */
      stallList: stallList,
      stallSideOptions: stallSideOptions,
      hasSide: stallSideOptions.length > 0,
      stallNoSummary: {
        has: noHas,
        none: noNone,
        unverified: noUnverified,
        total: stallList.length
      },

      /* 可信度 */
      verifyStatus: verify.verifyStatus,
      verifyText: verify.verifyText,
      verifyClass: verify.verifyClass,
      verifyTip: verify.verifyTip,
      verifiedAt: verify.verifiedAt,
      verifyLevel: verify.verifyLevel,
      verifyNote: verify.verifyNote,
      sourceKind: verify.sourceKind,
      sourceKindText: verify.sourceKindText,
      sourceDetail: verify.sourceDetail,
      sourceRef: verify.sourceRef,
      verifyLayers: verify.verifyLayers
    };
  });

  /**
   * 数据状态总览：页面顶部一行「当前数据有多少是演示 / 待核实 / 已核实」，
   * 全部由数据实算，不写死数字。
   */
  const DISH_STATUS_COUNT = countByStatus(ALL_DISHES);
  const SHOP_STATUS_COUNT = countByStatus(ALL_SHOPS);

  const DATA_STATUS_SUMMARY = {
    dishTotal: ALL_DISHES.length,
    shopTotal: ALL_SHOPS.length,
    dish: DISH_STATUS_COUNT,
    shop: SHOP_STATUS_COUNT
  };

  return {
    ALL_SHOPS: ALL_SHOPS,
    ALL_DISHES: ALL_DISHES,
    DATA_STATUS_SUMMARY: DATA_STATUS_SUMMARY
  };
}

/* ------------------------------------------------------------------
 * 本地默认数据集：仍然由 data/shops.js 与 data/dishes.js 生成。
 * 页面现有引用（ALL_SHOPS / ALL_DISHES / DATA_STATUS_SUMMARY）含义与内容不变。
 * ------------------------------------------------------------------ */
const LOCAL_DATASET = buildDataset(SHOPS, DISHES);

const ALL_SHOPS = LOCAL_DATASET.ALL_SHOPS;
const ALL_DISHES = LOCAL_DATASET.ALL_DISHES;
const DATA_STATUS_SUMMARY = LOCAL_DATASET.DATA_STATUS_SUMMARY;

module.exports = {
  AREA_LABEL,
  TASTE_LABEL,
  FOOD_TYPE_LABEL,
  SIDE_LABEL,
  SIDE_ORDER,
  STALL_NO_STATUS,
  describeStall,
  ALL_SHOPS,
  ALL_DISHES,
  DATA_STATUS_SUMMARY,
  VERIFY_STATUS,
  VERIFY_LABEL,
  /* 阶段 3-1 新增：纯函数，供云端适配层与离线测试复用 */
  buildDataset
};
