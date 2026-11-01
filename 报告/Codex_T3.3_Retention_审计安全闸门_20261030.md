# T3.3 Retention 审计安全闸门：实施与验收（2026-10-30）

## 结论

**本地闸门实施及离线回归 PASS；真实云端并发安全、历史失败批次的解除路径均 PENDING。** 本轮实际修改了 Retention 源码和专项测试，新增审计闸门测试；并非仅交方案。未调用云端、未部署、未建索引或触发器、未修改生产数据、`verifyStatus`、ID 映射、审批文件、冻结主套件或冻结契约，未执行 Git 写操作。完成后停止，交 DSH 独立验收。

## 现状与最小实施范围

开工时 `cloudfunctions/retention/index.js` 的 `purgePayload` 在 `:380–449` 直接进入候选扫描、批次 prepare 和 `payload:null` 条件更新；没有调用 `reconcileBatches`。`markExpired` 是独立状态标记流程，不清正文；`recoverPurgePending` 只补已清正文记录的审计。原 `reconcileBatches` 返回 `ok/code/completeScan/truncated/counts/batches`，`PARTIAL/FAILED` 可计入 `counts.closed`，但在 `counts.outcomes` 中独立可见。依据：本轮修改前外部备份、当前 `cloudfunctions/retention/index.js:381–453,708–817`、`tools/test_retention_reconcile.js` 的 C21/C22/C25。所有行号以下均指**本轮修改后**。

项目内只改：

1. `cloudfunctions/retention/index.js`：新增有界对账闸门、完整结构与结果校验；`purgePayload` 保留待补审计恢复，恢复后先查 `retention_mark` 和 `retention_purge`，通过后才扫描正文候选；对账数据库返回值缺失时直接失败。`exports.main` 的 `purge` 仍只调用这一入口（`:816–828`）。
2. `tools/test_retention_purge.js`：保留 18 个原用例，按新裁决更新 P7/P8/P10/P17/P18 的历史失败/延后批次预期；P6 在独立干净夹具中继续验证“先标记并完成审计、再清正文”。没有删测试，也没有降低对正文、版本、逐条日志和恢复的检查。
3. 新增 `tools/test_retention_audit_gate.js`：16 项独立离线断言，覆盖 A–M 及运行中 prepare、真实 501 条截断、结构缺失、维护入口与未授权入口。`tools/ugc_fake_cloud.js`、`tools/test_retention_reconcile.js`、`tools/test_retention_mark.js` 均未修改。

另有 `cloudfunctions/review/index.js:418–452` 的用户主动删除路径会清空正文；它是独立的用户删除请求，不属于 Retention T-2 到期清理，且本工单未授权修改 review。项目内 Retention 的正文清空写点只有 `cloudfunctions/retention/index.js:494`；公开维护动作与本地测试直接调用均经 `purgePayload`。本结论来自本轮 `rg 'payload: null|payloadRedactedAt' cloudfunctions` 与源码读码，不把用户删除入口误写成已受 T3.3 闸门保护。

## 闸门的实际行为

- `completeAuditReconcile`（`index.js:381–401`）要求结果存在且 `ok===true/code==='OK'/completeScan===true/truncated===false/nextCursor===null`，`eventType` 正确，`scanned/pages/counts/batches` 结构完整；所有结构异常计数和 `PARTIAL/FAILED/DEFERRED` 结果计数均为 0。成功批次须逐条为 `status:closed`、`completeCode:COMPLETE`、`outcome:OK`，且 `counts.closed===counts.outcomes.OK===batches.length`。因此只看 `closed` 绝不能放行。
- `checkPurgeAuditGate`（`:403–432`）对 `retention_mark` 与 `retention_purge` 各调用真实 `reconcileBatches`，默认每次最多等待 5000 ms。抛出、超时、缺失、截断、异常、未闭合 prepare、失败或延后结果一律返回 `AUDIT_GATE_BLOCKED/ok:false`。测试用的第二参数只供 `__test__.purgePayload` 故障注入；`exports.main` 在 `:827` 只传固定的 `requestId`，云端事件不能传入该钩子。
- `purgePayload`（`:434–453`）先保留原 `recoverPurgePending` 补审计行为；若其失败/未处理/延后则在正文处理前停止，数据库读取失败保持原 `DATABASE_ERROR` 返回口径。恢复成功后对账，两类事件都通过才执行正文候选查询与批次 prepare。阻断时不会触及 `payload:null` 更新，也不会生成该次清理批次的成功 complete。恢复动作本身可能追加**真实**的恢复 prepare/complete，不能误报成虚假清理成功。
- `reconcileBatches` 对分页和探针的缺失/非数组数据库响应返回 `RECONCILE_RESULT_INVALID`（`:734–758`），不再把缺失响应当作空日志成功。现有条件更新、版本检查、稳定逐条事件 ID、退避和只追加日志路径未改。

**安全边界：**此闸门只证明“单次扫描当时观察到的日志满足规则”。没有分布式锁、同事务快照或跨集合原子屏障；本报告不把本地 PASS 扩大为跨实例云端安全。单次超过 500 行会截断并阻断，不把局部窗口当全局对账。

## 仓库外备份与哈希

备份目录：`C:\Users\25975\Desktop\食神寻味小程序开发\备份\T3_3_retention_audit_gate_20261030_20261030T033443389307Z`，本轮新建，未覆盖旧目录。修改前复制原始字节并逐字节比较，大小与 SHA-256 相等；新测试在修改前不存在，故没有伪造“原始备份”。

| 项目文件 / 外部备份名 | 修改前字节 / SHA-256 | 修改后字节 / SHA-256 |
| --- | --- | --- |
| `cloudfunctions/retention/index.js` / `cloudfunctions__retention__index.js` | 37711 / `51CC315F7258B9CF6BBB759B416F3111CD3253F11A11F33AAA27B0B18918AC4D` | 41521 / `3DBB96443008F824F801C48C01EF72EEA0EA954BA2DE06B8BA867C608B293C8F` |
| `tools/test_retention_purge.js` / `tools__test_retention_purge.js` | 8973 / `D1C88EA9B36B7CBE9FB3DD7556A1D9AD51FA16A6B2E833D32660666D51B0D462` | 9206 / `32FCD7433A9A27F824906C9E2AF174DAFC67BA1538BB6B9D86C082B1340CC82D` |
| 新建 `tools/test_retention_audit_gate.js` | 不存在 | 10640 / `FA27B88047DE34581C85145612F0B96EAC9975A4C72B9326A33C6A6C968E9C10` |

## 测试和可观察证据

全部命令均在项目目录实际执行；原始输出：`报告/Codex_T3_3_最终回归_修订后_20261030.txt`，21846 字节，SHA-256 `7560EE5307569FD1C33EFA76D0B638DA6A49918D5BA8A7C0AF046D3AF2F66424`。测试未报告 skip 数，表中如实记“未报告”。

| 命令 | 实际结果 | 失败 | 跳过 | 退出码 |
| --- | --- | ---: | --- | ---: |
| `node tools/test_retention_audit_gate.js` | 16 PASS | 0 | 未报告 | 0 |
| `node tools/test_retention_reconcile.js` | 30 PASS | 0 | 未报告 | 0 |
| `node tools/test_retention_mark.js` | 71 PASS | 0 | 未报告 | 0 |
| `node tools/test_retention_purge.js` | 18 PASS | 0 | 未报告 | 0 |
| `node tools/test_retention_recover_pending.js` | 13 PASS | 0 | 未报告 | 0 |
| `node tools/test_ugc_review.js` | 86 PASS | 0 | 未报告 | 0 |
| `node tools/test_ugc_submit.js` | 110 PASS | 0 | 未报告 | 0 |
| `node tools/test_ugc_client_contract.js` | 90 PASS | 0 | 未报告 | 0 |
| `node tools/check_eol.js` | 61 文件，违规 0 | 0 | 未报告 | 0 |
| `git diff --check` | 无差异错误；仅既有 `project.config.json` CRLF 提示 | 0 | 不适用 | 0 |

新专项 G-B/G-C 使用**计数闭合但 `closed=1` 的真实 PARTIAL/FAILED 批次日志**；G-I 再把整体 `ok/code` 故障注入为假 OK，仍因 `outcomes.PARTIAL` 阻断。G-D2 验证未超 10 分钟的运行中 prepare 即使 `reconcileBatches.ok===true` 也阻断。G-F2 用 501 条完整字段的合成逐条日志实测 `SCAN_TRUNCATED` 阻断。G-G/G-H/G-H2/G-K 分别覆盖超时、缺结果、缺计数和数据库响应缺失；G-J 覆盖短暂对账错误后重新运行才允许清理。所有阻断用例均比较清理前后 `payload` 序列化后的 UTF-8 字节，并核对 `rev`、`payloadRedactedAt`、更新调用数和日志条数；在无待补恢复的阻断夹具中均保持不变。G-L 证明维护入口不能绕过闸门，G-M 证明无令牌在数据库查询前拒绝。

**隔离反事实：**仅在系统临时目录复制源码、假库和新测试，删去 `purgePayload` 对闸门的调用。结果 **2 PASS / 14 FAIL，退出码 1**；包括 G-B、G-C 和维护入口 G-L。临时目录自动清除，正式源码哈希未变。原始输出：`报告/Codex_T3_3_最终变异_20261030.txt`，1013 字节，SHA-256 `849C474B20DF44E7C0C3B2289DA3826DCBC9D2B3A77FCE0E3C8CB870CDD48E06`。

## 并发、时序及尚未闭环的风险

1. **TOCTOU：PENDING，且本地可复现。** 两次只读对账与正文条件更新不是同一事务。离线时序探针让 `retention_purge` 扫描返回 OK 后、正文更新前插入一条新异常日志，得到 `purge_code=OK,purged=1,payload_null=true`；随后再对账为 `RECONCILE_ANOMALIES,invalidLogs=1`，探针退出码 0。这证明当前闸门无法保证跨实例“对账后绝无新失败”。两实例同时 purge 的既有 P14 只证明假库条件更新一次有效，不能证明云端分布式原子性。需要经授权的跨实例协调/快照或可审计的持久屏障设计及云端验证；本轮未增集合、索引、锁或 schema。
2. **历史失败/延后批次的持续阻断：PENDING（可用性）。** 旧 `PARTIAL`、`FAILED`、`DEFERRED`、孤儿 prepare 日志只追加且不会因逐条审计补齐而改写；当前全量对账仍会看见原失败结果，严格规则使后续清理继续阻断。P8/P10/P17/P18 现按此裁决断言。G-J 的“恢复后放行”仅针对**短暂对账查询故障且没有历史异常日志**；不能冒称历史 PARTIAL 自动解除。若需解除，须另审“原批次与后续恢复批次的可证明关联、追加式解决记录及确认权限”，不能凭 `closed` 或人工口头判断绕过。
3. **500 行上限与云端能力：PENDING。** 日志超过单次 500 条将 fail-closed，当前没有能证明全局完整的跨窗口聚合；缺失字段、真实索引、`neq(null)`、条件更新原子性和函数超时也未在云端验收。本轮默认每事件 5 秒超时是本地安全上限，实际云端容量/延迟需独立验证。假库测试不能替代这些证据。
4. **审计范围：PENDING。** R-3 对账只比较已有 `upload_logs`；如果整个事件日志从未写入、查询静默漏行或索引行为异常，空结果本身不能证明历史上无操作。闸门遇显式查询错误会阻断，但无法仅靠本地代码证明云端日志集合完整。

## T3.2 的 Q5 缺口补记（仅计划）

- `deferPurge` 用 `where({_id,status,rev}).update({'retention.purge.retryAfter':...})`（`index.js:325–333`）。首次候选可能无 `retention.purge` 父级；假库的 `tools/ugc_fake_cloud.js:49–59` 会自动创建中间对象，**CloudBase 对缺父级点路径更新的真实行为仍 PENDING**。把“父级缺失/存在、更新成功统计、重读值、与 rev 冲突”纳入隔离环境 Q5 专项；只读轮不能执行更新，需另行获准写入合成夹具。
- R1/T-2 还有 `.doc(id).get()` 的逐条点读（如 `index.js:149–153,285–289`）和 `where({_id,status,rev,...}).update()` 的条件更新（如 `:179–195,310–322,486–497`）。T3.2 Q1–Q5 定义为**只读队列发现、排序、分页和索引核验包**，所以未把点读及写入性条件更新计作 Q1–Q5 的云端实测；这不表示它们已验证。点读可在隔离只读轮核返回/不存在行为；条件更新、丢回执、并发 CAS 需另行写入授权。CloudBase 真实行为保持 PENDING。

## Git 状态和差异核查

开工：`main`、HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、暂存 0、状态 325 条（追踪修改 15、未追踪 310）。收工实测：HEAD、分支、暂存均未变，状态 326 条（追踪修改 15、未追踪 311）；新增的一条是本轮专项测试。既有源码和清理测试原本就是未追踪的脏文件，未用 Git 历史覆盖。普通 `git diff --check` 退出 0；对两个既有未追踪文件还用外部备份执行 `git diff --no-index --check`，输出为空，退出 1 仅表示确有差异；新测试检查 LF 与行尾空白均通过。未执行任何 Git 写操作。

## 精确 unified diff

下列 diff 的前态为本轮外部原始字节备份；新测试的前态为不存在文件。以上报告与原始输出均在项目 Git 仓库外。

### Retention source

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_3_retention_audit_gate_20261030_20261030T033443389307Z\\cloudfunctions__retention__index.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
index 57cb42f..faf5554 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_3_retention_audit_gate_20261030_20261030T033443389307Z\\cloudfunctions__retention__index.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\cloudfunctions\\retention\\index.js"
@@ -46,6 +46,7 @@ const PURGE_STATES = Object.freeze(['approved', 'rejected', 'expired']);
 const RECONCILE_GRACE_MS = 10 * 60 * 1000;
 const RECONCILE_PAGE_SIZE = 50;
 const RECONCILE_MAX_ROWS = 500;
+const PURGE_AUDIT_GATE_TIMEOUT_MS = 5000;
 
 function fail(code, message, extra) {
   return Object.assign({ ok: false, code: code, message: message || '' }, extra || {});
@@ -377,12 +378,79 @@ async function recoverPurgePending(options) {
     code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
 }
 
-async function purgePayload(options) {
+function completeAuditReconcile(result, eventType) {
+  if (!result || result.ok !== true || result.code !== 'OK' ||
+      result.eventType !== eventType || result.completeScan !== true ||
+      result.truncated !== false || result.nextCursor !== null ||
+      !Number.isSafeInteger(result.scanned) || result.scanned < 0 ||
+      !Number.isSafeInteger(result.pages) || result.pages < 1 ||
+      !result.counts || !result.counts.outcomes || !Array.isArray(result.batches)) return false;
+  const counts = result.counts;
+  const statusKeys = ['closed', 'pairedWindow', 'suspectedOrphan', 'running',
+    'completeWithoutPrepare', 'duplicate', 'countMismatch', 'invalidLogs', 'unmatchedWindow'];
+  const outcomeKeys = ['OK', 'PARTIAL', 'FAILED', 'DEFERRED'];
+  if (!statusKeys.every(function (key) { return validCount(counts[key]); }) ||
+      !outcomeKeys.every(function (key) { return validCount(counts.outcomes[key]); })) return false;
+  if (statusKeys.slice(1).some(function (key) { return counts[key] !== 0; }) ||
+      outcomeKeys.slice(1).some(function (key) { return counts.outcomes[key] !== 0; }) ||
+      counts.closed !== counts.outcomes.OK || counts.closed !== result.batches.length) return false;
+  return result.batches.every(function (batch) {
+    return batch && batch.status === 'closed' && batch.completeCode === 'COMPLETE' &&
+      batch.outcome === 'OK';
+  });
+}
+
+async function checkPurgeAuditGate(testHooks) {
+  // The optional second argument of purgePayload is available only through __test__.
+  // exports.main never passes caller data into these hooks.
+  const reconcile = testHooks && testHooks.reconcile || reconcileBatches;
+  const timeoutMs = testHooks && Number.isSafeInteger(testHooks.timeoutMs) &&
+    testHooks.timeoutMs > 0 ? testHooks.timeoutMs : PURGE_AUDIT_GATE_TIMEOUT_MS;
+  for (const eventType of ['retention_mark', 'retention_purge']) {
+    let timer;
+    let result;
+    try {
+      result = await Promise.race([
+        Promise.resolve().then(function () { return reconcile({ eventType: eventType, now: new Date() }); }),
+        new Promise(function (_, reject) {
+          timer = setTimeout(function () { reject(new Error('AUDIT_GATE_TIMEOUT')); }, timeoutMs);
+        })
+      ]);
+    } catch (err) {
+      return fail('AUDIT_GATE_BLOCKED', '审计对账未能完成', {
+        eventType: eventType,
+        reason: err && err.message === 'AUDIT_GATE_TIMEOUT' ? 'TIMEOUT' : 'RECONCILE_ERROR'
+      });
+    } finally { if (timer) clearTimeout(timer); }
+    if (!completeAuditReconcile(result, eventType)) {
+      return fail('AUDIT_GATE_BLOCKED', '审计对账未能证明完整', {
+        eventType: eventType, reason: 'INCOMPLETE_OR_ANOMALOUS'
+      });
+    }
+  }
+  return { ok: true, code: 'OK' };
+}
+
+async function purgePayload(options, testHooks) {
   const config = readPolicy();
   if (config.error) return config.error;
   const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
   if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
   const cutoff = makeCutoff(now, PURGE_AFTER_DAYS);
+  let auditRecovery;
+  try { auditRecovery = await recoverPurgePending({ now: now }); }
+  catch (err) { return fail('AUDIT_GATE_BLOCKED', '清理审计恢复中断', { reason: 'RECOVERY_ERROR' }); }
+  if (auditRecovery && auditRecovery.code === 'DATABASE_ERROR') {
+    return fail('DATABASE_ERROR', '清理审计恢复队列读取失败');
+  }
+  if (!auditRecovery || auditRecovery.ok !== true || auditRecovery.code !== 'OK' ||
+      auditRecovery.failed || auditRecovery.deferred || auditRecovery.unprocessed ||
+      auditRecovery.retrySchedulingFailed) {
+    return fail('AUDIT_GATE_BLOCKED', '清理审计恢复未完成', { reason: 'RECOVERY_INCOMPLETE',
+      auditRecovery: auditRecovery });
+  }
+  const auditGate = await checkPurgeAuditGate(testHooks);
+  if (!auditGate.ok) return Object.assign({ auditRecovery: auditRecovery }, auditGate);
   let needsMark;
   let rows;
   try {
@@ -395,8 +463,6 @@ async function purgePayload(options) {
       .orderBy('_id', 'asc').limit(config.policy.batchLimit).get();
     rows = response && Array.isArray(response.data) ? response.data : [];
   } catch (err) { return fail('DATABASE_ERROR', '读取到期正文候选失败'); }
-  const auditRecovery = await recoverPurgePending({ now: now });
-  if (auditRecovery.code === 'DATABASE_ERROR') return fail('DATABASE_ERROR', '清理审计恢复队列读取失败');
   const result = { now: now, batchId: options && options.requestId || crypto.randomBytes(16).toString('hex'),
     selected: rows.length, needsMark: needsMark, purged: 0, purgedAudited: 0,
     auditFailedCount: 0, deferredAudit: 0, deferredRetry: 0,
@@ -669,7 +735,11 @@ async function reconcileBatches(options) {
       if (cursor) filter._id = _.gt(cursor);
       const response = await db.collection(COL.LOGS).where(filter)
         .orderBy('_id', 'asc').limit(take).get();
-      const rows = response && Array.isArray(response.data) ? response.data : [];
+      if (!response || !Array.isArray(response.data)) {
+        return fail('RECONCILE_RESULT_INVALID', '审计查询结果缺失',
+          { scanned: logs.length, truncated: true, completeScan: false });
+      }
+      const rows = response.data;
       pages++;
       for (const row of rows) {
         if (!row || typeof row._id !== 'string' || row._id <= cursor) {
@@ -682,7 +752,11 @@ async function reconcileBatches(options) {
       if (logs.length === maxRows) {
         const filterNext = { event: eventType, _id: _.gt(cursor) };
         const probe = await db.collection(COL.LOGS).where(filterNext).orderBy('_id', 'asc').limit(1).get();
-        truncated = !!(probe && Array.isArray(probe.data) && probe.data.length);
+        if (!probe || !Array.isArray(probe.data)) {
+          return fail('RECONCILE_RESULT_INVALID', '审计续页结果缺失',
+            { scanned: logs.length, truncated: true, completeScan: false });
+        }
+        truncated = !!probe.data.length;
         break;
       }
     }
```

### Purge regression test

```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_3_retention_audit_gate_20261030_20261030T033443389307Z\\tools__test_retention_purge.js" "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_purge.js"
index 7ee9460..1dfc1b8 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_3_retention_audit_gate_20261030_20261030T033443389307Z\\tools__test_retention_purge.js"
+++ "b/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\项目\\tools\\test_retention_purge.js"
@@ -56,6 +56,7 @@ async function run() {
   r = await T.purgePayload({ now: now });
   check('P5 超期 pending 只报告需标记，不清正文', r.needsMark === 1 &&
     r.code === 'PURGE_DEFERRED' && doc('pending').payload !== null && doc('pending').status === 'pending');
+  setup(); seed('pending', 'pending', 32 * day);
   await T.markExpired({ now: now });
   r = await T.purgePayload({ now: now });
   check('P6 经既有状态转换和审计完成后才清正文',
@@ -66,12 +67,13 @@ async function run() {
   h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
   await T.markExpired({ now: now }); h.clearFail();
   r = await T.purgePayload({ now: now });
-  check('P7 T-1 审计待补时绝不清正文', r.deferredAudit === 1 &&
-    doc('mark_failed').payload !== null && doc('mark_failed').retention.audit.state === 'pending' && closed(r));
+  check('P7 T-1 失败批次和待补审计阻断正文清理', r.code === 'AUDIT_GATE_BLOCKED' &&
+    doc('mark_failed').payload !== null && doc('mark_failed').retention.audit.state === 'pending');
   await T.recoverAudit('mark_failed');
   r = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
-  check('P8 标记审计恢复完成且退避结束后可清正文', r.purged === 1 &&
-    doc('mark_failed').payload === null && doc('mark_failed').retention.audit.state === 'complete');
+  check('P8 逐条审计已恢复但历史 PARTIAL 批次仍禁止清理',
+    r.code === 'AUDIT_GATE_BLOCKED' && doc('mark_failed').payload !== null &&
+    doc('mark_failed').retention.audit.state === 'complete');
 
   setup(); seed('race', 'approved', 31 * day);
   h.setBeforeUpdate(function (rows) { rows[0].status = 'rejected'; rows[0].rev = 2; h.setBeforeUpdate(null); });
@@ -87,10 +89,10 @@ async function run() {
   const advanced = await T.purgePayload({ now: now });
   const delayed = await T.purgePayload({ now: now });
   const resumed = await T.purgePayload({ now: new Date(now.getTime() + 61000) });
-  check('P10 写入失败退避，后续记录跨批推进', failed.failed === 1 &&
-    advanced.purged === 1 && delayed.deferredRetry === 1 && resumed.purged === 1 &&
-    doc('bad').payload === null && doc('good').payload === null &&
-    [failed, advanced, delayed, resumed].every(closed));
+  check('P10 写入失败留退避标记，PARTIAL 批次阻断后续正文清理', failed.failed === 1 &&
+    [advanced, delayed, resumed].every(function (x) { return x.code === 'AUDIT_GATE_BLOCKED'; }) &&
+    doc('bad').payload !== null && doc('good').payload !== null &&
+    doc('bad').retention.purge.retryAfter > now && closed(failed));
 
   setup(); seed('log_failure', 'approved', 31 * day);
   h.setFail({ collection: 'upload_logs', op: 'add', atCall: 2 });
@@ -98,7 +100,8 @@ async function run() {
   const afterFailure = await h.loadFunction('cloudfunctions/retention/index.js').__test__.purgePayload({ now: now });
   check('P11 逐条审计失败后标记留存，重启实例自动补记且不重复清正文',
     auditFailure.code === 'PURGE_PARTIAL' && auditFailure.auditFailedCount === 1 &&
-    afterFailure.auditRecovery.recovered === 1 && doc('log_failure').retention.purge.state === 'complete' &&
+    afterFailure.code === 'AUDIT_GATE_BLOCKED' && afterFailure.auditRecovery.recovered === 1 &&
+    doc('log_failure').retention.purge.state === 'complete' &&
     doc('log_failure').rev === 2 && logs('log_failure').length === 1 && closed(auditFailure));
 
   setup(); seed('prepare_failure', 'approved', 31 * day);
@@ -130,18 +133,18 @@ async function run() {
   const incompleteBatch = await T.purgePayload({ now: now });
   h.clearFail();
   const retriedBatch = await T.purgePayload({ now: now });
-  check('P17 批次 complete 日志失败不谎报成功，重跑不重复逐条事件',
+  check('P17 批次 complete 日志失败后孤儿 prepare 阻断重跑，逐条事件不重复',
     incompleteBatch.code === 'LOG_FAILED' && incompleteBatch.logged === false &&
-    doc('complete_log_failure').payload === null && retriedBatch.purged === 0 &&
+    doc('complete_log_failure').payload === null && retriedBatch.code === 'AUDIT_GATE_BLOCKED' &&
     logs('complete_log_failure').length === 1 && closed(incompleteBatch));
 
   setup(1); seed('invalid_rev', 'approved', 40 * day); seed('behind_invalid', 'rejected', 39 * day);
   h.state.docs.submissions[0].rev = 0;
   const invalid = await T.purgePayload({ now: now });
   const progressed = await T.purgePayload({ now: now });
-  check('P18 异常版本记录退避，不永久挤占后续名额', invalid.skipped === 1 &&
-    progressed.purged === 1 && doc('invalid_rev').payload !== null &&
-    doc('behind_invalid').payload === null && closed(invalid) && closed(progressed));
+  check('P18 异常版本记录退避，DEFERRED 批次未审清前阻断后续正文清理', invalid.skipped === 1 &&
+    progressed.code === 'AUDIT_GATE_BLOCKED' && doc('invalid_rev').payload !== null &&
+    doc('behind_invalid').payload !== null && closed(invalid));
   console.log('PASS ' + pass + ' / FAIL ' + fail);
   if (fail) process.exitCode = 1;
 }
```

### New audit gate test

```diff
--- /dev/null
+++ tools/test_retention_audit_gate.js
@@ -0,0 +1,208 @@
+'use strict';
+const { createHarness } = require('./ugc_fake_cloud');
+const h = createHarness();
+const fn = h.loadFunction('cloudfunctions/retention/index.js');
+const T = fn.__test__;
+const now = new Date('2026-10-28T12:00:00.000Z');
+const dayMs = 86400000;
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
+  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
+}
+function candidate(id) {
+  h.seed('submissions', { _id: id, status: 'approved', rev: 1,
+    createdAt: new Date(now.getTime() - 31 * dayMs), payload: { note: 'private-body-' + id },
+    verifyStatus: 'unverified' });
+}
+function payloadBytes(id) {
+  const row = h.docs('submissions').find(function (x) { return x._id === id; });
+  return Buffer.from(JSON.stringify(row.payload), 'utf8');
+}
+function stillPrivate(id, before, logCount) {
+  const row = h.docs('submissions').find(function (x) { return x._id === id; });
+  return Buffer.compare(payloadBytes(id), before) === 0 && row.rev === 1 &&
+    row.payloadRedactedAt === undefined && h.state.updateCalls === 0 &&
+    h.docs('upload_logs').length === logCount;
+}
+function batch(eventType, code, id) {
+  const mark = eventType === 'retention_mark';
+  for (const phase of ['prepare', 'complete']) {
+    const complete = phase === 'complete';
+    const stats = mark ? {
+      phase: phase, operation: 'mark', batchId: id, selected: 1,
+      marked: 0, markedAudited: 0, auditFailedCount: 0, skipped: 0,
+      conflicts: 0, failed: complete && code !== 'COMPLETE' ? 1 : 0,
+      unprocessed: complete ? (code === 'COMPLETE' ? 1 : 0) : 1
+    } : {
+      phase: phase, operation: 'purge', batchId: id, selected: 1,
+      purged: 0, purgedAudited: 0, auditFailedCount: 0, deferredAudit: 0,
+      deferredRetry: 0, skipped: 0, conflicts: 0,
+      failed: complete && code !== 'COMPLETE' ? 1 : 0,
+      unprocessed: complete ? (code === 'COMPLETE' ? 1 : 0) : 1, needsMark: 0
+    };
+    // A successful complete with one selected row must close a real outcome.
+    if (complete && code === 'COMPLETE') {
+      if (mark) { stats.marked = 1; stats.markedAudited = 1; }
+      else { stats.purged = 1; stats.purgedAudited = 1; }
+      stats.unprocessed = 0;
+    }
+    h.seed('upload_logs', { _id: id + '_' + phase, schemaVersion: 1,
+      event: eventType, action: eventType, submissionId: null,
+      day: '2026-10-28', at: new Date(now.getTime() - (complete ? 900 : 1000)),
+      rev: 1, actor: { role: 'system', openidHash: null }, errorCode: '',
+      result: { code: complete ? code : 'PREPARE', stats: stats } });
+  }
+}
+async function blocked(id, hooks) {
+  const before = payloadBytes(id);
+  const logCount = h.docs('upload_logs').length;
+  const result = await T.purgePayload({ now: now }, hooks);
+  return { result: result, intact: stillPrivate(id, before, logCount) };
+}
+async function run() {
+  setup(); candidate('normal'); batch('retention_mark', 'COMPLETE', 'normal_batch');
+  let result = await T.purgePayload({ now: now });
+  check('G-A 完整 OK 对账允许清正文', result.ok === true && result.purged === 1 &&
+    h.docs('submissions')[0].payload === null);
+
+  setup(); candidate('partial'); batch('retention_mark', 'PARTIAL', 'partial_batch');
+  let scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
+  let attempt = await blocked('partial');
+  check('G-B PARTIAL 即使 closed=1 也拦截且正文逐字节不变',
+    scan.counts.closed === 1 && scan.counts.outcomes.PARTIAL === 1 &&
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('failed'); batch('retention_purge', 'FAILED', 'failed_batch');
+  scan = await T.reconcileBatches({ eventType: 'retention_purge', now: new Date() });
+  attempt = await blocked('failed');
+  check('G-C FAILED 即使 closed=1 也拦截且不写虚假 complete',
+    scan.counts.closed === 1 && scan.counts.outcomes.FAILED === 1 &&
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('anomaly');
+  h.seed('upload_logs', { _id: 'orphan', schemaVersion: 1, event: 'retention_mark',
+    action: 'retention_mark', submissionId: null, day: '2026-10-28',
+    at: new Date(now.getTime() - 1000), rev: 1,
+    actor: { role: 'system', openidHash: null }, errorCode: '',
+    result: { code: 'PREPARE', stats: { phase: 'prepare', operation: 'mark',
+      batchId: 'orphan', selected: 1, marked: 0, markedAudited: 0,
+      auditFailedCount: 0, skipped: 0, conflicts: 0, failed: 0, unprocessed: 1 } } });
+  attempt = await blocked('anomaly');
+  check('G-D RECONCILE_ANOMALIES / 疑似孤儿 prepare 拦截',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('running_prepare');
+  const recent = new Date();
+  h.seed('upload_logs', { _id: 'recent_prepare', schemaVersion: 1,
+    event: 'retention_mark', action: 'retention_mark', submissionId: null,
+    day: recent.toISOString().slice(0, 10), at: recent, rev: 1,
+    actor: { role: 'system', openidHash: null }, errorCode: '',
+    result: { code: 'PREPARE', stats: { phase: 'prepare', operation: 'mark',
+      batchId: 'running_prepare', selected: 1, marked: 0, markedAudited: 0,
+      auditFailedCount: 0, skipped: 0, conflicts: 0, failed: 0, unprocessed: 1 } } });
+  scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
+  attempt = await blocked('running_prepare');
+  check('G-D2 未超阈值的运行中 prepare 即使对账 ok=true 也拦截',
+    scan.ok === true && scan.counts.running === 1 &&
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('incomplete');
+  attempt = await blocked('incomplete', { reconcile: async function (options) {
+    const actual = await T.reconcileBatches(options);
+    return Object.assign({}, actual, { completeScan: false });
+  } });
+  check('G-E completeScan=false 即使 ok=true 也拦截',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('truncated');
+  attempt = await blocked('truncated', { reconcile: async function (options) {
+    const actual = await T.reconcileBatches(options);
+    return Object.assign({}, actual, { truncated: true, nextCursor: 'cursor' });
+  } });
+  check('G-F 截断结果即使 ok=true 也拦截',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('real_truncation');
+  for (let i = 0; i < 501; i++) {
+    h.seed('upload_logs', { _id: 'single_' + String(i).padStart(4, '0'),
+      schemaVersion: 1, event: 'retention_mark', action: 'retention_mark',
+      submissionId: 'synthetic_' + i, day: '2026-10-28',
+      at: new Date(now.getTime() - 1000), rev: 1,
+      actor: { role: 'system', openidHash: null }, errorCode: '', result: { code: 'OK' } });
+  }
+  scan = await T.reconcileBatches({ eventType: 'retention_mark', now: new Date() });
+  attempt = await blocked('real_truncation');
+  check('G-F2 实际 501 条只读扫描截断阻断正文清理',
+    scan.code === 'SCAN_TRUNCATED' && scan.truncated === true &&
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('timeout');
+  attempt = await blocked('timeout', { reconcile: function () { return new Promise(function () {}); }, timeoutMs: 5 });
+  check('G-G 对账超时拦截', attempt.result.reason === 'TIMEOUT' && attempt.intact);
+
+  setup(); candidate('missing');
+  attempt = await blocked('missing', { reconcile: async function () { return undefined; } });
+  check('G-H 对账结果缺失拦截', attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('malformed');
+  attempt = await blocked('malformed', { reconcile: async function (options) {
+    const actual = await T.reconcileBatches(options);
+    return Object.assign({}, actual, { counts: undefined });
+  } });
+  check('G-H2 对账计数结构不完整拦截',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('bad_outcome'); batch('retention_mark', 'PARTIAL', 'bad_outcome_batch');
+  attempt = await blocked('bad_outcome', { reconcile: async function (options) {
+    const actual = await T.reconcileBatches(options);
+    return Object.assign({}, actual, { ok: true, code: 'OK' });
+  } });
+  check('G-I 返回码伪装 OK 仍检查 outcomes 中 PARTIAL',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('retry');
+  attempt = await blocked('retry', { reconcile: async function () { throw new Error('offline fault'); } });
+  const retry = await T.purgePayload({ now: now });
+  check('G-J 短暂对账故障后重试成功才清正文',
+    attempt.result.reason === 'RECONCILE_ERROR' && attempt.intact &&
+    retry.ok === true && retry.purged === 1 && h.docs('submissions')[0].payload === null);
+
+  setup(); candidate('invalid_db');
+  const originalCollection = h.db.collection;
+  h.db.collection = function (name) {
+    const coll = originalCollection(name);
+    if (name !== 'upload_logs') return coll;
+    return { where: function () { return { orderBy: function () { return this; },
+      limit: function () { return this; }, get: async function () { return undefined; } }; } };
+  };
+  attempt = await blocked('invalid_db');
+  h.db.collection = originalCollection;
+  check('G-K 数据库对账响应缺失不按空日志放行',
+    attempt.result.code === 'AUDIT_GATE_BLOCKED' && attempt.intact);
+
+  setup(); candidate('public_entry'); batch('retention_mark', 'FAILED', 'entry_batch');
+  const before = payloadBytes('public_entry'), logCount = h.docs('upload_logs').length;
+  result = await fn.main({ action: 'purge', maintenanceToken: 'offline-token' }, {});
+  check('G-L 维护入口同样不能绕过闸门', result.code === 'AUDIT_GATE_BLOCKED' &&
+    stillPrivate('public_entry', before, logCount));
+
+  setup(); candidate('unauthorized');
+  const raw = payloadBytes('unauthorized');
+  result = await fn.main({ action: 'purge' }, {});
+  check('G-M 无令牌拒绝且不查询或更新正文', result.code === 'FORBIDDEN' &&
+    Buffer.compare(payloadBytes('unauthorized'), raw) === 0 && h.state.updateCalls === 0 &&
+    h.calls('upload_logs').length === 0);
+
+  console.log('PASS ' + pass + ' / FAIL ' + fail);
+  if (fail) process.exitCode = 1;
+}
+run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
```
