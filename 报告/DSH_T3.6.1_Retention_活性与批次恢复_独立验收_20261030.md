# DSH｜T3.6.1 Retention 活性与批次恢复：独立验收

日期：2026-10-30；验收人：DSH（只读）。结论基于**我亲自读取的源码、我自己的探针脚本、我实跑的测试**，不以 Codex 报告的自述为依据。本轮未修改项目文件、未执行 Git 写、未调用云端、未部署、未建索引。

## 0. 结论表

| 判定项 | 结论 | 依据（摘要） |
|---|---|---|
| DEFERRED 活性 | **PASS（仅纯 `LOCK_BUSY` 子类）** | 零业务写入 + `DEFERRED_NOT_STARTED` + 释放后重试可完成；但混合 DEFERRED 仍永久阻断（见 P1-1） |
| 历史批次恢复 | **PASS（仅新批次）/ PENDING（历史无清单批次）** | PARTIAL→修复→重新对账→放行 实测通过；旧日志无清单/稳定 ID 被拒（如实） |
| 锁释放恢复 | **PASS（离线）** | 幂等 `ALREADY_RELEASED`、`LOCK_LOST` 拒绝旧 token、回执丢失点读确认 |
| 原有 B/E/F 回归 | **PASS（本地）** | T3.6 并发/修复/续扫 15/7/15 全绿；冻结主套件 290/0/11 |
| 正文安全 | **PASS（本地，生产入口关闭）** | 阻断与未开始路径 payload 逐字节不变；`main purge` 读库前失败关闭且零 DB 调用 |
| **整体 T3.6.1** | **PENDING** | P1-1（混合 DEFERRED 永久阻断）、全局 TOCTOU 未解决、生产 purge 关闭 |
| 真实 CloudBase | **PENDING（单独判定）** | 本端零云操作；CAS/时钟/回执/多实例/索引全部未验 |

一句话：**这次修的是"错杀"，证据链与锁恢复都做扎实了；但"永久停摆"只缩小了范围，没有消除。**

---

## 1. 对象、哈希与备份完整性

开工 `HEAD 274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、`main`、暂存 0；收工 `status --porcelain` 93 行、`--untracked-files=all` 336 行（与 Codex 报告一致）。

| 对象 | 字节 | SHA-256（前 16） | 报告值 |
|---|---:|---|---|
| `cloudfunctions/retention/index.js` | 72,452 | `C9BE61A1B030614A` | 一致 |
| `config/cloud/schema.upload_logs.json` | 4,269 | `F381B6F7A7FB259B` | 一致 |
| `tools/ugc_fake_cloud.js` | 11,319 | `A98A9C1F85122464` | 一致 |
| `tools/test_retention_t361_deferred.js` | 5,054 | `816E632337A132D5` | 一致 |
| `tools/test_retention_t361_repair.js` | 8,247 | `754F56E4A71C8B52` | 一致 |
| `tools/test_retention_t361_lock_recovery.js` | 6,370 | `41D65AE8CCF599C3` | 一致 |
| `docs/RETENTION_T361_DESIGN_20261030.md` | 5,971 | `257768D6C32BD2BE` | 一致 |
| `报告/Codex_T3.6.1_精确差异_20261030.patch` | 62,825 | `FF834E9F65427AD1` | 一致 |
| `报告/Codex_T3.6.1_回归原始输出_20261030.txt` | 119,227 | `5FA874ABAD2F39B6` | 一致 |

备份 `备份\T3_6_1_retention_20261030_230621_860\`：`manifest.txt` 三条记录（56,114 / 4,071 / 10,656 与对应 SHA-256）与三份 `*.before` 文件逐项复算一致；`tools__test_retention_t361_repair.before_debug.js`（6,039 B）是 Codex 自述的"编写中间快照"，**不冒充改前原始文件**，标注正确。

## 2. 代码核读（关键机制与行号）

- **纯 LOCK_BUSY 的严格判定**：`:874-879` 要求 `selected>0 && lockBusy===selected && deferredRetry===selected && purged/deferredAudit/skipped/conflicts/failed/unprocessed 全 0 && !retrySchedulingFailed && auditRecovery 未选中`，才写 `notStartedReason=LOCK_BUSY, zeroBusinessWrites=true`；`:880-887` 生成 `DEFERRED_NOT_STARTED / PURGE_NOT_STARTED`。混合批次落入 `hasDeferred` → `DEFERRED`，仍阻断。
- **闸门的接受条件**：`completeAuditReconcile()` `:691-716` 要求 `closed === outcomes.OK + DEFERRED_NOT_STARTED + repaired`、`repaired === PARTIAL+FAILED`、`unresolvedFailure === 0`、`outcomes.DEFERRED === 0`，且每个批次必须是 `closed` 且（`COMPLETE`/`DEFERRED_NOT_STARTED`/`PARTIAL|FAILED + repairStatus==='confirmed'`）。`:1302-1315` 对 `DEFERRED_NOT_STARTED` 的 stats 逐项复验，防伪造。
- **修复只追加**：`repairPurgeBatch()` `:509-637` —— 先校验 prepare/complete 唯一、同批同日、计数闭合、`selected` 一致、清单长度与 `evidenceDigest` 匹配（`:530-542`）；逐条验证：已清正文者须有 `purge.state==='complete'`、锁 `released`、稳定 `eventId` 逐条 OK 日志；未清者须 `rev/status/payloadProof` 与清单一致且 `purge.state!=='pending'`（`:563-609`）；通过后写稳定 `_id` 的 `REPAIR_CONFIRMED`（`:610-627`，写入失败先点读确认）；随后**必须重跑完整有界对账**才能报成功（`:629-636`）——收据本身不放行。
- **修复进入闸门的位置**：`reconcileBatches` `:1324-1334` —— 只有 `prepare.logId/complete.logId/evidenceDigest/selected` 全等且 `status==='closed'` 才 `counts.repaired++`，否则 `unresolvedFailure++`；有 repair 但未确认则计入 `invalidLogs`。
- **锁恢复**：`recoverPurgeLease()` `:467-482` 先释放，失败时点读：同 owner/token 且 `released` → `ALREADY_RELEASED`；token/owner 变化 → `LOCK_LOST`；仍 held → `LOCK_RELEASE_UNCONFIRMED`。`recoverExpiredPurgeLease()` `:484-498` 仅在租约到期后按读到的 owner/token 条件释放。
- **生产入口**：`main` `:1368-1386` 动作白名单 → 维护令牌 → `purge` 在读库前直接 `PURGE_GLOBAL_FENCE_UNVERIFIED`；`repairPurgeBatch` 需令牌并透传 `event.batchId`。`__test__.purgePayload` `:1396-1399` 才注入离线模拟开关（`Symbol`），模块不导出内部函数。

## 3. 独立复现（自有探针 20/20 PASS）

探针 `%TEMP%\t361_probe.js`，使用仓库假数据库但**自己构造输入、自己断言**，不调用 Codex 测试：

| # | 复现内容 | 结果 |
|---|---|---|
| P1.1–P1.2 | LOCK_BUSY → `PURGE_NOT_STARTED`；payload/rev/`retention.purge` 逐项不变、`submissions` 零 update/add/remove、日志只 +2 | PASS |
| P1.3 | 对账收下 `DEFERRED_NOT_STARTED` 并整体 `OK` | PASS |
| P1.4–P1.5 | 释放锁 → 再 purge `OK, purged=1`、payload=null；旧未开始事件仍在（只追加） | PASS |
| P2.1–P2.4 | 混合批次（先清 1 条再遇 LOCK_BUSY）→ `PURGE_DEFERRED`；释放锁后连续两次 `AUDIT_GATE_BLOCKED`；阻断时正文未动；**DEFERRED 批次无修复入口**（`repairPurgeBatch` 拒绝） | PASS（结论：仍永久阻断） |
| P3.1–P3.5 | 注入第二条日志写失败 → `PARTIAL`（`auditFailedCount=1`）→ 闸门阻断 → `repairPurgeBatch` 追加 `REPAIR_CONFIRMED` → 再对账 `repaired=1/unresolvedFailure=0/OK` → 下一次 purge 正常完成 | PASS |
| P4.1 | 无 `selectedEvidence` 的旧式批次（手工构造 prepare/complete）→ 修复被拒 `REPAIR_EVIDENCE_INVALID` | PASS |
| P5.1–P5.2 | 重复释放 → `ALREADY_RELEASED` 且 rev 不再增；新持有者接管后旧 token → `LOCK_LOST` | PASS |
| P6.1–P6.3 | 生产 `main purge` → `PURGE_GLOBAL_FENCE_UNVERIFIED`；无令牌 `repairPurgeBatch` → `FORBIDDEN`；两条入口合计 **0 次 DB 调用** | PASS |

**要求的两条链路均已独立复现**：`LOCK_BUSY → 释放 → 再次 purge 正常完成`（P1.4）、`PARTIAL → 修复 → 重新对账 → 解除阻断`（P3.3–P3.5）。

## 4. 反事实（我做，不看 Codex 的 counterfactual 目录）

在 `%TEMP%` 复制 harness + 三份测试 + 当前 `index.js`，逐次只改副本：

| 变异 | 结果 | 说明 |
|---|---|---|
| M1 关闭 `notStarted` 判定 | **4 PASS / 5 FAIL**（D1–D5） | 能检出；Codex 报告写"4 项 FAIL"，与实测 5 项不符（计数误差） |
| M2 修复忽略未清记录的 `rev` 漂移 | **12 PASS / 0 FAIL** | **测试没覆盖**：实现要求 rev 一致，但无对应用例；属覆盖缺口（见 P2-2） |
| M3 去掉幂等释放确认 | **6 PASS / 2 FAIL**（L1、L6b） | 与报告"2 项 FAIL"一致 |
| M4 闸门忽略修复证据（只认 OK） | **11 PASS / 1 FAIL**（H2b） | 能检出，但仅 1 条用例兜底 |

## 5. 回归（我实跑，全部 exit 0）

`t361_deferred 9/0`、`t361_repair 12/0`、`t361_lock_recovery 8/0`；`t36_concurrency 15/0`、`t36_repair 7/0`（仍打印"历史正向修复 PENDING"）、`t36_resume 15/0`、`t34_resume` exit 0；`reconcile 30/0`、`purge 18/0`、`audit_gate 16/0`、`recover_pending 13/0`、`mark` exit 0；`ugc_review`、`ugc_submit`、`client_contract` exit 0；`pages 106/0`、`index_state` 全通过；`check_eol 64 文件 0 违规`；`docref 51/0`；`records_spec 290/0/11`；`git diff --check` 0（仅既有 `project.config.json` CRLF 提示）。

## 6. 判定与理由

1. **DEFERRED 活性 = PASS（限纯 LOCK_BUSY）**。判定依据是"零业务写入有可核对证据"：payload/rev/`retention.purge` 未变、`submissions` 无写调用、只追加两条批次日志、闸门单列 `DEFERRED_NOT_STARTED` 不放行清理。混合批次仍 `DEFERRED`，按设计阻断——但这正是 P1-1。
2. **历史批次恢复 = PASS（新批次）/ PENDING（旧批次）**。新批次有 `selectedEvidence` + 稳定 ID，PARTIAL 修复链实测闭合；旧日志无清单的批次被明确拒绝、不补造证据——这是正确取舍，属如实 PENDING。
3. **锁释放恢复 = PASS（离线）**。幂等、fencing、回执丢失点读都成立；真实时钟/CAS 仍是云端事项。
4. **原有 B/E/F 回归 = PASS（本地）**。T3.6 三套件与冻结主套件全绿，未回退。
5. **正文安全 = PASS（本地）**。所有阻断/未开始路径正文逐字节不变；生产入口在读库前失败关闭且零 DB 调用。
6. **整体 T3.6.1 = PENDING**。理由见 P1。
7. **真实 CloudBase = PENDING**。本端零云操作，CAS、租约时钟、网络回执、双实例、索引与大数据量均未验。

## 7. 剩余风险与缺口

**P1-1（活性未闭环，最重要）**：`DEFERRED`（非纯 LOCK_BUSY）批次永久阻断且**没有修复入口**——`repairPurgeBatch` 只接受 PARTIAL/FAILED，闸门要求 `outcomes.DEFERRED===0`。触发条件在真实运营下可达：`needsMark>0`（存在超过截止日仍 pending 的投稿）、`skipped`（状态在读取后变化）、`conflicts`、`deferredAudit` 任一出现即写 DEFERRED。探针 P2.2 证明锁释放后连续两次仍 `AUDIT_GATE_BLOCKED`；D7 也把这一行为写成断言。→ **T-2 上线前必须给出"DEFERRED 的可证明恢复路径"，否则一次瞬时冲突/`needsMark` 就会让清理永久停摆。**
- **P1-2**：跨文档全局审计屏障仍未解决，生产 purge 继续关闭——本轮未改变这一点（判定 PENDING 的直接原因）。
- **P1-3**：历史无清单批次不可修复（设计如此），现实中若已产生此类批次，只能人工取证。
- **P2-1（可运维性）**：`repairPurgeBatch` 需要**原始 `batchId`**，但对账输出只给 `batchRef`（`batchId` 的 sha256 前 24 位，`:1335-1340`）；API 表面无法从"看到的 batchRef"推导回 `batchId`，运维只能去数据库控制台读日志。设计文档未写明获取路径。
- **P2-2（测试缺口）**：M2 变异存活——"未清正文记录 rev 漂移应拒绝修复"这条实现约束没有用例覆盖。
- **P2-3（覆盖存疑）**：T3.5 时期的 `tools/test_retention_scan_queue.js`（24 项）在当前工作区**不存在**，T3.6/T3.6.1 报告均未说明删除或合并去向；其覆盖（扫描队列/截断/空扫描）是否被 `reconcile 30` 与 `audit_gate 16` 完全继承，无法从报告确认。
- **P3-1（证据卫生）**：M1 实测 5 项 FAIL，报告写 4 项；不影响结论，但计数应精确。
- **P3-2**：真实云端的日志访问权限/清单泄露风险（清单含投稿 ID、无正文）设计已提示，仍 PENDING。

## 8. 边界声明

只读：未修改 `项目/` 任何文件；未 `git add/commit/reset/checkout/stash`；未调用、部署、删除云函数，未改云端数据/权限/索引/环境变量；未处理真实投稿、未动 `verifyStatus`、未解除 W2-04 §8.3、未生成正式产物。探针与变异副本只在 `%TEMP%`（`t361_probe.js`、`cf361_*`）。
