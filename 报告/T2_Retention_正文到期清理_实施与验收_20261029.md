# T-2 Retention 正文到期清理：本地实施与验收

日期：2026-10-29。结论：**本地实现与离线回归 PASS；真实云端索引、查询语义、并发原子性和调度 PENDING**。本报告不代表 T-2 已在线生效。

## 1. 实际预检与范围

- 已读 `报告/DSH_R1_Retention_自动恢复独立验收_20261029.md`、R1 实施报告、当前 Retention 函数、两份 schema、§3.5.2 契约、现有 Retention 测试与假数据库。R1 的自动审计恢复已存在，本轮未重做。
- 项目 Git：`main`，HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`；开始时暂存区空，状态清单 323 项（15 个已修改、308 个未跟踪）。当前相关源文件本身属于已有未跟踪文件；未用旧版本覆盖。
- `.baton/task.md`、`.baton/handoff/current.md` 实测不存在，故无 baton 交接文件可写。
- 本轮只修改本地 Retention 函数、假数据库、两份 schema、现有设计契约，并新增独立专项测试。无云端调用、部署、真实索引、触发器、正式产物、投稿处置或 Git 写操作。

## 2. 备份证据

修改前新建项目外目录 `C:\Users\25975\Desktop\食神寻味小程序开发\备份\t2-retention-20261029-20261029T0654162507883Z`。逐文件复制后按 SHA-256 校验，源与备份逐字节一致。新增测试没有修改前版本。

| 文件（项目相对路径） | 备份文件 | 原大小 B | 原 SHA-256 | 修改后大小 B | 修改后 SHA-256 |
|---|---|---:|---|---:|---|
| `cloudfunctions/retention/index.js` | `cloudfunctions__retention__index.js` | 15383 | `AEEC9C46A7B8E2BC82665F6F99FF4991ACB4B85FC1039ABCDB02F1886EA6B5E9` | 25238 | `45F304842FA500441BFC28FDA1A4BCE619E02A6038D55F46C53EC7CE84EAE693` |
| `tools/ugc_fake_cloud.js` | `tools__ugc_fake_cloud.js` | 9648 | `C2C1200D6A40DF4F4979F01B03821161ADC05A1FC588EAAE92173086B5C5B2CB` | 10483 | `853970B2BEFD31C4233CEC95385661AFD9E7AA5F7AA39FF759EC86DF4412FC96` |
| `config/cloud/schema.submissions.json` | `config__cloud__schema.submissions.json` | 7233 | `A26F7B78A68787EF2160A542814540D36271D6C9B46E9D04C6CC6F815B8F0425` | 8489 | `954D2E2875EFEFBACE184E450D29AA097CE2A434369A9AF471E800BC433CA105` |
| `config/cloud/schema.upload_logs.json` | `config__cloud__schema.upload_logs.json` | 3453 | `57F8157EEAAD5758A7FD49088782A03A849DC53A1943FAD7A8906696A7792907` | 3499 | `958A128870B15A15F5F5FA1336B51D055F8AA117F3310F2E481448EB2B186DCD` |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | `docs__UGC_MVP_DESIGN_FINAL_20261026.md` | 52446 | `F0490DE228E464C697555C62294B26536E765116BA0E57557FF114CF80D724D2` | 53541 | `3EC63B957450A53A8FDCED4205B5F3DDAB361CFE26F52984397FF6720FAF3AA1` |
| `tools/test_retention_purge.js` | 新建 | — | — | 8973 | `D1C88EA9B36B7CBE9FB3DD7556A1D9AD51FA16A6B2E833D32660666D51B0D462` |

回滚仅能在 DSH 审查后按上表逐文件核对当前哈希、再从上述独立备份恢复本轮五个原文件并移除本轮新测试；不得覆盖之后的用户改动。本轮没有执行回滚。

## 3. 实施逻辑与保护

- `purge` 使用一次调用的统一 `now`，严格条件 `createdAt < now - 30×24h`。恰在 30 天边界不清。状态仅限 `approved`、`rejected`、`expired`；超期 `pending` 只计入 `needsMark`，需先执行已有 T-1 `mark` 及审计恢复，再由后续 `purge` 清正文。
- 候选仅含 `payload != null`，限制单批数量，按 `retention.purge.retryAfter`、`createdAt`、`_id` 排序。当前采用每次重新查询并靠已清正文退出候选集、失败记录退避来推进；没有实现独立持久游标。索引和缺失嵌套字段排序必须在真实云端验收。
- 先写批次 `prepare`，再对每条复核状态、版本与 T-1 审计；`retention.audit.state='pending'` 的记录绝不清正文。条件更新 `_id+status+rev+payload != null`，只把 `payload` 置 `null`，写 `payloadRedactedAt`、增加 `rev`、保留投稿外壳、`verifyStatus` 和审计元数据。已清正文不重复转换。
- 清正文与写逐条日志不在同一事务。清正文的同次条件更新持久化 `retention.purge.state='pending'`、稳定事件 ID、清理后版本及日期；审计写入成功后才将标记改为 `complete`。日志不确定失败时按事件 ID 回读验证；下次 `purge` 自动扫描待补标记并恢复。日志/状态更新再次失败仍保留待补依据。逐条日志写系统操作者空哈希与服务器时间，不含正文；批次有 `prepare` / `complete` 摘要。
- 候选互斥分类：`selected = purgedAudited + auditFailedCount + deferredAudit + deferredRetry + skipped + conflicts + failed`；`purged = purgedAudited + auditFailedCount`。`needsMark` 和旧清理审计的 `auditRecovery` 单独报告，不混入本批 `selected`。批次收尾日志失败返回 `LOG_FAILED`，不谎报完整成功。
- 使用既有维护令牌鉴权，未增加公开入口。没有删除整条记录，未修改投稿准入数据。

## 4. 查询、索引和限制

- 本地 `schema.submissions.json` 声明 `ix_retention_purge_candidates`（`status/retention.purge.retryAfter/createdAt/_id`）和 `ix_retention_purge_audit_queue`（`retention.purge.state/retention.purge.retryAfter/createdAt/_id`）。候选还过滤 `createdAt` 范围、`payload != null`；待补队列过滤嵌套 `state`。这是仓库草案，假数据库仅模拟相应操作；真实云端未创建、未检查执行计划。
- `status in`、`payload != null`、范围查询与多字段排序能否共同使用所列复合索引，以及不存在 `retention.purge.retryAfter` 的旧记录能否稳定排序，均 **PENDING**。若不支持，应在云端只读验证后调整查询/索引；不得凭 schema 草案宣称有效。
- 假数据库单线程测试包含两个加载实例，能检验条件更新与稳定 ID 的本地逻辑，不能证明真实云端并发原子性。退避标记自身更新失败会返回 `retrySchedulingFailed` 和部分失败；若云端持续失败，当前无可靠排队公平性保证，须实测并另行设计运维告警/恢复。

## 5. 测试与反事实

完整逐条输出及退出码保存在同目录 `T2_Retention_正文到期清理_测试原始输出_20261029.txt`（39,857 B；SHA-256 `4C342966D1D76228A8FEB37BA47DA9F2FBE29C035F4B588B6D35D4F4DE0CF437`）。以下均为本轮重新运行。

| 命令 | 实际摘要 | 退出码 |
|---|---|---:|
| `node tools/test_retention_purge.js` | PASS 18 / FAIL 0 | 0 |
| `node tools/test_retention_mark.js` | PASS 71 / FAIL 0 | 0 |
| `node tools/test_retention_recover_pending.js` | PASS 13 / FAIL 0 | 0 |
| `node tools/test_ugc_review.js` | PASS 86 / FAIL 0 | 0 |
| `node tools/test_ugc_submit.js` | PASS 110 / FAIL 0 | 0 |
| `node tools/test_ugc_client_contract.js` | PASS 90 / FAIL 0 | 0 |
| `node tools/test_index_state.js` | 通过 205 项，失败 0 项 | 0 |
| `node tools/check_eol.js` | 原始输出见日志；无违规 | 0 |
| `node tools/test_check_doc_refs.js` | 通过 51，失败 0 | 0 |
| `git diff --check` | 无 diff 错误；仅已有 `project.config.json` 的 CRLF 提示 | 0 |

专项测试 P1–P18 覆盖严格 30 天边界、三种终态、保留外壳、重复执行、日志脱敏、pending 先标记、T-1 审计待补保护与恢复、rev 竞争、数据库失败与退避、逐条日志失败跨实例恢复、prepare/complete 失败、两个加载实例、未授权拒绝、schema 草案和异常版本。所有结果由本轮假数据库故障注入产生。修改前备份版在隔离假数据库中执行同一 `purge` 入口得到 `OLD_PURGE_EXPORT=undefined`、`OLD_PURGE_ACTION=INVALID_ACTION`、退出码 0；旧版无法满足新专项测试。此反事实仅证明新增入口/测试能区分旧实现，不能替代真实云端验证。

五个备份到当前文件及新测试均另用 `git diff --no-index --check` 检查：无空白错误输出；该命令因文件有差异按设计返回 1。下附逐字统一差异。

## 6. Git 状态、副作用和待审

- 结束时仍为 `main` / `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，暂存区空；状态清单 324 项（15 个已修改、309 个未跟踪）。较预检仅增加本轮新测试。五个现有目标文件原本就是未跟踪文件，本轮只在其现状上追加修改；原有脏文件和未跟踪文件保留。报告与测试原始输出位于项目外的 `报告` 目录。
- 本地功能及离线验证 **PASS**。真实索引、查询计划、嵌套缺失字段、并发原子性、调度可靠性及连续失败后的公平性 **PENDING**；不应宣称云端 T-2 PASS。
- DSH 请重点核对：备份与逐项 diff；T-1 待补审计保护是否覆盖真实竞态；条件更新及稳定事件 ID 的真实数据库语义；审计标记与正文写入的原子关系；复合查询与索引实际可用性；连续退避失败时的饥饿风险；日志字段合规及外壳保留。

## 附录：本轮精确 unified diff（备份 → 当前）
### cloudfunctions\retention\index.js

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\cloudfunctions__retention__index.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
index bfcadca..089d511 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\cloudfunctions__retention__index.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
@@ -4,8 +4,9 @@
  * 本函数不包含 triggers 配置，不能因提交本代码而自动运行。部署前必须由负责人
  * 在云环境显式确认每项策略参数；缺少或未确认任一参数时，入口失败关闭且不读写数据。
  *
- * mark 标记到期 pending；recover 按投稿 ID 补齐已标记记录的逐条审计。
- * 正文清除与审计日志轮转是独立的不可逆流程，不在本入口实现。
+ * mark 标记到期 pending；recover/recoverPending 补齐标记审计。
+ * purge 在独立阶段清理超过 30 天的终态正文，并补齐清理审计。
+ * 日志轮转与云端触发器仍不在本入口实现。
  *
  * 环境变量（均必填、无默认值）：
  *   UGC_RETENTION_POLICY_STATUS=confirmed
@@ -37,7 +38,9 @@ const STATUS = Object.freeze({
 
 const DAY_MS = 24 * 60 * 60 * 1000;
 const MARK_AFTER_DAYS = 29;
+const PURGE_AFTER_DAYS = 30;
 const MAX_BATCH_LIMIT = 100;
+const PURGE_STATES = Object.freeze(['approved', 'rejected', 'expired']);
 
 function fail(code, message, extra) {
   return Object.assign({ ok: false, code: code, message: message || '' }, extra || {});
@@ -228,6 +231,176 @@ async function recoverPending(options) {
   return Object.assign({ ok: result.failed === 0, code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
 }
 
+function purgeEventId(id, rev) {
+  return 'retention_purge_' + crypto.createHash('sha256')
+    .update(String(id) + '\0' + String(rev)).digest('hex');
+}
+
+async function writePurgeLog(result, phase, code, submissionId, eventId) {
+  const data = {
+    schemaVersion: 1, event: 'retention_purge', action: 'retention_purge',
+    submissionId: submissionId || null, day: result.day || result.now.toISOString().slice(0, 10),
+    result: { code: code }, errorCode: '',
+    actor: { role: 'system', openidHash: null }, at: db.serverDate(), rev: 1
+  };
+  if (eventId) data._id = eventId;
+  if (phase !== 'record') data.result.stats = {
+    phase: phase, batchId: result.batchId, selected: result.selected,
+    purged: result.purged, purgedAudited: result.purgedAudited,
+    auditFailedCount: result.auditFailedCount, deferredAudit: result.deferredAudit,
+    deferredRetry: result.deferredRetry, conflicts: result.conflicts,
+    failed: result.failed, skipped: result.skipped, needsMark: result.needsMark
+  };
+  return db.collection(COL.LOGS).add({ data: data });
+}
+
+async function recoverPurgeAudit(submissionId) {
+  let row;
+  try { row = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
+  catch (err) { return fail('DATABASE_ERROR', '读取待补清理审计失败'); }
+  const purge = row && row.retention && row.retention.purge;
+  if (!purge) return fail('NO_PENDING_PURGE_AUDIT', '没有待补清理审计标记');
+  if (purge.state === 'complete') return { ok: true, code: 'ALREADY_RECOVERED' };
+  if (purge.state !== 'pending' || !Number.isInteger(purge.purgedRev) ||
+      purge.eventId !== purgeEventId(row._id, purge.purgedRev) || row.payload !== null ||
+      !/^\d{4}-\d{2}-\d{2}$/.test(purge.day)) {
+    return fail('PURGE_AUDIT_STATE_INVALID', '清理状态与待补审计标记不一致');
+  }
+  try { await writePurgeLog({ day: purge.day }, 'record', 'OK', row._id, purge.eventId); }
+  catch (err) {
+    let existing;
+    try { existing = (await db.collection(COL.LOGS).doc(purge.eventId).get()).data; }
+    catch (readErr) { return fail('LOG_FAILED', '清理逐条审计尚未确认落库'); }
+    if (!existing || existing._id !== purge.eventId || existing.event !== 'retention_purge' ||
+        existing.action !== 'retention_purge' || existing.submissionId !== row._id ||
+        existing.day !== purge.day || existing.rev !== 1 ||
+        !existing.actor || existing.actor.role !== 'system' || existing.actor.openidHash !== null ||
+        !existing.result || existing.result.code !== 'OK') {
+      return fail('PURGE_AUDIT_STATE_INVALID', '已有清理审计内容不匹配');
+    }
+  }
+  try {
+    const updated = await db.collection(COL.SUBMISSIONS)
+      .where({ _id: row._id, status: row.status, rev: row.rev,
+        'retention.purge.eventId': purge.eventId, 'retention.purge.state': 'pending' })
+      .update({ data: { 'retention.purge.state': 'complete' } });
+    if (updated && updated.stats && updated.stats.updated === 1) return { ok: true, code: 'OK' };
+    const latest = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data;
+    if (latest && latest.retention && latest.retention.purge &&
+        latest.retention.purge.eventId === purge.eventId && latest.retention.purge.state === 'complete') {
+      return { ok: true, code: 'ALREADY_RECOVERED' };
+    }
+    return fail('STATE_CONFLICT', '清理审计已存在，待补标记尚未确认完成');
+  } catch (err) { return fail('DATABASE_ERROR', '清理审计已存在，待补标记更新失败'); }
+}
+
+async function deferPurge(row, now) {
+  const purge = row.retention && row.retention.purge || {};
+  try {
+    const updated = await db.collection(COL.SUBMISSIONS)
+      .where({ _id: row._id, status: row.status, rev: row.rev })
+      .update({ data: { 'retention.purge.retryAfter': new Date(now.getTime() + RECOVERY_RETRY_MS) } });
+    return !!(updated && updated.stats && updated.stats.updated === 1 && purge.state !== 'complete');
+  } catch (err) { return false; }
+}
+
+async function recoverPurgePending(options) {
+  const config = readPolicy();
+  if (config.error) return config.error;
+  const now = options && options.now instanceof Date ? options.now : new Date();
+  let rows;
+  try {
+    const response = await db.collection(COL.SUBMISSIONS)
+      .where({ 'retention.purge.state': 'pending' })
+      .orderBy('retention.purge.retryAfter', 'asc').orderBy('createdAt', 'asc')
+      .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
+    rows = response && Array.isArray(response.data) ? response.data : [];
+  } catch (err) { return fail('DATABASE_ERROR', '读取待补清理审计队列失败'); }
+  const result = { selected: rows.length, recovered: 0, deferred: 0, conflicts: 0, failed: 0 };
+  for (const row of rows) {
+    const retryAfter = row.retention && row.retention.purge && row.retention.purge.retryAfter;
+    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) { result.deferred++; continue; }
+    const outcome = await recoverPurgeAudit(row._id);
+    if (outcome.ok && outcome.code === 'OK') result.recovered++;
+    else if (outcome.ok || outcome.code === 'STATE_CONFLICT') result.conflicts++;
+    else {
+      result.failed++;
+      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
+    }
+  }
+  return Object.assign({ ok: result.failed === 0,
+    code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
+}
+
+async function purgePayload(options) {
+  const config = readPolicy();
+  if (config.error) return config.error;
+  const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
+  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
+  const cutoff = makeCutoff(now, PURGE_AFTER_DAYS);
+  let needsMark;
+  let rows;
+  try {
+    const pending = await db.collection(COL.SUBMISSIONS)
+      .where({ status: STATUS.PENDING, createdAt: _.lt(cutoff) }).count();
+    needsMark = pending.total;
+    const response = await db.collection(COL.SUBMISSIONS)
+      .where({ status: _.in(PURGE_STATES), createdAt: _.lt(cutoff), payload: _.neq(null) })
+      .orderBy('retention.purge.retryAfter', 'asc').orderBy('createdAt', 'asc')
+      .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
+    rows = response && Array.isArray(response.data) ? response.data : [];
+  } catch (err) { return fail('DATABASE_ERROR', '读取到期正文候选失败'); }
+  const auditRecovery = await recoverPurgePending({ now: now });
+  if (auditRecovery.code === 'DATABASE_ERROR') return fail('DATABASE_ERROR', '清理审计恢复队列读取失败');
+  const result = { now: now, batchId: options && options.requestId || crypto.randomBytes(16).toString('hex'),
+    selected: rows.length, needsMark: needsMark, purged: 0, purgedAudited: 0,
+    auditFailedCount: 0, deferredAudit: 0, deferredRetry: 0,
+    skipped: 0, conflicts: 0, failed: 0, auditRecovery: auditRecovery };
+  try { await writePurgeLog(result, 'prepare', 'PREPARE', null); }
+  catch (err) { return fail('LOG_FAILED', '清理批次准备审计失败，未清正文',
+    { selected: rows.length, needsMark: needsMark, purged: 0, logged: false }); }
+  for (const row of rows) {
+    const retryAfter = row.retention && row.retention.purge && row.retention.purge.retryAfter;
+    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) { result.deferredRetry++; continue; }
+    if (row.retention && row.retention.audit && row.retention.audit.state === 'pending') {
+      result.deferredAudit++;
+      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
+      continue;
+    }
+    if (PURGE_STATES.indexOf(row.status) === -1 || row.payload === null ||
+        !Number.isInteger(row.rev) || row.rev < 1) {
+      result.skipped++;
+      if (!await deferPurge(row, now)) result.retrySchedulingFailed = true;
+      continue;
+    }
+    const nextRev = row.rev + 1;
+    const eventId = purgeEventId(row._id, nextRev);
+    let updated;
+    try {
+      updated = await db.collection(COL.SUBMISSIONS)
+        .where({ _id: row._id, status: row.status, rev: row.rev, payload: _.neq(null) })
+        .update({ data: { payload: null, payloadRedactedAt: db.serverDate(),
+          'retention.purge': { state: 'pending', eventId: eventId, purgedRev: nextRev,
+            day: now.toISOString().slice(0, 10), retryAfter: new Date(0) },
+          updatedAt: db.serverDate(), rev: nextRev } });
+    } catch (err) { result.failed++; if (!await deferPurge(row, now)) result.retrySchedulingFailed = true; continue; }
+    if (!updated || !updated.stats || updated.stats.updated !== 1) { result.conflicts++; continue; }
+    result.purged++;
+    const outcome = await recoverPurgeAudit(row._id);
+    if (outcome.ok) result.purgedAudited++;
+    else result.auditFailedCount++;
+  }
+  const hasFailure = result.failed || result.auditFailedCount || auditRecovery.failed || result.retrySchedulingFailed;
+  const hasDeferred = result.deferredAudit || result.deferredRetry || result.skipped ||
+    result.needsMark || auditRecovery.deferred;
+  const complete = hasFailure ? 'PARTIAL' : (hasDeferred ? 'DEFERRED' : 'COMPLETE');
+  try { await writePurgeLog(result, 'complete', complete, null); }
+  catch (err) { return fail('LOG_FAILED', '正文处理后批次审计收尾失败', Object.assign({ logged: false }, result)); }
+  return Object.assign({ ok: complete === 'COMPLETE',
+    code: complete === 'COMPLETE' ? 'OK' : (hasFailure ? 'PURGE_PARTIAL' : 'PURGE_DEFERRED'),
+    cutoff: cutoff.toISOString() }, result);
+}
+
 async function markExpired(options) {
   const config = readPolicy();
   if (config.error) return config.error;
@@ -351,14 +524,15 @@ async function markExpired(options) {
 }
 
 exports.main = async function (event, context) {
-  if (!event || ['mark', 'recover', 'recoverPending'].indexOf(event.action) === -1) {
-    return fail('INVALID_ACTION', '仅支持维护令牌保护的 mark/recover/recoverPending 动作');
+  if (!event || ['mark', 'recover', 'recoverPending', 'purge'].indexOf(event.action) === -1) {
+    return fail('INVALID_ACTION', '仅支持维护令牌保护的保留期动作');
   }
   if (!hasValidMaintenanceToken(event.maintenanceToken)) {
     return fail('FORBIDDEN', '维护令牌无效或未配置');
   }
   if (event.action === 'recover') return recoverAudit(event.submissionId);
   if (event.action === 'recoverPending') return recoverPending();
+  if (event.action === 'purge') return purgePayload({ requestId: context && context.request_id });
   return markExpired({ requestId: context && context.request_id });
 };
 
@@ -367,5 +541,8 @@ exports.__test__ = {
   readPolicy: readPolicy,
   markExpired: markExpired,
   recoverAudit: recoverAudit,
-  recoverPending: recoverPending
+  recoverPending: recoverPending,
+  purgePayload: purgePayload,
+  recoverPurgePending: recoverPurgePending,
+  recoverPurgeAudit: recoverPurgeAudit
 };
``` 

### tools\ugc_fake_cloud.js

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\tools__ugc_fake_cloud.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\ugc_fake_cloud.js"
index 7746cb0..6e0125a 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\tools__ugc_fake_cloud.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\ugc_fake_cloud.js"
@@ -40,9 +40,24 @@ function matchValue(actual, expected) {
     const b = expected.value instanceof Date ? expected.value.getTime() : new Date(expected.value).getTime();
     return a < b;
   }
+  if (expected && typeof expected === 'object' && expected.__op === 'in') return expected.values.indexOf(actual) !== -1;
+  if (expected && typeof expected === 'object' && expected.__op === 'neq') return actual !== expected.value;
   return actual === expected;
 }
 
+function applyData(row, data, cloneValue) {
+  Object.keys(data).forEach(function (key) {
+    if (key.indexOf('.') === -1) { row[key] = cloneValue(data[key]); return; }
+    const parts = key.split('.');
+    let target = row;
+    for (let i = 0; i < parts.length - 1; i++) {
+      if (!target[parts[i]] || typeof target[parts[i]] !== 'object') target[parts[i]] = {};
+      target = target[parts[i]];
+    }
+    target[parts[parts.length - 1]] = cloneValue(data[key]);
+  });
+}
+
 function matches(doc, cond) {
   const keys = Object.keys(cond || {});
   for (let i = 0; i < keys.length; i++) {
@@ -84,7 +99,9 @@ function createHarness() {
 
   const command = {
     gte: function (value) { return { __op: 'gte', value: value }; },
-    lt: function (value) { return { __op: 'lt', value: value }; }
+    lt: function (value) { return { __op: 'lt', value: value }; },
+    in: function (values) { return { __op: 'in', values: values }; },
+    neq: function (value) { return { __op: 'neq', value: value }; }
   };
 
   function query(name, cond) {
@@ -128,7 +145,7 @@ function createHarness() {
         let updated = 0;
         for (let i = 0; i < rows.length; i++) {
           if (matches(rows[i], chain._cond)) {
-            Object.assign(rows[i], clone(payload.data));
+            applyData(rows[i], payload.data, clone);
             updated++;
           }
         }
@@ -176,7 +193,7 @@ function createHarness() {
             state.updateCalls++;
             const found = rows.filter(function (d) { return d._id === id; })[0];
             if (!found) return Promise.resolve({ stats: { updated: 0 } });
-            Object.assign(found, clone(payload.data));
+            applyData(found, payload.data, clone);
             return Promise.resolve({ stats: { updated: 1 } });
           }
         };
``` 

### config\cloud\schema.submissions.json

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\config__cloud__schema.submissions.json" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.submissions.json"
index cf4fa9f..a37b55f 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\config__cloud__schema.submissions.json"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.submissions.json"
@@ -5,8 +5,8 @@
     "rules": "本文件只是本地草稿；集合创建、索引与权限必须在微信云开发后台逐项配置并留存截图，才能标记为已生效",
     "collection": "submissions",
     "readBy": "普通客户端不可直读；仅 review 与 retention 云函数以服务端身份读取（云端权限待验收）",
-    "writtenBy": "submit 云函数创建、review 云函数人工审核、retention 云函数系统过期标记；客户端不可直写",
-    "retention": "已裁决正文自 createdAt 起 30 天、审计明细 90 天、逐条摘要自生成起 180 天；仅 T-1 本地实现，清理与云端部署未完成"
+    "writtenBy": "submit 云函数创建、review 云函数人工审核、retention 云函数系统过期标记与正文清理；客户端不可直写",
+    "retention": "已裁决正文自 createdAt 起 30 天、审计明细 90 天、逐条摘要自生成起 180 天；T-1/T-2 仅本地实现，日志轮转与云端部署未完成"
   },
   "fields": {
     "_id": { "type": "string", "note": "系统生成" },
@@ -62,6 +62,17 @@
       "type": "object|null",
       "note": "仅系统保留期流程写入；T-1 标记不清 payload",
       "properties": {
+        "purge": {
+          "type": "object|null",
+          "note": "T-2 正文清理及待补审计；不包含正文",
+          "properties": {
+            "state": { "type": "string", "enum": ["pending", "complete"] },
+            "eventId": { "type": "string" },
+            "day": { "type": "string" },
+            "purgedRev": { "type": "integer" },
+            "retryAfter": { "type": "date" }
+          }
+        },
         "markedAt": { "type": "date", "note": "T-1 系统标记时间" },
         "policyConfirmedBy": { "type": "string", "note": "已确认策略的记录标识，不含令牌或正文" },
         "audit": {
@@ -131,6 +142,18 @@
       "unique": false,
       "purpose": "待补审计自动发现与有界队列推进；仅本地建议，云端未建且查询计划未验收"
     },
+    {
+      "name": "ix_retention_purge_candidates",
+      "keys": [{ "field": "status", "order": "asc" }, { "field": "retention.purge.retryAfter", "order": "asc" }, { "field": "createdAt", "order": "asc" }, { "field": "_id", "order": "asc" }],
+      "unique": false,
+      "purpose": "T-2 终态候选：另筛 createdAt 截止和 payload 非空；仅本地建议，云端查询计划未验收"
+    },
+    {
+      "name": "ix_retention_purge_audit_queue",
+      "keys": [{ "field": "retention.purge.state", "order": "asc" }, { "field": "retention.purge.retryAfter", "order": "asc" }, { "field": "createdAt", "order": "asc" }, { "field": "_id", "order": "asc" }],
+      "unique": false,
+      "purpose": "T-2 已清正文但逐条审计待补的有界恢复队列；仅本地建议，云端未建"
+    },
     {
       "name": "ix_submitter_created",
       "keys": [{ "field": "submitter.openid", "order": "asc" }, { "field": "createdAt", "order": "desc" }],
``` 

### config\cloud\schema.upload_logs.json

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\config__cloud__schema.upload_logs.json" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.upload_logs.json"
index addbf09..0cb4941 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\config__cloud__schema.upload_logs.json"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\config\\cloud\\schema.upload_logs.json"
@@ -10,8 +10,8 @@
   "fields": {
     "_id": { "type": "string", "note": "系统生成" },
     "schemaVersion": { "type": "integer", "value": 1 },
-    "event": { "type": "string", "enum": ["submit", "denied", "throttle", "security_call", "review_approve", "review_reject", "alarm", "delete_request", "retention_mark"] },
-    "action": { "type": "string", "note": "云函数实际动作；系统标记使用 retention_mark，人工审核使用各自已定义动作" },
+    "event": { "type": "string", "enum": ["submit", "denied", "throttle", "security_call", "review_approve", "review_reject", "alarm", "delete_request", "retention_mark", "retention_purge"] },
+    "action": { "type": "string", "note": "云函数实际动作；系统标记／清理使用 retention_mark／retention_purge，人工审核使用各自已定义动作" },
     "submissionId": { "type": "string|null", "note": "逐条事件关联投稿 ID；批次 prepare/complete 为 null" },
     "actor": {
       "type": "object",
``` 

### docs\UGC_MVP_DESIGN_FINAL_20261026.md

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\docs\\UGC_MVP_DESIGN_FINAL_20261026.md"
index a63018c..d4cd72c 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\t2-retention-20261029-20261029T0654162507883Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\docs\\UGC_MVP_DESIGN_FINAL_20261026.md"
@@ -185,8 +185,8 @@
 | 字段 | 类型 | 说明 |
 |---|---|---|
 | `_id` | string | 自动 |
-| `event` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` / `retention_mark` |
-| `action` | string | 云函数实际动作；系统到期标记为 `retention_mark`。系统逐条事件仅含已裁决的八个逻辑字段，批次 `prepare` / `complete` 另含运行统计 |
+| `event` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` / `retention_mark` / `retention_purge` |
+| `action` | string | 云函数实际动作；系统到期标记和清理分别为 `retention_mark`、`retention_purge`。系统逐条事件长期仅投影已裁决的八个逻辑字段，批次 `prepare` / `complete` 另含运行统计 |
 | `submissionId` | string? | `throttle`/`denied`（未关联记录时）为空 |
 | `actor` | object | 投稿人／管理员：`{ openidHash, role }`，其中哈希为 32 位小写十六进制 HMAC 摘要；系统：`{ role:'system', openidHash:null }`；**日志内不存明文 openid，也不使用虚构哈希** |
 | `at` / `rev` | date / integer | 运行日志均写 `at=db.serverDate()`、`rev=1`；90 天后逐条摘要仅投影八个已裁决逻辑字段，不含这两项 |
@@ -262,7 +262,7 @@ pending ──approve──> approved（终态）
 
 #### 3.5.2 保留期（2026-10-28 已裁决，尚未部署）
 
-**现行裁决**：投稿正文自 `createdAt` 起 30 天，审计明细 90 天；逐条摘要采用 `schemaVersion/event/action/submissionId/day/result.code/errorCode/role` 八个逻辑字段，自生成起保留 180 天。每批追加 `prepare` 与 `complete` 两条运行摘要，失败需区分全失败和部分成功。系统运行日志填写 `actor.openidHash:null`，人工操作者沿用 32 位 HMAC 摘要；运行日志填写 `at/rev`，到期后的逐条摘要仍严格只投影八字段。当前仅 T-1 标记有本地代码，T-2 正文清理、日志轮转及触发器尚未实现或部署；本节规则不代表线上已生效。下列 A/B/C 表仅保留历史候选背景，不再作为待决选项。
+**现行裁决**：投稿正文自 `createdAt` 起 30 天，审计明细 90 天；逐条摘要采用 `schemaVersion/event/action/submissionId/day/result.code/errorCode/role` 八个逻辑字段，自生成起保留 180 天。每批追加 `prepare` 与 `complete` 两条运行摘要，失败需区分全失败和部分成功。系统运行日志填写 `actor.openidHash:null`，人工操作者沿用 32 位 HMAC 摘要；运行日志填写 `at/rev`，到期后的逐条摘要仍严格只投影八字段。T-1 标记和 T-2 正文清理已有本地代码，日志轮转、真实云端索引和触发器尚未实现或部署；本节规则不代表线上已生效。下列 A/B/C 表仅保留历史候选背景，不再作为待决选项。
 
 本节此前把「`submissions` 90 天 / `upload_logs` 180 天」写成既定值，属于越权设定；以下 A/B/C 仅为裁决前的历史候选，不再要求负责人重新选择：
 
@@ -274,6 +274,7 @@ pending ──approve──> approved（终态）
 
 - **本地与线上状态**：`config/ugc.js` 仍标 `pending_confirmation`，表示尚未部署和验收，不能再解释为业务期限未裁决。上线前须先完成隐私指引、清理实现与触发器验收并留截图。
 - **清理纪律**：T-1 只改状态、不清正文；T-2 独立按严格 30 天边界清正文，若仍为 pending，先补标 expired；过期标记与正文清理各自留痕，不得用 `delete_request` 冒充系统保留事件。正文删除后保留符合八字段口径的最小摘要；用户主动删除请求见 §7.7。
+- **T-2 本地实现（云端待验收）**：`purge` 不直接处理 pending；返回超期 `needsMark`，由独立 T-1 标记及审计恢复完成后再清。终态候选满足 `createdAt < now-30×24h`、状态为 approved/rejected/expired、`payload != null`；若 `retention.audit.state='pending'` 则延后处理并保留标记。按 `retention.purge.retryAfter/createdAt/_id` 稳定排序和有界批次逐次消退；写入前以 `_id+status+rev+payload 非空` 条件更新，只将正文置 null、写 `payloadRedactedAt` 与待补清理审计标记，保留记录外壳及 `verifyStatus`。`retention_purge` 逐条事件使用稳定 ID，可由下一次 purge 自动补记；日志与正文写入不在同一事务，真实云端原子性、索引及调度均待验收。批次互斥分类为 `purgedAudited/auditFailedCount/deferredAudit/deferredRetry/skipped/conflicts/failed`，其和等于 `selected`，`purged=purgedAudited+auditFailedCount`；另报 `needsMark` 与清理审计恢复结果。
 - **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。`recoverPending` 在相同鉴权下按 `retention.audit.state='pending'` 查询，并按 `retryAfter/createdAt/_id` 稳定排序、限批处理；成功项退出队列，失败项延后一分钟，重复触发可继续处理下一批而不依赖偏移量。每批 `selected=recovered+deferred+conflicts+failed`；真实复合索引、数据库原子性和进程中断行为未验收，不得把本地模拟称为云端可靠恢复。
 
 ---
@@ -453,7 +454,7 @@ pending ──approve──> approved（终态）
 
 - 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
 - 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
-- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
+- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending/purge`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
 
 ### 7.2 输入校验（服务端独立复算）
 
``` 

### tools\test_retention_purge.js（新建）

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_purge.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_purge.js"
new file mode 100644
index 0000000..7ee9460
--- /dev/null
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_purge.js"
@@ -0,0 +1,148 @@
+'use strict';
+const { createHarness } = require('./ugc_fake_cloud');
+const h = createHarness();
+const fn = h.loadFunction('cloudfunctions/retention/index.js');
+const T = fn.__test__;
+const now = new Date('2026-10-28T12:00:00Z');
+const day = 86400000;
+let pass = 0, fail = 0;
+function check(name, value) { console.log((value ? 'PASS ' : 'FAIL ') + name); if (value) pass++; else fail++; }
+function setup(limit) {
+  h.reset();
+  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
+  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
+  process.env.UGC_RETENTION_BATCH_LIMIT = String(limit || 10);
+  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
+  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
+}
+function seed(id, status, age, payload) {
+  h.seed('submissions', { _id: id, status: status, rev: 1,
+    createdAt: new Date(now.getTime() - age), updatedAt: new Date(now.getTime() - age),
+    payload: payload === undefined ? { note: 'private-body-' + id } : payload,
+    verifyStatus: 'unverified', source: { kind: 'user' }, review: { decision: status } });
+}
+function doc(id) { return h.docs('submissions').find(function (row) { return row._id === id; }); }
+function logs(id) { return h.docs('upload_logs').filter(function (row) { return row.event === 'retention_purge' && row.submissionId === id; }); }
+function closed(r) { return r.selected === r.purgedAudited + r.auditFailedCount +
+  r.deferredAudit + r.deferredRetry + r.skipped + r.conflicts + r.failed &&
+  r.purged === r.purgedAudited + r.auditFailedCount; }
+
+async function run() {
+  setup();
+  seed('young', 'approved', 30 * day - 1);
+  seed('exact', 'rejected', 30 * day);
+  seed('approved', 'approved', 30 * day + 1);
+  seed('rejected', 'rejected', 31 * day);
+  seed('expired', 'expired', 32 * day);
+  let r = await T.purgePayload({ now: now });
+  check('P1 严格 30 天边界：整点与未到期不清，超时才清',
+    doc('young').payload !== null && doc('exact').payload !== null &&
+    ['approved', 'rejected', 'expired'].every(function (id) { return doc(id).payload === null; }) &&
+    r.purged === 3 && closed(r));
+  check('P2 保留外壳、审核状态、来源和准入状态',
+    ['approved', 'rejected', 'expired'].every(function (id) {
+      const row = doc(id); return row.status === id && row.rev === 2 &&
+        row.payloadRedactedAt instanceof Date && row.verifyStatus === 'unverified' &&
+        row.source.kind === 'user' && row.review.decision === id;
+    }));
+  r = await T.purgePayload({ now: now });
+  check('P3 重跑已清正文不重复转换或写逐条日志', r.purged === 0 && r.selected === 0 &&
+    ['approved', 'rejected', 'expired'].every(function (id) { return logs(id).length === 1; }));
+  check('P4 清理日志不含正文或身份字段',
+    JSON.stringify(h.docs('upload_logs')).indexOf('private-body') === -1 &&
+    h.docs('upload_logs').every(function (log) { return log.actor.openidHash === null; }));
+
+  setup(); seed('pending', 'pending', 32 * day);
+  r = await T.purgePayload({ now: now });
+  check('P5 超期 pending 只报告需标记，不清正文', r.needsMark === 1 &&
+    r.code === 'PURGE_DEFERRED' && doc('pending').payload !== null && doc('pending').status === 'pending');
+  await T.markExpired({ now: now });
+  r = await T.purgePayload({ now: now });
+  check('P6 经既有状态转换和审计完成后才清正文',
+    doc('pending').status === 'expired' && doc('pending').retention.audit.state === 'complete' &&
+    doc('pending').payload === null && r.purged === 1);
+
+  setup(); seed('mark_failed', 'pending', 32 * day);
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  await T.markExpired({ now: now }); h.clearFail();
+  r = await T.purgePayload({ now: now });
+  check('P7 T-1 审计待补时绝不清正文', r.deferredAudit === 1 &&
+    doc('mark_failed').payload !== null && doc('mark_failed').retention.audit.state === 'pending' && closed(r));
+  await T.recoverAudit('mark_failed');
+  r = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
+  check('P8 标记审计恢复完成且退避结束后可清正文', r.purged === 1 &&
+    doc('mark_failed').payload === null && doc('mark_failed').retention.audit.state === 'complete');
+
+  setup(); seed('race', 'approved', 31 * day);
+  h.setBeforeUpdate(function (rows) { rows[0].status = 'rejected'; rows[0].rev = 2; h.setBeforeUpdate(null); });
+  const conflict = await T.purgePayload({ now: now });
+  const retry = await T.purgePayload({ now: now });
+  check('P9 并发状态和 rev 变化不被覆盖，重读后的下次运行可继续',
+    conflict.conflicts === 1 && conflict.purged === 0 && retry.purged === 1 &&
+    doc('race').status === 'rejected' && doc('race').rev === 3 && closed(conflict));
+
+  setup(1); seed('bad', 'approved', 40 * day); seed('good', 'rejected', 39 * day);
+  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
+  const failed = await T.purgePayload({ now: now }); h.clearFail();
+  const advanced = await T.purgePayload({ now: now });
+  const delayed = await T.purgePayload({ now: now });
+  const resumed = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
+  check('P10 写入失败退避，后续记录跨批推进', failed.failed === 1 &&
+    advanced.purged === 1 && delayed.deferredRetry === 1 && resumed.purged === 1 &&
+    doc('bad').payload === null && doc('good').payload === null &&
+    [failed, advanced, delayed, resumed].every(closed));
+
+  setup(); seed('log_failure', 'approved', 31 * day);
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  const auditFailure = await T.purgePayload({ now: now }); h.clearFail();
+  const afterFailure = await h.loadFunction('cloudfunctions/retention/index.js').__test__.purgePayload({ now: now });
+  check('P11 逐条审计失败后标记留存，重启实例自动补记且不重复清正文',
+    auditFailure.code === 'PURGE_PARTIAL' && auditFailure.auditFailedCount === 1 &&
+    afterFailure.auditRecovery.recovered === 1 && doc('log_failure').retention.purge.state === 'complete' &&
+    doc('log_failure').rev === 2 && logs('log_failure').length === 1 && closed(auditFailure));
+
+  setup(); seed('prepare_failure', 'approved', 31 * day);
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
+  r = await T.purgePayload({ now: now });
+  check('P12 批次 prepare 日志失败零正文写入', r.code === 'LOG_FAILED' && doc('prepare_failure').payload !== null);
+  h.clearFail(); r = await T.purgePayload({ now: now });
+  check('P13 prepare 失败后重试可完成', r.purged === 1 && doc('prepare_failure').payload === null);
+
+  setup(); seed('concurrent', 'approved', 31 * day);
+  const other = h.loadFunction('cloudfunctions/retention/index.js');
+  const both = await Promise.all([T.purgePayload({ now: now }), other.__test__.purgePayload({ now: now })]);
+  check('P14 两函数实例共享假 DB 时单次有效清理',
+    both[0].purged + both[1].purged === 1 && logs('concurrent').length === 1 &&
+    doc('concurrent').payload === null && both.every(closed));
+
+  r = await fn.main({ action: 'purge' }, {});
+  check('P15 无维护令牌被拒绝', r.code === 'FORBIDDEN');
+  const schema = require('../config/cloud/schema.submissions.json');
+  const auditSchema = require('../config/cloud/schema.upload_logs.json');
+  check('P16 本地索引与事件草案已声明且未冒充云端生效',
+    schema.indexes.some(function (x) { return x.name === 'ix_retention_purge_candidates'; }) &&
+    schema.indexes.some(function (x) { return x.name === 'ix_retention_purge_audit_queue'; }) &&
+    auditSchema.fields.event.enum.indexOf('retention_purge') !== -1 &&
+    schema._meta.status === 'pending_admin_console_verification');
+
+  setup(); seed('complete_log_failure', 'approved', 31 * day);
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 3 });
+  const incompleteBatch = await T.purgePayload({ now: now });
+  h.clearFail();
+  const retriedBatch = await T.purgePayload({ now: now });
+  check('P17 批次 complete 日志失败不谎报成功，重跑不重复逐条事件',
+    incompleteBatch.code === 'LOG_FAILED' && incompleteBatch.logged === false &&
+    doc('complete_log_failure').payload === null && retriedBatch.purged === 0 &&
+    logs('complete_log_failure').length === 1 && closed(incompleteBatch));
+
+  setup(1); seed('invalid_rev', 'approved', 40 * day); seed('behind_invalid', 'rejected', 39 * day);
+  h.state.docs.submissions[0].rev = 0;
+  const invalid = await T.purgePayload({ now: now });
+  const progressed = await T.purgePayload({ now: now });
+  check('P18 异常版本记录退避，不永久挤占后续名额', invalid.skipped === 1 &&
+    progressed.purged === 1 && doc('invalid_rev').payload !== null &&
+    doc('behind_invalid').payload === null && closed(invalid) && closed(progressed));
+  console.log('PASS ' + pass + ' / FAIL ' + fail);
+  if (fail) process.exitCode = 1;
+}
+run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
``` 
