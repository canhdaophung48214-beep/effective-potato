/**
 * 筛选内核：只做数据计算，不碰页面、不碰 UI。
 *
 * 把它单独拆出来的原因：
 *   1. 页面代码只剩「读状态 → 调这里 → 显示结果」，逻辑一眼看懂
 *   2. 这份代码可以在 Node 里直接跑测试，验证结果和你手机上看到的一致
 *
 * 条件对象 cond 的字段（全部可选，缺省 = 不限）：
 *   area       'all' | 'campus' | 'offsite'
 *   shops      Array，餐厅多选 + 每店独立位置条件（阶段 3）：
 *                [{ shopId, floorIds: [], stallIds: [], sides: [] }]
 *              · 不同餐厅之间是「或」：命中任意一家就算通过
 *              · 同一餐厅内部：楼层组 / 店铺组 / 方位组之间是「与」，
 *                每一组内部是「或」
 *              · 某家店的某个数组为空 = 这家店这一组不限
 *              · 空数组 / 缺省 = 餐厅这一级不限，此时回落到下面的旧单值字段
 *   budget     0 = 不限预算；10 / 15 / 20 = 该金额以内（含）
 *   foodTypes  Array，主食类型多选，组内「或」；空数组 = 不限
 *   tastes     Array，口味多选，组内「或」；空数组 = 不限
 *
 * 旧版单值入口（单选时代留下的，保留是为了不破坏既有调用与回归基线）：
 *   shopId     'all' | 具体餐厅 / 商家 id
 *   floorId    'all' | 具体楼层 id
 *   stallId    'all' | 具体窗口 / 档口 id
 *   foodType   'all' | 'rice' | 'noodle' | 'rice_noodle' | 'rice_vermicelli'
 *                     | 'dumpling' | 'malatang' | 'snack' | 'other'
 *   taste      'all' | 'light' | 'mild_spicy' | 'spicy'
 *              （菜品侧多一个 'choice' = 辣度可自选，用户选任何一档都算命中）
 *
 * 说明：不同筛选组之间是「与」的关系，全部满足才会被选出来。
 *      这一点是「主食类型必须与其他筛选同时生效」的实现依据——
 *      不是在别处再补一段判断，而是同一处 and 条件。
 *
 * 「不限」只有一种写法：空数组。'all' 允许出现在选项列表里，
 *      但一旦出现在条件数组里就会被过滤掉，绝不会被当成一个可选值——
 *      否则「选了不限」会被算成「只能是不限这个值」，结果恒为空集。
 */

/* ================================================================
   多选条件的归一化
   ================================================================ */

/* 菜品侧的特殊口味值：辣度可自选。语义见 hasAnyTaste。 */
const TASTE_CHOICE = 'choice';

/**
 * 把「多选数组」或「旧的单值」统一成一个干净的数组。
 *
 * 三条规则：
 *   1. 空数组就是「不限」，没有第二种表达方式
 *   2. 'all'、空串、null 一律丢弃，不进条件
 *   3. 传了数组就以数组为准；只有完全没传 multi 时才回落到旧单值字段
 *
 * 第 3 条是「不能自己配出空集」的关键：页面清空某一组时传的是 []，
 * 如果这时还能回落到旧的单值字段，清空就会失效。
 *
 * @param {Array|String|undefined} multi  多值入参
 * @param {String|undefined} single       旧版单值入参
 * @return {Array} 去重后的有效值
 */
function toValueSet(multi, single) {
  const isArray = Array.isArray(multi);
  const raw = isArray ? multi
    : (multi === undefined || multi === null || multi === '' || multi === 'all' ? [] : [multi]);

  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const v = raw[i];
    if (v === undefined || v === null || v === '' || v === 'all') continue;
    if (out.indexOf(v) === -1) out.push(v);
  }

  if (!isArray && !out.length) {
    if (single !== undefined && single !== null && single !== '' && single !== 'all') {
      out.push(single);
    }
  }

  return out;
}

/**
 * 归一化「餐厅多选 + 每店独立条件」。
 *
 * 只做两件事：丢掉非法条目、把每一组都变成数组。
 * 没有 shopId 或 shopId 为 'all' 的条目直接丢弃 —— 它们表达的是「不限」，
 * 而「不限」的正确表达是「整个 shops 为空」，留着一个空条件条目会在
 * 匹配时被当成「必须命中某家店」从而把结果筛成空集。
 *
 * @param {Array} shops
 * @return {Array} [{ shopId, floorIds, stallIds, sides }]
 */
function normalizeScopes(shops) {
  const out = [];
  if (!Array.isArray(shops)) return out;

  for (let i = 0; i < shops.length; i++) {
    const s = shops[i];
    if (!s || typeof s !== 'object') continue;

    const shopId = s.shopId || s.id;
    if (!shopId || shopId === 'all') continue;

    out.push({
      shopId: shopId,
      floorIds: toValueSet(s.floorIds, s.floorId),
      stallIds: toValueSet(s.stallIds, s.stallId),
      sides: toValueSet(s.sides, s.side)
    });
  }

  return out;
}

/**
 * 判断一道菜是否满足「餐厅这一级」的条件。
 *
 * 结构：不同餐厅之间「或」，每家餐厅必须满足自己那套条件。
 * 跨店串用在这里是被物理阻断的：只有 dish.shopId 与条件里的 shopId
 * 相同，才会拿这家店的楼层 / 店铺 / 方位去比对，第一餐厅的楼层
 * 永远不会被用在第三餐厅的菜上。
 *
 * @param {Object} dish
 * @param {Array} scopes normalizeScopes() 的输出
 * @return {Boolean}
 */
function matchShopScopes(dish, scopes) {
  for (let i = 0; i < scopes.length; i++) {
    const s = scopes[i];
    if (dish.shopId !== s.shopId) continue;

    /* 组间「与」：这家店的每一组条件都要满足 */
    if (s.floorIds.length && s.floorIds.indexOf(dish.floorId) === -1) continue;
    if (s.stallIds.length && s.stallIds.indexOf(dish.stallId) === -1) continue;
    if (s.sides.length && s.sides.indexOf(dish.side) === -1) continue;

    return true;
  }
  return false;
}

/**
 * 口味命中判断：一道菜可能有多个标签，命中任意一个即可。
 *
 * 'choice'（可选辣度）是通配：这类菜点单时能做成清淡 / 微辣 / 麻辣任意一种，
 * 所以用户选任何一档都应该被选出来。它只出现在**菜品侧**，不会出现在筛选条件里
 * （筛选条件只有页面上的三档 + 不限），因此这里对 dishTastes 做判断即可。
 *
 * @param {Array} dishTastes
 * @param {Array} wanted
 * @return {Boolean}
 */
function hasAnyTaste(dishTastes, wanted) {
  const list = dishTastes || [];
  if (list.indexOf(TASTE_CHOICE) !== -1) return true;
  for (let i = 0; i < list.length; i++) {
    if (wanted.indexOf(list[i]) !== -1) return true;
  }
  return false;
}

/**
 * 按条件筛选菜品
 * @param {Array} dishes 扁平菜品数组（来自 data/index.js 的 ALL_DISHES）
 * @param {Object} cond   条件对象
 * @return {Array} 符合条件的菜品
 */
function filterDishes(dishes, cond) {
  const c = cond || {};
  const area = c.area || 'all';
  const budget = (c.budget === undefined || c.budget === null) ? 0 : c.budget;

  /* 旧的单值条件：只在多选入口没给值时生效 */
  const shopId = c.shopId || 'all';
  const floorId = c.floorId || 'all';
  const stallId = c.stallId || 'all';

  const scopes = normalizeScopes(c.shops);
  const foodTypes = toValueSet(c.foodTypes, c.foodType);
  const tastes = toValueSet(c.tastes, c.taste);

  return dishes.filter(function (dish) {
    /* 1. 区域：不限 or 精确匹配 */
    if (area !== 'all' && dish.area !== area) {
      return false;
    }

    /* 2. 餐厅 / 商家 + 楼层 + 窗口：
         有多选条件时走「不同餐厅或 + 每店内部与」；
         没有时保持旧版的三个独立单值判断（顺序与原实现一致） */
    if (scopes.length) {
      if (!matchShopScopes(dish, scopes)) {
        return false;
      }
    } else {
      if (shopId !== 'all' && dish.shopId !== shopId) {
        return false;
      }
      if (floorId !== 'all' && dish.floorId !== floorId) {
        return false;
      }
      if (stallId !== 'all' && dish.stallId !== stallId) {
        return false;
      }
    }

    /* 3. 主食类型：组内「或」 */
    if (foodTypes.length && foodTypes.indexOf(dish.foodType) === -1) {
      return false;
    }

    /* 4. 预算：0 表示不限，否则价格必须小于等于上限 */
    if (budget !== 0 && dish.price > budget) {
      return false;
    }

    /* 5. 口味：组内「或」，命中任意一个标签即可 */
    if (tastes.length && !hasAnyTaste(dish.tastes, tastes)) {
      return false;
    }

    return true;
  });
}

/**
 * 从菜品列表里提取「店铺 id」去重列表
 * 用于「随机选一家」：先得到符合条件的店铺池，再随机抽一家
 * @param {Array} dishes
 * @return {Array} shopId 数组
 */
function collectShopIds(dishes) {
  const ids = [];
  const seen = {};
  for (let i = 0; i < dishes.length; i++) {
    const id = dishes[i].shopId;
    if (!seen[id]) {
      seen[id] = true;
      ids.push(id);
    }
  }
  return ids;
}

/**
 * 排序：只改变展示顺序，绝不改变筛选结果
 *
 * 必须用 slice() 复制再排的原因：Array.prototype.sort 是原地排序。
 * 如果直接 sort(matched)，会把「符合条件的菜品集合」本身重排，
 * 后续的随机抽取、以及任何依赖顺序的逻辑都会跟着变，属于隐性污染。
 *
 * 同价菜按 id 兜底排序，保证同价时顺序固定、不会每次刷新都跳动。
 *
 * @param {Array} dishes   要排序的数组（不会被修改）
 * @param {String} sortMode 'default' | 'priceAsc' | 'priceDesc'
 * @return {Array} 新数组
 */
function applySort(dishes, sortMode) {
  const src = dishes || [];

  /* 默认顺序：原样返回，但仍然复制，保证调用方拿到的是独立数组 */
  if (sortMode !== 'priceAsc' && sortMode !== 'priceDesc') {
    return src.slice();
  }

  const dir = sortMode === 'priceAsc' ? 1 : -1;

  return src.slice().sort(function (a, b) {
    if (a.price !== b.price) {
      return (a.price - b.price) * dir;
    }
    /* 同价：按 id 升序兜底，两个方向都保持一致的可预测性 */
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

module.exports = {
  filterDishes: filterDishes,
  collectShopIds: collectShopIds,
  applySort: applySort
};
