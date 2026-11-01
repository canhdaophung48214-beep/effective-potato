# B1 阶段完整报告

> 范围：从「B1 数据能否进入 `field_unverified`」到「本地导入完成」「云端现状核清」「seed 部署决策」的全部工作。
> 生成时间：2026-10-27 凌晨（北京时间）；环境 `shishen-dev-d2g4t8rgj7d0bd1e7`。
> 性质：本地完成，云端**零写入**。所有云端事实均来自项目负责人控制台截图（2026-10-26 23:4x–23:5x）。

## 0. 一页结论

| 问题 | 答案 |
|---|---|
| 数据能不能进 `field_unverified` | **还不能**：差 1 张档口照、1 张楼层指引、1 张麻酱凉面价签（或负责人书面确认替代） |
| 本地导入能不能跑通 | **能**：已用正式导入器生成 3 个产物，退出码 0，计数 1/1/1/12 |
| 云端能不能直接投稿 | **不能**：云端 `dishes` 只有 4 条 `demo`，`submit` 会先拒掉旧形态 ID |
| 云端 seed 能不能预演 | **不能**：线上是 2026-10-22 的旧版，没有六项复核、没有 `rollbackPlan` |
| 现在最该做的一件事 | 决定 seed 部署方式（覆盖 `seed` / 并行 `seed_b1`），把新版本放上去 |
| 距离真实投稿还差几步 | 部署 → 写入 12 条 → 投稿实测 → 审核实测，共 4 步 |

## 1. 时间线（本阶段）

| 时间 | 事件 |
|---|---|
| 10-22 00:20 | 云环境创建 |
| 10-22 12:22 | 演示数据写入云端（`batchId = seed-s01-20261022`，1 店 + 3 档 + 4 菜） |
| 10-22 16:04 | `seed` 云函数最后一次部署（**至今未更新**） |
| 10-23 | S2.1 回滚安全修复完成，**未再部署**（`docs/COLLECTION_STATUS_REPORT_20261023.md:181`） |
| 10-26 白天 | 阶段 C 云端联调：C1 建集合/索引/部署 submit+review/配环境变量；C2-A 拒绝路径实测 |
| 10-26 晚 | B1 证据核对：字段审计 → 负责人补充确认 → 辣度来源同步 |
| 10-26 23:30 | 按 CSV 重新生成 `pilot-data.js`；修正 B19 测试断言 |
| 10-27 00:10 | 本地正式导入执行，产物落在 `C:\Users\25975\Desktop\b1_import_out_20261027_001000` |
| 10-26 23:4x | 云端现状截图核验（集合、权限、seed 版本） |

## 2. 数据现状

### 2.1 本地 B1（唯一一条真实数据候选）

| 载体 | 内容 | 规模 |
|---|---|---|
| `tools/pilot/batch1_min/shops.csv` | 第三餐厅（三餐），c02 | 606 B |
| `tools/pilot/batch1_min/floors.csv` | c02_f2（2 楼） | 395 B |
| `tools/pilot/batch1_min/stalls.csv` | c02_t02 韩小面 | 521 B |
| `tools/pilot/batch1_min/dishes.csv` | 12 道面，`c02_d060`–`c02_d071` | 3,528 B |
| `tools/pilot/batch1_min/img/c02_t02_menu.jpg` | 门头 + 价目表同框 | 603,818 B |
| `cloudfunctions/seed/pilot-data.js` | 由 CSV 生成，供 seed 消费 | 8,115 B |

**哈希（全部与 manifest 一致）**：`shops e5724007…`、`floors ad5df081…`、`stalls 7e5b92e8…`、`dishes df344d86…`。

### 2.2 云端（截图实测）

| 集合 | 条数 | `_id` | 权限 |
|---|---|---|---|
| `restaurants` | 1 | `s01` | 所有用户可读 |
| `stalls` | 3 | `s01_t1`/`s01_t2`/`s01_t3` | 所有用户可读 |
| `dishes` | 4 | `d01`/`d02`/`d03`/`d39` | 所有用户可读 |
| `submissions` | 0 | — | 所有用户不可读写 |
| `upload_logs` | 1 | `26e7c545…` | 所有用户不可读写 |

- 全部演示数据：`batchId = "seed-s01-20261022"`、`dataClass = "demo"`、创建于 2026-10-22 12:22:31。
- `upload_logs` 唯一一条：`denied / RESERVED_FIELD / 2026-10-26 16:29:01`，对应 C2-A 的 A2 用例，证明 `submit` 已在云端运行且 `UGC_LOG_SALT` 生效。
- **pilot 批次从未写入云端**（`pilot_c02_batch1_20261022` 零记录）。

### 2.3 本地导入产物（已生成，未上云）

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `shops.json` | 2,137 | `7ca5dd0c…` |
| `dishes.json` | 6,609 | `9fa30b70…` |
| `manifest.json` | 4,284 | `e8e82728…` |

计数 1 店 / 1 层 / 1 档 / 12 菜；全部 `verifyStatus = "unverified"`、`verifiedAt = null`、无 `dataClass`、无 `batchId`（导入器设计如此）。

## 3. 证据链：五层状态

| 层 | 状态 | 依据 |
|---|---|---|
| ① 材料存在 | ✅ | 4 个 CSV + 1 张照片 + 生成器可复现 |
| ② 照片能支持 | ⚠️ 部分 | 支持 11/12 菜名、12 个价格、店招与档口名；**不支持楼层/餐厅名/方位**；麻酱凉面画面未见 |
| ③ CSV 与照片一致 | ⚠️ 部分 | 9 条精确；清汤 3 条「（可拼）」与负责人澄清「可干拌」存在口径差 |
| ④ 记录自洽 | ✅ | 导入 dry-run 0 错误 0 警告；ID 唯一、无跨表冲突 |
| ⑤ 可合法进入 `field_unverified` | ❌ | 缺档口照（含编号）、楼层指引、麻酱凉面价签；辣度仅有口述来源 |

**负责人口述已确认**（2026-10-26 23:24，非餐厅签字）：三餐 / 二楼 / 最西侧 / 韩小面 / 麻酱凉面在售 / 清汤「可干拌」。辣度：重庆小面、杂酱面、招牌豌杂面、三条干拌面 = 香辣；酸菜面、牛肉面 = 微辣。已同步进 CSV 的 `source_detail`，未改 `tastes` 字段（与负责人确认值本就一致）。

## 4. 云端 seed 版本（关键发现）

| 项 | 值 |
|---|---|
| 版本 | `$LATEST`（仅此一个，流量 100%） |
| 最后更新 | **2026-10-22 16:04:53** |
| 运行时 | Node.js 16.13 / `index.main` / 256 M / 10 s |
| 环境变量 | `ADMIN_OPENIDS` 已配置（掩码） |

**结论**：线上版本早于 S2.1。以下能力**只在本地、不在线上**：

- `driftReasons` 六项复核（`cloudfunctions/seed/index.js:809`）
- `absent` 与 `noop` 的区分（`:851`、`:938`）
- 从 `pilot-data.js` 读取真实批次（`:145`）
- `pilotEvidenceProblems` 缺证据整批拒写（`:317`、`:481`）
- `rollbackPlan` 只读预演动作

## 5. 风险清单

| # | 风险 | 影响 | 现状 |
|---|---|---|---|
| R1 | 线上 seed 落后，缺六项复核 | 预演与回滚保护不存在 | 待部署 |
| R2 | **部署无代码回滚路径** | 只有 `$LATEST`；`cloudfunctions/seed/` 未入 Git；全机无备份 | 需在部署前接受 |
| R3 | `dishes` 对客户端可读 | 写入 12 条后任何登录用户可查（界面不展示） | 需你知情同意或改权限 |
| R4 | c03 命名空间未批准 | `check_id_admission` 仍 exit 1（唯一告警） | 待决策 |
| R5 | 隐私指引声明「未处理任何信息」 | 一旦投稿上线即与事实矛盾 | 灰度前必须切换 |
| R6 | UGC 场景声明「未声明」 | 发布前硬门槛 | 未处理 |
| R7 | 小程序从未提交线上版本 | 审核页与 sitemap 规则尚未随包上线 | 事实 |

## 6. 测试与校验总表（真实退出码）

| 命令 | 退出码 | 结果 |
|---|---|---|
| `node tools/verify_data.js` | 0 | 12 店铺 / 7 楼层 / 24 窗口 / 45 菜品，0 错 |
| `node tools/test_import_data.js` | 0 | 243 通过 / 0 失败 |
| `node tools/test_seed_pilot.js` | 0 | 124 通过 / 0 失败 |
| `node tools/test_seed_s21.js` | 0 | 33 通过 / 0 失败 |
| `node tools/verify_seed.js` | 0 | 85 通过 / 0 失败 |
| `node tools/test_ugc_submit.js` | 0 | 110 通过 / 0 失败（本地模拟） |
| `node tools/test_ugc_review.js` | 0 | 84 通过 / 0 失败（本地模拟） |
| `node tools/test_check_id_admission.js` | 0 | 51 通过 / 0 失败 |
| `node tools/check_id_admission.js` | 1 | 1 条 `NS_UNAPPROVED`（c03，符合预期） |
| `node tools/check_eol.js` | 0 | 57 文件，违规 0 |
| `git diff --check` | 0 | 无空白错误 |
| 本地导入（`import_data --write`） | 0 | 产物 1/1/1/12 |

## 7. 仓库状态与副作用

| 项 | 值 |
|---|---|
| HEAD / 分支 | `274ebd6` / `main` |
| 暂存区 | 0 |
| `git status --short` / 展开 | 70 行 / 273 行 |
| 冻结 7 文件哈希 | 全部与基线一致 |
| 三件正式产物（`records.json` 等） | **仍不存在** |
| 云端写 / 部署 / 删除 / 权限变更 | 0 / 0 / 0 / 0 |
| Git 写操作 | 0 |

## 8. 需要你决定的 6 件事

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| D1 | seed 部署方式 | A 覆盖 `seed` / B 并行 `seed_b1` | **B**（先动新函数，旧函数零风险） |
| D2 | `dishes` 是否保持客户端可读 | 保持 / 改为仅服务端 | 保持（价格信息本身公开），但需你确认 |
| D3 | c03 命名空间 | 维持未批准 / 另行审批 | 维持未批准（本轮不碰） |
| D4 | 补拍计划 | 拍 P1–P4 / 用文字确认替代 | 拍楼层指引 + 档口正面 + 麻酱价签三张 |
| D5 | 隐私指引切换时点 | 灰度前 / 发布前 | 灰度前（切第二项并如实填写） |
| D6 | `seed` 头部注释漂移 | 顺带修 / 暂不动 | 顺带修（1 行注释，无行为影响） |

## 9. 建议的下一步（最短路径）

1. **你选 D1**（A 或 B）→ 我执行部署，只报部署结果与 `$LATEST` 新时间戳。
2. 部署后跑 `plan`（只读）：确认批次识别为 `pilot_c02_batch1_20261022`、期望 1+1+12、`driftReasons` 可用、`rollbackPlan` 可返回预测。
3. `plan` 干净后，单独授权 `write`：写入 12 条 `field_unverified`。
4. 用小程序体验版投稿一条，验证「目标可投稿 → 成功落库 → 审核页可见」。
5. 审核通过/驳回/删除各跑一次，确认 `upload_logs` 审计链完整。
6. 最后再谈是否公开（隐私指引 + UGC 声明 + 类目风险，另立门槛）。

## 附录 A：本阶段新增/更新的文档

| 文档 | 用途 |
|---|---|
| `docs/B1_EVIDENCE_FIELD_AUDIT_20261026.md` | 字段级证据矩阵（第一轮） |
| `docs/OWNER_ATTESTATION_TEMPLATE_B1_20261026.md` | 负责人书面确认模板（空模板） |
| `docs/B1_OWNER_CONFIRMATION_SUPPLEMENT_20261026.md` | 负责人口述确认入档与 M1–M9 待授权清单 |
| `docs/ACCELERATION_EXECUTION_20261026.md` / `_R2.md` | 加速轮执行记录（P1–P5、c02 条件批准） |
| `docs/REAL_DATA_CANDIDATE_SELECTION_20261026.md` | 6 个真实候选批次的全项目盘点 |
| `docs/B1_CLOUD_STATE_PREFLIGHT_20261026.md` | 云端现状与部署方案（本轮） |
| `docs/B1_COMPLETE_REPORT_20261027.md` | 本报告（汇总） |

## 附录 B：复现命令

```text
node tools/verify_data.js
node tools/import_data.js --dir tools/pilot/batch1_min --all --require-evidence --check-submit-ids
node tools/pilot/build_pilot_dataset.js --write
node tools/test_seed_pilot.js
node tools/check_id_admission.js
node tools/check_eol.js
git status --short
```

## 附录 C：术语

- **B1**：`tools/pilot/batch1_min/`，即 c02_t02 韩小面 12 道面。
- **`field_unverified`**：现场采集但未经核实，是投稿功能唯一接受的 `dataClass`。
- **六项复核**：回滚删除前逐条核对 `batchId` / `dataClass` / `verifyStatus` / `verifiedAt` / `contentHash` 重算 / 关联计数。
- **`rollbackPlan`**：只读预演，列出将删除、缺失、阻断原因，不删任何东西。
