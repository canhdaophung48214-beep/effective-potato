# Retention T3.6：并发、版本与扫描设计（2026-10-30）

本文以本地代码为准，区分已实现、离线验证、静态分析和真实云端待验收。`cloudfunctions/retention/index.js` 尚未部署，本轮不创建云端资源。

## 1. 整体架构与安全边界

外部维护入口 `main` 先验证维护令牌。`mark/recover/recoverPending/reconcile` 保留现有功能；外部 `purge` 因全局审计屏障无法证明跨集合原子性，返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`，在任何业务查询和正文更新之前失败关闭。普通内部 `purgePayload` 调用也失败关闭；仅 `__test__.purgePayload` 通过模块私有 Symbol 开启离线模拟，用于验证原有正常清理路径与新增同文档行锁。该测试出口不是云端 `main` 动作，不能作为云端安全证明。没有新增 `force/ignore/skip-history` 参数。

当前写入图：`markExpired` 写投稿状态与 `retention.audit`，并通过 `writeRunLog` 追加批次日志；`recoverAudit/recoverPending/deferAudit` 追加或确认逐条日志、更新待补状态/退避；`purgePayload` 调用 `recoverPurgePending`、两类事件对账、查询候选、写 prepare、同文档行锁、条件清正文、`recoverPurgeAudit`、条件释放行锁、写 complete；`deferPurge` 更新重试时间；`reconcileBatches` 只读。`submit` 创建投稿；`review` 更新审核状态或按人工删除请求清正文，均在本轮修改范围之外。Retention 不覆盖 `review` 的人工删除路径。

## 2. 同文档行锁、租约和 fencingToken

锁持久化在 `submissions.retention.purge.lock`，与正文和 `rev` 位于同一投稿文档。它保存随机 32 位十六进制 `owner`、`held/released` 状态、`leaseExpiresAt` 和递增的 `fencingToken`。获取锁以读取时的 `_id/status/rev/payload≠null` 条件更新，同时 `rev+1`；租约未过期的另一 owner 被拒。过期接管以新的 `rev` 条件更新并将 fencingToken 加一。续租和释放要求 owner、fencingToken、state、旧 rev 同时匹配，成功也 `rev+1`。正文更新要求同一文档上的 owner、fencingToken、state 和旧 rev 同时匹配；新持有者接管后，旧实例的条件更新不能命中。

本地假数据库测试覆盖两个独立函数实例、活租约、过期接管、旧实例续租/释放失败、额外 rev 变化、条件清正文冲突、崩溃后逐条审计恢复。锁仅保护同一投稿文档；它**不是**全局日志扫描的分布式锁。旧实例在租约到期但尚未被新实例接管时仍可能按旧 token 尝试写，真实云端对服务器时间条件的语义未证实；因此外部 purge 继续失败关闭。进程崩溃后锁会保留，接管依赖后续任务与真实时钟；无云端调度验收，不宣称自动恢复完成。

## 3. rev 版本机制

投稿创建 `rev=1`。Retention 每次成功更新投稿文档都以读到的旧 rev 为条件并写 `rev+1`：T-1 标记、标记审计确认/退避、T-2 候选退避、行锁获取/续租/释放、正文清除、清理审计确认。逐条日志 `rev=1` 是日志 schema 版本语义，与投稿 rev 分开。返回成功的恢复/锁操作带新 rev；失配按冲突分类，不做无条件覆盖。`review` 现有人工审核和删除路径已用预期 rev 条件，但本轮未改其源码；其真实云端原子性仍待验收。schema 注释同步说明元数据变更也递增 rev。

批次结果分类：`PARTIAL/FAILED` 保留失败；冲突或退避的批次为 `DEFERRED`，不再把仅有冲突的批次记成正常 `COMPLETE`。逐条 `retention.audit.state=pending` 仍只跳过该条候选；全局异常不降格为单条跳过。审计日志保持只追加。

## 4. scanScope、水位和分页续扫

只读 `reconcile(resumable:true)` 每次最多扫描 500 条，每页最多 50 条，按 `(event,_id)` 升序与 `_id>cursor` 前进。首轮记录 `scanId`、`scanStartedAt`、`highWaterMark`（起始最大 `_id`）、事件总数 `initialCount`；续扫凭据由维护令牌派生密钥签名，保存同一水位、游标、已哈希批次投影和累计计数。输出 `scanScope` 包含范围、页数、扫描数、完成标志与 `KEYSPACE_WATERMARK_COUNT_CHECK_NOT_ATOMIC` 一致性标签。凭据校验失败在读库前返回错误。相同凭据重复读取不会写库或重复累计；中断后可使用原凭据重试。

所有页结束前 `completeScan=false`。末尾重查同一事件总数；若扫描期间插入更小或更大 `_id`，或日志消失，总数变化触发 `SCAN_CHANGED`、`completeScan=false`、无继续凭据，必须重启扫描。相同时间的日志仍以 `_id` 稳定排序。该计数复核依赖日志只追加和数据库读一致性；“先读基数、再扫、最后读基数”不是事务快照，插入与删除数量抵消、跨查询不一致、末尾复核后新增日志仍可能漏检。外部 purge 不接受该扫描结果，因此不会因它的 `completeScan=true` 清正文。超过 2 MiB 的续扫凭据不能继续，失败关闭；真实 CloudBase 请求大小和索引尚未验收。

## 5. 历史 FAILED/PARTIAL 修复状态

原始 prepare/complete 日志不可更新或删除。现有批次日志仅有 batchId 和汇总计数；逐条事件没有原批次关联，也没有不可变的原批次选中记录清单。即使逐条 `audit.pending` 通过稳定事件 ID 补记，也不能证明某个历史失败批次的全部缺失内容已补齐。因此**本轮不追加“修复完成”事件，不开放人工修复入口**；FAILED/PARTIAL/DEFERRED 与孤儿 prepare 继续阻断。

可上线的后续修复协议必须先具备不可变的批次选中记录证据，再为每条真正缺失的审计补记稳定事件 ID；随后追加关联原 batchId 的修复事件，包含修复类型、UTC 时间、系统/授权操作者、原因、证据摘要和稳定修复事件 ID。重复修复按 ID 幂等，写失败后保留待补依据；重新完整对账无其他异常才可解除阻断。历史证据无法重建时继续阻断并交人工调查，不能把口头确认或参数开关当成证据。此协议本轮**未实现**，状态 PENDING。

## 6. 状态机与失败恢复

`pending` 投稿在 T-1 条件更新中进入 `expired` 并建立 `retention.audit.pending`；稳定事件 ID 的逐条日志确认后变 `complete`。T-2 只对超过 30 天的 `approved/rejected/expired` 且正文非空、标记审计不 pending 的记录尝试清理。行锁获取后，以旧 rev 和 fencingToken 条件清正文，同次建立 `retention.purge.pending`；逐条日志确认后改 `complete`；失败时待补标记保留，恢复入口可重试。任何全局对账异常、扫描未完成、锁丢失或版本冲突不得写虚假成功日志。外部 purge 因全局屏障未证实保持失败关闭，故这些本地状态转换只在离线模拟中执行。

## 7. CloudBase 能力与残余风险

[CloudBase 官方事务文档](https://docs.cloudbase.net/database/transaction)描述服务端事务、快照隔离、写冲突；同时说明事务内仅支持 `doc`、不支持 `where`，最多 100 次操作、30 秒。项目实际依赖 `wx-server-sdk ~2.6.3`，没有本轮真实云端环境证据证明它能把全局 `upload_logs` 查询、锁文档及投稿文档纳入同一原子约束。仅靠在锁文档上读锁，再更新另一业务文档，仍有旧实例复活窗口。真实索引、`_id` 排序、点路径更新、条件更新、计数一致性、回执丢失、跨实例事务和调度均 PENDING。

生产解锁前须先获得可验证的跨文档事务/串行执行条件，让所有 Retention 日志写入者与清理者遵守同一持久 fencing；在隔离环境验证双实例、过期接管、旧实例继续写、进程崩溃、网络超时和新增异常日志交错；并完成历史失败批次证据化修复及大规模扫描索引验收。若这些条件无法满足，保持外部正文清理失败关闭。
