# T3.2｜R-1/R-4 云端核验准备（2026-10-30）

**结论：本地准备 PASS；R-1、R-4 云端阻塞均为 PENDING。** 本报告是待执行的核验包，不是云端查询记录。本轮未触云、未部署、未建索引、未创建测试数据，也未修改生产代码、schema、契约或测试。

## 证据口径和基线

以下路径均相对于 `C:\Users\25975\Desktop\食神寻味小程序开发\项目\`，行号来自 2026-10-30 本轮实际文件。证据等级：**E1**＝当前工作区直接观察（源码读码、Git 只读命令和文件存在性检查）；**E2**＝当前 schema、配置或契约直接读码；**E3**＝本轮离线测试实跑；**E4**＝DSH 报告转述的历史控制台截图，非本轮复验；**E5**＝真实隔离云端尚无观察，结论 PENDING。推断会明确标为“推断”，不以 E1/E2 替代 E5。

| 基线项 | 实测及证据 |
| --- | --- |
| Git | `main`，HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，暂存 0，工作区 325 项（追踪修改 15、未追踪 310）；本报告位于项目仓库外。E1：本轮 `git rev-parse`、`branch`、`diff --cached`、`status --porcelain=v1 --untracked-files=all`。 |
| Retention 源码 | `cloudfunctions/retention/index.js`，37711 字节，SHA-256 `51CC315F7258B9CF6BBB759B416F3111CD3253F11A11F33AAA27B0B18918AC4D`。E1：本轮文件读取与哈希。 |
| 本地索引草案 | `config/cloud/schema.submissions.json`，8489 字节，SHA-256 `954D2E2875EFEFBACE184E450D29AA097CE2A434369A9AF471E800BC433CA105`；`config/cloud/schema.upload_logs.json`，4071 字节，SHA-256 `88EFFEA26E95997F4197772F630154E79276DDFA89E6B0D338C2FE7CCEB0985F`。两者 `_meta.status` 均为 `pending_admin_console_verification`（各 `:2–4`）。E2。 |
| 历史证据 | `报告/DSH_T3_Retention_云端就绪预检_独立验收_20261029.md` §3.5 与 `报告/DSH_T3.1_Retention_隔离环境只读查询独立验收_20261029.md:80–92` 仅转述 `ix_status_created` 的 2026-10-27 截图；未见四条 Retention 专用索引的历史截图，亦没有本轮实时清单。E4/E5。 |

仓库根目录的 `.baton/task.md`、`.baton/handoff/current.md`、`.baton/PROTOCOL.md` 本轮检查均不存在；因此没有可读取或更新的 baton 交接文件。本轮交接内容即本报告。E1：三个路径的存在性检查。

## A. R-1：逐项查询、写入与风险

| 操作 | 当前精确条件、排序和上限 | `retryAfter` 写入或检查；证据 |
| --- | --- | --- |
| `recoverPending` | `submissions.where({'retention.audit.state':'pending'}).orderBy('retention.audit.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`；没有游标，`hasMore` 只是 `rows.length===limit`。 | `cloudfunctions/retention/index.js:199–221`、`:227–253`，E1。应用层在选中后才检查未来 `retryAfter`。 |
| `deferAudit` | `where({_id,status,rev,'retention.audit.eventId','retention.audit.state':'pending'}).update(...)`，失败返回 false。 | 失败后写 `retryAfter=now+60s`，条件更新包括状态和版本；`index.js:134–146`、`:239–243`，E1。这是更新，不是发现查询。 |
| `purgePayload` | 先 `where({status:'pending',createdAt:_.lt(now−30d)}).count()`；再 `where({status:_.in(['approved','rejected','expired']),createdAt:_.lt(now−30d),payload:_.neq(null)}).orderBy('retention.purge.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`。 | `index.js:40–44`、`:380–410`，E1。选中后应用层才检查退避、待补审计和状态；无持久游标。 |
| `recoverPurgePending` | `where({'retention.purge.state':'pending'}).orderBy('retention.purge.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`；无游标。 | `index.js:335–359`，E1。失败后的 `deferPurge` 以 `_id,status,rev` 条件写 `now+60s`（`:325–333`）。 |
| `markExpired` | `where({status:'pending',createdAt:_.lt(now−29d)}).orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`。 | 查询本身不依赖 `retryAfter`；状态转换同次写入 `retention.audit.retryAfter=new Date(0)`，`index.js:452–471`、`:499–513`，E1。 |
| `reconcileBatches` | `upload_logs.where({event:eventType,_id:_.gt(cursor) 若有游标}).orderBy('_id','asc').limit(take).get()`；达上限后同条件 `limit(1)` 探针。 | `index.js:643–685`，E1。不查询、不排序 `retryAfter`；默认页 50、单次最多 500（`:47–48`、`:653–659`）。 |

**新记录是否一定有字段？** 新提交的投稿本身不能据现有写入路径认定有 `retention.audit/purge.retryAfter`；`submit/review` 没有写这两个 Retention 嵌套路径。新 T-1 标记写 `audit.retryAfter=纪元`，新 T-2 清理成功写 `purge.retryAfter=纪元`；首次进入 T-2 清理候选是在清理成功之前，所以**该候选不保证有 `purge.retryAfter`**。历史待补记录亦无全量补字段证据，schema 仅给可选类型。证据：`cloudfunctions/submit/index.js:630–658` 的新投稿字段、`cloudfunctions/review/index.js:435–452` 的删除更新字段、`cloudfunctions/retention/index.js:499–513,425–431` 的 Retention 写入；`config/cloud/schema.submissions.json:61–87`；对 `submit/review` 的 `retryAfter` 路径检索，E1/E2。这里的“首次候选可能缺字段”是由写入路径作出的推断，不是云端数据实测，E5。

**缺字段与队头：** 目标数据库对缺字段参与嵌套 `orderBy` 的真实行为尚未观察：可能漏选、排前/后或报错，不能从假库推断。若漏选，首次正文候选可能永远不可见；若反复把未到重试时间或无法处理的行排在有限批次前部，而任务无跨调用游标，可饿死后面的可处理行。这是有条件的风险推断，非已发生故障。证据：三个查询的 `orderBy(...retryAfter...)` 与 `limit`（`index.js:207–212`、`:341–344`、`:392–395`），应用层退避检查（`:227–233`、`:357–359`、`:409–420`），E1；缺字段真实排序为 E5。

**查询失败是否误报成功？** 显式查询异常被捕获并返回 `DATABASE_ERROR/ok:false`：`recoverPending` 在 `index.js:214–216`，`recoverPurgePending` 在 `:340–346`，`purgePayload` 的计数/候选在 `:388–399`，`markExpired` 在 `:460–471`，`reconcileBatches` 在 `:665–692`，均为 E1。**但**若缺字段导致查询“成功返回空集”，现有代码不能识别这种漏选；`recoverPending`/`recoverPurgePending` 在只有 deferred、无 failed 时仍可能返回 `ok:true/code:OK`（`:245–253`、`:368–377`），这不等于全队列清空。漏选是否实际发生仍为 E5。

**最小修复提案，不实施：** 优先审查把上述三个队列的主扫描改为依赖 `createdAt,_id` 的稳定键集分页，明确 `cursor` 与批次上限；对每个已选中行在应用层判断 `retryAfter`，跳过退避行时仍推进扫描位置，扫描至尾后回绕。续页位置需由经审查的调度或持久状态保存；只有移除 `retryAfter` 排序、没有跨调用续页，反会让旧失败行长期占据队头。旧行缺字段可定义为“立即可尝试”，但须补冲突/重复触发测试。现有本地 `markExpired` 已使用 `createdAt,_id` 排序（`index.js:462–467`），R-3 也有 `_id>cursor` 有界扫描（`:653–685`），为方案提供 E1 实现参照；跨调用状态、真实索引可行性仍为 E5。另一备选是所有写入路径初始化字段并获准回填历史记录、再验证服务器端时间过滤；这会写云端数据，本轮不执行。最终方案须经 DSH 审查与隔离云端验证后确定。

## B. R-4：索引字段与云端证据

状态列**只使用任务指定的四种值**；`仅 schema 声明` 不是“云端一定不存在”，`已有历史截图证据` 不是本轮实测。所有键均为升序。表中查询适配性仅为静态键序对照，实际查询计划、索引命中、构建状态均属 E5。

| 集合 / 索引 | 字段顺序（全部 asc） | 对应查询与条件 | 当前云端状态 | 证据等级、路径与行号 |
| --- | --- | --- | --- | --- |
| `submissions / ix_retention_mark_order` | `status, createdAt, _id` | T-1：`status=pending AND createdAt<29d 截止`，排序 `createdAt,_id` | 仅 schema 声明 | E2 `config/cloud/schema.submissions.json:134–135`；E1 `cloudfunctions/retention/index.js:462–467`；E5 云端。 |
| `submissions / ix_retention_audit_queue` | `retention.audit.state, retention.audit.retryAfter, createdAt, _id` | R1：`audit.state=pending`，排序 `retryAfter,createdAt,_id` | 仅 schema 声明 | E2 `schema.submissions.json:140–141`；E1 `index.js:207–212`；E5。 |
| `submissions / ix_retention_purge_candidates` | `status, retention.purge.retryAfter, createdAt, _id` | T-2：`status IN` 三终态、`createdAt<30d`、`payload!=null`，排序 `retryAfter,createdAt,_id`；payload 未入键 | 仅 schema 声明 | E2 `schema.submissions.json:146–147`；E1 `index.js:392–395`；E5，特别要验证多值 IN 与范围/排序并用。 |
| `submissions / ix_retention_purge_audit_queue` | `retention.purge.state, retention.purge.retryAfter, createdAt, _id` | T-2 待补清理审计：`purge.state=pending`，排序 `retryAfter,createdAt,_id` | 仅 schema 声明 | E2 `schema.submissions.json:152–153`；E1 `index.js:341–344`；E5。 |
| `upload_logs / ix_retention_reconcile_event_id` | `event, _id` | R-3：`event=retention_mark/retention_purge`，可加 `_id>cursor`，按 `_id` 排序 | 仅 schema 声明 | E2 `config/cloud/schema.upload_logs.json:59–60`；E1 `index.js:668–685`；E5。该索引是 R-3 对账索引，**不计入四条 submissions Retention 索引**。 |
| `submissions / ix_status_created` | `status, createdAt` | T-2 `needsMark`：`pending AND createdAt<30d 截止`，`count()` | 已有历史截图证据 | E2 `schema.submissions.json:128–129`；E1 `index.js:388–391`；E4 `报告/DSH_T3.1_Retention_隔离环境只读查询独立验收_20261029.md:80–92`；当前云端仍 E5。 |

## C. Q1–Q5 的只读执行包

Q1–Q5 是五个**核验主题**，不是五条彼此不同的生产查询：Q3 的正文候选表达式也用于 Q4 的 `IN` 和 Q5 的 `neq(null)` 诊断。探针须保持生产过滤/排序条件不变；单状态、缺字段对照查询仅用于诊断，明确另记。所有查询在已证实隔离且只读的环境中才可执行。截止以执行时 UTC 服务器时间为准，严格 `<`；`batchLimit` 按当前政策为 1–100（`index.js:40–44`、`:61–74`），E1。

| 核验主题 | 完整条件、排序、分页参数及源码 | 预期结果与要观察的索引 | FAIL / PENDING 标准与证据 |
| --- | --- | --- | --- |
| **Q1 审计恢复队列** | `where({'retention.audit.state':'pending'}).orderBy('retention.audit.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`；没有 cursor（`index.js:207–212`），E1 | 若现有行包含纪元、未来和**缺失** `retryAfter`，分别记录是否返回、三次重复查询的脱敏 `_id` 顺序、数量、耗时、错误；只读核 `ix_retention_audit_queue` 的字段/构建状态，E2 `schema.submissions.json:140–141`。 | 有可对照行却漏选/重行、排序不稳定或报错＝FAIL；无缺字段样本、索引计划不可见或未能证明隔离＝对应项 PENDING，E5。 |
| **Q2 到期标记** | `where({status:'pending',createdAt:_.lt(now−29d)}).orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`；无 cursor（`index.js:452–467`），E1 | 超期 pending 在批次中，已审核不占名额；恰等于截止点不匹配，同时间以 `_id` 稳定排序。观察 `ix_retention_mark_order`，并可对照 `ix_status_created`，E2 `schema.submissions.json:128–135`。 | 有边界行而结果不符/查询报错＝FAIL；无恰边界或同时间行＝该子项 PENDING，E5。 |
| **Q3 正文候选** | 先 `where({status:'pending',createdAt:_.lt(now−30d)}).count()`；再 `where({status:_.in(['approved','rejected','expired']),createdAt:_.lt(now−30d),payload:_.neq(null)}).orderBy('retention.purge.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit).get()`；无 cursor（`index.js:388–397`），E1 | `needsMark` 计超期 pending；候选应来自三终态、超 30 天且有正文。观察首次候选缺 `retryAfter` 是否出现、排序和批次推进；观察 `ix_status_created` 与 `ix_retention_purge_candidates`，E2 `schema.submissions.json:128–129,146–147`。不输出正文。 | 已有可对照候选却漏选、错误纳入、超期边界错或报错＝FAIL；无样本或计划不可观测＝相应项 PENDING，E5。 |
| **Q4 多值 `status IN`** | **沿用 Q3 同一条生产候选查询**及其 `limit`；再以相同 `createdAt<`、`payload!=null` 条件分别做 `approved/rejected/expired` 单状态**只读诊断探针**，比较脱敏结果并集、顺序与耗时（`index.js:392–395`），E1 | 确认 `status IN` 可执行、无漏/重，记录查询计划是否公开以及 `ix_retention_purge_candidates` 的实际构建/命中信息，E2 `schema.submissions.json:146–147`。 | 原查询报错、漏行/重行或重复执行排序不稳＝FAIL；若查询计划不可见，只能判结果行为，**索引命中仍 PENDING**，E5。 |
| **Q5 `neq(null)`、嵌套字段、`_id` 游标** | Q3 的 `payload:_.neq(null)`；Q1 的 `retention.audit.state='pending'`；另核 `where({'retention.purge.state':'pending'}).orderBy('retention.purge.retryAfter','asc').orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit)`（`index.js:341–344`）。对账读 `where({event:eventType,_id:_.gt(cursor) 若有 cursor}).orderBy('_id','asc').limit(take)`，到上限再 `limit(1)` 探针；`pageSize≤50,maxRows≤500`（`:47–48`、`:653–685`），E1。 | 对照 payload 非 null/null/缺失、嵌套状态有/缺、retryAfter 有/缺；分页 `_id` 严格递增、无漏重，超上限有截断和继续信息。观察 `ix_retention_audit_queue`、`ix_retention_purge_audit_queue`、`ix_retention_reconcile_event_id`，E2 相应 schema `:140–153`、`schema.upload_logs.json:59–60`。 | 有边界数据却错误匹配、漏/重、游标不单调或报错＝FAIL；缺边界数据、超过 500 条不能全局对账或计划不可见＝对应项 PENDING，E5。若缺 payload 匹配 `neq(null)`，当前应用层仅判断 `row.payload===null`（`:416–419`），须单独审查，不能直接判清理安全。 |

**只读可完成：**在已有样本且身份/权限隔离已证明时，查看索引元数据和构建状态，执行查询、count、三次重复、`_id` 续页，记录结果数量、脱敏顺序摘要、耗时、错误和可见查询计划。对账只准备原始日志的只读查询；本轮不调用任何云函数。依据 E1 `index.js:643–685`、E2 `schema.upload_logs.json:59–60`；真实能力 E5。

**需先获授权写入隔离夹具：**现有库若没有缺 `retryAfter`、三种终态、恰等于截止点、同创建时间不同 `_id`、payload 的非 null/null/缺失、嵌套字段缺失、超过批次上限和 500 条分页边界，这些子项保持 PENDING；不能为跑通查询私自插入。夹具应为合成数据，写入/建索引/创建环境均属未来单独授权。此判定来自查询条件 E1 和当前无隔离数据证据 E5。

每次执行按同一模板记录：UTC 时间、隔离环境 ID 证据编号、源码 SHA、Q 编号、原样条件/排序/limit/cursor、结果数、三次耗时与脱敏顺序摘要、分页连续性、错误原文、索引实际字段/方向/构建状态、查询计划是否可见及摘要、`truncated/nextCursor`、PASS/FAIL/PENDING 与理由。查询计划不可见时只报“不可观测”，不得写“已命中索引”。依据 E1 `index.js:653–685` 的分页和 `:704–744` 的截断结果；计划可见性 E5。

## D. 隔离环境前置条件（不输出密钥）

`config/cloud.js:15–26` 写有既有默认云环境标识；`project.config.json:3–6` 仅有应用配置与 `cloudfunctionRoot`，不能证明另一隔离环境。Retention 通过 `DYNAMIC_CURRENT_ENV` 绑定实际部署环境（`cloudfunctions/retention/index.js:23–28`），而目录中没有 `config.json`，`package.json:1–9` 也不含触发器配置。**默认环境应按生产等价环境处理，不用于本次试验。**这些是配置静态证据 E2；实际云端部署/权限为 E5。报告不读取或输出密钥、维护令牌或环境 ID 值。

1. **环境 ID 与隔离证明：**未来需在可信控制台同一会话展示默认环境与另一个环境的不同 ID、项目/数据库实例及集合归属、当前连接目标；记录时间、脱敏截图与哈希。仅凭环境名含 test 或配置文件不够。E2 `config/cloud.js:15–26`、`project.config.json:3–6`；真实隔离 E5。
2. **数据库权限：**准备仅限隔离环境 `submissions`、`upload_logs` 的文档读取/count、索引元数据查看权限；不得有生产数据访问或写入、建索引、部署权限。只读身份与未来获准写入夹具的管理员身份分开。E1 `index.js:30–33,207–212,341–344,388–397,668–685` 指明集合/操作；权限实况 E5。
3. **测试集合与账号：**确认隔离库有两类测试集合、无真实投稿迁入；提供可追溯的测试操作者/只读账号及权限证据。无现成合成边界数据时保持 PENDING，不写入。E1 `index.js:30–33`；集合/账号实况 E5。
4. **只读查询能力：**验证 SDK/控制台能执行嵌套路径、`IN`、`neq(null)`、多字段排序、`_id>cursor`、limit/count，并能返回错误、耗时与必要的脱敏结果；查询计划若不可见须标不可观测。E1 `index.js:207–212,341–344,388–397,668–685`；平台行为 E5。

隔离身份不明、连接指向默认环境、只读权限不能限定、操作要求插入/修改数据或建索引、查询会输出正文/身份/令牌、需要调用有副作用函数时，**立即停止相应云端步骤**。只有隔离环境的直接观察可使对应项从 PENDING 转 PASS；当前静态 schema、历史截图和离线测试不能代替。证据等级 E2/E4/E5 如上。

## 额外风险：R-3 `closed` 包含失败批次（只分析）

当前代码在 prepare/complete 配对、计数自洽且完整扫描时赋 `status='closed'` 并增加 `counts.closed`，**不要求结果码为 `COMPLETE`**（`cloudfunctions/retention/index.js:717–728`，E1）。因此 `PARTIAL`、`FAILED` 也可进入 `closed`；这表示批次生命周期闭合，不表示处理成功。源码同时返回原始 `completeCode`、归一化 `outcome` 和 `counts.outcomes`（`:602–605,704–732`），把 PARTIAL/FAILED 纳入异常，整体 `ok:false/code=RECONCILE_ANOMALIES`（`:734–744`，E1）；契约 `docs/UGC_MVP_DESIGN_FINAL_20261026.md:280–281` 明确此口径，E2。本轮 `node tools/test_retention_reconcile.js` 实跑 30 PASS / 0 FAIL、退出码 0，其中 C21/C22/C25 断言了失败批次不冒充正常成功（`tools/test_retention_reconcile.js:218–232,266–269`，E3）。

**重新登记的剩余风险：**下游若只读取 `counts.closed` 或 `status='closed'` 并当成成功批次数，会误报；必须同时看 `outcome/completeCode` 与整体 `ok/code`。本轮 `rg` 检索 `cloudfunctions/` 和 `tools/`（排除 `_backup`）只发现生产对账函数和专项测试消费这些字段，未发现其他仓库内生产读取方；外部运维面板或将来调用方是否存在不可确认。证据 E1（`index.js:704–744`）、E3（上述测试）；外部消费者为 E5。**不改代码，不将“闭合”重命名，也不把旧 DSH 报告的过时 DEFERRED 口径当当前实现**：当前源码仅有 DEFERRED 时返回 `RECONCILE_DEFERRED/ok:false`（`:734–740`，E1）。

## 本轮验证、Git 与停止

本轮只实跑 `node tools/test_retention_reconcile.js`：**30 PASS / 0 FAIL，退出码 0**；C21–C25 均 PASS，E3。本任务为静态核验准备，没有把该结果当云端验证。项目文件无修改；最终 Git HEAD、分支、暂存和 325 项状态与开工相同（本轮只读 Git 复核，E1）。本报告新建在 `报告/`，项目仓库外。R-1 与 R-4 的真实云端索引、缺字段排序、`status IN`、`neq(null)`、嵌套字段和分页行为均保持 **PENDING（E5）**。至此停止，交 DSH 独立审查。
