# DSH 独立验收：T3 Retention 云端就绪预检

> 审查人：DSH（独立审查，非实现者）。只读，未改项目文件、未执行 Git 写、未部署、未建索引、未触云数据。
> 审查对象：`报告/T3_Retention_云端就绪预检_20261029.md`（实测 16,902 B）、`报告/DSH_R1_Retention_自动恢复独立验收_20261029.md`、`报告/DSH_T2_Retention_正文到期清理_独立验收_20261029.md`、当前源码/schema/契约。

## 0. 结论

**T3 预检的实质判断成立，可作为进入云端只读核验的设计输入；但"本地是否具备部署条件"不成立——且 T3 自身有 3 处证据卫生问题（报文自述字节数、状态哈希、个别行号），需在下一轮修正后可引。**

分级：本地查询/索引**静态一致** PASS；云端行为（缺失字段排序、`neq(null)`、多值 `status` 排序、CAS、索引可用性）**PENDING**；**P1 风险成立 3 项**（见 §4），均非"代码 bug"而是"上线前必须解决的设计/运行缺口"。

## 1. 审查基线

| 项 | 实测值 |
|---|---|
| Git | `HEAD 274ebd6`、`main`、暂存 0、`git status --porcelain` 84 行、`-uall` 324 行（15 tracked 修改） |
| `cloudfunctions/retention/index.js` | 25,238 B / 690 行 |
| `cloudfunctions/retention/package.json` | 235 B（仅 `wx-server-sdk ~2.6.3`） |
| `config/cloud/schema.submissions.json` | 9 条索引声明（含 4 条 retention 专用） |
| `config/cloud/schema.upload_logs.json` | `ix_event_day` = (event, day) |
| 触发器/`config.json` | `cloudfunctions/retention/` 内**无** `config.json`、无 `triggers` |
| 调用方 | 生产代码除 `config/ugc.js:53` 的 `RETENTION` 常量外，**无**调用 `retention` 云函数 |

**证据等级**：①②=已独立验证（源码/静态/schema）；③=本地模拟；④=待云端；⑤=历史控制台证据（2026-10-27 会话截图，本轮未复验）。

## 2. 十项逐条

### ① 查询与排序的实际代码 — PASS
`markExpired` 查询在 `cloudfunctions/retention/index.js:414-418`（`status:'pending'` + `createdAt: _.lt(cutoff)` + `orderBy('createdAt','asc').orderBy('_id','asc').limit(limit)`）；`recoverPending` 在 `:197-202`（`retention.audit.state:'pending'` + `orderBy(retryAfter,createdAt,_id)`）；`needsMark` 计数在 `:344-346`；`purgePayload` 候选在 `:347-350`（`status: _.in(...)` + `createdAt<cutoff` + `payload: _.neq(null)` + `orderBy(retention.purge.retryAfter,createdAt,_id)`）；`recoverPurgePending` 在 `:313-316`。T3 引用行号基本准确，唯 `hasMore` 实为 `:209`（T3 写 `:206-207`，属小偏差）。

### ② 索引声明 vs 查询字段顺序 — PASS（静态）
| 索引（`schema.submissions.json`） | 键顺序 | 对应查询 | 判定 |
|---|---|---|---|
| `ix_retention_mark_order`（`:134`） | status, createdAt, _id | Q1（等值 + 范围 + 排序） | 一致 |
| `ix_retention_audit_queue` | retention.audit.state, retention.audit.retryAfter, createdAt, _id | Q2 | 一致 |
| `ix_retention_purge_candidates`（`:146`） | status, retention.purge.retryAfter, createdAt, _id | Q4（**status IN 多值** + createdAt 范围 + 排序） | 声明顺序与排序一致，**可用性待云端** |
| `ix_retention_purge_audit_queue` | retention.purge.state, retention.purge.retryAfter, createdAt, _id | Q5 | 一致 |
| `ix_status_created`（`:128`） | status, createdAt | Q3 计数 | 一致（且该索引在 C1 已建过，见 §3.5） |

### ③ `retryAfter` 缺失时的排序与队头阻塞 — PENDING（风险最高）
源码从未为"首次候选"写 `retention.purge.retryAfter`（仅 `deferPurge`/`recoverPurgeAudit` 写），因此**第一批候选一定缺该字段**。DB 对"缺失字段参与 `orderBy`"的语义（跳过/排前/报错）未知；若跳过 → T-2 永久空转；若排前 → 新候选可能被无限插入队头（严格保证阻塞）。T3 已识别，判定 PENDING 正确；DSH 追加：**这不是云端才该关心的问题，而是设计假设**，建议先做"去 `retryAfter` 排序、改为 `createdAt,_id` + 应用层过滤退避"的备选方案（与 R1 一致），再决定是否建复合索引。

### ④ 嵌套字段过滤、多字段排序、分页、稳定排序 — PENDING
`_id` 作为最后排序键可提供确定性，但 `status: _.in([...])` 使索引变成多区间扫描，`createdAt` 范围与 `retryAfter` 首排叠加时能否走同一索引**未验证**；`payload: _.neq(null)` 是否包含"字段缺失"文档同样**未定义**。分页用 `limit` + `hasMore=rows.length===limit`（`:209`），Q2 有、Q4 无——T3 已指出。均属云端实测。

### ⑤ 是否会误清待补审计记录 — PASS（应用层）+ PENDING（服务端）
`purgePayload` 在 `:365` 用 `needsMark(row)` 排除 `retention.audit.state==='pending'`；测试 P7/P8 覆盖；本地探针同样验证。但这是**应用层过滤**，没有服务端约束/事务兜底（若未来并发路径绕过该判断，仍可能清正文）。云端需验证"查询结果与守卫一致"。

### ⑥ 触发器、维护令牌、权限、重复执行 — 混合
- 令牌：源码 `:76` 校验、`:526-536` 先验令牌后验动作；测试有 FORBIDDEN/无效令牌用例 → PASS。
- 触发器：**无** `config.json`，`package.json` 无 `triggers` 字段 → **PENDING**（且 `retention` 从未部署，历史控制台函数列表只有 healthCheck/review/seed/seed_b1/submit）。
- 权限：集合"仅管理端"与云函数内读取**未形成证据链**；客户端读拒绝来自 T-2 之前的控制台证据（`-502003`），本轮未复验 → PENDING（历史证据 ⑤）。
- 重复执行：测试 `T-P14` 与探针"再跑不重写" → PASS（本地）。

### ⑦ prepare/complete 不一致的发现与恢复 — PENDING
`needsMark` 能发现"状态已 expired 但审计未完成"，但**没有**"prepare 日志存在、complete 缺失"的对账查询；`recoverPending` 只按 `retention.audit.state` 修复，看不到"日志半套"。T3 已列为缺口；DSH 同意，并指出这是**运维可观测性缺口**（不是数据正确性缺口）。

### ⑧ `needsMark`/`ok` 与完成状态的接口语义 — PASS（读码 + 测试），附使用注意
`needsMark` = 终态 + 未审计完成（`:344-346`）；`ok = failed===0 && !hasDeferred`（`:517`）——因此**只要还有待补/待退避记录，`ok` 就长期为 false**。T3 记录该点正确；建议部署时把它定义为"部分成功"并单独告警（`hasDeferred=true` 与 `failed>0` 分开触发），否则会被误当"全库失败"。

### ⑨ 证据分级 — PASS
T3 已逐条标注"已确认/未验证/官方文档/控制台观察"；DSH 复核其"本地"结论与 R1/T-2 报告一致，未见把模拟当云端。

### ⑩ 预检未写云端/未部署/未改文件 — PASS（就证据可及的层面）
Git 84/324 与 DSH T-2 验收时一致；`报告/` 在项目外；本轮 DSH 只读。但 T3 未给自己的"未改文件"提供 mtime 或哈希证据（P3）。

## 3. 索引逐条复核（DSH 补强）

1. **Q1 复用 `ix_status_created` 的可行性**：T3 的补充实验（单列 status 索引仍被选中）逻辑成立，但它是在**假设查询规划器行为**；真实环境应实测 `explain()` 或对比延迟。
2. **`ix_retention_purge_candidates` 的 `status` 前置**：Q4 用 `_.in([approved,rejected,expired])`，三值 IN 在索引上产生三个区间，再叠加 `createdAt<` 与 `retryAfter` 排序 → 极可能触发内存排序/多段合并；T3 判 PENDING 正确。
3. **`payload: _.neq(null)` 未进索引**：T3 对；同时"缺失字段是否匹配 neq"须实测（否则新记录即被排除）。
4. **`retryAfter` 缺失的前置影响**：见 §2③，建议改为单列 `createdAt` 排序 + 应用层退避。
5. **`ix_status_created` 已在云端存在**：2026-10-27 C1 建索引截图显示 `uk_submitter_clienttoken`、`ix_dedupe_status`、`ix_submitter_created`、`ix_status_created` 四条（历史控制台证据 ⑤）。T3 把"索引是否已建"整体列为 PENDING 是对的，但应注明 Q3 所需索引已在，而 4 条 retention 索引均未建。

## 4. 风险与阻塞

**P1（上线前必须解决/验证）**
1. **R-1 队列排序依赖未定义行为**：首批候选缺 `retryAfter`；若 DB 跳过缺失字段，T-2 永不执行；若排前则队头阻塞。（设计层）
2. **R-2 无调度**：无触发器、`retention` 未部署，功能不可能自动运行；即使部署也无 `config.json` 触发声明。
3. **R-3 恢复批次无审计、孤儿 prepare 无对账**：运维无法回答"哪次运行补了哪些投稿、哪条 prepare 无 complete"。
4. **R-4 四条 retention 索引均未建**（且 Q4 索引可能不可用）。

**P2**：`ok` 长期 false 的告警语义；`payload neq` 语义；多值 IN 排序；重试写失败仍可能队头阻塞（R1 已登记）。

**P3（文档证据卫生，不影响结论）**：T3 报告自述 16,485 B / 实测 16,902 B；状态哈希 `645B6470…` 不可复现（DSH 用原始字节与 LF 归一化分别为 `113b85669188150e` / 同值；PowerShell `Out-String` 亦不同）——应写明命令与序列化口径；`hasMore` 行号 `:206-207` 应为 `:209`；`writeRunLog`/`writePurgeLog` 结束行号各差 1–5 行。

## 5. 五个问题的答复

1. **当前查询和索引设计是否具备进入真实云端只读核验的条件？**
   具备——前提是把 R-1（缺失 `retryAfter` 排序）和 R-4（四条索引未建）作为**核验的第一批问题**，而不是部署后再发现。建议先只读验证 5 个查询的命中索引与结果集，再谈建索引。

2. **是否存在阻止上线的 P1 风险？**
   有 4 项（R-1…R-4）。其中 R-1、R-2 是**功能是否正确运行**的问题；R-3 是**可运维性**；R-4 是**性能/可用性**。没有"数据会丢"的 P1（正文清理只清 `payload`，审计待补时不清，计数有恒等式）。

3. **哪些风险必须通过真实云端实测才能关闭？**
   `orderBy` 缺失字段语义、`neq(null)` 对缺失字段语义、`status IN` 多值 + `retryAfter` 首排的排序合并、CAS `stats.updated` 在真实并发下的行为、自定义 `_id` 唯一冲突、嵌套字段更新、`count()` 的索引依赖、权限规则、函数超时（10s）与 `batchLimit` 的匹配、触发器 `config.json` 是否被接受。

4. **是否已经具备部署授权条件？**
   **不具备。** 预检通过 ≠ 部署授权；还缺：控制台证据（函数是否在、触发器是否存在、四索引是否建）、隔离环境查询核验、R-3 对账设计、负责人对"部署 + 建索引 + 配置触发器"的单独授权。

5. **下一步最小、可独立验收的任务是什么？**
   **「隔离环境只读查询核验」**：在隔离/测试集合上只读跑 5 个查询（含 `status IN`、缺失 `retryAfter`、`neq(null)`），记录命中索引/耗时/结果集并对照预期——不需要改代码、不建索引、不部署，直接决定 R-1/R-4 是否改设计。若云端暂不可用，退而求其次：**本地实现"孤儿 prepare 对账"只读查询**（R-3），但只能关闭 R-3，不能替代 R-1。

## 6. 边界声明

- 只读：未改 `项目/` 任何文件、未 Git 写、未部署、未建索引、未触云数据。
- 未复核 T3 引用的官方文档原文（外部文档，仅按报告转述判断）。
- 历史控制台证据来自 2026-10-27 会话截图，本轮未复验；已在 §1 标 ⑤。
- 本报告位于项目目录外：`C:\Users\25975\Desktop\食神寻味小程序开发\报告\`。
