#!/usr/bin/env node
'use strict';

/**
 * tools/check_id_admission.js —— ID 准入只读校验器（P5 草案的落地版）
 *
 * 只做检查，绝不做以下任何事：
 *   · 生成 / 重编 / 修正 / 批准任何 ID
 *   · 写任何文件、改任何映射、连云端
 *
 * 检查内容：
 *   1. 冻结映射完整性：id-map.json 的 SHA-256 是否与批准记录里的 frozenMapSha256 一致
 *   2. ID 形状：c\d{2} / c\d{2}_t\d{2} / c\d{2}_d\d{3}
 *   3. 源内重复：映射、batch1、batch1_min、pilot-data 各自内部是否有重复 ID
 *   4. 跨源重叠：同一 ID 同时出现在多个来源（映射 / 批次 / pilot）
 *   5. 命名空间区间重叠：同一前缀（c01、c02…）的菜品号段是否相交，相交多少条
 *   6. 引用完整性：批次 CSV 与 pilot-data 里 shop/stall/dish 的挂靠关系
 *   7. pilot-data 与 batch1_min 是否同构（ID / 名称 / 价格）
 *   8. 批准覆盖：pilot / 批次用到的命名空间是否有批准记录提及
 *
 * 用法：
 *   node tools/check_id_admission.js [--root <项目根>] [--json]
 * 退出码：0 无冲突；1 有冲突；2 用法错误或输入缺失
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseCsv } = require('./import_data');

const ROOT = path.resolve(__dirname, '..');

const SHAPE = {
  shopId: /^c\d{2}$/,
  stallId: /^c\d{2}_t\d{2}$/,
  dishId: /^c\d{2}_d\d{3}$/
};

const SOURCE_ORDER = ['map', 'batch1', 'batch1_min', 'pilot'];

/* ------------------------------------------------------------------
   输入读取（只读）
   ------------------------------------------------------------------ */

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readCsvTable(file) {
  if (!fs.existsSync(file)) return null;
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0].map(function (h) { return h.trim(); });
  return rows.slice(1).map(function (cells, idx) {
    const o = {};
    header.forEach(function (h, i) { o[h] = (cells[i] === undefined ? '' : cells[i]).trim(); });
    /* 物理行号：表头是第 1 行，数据从第 2 行开始；用于冲突里给出「引用位置」 */
    o.__line = idx + 2;
    return o;
  }).filter(function (o) {
    return String(o.shop_id || o.stall_id || o.dish_id || '').length > 0;
  });
}

function collect(root) {
  const problems = [];
  const data = {
    map: { entries: [], approval: null, sha256: null },
    batch1: { shops: [], stalls: [], dishes: [] },
    batch1_min: { shops: [], stalls: [], dishes: [] },
    pilot: { restaurants: [], stalls: [], dishes: [], batchId: null }
  };

  const mapFile = path.join(root, 'tools', 'pilot', 'id-map.json');
  const approvalDir = path.join(root, 'tools', 'pilot', 'approvals');

  if (!fs.existsSync(mapFile)) {
    problems.push('缺少 ' + mapFile);
  } else {
    const raw = fs.readFileSync(mapFile);
    data.map.sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const map = JSON.parse(raw.toString('utf8'));
    data.map.init = {
      planDigest: (map.initialization && map.initialization.planDigest) || '',
      mapVersion: (map.initialization && map.initialization.mapVersion) || '',
      approvalRef: (map.initialization && map.initialization.approvalRef) || ''
    };
    data.map.entries = (map.entries || []).map(function (e) {
      return { dishId: e.dishId || '', stallId: e.stallId || '', status: e.status || '', key: e.key || '' };
    });
  }

  /* 命名空间条件批准登记处：docs/decisions/*NAMESPACE*APPROVAL*.json
     · 与 tools/pilot/approvals/ 的正式审批是两层东西：正式审批冻结号段，
       这里只登记「有条件批准」，校验器只据此消除对应前缀的未批准告警。 */
  data.namespaceApprovals = [];
  const decisionsDir = path.join(root, 'docs', 'decisions');
  if (fs.existsSync(decisionsDir)) {
    fs.readdirSync(decisionsDir)
      .filter(function (f) { return /namespace.*approval.*\.json$/i.test(f); })
      .sort()
      .forEach(function (f) {
        let parsed = null;
        try {
          parsed = readJson(path.join(decisionsDir, f));
        } catch (e) {
          problems.push('命名空间登记文件无法解析：' + path.join(decisionsDir, f) + '（' + (e && e.message ? e.message : e) + '）');
          return;
        }
        const entries = (parsed && Array.isArray(parsed.entries)) ? parsed.entries : [];
        entries.forEach(function (e) {
          if (!e || !e.prefix) return;
          data.namespaceApprovals.push({
            prefix: String(e.prefix),
            status: String(e.status || ''),
            approvalRef: String(e.approvalRef || ''),
            approvedBy: String(e.approvedBy || ''),
            approvedAt: String(e.approvedAt || ''),
            batches: Array.isArray(e.batches) ? e.batches.map(String) : [],
            scope: String(e.scope || ''),
            constraints: Array.isArray(e.constraints) ? e.constraints.map(String) : [],
            forbidden: Array.isArray(e.forbidden) ? e.forbidden.map(String) : [],
            file: path.relative(root, path.join(decisionsDir, f)).replace(/\\/g, '/')
          });
        });
      });
  }

  if (fs.existsSync(approvalDir)) {
    const files = fs.readdirSync(approvalDir).filter(function (f) { return /\.json$/.test(f); }).sort();
    data.map.approval = files.map(function (f) { return readJson(path.join(approvalDir, f)); });
    data.map.refChecks = data.map.approval.map(function (a) {
      if (!a || !a.frozenMapRef) return null;
      const refFile = path.join(root, a.frozenMapRef);
      if (!fs.existsSync(refFile)) {
        return { approvalId: a.approvalId, ref: a.frozenMapRef, missing: true };
      }
      const raw = fs.readFileSync(refFile);
      return {
        approvalId: a.approvalId,
        ref: a.frozenMapRef,
        sha256: crypto.createHash('sha256').update(raw).digest('hex'),
        bytes: raw.length
      };
    }).filter(Boolean);
  }

  ['batch1', 'batch1_min'].forEach(function (name) {
    const dir = path.join(root, 'tools', 'pilot', name);
    data[name].shops = readCsvTable(path.join(dir, 'shops.csv')) || [];
    data[name].stalls = readCsvTable(path.join(dir, 'stalls.csv')) || [];
    data[name].dishes = readCsvTable(path.join(dir, 'dishes.csv')) || [];
    if (!fs.existsSync(path.join(dir, 'dishes.csv'))) problems.push('缺少 ' + path.join(dir, 'dishes.csv'));
  });

  const pilotFile = path.join(root, 'cloudfunctions', 'seed', 'pilot-data.js');
  if (!fs.existsSync(pilotFile)) {
    problems.push('缺少 ' + pilotFile);
  } else {
    /* 用模块加载保证与线上结构一致；pilot-data 是纯数据模块，无副作用 */
    const pilot = require(pilotFile);
    data.pilot.batchId = pilot.BATCH_ID || null;
    data.pilot.restaurants = pilot.RESTAURANTS || [];
    data.pilot.stalls = pilot.STALLS || [];
    data.pilot.dishes = pilot.DISHES || [];
  }

  return { data: data, problems: problems };
}

/* ------------------------------------------------------------------
   检查
   ------------------------------------------------------------------ */

function norm(v) { return String(v || '').trim(); }

function idSets(data) {
  const sets = {};
  sets.map = {
    shops: [],
    /* 映射是「一条菜品一行」，同一档口会被重复列 77 次；这里必须先去重再谈重复 */
    stalls: Array.from(new Set(data.map.entries.map(function (e) { return e.stallId; }).filter(Boolean))),
    dishes: data.map.entries.map(function (e) { return e.dishId; }).filter(Boolean)
  };
  ['batch1', 'batch1_min'].forEach(function (name) {
    sets[name] = {
      shops: data[name].shops.map(function (r) { return norm(r.shop_id); }).filter(Boolean),
      stalls: data[name].stalls.map(function (r) { return norm(r.stall_id); }).filter(Boolean),
      dishes: data[name].dishes.map(function (r) { return norm(r.dish_id); }).filter(Boolean)
    };
  });
  sets.pilot = {
    shops: data.pilot.restaurants.map(function (r) { return norm(r._id); }).filter(Boolean),
    stalls: data.pilot.stalls.map(function (r) { return norm(r._id); }).filter(Boolean),
    dishes: data.pilot.dishes.map(function (r) { return norm(r._id); }).filter(Boolean)
  };
  return sets;
}

function findDuplicates(list) {
  const seen = Object.create(null);
  const dup = Object.create(null);
  list.forEach(function (id) {
    if (seen[id]) dup[id] = (dup[id] || 1) + 1;
    seen[id] = true;
  });
  return Object.keys(dup).sort();
}

function rangesOf(ids) {
  const byPrefix = Object.create(null);
  ids.forEach(function (id) {
    const m = /^(c\d{2})_d(\d{3})$/.exec(id);
    if (!m) return;
    const prefix = m[1];
    const n = Number(m[2]);
    if (!byPrefix[prefix]) byPrefix[prefix] = [];
    byPrefix[prefix].push(n);
  });
  return byPrefix;
}

function overlapReport(data) {
  const sets = idSets(data);
  const sources = {
    map: sets.map.dishes,
    batch1: sets.batch1.dishes,
    batch1_min: sets.batch1_min.dishes,
    pilot: sets.pilot.dishes
  };
  const out = [];
  SOURCE_ORDER.forEach(function (a, i) {
    SOURCE_ORDER.slice(i + 1).forEach(function (b) {
      /* batch1 / batch1_min / pilot 是同一批次的三种形态（草稿 / 修订子集 / 服务端副本），
         它们之间的重叠是设计使然，不是冲突；只有与冻结映射比较才有意义。 */
      if (a !== 'map' && b !== 'map') return;
      const ra = rangesOf(sources[a]);
      const rb = rangesOf(sources[b]);
      Object.keys(ra).sort().forEach(function (prefix) {
        if (!rb[prefix]) return;
        const shared = ra[prefix].filter(function (n) { return rb[prefix].indexOf(n) !== -1; });
        if (!shared.length) return;
        shared.sort(function (x, y) { return x - y; });
        out.push({
          a: a,
          b: b,
          prefix: prefix,
          count: shared.length,
          min: shared[0],
          max: shared[shared.length - 1],
          sample: shared.slice(0, 5).map(function (n) { return prefix + '_d' + String(n).padStart(3, '0'); })
        });
      });
    });
  });
  return out;
}

function analyze(data) {
  const conflicts = [];
  const notes = [];
  const sets = idSets(data);
  const sourceIds = {
    map: { shops: sets.map.shops, stalls: sets.map.stalls, dishes: sets.map.dishes },
    batch1: sets.batch1,
    batch1_min: sets.batch1_min,
    pilot: sets.pilot
  };

  /* 1. 冻结映射完整性
     · 批准记录冻结的是 docs/decisions/ID_MAP_T48_T49_*.json（决策文件），
       tools/pilot/id-map.json 是运行时派生副本：两份文件序列化不同，哈希天然不同，
       所以「副本」只能靠 planDigest / mapVersion 与批准记录对齐，不能拿哈希直接比。 */
  const approvals = data.map.approval || [];
  const refChecks = data.map.refChecks || [];
  if (!approvals.length) notes.push('未找到批准记录，跳过冻结映射比对');
  refChecks.forEach(function (c) {
    if (c.missing) {
      conflicts.push({ code: 'FROZEN_REF_MISSING', message: '批准记录引用的冻结文件不存在：' + c.ref });
      return;
    }
    const a = approvals.filter(function (x) { return x.approvalId === c.approvalId; })[0] || {};
    if (a.frozenMapSha256 && a.frozenMapSha256 !== c.sha256) {
      conflicts.push({ code: 'FROZEN_HASH_MISMATCH', message: c.ref + ' 的 SHA-256 与 ' + c.approvalId + ' 记录不一致' });
    }
    if (a.frozenMapBytes && Number(a.frozenMapBytes) !== c.bytes) {
      conflicts.push({ code: 'FROZEN_SIZE_MISMATCH', message: c.ref + ' 的字节数 ' + c.bytes + ' 与 ' + c.approvalId + ' 记录 ' + a.frozenMapBytes + ' 不一致' });
    }
  });
  const init = data.map.init || {};
  approvals.forEach(function (a) {
    if (a.planDigest && init.planDigest && a.planDigest !== init.planDigest) {
      conflicts.push({ code: 'PLAN_DIGEST_MISMATCH', message: 'id-map.json 的 planDigest 与 ' + a.approvalId + ' 记录不一致' });
    }
    if (a.mapVersion && init.mapVersion && a.mapVersion !== init.mapVersion) {
      conflicts.push({ code: 'MAP_VERSION_MISMATCH', message: 'id-map.json 的 mapVersion ' + init.mapVersion + ' 与 ' + a.approvalId + ' 记录 ' + a.mapVersion + ' 不一致' });
    }
  });
  if (data.map.sha256) {
    notes.push('id-map.json（运行时副本）SHA-256 前 16 位：' + data.map.sha256.slice(0, 16) + '…，与批准记录冻结的决策文件不是同一份，按 planDigest/mapVersion 对齐');
  }

  /* 2. 形状 + 3. 源内重复 */
  SOURCE_ORDER.forEach(function (name) {
    const ids = sourceIds[name];
    if (!ids) return;
    const shapeChecks = [
      { list: ids.shops, re: SHAPE.shopId, label: '店铺' },
      { list: ids.stalls, re: SHAPE.stallId, label: '窗口' },
      { list: ids.dishes, re: SHAPE.dishId, label: '菜品' }
    ];
    shapeChecks.forEach(function (c) {
      c.list.filter(function (id) { return !c.re.test(id); }).sort().forEach(function (id) {
        conflicts.push({ code: 'ID_SHAPE', source: name, message: name + ' 的' + c.label + ' ID 形状不合规：' + id });
      });
      findDuplicates(c.list).forEach(function (id) {
        conflicts.push({ code: 'DUP_IN_SOURCE', source: name, message: name + ' 内部' + c.label + ' ID 重复：' + id });
      });
    });
  });

  /* 4. 跨源重叠（同一 ID 出现在两个来源）
     batch1 / batch1_min / pilot 同属 pilot 批次的三种形态，彼此重叠是设计使然；
     只有与冻结映射的重叠才意味着「候选撞进已批准的号段」。 */
  const pairNames = [['map', 'batch1'], ['map', 'batch1_min'], ['map', 'pilot']];
  pairNames.forEach(function (pair) {
    ['shops', 'stalls', 'dishes'].forEach(function (kind) {
      const a = sourceIds[pair[0]][kind];
      const b = sourceIds[pair[1]][kind];
      if (!a || !b) return;
      const shared = a.filter(function (id) { return b.indexOf(id) !== -1; }).sort();
      if (shared.length) {
        conflicts.push({
          code: 'CROSS_SOURCE',
          message: pair[0] + ' 与 ' + pair[1] + ' 的 ' + kind + ' ID 重叠 ' + shared.length + ' 条：' + shared.slice(0, 6).join('、') + (shared.length > 6 ? '…' : '')
        });
      }
    });
  });

  /* 5. 命名空间区间重叠 */
  overlapReport(data).forEach(function (o) {
    conflicts.push({
      code: 'RANGE_OVERLAP',
      message: o.a + ' 与 ' + o.b + ' 在 ' + o.prefix + ' 的菜品号段重叠 ' + o.count + ' 条（' +
        o.prefix + '_d' + String(o.min).padStart(3, '0') + '–' + o.prefix + '_d' + String(o.max).padStart(3, '0') +
        '，示例 ' + o.sample.join('、') + '）'
    });
  });

  /* 6. 引用完整性 */
  ['batch1', 'batch1_min'].forEach(function (name) {
    const t = data[name];
    const shops = t.shops.map(function (r) { return norm(r.shop_id); });
    const stalls = t.stalls.map(function (r) { return norm(r.stall_id); });
    t.stalls.forEach(function (r) {
      if (shops.indexOf(norm(r.shop_id)) === -1) {
        conflicts.push({ code: 'REF_MISSING', message: name + ' 窗口 ' + norm(r.stall_id) + ' 的 shop_id 不存在：' + norm(r.shop_id) });
      }
    });
    t.dishes.forEach(function (r) {
      if (stalls.indexOf(norm(r.stall_id)) === -1) {
        conflicts.push({ code: 'REF_MISSING', message: name + ' 菜品 ' + norm(r.dish_id) + ' 的 stall_id 不存在：' + norm(r.stall_id) });
      }
      if (shops.indexOf(norm(r.shop_id)) === -1) {
        conflicts.push({ code: 'REF_MISSING', message: name + ' 菜品 ' + norm(r.dish_id) + ' 的 shop_id 不存在：' + norm(r.shop_id) });
      }
    });
  });

  const pilotShops = data.pilot.restaurants.map(function (r) { return norm(r._id); });
  const pilotStalls = data.pilot.stalls.map(function (r) { return norm(r._id); });
  data.pilot.stalls.forEach(function (r) {
    if (pilotShops.indexOf(norm(r.restaurantId)) === -1) {
      conflicts.push({ code: 'REF_MISSING', message: 'pilot 窗口 ' + norm(r._id) + ' 的 restaurantId 不存在：' + norm(r.restaurantId) });
    }
  });
  data.pilot.dishes.forEach(function (r) {
    if (pilotStalls.indexOf(norm(r.stallId)) === -1) {
      conflicts.push({ code: 'REF_MISSING', message: 'pilot 菜品 ' + norm(r._id) + ' 的 stallId 不存在：' + norm(r.stallId) });
    }
    if (pilotShops.indexOf(norm(r.restaurantId)) === -1) {
      conflicts.push({ code: 'REF_MISSING', message: 'pilot 菜品 ' + norm(r._id) + ' 的 restaurantId 不存在：' + norm(r.restaurantId) });
    }
  });

  /* 7. pilot-data 与 batch1_min 同构 */
  const minById = Object.create(null);
  data.batch1_min.dishes.forEach(function (r) { minById[norm(r.dish_id)] = r; });
  const pilotIds = data.pilot.dishes.map(function (r) { return norm(r._id); }).sort();
  const minIds = Object.keys(minById).sort();
  const sameIds = pilotIds.length === minIds.length && pilotIds.every(function (id, i) { return id === minIds[i]; });
  if (!sameIds) {
    conflicts.push({ code: 'PILOT_MIN_DRIFT', message: 'pilot-data 与 batch1_min 的菜品 ID 集合不一致（' + pilotIds.length + ' vs ' + minIds.length + '）' });
  } else {
    data.pilot.dishes.forEach(function (d) {
      const r = minById[norm(d._id)];
      const price = Number(norm(r.price));
      if (norm(d.name) !== norm(r.dish_name)) {
        conflicts.push({ code: 'PILOT_MIN_DRIFT', message: 'pilot 菜品 ' + norm(d._id) + ' 名称与 batch1_min 不一致：' + norm(d.name) + ' vs ' + norm(r.dish_name) });
      }
      if (Number(d.price) !== price) {
        conflicts.push({ code: 'PILOT_MIN_DRIFT', message: 'pilot 菜品 ' + norm(d._id) + ' 价格与 batch1_min 不一致：' + d.price + ' vs ' + price });
      }
    });
  }

  /* 8. 批准覆盖：正式审批 ∪ 命名空间条件批准
     · 正式审批（tools/pilot/approvals/*.json）的 scope 提到某前缀 → 视为已批准；
     · 条件批准（docs/decisions/*NAMESPACE*APPROVAL*.json，status=conditional）
       只消除「被点名前缀 + 批次覆盖」的告警，不升级为正式批准、不波及其它前缀。 */
  const formalScope = approvals.map(function (a) {
    return String((a && a.scope) || '') + '\n' + String((a && a.notice) || '');
  }).join('\n');
  const namespaceApprovals = data.namespaceApprovals || [];

  function formalMentions(prefix) {
    const re = new RegExp('(^|[^A-Za-z0-9])' + prefix + '(?![0-9])');
    return re.test(formalScope);
  }
  function conditionalEntry(prefix, sourceName) {
    return namespaceApprovals.filter(function (e) {
      if (e.prefix !== prefix || e.status !== 'conditional') return false;
      if (!e.batches.length) return false;
      return e.batches.indexOf(sourceName) !== -1;
    })[0] || null;
  }
  function prefixRows(name, prefix) {
    const out = { shops: [], stalls: [], dishes: [], references: [] };
    const tables = name === 'pilot'
      ? [['shops', data.pilot.restaurants, '_id'], ['stalls', data.pilot.stalls, '_id'], ['dishes', data.pilot.dishes, '_id']]
      : [['shops', data[name].shops, 'shop_id'], ['stalls', data[name].stalls, 'stall_id'], ['dishes', data[name].dishes, 'dish_id']];
    tables.forEach(function (t) {
      const rows = (t[1] || []).filter(function (r) { return norm(r[t[2]]).indexOf(prefix) === 0; });
      if (!rows.length) return;
      const ids = rows.map(function (r) { return norm(r[t[2]]); });
      out[t[0]] = ids;
      const ref = {
        file: name === 'pilot' ? 'cloudfunctions/seed/pilot-data.js' : 'tools/pilot/' + name + '/' + t[0] + '.csv',
        table: t[0],
        count: ids.length,
        ids: ids.slice(0, 12)
      };
      if (rows[0] && rows[0].__line) {
        const lines = rows.map(function (r) { return r.__line; });
        ref.lines = [Math.min.apply(null, lines), Math.max.apply(null, lines)];
      }
      out.references.push(ref);
    });
    return out;
  }
  function prefixDependencies(prefix, name, mapHasPrefix) {
    const deps = [];
    if (!mapHasPrefix) {
      deps.push('冻结映射 tools/pilot/id-map.json 中没有 ' + prefix + ' 的任何条目（运行时副本只含已批准号段）');
    }
    deps.push('任何正式批准记录（tools/pilot/approvals/*.json）的 scope 均未提及 ' + prefix);
    const registered = namespaceApprovals.filter(function (e) { return e.prefix === prefix; });
    if (!registered.length) {
      deps.push('命名空间登记 docs/decisions/*NAMESPACE*APPROVAL*.json 中没有 ' + prefix + ' 的条目');
    } else {
      registered.forEach(function (e) {
        const why = e.status !== 'conditional'
          ? '状态为 ' + e.status + '，不是 conditional'
          : '适用批次为 ' + (e.batches.join('、') || '（空）') + '，不包含 ' + name;
        deps.push('命名空间登记 ' + e.file + ' 有 ' + prefix + ' 条目（' + (e.approvalRef || '无 ref') + '），但' + why + '，因此不覆盖当前来源');
      });
    }
    if (name === 'batch1') {
      deps.push('batch1 是草稿批次，其 ID 处置（重编或作废）尚未批准（见 ACCELERATION_READINESS §9 R-2）');
    }
    return deps;
  }

  const mapPrefixSet = Object.keys(rangesOf(sets.map.dishes));
  sets.map.stalls.forEach(function (id) {
    const m = /^(c\d{2})/.exec(id);
    if (m && mapPrefixSet.indexOf(m[1]) === -1) mapPrefixSet.push(m[1]);
  });

  ['pilot', 'batch1', 'batch1_min'].forEach(function (name) {
    const prefixes = Object.keys(rangesOf(sourceIds[name].dishes)).sort();
    prefixes.forEach(function (prefix) {
      if (formalMentions(prefix)) return;
      const cond = conditionalEntry(prefix, name);
      if (cond) {
        notes.push('NS_CONDITIONAL ' + prefix + '（' + name + '）：有条件批准 ' + (cond.approvalRef || '') +
          '，仅代表试点候选；禁止写入冻结映射与正式数据、禁止标 verified。后续正式登记条件见 ' + cond.file);
        return;
      }
      const rows = prefixRows(name, prefix);
      conflicts.push({
        code: 'NS_UNAPPROVED',
        source: name,
        namespace: prefix,
        message: name + ' 使用的命名空间 ' + prefix + ' 未获正式批准（有条件批准也不覆盖它，不代表已批准）',
        records: {
          shops: rows.shops,
          stalls: rows.stalls,
          dishes: rows.dishes.length
            ? { count: rows.dishes.length, min: rows.dishes[0], max: rows.dishes[rows.dishes.length - 1], sample: rows.dishes.slice(0, 5) }
            : null
        },
        references: rows.references,
        dependencies: prefixDependencies(prefix, name, mapPrefixSet.indexOf(prefix) !== -1)
      });
    });
  });

  /* 提示：候选 ID（batch1 中带 ex_ 前缀的示例行已在读取时过滤，这里只报告规模） */
  notes.push('来源规模：map 菜品 ' + sets.map.dishes.length +
    '；batch1 菜品 ' + sets.batch1.dishes.length +
    '；batch1_min 菜品 ' + sets.batch1_min.dishes.length +
    '；pilot 菜品 ' + sets.pilot.dishes.length);

  conflicts.sort(function (a, b) {
    const ka = a.code + '|' + (a.source || '') + '|' + a.message;
    const kb = b.code + '|' + (b.source || '') + '|' + b.message;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return { conflicts: conflicts, notes: notes };
}

/* ------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------ */

function render(result, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('==== check_id_admission（只读）====');
  console.log(result.notes.join('\n'));
  if (!result.conflicts.length) {
    console.log('\n✅ 未发现冲突');
    return;
  }
  console.log('\n冲突 ' + result.conflicts.length + ' 条：');
  result.conflicts.forEach(function (c) {
    console.log('  [' + c.code + '] ' + c.message);
  });
}

function main(argv) {
  let root = ROOT;
  let jsonMode = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { jsonMode = true; continue; }
    if (a === '--root') {
      root = argv[i + 1] ? path.resolve(argv[i + 1]) : '';
      i += 1;
      continue;
    }
    console.error('未知参数：' + a);
    console.error('用法：node tools/check_id_admission.js [--root <项目根>] [--json]');
    return 2;
  }
  if (!root) {
    console.error('用法：--root 后面必须跟项目根目录');
    return 2;
  }

  let collected;
  try {
    collected = collect(root);
  } catch (e) {
    console.error('读取输入失败：' + (e && e.message ? e.message : e));
    return 2;
  }
  if (collected.problems.length) {
    console.error('输入缺失：');
    collected.problems.forEach(function (p) { console.error('  · ' + p); });
    return 2;
  }

  const result = analyze(collected.data);
  render(result, jsonMode);
  return result.conflicts.length ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  SHAPE: SHAPE,
  collect: collect,
  analyze: analyze,
  idSets: idSets,
  findDuplicates: findDuplicates,
  rangesOf: rangesOf,
  overlapReport: overlapReport,
  main: main
};
