# DSH 独立复核：Retention 审计可靠性与日志结构（2026-10-29）

> 角色：独立审查人 DSH。审查对象为 Codex 于 2026-10-29 提交的 Retention 审计可靠性修复。
> 方法：只读审阅源码/测试/schema/设计稿 + 在本机复跑离线测试 + 自写脚本独立复现 + 在隔离副本上做反事实验证。
> 未修改任何项目文件；未执行 Git 写；未访问云端。

## 0. 一句话结论

**本地审计可靠性 PASS**：状态转换与"待补审计"标记同次条件写入，失败分行计数闭合，恢复按稳定事件 ID 幂等，日志字段与 schema 一致，新增测试在旧实现上会红。
但**"全自动恢复" PENDING**：没有批量发现入口与索引，恢复仍需人工给 `submissionId`；并发结论仅在**单线程假数据库**上成立。

## 1. 审查基线与证据等级

| 项 | 值 |
|---|---|
| Git | `HEAD 274ebd6`、`main`、暂存 0、`git status --porcelain` 81 行、`-uall` 317 行（15 tracked + 302 未跟踪）、`git diff --check` exit 0（仅 `project.config.json` 的 CRLF 警告） |
| `cloudfunctions/retention/index.js` | 12,426 B / `A106FD1DF544AFD8…`（310 行） |
| `tools/test_retention_mark.js` | 22,398 B / `8A3498D7E75A5C79…`（461 行，71 项） |
| `config/cloud/schema.submissions.json` | 6,687 B / `F74151CA424EB7BD…` |
| `config/cloud/schema.upload_logs.json` | 3,453 B / `57F8157EEAAD5758…` |
| `cloudfunctions/review/index.js` / `submit/index.js` | 18,488 B / 26,445 B（本轮未变） |
| 设计稿 `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 52,104 B / `B56A92B0A3705F7C…` |
| 新报告 | `报告/Codex_Retention_审计可靠性验收_20261029.md`（46,088 B / 651 行） |

证据等级标记：**【验】已独立验证**（本机实跑/自算）｜**【静】依据代码静态判断**｜**【拟】仅本地模拟**｜**【云】待真实云端验证**。

## 2. 逐项结论

| 项目 | 结论 | 关键依据 |
|---|---|---|
| A 审计失败恢复 | **PASS（本地，手动触发）** | 标记与审计同次写入（`retention/index.js` 的 `markExpired` 中 `retention.audit{state:'pending',…}` 与 `status` 同一 `update`）；`recoverAudit` 按 `eventId` 幂等补记；实测恢复成功后再调返回 `ALREADY_RECOVERED` |
| A 计数守恒 | **PASS** | 代码 `unprocessed = rows.length - marked - skipped - conflicts - failed`、`markedAudited = marked - auditFailedCount`、`selected = attempts = rows.length`；自写脚本复现 `selected=2, marked=1, markedAudited=0, auditFailedCount=1, unprocessed=1`，六项和 = 2 |
| B 并发与幂等 | **PARTIAL（本地模拟 PASS；真实并发 PENDING）** | F5/F6/F7b 覆盖"两个函数实例、两次触发、两恢复实例"，但共用同一 harness、假 DB 单线程；无真实数据库原子性证据 |
| C Schema 一致性 | **PASS（字段级）** | 见 §4：`at`/`rev`/`actor.role=system`/`actor.openidHash=null`/`submissionId`/`retention_mark` 全部与写入对象一致；普通用户哈希校验仍为 `^[0-9a-f]{32}$` |
| D 测试有效性 | **PASS（含反事实）** | 71/0；隔离副本上撤销 4 处修复分别命中 5/5/1/3 项失败，见 §5 |
| E 备份真实性 | **PASS** | 本轮备份 7 文件大小/哈希与报告表一致；上轮"修改前"已改称"中间快照"并回改旧报告（现 18,820 B，含"中间快照"字样） |
| 云端风险 | **PENDING** | 索引 `ix_retention_mark_order` 未建、触发器未建、真实原子性与限流未验 |
| Git 状态 | **PASS（无副作用）** | 本轮只读；新增仅 7 份备份目录 + 1 份 Codex 报告 + 本报告 |

## 3. A/B 细节：失败、恢复与并发

### 3.1 失败时的状态

自写脚本（两条到期记录，第 2 次 `upload_logs.add` 注入失败）：

```
run1 {"code":"LOG_FAILED","selected":2,"marked":1,"markedAudited":0,
      "auditFailedCount":1,"skipped":0,"conflicts":0,"failed":0,"unprocessed":1}
a: expired  retention.audit.state=pending  markedRev=2  eventId=retention_mark_ab111f21…
b: pending   logs=2（prepare + complete）
```

- 状态已转换、审计未落：`a` 带 `state='pending'`，**可被检出**（不再是"转换了但没有任何痕迹"）。【验】
- 计数不再吞掉：`marked=1` 与 `attempts/selected=2` 的差值由 `auditFailedCount+unprocessed` 解释；旧的"attempts=2 但只有 marked=1、其余全 0"缺口**已消失**。【验】

### 3.2 恢复路径与五个追问

| 追问 | 结论 | 依据 |
|---|---|---|
| 如何发现仍需补审计 | **人工**：调用 `{action:'recover',submissionId}`；schema 注记"自动扫描仍待索引验收"，代码中**无扫描入口** | 【静】`main` 仅 `mark`/`recover`；`retention.audit.state` 无索引 |
| 补偿自身失败能否继续 | **能**：恢复失败不改标记，下次仍可重试；写日志失败后按 `_id` 回读确认"回执丢失" | 【验】F4 与自写脚本 |
| 重复恢复是否重复写/覆盖 | **不会**：`ADD_ALREADY_PRESENT` → 读回逐字段比对 → 清除标记；再调返回 `ALREADY_RECOVERED` | 【验】实测第二次返回 `ALREADY_RECOVERED`，日志仍 3 条 |
| 重启/中断后依据是否还在 | **在**：标记里含 `eventId/markedRev/day`，事件 ID 由 `(id,rev)` 确定性生成，可重算比对 | 【静】`recordEventId` 稳定 |
| 恢复与标记并发是否安全 | **本地模拟通过**：清除标记的条件更新含 `_id/status/rev/retention.audit.eventId/state=pending`，冲突回读判定 | 【拟】单线程假 DB |

### 3.3 T-1 与 T-2 的边界（不混淆）

T-1 只做"到期标记"（`pending → expired`）与审计补记；**不清空正文、不删除记录**。T-2 的正文清理仍未实现，本轮未把 T-2 的任何语义算作 PASS。

## 4. Schema 与真实写入的字段级对照

| 字段 | schema 要求 | 实际写入（批次/逐条） | 结论 |
|---|---|---|---|
| `action` | 单键（本轮由 2 键去重） | `'retention_mark'` | ✅ |
| `event` | 枚举含 `retention_mark`（共 9 值） | `prepare`/`complete`/`retention_mark` | ✅ |
| `at` | `date`，注"所有运行日志均填写" | `db.serverDate()` | ✅ |
| `rev` | `1`，注"所有运行日志填写 1" | 字面 `1` | ✅ |
| `actor.role` | 枚举含 `system` | `'system'` | ✅ |
| `actor.openidHash` | `string\|null`，`pattern ^[0-9a-f]{32}$`（null 时不适用） | `null` | ✅ |
| `submissionId` | `string\|null` | 批次 `null`；逐条为投稿 ID | ✅ |
| `result/errorCode/day` | 既有 | 一致 | ✅ |
| `_id` | — | 逐条 `eventId`（稳定，防重复追加） | ✅ 额外收益 |
| `expired` | `submissions.status` 枚举 | `review/index.js:44-49` 与 `STATUS_VALUES` 均含 | ✅ |
| 索引依赖 | `ix_retention_mark_order(status,createdAt,_id)` | 已声明，**云端未建** | 【云】PENDING |

未发现"放宽校验以通过测试"的迹象：普通用户 `openidHash` 的 `pattern` 仍严格，`null` 只对 `system` 角色开放（schema 注记明确）。

## 5. 测试有效性（反事实验证）

在 `%TEMP%\ret_cf` 复制项目文件后**只改副本**：

| 撤销的修复 | 结果 | 命中的用例 |
|---|---|---|
| 恢复查询的 `status` 过滤 | 66 通过 / 5 失败 | D1/D2/D3/D5/E2 |
| 空 payload 不再跳过 | 66 / 5 | B2/B8/B9/B12/E1 |
| `unprocessed` 固定为 0 | 70 / 1 | F1（恒等式） |
| 去掉稳定 `_id` | 68 / 3 | F4/F7/F7b |

→ 新测试不是"只检查不抛异常"，能定位到具体缺陷。【验】

## 6. 备份与历史文本真实性

- 本轮备份 `项目/tools/_backup/retention-audit-20261029-20261029T0615109693621Z/`：7 文件，大小/哈希与报告表逐项一致（`retention` 7,831 `0740D71E…`、`test` 15,929 `2B64F8B3…`、两份 schema 6,049/3,189、设计稿 51,005、`ugc_fake_cloud` 9,259、旧 P0 报告 18,602 `932CA8CD…`）。
- 上一轮"修改前"备份的定性已修正为**中间快照**（测试里已含 B2/B8 新预期、缺 E 段），旧 P0 报告已就地更正（现 18,820 B，含"中间快照"字样），未被覆盖删除。
- 设计稿：§3.5.2 起注明"2026-10-28 已裁决"；`:265` 八字段与 `at/rev` 规则；`:277` 计数模型（`marked=markedAudited+auditFailedCount`，六项和 = `selected`）并自述"自动发现仍需云端查询/索引验收"；`:150/:409/:410/:595` 均已同步；未重新打开已裁决问题（如期限 30/90/180 仍为既定）。

## 7. 仍存在的缺口与建议

### P0（阻断"本地审计可靠性 PASS"的）

无。审计失败可恢复、计数无遗漏、schema 与写入一致、测试有效这四项均成立。

### P1（阻断"线上可用"）

1. **无自动发现入口**：恢复必须人工给 `submissionId`；`retention.audit.state='pending'` 无索引、无扫描动作 → 建议增加只读 `recoverPending`（分页扫描 pending 审计标记）并先建索引。 schema 已自述该限制，属已知待办而非隐瞒。
2. **真实并发/原子性未验证**：F5/F6/F7b 是单线程假 DB 上的两个实例；真实 CloudBase 的条件更新并发行为、日志集合唯一 `_id` 冲突语义、限流均未验。
3. **部署与触发器**：`retention` 未部署、无云函数定时触发器（全仓无 `triggers`），线上不存在自动标记。

### P2（建议但非阻断）

1. `recover` 成功路径只经 `__test__` 覆盖，`main({action:'recover',maintenanceToken})` 成功路径无用例（F9 只测无令牌 403）。
2. 恢复动作不写批次审计行，只有逐条日志；运维侧无法直接看出"谁在何时跑了恢复"（可用 `at != day` 间接识别）。
3. 清除待补标记的更新不改 `rev/updatedAt`，其他写者不会感知该变化（影响有限，但破坏"rev 单调反映任何写入"的直觉）。
4. `recoverAudit` 对 `audit.day` 只做 `^\d{4}-\d{2}-\d{2}$` 形状校验，未校验日期真实性（生产数据由系统写入，风险低）。

## 8. 复现命令与结果

```
node tools/test_retention_mark.js        → PASS 71 / FAIL 0，exit 0
node tools/test_ugc_review.js            → PASS 86 / FAIL 0，exit 0
node tools/test_ugc_submit.js            → PASS 110 / FAIL 0，exit 0
node tools/test_ugc_client_contract.js   → PASS 90 / FAIL 0，exit 0
node tools/check_eol.js                  → 61 文件，违规 0，exit 0
node tools/test_check_doc_refs.js        → 51/0，exit 0
git diff --check                         → exit 0（CRLF 警告 1 处，非致命）
```

独立复现与反事实脚本均在 `%TEMP%`，未写入项目。

## 9. 三个结论

1. **本地 Retention 审计可靠性：PASS**（范围限定：本地实现 + 本地模拟 + 静态分析；不含真实云端原子性、自动发现、部署与触发器）。
2. **剩余阻塞项**：P0 无；P1 三项（自动发现入口与索引、真实并发/原子性验收、部署与触发器）；P2 四项（见 §7）。
3. **是否建议进入 T-2 正文清理**：**建议进入"实现 + 本地测试"阶段，不建议直接上云**。理由：T-2 依赖"标记完成后再清正文"的顺序，而当前恢复链路的**发现环节仍需人工**；若先在云端跑 T-2 而不同时补 `recoverPending` 与索引，一旦出现日志写失败，只能靠人肉指出 `submissionId`。建议顺序：补自动发现入口 → 建 `retention.audit` 索引 → 部署 + 触发器隔离环境验收 → 单条真实恢复演练 → 再开 T-2。

## 10. 边界声明

本次只读执行：未修改任何项目文件、schema、测试、契约或设计稿；未执行 Git 写操作；未部署/调用云函数、未创建触发器、未改动权限或环境变量；未生成正式产物；未改动 `verifyStatus`、ID 映射或审批文件；未批准/拒绝/删除投稿。新增文件仅本报告。
