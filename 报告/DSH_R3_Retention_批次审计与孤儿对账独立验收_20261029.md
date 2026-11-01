# R-3 Retention 批次审计与孤儿 prepare 对账：DSH 独立验收

日期：2026-10-29　验收人：DSH（独立，非实现者）
对象：`cloudfunctions/retention/index.js` 的 `reconcile` 只读对账、恢复批次日志、`upload_logs` schema、`tools/test_retention_reconcile.js`

## 0. 结论

| 维度 | 结论 |
|---|---|
| 本地批次审计（恢复批次 prepare/complete、operation、重复、计数） | **PASS（本地假库）** |
| 本地孤儿 prepare 对账（含边界、截断、反向孤儿） | **PASS（本地假库）** |
| 计数与异常恢复 | **PASS（本地），含 2 项语义观察** |
| 鉴权与只读性 | **PASS** |
| 测试有效性 | **PASS（有 2 个未覆盖缺口，见 §6）** |
| schema 与契约/设计稿一致性 | **PASS（本地声明），索引真实存在 PENDING** |
| 真实云端能力 | **PENDING** |

**没有发现 P0。** 发现 3 项 P1（§7），其中"FAILED/PARTIAL 批次被归为 closed"是可观察性问题，不改变数据，但会让运维误判。

## 1. 基线、备份与范围

- Git：`HEAD 274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、分支 `main`、暂存 0、`git status --porcelain` 85 行、`--untracked-files=all` 325 行（15 tracked 修改 + 310 未跟踪）、`git diff --check` exit 0（仅 `project.config.json` 的既有 CRLF 警告）。
- 本轮我未改任何项目文件、未执行 Git 写、未触云、未部署、未建索引。
- 备份（项目与仓库外）：`备份\R3_retention_reconcile_20261029_20261029T0748217606981Z\`，逐文件实测：

| 备份文件 | 字节 | SHA-256 前 16 位 | 与"改前"一致 |
|---|---:|---|---|
| `cloudfunctions__retention__index.js` | 25,238 | `45F304842FA50044` | ✅ |
| `config__cloud__schema.upload_logs.json` | 3,499 | `958A128870B15A15` | ✅ |
| `docs__UGC_MVP_DESIGN_FINAL_20261026.md` | 53,541 | `3EC63B957450A53A` | ✅ |
| `tools__test_retention_recover_pending.js` | 7,043 | `F44BDA77C359A524` | ✅ |
| `tools__ugc_fake_cloud.js` | 10,483 | `853970B2BEFD31C4` | ✅ |

- 当前文件：`retention/index.js` **36,615 B / `7644D3F8…`**；`schema.upload_logs.json` **3,949 B / `FE9274F1…`**；`schema.submissions.json` 未变 8,489 B / `954D2E28…`；`test_retention_reconcile.js` 新建 10,499 B / `37F63B60…`；`test_retention_mark.js` 未变 22,398 B；设计稿 55,306 B / `399D87A9…`。
- 冻结件未变：契约 256,751 B `CA18C91E…`、`gen_records.js` 144,262 B `5B349419…`、`id-map.json` 42,990 B `4478C976…`、`test_records_spec.js` 337,743 B `0CB19A13…`。

## 2. 实现审查（逐条对源码）

`reconcile` 入口：`main` `:724-739` 先动作白名单（含 `reconcile`）→ `hasValidMaintenanceToken` → 再分发；`reconcileBatches` `:631-722`。

- 分页：单事件 `eventType∈{retention_mark,retention_purge}`（`:636`）；`pageSize≤50 / maxRows≤500 / cursor≤128`（`:644-647`）；`where({event,_id:_.gt(cursor)})` 按 `_id` 升序（`:656-659`）；重复/回退 `_id` → `UNSTABLE_SCAN`（`:663-665`）；到上限多读 1 条判断 `truncated`（`:670-674`）。
- 分组：`operation + batchId`（`:684-696`）；旧日志无 `operation` 时按 `eventType` 推断 `mark`/`purge`（`:628`）。
- 状态：重复半（`prepare>1` 或 `complete>1`）→ `duplicate`（`:698`）；缺半 → 未完整扫描为 `unmatchedWindow`、缺 prepare 为 `completeWithoutPrepare`、prepare 起满 600000ms（等号算到期）为 `suspectedOrphan`、否则 `running`（`:699-703`）；双方在 → `day` 不同 / `selected` 不同 / complete 早于 prepare / complete 计数不守恒 → `countMismatch`（`:704-707`）；否则完整扫描 `closed`、截断窗口 `pairedWindow`（`:708`）。
- 返回：`batchRef = sha256(eventType\0operation\0batchId).slice(0,24)`（`:710-711`）；`ok = !hasAnomaly && completeScan`；`code = completeScan ? (hasAnomaly?RECONCILE_ANOMALIES:OK) : SCAN_TRUNCATED`（`:714-717`）。
- 批次日志：`writeRunLog` `:90-127`；每条携带 `schemaVersion/event/action/submissionId=null/day/at/rev=1/actor{role:'system',openidHash:null}/result{code,stats}`；`batchId = requestId || randomBytes(16).hex`（mark `:484`、recoverPending `:221`、purge `:400`、recoverPurgePending `:349`）。
- 只读：`COL.LOGS` 仅 `where/orderBy/limit/get`（`:656-680`）；仓库内 `upload_logs` 无 update/remove（更新全部落在 `COL.SUBMISSIONS`）。

## 3. 我实际运行的结果

| 命令 | 通过 / 失败 / 跳过 | 退出码 |
|---|---|---:|
| `node tools/test_retention_reconcile.js` | 23 / 0 / — | 0 |
| `node tools/test_retention_mark.js` | 71 / 0 / — | 0 |
| `node tools/test_retention_purge.js` | 18 / 0 / — | 0 |
| `node tools/test_retention_recover_pending.js` | 13 / 0 / — | 0 |
| `node tools/test_ugc_review.js` | 86 / 0 / — | 0 |
| `node tools/test_ugc_submit.js` | 110 / 0 / — | 0 |
| `node tools/test_ugc_client_contract.js` | 90 / 0 / — | 0 |
| `node tools/test_index_state.js` | 205 / 0 / — | 0 |
| `node tools/test_pages.js` | 106 / 0 / — | 0 |
| `node tools/check_eol.js` | 61 文件 / 0 违规 | 0 |
| `node tools/test_check_doc_refs.js` | 51 / 0 | 0 |
| `git diff --check` | 通过（仅 CRLF 警告） | 0 |

## 4. 独立探针（自有脚本，不跑其测试）

| 探针 | 结果 | 判定 |
|---|---|---|
| P1 prepare/complete `day` 不同 | `countMismatch` | 边界正确 |
| P2 complete.at 早于 prepare.at | `countMismatch` | 正确 |
| P3 非法 `eventType` | `INVALID_EVENT` | 正确 |
| P4 `pageSize=51` / `maxRows=501` / cursor 129 字符 | `INVALID_SCAN_OPTIONS` | 正确 |
| P5 空日志集 | `OK, ok=true, scanned=0` | **观察项**：无数据也判"通过" |
| P6 `FAILED` 但计数守恒 | `closed` | **观察项**：失败批次被并入闭合 |
| P8 经 `main` 只读 | docs/update/remove/add 前后全同 | 正确 |
| P9 maxRows 恰等于行数 | `truncated=false, completeScan=true` | 正确 |
| M1 经 main：20 分钟前 prepare | `suspectedOrphan` | 正确 |
| M2 经 main：9 分钟前 prepare | `running`、`OK` | 正确 |
| M3 经 main：孤儿+闭合+无 prepare | `suspectedOrphan:1 / closed:1 / completeWithoutPrepare:1` | 正确 |
| M4 经 main：maxRows=4 > 5 行 | `SCAN_TRUNCATED` + `nextCursor` | 正确 |
| M5 经 main：maxRows=5 = 5 行 | `OK, completeScan=true` | 正确 |

（探针踩过一次坑：用固定 `now=12:00Z` 而实际时钟 08:0xZ，导致 `at` 落在"未来"被判 `invalidLogs`——这是探针时间不一致，不是实现缺陷；改用真实时间后正常。）

## 5. 变异测试（隔离副本，不动主工作区）

在 `%TEMP%\r3mut2` 的全量副本上改源码后跑其测试，再还原：

| 变异 | 结果 | 说明 |
|---|---|---|
| M1 孤儿阈值改为 `>=0` | **FAIL C3**，exit 1 | 边界用例有效 |
| M2 `code` 恒定 `OK` | **PASS 23/0，exit 0** | **缺口**：没有任何用例断言 `code === 'RECONCILE_ANOMALIES'` |
| M3 截断状态改为 `closed` | **FAIL C9、C10**，exit 1 | 截断语义用例有效 |
| M4 `ok` 去掉 `&& completeScan` | **PASS 23/0，exit 0** | **缺口**：没有用例断言"截断时 `ok===false`" |
| M5 关闭重复半检测 | **FAIL C5**，exit 1 | 重复检测有效 |

## 6. 测试有效性评估

- 有效：边界（C2/C3）、重复（C5）、计数（C6）、坏字段（C7）、分页/截断（C8/C8b/C9/C10）、内部故障（C11）、鉴权（C12）、只读（C13）、两种恢复批次（C15–C17）、日志失败（C16/C20）。
- 未覆盖（可本地补，不涉云端）：
  1. `code` 取值（异常时必须是 `RECONCILE_ANOMALIES`）；
  2. `ok` 在 `SCAN_TRUNCATED` 时必须为 `false`（M4 证明现测不出）；
  3. `FAILED/PARTIAL` 批次的可见性（见 P1-3）；
  4. 空日志集是否算"通过"的业务约定。
- C12 只断言"零数据库调用"，未断言两种集合都零访问（近似可接受）。
- C18 对 `appendOnly` 的检查是"schema 字符串包含 update/remove"，不是对真实 API 的拦截测试（本地假库也无拦截能力），属 PENDING。

## 7. 风险与判定

**P0：无。**

**P1（三项）**
1. **无调度/触发器**：`cloudfunctions/retention/` 无 `config.json`，仓库内除 `config/ugc.js` 的常量外无调用方；`reconcile` 与 `mark/recover` 目前只能人工以维护令牌调用。云端定时任务与令牌配置属部署阶段。
2. **云端索引与 `_id gt` 分页未验**：本地新增 `ix_retention_reconcile_event_id(event,_id)` 仅是 schema 声明（`_meta.status=pending_admin_console_verification`）；`_id` 范围 + 升序排序在真实索引下的行为、超过 500 条的全量对账均未验证。
3. **失败批次被并入 `closed`**：`complete` 的 `code=FAILED/PARTIAL` 只要计数守恒就判 `closed`（P6 实测）。对账结果因此看不到"这批恢复曾经失败"。建议在 counts 增加 `failedBatch`（读 `complete.result.code`），或在 batch 项保留 `completeCode`。

**P2（四项）**
1. 空日志集返回 `ok=true`（P5），运维可能误读为"对账通过"；建议返回 `empty:true` 或约定"空集不算通过"。
2. `invalidLogs` 只计数不列样本，排障需要人工重查。
3. `reconcile` 不写自身运行日志（只读设计使然，但"谁在何时跑过对账"没有审计痕迹）。
4. `reconcileBatches` 与 `main` 的 `now` 均取本机时间；跨时区部署/漂移会影响 `day` 判定，当前只在本机验证。

**已核实一致**：schema 批次 stats 与 `writeRunLog`/`batchLogInfo` 字段逐项对应；设计稿 §3.5.2 `:279-280` 已写明 R-3 阈值、鉴权、窗口限制与计数；`upload_logs` 仍只追加。

## 8. 五问

1. **本地 R-3 是否通过？** 是。批次审计、孤儿对账、鉴权、只读、计数闭合在本地假库上全部 PASS（23/0 及其它回归），证据为 §3/§4。
2. **是否有新的 P0/P1？** 无 P0；P1 三项：无调度/触发器、云端索引与分页未验、失败批次被并入 closed。
3. **R-1、R-2、R-4 是否仍然阻塞上线？** 仍然阻塞：R-1（隔离环境查询/索引未验）、R-2（未部署、无触发器、令牌与维护入口未配）、R-4（四条 retention 索引未建、Q4 多值排序未知）。R-3 通过不改变这三项的状态。
4. **哪些风险需隔离云环境验证？** 索引真实存在与查询计划、`_id gt` 分页与排序稳定性、超过 500 条的全局对账、两个函数实例并发、日志写回执不确定（timeout 但已落库）、定时触发器的重叠执行。
5. **下一项最小任务？** 在隔离环境（经负责人授权）建 `ix_retention_reconcile_event_id` 与 `ix_retention_audit_queue` 两条索引，跑 Q1–Q5 只读查询核验，并执行一次 `reconcile`（空库或 <500 条）确认 `ok/counts`；仍不部署、不启用触发器。

## 9. 边界声明

本次为只读独立验收：未修改项目文件、未执行 Git 写、未触云、未部署、未建索引或触发器；变异测试只在 `%TEMP%` 副本进行并已还原；临时探针脚本均在 `%TEMP%`，不属于项目交付物。
