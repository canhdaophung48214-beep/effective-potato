/**
 * utils/datasetGuard.js —— 数据集形状校验（阶段 3-3.4 / 修复 R-E）
 *
 * 目的：在「把一份数据装上页面」之前，先判断它到底能不能用。
 *
 * 为什么需要它：applyDataset() 的第一件事就是整体替换 this.raw 与 this.shopMap。
 * 如果 provider（将来是云端）返回一份畸形数据，先覆盖再抛错的话，好数据已经没了，
 * 页面还会停在 loading。所以校验必须发生在应用之前，失败就原样保留旧数据。
 *
 * 边界（重要）：
 *   · 只校验「结构」——字段在不在、类型对不对、数组是不是数组。
 *     不校验业务枚举（area 取值、foodType 取值、side 取值……）：
 *     那些由 verify_data.js 与 provider 自己负责，这里放宽才不会把
 *     将来新增的合法取值误判成畸形。
 *   · 不做任何「修复」：不把 null 变 []、不把 '12' 变 12、不补默认值。
 *     畸形就是畸形，交给调用方决定是报错还是丢弃。
 *   · 不读 wx、不读文件、不联网，纯函数，可在 Node 里直接测。
 *
 * 校验依据（都来自现有代码的实际用法，不是臆造）：
 *   · data/index.js buildDataset()：
 *       shopMap[shop.id]、shop.floors、shop.stalls、findById(shop.stalls, dish.stallId)、
 *       floor.label、shop.name / area / building / location、dish.price / tastes（.map）
 *   · utils/matcher.js filterDishes()：
 *       dish.area、dish.shopId、dish.floorId、dish.stallId、dish.side、
 *       dish.foodType、dish.price（数值比较）、dish.tastes（indexOf）
 *   · data/provenance.js：source / verifyStatus / verifiedAt 都是可选的，
 *     缺失会被当成 demo，所以这里不把它们列为必需字段。
 */

/* 错误最多记这么多条：畸形数据可能成千上万条，全存下来既没用又占内存 */
const MAX_ERRORS = 20;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isString(value) {
  return typeof value === 'string';
}

function isFiniteNumber(value) {
  return typeof value === 'number' && isFinite(value);
}

/**
 * 收集错误的小工具：到上限就停止记录，但 still 继续返回 false
 */
function createCollector() {
  const errors = [];
  let truncated = false;

  return {
    add: function (path, message) {
      if (errors.length >= MAX_ERRORS) {
        truncated = true;
        return;
      }
      errors.push(path + ' ' + message);
    },
    result: function () {
      return { errors: errors, truncated: truncated };
    }
  };
}

/* ---------------- 楼层 ---------------- */

function checkFloor(floor, path, collect) {
  if (!isPlainObject(floor)) {
    collect.add(path, '必须是对象');
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(floor.id)) {
    collect.add(path + '.id', '必须是非空字符串');
    ok = false;
  }
  if (!isString(floor.label)) {
    collect.add(path + '.label', '必须是字符串');
    ok = false;
  }
  return ok;
}

/* ---------------- 窗口 / 档口 ---------------- */

function checkStall(stall, path, collect) {
  if (!isPlainObject(stall)) {
    collect.add(path, '必须是对象');
    return false;
  }
  let ok = true;
  if (!isNonEmptyString(stall.id)) {
    collect.add(path + '.id', '必须是非空字符串');
    ok = false;
  }
  if (!isString(stall.name)) {
    collect.add(path + '.name', '必须是字符串');
    ok = false;
  }
  /* floorId 允许缺省或空串（无楼层划分的店就是这样），但给了就必须是字符串 */
  if (stall.floorId !== undefined && !isString(stall.floorId)) {
    collect.add(path + '.floorId', '必须是字符串（无楼层时用空串）');
    ok = false;
  }
  /* 这三个是可选采集字段，给了就必须是字符串 */
  ['side', 'noStatus', 'no'].forEach(function (key) {
    if (stall[key] !== undefined && !isString(stall[key])) {
      collect.add(path + '.' + key, '必须是字符串');
      ok = false;
    }
  });
  return ok;
}

/* ---------------- 店铺 ---------------- */

function checkShop(shop, path, collect) {
  if (!isPlainObject(shop)) {
    collect.add(path, '必须是对象');
    return false;
  }

  let ok = true;

  if (!isNonEmptyString(shop.id)) {
    collect.add(path + '.id', '必须是非空字符串');
    ok = false;
  }
  if (!isString(shop.name)) {
    collect.add(path + '.name', '必须是字符串');
    ok = false;
  }

  /* floors / stalls 允许缺省（buildDataset 用 (shop.floors || []) 兜底），
     但给了就必须是数组 —— 对象会被 forEach 打穿 */
  if (shop.floors !== undefined) {
    if (!Array.isArray(shop.floors)) {
      collect.add(path + '.floors', '必须是数组');
      ok = false;
    } else {
      for (let i = 0; i < shop.floors.length; i++) {
        if (!checkFloor(shop.floors[i], path + '.floors[' + i + ']', collect)) ok = false;
      }
    }
  }

  if (shop.stalls !== undefined) {
    if (!Array.isArray(shop.stalls)) {
      collect.add(path + '.stalls', '必须是数组');
      ok = false;
    } else {
      for (let i = 0; i < shop.stalls.length; i++) {
        if (!checkStall(shop.stalls[i], path + '.stalls[' + i + ']', collect)) ok = false;
      }
    }
  }

  return ok;
}

/* ---------------- 菜品 ---------------- */

function checkDish(dish, path, collect) {
  if (!isPlainObject(dish)) {
    collect.add(path, '必须是对象');
    return false;
  }

  let ok = true;

  if (!isNonEmptyString(dish.id)) {
    collect.add(path + '.id', '必须是非空字符串');
    ok = false;
  }
  if (!isNonEmptyString(dish.name)) {
    collect.add(path + '.name', '必须是非空字符串');
    ok = false;
  }
  /* 价格参与预算比较（dish.price > budget），类型错了会静默漏掉整道菜 */
  if (!isFiniteNumber(dish.price) || dish.price < 0) {
    collect.add(path + '.price', '必须是不小于 0 的有限数字');
    ok = false;
  }
  if (!isNonEmptyString(dish.foodType)) {
    collect.add(path + '.foodType', '必须是非空字符串');
    ok = false;
  }
  if (!isNonEmptyString(dish.shopId)) {
    collect.add(path + '.shopId', '必须是非空字符串');
    ok = false;
  }
  /* stallId 允许空串（将来可能有挂不到具体窗口的菜） */
  if (dish.stallId !== undefined && !isString(dish.stallId)) {
    collect.add(path + '.stallId', '必须是字符串');
    ok = false;
  }
  /* 口味：数组 + 元素全是字符串（tastes.map 与 indexOf 都依赖这一点） */
  if (dish.tastes !== undefined) {
    if (!Array.isArray(dish.tastes)) {
      collect.add(path + '.tastes', '必须是数组');
      ok = false;
    } else {
      for (let i = 0; i < dish.tastes.length; i++) {
        if (!isString(dish.tastes[i])) {
          collect.add(path + '.tastes[' + i + ']', '必须是字符串');
          ok = false;
        }
      }
    }
  }

  return ok;
}

/* ---------------- 对外入口 ---------------- */

/**
 * 校验一份数据集能不能被页面应用。
 *
 * @param {*} raw provider 返回的东西（可能是任何形状）
 * @return {{ok: boolean, errors: string[], truncated: boolean}}
 *   ok=true 表示结构可用；ok=false 时 errors 至少有一条，形如
 *   `shops[3].stalls[1].name 必须是字符串`，可直接写进日志或 _loadError。
 */
function validateDataset(raw) {
  const collect = createCollector();

  if (!isPlainObject(raw)) {
    collect.add('dataset', '必须是对象');
    return Object.assign({ ok: false }, collect.result());
  }

  let ok = true;

  /* 这两个字段是整个页面的根基：applyDataset 会对 shops 做 forEach，
     refresh 会对 dishes 做 filter，任何一个是对象都会当场打穿 */
  if (!Array.isArray(raw.shops)) {
    collect.add('dataset.shops', '必须是数组');
    ok = false;
  }
  if (!Array.isArray(raw.dishes)) {
    collect.add('dataset.dishes', '必须是数组');
    ok = false;
  }

  if (Array.isArray(raw.shops)) {
    for (let i = 0; i < raw.shops.length; i++) {
      if (!checkShop(raw.shops[i], 'shops[' + i + ']', collect)) ok = false;
    }
  }

  if (Array.isArray(raw.dishes)) {
    for (let i = 0; i < raw.dishes.length; i++) {
      if (!checkDish(raw.dishes[i], 'dishes[' + i + ']', collect)) ok = false;
    }
  }

  /* source 不参与结构校验：缺失要维持「未知来源」语义（见 S13），
     不能因为没写 source 就被当成畸形数据拒掉 */
  const result = collect.result();
  return { ok: ok, errors: result.errors, truncated: result.truncated };
}

module.exports = {
  validateDataset: validateDataset,
  MAX_ERRORS: MAX_ERRORS
};
