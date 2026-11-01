# DSH 独立验收：R1 Retention 自动审计恢复（2026-10-29）

> 角色：独立审查人 DSH。对象：Codex `报告/R1_Retention_自动审计恢复_实施与验收_20261029.md` 及其实际改动。
> 方法：读源码/精确 diff/测试/schema/设计稿 + 复跑全部命令 + 自写探针 + 隔离副本反事实与变异测试。
> 未修改项目文件、未执行 Git 写、未部署/触云/建索引/建触发器。

## 0. 结论

**本地"自动发现 + 有界批量恢复"PASS**；**真实云端行为、无人值守调度、恢复动作自身的审计 PENDING/P2**。
未发现 P0。可进入 **T-2 的本地实现与测试**；不具备"上云并无人值守运行"的条件。

## 1. 基线与证据等级

| 项 | 值 |
|---|---|
| Git | `HEAD 274ebd6`、`main`、暂存 0、`git status --porcelain` 83 行、`-uall` 323（15 tracked + 308 未跟踪）、`git diff --check` exit 0 |
| `cloudfunctions/retention/index.js` | 15,383 B / `AEEC9C46A7B8E2BC…` / 372 行（修改前 12,426 B / `A106FD1D…`） |
| `tools/test_retention_recover_pending.js` | 新建 136 行 / 13 项 / `F44BDA77…` |
| `tools/test_retention_mark.js` | 22,398 B / `8A3498D7…`（与修改前相同，未改旧套件） |
| `config/cloud/schema.submissions.json` | 7,233 B / `A26F7B78…` |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 52,446 B / `F0490DE2…` |
| 备份（修改前逐字节） | `项目/tools/_backup/r1-retention-20261029-20261029T0637432733201Z/` 5 文件，哈希与报告表一致 |

证据等级：**【验】已独立验证**｜**【静】静态判断**｜**【拟】本地模拟**｜**【云】待云端**。

## 2. 十项必查结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 直接读源码与 diff | **PASS** | 已逐行读 `retention/index.js:1-372`；diff 与报告 §7 一致（新增 `deferAudit:123-134`、`recoverPending:186-229`、`main:353-363`、`retryAfter` 初次写入 `:288-291`） |
| 2 | 不依赖人工 `submissionId` 的发现 | **PASS（本地）** | `recoverPending` 按 `retention.audit.state='pending'` 查询（`:194-199`），无需 ID；我用两条 pending 记录直接调用，一次恢复一条、无需指定 ID |
| 3 | 分页/批次上限/排序是否饥饿 | **PASS（健康库）/ P2（持久故障）** | 有界 `limit(batchLimit)`、按 `retryAfter,createdAt,_id` 排序、失败延后 60s（`:121-134`）；我的探针 A 证明失败记录退到队尾、后续记录被处理；探针 B 证明"DB 全面故障时队头反复失败会挡住后面"，清除故障即继续 |
| 4 | 日志失败、中断、重试、重复恢复 | **PASS（本地）** | 中断后 `pending` 标记留存（`:288-291` 同次写入）；重试幂等（稳定 `_id` + 回读校验 `:149-165`）；重复恢复返回 `ALREADY_RECOVERED`（`:144`、`:176-179`）；实测见 §3.3 |
| 5 | 状态更新/稳定事件 ID/清标记的顺序与幂等 | **PASS** | 事件 ID = `sha256(id+\0+markedRev)`（`:116-119`）；先写日志、后清标记（`:149-182`）；清标记为条件更新（`_id/status/rev/eventId/state=pending`，`:167-171`） |
| 6 | 计数公式与每记录唯一分类 | **PASS** | 代码 `:205-228` 每次循环只进一个分支；`selected=recovered+deferred+conflicts+failed` 由构造保证；测试 `conserved()`（`test_retention_recover_pending.js:37-39`）在 R1/R2/R4/R5/R6/R7/R8b/R11 全部断言 |
| 7 | 授权机制 | **PASS** | `main` 三种动作统一先过 `hasValidMaintenanceToken`（`:353-359`，`timingSafeEqual` `:73-80`）；R9 无令牌 `FORBIDDEN`、R10 有令牌 `OK`；无第二个入口（全仓仅此 `exports.main`） |
| 8 | 新测试能否在撤销修复后红 | **PASS** | 旧 retention + 新测试：exit 1，`TypeError: T.recoverPending is not a function`；三处定向变异见 §3.6 |
| 9 | schema/索引声明与实际查询一致 | **PASS（声明）/ PENDING（云端）** | 查询为 `state` 筛选 + `retryAfter/createdAt/_id` 排序；索引 `ix_retention_audit_queue(state,retryAfter,createdAt,_id)`（`schema.submissions.json:129-130`）逐字段对齐；`_meta.status=pending_admin_console_verification` |
| 10 | 单线程假库 / 实例模拟 / 真实并发 | **明确区分** | R6"重启"=重新加载模块；R7"两实例"=同进程共享 fake DB（报告 §5 已自述）；真实并发 **PENDING** |

## 3. 关键实测

### 3.1 命令（`项目/`，均为本轮实跑）

```
node tools/test_retention_mark.js            → PASS 71 / FAIL 0，exit 0
node tools/test_retention_recover_pending.js → PASS 13 / FAIL 0，exit 0
node tools/test_ugc_review.js                → PASS 86 / FAIL 0，exit 0
node tools/test_ugc_submit.js                → PASS 110 / FAIL 0，exit 0
node tools/test_ugc_client_contract.js       → PASS 90 / FAIL 0，exit 0
node tools/check_eol.js                      → 61 文件，违规 0，exit 0
node tools/test_check_doc_refs.js            → 51/0，exit 0
git diff --check                             → exit 0
```

### 3.2 自动发现（无 `submissionId`）

自写探针：两条 `status=expired`、`audit.state=pending` 记录，`batchLimit=1`，直接调用 `recoverPending({now})`。**无需任何投稿 ID**，第一轮恢复 `a`、第二轮恢复 `b`，两条都留下恰一条逐条日志。【验】

### 3.3 失败、退避与"队头"行为（探针 A/B）

**A. 仅日志写失败（退避可写）**：

```
run1 selected=1 recovered=0 deferred=0 failed=1   （a 失败，a.retryAfter 置为 now+60s）
run2 selected=1 recovered=1                        （选中 b 并恢复）
a=pending, b=complete
```

→ 失败记录**退出队头**，后续记录不被饿死。【验】

**B. 日志失败 + 退避更新也失败（数据库全面故障）**：

```
run1..run3 selected=1 failed=1 retrySchedulingFailed=true hasMore=true
a=pending, b=pending   （三轮都卡在同一个队头）
清除故障后：a=complete → 下一轮 b 被处理
```

→ **队头阻塞是真实存在的**，范围=故障持续期；故障恢复后自愈。报告 §2/§6 已把该风险列为"持续数据库故障下可能阻挡后续项"，与实测一致。【验】

### 3.4 幂等与事件 ID

- 恢复成功后再次调用 → `ALREADY_RECOVERED`（`:144`；测试 F3 同）。
- 日志已写、清标记失败 → 下次重试：`add` 冲突 → 按 `_id` 读回逐字段比对（`:152-165`）→ 再清标记；日志仍 1 条（R6 实测）。
- 事件 ID 由 `(id, markedRev)` 决定，跨批稳定；两个实例并发只落一条（R7，**仅同进程假库**）。

### 3.5 计数守恒

代码：`selected = recovered + deferred + conflicts + failed`（`:205-228`），每行只进一个分支；`deferred` 不计入失败、`conflicts` 覆盖"另一实例已完成/状态已变"。测试 `conserved()` 在 8 处断言；我另用两条记录独立复算，恒等式成立。【验】

### 3.6 测试有效性（反事实 + 变异）

| 操作（隔离副本） | 结果 | 说明 |
|---|---|---|
| 旧 retention + 新测试 | exit 1，`TypeError: T.recoverPending is not a function` | 旧代码无法通过 |
| 变异 M2：禁用退避写入 | 1 FAIL，exit 1 | 捕获"失败记录不退避" |
| 变异 M3：`deferred` 计入 `recovered` | 1 FAIL，exit 1 | 捕获计数分类错误 |
| 变异 M4：去掉 `state` 筛选 | 4 FAIL，exit 1 | 捕获查询范围错误 |

新测试不是"只验证不抛异常"；但**覆盖缺口**：没有用例断言恢复不改 `status/rev`（只测了 `payload/verifyStatus`）、没有"恢复动作运行日志"的用例（见 §4 P2）。

### 3.7 schema / 索引 / 文档

- `retention.audit.retryAfter` 已入 schema（`schema.submissions.json:75`，`type: date`）；四列复合索引与查询逐字段一致（`:129-130`）。
- 设计稿：`:263` 标注"2026-10-28 已裁决，尚未部署"；`:265` 明确"仅 T-1 有本地代码，T-2/轮转/触发器未实现"；`:277` 完整计数公式 + "真实复合索引、数据库原子性和进程中断行为未验收"；`:456` 写明维护入口动作 `mark/recover/recoverPending`。与代码一致，未重新打开已裁决问题。

### 3.8 备份与 diff

- 备份目录 5 文件哈希与报告 §4 表逐项一致（`retention` 12,426 `A106FD1D…`、`fake_cloud` 9,515 `DED35A3B…`、schema 6,687 `F74151CA…`、设计稿 52,104 `B56A92B0…`、旧测试 22,398 `8A3498D7…`）；修改后哈希亦一致。
- `fake_cloud` 的改动只有排序比较器两行：缺 `retryAfter` 的旧记录排在前面（`tools/ugc_fake_cloud.js` 比较函数）；这是测试替身行为，不等于云端行为。【静】

## 4. 风险与分级

### P0

无。

### P1（阻断"线上可用"，不阻断本地实现）

1. **真实云端未验收**：嵌套字段四列索引的查询计划、缺失 `retryAfter` 的排序、条件更新原子性、自定义 `_id` 唯一冲突语义、集合权限——全部【云】PENDING。
2. **无调度**：`retention` 仍无 `config.json`/触发器；`recoverPending` 只能由人/外部定时器携带维护令牌调用。"自动"仅指"按队列自动发现"，不等于无人值守。
3. **队头阻塞（故障期）**：探针 B 已复现；`hasMore` 在纯阻塞时仍为 true，若调用方按 `hasMore` 循环会空转。需运维熔断/告警策略，而不是改代码即可消除。

### P2

1. **恢复动作自身无批次审计**：`recoverPending` 只写逐条日志，没有"谁在何时跑了恢复"的运行摘要（`writeRunLog` 仅用于记录级与 mark 批次）。审计系统里这是一个可观测性缺口。
2. **恢复不清 `rev/updatedAt`**：清标记的更新只改 `retention.audit.state`，并发写者不会感知（与上一轮结论一致）。
3. **备份放在仓库内**：`项目/tools/_backup/...` 违背"备份放项目目录外"的落位约定，且增加未跟踪文件（本轮 323 项）。
4. **`recover` 成功路径仍无 `main` 级用例**（只有 `__test__`），与上一轮相同。
5. **`batchLimit` 与 mark 共用**：积压时恢复吞吐被同一参数限制。

## 5. 回答四个问题

1. **本地自动审计恢复是否 PASS？** —— **PASS**（范围：本地实现 + 本地模拟 + 静态分析；发现、分页、失败退避、幂等、计数、鉴权均成立）。
2. **是否仍有 P0/P1 阻塞？** —— **P0 无**；**P1 三项**（真实云端验收、无调度、故障期队头阻塞）；P2 五项。
3. **是否具备进入 T-2 正文清理实施的条件？** —— **具备进入"本地实现 + 本地测试"的条件**；不具备"上云运行"条件。且 T-2 设计必须自带两条前置：清除查询排除 `retention.audit.state='pending'`；为清除查询建 `(status,createdAt)` 之外的复合索引。
4. **哪些风险必须留到真实云端验收？** —— ①嵌套索引查询计划与缺失字段排序；②条件更新与自定义 `_id` 的唯一性/原子性；③触发器与并发（含两实例真并发）；④集合权限与超时；⑤积压与吞吐（`batchLimit` 实测）。

## 6. 边界声明

只读审查：未改项目文件/schema/测试/契约/设计稿；未执行 Git 写；未部署/调用云函数、未建索引或触发器、未改权限或环境变量；未生成正式产物；未处理投稿。新增文件仅本报告。
