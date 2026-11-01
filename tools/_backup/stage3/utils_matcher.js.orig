/**
 * 筛选内核：只做数据计算，不碰页面、不碰 UI。
 *
 * 把它单独拆出来的原因：
 *   1. 页面代码只剩「读状态 → 调这里 → 显示结果」，逻辑一眼看懂
 *   2. 这份代码可以在 Node 里直接跑测试，验证结果和你手机上看到的一致
 *
 * 条件对象 cond 的字段（全部可选，缺省 = 不限）：
 *   area     'all' | 'campus' | 'offsite'
 *   shopId   'all' | 具体餐厅 / 商家 id
 *   floorId  'all' | 具体楼层 id
 *   stallId  'all' | 具体窗口 / 档口 id
 *   foodType 'all' | 'rice' | 'noodle' | 'rice_noodle' | 'rice_vermicelli'
 *                  | 'dumpling' | 'malatang' | 'snack' | 'other'
 *   budget   0 = 不限预算；10 / 15 / 20 = 该金额以内（含）
 *   taste    'all' | 'light' | 'mild_spicy' | 'spicy'
 *
 * 说明：七个条件是「与」的关系，全部满足才会被选出来。
 *      这一点是「主食类型必须与其他筛选同时生效」的实现依据——
 *      不是在别处再补一段判断，而是同一处 and 条件。
 */

/**
 * 按条件筛选菜品
 * @param {Array} dishes 扁平菜品数组（来自 data/index.js 的 ALL_DISHES）
 * @param {Object} cond   条件对象
 * @return {Array} 符合条件的菜品
 */
function filterDishes(dishes, cond) {
  const c = cond || {};
  const area = c.area || 'all';
  const shopId = c.shopId || 'all';
  const floorId = c.floorId || 'all';
  const stallId = c.stallId || 'all';
  const foodType = c.foodType || 'all';
  const budget = (c.budget === undefined || c.budget === null) ? 0 : c.budget;
  const taste = c.taste || 'all';

  return dishes.filter(function (dish) {
    /* 1. 区域：不限 or 精确匹配 */
    if (area !== 'all' && dish.area !== area) {
      return false;
    }
    /* 2. 餐厅 / 商家 */
    if (shopId !== 'all' && dish.shopId !== shopId) {
      return false;
    }
    /* 3. 楼层 */
    if (floorId !== 'all' && dish.floorId !== floorId) {
      return false;
    }
    /* 4. 窗口 / 档口 */
    if (stallId !== 'all' && dish.stallId !== stallId) {
      return false;
    }
    /* 5. 主食类型：不限类型时不限制，选具体类型时精确匹配 */
    if (foodType !== 'all' && dish.foodType !== foodType) {
      return false;
    }
    /* 6. 预算：0 表示不限，否则价格必须小于等于上限 */
    if (budget !== 0 && dish.price > budget) {
      return false;
    }
    /* 7. 口味：一道菜可能有多个标签，命中任意一个即可 */
    if (taste !== 'all' && dish.tastes.indexOf(taste) === -1) {
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
