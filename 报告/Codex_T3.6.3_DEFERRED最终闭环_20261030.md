# T3.6.3 DEFERRED 最终闭环：本地实施与验收

执行：Codex；复核：待 DSH。实际执行跨 2026-10-30/31 北京时间。**本地有证据的新批次恢复 PASS；真实 CloudBase 和无清单旧批次 PENDING。** 未调用云端，未部署、建索引或触发器，未改真实投稿、`verifyStatus`、映射、审批文件或冻结主套件；未执行 Git 写操作。生产 `main({action:'purge'})` 仍返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。

## 1. 结论与边界

| 要求 | 本轮结论 | 证据 |
|---|---|---|
| 普通 DEFERRED 有入口 | **PASS（本地、新证据批次）** | 维护令牌保护的 `resolveDeferredBatch`，测试 A4、D1 |
| audit.pending 补记后旧批次解阻 | **PASS（本地）** | A1–A7：补记、追加凭证、完整对账、新 batchId 清理 |
| 原日志只追加 | **PASS（本地）** | A5、D3；源码只对 `upload_logs` 使用 `add` |
| rev 漂移、不确定写入失败关闭 | **PASS（本地）** | A8、D6、I2、I9；旧 PARTIAL/FAILED 回归通过 |
| 伪造恢复凭证 | **PASS（本地 HMAC 与字段篡改）** | I3、I5，隔离变异 `allow_forged_resolution` 触发 I3 失败 |
| 重新对账后才解阻 | **PASS（本地）** | A4、D2、I3–I5；`completeScan` 闸门保持 |
| 新批次执行 | **PASS（仅离线模拟）** | A7、D5 |
| T3.6–T3.6.2 回归 | **PASS** | 相关旧套件退出码均 0 |
| T3.5 原 24 项逐项继承 | **PENDING** | 原测试与逐项清单不可恢复，不能宣称等价 |
| 生产入口 | **PASS（继续关闭）** | D7 |
| 真实云端能力及全局 TOCTOU | **PENDING** | 本轮禁止云端操作；本地假数据库不能证明跨实例原子性 |

原 `DEFERRED` outcome 不变。对账只在清单、原因、投稿复读、逐条日志、HMAC、计数和完整扫描均合格时派生 `RESOLVED_DEFERRED`；否则为 `UNRESOLVED_DEFERRED` / `BLOCKED_UNCERTAIN`，全局闸门继续阻断。历史批次缺少 manifest 或 `deferredReasons` 时，恢复器返回 `DEFERRED_EVIDENCE_INVALID`，不会伪造证据。skipped 正向测试使用带合法 HMAC 的**合成历史批次**；它验证恢复器，不证明当前真实 CloudBase 查询可产生同形批次。

## 2. 修改、精确差异与备份

精确逐文件 unified diff：[Codex_T3.6.3_精确差异_20261030.patch](Codex_T3.6.3_精确差异_20261030.patch)（54,935 B）。包含全部新文件；仓库中目标文件原本未跟踪，普通 `git diff` 不会显示它们，因此差异以**修改前逐字节备份 → 当前文件**生成。

| 文件（均在 `项目/`） | 作用 | 改前字节 / SHA-256 | 改后字节 / SHA-256 |
|---|---|---|---|
| `cloudfunctions/retention/index.js` | 记录延期清单、证据型恢复、派生状态和闸门 | 80,795 / `1b227760da40b068698d84468f48e6a6903f4451688ca8c2dce653cca03271e6` | 95,575 / `3b54b15583960d9beedb706f830fd48f6aa6d22eab8d0dc0138e992e87975cf0` |
| `config/cloud/schema.upload_logs.json` | 说明 `DEFERRED_RESOLUTION` 与字段语义 | 4,311 / `0461bc5ee745452871c839d69438a11a683efccb8081a6be020d6fd6a42a62ae` | 4,398 / `98b4c5b5b862a6f76596071a4030f9f0b48ae6552f7de1ae50104c80c7f5be51` |
| `tools/retention_t363_fixture.js` | 新增离线夹具 | 不存在 | 1,398 / `e8b51cf2f9386c2ea0b84a09cf6c32993f351fda19eee5169a9cc5d038e25823` |
| `tools/test_retention_t363_deferred_resolution.js` | skipped 清单、混合批次、rev 与新批次 | 不存在 | 4,903 / `0a301464aa053d11ffcff58d5e8f3373255f8b959277ad9a2424d876fa027cab` |
| `tools/test_retention_t363_audit_recovery.js` | audit.pending 正向恢复与幂等 | 不存在 | 3,167 / `0d3acda267639e633903b4b9a39e1426f43bca4c34511299c1c13b9424cf6600` |
| `tools/test_retention_t363_batch_integrity.js` | 缺清单、伪造、失败恢复、鉴权与闸门 | 不存在 | 6,788 / `5bb77d76838b7f01cae22f98fb6c098c0a5c01aab200505b12de2029a214f726` |
| `docs/RETENTION_T363_DESIGN_20261030.md` | 状态机、证据与限制 | 不存在 | 4,514 / `84dce07b6602cf2f2c0bda5cd93b4b9dcdc6c04d22494cbe4bdd3b78ab478817` |

原始备份在 `备份/T3_6_3_retention_20261030_235512_453/`，仓库及项目目录外。`manifest.txt` 记录上述两份已有文件；创建时逐字节核对源与备份相同，未覆盖旧备份。新增文件开工时不存在，故无“修改前备份”，没有伪称原文件。最终哈希与差异清单另见 `after_manifest.json`。

## 3. 原始测试输出与退出码

以下每行均为本轮实际执行的 `node <脚本>`；原始 stdout/stderr 分别保存在 `备份/T3_6_3_retention_20261030_235512_453/test_outputs/<脚本文件名>.txt`，机器摘要在同目录 `summary.json`。`test_retention_t34_resume.js` 的汇总格式为 `21 PASS, 0 FAIL`，单独按原始输出读取。`check_eol.js` 为检查 66 文件、违规 0，故无断言通过数。

| 脚本（`tools/` 下） | PASS / FAIL / PENDING | 退出码 |
|---|---:|---:|
| `test_retention_t363_deferred_resolution.js` | 8 / 0 / 0 | 0 |
| `test_retention_t363_audit_recovery.js` | 8 / 0 / 0 | 0 |
| `test_retention_t363_batch_integrity.js` | 10 / 0 / 0 | 0 |
| `test_retention_mark.js` | 71 / 0 / 0 | 0 |
| `test_retention_recover_pending.js` | 13 / 0 / 0 | 0 |
| `test_retention_purge.js` | 18 / 0 / 0 | 0 |
| `test_retention_reconcile.js` | 30 / 0 / 0 | 0 |
| `test_retention_audit_gate.js` | 16 / 0 / 0 | 0 |
| `test_retention_t34_resume.js` | 21 / 0 / 0 | 0 |
| `test_retention_t36_concurrency.js` | 15 / 0 / 0 | 0 |
| `test_retention_t36_repair.js` | 7 / 0 / 原套件标注历史正向恢复 PENDING | 0 |
| `test_retention_t36_resume.js` | 15 / 0 / 0 | 0 |
| `test_retention_t361_deferred.js` | 9 / 0 / 0 | 0 |
| `test_retention_t361_repair.js` | 12 / 0 / 0 | 0 |
| `test_retention_t361_lock_recovery.js` | 8 / 0 / 0 | 0 |
| `test_retention_t362_deferred.js` | 7 / 0 / 0 | 0 |
| `test_retention_t362_repair.js` | 4 / 0 / 0 | 0 |
| `test_retention_t362_discovery.js` | 5 / 0 / 0 | 0 |
| `test_retention_t362_scan_queue.js` | 4 / 0 / 0 | 0 |
| `test_ugc_review.js` | 86 / 0 / 0 | 0 |
| `test_ugc_submit.js` | 110 / 0 / 0 | 0 |
| `test_ugc_client_contract.js` | 90 / 0 / 0 | 0 |
| `test_index_state.js` | 205 / 0 / 0 | 0 |
| `test_pages.js` | 106 / 0 / 0 | 0 |
| `check_eol.js` | 66 文件 / 0 违规 | 0 |
| `test_check_doc_refs.js` | 51 / 0 / 0 | 0 |
| `test_records_spec.js`（只运行） | 290 / 0 / **11** | 0 |

另运行 `node --check cloudfunctions/retention/index.js`：退出 0；`git diff --check`：退出 0，仅报告既有 `project.config.json` CRLF 提示。目标未跟踪文件另用 `rg -n '[ \t]+$' <七个目标文件>` 检查尾随空白：退出 1（无匹配）。未把冻结主套件的 11 项 PENDING 改成 PASS。

## 4. 反事实测试与故障探针

在上述备份目录下的 `counterfactual/` 创建五份**项目外隔离副本**；仅改变隔离副本源码，原工作区不参与变异。每项均退出 1，且目标断言变红；逐项原始输出为各目录 `output.txt`，机器结果 `counterfactual/summary.json`。

| 隔离变异 | 预期被抓住的断言 | 实际 |
|---|---|---|
| 移除对账的恢复事件识别 | A4 | FAIL A4，exit 1 |
| 忽略 unresolvedCount（测试重算了合法 HMAC） | I5 | FAIL I5，exit 1 |
| 移除恢复时 rev 条件 | A8 | FAIL A8，exit 1 |
| 全局闸门只相信 `ok=true` | I8 | FAIL I8，exit 1 |
| 不核验恢复凭证 HMAC | I3 | FAIL I3，exit 1 |

故障注入还覆盖日志 `add` 失败后的重试（I6）、逐条审计身份篡改（I9）、两个独立函数实例并发写同一稳定凭证（I10）、原批次清单缺失（I1）、异常计数（I2）、未授权调用（I7）、rev 漂移（A8/D6）。阻断场景检查了正文和 rev 不变、没有虚假新成功批次；假数据库不等同真实云端。

## 5. 历史覆盖、Git 与剩余风险

T3.5 `tools/test_retention_scan_queue.js`：本轮再次查了可见 Git 历史、项目、`备份/`、`报告/`，无原文件或 24 条断言逐项清单。可见类别映射为：空扫描、501 截断与续扫、扫描中插入、坏游标，对应现存 `t362_scan_queue` 4 项及 T3.4/T3.6 续扫测试；其余原断言无法逐项恢复，**PENDING**。没有虚构 24 项已经继承。

Git 前后均 `main` / `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，暂存区为空。开工 `git status --porcelain=v1 -uall` 341 项（15 tracked 已修改、326 未跟踪）；结束 346 项（同 15 tracked、331 未跟踪），增加的是本轮 3 个测试、1 个夹具、1 个设计文档。`index.js`、schema 开工前已是未跟踪文件，未覆盖其旧工作内容。完整结束状态见备份目录 `git_status_after.txt`。仓库外新增主报告、精确 patch 和备份证据；项目内仅改表中目标。

剩余风险：真实 CloudBase 的查询、索引、条件更新和并发回执未验；全局审计扫描与正文 CAS 仍非单一事务，因此生产 purge 继续关闭。维护令牌轮换会使旧 HMAC 凭证无法验证，需要独立迁移设计。旧批次缺失清单、原因或审计证据时保持阻断；这不是自动强制解锁入口。合成 skipped 测试不替代真实查询实测。交 DSH 独立只读验收，本轮停止。
