# 套餐（组合餐）数据模型设计提案（A3）

> 版本：A3 初版 · 2026-10-22
> 状态：**设计提案，未实施。** 本文所有新字段都是「建议字段 / 待实现」，当前代码里一个都不存在。
> 本轮不动 `data/`、`pages/`、`cloudfunctions/`、云数据库。等确认后再排期。

---

## 0. 为什么现在要单独谈套餐

产品决策 3 要求「首批同时采集普通菜品和套餐」。但当前代码**明确拒绝**套餐：

- `tools/import_data.js:52-53`：`RECORD_TYPE_DISH = '菜品'`，`RECORD_TYPES_UNSUPPORTED = ['套餐', '加料', '店铺规则']`
- `tools/import_data.js:492-499`：`record_type` 不是「菜品」→ 直接 `reject`，连校验都进不去
- `tools/verify_data.js` 里没有任何套餐规则（规则表只有 S1–S3 / F1–F3 / T1–T6 / D1–D8 / P1–P6 / J1–J4）
- 现在的菜品模型（`data/dishes.js:6-13`）：`id / name / price / foodType / shopId / stallId / tastes` —— **没有任何"组成项"的位置**

所以「不先定模型就采套餐」只有两个结局：要么把套餐总价当成一道菜的单价录进去（污染预算筛选），要么录不进去。

---

## 1. 两个候选方案

### 方案 A：套餐独立成表，组成项用独立子记录（关联表）

```
combos:      { id, name, price, shopId, stallId, priceScope:'combo', source… }
comboItems:  { id, comboId, dishId, qty, optional, extraPrice }
```

- 套餐和菜品在**不同集合/不同 CSV**里，天然不会串价。
- 组成项是**独立记录**，可以有自己的证据、自己的价格、自己的备注。
- 代价：多一张表 + 多一套校验 + 多一次关联查询；导入器要新增 `combos.csv` / `combo_items.csv`。

### 方案 B：套餐是 `dishes` 里的一种 record_type，组成项做结构化字段

```
dishes: { id, name, price, recordType:'combo', priceScope:'combo',
          comboItems:[{dishId, qty, optional, extraPrice}], shopId, stallId, tastes… }
```

- 复用现有四张表，只加 `record_type='套餐'` + 一个 `combo_items` 单元格。
- 代价：菜品表里混进两种东西，**预算筛选、随机推荐、比价页面全都要多一个判断**；组成项只能塞进一个 CSV 单元格（格式自造，容易写错）。

---

## 2. 七维对比

| 维度 | 方案 A（独立表） | 方案 B（同表 + 结构化字段） |
|---|---|---|
| **数据一致性** | 强。组成项引用 `dishId`，可做外键式校验（必须存在、必须同店） | 中。能引用 `dishId`，但同一表里混两种语义，校验要按 `recordType` 分支 |
| **套餐价 vs 单品价** | 天然分开：不同表、不同页面入口，不会被误当单品价 | **最大风险点**：同一字段 `price` 存两种含义，必须靠 `priceScope` 区分，任何漏判都会污染预算筛选 |
| **可选项 / 加料** | 好。`optional` + `extraPrice` 是组成项的一等属性，未来还能加「二选一」组 | 勉强。字段能塞，但一个单元格里表达"可选 + 加价 + 二选一"会迅速失控 |
| **未来更新** | 好。改一项不影响套餐主记录；可单独给组成项补价格变化 | 差。改一个组成项要重写整条套餐记录（含证据链） |
| **现有验证器兼容** | 需要新增一组规则（C1–Cn），但**不改**现有 D1–D8 语义 | 需要给 D 组加 `recordType` 分支，D5/D8 都要重新定义「什么叫重复」 |
| **现有页面兼容** | 页面零改动（套餐先不进首页），后续新增入口 | **必须改**：`utils/matcher.js` 的 `filterDishes` 要按 `recordType` 过滤，否则套餐会混进"随机选一道菜"和价格排序 |
| **迁移成本** | 高一次：新表 + 新校验 + 新导入表 + 新页面入口 | 低起步：先加字段就能跑；但技术债在后面几轮持续付 |

---

## 3. 推荐方案：B′（方案 B 的最小可行变体）

**理由**：首批采集要的是「能采、能存、能展示」，不是「套餐系统」。A 的完整形态（独立表 + 二选一 + 加料组）现在做，会把一个还没验证过的需求做成三层结构；而纯 B 的漏洞（`price` 语义混淆）可以用**两个显式字段 + 三条校验**堵死。

B′ = 在 `dishes` 里加 4 个字段，并且**只在 `recordType='combo'` 时合法**：

### 3.1 套餐主记录字段（建议字段，待实现）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `recordType` | `'dish'` \| `'combo'` | 是（新增字段，默认 `'dish'`） | 显式区分，不再靠猜 |
| `priceScope` | `'item'` \| `'combo'` | 是（新增字段） | `item` = 单品价；`combo` = 套餐总价。**这是防串价的核心** |
| `price` | number | 是 | 含义由 `priceScope` 决定；校验规则完全不变（正数、一位小数、>100 走人工复核） |
| `comboItems` | array | `combo` 时必填 | 组成项，见 3.2 |
| `comboComplete` | boolean | 否（默认 `true`） | `false` = 组成信息不全，页面必须显示「套餐组成待补充」 |
| `comboNote` | string | 否 | 组成不确定时的说明（如「另可选凉菜一份，待确认」） |
| 其余字段 | — | — | `id / name / shopId / stallId / tastes / source…` 沿用现状 |

> `foodType`：套餐建议**照常填**（饭类套餐填 `rice`），这样「想吃饭」的用户能筛到它；但**价格筛选必须按 `priceScope` 决定要不要算进来** —— 见 3.4 的规则 3。

### 3.2 组成项如何引用菜品（建议字段，待实现）

```js
comboItems: [
  { dishId: 'c01_d001', qty: 1, optional: false, extraPrice: null },
  { dishId: 'c01_d007', qty: 1, optional: false, extraPrice: null },
  { dishId: 'c01_d012', qty: 1, optional: true,  extraPrice: 2 }
]
```

| 属性 | 规则 |
|---|---|
| `dishId` | **必须**指向同一 `shopId` 下已存在的菜品（跨食堂引用 = 报错） |
| `qty` | 正整数 ≥ 1（"两份米饭" → `qty: 2`，不重复写两条） |
| `optional` | 布尔；`true` = 可选加/换，默认不含 |
| `extraPrice` | 仅 `optional: true` 的项可填，≥ 0、最多一位小数；必选项**必须**为 `null` |

### 3.3 固定套餐价 vs 可选加料价

- **固定套餐价**：主记录 `price` + `priceScope: 'combo'`，代表「不含可选项时的整份价格」。
- **可选加料价**：只在 `comboItems[].extraPrice` 上出现，代表「加这一项要多付多少」，**不并入** `price`。
- 页面展示：`¥12.5 起`（有可选项时加「起」），点开才列出「+ 2 元可加卤蛋」。

### 3.4 三条必备校验（防串价 / 防残缺）

| 编号 | 规则 | 失败处理 |
|---|---|---|
| **C1** | `recordType='combo'` ⇔ `priceScope='combo'`；`recordType='dish'` ⇔ `priceScope='item'` | 错误（必填/冲突） |
| **C2** | `comboItems` 非空、≥ 2 项；每项 `dishId` 必须存在于**同店**、`qty` 正整数、`optional` 布尔、`extraPrice` 仅 optional 可用 | 错误 |
| **C3** | 套餐价与「必选项单点合计」相差过大（< 合计 × 0.5 或 > 合计 × 1.2）→ **警告 + 人工复核**，不判错（避免用主观折扣规则硬判） | 警告 |

另外两条：

- **C4**：`comboComplete=false` 时必须在 `comboNote` 写清缺什么；页面显示「套餐组成待补充」，**不参与**「随机选一道菜」。
- **C5**：`recordType='dish'` 的记录出现 `comboItems` / `comboComplete` / `comboNote` 任一字段 → 错误（防止复制粘贴串字段）。

### 3.5 套餐 / 组成项不存在或不完整怎么办

| 情况 | 现在的工具链能做什么 | 应该怎么做 |
|---|---|---|
| 组成项 `dishId` 不存在 | 以后 C2 会拦 | 先把组成菜品采进 `dishes.csv`，再采套餐（顺序：菜品 → 套餐） |
| 跨店引用 | C2 拦 | 说明采集错了，套餐只由本店菜品组成 |
| 只知道「两荤一素」不知道具体菜 | 无法表达 | `comboComplete: false` + `comboNote: '两荤一素，具体菜品待确认'`，**不要**编 dishId |
| 套餐临时缺货 / 换菜 | 模型里没有库存/时间维度 | 记在 `comboNote`，不为此改模型 |

### 3.6 防止把套餐总价当单品价

1. `priceScope` 显式字段 + C1 双向互斥校验；
2. 任何按价格排序/预算筛选的地方，都必须先看 `priceScope`（`utils/matcher.js` 的 `filterDishes`、`applySort`、首页「随机选菜」）；
3. C3 的"合计对比"警告能抓住"把 25 元套餐写成 25 元单品"之外的另一种常见错——把**其中一道菜**的单价当成了套餐价（此时套餐价会明显小于合计）；
4. 采集规范（`tools/REAL_DATA_COLLECTION_SPEC.md` 第 2 节）里写明：套餐出现时先记备注，等模型上线再采。

---

## 4. 采用 B′ 需要动的清单（本轮都不做）

| 文件 | 需要改什么 | 影响面 |
|---|---|---|
| `data/dishes.js` | 加 `recordType` / `priceScope`（默认值），套餐加 `comboItems` 等 | 45 条演示数据全部要补默认值，`data/index.js` 的 `buildDataset` 要透传 |
| `data/index.js` | `ALL_DISHES` 组装时透传新字段；`DATA_STATUS_SUMMARY` 是否区分套餐待定 | 影响首页统计文案 |
| `utils/matcher.js` | `filterDishes` 增加 `recordType` 维度（默认只选单品？还是都选？需产品定） | **直接影响现有筛选结果**，属于行为变更 |
| `tools/verify_data.js` | 新增 C1–C5 规则；D5/D8 增加 `priceScope` 语义说明 | 校验基线变化，历史测试要跟着调 |
| `tools/import_data.js` | `RECORD_TYPES_UNSUPPORTED` 里去掉「套餐」；`SCHEMAS.dishes` 加 4 列；解析 `combo_items` 单元格 | CSV 格式变更，旧模板要升级 |
| `tools/templates/dishes.csv` | 加列 | 采集表要重新发 |
| `pages/index/*` | 列表/卡片显示套餐标记、`x 起`、组成弹层 | UI 工作量最大的一块 |
| `cloudfunctions/seed` | 套餐字段要进云端 schema | **必须重新授权才能碰** |

**工作量粗估**：数据层 0.5 天、校验与测试 1 天、导入器 1 天、页面 1–2 天。**云端那一环另算，且需要新授权。**

---

## 5. 迁移顺序（确认后按这个走）

1. 数据层加字段 + 默认值（演示数据全部 `recordType:'dish'`、`priceScope:'item'`），跑全量回归确认零行为变化；
2. `verify_data.js` 加 C1–C5，补测试（含"套餐价 < 合计一半"的警告用例）；
3. `import_data.js` 支持 `record_type=套餐` + `combo_items` 单元格，补测试（含跨店引用、缺 qty、可选项带 extraPrice）；
4. 页面：先只做**展示**（套餐标记 + 组成展开），不改筛选；
5. 再单独决策：套餐是否参与「随机选一道菜」、是否参与预算筛选。

---

## 6. 待你确认的决策

1. **套餐要不要参与「随机选一道菜」和预算筛选？** 我倾向：参与预算筛选（按套餐价），**不参与**「随机选一道菜」（避免抽到"两荤一素"却只显示一个菜名）。
2. **`comboItems` 的 CSV 表达**：建议 `c01_d001*1|c01_d007*1|+c01_d012*1*2.0`（`+` = 可选，末尾 = 加价）。确认后我写进模板与文档。
3. **套餐是否允许跨窗口组合**？我倾向**不允许**（同店同窗口），否则证据链说不清。
4. 采用 B′ 还是先只采单品、套餐整体延后到下一轮？
