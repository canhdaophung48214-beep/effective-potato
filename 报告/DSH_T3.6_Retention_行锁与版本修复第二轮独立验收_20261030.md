# DSH｜T3.6 Retention 行锁与版本修复 · 第二轮独立验收（2026-10-30）

审查人：DSH（独立审查，非实现者）。方式：只读 + 仓库外隔离副本探针/变异。**未修改任何项目文件**（本报告是唯一新增文件，位于项目外 `报告/`）；未执行 Git 写操作；未部署、未调用云函数、未建索引、未读写云端数据。

## 1. 结论摘要

Codex 的 T3.6 交付物**已齐备**（报告、三份测试、设计文档、精确 diff、原始输出、备份）。独立复核后：

- **A 并发安全 = PENDING**。行锁/租约/fencing 的**单文档**保护在本地成立（我独立探针 12/12 通过），但**跨文档的全局审计屏障没有被解决**——Codex 的做法是**把生产清理入口整体关闭**（`main purge` 与普通 `purgePayload` 一律返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`，读库前返回）。这消除了 T3.4 实测的 TOCTOU，但代价是 T-2 生产清理不可用。**不得判 PASS**。
- **B 版本一致性 = PASS（本地）**，云端 CAS 语义单列 PENDING。所有 retention 投稿写路径均以旧 `rev` 条件写 `rev+1`（8 处 DB update 逐条核对），锁操作也递增 rev。
- **C 精确扫描范围 = PASS（本地）**。`scanId` + `initialCount` + 水位/游标，末尾总数复核不一致即 `SCAN_CHANGED`、`completeScan=false`；我的独立探针（1001 条分 3 页、中途插入更小 `_id`）按预期失败关闭。
- **D 历史异常修复 = PENDING**。只做了"安全阻断"：无 force/ignore，原始日志不变；**正向修复未实现**（缺少原批次选中记录的不可变清单）。Codex 自己也没有声称完成。
- **E 分页续扫 = PASS（本地）**。15/15 + 我的独立 1001 条探针；续扫结果不进入生产 purge 放行。
- **F 测试有效性 = PASS（本地）**。我独立做了两项变异：去掉 fencing 条件 → `C15` 红；去掉末尾计数复核 → `S1/S2/S6` 红。旧基线（46,633 B）跑新测试：并发测试 `C2` 先红后 TypeError，续扫 4 PASS/11 FAIL。
- **整体 T3.6 = PENDING**。原因不是测试不绿，而是 A 的全局屏障与 D 的正向修复都未闭环，且生产清理入口被关闭。
- **真实 CloudBase = PENDING**（单独判定，见 §9）。

**新发现（P1，Codex 报告未列）**：**一次瞬时锁冲突就会永久阻断后续清理**。`hasDeferred` 把 `LOCK_BUSY`/`conflicts` 计入 → 批次写 `DEFERRED`；闸门要求所有历史批次 `outcome=OK`；批次日志只追加、无批次级修复入口（`recoverPending` 只处理 `audit.pending`）。我的探针 L1–L5 完整复现：预置他人持锁 → 本次 `PURGE_DEFERRED`（正文未清）→ 释放锁后再跑 → `AUDIT_GATE_BLOCKED` 永久成立。这是"安全但不可恢复"的活性缺陷，启用生产 purge 前必须解决。

## 2. 验收对象与哈希

| 对象 | 字节 | SHA-256（前 16 位） | 时间 |
|---|---:|---|---|
| `报告/Codex_T3.6_Retention_P1三项完整闭环_20261030.md` | 87,431 | `4A79FBB1782652A3` | 12:41:55 |
| `报告/Codex_T3.6_精确差异_20261030.patch` | 70,840 | `D9073D38525B00AB` | 12:39:12 |
| `报告/Codex_T3.6_回归原始输出_20261030.txt` | 107,294 | `92375286F3FE5027` | 12:39:02 |
| `cloudfunctions/retention/index.js` | 56,114 | `255686A5077214D1` | 12:36:26 |
| `config/cloud/schema.submissions.json` | 9,152 | `E7B4A9DCC4067A4F` | 12:29:59 |
| `docs/RETENTION_T36_DESIGN_20261030.md` | 8,009 | `87C27184FFE64420` | 12:36:37 |
| `tools/test_retention_t36_concurrency.js` | 9,298 | `DD22F2806C2EE182` | 12:37:35 |
| `tools/test_retention_t36_repair.js` | 5,722 | `5B61D15A8A635C67` | 12:33:49 |
| `tools/test_retention_t36_resume.js` | 5,627 | `56BE1628C8908707` | 12:32:17 |
| `tools/test_retention_purge.js` | 9,335 | `4B1D6059F93DB01B` | 12:35:21 |
| `tools/test_retention_audit_gate.js` | 10,670 | `C3A8C7B65A016E66` | 12:28:39 |

**备份完整性**：`备份\T3_6_retention_20261030_122422_918\manifest.txt` 10 条记录，逐条 `split('|')` 重算字节数与 SHA-256，**10/10 一致**（哈希为大写，比较时需忽略大小写）。`counterfactual/` 子目录与备份本体分离，未混用。

## 3. 基线

| 项 | 值 |
|---|---|
| Git | `HEAD 274ebd6`、`main`、暂存 0 |
| porcelain | 90 行 |
| porcelain `-uall` | 332 行（15 tracked 修改 + 317 未跟踪） |
| 冻结件 | `test_records_spec.js` 337,743 B `0CB19A13…`；契约 256,751 B `CA18C91E…`；`gen_records.js` 144,262 B `5B349419…`；`id-map.json` 42,990 B `4478C976…`；`ID_MAP_T48_T49.json` 37,741 B `40642870…`；`approvals/ap-20261025-01.json` 1,894 B `F2B909B7…`；`init-plans/ip-20261025-01.md` 20,597 B `5B7AEC94…` —— 均未变 |

## 4. A–I 逐项

### A. 跨实例写入保护（不是单文档 CAS）

- **单文档层**：`acquirePurgeLease`（`:355-388`）以 `where({_id,status,rev,payload≠null})` 写 `retention.purge.lock`（state/owner/fencingToken/leaseExpiresAt）并 `rev+1`；租约未过期且状态 held → `LOCK_BUSY`；过期后接管 `fencingToken+1`。`changePurgeLease`（`:390-419`）的释放/续租条件含 `owner`+`fencingToken`+`state=held`+`rev`。清正文（`:617-627`）条件额外含 `lock.owner`/`lock.fencingToken`/`lock.state=held`，并用点路径保留锁元数据。
- **跨文档层**：`purgePayload` 第一行（`:535-537`）在**读策略/读库之前**要求模块内私有 `Symbol`；否则返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。`main` 的 `purge`（`:1101-1103`）同样直接返回该码。即：**生产入口没有任何路径能清正文**。
- **结论**：单文档并发保护本地成立；全局屏障未实现，靠"关闭入口"兜底。**A = PENDING**（不是 PASS，也不是 FAIL：实现方明确选择了失败关闭，且报告自述不得据此上线）。

### B. rev 版本规则

- 8 处 DB `update` 逐条核对：`:149`（审计确认）、`:191`（审计退避）、`:325`（清理审计确认）、`:346`（清理退避）、`:382`（取锁）、`:414`（续租/释放）、`:622`（清正文）、`:715`（标记过期）——全部带 `rev: <old>+1` 且 where 带旧 rev；冲突不写虚假成功。
- `markExpired` 把 `status→expired` 与 `retention.audit.pending` **同一次条件更新**写入（`:713-727`）。
- 测试 C5/C7/C11/C12/C13 覆盖"续租/释放递增 rev""他处改 rev 后旧实例失败""审计退避 rev+1"，实测通过。
- **B = PASS（本地）；云端 CAS 语义 PENDING。**

### C. 精确扫描范围

- `reconcileBatches`（`:895+`）：`scanId`（`:927`）、`initialCount` 基线（`:936`）、水位 `upperId`、`scanScope`（`scanId/scanStartedAt/highWaterMark/initialCount/...`）；末尾总数复核（`:989-992`）不一致 → `SCAN_CHANGED`、`completeScan=false`。
- 我的独立探针：1001 条、`pageSize=50/maxRows=500` → 第 1 页 `SCAN_TRUNCATED, scanned=500, completeScan=false`；中途插入 `_id='0000a'` 后继续翻页至结束 → `SCAN_CHANGED`、`initialCount=1001`、3 页。**符合预期**。
- **C = PASS（本地）；真实索引/排序 PENDING。**

### D. 历史 FAILED/PARTIAL 修复

- 代码内 `force|ignore|skipHistory|bypass` grep **0 命中**；`recoverPending` 仅针对 `retention.audit.pending` 补记，不能把历史 `FAILED/PARTIAL` 批次改成成功。
- `test_retention_t36_repair.js` 7 项：H1/H4/H6 明确断言"无证据不得修复""不得伪造已修复"；H3/H7 只覆盖逐条审计补记。
- Codex 报告 §1/§8 自述"正向修复 PENDING"。
- **D = PENDING。**

### E. 分页续扫

- 15 项测试全过；我的独立探针补充 1001 条 3 页 + 中途插入两类（更小/更大 `_id`）路径中的"更小"分支；`SCAN_CHANGED` 判定成立。
- 续扫 `completeScan` 不被 `checkPurgeAuditGate` 接受（闸门仍独立重扫），避免"诊断结果冒充放行凭据"。
- **E = PASS（本地）。**

### F. 测试有效性

- 我独立做的两项变异（隔离副本，项目未被修改）：
  - 删除清正文条件中的 `'retention.purge.lock.fencingToken': token` → `test_retention_t36_concurrency` **14 PASS / 1 FAIL（C15 红）**，exit 1；
  - 把末尾计数复核改成恒假 → `test_retention_t36_resume` **12 PASS / 3 FAIL（S1/S2/S6 红）**，exit 1。
- 旧基线（`备份\...\cloudfunctions__retention__index.js`，46,633 B）跑新测试：并发测试 `C2` 红后 `T.acquirePurgeLease is not a function`；续扫 **4 PASS / 11 FAIL**，exit 1。
- **F = PASS（本地测试对目标缺陷有区分力）。**

### G. payload 不变性

- 闸门阻断（DEFERRED/PARTIAL/FAILED/超时/截断）、锁冲突、CAS 失败、日志失败路径均不写 `payload`；我在 P3 探针中断言"被阻断时正文逐字节不变"，通过。
- 唯一的正文清除发生在 `:622`，且要求 6 个条件同时成立（含 rev/owner/fencingToken/state/payload≠null）。
- **G 部分并入 A/D；本地证据成立，云端未验。**

### H. fake DB 与真实 CloudBase

- Codex 报告 §1/§8 明确写"单进程假数据库的条件更新模拟""不证明 CloudBase 真实并发原子性""不得因离线测试全绿启用生产 purge"。
- 未发现"把 fake DB 结果冒充云端证据"的表述；`_meta.status` 仍为本地草案。
- **H = PASS（证据分级诚实）。**

### I. 副作用

- 未部署、未建索引/触发器、未改云端；无真实投稿处理；`verifyStatus` 未动；冻结生成器/主套件/契约/审批/计划文件哈希全等；无 Git 写（`add/commit/reset/checkout/stash` 均未执行）；`git diff --check` 0。
- **I = PASS。**

## 5. 独立探针（我的脚本，`%TEMP%，12 项全 PASS`）

| # | 断言 | 结果 |
|---|---|---|
| P1 | `main({action:'purge'})` 返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`，且**零 DB 调用** | PASS |
| P2 | 模块不导出 `purgePayload`（只能经 `__test__` 私有 Symbol） | PASS |
| P3 | 干净批次离线模拟放行 `OK`；把 COMPLETE 改造成 DEFERRED 后 → `AUDIT_GATE_BLOCKED`，正文逐字节不变 | PASS |
| P4 | 取锁 token=1；租约过期后接管 token=2；旧实例释放 → `LOCK_LOST`；正文未动 | PASS |
| P5 | 1001 条首页 `SCAN_TRUNCATED/completeScan=false`；中途插入更小 `_id` 后翻页结束 → `SCAN_CHANGED`、3 页 | PASS |

（探针初版曾因我把 `pageSize` 设成 500 越界、把日志 `phase` 读在顶层而误报 4 FAIL，修正后 12/12 通过；误报已如实记录。）

## 6. 独立复算的回归矩阵

全部 exit 0：`t36_concurrency` 15/0、`t36_repair` 7/0、`t36_resume` 15/0、`purge` 18/0、`audit_gate` 16/0、`mark` 71/0、`reconcile` 30/0、`recover_pending` 13/0、`t34_resume` 21/0、`ugc_review` 86/0、`ugc_submit` 110/0、`ugc_client_contract` 90/0、`check_eol` 63 文件 0 违规、`test_check_doc_refs` 51/0、`test_records_spec` 290/0/11（PENDING 未转 PASS）、`test_pages` 106/0、`test_index_state` 205/0、两份 schema JSON 解析 OK、`git diff --check` 0。

## 7. 新发现：批次级 DEFERRED 造成不可恢复的阻断（P1）

**机制**：`purgePayload` 的 `hasDeferred` 含 `deferredRetry`（锁被他人持有）与 `conflicts`（CAS 冲突）→ 写 `complete` 批次 `DEFERRED`；闸门 `completeAuditReconcile` 要求所有历史批次的 `counts.outcomes` 除 `OK` 外全为 0；批次日志只追加、没有"批次级修复"入口，`recoverPending` 只补 `audit.pending`。

**实测（探针 L1–L5）**：

```text
L1 预置他人持锁成功 (token=1)
L2 本次 purge → PURGE_DEFERRED, deferredRetry=1, 正文未清
L3 释放租约成功
L4 再次 purge → AUDIT_GATE_BLOCKED (reason=INCOMPLETE_OR_ANOMALOUS), 正文未清
L5 recoverPending → OK，但再次 purge 仍 AUDIT_GATE_BLOCKED
```

**影响**：生产一旦启用，**一次瞬时锁冲突 = 清理永久停止**（安全但不可用）。Codex 把它当作安全特性（"DEFERRED 未审清前阻断"）记录，但没有给出恢复路径；D 的正向修复正是这个缺口。**T-2 上线前必须同时解决"批次级可修复"**，否则只能靠人工改日志（违反只追加原则）。

**次要**：清正文后若 `releasePurgeLease` 失败，记录 `payload=null` 但锁残留 `held`；后续候选查询过滤 `payload≠null` 不会再选到它，锁只能等自然过期（无安全影响，但审计上会看到"永久 held"）。

## 8. 判定汇总

| 判定项 | 结果 | 依据 |
|---|---|---|
| A 并发安全 | **PENDING** | 本地行锁/fencing PASS；全局屏障未实现，生产入口整体关闭；不得据此判 PASS |
| B 版本一致性 | **PASS（本地）/ PENDING（云端）** | 8 处写路径 rev+1 + 条件；云端 CAS 未验 |
| C 精确扫描范围 | **PASS（本地）/ PENDING（云端）** | scanId/initialCount/水位/末尾复核；探针通过 |
| D 历史异常修复 | **PENDING** | 仅阻断，无正向修复，缺不可变证据 |
| E 分页续扫 | **PASS（本地）/ PENDING（云端）** | 15/15 + 1001 条探针 |
| F 测试有效性 | **PASS（本地）** | 两项独立变异红；旧基线红 |
| 整体 T3.6 | **PENDING** | A、D 未闭环；不得启用生产 purge |
| 真实 CloudBase | **PENDING** | 未执行任何云端验证（条件更新原子性、索引/排序、租约时钟、回执不确定、请求大小） |

## 9. 真实 CloudBase 的独立结论

本端**没有**接触云端，因此只能给出静态判断：CloudBase 事务只支持 `doc`、不支持 `where`，`wx-server-sdk ~2.6.3` 的条件更新语义、`serverDate` 单调性、点路径嵌套写、缺失字段排序、`_id` 水位、续扫凭据大小、网络回执不确定与两实例并发**均未验证**。这些必须放进隔离云环境的预检，且不能用本地假库结果替代。

## 10. 边界声明

- 只读审查；项目内文件零修改（本报告在项目外 `报告/`）；
- 未执行任何 Git 写操作；未部署/调用云函数；未创建索引；未读写云端数据；未处理真实投稿；
- 未修改 `verifyStatus`、未解除 W2-04 §8.3、未生成正式产物、未清理既有备份或临时目录；
- 隔离副本与探针只存在于 `%TEMP%`（`t36mut`、`t36probe`），未写入项目。

## 11. 下一步最小条件（不是执行计划）

1. **A**：要么设计可证明的全局屏障（事务/串行执行/持久 fencing），要么保持入口关闭并明确"T-2 不可上线"；不得用行锁冒充全局屏障。
2. **D/P1**：给出批次级"仅凭证据修复"的机制（不可变原批次清单 → 幂等补记 → 修复后重新对账），并解决 DEFERRED 永久阻断。
3. **云端**：取得隔离环境后，按 C/B 的未验证项逐条实测，再谈放行。
