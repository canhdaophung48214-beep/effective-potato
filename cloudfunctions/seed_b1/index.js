/**
 * seed —— 阶段 2 专用：把 s01（一号食堂）的演示数据写进云端并逐字段核对
 *
 * ⚠️ 数据性质：全部是课程演示数据（dataClass: 'demo'），
 *    不对应山东理工大学或周边任何真实食堂、楼层、窗口、菜品。
 *
 * 设计边界（六条硬规则，任何一条被绕过都算实现错误）：
 *   1. 只能写三种集合：restaurants / stalls / dishes。集合名是下面 COL 里的冻结常量，
 *      客户端传什么集合名都会被忽略 —— 本函数根本不把入参当集合名用。
 *   2. 只能写 8 个预先写死的 _id（1 店 + 3 窗口 + 4 菜）。白名单外的一律拒绝。
 *   3. 不信任客户端身份：操作人取 cloud.getWXContext().OPENID，不读入参里的 openid。
 *   4. 不覆盖、不删除未知记录：删除只走 doc(_id).remove()，代码里没有 where().remove()。
 *      已存在且 contentHash 不同 → 报冲突，绝不覆盖。
 *   5. 稳定业务 ID：_id 直接用本地业务码（s01 / s01_t1 / d01），天然幂等。
 *   6. 部分失败如实报告：逐条给 created / skipped / conflict / failed，
 *      有任一失败 ok 就是 false，并返回 done / failed / notAttempted 三段。
 *
 * 动作（action）：
 *   ensure        建集合（已存在则跳过）
 *   plan          只读：探测本批次记录是否已存在、内容是否一致（不写任何东西）
 *   write         写入不存在的记录（已存在且一致 → skipped；不一致 → conflict）
 *   verify        只读：读回本批次记录，与内置期望逐字段比对 + 关联校验
 *   cleanup       只删除本批次的 **演示** 记录（三重锁：白名单 + dataClass + batchId）
 *   rollbackPlan  只读：真实批次的回滚预览（列出将删除 / 缺失 / 阻断原因，不删任何东西）
 *   rollback      真实批次的回滚执行（先内部复核一次，全部通过才删）
 *
 * 批次与数据分类（S2 引入）：
 *   - 演示批次：batchId 形如 seed-s01-20261022，写入 dataClass='demo'
 *   - 真实批次：batchId 必须精确等于 PILOT_BATCH_ID，写入 dataClass='field_unverified'
 *     （现场采集但尚未核实；verifyStatus='unverified'、verifiedAt=null、source.kind='field'）
 *   - 两套数据集互不重叠，白名单各自独立；cleanup 只认演示批次，
 *     rollback 只认真实批次 —— 任一方向交叉都会被拒。
 *
 * 数据来源（S2.1）：真实批次的数据不再手写，改由 `./pilot-data` 提供，
 *   而 `pilot-data.js` 由 `tools/pilot/build_pilot_dataset.js` 从采集 CSV 生成。
 *   改动数据一律改 CSV 再重新生成，禁止直接编辑 `pilot-data.js`。
 *
 * ⚠️ 回滚的安全保证（必须如实理解，不得对外宣称「原子」）：
 *   - 本实现**没有使用数据库事务**。wx-server-sdk 2.6.3 提供了
 *     db.runTransaction / db.startTransaction，但（a）无法在离线环境确认其对
 *     Transaction.collection().doc().remove() 与跨集合 14 条删除的实际支持，
 *     （b）云函数超时 10s。故本轮不引入事务，改用「逐条前置复核 + 删后核验」。
 *   - 保证的是：① 删除前对每条记录用当前内容重算 contentHash 并核对批次/分类/状态；
 *     ② 顺序为 菜品→窗口→店铺；③ 删后按 ID 逐条读回核验；④ 已不存在的记录会被
 *     单独记为 already-absent，不计入 deleted。
 *   - 不保证的是：检查与删除之间的瞬时并发（TOCTOU 仍然存在，只是从「整批」缩到
 *     「一条记录的一次读」）；也不保证「要么全删、要么全不删」。中途失败时已删的
 *     记录不会自动恢复，但可以再次执行 rollback 继续删剩下的（缺席不再阻断）。
 *   - 想获得真正的原子回滚，必须先由人确认事务在目标环境可用，再单独改造。
 */

'use strict';

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

/* ================================================================
   白名单：集合只认这三个
   ================================================================ */
const COL = Object.freeze({
  RESTAURANTS: 'restaurants',
  STALLS: 'stalls',
  DISHES: 'dishes'
});
const COLLECTION_NAMES = Object.freeze([COL.RESTAURANTS, COL.STALLS, COL.DISHES]);

/* 批次号格式：seed-s01-YYYYMMDD。格式不对直接拒绝，避免任意删除范围 */
const BATCH_RE = /^seed-[a-z0-9]{2,12}-\d{8}$/;

/* ================================================================
   期望数据：逐字段取自
     data/shops.js  → s01（一号食堂）、s01_f1/s01_f2、s01_t1/s01_t2/s01_t3
     data/dishes.js → d01 / d02 / d03 / d39（这 4 道属于 s01）
   注意 s01 在源文件里只有 4 道菜，不是 5 道。
   ================================================================ */
const DEMO_SOURCE = Object.freeze({
  kind: 'demo',
  detail: '非真实商家、楼层、窗口与菜品',
  ref: ''
});

/* 真实批次的数据来源：现场采集，未核实。
   kind='field' 属 data/provenance.js 的 EVIDENCE_KINDS（official/merchant/user/web/field），
   但**没有核实时间**就是 unverified —— 采集三件套不是核实依据。 */
const FIELD_SOURCE = Object.freeze({
  kind: 'field',
  detail: '现场采集：三餐 2 楼最西侧「韩小面」门头与价目表（照片 img/c02_t02_menu.jpg），未核实',
  ref: ''
});

/* 数据分类：demo = 课程演示；field_unverified = 现场采集但尚未核实 */
const DATA_CLASS = Object.freeze({
  DEMO: 'demo',
  FIELD_UNVERIFIED: 'field_unverified'
});

const EXPECTED_RESTAURANTS = [
  {
    _id: 's01',
    name: '一号食堂',
    area: 'campus',
    building: '西区食堂群',
    location: '西校区 · 一号食堂（演示位置）',
    floors: [
      { id: 's01_f1', label: '1 楼', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE },
      { id: 's01_f2', label: '2 楼', verifyStatus: 'demo', verifiedAt: null, source: DEMO_SOURCE }
    ]
  }
];

const EXPECTED_STALLS = [
  { _id: 's01_t1', restaurantId: 's01', floorId: 's01_f1', name: '1 号窗口', side: '', noStatus: 'unverified', no: '' },
  { _id: 's01_t2', restaurantId: 's01', floorId: 's01_f2', name: '2 号窗口', side: '', noStatus: 'unverified', no: '' },
  { _id: 's01_t3', restaurantId: 's01', floorId: 's01_f2', name: '5 号窗口', side: '', noStatus: 'unverified', no: '' }
];

const EXPECTED_DISHES = [
  { _id: 'd01', name: '红烧肉盖饭', price: 12, foodType: 'rice', restaurantId: 's01', stallId: 's01_t2', tastes: ['light'] },
  { _id: 'd02', name: '番茄炒蛋盖饭', price: 8, foodType: 'rice', restaurantId: 's01', stallId: 's01_t1', tastes: ['light'] },
  { _id: 'd03', name: '宫保鸡丁盖饭', price: 12, foodType: 'rice', restaurantId: 's01', stallId: 's01_t3', tastes: ['mild_spicy'] },
  { _id: 'd39', name: '番茄鸡蛋米线', price: 11, foodType: 'rice_noodle', restaurantId: 's01', stallId: 's01_t1', tastes: ['light'] }
];

/* 白名单 id（删除与写入都只认这些） */
const ID_WHITELIST = Object.freeze({
  [COL.RESTAURANTS]: EXPECTED_RESTAURANTS.map(function (r) { return r._id; }),
  [COL.STALLS]: EXPECTED_STALLS.map(function (s) { return s._id; }),
  [COL.DISHES]: EXPECTED_DISHES.map(function (d) { return d._id; })
});

/* ================================================================
   真实批次（S2）：pilot_c02_batch1_20261022
   ----------------------------------------------------------------
   来源 tools/pilot/batch1_min/（严格 dry-run --require-evidence 0 错误 0 警告）：
     1 店 c02 三餐 · 2 楼最西侧 / 1 层 c02_f2 / 1 窗 c02_t02 韩小面 / 12 道面
   与演示数据集**完全分离**：不走 EXPECTED_*、不进 ID_WHITELIST，
   只能被 rollback 删除，不能被 demo 的 cleanup 删除。
   ================================================================ */
/* 真实批次的数据集由 tools/pilot/build_pilot_dataset.js 从采集 CSV 生成（单一真源）。
   不要在下面手写记录：手写就会和 CSV 漂移（S2 时曾出现 8/12 条不一致）。 */
const PILOT_DATA = require('./pilot-data');

const PILOT_BATCH_ID = PILOT_DATA.BATCH_ID;
/* 真实批次的批次号格式（宽进严出：格式合法 ≠ 被承认，见 datasetFor） */
const PILOT_BATCH_RE = /^pilot_[a-z0-9_]{4,40}_\d{8}$/;

/* __row 只用于把问题指回 CSV 行号，不写进云端文档 */
function withoutSheetRef(record) {
  const out = Object.assign({}, record);
  delete out.__row;
  if (Array.isArray(out.floors)) out.floors = out.floors.map(withoutSheetRef);
  return out;
}

const PILOT_RESTAURANTS = PILOT_DATA.RESTAURANTS.map(withoutSheetRef);
const PILOT_STALLS = PILOT_DATA.STALLS.map(withoutSheetRef);
const PILOT_DISHES = PILOT_DATA.DISHES.map(withoutSheetRef);

/* 真实批次的白名单：只给 rollback 用，cleanup 不认它 */
const PILOT_WHITELIST = Object.freeze({
  [COL.RESTAURANTS]: PILOT_RESTAURANTS.map(function (r) { return r._id; }),
  [COL.STALLS]: PILOT_STALLS.map(function (s) { return s._id; }),
  [COL.DISHES]: PILOT_DISHES.map(function (d) { return d._id; })
});

const FOOD_TYPES = ['rice', 'noodle', 'rice_noodle', 'rice_vermicelli', 'dumpling', 'malatang', 'snack', 'other'];
/* 第 4 个值 choice = 可选辣度（顾客自己加辣），与 data/index.js 的 TASTE_LABEL 保持一致 */
const TASTE_VALUES = ['light', 'mild_spicy', 'spicy', 'choice'];
const SIDE_VALUES = ['east', 'south', 'west', 'north', ''];
const NO_STATUS_VALUES = ['has', 'none', 'unverified'];
const PRICE_MAX = 100;

/* ================================================================
   工具
   ================================================================ */

/* 稳定序列化：对象键排序，保证同一份业务数据永远得到同一个哈希 */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) {
    return JSON.stringify(k) + ':' + stableStringify(value[k]);
  }).join(',') + '}';
}

/**
 * 业务字段指纹：用来判断「这条记录变没变」。
 * 排除 _id（身份）、时间戳、contentHash、rev、batchId ——
 * batchId 每次导入可能不同，算进来会让重复执行变成冲突。
 */
const HASH_EXCLUDE = ['_id', 'createdAt', 'updatedAt', 'contentHash', 'rev', 'batchId'];

function businessOf(doc) {
  const out = {};
  Object.keys(doc).forEach(function (k) {
    if (HASH_EXCLUDE.indexOf(k) === -1) out[k] = doc[k];
  });
  return out;
}

function contentHashOf(doc) {
  return crypto.createHash('sha256').update(stableStringify(businessOf(doc))).digest('hex');
}

/* 深比较：只比业务字段，返回差异列表（最多 20 条，避免刷屏） */
function diffDocs(expected, actual, prefix, out) {
  out = out || [];
  const keys = {};
  Object.keys(expected || {}).forEach(function (k) { keys[k] = true; });
  Object.keys(actual || {}).forEach(function (k) { keys[k] = true; });

  Object.keys(keys).forEach(function (k) {
    if (HASH_EXCLUDE.indexOf(k) !== -1) return;
    const e = expected ? expected[k] : undefined;
    const a = actual ? actual[k] : undefined;
    const path = prefix ? prefix + '.' + k : k;

    if (e !== null && typeof e === 'object' && a !== null && typeof a === 'object') {
      diffDocs(e, a, path, out);
      return;
    }
    if (stableStringify(e) !== stableStringify(a)) {
      if (out.length < 20) out.push({ field: path, expected: e, actual: a });
    }
  });
  return out;
}

function isEmptyish(err) {
  const msg = String((err && (err.errMsg || err.message)) || '');
  const code = err && (err.errCode !== undefined ? err.errCode : err.code);
  /* 云开发「文档不存在」在不同版本里表现为不同的码/文案，这里统一视为不存在 */
  return code === -1 || code === 'DATABASE_DOCUMENT_NOT_FOUND' ||
    code === -502005 || /does not exist|not exist|not found|cannot find document/i.test(msg);
}

/* 探测单条文档：存在返回 data，不存在返回 null */
async function getDocOrNull(collectionName, id) {
  try {
    const res = await db.collection(collectionName).doc(id).get();
    return (res && res.data) ? res.data : null;
  } catch (err) {
    if (isEmptyish(err)) return null;
    throw err;
  }
}

/* ================================================================
   鉴权（A0-3）：只认 ADMIN_OPENIDS 里的 OPENID
   ----------------------------------------------------------------
   1. 身份只取服务端上下文 cloud.getWXContext().OPENID，绝不读入参。
   2. 变量未配置 / 空串 / 纯空白 / 只有分隔符 → 一律拒绝（fail-closed），
      不存在「空配置等于放行」的分支。
   3. 调用时读取 process.env，不在模块加载时缓存：改配置后无需重新部署，
      离线测试也能逐条改写。
   4. 不做大小写归一：OPENID 区分大小写，归一化会造成误放行。
   5. 拒绝原因分开返回，便于区分「配置错了」与「人被挡住了」；
      任何响应都不包含白名单内容。
   ================================================================ */
function parseAdminOpenIds(raw) {
  if (typeof raw !== 'string') return [];
  const out = [];
  const parts = raw.split(/[\s,;，；]+/);
  for (let i = 0; i < parts.length; i++) {
    const id = parts[i].trim();
    if (id && out.indexOf(id) === -1) out.push(id);
  }
  return out;
}

function checkAdmin(openid) {
  const admins = parseAdminOpenIds(process.env.ADMIN_OPENIDS);
  const actor = (typeof openid === 'string') ? openid.trim() : '';
  if (!admins.length) return { ok: false, reason: 'ADMIN_OPENIDS_NOT_CONFIGURED' };
  if (!actor) return { ok: false, reason: 'NO_OPENID' };
  if (admins.indexOf(actor) === -1) return { ok: false, reason: 'NOT_ADMIN' };
  return { ok: true, reason: '' };
}

/* 两套元数据。显式传入，不靠猜；默认仍是 demo，保证原有 8 条行为一字不变。 */
function demoMeta() {
  return {
    dataClass: DATA_CLASS.DEMO,
    verifyStatus: 'demo',
    verifiedAt: null,
    source: DEMO_SOURCE
  };
}

/* 真实批次的元数据：来源跟着**每条记录自己的** source 走（来自 CSV 的 source_kind/detail/ref）。
   统一写一句「现场采集…」会让云端文档与本地 CSV／导入器产物不同构（S2 的 N5 问题）。 */
function pilotMeta(record) {
  const src = (record && record.source) || FIELD_SOURCE;
  return {
    dataClass: DATA_CLASS.FIELD_UNVERIFIED,
    verifyStatus: 'unverified',
    verifiedAt: null,
    source: { kind: src.kind, detail: src.detail, ref: src.ref || '' }
  };
}

/**
 * 真实批次写入前的证据闸门（P4）。
 * 空 source.kind / source.detail 的记录不允许进入云端：这类文档看起来「有来源」，
 * 实际没有任何可追溯证据，会把未核实数据伪装成已核实。
 * 只对 pilot 数据集生效，演示批次行为不变。
 * @param {{key:string, restaurants?:Array, stalls?:Array, dishes?:Array}} ds
 * @return {Array<{collection:string,id:string,reasons:string[]}>}
 */
function pilotEvidenceProblems(ds) {
  const problems = [];
  if (!ds || ds.key !== 'pilot') return problems;
  const groups = [
    { collection: COL.RESTAURANTS, label: '店铺', list: ds.restaurants || [] },
    { collection: COL.STALLS, label: '窗口', list: ds.stalls || [] },
    { collection: COL.DISHES, label: '菜品', list: ds.dishes || [] }
  ];
  groups.forEach(function (g) {
    g.list.forEach(function (record) {
      const src = record && record.source;
      const reasons = [];
      if (!src || !src.kind) reasons.push('缺 source_kind');
      if (!src || !String(src.detail || '').trim()) reasons.push('缺 source_detail');
      if (reasons.length) {
        problems.push({ collection: g.collection, id: (record && record._id) || '', reasons: reasons });
      }
    });
  });
  return problems;
}

/**
 * withMeta(record, batchId, meta)
 *   meta 缺省 = demoMeta()（原有调用点不传第三个参数，行为与 S2 之前完全一致）
 *   meta 显式传入 = 用传入的 dataClass/verifyStatus/verifiedAt/source
 */
function withMeta(record, batchId, meta) {
  const m = meta || demoMeta();
  const doc = Object.assign({}, record, {
    dataClass: m.dataClass,
    verifyStatus: m.verifyStatus,
    verifiedAt: m.verifiedAt,
    source: m.source,
    batchId: batchId,
    rev: 1
  });
  doc.contentHash = contentHashOf(doc);
  return doc;
}

/* ================================================================
   批次 → 数据集
   ----------------------------------------------------------------
   - batchId 精确等于 PILOT_BATCH_ID → 真实批次（field_unverified）
   - batchId 符合演示格式 seed-xxx-YYYYMMDD → 演示批次（demo）
   - 其它（含格式合法但不是本批次号）→ null，调用方必须报错，不许默认落到任何一批
   ================================================================ */
const DATASETS = Object.freeze({
  demo: {
    key: 'demo',
    expectedBatchId: null,
    meta: demoMeta,
    restaurants: EXPECTED_RESTAURANTS,
    stalls: EXPECTED_STALLS,
    dishes: EXPECTED_DISHES
  },
  pilot: {
    key: 'pilot',
    expectedBatchId: PILOT_BATCH_ID,
    meta: pilotMeta,
    restaurants: PILOT_RESTAURANTS,
    stalls: PILOT_STALLS,
    dishes: PILOT_DISHES
  }
});

function datasetFor(batchId) {
  if (batchId === PILOT_BATCH_ID) return DATASETS.pilot;
  if (BATCH_RE.test(batchId)) return DATASETS.demo;
  return null;
}

function buildSpecs(batchId) {
  const ds = datasetFor(batchId) || DATASETS.demo;
  return planOf(
    ds.restaurants.map(function (r) {
      return { collection: COL.RESTAURANTS, record: withMeta(r, batchId, ds.meta(r)) };
    }).concat(
      ds.stalls.map(function (s) {
        return { collection: COL.STALLS, record: withMeta(s, batchId, ds.meta(s)) };
      })
    ).concat(
      ds.dishes.map(function (d) {
        return { collection: COL.DISHES, record: withMeta(d, batchId, ds.meta(d)) };
      })
    )
  );
}

function planOf(specs) {
  return specs.map(function (spec) {
    return {
      collection: spec.collection,
      id: spec.record._id,
      record: spec.record
    };
  });
}

/* ================================================================
   动作实现
   ================================================================ */

async function actionEnsure(report) {
  for (let i = 0; i < COLLECTION_NAMES.length; i++) {
    const name = COLLECTION_NAMES[i];
    try {
      await db.createCollection(name);
      report.results.push({ collection: name, action: 'created' });
    } catch (err) {
      const msg = String((err && (err.errMsg || err.message)) || '');
      /* 已存在（-501001 / ResourceUnavailable.CollectionExists 等）视为正常 */
      if (/exist|已存在/i.test(msg)) {
        report.results.push({ collection: name, action: 'already-exists' });
      } else {
        report.results.push({ collection: name, action: 'failed', error: msg });
        report.ok = false;
      }
    }
  }
  return report;
}

async function actionPlan(batchId, report) {
  const ds = datasetFor(batchId);
  if (!ds) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  report.dataset = ds.key;
  const specs = buildSpecs(batchId);
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const existing = await getDocOrNull(spec.collection, spec.record._id);
    if (!existing) {
      report.creates.push(spec.record._id);
      report.results.push({ collection: spec.collection, id: spec.record._id, action: 'would-create' });
      continue;
    }
    const same = contentHashOf(existing) === spec.record.contentHash;
    if (same) {
      report.identical.push(spec.record._id);
      report.results.push({ collection: spec.collection, id: spec.record._id, action: 'identical' });
    } else {
      report.conflicts.push(spec.record._id);
      report.results.push({ collection: spec.collection, id: spec.record._id, action: 'conflict' });
    }
  }
  return report;
}

async function actionWrite(batchId, report) {
  const ds = datasetFor(batchId);
  if (!ds) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  report.dataset = ds.key;

  /* P4：真实批次存在缺证据记录时整批拒写，一条都不写 */
  if (ds.key === 'pilot') {
    const evidenceProblems = pilotEvidenceProblems(ds);
    if (evidenceProblems.length) {
      report.ok = false;
      report.message = '拒写：真实批次存在缺证据记录（' + evidenceProblems.length + ' 条），整批不写入';
      report.blockers = (report.blockers || []).concat(evidenceProblems);
      evidenceProblems.forEach(function (p) {
        report.results.push({ collection: p.collection, id: p.id, action: 'blocked', error: p.reasons.join('、') });
      });
      return report;
    }
  }

  const specs = buildSpecs(batchId);
  let blocked = false;

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const id = spec.record._id;

    if (blocked) {
      report.notAttempted.push(id);
      continue;
    }

    try {
      const existing = await getDocOrNull(spec.collection, id);

      if (existing) {
        const same = contentHashOf(existing) === spec.record.contentHash;
        if (same) {
          report.done.push(id);
          report.results.push({ collection: spec.collection, id: id, action: 'skipped' });
        } else {
          /* 不覆盖：记为冲突，继续处理其它记录，但不阻塞整体 */
          report.failed.push({ id: id, error: 'conflict: 已存在且内容不同，未覆盖' });
          report.results.push({ collection: spec.collection, id: id, action: 'conflict' });
        }
        continue;
      }

      const payload = Object.assign({}, spec.record, {
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      });
      await db.collection(spec.collection).add({ data: payload });
      report.done.push(id);
      report.results.push({ collection: spec.collection, id: id, action: 'created' });
    } catch (err) {
      blocked = true;
      report.failed.push({
        id: id,
        error: String((err && (err.errMsg || err.message)) || err)
      });
      report.results.push({ collection: spec.collection, id: id, action: 'failed' });
    }
  }

  if (report.failed.length) report.ok = false;
  return report;
}

async function actionVerify(batchId, report) {
  /* 验证范围：带 batchId 时按该批次的数据集校验；不带则按演示批次（兼容旧调用） */
  const ds = (batchId ? datasetFor(batchId) : DATASETS.demo);
  if (!ds) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  report.dataset = ds.key;

  /* 1. 逐条读回并比对业务字段 */
  const groups = [
    { collection: COL.RESTAURANTS, expected: ds.restaurants },
    { collection: COL.STALLS, expected: ds.stalls },
    { collection: COL.DISHES, expected: ds.dishes }
  ];

  const loaded = { restaurants: [], stalls: [], dishes: [] };

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (let i = 0; i < group.expected.length; i++) {
      const exp = group.expected[i];
      /* 每条记录自己的 meta：真实批次的 source 跟着记录走（来自 CSV），
         不能再拿一个统一的 meta 去比，否则 source.detail 会整批误报（S2.1 / N5） */
      const meta = ds.meta(exp);
      const actual = await getDocOrNull(group.collection, exp._id);

      if (!actual) {
        report.diffs.push({ id: exp._id, field: '<document>', expected: '存在', actual: '不存在' });
        report.ok = false;
        continue;
      }

      loaded[group.collection].push(actual);
      report.checked++;

      /* 期望值要补上 withMeta 注入的元数据再比，
         否则 dataClass/verifyStatus/verifiedAt/source/rev 会被误报成差异
         （EXPECTED_* / PILOT_* 里只有业务字段，元数据是写入时才加的） */
      const expFull = withMeta(exp, report.batchId, meta);
      const d = diffDocs(expFull, actual, '', []);
      if (d.length) {
        report.ok = false;
        d.forEach(function (item) {
          report.diffs.push({ id: exp._id, field: item.field, expected: item.expected, actual: item.actual });
        });
      }

      /* 元数据断言：按本批次应有的 meta 比，而不是硬编码 demo。
         演示批次 → demo/demo/null/demo；真实批次 → field_unverified/unverified/null/field */
      if (actual.dataClass !== meta.dataClass || actual.verifyStatus !== meta.verifyStatus ||
        actual.verifiedAt !== meta.verifiedAt || !actual.source || actual.source.kind !== meta.source.kind) {
        report.ok = false;
        report.diffs.push({
          id: exp._id,
          field: 'dataClass/verifyStatus/verifiedAt/source.kind',
          expected: [meta.dataClass, meta.verifyStatus, meta.verifiedAt, meta.source.kind].join('/'),
          actual: [actual.dataClass, actual.verifyStatus, actual.verifiedAt,
            actual.source && actual.source.kind].join('/')
        });
      }
    }
  }

  /* 2. 关联校验（云端没有外键，只能自己查） */
  const shops = loaded[COL.RESTAURANTS];
  const stalls = loaded[COL.STALLS];
  const dishes = loaded[COL.DISHES];

  const shopIds = {};
  shops.forEach(function (s) { shopIds[s._id] = s; });

  const stallById = {};
  stalls.forEach(function (st) { stallById[st._id] = st; });

  stalls.forEach(function (st) {
    const parent = shopIds[st.restaurantId];
    if (!parent) {
      report.ok = false;
      report.diffs.push({ id: st._id, field: 'restaurantId', expected: '存在父店铺', actual: st.restaurantId });
      return;
    }
    if (st.floorId) {
      const ids = (parent.floors || []).map(function (f) { return f.id; });
      if (ids.indexOf(st.floorId) === -1) {
        report.ok = false;
        report.diffs.push({ id: st._id, field: 'floorId', expected: '属于父店铺楼层', actual: st.floorId });
      }
    }
    if (NO_STATUS_VALUES.indexOf(st.noStatus) === -1) {
      report.ok = false;
      report.diffs.push({ id: st._id, field: 'noStatus', expected: NO_STATUS_VALUES.join('/'), actual: st.noStatus });
    }
    if (SIDE_VALUES.indexOf(st.side) === -1) {
      report.ok = false;
      report.diffs.push({ id: st._id, field: 'side', expected: SIDE_VALUES.join('/'), actual: st.side });
    }
    if (st.noStatus === 'has' && !st.no) {
      report.ok = false;
      report.diffs.push({ id: st._id, field: 'no', expected: 'noStatus=has 必须有编号', actual: st.no });
    }
  });

  dishes.forEach(function (dish) {
    if (!shopIds[dish.restaurantId]) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'restaurantId', expected: '存在父店铺', actual: dish.restaurantId });
    }
    const stall = stallById[dish.stallId];
    if (!stall) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'stallId', expected: '存在窗口', actual: dish.stallId });
    } else if (stall.restaurantId !== dish.restaurantId) {
      report.ok = false;
      report.diffs.push({
        id: dish._id,
        field: 'stallId.restaurantId',
        expected: dish.restaurantId,
        actual: stall.restaurantId
      });
    }
    if (!Array.isArray(dish.tastes) || dish.tastes.length !== 1) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'tastes', expected: '恰好 1 个', actual: dish.tastes });
    } else if (TASTE_VALUES.indexOf(dish.tastes[0]) === -1) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'tastes[0]', expected: TASTE_VALUES.join('/'), actual: dish.tastes[0] });
    }
    if (FOOD_TYPES.indexOf(dish.foodType) === -1) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'foodType', expected: FOOD_TYPES.join('/'), actual: dish.foodType });
    }
    if (typeof dish.price !== 'number' || !isFinite(dish.price) || dish.price <= 0 || dish.price > PRICE_MAX) {
      report.ok = false;
      report.diffs.push({ id: dish._id, field: 'price', expected: '0 < price <= ' + PRICE_MAX, actual: dish.price });
    }
  });

  const floorsOfS01 = (shopIds['s01'] && shopIds['s01'].floors) || [];
  const floorsByShop = {};
  shops.forEach(function (s) { floorsByShop[s._id] = (s.floors || []).length; });

  const all = shops.concat(stalls, dishes);
  /* summary 只比「分类」这一项，取本批次应有的分类即可（真实批次 = field_unverified）；
     逐条元数据已在上面用各自记录的 source 比过（S2.1 / N5）。 */
  const batchMeta = ds.meta();
  report.summary = {
    dataset: ds.key,
    expectedDataClass: batchMeta.dataClass,
    restaurants: shops.length,
    stalls: stalls.length,
    dishes: dishes.length,
    floorsOfS01: floorsOfS01.length,
    floorsByShop: floorsByShop,
    /* 与期望 dataClass 不一致的条数（演示批次等价于原来的 nonDemoCount） */
    offClassCount: all.filter(function (d) { return d.dataClass !== batchMeta.dataClass; }).length,
    nonDemoCount:
      all.filter(function (d) {
        return d.dataClass !== 'demo' || d.verifyStatus !== 'demo';
      }).length,
    nonNullVerifiedAt:
      all.filter(function (d) { return d.verifiedAt !== null && d.verifiedAt !== undefined; }).length
  };

  /* 只有「与期望分类不一致」才是错；真实批次里 dataClass 本来就是 field_unverified */
  if (report.summary.offClassCount !== 0) report.ok = false;
  return report;
}

async function actionCleanup(batchId, report) {
  const cleanupDs = datasetFor(batchId);
  if (!cleanupDs) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  if (cleanupDs.key !== 'demo') {
    /* 不许用演示清理去删真实记录：真实批次只走 rollback */
    report.ok = false;
    report.message = 'cleanup 只删演示批次；真实批次请用 rollbackPlan / rollback（批次 ' + PILOT_BATCH_ID + '）';
    return report;
  }
  report.dataset = cleanupDs.key;

  const groups = [
    { collection: COL.RESTAURANTS, ids: ID_WHITELIST[COL.RESTAURANTS] },
    { collection: COL.STALLS, ids: ID_WHITELIST[COL.STALLS] },
    { collection: COL.DISHES, ids: ID_WHITELIST[COL.DISHES] }
  ];

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (let i = 0; i < group.ids.length; i++) {
      const id = group.ids[i];
      const existing = await getDocOrNull(group.collection, id);

      if (!existing) {
        report.skipped.push(id);
        continue;
      }
      /* 三重锁：白名单 id（已在循环里约束）+ dataClass + batchId */
      if (existing.dataClass !== 'demo' || existing.batchId !== batchId) {
        report.skipped.push(id);
        report.results.push({
          collection: group.collection,
          id: id,
          action: 'skip-guarded',
          reason: 'dataClass/batchId 不匹配，拒绝删除'
        });
        continue;
      }
      try {
        await db.collection(group.collection).doc(id).remove();
        report.deleted.push(id);
        report.results.push({ collection: group.collection, id: id, action: 'removed' });
      } catch (err) {
        report.ok = false;
        report.failed.push({ id: id, error: String((err && (err.errMsg || err.message)) || err) });
      }
    }
  }

  /* 清理后清点：确认这批 id 全部消失 */
  let remaining = 0;
  const remainIds = [];
  const groups2 = [
    { collection: COL.RESTAURANTS, ids: ID_WHITELIST[COL.RESTAURANTS] },
    { collection: COL.STALLS, ids: ID_WHITELIST[COL.STALLS] },
    { collection: COL.DISHES, ids: ID_WHITELIST[COL.DISHES] }
  ];
  for (let g = 0; g < groups2.length; g++) {
    for (let i = 0; i < groups2[g].ids.length; i++) {
      const still = await getDocOrNull(groups2[g].collection, groups2[g].ids[i]);
      if (still) { remaining++; remainIds.push(groups2[g].ids[i]); }
    }
  }
  report.remainingCount = remaining;
  report.remainingIds = remainIds;
  if (remaining !== 0) report.ok = false;
  return report;
}

/* ================================================================
   真实批次回滚：rollbackPlan（只读预览） / rollback（执行）
   ----------------------------------------------------------------
   只针对 PILOT_BATCH_ID 这一批。判断顺序（任一不满足 → 整批停止，一条都不删）：
     1. 批次号必须精确等于 PILOT_BATCH_ID
     2. 期望的 14 条必须全部存在（有缺失 → 无法证明这批属于我们）
     3. 每条 dataClass 必须是 field_unverified
     4. 每条 verifyStatus 必须是 unverified、verifiedAt 必须是 null
     5. 每条 contentHash 必须与期望一致（被改过 → 视为他人数据，不删）
     6. 不能有额外关联：c02 的窗口数、c02 的菜品数、c02_t02 的菜品数不得超过期望
   删除只走 doc(_id).remove()，顺序：菜品 → 窗口 → 店铺（子先父后）。
   ================================================================ */

const PILOT_EXPECTED_COUNTS = Object.freeze({
  stallsOfShop: PILOT_STALLS.length,
  dishesOfShop: PILOT_DISHES.length,
  dishesOfStall: PILOT_DISHES.length
});

/**
 * 单条记录的六项一致性判定（不含「额外关联」，那项按集合计数）。
 * 返回空数组 = 这条记录仍是我们写进去的那条，可以删。
 * 抽成独立函数是为了让「回滚前置检查」和「删前逐条复核」用同一套标准（S2.1 / N2）。
 */
function driftReasons(actual, expectedRecord, meta) {
  const reasons = [];
  if (actual.batchId !== PILOT_BATCH_ID) {
    reasons.push('batchId 不是本批次：' + String(actual.batchId));
  }
  if (actual.dataClass !== meta.dataClass) {
    reasons.push('dataClass 不是 ' + meta.dataClass + '：' + String(actual.dataClass));
  }
  if (actual.verifyStatus !== meta.verifyStatus) {
    reasons.push('verifyStatus 不是 ' + meta.verifyStatus + '：' + String(actual.verifyStatus));
  }
  if (actual.verifiedAt !== meta.verifiedAt) {
    reasons.push('verifiedAt 不是 null：' + String(actual.verifiedAt));
  }
  /* 不能只比库里存的 contentHash 字段——那字段是写入时算的，
     记录被就地改过后它不会跟着变。必须用**当前内容重算**一遍再比。 */
  if (contentHashOf(actual) !== withMeta(expectedRecord, PILOT_BATCH_ID, meta).contentHash) {
    reasons.push('contentHash 与期望不一致（记录在写入后被修改过）');
  }
  return reasons;
}

async function pilotRollbackCheck(report) {
  const groups = [
    { collection: COL.RESTAURANTS, expected: PILOT_RESTAURANTS },
    { collection: COL.STALLS, expected: PILOT_STALLS },
    { collection: COL.DISHES, expected: PILOT_DISHES }
  ];

  const candidates = [];

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    for (let i = 0; i < group.expected.length; i++) {
      const exp = group.expected[i];
      const meta = pilotMeta(exp);
      const actual = await getDocOrNull(group.collection, exp._id);

      if (!actual) {
        /* 已经不存在 ≠ 风险：它删不了别人的数据。
           但只有「仍然存在且六项全对」的记录才进候选（见下），所以宽容缺席不会放宽误删保护。 */
        report.missing.push(exp._id);
        report.absent.push(exp._id);
        continue;
      }

      const reasons = driftReasons(actual, exp, meta);
      if (reasons.length) {
        report.blockers.push({ collection: group.collection, id: exp._id, reasons: reasons });
      } else {
        candidates.push({ collection: group.collection, id: exp._id, expected: exp });
      }
    }
  }

  /* 额外关联检查：count 只读，不会删任何东西 */
  try {
    const stallsOfShop = await db.collection(COL.STALLS).where({ restaurantId: PILOT_RESTAURANTS[0]._id }).count();
    const dishesOfShop = await db.collection(COL.DISHES).where({ restaurantId: PILOT_RESTAURANTS[0]._id }).count();
    const dishesOfStall = await db.collection(COL.DISHES).where({ stallId: PILOT_STALLS[0]._id }).count();

    const extra = [];
    if (stallsOfShop.total > PILOT_EXPECTED_COUNTS.stallsOfShop) {
      extra.push('店铺下窗口数 ' + stallsOfShop.total + ' > 期望 ' + PILOT_EXPECTED_COUNTS.stallsOfShop);
    }
    if (dishesOfShop.total > PILOT_EXPECTED_COUNTS.dishesOfShop) {
      extra.push('店铺下菜品数 ' + dishesOfShop.total + ' > 期望 ' + PILOT_EXPECTED_COUNTS.dishesOfShop);
    }
    if (dishesOfStall.total > PILOT_EXPECTED_COUNTS.dishesOfStall) {
      extra.push('窗口下菜品数 ' + dishesOfStall.total + ' > 期望 ' + PILOT_EXPECTED_COUNTS.dishesOfStall);
    }
    if (extra.length) {
      report.blockers.push({ collection: '<relations>', id: PILOT_RESTAURANTS[0]._id, reasons: extra });
    }
  } catch (err) {
    report.blockers.push({
      collection: '<relations>',
      id: PILOT_RESTAURANTS[0]._id,
      reasons: ['无法核对额外关联：' + String((err && (err.errMsg || err.message)) || err)]
    });
  }

  /* 是否可继续：
     - 有 blockers（仍然存在的记录不匹配、或存在额外关联）→ 一律不动
     - absent（已经不存在）→ 不算阻断，可以继续删剩下的，但**只删六项全对的那些**
     这样「删到一半失败」可以续做，同时没有把保护降级成「同批次就删」。 */
  const clean = report.blockers.length === 0;
  if (!clean) report.ok = false;
  report.wouldDelete = clean ? candidates.map(function (c) { return c.id; }) : [];
  report.presentCount = candidates.length;
  return { clean: clean, candidates: candidates };
}

async function actionRollbackPlan(batchId, report) {
  if (batchId !== PILOT_BATCH_ID) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  report.dataset = DATASETS.pilot.key;
  const res = await pilotRollbackCheck(report);
  report.plan = {
    clean: res.clean,
    wouldDelete: report.wouldDelete.slice(),
    missing: report.missing.slice(),
    blockers: report.blockers.slice()
  };
  return report;
}

async function actionRollback(batchId, report) {
  if (batchId !== PILOT_BATCH_ID) {
    report.ok = false;
    report.message = '未知批次：' + (batchId || '(空)') + ' 不在已知批次清单里';
    return report;
  }
  report.dataset = DATASETS.pilot.key;

  /* 删之前再复核一次：plan 与 rollback 之间数据可能已经变了 */
  const res = await pilotRollbackCheck(report);
  if (!res.clean) {
    report.ok = false;
    report.message = '回滚前置检查未通过，未删除任何记录（缺失 ' + report.missing.length +
      ' 条、阻断 ' + report.blockers.length + ' 项）';
    return report;
  }

  /* 全部都已不存在：不是失败，也不能报「删掉了 N 条」 */
  if (res.candidates.length === 0) {
    report.noop = true;
    report.wouldDelete = [];
    report.remainingCount = 0;
    report.remainingIds = [];
    report.message = '没有可删除的记录：本批次 ' + report.absent.length +
      ' 条已经全部不存在（可能已经回滚过）';
    return report;
  }

  /* 子先父后：菜品 → 窗口 → 店铺 */
  const order = [COL.DISHES, COL.STALLS, COL.RESTAURANTS];
  for (let o = 0; o < order.length; o++) {
    const collection = order[o];
    for (let i = 0; i < res.candidates.length; i++) {
      const item = res.candidates[i];
      if (item.collection !== collection) continue;

      /* 删前逐条复核：把「检查 → 删除」之间的窗口从整批缩小到一条记录的一次读（S2.1 / N2）。
         没有事务时这是能做到的最强保护；它仍然不是原子操作，见文件头的保证声明。 */
      const now = await getDocOrNull(item.collection, item.id);
      if (!now) {
        report.alreadyAbsent.push(item.id);
        report.results.push({ collection: item.collection, id: item.id, action: 'already-absent' });
        continue;
      }
      const drift = driftReasons(now, item.expected, pilotMeta(item.expected));
      if (drift.length) {
        report.blockedNow.push({ collection: item.collection, id: item.id, reasons: drift });
        report.ok = false;
        continue;
      }

      try {
        const rm = await db.collection(item.collection).doc(item.id).remove();
        const removed = (rm && rm.stats && typeof rm.stats.removed === 'number')
          ? rm.stats.removed
          : ((rm && typeof rm.removed === 'number') ? rm.removed : null);
        if (removed === 0) {
          /* 并发或重复调用下文档可能已经不在：不能记成「我删的」（S2.1 / N4） */
          report.alreadyAbsent.push(item.id);
          report.results.push({ collection: item.collection, id: item.id, action: 'already-absent' });
        } else {
          report.deleted.push(item.id);
          report.results.push({ collection: item.collection, id: item.id, action: 'removed', removed: removed });
        }
      } catch (err) {
        report.ok = false;
        report.failed.push({ id: item.id, error: String((err && (err.errMsg || err.message)) || err) });
      }
    }
  }

  /* 删后核验：只核验「本来存在、且没有在删前被判为漂移」的那些 */
  const expectGone = res.candidates.filter(function (c) {
    return !report.blockedNow.some(function (b) { return b.id === c.id; });
  });
  let remaining = 0;
  const remainIds = [];
  for (let i = 0; i < expectGone.length; i++) {
    const item = expectGone[i];
    const still = await getDocOrNull(item.collection, item.id);
    if (still) { remaining++; remainIds.push(item.id); }
  }
  report.remainingCount = remaining;
  report.remainingIds = remainIds;
  if (remaining !== 0) report.ok = false;
  return report;
}

/* ================================================================
   入口
   ================================================================ */
exports.main = async function (event) {
  const startedAt = Date.now();
  const action = String((event && event.action) || 'plan');
  const batchId = String((event && event.batchId) || '');
  const wx = cloud.getWXContext() || {};

  /* 鉴权闸门：必须先于任何数据库读写、集合创建与 action 分发。
     放在 action 白名单校验之前，非管理员连「有哪些 action」都探不到。 */
  const gate = checkAdmin(wx.OPENID);
  if (!gate.ok) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      reason: gate.reason,
      action: action,
      batchId: batchId,
      env: wx.ENV || '',
      checked: 0,
      elapsedMs: Date.now() - startedAt
    };
  }

  const report = {
    ok: true,
    action: action,
    dataset: '',
    env: (wx.ENV || ''),
    actorOpenId: (wx.OPENID || ''),
    batchId: batchId,
    checked: 0,
    creates: [],
    identical: [],
    conflicts: [],
    done: [],
    failed: [],
    notAttempted: [],
    deleted: [],
    skipped: [],
    missing: [],
    absent: [],
    alreadyAbsent: [],
    blockedNow: [],
    blockers: [],
    wouldDelete: [],
    results: [],
    diffs: [],
    noop: false,
    summary: null,
    elapsedMs: 0
  };

  const actions = ['ensure', 'plan', 'write', 'verify', 'cleanup', 'rollbackPlan', 'rollback'];
  if (actions.indexOf(action) === -1) {
    return Object.assign(report, {
      ok: false,
      message: '不支持的 action，允许：' + actions.join(' / ')
    });
  }

  /* 除 ensure / verify 外，写与删操作必须带批次号；
     批次号格式只做粗筛，是否被承认由 datasetFor 决定（宽进严出） */
  const needsBatch = ['write', 'cleanup', 'plan', 'rollbackPlan', 'rollback'].indexOf(action) !== -1;
  if (needsBatch && !BATCH_RE.test(batchId) && !PILOT_BATCH_RE.test(batchId)) {
    return Object.assign(report, {
      ok: false,
      message: 'batchId 不合法，应形如 seed-s01-20261022 或 ' + PILOT_BATCH_ID
    });
  }

  try {
    if (action === 'ensure') await actionEnsure(report);
    else if (action === 'plan') await actionPlan(batchId, report);
    else if (action === 'write') await actionWrite(batchId, report);
    else if (action === 'verify') await actionVerify(batchId, report);
    else if (action === 'cleanup') await actionCleanup(batchId, report);
    else if (action === 'rollbackPlan') await actionRollbackPlan(batchId, report);
    else if (action === 'rollback') await actionRollback(batchId, report);
  } catch (err) {
    report.ok = false;
    report.message = String((err && (err.errMsg || err.message)) || err);
  }

  report.elapsedMs = Date.now() - startedAt;
  return report;
};

/* 供离线自检脚本 require（不参与云函数运行） */
exports.__test__ = {
  COL: COL,
  COLLECTION_NAMES: COLLECTION_NAMES,
  EXPECTED_RESTAURANTS: EXPECTED_RESTAURANTS,
  EXPECTED_STALLS: EXPECTED_STALLS,
  EXPECTED_DISHES: EXPECTED_DISHES,
  DEMO_SOURCE: DEMO_SOURCE,
  FIELD_SOURCE: FIELD_SOURCE,
  DATA_CLASS: DATA_CLASS,
  PILOT_BATCH_ID: PILOT_BATCH_ID,
  PILOT_BATCH_RE: PILOT_BATCH_RE,
  PILOT_RESTAURANTS: PILOT_RESTAURANTS,
  PILOT_STALLS: PILOT_STALLS,
  PILOT_DISHES: PILOT_DISHES,
  PILOT_WHITELIST: PILOT_WHITELIST,
  PILOT_EXPECTED_COUNTS: PILOT_EXPECTED_COUNTS,
  ID_WHITELIST: ID_WHITELIST,
  datasetFor: datasetFor,
  demoMeta: demoMeta,
  pilotMeta: pilotMeta,
  pilotEvidenceProblems: pilotEvidenceProblems,
  contentHashOf: contentHashOf,
  stableStringify: stableStringify,
  buildSpecs: buildSpecs,
  withMeta: withMeta,
  diffDocs: diffDocs,
  parseAdminOpenIds: parseAdminOpenIds,
  checkAdmin: checkAdmin,
  BATCH_RE: BATCH_RE
};
