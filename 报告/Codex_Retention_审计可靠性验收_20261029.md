# Retention 审计可靠性与契约一致性：本地验收（2026-10-29）

**总状态：PENDING。** 计数守恒、按 ID 补记和本地日志结构已通过离线测试；待补记录的自动发现、真实云端自定义 `_id` 追加及条件更新语义、云端索引与权限尚未验证，不能宣称审计恢复全面可靠。T-2 正文清理仍未实现。

## 1. 实测基线与缺陷复现

项目 HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、分支 `main`、暂存区为空；开工 `git status --porcelain=v1 --untracked-files=all` 为 310 项（15 个已修改跟踪文件、295 个未跟踪文件）。`.baton/task.md` 与 `.baton/handoff/current.md` 当前均不存在。

在修改前备份的 `cloudfunctions/retention/index.js` 上，用隔离 fake DB 种入两个到期 pending 记录，令第二次 `upload_logs.add` 失败：实际输出 `code=LOG_FAILED, marked=1, skipped=0, conflicts=0, failed=0, statuses=[a:expired,b:pending]`，命令退出码 0。可见 `a` 已改状态但逐条日志缺失，`b` 已选中却未分类。当前测试基线 60/0；DSH 报告中的故障并未被该套件锁住。

## 2. 计数语义与本地恢复路径

- `attempts` 保留原有含义：本批数据库返回的选中行数；新增 `selected` 为同一数值。既有 `marked` 保留“状态转换成功数”，包括审计尚待补齐的行，避免静默改变接口。
- 互斥分类为 `markedAudited`（转换且逐条审计确认）、`auditFailedCount`（转换成功但审计或待补标记确认失败）、`skipped`（选中但本地前置条件不合）、`conflicts`（条件更新零行）、`failed`（数据库更新异常）、`unprocessed`（审计中断后剩余未处理）。不变量：`selected = markedAudited + auditFailedCount + skipped + conflicts + failed + unprocessed`，且 `marked = markedAudited + auditFailedCount`。旧的批次 `auditFailed` 布尔值仍保留。
- 状态 `pending→expired` 与 `retention.audit={state:'pending',markedRev,eventId,day}` 在同一次带 `_id+status+rev` 的条件更新中写入。逐条日志使用由投稿 ID 和标记后 rev 计算的稳定 `_id`，填写 `at/rev:1`、`actor:{role:'system',openidHash:null}`；追加成功或在回执不明时按 `_id` 读回核对后，再把标记置为 `complete`。维护令牌保护的 `recover` 按投稿 ID 重试，重复或并发恢复只接受内容匹配的同 ID 日志。后续审核或删除改变状态／rev 时仍以 `markedRev` 识别原标记事件。
- 该机制需要云端允许服务端以指定 `_id` 追加并按 `_id` 读取日志、按嵌套字段做条件更新。当前只有 fake DB 证据。自动扫描所有 `audit.state=pending` 的可靠查询计划、索引及权限未获授权／验证；若调用方丢失投稿 ID 或任务在返回前崩溃，目前还不能保证自动发现并修复，列为 **PENDING**。批次 prepare/complete 可因重复触发各自新增运行记录；逐条事件通过稳定 ID 去重。

## 3. 修改文件、修改前备份及回滚

修改前新建独立备份目录：`项目/tools/_backup/retention-audit-20261029-20261029T0615109693621Z/`。以下每份备份均在对应文件修改前复制，并用 SHA-256 和逐字节比较验证一致；未覆盖旧备份。此处“修改前”专指本轮基线，**不代表历史上 B2/B8 两红的原始状态**。

| 文件 | 备份字节 | 修改前 SHA-256 | 差异／回滚 |
|---|---:|---|---|
| `项目/cloudfunctions/retention/index.js` | 7,831 | `0740D71E2FFA4D88055B0BCE8120683321BFC9375FA20AEB43E78EABB321B169` | 增互斥分类、稳定日志 ID、待补标记与 `recover`；仅在本地未部署时可按后附 diff 或备份恢复。 |
| `项目/tools/test_retention_mark.js` | 15,929 | `2B64F8B3627E1F2EEC63CF820A78B078A977803606C41955CF7CF2F3956508E5` | 更新系统空哈希／运行日志断言，增 F1–F9（含 F7b/F7c）。 |
| `项目/tools/ugc_fake_cloud.js` | 9,259 | `3228C92351E4BFD8DC837D33BC56C67A01DA8963081070A9D2F5C717D3E602DB` | 仅给测试替身加同 `_id` 追加冲突模拟；不代表云端实现。 |
| `项目/config/cloud/schema.submissions.json` | 6,049 | `5523951FE828B33C4897AD14228680064D7E28CE2558551F29F17E30192ACBD1` | 描述持久待补标记及原转换版本；本地草案，未改云端 schema。 |
| `项目/config/cloud/schema.upload_logs.json` | 3,189 | `8977A551F076F2D518C87E9F2F5FD5CC8816C56C8BA6798E588047CB89D5EA93` | 系统空哈希、所有运行日志 `at/rev`、按 ID 读回语义；本地草案，未改云端索引／权限。 |
| `项目/docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 51,005 | `8C93DC991815CD992F8369F7463441E393AF58A8D9C09430E268A1FA2170A96B` | 将 §3.5.2 已裁决期限同步到 `:150/:220/:409/:433/:594` 旧口径；补计数与审计恢复契约。 |
| `报告/Codex_Retention_P0_闭环验收_20261029.md` | 18,602 | `932CA8CD7FB4A0C80390E08CFAD5AFC3082D9D74E18D7533A3450AF0AB521AA5` | 更正“修改前备份”措辞：测试备份是 B2/B8 已修、E 段未加的中间快照，不能用于恢复两红原始状态。没有伪造缺失备份。 |

本轮无云端或正式产物副作用。回滚本地文件应逐文件核对当前哈希与后附 diff，再选择反向应用本轮 diff 或使用相应备份；不得覆盖别人的后续修改，不使用 Git 写操作。若未来云端真实产生审计行，代码回滚无法删除该事实，也不应改写 append-only 日志。

## 4. 实际验证

| 命令（`项目/` 下） | 输出摘要 | 退出码 |
|---|---|---:|
| `node tools/test_retention_mark.js` | PASS 71 / FAIL 0；两实例交错、重复触发、日志失败／丢回执／并发恢复、计数守恒、空哈希均通过 | 0 |
| `node tools/test_ugc_review.js` | PASS 86 / FAIL 0 | 0 |
| `node tools/test_ugc_submit.js` | PASS 110 / FAIL 0 | 0 |
| `node tools/test_ugc_client_contract.js` | PASS 90 / FAIL 0 | 0 |
| `node tools/test_index_state.js` | 205 通过 / 0 失败 | 0 |
| `node tools/test_home_datasource.js` | PASS 68 / FAIL 0 | 0 |
| `node tools/check_eol.js` | 61 文件，违规记录 0 | 0 |
| `node tools/test_check_doc_refs.js` | 通过 51，失败 0 | 0 |
| schema／契约离线检查 | PASS 9 / FAIL 0：状态、待补标记、事件、空哈希、`at/rev`、查询索引草案与契约 | 0 |
| `git diff --check` | 无差异错误；仅既有 `project.config.json` CRLF 将来转换提示 | 0 |

查询消费者检查：`submit/review` 继续写真实 32 位 HMAC；Retention 逐条事件现在有 `at`，本地 `ix_at` 与 `ix_event_day` 草案可覆盖按时间／事件倒查；系统 actor 的空哈希不适用于 `ix_actor_at` 的人工主体追溯。现有业务代码未发现直接按 upload_logs 索引查询的消费者；新增 `recover` 只按稳定 `_id` 读回。真实索引是否存在、是否命中及权限能否读回均未验证。

最终项目 Git HEAD、分支、暂存区不变；`git status --porcelain=v1 --untracked-files=all` 为 317 项（已修改跟踪文件仍 15 项，未跟踪文件 302 项），较开工增加的 7 项是本轮备份；新报告位于项目仓库外。未执行 Git 写操作，未触云、部署、创建触发器／索引、修改环境变量／权限，未生成正式产物或处理投稿。T-2、复合索引与真实云端验收保持 PENDING。完成后停止，交 DSH 独立复核。

## 5. 修改前后精确 unified diff

以下逐对使用 `git diff --no-index -- <本轮修改前备份> <当前文件>` 生成；有差异时该只读命令退出 1 属预期。

### cloudfunctions/retention/index.js

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\cloudfunctions__retention__index.js" b/cloudfunctions/retention/index.js
index d7f9659..15afbde 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\cloudfunctions__retention__index.js"
+++ b/cloudfunctions/retention/index.js
@@ -4,7 +4,7 @@
  * 本函数不包含 triggers 配置，不能因提交本代码而自动运行。部署前必须由负责人
  * 在云环境显式确认每项策略参数；缺少或未确认任一参数时，入口失败关闭且不读写数据。
  *
- * 本轮只有 mark 动作：将超过已确认标记期限的 pending 投稿置为 expired。
+ * mark 标记到期 pending；recover 按投稿 ID 补齐已标记记录的逐条审计。
  * 正文清除与审计日志轮转是独立的不可逆流程，不在本入口实现。
  *
  * 环境变量（均必填、无默认值）：
@@ -79,19 +79,21 @@ function hasValidMaintenanceToken(value) {
     crypto.timingSafeEqual(expectedBuffer, actualBuffer);
 }
 
-async function writeRunLog(result, phase, code, submissionId) {
+async function writeRunLog(result, phase, code, submissionId, eventId) {
   const data = {
     schemaVersion: 1,
     event: 'retention_mark',
     action: 'retention_mark',
     submissionId: submissionId || null,
-    day: result.now.toISOString().slice(0, 10),
+    day: result.day || result.now.toISOString().slice(0, 10),
     result: { code: code },
     errorCode: '',
-    actor: { role: 'system' }
+    actor: { role: 'system', openidHash: null },
+    at: db.serverDate(),
+    rev: 1
   };
-  // A record event is exactly the approved eight-field logical projection.
-  // Batch rows carry operational counters separately and are not record summaries.
+  // The eight-field long-term projection is separate from the complete runtime log.
+  if (eventId) data._id = eventId;
   if (phase !== 'record') {
     data.result.stats = {
       phase: phase,
@@ -101,13 +103,71 @@ async function writeRunLog(result, phase, code, submissionId) {
       conflicts: result.conflicts,
       failed: result.failed,
       auditFailed: !!result.auditFailed,
-      attempts: result.attempts
+      attempts: result.attempts,
+      selected: result.selected,
+      markedAudited: result.markedAudited,
+      auditFailedCount: result.auditFailedCount,
+      unprocessed: result.unprocessed
     };
-    data.at = db.serverDate();
   }
   return db.collection(COL.LOGS).add({ data: data });
 }
 
+function recordEventId(id, nextRev) {
+  return 'retention_mark_' + crypto.createHash('sha256')
+    .update(String(id) + '\0' + String(nextRev)).digest('hex');
+}
+
+async function recoverAudit(submissionId) {
+  if (typeof submissionId !== 'string' || !submissionId.trim()) return fail('INVALID_SUBMISSION_ID', '缺少投稿 ID');
+  let row;
+  try { row = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
+  catch (err) { return fail('DATABASE_ERROR', '无法读取待补审计记录'); }
+  const retention = row && row.retention;
+  const audit = retention && retention.audit;
+  if (!audit) return fail('NO_PENDING_AUDIT', '该投稿没有待补审计标记');
+  if (audit.state === 'complete') return { ok: true, code: 'ALREADY_RECOVERED' };
+  if (audit.state !== 'pending' || !Number.isInteger(audit.markedRev) ||
+      audit.eventId !== recordEventId(row._id, audit.markedRev) || !/^\d{4}-\d{2}-\d{2}$/.test(audit.day)) {
+    return fail('AUDIT_STATE_INVALID', '待补审计标记与投稿状态不一致');
+  }
+  try {
+    await writeRunLog({ day: audit.day }, 'record', 'OK', row._id, audit.eventId);
+  } catch (err) {
+    // A lost acknowledgement can mean the append succeeded. Confirm by stable _id.
+    let existing;
+    try { existing = (await db.collection(COL.LOGS).doc(audit.eventId).get()).data; }
+    catch (readErr) { return fail('LOG_FAILED', '逐条审计尚未确认写入', { logged: false }); }
+    if (!existing || existing.event !== 'retention_mark' || existing.submissionId !== row._id) {
+      return fail('AUDIT_STATE_INVALID', '审计 ID 已被其他内容占用');
+    }
+    if (existing._id !== audit.eventId || existing.action !== 'retention_mark' ||
+        existing.day !== audit.day || existing.rev !== 1 ||
+        !existing.actor || existing.actor.role !== 'system' || existing.actor.openidHash !== null ||
+        !existing.result || existing.result.code !== 'OK') {
+      return fail('AUDIT_STATE_INVALID', '已有审计内容与待补标记不一致');
+    }
+  }
+  try {
+    const updated = await db.collection(COL.SUBMISSIONS)
+      .where({ _id: row._id, status: row.status, rev: row.rev,
+        'retention.audit.eventId': audit.eventId, 'retention.audit.state': 'pending' })
+      .update({ data: { retention: Object.assign({}, retention,
+        { audit: Object.assign({}, audit, { state: 'complete' }) }) } });
+    if (!updated || !updated.stats || updated.stats.updated !== 1) {
+      let latest;
+      try { latest = (await db.collection(COL.SUBMISSIONS).doc(submissionId).get()).data; }
+      catch (err) { return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除'); }
+      if (latest && latest.retention && latest.retention.audit &&
+          latest.retention.audit.eventId === audit.eventId && latest.retention.audit.state === 'complete') {
+        return { ok: true, code: 'ALREADY_RECOVERED', submissionId: row._id };
+      }
+      return fail('STATE_CONFLICT', '审计已存在，但待补标记未能确认清除');
+    }
+  } catch (err) { return fail('DATABASE_ERROR', '审计已存在，但待补标记清除失败'); }
+  return { ok: true, code: 'OK', submissionId: row._id };
+}
+
 async function markExpired(options) {
   const config = readPolicy();
   if (config.error) return config.error;
@@ -126,7 +186,8 @@ async function markExpired(options) {
       .get();
     rows = (res && Array.isArray(res.data)) ? res.data : [];
   } catch (err) {
-    return fail('DATABASE_ERROR', '读取待标记投稿失败', { marked: 0, skipped: 0, conflicts: 0 });
+    return fail('DATABASE_ERROR', '读取待标记投稿失败', { marked: 0, skipped: 0,
+      conflicts: 0, failed: 0, selected: 0, markedAudited: 0, auditFailedCount: 0, unprocessed: 0 });
   }
 
   let marked = 0;
@@ -134,14 +195,18 @@ async function markExpired(options) {
   let conflicts = 0;
   let failed = 0;
   let auditFailed = false;
+  let auditFailedCount = 0;
+  let unprocessed = 0;
   const result = { marked: 0, skipped: 0, conflicts: 0, failed: 0,
-    attempts: rows.length, now: now,
+    attempts: rows.length, selected: rows.length, markedAudited: 0,
+    auditFailedCount: 0, unprocessed: 0, now: now,
     batchId: (options && options.requestId) || crypto.randomBytes(16).toString('hex') };
   try {
     await writeRunLog(result, 'prepare', 'PREPARE', null);
   } catch (err) {
     return fail('LOG_FAILED', '批次准备审计写入失败，未更改投稿', {
-      marked: 0, skipped: 0, conflicts: 0, failed: 0, logged: false
+      marked: 0, skipped: 0, conflicts: 0, failed: 0, logged: false,
+      selected: rows.length, markedAudited: 0, auditFailedCount: 0, unprocessed: rows.length
     });
   }
   for (let i = 0; i < rows.length; i++) {
@@ -159,7 +224,10 @@ async function markExpired(options) {
             status: STATUS.EXPIRED,
             retention: {
               markedAt: db.serverDate(),
-              policyConfirmedBy: policy.confirmedBy
+              policyConfirmedBy: policy.confirmedBy,
+              audit: { state: 'pending', markedRev: row.rev + 1,
+                eventId: recordEventId(row._id, row.rev + 1),
+                day: now.toISOString().slice(0, 10) }
             },
             updatedAt: db.serverDate(),
             rev: row.rev + 1
@@ -173,17 +241,20 @@ async function markExpired(options) {
     if (updated) {
       marked++;
       result.marked = marked;
-      try { await writeRunLog(result, 'record', 'OK', row._id); }
-      catch (err) {
+      const recovered = await recoverAudit(row._id);
+      if (!recovered.ok) {
         auditFailed = true;
+        auditFailedCount++;
         break;
       }
     } else conflicts++;
   }
 
+  unprocessed = rows.length - marked - skipped - conflicts - failed;
   Object.assign(result, { marked: marked, skipped: skipped, conflicts: conflicts,
-    failed: failed, auditFailed: auditFailed });
-  const completion = failed === 0 && !auditFailed ? 'COMPLETE' : (marked > 0 ? 'PARTIAL' : 'FAILED');
+    failed: failed, auditFailed: auditFailed, auditFailedCount: auditFailedCount,
+    markedAudited: marked - auditFailedCount, unprocessed: unprocessed });
+  const completion = failed === 0 && !auditFailed && unprocessed === 0 ? 'COMPLETE' : (marked > 0 ? 'PARTIAL' : 'FAILED');
   try {
     await writeRunLog(result, 'complete', completion, null);
   } catch (err) {
@@ -192,13 +263,17 @@ async function markExpired(options) {
       skipped: skipped,
       conflicts: conflicts,
       failed: failed,
+      selected: rows.length, markedAudited: result.markedAudited,
+      auditFailedCount: auditFailedCount, unprocessed: unprocessed,
       logged: false
     });
   }
 
   if (auditFailed) {
     return fail('LOG_FAILED', '状态已标记，但逐条审计写入失败；批次已记录部分成功', {
-      marked: marked, skipped: skipped, conflicts: conflicts, failed: failed, logged: false
+      marked: marked, skipped: skipped, conflicts: conflicts, failed: failed,
+      selected: rows.length, markedAudited: result.markedAudited,
+      auditFailedCount: auditFailedCount, unprocessed: unprocessed, logged: false
     });
   }
 
@@ -209,22 +284,26 @@ async function markExpired(options) {
     skipped: skipped,
     conflicts: conflicts,
     failed: failed,
+    selected: rows.length, markedAudited: result.markedAudited,
+    auditFailedCount: auditFailedCount, unprocessed: unprocessed,
     cutoff: cutoff.toISOString()
   };
 }
 
 exports.main = async function (event, context) {
-  if (!event || event.action !== 'mark') {
-    return fail('INVALID_ACTION', '仅支持由已配置触发器调用的 mark 动作');
+  if (!event || (event.action !== 'mark' && event.action !== 'recover')) {
+    return fail('INVALID_ACTION', '仅支持维护令牌保护的 mark/recover 动作');
   }
   if (!hasValidMaintenanceToken(event.maintenanceToken)) {
     return fail('FORBIDDEN', '维护令牌无效或未配置');
   }
+  if (event.action === 'recover') return recoverAudit(event.submissionId);
   return markExpired({ requestId: context && context.request_id });
 };
 
 exports.__test__ = {
   makeCutoff: makeCutoff,
   readPolicy: readPolicy,
-  markExpired: markExpired
+  markExpired: markExpired,
+  recoverAudit: recoverAudit
 };
```

### tools/test_retention_mark.js

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\tools__test_retention_mark.js" b/tools/test_retention_mark.js
index dd0a609..89de68e 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\tools__test_retention_mark.js"
+++ b/tools/test_retention_mark.js
@@ -161,14 +161,17 @@ async function main() {
   ok('B12 每条成功状态更新有独立事件', ['overdue', 'already_redacted'].every(function (id) {
     return h.docs('upload_logs').some(function (log) { return log.submissionId === id && log.result.code === 'OK'; });
   }));
-  ok('B13 系统审计省略 openidHash', h.docs('upload_logs').every(function (log) {
-    return log.actor && log.actor.role === 'system' && !Object.prototype.hasOwnProperty.call(log.actor, 'openidHash');
+  ok('B13 系统审计明确使用空 openidHash', h.docs('upload_logs').every(function (log) {
+    return log.actor && log.actor.role === 'system' && log.actor.openidHash === null;
   }));
-  ok('B14 逐条标记事件仅含八个逻辑字段', h.docs('upload_logs').filter(function (log) {
+  ok('B14 逐条运行日志含可倒查字段，长期摘要投影仍为八个逻辑字段', h.docs('upload_logs').filter(function (log) {
     return log.submissionId !== null;
   }).every(function (log) {
-    return Object.keys(log).sort().join(',') === '_id,action,actor,day,errorCode,event,result,schemaVersion,submissionId' &&
-      Object.keys(log.result).join(',') === 'code' && Object.keys(log.actor).join(',') === 'role';
+    const projection = [log.schemaVersion, log.event, log.action, log.submissionId,
+      log.day, log.result.code, log.errorCode, log.actor.role];
+    return projection.length === 8 && projection.every(function (value) { return value !== undefined; }) &&
+      log.at instanceof Date && log.rev === 1 && log.actor.openidHash === null &&
+      typeof log._id === 'string';
   }));
 
   console.log('== C. 可重跑与失败关闭 ==');
@@ -324,6 +327,121 @@ async function main() {
       return h.docs('upload_logs').filter(function (log) { return log.submissionId === id; }).length === 1;
     }));
 
+  console.log('== F. 审计待补与计数守恒 ==');
+  prepare({ batchLimit: '2' });
+  seedSubmission({ _id: 'audit_first' });
+  seedSubmission({ _id: 'audit_second' });
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  const interrupted = await T.markExpired({ now: now });
+  ok('F1 审计中断时选中记录分到互斥结果', interrupted.code === 'LOG_FAILED' &&
+    interrupted.selected === 2 && interrupted.marked === 1 &&
+    interrupted.markedAudited === 0 && interrupted.auditFailedCount === 1 &&
+    interrupted.unprocessed === 1 && interrupted.skipped === 0 &&
+    interrupted.conflicts === 0 && interrupted.failed === 0 &&
+    interrupted.selected === interrupted.markedAudited + interrupted.auditFailedCount +
+      interrupted.skipped + interrupted.conflicts + interrupted.failed + interrupted.unprocessed);
+  ok('F2 待补标记与状态同次写入，后续记录仍 pending',
+    docById('audit_first').status === 'expired' &&
+    docById('audit_first').retention.audit.state === 'pending' &&
+    docById('audit_second').status === 'pending');
+  h.clearFail();
+  const fixed = await T.recoverAudit('audit_first');
+  const fixedAgain = await T.recoverAudit('audit_first');
+  const nextRun = await T.markExpired({ now: now });
+  ok('F3 逐条审计可按 ID 恢复且重复调用不重写日志', fixed.code === 'OK' &&
+    fixedAgain.code === 'ALREADY_RECOVERED' && nextRun.marked === 1 &&
+    docById('audit_first').rev === 2 && docById('audit_second').rev === 2 &&
+    ['audit_first', 'audit_second'].every(function (id) {
+      return h.docs('upload_logs').filter(function (log) { return log.submissionId === id; }).length === 1;
+    }));
+
+  prepare();
+  seedSubmission({ _id: 'ack_lost' });
+  const actualCollection = h.db.collection;
+  let lostAck = true;
+  h.db.collection = function (name) {
+    const collection = actualCollection(name);
+    if (name === 'upload_logs') {
+      const add = collection.add;
+      collection.add = async function (payload) {
+        const response = await add(payload);
+        if (payload.data.submissionId === 'ack_lost' && lostAck) {
+          lostAck = false;
+          throw new Error('simulated lost acknowledgement');
+        }
+        return response;
+      };
+    }
+    return collection;
+  };
+  try { r = await T.markExpired({ now: now }); }
+  finally { h.db.collection = actualCollection; }
+  ok('F4 日志已落库但回执丢失时按稳定 ID 确认，不重复追加', r.marked === 1 &&
+    r.auditFailedCount === 0 && docById('ack_lost').retention.audit.state === 'complete' &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'ack_lost'; }).length === 1);
+
+  prepare();
+  seedSubmission({ _id: 'two_instances' });
+  const otherInstance = h.loadFunction('cloudfunctions/retention/index.js');
+  const concurrent = await Promise.all([T.markExpired({ now: now }), otherInstance.__test__.markExpired({ now: now })]);
+  ok('F5 两个独立实例交错执行仅一次状态转换和逐条日志',
+    concurrent[0].marked + concurrent[1].marked === 1 &&
+    concurrent[0].conflicts + concurrent[1].conflicts === 1 &&
+    docById('two_instances').rev === 2 &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'two_instances'; }).length === 1);
+  const repeated = await T.markExpired({ now: now });
+  ok('F6 连续触发不重复转换或补写已完成审计', repeated.marked === 0 &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'two_instances'; }).length === 1);
+
+  prepare();
+  seedSubmission({ _id: 'marker_update_failure' });
+  h.setFail({ collection: 'submissions', op: 'update', atCall: 2 });
+  const markerFailure = await T.markExpired({ now: now });
+  h.clearFail();
+  const markerRecovery = await T.recoverAudit('marker_update_failure');
+  ok('F7 日志存在但待补标记清除失败，重试不产生第二条日志',
+    markerFailure.code === 'LOG_FAILED' && markerFailure.auditFailedCount === 1 &&
+    markerRecovery.code === 'OK' && docById('marker_update_failure').retention.audit.state === 'complete' &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'marker_update_failure'; }).length === 1);
+
+  prepare();
+  seedSubmission({ _id: 'concurrent_recovery' });
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  await T.markExpired({ now: now });
+  h.clearFail();
+  const recoveryInstance = h.loadFunction('cloudfunctions/retention/index.js');
+  const recoveryRace = await Promise.all([
+    T.recoverAudit('concurrent_recovery'),
+    recoveryInstance.__test__.recoverAudit('concurrent_recovery')
+  ]);
+  ok('F7b 两个独立恢复实例并发时只产生一条逐条日志',
+    recoveryRace.every(function (result) { return result.ok; }) &&
+    docById('concurrent_recovery').retention.audit.state === 'complete' &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'concurrent_recovery'; }).length === 1);
+
+  prepare();
+  seedSubmission({ _id: 'reviewed_after_mark' });
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
+  await T.markExpired({ now: now });
+  h.clearFail();
+  h.state.docs.submissions[0].status = 'rejected';
+  h.state.docs.submissions[0].rev = 3;
+  const afterReview = await T.recoverAudit('reviewed_after_mark');
+  ok('F7c 后续状态和 rev 已变化时仍能补记原标记事件', afterReview.code === 'OK' &&
+    docById('reviewed_after_mark').status === 'rejected' && docById('reviewed_after_mark').rev === 3 &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'reviewed_after_mark'; }).length === 1);
+
+  const logSchema = require('../config/cloud/schema.upload_logs.json');
+  const runtimeLogs = h.docs('upload_logs');
+  ok('F8 系统日志符合 at/rev 与空哈希契约', runtimeLogs.length > 0 &&
+    runtimeLogs.every(function (log) {
+      return log.at instanceof Date && log.rev === 1 && log.actor.role === 'system' &&
+        log.actor.openidHash === null && logSchema.fields.event.enum.indexOf(log.event) !== -1;
+    }) && logSchema.fields.actor.properties.openidHash.type === 'string|null');
+
+  r = await fn.main({ action: 'recover', submissionId: 'marker_update_failure' }, {});
+  eq('F9 待补审计入口仍须维护令牌', r.code, 'FORBIDDEN');
+
   console.log('');
   console.log('---- 汇总 ----');
   console.log('PASS ' + pass + ' / FAIL ' + failCount);
```

### tools/ugc_fake_cloud.js

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\tools__ugc_fake_cloud.js" b/tools/ugc_fake_cloud.js
index 3e91f4f..666c0a5 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\tools__ugc_fake_cloud.js"
+++ b/tools/ugc_fake_cloud.js
@@ -146,6 +146,11 @@ function createHarness() {
     return {
       add: function (payload) {
         maybeFail(name, 'add');
+        if (payload.data && payload.data._id && rows.some(function (row) { return row._id === payload.data._id; })) {
+          const err = new Error('FAKE_DUPLICATE_ID:' + payload.data._id);
+          err.errCode = -501001;
+          throw err;
+        }
         state.seq++;
         const doc = clone(payload.data);
         doc._id = doc._id || ('fake_id_' + state.seq);
```

### config/cloud/schema.submissions.json

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\config__cloud__schema.submissions.json" b/config/cloud/schema.submissions.json
index b55a9ea..f98a03d 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\config__cloud__schema.submissions.json"
+++ b/config/cloud/schema.submissions.json
@@ -63,7 +63,17 @@
       "note": "仅系统保留期流程写入；T-1 标记不清 payload",
       "properties": {
         "markedAt": { "type": "date", "note": "T-1 系统标记时间" },
-        "policyConfirmedBy": { "type": "string", "note": "已确认策略的记录标识，不含令牌或正文" }
+        "policyConfirmedBy": { "type": "string", "note": "已确认策略的记录标识，不含令牌或正文" },
+        "audit": {
+          "type": "object",
+          "note": "与 pending→expired 条件更新同次写入；待补记录可按投稿 ID 恢复，自动扫描仍待索引验收",
+          "properties": {
+            "state": { "type": "string", "enum": ["pending", "complete"] },
+            "markedRev": { "type": "integer", "note": "标记状态转换后的 rev；后续审核或删除改变 rev 时仍可补记原事件" },
+            "eventId": { "type": "string", "note": "确定性的 retention_mark 逐条日志 ID" },
+            "day": { "type": "string", "note": "标记发生日期 YYYY-MM-DD" }
+          }
+        }
       }
     },
     "submitter": {
```

### config/cloud/schema.upload_logs.json

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\config__cloud__schema.upload_logs.json" b/config/cloud/schema.upload_logs.json
index eb442d4..addbf09 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\config__cloud__schema.upload_logs.json"
+++ b/config/cloud/schema.upload_logs.json
@@ -3,7 +3,7 @@
     "purpose": "UGC MVP 阶段 B 本地建议审计日志 schema，未应用到任何云端环境",
     "status": "pending_admin_console_verification",
     "collection": "upload_logs",
-    "readBy": "无（普通客户端不可读；仅服务端写与内部排查）",
+    "readBy": "普通客户端不可读；retention 服务端仅按确定性 _id 读取待补逐条事件，内部排查权限待云端验收",
     "writtenBy": "submit / review / retention 云函数仅追加（add）；任何一方都不得 update/delete",
     "retention": "已裁决审计明细 90 天、逐条八字段摘要自生成起 180 天；轮转与云端部署尚未完成"
   },
@@ -16,7 +16,7 @@
     "actor": {
       "type": "object",
       "properties": {
-        "openidHash": { "type": "string", "pattern": "^[0-9a-f]{32}$", "note": "投稿人和管理员用 HMAC-SHA256(salt).slice(0,32)；系统操作者省略此字段，不写 null" },
+        "openidHash": { "type": "string|null", "pattern": "^[0-9a-f]{32}$", "note": "投稿人和管理员必须是 32 位小写十六进制 HMAC 摘要；系统任务明确写 null，禁止虚构哈希" },
         "role": { "type": "string", "enum": ["submitter", "admin", "system"] }
       }
     },
@@ -39,8 +39,8 @@
     "note": { "type": "string|null", "note": "仅内部短说明，禁止写用户私密信息与凭据" },
     "clientTokenHash": { "type": "string|null", "note": "客户端令牌摘要，仅 submit 使用" },
     "day": { "type": "string", "note": "YYYY-MM-DD，便于按天归档" },
-    "at": { "type": "date" },
-    "rev": { "type": "integer", "value": 1 }
+    "at": { "type": "date", "note": "所有运行日志均填写；逐条 retention_mark 也可按 ix_at 倒查" },
+    "rev": { "type": "integer", "value": 1, "note": "所有运行日志填写 1；系统逐条日志使用稳定 _id 以支持幂等补记" }
   },
   "indexes": [
     {
```

### docs/UGC_MVP_DESIGN_FINAL_20261026.md

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md" b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
index 40dec05..b67774f 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md"
+++ b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
@@ -147,7 +147,7 @@
 | B3 | 文本内容安全接口**配额**（次/日） | 未确认 | `docs/CHECKLIST_CONTENT_SECURITY_BACKEND_20261025.md:31` |
 | B4 | 云端是否存在可供纠错的 pilot 真实记录 | 未核实（本轮零云端操作） | `cloudfunctions/seed/pilot-data.js` 有 `DISHES` 12 条；实际是否已写入 `dishes` 集合以云开发控制台为准 |
 | B5 | 管理员 `openid` 白名单由谁担任 | 未指定 | `docs/AUDIT_PRODUCT_BOUNDARY_AND_UPLOAD_MVP_20261025.md:128` |
-| B6 | 数据保留期与删除流程 | 未定 | `docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:127` |
+| B6 | 数据保留期与删除流程 | 期限已裁决；T-2 清理、删除流程和线上验收未完成 | §3.5.2；`docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md:127` 为旧依据 |
 
 > B1–B6 任一未关闭，MVP 只能停留在**开发者工具/体验版内部灰度**，不得提交审核、不得对公众开放。
 
@@ -188,8 +188,8 @@
 | `event` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` / `retention_mark` |
 | `action` | string | 云函数实际动作；系统到期标记为 `retention_mark`。系统逐条事件仅含已裁决的八个逻辑字段，批次 `prepare` / `complete` 另含运行统计 |
 | `submissionId` | string? | `throttle`/`denied`（未关联记录时）为空 |
-| `actor` | object | 投稿人／管理员：`{ openidHash, role }`，其中哈希为 32 位小写十六进制 HMAC 摘要；系统：`{ role:'system' }`，省略 `openidHash`；**日志内不存明文 openid** |
-| `at` | date? | 人工及系统批次日志使用 `db.serverDate()`；系统逐条八字段投影不含此字段 |
+| `actor` | object | 投稿人／管理员：`{ openidHash, role }`，其中哈希为 32 位小写十六进制 HMAC 摘要；系统：`{ role:'system', openidHash:null }`；**日志内不存明文 openid，也不使用虚构哈希** |
+| `at` / `rev` | date / integer | 运行日志均写 `at=db.serverDate()`、`rev=1`；90 天后逐条摘要仅投影八个已裁决逻辑字段，不含这两项 |
 | `before` / `after` | object? | 仅状态迁移类：`{ status, rev }` |
 | `reasonCode` / `reasonText` | string? | `reasonText` 为管理员手写理由（≤100 字），不含用户原文 |
 | `requestId` | string | 云函数 `request_id`，用于串联同一次调用 |
@@ -217,7 +217,7 @@ pending ──approve──> approved（终态）
 |---|---|---|---|
 | `openid` 明文 | 是 | `submissions.submitter.openid` | "仅自己可见"查询与限流需要；集合权限为仅管理端 |
 | `openid` 哈希 | 是 | `upload_logs.actor.openidHash` | 审计可追溯但不扩散标识符；盐在云函数环境变量 |
-| 投稿正文 | 是（≤100 字） | `submissions.payload.note` | 审核必需；保留期**待负责人决策**（见 §3.5.2），未确认前不得在隐私条款或文案中写死任何天数 |
+| 投稿正文 | 是（≤100 字） | `submissions.payload.note` | 审核必需；30 天期限已裁决（§3.5.2），清理未部署前不得对外声称已按期删除 |
 | 昵称/头像/手机号 | **否** | — | 无业务必要（运营规范 5.12/15.1） |
 | 位置/IP/设备 | **否** | — | 纠错不需要；限流用 openid 维度足够 |
 | 图片 | **否** | — | §1.2 N2 |
@@ -262,9 +262,9 @@ pending ──approve──> approved（终态）
 
 #### 3.5.2 保留期（2026-10-28 已裁决，尚未部署）
 
-**现行裁决**：投稿正文自 `createdAt` 起 30 天，审计明细 90 天；逐条摘要采用 `schemaVersion/event/action/submissionId/day/result.code/errorCode/role` 八个逻辑字段，自生成起保留 180 天。每批追加 `prepare` 与 `complete` 两条运行摘要，失败需区分全失败和部分成功。系统操作者省略 `actor.openidHash`，人工操作者沿用 32 位 HMAC 摘要。当前仅 T-1 标记有本地代码，T-2 正文清理、日志轮转及触发器尚未实现或部署；本节规则不代表线上已生效。下列 A/B/C 表仅保留历史候选背景，不再作为待决选项。
+**现行裁决**：投稿正文自 `createdAt` 起 30 天，审计明细 90 天；逐条摘要采用 `schemaVersion/event/action/submissionId/day/result.code/errorCode/role` 八个逻辑字段，自生成起保留 180 天。每批追加 `prepare` 与 `complete` 两条运行摘要，失败需区分全失败和部分成功。系统运行日志填写 `actor.openidHash:null`，人工操作者沿用 32 位 HMAC 摘要；运行日志填写 `at/rev`，到期后的逐条摘要仍严格只投影八字段。当前仅 T-1 标记有本地代码，T-2 正文清理、日志轮转及触发器尚未实现或部署；本节规则不代表线上已生效。下列 A/B/C 表仅保留历史候选背景，不再作为待决选项。
 
-本节此前把「`submissions` 90 天 / `upload_logs` 180 天」写成既定值，属于越权设定。现改为待决策项，候选如下，**由负责人选择，本文不替选**：
+本节此前把「`submissions` 90 天 / `upload_logs` 180 天」写成既定值，属于越权设定；以下 A/B/C 仅为裁决前的历史候选，不再要求负责人重新选择：
 
 | 候选 | `submissions` | `upload_logs` | 好处 | 代价 / 风险 |
 | --- | --- | --- | --- | --- |
@@ -274,6 +274,7 @@ pending ──approve──> approved（终态）
 
 - **本地与线上状态**：`config/ugc.js` 仍标 `pending_confirmation`，表示尚未部署和验收，不能再解释为业务期限未裁决。上线前须先完成隐私指引、清理实现与触发器验收并留截图。
 - **清理纪律**：T-1 只改状态、不清正文；T-2 独立按严格 30 天边界清正文，若仍为 pending，先补标 expired；过期标记与正文清理各自留痕，不得用 `delete_request` 冒充系统保留事件。正文删除后保留符合八字段口径的最小摘要；用户主动删除请求见 §7.7。
+- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。自动发现所有待补投稿仍需云端查询／索引验收，不能仅凭本地测试称恢复全自动可靠。
 
 ---
 
@@ -406,7 +407,7 @@ pending ──approve──> approved（终态）
 | P4 | 文本接口**配额**（次/日） | 「调用额度」页未列逐接口数值 | `[待后台确认]` | 灰度阻塞（影响限流参数） | 后台调用额度页 / 首次超限实测 |
 | P5 | 图片接口 `media_check_async` | 未实测 | `[待后台确认]` | 阻塞图片功能（MVP 已关闭） | 需素材 URL 后单独实测 |
 | P6 | 投诉举报承接方式与响应时限 | 客服 + 用户反馈入口存在 | `[后台截图]` 入口有，**流程未定义** | 上线阻塞（3.10/10.3） | 产品定义承接人与 SLA |
-| P7 | 数据保留期与删除流程 | 未定 | `[待确认]` | 上线阻塞（15.3） | 负责人从 §3.5.2 候选 A/B/C 择一并写明理由（本文不代选） |
+| P7 | 数据保留期与删除流程 | 期限已裁决，执行未验收 | `[待实现/验收]` | 上线阻塞（15.3） | 按 §3.5.2 完成 T-2、日志轮转、隐私声明与线上验证 |
 | P8 | 管理员 `openid` 名单 | 未指定 | `[待确认]` | 灰度阻塞 | 负责人指定 |
 | P9 | 审核员是否会被认定为"变相 UGC" | 无官方口径 | `[待确认]` 风险中 | 提审风险 | 提审说明中明确"不公开展示、仅纠错参考" |
 | P10 | 内容安全接口 `scene` 参数在个人主体下的可填范围 | 未核实 | `[待后台确认]` | 灰度阻塞 | 首次调用按 `scene=1`，异常则记录原文 |
@@ -430,7 +431,7 @@ pending ──approve──> approved（终态）
 
 1. **收集什么**：投稿文本（≤100 字）与你选择的菜品/档口标识；不收集昵称、头像、手机号、位置。
 2. **用途**：仅供运营者核实与改进菜品信息；**不公开展示、不向第三方提供**。
-3. **保留与删除**：保留期**待负责人决策**（见 §3.5.2，候选 30/90/180 天）；未确认前不得对外承诺具体天数。你可随时申请删除，删除后 24 小时内移除正文（审计行保留匿名计数）。
+3. **保留与删除**：已裁决投稿正文自创建起 30 天、审计明细 90 天、逐条摘要自生成起 180 天（§3.5.2）；清理和删除流程上线验收前不得对外声称已生效。你可申请删除；具体处理时限须与实际部署能力和隐私声明一致（审计行不保留正文）。
 
 > 运营规范 15.3：服务终止后 24 小时内删除数据 —— 该义务同样适用于"项目停止运营"场景，需在阶段 B 的验收里以"删除演练"覆盖。
 
@@ -452,7 +453,7 @@ pending ──approve──> approved（终态）
 
 - 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
 - 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
-- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌和 `mark`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
+- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
 
 ### 7.2 输入校验（服务端独立复算）
 
@@ -591,7 +592,7 @@ pending ──approve──> approved（终态）
 
 1. **P1–P10 归属人与时限**（§6.3）。
 2. **是否接受路径 A 的"变相 UGC"提审风险**（风险中，需产品签字）。
-3. **保留期选哪一档**（§3.5.2 候选 A/B/C；未定前隐私条款与文案不得写死天数，见 P7）。
+3. **保留期实施与验收**（期限已在 §3.5.2 裁决；T-2、日志轮转、隐私声明和真实云端验证仍阻塞上线，见 P7）。
 4. **管理员人数与轮值**（单点会有不可用窗口）。
 5. **是否允许"用户收到审核结果通知"**（当前设计不通知；通知本身会引入新的合规面——需单独评估）。
 
```

### ../报告/Codex_Retention_P0_闭环验收_20261029.md

```diff
diff --git "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\report__报告__Codex_Retention_P0_闭环验收_20261029.md" b/../报告/Codex_Retention_P0_闭环验收_20261029.md
index c481c91..cc11068 100644
--- "a/tools\\_backup\\retention-audit-20261029-20261029T0615109693621Z\\report__报告__Codex_Retention_P0_闭环验收_20261029.md"
+++ b/../报告/Codex_Retention_P0_闭环验收_20261029.md
@@ -8,11 +8,11 @@
 
 ## 修改、备份与回滚
 
-新独立备份目录：`项目/tools/_backup/retention-p0-close-20261029-20261029T0554421214165Z/`。每个文件均在修改前复制，SHA-256 相同并用逐字节比较确认；没有覆盖旧备份。下表 SHA-256 是**修改前备份**。
+新独立备份目录：`项目/tools/_backup/retention-p0-close-20261029-20261029T0554421214165Z/`。每个文件均在本报告所述 E 段与 schema/契约修改前复制，SHA-256 相同并用逐字节比较确认；没有覆盖旧备份。**其中测试文件是中间快照：B2/B8 在备份时已经修正，E 段尚不存在；它不是早期“2 红”的原始文件，不能用于恢复那一状态。**下表 SHA-256 为这一中间时点的备份。
 
 | 修改文件 | 备份文件名 | 备份大小（字节） | 备份 SHA-256 | 影响与回滚 |
 |---|---|---:|---|---|
-| `tools/test_retention_mark.js` | `test_retention_mark.js` | 12,897 | `5C353374C3D2D73C7EF70771D5DA62046EB026D627BD1F6156634EA615E38BF5` | 增 E1–E4；可按下文精确 diff 反向应用或用已校验备份恢复，需保留当前其他人的变更。 |
+| `tools/test_retention_mark.js` | `test_retention_mark.js` | 12,897 | `5C353374C3D2D73C7EF70771D5DA62046EB026D627BD1F6156634EA615E38BF5` | 增 E1–E4；备份只能恢复到 B2/B8 已修、E 段未加的中间状态，不能恢复早期“2 红”状态。 |
 | `config/cloud/schema.submissions.json` | `config__cloud__schema.submissions.json` | 5,567 | `B5E5D8BC939ECC17AFB6636B6E0E879900D8B7852380B4B14418BE5F072E68D5` | 说明 retention 为读取／写入方，登记已裁决但未部署期限，补当前代码实际写入的 `retention.markedAt/policyConfirmedBy`。只改本地草案，未改云端 schema。 |
 | `config/cloud/schema.upload_logs.json` | `config__cloud__schema.upload_logs.json` | 3,185 | `0DD50781D718C93329BEF320E8BBAE18085A71C32B0F571C265456E6DF5C36DD` | 登记 retention 写入者、`submissionId`、人工哈希格式与系统省略语义；移除重复 `action` 键。`retention_mark` 在本轮开始前已存在，未重复添加。 |
 | `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | `docs__UGC_MVP_DESIGN_FINAL_20261026.md` | 50,362 | `EF985AC02633129315E646058F82F9DE1A0EADF81B884B8F0367970DB8156B0E` | 修订旧三状态表、日志事件／身份语义，以及“仅两个云函数入口”的过时表述；保留既定期限与状态机。 |
```

