# Retention P0 本地闭环验收（2026-10-29）

## 结论与基线

**PASS（本地 P0 测试与当前 schema/契约一致性）；PENDING（T-2、复合索引实际创建、逐条审计失败自动恢复、真实云端行为）。**未宣称整个 Retention 完成。项目 HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，分支 `main`，暂存区为空。修改前 `git status --porcelain=v1 --untracked-files=all` 为 306 项：已修改跟踪文件 15 项、未跟踪文件 291 项。所有既有未提交内容均保留。

本轮重跑发现较早 DSH 报告中的 B2/B8 两红已被后续改动修正：当前 `tools/test_retention_mark.js:141,147` 断言“到期两条”和“空正文 pending 转 expired”，基线实跑 PASS 56／FAIL 0，退出码 0。因此没有把正确期望反向改回旧缺陷。四个新增场景 E1–E4 分别验证空正文单独到期、查询条件先含 pending 再限批、并发 rev 变化后的重跑、单条 DB 失败后续跑。E1 会检出旧 `payload===null` 跳过逻辑，E2 会检出旧无状态过滤的查询；E3/E4 检查冲突和故障后不会重复写逐条成功事件。新增后实跑 PASS 60／FAIL 0，退出码 0。该测试使用 fake cloud，不证明云端数据库原子性。

## 修改、备份与回滚

新独立备份目录：`项目/tools/_backup/retention-p0-close-20261029-20261029T0554421214165Z/`。每个文件均在修改前复制，SHA-256 相同并用逐字节比较确认；没有覆盖旧备份。下表 SHA-256 是**修改前备份**。

| 修改文件 | 备份文件名 | 备份大小（字节） | 备份 SHA-256 | 影响与回滚 |
|---|---|---:|---|---|
| `tools/test_retention_mark.js` | `test_retention_mark.js` | 12,897 | `5C353374C3D2D73C7EF70771D5DA62046EB026D627BD1F6156634EA615E38BF5` | 增 E1–E4；可按下文精确 diff 反向应用或用已校验备份恢复，需保留当前其他人的变更。 |
| `config/cloud/schema.submissions.json` | `config__cloud__schema.submissions.json` | 5,567 | `B5E5D8BC939ECC17AFB6636B6E0E879900D8B7852380B4B14418BE5F072E68D5` | 说明 retention 为读取／写入方，登记已裁决但未部署期限，补当前代码实际写入的 `retention.markedAt/policyConfirmedBy`。只改本地草案，未改云端 schema。 |
| `config/cloud/schema.upload_logs.json` | `config__cloud__schema.upload_logs.json` | 3,185 | `0DD50781D718C93329BEF320E8BBAE18085A71C32B0F571C265456E6DF5C36DD` | 登记 retention 写入者、`submissionId`、人工哈希格式与系统省略语义；移除重复 `action` 键。`retention_mark` 在本轮开始前已存在，未重复添加。 |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | `docs__UGC_MVP_DESIGN_FINAL_20261026.md` | 50,362 | `EF985AC02633129315E646058F82F9DE1A0EADF81B884B8F0367970DB8156B0E` | 修订旧三状态表、日志事件／身份语义，以及“仅两个云函数入口”的过时表述；保留既定期限与状态机。 |

上述回滚仅适用于本地文件；本轮没有产生云端状态或正式产物。修改前 `expired` 已见于 submissions schema 和 review `STATUS_VALUES`，`retention_mark` 已在 upload_logs event enum；submit/review 的 `hashOpenid` 均为 HMAC-SHA256 小写十六进制前 32 位，只有 retention 的系统日志省略 `openidHash`。未改 submit/review/retention 源码，因为当前事件消费者和写入方与这些约束一致；人工审核入口仍无 `expire` 动作。

## 实测与边界

| 命令（工作目录 `项目/`） | 实际输出摘要 | 退出码 |
|---|---|---:|
| `node tools/test_retention_mark.js`（改前） | PASS 56 / FAIL 0 | 0 |
| `node tools/test_retention_mark.js`（增四场景后、回归） | PASS 60 / FAIL 0 | 0 |
| `node tools/test_ugc_review.js` | PASS 86 / FAIL 0 | 0 |
| `node tools/test_ugc_submit.js` | PASS 110 / FAIL 0 | 0 |
| `node tools/check_eol.js` | docs 47/47 合规；tools Markdown 14/14 合规；违规 0 | 0 |
| `node tools/test_check_doc_refs.js` | 通过 51，失败 0 | 0 |
| `node tools/test_ugc_client_contract.js` | PASS 90 / FAIL 0 | 0 |
| `git diff --check` | 无差异错误；仅既有 `project.config.json` CRLF 将来转换提示 | 0 |

审计失败恢复语义未获确定：当前 record 日志写失败时业务状态可能已是 expired，批次以 `LOG_FAILED/PARTIAL` 如实报告，但没有自动补写缺失逐条事件。此次没有添加“补记即成功”的测试或实现。T-2 正文清理、线上索引、触发器、真实 `where().update` 原子性和权限仍为 PENDING。未触云、未部署、未修改环境变量／权限／索引、未生成正式产物、未处理投稿或修改 `verifyStatus`、ID 映射、审批文件；未执行任何 Git 写操作。

## 修改前后精确 unified diff

以下 diff 由 `git diff --no-index -- <修改前备份> <当前文件>` 生成；该命令因存在差异返回 1，属于预期。

### tools/test_retention_mark.js

```diff
diff --git "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\test_retention_mark.js" b/tools/test_retention_mark.js
index 74008b2..dd0a609 100644
--- "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\test_retention_mark.js"
+++ b/tools/test_retention_mark.js
@@ -265,6 +265,65 @@ async function main() {
   eq('D20 complete 审计失败如实返回 LOG_FAILED', r.code, 'LOG_FAILED');
   eq('D21 complete 审计失败保留成功计数', r.marked, 1);
 
+  console.log('== E. 缺陷回归与失败后续跑 ==');
+  prepare({ batchLimit: '1' });
+  seedSubmission({ _id: 'empty_only', payload: null, rev: 7 });
+  r = await T.markExpired({ now: now });
+  ok('E1 空正文单独到期仍标记且只记一次逐条事件', r.marked === 1 &&
+    docById('empty_only').status === 'expired' && docById('empty_only').rev === 8 &&
+    docById('empty_only').payload === null && h.docs('upload_logs').filter(function (log) {
+      return log.submissionId === 'empty_only' && log.result.code === 'OK';
+    }).length === 1);
+
+  prepare({ batchLimit: '1' });
+  seedSubmission({ _id: 'older_approved', status: 'approved', createdAt: new Date('2026-01-01T00:00:00Z') });
+  seedSubmission({ _id: 'eligible_pending', createdAt: new Date('2026-01-02T00:00:00Z') });
+  let selectedCondition;
+  const originalCollection = h.db.collection;
+  h.db.collection = function (name) {
+    const collection = originalCollection(name);
+    if (name !== 'submissions') return collection;
+    const originalWhere = collection.where;
+    collection.where = function (condition) {
+      if (condition && condition.createdAt) selectedCondition = condition;
+      return originalWhere(condition);
+    };
+    return collection;
+  };
+  try { r = await T.markExpired({ now: now }); }
+  finally { h.db.collection = originalCollection; }
+  ok('E2 查询先过滤 pending 再限批', !!selectedCondition &&
+    selectedCondition.status === 'pending' && selectedCondition.createdAt.__op === 'lt' &&
+    r.marked === 1 && docById('eligible_pending').status === 'expired');
+
+  prepare();
+  seedSubmission({ _id: 'changed_pending' });
+  h.setBeforeUpdate(function (rows) {
+    rows[0].rev = 2;
+    h.setBeforeUpdate(null);
+  });
+  const firstConflict = await T.markExpired({ now: now });
+  const secondAttempt = await T.markExpired({ now: now });
+  ok('E3 并发版本变化后重跑只标记一次', firstConflict.conflicts === 1 &&
+    firstConflict.marked === 0 && secondAttempt.marked === 1 &&
+    docById('changed_pending').rev === 3 &&
+    h.docs('upload_logs').filter(function (log) { return log.submissionId === 'changed_pending'; }).length === 1);
+
+  prepare();
+  seedSubmission({ _id: 'retry_failed_first', createdAt: new Date('2026-01-01T00:00:00Z') });
+  seedSubmission({ _id: 'retry_succeeded_second', createdAt: new Date('2026-01-02T00:00:00Z') });
+  h.setFail({ collection: 'submissions', op: 'update', atCall: 1 });
+  const partial = await T.markExpired({ now: now });
+  h.clearFail();
+  const recovered = await T.markExpired({ now: now });
+  ok('E4 单条更新失败后重跑只补未完成记录', partial.code === 'DATABASE_ERROR' &&
+    partial.marked === 1 && partial.failed === 1 && recovered.marked === 1 &&
+    docById('retry_failed_first').status === 'expired' &&
+    docById('retry_succeeded_second').rev === 2 &&
+    ['retry_failed_first', 'retry_succeeded_second'].every(function (id) {
+      return h.docs('upload_logs').filter(function (log) { return log.submissionId === id; }).length === 1;
+    }));
+
   console.log('');
   console.log('---- 汇总 ----');
   console.log('PASS ' + pass + ' / FAIL ' + failCount);
```

### config/cloud/schema.submissions.json

```diff
diff --git "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\config__cloud__schema.submissions.json" b/config/cloud/schema.submissions.json
index 3500810..b55a9ea 100644
--- "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\config__cloud__schema.submissions.json"
+++ b/config/cloud/schema.submissions.json
@@ -4,9 +4,9 @@
     "status": "pending_admin_console_verification",
     "rules": "本文件只是本地草稿；集合创建、索引与权限必须在微信云开发后台逐项配置并留存截图，才能标记为已生效",
     "collection": "submissions",
-    "readBy": "无（普通客户端不可直读；仅 review 云函数以服务端身份读取）",
-    "writtenBy": "仅 submit 云函数（创建）与 review 云函数（状态变更）；客户端不可直写",
-    "retention": "待负责人确认，默认不承诺 90 天；删除请求见 review.delete"
+    "readBy": "普通客户端不可直读；仅 review 与 retention 云函数以服务端身份读取（云端权限待验收）",
+    "writtenBy": "submit 云函数创建、review 云函数人工审核、retention 云函数系统过期标记；客户端不可直写",
+    "retention": "已裁决正文自 createdAt 起 30 天、审计明细 90 天、逐条摘要自生成起 180 天；仅 T-1 本地实现，清理与云端部署未完成"
   },
   "fields": {
     "_id": { "type": "string", "note": "系统生成" },
@@ -58,6 +58,14 @@
         "edits": { "type": "object|null" }
       }
     },
+    "retention": {
+      "type": "object|null",
+      "note": "仅系统保留期流程写入；T-1 标记不清 payload",
+      "properties": {
+        "markedAt": { "type": "date", "note": "T-1 系统标记时间" },
+        "policyConfirmedBy": { "type": "string", "note": "已确认策略的记录标识，不含令牌或正文" }
+      }
+    },
     "submitter": {
       "type": "object",
       "note": "仅存 openid；删除请求时置为 deleted",
```

### config/cloud/schema.upload_logs.json

```diff
diff --git "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\config__cloud__schema.upload_logs.json" b/config/cloud/schema.upload_logs.json
index a845924..eb442d4 100644
--- "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\config__cloud__schema.upload_logs.json"
+++ b/config/cloud/schema.upload_logs.json
@@ -4,22 +4,22 @@
     "status": "pending_admin_console_verification",
     "collection": "upload_logs",
     "readBy": "无（普通客户端不可读；仅服务端写与内部排查）",
-    "writtenBy": "仅 submit / review 云函数；只追加（add），任何一方都不得 update/delete",
-    "retention": "依法必须保留的记录应按法规与负责人确认的期限保存；用户删除请求只能抹除 payload，日志正文不随意删改"
+    "writtenBy": "submit / review / retention 云函数仅追加（add）；任何一方都不得 update/delete",
+    "retention": "已裁决审计明细 90 天、逐条八字段摘要自生成起 180 天；轮转与云端部署尚未完成"
   },
   "fields": {
     "_id": { "type": "string", "note": "系统生成" },
     "schemaVersion": { "type": "integer", "value": 1 },
     "event": { "type": "string", "enum": ["submit", "denied", "throttle", "security_call", "review_approve", "review_reject", "alarm", "delete_request", "retention_mark"] },
-    "action": { "type": "string", "note": "云函数实际动作：submit / denied / throttle / security_call / approve / reject / delete 等，便于排查" },
+    "action": { "type": "string", "note": "云函数实际动作；系统标记使用 retention_mark，人工审核使用各自已定义动作" },
+    "submissionId": { "type": "string|null", "note": "逐条事件关联投稿 ID；批次 prepare/complete 为 null" },
     "actor": {
       "type": "object",
       "properties": {
-        "openidHash": { "type": "string", "note": "人工操作者用 HMAC-SHA256(salt).slice(0,32)；系统操作者省略此字段，不写 null" },
+        "openidHash": { "type": "string", "pattern": "^[0-9a-f]{32}$", "note": "投稿人和管理员用 HMAC-SHA256(salt).slice(0,32)；系统操作者省略此字段，不写 null" },
         "role": { "type": "string", "enum": ["submitter", "admin", "system"] }
       }
     },
-    "action": { "type": "string", "note": "submit / session / list / detail / approve / reject / delete" },
     "target": {
       "type": "object",
       "properties": {
```

### docs/UGC_MVP_DESIGN_FINAL_20261026.md

```diff
diff --git "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md" b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
index 817daa5..40dec05 100644
--- "a/tools\\_backup\\retention-p0-close-20261029-20261029T0554421214165Z\\docs__UGC_MVP_DESIGN_FINAL_20261026.md"
+++ b/docs/UGC_MVP_DESIGN_FINAL_20261026.md
@@ -167,7 +167,7 @@
 | `payload` | object | 客户端 | `{ price?, nameSuggestion?, note? }`；**禁止其它键**；`note` ≤100 字；`nameSuggestion` ≤20 字 |
 | `photos` | array | 服务端 | 恒 `[]`；入参非空 → 400 `PHOTO_NOT_SUPPORTED` |
 | `security` | object | 服务端 | `{ state: pass\|review\|risk\|error\|pending, labels:[], provider:'msg_sec_check', version:2, checkedAt, rid, attempts }` |
-| `status` | enum | **仅服务端** | `pending` / `approved` / `rejected`；客户端传值一律忽略并记 `denied` |
+| `status` | enum | **仅服务端** | `pending` / `approved` / `rejected` / `expired`；`expired` 仅系统保留期流程写入，客户端传值一律忽略并记 `denied` |
 | `review` | object | **仅服务端** | `{ decision, byOpenidHash, at, reasonCode, reasonText, edits }`；`rejected` 必须 `reasonCode` |
 | `submitter` | object | 服务端 | `{ openid }`；仅管理端可读，任何对外响应都不返回 |
 | `dedupe` | object | 服务端 | `{ key, dupOf }`；`key = dishId\|norm(note)\|price` |
@@ -178,16 +178,18 @@
 | `reopenOf` | string? | 服务端 | 复议/重新提交时指向前一条 `_id`；**不改写旧记录** |
 | `createdAt` / `updatedAt` | date | 服务端 | `db.serverDate()`；客户端时间不采信 |
 | `rev` | number | 服务端 | 乐观锁；每次状态迁移 `+1`，审核写入须带 `expectedRev` |
+| `retention` | object? | 系统保留期流程 | T-1 标记时写 `markedAt` 与 `policyConfirmedBy`；不含正文、维护令牌或投稿人身份 |
 
 ### 3.2 `upload_logs`（审计表，只追加）
 
 | 字段 | 类型 | 说明 |
 |---|---|---|
 | `_id` | string | 自动 |
-| `action` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` |
+| `event` | enum | `submit` / `security_call` / `review_approve` / `review_reject` / `throttle` / `denied` / `delete_request` / `alarm` / `retention_mark` |
+| `action` | string | 云函数实际动作；系统到期标记为 `retention_mark`。系统逐条事件仅含已裁决的八个逻辑字段，批次 `prepare` / `complete` 另含运行统计 |
 | `submissionId` | string? | `throttle`/`denied`（未关联记录时）为空 |
-| `actor` | object | `{ openidHash, role: submitter\|admin\|system }`；**日志内不存明文 openid** |
-| `at` | date | `db.serverDate()` |
+| `actor` | object | 投稿人／管理员：`{ openidHash, role }`，其中哈希为 32 位小写十六进制 HMAC 摘要；系统：`{ role:'system' }`，省略 `openidHash`；**日志内不存明文 openid** |
+| `at` | date? | 人工及系统批次日志使用 `db.serverDate()`；系统逐条八字段投影不含此字段 |
 | `before` / `after` | object? | 仅状态迁移类：`{ status, rev }` |
 | `reasonCode` / `reasonText` | string? | `reasonText` 为管理员手写理由（≤100 字），不含用户原文 |
 | `requestId` | string | 云函数 `request_id`，用于串联同一次调用 |
@@ -450,7 +452,7 @@ pending ──approve──> approved（终态）
 
 - 两集合权限：**仅管理端可读写**（自定义规则或"仅管理端"档位）；客户端零直读、零直写。
 - 服务端读投稿只经云函数；不得把 `submissions` 加入 `utils/cloudRepo.js` 的白名单（`:43-47` 只允许 `restaurants`/`stalls`/`dishes`）。
-- 云函数只暴露两个动作入口：`submit`、`review`；`review` 的所有子动作（`session`/`list`/`detail`/`approve`/`reject`）都在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
+- 用户和管理员业务入口为 `submit`、`review`；本地另有未部署的 `retention` 系统维护入口，仅接受维护令牌和 `mark`。`review` 的所有子动作均在鉴权之后才可探测，非管理员连"有哪些 action"都探不到（沿用 `cloudfunctions/seed/index.js:972` 的思路）。
 
 ### 7.2 输入校验（服务端独立复算）
 
```
## 最终核对

- 两份 schema 均可 JSON 解析；对 `expired`、`expire`、`retention.markedAt/policyConfirmedBy`、`retention_mark`、哈希格式及单一 `action` 字段的 7 项离线检查：PASS 7／FAIL 0，退出码 0。
- 最后一次契约改动后重跑 `node tools/check_eol.js`（违规 0，退出码 0）、`node tools/test_check_doc_refs.js`（通过 51、失败 0，退出码 0）和 `git diff --check`（退出码 0）。
- 最终项目 Git HEAD／分支不变，暂存区为空；`git status --porcelain=v1 --untracked-files=all` 为 310 项：已修改跟踪文件仍 15 项，未跟踪文件 295 项。相较开工仅新增 4 个备份文件；本轮修改的 4 个目标文件原本即未跟踪。独立验收报告位于项目仓库外的 `报告/` 目录。
- 本地 Retention P0 与 schema/契约一致性判为 PASS；审计缺口自动补齐、T-2、复合索引及云端验收均维持 PENDING。停止实施，等待 DSH 独立审查。
