# DSH｜T3.6.2 Retention DEFERRED 与批次恢复 · 独立验收

日期：2026-10-30　审查人：DSH（只读，非实现者）
对象：`报告/Codex_T3.6.2_Retention_DEFERRED与批次恢复_20261030.md`（7,587 B）、`报告/Codex_T3.6.2_精确差异_20261030.patch`（47,229 B）、`报告/Codex_T3.6.2_最终回归原始输出_20261030.txt`（111,386 B）及当前源码/测试/schema/设计文档。
方式：逐行读源码、读四份新测试、**自写探针 14 组**（不跑其测试断言）、隔离副本 5 组变异、实跑 24 个套件、核对备份与 Git。未修改项目文件、未执行 Git 写、未触云。

---

## 1. 结论

| 判定项 | 结论 |
|---|---|
| DEFERRED 分类 | **PASS**（needsMark / LOCK_BUSY / RETRY_AFTER / CAS 四类已正确分流） |
| 可重试延期 | **PASS**（零写入 → 到期修复 → 重新对账 → 正常清理） |
| 审计阻断 | **PASS**（audit.pending 阻断且正文逐字节不变） |
| 批次级修复 | **PASS（PARTIAL/FAILED/DEFERRED_RETRYABLE）／FAIL（DEFERRED）** |
| rev 漂移保护 | **PASS**（拒绝修复，变异可检出） |
| 运维批次发现 | **PASS（本地）／PENDING（真实数据库分页语义）** |
| 历史测试覆盖（T3.5 24 项） | **PENDING**（原文件不存在，无法核） |
| B/E/F 回归 | **PASS**（本地全绿） |
| 生产入口失败关闭 | **PASS** |
| **整体 T3.6.2** | **FAIL**——核心目标"永久阻断真正解决"未达成 |
| 真实 CloudBase | **PENDING**（单独判定，不因本地通过而改变） |

**一句话**：needsMark 毒化、LOCK_BUSY 误杀、CAS/RETRY_AFTER 可重试这三类确实修好了；但 `skipped`、`audit.pending` 等产生的 **普通 `DEFERRED` 仍无任何恢复入口**，且 `recoverPending` 修好审计之后**旧批次依然永久挡住后续清理**。T3.6.2 把"永久阻断"的范围缩小了，没有消除。

---

## 2. 必须复现的十条（自写探针，全部独立于 Codex 测试）

| # | 流程 | 实测 | 判定 |
|---|---|---|---|
| 1 | needsMark → mark → recover → purge | `needsMark=1` 但批次 `COMPLETE/OK`、`purged=1`、pending 正文保留；`markExpired` marked=1 → `recoverPending OK` → `reconcile OK` → 二次 purge `OK purged=1`，`status=expired`、`payload=null` | **PASS** |
| 2 | skipped → 无关记录照清 | `skipped=1 purged=1`，坏记录正文保留且写入 `retryAfter`，正常记录已清；**但批次 `DEFERRED`，下一次 `AUDIT_GATE_BLOCKED`，`repairPurgeBatch` → `REPAIR_EVIDENCE_INVALID`** | **PASS（单次）／FAIL（后续永久阻断）** |
| 3 | CAS conflict → 零更新 → 重试 | `conflicts=1 purged=0`，冲突时 `rev=1`、正文逐字节不变；`repair` → `REPAIRED`，再 purge `OK purged=1` | **PASS** |
| 4 | 不确定写入必须阻断 | `PURGE_PARTIAL`、`failed=1`、正文保留，下一次 `AUDIT_GATE_BLOCKED` | **PASS** |
| 5 | deferredAudit → recover → reconcile → 恢复 | audit.pending → `deferredAudit=1/PURGE_DEFERRED`；`recoverPending` → `OK recovered=1`；**`reconcile` 仍 `RECONCILE_DEFERRED`（历史 DEFERRED 批次）→ purge `AUDIT_GATE_BLOCKED`** | **FAIL** |
| 6 | PARTIAL → repair → reconcile → 正常 | 日志失败 → `PARTIAL auditFailedCount=1`；下一次触发恢复后 `repair` → `REPAIRED` → `reconcile OK` → purge `OK` | **PASS** |
| 7 | rev 漂移 → 拒绝修复 | `rev=2` → `REPAIR_EVIDENCE_INCOMPLETE`，`REPAIR_CONFIRMED` 数 0，正文保留 | **PASS** |
| 8 | batchRef → batchId 定位 | 对账输出 `batchRef=a5245911dc39667165b332de`；`discoverPurgeBatches` → `FOUND`、`batchId=p8`、`repairable=true` | **PASS** |
| 9 | 无清单历史批次不得强制解除 | 构造仅 prepare/complete、无 `selectedEvidence` 的旧批次 → `REPAIR_EVIDENCE_MISSING` | **PASS** |
| 10 | 锁释放失败不误动正文 | `afterLockAcquired` 抛错 → `failed=1`、正文保留、`rev=3`、锁 `released`；取锁后中断路径另由 T3.6.1 L6/L7 覆盖 | **PASS（离线）** |

---

## 3. 重点攻击（隔离副本，不碰项目文件）

| 攻击 | 结果 | 被谁抓住 |
|---|---|---|
| 将所有 DEFERRED 改为非阻断（同时放开 code/计数/批次三处） | **被抓住**，exit 1 | `t362_deferred D6`、`purge P9/P18`、`t361_deferred D7` |
| 删除修复中的 rev 条件 | **被抓住** | `t362_repair R1` |
| 删除修复证据摘要校验 | **被抓住** | `t362_repair R3` |
| 伪造 `REPAIR_CONFIRMED`（复制 prepare/complete 两个摘要） | **未被接受**：`rs=invalid`、`repaired=0`、`RECONCILE_ANOMALIES`、gate 仍阻断 | reconcile 的修复事件校验 |
| 只信任 `ok=true` | **被抓住** | `purge P17`、`audit_gate G-D2/G-E/G-F` |
| 删除 batchId 关联检查 | **未被抓住**，但无可利用路径 | 修复事件按 `purgeBatchLogId(batchId)` 派生 ID 读取，关联由文档 ID 本身强制 |

补充：单独篡改任一处 DEFERRED 接受逻辑**不会被抓住**（被 code 检查、计数方程、批次条件三层互相兜底），必须三层同时放开才红——这是纵深防御，不是测试空洞。

---

## 4. T3.5 原 24 项覆盖

- 全盘搜索 `test_retention_scan_queue*.js`：**0 个文件**（含 `备份/`、项目、报告）。
- 两份原始输出里只有 `T3.6.2 scan queue: 4 PASS / 0 FAIL`，没有任何 T3.5 二十四项的名称或结果。
- 结论：**PENDING**。Codex 自己的判定也是 PENDING，我确认其"不声称继承"的态度正确；但 T3.5 中与"空扫描、截断、扫描期插入、坏游标"无关的其余断言是否被替代覆盖，**不可核**。新 `t362_scan_queue`（4 项）只覆盖上述四类。

---

## 5. 回归（真实执行，全部 exit 0）

T3.6.2 四套件 7/4/5/4；T3.6.1 三套件 9/12/8；T3.6 三套件 15/7/15；T3.4 续扫 21；reconcile 30；purge 18；audit_gate 16；recover_pending 13；mark 71；ugc_review 86；ugc_submit 110；client_contract 90；pages 106；index_state 全通过；records_spec **290 PASS/0 FAIL/11 PENDING**；`check_eol` 65 文件 0 违规；`test_check_doc_refs` 51/0；`git diff --check` 0。原始输出保存在 `%TEMP%\t362_run.txt`（90,428 B）。

---

## 6. 备份、Git 与副作用

- 备份 `备份\T3_6_2_retention_20261030_233702_886\`：4 份改前文件哈希与报告表**逐项一致**（`C9BE61A1…`、`F381B6F7…`、`A98A9C1F…`、`4B1D6059…`）；当前文件亦与报告一致（`1B227760…`、`0461BC5E…`、`DBD4D02F…`、`F06FBC82…`）。
- `intermediate` 副本被如实标注为编写中间态（2,516 B），非开工原件。
- Git：`HEAD 274ebd6`、`main`、暂存 0、`--porcelain` 97、`-uall` 341（与报告 341 一致）。
- 云端调用/部署/索引/触发器/真实数据：**0**。生产 `main purge` 仍返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`（本次未复跑该断言，依据源码 `:1531-1533` 与 Gate 测试 G-L/G-M）。

---

## 7. 仍存在的风险（按严重度）

1. **P1｜普通 DEFERRED 无恢复入口**：`skipped`、`audit.pending`、`conflicts`（非 CAS_UNMATCHED）、`auditRecovery.deferred` 任一出现即写 `DEFERRED`；闸门要求 `DEFERRED===0`；`repairPurgeBatch` 只接受 PARTIAL/FAILED/DEFERRED_RETRYABLE → **永久阻断**（探针 2、5）。
2. **P1｜审计恢复后旧批次仍挡路**：`recoverPending` 成功（`recovered=1`）也不能让历史 `DEFERRED` 批次转为可接受，`reconcile` 持续 `RECONCILE_DEFERRED`（探针 5）。
3. **P2｜skipped 的可达性**：`rev` 非法或状态/正文在查询与处理之间变化（审核并发）即触发；一旦触发就是 P1。
4. **P2｜发现接口按页**：`completeScan` 仅在不截断且无游标时为真；首屏找不到返回 `NOT_FOUND_IN_PAGE`，运维需自行翻页，无"全局唯一"保证。
5. **P3｜空批次**：`selected=0` 时不写 prepare/complete（`scanQueue` 侧有 `SCAN_EMPTY` 保护，清理侧无此问题）。
6. **P3｜修复事件无操作者身份**：`repairOperator='system'` 为常量，无法区分是谁触发的修复（共享维护令牌）。

---

## 8. 五个明确回答

1. **本地 T3.6.2 是否 PASS？** —— **FAIL**（核心目标角度）。分类与可重试延期是 PASS，但"永久阻断"仍存在于 `DEFERRED` 分支，且审计恢复后无法自愈。
2. **是否存在 P0/P1 阻塞？** —— **有 2 个 P1**（第 7 节 1、2 条），无新增 P0；原有 P0（TOCTOU、生产入口）仍靠"关闭入口"兜底，未被本轮改变。
3. **哪些问题可在本地继续解决？** —— 给 `DEFERRED` 增加"零写入可证明"的恢复事件（如 `RESUMED_EMPTY`/`SKIPPED_RECHECK`），或让 `recoverPending` 成功后的历史 `DEFERRED` 批次自动转 `DEFERRED_RETRYABLE` 并按到期重试；两者都需作者裁决语义，不是纯测试问题。
4. **是否具备进入云端预检的条件？** —— **不具备**。任何清理动作都必须先在本地把 `DEFERRED` 死路打通；否则云端一旦出现一次 `skipped`/`audit.pending`，清理就永久停摆。
5. **仍需负责人授权的事项** —— ①确定 `DEFERRED` 的恢复语义（是否允许"重检后清零"事件）；②真实 CloudBase 的隔离环境与只读查询；③是否允许建立触发器/调度（当前无 `config.json`）；④索引落地（4 条 retention 索引仍为本地草案）。

---

## 9. 未做与限制

- 未验证真实云端条件更新、`_id gt` 排序、多值 IN 排序、索引命中。
- 未做真实双实例并发（假库单线程），跨实例互斥仍是"设计未验"。
- 未复原 T3.5 原 24 项，故其覆盖不可核。
- 探针只在 `%TEMP%` 与本报告的隔离副本中运行；项目文件零修改。
