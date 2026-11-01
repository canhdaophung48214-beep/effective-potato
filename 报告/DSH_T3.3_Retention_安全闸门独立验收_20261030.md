# DSH｜T3.3 Retention 审计安全闸门 —— 独立验收（2026-10-30）

验收人：DSH（独立审查人）
被审对象：`报告/Codex_T3.3_Retention_审计安全闸门_20261030.md`
方式：只读（文件枚举、源码核对、现有套件复跑）。未改项目文件、未触云、未 Git 写。

## 0. 先说结论

**被审对象不存在，T3.3 未交付，无法进入内容审查。**

| 判定项 | 结论 |
|---|---|
| 本地安全闸门 | **FAIL（未实现）** |
| 正文保护 | **PENDING**（无闸门可测；现有路径本身不写正文进日志，见 §5） |
| 恢复机制 | **PASS**（现有 mark/purge/recover/reconcile/review 套件全绿，未被削弱） |
| 并发安全 | **PENDING**（闸门缺失，无从谈"对账后清理前"竞态防护） |
| 整体 T3.3 | **PENDING（未提交）** |

## 1. 缺失证据（可复现）

1. `报告/` 下不存在 `Codex_T3.3_Retention_审计安全闸门_20261030.md`；全目录 **没有任何文件提到 "T3.3"**（`Select-String -Pattern 'T3\.3'` 零命中）。目录内最新文件依次为 `Codex_T3.2_R1_R4_云端核验准备_20261030.md`（20,581 B / 11:26:49）、`DSH_T3.2_R1_R4_独立验收_20261030.md`（11:18）、`T3.2_Retention_R1_R4_云端核验准备_20261030.md`（11:14）。
2. 项目内 **10:50 之后只改过一个文件**：`tools/test_retention_reconcile.js`（14,955 B / 11:01:13，即 C17b 修复）。`cloudfunctions/retention/index.js` 仍是 **37,711 B / `51CC315F7258B9CF…` / 10-29 16:48:43**——与 T3.2 审查时逐字节相同，**没有任何闸门实现**。
3. `cloudfunctions/retention/index.js` 全文检索 `PARTIAL|FAILED|RECONCILE_ANOMALIES|outcome`：命中全部集中在 `reconcileBatches` 自身（`:235-253`、`:360-377`、`:435-448`、`:602-604`、`:707`、`:726-739`），**`purgePayload`/`markExpired` 没有一处读取对账结果**。

## 2. 逐项核对（按任务 9 问）

| # | 检查点 | 现状（源码实测） | 判定 |
|---|---|---|---|
| 1 | 是否真正阻断 PARTIAL/FAILED/RECONCILE_ANOMALIES | `purgePayload`（`:380-450`）只检查三件事：`retryAfter` 未来（`:410`）、`retention.audit.state==='pending'`（`:411`）、状态/rev/payload 合法（`:416`）。**不调用 `reconcileBatches`，不读 `outcomes`** | **FAIL** |
| 2 | 扫描截断/超时是否失败关闭 | 清理侧根本没有"扫描"概念；`reconcileBatches` 的 `completeScan=false→ok:false` 只影响对账返回值 | **FAIL** |
| 3 | 是否有绕过闸门的其他正文清理入口 | 全仓 `payload:null` 仅两处：`retention/index.js:428`（到期清理）与 `review/index.js:439`（用户删除，设计内）。前者无闸门；后者不经 Retention | **FAIL**（清理入口未受闸门约束） |
| 4 | 对账成功后、清理前状态变化 | 无闸门 → 无"对账快照"。即使后续加"先查再清"，`purgePayload` 的条件更新（`:426-431`）只校验 `_id/status/rev/payload`，**不校验对账结论对应的批次**，仍可能清掉"对账之后才出现的 PARTIAL 批次"覆盖的记录 | **PENDING**（设计未出现） |
| 5 | 被阻断时正文逐字节不变 | 无阻断路径可测。现有失败路径（查询失败 `:397`、prepare 日志失败 `:406`）确实不写正文，但这不等于"被闸门阻断" | **PENDING** |
| 6 | 日志是否泄漏正文 | `writePurgeLog`/`writeRunLog` 字段里无 `payload`；`note` 只放 `status/kind` 摘要。现有 18 项 purge 测试与 30 项 reconcile 测试均未出现正文外泄 | **PASS**（现有代码） |
| 7 | 恢复、重试、幂等是否保持 | 实跑：`test_retention_mark` RESULT OK、`test_retention_purge` 18/0、`test_retention_recover_pending` 13/0、`test_retention_reconcile` 30/0、`test_ugc_review` RESULT OK，exit 全 0 | **PASS** |
| 8 | 新测试能否在撤销闸门后失败 | 不存在新测试文件，也没有闸门可撤销 | **无法验证** |
| 9 | 是否只在 fake DB 成立 | 现有对账已存在两处 fake-DB 依赖需在闸门实现时一并考虑：①游标用 `_id` 升序 `gt`（`:684`）——真实 CloudBase 对 `_id` 排序/游标支持需实测；②`at > now` 拒绝未来日志（`:698`）——真实环境 `serverDate()` 与函数本地时钟存在偏移时，可能把正常日志判成"未来"。闸门若复用这两处，需重新验证 | **记录在案** |

## 3. T3.2 重交版本的补充

11:26:49 出现了新版 `报告/Codex_T3.2_R1_R4_云端核验准备_20261030.md`（20,581 B / `8F7B4CDE…`），比 11:14 版多出 §「额外风险：R-3 `closed` 包含失败批次（只分析）」，并写明"下游若只读取 `counts.closed` 会误报，必须同时看 `outcome`"。

这与我上一轮的 FAIL 项（第 7 项）方向一致，但**只是分析，不是闸门**；它也确认了"R-3 结果目前没有消费者"。T3.3 要解决的正是这一条。

## 4. 闸门交付后我会怎么验收（预登记，避免事后改口径）

1. **阻断语义**：构造 `PARTIAL`、`FAILED`、`RECONCILE_ANOMALIES`、以及 `completeScan=false` 四种前置，断言 `purgePayload` 返回 `ok:false` 且 `code` 明确（如 `AUDIT_GATE_BLOCKED`），`payload` 前后逐字节相等。
2. **失败关闭**：注入对账查询失败/超时/截断，断言清理不执行且返回 `ok:false`；不得以"查不到就当干净"通过。
3. **入口穷举**：全仓 grep `payload:null` 与 `payloadRedactedAt`，确认除 `review` 的删除外，所有清正文路径都过闸门；`main` 的 `action==='purge'` 必须走同一守卫。
4. **竞态**：对账完成 → 人为插入一条新的 PARTIAL 批次 → 执行清理，断言要么阻断、要么在条件更新里带上"对账快照标识"（batchId/水位），不能只靠 `rev`。
5. **正文与日志**：阻断路径下正文 hash 不变；所有日志字段无正文、无 openid、无 token。
6. **恢复不受损**：`test_retention_mark / purge / recover_pending / reconcile` 全绿且计数闭合；新增测试在撤销闸门后必须变红（隔离副本变异）。
7. **边界**：任何"只在 fake DB 成立"的假设（`_id` 游标、serverDate 偏移、`in` 多值排序）必须在报告里显式标注为 PENDING，不得写成云端已验证。

## 5. 判定与建议

- **整体 T3.3：PENDING（未提交）**。没有可审的实现或报告，任何 PASS 都会是伪造。
- **本地安全闸门：FAIL（当前代码）**——"审计未闭合仍会清正文"这一实质风险仍然存在，与我 T3.2 审查第 7 项一致。
- **正文保护：PENDING**；**恢复机制：PASS**（既有能力未被削弱）；**并发安全：PENDING**。
- 在闸门落地并通过上述 7 条验收前，**不建议把 T-2 清理部署到任何真实环境**；T3.2 的云端核验若先行，也应在"存在未闭合审计批次"场景下拒绝执行清理。

---
声明：本轮只读（文件枚举、源码阅读、现有套件复跑），未修改项目文件、未执行 Git 写、未调用或部署云函数、未读写云端数据、未生成正式产物。
