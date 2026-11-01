# Retention T3.6.2：DEFERRED 分类与批次定位

证据等级：本地源码及假数据库测试；CloudBase 实测仍为 PENDING。生产 `main purge` 继续返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。

## 分类与写入边界

| 来源 | 本批正文 | 业务元数据 | 审计日志 | 本地分类 |
|---|---|---|---|---|
| 未选入候选的超期 pending（needsMark） | 不清 | 不改 | 批次 prepare/complete | 独立计数；不使已审候选批次 DEFERRED。pending 仍须走 T-1。 |
| 全部候选仅 LOCK_BUSY | 不清 | 不改 | `DEFERRED_NOT_STARTED` | 沿用 T3.6.1。 |
| 候选已有未来 retryAfter | 不清该项 | 不改该项 | `DEFERRED_RETRYABLE`，逐项 `RETRY_AFTER` | 到期后复核、追加修复、重新对账。 |
| 获取锁 CAS 明确零更新，复读 rev/status/正文 HMAC 不变 | 不清该项 | 不改该项 | `DEFERRED_RETRYABLE`，逐项 `CAS_UNMATCHED` | 批次级 retryAfter 后复核。假库的零更新不再暗中应用数据。 |
| audit.pending | 不清该项 | deferPurge 可递增 rev | `DEFERRED` | 阻断；先恢复逐条审计。批次级正向恢复尚未闭环。 |
| skipped 异常版本/状态 | 不清该项 | deferPurge 可能更新或失败 | `DEFERRED/PARTIAL` | 不能证明安全延期时阻断。当前正常查询不产生可证明零写入 skipped。 |
| 获取锁后冲突、日志失败、数据库回执不确定 | 可能已变 | 可能已变 | `DEFERRED/PARTIAL/FAILED` | 保持阻断，不借用可重试分类。 |

纯 `LOCK_BUSY` 的旧规则不变。`DEFERRED_RETRYABLE` 可以与同批已成功审计的清理共存，但全部未清项必须有完整清单、原因码和可执行的 UTC retryAfter，失败/待审计计数必须为零。它**在修复事件前仍阻断全局审计闸门**，不因名称“可重试”立即放行。修复动作检查原 prepare/complete 的稳定 ID 和 HMAC 清单，逐记录确认 rev/status/payload、audit.pending 与 held 锁；未清记录 rev 漂移或证据不符即拒绝。修复事件只追加，原始 `DEFERRED_RETRYABLE` 继续可见，对账输出分别保留 outcome 与 repairStatus。重复修复按稳定事件 ID 幂等。

## 运维发现

`discoverPurgeBatches` 使用现有维护令牌，在业务查询前鉴权；按 `event=retention_purge`、`_id` 升序和最多 100 条有界分页扫描 complete 日志。输入对账 `batchRef`，返回匹配批次的 batchId、operation、outcome、reasonCode、createdAt、unresolvedCount、repairable、blockedReason、nextCursor。`repairable` 仅表示有不可变准备清单，实际修复还要复核每条投稿；不能把它当成功证明。返回不含正文、投稿 ID 或维护令牌。当前接口是逐页发现，未完成全部页面时不能宣称全局没有匹配批次；真实索引与分页语义未验。

## T3.5 扫描队列测试去向

搜索当前仓库、可见 Git 历史、`备份/`、`报告/` 与文档，未找到 `tools/test_retention_scan_queue.js` 的原文件或 24 条断言清单。DSH 报告只保留“24 项”数量与扫描/截断/空扫描类别，不能据此捏造逐项名称。新建 `test_retention_t362_scan_queue.js` 复核空扫描、501 条截断续扫、扫描中插入、损坏游标；已有 `test_retention_t36_resume.js` 的 15 项和 `test_retention_t34_resume.js` 的 21 项仍运行。原 24 条逐项等价性 PENDING。

## 上线限制

旧日志无选中清单、audit.pending 引起的旧 DEFERRED、混合 LOCK_BUSY 以及无法确认零写入的 skipped 仍可能阻断，需要另一轮证据设计与独立验收。修复 HMAC 依赖维护令牌派生密钥；轮换策略尚未实现。单文档 rev/fencing 和本地假库无法证明全局审计与正文清理的跨文档原子性，因此生产 purge 保持关闭。本轮不触云、不部署、不建索引。
