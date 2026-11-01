const {
  ALL_DISHES,
  ALL_SHOPS,
  AREA_LABEL,
  TASTE_LABEL,
  FOOD_TYPE_LABEL,
  SIDE_LABEL,
  DATA_STATUS_SUMMARY
} = require('../../data/index');
const { filterDishes, collectShopIds, applySort } = require('../../utils/matcher');
const { validateDataset } = require('../../utils/datasetGuard');
const { loadCloudDataset } = require('../../utils/cloudRepo');
const b1Adapter = require('../../utils/b1Adapter');

/* ---------------- 筛选选项配置 ---------------- */

const AREA_OPTIONS = [
  { value: 'all',     label: '不限区域' },
  { value: 'campus',  label: '校内食堂' },
  { value: 'offsite', label: '校外周边' }
];

/**
 * 预算选项：单选，保持不变。
 * 展示方式改成横向滚动（见 index.wxml），选项文字一个字都不缩。
 */
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
 * 八个枚举一个都不删：rice / noodle / rice_noodle / rice_vermicelli /
 * dumpling / malatang / snack / other
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

/* ---------------- 数据加载的常量 ---------------- */

/**
 * 单次加载的最长等待时间（毫秒）。
 * 只给"数据源卡死不返回"兜底：本地同步路径根本用不到它，接云端后才真正生效。
 * 单独起名字，测试引用同一个常量，两边不会各写一个数字。
 */
const LOAD_TIMEOUT_MS = 8000;

/* 来源标识：provider 没写 source 时落到 unknown。
   宁可显示"来源未知"，也不把它默认成本地数据或演示数据。 */
const SOURCE_LOCAL = 'local';
const SOURCE_CLOUD = 'cloud';
const SOURCE_UNKNOWN = 'unknown';

/* 云端失败 / 空数据时回退到演示数据的两句提示：必须让用户一眼看出现在看的不是真实数据 */
const NOTICE_CLOUD_FALLBACK = '真实数据加载失败，当前展示的是演示数据';
const NOTICE_CLOUD_EMPTY = '云端还没有可展示的真实数据，当前展示的是演示数据';

/* 两种失败文案，都要求用户能看懂"点重试" */
const LOAD_ERROR_TEXT = '数据暂时无法加载，请点「重试」再试一次';
const LOAD_TIMEOUT_TEXT = '加载等待时间过长，已停止等待，请点「重试」再试一次';
/* 上一轮请求还挂在那里、又点重试时的提示：说明为什么点了没反应 */
const LOAD_BUSY_TEXT = '上一次加载还在等待，请稍后再试';

/**
 * 同时在途的底层请求上限（阶段 3-3.4 / 修复 R-B）。
 *
 * 为什么要有一个上限：小程序云开发的数据库查询**没有取消接口**
 * （全项目 grep abort / AbortController / requestTask 均为 0 命中，
 *  数据库查询返回的 Promise 也没有 abort 之类的句柄）。
 * 8 秒超时只是让页面停止等待，底层请求还在跑。如果每 8 秒超时一次就允许重试，
 * 挂起的请求会无限累积，每个都抱着一个页面实例的闭包。
 *
 * 取 2 的理由：允许"超时后立刻重试一次"这个正常动作，但绝不允许第三次；
 * 一旦某一轮真正结束（resolve / reject），计数就会减回去，重试重新可用。
 * 所以它是"有上限的等待"，不是"永久锁死"。
 */
const LOAD_INFLIGHT_MAX = 2;

/* 云端自己的等待上限：先于页面总超时回退演示数据，避免整页变错误态 */
const CLOUD_TIMEOUT_MS = 6000;


/* 店铺 id → 店铺对象（含 floors / stallList / stallSideOptions）
 *
 * 注意：这是**本地演示数据**的模块级映射，只在两处用：
 *   1) 模块加载时算 DEFAULT_CONDITION_TEXT（页面还没有实例，拿不到 this.shopMap）
 *   2) buildConditionText 的兜底 lookup
 * 页面运行时一律用 this.shopMap（由 applyDataset 按当前数据源现场建），
 * 这样将来换成云端数据时，展示与摘要都跟着数据源走，不会一半新一半旧。 */
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

/* ================================================================
   多选状态的小工具
   ================================================================ */

/* 一家店的空条件：三个组都是空数组 = 三组都不限 */
function emptyShopFilter() {
  return { floorIds: [], stallIds: [], sides: [] };
}

/* 复制一份，避免 setData 之后新旧状态共用同一个数组 */
function cloneShopFilter(filter) {
  const src = filter || {};
  return {
    floorIds: (src.floorIds || []).slice(),
    stallIds: (src.stallIds || []).slice(),
    sides: (src.sides || []).slice()
  };
}

/* 组内切换：已经在里面就移除，不在就加入。组内是「或」，顺序不影响结果 */
function toggleInArray(list, value) {
  const arr = (list || []).slice();
  const i = arr.indexOf(value);
  if (i === -1) arr.push(value);
  else arr.splice(i, 1);
  return arr;
}

/**
 * 选项列表 → 带选中标记的 chip 视图
 * WXML 里不能调 indexOf，所以选中态必须在这里算好。
 * 'all' 这一项代表「这一组不限」，对应状态是数组为空。
 */
function buildOptionChips(options, selected) {
  const list = selected || [];
  return options.map(function (opt) {
    if (opt.value === 'all') {
      return { value: opt.value, label: opt.label, on: list.length === 0 };
    }
    return { value: opt.value, label: opt.label, on: list.indexOf(opt.value) !== -1 };
  });
}

/* 数据状态一行：全部由数据实算，不写死数字 */
function buildDataStatusText(summary) {
  const s = summary || DATA_STATUS_SUMMARY;
  return '共 ' + s.dishTotal + ' 道菜 · ' + s.shopTotal + ' 家店：演示信息 ' +
    s.dish.demo + ' 道 · 待核实 ' + s.dish.unverified + ' 道 · 已核实 ' +
    s.dish.verified + ' 道';
}

/**
 * 条件摘要：唯一的一处生成逻辑。
 * data.conditionText 的初始值和每次刷新都用它，避免「默认文案」和「拼装逻辑」
 * 变成两份互相漂移的真相。
 *
 * 餐厅段的结构是「店名(楼 层·店铺·方位) + 店名(...)」，
 * 括号里只写这家店真正选了的条件，全不限就不带括号。
 */
function buildConditionText(state, shopMap) {
  const s = state || {};
  const lookup = shopMap || SHOP_MAP;
  const parts = [];

  parts.push(s.area && s.area !== 'all' ? (AREA_LABEL[s.area] || s.area) : '不限区域');

  const selected = s.selectedShops || [];
  const filters = s.shopFilters || {};

  if (selected.length) {
    const segs = selected.map(function (id) {
      const shop = lookup[id];
      const name = shop ? shop.name : id;
      const f = filters[id] || emptyShopFilter();
      const sub = [];

      (f.floorIds || []).forEach(function (fid) {
        const floor = shop ? findById(shop.floors, fid) : null;
        if (floor) sub.push(floor.label);
      });
      (f.stallIds || []).forEach(function (tid) {
        const stall = shop ? findById(shop.stallList, tid) : null;
        if (stall) sub.push(stall.label);
      });
      (f.sides || []).forEach(function (v) {
        if (SIDE_LABEL[v]) sub.push(SIDE_LABEL[v]);
      });

      return name + (sub.length ? '(' + sub.join('·') + ')' : '');
    });
    parts.push(segs.join(' + '));
  }

  parts.push(s.budget === 0 || !s.budget ? '不限预算' : s.budget + ' 元以内');

  const foodTypes = s.foodTypes || [];
  parts.push(foodTypes.length
    ? foodTypes.map(function (v) { return FOOD_TYPE_LABEL[v] || v; }).join('/')
    : '不限类型');

  const tastes = s.tastes || [];
  parts.push(tastes.length
    ? tastes.map(function (v) { return TASTE_LABEL[v] || v; }).join('/')
    : '不限口味');

  return parts.join(' · ');
}

/* 默认状态下的摘要，直接由同一个生成函数产出 */
const DEFAULT_CONDITION_TEXT = buildConditionText({
  area: 'all',
  selectedShops: [],
  shopFilters: {},
  budget: 0,
  foodTypes: [],
  tastes: []
});

Page({
  data: {
    /* 选项配置 */
    areaOptions: AREA_OPTIONS,
    foodTypeOptions: FOOD_TYPE_OPTIONS,
    budgetOptions: BUDGET_OPTIONS,
    tasteOptions: TASTE_OPTIONS,
    sortOptions: SORT_OPTIONS,

    /* ---------------- 加载状态 ---------------- */

    /* 由 beginLoad() 真实驱动：loading → ready；抛错 → error
       注意：本地数据是同步模块，这里仍然走 Promise 链，是为了让
       "数据准备好之前不渲染依赖数据的列表" 这条规则由流程保证，
       而不是靠 wx:if 假装。加载中在真机上通常一闪而过，这是正常的。 */
    dataState: 'loading',

    /* 数据来源：loading 阶段先标 unknown，加载完成后才落成 local / cloud */
    dataSource: 'unknown',
    /* 回退说明：真实数据加载失败或为空时，这里会有一句「当前是演示数据」 */
    dataNoticeText: '',

    /* error 态展示给用户的中性说明；其他状态恒为空串 */
    dataErrorText: '',

    /* ---------------- 当前筛选状态 ---------------- */

    /* 区域：仍然单选 */
    area: 'all',

    /* 餐厅多选：有序数组，是这一层的原始真相 */
    selectedShops: [],

    /* 每店独立的位置条件：{ shopId: { floorIds: [], stallIds: [], sides: [] } }
       key 必然是 selectedShops 的子集；取消餐厅时同步删 key，不留孤儿状态 */
    shopFilters: {},

    /* 每店配置区的折叠状态：只影响 UI，不参与筛选 */
    expandedShops: {},

    /* 预算仍单选 */
    budget: 0,

    /* 组内「或」的两组，空数组 = 不限 */
    foodTypes: [],
    tastes: [],

    /* ---------------- 视图数据 ---------------- */

    /* 当前区域下的餐厅候选（带 selected 标记） */
    restaurantOptions: [],

    /* 已选餐厅的位置配置视图（楼层 / 店铺 / 方位 / 折叠 / 摘要） */
    shopViews: [],

    /* 类型与口味的多选 chip */
    foodTypeChips: buildOptionChips(FOOD_TYPE_OPTIONS, []),
    tasteChips: buildOptionChips(TASTE_OPTIONS, []),

    /* ---------------- 结果与展示 ---------------- */

    conditionText: DEFAULT_CONDITION_TEXT,
    matchedCount: 0,
    matchedShopCount: 0,

    /* none 未操作 / shop 随机选一家 / dish 随机选一道菜 / all 查看全部 */
    mode: 'none',
    pickedShop: null,
    pickedDish: null,
    listDishes: [],

    sortMode: 'default',

    dataStatusText: buildDataStatusText()
  },

  onLoad() {
    /* ---- 加载流程需要的实例状态（不进 data，避免无谓的 setData） ---- */
    this._alive = true;        /* 页面是否还活着：onUnload 后禁止再 setData */
    this._loadSeq = 0;         /* 加载序号：旧加载完成时不能覆盖新加载 */
    this._loading = false;     /* 是否有一轮加载在进行：给「重试」做防重复 */
    this._inflight = 0;        /* 仍在底层跑、尚未真正结束的请求数（含已超时的） */
    this._loadError = null;    /* 原始加载错误（真正的失败原因） */
    this._settleError = null;  /* 收口阶段自身抛的错误，与 _loadError 分开记 */
    this._setDataError = null; /* 连 setData 都失败时的错误，不再往外冒 */
    this.raw = null;           /* { source, shops, dishes } —— 当前数据源的内容 */
    this.shopMap = Object.create(null); /* 由 raw.shops 现场建，画店时查详情 */
    this.matched = [];         /* 当前条件命中的菜，refresh() 产出 */

    /* 云端数据源的实例状态：idle / loading / done / failed / unsupported
       done 表示已有真实数据、不再重复查询；failed 表示本轮已回退演示数据 */
    this._cloudState = 'idle';
    this._cloudCachedRaw = null;
    this._cloudNotice = '';

    this.beginLoad();
  },

  onUnload() {
    /* 只打标记，不做取消。本地数据是同步的，没有可取消的在途请求；
       标记的作用是拦住 after-unload 的 setData。

       阶段 3-3.4 补充：即使将来接云端、请求还挂着，这里也不去动它 ——
       小程序云开发的查询没有取消接口，硬等它自己结束才是唯一诚实的做法。
       页面上不会再多发请求，实例会被 JS 引擎连同闭包一起回收。 */
    this._alive = false;
  },

  /* ================================================================
     数据加载流程
     ================================================================
     本阶段只有本地一个数据源，且它是同步 require 进来的模块。
     仍然走 Promise，是因为后面接云端时这里要原样替换成异步取数，
     状态机与 WXML 的分支不能那时再改一遍。

     失败分支在本地场景下不可能自然发生 —— 不伪造失败。
     它通过 test_index_state.js 替换 loadRawDataset 来覆盖。
     ================================================================ */

  /* ================================================================
     数据来源：优先真实（云端只读），失败 / 为空则回退本地演示数据
     ================================================================
     四条规则：
       1. 只在 onLoad 或用户点「重试」时尝试云端；成功后缓存，
          页面重新渲染不会再发查询（`_cloudState === 'done'`）。
       2. 失败（异常 / 超时 / 空数据）一律回退演示数据，
          并在界面明确标出「当前是演示数据」，绝不冒充真实数据。
       3. 一次加载只选一份数据，演示数据与真实数据不混在同一个列表里。
       4. 只读：三集合「所有用户可读」，不写任何云端数据。 */

  /* 本地演示数据（同步、永远可用） */
  buildLocalRaw(notice) {
    return {
      source: SOURCE_LOCAL,
      shops: ALL_SHOPS,
      dishes: ALL_DISHES,
      statusText: buildDataStatusText(),
      noticeText: notice || ''
    };
  },

  /* 云端数据源：测试可整体替换这个函数；生产走 wx.cloud.database() */
  fetchCloudDataset() {
    return loadCloudDataset({ db: wx.cloud.database() });
  },

  /* 当前环境是否具备云端只读能力 */
  canUseCloud() {
    try {
      return typeof wx !== 'undefined' && !!wx && !!wx.cloud &&
        typeof wx.cloud.database === 'function';
    } catch (err) {
      return false;
    }
  },

  /* 唯一的「数据来源」接缝 */
  loadRawDataset() {
    const self = this;

    /* 注入的加载器只替换"怎么取云端数据"这一步，后面的归一化、回退、
       缓存逻辑一律照常走 —— 否则测试就会绕开真实分支，测了个寂寞。 */
    const hasInjectedLoader = typeof this._cloudLoader === 'function';
    const fetch = hasInjectedLoader ? this._cloudLoader : this.fetchCloudDataset.bind(this);

    if (!hasInjectedLoader && !this.canUseCloud()) {
      this._cloudState = 'unsupported';
      return this.buildLocalRaw(NOTICE_CLOUD_FALLBACK);
    }

    if (this._cloudState === 'done' && this._cloudCachedRaw) {
      return this._cloudCachedRaw;   /* 已有真实数据：不重复查询 */
    }
    if (this._cloudState === 'failed') {
      return this.buildLocalRaw(this._cloudNotice || NOTICE_CLOUD_FALLBACK);
    }

    this._cloudState = 'loading';

    /* 云端自己的 6 秒上限：比页面 8 秒总超时更早，保证「先回退到演示数据」，
       而不是把整个页面推成错误态、让用户无数据可看。 */
    let timer = null;
    const fetchPromise = fetch();
    const timeoutPromise = new Promise(function (resolve) {
      timer = self._setLoadTimer(function () {
        timer = null;
        resolve({ __quickTimeout: true });
      }, CLOUD_TIMEOUT_MS);
    });

    return Promise.race([fetchPromise, timeoutPromise])
      .then(function (res) {
        if (timer !== null) { self._clearLoadTimer(timer); timer = null; }

        if (!res || res.__quickTimeout) {
          self._cloudState = 'failed';
          self._cloudNotice = NOTICE_CLOUD_FALLBACK;
          return self.buildLocalRaw(NOTICE_CLOUD_FALLBACK);
        }

        const view = b1Adapter.normalizeAdaptedDataset({
          shops: (res && res.shops) || [],
          dishes: (res && res.dishes) || []
        });
        if (!view.ALL_DISHES.length) {
          self._cloudState = 'failed';
          self._cloudNotice = NOTICE_CLOUD_EMPTY;
          return self.buildLocalRaw(NOTICE_CLOUD_EMPTY);
        }

        self._cloudState = 'done';
        self._cloudCachedRaw = {
          source: SOURCE_CLOUD,
          shops: view.ALL_SHOPS,
          dishes: view.ALL_DISHES,
          /* 云端文案要自报家门：同一句汇总，真实数据前面加「真实试点数据」，避免和演示数据混淆 */
          statusText: '真实试点数据 · ' + buildDataStatusText(view.DATA_STATUS_SUMMARY),
          noticeText: ''
        };
        return self._cloudCachedRaw;
      })
      .catch(function () {
        if (timer !== null) { self._clearLoadTimer(timer); timer = null; }
        self._cloudState = 'failed';
        self._cloudNotice = NOTICE_CLOUD_FALLBACK;
        return self.buildLocalRaw(NOTICE_CLOUD_FALLBACK);
      });
  },

  /* 把一份原始数据装配成页面可直接用的形态。同步、无副作用、可重入 */
  applyDataset(raw) {
    const shops = (raw && raw.shops) || [];
    const map = Object.create(null);
    shops.forEach(function (shop) {
      map[shop.id] = shop;
    });

    /* 来源只认 provider 明确写出的非空字符串。
       缺字段 / 空串 / 非字符串一律落 unknown —— 不给它任何默认值，
       否则云端数据会被显示成"本地"，进而连"演示数据"那条横幅都变成假话。 */
    const declared = (raw && typeof raw.source === 'string') ? raw.source.trim() : '';
    this.raw = {
      source: declared || SOURCE_UNKNOWN,
      shops: shops,
      dishes: (raw && raw.dishes) || [],
      noticeText: (raw && typeof raw.noticeText === 'string') ? raw.noticeText : ''
    };
    this.shopMap = map;
  },

  /* 加载 / 重试的唯一入口。
   *
   * 一轮加载从开始到落幕，只允许"成功 / 失败 / 超时"三者之中发生一次，
   * 统一由 settle() 收口；锁和最终状态只归序号最新的一轮。
   *
   * 五条路径都必须经过 settle，不允许谁自己改 _loading：
   *   1 同步成功   2 同步抛错   3 异步成功   4 异步 reject   5 超时
   */
  beginLoad() {
    const self = this;

    /* 在途上限（修复 R-B）：已经有 LOAD_INFLIGHT_MAX 个请求没真正结束 ——
       包括那些早被超时"放弃等待"、但底层仍在跑的 —— 就不再发新的。
       此时刻意不改 dataState：页面保持当前样子（多为 error），
       只给一句提示；等其中任意一个真正结束，配额还回来，重试自然可用。 */
    if (this._inflight >= LOAD_INFLIGHT_MAX) {
      this._notifyBusy();
      return Promise.resolve(null);
    }

    const seq = ++this._loadSeq;

    this._loading = true;
    if (this._alive !== false) {
      this.setData({ dataState: 'loading', dataErrorText: '' });
    }

    let settled = false;   /* 本轮是否已经有结论 */
    let timer = null;      /* 只有异步路径才会真的开表 */

    function clearTimer() {
      if (timer === null) return;
      self._clearLoadTimer(timer);
      timer = null;
    }

    /* 唯一收口：只收敛一次；过期轮次不碰状态与数据；卸载后不碰界面。
     *
     * 阶段 3-3.4 的关键改动：handler 自己抛错时，兜底也必须落到 error。
     * 之前只记一句 _loadError 就完事，dataState 会永远停在 'loading'，
     * 而 loading 卡上没有重试按钮 —— 用户就再也出不来了。 */
    function settle(handler) {
      if (settled) return;
      settled = true;
      clearTimer();

      /* 已经被更新的加载顶掉：不改状态、不改数据、不解别人的锁 */
      if (seq !== self._loadSeq) return;

      /* 锁只归最新一轮，并且只由它自己释放 */
      self._loading = false;

      /* 页面已卸载：只收敛锁，不再 setData */
      if (self._alive === false) return;

      try {
        handler();
      } catch (err) {
        /* 处理阶段的错误单独记，绝不覆盖 _loadError 里已有的原始原因 */
        self._settleError = (err && err.message) || String(err);
        if (!self._loadError) self._loadError = self._settleError;

        /* 直接改状态，不再回调 fail()：失败处理只走一次，不递归 */
        try {
          self.setData({ dataState: 'error', dataErrorText: LOAD_ERROR_TEXT });
        } catch (setErr) {
          /* 连 setData 都失败（实例已被销毁之类）：只留痕，不再往上抛，
             否则异步链末端会变成 unhandled rejection */
          self._setDataError = (setErr && setErr.message) || String(setErr);
        }
      }
    }

    function finish(raw) {
      /* 先校验，再应用（阶段 3-3.4 / 修复 R-E）。
         不合格就当场抛，由 settle 收口到 error —— 这时 this.raw 与 this.shopMap
         一个字都还没动，旧数据完好无损。绝不"先覆盖再发现问题"。 */
      const guard = validateDataset(raw);
      if (!guard.ok) {
        const first = guard.errors[0] || '结构不合格';
        const more = guard.errors.length > 1 ? '（另有 ' + (guard.errors.length - 1) + ' 处）' : '';
        const err = new Error('数据集被拒绝：' + first + more);
        err.datasetErrors = guard.errors;
        throw err;
      }

      self.applyDataset(raw);
      self._loadError = null;   /* 成功后清掉上一轮的诊断残留 */
      self._settleError = null;
      self.rebuildShopViews();
      self.refresh();
      self.setData({
        dataState: 'ready',
        dataSource: self.raw.source,
        dataNoticeText: self.raw.noticeText || '',
        dataErrorText: '',
        dataStatusText: (raw && raw.statusText) || self.data.dataStatusText
      });
    }

    function fail(err) {
      /* 原始错误留在实例上便于排查，界面上只给中性提示 */
      self._loadError = (err && err.message) || String(err);
      self.setData({
        dataState: 'error',
        dataErrorText: LOAD_ERROR_TEXT
      });
    }

    function timeout() {
      self._loadError = 'load timeout after ' + LOAD_TIMEOUT_MS + 'ms';
      self.setData({
        dataState: 'error',
        dataErrorText: LOAD_TIMEOUT_TEXT
      });
    }

    let raw;
    try {
      raw = this.loadRawDataset();
    } catch (err) {
      settle(function () { fail(err); });
      return Promise.resolve(null);
    }

    /* 异步路径：云端或任何返回 Promise 的数据源走这里。
       定时器只在异步路径开，同步路径不会留下任何活表。 */
    let isThenable = false;
    try {
      isThenable = !!(raw && typeof raw.then === 'function');
    } catch (err) {
      /* 极端情况：thenable 的 getter 自己抛错。当作本次加载失败，
         锁由 settle 释放，不能让异常直接冒到 onLoad 把 _loading 锁死 */
      settle(function () { fail(err); });
      return Promise.resolve(null);
    }

    if (isThenable) {
      /* 先记账再挂处理器：从这一刻起这个请求就算"在途"。
         超时只清定时器、只放 _loading，**不会**减这里 —— 因为请求还在跑。 */
      this._inflight += 1;
      let released = false;
      function releaseInflight() {
        if (released) return;
        released = true;
        self._inflight = Math.max(0, self._inflight - 1);
      }

      try {
        timer = this._setLoadTimer(function () {
          timer = null;          /* 已经到期，不用再清 */
          settle(timeout);
        }, LOAD_TIMEOUT_MS);
      } catch (err) {
        /* 连定时器都开不起来（宿主环境异常）：按失败处理，别把锁留在 loading */
        releaseInflight();
        settle(function () { fail(err); });
        return Promise.resolve(null);
      }

      return Promise.resolve(raw)
        .then(function (value) {
          settle(function () { finish(value); });
          return value;
        })
        .catch(function (err) {
          settle(function () { fail(err); });
          return null;
        })
        .then(function (value) {
          /* 真正的结束点：请求已经不再占用底层，配额还回去。
             超时的那条路永远走不到这里 —— 那正是"不会无限累积"的实现方式。 */
          releaseInflight();
          return value;
        });
    }

    /* 同步路径：本地演示数据是同步模块，onLoad 返回时数据已经就绪，
       行为与加状态机之前完全一致；loading 只是一帧过渡，不靠定时器假装。 */
    settle(function () { finish(raw); });
    return Promise.resolve(this.raw);
  },

  /* 定时器做成实例方法：测试换成可控时钟，生产用真实 setTimeout。
     清理策略：settle() 里统一 clearTimer，成功 / 失败 / 超时都不会留下活表；
     页面卸载后若仍有一轮在途，它的表最多再活 LOAD_TIMEOUT_MS，到点自己触发
     一次 settle —— 那次只放锁，不 setData。 */
  _setLoadTimer(fn, ms) {
    return setTimeout(fn, ms);
  },

  _clearLoadTimer(id) {
    clearTimeout(id);
  },

  /* 只给测试与排查用：让两边引用同一个超时值，避免测试里再写一个魔法数字 */
  getLoadTimeoutMs() {
    return LOAD_TIMEOUT_MS;
  },

  /* 只给测试与排查用：当前还有几个底层请求没真正结束 */
  getInflightCount() {
    return this._inflight || 0;
  },

  /* 在途请求已到上限时的反馈：只提示，不改状态、不动数据。
     用 toast 而不是把页面推成 error —— 数据可能还是好的，
     推成 error 反而会让用户以为"数据没了"。 */
  _notifyBusy() {
    this._loadBusy = true;
    try {
      if (typeof wx !== 'undefined' && wx && typeof wx.showToast === 'function') {
        wx.showToast({ title: LOAD_BUSY_TEXT, icon: 'none', duration: 2000 });
      }
    } catch (err) {
      /* 提示失败不影响主流程，也不能因此抛到调用方 */
      this._loadBusyError = (err && err.message) || String(err);
    }
  },

  onRetry() {
    if (this._loading) return;   /* 连点不叠加，避免重复初始化 */
    this.beginLoad();
  },

  /* ================================================================
     视图重建：餐厅候选 + 每家已选餐厅的位置配置
     ================================================================
     规则：
       · 选了区域，才出现餐厅候选（区域仍是单选）
       · 只有已选中的餐厅才会展开出一块配置区，默认折叠
       · 楼层候选来自该店自己的 floors，没有楼层就不给假楼层
       · 店铺 / 位置候选来自该店真实的 stallList，并按已选楼层收敛
       · 方位候选只由该店真实出现过的 side 去重得到；一个都没有时整行为空
       · 不要求每家店都有楼层、都有窗口编号、都有方位
     ================================================================ */
  rebuildShopViews() {
    const d = this.data;
    const area = d.area;
    const selected = d.selectedShops || [];
    const filters = d.shopFilters || {};
    const expanded = d.expandedShops || {};

    /* ---- 餐厅候选（只跟区域有关，不跟别的筛选联动） ---- */
    const shops = (this.raw && this.raw.shops) || [];

    let restaurantOptions = [];
    if (area === 'campus' || area === 'offsite') {
      restaurantOptions = shops
        .filter(function (s) { return s.area === area; })
        .map(function (s) {
          return {
            id: s.id,
            name: s.name,
            selected: selected.indexOf(s.id) !== -1
          };
        });
    }

    /* ---- 每家已选餐厅的配置视图 ---- */
    const self = this;
    const shopViews = selected
      .filter(function (id) { return !!self.shopMap[id]; })
      .map(function (id) {
        return self.buildShopView(id, filters[id], !!expanded[id]);
      });

    this.setData({
      restaurantOptions: restaurantOptions,
      shopViews: shopViews
    });
  },

  /* 单家餐厅的配置视图。参数里的 filter 允许是 undefined（= 三组都不限） */
  buildShopView(shopId, filter, expanded) {
    const shop = this.shopMap[shopId];
    const f = cloneShopFilter(filter);
    const floorIds = f.floorIds;
    const stallIds = f.stallIds;
    const sides = f.sides;

    /* ---- 楼层：该店真实配置 ---- */
    const floors = shop.floors || [];
    const hasFloor = floors.length > 0;
    const floorChips = hasFloor
      ? [{ id: 'all', label: '不限楼层', on: floorIds.length === 0 }].concat(
        floors.map(function (fl) {
          return { id: fl.id, label: fl.label, on: floorIds.indexOf(fl.id) !== -1 };
        })
      )
      : [];
    const floorHint = hasFloor ? '' : '该餐厅没有楼层划分，直接选店铺即可';

    /* ---- 店铺 / 位置：按已选楼层收敛，不串楼层 ---- */
    const stallList = shop.stallList || [];
    const visibleStalls = stallList.filter(function (st) {
      if (!floorIds.length) return true;
      return floorIds.indexOf(st.floorId) !== -1;
    });

    const stallAllLabel = shop.area === 'offsite' ? '不限档口' : '不限店铺';
    const stallChips = [{ id: 'all', label: stallAllLabel, on: stallIds.length === 0 }]
      .concat(visibleStalls.map(function (st) {
        return {
          id: st.id,
          label: st.label,
          /* 编号三态透传给界面：'has' 有编号 / 'none' 确认无编号 / 'unverified' 尚未核实 */
          noStatus: st.noStatus,
          on: stallIds.indexOf(st.id) !== -1
        };
      }));

    let stallHint = '';
    const noSum = shop.stallNoSummary || { has: 0, none: 0, unverified: 0, total: 0 };
    if (!stallList.length) {
      stallHint = '该餐厅暂无店铺记录';
    } else if (noSum.total && noSum.none === noSum.total) {
      stallHint = '该餐厅窗口不编号，按店铺名选择';
    } else if (noSum.unverified > 0) {
      stallHint = '部分窗口编号尚未核实';
    }

    /* ---- 方位：数据里一个都没有时，整行不渲染 ---- */
    const sideOptions = shop.stallSideOptions || [];
    const sideChips = sideOptions.length
      ? [{ value: 'all', label: '不限方位', on: sides.length === 0 }].concat(
        sideOptions.map(function (o) {
          return { value: o.value, label: o.label, on: sides.indexOf(o.value) !== -1 };
        })
      )
      : [];

    /* ---- 折叠时显示的一句话摘要 ---- */
    const parts = [];
    floorIds.forEach(function (id) {
      const fl = findById(floors, id);
      if (fl) parts.push(fl.label);
    });
    stallIds.forEach(function (id) {
      const st = findById(stallList, id);
      if (st) parts.push(st.label);
    });
    sides.forEach(function (v) {
      if (SIDE_LABEL[v]) parts.push(SIDE_LABEL[v]);
    });

    return {
      id: shopId,
      name: shop.name,
      areaText: shop.areaText || '',
      expanded: !!expanded,

      floorChips: floorChips,
      floorHint: floorHint,
      hasFloor: hasFloor,

      stallChips: stallChips,
      stallHint: stallHint,

      sideChips: sideChips,
      hasSide: sideChips.length > 0,

      summary: parts.length ? parts.join(' · ') : '未设置条件'
    };
  },

  /* ================================================================
     选择动作
     ================================================================ */

  /* 区域仍单选。换区域后所有餐厅选择一并清空（餐厅是按区域列出来的） */
  onSelectArea(e) {
    const area = e.currentTarget.dataset.value;
    this.setData({
      area: area,
      selectedShops: [],
      shopFilters: {},
      expandedShops: {}
    }, () => {
      this.rebuildShopViews();
      this.onFilterChanged();
    });
  },

  /**
   * 餐厅多选开关。
   * 选中：登记 id + 建一份空条件 + 默认折叠（避免筛选面板被撑长）
   * 取消：只删这家自己的条件与折叠状态，其他餐厅一个字段都不动
   */
  onToggleShop(e) {
    const shopId = e.currentTarget.dataset.shopId;
    if (!shopId || !this.shopMap[shopId]) return;

    const selected = (this.data.selectedShops || []).slice();
    const filters = Object.assign({}, this.data.shopFilters);
    const expanded = Object.assign({}, this.data.expandedShops);
    const idx = selected.indexOf(shopId);

    if (idx === -1) {
      selected.push(shopId);
      filters[shopId] = emptyShopFilter();
      expanded[shopId] = false;
    } else {
      selected.splice(idx, 1);
      delete filters[shopId];
      delete expanded[shopId];
    }

    this.setData({
      selectedShops: selected,
      shopFilters: filters,
      expandedShops: expanded
    }, () => {
      this.rebuildShopViews();
      this.onFilterChanged();
    });
  },

  /* 展开 / 折叠某家餐厅的位置配置。纯 UI，不重算筛选 */
  onToggleShopConfig(e) {
    const shopId = e.currentTarget.dataset.shopId;
    if (!shopId) return;

    const expanded = Object.assign({}, this.data.expandedShops);
    expanded[shopId] = !expanded[shopId];

    this.setData({ expandedShops: expanded }, () => {
      this.rebuildShopViews();
    });
  },

  /**
   * 改某一家餐厅的位置条件。
   * 只替换 shopFilters[shopId] 这一个 key，其他餐厅的条件原样保留。
   */
  updateShopFilter(shopId, mutator) {
    if (!shopId || !this.shopMap[shopId]) return;

    const filters = Object.assign({}, this.data.shopFilters);
    const cur = cloneShopFilter(filters[shopId]);
    const next = mutator(cur) || cur;

    filters[shopId] = {
      floorIds: next.floorIds || [],
      stallIds: next.stallIds || [],
      sides: next.sides || []
    };

    this.setData({ shopFilters: filters }, () => {
      this.rebuildShopViews();
      this.onFilterChanged();
    });
  },

  /* 楼层多选。'all' = 清空这一组 */
  onToggleFloor(e) {
    const ds = e.currentTarget.dataset;
    const shopId = ds.shopId;
    const value = ds.value;
    const shop = this.shopMap[shopId];

    this.updateShopFilter(shopId, function (f) {
      if (value === 'all') {
        return { floorIds: [], stallIds: f.stallIds, sides: f.sides };
      }

      const floorIds = toggleInArray(f.floorIds, value);

      /* 楼层变了：剔除不属于新楼层的已选店铺，避免「2 楼的条件 配 1 楼的店铺」。
         只处理这一家店的 stallIds —— 这正是「不把第一餐厅的楼层用到第三餐厅」的保证 */
      let stallIds = f.stallIds;
      if (stallIds.length && floorIds.length && shop && shop.stallList) {
        stallIds = stallIds.filter(function (tid) {
          const st = findById(shop.stallList, tid);
          return !!st && floorIds.indexOf(st.floorId) !== -1;
        });
      }

      return { floorIds: floorIds, stallIds: stallIds, sides: f.sides };
    });
  },

  /* 店铺 / 位置多选 */
  onToggleStall(e) {
    const ds = e.currentTarget.dataset;
    this.updateShopFilter(ds.shopId, function (f) {
      if (ds.value === 'all') {
        return { floorIds: f.floorIds, stallIds: [], sides: f.sides };
      }
      return { floorIds: f.floorIds, stallIds: toggleInArray(f.stallIds, ds.value), sides: f.sides };
    });
  },

  /* 方位多选。选项只在该店真实标过方位时才会出现 */
  onToggleSide(e) {
    const ds = e.currentTarget.dataset;
    this.updateShopFilter(ds.shopId, function (f) {
      if (ds.value === 'all') {
        return { floorIds: f.floorIds, stallIds: f.stallIds, sides: [] };
      }
      return { floorIds: f.floorIds, stallIds: f.stallIds, sides: toggleInArray(f.sides, ds.value) };
    });
  },

  /* 预算：仍然单选 */
  onSelectBudget(e) {
    const value = Number(e.currentTarget.dataset.value);
    this.setData({ budget: value }, () => this.onFilterChanged());
  },

  /* 主食类型多选。'all' = 清空这一组（八个枚举照旧全部可选） */
  onToggleFoodType(e) {
    const value = e.currentTarget.dataset.value;
    const next = value === 'all' ? [] : toggleInArray(this.data.foodTypes, value);

    this.setData({
      foodTypes: next,
      foodTypeChips: buildOptionChips(FOOD_TYPE_OPTIONS, next)
    }, () => this.onFilterChanged());
  },

  /* 口味多选。'all' = 清空这一组 */
  onToggleTaste(e) {
    const value = e.currentTarget.dataset.value;
    const next = value === 'all' ? [] : toggleInArray(this.data.tastes, value);

    this.setData({
      tastes: next,
      tasteChips: buildOptionChips(TASTE_OPTIONS, next)
    }, () => this.onFilterChanged());
  },

  onReset() {
    this.setData({
      area: 'all',
      selectedShops: [],
      shopFilters: {},
      expandedShops: {},
      budget: 0,
      foodTypes: [],
      tastes: [],
      foodTypeChips: buildOptionChips(FOOD_TYPE_OPTIONS, []),
      tasteChips: buildOptionChips(TASTE_OPTIONS, []),
      mode: 'none',
      pickedShop: null,
      pickedDish: null,
      listDishes: [],
      sortMode: 'default'
    }, () => {
      this.rebuildShopViews();
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

  /**
   * 把页面状态收成筛选内核认识的条件对象。
   * shops 只放「已选餐厅 + 它自己那份条件」，因此每家的楼层 / 方位 / 店铺
   * 天生互相隔离；组与组之间由内核按「与」处理。
   */
  buildCond() {
    const d = this.data;
    const filters = d.shopFilters || {};

    const shops = (d.selectedShops || []).map(function (id) {
      const f = filters[id] || emptyShopFilter();
      return {
        shopId: id,
        floorIds: (f.floorIds || []).slice(),
        stallIds: (f.stallIds || []).slice(),
        sides: (f.sides || []).slice()
      };
    });

    return {
      area: d.area,
      shops: shops,
      budget: d.budget,
      foodTypes: (d.foodTypes || []).slice(),
      tastes: (d.tastes || []).slice()
    };
  },

  refresh() {
    const d = this.data;

    /* 数据还没准备好就不算出结果，交给 dataState 表达 */
    if (!this.raw) return;

    const list = filterDishes(this.raw.dishes, this.buildCond());
    this.matched = list;

    const shopIds = collectShopIds(list);

    this.setData({
      matchedCount: list.length,
      matchedShopCount: shopIds.length,
      conditionText: buildConditionText(d, this.shopMap)
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
    const shop = this.shopMap[shopId] || {};
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
  },

  /**
   * 从菜品卡片进入纠错投稿。
   * 只使用页面已有的真实编号（dish.shopId / dish.stallId / dish.id），
   * 缺一个就不跳转，绝不拼接、不猜测、不用展示文案反推。
   */
  onSubmitDish(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    const shopId = String(ds.shopId || '').trim();
    const stallId = String(ds.stallId || '').trim();
    const dishId = String(ds.dishId || '').trim();

    if (!shopId || !stallId) {
      wx.showToast({ title: '该菜品缺少店铺或档口编号，暂不能纠错', icon: 'none' });
      return;
    }

    const query = [
      'shopId=' + encodeURIComponent(shopId),
      'stallId=' + encodeURIComponent(stallId)
    ];
    if (dishId) query.push('dishId=' + encodeURIComponent(dishId));

    wx.navigateTo({
      url: '/pages/submit/submit?' + query.join('&'),
      fail() {
        wx.showToast({ title: '暂时无法打开投稿页', icon: 'none' });
      }
    });
  }
});
