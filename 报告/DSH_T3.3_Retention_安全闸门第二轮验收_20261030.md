# DSH｜T3.3 Retention 审计安全闸门 —— 第二轮独立验收（2026-10-30）

验收人：DSH（独立审查人，非实现者）
被审报告：`报告/Codex_T3.3_Retention_审计安全闸门_20261030.md`（36,135 B / SHA-256 `6C7CE25C7C0931E5F63E3868855180B6E67040B0C496BEF67172A158905891`）
方式：只读；独立跑测 + 自有探针 + 隔离变异。未改项目文件、未触云、未 Git 写。

**前提核对**：本次交付前我上一轮判 PENDING（对象不存在）。本轮生产代码确有对应修改——`cloudfunctions/retention/index.js` 从 37,711 B `51CC315F…` 变为 **41,521 B / `3DBB96443008F824…`**（11:44），新增 `checkPurgeAuditGate`（`:403–432`）、`completeAuditReconcile`（`:381–401`），`purgePayload`（`:434`）在扫描候选前先做恢复与闸门；新增 `tools/test_retention_audit_gate.js`（10,640 B / `FA27B880…`）；`tools/test_retention_purge.js` 8,973→9,206 B（`32FCD743…`）。

## 一、判定

| 项 | 判定 | 依据 |
|---|---|---|
| 本地安全闸门 | **PASS** | PARTIAL/FAILED/DEFERRED/孤儿/截断/超时/缺失结果全部阻断，且维护入口不能绕过 |
| 正文保护 | **PASS** | 阻断路径 `payload` 逐字节不变、`rev` 不变、0 次 update、0 条新日志 |
| 恢复机制 | **PASS**（有界） | 恢复与重试未被削弱；恢复完成且无历史异常日志时闸门放行、可继续清理 |
| 并发安全 | **PENDING** | TOCTOU 本地可复现（闸门后插入 PARTIAL，清理仍执行）；无跨实例原子性证据 |
| 测试有效性 | **PASS** | 去掉闸门 → 14 项红；只信 `ok` 标志 → 12 项红；但冗余守卫单删不可检出 |
| 整体 T3.3 | **PASS（本地）** | 目标"审计未闭合不得清正文"在本地成立；云端与长期可用性仍 PENDING |

## 二、十问逐项证据

证据等级：【实测·我跑】【实测·我构造】【静态】【待云端】。探针脚本在 `%TEMP%`，不落项目。

| # | 问题 | 我的实测 | 结论 |
|---|---|---|---|
| 1 | 生产代码是否真改了 | 源码哈希/行号/备份三处一致；备份 `index.js` 37,711 B `51CC315F…` = 改前 | 是【静态】 |
| 2 | 独立跑测 | `audit_gate` 16/0、`purge` 18/0、`mark` 71 OK、`recover_pending` 13/0、`reconcile` 30/0、`review` 86 OK、`submit` 110 OK，exit 全 0 | 与 Codex 一致【实测·我跑】 |
| 3 | PARTIAL/FAILED 不清正文 | 探针 B：`closed=1` 的真实 PARTIAL 批次 → `AUDIT_GATE_BLOCKED/INCOMPLETE_OR_ANOMALOUS`，`payload` 字节相等、`updateCalls=0`、日志数不变；探针 C：FAILED 同样阻断；探针 L：DEFERRED 也阻断 | PASS【实测·我构造】 |
| 4 | 截断/超时/缺失失败关闭 | 探针 E：251 个干净批次（>500 条日志）→ `SCAN_TRUNCATED` → 阻断；F：`timeoutMs=5` + 悬挂 reconcile → `reason=TIMEOUT`；G：`undefined` 结果 → 阻断；I：恢复失败 → `RECOVERY_INCOMPLETE` 且正文不变 | PASS【实测·我构造】 |
| 5 | `closed` 含 FAILED/PARTIAL 仍阻断 | 与 3 同源：`counts.closed` 计入失败批次时，`completeAuditReconcile` 要求 `outcomes.PARTIAL/FAILED/DEFERRED` 全 0、`closed==outcomes.OK==batches.length`、逐批 `outcome:'OK'`，故阻断 | PASS【实测】 |
| 6 | 阻断前后 payload 字节一致 | 所有阻断用例均比较 `JSON.stringify(payload)` 的 UTF-8 字节 + `rev` + `payloadRedactedAt` + update 计数 + 日志条数，全部相等 | PASS【实测】 |
| 7 | 所有正文清理入口 | 全仓 `payload: null` 仅两处：`retention/index.js:494`（到期清理，已过闸门）、`review/index.js:439`（用户主动删除，独立语义、管理员动作）。`main` 的 `purge` 只传 `{requestId}`，云端事件无法注入 `testHooks` | 入口收敛【静态】 |
| 8 | 并发/TOCTOU | 探针 H：闸门扫描返回 OK 后插入一条 PURGE/PARTIAL 批次，清理仍 `code=OK, purged=1`、`payload=null`；再对账得 `RECONCILE_ANOMALIES` | **PENDING（窗口存在）**【实测·我构造】 |
| 9 | 恢复后能否重新清理 | 探针 N：真实待补标记 → `recoverPurgePending` `ok:true`、对账 `closed=1/OK` → 再 purge `ok:true`；探针 M：单行 `retention.audit=pending` 被跳过、其余行照常清理且不整批阻断 | 可恢复【实测】 |
| 10 | 虚假成功日志 | 阻断发生在 `writePurgeLog(prepare)` 之前，探针 K 实测阻断路径新增日志 0 条；失败返回 `ok:false` | PASS【实测】 |

**变异测试（隔离副本，项目文件未动）**
- M1 把闸门调用改为恒 `{ok:true}` → **2 PASS / 14 FAIL**，含 G-B/G-C/G-D/G-E/G-F2/G-L。
- M3 让 `checkPurgeAuditGate` 只信 `ok` 标志（绕过 `completeAuditReconcile`）→ **4 PASS / 12 FAIL**。
- M2 仅删 `outcomeKeys.slice(1)` 一行 → **16 PASS / 0 FAIL**：该检查与 `closed===outcomes.OK`、逐批 `outcome==='OK'` 冗余，单层删除不可检出（防御纵深，非缺陷，但测试无法证明每层独立生效）。

## 三、风险清单

**P1（进入真实环境前应处理）**
1. **TOCTOU 未闭环**（报告 §59-61 已自认）：闸门与清理不是同一事务；跨实例/崩溃批次可在两次只读之间产生。需要快照水位、或把闸门结论与清理条件绑定的持久屏障，并云端验证。
2. **历史失败批次永久阻断**（报告 §62 已自认）：`upload_logs` 只追加，任何一次 `PARTIAL/FAILED/DEFERRED`/孤儿 prepare 会让后续每次清理都阻断，且仓库内没有"解除/确认"工具。真实运行中第一次失败后 T-2 即停摆——安全但不可运营。
3. **500 行上限 + 5 秒超时**（报告 §63 已自认）：闸门不带游标续扫，日志超过 500 条（约 250 个批次或 500 条逐条日志）即永久 `SCAN_TRUNCATED`；云端延迟下 5 秒也可能常态超时。两者都会把"安全阻断"变成"永久阻断"。

**P2**
4. `tools/test_retention_purge.js` 的 P7/P8/P10/P17/P18 由"恢复后应清正文"改写为"阻断"，语义随闸门正确，但"失败→恢复→再清理"的正面路径只剩 G-J（短暂查询故障）与我这次探针 N，回归覆盖变薄。
5. `checkPurgeAuditGate` 超时后 reconcile 的 Promise 不会被取消，仍继续只读查询；无害但会占用配额。
6. 空数据环境（零批次日志）判 `OK` 放行——与"空结果不能证明历史无操作"（报告 §64）自相矛盾，属可接受的保守缺口，但应写入已知限制。

## 四、交付核对

- 备份 `备份\T3_3_retention_audit_gate_20261030_20261030T033443389307Z\` 两文件：`index.js` 37,711 B `51CC315F…`、`test_retention_purge.js` 8,973 B `D1C88EA9…`，与报告表逐字节一致；新测试无前态备份（原本不存在），报告已如实说明。
- 报告声明的改后哈希与实际一致：`index.js` 41,521 B `3DBB9644…`、`test_retention_purge.js` 9,206 B `32FCD743…`、`test_retention_audit_gate.js` 10,640 B `FA27B880…`。
- 其它检查：`check_eol` 61 文件 0 违规 exit 0；`check_doc_refs` exit 0（1642 OK / 77 歧义，未变）；`git diff --check` exit 0。
- Git：`HEAD 274ebd6`、`main`、暂存 0、`status --short` 86、`-uall` 326（较上轮 +1 即新测试）。

## 五、给负责人的结论

1. **本地安全闸门目标已达成**：审计未闭合时不再清正文，这一点可以判 PASS，且测试确实能发现闸门被移除。
2. **不建议仅凭本轮通过就进入真实环境**：P1 的 TOCTOU、历史失败永久阻断、500 行/5 秒上限，三项都会在真实运行中把"安全"变成"停摆"，需要先决定"谁来解除阻断、如何解除、是否接受停摆"。
3. 并发安全只能判 PENDING；云端任何"已原子"的表述都没有证据。
4. 需要负责人裁决的最小问题：①历史失败批次是否允许一次性"审计确认"解除；②是否接受"任何失败即停清理"的运营模型；③闸门是否改为带游标的分段对账（消除 500 行上限）。

---
声明：本轮只读（读码、跑本地套件、自有探针、隔离变异），未修改任何项目文件、未执行 Git 写、未调用或部署云函数、未读写云端数据、未生成正式产物。
