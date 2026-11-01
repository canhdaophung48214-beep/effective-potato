# DSH 独立验收：T-2 Retention 正文到期清理（2026-10-29）

> 角色：独立审查人 DSH，不是实现者。对象：`报告/T2_Retention_正文到期清理_实施与验收_20261029.md` 及其实际改动。
> 方法：读源码/测试/schema/设计稿 + 复跑命令 + 自写独立探针 + 隔离副本反事实与变异。
> 未修改项目文件、未 Git 写、未部署、未建索引、未触云。

## 0. 结论

| 维度 | 结论 |
|---|---|
| 本地正文清理逻辑 | **PASS** |
| 状态转换与审计保护 | **PASS（本地）** |
| 幂等、重试与计数 | **PASS（本地）** |
| schema 与索引 | **声明一致 / PENDING（云端可用性）** |
| 真实云端能力 | **PENDING** |
| 进入云端预检 | **具备条件**（P0 无，P1 三项需授权后处理） |

**本地 T-2 PASS；未发现 P0。** "T-2 已生效"不能宣称。

## 1. 基线与证据等级

| 项 | 值 |
|---|---|
| Git | `HEAD 274ebd6`、`main`、暂存 0、`porcelain` 84、`-uall` 324（15 tracked + 309 未跟踪）、`git diff --check` exit 0（仅既有 `project.config.json` CRLF 提示） |
| `cloudfunctions/retention/index.js` | 25,238 B / `45F304842FA500441BFC28FDA1A4BCE619E02A6038D55F46C53EC7CE84EAE693` / 548 行 |
| `tools/test_retention_purge.js` | 新建 8,973 B / `D1C88EA9B36B7CBE9FB3DD7556A1D9AD51FA16A6B2E833D32660666D51B0D462` / 148 行 |
| `config/cloud/schema.submissions.json` | 8,489 B / `954D2E2875EFEFBACE184E450D29AA097CE2A434369A9AF471E800BC433CA105` |
| `config/cloud/schema.upload_logs.json` | 3,499 B / `958A128870B15A15F5F5FA1336B51D055F8AA117F3310F2E481448EB2B186DCD` |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 53,541 B / `3EC63B957450A53A8FDCED4205B5F3DDAB361CFE26F52984397FF6720FAF3AA1` |
| 备份（项目外） | `备份/t2-retention-20261029-20261029T0654162507883Z/`，5 文件哈希与报告表**逐项一致**（我实测：`AEEC9C46…`、`A26F7B78…`、`57F8157E…`、`F0490DE2…`、`C2C1200D…`） |

证据等级：**【验】已独立验证**｜**【静】静态判断**｜**【拟】本地模拟**｜**【云】待云端**。

## 2. 十二项逐项结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 读实现与测试（不复述报告） | **PASS** | 逐行读 `retention/index.js:234-402`（purge/recover/queue）与测试 148 行 |
| 2 | 30 天截止、时区、边界、重跑 | **PASS（UTC 口径）** | `PURGE_AFTER_DAYS=30`（`:41`）、`cutoff=now-30d`（`:340`）；查询 `createdAt: _.lt(cutoff)`（`:348`）；探针 B1/B1b：恰好 30 天不清、29d23h59m59.999s 不清、30d+1ms 清 |
| 3 | approved/rejected/expired 行为 | **PASS** | `PURGE_STATES`（`:43`）；探针 B2 三种终态全部清正文，P2 外壳保留 |
| 4 | 超期 pending 不绕过过期转换 | **PASS** | 候选查询只含终态（`:348`），pending 只进 `needsMark`（`:344-346`）；探针 B2/B5 |
| 5 | `retention.audit.state='pending'` 绝不清正文 | **PASS** | `:365-369` 先判审计、再判状态/版本；探针 B5（正文保留、`deferredAudit=1`）；变异 M1 被测试捕获（P7/P8 红） |
| 6 | 审计恢复后可重新进入清理 | **PASS** | `:353` 先 `recoverPurgePending`；探针 B6：恢复 + 退避 61s 后 `purged=1` |
| 7 | 条件更新、rev 冲突、日志失败、中断重试 | **PASS（本地）** | 更新条件 `_id+status+rev+payload!=null`（`:381-385`）；冲突 `:387`；日志失败 `:359-361`、`:397-398`；待补 `:383-384` + `recoverPurgeAudit` `:257-295`；P9/P11/P17 |
| 8 | 分页、上限、退避、计数闭合 | **PASS** | `batchLimit`（`:350`）；`retryAfter` 退避（`:297-305`）；计数 `selected = purgedAudited+auditFailedCount+deferredAudit+deferredRetry+skipped+conflicts+failed`（构造式闭合，`:356-392`）；探针 B7/B11 每次 `closed()` |
| 9 | 无条件覆盖/正文泄漏/误删/审计丢失 | **PASS** | 更新只写 `payload:null`+`payloadRedactedAt`+`retention.purge`+`rev`（`:382-385`），不写 status/review/verifyStatus；全函数 `remove/delete` 计数 0；日志无正文（P4、探针 B10）；`retention.audit` 保留（探针 B5/B6） |
| 10 | schema/索引与真实查询一致 | **PASS（声明）/ PENDING（可用性）** | 两索引与两查询字段对齐（`schema.submissions.json` `ix_retention_purge_candidates`、`ix_retention_purge_audit_queue`）；但候选查询同时有 `status IN`、`createdAt 范围`、`payload!=null`，索引能否同时服务过滤与三字段排序 —— 未验证 |
| 11 | 只在隔离副本撤销修复，确认测试能捕获 | **PASS（部分变异冗余）** | 见 §4：M1/M4/M5 被捕获；M2/M3 未被捕获（冗余守卫，见 P3-1/P3-2） |
| 12 | 区分假库/实例/真实云端 | **PASS（已区分）** | P14 为同进程共享 fake DB；报告 §4 已自述；真实并发【云】PENDING |

## 3. 独立探针（12/12，自有脚本，未复用其测试）

| # | 场景 | 结果 |
|---|---|---|
| B1 | 恰好 30 天 / 少 1ms / 多 1ms | 前两者不清、后者清，`purged=1` ✅ |
| B1b | cutoff 精确等于 `now-30*24h` | ✅ |
| B2 | 三终态 + pending | 三终态清、pending 保留、`needsMark=1`、计数闭合 ✅ |
| B3 | 外壳与元数据 | `status/rev=2/review/verifyStatus` 保留，`payloadRedactedAt` 为 Date ✅ |
| B4 | `day` 口径 | 批次日志 `day='2026-10-29'`（now=23:30Z，**UTC 日期**）✅ |
| B5 | T-1 审计 pending | `deferredAudit=1`、正文保留、计数闭合 ✅ |
| B6 | 审计恢复 + 退避后 | `audit.state=complete`、正文清、`purged=1` ✅ |
| B7 | 逐条日志失败 | `PURGE_PARTIAL`、正文已清、标记 `pending`、`auditFailedCount=1` ✅ |
| B8 | 下一次自动补记 | `auditRecovery.recovered=1`、标记 `complete`、逐条日志恰 1 条、`actor.openidHash=null` ✅ |
| B9 | 重复执行 | 不再清、不再写日志 ✅ |
| B10 | 正文泄漏 | 全部 `retention_purge` 日志不含 `BODY-` ✅ |
| B11 | batchLimit=2 分页 | 两次调用清完 3 条 ✅ |

## 4. 反事实与变异（隔离副本 `%TEMP%/t2_cf`，不改项目）

| 用例 | 结果 |
|---|---|
| 当前源码 | PASS 18 / FAIL 0，exit 0 |
| 换回修改前备份（15,383 B） | exit 1，`T.purgePayload is not a function` → 新测试无法通过旧实现 |
| M1 去掉 `retention.audit.state==='pending'` 守卫 | exit 1，**P7/P8 红** |
| M2 去掉更新条件里的 `payload: _.neq(null)` | 18/0 全绿 → **未被捕获**（该守卫与 status+rev 冗余，见 P3-1） |
| M3 去掉候选查询的 `status: _.in(PURGE_STATES)` | 18/0 全绿 → **未被捕获**（循环内 `:370` 状态复检仍在，行为等价，见 P3-2） |
| M4 破坏 `auditFailedCount` 计数 | exit 1，**P11 红**（`closed()` 捕获） |
| M5 去掉 `recoverPurgePending` | exit 1，**P11 红** |

## 5. 命令与退出码（本轮实跑，`项目/`）

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node tools/test_retention_purge.js` | PASS 18 / FAIL 0 | 0 |
| `node tools/test_retention_mark.js` | PASS 71 / FAIL 0 | 0 |
| `node tools/test_retention_recover_pending.js` | PASS 13 / FAIL 0 | 0 |
| `node tools/test_ugc_review.js` | PASS 86 / FAIL 0 | 0 |
| `node tools/test_ugc_submit.js` | PASS 110 / FAIL 0 | 0 |
| `node tools/test_ugc_client_contract.js` | PASS 90 / FAIL 0 | 0 |
| `node tools/test_index_state.js` | 全部通过（205 项） | 0 |
| `node tools/check_eol.js` | 无违规 | 0 |
| `node tools/test_check_doc_refs.js` | RESULT: OK（51/0） | 0 |
| `git diff --check` | 无错误（仅既有 CRLF 提示） | 0 |

## 6. 风险分级

### P0

无。

### P1（阻断"线上可用"，不阻断本地）

1. **云端查询/索引语义未验收**：`status IN + createdAt 范围 + payload!=null` 与 `orderBy(retryAfter,createdAt,_id)` 能否共用 `(status,retryAfter,createdAt,_id)`，以及缺失 `retention.purge.retryAfter` 的旧文档排序稳定性，均为【云】PENDING。
2. **无调度**：`retention` 仍无 `config.json`/触发器；`purge` 只能被人工或外部定时器带维护令牌调用。
3. **真实并发未验收**：P14 是同一进程共享 fake DB，不能证明多实例 + 真实数据库的原子性与读后写一致性。

### P2

1. **清理恢复没有批次审计**：`recoverPurgePending` 只写逐条日志，没有"谁在何时跑了恢复"的 prepare/complete 摘要（与 R1 同族问题）。
2. **持续失败仍可能队头阻塞**：`deferPurge` 自身失败时 `retrySchedulingFailed` 只上报、不换队，故障持续期同一队头会被反复选中（无公平性保证）；报告已承认，需运维熔断/告警策略。
3. **prepare 无对应 complete 的悬挂**：进程在批次中途被杀会留下 `PREPARE` 行而没有 `COMPLETE`，当前无对账/清理规则，审计流会出现孤立批次。
4. **`needsMark` 让 `ok:false` 长期成立**：只要存在超期 pending，`purge` 永远返回 `PURGE_DEFERRED`（`ok:false`），即使所有终态正文都已清完；呼叫方若按 `ok` 判定"清理失败"会误读。
5. **`day` 是 UTC 日期**：`now.toISOString().slice(0,10)`（`:384`、`:242`）与本地（Asia/Shanghai）自然日差 8 小时，审计报表按本地日期统计会对不上。

### P3

1. **`payload != null` 守卫冗余（M2 未捕获）**：真实场景里 payload 被清必然伴随 `rev` 变化，status+rev 条件已足够；该守卫是防御性冗余，建议要么补一条 TOCTOU 用例（`setBeforeUpdate` 把 payload 置 null、rev+1），要么注明"冗余防御"。
2. **候选查询的 status 过滤是优化而非保护**（M3 未捕获）：真正的状态守卫在循环内 `:370`；两份"保护"并存但只有一份被测。
3. **空转批次仍写两条日志**：无候选时也会写 prepare/complete，定时高频运行时审计量线性增长，需在调度层限频。
4. **无错误令牌用例**（只有无令牌 P15）。
5. **本轮备份在项目外（合规），但 R1 的 `项目/tools/_backup/` 仍在仓库内**，建议统一迁移。

## 7. 五个回答

1. **本地 T-2 是否 PASS？** —— **PASS**（本地实现 + 离线回归 + 独立探针 + 反事实/变异；范围不含云端）。
2. **是否存在 P0/P1 阻塞？** —— **P0 无**；**P1 三项**（云端索引/查询语义、无调度、真实并发未验收）。
3. **哪些问题可在本地继续解决？** —— 补 TOCTOU 用例或注明冗余守卫；补错误令牌用例；为 prepare-without-complete 设计对账规则；决定恢复批次审计字段；统一 `day` 口径（UTC 写死或改本地）并写进 schema；空批次日志限频策略。
4. **是否具备进入云端预检的条件？** —— **具备**：本地 PASS、索引草案齐备、可写只读验证脚本。预检本身需建索引/触发器（授权后），且应以"只读验证查询计划 + 排序稳定性"为先。
5. **仍需负责人授权的事项** —— ①云端建两个复合索引 + 触发器/定时调度；②部署 retention 新版本（含 purge 动作）；③确认 `day` 时区口径；④是否接受 `needsMark` 导致 `ok:false` 的语义；⑤是否增加恢复批次审计与空批次限频；⑥R1 遗留的仓库内备份迁移。

## 8. 边界声明

只读审查：未修改项目文件、schema、测试或设计稿；未执行 Git 写；未部署/调用云函数、未建索引、未改权限或环境变量；未生成正式产物；未处理投稿。唯一新增文件为本报告；探针与变异脚本均在 `%TEMP%`，不构成项目文件。Git 状态与预检一致：`HEAD 274ebd6`、暂存 0、15 tracked 修改、`-uall` 324。
