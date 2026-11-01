# T3.2 R-1/R-4 云端核验准备：DSH 独立验收（2026-10-30）

验收人：DSH（独立，非实现者）
被审对象：`报告/T3.2_Retention_R1_R4_云端核验准备_20261030.md`（17,961 B / SHA-256 `FCA40693363A4AE6DA7A086895D13A737CB6675EBD2A80A0AE827A2ABA0CF4DB`）
方式：只读；核对源码、schema、查询；复跑专项测试。未改项目文件、未触云、未 Git 写。

**交付名称不符**：任务约定 `报告/Codex_T3.2_R1_R4_云端核验准备_20261030.md`，实际文件名为 `T3.2_Retention_R1_R4_云端核验准备_20261030.md`（无 `Codex_` 前缀、含 `Retention_`）。内容即为本轮提交，审查针对实际文件；命名一致性记 **PENDING（交付规范）**，不影响内容判定。

## 结论总表

| # | 审查项 | 判定 | 一句理由 |
|---|---|---|---|
| 1 | R-1 对缺失 `retryAfter` 的分析完整性 | **PASS**（附 1 处未覆盖点） | 覆盖三条队列与首次候选，明确"缺字段行为未验证"；未讨论 `deferPurge` 点路径更新的父级创建语义 |
| 2 | 是否存在未经证实的 CloudBase 查询语义假设 | **PASS** | 缺字段排序、`IN`、`neq(null)`、查询计划全部标 PENDING，未把假库排序当云端语义 |
| 3 | R-4 索引字段顺序与真实查询一致 | **PASS** | 逐条核对 schema `keys` 与 `orderBy` 序列、方向、前导等值字段 |
| 4 | Q1–Q5 是否覆盖所有实际查询 | **PASS**（附说明） | 覆盖全部队列/分页/count 查询；`.doc()` 点读与条件更新未列（非队列访问） |
| 5 | 是否区分 schema 声明与云端实际索引 | **PASS** | 四类状态、`_meta.status` 两处、0 条"已实测"；历史截图证据可追溯 |
| 6 | 隔离环境是否真隔离 | **PASS** | 默认环境视为生产等价、要求同会话双环境证明、无证据即停 |
| 7 | 是否遗漏 R-3 FAILED/PARTIAL 批次风险 | **FAIL** | 全文无 PARTIAL/FAILED/outcome 语义与处置要求 |

## 1. R-1 缺 `retryAfter` 分析（PASS，附 1 处缺口）

核对源码逐条成立：

| 报告断言 | 源码 | 结论 |
|---|---|---|
| `recoverPending` 以 `audit.state=pending` 排序 `retryAfter,createdAt,_id` | `:207-212` | 一致 |
| 读取后应用层才跳过未来 `retryAfter` | `:227-233` | 一致 |
| `markExpired` 新建待补标记写 `new Date(0)` | `:502-513` | 一致 |
| `deferAudit` 以 5 条件更新推迟 60 秒 | `:136-146` | 一致 |
| `recoverPurgePending` 同构队列 | `:341-346` | 一致 |
| `purgePayload` 候选按 `status IN / createdAt< / payload neq null` 且排序 `purge.retryAfter` | `:392-395` | 一致 |
| **首次清理候选没有必然写 `retention.purge.retryAfter` 的路径** | 全仓仅 `retention/index.js:330`（退避）与清理成功分支写该字段；`submit`/`review` 均未写 | 一致（关键事实成立） |
| 缺字段时云端排序行为未知 | 无云端证据 | 标 PENDING，正确 |
| `recoverPending` 仅 deferred 时仍可能 `ok:true` | `:218-220` 初始化、无 failed 时按 `ok` 汇总 | 成立 |

**未覆盖点（建议补）**：`deferPurge` 在 `retention.purge` 整个父级缺失时执行 `update({'retention.purge.retryAfter': ...})`（`:328-331`）。CloudBase 是否会为缺失父级创建嵌套字段，属未验证的平台语义；若不会，则"首次候选缺字段 → 跳过或失败 → 退避写失败"的路径会让队头持续占用。这正好落在 Q5 的"嵌套字段缺失"探测范围内，但报告未把它列为观察项。属分析完整性的小缺口，不影响主结论。

## 2. 未经证实的查询语义假设（PASS）

- 报告 §A 明确：缺字段参与 `orderBy` 时"排除/排前/排后/报错"四种可能均为 PENDING，并说明各自的业务后果；没有把本地假库行为外推。
- §C 明确 Q3/Q4/Q5 复用同一条生产候选查询，不伪称五次独立调用；查询计划不可观测时要求写"不可观测"。
- 未发现把 `IN` 多区间合并、`neq(null)` 空值语义、多键 `orderBy` 组合写成"已知"的表述。
- 唯一略可疑处：§B 写 `ix_status_created`「已有历史截图证据」但未给截图路径/哈希——按我的 T3 §3.5 记录（2026-10-27 C1 建索引截图）可追溯，属引用不足而非事实错误，建议补引用。

## 3. R-4 索引字段顺序（PASS）

逐条比对 `config/cloud/schema.submissions.json` / `schema.upload_logs.json` 的 `keys` 与源码 `orderBy`：

| 索引（schema 行） | 声明顺序 | 实际查询 | 判定 |
|---|---|---|---|
| `ix_retention_mark_order`（`:134-137`） | `status↑, createdAt↑, _id↑` | `:463-466` 同序 | 一致 |
| `ix_retention_audit_queue`（`:140-143`） | `audit.state↑, audit.retryAfter↑, createdAt↑, _id↑` | `:208-212` 同序 | 一致 |
| `ix_retention_purge_candidates`（`:146-149`） | `status↑, purge.retryAfter↑, createdAt↑, _id↑` | `:393-395` 同序；`payload` 仅过滤不入键 | 一致（报告已注明） |
| `ix_retention_purge_audit_queue`（`:152-155`） | `purge.state↑, purge.retryAfter↑, createdAt↑, _id↑` | `:342-344` 同序 | 一致 |
| `ix_retention_reconcile_event_id`（upload_logs `:59-64`） | `event↑, _id↑` | `:670-671`、`:684` | 一致 |
| `ix_status_created`（`:128-131`） | `status↑, createdAt↑` | `:390` count、`:463` 基础过滤 | 一致 |

方向全部升序，前导等值字段（`status`/`state`/`event`）与排序键顺序正确；报告对"`payload` 未入键"与"多区间组合不能仅凭键序宣称可用"的判断成立。

## 4. Q1–Q5 覆盖面（PASS，附说明）

retention 中的集合访问清单（我逐行枚举）：

| 访问 | 行 | 是否被 Q 覆盖 |
|---|---|---|
| `submissions.where(audit.state)` 队列 | `:208` | Q1 |
| `submissions.where(status,createdAt).count()` | `:390` | Q3 |
| `submissions.where(status IN,createdAt,payload).orderBy` | `:393` | Q3/Q4/Q5 |
| `submissions.where(purge.state)` 队列 | `:342` | Q5 |
| `submissions.where(status,createdAt).orderBy` 标记 | `:463` | Q2 |
| `upload_logs.where(event,_id>cursor)` 分页 + 探针 | `:670`、`:684` | Q5 |
| `submissions.doc(id).get()` 点读 | `:152/187/287/316` | 未列（按 `_id` 点读，不依赖上述索引） |
| `upload_logs.doc(eventId).get()` | `:167/300` | 未列（同上） |
| 各 `where(_id,status,rev...).update()` | `:141/181/312/329/427/502` | 未列（写操作，非只读查询） |

结论：**队列/排序/分页/count 类查询已全覆盖**；点读与条件更新未列入属合理省略，但报告未显式声明"点读不纳入"，建议补一句以免被误读为遗漏。

## 5. schema 声明 vs 云端实际（PASS）

- 两份 schema `_meta.status = "pending_admin_console_verification"`（各自 `:4`），报告如实引用。
- 报告用四类状态（仅 schema 声明 / 已有历史截图 / 已实测存在 / 未知），并明确"本轮没有任何已实测存在项"；四条 Retention 索引全部"仅 schema 声明"。
- `ix_status_created` 标注"已有历史截图证据"，来源可追溯（DSH T3 §3.5 / 2026-10-27 C1 建索引截图），但报告未给截图路径或哈希——建议补，否则下一轮容易被当成"已复验"。

## 6. 隔离环境（PASS）

- `config/cloud.js:23` 为项目默认环境 `shishen-dev-d2g4t8rgj7d0bd1e7`；`cloudfunctions/retention/index.js:25` 用 `cloud.DYNAMIC_CURRENT_ENV`——无法从代码推断实际部署环境，报告结论正确。
- 报告把默认环境视为**生产等价**、禁止作为测试目标，并要求"同一控制台会话内同时展示生产与隔离两个环境 ID、不同资源归属、权限截图、时间与哈希"；不足即停。与 T3.1 的失败教训一致，标准没有降低。

## 7. R-3 FAILED/PARTIAL 风险（FAIL）

全文检索 `PARTIAL`、`FAILED`、`outcome`、`RECONCILE_ANOMALIES` 均无命中；`reconcileBatches` 只在 §A 作为"不查 retryAfter、按 `_id` 续页"的查询被提及，Q5 也只覆盖分页与截断。

遗漏的具体风险：

1. R-3 已实现 `batchOutcome/completeCode/outcome`：complete 批次为 `PARTIAL`/`FAILED` 时，对账返回 `RECONCILE_ANOMALIES`、`ok=false`，但**清理侧（`purgePayload`/`markExpired`）不读取对账结果**，会继续按自己的队列推进——"审计不完整"与"业务继续清理"之间没有闸门。
2. `RECONCILE_ANOMALIES` 只影响对账接口的返回码，没有告警、没有阻断，也没有写入任何"待人工处理"标记；T3.2 把它当作纯只读探针，未把它列为 R-1/R-4 之前的运营前置。
3. Q5 的"截断窗口不冒充闭合"只覆盖分页完整性，不覆盖 `outcomes.PARTIAL/FAILED>0` 时"批次已闭合但审计未完成"的语义。

建议在 T3.2 增补一小节：明确 R-3 结果为 `PARTIAL`/`FAILED`/`RECONCILE_ANOMALIES` 时，清理与标记是否暂停、由谁处置、以什么标记记录；并在云端核验前决定"是否允许在存在未闭合审计批次时执行 T-2 清理"。

## 本地复核

- `node tools/test_retention_reconcile.js` → **30 PASS / 0 FAIL，exit 0**（与报告一致）。
- 报告声明的 mark 71/0、recover_pending 13/0、purge 18/0 与上轮我实测一致，未再逐条复跑。
- Git：`HEAD 274ebd6`、`main`、暂存 0、`status --short` 85、`-uall` 325；项目文件本轮无改动（T3.2 报告位于项目仓库外）。

## 给负责人的裁决点

1. **原则性放行**：T3.2 作为"云端核验准备包"可用；1–6 项可判 PASS。
2. **需补**：第 7 项（R-3 PARTIAL/FAILED 与清理闸门）必须补进 T3.2 或单独立项，否则云端核验通过后仍会在"审计不完整 + 继续清理"处留下运营漏洞。
3. **需授权**：隔离环境与只读账号、后续夹具写入/建索引、调度与部署，均需单独授权；本报告不构成任何云端操作授权。

---
声明：本轮只读（读码、读 schema、跑本地测试），未修改项目文件、未执行 Git 写、未调用/部署云函数、未读写云端数据。
