/**
 * 数据可信度：来源 / 核实状态 / 核实时间
 *
 * 这一层只做三件事，不负责页面展示：
 *   1. 定义统一的状态枚举与文案
 *   2. 给每条记录写入 `source` / `verifyStatus` / `verifiedAt` 三个字段
 *   3. 把「一条记录 + 它所在的地点」合成一个用户能看到的状态（最弱一环）
 *
 * —— 为什么状态要「取最弱一环」——
 *   一道菜的菜名可能是实地核实过的，但它挂的窗口还是待核实，
 *   那么用户看到的这条信息整体就仍然不能被当成已核实。
 *   所以卡片上显示的是「菜品 / 窗口 / 楼层 / 店铺」四层里最弱的那一层，
 *   并且同时给出那一层的来源说明，方便追到到底是哪一环没核实。
 *
 * —— 三条硬规则（对应产品要求）——
 *   · 演示数据一律 demo，且 verifiedAt 必须为空：演示不是核实。
 *   · 标 verified / expired 必须同时拿得出「合法来源 + 非空说明 + 严格合法的日期」；
 *     web 来源还要有可追溯链接。任何一条不满足 → 降级 unverified，绝不编造时间。
 *   · 缺字段 / 来源类型不在白名单 → 按 unverified 处理，不按「真实」处理。
 */

/* 核实状态。顺序即「可信度从弱到强」，expired 是特殊态，不参与排序比较 */
const VERIFY_STATUS = {
  DEMO: 'demo',
  UNVERIFIED: 'unverified',
  VERIFIED: 'verified',
  EXPIRED: 'expired'
};

/* 状态取值白名单。用值判断，别用 VERIFY_STATUS 的键（键是大写常量名） */
const STATUS_VALUES = ['demo', 'unverified', 'verified', 'expired'];

/* 状态 → 页面标签文案 */
const VERIFY_LABEL = {
  demo: '演示信息',
  unverified: '待核实',
  verified: '已核实',
  expired: '核实已过期'
};

/* 状态 → 样式类后缀（wxss 里是 .tag-v.v-demo 这种写法） */
const VERIFY_CLASS = {
  demo: 'v-demo',
  unverified: 'v-unverified',
  verified: 'v-verified',
  expired: 'v-expired'
};

/* 状态 → 一句话解释，鼠标/长按很难做，先留作文案与测试依据 */
const VERIFY_TIP = {
  demo: '课程演示数据，不对应任何真实商家',
  unverified: '尚未取得可追溯的核实依据',
  verified: '有核实依据，并记录了核实时间',
  expired: '曾核实过，但已超过有效期，需要重新核实'
};

/* 前三种状态的强弱排序：数字越小越弱，合成时取最小值 */
const STATUS_RANK = {
  demo: 0,
  unverified: 1,
  verified: 2
};

/* 来源类型 */
const SOURCE_KIND = {
  DEMO: 'demo',           // 课程演示数据
  OFFICIAL: 'official',   // 校方 / 后勤公示
  MERCHANT: 'merchant',   // 商家提供
  USER: 'user',           // 同学反馈
  WEB: 'web',             // 网络来源（必须带 ref）
  FIELD: 'field',         // 实地核实
  UNKNOWN: 'unknown'      // 未标注（按待核实处理）
};

const SOURCE_KIND_LABEL = {
  demo: '演示数据',
  official: '校方公示',
  merchant: '商家提供',
  user: '同学反馈',
  web: '网络来源',
  field: '实地核实',
  unknown: '来源未标注'
};

/* 演示记录共用的来源对象（每次 attach 都复制一份，避免多处共享同一个引用） */
const DEMO_SOURCE = {
  kind: SOURCE_KIND.DEMO,
  detail: '非真实商家、楼层、窗口与菜品',
  ref: ''
};

function copySource(source) {
  return {
    kind: source.kind,
    detail: source.detail || '',
    ref: source.ref || ''
  };
}

/**
 * 构造来源对象。
 * @param {string} kind   SOURCE_KIND 之一
 * @param {string} detail 来源说明，必须能说清「从哪来」
 * @param {string} [ref]  可追溯凭证：公示链接、照片、聊天记录编号等，没有就留空
 */
function makeSource(kind, detail, ref) {
  return {
    kind: kind || SOURCE_KIND.UNKNOWN,
    detail: detail || '',
    ref: ref || ''
  };
}

/* 来源类型白名单（值，不是键） */
const KIND_VALUES = [
  'demo', 'official', 'merchant', 'user', 'web', 'field', 'unknown'
];

/* 能支撑「已核实 / 已过期」的来源：demo 是假的，unknown 是没来源，都不算证据 */
const EVIDENCE_KINDS = ['official', 'merchant', 'user', 'web', 'field'];

/* 这些来源必须给出可追溯凭证 ref，否则不算证据（网络来源没有链接等于没来源） */
const REF_REQUIRED_KINDS = ['web'];

/* ----------------------------------------------------------------
   日期校验
   ---------------------------------------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/* 今天的 YYYY-MM-DD（本地时区）。测试可传入固定基准，结果不随运行日期漂移 */
function todayString() {
  const now = new Date();
  return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
}

/**
 * 严格校验 YYYY-MM-DD，三条同时成立才算合法：
 *   1. 格式：10 位、连字符位置固定（'2026-1-1' / 'not-a-date' 都不算）
 *   2. 真实日历日期：2026-02-30、2026-13-01 这类不存在的日子不算
 *   3. 不晚于基准日：未来日期不算「已核实」
 * @param {string} value 待校验日期
 * @param {string} [today] 基准日 YYYY-MM-DD，默认今天
 */
function isValidDateString(value, today) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;

  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const d = Number(value.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;

  /* 用 UTC 构造再回读，任何溢出（2 月 30 日、4 月 31 日）都会对不上 */
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return false;
  }

  /* 同格式下字符串比较等价于日期比较 */
  if (value > (today || todayString())) return false;
  return true;
}

/**
 * 规范化一条记录的元信息。任何缺字段、自相矛盾的写法都在这里被纠正。
 *
 * 处理顺序（顺序本身就是规则，改写时不要调换）：
 *   1. 来源类型：不在白名单 → 一律按 unknown 处理，非白名单值绝不保留
 *   2. 演示优先：来源是 demo，或自己声称 demo → 强制 demo，且核实时间清空
 *   3. 核实 / 过期：来源要有证据力、说明非空、web 要有链接、日期必须严格合法
 *      任何一条不满足 → 降级 unverified，且不保留日期（不补造时间）
 *   4. 其余（unverified）：核实时间一律 null
 *
 * @param {object} raw 原始记录
 * @param {object} [options] { today: 'YYYY-MM-DD' } 仅测试用，固定基准日
 * @returns {{ verifyStatus, verifiedAt, source, normalizeNote }}
 */
function normalizeMeta(raw, options) {
  const rec = raw || {};
  const today = (options && options.today) || todayString();
  let note = '';

  /* ---- 1. 来源类型与文字 ---- */
  const rawSource = rec.source;
  let source;
  let kindRejected = '';
  if (!rawSource || typeof rawSource !== 'object') {
    source = makeSource(SOURCE_KIND.UNKNOWN, '', '');
    note = '来源缺失';
  } else {
    source = makeSource(
      typeof rawSource.kind === 'string' ? rawSource.kind : '',
      typeof rawSource.detail === 'string' ? rawSource.detail.trim() : '',
      typeof rawSource.ref === 'string' ? rawSource.ref.trim() : ''
    );
    if (KIND_VALUES.indexOf(source.kind) === -1) {
      kindRejected = source.kind || '(空)';
      note = '来源类型非法（' + kindRejected + '），按来源未标注处理';
      source = makeSource(SOURCE_KIND.UNKNOWN, source.detail, source.ref);
    }
  }

  /* ---- 2. 状态取值 ---- */
  let status = STATUS_VALUES.indexOf(rec.verifyStatus) === -1
    ? VERIFY_STATUS.UNVERIFIED
    : rec.verifyStatus;

  let verifiedAt = (typeof rec.verifiedAt === 'string' && rec.verifiedAt.trim())
    ? rec.verifiedAt.trim()
    : null;

  /* ---- 3. 演示优先 ---- */
  if (source.kind === SOURCE_KIND.DEMO || status === VERIFY_STATUS.DEMO) {
    const detail = source.detail || DEMO_SOURCE.detail;
    return {
      verifyStatus: VERIFY_STATUS.DEMO,
      verifiedAt: null,
      source: makeSource(SOURCE_KIND.DEMO, detail, source.kind === SOURCE_KIND.DEMO ? source.ref : ''),
      normalizeNote: status === VERIFY_STATUS.DEMO ? '演示数据不参与核实判定' : '来源为演示数据'
    };
  }

  /* ---- 4. 已核实 / 已过期：必须有证据 ---- */
  if (status === VERIFY_STATUS.VERIFIED || status === VERIFY_STATUS.EXPIRED) {
    const problems = [];

    if (kindRejected) {
      problems.push('来源类型非法（' + kindRejected + '）');
    } else if (EVIDENCE_KINDS.indexOf(source.kind) === -1) {
      problems.push('来源类型不足以支撑核实');
    }
    if (!source.detail) {
      problems.push('来源说明为空');
    }
    if (REF_REQUIRED_KINDS.indexOf(source.kind) > -1 && !source.ref) {
      problems.push('网络来源缺少可追溯链接');
    }
    if (!isValidDateString(verifiedAt, today)) {
      problems.push(verifiedAt ? '核实时间非法（' + verifiedAt + '）' : '缺少核实时间');
    }

    if (problems.length) {
      return {
        verifyStatus: VERIFY_STATUS.UNVERIFIED,
        verifiedAt: null,
        source: source,
        normalizeNote: problems.join('；')
      };
    }

    return {
      verifyStatus: status,
      verifiedAt: verifiedAt,
      source: source,
      normalizeNote: ''
    };
  }

  /* ---- 5. 待核实：没有核实记录就没有核实时间 ---- */
  return {
    verifyStatus: VERIFY_STATUS.UNVERIFIED,
    verifiedAt: null,
    source: source,
    normalizeNote: note
  };
}

/* 把一条元信息展开成页面能直接用的扁平字段 */
function decorate(meta, level) {
  const source = meta.source;
  return {
    metaLevel: level || '',
    verifyStatus: meta.verifyStatus,
    verifyText: VERIFY_LABEL[meta.verifyStatus] || '待核实',
    verifyClass: VERIFY_CLASS[meta.verifyStatus] || VERIFY_CLASS.unverified,
    verifyTip: VERIFY_TIP[meta.verifyStatus] || '',
    verifiedAt: meta.verifiedAt,
    sourceKind: source.kind,
    sourceKindText: SOURCE_KIND_LABEL[source.kind] || SOURCE_KIND_LABEL.unknown,
    sourceDetail: source.detail,
    sourceRef: source.ref,
    /* 原始来源对象也带上：合成「最弱一环」时要用 */
    source: copySource(source)
  };
}

/* 演示元信息（每次新建，不共享引用） */
function demoMeta(level) {
  return decorate(normalizeMeta({
    verifyStatus: VERIFY_STATUS.DEMO,
    verifiedAt: null,
    source: DEMO_SOURCE
  }), level);
}

/**
 * 给一组同类记录补上可信度字段。
 *
 * 关键改动（阶段 2 加固）：以前「已经有 verifyStatus 就直接跳过」，
 * 等于把来源不明、日期非法的记录原样放进页面。现在分两种情况，且都不跳过校验：
 *   · 完全没有可信度字段（纯业务数据）→ 按演示处理（本项目的现有数据全属此类）
 *   · 已经有任何可信度声明 → 一律 normalizeMeta 重新校验 + decorate 重算派生字段
 * 已有的合法真实来源与合法状态会被保留；不合法的组合在 normalizeMeta 里安全降级。
 * 原有业务字段全部原样保留（Object.assign 只覆盖可信度字段）。
 */
function attachDemo(list, level) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] || {};
    let flat;

    if (!raw.verifyStatus && !raw.source) {
      flat = demoMeta(level);
    } else {
      flat = decorate(normalizeMeta(raw), level);
    }

    out.push(Object.assign({}, raw, flat));
  }
  return out;
}

/**
 * 给店铺数组打演示标，并递归处理 floors / stalls。
 * 店铺、楼层、窗口三层都拿到同一套字段，层级由 metaLevel 区分。
 */
function attachDemoShops(list) {
  const shops = attachDemo(list, 'shop');
  for (let i = 0; i < shops.length; i++) {
    const shop = shops[i];
    if (shop.floors && shop.floors.length) {
      shop.floors = attachDemo(shop.floors, 'floor');
      /* 楼层自身记下所属店铺，出问题时能直接定位到哪家店 */
      for (let j = 0; j < shop.floors.length; j++) {
        if (!shop.floors[j].shopId) shop.floors[j].shopId = shop.id;
      }
    }
    if (shop.stalls && shop.stalls.length) {
      shop.stalls = attachDemo(shop.stalls, 'stall');
      /* 窗口同理：既能查到店铺，也能查到所属楼层 */
      for (let k = 0; k < shop.stalls.length; k++) {
        if (!shop.stalls[k].shopId) shop.stalls[k].shopId = shop.id;
      }
    }
  }
  return shops;
}

/**
 * 合成一组层级的状态，取「最弱一环」。
 * @param {Array} layers [{ level, id, verifyStatus, verifiedAt, source }]
 * @returns {{ status, level, id, verifiedAt, source, note }}
 *
 * 规则：
 *   · 任一层 expired → 整体 expired（过期比「待核实」更需要提醒重新核实）
 *   · 否则取 rank 最小的那层
 *   · 若最弱那一层不是自己，note 里写清是哪个层级拖累了状态
 */
function weakest(layers) {
  const list = [];
  for (let i = 0; i < layers.length; i++) {
    if (layers[i]) list.push(layers[i]);
  }
  if (!list.length) {
    return {
      status: VERIFY_STATUS.UNVERIFIED,
      level: '',
      id: '',
      verifiedAt: null,
      source: makeSource(SOURCE_KIND.UNKNOWN, '来源未标注', ''),
      note: ''
    };
  }

  let expired = null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].verifyStatus === VERIFY_STATUS.EXPIRED) { expired = list[i]; break; }
  }
  if (expired) {
    return {
      status: VERIFY_STATUS.EXPIRED,
      level: expired.metaLevel || '',
      id: expired.id || '',
      verifiedAt: expired.verifiedAt || null,
      source: copySource(expired.source),
      note: ''
    };
  }

  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    const a = STATUS_RANK[list[i].verifyStatus];
    const b = STATUS_RANK[best.verifyStatus];
    if ((a === undefined ? 1 : a) < (b === undefined ? 1 : b)) best = list[i];
  }

  const LEVEL_NAME = { shop: '店铺信息', floor: '楼层信息', stall: '窗口信息', dish: '菜品信息' };
  const selfLevel = list[0].metaLevel || '';
  let note = '';
  if (best.metaLevel && best.metaLevel !== selfLevel) {
    note = '该菜品本身为' + (VERIFY_LABEL[list[0].verifyStatus] || '待核实') +
      '，但' + (LEVEL_NAME[best.metaLevel] || '所属地点') + '为' +
      (VERIFY_LABEL[best.verifyStatus] || '待核实');
  }

  return {
    status: best.verifyStatus,
    level: best.metaLevel || '',
    id: best.id || '',
    verifiedAt: best.verifiedAt || null,
    source: copySource(best.source),
    note: note
  };
}

/* 统计一组记录各自的状态数量，用于页面上的「数据状态」一行 */
function countByStatus(list) {
  const out = { demo: 0, unverified: 0, verified: 0, expired: 0 };
  for (let i = 0; i < list.length; i++) {
    const s = (list[i] && list[i].verifyStatus) || VERIFY_STATUS.UNVERIFIED;
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

module.exports = {
  VERIFY_STATUS,
  VERIFY_LABEL,
  VERIFY_CLASS,
  VERIFY_TIP,
  SOURCE_KIND,
  SOURCE_KIND_LABEL,
  DEMO_SOURCE,
  KIND_VALUES,
  EVIDENCE_KINDS,
  makeSource,
  todayString,
  isValidDateString,
  normalizeMeta,
  decorate,
  demoMeta,
  attachDemo,
  attachDemoShops,
  weakest,
  countByStatus
};
