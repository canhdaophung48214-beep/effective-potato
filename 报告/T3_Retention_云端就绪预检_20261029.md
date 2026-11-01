# T3 Retention 云端就绪预检（只读）

日期：2026-10-29。结论：**本地 R1/T-2 通过的事实保持；云端就绪 PENDING。** 本轮未接触真实云端或业务数据，不能据此确认线上索引、权限、调度和并发行为。建议 DSH 只读复核本报告。

## 1. 基线和证据范围

- 指令中的 `DSH_R1_Retention_自动审计恢复独立验收_20261029.md` 实际文件名为 `报告/DSH_R1_Retention_自动恢复独立验收_20261029.md`；已读该报告、`报告/DSH_T2_Retention_正文到期清理_独立验收_20261029.md`、当前 Retention 源码、schema、契约、现有专项测试，以及 `submit/review` 写入路径。两报告均判本地 PASS、真实云端 PENDING；当前源码与其关键基线相符。
- 源码版本：`项目/cloudfunctions/retention/index.js` 548 行；本地建议索引在 `项目/config/cloud/schema.submissions.json:114-155`，`_meta.status=pending_admin_console_verification`（`:3-5`）。设计契约见 `项目/docs/UGC_MVP_DESIGN_FINAL_20261026.md:265-278,453-457`。
- 证据标记：【码】当前源码；【稿】本地 schema/契约；【官】腾讯云开发官方文档；【云待】必须在目标云环境只读或经另行授权的隔离验证确认。官方文档说明组合索引遵循最左前缀、等值条件置前、范围条件置后，排序方向需要匹配；这些是设计原则，不代表本项目查询计划已命中。[索引管理](https://docs.cloudbase.net/database/data-index)、[查询优化](https://docs.cloudbase.net/recipes/optimize-database-query-performance)。

## 2. 当前实际写入与保护口径

| 字段 | 写入/读取事实 | 预检结论 |
|---|---|---|
| `_id` | `submit/index.js:662-667` 用 `add` 返回投稿 ID；Retention `:119-122,:234-237` 按 ID 与版本生成稳定日志 ID，`:153-165,:269-280` 在写入不确定时按日志 `_id` 回读。 | 自定义日志 `_id` 唯一冲突与回读一致性【云待】。 |
| `createdAt/status/rev/payload` | `submit/index.js:646-657` 创建 pending、`createdAt=db.serverDate()`、`rev=1`；schema `:25-32,:49,:110-112` 定义；`review/index.js:283-296` 写 approved 和 rev，`:437-440` 删除请求路径可置 rejected、payload=null。 | 真实存量行的字段类型、缺失比例和时间口径【云待】，本轮不读业务数据。 |
| T-1 标记 | `retention/index.js:404-418` 按严格 `< now-29d` 查询 pending；`:450-468` 以 `_id+status+rev` 条件更新为 expired，并同时写 `retention.audit={state:'pending',markedRev,eventId,day,retryAfter:epoch}`，不清正文。 | 条件更新的原子性、`stats.updated` 实值、并发冲突【云待】。 |
| T-1 待补 | `:126-135` 失败后更新 `retryAfter=now+60s`；`:139-184` 用稳定事件 ID 写日志后才清 `audit.state`；schema `:78-87`。 | 存量旧记录可能缺 `retryAfter`；真假数据库排序不同，不能由 fake DB 推断。 |
| T-2 清理 | `:335-352` 严格 `< now-30d`、终态、`payload != null`；`:365-369` 见 T-1 审计 pending 则跳过；`:379-385` 用 `_id+status+rev+payload非空` 条件更新 `payload=null`、`payloadRedactedAt`、rev 与待补清理审计；schema `:65-74,:108`。 | `retention.audit.state` 保护是取数后的应用层判断，并未进入候选过滤。真实并发与查询计划【云待】。 |
| 日志时间 | `retention/index.js:90-99,:239-254` 批次/逐条写 `at=db.serverDate()`；`day=now.toISOString().slice(0,10)`，明确为 **UTC 日期**；日志 schema `schema.upload_logs.json:13-20,41-43`。 | `at` 与 UTC `day` 在午夜附近可能落不同自然日；按已定业务口径以 `day` UTC 为准，监控需分辨。 |

## 3. 每个读取查询与索引对照

以下五个列表/计数查询都针对 `submissions`。`limit` 是有界重查，**没有 `skip` 或持久游标**；已完成项退出队列、失败项写退避时间后，下一次重新取队首。`_id` 是同时间的次级稳定键，但仅当云端按列排序并返回缺失字段行时才成立。官方文档也以 `createdAt + _id` 作为稳定分页排序示例；本代码并未实现其游标谓词。[查询优化·游标分页](https://docs.cloudbase.net/recipes/optimize-database-query-performance)。

| 查询及源码 | 过滤条件/操作符 | 排序、批次 | 必需与可能缺失字段 | 已声明索引；差距与云端验证 |
|---|---|---|---|---|
| Q1 T-1 `markExpired` `:414-420` | `status='pending'` 等值；`createdAt < now-29d` 范围 | `createdAt↑,_id↑`；`limit(batchLimit)` | 新投稿应有 status/createdAt/_id；存量异常类型未知 | `ix_retention_mark_order(status,createdAt,_id)` `schema:134-137` 字段顺序匹配；确认真实索引存在和执行计划【云待】。`ix_status_created` 少 `_id`。 |
| Q2 R1 `recoverPending` `:189-204` | `retention.audit.state='pending'` 嵌套等值 | `retention.audit.retryAfter↑,createdAt↑,_id↑`；`limit(batchLimit)`；`:211-226` 对未来时间跳过，失败退避 60s | `audit.state` 必须存在才能发现；旧 pending 审计可能缺 `retryAfter`，createdAt/_id 应有 | `ix_retention_audit_queue(state,retryAfter,createdAt,_id)` `schema:140-143`；点路径索引官方支持，但缺字段排序、连续范围及命中计划【云待】。[索引管理·嵌套字段](https://docs.cloudbase.net/database/data-index)。 |
| Q3 T-2 `needsMark` `:343-346` | `status='pending'`；`createdAt < now-30d` | 无排序，`count()` | status/createdAt | `ix_status_created(status,createdAt)` `schema:128-131` 可作为候选；真实 count 查询计划和数据分布【云待】。这里的计数不是本次标记数。 |
| Q4 T-2 候选 `purgePayload` `:347-352` | `status IN (approved,rejected,expired)`；`createdAt < now-30d`；`payload != null` | `retention.purge.retryAfter↑,createdAt↑,_id↑`；`limit(batchLimit)` | 旧终态行通常缺 `retention.purge.retryAfter`/整段 `retention.purge`；payload 可能为 null 或字段缺失；createdAt/_id 应有 | `ix_retention_purge_candidates(status,retryAfter,createdAt,_id)` `schema:146-149` 仅覆盖部分字段；`payload` 未入索引，`retention.audit.state` 未在查询过滤。`status IN` + 两个非等值条件 + 三列排序能否利用单一索引、是否要拆成三种状态等值查询或改扫描策略【云待】。不能把“字段看似对齐”当作可用计划。 |
| Q5 T-2 待补 `recoverPurgePending` `:307-318` | `retention.purge.state='pending'` 嵌套等值 | `retention.purge.retryAfter↑,createdAt↑,_id↑`；`limit(batchLimit)`；`:321-329` 未来时间跳过 | 新清理标记同次写 epoch，旧/异常 pending 标记可能缺 retryAfter | `ix_retention_purge_audit_queue(state,retryAfter,createdAt,_id)` `schema:152-155`；真实嵌套索引、缺字段、稳定排序及吞吐【云待】。 |

条件更新及点查也需单独验收：`recoverAudit` `:139-184` 与 `recoverPurgeAudit` `:257-295` 先按投稿 `_id` 读，再按 `_id/status/rev/eventId/state=pending` 更新；`markExpired` `:450-468`、`purgePayload` `:379-387` 用 `_id/status/rev` 条件更新；日志按确定性 `_id` `add`，冲突后按 `doc(id).get()` 回读。单线程 fake DB 只证明本地逻辑，不证明云端原子性、重复写抑制或 SDK `stats.updated` 形状。

### 排序与饥饿风险

1. R1 Q2：`retryAfter` 初始写 epoch（`:461-463`），但老标记可能没有字段；本地 fake DB 把缺失值排前，不等于云端承诺。官方索引文档只明确**建索引时缺字段按 null 处理**，未保证 `orderBy` 对缺字段文档的返回/顺序。[索引管理·缺失字段](https://docs.cloudbase.net/database/data-index)。若缺失行被排除，将漏恢复；若排在未来退避项之后，可能长期饥饿。必须在授权的隔离云测试集合验证，不能读取现有业务行。
2. Q4：首次清理前通常缺 `retention.purge.retryAfter`；若目标数据库多字段排序排除它，终态正文可能永不入队。`payload != null` 对**缺失 payload** 的语义亦未由本地代码或所查官方文档证实，应在隔离夹具验证。Q4 的 `retention.audit.state='pending'` 是取数后才判断；大量受保护项可耗完本批名额，即使有其他可清正文。退避写入成功时本地模拟能推进；真实排序和退避写失败时不能保证。
3. Q2/Q5 的“失败延期”是读出后判断而非 `where(retryAfter <= now)`。未来项仍占 `limit`；当队首连续失败、退避更新自身失败，R1 独立探针已复现故障期队头阻塞。Q4 同类风险，`retrySchedulingFailed` 只上报。`hasMore` 在 Q2 仅由 `rows.length===limit` 推断（`:206-207`），不能证明后面有可处理项。
4. Q4 候选索引把 `status` 放首列，但筛选是 `IN` 而非单值；同时 `createdAt` 是范围、`payload` 是不等式且未入索引。依据官方最左前缀和范围置后原则，**推断**单一草案索引未必同时完成过滤与排序；是否索引扫描后内存排序、全表扫、直接报索引错误只能通过目标环境的查询计划/耗时确定，不据此擅改索引。

## 4. 调度、权限、并发、恢复与对账

| 事项 | 当前证据 | 上线前需取得的证据 |
|---|---|---|
| 定时触发器 | `cloudfunctions/retention/config.json` 不存在；`package.json` 仅定义依赖，`index.js:4-9` 明说无 triggers。仓库内未找到 retention 调度调用方。【码】 | 云函数控制台“retention → 触发器”显示目标环境实际绑定、启用、Cron/时区及最近触发记录；不能仅凭本地配置推断。官方说明本地 `config.json` 仍需上传触发器。[定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)。当前是否存在控制台手工创建的触发器【云待】。 |
| 调用入口/令牌 | `main:526-536` 仅 `mark/recover/recoverPending/purge`，先校验 `event.maintenanceToken`；`:76-83` 与环境变量中的令牌常量时间比较；不满足拒绝。`recoverPurgePending` 是 `purge` 的内部步骤，无独立外部 action。【码】 | 明确可信调度器如何安全传递令牌、轮换和最小权限；校验触发事件格式是否能携带令牌。不得在 Cron、日志或报告中写明文令牌。云端环境变量实际存在与配置值本轮不读【云待】。 |
| 顺序/重复/超时 | 当前无编排器；T-1 mark、R1 recoverPending、T-2 purge 需要顺序与重复调度。条件更新和稳定事件 ID 可帮助重试；两个实例同进程假库测试不是真并发。【码/拟】 | 授权后以隔离数据测试两个真实实例、超时/重试、日志写成功但确认失败、`rev` 冲突、一次处理上限与堆积消退；记录请求 ID、版本、日志事件数与结果分类【云待】。 |
| `prepare` 缺 `complete` | mark `:427-443,:486-495`、purge `:359-361,:397-398` 写批次日志；均带 `result.stats.batchId/phase`（`:85-112,:239-254`）。进程在中间停止或 complete 日志失败后，无自动“孤儿 prepare”扫描/对账。【码】 | 上线前设计并验收只读对账：按 UTC day/event 查询 prepare，按 batchId 配对 complete；孤儿批次用逐条稳定事件与 submission 待补标记核对，判“未开始/部分处理/完成但收尾失败/状态未知”，状态未知不得自动判成功。当前 `upload_logs.ix_event_day` 仅 `event,day`（`schema.upload_logs.json:53-56`），无 batchId/phase 专用索引或对账程序。 |
| 恢复批次 | `recoverPending:189-232`、`recoverPurgePending:307-333` 只写逐条事件或更新标记，**不写恢复批次 prepare/complete**；`purgePayload` 在自己的 prepare 前调用后者（`:353-359`）。【码】 | 恢复批次审计、可查询摘要、计数闭合与对账列为上线前必办。明确 `selected/recovered/deferred/conflicts/failed`，保留批次 ID、UTC day、开始/完成时间和结果；不写正文/令牌。接口和日志最小变更需另轮审查。 |
| `needsMark`/返回值 | `purgePayload:343-346` 的 `needsMark` 是**所有超过 30 天仍 pending 的总数**，不是本次 selected，也不是程序失败；`:393-401` 使它触发 `PURGE_DEFERRED`、`ok:false`。全仓生产代码无 Retention 调用方；仅专项测试断言该语义（`tools/test_retention_purge.js:55-58`）。【码】 | 调度器不得把仅 `needsMark>0` 的 `ok:false` 当技术故障。兼容建议：保持现有 `ok/code`，增量加 `completionState`（如 complete/work_remaining/failed）及 `workRemaining` 数值，调用方先按 `code` 分类；提案与测试须单独审查，本轮不实施。 |
| 集合权限 | 本地 schema `schema.submissions.json:3-8`、`schema.upload_logs.json:3-8` 均明示草案；契约 `UGC_MVP_DESIGN_FINAL_20261026.md:453-457` 要求客户端零直读、仅云函数服务端访问。【稿】 | 控制台分别查看 `submissions/upload_logs` 权限规则与函数运行身份；授权后验证未授权客户端不能读写、retention 函数能按条件读写、日志只能追加。不可通过读取现有业务数据来证明权限。本轮权限实际状态【云待】。 |

## 5. 最小后续工作与顺序

**可在本地另轮实现/审查**：①为 `needsMark` 增加兼容的独立完成状态，并补调用方分类测试；②为两类恢复动作加批次审计和孤儿 prepare 对账设计；③对缺 `retryAfter`、保护项占满 batch、退避写失败补故障注入和告警规则；④根据隔离云查询计划选择拆分 status 查询、规范化排序键或调整索引草案，**不得先猜一个云端索引**。以上只列计划，本轮未改代码。

**必须经另行授权在目标云环境验证**：按以下顺序收集证据，验收前不部署生产处理函数、不读写真实业务数据。

1. 控制台“环境 → 云函数 → retention”：记录实际部署版本、运行时、超时、环境变量**键名/是否配置**、触发器列表、Cron/时区、最近调用来源；不显示令牌值。没有部署时记录“不存在”。
2. 控制台“数据库 → submissions/upload_logs → 索引管理”：记录实际索引名、字段顺序/方向、构建状态及数量；与 `schema.submissions.json:128-155`、`schema.upload_logs.json:45-63` 对照。schema 声明不等于已创建。
3. 控制台“数据库 → 集合 → 权限规则”：记录客户端/服务端读写规则及生效环境，不打开业务记录。用授权的隔离测试身份验证拒绝与允许路径。
4. 经单独授权后在**隔离测试集合/环境**放置合成夹具，验证五个查询的实际结果集、缺失 `retryAfter`、`payload` 缺失/null、嵌套字段点路径、多字段排序与 `_id` 同时间稳定性；记录查询计划、命中索引、耗时、扫描量、错误码。若无法查看计划，记录慢查询指标与受控 A/B 结果，仍标计划不可证实。
5. 在隔离环境验证条件更新 `stats.updated`、自定义日志 `_id` 冲突、日志已写但清标记失败、两实例竞争、超时/重试、批次超限与队列消退。最后对 `prepare/complete` 和恢复批次摘要做对账，确定无人值守调度、告警和停机标准后再评估上线。

## 6. 本轮 Git 与副作用核查

预检：`main`、HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、暂存 0；`git status --porcelain=v1 --untracked-files=all` 为 324 项（15 个已修改、309 个未跟踪），状态文本 SHA-256 `645B6470AF75201093335AA21807BB2220A722670B97F15ABAEF739F4F9A8A92`。`git diff --check` 退出 0，仅既有 `project.config.json` CRLF 提示。本报告建在项目外 `报告/`；项目源码、schema、契约、测试和 Git 均未修改。结束后复核值见文末。

**未证实清单**：真实部署版本和触发器、环境变量实际状态、权限规则、四条 Retention 专用索引是否已建、各查询执行计划/缺失字段排序、`neq(null)` 对缺字段行为、真实 CAS/日志 `_id` 唯一性、并发/超时、批次对账机制与业务数据分布。此清单均为 **PENDING**，非失败结论。

## 7. 供 DSH 独立复核

请对照当前源码行号、schema 草案和两份 DSH 既有报告，特别核查 Q4 复合索引能否同时支撑筛选与排序的表述、缺失字段风险是否标为待验、`needsMark` 是否被正确区分于故障、恢复批次及孤儿 prepare 的上线前门槛。本报告仅作只读预检；未进入部署或业务数据验证。
### 结束复核

$branch=main；HEAD=274ebd6bc35da21394e5e04b0abd7e02b4ce0fad；暂存=0；状态总数=324（已修改=15、未跟踪=309）；状态文本 SHA-256=645B6470AF75201093335AA21807BB2220A722670B97F15ABAEF739F4F9A8A92。与预检完全一致，项目工作区没有新增、删除或覆盖文件。报告文件存在，大小 16485 B。未触云、未生成正式产物、未执行 Git 写操作。
