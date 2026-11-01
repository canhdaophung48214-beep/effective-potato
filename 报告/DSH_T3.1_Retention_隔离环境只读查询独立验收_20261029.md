# DSH 独立验收：T3.1 Retention 隔离环境只读查询

> 审查人：DSH（独立验收，非实现者）。只读，未改项目文件、未 Git 写、未建索引、未部署、未执行任何云端查询。
> 审查对象：`报告/T3.1_Retention_隔离环境只读查询核验_20261029.md`（10,033 B / 68 行）、`报告/DSH_T3_Retention_云端就绪预检_独立验收_20261029.md`、当前源码/schema/索引声明。

## 0. 结论

**T3.1 是一次"正确地停下来"的报告，不是一次完成的核验。**

- 作为**过程与诚实性**：PASS。它没有编造查询次数/耗时/索引命中，没有把静态源码、schema 草案或 2026-10-27 旧截图包装成实时证据，并明确写出"环境隔离身份不可证明 → 停止"。
- 作为**任务目标**（隔离环境只读查询核验）：**PENDING / 阻塞**。Q1–Q5 一次未跑，R-1、R-4 均未获得真实数据。
- **不判 FAIL**：现有证据不足以证明 T3.1 有造假或越界；其停止条件由执行令自身规定。

## 1. 独立核对（DSH 实测，非引用）

### 1.1 文件哈希与 T3.1 §2/§6 对照（全部逐字节一致）

| 文件 | 实测字节 | 实测 SHA-256（DSH） | 与 T3.1 一致 |
|---|---:|---|---|
| `cloudfunctions/retention/index.js` | 25,238 | `45F304842FA500441BFC28FDA1A4BCE619E02A6038D55F46C53EC7CE84EAE693` | 是 |
| `config/cloud/schema.submissions.json` | 8,489 | `954D2E2875EFEFBACE184E450D29AA097CE2A434369A9AF471E800BC433CA105` | 是 |
| `config/cloud/schema.upload_logs.json` | 3,499 | `958A128870B15A15F5F5FA1336B51D055F8AA117F3310F2E481448EB2B186DCD` | 是 |

修改时间均为 `2026-10-29T06:59:0xZ`（本地 14:59），**早于 T3.1 执行窗口（15:25–15:27）**。

### 1.2 "无云端访问路径"的独立验证

- `Get-Command tcb,cloudbase,wx,wxcloud` → **0 个**结果。
- 环境变量 `TCB_* / CLOUDBASE_* / WX_* / WECHAT_* / TENCENT_*` → **0 个**。
- 项目根无 `cloudbaserc.json`（Test-Path = False）。
- `project.config.json` 键为 `description/projectname/appid/compileType/cloudfunctionRoot/setting/condition/...`，**无 env 字段**（正则 `env` 不命中）。
- `cloudfunctions/retention/` 无 `config.json`（无触发器声明）。

上述证明"本会话没有现成的云端连接方式"，与 T3.1 §1 一致。**注意**：这只能证明"不可达"，不能证明"隔离环境不存在"。

### 1.3 只读边界（本轮窗口无写入）

- `git status --porcelain` = 84 行、`-uall` = 324 行、tracked 修改 **15**、暂存 0、`HEAD 274ebd6`、`main`。
- 项目内 **15:20 之后无任何文件被修改**（递归扫描，排除 `node_modules`）。
- 三个被审文件 mtime 均为 14:59（历史），非本轮。
- 结论：T3.1 "只新建项目外报告、未改项目文件" **可证**。

### 1.4 源码对照（五条查询）

| 查询 | 源码实测行（DSH） | T3.1 引用 | 判定 |
|---|---|---|---|
| Q1 审计恢复队列 | `where({'retention.audit.state':'pending'}).orderBy(retryAfter,createdAt,_id).limit`，`:197-202`；未来项跳过 `:211-217`；`hasMore` `:209` | `:197-203`、`:211-225` | 基本一致（边界差 1 行） |
| Q2 到期标记 | `status='pending'` + `createdAt:_.lt(cutoff)`，`:414-418` | `:414-420` | 基本一致 |
| Q3 needsMark count | `:344-346` | `:340-352` | 一致（区间包含） |
| Q4 清正文候选 | `status:_.in([...])` + `createdAt<` + `payload:_.neq(null)`，`:347-350` | `:347-350` | 一致 |
| Q5 清理审计队列 | `:313-316`；应用层守卫 `:365` | `:313-316`、`:365-369` | 一致 |

T3.1 关于"Q3/Q4 是同一候选查询的两面、五条并非五次独立执行"的说明**正确且必要**。

### 1.5 索引声明（本地）

`config/cloud/schema.submissions.json` 共 9 条索引：`uk_submitter_clienttoken`、`ix_dedupe_status`、`ix_status_created`、`ix_retention_mark_order`、`ix_retention_audit_queue`、`ix_retention_purge_candidates`、`ix_retention_purge_audit_queue`、`ix_submitter_created`、`ix_security_status`；4 条 Retention 索引键序与 T3.1 §4 描述一致。`_meta.status = "pending_admin_console_verification"`。

### 1.6 R-3 是否真有对账实现

`cloudfunctions/retention/index.js` 中 `reconcili|orphan|prepare_only|prepareOnly` **0 命中** → **只有设计叙述，无实现**。T3.1 判 PENDING 正确。

## 2. 十项逐条

| # | 检查项 | 判定 | 依据 |
|---|---|---|---|
| ① | 环境隔离证据 | **FAIL（前提不成立）+ PASS（正确停止）** | 无隔离环境 ID、无连接器、无 `cloudbaserc.json`（§1.2）；T3.1 据此停止 |
| ② | 五条查询与源码一致 | **PASS** | §1.4 逐行核对 |
| ③ | 查询结果有实际运行证据 | **PENDING（未运行，且如实声明）** | T3.1 §3 "0 次 / 不可观测"；无连接器佐证 |
| ④ | 缺失 `retryAfter` 实测 | **PENDING** | 0 次查询；无隔离数据 |
| ⑤ | `neq(null)`/嵌套/`IN`/分页实测 | **PENDING** | 同上；T3.1 明确未验证 |
| ⑥ | 4 条 Retention 索引与 `ix_status_created` 真实存在 | **PENDING（1 条有历史证据、4 条无任何证据）** | 见 §3 纠正② |
| ⑦ | 计划/命中不可见时如实标注 | **PASS** | T3.1 明说"不可观测"，并声明即使运行也不能宣称命中索引 |
| ⑧ | R-3 有对账能力还是仅有设计 | **PENDING（仅设计）** | 源码 0 命中（§1.6） |
| ⑨ | 只读边界 | **PASS** | §1.3 |
| ⑩ | Git/文件状态证据可信 | **PASS** | 三个哈希、HEAD、暂存、计数逐项复现 |

## 3. 对 T3.1 的三处纠正（P3，不改结论）

1. **"没有目标云环境 ID"应限定为"没有隔离环境 ID"**：生产环境 ID 存在（`config/cloud.js:23` 的 `shishen-dev-d2g4t8rgj7d0bd1e7`），T3.1 的表述会让人误读为"连生产环境都不知道"。
2. **索引存在性应分两档**：`ix_status_created`（及 `uk_submitter_clienttoken`/`ix_dedupe_status`/`ix_submitter_created`）有 **2026-10-27 C1 建索引截图**这一历史控制台证据；**4 条 Retention 索引从未在任何控制台证据中出现**。T3.1 统一写 PENDING 方向正确，但可更精确。
3. **行号小幅漂移**：Q2 `:414-420` 实为 `:414-418`；Q1 `:197-203` 实为 `:197-202`（`hasMore` 在 `:209`）。不影响语义。

## 4. 五个问题的答复

### 1. R-1 是否得到真实验证？

**没有。** 缺 `retryAfter` 时的过滤/排序行为**零次实测**。R-1 仍是"设计假设未验证"，不能因为本地 fake DB 的排序"看起来正确"而视为关闭。

### 2. R-4 的索引问题是否得到真实验证？

**没有。** 本轮没有读到真实索引列表、字段顺序、构建状态或查询计划。当前只能确认：**本地 schema 声明了 4 条 Retention 索引；云端从未有过这 4 条索引的证据**；`ix_status_created` 仅有 10-27 历史截图。

### 3. 哪些 P1 仍阻止上线？

- **P1-0（新）隔离环境不可用**：没有可证明隔离的环境与只读通道，所有云端验证无法开始。
- **P1-1（R-1）** 队列排序依赖未定义行为：首批候选恒缺 `retention.purge.retryAfter`，若 DB 跳过缺失字段 → T-2 永久空转；若排前 → 队头阻塞。
- **P1-2（R-2）** 无部署/无触发器：函数从未部署，`config.json` 不存在，功能不可能自动运行。
- **P1-3（R-3）** 无恢复批次审计、无孤儿 prepare 对账（源码 0 命中）。
- **P1-4（R-4）** 4 条索引未建、Q4 多值 `IN` 排序可用性未知。

### 4. 下一步最小任务是什么？

**由负责人提供"可证明隔离的环境 ID + 只读访问方式"**（控制台同账号下两个环境 ID 的对照、隔离环境集合/索引可见信息），然后按源码原样跑 Q1–Q5 的只读核验；必须先只读核对索引定义，再谈查询。

若短期拿不到隔离环境，**本地可独立推进的替代任务**是 **R-3 的对账实现**：`recoverPending`/`recoverPurgePending` 增加 `prepare`/`complete` 批次审计行 + 孤儿 prepare 只读对账工具 + 测试（不需要云端，可直接本地验收）。它不能关闭 R-1/R-4，但能关闭 R-3。

### 5. 是否有任何事项具备独立部署授权？

**没有。** 按执行令默认答案：无。T3/T3.1 均未产生可签核的云端证据；部署、建索引、配置触发器、触碰云端数据都需要负责人另行明确授权，并且应先完成隔离环境只读核验。

## 5. 边界声明

- 只读：未改 `项目/` 任何文件（本轮窗口内 0 个文件被写）、未 Git 写、未建索引、未部署、未触云。
- 未复验 T3.1 引用的官方文档原文；历史控制台证据来自 2026-10-27 会话，已标"历史"。
- 报告位于项目外：`C:\Users\25975\Desktop\食神寻味小程序开发\报告\`。
