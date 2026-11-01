# Retention T3.6.5 本地设计与证据

日期：2026-10-31。仅本地模拟；不涉及云部署、云数据、索引写入或 Git 写操作。生产 purge 和 retryDeferredAttempt 都保留 PURGE_GLOBAL_FENCE_UNVERIFIED，跨文档全局屏障未验证。

## 真实 skipped 恢复

新测试从真实 expired、31 天、payload 存在、明确 rev=0 的候选调用实际 purgePayload。原逻辑仍将其归 skipped，并由 deferPurge 条件写入 rev=1；complete 明确追加 revBefore=0 / revAfter=1，不改 skipped 分类。prepare 的选中清单允许明确整数 0；缺失、null、负数、非整数均不是 0。resolveDeferredBatch 接受此清单并按原严格版本规则复核；新增批次随后清理正文。既有严格 drift 测试保持通过。

## 显式处置与可验证重试

维护令牌保护的新 disposeDeferredBatch 与旧严格 resolver 分开。原 prepare/complete 永不修改，原 outcome 始终为 DEFERRED。处置是签名 resolution 项的 reasonCode：

| 处置 | 必要证据 | 后续 |
| --- | --- | --- |
| RECORD_ABSENT | 指定文档 get 抛 SDK errCode=-1 且消息精确匹配 document does not exist / document not found；其他读取异常拒绝 | observedRev=null，记录确认不存在；不声称谁删除了记录 |
| ALREADY_CLEARED | 精确文档当前 payload=null，并记录 rev/status；待补清理审计与 held 锁先阻断 | 不再清理 |
| NO_LONGER_ELIGIBLE | 当前 status=pending、明确合法 rev | 仅解除原延期；后续回到终态仍可被普通候选查询选中 |
| REQUEUED_CURRENT_REV | 当前终态、超过 30 天、非空且存在 payload、合法最新 rev、无未补审计或 held 锁 | 追加稳定独立 retention_deferred_attempt 事件；resolution 引用其独立 batchId |
| BLOCKED_UNCERTAIN | 读错/缺清单/未知状态/写入无法核验等 | 不追加成功 resolution，不触碰正文 |

AUDIT_PENDING 必须验证原 retention_mark 逐条日志的稳定 ID、动作、日期、版本、系统身份和成功码。非延期、原已清的 manifest 项继续走旧严格清理审计校验。

attempt 的稳定 ID 绑定原 batchId 和投稿 ID；HMAC 覆盖原始/当前版本、状态、正文 HMAC 和时间。重复调用复用已核实的同一事件；内容冲突拒绝。reconcile 在确认 resolution 前重新读取并验证所有 attempt，包括续扫投影之前的验证；缺失或伪造凭证不会解除阻断。

retryDeferredAttempt 的生产入口始终关闭。仅 __test__ 可使用私有模拟标志，重新验证 resolution、attempt 和当前版本/状态/正文摘要，再调用实际 purgePayload。候选复读后再次检查 expected rev/status/proof，避免两次读取之间的漂移；后续沿用全量审计门禁、审计恢复、退避、行锁、fencing 与条件更新。重试仅选择指定投稿，并以独立稳定 batchId 写 prepare/complete；已开始的重试不重复执行，须按原批次恢复/修复。

## 备份与验证

外部备份：../备份/T365_impl_20261031_144505_614/SHA256_MANIFEST.json。包含原 index.js、schema.upload_logs.json、schema.submissions.json 的绝对路径、SHA256、字节数和逐字节哈希核验。未修改既有测试。

新增三脚本使用 tools/retention_t363_fixture.js 与真实云函数代码，不手造 rev=2 历史 prepare/complete。覆盖：真实 0→1、旧 resolver 恢复、新批次清理、重复幂等、原日志不变、非法版本、确切不存在、正文已清、pending 退出和重入、最新 rev 重排及实际执行、读取不确定、缺失历史清单、缺失/伪造 attempt、伪造 resolution、未确认写入、审计证据缺失、公开入口围栏、后续版本漂移及审计门禁。另已运行十个未改动的旧回归脚本，包括 PARTIAL/FAILED repair、LOCK_BUSY 恢复、fencing、分页续扫。

本地结论不能证明云 SDK 错误枚举、条件更新或全局一致性；未识别的 notfound 表达保守阻断，待云端验收。
