# 加速执行报告：P1/P2/P4 最小补丁 + ID 准入校验器

- 生成日期：2026-10-26
- 依据：`docs/ACCELERATION_READINESS_20261026.md`（§4 P1–P5 草案、§6 任务表）
- 授权：2026-10-26 用户指令（只实施 P1/P2/P4、新增 `tools/check_id_admission.js`、加测试、写本报告）
- 性质：**本地改动 + 本地测试**。本轮零云端调用、零部署、零云端写入、零 Git 写操作。

---

## 1. 结论

1. **P1 / P2 / P4 已按草案落地**，均为最小改动，未触碰 CSV、`id-map.json`、冻结文件、正式产物、云函数配置。
2. **新增只读校验器** `tools/check_id_admission.js`：确定性、无写入、退出码 0/1/2 分明；在真实仓库上跑出 **4 条冲突**，全部是"命名空间未批准"，非 ID 撞号。
3. **测试从 4 个文件扩到 6 个套件**：`test_import_data` 243 项、`test_seed_pilot` 123 项、`test_ugc_submit` 99 项、新增 `test_check_id_admission` 37 项，全部 0 失败；既有 `verify_data`、`test_seed_s21`、`verify_seed` 全绿。
4. **未实施 P3**；**"P5"存在编号冲突**（详见 §9），本轮按显式授权创建了校验器，并在此如实标注，未擅自扩大范围。
5. 结论一句话：**导入侧现在能把"能导入但永远无法被投稿命中"的 ID 挡在门外；服务端真实批次现在会因缺证据整批拒写；ID 冲突第一次有了可复跑的只读判定。**

---

## 2. 授权与本轮边界

| 项 | 内容 |
|---|---|
| 允许 | 读报告与源码；实施 P1/P2/P4；新增校验器；加测试；跑本地测试；写本报告；记录改前后哈希 |
| 禁止 | 改 CSV / `tools/pilot/id-map.json` / 冻结文件 / 正式产物 / 云函数配置 / 云端资源；Git 写；删改已有文件；应用 P3/P5；把数据标 verified；补全证据 |
| 实际执行 | 全部符合。未删除、未覆盖任何既有文件；6 个既有文件为**追加/局部替换**式修改 |

---

## 3. 改动清单（改前 → 改后）

| 文件 | 改前 SHA-256（前 16） | 改后 SHA-256（前 16） | 字节 | 行 | 改动性质 |
|---|---|---|---|---|---|
| `tools/import_data.js` | `50a96f870b50fce1` | `0070005bfc1fb607` | 46,172 → 49,293 | 1,269 | 新增 `SUBMIT_ID_RE`、`checkSubmitIds()`、`--check-submit-ids`、main 早退 |
| `tools/pilot/build_pilot_dataset.js` | `d1cd64195ef0ce2b` | `9edca04b45d63995` | 10,341 → 10,720 | 259 | shops/stalls 增加 `source.kind`/`source.detail` 校验 |
| `cloudfunctions/seed/index.js` | `120eb768d6e17b6f` | `f4ee51aa8341c6c8` | 44,350 → 46,312 | 1,126 | 新增 `pilotEvidenceProblems()`；`actionWrite` 整批拒写；`__test__` 导出 |
| `cloudfunctions/submit/index.js` | `d013d7d723761c43` | `cb9d5c2e7b0e7162` | 24,914 → 25,074 | 688 | 仅改注释（`ID_RE` 上方 3 行），无逻辑变更 |
| `tools/test_import_data.js` | `645959734522811c` | `a3efa15d76911eb6` | 46,388 → 51,229 | 1,155 | 新增 B1–B6 共 17 项 |
| `tools/test_seed_pilot.js` | `3479e0213b55d98a` | `7fcbbd742c318fd2` | 23,920 → 26,910 | 602 | 新增 I1–I10 共 10 项 |
| `tools/test_ugc_submit.js` | `6c913de94da347a0` | `967e8a7cafb1819e` | 15,398 → 16,579 | 362 | 新增 N1–N8 共 8 项 |
| `tools/check_id_admission.js` | （新增） | `7cfaa18e7443bdb3` | 19,176 | 473 | 新文件 |
| `tools/test_check_id_admission.js` | （新增） | `e15cbce836fed278` | 11,025 | 248 | 新文件 |

**回滚方法（逐文件独立，互不依赖）**：按上表"改前哈希"从备份/版本库取回原文件即可；本轮未产生任何数据或状态副作用，无需回滚数据。新增的两个文件删除即可回到改动前状态。

---

## 4. 三个补丁的实际实现

### P1 — 导入前可选的 ID 形状校验（`tools/import_data.js`）

- 常量 `SUBMIT_ID_RE = { shopId:/^c\d{2}$/, stallId:/^c\d{2}_t\d{2}$/, dishId:/^c\d{2}_d\d{3}$/ }`，与 `cloudfunctions/submit/index.js:80-84` 的 `ID_RE` 逐字一致。
- `checkSubmitIds(tables, opts)`：**只有 `opts.checkSubmitIds === true` 才执行**，默认不改变任何既有行为；读 `shopId/shop_id` 两种键名（`readTable` 后会归一化为 camelCase）。
- `main()` 中位置：**`tableErrors` 判定之后、`indexExisting()` 与 `buildImport()` 之前**——即"任何构建/写入之前失败退出"，返回 `EXIT.INVALID`(1)。
- 提示语说明"这些 ID 能通过导入，但投稿端会先返回 INVALID_FIELD"。

**与草案的偏差（一处，机械适配）**：草案写的是从"解析后行"读 `r.id`，实际源码里此处只有原始 CSV 字段（`shop_id`/`stall_id`/`dish_id`）。按实际字段读取，语义不变；已在代码注释与本报告注明。

### P2 — 注释与真实校验顺序对齐（`cloudfunctions/submit/index.js`）

改前注释暗示"演示数据会被 `TARGET_NOT_FOUND`/`TARGET_IS_DEMO` 挡住"，实际 `validateBody` 的形状校验（`ID_RE`）先于 `resolveTarget`，所以云端得到的是 `INVALID_FIELD`。本轮只改注释，**未改任何分支**；新增 N1–N8 用测试把"先形状、后查库"钉住。

### P4 — 真实批次缺证据整批拒写（`cloudfunctions/seed/index.js`）

- 新增 `pilotEvidenceProblems(ds)`：只检查 `ds.key === 'pilot'`，对 restaurants / stalls / dishes 逐条检查 `source.kind` 与 `source.detail`。
- `actionWrite` 在 `report.dataset = ds.key` 之后、`buildSpecs()` 之前判断：有缺证据 → `ok:false`、`message='拒写：真实批次存在缺证据记录（N 条），整批不写入'`、`blockers` 带明细、`results` 记 `blocked`，**一条都不写**。
- `__test__` 导出 `pilotEvidenceProblems`，供测试直接断言。

### 生成器侧证据硬校验（`tools/pilot/build_pilot_dataset.js`）

草案要求"缺证据在生成阶段就报错"。原实现只校验菜品 `source_detail` 非空，shops/stalls 只校验枚举。本轮补上：shops 与 stalls 都要求 `source.kind` 合法且 `source.detail` 非空。

---

## 5. 新增只读校验器 `tools/check_id_admission.js`

| 检查 | 说明 | 冲突码 |
|---|---|---|
| 冻结文件完整性 | 批准记录 `frozenMapSha256`/`frozenMapBytes` 与 `frozenMapRef` 指向的决策文件比对 | `FROZEN_HASH_MISMATCH` / `FROZEN_SIZE_MISMATCH` / `FROZEN_REF_MISSING` |
| 派生副本对齐 | `id-map.json` 的 `planDigest`/`mapVersion` 与批准记录比对（它是运行时副本，与决策文件不是同一份，**不能拿哈希直接比**） | `PLAN_DIGEST_MISMATCH` / `MAP_VERSION_MISMATCH` |
| ID 形状 | 四来源（map/batch1/batch1_min/pilot）全部 `c\d{2}`、`c\d{2}_t\d{2}`、`c\d{2}_d\d{3}` | `ID_SHAPE` |
| 源内重复 | 同一来源内部重复 ID | `DUP_IN_SOURCE` |
| 撞冻结映射 | 候选 ID 与已批准号段重叠 | `CROSS_SOURCE` + `RANGE_OVERLAP` |
| 引用完整性 | 菜品 → 档口 → 店铺 引用必须存在 | `REF_MISSING` |
| 派生一致 | `pilot-data.js` 与 `batch1_min` 的 ID/名称/价格一致 | `PILOT_MIN_DRIFT` |
| 命名空间批准 | 来源前缀是否出现在批准记录 `scope` 文本里 | `NS_UNAPPROVED` |

- 参数：`--root <项目根>`、`--json`；退出码：`0` 无冲突 / `1` 有冲突 / `2` 输入缺失或参数错误。
- **只读**：无 `writeFileSync`/`rename`/`rm`/`mkdir`；不生成、不修复、不重编号、不批准。冲突只报告。
- `batch1` / `batch1_min` / `pilot` 三者是同一批次的三种形态，彼此重叠不计冲突——只有与冻结映射的重叠才报告。
- **真实仓库首跑**：退出码 1，**冲突 4 条，全部为 `NS_UNAPPROVED`**：
  - `c02`（pilot、batch1、batch1_min 各一条）与 `c03`（batch1）未出现在任何批准记录 `scope` 中。
  - 冻结文件哈希一致、`planDigest`=`4ed23cb4…` 一致、无 ID 撞入 `c01` 号段、无形状违规。

---

## 6. 测试

| 套件 | 新增覆盖 | 结果 |
|---|---|---|
| `tools/test_import_data.js` | B1 合法形状放行；B2 非法形状（含 `s01` 店铺）拦下且无成功文案；B3 不带开关保持原行为；B4 候选内重复；B5 证据文件缺失（有无开关都拦）；B6 导入产物无 `dataClass`、一律 `unverified`、`verifiedAt:null`，manifest 写明不构成 verified 依据 | 243 项 / 0 失败 / exit 0 |
| `tools/test_seed_pilot.js` | I1–I4 `pilotEvidenceProblems` 正反例；I5–I8 缺证据时 `write` 整批拒写且 0 文档；I9–I10 证据齐全仍写 14 条（回归保护，用 stub 注入缺证据副本，真实 `main`） | 123 项 / 0 失败 / exit 0 |
| `tools/test_ugc_submit.js` | N1–N8：旧命名 `dishId`/`shopId` → `INVALID_FIELD` 且**一次库都没读**；形状合法不存在才 `TARGET_NOT_FOUND` 且确实读库；注释与顺序一致 | 99 项 / 0 失败 / exit 0 |
| `tools/test_check_id_admission.js` | A 干净夹具 0 冲突 + 确定性；B 六类冲突（重复/形状/撞映射/未批准/哈希/digest/漂移）；C 输入缺失退出 2、`--json` 可解析、未知参数退出 2；D 只读不修复；E 静态边界 | 37 项 / 0 失败 / exit 0 |

**模拟声明**：`test_seed_pilot` 与 `test_ugc_submit`/`test_ugc_review` 使用假数据库/假云开发互操作，属**本地模拟**，不代表云端真实行为；`test_check_id_admission` 使用临时目录夹具，不触碰仓库数据。

---

## 7. 验收实测（真实退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node tools/verify_data.js` | 0 | 12 店铺 / 7 楼层 / 24 窗口 / 45 菜品，0 错误 |
| `node tools/test_import_data.js` | 0 | 通过 243 / 失败 0 |
| `node tools/test_seed_pilot.js` | 0 | 通过 123 / 失败 0（本地模拟） |
| `node tools/test_seed_s21.js` | 0 | 通过 33 / 失败 0（本地模拟） |
| `node tools/verify_seed.js` | 0 | 通过 85 / 失败 0 |
| `node tools/test_ugc_submit.js` | 0 | PASS 99 / FAIL 0（本地模拟） |
| `node tools/test_ugc_review.js` | 0 | PASS 84 / FAIL 0（本地模拟） |
| `node tools/test_check_id_admission.js` | 0 | 通过 37 / 失败 0 |
| `node tools/check_id_admission.js` | **1** | 4 条冲突（期望：真实仓库确实存在未批准命名空间） |
| `node tools/check_eol.js` | 0 | docs 37 + tools 12 = 49 文件，违规 0 |

---

## 8. 安全检查与副作用

| 项 | 结果 |
|---|---|
| Git 写操作 | **0**（无 commit / checkout / reset / stash / push） |
| `HEAD` / 分支 / 暂存区 | `274ebd6` / `main` / 0 |
| `git status --short` | 70 行（较上轮 68：+`M` 三个源文件 +2 个新 `??`） |
| `git status --short -uall` | 264 行（+2 新文件，另 +3 已有文件转为 `M`） |
| `git diff --check` | exit 0（无空白错误） |
| 冻结文件 7 个 | SHA-256 前 16 位与基线全等 |
| 三份正式产物 | `records.json` / `records_blockers.json` / `gen-manifest.json` 均不存在 |
| 云端 | 调用 0 次、部署 0 次、数据写入 0 条 |
| 文件删除/覆盖 | 0（6 个既有文件均为局部修改，原内容可回溯） |

---

## 9. 未实施项与编号冲突

### 9.1 P3 未实施

草案 P3：`resolveTarget` 阶段对 `dataClass==='field_unverified'` 且 `verifyStatus!=='unverified'` 的记录直接拒绝（422）。

- **必要性**：中。现有链路已强制写入方只能产出 `unverified`，P3 属于"防御纵深"，防的是绕过写入方直接改库的历史数据。
- **风险**：低（只收紧，不放宽），但会改变云端返回码，需与 A2/A4 的既有期望同步。
- **本轮结论**：未做。等授权。

### 9.2 "P5"编号冲突（需裁决）

`docs/ACCELERATION_READINESS_20261026.md` §4 把 "P5" 定义为**新增 `check_id_admission.js`**，并写"本轮不创建"；而本次授权既要求创建该工具、又把 "P3/P5" 列入禁止清单。两处冲突解释：

- 本轮按**显式授权**（"新增 tools/check_id_admission.js"）创建了该工具，并把它当作独立交付物；
- 若"P5"另指补丁清单里的其他项（例如写入前快照），则**本轮未做**，因为它涉及云端写入流程，超出本轮范围；
- 敬请裁决：`P5` 究竟指校验器还是另一项；若是后者，请给出唯一定义，我下一轮照做。

### 9.3 其它有意未做

- 不新增批准记录 `ap-20261026-01`（草案在报告里，未落盘到 `approvals/`）。
- 不改 `batch1_min` 的楼层/位置/辣度描述（属数据修正，需你确认口径）。
- 不给 `check_id_admission` 加 `--fix`（授权明确禁止自动修复）。

---

## 10. 需要审批的决定

| 编号 | 事项 | 建议 |
|---|---|---|
| R-1 | 批准 `c02` 试点命名空间（三个来源均指向它） | 批准后校验器应从 4 条冲突降为 3 条（`c03` 仍属 batch1 草稿） |
| R-2 | `batch1` 中 `c03` 的 8 条草稿 ID 是否作废重编 | 建议作废，避免与未来正式批次撞号 |
| R-3 | 是否实施 P3 | 建议实施，并同步更新 A2/A4 断言 |
| R-4 | "P5"唯一定义 | 见 §9.2，请裁决 |
| R-5 | 是否允许把 `c02_d060–d071` 的 12 条证据描述先改为"未核实"（不重编号） | 建议允许，风险最低 |

---

## 11. 复现命令

```powershell
cd "C:\Users\25975\Desktop\文件all\微信小程序"
node tools/check_id_admission.js            # 期望 exit 1，4 条 NS_UNAPPROVED
node tools/test_check_id_admission.js       # 期望 exit 0，37 项
node tools/test_import_data.js              # 期望 exit 0，243 项
node tools/test_seed_pilot.js               # 期望 exit 0，123 项
node tools/test_ugc_submit.js               # 期望 exit 0，99 项
node tools/verify_data.js
node tools/test_seed_s21.js
node tools/verify_seed.js
node tools/test_ugc_review.js
node tools/check_eol.js                     # 期望 exit 0，49 文件 0 违规
```
