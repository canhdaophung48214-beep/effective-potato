# Codex｜T3.4 Retention 三项 P1 实施与验收（2026-10-30）

执行人：Codex。验收对象为本轮实际工作区；DSH 后续独立只读复核。本轮没有访问云端、部署、建索引、改触发器、执行 Git 写操作、处理真实投稿或生成正式产物。

## 1. 结论（不得合并为总体 PASS）

| 项目 | 本轮结果 | 证据与边界 |
|---|---|---|
| T3.4-A：TOCTOU | **FAIL（本地安全目标）／云端 PENDING** | 现有闸门与清正文更新不原子。本轮交错探针实测：对账 OK 后插入 PARTIAL，`purgeCode=OK`、`payloadCleared=true`、`rev=2`，随后对账 `RECONCILE_ANOMALIES`。未实施虚假的内存锁或不完整的持久锁。**禁止据此版本部署或运行 purge。** |
| T3.4-B：历史 FAILED/PARTIAL 恢复 | **PENDING** | 批次日志只有汇总与 `batchId`，逐条日志没有原批次 ID；无法证明历史批次缺失的具体审计已经补齐。原始日志未改，失败批次继续阻断。未添加 `force/ignore/skip-history`。 |
| T3.4-C：分页和断点续扫 | **本地只读诊断 PASS；作为正文闸门 PENDING** | 新增有签名的跨调用续扫，499/500/501/1001 条及中断、重复、双实例只读续扫通过。扫描只覆盖起始 `_id` 水位内的键空间，不是原子快照；闸门仍不接受续扫结果，超过 500 条继续失败关闭。 |
| 整体上线条件 | **PENDING** | A 已在本地复现违反正文保护；B 与 C 的生产级条件未闭环。真实 CloudBase 索引、事务、排序、并发和部署均未验证。 |

## 2. 开工核验与调用关系

- 开工 Git：`main`，HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`；暂存 0，`status --porcelain=v1 --untracked-files=all` 326 条（既有 15 个已跟踪修改、311 个未跟踪）。`cloudfunctions/retention/index.js` 开工时已经是未跟踪文件；本轮保留其原字节并从原字节备份开始修改。
- 根目录及项目目录未找到 `.baton/task.md`、`.baton/handoff/current.md`、`.baton/PROTOCOL.md`；因此未伪造交接内容。读取了 DSH T3.3 第二轮及 DSH T3.4 尚未交付验收记录，并核对当前源码、专项测试、schema 与冻结设计稿。
- `cloudfunctions/retention/index.js:914` 的 `main` 先验维护令牌，再分派 `mark`→`markExpired:520`、`recover`→`recoverAudit:152`、`recoverPending:202`、`purge`→`purgePayload:436`、`reconcile`→`reconcileBatches:747`。`markExpired` 和 `recoverPending` 经 `writeRunLog:93` 写批次/逐条事件；`deferAudit:139` 更新待补退避。`purgePayload` 先调用 `recoverPurgePending:338`、`checkPurgeAuditGate:405`，再读候选、写 prepare、在 `:496` 清空 `payload`、调用 `recoverPurgeAudit:288`、写 complete；`deferPurge:328` 更新重试；`writePurgeLog:264` 只追加。`reconcileBatches` 只读。`cloudfunctions/review/index.js:439` 另有人工删除请求路径的 `payload:null`，本轮未修改或调用。
- `config/cloud/schema.upload_logs.json:59-62` 只声明本地 `(event,_id)` 索引，不证明真实云端已建；`cloudfunctions/retention/package.json` 依赖 `wx-server-sdk ~2.6.3`。冻结契约 `docs/UGC_MVP_DESIGN_FINAL_20261026.md:280` 保留单页 50、单次 500、截断不得作全局结论。

## 3. 实施内容与精确差异

1. `项目/cloudfunctions/retention/index.js`：在原有对账逻辑外新增只读续扫凭据。用维护令牌派生密钥作 HMAC；签名/结构无效先拒绝再读库。凭据只保存已哈希的批次引用和已知计数字段、固定时间、水位 `_id`、游标、累计扫描状态。每次最多 500 条、每页最多 50 条；未完成时 `completeScan=false`，返回 `nextContinuation`。增加 `scanScope.consistency=KEYSPACE_WATERMARK_NOT_ATOMIC`，明确续扫结果不是全局原子快照。`purgePayload` 与 T3.3 闸门没有接入外部续扫结果。
2. `项目/tools/test_retention_t34_resume.js`（新建）：21 条离线断言，覆盖 499/500/501/1001、跨页同时间批次配对、截断失败关闭、签名破坏、重复续扫、查询中断重试、新函数实例、两实例只读并行、扫描中插入日志、鉴权及零写入；还检查凭据不含原始批次 ID、投稿 ID、正文和令牌。
3. `项目/docs/RETENTION_T34_SAFETY_BOUNDARIES_20261030.md`（新建）：说明续扫的一致性边界、A/B 未闭环原因和上线前验收条件。未修改 schema、fake DB、冻结主套件或冻结契约。

三文件逐行 unified diff 见同目录 `Codex_T3.4_精确差异_20261030.patch`（24,238 字节，SHA-256 `22655E06412DD543AC249276B1475B1387A3F68A29EE62828E239818B436AB6B`）；本报告附录嵌入同一份差异。该差异以本轮外部原字节备份为 `index.js` 的旧侧；新文件以 `/dev/null` 为旧侧。由于目标原本未跟踪，普通 `git diff` 无法呈现其变化。

## 4. 备份及文件哈希

| 文件 | 修改前字节 / SHA-256 | 修改后字节 / SHA-256 | 备份 |
|---|---|---|---|
| `cloudfunctions/retention/index.js` | 41,521 / `3DBB96443008F824F801C48C01EF72EEA0EA954BA2DE06B8BA867C608B293C8F` | 46,633 / `8BE773F7D271A9C92F98B3AFF62AE0C035A054FE8B20F09B7EC617EE674682C7` | `C:\Users\25975\Desktop\食神寻味小程序开发\备份\T3_4_retention_20261030_120050_787\index.js`，复制后与源 SHA-256 相同；收工再次核对仍为原哈希。 |
| `tools/test_retention_t34_resume.js` | 不存在 | 7,758 / `E6EF3BD70C2AE3C35C9AC3D65FCBA2952770F70ACF8D1B2A9E486E6D68CCF498` | 新文件无修改前字节。 |
| `docs/RETENTION_T34_SAFETY_BOUNDARIES_20261030.md` | 不存在 | 3,982 / `C719E502E9AD8A2668F8EC2301DEB30C5BABC4275064EEB9EF179501FB06BE6A` | 新文件无修改前字节。 |

备份位于项目和 Git 仓库外；未覆盖旧备份。外部 `counterfactual/` 与 `toctou_probe.js` 是临时离线实验文件，不是原始备份，也未写入项目。

## 5. A：并发与 TOCTOU 探针

在仓库外运行 `node 备份/T3_4_retention_20261030_120050_787/toctou_probe.js`，退出码 0，实际输出：

```json
{"purgeCode":"OK","purgeOk":true,"payloadCleared":true,"rev":2,"laterCode":"RECONCILE_ANOMALIES","partial":1,"logWrites":3}
```

探针使用共享假数据库，在 `retention_purge` 对账完成后插入一个 PARTIAL 批次，随后函数继续执行 `:496` 的正文更新。该探针**证明当前本地代码存在交错窗口**；它不证明真实云端发生概率。两个 purge 实例、旧持锁实例超时后继续写入、网络超时回执不确定等均未得到可证明的跨实例屏障。现有 `status/rev` 条件仅保护投稿单文档，不能把全局日志查询与正文更新变成一个原子操作。

官方 [CloudBase 事务文档](https://docs.cloudbase.net/database/transaction)说明服务端事务支持 `doc` 而不支持 `where`，且有 100 次操作、30 秒限制；这些文档没有证明当前 `wx-server-sdk ~2.6.3` 的全局日志查询、持久 fencing 与所有写入入口可在同一原子约束下工作。需要先核实目标 SDK/云端能力，或获得所有写入方共同遵守的持久串行/租约/fencing 设计与真实并发验收。单进程内存锁和“acquire/check/release”三步均不足以关闭 A。

## 6. B：历史失败恢复证据缺口

`writeRunLog:93-129` 与 `writePurgeLog:264-285` 的批次记录含 `batchId` 和汇总计数；逐条事件只含 `submissionId`、稳定事件 ID 和结果，没有原批次关联。`batchLogInfo:679-707` 明确把逐条事件排除在批次配对外。`validCompleteCounts:648-666` 能证明数字守恒，不能证明每条历史记录缺失的审计内容是什么。直接追加“已修复”事件会构成无证据放行，因此本轮没有实施修复入口，也没有改写/删除旧日志。现有 FAILED/PARTIAL/DEFERRED 及孤儿 prepare 仍阻断清理。

后续最小条件：取得可验证的原批次选中记录清单或等价证据；仅对缺失的逐条审计补写稳定事件 ID；再追加关联原 `batchId` 的修复事件（类型、UTC 时间、系统操作者、证据摘要、稳定修复事件 ID）；重复调用按相同 ID 幂等，失败保留续修标记；修复后重新完整对账，其他异常仍阻断。历史证据无法重建的批次保持阻断并交人工调查，不能人工强制覆盖结果。

## 7. C：分页完整性与一致性

- 本地续扫 499/500 条单次闭合；501 条两次闭合；1001 条三次闭合。批次 prepare 位于首条、complete 位于末条，最终仍只形成一个 `closed/OK`，无跨页重复计数。中间调用 `SCAN_TRUNCATED`、`ok=false`、`completeScan=false`；有效继续凭据可重复使用，查询失败后原凭据重试，重启函数实例后可继续。
- 两个独立函数实例共享假数据库并行只读续扫结果一致，`updateCalls=0`、`removeCalls=0`。这不是云端并发原子性证明。
- 起始最大 `_id` 为水位；水位内新插入且 `at>now` 的异常日志被计入 `invalidLogs` 并返回 `RECONCILE_ANOMALIES`。水位外的新日志被明确排除，输出 `scanScope` 说明范围。若云端允许后写入更小 `_id` 或时间回拨，无法保证快照一致。HMAC 凭据 2 MiB 上限、真实请求大小、真实索引和排序仍待云端验证。**续扫的 `completeScan=true` 不作为 purge 放行凭据。**
- T3.3 的 `checkPurgeAuditGate` 仍独立重新扫描两个事件，`tools/test_retention_audit_gate.js` 的实际 501 条断言仍证明正文失败关闭；这意味着 C 的诊断分页已实现，但超过 500 条的生产清理仍 PENDING。

## 8. 反事实测试

仅在仓库外隔离副本修改代码；正式工作区未做变异。

| 变异 | 实际命令/结果 | 捕获情况 |
|---|---|---|
| 把 `completeScan` 固定为 `true` | `node tools/test_retention_t34_resume.js`，退出 1，18 PASS / 3 FAIL | 501/1001 未扫完失败关闭与鉴权续扫断言变红。 |
| 同时移除“超过水位停止”和“读到水位停止” | 同命令，退出 1，20 PASS / 1 FAIL | “高水位之外的新日志不进入本次诊断快照”变红。 |

单独只移除第二个水位分支时测试仍绿，因为第一个分支仍阻止越界；因此采用两个分支同时移除作为有效反事实，不把无效变异冒充成功。

## 9. 本轮完整离线回归

以下均为本轮最终源码状态实跑。逐命令原始输出见同目录 `Codex_T3.4_回归原始输出_20261030.txt`（103,500 字节，SHA-256 `6A81699D8F5124BAF0402DDA72D4F8950EEB4461C402B994C648B8D9CB053616`）。表内“跳过”除冻结主套件的 11 项 PENDING 外均为 0 或未设跳过项。

| 命令 | 退出码 | 实际汇总 |
|---|---:|---|
| `node tools/test_retention_t34_resume.js` | 0 | 21 PASS / 0 FAIL |
| `node tools/test_retention_reconcile.js` | 0 | 30 PASS / 0 FAIL |
| `node tools/test_retention_mark.js` | 0 | 71 PASS / 0 FAIL |
| `node tools/test_retention_purge.js` | 0 | 18 PASS / 0 FAIL |
| `node tools/test_retention_recover_pending.js` | 0 | 13 PASS / 0 FAIL |
| `node tools/test_retention_audit_gate.js` | 0 | 16 PASS / 0 FAIL |
| `node tools/test_ugc_review.js` | 0 | 86 PASS / 0 FAIL |
| `node tools/test_ugc_submit.js` | 0 | 110 PASS / 0 FAIL |
| `node tools/test_ugc_client_contract.js` | 0 | 90 PASS / 0 FAIL |
| `node tools/test_index_state.js` | 0 | 205 PASS / 0 FAIL |
| `node tools/test_pages.js` | 0 | 106 PASS / 0 FAIL |
| `node tools/check_eol.js` | 0 | docs/tools Markdown 62 文件检查，违规 0 |
| `node tools/test_check_doc_refs.js` | 0 | 51 PASS / 0 FAIL |
| `node tools/test_records_spec.js` | 0 | 290 PASS / 0 FAIL / 11 PENDING；未改变其状态 |
| `node --check cloudfunctions/retention/index.js` | 0 | 无输出，语法通过 |
| `node --check tools/test_retention_t34_resume.js` | 0 | 无输出，语法通过 |
| `git diff --check`（只读） | 0 | 仅提示既有 `project.config.json` 将来可能换行规范化，无 whitespace 错误；新增未跟踪文件另查无尾随空格 |

## 10. Git、EOL、副作用与 DSH 清单

- 收工 Git 仍为 `main`、同一 HEAD、暂存 0；`status --porcelain=v1 --untracked-files=all` 为 328 条。与开工 326 条相比新增的项目文件仅本轮测试及设计文档；`index.js` 原本已未跟踪，保留了其既有内容并只增加本轮续扫代码。原有 15 个已跟踪修改和其余 311 个未跟踪文件未清理、未暂存、未覆盖。报告与备份位于项目外。
- `git diff --check` 退出 0；三目标文件另查无尾随空格。`check_eol.js` 对新增文档检查通过。未修改 schema、假数据库、`verifyStatus`、ID 映射、审批文件、冻结生成器/主套件/契约。
- 云端调用、部署、建索引、触发器、真实数据访问均为 **0**。假数据库中的日志与正文变更只发生在离线测试或探针中。无正式产物。
- 请 DSH 分别复核：A 的交错探针及生产禁用结论；B 的原始批次与逐条日志关联缺口；C 的签名凭据、哈希投影、游标/水位、跨页计数、故障重试及 `scanScope`；并确认续扫未被正文闸门使用。不要把 C 的本地诊断 PASS 升格为生产清理 PASS。

## 11. 剩余风险与停止条件

本轮没有完成三项 P1 总闭环，尤其 A 当前仍可在交错条件下清正文。B 需要历史证据重建策略，C 需要真实云端 `_id`/索引/请求大小与一致性验证，并与 A 的持久串行或事务方案合并。超时、崩溃、续租、旧实例失效、写日志回执不确定、两实例同时 purge 均为 PENDING。依工单在此停止，不部署、不进入 T3.5，等待 DSH 独立验收和下一轮授权。

## 附录：本轮精确 unified diff


```diff
diff --git "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_4_retention_20261030_120050_787\\index.js" b/cloudfunctions/retention/index.js
index faf5554..6222c33 100644
--- "a/C:\\Users\\25975\\Desktop\\食神寻味小程序开发\\备份\\T3_4_retention_20261030_120050_787\\index.js"
+++ b/cloudfunctions/retention/index.js
@@ -46,6 +46,8 @@ const PURGE_STATES = Object.freeze(['approved', 'rejected', 'expired']);
 const RECONCILE_GRACE_MS = 10 * 60 * 1000;
 const RECONCILE_PAGE_SIZE = 50;
 const RECONCILE_MAX_ROWS = 500;
+// Continuations are diagnostics only; purge never accepts a caller supplied scan token.
+const RECONCILE_TOKEN_MAX_CHARS = 2 * 1024 * 1024;
 const PURGE_AUDIT_GATE_TIMEOUT_MS = 5000;
 
 function fail(code, message, extra) {
@@ -705,6 +707,42 @@ function batchLogInfo(log, eventType) {
     stats: Object.assign({}, stats, { operation: operation }) };
 }
 
+function scanTokenKey() {
+  const secret = process.env.UGC_RETENTION_TRIGGER_TOKEN;
+  return typeof secret === 'string' && secret.trim() ?
+    crypto.createHash('sha256').update('retention-reconcile-v1\0' + secret.trim()).digest() : null;
+}
+
+function sealScanState(state) {
+  const key = scanTokenKey();
+  if (!key) return null;
+  const body = Buffer.from(JSON.stringify(state)).toString('base64url');
+  if (body.length > RECONCILE_TOKEN_MAX_CHARS) return null;
+  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url');
+  return body + '.' + signature;
+}
+
+function openScanState(token, eventType) {
+  const key = scanTokenKey();
+  if (!key || typeof token !== 'string' || token.length > RECONCILE_TOKEN_MAX_CHARS + 64) return null;
+  const parts = token.split('.');
+  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) ||
+      !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
+  const actual = Buffer.from(parts[1], 'base64url');
+  const expected = crypto.createHmac('sha256', key).update(parts[0]).digest();
+  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
+  let state;
+  try { state = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); }
+  catch (err) { return null; }
+  if (!state || state.version !== 1 || state.eventType !== eventType ||
+      typeof state.cursor !== 'string' || !state.cursor || state.cursor.length > 128 ||
+      typeof state.upperId !== 'string' || !state.upperId || state.upperId.length > 128 ||
+      state.cursor > state.upperId || !Number.isSafeInteger(state.scanned) || state.scanned < 1 ||
+      !Number.isSafeInteger(state.pages) || state.pages < 1 || !validCount(state.invalidLogs) ||
+      !Array.isArray(state.entries) || Number.isNaN(new Date(state.now).getTime())) return null;
+  return state;
+}
+
 // Read-only, bounded scan. Unmatched halves are not called orphans when a window is truncated.
 async function reconcileBatches(options) {
   const config = readPolicy();
@@ -714,21 +752,41 @@ async function reconcileBatches(options) {
   if (eventType !== 'retention_mark' && eventType !== 'retention_purge') {
     return fail('INVALID_EVENT', '请选择 retention_mark 或 retention_purge');
   }
-  const now = input.now instanceof Date ? new Date(input.now.getTime()) : new Date();
+  const resumable = input.resumable === true || input.continuation !== undefined;
+  const previous = input.continuation === undefined ? null :
+    openScanState(input.continuation, eventType);
+  if (input.continuation !== undefined && !previous) {
+    return fail('INVALID_SCAN_CONTINUATION', '对账续扫凭据无效');
+  }
+  const now = previous ? new Date(previous.now) :
+    (input.now instanceof Date ? new Date(input.now.getTime()) : new Date());
   if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
   const pageSize = input.pageSize === undefined ? RECONCILE_PAGE_SIZE : input.pageSize;
   const maxRows = input.maxRows === undefined ? RECONCILE_MAX_ROWS : input.maxRows;
-  const startCursor = input.cursor === undefined ? '' : input.cursor;
+  const startCursor = previous ? previous.cursor : (input.cursor === undefined ? '' : input.cursor);
   if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > RECONCILE_PAGE_SIZE ||
       !Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > RECONCILE_MAX_ROWS ||
-      typeof startCursor !== 'string' || startCursor.length > 128) {
+      typeof startCursor !== 'string' || startCursor.length > 128 ||
+      (resumable && !previous && startCursor) || (previous && input.cursor !== undefined)) {
     return fail('INVALID_SCAN_OPTIONS', '对账扫描参数不合法');
   }
   let cursor = startCursor;
   const logs = [];
   let pages = 0;
   let truncated = false;
+  let reachedUpper = false;
+  let upperId = previous ? previous.upperId : null;
   try {
+    if (resumable && !previous) {
+      const top = await db.collection(COL.LOGS).where({ event: eventType })
+        .orderBy('_id', 'desc').limit(1).get();
+      if (!top || !Array.isArray(top.data) ||
+          (top.data.length && (typeof top.data[0]._id !== 'string' || !top.data[0]._id))) {
+        return fail('RECONCILE_RESULT_INVALID', '审计扫描水位无效',
+          { scanned: 0, truncated: true, completeScan: false });
+      }
+      upperId = top.data.length ? top.data[0]._id : null;
+    }
     while (logs.length < maxRows) {
       const take = Math.min(pageSize, maxRows - logs.length);
       const filter = { event: eventType };
@@ -745,10 +803,12 @@ async function reconcileBatches(options) {
         if (!row || typeof row._id !== 'string' || row._id <= cursor) {
           return fail('UNSTABLE_SCAN', '对账分页顺序无效', { scanned: logs.length, truncated: true });
         }
+        if (resumable && row._id > upperId) { reachedUpper = true; break; }
         cursor = row._id;
         logs.push(row);
+        if (resumable && cursor === upperId) { reachedUpper = true; break; }
       }
-      if (rows.length < take) break;
+      if (reachedUpper || rows.length < take) break;
       if (logs.length === maxRows) {
         const filterNext = { event: eventType, _id: _.gt(cursor) };
         const probe = await db.collection(COL.LOGS).where(filterNext).orderBy('_id', 'asc').limit(1).get();
@@ -756,7 +816,8 @@ async function reconcileBatches(options) {
           return fail('RECONCILE_RESULT_INVALID', '审计续页结果缺失',
             { scanned: logs.length, truncated: true, completeScan: false });
         }
-        truncated = !!probe.data.length;
+        truncated = resumable ? !!(probe.data.length && probe.data[0]._id <= upperId) :
+          !!probe.data.length;
         break;
       }
     }
@@ -765,17 +826,40 @@ async function reconcileBatches(options) {
       { scanned: logs.length, nextCursor: cursor || null, truncated: true, completeScan: false });
   }
   const groups = new Map();
-  let invalidLogs = 0;
+  let invalidLogs = previous ? previous.invalidLogs : 0;
+  const entries = previous ? previous.entries.slice() : [];
   for (const log of logs) {
     const info = batchLogInfo(log, eventType);
     if (!info) continue;
     if (info.invalid || info.at.getTime() > now.getTime()) { invalidLogs++; continue; }
+    if (resumable) {
+      const digest = crypto.createHash('sha256').update(eventType + '\0' + info.operation +
+        '\0' + info.batchId).digest('hex');
+      const projected = { phase: info.phase, operation: info.operation, batchId: digest };
+      const countKeys = ['selected', 'marked', 'markedAudited', 'auditFailedCount',
+        'skipped', 'conflicts', 'failed', 'unprocessed', 'recovered', 'deferred',
+        'purged', 'purgedAudited', 'deferredAudit', 'deferredRetry', 'needsMark'];
+      let invalidProjection = false;
+      for (const key of countKeys) {
+        if (Object.prototype.hasOwnProperty.call(info.stats, key)) {
+          if (!validCount(info.stats[key])) { invalidProjection = true; break; }
+          projected[key] = info.stats[key];
+        }
+      }
+      if (invalidProjection) { invalidLogs++; continue; }
+      info.batchId = digest;
+      info.stats = projected;
+    }
+    entries.push(info);
+  }
+  for (const info of entries) {
+    if (!(info.at instanceof Date)) info.at = new Date(info.at);
     const key = info.operation + '\0' + info.batchId;
     if (!groups.has(key)) groups.set(key, { operation: info.operation, batchId: info.batchId,
       prepare: [], complete: [] });
     groups.get(key)[info.phase].push(info);
   }
-  const completeScan = !truncated && !startCursor;
+  const completeScan = !truncated && (resumable || !startCursor);
   const counts = { closed: 0, pairedWindow: 0, suspectedOrphan: 0, running: 0, completeWithoutPrepare: 0,
     duplicate: 0, countMismatch: 0, invalidLogs: invalidLogs, unmatchedWindow: 0,
     outcomes: { OK: 0, PARTIAL: 0, FAILED: 0, DEFERRED: 0 } };
@@ -800,8 +884,9 @@ async function reconcileBatches(options) {
     const outcome = complete && (status === 'closed' || status === 'pairedWindow') ?
       batchOutcome(complete.completeCode) : null;
     if (outcome) counts.outcomes[outcome]++;
-    const batchRef = crypto.createHash('sha256').update(eventType + '\0' + group.operation +
-      '\0' + group.batchId).digest('hex').slice(0, 24);
+    const batchRef = resumable ? group.batchId.slice(0, 24) :
+      crypto.createHash('sha256').update(eventType + '\0' + group.operation +
+        '\0' + group.batchId).digest('hex').slice(0, 24);
     batches.push({ batchRef: batchRef, operation: group.operation, status: status,
       completeCode: complete ? complete.completeCode : null, outcome: outcome });
   }
@@ -813,8 +898,16 @@ async function reconcileBatches(options) {
     code: completeScan ? (hasAnomaly ? 'RECONCILE_ANOMALIES' :
       (hasDeferred ? 'RECONCILE_DEFERRED' : 'OK')) : 'SCAN_TRUNCATED',
     eventType: eventType,
-    scanned: logs.length, pages: pages, truncated: truncated, completeScan: completeScan,
+    scanned: logs.length + (previous ? previous.scanned : 0),
+    pages: pages + (previous ? previous.pages : 0), truncated: truncated, completeScan: completeScan,
     nextCursor: truncated ? cursor : null, thresholdMs: RECONCILE_GRACE_MS,
+    scanScope: resumable ? { upperId: upperId, capturedAt: now.toISOString(),
+      consistency: 'KEYSPACE_WATERMARK_NOT_ATOMIC' } : null,
+    nextContinuation: resumable && truncated ? sealScanState({ version: 1, eventType: eventType,
+      now: now.toISOString(), upperId: upperId, cursor: cursor,
+      scanned: logs.length + (previous ? previous.scanned : 0),
+      pages: pages + (previous ? previous.pages : 0), invalidLogs: invalidLogs,
+      entries: entries }) : null,
     counts: counts, batches: batches };
 }
 
@@ -826,7 +919,8 @@ exports.main = async function (event, context) {
     return fail('FORBIDDEN', '维护令牌无效或未配置');
   }
   if (event.action === 'reconcile') return reconcileBatches({ eventType: event.eventType,
-    pageSize: event.pageSize, maxRows: event.maxRows, cursor: event.cursor });
+    pageSize: event.pageSize, maxRows: event.maxRows, cursor: event.cursor,
+    resumable: event.resumable, continuation: event.continuation });
   if (event.action === 'recover') return recoverAudit(event.submissionId);
   if (event.action === 'recoverPending') return recoverPending();
   if (event.action === 'purge') return purgePayload({ requestId: context && context.request_id });
diff --git a/tools/test_retention_t34_resume.js b/tools/test_retention_t34_resume.js
new file mode 100644
index 0000000..7e14723
--- /dev/null
+++ b/tools/test_retention_t34_resume.js
@@ -0,0 +1,152 @@
+'use strict';
+
+const { createHarness } = require('./ugc_fake_cloud');
+const h = createHarness();
+const fn = h.loadFunction('cloudfunctions/retention/index.js');
+const T = fn.__test__;
+const now = new Date('2026-10-30T12:00:00.000Z');
+let passed = 0, failed = 0;
+
+function check(name, condition) {
+  console.log((condition ? 'PASS ' : 'FAIL ') + name);
+  if (condition) passed++; else failed++;
+}
+
+function setup(total) {
+  h.reset();
+  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
+  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
+  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
+  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
+  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-secret';
+  for (let i = 0; i < total; i++) {
+    const id = String(i).padStart(5, '0');
+    const row = { _id: id, event: 'retention_mark', action: 'retention_mark',
+      submissionId: 'synthetic-' + id, at: new Date(now.getTime() - 1000),
+      result: { code: 'OK' } };
+    if (i === 0 || i === total - 1) {
+      const phase = i === 0 ? 'prepare' : 'complete';
+      row.schemaVersion = 1;
+      row.submissionId = null;
+      row.day = '2026-10-30';
+      row.rev = 1;
+      row.actor = { role: 'system', openidHash: null };
+      row.result = { code: phase === 'prepare' ? 'PREPARE' : 'COMPLETE',
+        stats: { phase: phase, operation: 'mark', batchId: 'batch-one', selected: 1,
+          marked: phase === 'prepare' ? 0 : 1,
+          markedAudited: phase === 'prepare' ? 0 : 1, auditFailedCount: 0,
+          skipped: 0, conflicts: 0, failed: 0,
+          unprocessed: phase === 'prepare' ? 1 : 0 } };
+    }
+    h.seed('upload_logs', row);
+  }
+}
+
+async function scan(input) {
+  return T.reconcileBatches(Object.assign({ eventType: 'retention_mark', now: now,
+    resumable: true }, input || {}));
+}
+
+async function run() {
+  for (const total of [499, 500, 501, 1001]) {
+    setup(total);
+    if (total > 500) h.state.docs.upload_logs[0].result.stats.unexpectedPrivate = 'private-body';
+    let result = await scan();
+    let steps = 1;
+    let intermediateSafe = !result.completeScan && result.ok === false;
+    const firstToken = result.nextContinuation;
+    while (result.nextContinuation && steps < 10) {
+      result = await scan({ continuation: result.nextContinuation });
+      steps++;
+      if (result.nextContinuation) intermediateSafe = intermediateSafe &&
+        !result.completeScan && result.ok === false;
+    }
+    check(total + ' 条跨页汇总且最终闭合', result.ok === true && result.completeScan === true &&
+      result.scanned === total && result.batches.length === 1 &&
+      result.counts.closed === 1 && result.counts.outcomes.OK === 1 &&
+      result.scanScope && result.scanScope.upperId === String(total - 1).padStart(5, '0') &&
+      result.scanScope.consistency === 'KEYSPACE_WATERMARK_NOT_ATOMIC' &&
+      steps === Math.ceil(total / 500));
+    if (total > 500) {
+      check(total + ' 条未扫完时保持失败关闭', intermediateSafe && !!firstToken);
+      const tokenPayload = Buffer.from(firstToken.split('.')[0], 'base64url').toString('utf8');
+      check(total + ' 条续扫凭据不含原始批次或身份',
+        !/batch-one|synthetic-|offline-secret|private-body/.test(tokenPayload));
+      const repeated = await scan({ continuation: firstToken });
+      check(total + ' 条重复续扫幂等', repeated.scanned === Math.min(total, 1000) &&
+        repeated.pages > 0 && h.updateCalls() === 0);
+      const broken = firstToken.slice(0, -1) + (firstToken.endsWith('A') ? 'B' : 'A');
+      const before = h.calls('upload_logs').length;
+      const rejected = await scan({ continuation: broken });
+      check(total + ' 条损坏游标在读取前拒绝', rejected.code === 'INVALID_SCAN_CONTINUATION' &&
+        h.calls('upload_logs').length === before);
+    }
+  }
+  setup(501);
+  const first = await scan();
+  h.setFail({ collection: 'upload_logs', op: 'get', atCall: h.calls('upload_logs').filter(
+    function (x) { return x === 'get'; }).length + 1 });
+  const interrupted = await scan({ continuation: first.nextContinuation });
+  h.clearFail();
+  const resumed = await scan({ continuation: first.nextContinuation });
+  check('查询中断可从原凭据重试', interrupted.ok === false &&
+    interrupted.completeScan === false && resumed.ok === true && resumed.scanned === 501);
+  const restarted = h.loadFunction('cloudfunctions/retention/index.js');
+  const afterRestart = await restarted.__test__.reconcileBatches({
+    eventType: 'retention_mark', continuation: first.nextContinuation });
+  check('新函数实例使用同一凭据继续扫描', afterRestart.ok === true &&
+    afterRestart.scanned === 501 && afterRestart.counts.closed === 1);
+  const concurrent = await Promise.all([scan({ continuation: first.nextContinuation }),
+    restarted.__test__.reconcileBatches({ eventType: 'retention_mark',
+      continuation: first.nextContinuation })]);
+  check('两实例只读续扫得到相同结果', concurrent.every(function (x) {
+    return x.ok === true && x.scanned === 501 && x.counts.closed === 1;
+  }) && h.updateCalls() === 0);
+
+  setup(501);
+  const watermark = await scan();
+  h.seed('upload_logs', { _id: '00499a', schemaVersion: 1,
+    event: 'retention_mark', action: 'retention_mark', submissionId: null,
+    day: '2026-10-30', at: new Date(now.getTime() + 1000), rev: 1,
+    actor: { role: 'system', openidHash: null }, result: { code: 'PREPARE',
+      stats: { phase: 'prepare', operation: 'mark', batchId: 'late-batch', selected: 1 } } });
+  const late = await scan({ continuation: watermark.nextContinuation });
+  check('扫描中插入水位内未来日志阻断成功', late.ok === false &&
+    late.code === 'RECONCILE_ANOMALIES' && late.counts.invalidLogs === 1 &&
+    late.scanned === 502);
+
+  setup(501);
+  const frozen = await scan();
+  h.seed('upload_logs', { _id: 'zzzzz', event: 'retention_mark',
+    action: 'retention_mark', submissionId: 'later',
+    at: new Date(now.getTime() + 1000), result: { code: 'OK' } });
+  const snapshot = await scan({ continuation: frozen.nextContinuation });
+  check('高水位之外的新日志不进入本次诊断快照', snapshot.scanned === 501 &&
+    snapshot.ok === true && snapshot.completeScan === true);
+  const before = h.calls('upload_logs').length;
+  const denied = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
+    resumable: true, maintenanceToken: 'wrong' });
+  check('未授权调用不访问审计集合', denied.code === 'FORBIDDEN' &&
+    h.calls('upload_logs').length === before);
+  setup(501);
+  const liveAt = new Date(Date.now() - 1000);
+  h.state.docs.upload_logs.forEach(function (row) {
+    row.at = liveAt;
+    if (row.submissionId === null) row.day = liveAt.toISOString().slice(0, 10);
+  });
+  const authorizedFirst = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
+    resumable: true, maintenanceToken: 'offline-secret' });
+  const authorizedFinal = await fn.main({ action: 'reconcile', eventType: 'retention_mark',
+    continuation: authorizedFirst.nextContinuation, maintenanceToken: 'offline-secret' });
+  check('鉴权入口可跨次续扫', authorizedFirst.code === 'SCAN_TRUNCATED' &&
+    authorizedFinal.ok === true && authorizedFinal.scanned === 501);
+  check('续扫全程只读', h.updateCalls() === 0 && h.removeCalls() === 0);
+  setup(0);
+  const empty = await scan();
+  check('空日志窗口正常闭合且不伪造批次', empty.ok === true &&
+    empty.scanned === 0 && empty.counts.closed === 0 && empty.scanScope.upperId === null);
+  console.log('T3.4 resume: ' + passed + ' PASS, ' + failed + ' FAIL');
+  if (failed) process.exitCode = 1;
+}
+
+run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
diff --git a/docs/RETENTION_T34_SAFETY_BOUNDARIES_20261030.md b/docs/RETENTION_T34_SAFETY_BOUNDARIES_20261030.md
new file mode 100644
index 0000000..87b58ba
--- /dev/null
+++ b/docs/RETENTION_T34_SAFETY_BOUNDARIES_20261030.md
@@ -0,0 +1,27 @@
+# Retention T3.4 本地安全边界（2026-10-30）
+
+本文件记录本地实现的能力边界，不表示云端已部署或已验收。冻结设计稿的单次 50 条分页、500 条上限保持不变。
+
+## 调用与写入入口
+
+`main` 先验维护令牌，再分派 `mark` → `markExpired`、`recover` → `recoverAudit`、`recoverPending` → `recoverPending`、`purge` → `purgePayload`、`reconcile` → `reconcileBatches`。`markExpired` 和 `recoverPending` 写 `retention_mark` 批次日志；`recoverAudit` 补逐条日志；`purgePayload` 先调用 `recoverPurgePending` 和两种事件的 `reconcileBatches`，再选候选、写 prepare、条件清正文、调用 `recoverPurgeAudit`、写 complete。`recoverPurgePending`、`recoverPurgeAudit`、`deferAudit`、`deferPurge` 分别更新对应待补和重试元数据。`reconcileBatches` 只读取日志。其他人工删除入口属于 `review`，不由本流程执行。
+
+## T3.4-C 只读诊断续扫
+
+维护令牌保护的 `reconcile` 接受 `resumable: true` 开始诊断扫描。每次最多读取 500 条、每页最多 50 条，返回 `nextContinuation`；下一次传入该值继续。续扫凭据由维护令牌派生密钥签名，签名无效在读库前拒绝。凭据保存上次 `_id`、起始时看到的最大 `_id`、固定的 `now`、仅含哈希批次引用的分组投影和累计计数；不保存原始批次 ID、投稿 ID、正文或维护令牌。同一凭据重复使用只重复只读计算。所有页结束前 `completeScan=false`。凭据超过 2 MiB 时不能继续，结果仍保持不完整。
+
+`scanScope.consistency=KEYSPACE_WATERMARK_NOT_ATOMIC` 明示这是 `_id` 范围的诊断扫描。起始后写入且 `_id` 高于水位的日志不属于本次范围；如果数据库允许后写入更小 `_id`，也不能把该范围当成一致性快照。续扫返回的 `completeScan=true` 只表示该范围读完，不证明扫描结束时没有新日志。正文清理闸门不接受外部续扫凭据，仍用自身实时对账；超过单次上限时继续失败关闭。
+
+## T3.4-A：跨实例原子性仍 PENDING
+
+当前对账查询与 `submissions` 条件更新分开执行；状态及 `rev` 条件只保护单条投稿，不能保护全局 `upload_logs`。维护令牌限制调用者，不串行化两个函数实例。任何锁方案都必须让所有相关日志写入者和正文清理者共同遵守持久 fencing token，并明确原子获取、续租、过期、条件释放与旧实例失效。当前代码没有这些条件，不能把本地双实例模拟当成云端安全证明。
+
+CloudBase 官方事务文档说明事务仅服务端支持，事务内仅支持 `doc`，不支持 `where`，最多 100 次操作、30 秒；本函数实际依赖 `wx-server-sdk ~2.6.3`，尚未验证目标环境中相同语义、跨集合写入和查询与屏障的组合。参考：[官方事务文档](https://docs.cloudbase.net/database/transaction)。在得到可验证的事务或串行执行方案之前，TOCTOU 不关闭。
+
+## T3.4-B：历史失败批次仍 PENDING
+
+原始 prepare/complete 只保存 `batchId` 与汇总数；逐条事件只有 `submissionId` 和稳定事件 ID，没有原批次关联。仅凭汇总数不能证明某个历史 FAILED/PARTIAL 批次所缺的具体审计已补齐。原日志保持只追加，旧批次仍阻断。后续需要可审查的每批选中记录清单或等价的持久证据，再设计稳定修复事件 ID、原批次引用、修复类型/时间/操作者、逐条证据核对、幂等续修及修复后重新对账。证据无法重建的批次继续阻断；不提供 `force`、`ignore`、`skip-history` 参数。
+
+## 上线前验收
+
+需在身份已证实的隔离环境验证真实索引、`_id` 排序与游标、多实例与超时后旧实例、事务或分布式屏障、历史修复证据及完整扫描。任何未完成扫描、异常、FAILED/PARTIAL/DEFERRED 或待补审计均不得被当成正文清理许可。

```
