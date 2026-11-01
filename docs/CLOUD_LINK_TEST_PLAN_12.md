# 12 道样板菜云端链路测试计划

> 状态：**计划，未执行**。本文件由只读检查产出，本轮没有调用云函数、没有部署、没有写云数据库、没有导入真实数据、没有改页面。
> 核对时间基准：工作区 `HEAD 274ebd6`，`git status --short` 47 行（14 M + 33 ??），暂存区空。

---

## 一、只读核对结论（现状）

### 1.1 云端函数

| 函数 | 状态 | 超时 | 运行时 | 说明 |
|---|---|---|---|---|
| `seed` | Active | 10s | Nodejs16.13 | 有 `ADMIN_OPENIDS` 鉴权；数据源是硬编码的 8 条 |
| `healthCheck` | Active | 3s | Nodejs16.13 | 只读，不碰数据库 |
| `dbCheck` | **已删除** | — | — | 全仓库 0 引用 |

### 1.2 云端集合与数据（现有 8 条）

| 集合 | 条数 | `_id` |
|---|---|---|
| `restaurants` | 1 | `s01` |
| `stalls` | 3 | `s01_t1`、`s01_t2`、`s01_t3` |
| `dishes` | 4 | `d01`、`d02`、`d03`、`d39` |

历史残留：`conncheck`（0 条，`dbCheck` 时代产物）。`contributions`/`reviews` 不存在（`-502005`）。

**集合权限**：三集合均为控制台档位「所有用户可读」（`read:true, write:false`）。小程序端 `add` 已实测 `-502003 DATABASE_PERMISSION_DENIED`，即客户端写不进去；只有云函数（管理端身份）能写。**本轮未复核权限档位，S1 前必须在控制台再看一次。**

### 1.3 代码侧现状

| 位置 | 事实 |
|---|---|
| `pages/index/index.js:354 loadRawDataset()` | 首页唯一取数入口，**只返回本地数据** |
| `pages/index/`（js/wxml/wxss） | 对 `cloudRepo`、`wx.cloud`、`loadCloudDataset` **0 引用** |
| `utils/cloudRepo.js` | 只被 `tools/test_cloudrepo.js` 引用，**运行时死代码** |
| `app.js` | 只有 `wx.cloud.init({ env, traceUser: true })`，无任何数据调用 |

结论：**首页当前完全不读云端**。要让 12 道样板菜真正跑通链路，必须有一次首页改造（本轮禁止，需单独授权）。

### 1.4 调用链锚点（改造时要动的点）

```
onLoad → beginLoad(:391) → loadRawDataset(:354) → applyDataset → refresh(:985)
       → buildCond(:962) → filterDishes(matcher:168) → this.matched
       → sortedList(:1009) → applySort(matcher:258)
       → drawShop(:1031) / drawDish(:1084) / onViewAll(:1135)
```

---

## 二、本轮将新增的记录（只计划，不执行）

来源：`tools/pilot/batch1_min/`（B 方案最小样板，严格 dry-run `--require-evidence` 0 错误 0 警告）。

| 集合 | `_id` | 名称 | 关键字段 |
|---|---|---|---|
| `restaurants` | `c02` | 三餐 | `area:'campus'`、`building:'第三餐厅'`、`location:'三餐 · 2 楼最西侧'`、`floors:[{id:'c02_f2',label:'2 楼'}]` |
| `stalls` | `c02_t02` | 韩小面 | `restaurantId:'c02'`、`floorId:'c02_f2'`、`side:'west'`、`noStatus:'unverified'` |
| `dishes` | `c02_d060`~`c02_d071` | 12 道 | 见下表 |

| `_id` | 名称 | 价格 | foodType | tastes |
|---|---|---|---|---|
| `c02_d060` | 重庆小面 | 7 | noodle | spicy |
| `c02_d061` | 杂酱面 | 9 | noodle | choice |
| `c02_d062` | 招牌豌杂面 | 11 | noodle | spicy |
| `c02_d063` | 酸菜面 | 8 | noodle | choice |
| `c02_d064` | 牛肉面 | 15 | noodle | choice |
| `c02_d065` | 干拌小面 | 7 | noodle | choice |
| `c02_d066` | 干拌杂酱面 | 9 | noodle | choice |
| `c02_d067` | 干拌豌杂面 | 11 | noodle | choice |
| `c02_d068` | 清汤小面 | 7 | noodle | choice |
| `c02_d069` | 清汤杂酱面 | 9 | noodle | choice |
| `c02_d070` | 清汤豌杂面 | 11 | noodle | choice |
| `c02_d071` | 麻酱凉面 | 8 | noodle | choice |

合计新增 **14 条文档**（1 店 + 1 窗 + 12 菜）+ 1 个楼层内嵌对象。

**证据**：14 条共用 `img/c02_t02_menu.jpg`（同一张照片同时拍到门头招牌与完整价目表，合法覆盖店铺/楼层/窗口/菜品四层），`source_detail` 逐条写明依据。

### 2.4 写入通道的硬约束（本轮只读核对发现，必须先在 S2 解决）

| 编号 | 位置 | 事实 | 影响 |
|---|---|---|---|
| W1 | `cloudfunctions/seed/index.js:60/74/80` | `EXPECTED_RESTAURANTS/STALLS/DISHES` 是**硬编码 8 条** | 不扩这三组常量，一条新记录都写不进去 |
| W2 | `:88-91` | `ID_WHITELIST` 由上面三组**派生** | 扩常量后白名单自动跟随（cleanup 也自动能覆盖新 id） |
| W3 | `:210-221 withMeta(record, batchId)` | 写死 `dataClass:'demo'`、`verifyStatus:'demo'`、`source: DEMO_SOURCE` | **直接扩常量会把 12 道真实菜标成「演示」**——必须给 `withMeta` 增加 meta 参数 |
| W4 | `:477-485` | `actionVerify` 的 summary 断言 `nonDemoCount === 0` 且 `nonNullVerifiedAt === 0`，否则 `ok=false` | 写进真实（unverified）数据后 `verify` 必然失败，需改成「按本批次期望 meta 比对」 |
| W5 | `:471` | `floorsOfS01` 写死 `s01` | 扩数据后该指标失去意义，需泛化或删除 |
| W6 | `:507` | `cleanup` 三重锁含 `dataClass !== 'demo'` 即 `skip-guarded` | 新写入的真实记录**删不掉**；回滚必须另设守卫（batchId + id 白名单） |

---

## 三、是否修改现有记录

**不修改现有 8 条。** 依据：

1. 写入路径只有 `actionWrite`（`:295`），逐条 `add()`；已存在且 `contentHash` 相同 → `skipped`（`:313-315`），不同 → `conflict` 且**不覆盖**（`:317-319`）。代码里没有 `set`/`update`。
2. 新 14 条 `_id` 全在 `c02*` 前缀，与 `s01*`、`d01/d02/d03/d39` 无重叠。
3. 执行后用 `verify` + `contentHash` 比对，证明 8 条一个字节没变。

---

## 四、集合写权限风险

| 风险 | 等级 | 对策 |
|---|---|---|
| 客户端直写 | 低（已封） | 三集合「所有用户可读」；客户端 `add` 已实测 `-502003` |
| 云函数写无上限 | 中 | 保持三条不破：只 `add`、只白名单 `_id`、`doc(_id).remove()` 是唯一删除路径 |
| 权限被误改 | 中 | S1 与 S4 各看一次控制台「数据权限」，绝不改成「所有用户可读写」 |
| demo 与真实混标 | **高** | W3 未修就写，会把真实菜标成 demo；页面横幅/徽标将全部失真 |
| 演示数据长期混在正式集合 | 中 | 4 道 `s01` demo 仍在正式集合；页面必须按记录级 `verifyStatus` 区分 |

---

## 五、备份与回滚方案

### 5.1 备份（执行前必须完成）

1. 控制台 → 数据库 → 每个集合 → 导出 JSON → `C:\Users\25975\Documents\shishen-dev-archive\cloud-before-12\`。
2. 记录 `seed` 只读 `actionPlan` 的输出（`creates`/`identical`/`conflicts`）到本地文本。
3. 记录基线 `count()`：`restaurants 1 / stalls 3 / dishes 4`。

### 5.2 回滚

| 层级 | 手段 | 影响 |
|---|---|---|
| 精确删本次 14 条 | `actionCleanup` + 新批次号（**前提：W6 守卫放宽为 batchId + 白名单**） | 只动 `c02*` |
| 若 W6 未改 | 控制台按 `_id` 逐条删除 14 条（人工，需截图留证） | 只动 `c02*` |
| 整体回退 | 用 5.1 导出文件重灌（控制台「导入」，覆盖式） | 高风险，仅兜底 |
| 代码回退 | 还原 `cloudfunctions/seed/index.js` 并重部旧版（备份 `shishen-dev-archive\seed-before-auth\` 与 `seed-before-12\`） | 不影响数据 |

**不接受**：`dropCollection`、`where().remove()`、无批次记录的手点删除。

---

## 六、各页面验收条件

数据切云后应达到（全部可用现有 `filterDishes` 实算复核，已在本轮算过一次）：

| 场景 | 期望值 | 依据 |
|---|---|---|
| 默认（不限） | **16 道** | 4 demo + 12 样板 |
| 校内食堂 | 16 | 全部 `campus` |
| 校外周边 | 0 | 无校外数据 |
| 预算 ≤10 | 9 | 8 道样板 ¥7/8/9 + `d02` ¥8 |
| 预算 ≤15 | 16 | 最贵 ¥15 |
| 预算 ≤20 | 16 | 同上 |
| 面类 | 12 | 12 道全 `noodle` |
| 米线类 | 1 | `d39` |
| 饭类 | 3 | `d01/d02/d03` |
| 清淡 | 13 | 3 + 10（`choice` 通配） |
| 微辣 | 11 | 1 + 10 |
| 麻辣 | 12 | 2 + 10 |
| 可选辣度 | 10 | 10 道 `choice` |
| 校内 + ≤15 + 面类 | 12 | 交集 |

页面级：默认态 16 道；4 道带「演示信息」、12 道带「待核实」；随机选一家从 2 店抽；`c02` 的菜显示「韩小面 / 2 楼 / 三餐 · 2 楼最西侧」；查看全部 16 道（`c02_d0xx` 未进 `LOCAL_DISH_ORDER` → 落字典序末尾）；升序首项 ¥7、降序首项 ¥15（牛肉面）；加载/失败态可重试且**不得静默回退本地**；横幅**不得**再说「演示数据 · 不对应任何真实商家」（`index.wxml:34` 现在只看 `dataSource`，是已知缺口 M6）。

---

## 七、失败时如何恢复

| 失败点 | 表现 | 恢复 |
|---|---|---|
| 扩常量/改 `withMeta` 后部署失败 | 线上仍跑旧版 | `download` 取回线上源码比对；旧版备份可直接重部 |
| 写入中途超时（10s） | 部分写入，`failed`/`notAttempted` 有记录 | `verify` 查差异 → 按 §5.2 删已写部分 → 重跑 |
| 写入成功但 `verify` 报差异 | `diffs` 非空 | 先看差异字段（`contentHash`/`dataClass`/`price`），记录后回滚 |
| 真实菜被标成 demo | 徽标显示「演示信息」 | 立即停手，回滚 14 条，修 W3 后重来 |
| `cleanup` 删不掉新记录 | 全部 `skip-guarded` | 按 §5.2 第二行走控制台人工删除 |
| 首页切云后数字不符 | 与 §6 表格不一致 | 停止切换（页面改动最后做，可整体回退），用 `loadCloudDataset` 在真实数据复算 |
| 顺序表未收录 | `c02_d0xx` 落字典序 | 补 `LOCAL_DISH_ORDER`，或接受并写入文档 |

---

## 八、执行顺序（每一步都需单独授权）

| 步骤 | 内容 | 需授权 |
|---|---|---|
| S1 | 控制台导出三集合备份 + 复核权限档位 | 是（人工） |
| S2 | 改 `cloudfunctions/seed/index.js`：扩 `EXPECTED_*` 到 22 条、`withMeta` 加 meta 参数（真实记录写 `dataClass:'real'`/`verifyStatus:'unverified'`/`verifiedAt:null`/`source:{kind:'field',…}`）、`actionVerify` 按期望 meta 比对、`floorsOfS01` 泛化、`cleanup` 守卫改为 batchId+白名单；补测试后部署 | 是 |
| S3 | 调 `plan`（应显示 14 creates / 8 identical）→ `write`（批次号如 `seed-c02-20261024`） | 是 |
| S4 | 调 `verify`（16 条、0 差异）→ `count()` 复核 2/4/16 → 再调一次 `write` 验幂等（14 skipped） | 是 |
| S5 | 改首页：`loadRawDataset()` 接 `loadCloudDataset`，加 `dataSource='cloud'`、横幅按记录级 `verifyStatus` 分支、超时与在途治理沿用现有 `beginLoad` | 是（本轮禁止） |
| S6 | 按 §6 逐项验收，失败按 §7 恢复 | 是 |

---

## 九、未决问题（需裁决）

1. **W3 的 meta 写法**：`withMeta` 加参数，还是为新记录单独建 `REAL_*` 常量组？（倾向后者更易读，但要防两套代码漂移）
2. **`dataClass` 取值**：真实未核实用 `'real'` 还是沿用 `'demo'`+`verifyStatus='unverified'`？（`dataClass` 目前只有 `demo` 一个取值，属新枚举，需定名）
3. **顺序表**：`LOCAL_DISH_ORDER` 是否补 `c02_d060~c02_d071`？
4. **横幅口径 M6**：是否在 S5 一并修？
5. **4 道 demo 菜**：真实数据进来后隐藏还是保留作对照？
6. **批次号**：新 14 条用独立批次号（便于精确回滚），是否同意？

---

## 十、S2 之后的当前状态（2026-10-22 补充；§一–§九 保持改造前原样记录）

> 本节由 S2 实现后的只读安全审查追加。**S2 的代码已在本地产出并跑过 13 套测试，但没有部署、没有调用线上云函数、没有写过云数据库、没有执行过真实批次回滚。**

### 10.1 W1–W6 的解决情况

| 编号 | 状态 | 现在的实现 | 证据 |
|---|---|---|---|
| W1 | 已解决 | demo 的 `EXPECTED_*` 一条没动；真实批次改用独立的 `PILOT_RESTAURANTS`/`PILOT_STALLS`/`PILOT_DISHES` | `cloudfunctions/seed/index.js:130`、`:143`、`:147`；`DATASETS` + `datasetFor()` `:350` |
| W2 | 已解决 | `ID_WHITELIST` 仍是 demo 派生；真实批次用独立 `PILOT_WHITELIST` | `:163` |
| W3 | 已解决 | `withMeta(record, batchId, meta)` 增加第三参，缺省仍走 `demoMeta()`；真实批次走 `pilotMeta()` | `:310`、`:287`、`:296`；`test_seed_pilot` A 组 22 条证明 demo 行为未变 |
| W4 | 已解决 | `actionVerify(batchId, report)` 参数化，按 `ds.meta()` 比对，硬编码的 `nonDemoCount` 换成 `offClassCount`，summary 增 `dataset`/`expectedDataClass`/`floorsByShop` | `:494` |
| W5 | 已解决 | `floorsOfS01` 换成按店铺聚合的 `floorsByShop` | `:494` 起的 summary 构造 |
| W6 | 部分解决（有意如此） | `actionCleanup` 仍**只删 demo**（`:659`，`skip-guarded` 一行未改）；真实批次走新的 `rollbackPlan`/`rollback` + 六道前置检查 | `:751`、`:832`、`:849` |

### 10.2 §九 六个未决问题的裁决结果

| 问题 | 裁决 |
|---|---|
| W3 的 meta 写法 | 用 `withMeta` 第三参，不建 `REAL_*` 重复常量组（避免两套代码漂移） |
| `dataClass` 取值 | 真实未核实用 `'field_unverified'`（与 `'demo'` 并列的新枚举值），`verifyStatus` 仍 `unverified`、`verifiedAt` 恒 `null` |
| 顺序表 | 本轮**不改** `LOCAL_DISH_ORDER`（等首页接云时一并处理） |
| 横幅口径 M6 | 推迟到 S5，本轮不改页面 |
| 4 道 demo 菜 | 保留作对照，本轮只设计过滤条件 |
| 批次号 | `pilot_c02_batch1_20261022`（`PILOT_BATCH_ID`），格式由 `PILOT_BATCH_RE` 约束 |

### 10.3 本地测试能证明什么、不能证明什么

**能证明**：demo 五动作行为未变；真实批次只能写 `PILOT_WHITELIST` 内 14 条；元数据落在 `field_unverified`/`unverified`/`null`；`cleanup` 不删真实记录；`rollback` 在六类冲突（改价、换批次、改分类、补关联、缺记录、多记录）下拒绝删除；删除顺序为菜品→窗口→店铺；删后按 ID 逐条读回核验；废弃批次号被拒；闸门仍在 action 分发之前。

**不能证明**：线上数据库的真实字段形态与索引行为、集合权限、超时行为（云函数 timeout 10s）、并发写入下的实际时序、`remove()` 在真实环境对「不存在的文档」的返回值语义。

### 10.4 本次审查新发现（尚未修复，需裁决）

| 编号 | 问题 | 位置 | 建议 |
|---|---|---|---|
| N1 | `PILOT_DISHES` 与 `tools/pilot/batch1_min/dishes.csv` **8/12 条不一致**：`c02_d060`–`d067` 少了「（素）」/「（荤）」后缀；`c02_d062` CSV=`choice` 而 SEED=`spicy`，`c02_d065` CSV=`spicy` 而 SEED=`choice` | `cloudfunctions/seed/index.js:147` 起 | 以 CSV 为准重新对齐 `PILOT_DISHES`（CSV 已通过严格 dry-run），并对齐后补一条「SEED 常量 == CSV」的比对断言 |
| N2 | 回滚**无事务**（SDK 2.6.3 有 `startTransaction`/`runTransaction`，本实现未使用），前置检查与逐条删除之间存在 TOCTOU 窗口 | `:858` 与 `:866-882` | 要么用事务包住 14 条删除，要么在文档里明确「非原子、检查不代表锁定」并在每条删除前重新比对 `contentHash` |
| N3 | 部分失败**不可续**：删除循环遇错不中断、继续删下一条；但一旦有记录已删，再跑 `rollback` 会因 `missing≠0` 被前置检查永久拒绝 | `:877-880`、`:751-830` | 增加「允许在可证明范围内继续」的分支，或改用「逐条状态机 + 断点续删」，同时保留人工兜底说明 |
| N4 | `remove()` 的返回值被忽略，并发/重复调用下可能把未真正删除的 id 计入 `deleted` | `:874` | 检查 `stats.removed`，为 0 时记 `already-absent` 而不是 `removed` |
| N5 | `source.detail` 口径不同：CSV 是逐条现场描述，SEED 是统一说明句 | `:296` `pilotMeta()` | 若要求「云端与本地同源」，改由同一份数据生成；否则接受差异并在文档标注 |

### 10.5 仍然没有做的事

未部署 `seed`；未调用 `plan`/`write`/`verify`/`rollback`/`cleanup`；未读写云数据库；未改集合权限；未导入 12 道样板菜；未改 `data/`、`pages/`、`utils/`；未执行任何 Git 写操作。

### 10.6 进入下一次执行（S3）的前置条件

1. N1 必须先修：常量与 CSV 不一致会让「写入的」和「本地验收基准」不是同一份数据。
2. 需裁决是否引入事务，或接受「非原子 + 逐条复核」的弱保证并在文档写明边界。
3. 需裁决 N3 的续删策略（否则一次失败之后只能靠控制台手工清理）。
4. 执行前仍要完成 S1 的备份与权限复核（本文 §五 5.1）。

---

## 十一、S2.1 本地安全修复记录（2026-10-22；只改本地代码，未部署、未碰云端）

裁决来自 §10.6 的四个前置条件：N1 必须修、N2 先评估事务不盲目套、N3 必须改进恢复方案、N4 一并修、N5 必须统一口径；且**不得为方便回滚而降低误删保护**。

### 11.1 N1：云端批次常量改为由采集 CSV 生成

- 新增 `tools/pilot/build_pilot_dataset.js`：RFC4180 解析 `tools/pilot/batch1_min/*.csv`，跳过 `ex_` 示例行，生成带 `source` 与 `__row` 的记录，并做关联/枚举/价格/口味校验；`--write` 才输出文件，否则只打印。
- 新生成 `cloudfunctions/seed/pilot-data.js`（262 行 / 6,030 字节），`seed` 用它取代原先手写的 `PILOT_*` 常量；`__row` 在载入时由 `withoutSheetRef()` 剥离，不下发到云端文档。
- 纪律：**改数据只改 CSV 再重新生成，禁止直接编辑 `pilot-data.js`**（文件头已写）。
- 现状差异归零：12/12 道菜的名称（含「（素）/（荤）」）、价格、口味、类型与 CSV 完全一致（原 8/12 不一致，其中 d062 与 d065 的口味是互换的）。

### 11.2 N5：`source` 逐条跟着记录走

`pilotMeta(record)` 改为按记录自己的 `source` 生成元数据；`FIELD_SOURCE` 仅作兜底。同一批数据现在只有一个来源口径，`contentHash` 与本地验收基准因此一致。

### 11.3 N2：事务评估结论 —— 能力存在，但本轮不引入，明确降级保证

- 事实：`seed` 全文 0 处事务调用；离线 SDK `wx-server-sdk@2.6.3` 确有 `db.runTransaction` / `db.startTransaction` 与 `Transaction.collection()`。
- 判断：**无法在离线环境验证**事务对「跨 3 个集合、14 条记录、逐条 `doc(id).remove()`」的实际支持与回滚语义；在不能验证的前提下套事务，等于用一个未经验证的保证替换一个已知的弱保证。
- 结论：本轮不引入事务，改为在文件头**如实写出降级保证**（见 11.5），并把「能否事务化」留给 S3 前用真实环境验证。

### 11.4 N3 / N4：可续做、可区分、不虚报

- 缺席不再阻断：`pilotRollbackCheck` 把「已不存在」记入 `absent`，只有「存在但被改过/批次不符/数据类不符/有额外关联」才进 `blockers` 并整批拒绝。
- 可续做：一次中断后再执行 `rollback` 会继续删剩余记录；全部不存在时返回 `noop:true` 与「没有可删除的记录：本批次 N 条已经全部不存在（可能已经回滚过）」。
- 逐条前置复核：删除循环内对每条记录**重新读回并比对**（`driftReasons()`：batchId / dataClass / verifyStatus / verifiedAt / contentHash 重算），发现漂移立即停止该条并整体 `ok=false`。
- `remove()` 返回值不再忽略：返回 0 记 `alreadyAbsent` / `already-absent`，只有确实删除才进 `deleted` / `removed`；报告新增 `absent` / `alreadyAbsent` / `blockedNow` / `noop` 四个字段。

### 11.5 新的回滚保证边界（写入代码文件头，避免后人误读）

保证：

1. 删除前逐条复核，任何一条与期望不一致即停止。
2. 子先父后（菜品 → 窗口 → 店铺）。
3. 删除后重新核验，把「本该删掉却还在」的记录报出来。
4. `already-absent` 不计入 `deleted`（不虚报）。

不保证：

1. 原子性；2. 检查与删除之间的并发窗口（TOCTOU）仍然存在；3. 已删记录不可恢复（但可再次执行 `rollback` 续删剩余）。

### 11.6 改动文件与测试

| 文件 | 变化 |
|---|---|
| `tools/pilot/build_pilot_dataset.js` | 新增（CSV → 云端常量的唯一通道） |
| `cloudfunctions/seed/pilot-data.js` | 新增（生成产物，勿手改） |
| `cloudfunctions/seed/index.js` | 常量改由 `pilot-data.js` 提供；`pilotMeta` 逐条取 source；新增 `driftReasons`；`pilotRollbackCheck` 分离 absent/blockers；`actionRollback` 逐条复核 + 区分 already-absent；`actionVerify` 逐条比 meta；文件头补安全保证段 |
| `tools/test_seed_s21.js` | 新增（33 项：N1/N2/N3/N4/N5 逐条锁） |
| `tools/test_seed_pilot.js` | 断言按新契约更新（noop / absent / 续删） |
| `tools/test_seed_auth.js`、`tools/verify_seed.js` | 假 `require` 支持相对路径解析（`./pilot-data`） |

测试（全部 exit 0）：`test_seed_s21` 33/0、`test_seed_pilot` 113/0、`test_seed_auth` 52/0、`verify_seed` 85/0、`test_import_data` 217/0、`test_verify_data` 122/0、`verify_data` 0 错误、`regression` 122/0/跳 3、`verify_stage2` 76/0、`verify_provenance` 116/0、`verify_multiselect` 168/0、`test_index_state` 203/0、`test_pages` 106/0、`test_cloudrepo` 102/0。

### 11.7 本轮仍然没有做的事

未部署 `seed`；未调用任何线上 action；未读写云数据库；未改集合权限；未导入任何真实数据；未改 `data/`、`pages/`、`utils/`；未执行 Git 写操作。
