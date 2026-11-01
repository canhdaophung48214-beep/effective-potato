# R-3 Retention 批次审计与孤儿 prepare 对账：本地实施与验收

日期：2026-10-29。**本地实施与离线回归 PASS；真实云端索引/排序/并发、超过单次扫描上限的全局对账 PENDING。** 交 DSH 独立复核；本报告不把假数据库当成云端验收。

## 1. 现状、范围与最小差异

开工前已读四份指定的 DSH 独立报告和当前源码。实际文件是 `项目/config/cloud/schema.upload_logs.json` 与 `schema.submissions.json`，不是指令中的泛称 `schema/upload_logs.json`。`项目/cloudfunctions/retention/index.js` 原有 `mark`/`purge` 的 prepare/complete 和逐条稳定事件；`recoverPending`/内部 `recoverPurgePending` 仅有逐条补记，日志写入失败、中断可产生 prepare 无 complete；`upload_logs` schema `appendOnly` 禁止 update/remove。原有索引只有 `ix_event_day(event,day)`，不能由该声明证明按事件与 `_id` 续页可用。

最小差异：①在恢复批次复用现有 retention_mark/retention_purge 日志，增加 `operation`、prepare/complete 与互斥计数；②新增维护令牌保护的只读 `reconcile`，按事件分别做有界 `_id` 续页；③只在本地日志 schema 声明 `(event,_id)` 索引并在 §3.5.2 明确 10 分钟阈值与截断语义；④给假数据库补 `gt`、新增独立测试，并把 R1 旧测试的日志失败注入从新增 prepare 后移到逐条日志，不降低断言。未修改 `schema.submissions.json`、冻结主套件或历史审计快照。

## 2. 备份与修改文件

修改前在**项目及 Git 仓库外**新建 `C:\Users\25975\Desktop\食神寻味小程序开发\备份\R3_retention_reconcile_20261029_20261029T0748217606981Z`。逐文件复制后进行字节数组逐字节比对并验证 SHA-256；未覆盖旧备份。新增测试无修改前原件。

| 项目文件 | 修改理由 | 备份名 | 改前 B / SHA-256 | 改后 B / SHA-256 |
|---|---|---|---|---|
| `cloudfunctions/retention/index.js` | 恢复批次审计、只读对账、严格分类 | `cloudfunctions__retention__index.js` | 25238 / `45F304842FA500441BFC28FDA1A4BCE619E02A6038D55F46C53EC7CE84EAE693` | 36615 / `7644D3F8134174E2D7F5273172329A8117649DC0FB453B711DE18CA479BA1383` |
| `tools/ugc_fake_cloud.js` | 离线模拟 `_id > cursor` | `tools__ugc_fake_cloud.js` | 10483 / `853970B2BEFD31C4233CEC95385661AFD9E7AA5F7AA39FF759EC86DF4412FC96` | 10656 / `B8A4F2A28A99E8A397BC41182D28B17DBE25C55A311CA48E8444E99299B6E13B` |
| `tools/test_retention_recover_pending.js` | 旧 R4 故障注入继续命中逐条日志 | `tools__test_retention_recover_pending.js` | 7043 / `F44BDA77C359A5243CFCD2DA559EB5D01BEDD820725580BFA0E3DE147E871FE8` | 7118 / `E7B8E24042AA54FB682FBCF2711F0D91FF859A651B78D753B61BFA805BF7BCB9` |
| `config/cloud/schema.upload_logs.json` | 说明批次 stats、声明本地对账索引 | `config__cloud__schema.upload_logs.json` | 3499 / `958A128870B15A15F5F5FA1336B51D055F8AA117F3310F2E481448EB2B186DCD` | 3949 / `FE9274F1287CCB01256ED291B2B254294922D9C89845865591DE826E0419BDF4` |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 记录阈值、鉴权、窗口限制和计数 | `docs__UGC_MVP_DESIGN_FINAL_20261026.md` | 53541 / `3EC63B957450A53A8FDCED4205B5F3DDAB361CFE26F52984397FF6720FAF3AA1` | 55306 / `399D87A944414039AA6CE3B9B5E5DBAB87B1E7A56794CF50616C23EACDB0349B` |
| `tools/test_retention_reconcile.js` | 新独立离线测试 | 新建 | — | 10499 / `37F63B60C086C5943CE069D2FA2AFDB1A5971986AC9C50AFD95CBF15971E1A25` |

回滚须先比较当前 SHA-256 是否仍为表中“改后”，经 DSH 审查后才逐文件从该外部目录恢复，并移除本轮新测试；若之后已有其他修改，不得覆盖。本轮未执行回滚。

## 3. 批次审计实现与结果语义

`writeRunLog`（当前 `retention/index.js:90`）与 `writePurgeLog`（`:261`）仍写原事件、`at=db.serverDate()`、`rev=1`、`actor={role:'system',openidHash:null}`；只追加，不改写或删除。既有 mark/purge 的批次日志增加 `result.stats.operation`；`recoverPending`（`:199-251`）每次查询后先写 prepare，处理后写 COMPLETE/PARTIAL/DEFERRED；内部 `recoverPurgePending`（`:335-377`）仅在选中非空时写这两条，避免每次空队列 purge 额外写两条。每次运行的 batchId 固定，逐条审计的稳定事件 ID 与 T-1/T-2 正文保护均未改变。

恢复批次：`selected = recovered + deferred + conflicts + failed + unprocessed`。T-1 标记和 T-2 清理的 complete 也写 `unprocessed`；T-2 互斥式为 `selected = purgedAudited + auditFailedCount + deferredAudit + deferredRetry + skipped + conflicts + failed + unprocessed`，`purged=purgedAudited+auditFailedCount`。prepare 日志失败即不处理该恢复批次；complete 写失败返回 `LOG_FAILED` 和真实计数，不谎称闭合。日志写入回执不确定时，`prepare/complete` 本身没有稳定事件 ID，故不能仅凭错误判断日志是否落库；只读对账可观察实际日志，但无法重构进程中断时未持久化的全部内存细节，列为 PENDING。逐条审计继续依赖原稳定事件 ID 幂等补记。

## 4. 只读对账、鉴权和分页

`main`（`:724-739`）把 `reconcile` 纳入原维护动作列表，沿用 `maintenanceToken` 常量时间校验；先校验令牌，再调用 `reconcileBatches`。离线 C12 断言无令牌时两个集合均没有查询。对账源码（`:582-721`）只有 `upload_logs.where(...).orderBy(...).limit(...).get()`，没有 add/update/remove，也不访问投稿集合；C13 比较前后假数据库字节内容和更新/删除/追加调用计数。

同次只查询 `retention_mark` 或 `retention_purge` 一种事件；`where({event,_id:gt(cursor)})` 按 `_id` 升序，单页最多 50 条、单次最多 500 条。达到上限时额外只读探测一条，若仍有记录则 `truncated=true` 和 `nextCursor`。分页顺序异常或查询中断返回错误和 `completeScan=false`，不输出假的全量分类。若传入 cursor 或扫描截断，未配对为 `unmatchedWindow`，窗口内配对为 `pairedWindow`，都不能宣称全局孤儿或闭合。当前方法**不跨调用保存分组状态**；超过 500 条日志的全量对账依赖以后另行设计只读聚合或持久续页状态，不能用当前单次结果关闭 R-3 的全局风险。

仅在从头到尾完整扫描时按 `event+operation+batchId` 匹配。prepare 起满 **600000 ms（10 分钟，等号算到期）** 且无 complete 为 `suspectedOrphan`，未满为 `running`；同时识别 complete 无 prepare、重复半边、计数不守恒、日期/时间/身份/批次 ID 缺失或不合法。异常为 `RECONCILE_ANOMALIES`；截断为 `SCAN_TRUNCATED`。疑似孤儿只表示运行摘要不闭合，**不等于正文或审计数据丢失**。返回的 `batchRef` 是原批次 ID 的短哈希，不含原 ID、正文、用户身份或维护令牌。旧批次日志无 operation 时只按事件推断 mark/purge。schema 新索引 `ix_retention_reconcile_event_id(event,_id)` 仍为**本地草案**，真实云端未建、SDK `_id gt` 和查询计划未验收。

## 5. 离线测试与反事实

最新完整原始输出在同目录 `Codex_R3_Retention_批次审计与孤儿对账_最终回归_20261029.txt`，102301 B / SHA-256 `B4C728FF2E26645BD9980373C5D80BA391F2B2B44ECDC267C7BA5E26370911AA`。先前调试回归与反事实原始输出另存 `Codex_R3_Retention_批次审计与孤儿对账_测试原始输出_20261029.txt`，103110 B / SHA-256 `4608165365A4B3FE9957635E82968D0EEC57891A20F3ECEDF124E8805BE83DBC`，该文件属于中间证据，**不代替最终回归**。

| 实际命令 | 通过 / 失败 / 跳过或待实现 | 退出码 |
|---|---|---:|
| `node tools/test_retention_reconcile.js` | 23 / 0 / 未报告 | 0 |
| `node tools/test_retention_mark.js` | 71 / 0 / 未报告 | 0 |
| `node tools/test_retention_recover_pending.js` | 13 / 0 / 未报告 | 0 |
| `node tools/test_retention_purge.js` | 18 / 0 / 未报告 | 0 |
| `node tools/test_ugc_review.js` | 86 / 0 / 未报告 | 0 |
| `node tools/test_ugc_submit.js` | 110 / 0 / 未报告 | 0 |
| `node tools/test_ugc_client_contract.js` | 90 / 0 / 未报告 | 0 |
| `node tools/test_index_state.js` | 205 / 0 / 未报告 | 0 |
| `node tools/test_pages.js` | 106 / 0 / 未报告 | 0 |
| `node tools/check_eol.js` | 61 文件 / 0 违规；跳过未报告 | 0 |
| `node tools/test_check_doc_refs.js` | 51 / 0 / 未报告 | 0 |
| `node tools/test_records_spec.js`（冻结，只运行） | 290 / 0 / **11 PENDING** | 0 |
| `git diff --check` | 无错误；既有 `project.config.json` CRLF 提示 | 0 |

专项 C1–C20 共 23 项：正常闭合、十分钟边界、孤儿/反向孤儿、重复、计数、坏字段、分页与截断、第二页故障、未授权不查询、只读无写、无正文/身份/令牌、两种恢复批次、prepare/complete 日志故障、索引草案。新增测试没有改冻结主套件。备份旧 Retention 源码通过**内存中替换测试加载路径**运行新测试，真实结果 `TypeError: T.reconcileBatches is not a function`、退出码 **1**；原工作区未被替换。新测试确能识别旧实现缺失对账能力。所有目标文件另以 `git diff --no-index --check` 对比备份/空文件，空白错误输出均为 0 行；该命令因存在差异按设计返回 1。

## 6. Git、副作用与剩余风险

开工：`main`、HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、暂存 0、`git status --porcelain=v1 --untracked-files=all` 324 项（15 tracked 修改、309 未跟踪）。结束：同分支同 HEAD、暂存 0，325 项（15 tracked 修改、310 未跟踪）；仅新增 `tools/test_retention_reconcile.js`。五个原目标文件本来就在既有脏工作区/未跟踪范围内，本轮在其现状上修改；其余既有改动保留。精确 diff 见附录，全部为项目内本轮差异（备份→当前）。报告、备份和测试日志均位于项目目录外。

**PASS（本地）**：恢复批次日志、只读有限对账、鉴权、计数与旧套件回归。**PENDING**：真实云端索引/查询排序、日志 `_id gt` 与 SDK 行为、并发/日志回执不确定情形、超过 500 条的全量配对、空恢复批次不写日志的运营接受度、孤儿 prepare 的后续运维处置。`R-3` 的全局上线风险因此**不得宣称已关闭**。R-1/R-2/R-4 未在本轮实施。全部云端操作 **0**：无云调用、部署、索引/触发器/权限/环境变量变更，无正式产物、投稿处置或 Git 写操作。

DSH 复核重点：① `batchId` 与 operation 关联和旧日志兼容；② prepare 失败、complete 失败及回执未知时结果；③ 本地只读证明与公开入口鉴权顺序；④ 截断及跨窗口不冒充全局结论；⑤ `ix_retention_reconcile_event_id` 只是草案；⑥ 旧恢复测试 R4 故障注入仍测试同一逐条日志失败语义；⑦ 所有备份与后哈希及完整回归原始输出。

## 附录：精确 unified diff（独立备份 → 当前）
### cloudfunctions\retention\index.js

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\cloudfunctions__retention__index.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
index 089d511..a23f1d1 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\cloudfunctions__retention__index.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
@@ -6,6 +6,7 @@
  *
  * mark 标记到期 pending；recover/recoverPending 补齐标记审计。
  * purge 在独立阶段清理超过 30 天的终态正文，并补齐清理审计。
+ * reconcile 只读、按批次日志核对 prepare/complete；截断窗口不作全局结论。
  * 日志轮转与云端触发器仍不在本入口实现。
  *
  * 环境变量（均必填、无默认值）：
@@ -41,6 +42,10 @@ const MARK_AFTER_DAYS = 29;
 const PURGE_AFTER_DAYS = 30;
 const MAX_BATCH_LIMIT = 100;
 const PURGE_STATES = Object.freeze(['approved', 'rejected', 'expired']);
+// See UGC_MVP_DESIGN_FINAL §3.5.2: equality is already a suspected orphan.
+const RECONCILE_GRACE_MS = 10 * 60 * 1000;
+const RECONCILE_PAGE_SIZE = 50;
+const RECONCILE_MAX_ROWS = 500;
 
 function fail(code, message, extra) {
   return Object.assign({ ok: false, code: code, message: message || '' }, extra || {});
@@ -98,8 +103,13 @@ async function writeRunLog(result, phase, code, submissionId, eventId) {
   // The eight-field long-term projection is separate from the complete runtime log.
   if (eventId) data._id = eventId;
   if (phase !== 'record') {
-    data.result.stats = {
+    data.result.stats = result.operation === 'recoverPending' ? {
+      phase: phase, operation: 'recoverPending', batchId: result.batchId,
+      selected: result.selected, recovered: result.recovered, deferred: result.deferred,
+      conflicts: result.conflicts, failed: result.failed, unprocessed: result.unprocessed
+    } : {
       phase: phase,
+      operation: result.operation || 'mark',
       batchId: result.batchId,
       marked: result.marked,
       skipped: result.skipped,
@@ -206,7 +216,13 @@ async function recoverPending(options) {
       { selected: 0, recovered: 0, deferred: 0, conflicts: 0, failed: 0 });
   }
   const result = { selected: rows.length, recovered: 0, deferred: 0,
-    conflicts: 0, failed: 0, hasMore: rows.length === limit, nextEligibleAt: null };
+    conflicts: 0, failed: 0, unprocessed: rows.length,
+    hasMore: rows.length === limit, nextEligibleAt: null, now: now,
+    operation: 'recoverPending', batchId: options && options.requestId || crypto.randomBytes(16).toString('hex') };
+  try { await writeRunLog(result, 'prepare', 'PREPARE', null); }
+  catch (err) { return fail('LOG_FAILED', '恢复批次准备审计失败，未处理记录',
+    { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
+      unprocessed: rows.length, logged: false }); }
   for (const row of rows) {
     const retryAfter = row && row.retention && row.retention.audit && row.retention.audit.retryAfter;
     if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) {
@@ -226,6 +242,12 @@ async function recoverPending(options) {
       if (!deferred) result.retrySchedulingFailed = true;
     }
   }
+  result.unprocessed = result.selected - result.recovered - result.deferred - result.conflicts - result.failed;
+  const completion = result.failed || result.retrySchedulingFailed ? 'PARTIAL' :
+    (result.deferred ? 'DEFERRED' : 'COMPLETE');
+  try { await writeRunLog(result, 'complete', completion, null); }
+  catch (err) { return fail('LOG_FAILED', '恢复批次已执行，收尾审计未确认写入',
+    Object.assign({ logged: false }, result)); }
   // Every selected row belongs to exactly one class. Completed and deferred rows
   // leave the head of the next eligible batch; failed rows receive a retry delay.
   return Object.assign({ ok: result.failed === 0, code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
@@ -244,12 +266,18 @@ async function writePurgeLog(result, phase, code, submissionId, eventId) {
     actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1
   };
   if (eventId) data._id = eventId;
-  if (phase !== 'record') data.result.stats = {
-    phase: phase, batchId: result.batchId, selected: result.selected,
+  if (phase !== 'record') data.result.stats = result.operation === 'recoverPurgePending' ? {
+    phase: phase, operation: 'recoverPurgePending', batchId: result.batchId,
+    selected: result.selected, recovered: result.recovered, deferred: result.deferred,
+    conflicts: result.conflicts, failed: result.failed, unprocessed: result.unprocessed
+  } : {
+    phase: phase, operation: result.operation || 'purge',
+    batchId: result.batchId, selected: result.selected,
     purged: result.purged, purgedAudited: result.purgedAudited,
     auditFailedCount: result.auditFailedCount, deferredAudit: result.deferredAudit,
     deferredRetry: result.deferredRetry, conflicts: result.conflicts,
-    failed: result.failed, skipped: result.skipped, needsMark: result.needsMark
+    failed: result.failed, skipped: result.skipped, unprocessed: result.unprocessed,
+    needsMark: result.needsMark
   };
   return db.collection(COL.LOGS).add({ data: data });
 }
@@ -316,7 +344,16 @@ async function recoverPurgePending(options) {
       .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
     rows = response && Array.isArray(response.data) ? response.data : [];
   } catch (err) { return fail('DATABASE_ERROR', '读取待补清理审计队列失败'); }
-  const result = { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0 };
+  const result = { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
+    unprocessed: rows.length, now: now, operation: 'recoverPurgePending',
+    batchId: options && options.requestId || crypto.randomBytes(16).toString('hex') };
+  // Empty internal recovery checks do not create an extra batch for each purge call.
+  if (rows.length) {
+    try { await writePurgeLog(result, 'prepare', 'PREPARE', null); }
+    catch (err) { return fail('LOG_FAILED', '清理审计恢复准备日志失败，未处理记录',
+      { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0,
+        unprocessed: rows.length, logged: false }); }
+  }
   for (const row of rows) {
     const retryAfter = row.retention && row.retention.purge && row.retention.purge.retryAfter;
     if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) { result.deferred++; continue; }
@@ -328,6 +365,14 @@ async function recoverPurgePending(options) {
       if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
     }
   }
+  result.unprocessed = result.selected - result.recovered - result.deferred - result.conflicts - result.failed;
+  if (rows.length) {
+    const completion = result.failed || result.retrySchedulingFailed ? 'PARTIAL' :
+      (result.deferred ? 'DEFERRED' : 'COMPLETE');
+    try { await writePurgeLog(result, 'complete', completion, null); }
+    catch (err) { return fail('LOG_FAILED', '清理审计恢复已执行，收尾日志未确认写入',
+      Object.assign({ logged: false }, result)); }
+  }
   return Object.assign({ ok: result.failed === 0,
     code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
 }
@@ -355,7 +400,8 @@ async function purgePayload(options) {
   const result = { now: now, batchId: options && options.requestId || crypto.randomBytes(16).toString('hex'),
     selected: rows.length, needsMark: needsMark, purged: 0, purgedAudited: 0,
     auditFailedCount: 0, deferredAudit: 0, deferredRetry: 0,
-    skipped: 0, conflicts: 0, failed: 0, auditRecovery: auditRecovery };
+    skipped: 0, conflicts: 0, failed: 0, unprocessed: rows.length,
+    auditRecovery: auditRecovery };
   try { await writePurgeLog(result, 'prepare', 'PREPARE', null); }
   catch (err) { return fail('LOG_FAILED', '清理批次准备审计失败，未清正文',
     { selected: rows.length, needsMark: needsMark, purged: 0, logged: false }); }
@@ -390,7 +436,9 @@ async function purgePayload(options) {
     if (outcome.ok) result.purgedAudited++;
     else result.auditFailedCount++;
   }
-  const hasFailure = result.failed || result.auditFailedCount || auditRecovery.failed || result.retrySchedulingFailed;
+  result.unprocessed = result.selected - result.purgedAudited - result.auditFailedCount -
+    result.deferredAudit - result.deferredRetry - result.skipped - result.conflicts - result.failed;
+  const hasFailure = result.failed || result.auditFailedCount || !auditRecovery.ok || result.retrySchedulingFailed;
   const hasDeferred = result.deferredAudit || result.deferredRetry || result.skipped ||
     result.needsMark || auditRecovery.deferred;
   const complete = hasFailure ? 'PARTIAL' : (hasDeferred ? 'DEFERRED' : 'COMPLETE');
@@ -432,7 +480,7 @@ async function markExpired(options) {
   let unprocessed = 0;
   const result = { marked: 0, skipped: 0, conflicts: 0, failed: 0,
     attempts: rows.length, selected: rows.length, markedAudited: 0,
-    auditFailedCount: 0, unprocessed: 0, now: now,
+    auditFailedCount: 0, unprocessed: rows.length, now: now,
     batchId: (options && options.requestId) || crypto.randomBytes(16).toString('hex') };
   try {
     await writeRunLog(result, 'prepare', 'PREPARE', null);
@@ -523,13 +571,165 @@ async function markExpired(options) {
   };
 }
 
+function validUtcDay(day) {
+  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
+  const parsed = new Date(day + 'T00:00:00.000Z');
+  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
+}
+
+function validCount(value) { return Number.isSafeInteger(value) && value >= 0; }
+
+function validCompleteCounts(stats) {
+  if (!validCount(stats.selected)) return false;
+  if (stats.operation === 'mark') {
+    const keys = ['markedAudited', 'auditFailedCount', 'skipped', 'conflicts', 'failed', 'unprocessed'];
+    return keys.every(function (key) { return validCount(stats[key]); }) &&
+      stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0) &&
+      stats.marked === stats.markedAudited + stats.auditFailedCount;
+  }
+  if (stats.operation === 'purge') {
+    const keys = ['purgedAudited', 'auditFailedCount', 'deferredAudit', 'deferredRetry',
+      'skipped', 'conflicts', 'failed', 'unprocessed'];
+    return keys.every(function (key) { return validCount(stats[key]); }) &&
+      stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0) &&
+      stats.purged === stats.purgedAudited + stats.auditFailedCount;
+  }
+  const keys = ['recovered', 'deferred', 'conflicts', 'failed', 'unprocessed'];
+  return keys.every(function (key) { return validCount(stats[key]); }) &&
+    stats.selected === keys.reduce(function (sum, key) { return sum + stats[key]; }, 0);
+}
+
+function batchLogInfo(log, eventType) {
+  const stats = log.result && log.result.stats;
+  if (log.submissionId !== null) {
+    if (stats && (stats.phase === 'prepare' || stats.phase === 'complete')) return { invalid: true };
+    if (typeof log.submissionId === 'string' && log.submissionId) return null;
+    return { invalid: true };
+  } // Per-record events are not batches.
+  if (!stats || (stats.phase !== 'prepare' && stats.phase !== 'complete')) return { invalid: true };
+  const operation = stats.operation || (eventType === 'retention_mark' ? 'mark' : 'purge');
+  const validOperation = eventType === 'retention_mark' ?
+    ['mark', 'recoverPending'].indexOf(operation) !== -1 :
+    ['purge', 'recoverPurgePending'].indexOf(operation) !== -1;
+  const at = log.at instanceof Date ? log.at : new Date(log.at);
+  if (!validOperation || typeof stats.batchId !== 'string' ||
+      !/^[A-Za-z0-9:_-]{1,128}$/.test(stats.batchId) ||
+      !validUtcDay(log.day) || Number.isNaN(at.getTime()) ||
+      log.schemaVersion !== 1 || log.action !== eventType || log.rev !== 1 ||
+      !log.actor || log.actor.role !== 'system' || log.actor.openidHash !== null ||
+      !log.result ||
+      typeof log.result.code !== 'string' || !validCount(stats.selected) ||
+      (stats.phase === 'prepare' && log.result.code !== 'PREPARE') ||
+      (stats.phase === 'complete' && !['COMPLETE', 'PARTIAL', 'FAILED', 'DEFERRED'].includes(log.result.code))) {
+    return { invalid: true };
+  }
+  return { operation: operation, batchId: stats.batchId, phase: stats.phase,
+    at: at, day: log.day, stats: Object.assign({}, stats, { operation: operation }) };
+}
+
+// Read-only, bounded scan. Unmatched halves are not called orphans when a window is truncated.
+async function reconcileBatches(options) {
+  const config = readPolicy();
+  if (config.error) return config.error;
+  const input = options || {};
+  const eventType = input.eventType;
+  if (eventType !== 'retention_mark' && eventType !== 'retention_purge') {
+    return fail('INVALID_EVENT', '请选择 retention_mark 或 retention_purge');
+  }
+  const now = input.now instanceof Date ? new Date(input.now.getTime()) : new Date();
+  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
+  const pageSize = input.pageSize === undefined ? RECONCILE_PAGE_SIZE : input.pageSize;
+  const maxRows = input.maxRows === undefined ? RECONCILE_MAX_ROWS : input.maxRows;
+  const startCursor = input.cursor === undefined ? '' : input.cursor;
+  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > RECONCILE_PAGE_SIZE ||
+      !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > RECONCILE_MAX_ROWS ||
+      typeof startCursor !== 'string' || startCursor.length > 128) {
+    return fail('INVALID_SCAN_OPTIONS', '对账扫描参数不合法');
+  }
+  let cursor = startCursor;
+  const logs = [];
+  let pages = 0;
+  let truncated = false;
+  try {
+    while (logs.length < maxRows) {
+      const take = Math.min(pageSize, maxRows - logs.length);
+      const filter = { event: eventType };
+      if (cursor) filter._id = _.gt(cursor);
+      const response = await db.collection(COL.LOGS).where(filter)
+        .orderBy('_id', 'asc').limit(take).get();
+      const rows = response && Array.isArray(response.data) ? response.data : [];
+      pages++;
+      for (const row of rows) {
+        if (!row || typeof row._id !== 'string' || row._id <= cursor) {
+          return fail('UNSTABLE_SCAN', '对账分页顺序无效', { scanned: logs.length, truncated: true });
+        }
+        cursor = row._id;
+        logs.push(row);
+      }
+      if (rows.length < take) break;
+      if (logs.length === maxRows) {
+        const filterNext = { event: eventType, _id: _.gt(cursor) };
+        const probe = await db.collection(COL.LOGS).where(filterNext).orderBy('_id', 'asc').limit(1).get();
+        truncated = !!(probe && Array.isArray(probe.data) && probe.data.length);
+        break;
+      }
+    }
+  } catch (err) {
+    return fail('DATABASE_ERROR', '对账只读扫描中断',
+      { scanned: logs.length, nextCursor: cursor || null, truncated: true, completeScan: false });
+  }
+  const groups = new Map();
+  let invalidLogs = 0;
+  for (const log of logs) {
+    const info = batchLogInfo(log, eventType);
+    if (!info) continue;
+    if (info.invalid || info.at.getTime() > now.getTime()) { invalidLogs++; continue; }
+    const key = info.operation + '\0' + info.batchId;
+    if (!groups.has(key)) groups.set(key, { operation: info.operation, batchId: info.batchId,
+      prepare: [], complete: [] });
+    groups.get(key)[info.phase].push(info);
+  }
+  const completeScan = !truncated && !startCursor;
+  const counts = { closed: 0, pairedWindow: 0, suspectedOrphan: 0, running: 0, completeWithoutPrepare: 0,
+    duplicate: 0, countMismatch: 0, invalidLogs: invalidLogs, unmatchedWindow: 0 };
+  const batches = [];
+  for (const group of groups.values()) {
+    let status;
+    if (group.prepare.length > 1 || group.complete.length > 1) status = 'duplicate';
+    else if (!group.prepare.length || !group.complete.length) {
+      if (!completeScan) status = 'unmatchedWindow';
+      else if (!group.prepare.length) status = 'completeWithoutPrepare';
+      else status = now.getTime() - group.prepare[0].at.getTime() >= RECONCILE_GRACE_MS ?
+        'suspectedOrphan' : 'running';
+    } else if (group.prepare[0].day !== group.complete[0].day ||
+        group.prepare[0].stats.selected !== group.complete[0].stats.selected ||
+        group.complete[0].at.getTime() < group.prepare[0].at.getTime() ||
+        !validCompleteCounts(group.complete[0].stats)) status = 'countMismatch';
+    else status = completeScan ? 'closed' : 'pairedWindow';
+    counts[status]++;
+    const batchRef = crypto.createHash('sha256').update(eventType + '\0' + group.operation +
+      '\0' + group.batchId).digest('hex').slice(0, 24);
+    batches.push({ batchRef: batchRef, operation: group.operation, status: status });
+  }
+  const hasAnomaly = invalidLogs || counts.suspectedOrphan ||
+    counts.completeWithoutPrepare || counts.duplicate || counts.countMismatch;
+  return { ok: !hasAnomaly && completeScan,
+    code: completeScan ? (hasAnomaly ? 'RECONCILE_ANOMALIES' : 'OK') : 'SCAN_TRUNCATED',
+    eventType: eventType,
+    scanned: logs.length, pages: pages, truncated: truncated, completeScan: completeScan,
+    nextCursor: truncated ? cursor : null, thresholdMs: RECONCILE_GRACE_MS,
+    counts: counts, batches: batches };
+}
+
 exports.main = async function (event, context) {
-  if (!event || ['mark', 'recover', 'recoverPending', 'purge'].indexOf(event.action) === -1) {
+  if (!event || ['mark', 'recover', 'recoverPending', 'purge', 'reconcile'].indexOf(event.action) === -1) {
     return fail('INVALID_ACTION', '仅支持维护令牌保护的保留期动作');
   }
   if (!hasValidMaintenanceToken(event.maintenanceToken)) {
     return fail('FORBIDDEN', '维护令牌无效或未配置');
   }
+  if (event.action === 'reconcile') return reconcileBatches({ eventType: event.eventType,
+    pageSize: event.pageSize, maxRows: event.maxRows, cursor: event.cursor });
   if (event.action === 'recover') return recoverAudit(event.submissionId);
   if (event.action === 'recoverPending') return recoverPending();
   if (event.action === 'purge') return purgePayload({ requestId: context && context.request_id });
@@ -544,5 +744,6 @@ exports.__test__ = {
   recoverPending: recoverPending,
   purgePayload: purgePayload,
   recoverPurgePending: recoverPurgePending,
-  recoverPurgeAudit: recoverPurgeAudit
+  recoverPurgeAudit: recoverPurgeAudit,
+  reconcileBatches: reconcileBatches
 };
``` 

### tools\ugc_fake_cloud.js

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\tools__ugc_fake_cloud.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\ugc_fake_cloud.js"
index 6e0125a..a6da68b 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\tools__ugc_fake_cloud.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\ugc_fake_cloud.js"
@@ -42,6 +42,7 @@ function matchValue(actual, expected) {
   }
   if (expected && typeof expected === 'object' && expected.__op === 'in') return expected.values.indexOf(actual) !== -1;
   if (expected && typeof expected === 'object' && expected.__op === 'neq') return actual !== expected.value;
+  if (expected && typeof expected === 'object' && expected.__op === 'gt') return actual > expected.value;
   return actual === expected;
 }
 
@@ -101,7 +102,8 @@ function createHarness() {
     gte: function (value) { return { __op: 'gte', value: value }; },
     lt: function (value) { return { __op: 'lt', value: value }; },
     in: function (values) { return { __op: 'in', values: values }; },
-    neq: function (value) { return { __op: 'neq', value: value }; }
+    neq: function (value) { return { __op: 'neq', value: value }; },
+    gt: function (value) { return { __op: 'gt', value: value }; }
   };
 
   function query(name, cond) {
``` 

### tools\test_retention_recover_pending.js

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\tools__test_retention_recover_pending.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_recover_pending.js"
index b5aa9f2..43feb33 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\tools__test_retention_recover_pending.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_recover_pending.js"
@@ -56,7 +56,8 @@ async function run() {
 
   setup(1);
   seed('fail_first'); seed('later');
-  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
+  // First add is now the recovery batch prepare; fail the per-record add.
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
   const first = await T.recoverPending({ now: now });
   h.clearFail();
   const second = await T.recoverPending({ now: now });
``` 

### config\cloud\schema.upload_logs.json

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\config__cloud__schema.upload_logs.json" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.upload_logs.json"
index 0cb4941..9698faa 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\config__cloud__schema.upload_logs.json"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.upload_logs.json"
@@ -31,7 +31,7 @@
       "type": "object",
       "properties": {
         "code": { "type": "string", "note": "OK 或错误码；alert 行记 LOG_FAILED" },
-        "stats": { "type": "object|null", "note": "如 { updated: 1 }" },
+        "stats": { "type": "object|null", "note": "Retention 批次含 phase/operation/batchId/selected 与互斥结果计数；逐条日志无 stats；只追加。恢复批次操作为 recoverPending 或 recoverPurgePending" },
         "attempts": { "type": "integer", "note": "内容安全尝试次数" }
       }
     },
@@ -55,6 +55,12 @@
       "unique": false,
       "purpose": "按事件与日期聚合"
     },
+    {
+      "name": "ix_retention_reconcile_event_id",
+      "keys": [{ "field": "event", "order": "asc" }, { "field": "_id", "order": "asc" }],
+      "unique": false,
+      "purpose": "按 retention 事件与 _id 做只读有界对账扫描；仅本地声明，云端未创建或验收"
+    },
     {
       "name": "ix_actor_at",
       "keys": [{ "field": "actor.openidHash", "order": "asc" }, { "field": "at", "order": "desc" }],
``` 

### docs\UGC_MVP_DESIGN_FINAL_20261026.md

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\docs\\UGC_MVP_DESIGN_FINAL_20261026.md"
index d4cd72c..bca4939 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\R3_retention_reconcile_20261029_20261029T0748217606981Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\docs\\UGC_MVP_DESIGN_FINAL_20261026.md"
@@ -274,8 +274,10 @@ pending ──approve──> approved（终态）
 
 - **本地与线上状态**：`config/ugc.js` 仍标 `pending_confirmation`，表示尚未部署和验收，不能再解释为业务期限未裁决。上线前须先完成隐私指引、清理实现与触发器验收并留截图。
 - **清理纪律**：T-1 只改状态、不清正文；T-2 独立按严格 30 天边界清正文，若仍为 pending，先补标 expired；过期标记与正文清理各自留痕，不得用 `delete_request` 冒充系统保留事件。正文删除后保留符合八字段口径的最小摘要；用户主动删除请求见 §7.7。
-- **T-2 本地实现（云端待验收）**：`purge` 不直接处理 pending；返回超期 `needsMark`，由独立 T-1 标记及审计恢复完成后再清。终态候选满足 `createdAt < now-30×24h`、状态为 approved/rejected/expired、`payload != null`；若 `retention.audit.state='pending'` 则延后处理并保留标记。按 `retention.purge.retryAfter/createdAt/_id` 稳定排序和有界批次逐次消退；写入前以 `_id+status+rev+payload 非空` 条件更新，只将正文置 null、写 `payloadRedactedAt` 与待补清理审计标记，保留记录外壳及 `verifyStatus`。`retention_purge` 逐条事件使用稳定 ID，可由下一次 purge 自动补记；日志与正文写入不在同一事务，真实云端原子性、索引及调度均待验收。批次互斥分类为 `purgedAudited/auditFailedCount/deferredAudit/deferredRetry/skipped/conflicts/failed`，其和等于 `selected`，`purged=purgedAudited+auditFailedCount`；另报 `needsMark` 与清理审计恢复结果。
-- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。`recoverPending` 在相同鉴权下按 `retention.audit.state='pending'` 查询，并按 `retryAfter/createdAt/_id` 稳定排序、限批处理；成功项退出队列，失败项延后一分钟，重复触发可继续处理下一批而不依赖偏移量。每批 `selected=recovered+deferred+conflicts+failed`；真实复合索引、数据库原子性和进程中断行为未验收，不得把本地模拟称为云端可靠恢复。
+- **T-2 本地实现（云端待验收）**：`purge` 不直接处理 pending；返回超期 `needsMark`，由独立 T-1 标记及审计恢复完成后再清。终态候选满足 `createdAt < now-30×24h`、状态为 approved/rejected/expired、`payload != null`；若 `retention.audit.state='pending'` 则延后处理并保留标记。按 `retention.purge.retryAfter/createdAt/_id` 稳定排序和有界批次逐次消退；写入前以 `_id+status+rev+payload 非空` 条件更新，只将正文置 null、写 `payloadRedactedAt` 与待补清理审计标记，保留记录外壳及 `verifyStatus`。`retention_purge` 逐条事件使用稳定 ID，可由下一次 purge 自动补记；日志与正文写入不在同一事务，真实云端原子性、索引及调度均待验收。批次互斥分类为 `purgedAudited/auditFailedCount/deferredAudit/deferredRetry/skipped/conflicts/failed/unprocessed`，其和等于 `selected`，`purged=purgedAudited+auditFailedCount`；另报 `needsMark` 与清理审计恢复结果。
+- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。`recoverPending` 在相同鉴权下按 `retention.audit.state='pending'` 查询，并按 `retryAfter/createdAt/_id` 稳定排序、限批处理；成功项退出队列，失败项延后一分钟，重复触发可继续处理下一批而不依赖偏移量。每批 `selected=recovered+deferred+conflicts+failed+unprocessed`；真实复合索引、数据库原子性和进程中断行为未验收，不得把本地模拟称为云端可靠恢复。
+- **R-3 批次审计与只读对账（本地实现，云端待验收）**：`mark`/`purge` 沿用 `retention_mark`/`retention_purge` 运行日志；有实际待补记录的 `recoverPurgePending` 与每次 `recoverPending` 也各写 `prepare` 和 `complete`，`result.stats.operation` 区分动作，`batchId` 在同次执行中固定。恢复批次的 `selected=recovered+deferred+conflicts+failed+unprocessed`；准备日志失败则不处理记录，收尾日志失败不得返回批次完成。逐条审计仍用原稳定事件 ID，`upload_logs` 永远只追加。
+- **R-3 对账阈值与范围**：维护令牌保护的 `reconcile` 只读动作一次只查 `retention_mark` 或 `retention_purge` 一个事件，按 `(event,_id)` 升序做 `_id > cursor` 续页；单页最多 **50** 条、单次最多 **500** 条，超过时返回 `truncated=true/nextCursor`，未配对项为 `unmatchedWindow`、窗口内配对项为 `pairedWindow`，均不得冒充全局孤儿或闭合。完整扫描且无续页时，以相同 `event+operation+batchId` 配对；从 prepare 的 `at` 起满 **10 分钟（≥600000 ms）** 且无 complete 才标“疑似孤儿”，未满为“运行中”，不代表数据丢失。另识别 complete 无 prepare、重复 prepare/complete、计数不守恒、关联 ID/日期/时间缺失或不合法。对外只返回批次 ID 的稳定哈希引用 `batchRef`，不返回原始 ID、正文或身份。旧日志缺 operation 时只按事件推断为 mark/purge；跨窗口配对和大于 500 条的全局对账仍需后续只读聚合或可持久的游标状态方案及真实云端索引验收，不能把本地有限扫描说成全量对账。
 
 ---
 
@@ -454,7 +456,7 @@ pending ──approve──> approved（终态）
 
 - 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
 - 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
-- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending/purge`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
+- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending/purge/reconcile`。`reconcile` 只读且先鉴权，再验证扫描参数；`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
 
 ### 7.2 输入校验（服务端独立复算）
 
``` 

### tools\test_retention_reconcile.js（新建）

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_reconcile.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_reconcile.js"
new file mode 100644
index 0000000..f50db71
--- /dev/null
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_reconcile.js"
@@ -0,0 +1,196 @@
+'use strict';
+const crypto = require('crypto');
+const { createHarness } = require('./ugc_fake_cloud');
+const h = createHarness();
+const fn = h.loadFunction('cloudfunctions/retention/index.js');
+const T = fn.__test__;
+const now = new Date('2026-10-29T12:00:00.000Z');
+let pass = 0, fail = 0;
+function check(name, condition) {
+  console.log((condition ? 'PASS ' : 'FAIL ') + name);
+  if (condition) pass++; else fail++;
+}
+function setup() {
+  h.reset();
+  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
+  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
+  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
+  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
+  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
+}
+function log(id, batchId, phase, at, overrides) {
+  const stats = Object.assign({ phase: phase, operation: 'mark', batchId: batchId,
+    selected: 1, marked: phase === 'prepare' ? 0 : 1,
+    markedAudited: phase === 'prepare' ? 0 : 1, auditFailedCount: 0,
+    skipped: 0, conflicts: 0, failed: 0, unprocessed: phase === 'prepare' ? 1 : 0 },
+  overrides && overrides.stats);
+  const row = Object.assign({ _id: id, schemaVersion: 1, event: 'retention_mark',
+    action: 'retention_mark', submissionId: null, day: '2026-10-29',
+    at: at, rev: 1, actor: { role: 'system', openidHash: null },
+    result: { code: phase === 'prepare' ? 'PREPARE' : 'COMPLETE', stats: stats },
+    errorCode: '' }, overrides || {});
+  h.seed('upload_logs', row);
+}
+async function scan(options) {
+  return T.reconcileBatches(Object.assign({ eventType: 'retention_mark', now: now }, options || {}));
+}
+function oneStatus(result, expected) {
+  return result.batches.length === 1 && result.batches[0].status === expected &&
+    result.counts[expected] === 1;
+}
+async function run() {
+  setup();
+  log('a1', 'closed', 'prepare', new Date(now - 1000));
+  log('a2', 'closed', 'complete', new Date(now - 500));
+  let r = await scan();
+  check('C1 正常 prepare/complete 同批闭合', r.ok && oneStatus(r, 'closed') && r.scanned === 2);
+  check('C1b 只输出哈希引用，不回传原始批次 ID',
+    /^[0-9a-f]{24}$/.test(r.batches[0].batchRef) &&
+    !JSON.stringify(r).includes('"batchId":"closed"'));
+
+  setup(); log('b1', 'orphan', 'prepare', new Date(now - 600000));
+  r = await scan();
+  check('C2 恰好十分钟为疑似孤儿，不声称数据丢失', !r.ok && oneStatus(r, 'suspectedOrphan'));
+  setup(); log('b2', 'running', 'prepare', new Date(now - 599999));
+  r = await scan();
+  check('C3 未满十分钟仍是运行中', oneStatus(r, 'running') && r.counts.suspectedOrphan === 0);
+
+  setup(); log('c1', 'missing_prepare', 'complete', new Date(now - 1000));
+  r = await scan();
+  check('C4 complete 无 prepare 是异常', oneStatus(r, 'completeWithoutPrepare'));
+  setup();
+  log('d1', 'duplicate_prepare', 'prepare', new Date(now - 1000));
+  log('d2', 'duplicate_prepare', 'prepare', new Date(now - 900));
+  log('d3', 'duplicate_complete', 'prepare', new Date(now - 1000));
+  log('d4', 'duplicate_complete', 'complete', new Date(now - 900));
+  log('d5', 'duplicate_complete', 'complete', new Date(now - 800));
+  r = await scan({ pageSize: 2 });
+  check('C5 重复 prepare 与重复 complete 分别发现', r.counts.duplicate === 2 && r.pages >= 3);
+
+  setup();
+  log('e1', 'bad_count', 'prepare', new Date(now - 1000));
+  log('e2', 'bad_count', 'complete', new Date(now - 900),
+    { stats: { phase: 'complete', operation: 'mark', batchId: 'bad_count', selected: 2,
+      marked: 1, markedAudited: 1, auditFailedCount: 0, skipped: 0,
+      conflicts: 0, failed: 0, unprocessed: 0 } });
+  r = await scan();
+  check('C6 计数不守恒或首尾选中数变化被发现', oneStatus(r, 'countMismatch'));
+
+  setup();
+  log('f1', '', 'prepare', new Date(now - 1000));
+  log('f2', 'bad_time', 'prepare', new Date('bad'));
+  log('f3', 'bad_day', 'prepare', new Date(now - 1000), { day: '2026-02-30' });
+  log('f4', 'missing_field', 'prepare', new Date(now - 1000), { submissionId: undefined });
+  r = await scan();
+  check('C7 无效 ID、日期、时间及必填关联字段计入异常', r.counts.invalidLogs === 4 && !r.ok);
+
+  setup();
+  log('g1', 'page_a', 'prepare', new Date(now - 1000));
+  log('g2', 'page_a', 'complete', new Date(now - 900));
+  log('g3', 'page_b', 'prepare', new Date(now - 800));
+  log('g4', 'page_b', 'complete', new Date(now - 700));
+  log('g5', 'page_c', 'prepare', new Date(now - 600));
+  log('g6', 'page_c', 'complete', new Date(now - 500));
+  r = await scan({ pageSize: 2 });
+  check('C8 多页扫描稳定推进，完整结果三批闭合', r.scanned === 6 && r.pages >= 3 &&
+    r.counts.closed === 3 && !r.truncated && r.completeScan);
+  const pairedPartial = await scan({ pageSize: 2, maxRows: 2 });
+  check('C8b 截断窗口内已配对也不冒充全局闭合', pairedPartial.truncated &&
+    pairedPartial.counts.pairedWindow === 1 && pairedPartial.counts.closed === 0);
+  const partial = await scan({ pageSize: 1, maxRows: 1 });
+  check('C9 截断窗口不误判孤儿且返回续页 ID', partial.truncated && !partial.completeScan &&
+    partial.nextCursor === 'g1' && partial.counts.unmatchedWindow === 1 &&
+    partial.counts.suspectedOrphan === 0);
+  const continued = await scan({ cursor: partial.nextCursor, pageSize: 1, maxRows: 2 });
+  check('C10 续页为局部窗口，缺配对不能冒充全局结论',
+    !continued.completeScan && continued.counts.unmatchedWindow >= 1);
+
+  setup();
+  log('h1', 'interrupted', 'prepare', new Date(now - 1000));
+  log('h2', 'interrupted', 'complete', new Date(now - 900));
+  h.setFail({ collection: 'upload_logs', op: 'get', atCall: 2 });
+  r = await scan({ pageSize: 1 }); h.clearFail();
+  check('C11 第二页读取故障不返回假完整结论', r.code === 'DATABASE_ERROR' &&
+    r.scanned === 1 && r.truncated && !r.completeScan);
+
+  setup();
+  r = await fn.main({ action: 'reconcile', eventType: 'retention_mark' }, {});
+  check('C12 无令牌在读取日志前拒绝', r.code === 'FORBIDDEN' &&
+    h.calls('upload_logs').length === 0 && h.calls('submissions').length === 0);
+
+  setup();
+  log('i1', 'private_batch', 'prepare', new Date(now - 1000),
+    { note: 'private-body', actor: { role: 'system', openidHash: 'private-openid' } });
+  const before = JSON.stringify(h.state.docs);
+  const updates = h.state.updateCalls, removes = h.state.removeCalls;
+  const adds = h.calls('upload_logs').filter(function (x) { return x === 'add'; }).length;
+  r = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
+    maintenanceToken: 'offline-secret' }, {});
+  check('C13 鉴权后对账只读，不更改投稿或审计日志',
+    JSON.stringify(h.state.docs) === before && h.state.updateCalls === updates &&
+    h.state.removeCalls === removes && h.calls('upload_logs').filter(function (x) { return x === 'add'; }).length === adds);
+  check('C14 返回值不含正文、身份、令牌',
+    !/private-body|private-openid|offline-secret/.test(JSON.stringify(r)));
+
+  setup();
+  r = await T.recoverPending({ now: now });
+  const recoveryLogs = h.docs('upload_logs').filter(function (x) {
+    return x.result && x.result.stats && x.result.stats.operation === 'recoverPending';
+  });
+  check('C15 R1 恢复批次沿用 prepare/complete，计数闭合', recoveryLogs.length === 2 &&
+    recoveryLogs[0].result.stats.phase === 'prepare' &&
+    recoveryLogs[1].result.stats.phase === 'complete' &&
+    recoveryLogs[0].result.stats.batchId === recoveryLogs[1].result.stats.batchId &&
+    recoveryLogs[1].result.stats.selected === recoveryLogs[1].result.stats.recovered +
+    recoveryLogs[1].result.stats.deferred + recoveryLogs[1].result.stats.conflicts +
+    recoveryLogs[1].result.stats.failed + recoveryLogs[1].result.stats.unprocessed);
+
+  setup();
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
+  r = await T.recoverPending({ now: now }); h.clearFail();
+  check('C16 恢复 prepare 失败时未处理业务记录', r.code === 'LOG_FAILED' &&
+    r.unprocessed === r.selected && h.state.updateCalls === 0);
+
+  setup();
+  const eventId = 'retention_purge_' + crypto.createHash('sha256').update('purge1\0' + '2').digest('hex');
+  h.seed('submissions', { _id: 'purge1', status: 'approved', rev: 2, payload: null,
+    createdAt: new Date(now - 32 * 86400000), verifyStatus: 'unverified',
+    retention: { purge: { state: 'pending', purgedRev: 2, eventId: eventId,
+      day: '2026-10-29', retryAfter: new Date(0) } } });
+  r = await T.recoverPurgePending({ now: now });
+  const purgeLogs = h.docs('upload_logs').filter(function (x) {
+    return x.result && x.result.stats && x.result.stats.operation === 'recoverPurgePending';
+  });
+  check('C17 T-2 恢复批次有准备和完成，正文仍为空', r.recovered === 1 &&
+    purgeLogs.length === 2 && purgeLogs[0].result.stats.phase === 'prepare' &&
+    purgeLogs[1].result.stats.phase === 'complete' &&
+    h.docs('submissions')[0].payload === null);
+  const purgeReconciled = await T.reconcileBatches({ eventType: 'retention_purge', now: now });
+  check('C17b 清理恢复批次可被同一对账入口识别',
+    purgeReconciled.counts.closed === 1 && purgeReconciled.counts.invalidLogs === 0);
+
+  setup();
+  log('j1', 'invalid_actor', 'prepare', new Date(now - 1000),
+    { actor: { role: 'system', openidHash: 'invented' } });
+  log('j2', 'wrong_submission', 'prepare', new Date(now - 1000), { submissionId: 'user-id' });
+  r = await scan();
+  check('C19 系统身份字段和批次投稿 ID 不合规可检测且不回显',
+    r.counts.invalidLogs === 2 && !JSON.stringify(r).includes('user-id'));
+
+  setup();
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  r = await T.recoverPending({ now: now }); h.clearFail();
+  check('C20 恢复 complete 写入失败不得谎报闭合', r.code === 'LOG_FAILED' &&
+    r.logged === false && h.docs('upload_logs').length === 1 &&
+    h.docs('upload_logs')[0].result.stats.phase === 'prepare');
+
+  const schema = require('../config/cloud/schema.upload_logs.json');
+  check('C18 索引仅为本地草案且日志仍禁止更新/删除',
+    schema._meta.status === 'pending_admin_console_verification' &&
+    schema.indexes.some(function (x) { return x.name === 'ix_retention_reconcile_event_id'; }) &&
+    schema.appendOnly.forbidden.indexOf('collection.update') !== -1);
+
+  console.log('PASS ' + pass + ' / FAIL ' + fail);
+  if (fail) process.exitCode = 1;
+}
+run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
``` 
