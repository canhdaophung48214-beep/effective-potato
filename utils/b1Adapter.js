/**
 * B1 试点数据的客户端适配层（纯函数，离线可用）。
 *
 * 为什么单独一层：
 *   云端把餐厅 / 档口 / 菜品放在三个集合里，字段名与本地演示数据不同
 *   （`_id` vs `id`、`restaurantId` vs `shopId`、楼层内嵌在餐厅文档里）。
 *   直接把它们塞进页面，会让页面出现「有的菜有店名、有的没有」这类隐性错误。
 *   这里把云端形状统一翻成本地 `data/index.js` 认识的形状，
 *   再由 `buildDataset()` 拼成页面视图模型 —— 页面代码一行都不用改。
 *
 * 四条硬规则（与项目「不伪造」原则对齐）：
 *   1. `dataClass` **缺省或为 `'field_unverified'`** 才接受
 *      （`pilot-data.js` 是写入前数据源，本来就不带 `dataClass`，由 seed 写入时补）；
 *      显式标成 `demo` 或其它等级的记录一律拒收并计入 skipped，绝不混进 B1 视图；
 *      适配层自己**从不给记录补 `dataClass`**，缺就是缺，不替它定性。
 *   2. 不改写可信度：`verifyStatus` / `verifiedAt` 原样透传，
 *      不补 `verified`、不把 `unverified` 升级、不替记录编 `verifiedAt`。
 *   3. 不造字段：楼层、方位、窗口编号没有就留空，
 *      不用「1 楼」「东面」之类的默认值填坑。
 *   4. 形状不合法的记录直接拒收（计入 skipped 并给出原因），
 *      不做「猜一个差不多的 id」这种修复。
 *
 * 本模块不引用 `wx`、不引用 `utils/cloudRepo`、不发网络请求，
 * 因此可以在 Node 里直接跑测试（见 tools/test_b1_adapter.js）。
 */

'use strict';

const { buildDataset, FOOD_TYPE_LABEL } = require('../data/index');

/* 与 submit / seed 云函数一致的 ID 形状；不一致的一律拒收 */
const SHOP_ID_RE = /^c\d{2}$/;
const STALL_ID_RE = /^c\d{2}_t\d{2}$/;
const DISH_ID_RE = /^c\d{2}_d\d{3}$/;

/* 来源说明里明确写了「方位…未核实」的，界面不许把方位当既成事实展示。
   只认显式标注，不靠猜测：文字没写就不动。云端实际写法有三种，都要认——
     · 方位 west 未核实
     · 方位 west 来自项目负责人提供的现场信息，非餐厅负责人签字，照片未独立证明
     · 方位 west 未获独立确认 */
const SIDE_UNVERIFIED_RE = /方位[^。；;]{0,200}?(?:未核实|未独立证明|未获独立证明|未获独立确认|非[^。；;]{0,60}?(?:签字|确认))/;

/* 唯一允许进入 B1 视图的数据等级；缺省（未标注）同样接受，但不会被补成这个值 */
const ACCEPTED_DATA_CLASS = 'field_unverified';

/* 拒收原因（测试与排查用，全部是稳定字符串） */
const SKIP = {
  NOT_OBJECT: 'NOT_OBJECT',
  SHOP_ID: 'SHOP_ID',
  STALL_ID: 'STALL_ID',
  DISH_ID: 'DISH_ID',
  DATA_CLASS: 'DATA_CLASS',
  NAME: 'NAME',
  PRICE: 'PRICE',
  FOOD_TYPE: 'FOOD_TYPE',
  TASTES: 'TASTES',
  SHOP_REF: 'SHOP_REF',
  STALL_REF: 'STALL_REF',
  DUPLICATE_ID: 'DUPLICATE_ID'
};

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function text(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 把云端文档的「可信度三件套」原样搬过去。
 * 注意：这里**不补默认值**。字段缺失就让 `normalizeMeta()` 自己按
 * 「未核实」处理；补一个 'unverified' 反而会掩盖「云端根本没写这个字段」。
 */
function pickMeta(doc) {
  const out = {};
  if (doc.verifyStatus !== undefined) out.verifyStatus = doc.verifyStatus;
  if (doc.verifiedAt !== undefined) out.verifiedAt = doc.verifiedAt;
  if (doc.source !== undefined) out.source = doc.source;
  if (doc.dataClass !== undefined) out.dataClass = doc.dataClass;
  if (doc.batchId !== undefined) out.batchId = doc.batchId;
  return out;
}

function skip(list, kind, id, reason) {
  list.push({ kind: kind, id: id || '', reason: reason });
}

/**
 * 显式标了别的等级（demo / real / 未知值）→ 拒收。
 * 未标注（undefined）→ 放行，且**不补值**：`pilot-data.js` 就是这种形态，
 * 由 seed 写入时才补 `dataClass`，适配层不抢跑。
 */
function classRejected(doc) {
  return doc.dataClass !== undefined && doc.dataClass !== ACCEPTED_DATA_CLASS;
}

/** 餐厅文档 → 适配层店铺（楼层内嵌，档口稍后挂上） */
function adaptRestaurant(doc, skipped) {
  if (!isObject(doc)) { skip(skipped, 'shop', '', SKIP.NOT_OBJECT); return null; }
  const id = text(doc._id);
  if (!SHOP_ID_RE.test(id)) { skip(skipped, 'shop', id, SKIP.SHOP_ID); return null; }
  if (classRejected(doc)) { skip(skipped, 'shop', id, SKIP.DATA_CLASS); return null; }
  const name = text(doc.name);
  if (!name) { skip(skipped, 'shop', id, SKIP.NAME); return null; }

  const floors = Array.isArray(doc.floors) ? doc.floors
    .filter(function (f) { return isObject(f) && text(f.id) && text(f.label); })
    .map(function (f) {
      const meta = pickMeta(f);
      return Object.assign({
        id: text(f.id),
        label: text(f.label)
      }, meta);
    }) : [];

  const shop = Object.assign({
    id: id,
    name: name,
    area: text(doc.area),
    building: text(doc.building),
    location: text(doc.location),
    floors: floors,
    stalls: []
  }, pickMeta(doc));

  return shop;
}

/** 档口文档 → 适配层窗口；必须能对上已接收的餐厅 */
function adaptStall(doc, shopMap, skipped) {
  if (!isObject(doc)) { skip(skipped, 'stall', '', SKIP.NOT_OBJECT); return null; }
  const id = text(doc._id);
  if (!STALL_ID_RE.test(id)) { skip(skipped, 'stall', id, SKIP.STALL_ID); return null; }
  if (classRejected(doc)) { skip(skipped, 'stall', id, SKIP.DATA_CLASS); return null; }
  const shopId = text(doc.restaurantId);
  if (!shopMap[shopId]) { skip(skipped, 'stall', id, SKIP.SHOP_REF); return null; }

  /* 档口名可以为空（有的窗口只有编号），但不拿 id 冒充名字 */
  const stall = Object.assign({
    id: id,
    floorId: text(doc.floorId),
    name: text(doc.name),
    side: text(doc.side),
    /* 编号三态原样透传；缺省由 describeStall() 归一为「尚未核实」 */
    noStatus: doc.noStatus,
    no: doc.no === undefined || doc.no === null ? '' : String(doc.no)
  }, pickMeta(doc));

  return stall;
}

/** 菜品文档 → 适配层菜品；`restaurantId` 映射为 `shopId` */
function adaptDish(doc, shopMap, stallMap, skipped) {
  if (!isObject(doc)) { skip(skipped, 'dish', '', SKIP.NOT_OBJECT); return null; }
  const id = text(doc._id);
  if (!DISH_ID_RE.test(id)) { skip(skipped, 'dish', id, SKIP.DISH_ID); return null; }
  if (classRejected(doc)) { skip(skipped, 'dish', id, SKIP.DATA_CLASS); return null; }
  const name = text(doc.name);
  if (!name) { skip(skipped, 'dish', id, SKIP.NAME); return null; }

  /* 价格：只收有限正数；字符串「7 元」不猜、不截，直接拒收 */
  const price = doc.price;
  if (typeof price !== 'number' || !isFinite(price) || price <= 0) {
    skip(skipped, 'dish', id, SKIP.PRICE);
    return null;
  }
  /* 类型必须是我们认识的枚举，否则页面会出现空标签 */
  const foodType = text(doc.foodType);
  if (!FOOD_TYPE_LABEL[foodType]) { skip(skipped, 'dish', id, SKIP.FOOD_TYPE); return null; }
  const tastes = Array.isArray(doc.tastes) ? doc.tastes.filter(function (t) { return typeof t === 'string' && t; }) : [];
  if (!tastes.length) { skip(skipped, 'dish', id, SKIP.TASTES); return null; }

  const shopId = text(doc.restaurantId);
  const stallId = text(doc.stallId);
  if (!shopMap[shopId]) { skip(skipped, 'dish', id, SKIP.SHOP_REF); return null; }
  if (!stallMap[stallId] || stallMap[stallId].shopId !== shopId) {
    skip(skipped, 'dish', id, SKIP.STALL_REF);
    return null;
  }

  return Object.assign({
    id: id,
    name: name,
    price: price,
    shopId: shopId,
    stallId: stallId,
    foodType: foodType,
    tastes: tastes.slice()
  }, pickMeta(doc));
}

/**
 * 去掉位置文字里与楼层重复的片段。
 *
 * 为什么需要：`shops.location` 里常常已经写了楼层（例如「三餐 · 2 楼最西侧」），
 * 而页面拼位置时又会把 `floors.label`（「2 楼」）接上去，
 * 结果就成了「三餐 · 2 楼最西侧 · 2 楼」。这里只做**去重**，不改写文字内容：
 * 把已经出现过的楼层片段从基底里移除，剩下的部分原样保留。
 *
 * @param {string} base 店铺位置原文
 * @param {Array<string>} floorLabels 该店楼层名列表
 * @return {string} 去重后的位置基底（可能为空串）
 */
function dedupeLocationText(base, floorLabels) {
  let out = text(base);
  const labels = Array.isArray(floorLabels) ? floorLabels : [];
  for (let i = 0; i < labels.length; i++) {
    const label = text(labels[i]);
    if (!label) continue;
    const parts = out.split(label);
    /* 只出现一次：这是真实信息，原样保留（不许"去重"去掉了唯一一次） */
    if (parts.length <= 2) continue;
    /* 出现多次：保留第一次，其余删掉 */
    out = parts[0] + label + parts.slice(2).join('');
  }
  /* 清掉去重后留下的空分隔：'三餐 ·  · 最西侧' → '三餐 · 最西侧' */
  return out
    .split('·')
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return !!part; })
    .join(' · ');
}

/* 来源说明是否明确写了「方位…未核实」 */
function isSideUnverified(stall) {
  const detail = stall && stall.source && typeof stall.source.detail === 'string'
    ? stall.source.detail : '';
  return SIDE_UNVERIFIED_RE.test(detail);
}

/* 方位词 → 页面上的写法（只用于"要不要把这个词从位置串里拿掉"） */
const SIDE_LABELS = ['东面', '西面', '南面', '北面'];

/**
 * 位置串最终清洗（作用在 buildDataset 组装好的 `location` 上）。
 *
 * 云端 `shops.location` 本身已经写了「2 楼最西侧」，`buildDataset` 又会再拼一次
 * 楼层，于是出现「三餐 · 2 楼最西侧 · 2 楼 · 西面」。这里只做两件事：
 *   1. 后面的片段如果被前面的片段包含（"2 楼" ⊂ "2 楼最西侧"），丢掉后面那个；
 *   2. 来源写明方位未核实时，把方位词丢掉（不把未核实信息当既成事实）。
 * 不做任何"补全"或"猜测"。
 *
 * @param {string} location buildDataset 产出的位置串
 * @param {boolean} dropSide 是否丢弃方位词
 * @return {string}
 */
function cleanLocationText(location, dropSide) {
  const tokens = text(location)
    .split('·')
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return !!part; });

  const kept = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (dropSide && SIDE_LABELS.indexOf(token) >= 0) continue;
    let covered = false;
    for (let j = 0; j < kept.length; j++) {
      if (kept[j] !== token && kept[j].indexOf(token) >= 0) { covered = true; break; }
    }
    if (!covered) kept.push(token);
  }
  return kept.join(' · ');
}

/* 一条菜品是否具备「进入真实投稿目标流程」的资格：三个编号形状都对 */
function isRealTarget(dish) {
  return !!dish &&
    SHOP_ID_RE.test(text(dish.shopId)) &&
    STALL_ID_RE.test(text(dish.stallId)) &&
    DISH_ID_RE.test(text(dish.id));
}

/**
 * 主入口：把三个集合的文档转成 `buildDataset()` 需要的 (shopsRaw, dishesRaw)。
 *
 * @param {{restaurants: Array, stalls: Array, dishes: Array}} input
 * @return {{shopsRaw: Array, dishesRaw: Array, skipped: Array, counts: object}}
 */
function toRawDataset(input) {
  const src = input || {};
  const restaurants = Array.isArray(src.restaurants) ? src.restaurants : [];
  const stalls = Array.isArray(src.stalls) ? src.stalls : [];
  const dishes = Array.isArray(src.dishes) ? src.dishes : [];

  const skipped = [];
  const shopMap = {};
  const shopsRaw = [];

  /* 1. 餐厅：形状 + 数据等级 + 重名 id 都不能放过 */
  for (let i = 0; i < restaurants.length; i++) {
    const shop = adaptRestaurant(restaurants[i], skipped);
    if (!shop) continue;
    if (shopMap[shop.id]) { skip(skipped, 'shop', shop.id, SKIP.DUPLICATE_ID); continue; }
    shopMap[shop.id] = shop;
    shopsRaw.push(shop);
  }

  /* 2. 档口：按 restaurantId 挂到餐厅的 stalls 数组上 */
  const stallMap = {};
  for (let i = 0; i < stalls.length; i++) {
    const stall = adaptStall(stalls[i], shopMap, skipped);
    if (!stall) continue;
    if (stallMap[stall.id]) { skip(skipped, 'stall', stall.id, SKIP.DUPLICATE_ID); continue; }
    const shopId = text(stalls[i].restaurantId);
    const owner = shopMap[shopId];
    stallMap[stall.id] = { id: stall.id, shopId: shopId };
    owner.stalls.push(stall);
  }

  /* 3. 菜品 */
  const dishesRaw = [];
  const seenDish = {};
  for (let i = 0; i < dishes.length; i++) {
    const dish = adaptDish(dishes[i], shopMap, stallMap, skipped);
    if (!dish) continue;
    if (seenDish[dish.id]) { skip(skipped, 'dish', dish.id, SKIP.DUPLICATE_ID); continue; }
    seenDish[dish.id] = true;
    dishesRaw.push(dish);
  }

  return {
    shopsRaw: shopsRaw,
    dishesRaw: dishesRaw,
    skipped: skipped,
    counts: {
      shops: shopsRaw.length,
      stalls: Object.keys(stallMap).length,
      dishes: dishesRaw.length,
      skipped: skipped.length
    }
  };
}

/**
 * 转成首页视图模型（与 `data/index.js` 的 ALL_SHOPS / ALL_DISHES 同构）。
 * @param {{restaurants: Array, stalls: Array, dishes: Array}} input
 */
function buildB1View(input) {
  const raw = toRawDataset(input);
  const dataset = buildDataset(raw.shopsRaw, raw.dishesRaw);
  return {
    ALL_SHOPS: dataset.ALL_SHOPS,
    ALL_DISHES: dataset.ALL_DISHES,
    DATA_STATUS_SUMMARY: dataset.DATA_STATUS_SUMMARY,
    skipped: raw.skipped,
    counts: raw.counts
  };
}

/**
 * 归一化「已经适配过」的数据集（`cloudRepo.loadCloudDataset()` 的产物）。
 *
 * 与 `buildB1View` 的分工：
 *   - `buildB1View` 吃**云端原始文档**（`_id` / `restaurantId` 那套），负责整段映射；
 *   - 本函数吃**cloudRepo 已适配好的** `{shops, dishes}`（`id` / `shopId` 那套），
 *     只做两件展示层的修正与一道准入闸，不重复映射：
 *       1. 位置去重（店铺位置里已含楼层时不再重复拼接）；
 *       2. 来源写明「方位未核实」时，不把方位当既成事实展示；
 *       3. 只保留编号形状合法的菜品（形状不对的进 `dropped`，不静默混入）。
 *
 * 不改 `verifyStatus` / `verifiedAt`，不补任何可信度字段。
 *
 * @param {{shops: Array, dishes: Array}} input
 * @return {{ALL_SHOPS: Array, ALL_DISHES: Array, DATA_STATUS_SUMMARY: object, notes: Array, counts: object}}
 */
function normalizeAdaptedDataset(input) {
  const src = input || {};
  const shopsIn = Array.isArray(src.shops) ? src.shops : [];
  const dishesIn = Array.isArray(src.dishes) ? src.dishes : [];

  const notes = [];
  const dropped = [];

  /* 0. 店铺级准入：演示店铺整店剔除。不剔的话 DATA_STATUS_SUMMARY 会把演示店
        也算成「1 家店」，页面上就会出现「2 家店、12 道菜」这种自相矛盾的计数。 */
  const shopsKept = [];
  shopsIn.forEach(function (shop) {
    if (shop && shop.dataClass === 'demo') {
      dropped.push({ id: shop.id || '', kind: 'shop', reason: 'DATA_CLASS' });
      return;
    }
    shopsKept.push(shop);
  });

  /* 记录哪些档口的来源明确写了「方位…未核实」：页面要把方位词从位置串里去掉 */
  const suppressedStalls = {};
  shopsKept.forEach(function (shop) {
    (Array.isArray(shop.stalls) ? shop.stalls : []).forEach(function (stall) {
      if (stall && stall.side && isSideUnverified(stall)) {
        suppressedStalls[text(shop.id) + '|' + text(stall.id)] = true;
      }
    });
  });

  const shops = shopsKept.map(function (shop) {
    const floors = Array.isArray(shop.floors) ? shop.floors : [];
    const floorLabels = floors.map(function (f) { return text(f && f.label); });
    const location = dedupeLocationText(shop.location, floorLabels);
    if (location !== text(shop.location)) {
      notes.push({ kind: 'location_deduped', shopId: shop.id, from: text(shop.location), to: location });
    }

    const stalls = (Array.isArray(shop.stalls) ? shop.stalls : []).map(function (stall) {
      const copy = Object.assign({}, stall);
      /* 只认来源里写明「方位…未核实」这一种情况；文字没写就不动 */
      if (copy.side && isSideUnverified(copy)) {
        notes.push({ kind: 'side_suppressed', stallId: copy.id, side: copy.side });
        copy.side = '';
      }
      return copy;
    });

    return Object.assign({}, shop, { location: location, floors: floors, stalls: stalls });
  });

  const dishes = dishesIn.filter(function (dish) {
    if (dish && dish.dataClass === 'demo') {
      dropped.push({ id: dish.id || '', kind: 'dish', reason: 'DATA_CLASS' });
      return false;
    }
    if (!isRealTarget(dish)) {
      dropped.push({ id: (dish && dish.id) || '', kind: 'dish', reason: 'ID_SHAPE' });
      return false;
    }
    return true;
  });

  const dataset = buildDataset(shops, dishes);

  /* 展示层修正：位置串里楼层重复、方位词来自"未核实"的来源说明 */
  const ALL_DISHES = dataset.ALL_DISHES.map(function (dish) {
    const key = text(dish.shopId) + '|' + text(dish.stallId);
    const cleaned = cleanLocationText(dish.location, !!suppressedStalls[key]);
    if (cleaned !== text(dish.location)) {
      notes.push({ kind: 'location_cleaned', dishId: dish.id, from: text(dish.location), to: cleaned });
    }
    return Object.assign({}, dish, { location: cleaned });
  });

  return {
    ALL_SHOPS: dataset.ALL_SHOPS,
    ALL_DISHES: ALL_DISHES,
    DATA_STATUS_SUMMARY: dataset.DATA_STATUS_SUMMARY,
    notes: notes,
    dropped: dropped,
    counts: {
      shops: dataset.ALL_SHOPS.length,
      dishes: ALL_DISHES.length,
      dropped: dropped.length
    }
  };
}

module.exports = {
  SHOP_ID_RE,
  STALL_ID_RE,
  DISH_ID_RE,
  SIDE_UNVERIFIED_RE,
  ACCEPTED_DATA_CLASS,
  SKIP,
  dedupeLocationText,
  isSideUnverified,
  isRealTarget,
  toRawDataset,
  buildB1View,
  normalizeAdaptedDataset
};
