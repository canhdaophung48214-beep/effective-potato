# 食神寻味 · 加速推进准备度报告（2026-10-26）

> 只读审计 + 补丁草案。本轮未应用任何代码/CSV/映射/配置修改，未连接云端，未执行 Git 写操作。
> 新增文件仅此一份：`docs/ACCELERATION_READINESS_20261026.md`。

## 1. 执行摘要

**一句话**：阻碍首批真实数据准入的不是代码能力，而是三件事——**c02 命名空间没有批准记录**、**楼层/辣度等字段缺证据**、**导入链路与投稿链路之间没有一致性校验**。这三件都能用「文档 + 只读校验器 + 补拍」解决，不需要重编号、不需要改云端。

**四个阻塞点的结论**：

| 阻塞点 | 现状 | 结论 | 最省力的解法 |
|---|---|---|---|
| A ID 命名空间 | 冻结映射 104 条全 `c01`；pilot 用 `c02` 且不在映射；`batch1` 草稿 `c02_d040–d074` 与 pilot `d060–d071` 重叠 12 条 | **冲突真实存在，但不撞号**（不同 shopId 允许同后缀）。pilot 的 12 条形状完全合规 | 新增一份 `c02` 试点命名空间批准记录 + 冻结 `batch1` 待重编；**不重编号、不往 id-map 塞候选** |
| B 证据真实性 | 照片能证明店招、12 条菜名、12 个价格、采集日期；**不能**证明楼层、位置、餐厅名、辣度、方位 | 12 条里 **价格 12/12 支持、菜名 9/12 精确支持、辣度 0/12 支持**；楼层来源描述与照片**矛盾** | 改 3 处来源描述（不需补拍）+ 补拍 4 类（餐厅名/楼层/方位/辣度） |
| C 导入与投稿校验 | 导入器不校验 `c\d{2}` 形状、默认不强制证据；投稿按 `dataClass` 判断且形状校验先于查库；注释与实际顺序不符 | 「导入通过 ≠ 能投稿」是**结构性缺口**，不只是配置问题 | 新增一个 opt-in 形状校验开关 + 修注释 + 补 3 条测试；不改默认行为 |
| D 云端试点放行 | 本地 7 个套件全绿；seed 有 write/verify/rollback；但**线上 seed 版本无法证实**，rollback 修复「未再部署」，无写入前快照，普通用户 403 未实测 | 可以放行，但必须**先证实线上版本**并接受「无快照、靠六项校验回滚」的残余风险 | 用 `plan` 预演 + 写后 `verify` + 保留 rollback 窗口；先在体验版补 A1 |

## 2. 任务 A：ID 命名空间

### A1. 三个问题的直接回答

**问题 1：`c02`、`c02_t02`、`c02_d060–c02_d071` 是否与冻结映射、`batch1`、现有契约冲突？**

| 对象 | 与冻结映射 | 与 `batch1` | 与契约 |
|---|---|---|---|
| `c02`（三餐） | **不冲突**：`id-map.json` 104 条全 `c01`，无 `c02` | `batch1` 无 `c02` 店铺行 | 契约未把 `c02` 列入正式 2F/3F 编号表 |
| `c02_t02`（韩小面） | 不冲突（映射只有 `c01_t48/t49`） | `batch1` 无同名档口 | 同上 |
| `c02_d060–d071`（12 菜） | 不冲突（映射菜品 `c01_d437–d540`） | **冲突**：`batch1` 草稿另有 `c02_d040–d074`，与 `d060–d071` **重叠 12 条** | 契约 `:487` 把 pilot 的这 12 个 ID 列为「正式数据永不重编」；`:488` 又把 batch1 的 `c02_d040–d074` 列为「未导入旧草稿、待单独批准重编」——**文档内部不自洽** |

**问题 2：哪些已登记、哪些是候选、哪些重叠？**

- **已正式登记（批准映射）**：`c01` 命名空间 104 条（`c01_t48`/`c01_t49` 两档口，菜品 `c01_d437`–`c01_d540`），`approvalRef=ap-20261025-01`，全部 `active`。
- **契约冻结但未进映射**：`data/dishes.js` 的 `d01–d45`、`pilot-data.js` 的 `c02_d060–c02_d071`（`:487` 声明永不重编）。
- **候选/草稿**：`batch1/` 全量（`c01_d001–d039`、`c02_d040–d074`、`c03_d075–d082`，82 条）+ `batch1_min`（本次 12 条，与 pilot 同源）。
- **重叠**：`batch1` 的 `c02_d060–d071`（12 条）与 pilot 完全重叠；`batch1` 的 `c01_t01–t03` 与冻结映射东①–③重叠（契约 `:419` 已记录）。

**问题 3：最少改动怎么解决？**

不重编号、不改映射、不碰 pilot 的 12 个 ID（契约已声明不重编）。最小动作两件：

1. **给 `c02` 补一份「试点命名空间批准记录」**（新文件，例如 `tools/pilot/approvals/ap-20261026-01.json`），内容是：
   ```json
   {
     "approvalRef": "ap-20261026-01",
     "namespace": "c02",
     "batchId": "pilot_c02_batch1_20261022",
     "ids": ["c02", "c02_f2", "c02_t02",
             "c02_d060","c02_d061","c02_d062","c02_d063","c02_d064","c02_d065",
             "c02_d066","c02_d067","c02_d068","c02_d069","c02_d070","c02_d071"],
     "dataClass": "field_unverified",
     "scope": "single-stall pilot, 并非正式数据集",
     "digest": "<对清单排序后的 sha256>"
   }
   ```
   它**不替代 id-map**：id-map 是离线 2F/3F 映射；这份是「试点批次准入」。两者由同一个校验器交叉检查。
2. **冻结 `batch1`**：在契约里把 batch1 的 `c02_d040–d074` 标记为「与 pilot 重叠、禁止导入」，重编阶段再分配（契约已有该状态，只需补一条显式重叠记录）。

**问题 4：可审计的 ID 登记流程**

```
① 唯一性预检（只读脚本）
   - 形状：/^c\d{2}$/、/^c\d{2}_t\d{2}$/、/^c\d{2}_d\d{3}$/
   - 跨注册表唯一：id-map ∪ 试点批准 ∪ 待导入批次，ID 不得重复
   - 区间不重叠：同命名空间的 dish 区间不得相交
   - 引用完整：dish.shopId/stallId 必须存在且归属一致
② 审批（负责人）
   - 生成 approval 记录：approvalRef + ids + digest + 批次号 + 范围
   - digest 覆盖「排序后的 ID 清单」，任何增删都会改 digest
③ 导入/写入（执行方）
   - 只允许写 approval 记录里列出的 ID；写前 plan 预演
④ 写后验证
   - verify：条数、关联计数、contentHash、dataClass/verifyStatus/source
⑤ 回滚窗口
   - rollback 前六项校验；不匹配即整批不动
```

## 3. 任务 B：字段证据矩阵

**唯一证据**：`tools/pilot/batch1_min/img/c02_t02_menu.jpg`（1,864×2,249，603,818 B）。画面内容：门头「韩小面」+「重庆风味」小牌；价目表「韩小面价格表」四栏（汤面/拌面/清汤/小吃）+ 店长提醒；相机水印 `2026.10.22 18:00 · 山东省淄博市张店区`。

| 字段 | 记录值 | 判定 | 依据 |
|---|---|---|---|
| 档口名 | 韩小面 | **SUPPORTED** | 门头招牌 |
| 菜品名（9 条） | 重庆小面（素）等 | **SUPPORTED** | 价目表逐条可对 |
| 菜品名（清汤 3 条） | 清汤小面 / 杂酱面 / 豌杂面 | **CONFLICT** | 照片为「清汤小面（可拼）」等，记录丢了「（可拼）」 |
| 价格 | 7/9/11/8/15/7/9/11/7/9/11/8 | **SUPPORTED**（12/12） | 价目表逐格可对 |
| foodType | noodle | **SUPPORTED** | 四栏全是面类 |
| 采集日期 | 2026-10-22 | **SUPPORTED** | 相机水印 |
| 采集城市 | 山东省淄博市张店区 | **SUPPORTED** | 相机水印（仅到城市） |
| 餐厅名 | 三餐 / 第三餐厅 | **UNSUPPORTED** | 照片只有店招，无「三餐」标识 |
| 楼层 | `c02_f2`「2 楼」 | **CONFLICT + NEEDS_RECAPTURE** | 来源描述称「照片可见第二层」，照片无楼层信息；画面更像临街/一层店面 |
| 档口位置 | 三餐·2 楼最西侧 | **UNSUPPORTED** | 照片无方位参照 |
| 档口方位 | `west` | **UNSUPPORTED** | 无证据 |
| 辣度/口味强度 | `spicy`（2 条）/`choice`（10 条） | **UNSUPPORTED** | 价目表无辣度标识；「重庆小面」字样不能推断辣度等级 |
| 可拼选项 | 未记录 | **UNSUPPORTED**（字段缺失） | 照片明确有「（可拼）」，记录未落 |
| area（校内） | campus | **UNSUPPORTED** | 照片不能证明校内外 |

### 最小纠错清单

**① 不需补证据即可保留**：档口名、9 条菜名、12 条价格、foodType、采集日期、采集城市、record_type、ID 形状（本地已核）。

**② 只需调整来源描述**（改 CSV 文字后重新生成 `pilot-data.js`，不补拍）：
- `shops.csv` / `floors.csv` 的「楼层依据：窗口门头照可见…第二层」→ 改为「楼层未核实，待补拍楼层指引/楼层牌」；
- `shops.csv` 的「三餐 · 2 楼最西侧」→ 保留为「候选位置」，来源描述注明「位置未核实」；
- 档口 `side=west` 若无证据 → 置空或保持 `unverified`，不要写 `west`。

**③ 必须重新采集**：
- 含餐厅名的门头照（证明「三餐/第三餐厅」）；
- 楼层指引牌或楼层全景（证明「2 楼」）；
- 档口两侧照片（证明「最西侧」及方位）；
- 辣度标识（价目表若无辣度，需向店长确认并记录，不能从菜名推断）。

**④ 暂时保持未知**：楼层/位置的精确值、辣度等级、可拼在数据模型中的落点（需先决定字段是否保留）。

## 4. 任务 C：导入与投稿校验

### C1. 会「导入通过但投稿打不中」的结构性缺口

| # | 缺口 | 证据 | 后果 |
|---|---|---|---|
| C1-1 | 导入器/验证器**都不校验** `c\d{2}` 形状 | `tools/import_data.js` 全文无该正则；`tools/verify_data.js` 规则表 S1/D1 只要求非空字符串 | 任意 ID 都能过导入；本轮 12 条是「碰巧合规」 |
| C1-2 | 导入产物只带 `verifyStatus`，**不带 `dataClass`** | `import_data.js:300-308`；本地数据 grep `dataClass` = 0 | 导入成功不代表云端文档是 `field_unverified`；投稿判的是 `dataClass` |
| C1-3 | 导入默认**不强制证据** | `import_data.js:1033` `requireEvidence: false` | 「资料看似有来源」但可能 `source.detail` 为空 |
| C1-4 | `verifyStatus` 与 `dataClass` **无配对断言** | `submit/index.js:438-441` 只看 `dataClass` | 理论上一份 `dataClass=field_unverified` + `verifyStatus=verified` 的文档能过目标校验 |
| C1-5 | 注释与实际执行顺序不符 | `submit/index.js:76-77` 称 demo 会被 `TARGET_NOT_FOUND`/`TARGET_IS_DEMO` 挡；实际 `:371-379` 先返回 `INVALID_FIELD` | 读者会误判云端行为；C2-A 已实测两次 |
| C1-6 | `TARGET_IS_DEMO` 在云端**不可达** | 云端 demo 文档 `_id=d01`，形状非法 → 先 `INVALID_FIELD` | 该分支只有本地假 DB 证据 |
| C1-7 | seed 写入时只校验菜品 `source_detail` | `build_pilot_dataset.js:157` 只查 dishes；shops/stalls 只查枚举 | 店铺/档口可能带着空 detail 进云端 |

### C2. 最小补丁草案（**不应用**）

**P1 `tools/import_data.js`：新增 opt-in 形状校验**
```js
const SUBMIT_ID_RE = Object.freeze({
  shopId:  /^c\d{2}$/,
  stallId: /^c\d{2}_t\d{2}$/,
  dishId:  /^c\d{2}_d\d{3}$/
});
function checkSubmitIds(tables, opts) {
  if (!opts.checkSubmitIds) return [];
  const errs = [];
  tables.shops.forEach(r => { if (!SUBMIT_ID_RE.shopId.test(r.id)) errs.push('店铺 ID 形状不合投稿约束：' + r.id); });
  tables.stalls.forEach(r => { if (!SUBMIT_ID_RE.stallId.test(r.id)) errs.push('档口 ID 形状不合投稿约束：' + r.id); });
  tables.dishes.forEach(r => { if (!SUBMIT_ID_RE.dishId.test(r.id)) errs.push('菜品 ID 形状不合投稿约束：' + r.id); });
  return errs;
}
// 用法：node tools/import_data.js --dir <CSV> --check-submit-ids
```
默认关闭，保证「给已有演示店补菜」的旧用法不变。

**P2 `cloudfunctions/submit/index.js:76-77`：修注释**（一行级）
```js
/* 目标 ID 形状：真实批次（c02 / c02_t02 / c02_d060）。
   形状不符在 validateBody 阶段即返回 INVALID_FIELD（见 :371-379），不会进入 resolveTarget；
   因此演示数据（s01 / d01）在云端得到的是 INVALID_FIELD，而不是 TARGET_IS_DEMO。 */
```

**P3 `cloudfunctions/submit/index.js`：目标可信度配对（可选加固）**
```js
if (dish.dataClass === 'field_unverified' && dish.verifyStatus !== 'unverified') {
  return { ok: false, code: 'TARGET_NOT_VERIFIABLE', httpStatus: 422 };
}
```
（档口分支同理；只在负责人同意后启用。）

**P4 `cloudfunctions/seed/index.js` + `build_pilot_dataset.js`：空证据拦截**
在 `build_pilot_dataset` 的 shops/stalls 校验里补 `if (!row.source.detail) errors.push(...)`；`seed` 写入前再拒一次。

**P5 新增只读校验器 `tools/check_id_admission.js`（草案，本轮不创建）**
```
node tools/check_id_admission.js --csv tools/pilot/batch1_min
→ 校验：形状 / 跨注册表唯一 / 区间不重叠 / 引用完整 / 与 pilot-data 一致
→ 退出码 0 通过、1 有冲突、2 用法错误
```

**需要新增的测试用例**
1. `test_import_data`：`s01` 店铺、`c02_t2` 档口、`c02_d60` 菜品，在 `--check-submit-ids` 下被拒（3 条）。
2. `test_import_data`：不加开关时旧行为不变（1 条）。
3. `test_ugc_submit`：`dataClass=field_unverified` + `verifyStatus=verified` → `TARGET_NOT_VERIFIABLE`（P3 启用后）。
4. `test_seed_pilot`：shops/stalls 的 `source_detail` 为空 → 整批拒绝（P4）。
5. `test_ugc_submit`：断言「形状不符一定先于 resolvTarget」——静态断言 `:371-379` 在 `:512` 之前（防止顺序被改回去）。

## 5. 任务 D：云端试点放行清单

| # | 检查项 | 结论 | 证据/限制 |
|---|---|---|---|
| D-1 | 线上 seed 代码版本已证实？ | **UNKNOWN** | 2026-10-23 的 `docs/COLLECTION_STATUS_REPORT_20261023.md:50` 记「字节级核对一致」；但同文 `:181` 记 S2.1 回滚修复「未再部署」。**没有本轮证据**能证明现在线上是哪一版 |
| D-2 | 写入前有快照/备份？ | **无** | `actionWrite`（`seed/index.js:440-480`）只做「不存在才 add、相同就跳过、不同就记冲突不覆盖」，**不导出旧数据**。`actionPlan` 是只读预演，不是快照 |
| D-3 | 能准确区分本批写入？ | **能，有条件** | `batchId=pilot_c02_batch1_20261022` + `dataClass=field_unverified` + 15 个白名单 ID + `contentHash`；前提是线上版本含这些字段 |
| D-4 | 写后能验条数/关联/哈希/权限？ | **部分** | `actionVerify` 校验条数、关联计数、`contentHash`、元数据漂移（`seed/index.js:535-560` 等）；**权限不在 seed 校验内**，需另做客户端直读测试（C2-A 已对 submissions/upload_logs 做过，业务集合未做） |
| D-5 | 回滚会误删其他批次/真实数据？ | **风险受控但不为零** | `driftReasons` 六项（batchId/dataClass/verifyStatus/verifiedAt/contentHash/额外关联）+ 白名单 + 子先父后；缺快照意味着「误判后无法恢复」 |
| D-6 | 有普通非管理员身份测试？ | **缺** | C2-A 的 A1 未执行（需第二个微信号登录体验版）。若线上 seed 版本较旧，`ADMIN_OPENIDS` 闸门行为也可能不同 |
| D-7 | 集合权限现状 | **UNKNOWN（业务集合）** | `docs/COLLECTION_STATUS_REPORT_20261023.md:51` 记三业务集合「所有用户可读」；pilot 写入后这些数据**对所有客户端可读**（dishes 本就公开，但 restaurants/stalls 同样可读） |

**放行条件（任一不满足就不放行）**：
1. 用控制台/开发者工具确认线上 `seed` 版本号或重新部署当前 HEAD（需单独授权部署）；
2. 先跑 `seed {action:'plan', batchId:'pilot_c02_batch1_20261022'}`，确认 `creates=15 / conflicts=0 / identical=0`；
3. 记录写入前的控制台条数截图（restaurants/stalls/dishes），作为人工快照；
4. 写入后立刻 `verify`，并保留 `rollback` 窗口；
5. 补 A1（普通用户调 `review.session` 期望 403）。

## 6. 下一步任务（按依赖排序）

| 序 | 任务 | 依赖 | 可并行 | 谁做 |
|---|---|---|---|---|
| 1 | 改 3 处来源描述（楼层/位置措辞），重新生成 `pilot-data.js` | 无 | 与 2 并行 | DS（需**修改授权**） |
| 2 | 补拍餐厅名门头、楼层指引、档口两侧、辣度确认 | 无 | 与 1 并行 | 负责人 |
| 3 | 出 `c02` 试点命名空间批准记录（含 digest） | 1、2 完成后才有意义 | 否 | 负责人 |
| 4 | 实现 P1/P2/P4 + 5 条测试 | 1 | 与 3 并行 | DS（需**应用补丁授权**） |
| 5 | 新增 `check_id_admission` 只读校验器 | 3 的 schema | 与 3 并行 | DS |
| 6 | 确认线上 seed 版本（或重新部署） | 3 | 否 | 负责人 |
| 7 | 体验版补 A1（普通用户 403） | 无 | 与 2 并行 | 负责人 + 第二微信号 |
| 8 | `seed plan` 预演 + 写入 + `verify` | 3、4、6 | 否 | 共同，**需云端写入单独授权** |
| 9 | 写后 24h 内 `rollback` 或确认保留 | 8 | 否 | 共同 |

## 7. 证据来源、命令与限制

**本轮实际执行的命令（全部只读，记录真实退出码）**：

| 命令 | 结果 |
|---|---|
| `node tools/verify_data.js` | exit 0，12 店铺/7 楼层/24 窗口/45 菜品，0 错误 |
| `node tools/test_import_data.js` | exit 0，「✅ 全部通过」 |
| `node tools/test_seed_pilot.js` | exit 0，失败 0，「全部通过」 |
| `node tools/test_seed_s21.js` | exit 0，失败 0，「全部通过」 |
| `node tools/verify_seed.js` | exit 0，失败 0，「全部通过」 |
| `node tools/test_ugc_submit.js` | exit 0，PASS 91 / FAIL 0（本地模拟） |
| `node tools/test_ugc_review.js` | exit 0，PASS 84 / FAIL 0（本地模拟） |
| `node tools/import_data.js --dir tools/pilot/batch1_min` | exit 0，新增校验 0 错误/0 警告（dry-run） |
| `node tools/import_data.js --dir tools/pilot/batch1_min --require-evidence` | exit 0，同样 0/0（严格证据模式） |

**结论的证据等级**：
- ID 现状、映射内容、区间重叠：**LOCAL-DATA**（`id-map.json`、`batch1/dishes.csv`、`pilot-data.js` 实测）。
- 契约条款、历史冲突记录：**LOCAL-DOC**（`RECORD_GENERATOR_CONTRACT_20261023.md:419/487/488/1068`）。
- 校验器/投稿行为：**LOCAL-CODE + LOCAL-TEST**（源码行号 + 假 DB 测试）。
- 字段真实性：**LOCAL-DATA**（照片逐项比对）。
- 云端版本、集合权限、写入后状态：**UNKNOWN / NOT-VERIFIED**（本轮禁止云端调用）。

**限制**：①无法确认线上 seed 版本；②无写入前快照；③A1 未执行；④照片为单张，不能证明楼层/方位；⑤「辣度」在数据模型里是必填枚举，当前无证据，只能补采集或改口径。

## 8. 本轮未执行的操作

- 未应用任何代码补丁（P1–P5 全部只是草案文本）。
- 未修改任何 CSV、照片、ID、状态、映射、契约、配置、源码、测试。
- 未创建 `tools/check_id_admission.js`、未生成任何 approval 记录。
- 未调用云函数、未连接云数据库、未部署、未改权限/索引/环境变量。
- 未生成 `records.json` / `records_blockers.json` / `gen-manifest.json`。
- 未执行任何 Git 写操作；未删除或覆盖任何已有文件。

## 9. 决策表

| 事项 | 只需审批 | 需补采集证据 | 可立刻进入下一阶段 | 必须另行授权 |
|---|---|---|---|---|
| `c02` 试点命名空间批准记录 | ✅ | | | |
| 楼层/位置来源描述改为「未核实」 | ✅ | | | |
| 餐厅名门头、楼层牌、档口方位、辣度 | | ✅ | | |
| 清汤三款「（可拼）」口径 | ✅ | | | |
| 冻结 `batch1`（禁止导入） | ✅ | | | |
| P1/P2/P4 补丁 + 5 条测试 | ✅ | | | |
| `check_id_admission.js` 只读校验器 | ✅ | | | |
| 本地测试与文档更新 | | | ✅ | |
| 体验版 A1（普通用户 403） | | | ✅（需第二微信号） | |
| 确认/重部署线上 seed | ✅ | | | ✅（部署） |
| `seed plan` 预演 | | | | ✅（云函数调用） |
| `seed write` 写入 15 条 | | | | ✅（云端写入） |
| `seed rollback` | | | | ✅（云端删除） |
