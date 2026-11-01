const {
  ALL_DISHES,
  ALL_SHOPS,
  AREA_LABEL,
  TASTE_LABEL,
  FOOD_TYPE_LABEL,
  DATA_STATUS_SUMMARY
} = require('../../data/index');
const { filterDishes, collectShopIds, applySort } = require('../../utils/matcher');

/* ---------------- 筛选选项配置 ---------------- */

const AREA_OPTIONS = [
  { value: 'all',     label: '不限区域' },
  { value: 'campus',  label: '校内食堂' },
  { value: 'offsite', label: '校外周边' }
];

const BUDGET_OPTIONS = [
  { value: 10, label: '10 元以内' },
  { value: 15, label: '15 元以内' },
  { value: 20, label: '20 元以内' },
  { value: 0,  label: '不限预算' }
];

const TASTE_OPTIONS = [
  { value: 'all',        label: '不限' },
  { value: 'light',      label: '清淡' },
  { value: 'mild_spicy', label: '微辣' },
  { value: 'spicy',      label: '麻辣' }
];

/**
 * 主食类型筛选选项
 * 'all' 只出现在这里（筛选器的「不限类型」），不会被写进任何一条菜品数据。
 */
const FOOD_TYPE_OPTIONS = [
  { value: 'all',             label: '不限类型' },
  { value: 'rice',            label: '饭类' },
  { value: 'noodle',          label: '面类' },
  { value: 'rice_noodle',     label: '米线类' },
  { value: 'rice_vermicelli', label: '粉类' },
  { value: 'dumpling',        label: '饺子馄饨类' },
  { value: 'malatang',        label: '麻辣烫 / 冒菜类' },
  { value: 'snack',           label: '面点小吃类' },
  { value: 'other',           label: '其他' }
];

/**
 * 排序选项
 * 只影响「查看全部」里菜品的展示顺序，不参与任何筛选判断。
 */
const SORT_OPTIONS = [
  { value: 'default',   label: '默认顺序' },
  { value: 'priceAsc',  label: '价格从低到高' },
  { value: 'priceDesc', label: '价格从高到低' }
];

/* 店铺 id → 店铺对象（含 floors / stalls） */
const SHOP_MAP = {};
ALL_SHOPS.forEach(function (shop) {
  SHOP_MAP[shop.id] = shop;
});

/* 小工具：按 id 在数组里找一项 */
function findById(list, id) {
  if (!list || !list.length) return null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

/* 数据状态一行：全部由数据实算，不写死数字 */
function buildDataStatusText() {
  const s = DATA_STATUS_SUMMARY;
  return '共 ' + s.dishTotal + ' 道菜 · ' + s.shopTotal + ' 家店：演示信息 ' +
    s.dish.demo + ' 道 · 待核实 ' + s.dish.unverified + ' 道 · 已核实 ' +
    s.dish.verified + ' 道';
}

Page({
  data: {
    /* 选项 */
    areaOptions: AREA_OPTIONS,
    foodTypeOptions: FOOD_TYPE_OPTIONS,
    budgetOptions: BUDGET_OPTIONS,
    tasteOptions: TASTE_OPTIONS,
    sortOptions: SORT_OPTIONS,

    /* 当前筛选状态（前四项是地点，后三项是通用条件） */
    area: 'all',
    shopId: 'all',
    floorId: 'all',
    stallId: 'all',
    budget: 0,
    foodType: 'all',
    taste: 'all',

    /* 地点三级的动态候选（随上一级变化而重建） */
    restaurantOptions: [],
    floorOptions: [],
    stallOptions: [],
    floorHint: '',
    stallHint: '',

    /* 筛选结果统计与文案 */
    conditionText: '不限区域 · 不限预算 · 不限类型 · 不限口味',
    matchedCount: 0,
    matchedShopCount: 0,

    /* 展示状态：none 未操作 / shop 随机选一家 / dish 随机选一道菜 / all 查看全部 */
    mode: 'none',
    pickedShop: null,
    pickedDish: null,
    listDishes: [],

    /* 排序模式：只影响展示顺序 */
    sortMode: 'default',

    /* 数据状态一行（可信度体系，阶段 2） */
    dataStatusText: buildDataStatusText()
  },

  onLoad() {
    this.matched = [];
    this.rebuildLocationOptions();
    this.refresh();
  },

  /* ================================================================
     地点三级：候选列表生成
     规则：
       · 选了区域，才出现「餐厅」这一级的候选
       · 选了餐厅，楼层候选才换成该餐厅真实配置的楼层
       · 选了楼层，窗口候选才收敛到该楼层下的窗口
       · 上一级是「不限」时，下一级只留「不限」一项 + 一句说明，
         绝不给出会造成无效组合的候选
       · 餐厅没有配楼层时（floors 为空），楼层这一级只留「不限楼层」，
         并提示可以直接选窗口，不会强迫用户选楼层
     ================================================================ */
  rebuildLocationOptions() {
    const area = this.data.area;
    const shopId = this.data.shopId;
    const floorId = this.data.floorId;

    /* ---- 1. 餐厅 / 商家候选 ---- */
    let restaurantOptions = [];
    if (area === 'campus' || area === 'offsite') {
      restaurantOptions = ALL_SHOPS
        .filter(function (s) { return s.area === area; })
        .map(function (s) { return { id: s.id, name: s.name }; });
    }

    /* ---- 2. 楼层候选 ---- */
    let floorOptions = [];
    let floorHint = '';
    if (shopId === 'all') {
      floorOptions = [];
      floorHint = area === 'campus' ? '先选具体餐厅，才能按楼层定位' : '';
    } else {
      const shop = SHOP_MAP[shopId];
      const floors = (shop && shop.floors) || [];
      if (!floors.length) {
        floorOptions = [];
        floorHint = '该餐厅没有楼层划分，直接选窗口即可';
      } else {
        floorOptions = floors.map(function (f) { return { id: f.id, label: f.label }; });
        floorHint = '';
      }
    }

    /* ---- 3. 窗口 / 档口候选 ---- */
    let stallOptions = [];
    let stallHint = '';
    if (shopId === 'all') {
      stallOptions = [];
      stallHint = area === 'campus' ? '先选具体餐厅，才能按窗口定位'
        : (area === 'offsite' ? '先选具体商家，才能按档口定位' : '');
    } else {
      const shop = SHOP_MAP[shopId];
      const stalls = (shop && shop.stalls) || [];
      stallOptions = stalls
        .filter(function (t) { return floorId === 'all' || t.floorId === floorId; })
        .map(function (t) { return { id: t.id, name: t.name }; });
      stallHint = stallOptions.length ? '' : '该楼层下暂无窗口';
    }

    this.setData({
      restaurantOptions: restaurantOptions,
      floorOptions: floorOptions,
      floorHint: floorHint,
      stallOptions: stallOptions,
      stallHint: stallHint
    });
  },

  /* ================================================================
     选择动作
     每一级变化都清空下一级，杜绝「一号食堂 + 三号食堂的 7 号窗口」这种脏组合
     ================================================================ */

  onSelectArea(e) {
    const area = e.currentTarget.dataset.value;
    this.setData({
      area: area,
      shopId: 'all',
      floorId: 'all',
      stallId: 'all'
    }, () => {
      this.rebuildLocationOptions();
      this.onFilterChanged();
    });
  },

  /* 餐厅（校内）/ 商家（校外） */
  onSelectShop(e) {
    const shopId = e.currentTarget.dataset.value;
    this.setData({
      shopId: shopId,
      floorId: 'all',
      stallId: 'all'
    }, () => {
      this.rebuildLocationOptions();
      this.onFilterChanged();
    });
  },

  onSelectFloor(e) {
    const floorId = e.currentTarget.dataset.value;
    this.setData({
      floorId: floorId,
      stallId: 'all'
    }, () => {
      this.rebuildLocationOptions();
      this.onFilterChanged();
    });
  },

  onSelectStall(e) {
    const stallId = e.currentTarget.dataset.value;
    this.setData({ stallId: stallId }, () => this.onFilterChanged());
  },

  onSelectBudget(e) {
    const value = Number(e.currentTarget.dataset.value);
    this.setData({ budget: value }, () => this.onFilterChanged());
  },

  /* 主食类型：与地点、预算、口味一样，只是改一个状态值，然后交给同一个筛选内核 */
  onSelectFoodType(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ foodType: value }, () => this.onFilterChanged());
  },

  onSelectTaste(e) {
    const value = e.currentTarget.dataset.value;
    this.setData({ taste: value }, () => this.onFilterChanged());
  },

  onReset() {
    this.setData({
      area: 'all',
      shopId: 'all',
      floorId: 'all',
      stallId: 'all',
      budget: 0,
      foodType: 'all',
      taste: 'all',
      mode: 'none',
      pickedShop: null,
      pickedDish: null,
      listDishes: [],
      sortMode: 'default'
    }, () => {
      this.rebuildLocationOptions();
      this.refresh();
    });
  },

  /* 条件变化后：重算数量；已经在看列表就实时刷新，看的是单个结果就清掉 */
  onFilterChanged() {
    const mode = this.data.mode;
    this.refresh();

    if (mode === 'all') {
      this.setData({ listDishes: this.sortedList() });
    } else if (mode === 'shop' || mode === 'dish') {
      this.setData({
        mode: 'none',
        pickedShop: null,
        pickedDish: null,
        listDishes: []
      });
    }
  },

  /* ================================================================
     核心计算
     ================================================================ */

  refresh() {
    const d = this.data;

    const list = filterDishes(ALL_DISHES, {
      area: d.area,
      shopId: d.shopId,
      floorId: d.floorId,
      stallId: d.stallId,
      foodType: d.foodType,
      budget: d.budget,
      taste: d.taste
    });
    this.matched = list;

    const shopIds = collectShopIds(list);

    /* 条件文案：不限的项也写出来，让用户一眼看到当前到底筛了什么 */
    const parts = [];

    parts.push(d.area === 'all' ? '不限区域' : AREA_LABEL[d.area]);

    if (d.shopId !== 'all') {
      const shop = SHOP_MAP[d.shopId];
      if (shop) parts.push(shop.name);
    }
    if (d.floorId !== 'all') {
      const shop = SHOP_MAP[d.shopId];
      const floor = shop ? findById(shop.floors, d.floorId) : null;
      if (floor) parts.push(floor.label);
    }
    if (d.stallId !== 'all') {
      const shop = SHOP_MAP[d.shopId];
      const stall = shop ? findById(shop.stalls, d.stallId) : null;
      if (stall) parts.push(stall.name);
    }

    parts.push(d.budget === 0 ? '不限预算' : d.budget + ' 元以内');
    parts.push(d.foodType === 'all' ? '不限类型' : FOOD_TYPE_LABEL[d.foodType]);
    parts.push(d.taste === 'all' ? '不限口味' : TASTE_LABEL[d.taste]);

    this.setData({
      matchedCount: list.length,
      matchedShopCount: shopIds.length,
      conditionText: parts.join(' · ')
    });
  },

  /* ================================================================
     排序
     只改变展示顺序，绝不改变 this.matched（筛选结果）
     ================================================================ */

  /* 当前条件匹配到的菜，按当前排序模式产出。永远返回新数组，不会污染 this.matched */
  sortedList() {
    return applySort(this.matched, this.data.sortMode);
  },

  onSelectSort(e) {
    const sortMode = e.currentTarget.dataset.value;
    const patch = { sortMode: sortMode };

    /* 正在看列表：立刻按新排序重排。其他状态只记住选择，下次列表生效 */
    if (this.data.mode === 'all') {
      patch.listDishes = applySort(this.matched, sortMode);
    }

    this.setData(patch);
  },

  /* ================================================================
     三种推荐：全部基于 this.matched，也就是「满足全部条件」的集合
     ================================================================ */

  /* 抽一家店铺。excludeShopId 为空 = 纯随机（允许和上次同一家）；
     有值 = 换一家（必须不同，没有别的候选就提示，不静默返回同一家） */
  drawShop(excludeShopId) {
    const list = this.matched;
    if (!list.length) {
      wx.showToast({ title: '当前条件没有符合条件的菜品', icon: 'none' });
      return;
    }

    let shopIds = collectShopIds(list);

    if (excludeShopId) {
      shopIds = shopIds.filter(function (id) {
        return id !== excludeShopId;
      });

      if (!shopIds.length) {
        wx.showToast({ title: '没有其他符合条件的店铺，换个条件试试', icon: 'none' });
        return;
      }
    }

    const shopId = shopIds[Math.floor(Math.random() * shopIds.length)];
    const shop = SHOP_MAP[shopId] || {};
    const dishes = list.filter(function (dish) {
      return dish.shopId === shopId;
    });

    this.setData({
      mode: 'shop',
      pickedDish: null,
      listDishes: [],
      pickedShop: {
        id: shopId,
        name: shop.name || '未知店铺',
        areaText: shop.areaText || '',
        building: shop.building || '',
        location: shop.location || '',
        dishes: dishes,

        /* 可信度：整家店（含楼层 / 窗口）取最弱一环 */
        verifyStatus: shop.verifyStatus,
        verifyText: shop.verifyText,
        verifyClass: shop.verifyClass,
        verifyTip: shop.verifyTip,
        verifyNote: shop.verifyNote,
        verifiedAt: shop.verifiedAt,
        sourceKindText: shop.sourceKindText,
        sourceDetail: shop.sourceDetail,
        sourceRef: shop.sourceRef
      }
    });
  },

  /* 抽一道菜。和店铺抽取一样，是纯随机，不排除上次结果 */
  drawDish() {
    const list = this.matched;
    if (!list.length) {
      wx.showToast({ title: '当前条件没有符合条件的菜品', icon: 'none' });
      return;
    }

    const dish = list[Math.floor(Math.random() * list.length)];

    this.setData({
      mode: 'dish',
      pickedShop: null,
      listDishes: [],
      pickedDish: dish
    });
  },

  /* 随机选一家：纯随机，允许和上一次是同一家（这才是"随机"） */
  onRandomShop() {
    this.drawShop(null);
  },

  /* 换一家：排除当前这家，从其余符合条件的店铺里抽 */
  onChangeShop() {
    const cur = this.data.pickedShop ? this.data.pickedShop.id : null;
    this.drawShop(cur);
  },

  /* 再抽一次：沿用当前模式重新抽，允许抽回原结果 */
  onDrawAgain() {
    const mode = this.data.mode;

    if (mode === 'shop') {
      this.drawShop(null);
      return;
    }

    if (mode === 'dish') {
      this.drawDish();
      return;
    }

    wx.showToast({ title: '先选一种推荐方式', icon: 'none' });
  },

  /* 随机选一道菜：直接在符合条件的菜品池里随机抽一道 */
  onRandomDish() {
    this.drawDish();
  },

  /* 查看全部：把符合条件的菜品整表列出来，按当前排序 */
  onViewAll() {
    /* 空结果时和其他两个按钮保持一致：只提示，不切状态，
       避免界面被空态卡片盖住、状态却已经变成 'all' */
    if (!this.matched.length) {
      wx.showToast({ title: '当前条件没有符合条件的菜品', icon: 'none' });
      return;
    }

    this.setData({
      mode: 'all',
      pickedShop: null,
      pickedDish: null,
      listDishes: this.sortedList()
    });
  }
});
