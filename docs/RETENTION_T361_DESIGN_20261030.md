# Retention T3.6.1：活性、追加式批次修复与行锁恢复

状态：**本地实现与离线模拟已验证；真实 CloudBase、全局审计原子屏障及生产 purge 仍未验证。** `main({action:'purge'})` 继续在读库前返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。本文件是本地实现说明，不能用作上线许可。

## 1. 调用与状态

本地模拟 `purgePayload`：待补逐条清理审计恢复 → 标记和清理事件对账 → 到期候选查询 → 追加 prepare → 逐条获取同文档行锁 → 条件清正文和写 `retention.purge.pending` → 逐条审计恢复 → 条件释放锁 → 追加 complete。生产入口仍关闭。`reconcileBatches` 只读扫描 `upload_logs`，按 `event+operation+batchId` 配对。`repairPurgeBatch` 是维护令牌保护的追加式修复动作，不清正文、不修改旧日志；`recoverExpiredPurgeLease` 是内部锁恢复函数。

## 2. `DEFERRED_NOT_STARTED` 的严格边界

只有全部选中记录都在**取得行锁之前**返回 `LOCK_BUSY`，且该批次 `purged/deferredAudit/skipped/conflicts/failed/unprocessed` 均为零、`deferredRetry=selected>0`、没有退避更新失败、前置待补审计恢复未选中记录时，complete 才写 `DEFERRED_NOT_STARTED`。它的 stats 带 `notStartedReason=LOCK_BUSY` 和 `zeroBusinessWrites=true`。正文、投稿 rev、已有 `retryAfter` 均保持原样；批次 prepare/complete 仍追加保存。

对账器重新检查这些计数与字段，只把合格的未开始批次视为**可重试的历史记录**，并在 `outcomes.DEFERRED_NOT_STARTED` 中单独计数。它不成为 `OK`，也不算业务成功。若锁已获取、任何正文或审计状态可能已写入、出现版本冲突、日志失败、回执不确定，保持 `DEFERRED/PARTIAL/FAILED` 阻断。一个批次先清了记录 A，再遇 B 的 `LOCK_BUSY`，仍为阻断性的 `DEFERRED`。审计闸门独立复核每个批次结果。

## 3. 可证明批次的修复证据

新产生的 purge prepare 使用由 batchId 导出的稳定日志 `_id`，并记录选中投稿的最小证据清单：`id/rev/status/payloadProof`；`payloadProof` 是用维护令牌派生密钥计算的正文 HMAC，日志不含正文。清单及摘要被原始 prepare 固定；complete 也用稳定 `_id`。这使新批次可在回执丢失后定位原始日志。历史旧日志没有这些字段或稳定 ID 时，返回 `REPAIR_EVIDENCE_MISSING/INVALID`，继续阻断，**不会自动补造旧证据**。

`repairPurgeBatch(batchId)` 先确认原 prepare/complete 唯一、同批次同日、计数闭合，且原结果确为 `PARTIAL` 或 `FAILED`。逐条读取清单中的投稿：已清正文者必须有已完成的 `retention.purge`、匹配的稳定逐条 OK 日志及已释放行锁；未清正文者必须与 prepare 时的 rev/status/正文 HMAC 完全一致，表示可以在后续新批次重试。仍为 `audit.pending`、锁未确认、版本/正文变化、记录丢失或日志不匹配时，禁止修复。这个检查允许“原失败批次已有可证明的审计结果或未处理项”，并不把原失败改写成成功。

核验通过后只追加一条稳定 `_id` 的 `REPAIR_CONFIRMED` 事件，关联原 batchId、原 prepare/complete ID、清单摘要、已审计数、未处理但未变化数、固定修复原因、系统操作者和服务器时间。重复调用按稳定 ID 复核；写入失败或网络回执不确定时先点读确认，不能确认则返回失败。追加后重新做完整有界对账；扫描截断、其他异常或超时仍不放行。对账输出保留原 `PARTIAL/FAILED` outcome，同时单独给出 `repairStatus=confirmed` 与 `counts.repaired`。重复修复不依赖投稿继续停留在修复当时的版本。

修复入口仅有维护令牌，日志操作者准确记为 `system`。当前共享维护令牌不能区分具体自然人；个人操作者归属仍需独立身份机制，不能把策略配置里的 `confirmedBy` 冒充本次执行者。批次清单含投稿 ID，虽无正文与用户身份，仍应按受限审计数据管理；真实云端的日志访问权限未验收。

## 4. 行锁释放与不确定回执

行锁与正文同在投稿文档，更新都含旧 `rev`；释放条件再含 owner、fencingToken、`held`。重复释放同一 owner/token 的已释放锁返回 `ALREADY_RELEASED`，不再递增 rev。若释放更新报错，`recoverPurgeLease` 重新点读：同 token 已释放才确认成功；仍 held 返回 `LOCK_RELEASE_UNCONFIRMED`；token 或 owner 变化返回 `LOCK_LOST`，旧实例不能释放新持有者的锁。

`recoverExpiredPurgeLease` 只在租约到期后按读到的 owner/token 条件释放；若新实例已接管，rev/fencing 条件使旧更新失败。正文已清而释放失败时，原批次保留 `PARTIAL`；待租约安全释放、逐条审计确认后，可走上述追加式批次修复。假数据库分别模拟更新前失败和**写入已成功但回执丢失**。它不能证明真实云端时钟、CAS 原子性或网络回执语义。

## 5. 分页与剩余边界

沿用 T3.6 的 scanId、`_id` 水位、HMAC 续扫凭据、起止 count 复核；续扫凭据只投影证据摘要与数量，不放入选中投稿 ID 或正文。不完整扫描不放行。修复后的复核最多续扫 20 个有界页面，超出即 `REPAIR_PENDING_RECONCILE`。生产 purge 不使用调用方提供的扫描凭据，入口继续失败关闭。真实云端索引、多字段排序、缺失字段行为、跨文档全局审计与正文写入之间的 TOCTOU 尚未证明；单文档行锁不能代替全局屏障。历史无证据批次仍需单独取证，无法取证者继续阻断。

证据等级：代码与新增测试为**本地已实现/离线已验证**；CloudBase 原子性、调度、索引、权限、真实两实例、网络超时和上线清理为 **PENDING**。本轮没有云端调用、部署、建索引或数据写入。
