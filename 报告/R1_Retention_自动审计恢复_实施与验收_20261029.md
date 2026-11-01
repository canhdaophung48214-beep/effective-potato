# R1 Retention 自动审计恢复：本地实施与验收（2026-10-29）

**本地自动发现与批量恢复：PASS；真实云端行为：PENDING。**本轮没有部署、触云、创建索引或触发器，也没有实施 T-2 清理。DSH 应以本报告附带的精确 diff 和当前文件重新独立复核。

## 1. 预检与基线

- 项目 `HEAD=274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，分支 `main`，暂存区为空；开工时 `git status --porcelain=v1 --untracked-files=all` 为 317 项：已修改跟踪文件 15 项，未跟踪文件 302 项。`.baton/task.md` 与 `.baton/handoff/current.md` 均不存在。目标报告在本轮前不存在。
- 实查 `cloudfunctions/retention/index.js:116-169,171-310`、`tools/test_retention_mark.js:330-461`、`tools/ugc_fake_cloud.js:79-133,203-255`、`config/cloud/schema.submissions.json:61-78,102-130`、`docs/UGC_MVP_DESIGN_FINAL_20261026.md:263-277,456`，以及 `报告/DSH_独立复核_Retention_审计可靠性_20261029.md`。现有 `recoverAudit(submissionId)` 用确定性 `recordEventId(id,markedRev)`、条件更新 `_id/status/rev/eventId/state` 与维护令牌保护的 `main`；原先没有自动扫描入口。测试 fake DB 为同一进程共享的可控替身，不能证明真实数据库事务和隔离级别。
- 本轮不使用旧测试输出：完成后重新运行全部列明命令。已有目标文件均有未提交状态，按当前字节备份后在其上增量修改，没有用旧版本覆盖。

## 2. 自动发现、分页与故障恢复

- 新增受原有维护令牌保护的 `recoverPending` 动作与内部函数。按真实代码使用的 `collection.where({...}).orderBy(...).limit(...).get()` 形态查询 `retention.audit.state='pending'`，按 `retention.audit.retryAfter ASC, createdAt ASC, _id ASC` 选取最多策略 `batchLimit` 条。当前 T-1 新建待补标记时附 `retryAfter=1970-01-01`；旧标记没有该字段时在本地排序中先处理。
- **消退式分页**：成功项状态变成 `complete`，退出下一次查询；失败项用带 `_id/status/rev/eventId/state` 条件的更新将 `retryAfter` 延后一分钟，排在其余待处理记录之后；到期后再次可选。每次调用只处理有界批次，不使用易因队列变化跳页的偏移量。即使延后排程更新失败，原 pending 标记仍留存；下次调用可以再次发现，但持续数据库故障下可能阻挡后续项，见风险。
- 逐条补记复用既有确定性日志 `_id` 和 `recoverAudit`。同一逻辑事件重复追加发生冲突时按 ID 读回并核对内容；恢复成功后才把待补标记改为 `complete`。`recoverPending` 本身不清正文、不修改 `verifyStatus` 或审核状态。
- 批次互斥计数：`selected = recovered + deferred + conflicts + failed`。`recovered` 表示本轮确认补齐并完成标记，`deferred` 表示选中但尚未到可重试时间，`conflicts` 表示另一实例已完成或条件状态变化，`failed` 表示本轮未完成且仍留待重试。`hasMore` 只是本批达到上限的提示，不是“当前仍有可执行项”的证明；调用方不得据此无限循环。
- 反事实检查：从本轮修改前独立备份加载旧 Retention，`recoverPending` 导出为 `undefined`、同名入口返回 `INVALID_ACTION`（命令退出 0）；本轮 R10 断言授权入口返回 `OK` 且空队列正常完成，因此旧代码无法通过新增专项测试。

## 3. 索引与证据层级

本地 schema 新增建议索引 `ix_retention_audit_queue(retention.audit.state, retention.audit.retryAfter, createdAt, _id)`，字段顺序与查询筛选和排序一致。`tools/ugc_fake_cloud.js` 只模拟嵌套字段查询、排序和 `_id` 唯一冲突，**不模拟索引或性能**。本轮未创建或读取真实云端索引，真实查询计划、缺失 `retryAfter` 字段的排序行为、条件更新原子性、日志自定义 `_id` 唯一性和服务端读取权限均为 PENDING。若实测数据库不支持上述查询或原子语义，不能启用自动触发。

## 4. 备份、文件与回滚

修改前新建独立目录 `项目/tools/_backup/r1-retention-20261029-20261029T0637432733201Z/`，逐项校验 SHA-256 与逐字节相等；没有覆盖旧备份。下表路径均相对于项目目录，哈希为修改前→修改后。

| 文件 | 备份大小（字节） | SHA-256 修改前 → 修改后 | 影响 |
|---|---:|---|---|
| `cloudfunctions/retention/index.js` | 12,426 | `A106FD1DF544AFD804B9800638E1BDCDDD924C9B02C5B285267B90D0D3E4C5AA` → `AEEC9C46A7B8E2BC82665F6F99FF4991ACB4B85FC1039ABCDB02F1886EA6B5E9` | 新增自动恢复、失败退避和维护入口；备份名 `cloudfunctions__retention__index.js`。 |
| `tools/ugc_fake_cloud.js` | 9,515 | `DED35A3BE810EC11274741A3FCED3059E083EE39B44A50757CCD1E3DF10D5D75` → `C2C1200D6A40DF4F4979F01B03821161ADC05A1FC588EAAE92173086B5C5B2CB` | 缺失排序键按旧记录优先处理；备份名 `tools__ugc_fake_cloud.js`。 |
| `config/cloud/schema.submissions.json` | 6,687 | `F74151CA424EB7BD0E15979CE43DC5D6C01FC5B43A5D30E09DE7ACDBC63EBC03` → `A26F7B78A68787EF2160A542814540D36271D6C9B46E9D04C6CC6F815B8F0425` | 待补重试时间与复合索引的本地草案；备份名 `config__cloud__schema.submissions.json`。 |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 52,104 | `B56A92B0A3705F7C8879A7716B33169D80F58E80612873F6E4FE764DF98DAC71` → `F0490DE228E464C697555C62294B26536E765116BA0E57557FF114CF80D724D2` | 更新恢复契约；备份名 `docs__UGC_MVP_DESIGN_FINAL_20261026.md`。 |
| `tools/test_retention_mark.js` | 22,398 | `8A3498D7E75A5C792A23273B4A0F76256A03E6E5C60FD55A3E6C98D5A995E733` → 同哈希 | 预检时备份，未修改旧套件；备份名 `tools__test_retention_mark.js`。 |
| `tools/test_retention_recover_pending.js` | 本轮新建 | 无修改前文件 → `F44BDA77C359A5243CFCD2DA559EB5D01BEDD820725580BFA0E3DE147E871FE8` | 13 项隔离 fake DB 专项测试；此前路径不存在。 |

本轮仅本地文件可按后附 diff 和备份回退；不得覆盖别人后续修改。云端无副作用可回滚。备份保留原样，不使用 Git 写操作。

## 5. 本轮实测

| 命令（`项目/`） | 实际结果 | 退出码 |
|---|---|---:|
| `node tools/test_retention_mark.js` | PASS 71 / FAIL 0 | 0 |
| `node tools/test_retention_recover_pending.js` | PASS 13 / FAIL 0；含跨批、退避、旧标记、独立实例和授权测试 | 0 |
| `node tools/test_ugc_review.js` | PASS 86 / FAIL 0 | 0 |
| `node tools/test_ugc_submit.js` | PASS 110 / FAIL 0 | 0 |
| `node tools/test_ugc_client_contract.js` | PASS 90 / FAIL 0 | 0 |
| `node tools/check_eol.js` | 61 文件、违规记录 0 | 0 |
| `node tools/test_check_doc_refs.js` | 通过 51、失败 0 | 0 |
| `git diff --check` | 无差异错误；仅既有 `project.config.json` CRLF 转换提示 | 0 |

R7 的“两实例”是分别加载 Retention 模块、共享同一 fake DB，在一个 Node 进程中通过 `Promise.all` 交错；R6 的“重启”是重新加载模块实例后使用保留的 fake DB 状态，**不是两个进程或真实云端并发**。这两项真实行为列为 PENDING。没有删除旧断言、降低门槛或把失败转为 SKIP。

## 6. 最终状态与 DSH 审查清单

最终 HEAD/分支/暂存状态不变；`git status --porcelain=v1 --untracked-files=all` 为 323 项（原有 15 个已修改跟踪文件保持，未跟踪文件 302→308；增加 5 份本轮备份和 1 份新测试，报告在仓库外）。未触云、未部署、未建真实索引或触发器、未修改环境变量与权限、未生成正式产物、未处理投稿；T-2 正文清理未执行。

DSH 请重点复核：① CloudBase 对缺失嵌套排序键与四列索引的实际查询计划；②真实并发下条件更新和确定性日志 `_id` 的唯一性；③批次发生持久 DB 故障且退避写入失败时的饥饿风险；④维护令牌的实际调用边界；⑤ `hasMore` 不能用作无界循环信号。线上索引、权限、触发器和真实云端验收均不得从本地 PASS 推导为 PASS。本轮至此停止。

## 7. 修改前后精确 unified diff

以下逐对使用只读 `git diff --no-index` 从本轮备份与当前文件生成；新增测试以空文件为左侧。diff 命令因存在差异返回 1 属预期。

### cloudfunctions/retention/index.js

```diff
diff --git "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\cloudfunctions__retention__index.js" b/cloudfunctions/retention/index.js
index 15afbde..bfcadca 100644
--- "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\cloudfunctions__retention__index.js"
+++ b/cloudfunctions/retention/index.js
@@ -118,6 +118,21 @@ function recordEventId(id, nextRev) {
     .update(String(id) + '\0' + String(nextRev)).digest('hex');
 }
 
+const RECOVERY_RETRY_MS = 60 * 1000;
+
+async function deferAudit(row, now) {
+  const audit = row && row.retention && row.retention.audit;
+  if (!audit || audit.state !== 'pending') return false;
+  try {
+    const updated = await db.collection(COL.SUBMISSIONS)
+      .where({ _id: row._id, status: row.status, rev: row.rev,
+        'retention.audit.eventId': audit.eventId, 'retention.audit.state': 'pending' })
+      .update({ data: { retention: Object.assign({}, row.retention,
+        { audit: Object.assign({}, audit, { retryAfter: new Date(now.getTime() + RECOVERY_RETRY_MS) }) }) } });
+    return !!(updated && updated.stats && updated.stats.updated === 1);
+  } catch (err) { return false; }
+}
+
 async function recoverAudit(submissionId) {
   if (typeof submissionId !== 'string' || !submissionId.trim()) return fail('INVALID_SUBMISSION_ID', '缺少投稿 ID');
   let row;
@@ -168,6 +183,51 @@ async function recoverAudit(submissionId) {
   return { ok: true, code: 'OK', submissionId: row._id };
 }
 
+async function recoverPending(options) {
+  const config = readPolicy();
+  if (config.error) return config.error;
+  const now = options && options.now instanceof Date ? new Date(options.now.getTime()) : new Date();
+  if (Number.isNaN(now.getTime())) return fail('INVALID_NOW', '执行时间不合法');
+  const limit = config.policy.batchLimit;
+  let rows;
+  try {
+    const response = await db.collection(COL.SUBMISSIONS)
+      .where({ 'retention.audit.state': 'pending' })
+      .orderBy('retention.audit.retryAfter', 'asc')
+      .orderBy('createdAt', 'asc')
+      .orderBy('_id', 'asc')
+      .limit(limit).get();
+    rows = response && Array.isArray(response.data) ? response.data : [];
+  } catch (err) {
+    return fail('DATABASE_ERROR', '读取待补审计队列失败',
+      { selected: 0, recovered: 0, deferred: 0, conflicts: 0, failed: 0 });
+  }
+  const result = { selected: rows.length, recovered: 0, deferred: 0,
+    conflicts: 0, failed: 0, hasMore: rows.length === limit, nextEligibleAt: null };
+  for (const row of rows) {
+    const retryAfter = row && row.retention && row.retention.audit && row.retention.audit.retryAfter;
+    if (retryAfter && new Date(retryAfter).getTime() > now.getTime()) {
+      result.deferred++;
+      if (!result.nextEligibleAt || new Date(retryAfter) < new Date(result.nextEligibleAt)) {
+        result.nextEligibleAt = new Date(retryAfter).toISOString();
+      }
+      continue;
+    }
+    const outcome = await recoverAudit(row._id);
+    if (outcome.ok && outcome.code === 'OK') result.recovered++;
+    else if (outcome.ok || outcome.code === 'STATE_CONFLICT' || outcome.code === 'NO_PENDING_AUDIT') {
+      result.conflicts++;
+    } else {
+      result.failed++;
+      const deferred = await deferAudit(row, now);
+      if (!deferred) result.retrySchedulingFailed = true;
+    }
+  }
+  // Every selected row belongs to exactly one class. Completed and deferred rows
+  // leave the head of the next eligible batch; failed rows receive a retry delay.
+  return Object.assign({ ok: result.failed === 0, code: result.failed ? 'RECOVERY_PARTIAL' : 'OK' }, result);
+}
+
 async function markExpired(options) {
   const config = readPolicy();
   if (config.error) return config.error;
@@ -227,7 +287,7 @@ async function markExpired(options) {
               policyConfirmedBy: policy.confirmedBy,
               audit: { state: 'pending', markedRev: row.rev + 1,
                 eventId: recordEventId(row._id, row.rev + 1),
-                day: now.toISOString().slice(0, 10) }
+                day: now.toISOString().slice(0, 10), retryAfter: new Date(0) }
             },
             updatedAt: db.serverDate(),
             rev: row.rev + 1
@@ -291,13 +351,14 @@ async function markExpired(options) {
 }
 
 exports.main = async function (event, context) {
-  if (!event || (event.action !== 'mark' && event.action !== 'recover')) {
-    return fail('INVALID_ACTION', '仅支持维护令牌保护的 mark/recover 动作');
+  if (!event || ['mark', 'recover', 'recoverPending'].indexOf(event.action) === -1) {
+    return fail('INVALID_ACTION', '仅支持维护令牌保护的 mark/recover/recoverPending 动作');
   }
   if (!hasValidMaintenanceToken(event.maintenanceToken)) {
     return fail('FORBIDDEN', '维护令牌无效或未配置');
   }
   if (event.action === 'recover') return recoverAudit(event.submissionId);
+  if (event.action === 'recoverPending') return recoverPending();
   return markExpired({ requestId: context && context.request_id });
 };
 
@@ -305,5 +366,6 @@ exports.__test__ = {
   makeCutoff: makeCutoff,
   readPolicy: readPolicy,
   markExpired: markExpired,
-  recoverAudit: recoverAudit
+  recoverAudit: recoverAudit,
+  recoverPending: recoverPending
 };
```

### tools/ugc_fake_cloud.js

```diff
diff --git "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\tools__ugc_fake_cloud.js" b/tools/ugc_fake_cloud.js
index 666c0a5..7746cb0 100644
--- "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\tools__ugc_fake_cloud.js"
+++ b/tools/ugc_fake_cloud.js
@@ -111,6 +111,8 @@ function createHarness() {
               const bv = getPath(b, order.field);
               const at = av instanceof Date ? av.getTime() : av;
               const bt = bv instanceof Date ? bv.getTime() : bv;
+              if (at === undefined && bt !== undefined) return -1;
+              if (bt === undefined && at !== undefined) return 1;
               if (at !== bt) return (at > bt ? 1 : -1) * (order.dir === 'desc' ? -1 : 1);
             }
             return 0;
```

### config/cloud/schema.submissions.json

```diff
diff --git "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\config__cloud__schema.submissions.json" b/config/cloud/schema.submissions.json
index f98a03d..cf4fa9f 100644
--- "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\config__cloud__schema.submissions.json"
+++ b/config/cloud/schema.submissions.json
@@ -71,7 +71,8 @@
             "state": { "type": "string", "enum": ["pending", "complete"] },
             "markedRev": { "type": "integer", "note": "标记状态转换后的 rev；后续审核或删除改变 rev 时仍可补记原事件" },
             "eventId": { "type": "string", "note": "确定性的 retention_mark 逐条日志 ID" },
-            "day": { "type": "string", "note": "标记发生日期 YYYY-MM-DD" }
+            "day": { "type": "string", "note": "标记发生日期 YYYY-MM-DD" },
+            "retryAfter": { "type": "date", "note": "自动恢复队列下次可尝试时间；初始为纪元，失败后有限退避" }
           }
         }
       }
@@ -124,6 +125,12 @@
       "unique": false,
       "purpose": "T-1 到期标记先筛 pending，再按创建时间与 ID 稳定分批；仅本地建议，云端未建"
     },
+    {
+      "name": "ix_retention_audit_queue",
+      "keys": [{ "field": "retention.audit.state", "order": "asc" }, { "field": "retention.audit.retryAfter", "order": "asc" }, { "field": "createdAt", "order": "asc" }, { "field": "_id", "order": "asc" }],
+      "unique": false,
+      "purpose": "待补审计自动发现与有界队列推进；仅本地建议，云端未建且查询计划未验收"
+    },
     {
       "name": "ix_submitter_created",
       "keys": [{ "field": "submitter.openid", "order": "asc" }, { "field": "createdAt", "order": "desc" }],
```

### docs/UGC_MVP_DESIGN_FINAL_20261026.md

```diff
diff --git "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md" b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
index b67774f..a63018c 100644
--- "a/tools\\_backup\\r1-retention-20261029-20261029T0637432733201Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md"
+++ b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
@@ -274,7 +274,7 @@ pending ──approve──> approved（终态）
 
 - **本地与线上状态**：`config/ugc.js` 仍标 `pending_confirmation`，表示尚未部署和验收，不能再解释为业务期限未裁决。上线前须先完成隐私指引、清理实现与触发器验收并留截图。
 - **清理纪律**：T-1 只改状态、不清正文；T-2 独立按严格 30 天边界清正文，若仍为 pending，先补标 expired；过期标记与正文清理各自留痕，不得用 `delete_request` 冒充系统保留事件。正文删除后保留符合八字段口径的最小摘要；用户主动删除请求见 §7.7。
-- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。自动发现所有待补投稿仍需云端查询／索引验收，不能仅凭本地测试称恢复全自动可靠。
+- **T-1 审计恢复（本地实现，云端待验收）**：`attempts` 与 `selected` 均为本批查询选中的记录数；既有 `marked` 继续表示状态已转换，包含逐条审计尚待确认的记录。互斥分类为 `markedAudited`、`auditFailedCount`、`skipped`、`conflicts`、`failed`、`unprocessed`，其和等于 `selected`，且 `marked=markedAudited+auditFailedCount`。状态转换同次写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter}`；确定性逐条日志 ID 供维护令牌保护的 `recover` 按投稿 ID 补记或核验，成功后将待补标记改为 `complete`。`recoverPending` 在相同鉴权下按 `retention.audit.state='pending'` 查询，并按 `retryAfter/createdAt/_id` 稳定排序、限批处理；成功项退出队列，失败项延后一分钟，重复触发可继续处理下一批而不依赖偏移量。每批 `selected=recovered+deferred+conflicts+failed`；真实复合索引、数据库原子性和进程中断行为未验收，不得把本地模拟称为云端可靠恢复。
 
 ---
 
@@ -453,7 +453,7 @@ pending ──approve──> approved（终态）
 
 - 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
 - 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
-- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
+- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌保护的 `mark/recover/recoverPending`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
 
 ### 7.2 输入校验（服务端独立复算）
 
```

### tools/test_retention_recover_pending.js

```diff
diff --git a/tools/test_retention_recover_pending.js b/tools/test_retention_recover_pending.js
new file mode 100644
index 0000000..b5aa9f2
--- /dev/null
+++ b/tools/test_retention_recover_pending.js
@@ -0,0 +1,135 @@
+'use strict';
+
+// Offline recovery queue tests. The fake database does not prove cloud atomicity.
+const crypto = require('crypto');
+const { createHarness } = require('./ugc_fake_cloud');
+const h = createHarness();
+const fn = h.loadFunction('cloudfunctions/retention/index.js');
+const T = fn.__test__;
+const now = new Date('2026-10-28T12:00:00Z');
+let pass = 0;
+let fail = 0;
+
+function check(name, condition) {
+  console.log((condition ? 'PASS ' : 'FAIL ') + name);
+  if (condition) pass++; else fail++;
+}
+function setup(limit) {
+  h.reset();
+  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
+  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
+  process.env.UGC_RETENTION_BATCH_LIMIT = String(limit);
+  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
+  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-token';
+}
+function seed(id, retryAfter) {
+  const eventId = 'retention_mark_' + crypto.createHash('sha256').update(id + '\0' + '2').digest('hex');
+  h.seed('submissions', {
+    _id: id, createdAt: new Date('2026-01-01T00:00:00Z'), status: 'expired', rev: 2,
+    payload: { note: 'must remain' }, verifyStatus: 'unverified',
+    retention: { markedAt: new Date('2026-02-01T00:00:00Z'), policyConfirmedBy: 'offline-test',
+      audit: { state: 'pending', markedRev: 2, eventId: eventId, day: '2026-02-01',
+        retryAfter: retryAfter === undefined ? new Date(0) : retryAfter } }
+  });
+}
+function doc(id) { return h.docs('submissions').find(function (row) { return row._id === id; }); }
+function logs(id) { return h.docs('upload_logs').filter(function (row) { return row.submissionId === id; }); }
+function conserved(result) {
+  return result.selected === result.recovered + result.deferred + result.conflicts + result.failed;
+}
+
+async function run() {
+  setup(2);
+  let r = await T.recoverPending({ now: now });
+  check('R1 空队列正常完成', r.ok && r.selected === 0 && conserved(r));
+
+  setup(1);
+  seed('a'); seed('b'); seed('c');
+  const pages = [];
+  for (let i = 0; i < 3; i++) pages.push(await T.recoverPending({ now: now }));
+  check('R2 有界批次跨三次调用持续推进', pages.every(function (x) {
+    return x.selected === 1 && x.recovered === 1 && conserved(x);
+  }) && ['a', 'b', 'c'].every(function (id) { return doc(id).retention.audit.state === 'complete'; }));
+  r = await T.recoverPending({ now: now });
+  check('R3 连续运行不重复写逐条事件', r.selected === 0 &&
+    ['a', 'b', 'c'].every(function (id) { return logs(id).length === 1; }));
+
+  setup(1);
+  seed('fail_first'); seed('later');
+  h.setFail({ collection: 'upload_logs', op: 'add', atCall: 1 });
+  const first = await T.recoverPending({ now: now });
+  h.clearFail();
+  const second = await T.recoverPending({ now: now });
+  const third = await T.recoverPending({ now: now });
+  const fourth = await T.recoverPending({ now: new Date(now.getTime() + 61000) });
+  check('R4 日志失败延后重试，后续记录不饥饿', first.failed === 1 &&
+    second.recovered === 1 && doc('later').retention.audit.state === 'complete' &&
+    third.deferred === 1 && fourth.recovered === 1 && conserved(first) &&
+    conserved(second) && conserved(third) && conserved(fourth) &&
+    logs('fail_first').length === 1 && logs('later').length === 1);
+
+  setup(1);
+  seed('rev_race');
+  h.setBeforeUpdate(function (rows) { rows[0].rev = 3; h.setBeforeUpdate(null); });
+  const conflict = await T.recoverPending({ now: now });
+  const retry = await T.recoverPending({ now: now });
+  check('R5 rev 冲突后重试不重复日志或覆盖新版本', conflict.conflicts === 1 &&
+    retry.recovered === 1 && doc('rev_race').rev === 3 && logs('rev_race').length === 1 &&
+    conserved(conflict) && conserved(retry));
+
+  setup(1);
+  seed('interrupted');
+  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
+  const interrupted = await T.recoverPending({ now: now });
+  h.clearFail();
+  const restartedInstance = h.loadFunction('cloudfunctions/retention/index.js');
+  const resumed = await restartedInstance.__test__.recoverPending({ now: new Date(now.getTime() + 61000) });
+  check('R6 日志已写但状态确认中断后可续跑', interrupted.failed === 1 &&
+    resumed.recovered === 1 && doc('interrupted').retention.audit.state === 'complete' &&
+    logs('interrupted').length === 1 && conserved(interrupted) && conserved(resumed));
+
+  setup(1);
+  seed('two_instances');
+  const other = h.loadFunction('cloudfunctions/retention/index.js');
+  const both = await Promise.all([T.recoverPending({ now: now }), other.__test__.recoverPending({ now: now })]);
+  check('R7 两个函数实例共享假 DB 时单条日志', both.every(conserved) &&
+    both[0].recovered + both[1].recovered === 1 && logs('two_instances').length === 1 &&
+    doc('two_instances').retention.audit.state === 'complete');
+  check('R8 恢复不清正文或更改准入状态',
+    doc('two_instances').payload.note === 'must remain' && doc('two_instances').verifyStatus === 'unverified');
+
+  setup(1);
+  seed('schedule_failure');
+  h.setFail({ collection: 'submissions', op: 'update' });
+  const schedulingFailed = await T.recoverPending({ now: now });
+  const pendingSurvived = doc('schedule_failure').retention.audit.state === 'pending';
+  h.clearFail();
+  const retried = await h.loadFunction('cloudfunctions/retention/index.js').__test__.recoverPending({ now: now });
+  check('R8b 延后排程写入也失败时，原待补标记仍可在下次发现',
+    schedulingFailed.failed === 1 && schedulingFailed.retrySchedulingFailed === true && pendingSurvived &&
+    doc('schedule_failure').retention.audit.state === 'complete' && retried.recovered === 1 &&
+    logs('schedule_failure').length === 1 && conserved(schedulingFailed) && conserved(retried));
+
+  setup(1);
+  seed('legacy_without_retry_after');
+  delete h.state.docs.submissions[0].retention.audit.retryAfter;
+  const legacy = await T.recoverPending({ now: now });
+  check('R11 旧待补标记缺 retryAfter 仍能自动发现', legacy.recovered === 1 &&
+    conserved(legacy) && logs('legacy_without_retry_after').length === 1);
+
+  const schema = require('../config/cloud/schema.submissions.json');
+  const index = schema.indexes.find(function (item) { return item.name === 'ix_retention_audit_queue'; });
+  check('R12 本地索引草案覆盖状态筛选与稳定排序', !!index &&
+    index.keys.map(function (item) { return item.field; }).join(',') ===
+      'retention.audit.state,retention.audit.retryAfter,createdAt,_id' &&
+    schema._meta.status === 'pending_admin_console_verification');
+
+  r = await fn.main({ action: 'recoverPending' }, {});
+  check('R9 未授权自动恢复被拒绝', r.code === 'FORBIDDEN');
+  r = await fn.main({ action: 'recoverPending', maintenanceToken: 'offline-token' }, {});
+  check('R10 授权入口可调用且空队列正常返回', r.code === 'OK' && r.selected === 0);
+
+  console.log('PASS ' + pass + ' / FAIL ' + fail);
+  if (fail) process.exitCode = 1;
+}
+run().catch(function (err) { console.error(err.stack || err); process.exitCode = 1; });
```
