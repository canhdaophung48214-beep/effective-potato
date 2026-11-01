# T3.6.3 Retention 延期批次证据型恢复

状态：本地实现与离线模拟；真实 CloudBase 行为、全局 TOCTOU 和生产清理入口仍待验收。生产 `main({action:'purge'})` 保持 `PURGE_GLOBAL_FENCE_UNVERIFIED`。

## 1. 原因与边界

`recoverPending` 只补逐条 `retention_mark` 审计。它不会改写原 `retention_purge` 批次的 `DEFERRED` complete，因而旧批次仍阻断对账。本轮追加 `DEFERRED_RESOLUTION`，原 prepare、complete 与逐条日志均保持只追加、不可改写。普通 `DEFERRED` 只有在提交清单、逐项延期原因和重新读取证据完整时才可解除阻断。历史日志缺少这些信息时保持阻断。

## 2. 事件与状态

`retention_purge` 的 `result.code=DEFERRED_RESOLUTION`、`stats.phase=resolution`。稳定 `_id` 由原 batchId 和 `deferred_resolution` 派生。事件包含原 batchId、batchRef、prepareId、completeId、originalOutcome=DEFERRED、manifestHash、deferredDigest、selected、unresolvedCount=0、createdAt，以及逐项的 submissionId、originalRev、observedRev、reasonCode、recoveryAction、evidenceRef。`seal` 是维护令牌派生密钥对这些字段的 HMAC。日志不含正文。`at` 使用服务器日期，`day` 使用 UTC 日期；操作者为 `system`，`openidHash=null`。

对账保留原 outcome=`DEFERRED`，派生 `UNRESOLVED_DEFERRED`、`RESOLVED_DEFERRED` 或 `BLOCKED_UNCERTAIN`。只有 prepare/complete 计数闭合、清单摘要与延期原因摘要一致、恢复事件字段及 HMAC 合法、批次引用一致、`unresolvedCount=0`、全量扫描完成，才计入 `resolvedDeferred`。成功闸门要求 `counts.resolvedDeferred === counts.outcomes.DEFERRED`，并保留原有 PARTIAL、FAILED、DEFERRED_RETRYABLE 修复判定。扫描截断、无效事件、孤儿日志和未知结果继续阻断。

## 3. 恢复流程

维护令牌鉴权先于查询。`resolveDeferredBatch(batchId)` 按稳定 ID 读取原 prepare/complete，验证清单、计数、原因和摘要，再逐条重读投稿。

- `AUDIT_PENDING`：要求 `retention.audit.state=complete`、原稳定 `retention_mark` 逐条日志存在且关联一致、正文 HMAC 未变、当前 rev 为原 rev+2（延期更新与补记完成各一次）。
- `SKIPPED_RECHECK`：要求状态与正文 HMAC 未变、当前 rev 为原 rev+1。此分支只接受原批次确有完整清单和延期原因的证据；当前数据库筛选条件下，真实 skipped 候选能否产生这种安全证据仍待验证。
- `LOCK_BUSY`：混合批次须确认原 fencingToken 的租约已释放，rev 与释放动作一致。纯 LOCK_BUSY 沿用 `DEFERRED_NOT_STARTED`，无需这条恢复路径。
- `RETRY_AFTER` 与 `CAS_UNMATCHED`：未到重试时间拒绝恢复；已有纯零写入批次沿用 `DEFERRED_RETRYABLE` 的既有修复流程。
- 已清正文的混合批次记录：核验稳定逐条清理日志、已释放锁、purgedRev 与最终 rev，不重复清理。

任一投稿缺失、rev 漂移、正文摘要变化、`audit.pending` 未清、锁未释放、日志回执不确定、原始计数不闭合或缺少清单，均拒绝自动恢复。成功追加事件后重新执行有界、可续扫的完整对账；对账不通过则报告待处理，不向清理闸门宣称成功。重复调用读取相同稳定 ID 并重新对账；追加回执丢失时按稳定 ID 复读确认。没有 force、ignore-history 或修改旧日志的入口。

## 4. 证据等级与限制

本地已实现：批次延期原因记录、追加式恢复事件、派生状态、维护令牌入口、完整对账闸门。本地已验证：三份 T3.6.3 测试及既有 T3.6–T3.6.2 回归；五组隔离副本变异均被对应断言检出。skipped 正向用例使用带完整 HMAC 清单的**合成历史批次**，证明恢复器的证据处理，未证明当前 CloudBase 查询会实际产生这种批次。T3.5 原 24 条断言的原文件与逐项清单未找到，不能声称逐项继承。

静态分析：完整扫描使用 `_id` 高水位和计数复核，页面内游标稳定；日志仅执行 add。真实云端未验证：复合索引、嵌套字段查询、缺失字段排序、条件更新原子性、日志追加回执、跨实例交错和令牌轮换后的旧凭证验证。全局日志对账与单条正文更新不在同一事务，生产入口继续失败关闭。旧历史批次没有 manifest 或 deferredReasons 时保持阻断，需要独立人工取证方案，不能伪造恢复证据。
