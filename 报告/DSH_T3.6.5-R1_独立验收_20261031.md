# DSH：T3.6.5-R1 独立验收

- 验收对象：`报告/Codex_T3.6.5_Retention_最终闭环_20261031.md`（10,275 B）、`Codex_T3.6.5_精确差异_20261031.patch`（41,071 B）、`Codex_T3.6.5_最终回归原始输出_20261031.txt`（112,869 B）、`报告/T365_evidence_20261031/seven_artifacts_manifest.json`
- 被验代码：`cloudfunctions/retention/index.js` 108,172 B / `33E3863DC5D8760F…`；`config/cloud/schema.upload_logs.json` 4,940 B；`config/cloud/schema.submissions.json` 9,419 B；`docs/RETENTION_T365_DESIGN_20261031.md` 4,013 B
- 基线：`HEAD 274ebd6`、`main`、暂存 0、`git status --porcelain` 104 行、`-uall` 350 行
- 执行时间：2026-10-31 15:0x（Asia/Shanghai）
- 方式：只读验收；项目文件零修改；云端零操作；Git 零写入

## 一、判定总表

| 编号 | 项目 | 判定 | 主要依据 |
|---|---|---|---|
| ① | 真实 skipped | **PASS** | 独立造 `rev:0`，`purge` → `PURGE_DEFERRED(skipped=1)` → `dispose` → `RESOLVED_DEFERRED` → 下一轮 `purge OK purged=1`，payload=null |
| ② | 外部修改恢复 | **PASS** | `RECORD_ABSENT` / `ALREADY_CLEARED` / `NO_LONGER_ELIGIBLE` / `REQUEUED_CURRENT_REV` 四类均可 disposition，`reconcile ok:true、resolvedDeferred:1` |
| ③ | 记录级隔离 | **PASS** | 隔离批 disposition 后，其他合格记录在下一轮被清理（`purged=2`）；`NO_LONGER_ELIGIBLE` 记录保持 payload 不被清 |
| ④ | 审计不可变 | **FAIL（P1）** | 原始 prepare/complete 逐字节不变、只追加 1 条 resolution ✔；但**篡改 resolution 的 `items[].reasonCode` 后 `reconcile` 与 `purge` 均不报错**，seal 从不校验 ✘ |
| ⑤ | 计数闭合 | **PASS（附 P2）** | 不变量都成立；但 resolution 无 `exclusions/excludedCount`，全排除批次也写 `unresolvedCount:0`、`code:'DEFERRED_RESOLUTION'`，批次级无法区分"验证通过"与"排除" |
| ⑥ | 原有回归 | **PASS** | 32 个脚本全部 exit 0（3 个 t365 + 29 个既有）；`test_records_spec` 290/0/11、`check_eol` 67 文件 0 违规、`test_check_doc_refs` 51/0、`git diff --check` 0 |
| ⑦ | 生产入口关闭 | **PASS** | `main({action:'purge'})` → `PURGE_GLOBAL_FENCE_UNVERIFIED`；`disposeDeferredBatch` 无维护令牌 → `FORBIDDEN`；`purgePayload` 不导出 |
| ⑧ | **整体 T3.6.5-R1** | **FAIL** | 存在 1 项 P1（④），按"发现 P1 不得整体 PASS" |
| ⑨ | 真实 CloudBase | **PENDING** | 无隔离环境、未部署、未建索引、未执行任何云端查询 |

## 二、第一组：真实 skipped

独立脚本（真实模块 + fake cloud，不跑其测试）：

1. 写入一条合法 `rev:0` 的到期记录（这是真实世界里唯一能通过查询、却在 `markExpired` 里被判 `skipped` 的形状）。
2. `purgePayload` → `{"code":"PURGE_DEFERRED","purged":0,"skipped":1}`；prepare 的 `selectedEvidence[0].rev = 0`；complete 的 `deferredReasons[0] = {reasonCode:'SKIPPED_RECHECK', originalRev:0, observedRev:1, revBefore:0, revAfter:1}`。
3. `resolveDeferredBatch({batchId, disposition:true})` → `RESOLVED_DEFERRED`，`unresolvedCount:0`。
4. `purgePayload({now: now+61s})` → `{"code":"OK","purged":1}`，记录 `payload=null`。
5. 再次 resolve → `ALREADY_RESOLVED`。

结论：**上一轮的 P1（真实 skipped 不可能恢复）已消失**，且恢复后重新进入普通清理。

## 三、第二组：外部变化

| 场景 | 构造 | disposition 结果 | 记录终态 |
|---|---|---|---|
| ① 外部改后仍可清 | `rev+1`、status 仍 expired | `REQUEUED_CURRENT_REV` → `retryDeferredAttempt` 写 `nextBatchId` 并签名 | 下一批被正常清理 |
| ② 外部改后不可清 | `rev+1`、status=pending | `NO_LONGER_ELIGIBLE` | payload 保留；pending 期间不被清 |
| ③ 外部删除 | 删除文档 | `RECORD_ABSENT`（`confirmedAbsent:true`、`observedRev:null`） | 无正文可清 |
| ④ 无法解释的 rev 漂移 | revocation 与观测不符 | `DEFERRED_RECORD_CHANGED`（阻断） | 不 disposition |

四类 disposition 之后，`reconcileBatches` 都返回 `ok:true、code:'OK'、resolvedDeferred:1`；隔离记录在隔离期间 `payload` 不变。
**隔离后继续工作**：同一批"1 条 skipped + 1 条正常"里，首批 `purged=1/skipped=1`；disposition 后 reconcile OK；新增记录再 purge → `OK purged=2`，两条 payload 均为 null。

## 四、第三组：审计真实性

- **历史日志不可变**：disposition 前后，prepare/complete 两条日志的 `JSON.stringify` 逐字节相等；新增日志恰 1 条（resolution）。
- **只追加**：二次 disposition 返回 `ALREADY_RESOLVED`，不新增日志。
- **隔离事件关联**：resolution 的 `stats` 含 `prepareId`/`completeId`/`batchRef`/`manifestHash`/`deferredDigest`，与批次一一对应。
- **RESOLVED_WITH_EXCLUSIONS 不能冒充 OK**：代码中不存在该状态——全排除批次也写 `DEFERRED_RESOLUTION`、`unresolvedCount:0`，reconcile 直接 `OK`。排除信息只在 `items[].reasonCode`，批次级无计数字段。判 **P2**（与需求措辞不符，属审计可读性缺陷，不构成绕过）。
- **不确定写入继续阻断**：`setFail({collection:'submissions',op:'get'})` → `BLOCKED_UNCERTAIN`，无 resolution，记录不变。
- **重新对账不可绕过**：resolve 内部强制 `reconcileAfterRepair`，失败 → `DEFERRED_RECONCILE_BLOCKED`；但见下方 P1/P2D。

## 五、第四组：攻击测试

在 `%TEMP%` 项目副本上改源码（不动项目）：

| 攻击 | 结果 |
|---|---|
| 删除 rev 一致性检查 | 3 个 t365 测试**全绿**（未覆盖）；`test_retention_t363_deferred_resolution` 变红 → 旧套件兜底 |
| 删除隔离证据（attempt `eventId` 降级为 `completeId`） | `t365_unrecoverable`、`t365_repair_regression` 变红 → 抓住 |
| 伪造隔离事件（写时不带证据） | 3 个 t365 测试中 2 个变红 → 抓住 |
| 所有 DEFERRED 当成功 | 3 个 t365 全绿；`test_retention_reconcile`、`test_retention_t361_deferred` 变红 → 兜底 |
| 跳过重新对账（resolver 直接 `ok:true`） | **11 个 retention 测试全绿，无任何测试抓住** → 测试缺口 |
| 重复提交恢复凭证 | `ALREADY_RESOLVED`，不重复写日志 → 安全 |

**P1（新发现，代码级）**：resolution 事件里的 `items[].reasonCode` 被改写后（`REQUEUED_CURRENT_REV` → `ALREADY_CLEARED`），`reconcileBatches`（普通与 `resumable:true`）都返回 `ok:true、invalidLogs:0`，随后 `purgePayload` 也 `OK`。resolution 的 `seal` 是 64 位十六进制、存在，但 `batchLogInfo` **从不校验 resolution 的 seal**。也就是说：写时伪造会被抓，**写后篡改不被发现**。

## 六、第五组：回归

32 个脚本全部 `exit 0`：

- 新增：`t365_skipped_recovery`、`t365_unrecoverable`、`t365_repair_regression`
- T3.6.3 及更早：t363（8/8/10）、purge 18、reconcile 30、audit_gate 16、mark 71、recover_pending 13、t34_resume 21、t36（15/7/15）、t361（9/12/8）、t362（7/4/5/4）
- 周边：`ugc_review`、`ugc_submit`、`ugc_client_contract`、`index_state`、`pages`、`check_eol`（67 文件 0 违规）、`test_check_doc_refs`（51/0）、`test_records_spec`（290/0/11）、`test_verify_data`、`verify_data`
- `git diff --check` exit 0（仅 `project.config.json` 的 CRLF 提示）

## 七、遗留问题

**P1**
1. 隔离事件（resolution）的 `seal` 从未校验：写后篡改 `items[].reasonCode` 不被发现，`reconcile` 与 `purge` 均放行。这是"审计真实性"的实质缺口，必须在闸门前校验 resolution seal 并覆盖篡改用例。

**P2**
1. 无排除计数/状态：全排除批次与正常恢复在批次级不可区分（`unresolvedCount` 恒 0、无 `exclusions` 字段）。
2. 新测试未覆盖"删 rev 检查"与"跳过重新对账"两种回退；前者靠旧测试、后者无人抓。
3. `seal` 使用 `UGC_RETENTION_TRIGGER_TOKEN` 派生 HMAC——持有令牌者（运维）可重算，属"防意外/防误写"而非"防恶意"，设计文档应写明信任边界。
4. 报告称 6 组反事实变异，我独立只复核到 4 组对应变异（rev0 拒绝、absence、密封、重试扫描守卫），其余未在原始输出中体现可复现命令。

## 八、副作用与状态

- 项目文件：**零修改**（`retention/index.js` 仍 108,172 B / `33E3863D…`；Git 104/350 未变）
- 临时脚本：仅 `%TEMP%`（`dsh_t365r1_*.js`），非项目文件
- 云端：0 调用 / 0 部署 / 0 索引创建 / 0 数据读写
- Git：未 add/commit/reset，`git diff --check` 0

## 九、结论

- 真实 skipped：**PASS**；外部修改恢复：**PASS**；记录级隔离：**PASS**；计数闭合：**PASS（附 P2）**；原有回归：**PASS**；生产入口关闭：**PASS**
- 审计不可变：**FAIL（P1）** → **整体 T3.6.5-R1：FAIL**
- 真实 CloudBase：**PENDING**（需隔离环境、部署、建索引、只读查询与真实并发验证）

修复建议顺序：①在 `checkPurgeAuditGate`/`reconcileBatches` 读入 resolution 时重算并校验 `seal`，篡改即 `invalidLogs`/`RECONCILE_ANOMALIES`；②给 resolution 增加 `exclusions` 计数与独立状态码；③为"删 rev 检查""跳过重新对账"各补一条能变红的用例。
