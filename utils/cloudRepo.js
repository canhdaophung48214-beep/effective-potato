/**
 * utils/cloudRepo.js —— 云端数据集读取适配层（阶段 3-2）
 *
 * 这个模块只做三件事：**读**、**适配**、**拼装**。它不写库、不建集合、不改权限、
 * 不切首页数据源、不缓存。页面在没有明确切换之前，仍然用本地 data/index.js 的实例。
 *
 * 为什么需要这一层：
 *   云数据库返回的是「三张平表」（restaurants / stalls / dishes），字段名是 _id、
 *   restaurantId；而页面用的是「拼好的扁平结构」，字段名是 id、shopId。
 *   这段差异必须集中在一个地方翻译，否则页面里到处出现 `doc._id || doc.id` 这种补丁。
 *
 * 三条硬约束（后续任何改动都不许违反）：
 *   1. **不吞异常**：读取失败必须抛出可诊断的错误（带 code / collection / page），
 *      绝不返回"看起来正常"的空数组，也绝不自动退回本地演示数据。
 *   2. **不编造关系**：缺 restaurantId / stallId 就留空并记进 diagnostics，
 *      不猜、不补、不按名字模糊匹配。
 *   3. **不抬升可信度**：source / verifyStatus / verifiedAt 原样透传，剩下的交给
 *      data/provenance.js 的 normalizeMeta 判定（演示数据永远压过"声称已核实"）。
 *
 * 与微信运行环境的关系：
 *   模块加载时**不访问 wx、不发请求、不写全局**。真正的数据库句柄是调用时注入的
 *   （loadCloudDataset({ db }) 或 loadCloudDataset({ fetchPage })），
 *   所以 Node 下可以完全离线测试。
 */

const { buildDataset } = require('../data/index');

/* ================================================================
   一、常量与错误码
   ================================================================ */

/**
 * 允许读取的集合名。
 * 这是一份**白名单**：fetchAll 只接受这三个名字，调用方无法拿它去读别的集合，
 * 更无法借它做写入 / 删除（本模块没有任何写方法）。
 */
const COLLECTION = Object.freeze({
  RESTAURANTS: 'restaurants',
  STALLS: 'stalls',
  DISHES: 'dishes'
});

const ALLOWED_COLLECTIONS = Object.freeze([
  COLLECTION.RESTAURANTS,
  COLLECTION.STALLS,
  COLLECTION.DISHES
]);

/**
 * 单页条数默认 20。
 * 小程序端对 limit 有上限（不同基础库版本不一样），20 是保守且稳定的取值；
 * 分页本身不依赖"一次拿全"，所以不需要为了性能往上顶。
 */
const DEFAULT_PAGE_SIZE = 20;

/**
 * 最大页数保护：50 页 × 20 条 = 1000 条。
 * 现在的数据量是 12 店 / 24 窗口 / 45 菜，远不会碰到；
 * 这个上限只是防止「游标写错导致无限翻页」把用户流量和资源点烧掉。
 * 碰到上限且上一页仍是满页时**直接报错**，不返回截断结果。
 */
const DEFAULT_MAX_PAGES = 50;

const ERROR_CODE = Object.freeze({
  BAD_COLLECTION: 'BAD_COLLECTION', /* 集合名不在白名单 */
  BAD_ARGS: 'BAD_ARGS',             /* 参数类型不对（没有可用的取数函数等） */
  BAD_DOC: 'BAD_DOC',               /* 云端返回的记录缺少可用的 _id */
  FETCH_FAILED: 'FETCH_FAILED',     /* 底层查询抛错（网络 / 权限 / 超时） */
  TOO_MANY_PAGES: 'TOO_MANY_PAGES', /* 翻页触顶，且可能仍有剩余 */
  STUCK_CURSOR: 'STUCK_CURSOR'      /* 游标没有前进，会无限循环 */
});

/** 诊断码：适配阶段发现的问题，全部进 diagnostics，不静默丢 */
const DIAG_CODE = Object.freeze({
  ORPHAN_STALL: 'ORPHAN_STALL',                 /* 窗口的 restaurantId 找不到店铺 */
  ORPHAN_DISH: 'ORPHAN_DISH',                   /* 菜品的 restaurantId 找不到店铺 */
  STALL_NOT_FOUND: 'STALL_NOT_FOUND',           /* 菜品的 stallId 在该店窗口里找不到 */
  STALL_SHOP_MISMATCH: 'STALL_SHOP_MISMATCH',   /* 菜品指向的窗口属于另一家店 */
  FLOOR_NOT_FOUND: 'FLOOR_NOT_FOUND',           /* 窗口的 floorId 不在该店楼层里 */
  MISSING_FIELD: 'MISSING_FIELD',               /* 关键字段缺失（如 price） */
  DUP_ID: 'DUP_ID'                              /* 同名 _id 出现多次，已保留首条 */
});

/* ================================================================
   二、默认顺序：本地兼容映射（阶段 3-2 的关键）
   ================================================================

   为什么不能直接用 _id 字典序：
     本地「默认顺序」= data/dishes.js / data/shops.js 里的书写顺序，**不是字典序**。
     实测本地菜品前 8 位是 d01,d02,d03,d39,d04,d05,d06,d37 —— d39 夹在 d03 后面。
     云端按 _id 读回来必然是 d01,d02,d03,d04…，直接切过去用户会看到顺序突变。

   所以这里维护一张**显式**的本地顺序表：
     - 表里有的 ID：严格按表里的位置排；
     - 表里没有的新 ID：排在所有已有记录**之后**，彼此之间按 _id 字典序（确定、稳定）。
   这样「现有记录顺序不变」和「新记录有确定位置」同时成立，且与输入顺序无关。

   维护约定：以后在 data/ 里新增菜品/店铺时，把新 ID 追加到对应数组末尾。
   忘了追加也不会出错 —— 它会被当成"新 ID"排到最后，只是本地顺序与云端顺序可能不同。
   ================================================================ */

const LOCAL_SHOP_ORDER = Object.freeze([
  's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08',
  's09', 's10', 's11', 's12'
]);

const LOCAL_STALL_ORDER = Object.freeze([
  's01_t1', 's01_t2', 's01_t3', 's02_t1', 's02_t2', 's03_t1', 's03_t2', 's03_t3',
  's04_t1', 's04_t2', 's04_t3', 's05_t1', 's05_t2', 's05_t3', 's06_t1', 's07_t1',
  's07_t2', 's08_t1', 's09_t1', 's09_t2', 's10_t1', 's11_t1', 's12_t1', 's12_t2'
]);

const LOCAL_DISH_ORDER = Object.freeze([
  'd01', 'd02', 'd03', 'd39', 'd04', 'd05', 'd06', 'd37',
  'd42', 'd07', 'd45', 'd08', 'd09', 'd10', 'd11', 'd12',
  'd13', 'd14', 'd43', 'd15', 'd38', 'd16', 'd17', 'd18',
  'd19', 'd20', 'd21', 'd22', 'd23', 'd24', 'd25', 'd26',
  'd27', 'd44', 'd28', 'd29', 'd30', 'd41', 'd31', 'd32',
  'd33', 'd34', 'd35', 'd36', 'd40'
]);

/* id → 位置 的索引，模块加载时算一次（纯计算，不碰网络） */
function indexOfOrder(order) {
  const map = Object.create(null);
  for (let i = 0; i < order.length; i++) map[order[i]] = i;
  return map;
}

const SHOP_INDEX = indexOfOrder(LOCAL_SHOP_ORDER);
const STALL_INDEX = indexOfOrder(LOCAL_STALL_ORDER);
const DISH_INDEX = indexOfOrder(LOCAL_DISH_ORDER);

/**
 * 按「本地顺序表优先，新 ID 排后，新 ID 之间按 _id 字典序」比较两条记录。
 * 返回负数表示 a 在前。这个比较函数是**全序**且不依赖输入顺序，所以结果稳定。
 */
function compareByLocalOrder(a, b, index) {
  const aKnown = Object.prototype.hasOwnProperty.call(index, a.id);
  const bKnown = Object.prototype.hasOwnProperty.call(index, b.id);
  if (aKnown && bKnown) return index[a.id] - index[b.id];
  if (aKnown) return -1;
  if (bKnown) return 1;
  /* 两个都是新 ID：按 id 字典序，保证确定 */
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function sortByLocalOrder(list, index) {
  /* slice() 后排序：不原地改调用方传进来的数组 */
  return list.slice().sort(function (a, b) {
    return compareByLocalOrder(a, b, index);
  });
}

/* ================================================================
   三、错误与参数工具
   ================================================================ */

function repoError(code, message, detail) {
  const err = new Error(message);
  err.name = 'CloudRepoError';
  err.code = code;
  err.detail = detail || null;
  return err;
}

/** 把底层异常压成可序列化的诊断信息（保留 message / code，不保留方法栈里的敏感内容） */
function describeError(err) {
  if (!err) return { message: '未知错误' };
  return {
    message: String(err.message || err),
    code: (err.code === undefined || err.code === null) ? '' : String(err.code),
    errMsg: err.errMsg ? String(err.errMsg) : ''
  };
}

function positiveInt(value, fallback) {
  const n = Number(value);
  if (!isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * 把底层返回统一成数组。兼容三种形态：
 *   - 微信云数据库：{ data: [...] }
 *   - 自定义适配器：{ list: [...] }
 *   - 直接返回数组：[ ... ]
 */
function normalizeBatch(res, collection, page) {
  let arr = null;
  if (Array.isArray(res)) arr = res;
  else if (res && Array.isArray(res.list)) arr = res.list;
  else if (res && Array.isArray(res.data)) arr = res.data;
  if (!arr) {
    throw repoError(
      ERROR_CODE.BAD_ARGS,
      '取数函数返回了无法识别的结构（集合 ' + collection + ' 第 ' + page + ' 页）',
      { collection: collection, page: page, got: typeof res }
    );
  }
  return arr;
}

/* ================================================================
   四、fetchAll：游标翻页读取
   ================================================================

   分页机制（为什么用游标而不是 skip）：
     查询固定 `orderBy('_id','asc')`，每页取 limit 条；下一页的条件是 `_id > 上一页最后一条 _id`。
     skip 的问题在于「翻页期间有人写入」会导致漏读或重复读；`_id` 单调递增，
     游标法只依赖已经读到的位置，天然不受中间插入影响。

   终止条件（三条，任一命中即停）：
     1. 这一页返回 0 条        → 到底了（空集合 / 刚好读完）
     2. 这一页不足 pageSize    → 已是最后一页
     3. 满页但已到 maxPages    → **不当作结束**，抛 TOO_MANY_PAGES（见下）

   最大页数保护：
     每轮循环开始检查 `pages >= maxPages`。能在还"可能有剩余"的状态下走到这里，
     说明已经翻了 maxPages 个满页 —— 这时**抛错**而不是返回已读到的部分，
     因为把截断数据当完整数据交给页面，比明确失败更危险（会静默少菜、少店）。

   异常处理策略：
     取数函数抛出的任何错误都包成 FETCH_FAILED，带上 collection / page / lastId /
     原始 message，向上抛。**不做自动重试、不做自动降级到本地数据** ——
     重试与降级是页面的产品决策，不属于数据层偷偷替用户决定的事。
   ================================================================ */
async function fetchAll(options) {
  const opts = options || {};
  const collection = opts.collection;

  if (ALLOWED_COLLECTIONS.indexOf(collection) < 0) {
    throw repoError(
      ERROR_CODE.BAD_COLLECTION,
      '不允许读取集合「' + String(collection) + '」，只接受 ' + ALLOWED_COLLECTIONS.join(' / '),
      { collection: collection, allowed: ALLOWED_COLLECTIONS.slice() }
    );
  }

  const fetchPage = opts.fetchPage;
  if (typeof fetchPage !== 'function') {
    throw repoError(
      ERROR_CODE.BAD_ARGS,
      'fetchAll 需要一个 fetchPage 函数（用于离线测试或包装云数据库）',
      { collection: collection }
    );
  }

  const pageSize = positiveInt(opts.pageSize, DEFAULT_PAGE_SIZE);
  const maxPages = positiveInt(opts.maxPages, DEFAULT_MAX_PAGES);

  const list = [];
  const duplicates = [];
  const seen = Object.create(null);

  let lastId = null;
  let pages = 0;

  for (;;) {
    if (pages >= maxPages) {
      /* 走到这里 = 已经翻了 maxPages 个满页，后面还有没有数据我们不知道。
         把"不知道"当成"读完了"是错的，所以直接失败。 */
      throw repoError(
        ERROR_CODE.TOO_MANY_PAGES,
        '集合 ' + collection + ' 读取超过最大页数 ' + maxPages +
        '（每页 ' + pageSize + ' 条），可能仍有剩余记录；已停止读取以避免返回截断数据',
        {
          collection: collection,
          maxPages: maxPages,
          pageSize: pageSize,
          fetched: list.length,
          lastId: lastId
        }
      );
    }

    let raw;
    try {
      raw = await fetchPage({ collection: collection, lastId: lastId, limit: pageSize });
    } catch (cause) {
      /* 不吞：原始错误压成 detail，挂到带上下文的错误上继续向上抛 */
      throw repoError(
        ERROR_CODE.FETCH_FAILED,
        '读取集合 ' + collection + ' 失败（第 ' + (pages + 1) + ' 页）：' + describeError(cause).message,
        { collection: collection, page: pages + 1, lastId: lastId, cause: describeError(cause) }
      );
    }

    pages++;
    const batch = normalizeBatch(raw, collection, pages);

    /* 终止条件 1：空页 */
    if (batch.length === 0) break;

    let addedThisPage = 0;
    let lastDocId = null;
    for (let i = 0; i < batch.length; i++) {
      const doc = batch[i];
      const id = (doc && typeof doc._id === 'string') ? doc._id : '';
      if (!id) {
        throw repoError(
          ERROR_CODE.BAD_DOC,
          '集合 ' + collection + ' 第 ' + pages + ' 页存在缺少合法 _id 的记录',
          { collection: collection, page: pages, index: i }
        );
      }
      if (seen[id]) {
        /* 重复记录：保留第一条，记进 duplicates，由调用方决定怎么报告 */
        duplicates.push({ collection: collection, id: id, page: pages });
        continue;
      }
      seen[id] = true;
      list.push(doc);
      addedThisPage++;
      lastDocId = id;
    }

    /* 终止条件 2：最后一页不足 pageSize */
    if (batch.length < pageSize) break;

    /* 游标必须前进，否则下次会拿到同一页，死循环 */
    const nextCursor = lastDocId || batch[batch.length - 1]._id;
    if (nextCursor === lastId) {
      throw repoError(
        ERROR_CODE.STUCK_CURSOR,
        '集合 ' + collection + ' 游标未前进（仍是 ' + String(lastId) + '），停止读取以避免死循环',
        { collection: collection, page: pages, lastId: lastId }
      );
    }
    lastId = nextCursor;

    /* 防御：这一页全是重复记录（addedThisPage === 0）但 batch 仍满页，
       说明分页边界和去重键不一致，继续翻也不会推进真实进度 */
    if (addedThisPage === 0) {
      throw repoError(
        ERROR_CODE.STUCK_CURSOR,
        '集合 ' + collection + ' 第 ' + pages + ' 页全部为重复记录，停止读取',
        { collection: collection, page: pages, lastId: lastId }
      );
    }
  }

  return {
    collection: collection,
    list: list,
    pages: pages,
    duplicates: duplicates,
    complete: true
  };
}

/* ================================================================
   五、字段适配：云端文档 → 本地模型
   ================================================================

   映射表（只列"改名的"和"必须原样保留的"，其余同名直传）：

     云端 restaurants            →  本地 shop
       _id                       →  id
       floors[].id / label       →  floors[].id / label（原样）
       verifyStatus/verifiedAt/source/dataClass → 原样透传

     云端 stalls                 →  本地 stall
       _id                       →  id
       restaurantId              →  restaurantId（保留，装配时用；不进页面输出）
       floorId / name / side / noStatus / no                →  原样
       verifyStatus/verifiedAt/source                      →  原样透传

     云端 dishes                 →  本地 dish
       _id                       →  id
       restaurantId              →  shopId   ← 本次唯一的"改名"
       stallId / tastes / price / foodType / name           →  原样
       verifyStatus/verifiedAt/source                      →  原样透传

   两条禁止事项：
     - 缺字段不补默认值（缺 restaurantId 就留空串，不按店名猜、不按顺序猜）
     - 不把 dataClass 当成 verifyStatus 用（dataClass 描述"是不是演示数据"，
       verifyStatus 描述"核验到哪一步"，两者都由 provenance 层裁决）
   ================================================================ */

/** 只搬可信度三件套 + dataClass；缺失就**不写这个键**，交给 normalizeMeta 兜底 */
function pickProvenance(raw) {
  const out = {};
  const src = raw || {};
  if (src.verifyStatus !== undefined) out.verifyStatus = src.verifyStatus;
  if (src.verifiedAt !== undefined) out.verifiedAt = src.verifiedAt;
  if (src.source !== undefined) out.source = src.source;
  if (src.dataClass !== undefined) out.dataClass = src.dataClass;
  return out;
}

/** 楼层：内嵌在店铺文档里，云端与本地同构，只需补可信度字段 */
function adaptFloor(raw) {
  const f = raw || {};
  return Object.assign({
    id: String(f.id || f._id || ''),
    label: f.label || ''
  }, pickProvenance(f));
}

/**
 * 店铺：_id → id；floors 递归适配；stalls 留空，由 loadCloudDataset 装配。
 * 注意这里**不填 stalls**，避免"适配函数自己承担关联职责"这种隐性耦合。
 */
function adaptRestaurant(doc) {
  const d = doc || {};
  const floors = Array.isArray(d.floors) ? d.floors.map(adaptFloor) : [];
  return Object.assign({
    id: String(d._id || ''),
    name: d.name || '',
    area: d.area || '',
    building: d.building || '',
    location: d.location || '',
    floors: floors,
    stalls: []
  }, pickProvenance(d));
}

/** 窗口：_id → id；restaurantId 保留（装配用），其余原样 */
function adaptStall(doc) {
  const d = doc || {};
  const out = Object.assign({
    id: String(d._id || ''),
    restaurantId: d.restaurantId || '',
    floorId: d.floorId || '',
    name: d.name || ''
  }, pickProvenance(d));

  /* side / noStatus / no 是"没采集就没有"的字段：
     存在才搬，缺省时保持缺省，让 describeStall 走它自己的三态判定 */
  if (d.side !== undefined) out.side = d.side;
  if (d.noStatus !== undefined) out.noStatus = d.noStatus;
  if (d.no !== undefined) out.no = d.no;

  return out;
}

/** 菜品：_id → id，restaurantId → shopId（唯一改名），其余原样 */
function adaptDish(doc) {
  const d = doc || {};
  return Object.assign({
    id: String(d._id || ''),
    name: d.name || '',
    price: d.price,
    foodType: d.foodType || 'other',
    shopId: d.restaurantId || '',
    stallId: d.stallId || '',
    tastes: Array.isArray(d.tastes) ? d.tastes.slice() : []
  }, pickProvenance(d));
}

/* ================================================================
   六、微信云数据库包装器（可选，仅当传入 db 时使用）
   ================================================================ */

/**
 * 把 wx.cloud.database() 实例包成 fetchPage。
 * 只在 loadCloudDataset 调用时执行，模块加载时不会碰 db。
 *
 * @param {object} db wx.cloud.database() 的返回值
 * @return {function} fetchPage({collection,lastId,limit})
 */
function makeWxFetcher(db) {
  if (!db || typeof db.collection !== 'function' || !db.command) {
    throw repoError(ERROR_CODE.BAD_ARGS, 'makeWxFetcher 需要一个可用的云数据库实例（含 collection 与 command）');
  }
  return async function fetchPage(params) {
    const _ = db.command;
    let query = db.collection(params.collection);
    if (params.lastId !== null && params.lastId !== undefined) {
      query = query.where({ _id: _.gt(params.lastId) });
    }
    const res = await query.orderBy('_id', 'asc').limit(params.limit).get();
    return { list: (res && res.data) || [] };
  };
}

/* ================================================================
   七、loadCloudDataset：读三张表 → 适配 → 装配 → buildDataset
   ================================================================ */

/**
 * 读取云端三张表并组装成与本地同形的数据集。
 *
 * 读取顺序固定为 restaurants → stalls → dishes：
 *   先有店铺才能把窗口挂上去，先有店铺+窗口才能判断菜品的关联是否有效。
 *
 * @param {object} options
 *   - db        {object}  可选，wx.cloud.database() 实例（内部用 makeWxFetcher 包装）
 *   - fetchPage {function} 可选，直接注入取数函数（离线测试用）；优先级高于 db
 *   - pageSize  {number}   默认 20
 *   - maxPages  {number}   默认 50
 * @return {Promise<object>} { dataset, shops, dishes, diagnostics, meta }
 */
async function loadCloudDataset(options) {
  const opts = options || {};

  let fetchPage = opts.fetchPage;
  if (typeof fetchPage !== 'function') {
    if (opts.db) fetchPage = makeWxFetcher(opts.db);
    else {
      throw repoError(
        ERROR_CODE.BAD_ARGS,
        'loadCloudDataset 需要 options.fetchPage 或 options.db 之一',
        null
      );
    }
  }

  const pageSize = positiveInt(opts.pageSize, DEFAULT_PAGE_SIZE);
  const maxPages = positiveInt(opts.maxPages, DEFAULT_MAX_PAGES);

  /* --- 1. 店铺（先读，后面两表都要用它的 id） --- */
  const r1 = await fetchAll({
    collection: COLLECTION.RESTAURANTS, pageSize: pageSize, maxPages: maxPages, fetchPage: fetchPage
  });
  const shops = r1.list.map(adaptRestaurant);

  /* --- 2. 窗口 --- */
  const r2 = await fetchAll({
    collection: COLLECTION.STALLS, pageSize: pageSize, maxPages: maxPages, fetchPage: fetchPage
  });
  const stalls = r2.list.map(adaptStall);

  /* --- 3. 菜品 --- */
  const r3 = await fetchAll({
    collection: COLLECTION.DISHES, pageSize: pageSize, maxPages: maxPages, fetchPage: fetchPage
  });
  const dishes = r3.list.map(adaptDish);

  /* --- 4. 装配 + 诊断 --- */
  const diagnostics = [];

  r1.duplicates.forEach(function (dup) {
    diagnostics.push({ collection: dup.collection, code: DIAG_CODE.DUP_ID, id: dup.id, page: dup.page });
  });
  r2.duplicates.forEach(function (dup) {
    diagnostics.push({ collection: dup.collection, code: DIAG_CODE.DUP_ID, id: dup.id, page: dup.page });
  });
  r3.duplicates.forEach(function (dup) {
    diagnostics.push({ collection: dup.collection, code: DIAG_CODE.DUP_ID, id: dup.id, page: dup.page });
  });

  const shopById = Object.create(null);
  shops.forEach(function (shop) { shopById[shop.id] = shop; });

  const stallById = Object.create(null);
  stalls.forEach(function (stall) {
    stallById[stall.id] = stall;
    const shop = shopById[stall.restaurantId];
    if (!shop) {
      /* 窗口挂着不存在的店：不挂到任何店上，但记下来 */
      diagnostics.push({
        collection: COLLECTION.STALLS,
        code: DIAG_CODE.ORPHAN_STALL,
        id: stall.id,
        restaurantId: stall.restaurantId,
        message: '窗口的 restaurantId 找不到对应店铺，已跳过装配'
      });
      return;
    }
    /* 楼层引用检查：楼层缺失不影响窗口存在，但要在诊断里露出来 */
    if (stall.floorId) {
      const floorFound = shop.floors.some(function (f) { return f.id === stall.floorId; });
      if (!floorFound) {
        diagnostics.push({
          collection: COLLECTION.STALLS,
          code: DIAG_CODE.FLOOR_NOT_FOUND,
          id: stall.id,
          floorId: stall.floorId,
          message: '窗口的 floorId 不在该店楼层列表中，页面楼层文字会留空'
        });
      }
    }
    shop.stalls.push(stall);
  });

  dishes.forEach(function (dish) {
    if (dish.price === undefined || dish.price === null || dish.price === '') {
      diagnostics.push({
        collection: COLLECTION.DISHES,
        code: DIAG_CODE.MISSING_FIELD,
        id: dish.id,
        field: 'price',
        message: '菜品缺少价格，页面会显示为 undefined'
      });
    }

    const shop = shopById[dish.shopId];
    if (!shop) {
      diagnostics.push({
        collection: COLLECTION.DISHES,
        code: DIAG_CODE.ORPHAN_DISH,
        id: dish.id,
        restaurantId: dish.shopId,
        message: '菜品的 restaurantId 找不到对应店铺；记录保留，页面店名会显示「未知店铺」'
      });
      return;
    }

    if (!dish.stallId) {
      /* 没写窗口是数据缺失，不是"属于全店" —— 不补、不猜 */
      diagnostics.push({
        collection: COLLECTION.DISHES,
        code: DIAG_CODE.MISSING_FIELD,
        id: dish.id,
        field: 'stallId',
        message: '菜品没有 stallId，窗口信息会留空'
      });
      return;
    }

    const stall = stallById[dish.stallId];
    if (!stall) {
      diagnostics.push({
        collection: COLLECTION.DISHES,
        code: DIAG_CODE.STALL_NOT_FOUND,
        id: dish.id,
        stallId: dish.stallId,
        message: '菜品的 stallId 在窗口表里不存在，窗口信息会留空'
      });
      return;
    }
    if (stall.restaurantId !== dish.shopId) {
      diagnostics.push({
        collection: COLLECTION.DISHES,
        code: DIAG_CODE.STALL_SHOP_MISMATCH,
        id: dish.id,
        stallId: dish.stallId,
        restaurantId: dish.shopId,
        stallRestaurantId: stall.restaurantId,
        message: '菜品指向的窗口属于另一家店，关联不可信'
      });
    }
  });

  /* --- 5. 排序：恢复本地默认顺序（与输入顺序无关） --- */
  const orderedShops = sortByLocalOrder(shops, SHOP_INDEX);
  orderedShops.forEach(function (shop) {
    shop.stalls = sortByLocalOrder(shop.stalls, STALL_INDEX);
  });
  const orderedDishes = sortByLocalOrder(dishes, DISH_INDEX);

  /* --- 6. 复用 data/index.js 的拼装（不另写一套 join） --- */
  const dataset = buildDataset(orderedShops, orderedDishes);

  return {
    dataset: dataset,
    shops: orderedShops,
    dishes: orderedDishes,
    diagnostics: diagnostics,
    meta: {
      counts: {
        restaurants: shops.length,
        stalls: stalls.length,
        dishes: dishes.length
      },
      pages: {
        restaurants: r1.pages,
        stalls: r2.pages,
        dishes: r3.pages
      },
      duplicates: {
        restaurants: r1.duplicates,
        stalls: r2.duplicates,
        dishes: r3.duplicates
      },
      pageSize: pageSize,
      maxPages: maxPages
    }
  };
}

module.exports = {
  COLLECTION,
  ALLOWED_COLLECTIONS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_MAX_PAGES,
  ERROR_CODE,
  DIAG_CODE,
  LOCAL_SHOP_ORDER,
  LOCAL_STALL_ORDER,
  LOCAL_DISH_ORDER,
  /* 排序策略没有变，只是把纯函数暴露出来，
     让测试能直接验证"不原地修改输入"这条约束。 */
  sortByLocalOrder,
  fetchAll,
  adaptFloor,
  adaptRestaurant,
  adaptStall,
  adaptDish,
  makeWxFetcher,
  loadCloudDataset
};
