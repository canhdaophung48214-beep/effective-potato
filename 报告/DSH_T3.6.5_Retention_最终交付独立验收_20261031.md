# DSH T3.6.5 Retention 最终交付独立验收（2026-10-31）

> 审查人：DSH（独立验收，只读）。审查对象：`T3.6.5`（DEFERRED 最后两类 P1 闭环）。
> 本轮**未修改**任何项目文件、**未执行** Git 写操作、**未触碰**云端资源或数据。

## 0. 结论

**PENDING —— T3.6.5 的交付物在磁盘上不存在，无法按交付内容验收。**

- 2026-10-31 13:43:08–13:46:34 连续 5 次全树检索（`报告\`、`项目\`、`备份\`，匹配 `T3.6.5`/`T365`/`t365`）**均为 0 命中**。
- 项目最新字节仍是 **T3.6.3**：`项目/cloudfunctions/retention/index.js` = **95,575 B / `3B54B15583960D9BEEDB706F830FD48F6AA6D22EAB8D0DC0138E992E87975CF0` / 2026-10-31 00:15:26**。
- Git：`HEAD 274ebd6`、分支 `main`、暂存 0、`status --short` 101 行、`-uall` 346 行（与 T3.6.3 验收时相同，00:16 之后无新增文件）。

因此本轮**不能**对 `T3.6.5` 的 6 项声明作出 PASS/FAIL 判断；下文的复核只针对"当前磁盘字节"，用于说明风险基线，不代替 T3.6.5 验收。

## 1. 交付核验（应到 vs 实到）

| 应交付物 | 期望路径 | 实测 |
|---|---|---|
| T3.6.5 实施报告 | `报告/Codex_T3.6.5_Retention_最终闭环_20261031.md` | **不存在** |
| 精确差异补丁 | `报告/Codex_T3.6.5_精确差异_20261031.patch` | **不存在** |
| 原始测试输出 | `报告/Codex_T3.6.5_最终回归原始输出_20261031.txt` | **不存在** |
| skipped 专项测试 | `项目/tools/test_retention_t365_skipped_recovery.js` | **不存在** |
| 不可恢复专项测试 | `项目/tools/test_retention_t365_unrecoverable.js` | **不存在** |
| 修复回归测试 | `项目/tools/test_retention_t365_repair_regression.js` | **不存在** |
| 设计变更说明 | `项目/docs/RETENTION_T365_DESIGN_20261031.md` | **不存在** |
| 改前备份目录 | `备份/<新目录>/` | **无新增**（最近仍为 `T3_6_3_retention_20261030_235512_453`） |

检索证据（逐次）：`13:43:08 / 13:43:49 / 13:44:30 / 13:45:11` 轮询 4 次 + `13:46:34` 终检，全部 `NONE`。

## 2. 当前字节的只读复核（不代替 T3.6.5 验收）

用现有夹具（`项目/tools/retention_t363_fixture.js`）在当前 `index.js` 上复跑三条链路：

### 2.1 audit.pending 端到端 —— PASS（机制已存在）

```
purge   : {"code":"PURGE_DEFERRED","purged":1,"deferredAudit":1}
recover : {"ok":true,"code":"OK"}
resolve : {"ok":true,"code":"RESOLVED_DEFERRED"}
reconcile: {"ok":true,"code":"OK","counts":{"closed":1,"outcomes":{"DEFERRED":1}}}
nextPurge: {"code":"PURGE_DEFERRED","purged":0,"gateBlocked":false}
```

即：待补审计的批次可被恢复事件解除阻断，闸门恢复放行（续跑仍受 defer 时间约束，非阻断）。

### 2.2 真实 skipped 记录 —— **P1（当前字节未闭环）**

唯一能被查询选中、却触发 `SKIPPED_RECHECK` 的真实形状是 `rev: 0`（查询只过滤 status/payload，skip 条件含 `rev < 1`）：

```
seed      : {_id:"R0", status:"expired", rev:0, payload:{...}}
purge     : {"code":"PURGE_DEFERRED","skipped":1,"revAfter":1}
resolve   : {"ok":false,"code":"DEFERRED_EVIDENCE_INVALID"}   // manifest 校验要求 item.rev>=1
reconcile : {"ok":false,"code":"RECONCILE_DEFERRED"}
```

T3.6.3 的专项测试用夹具预置 `rev:2` 的合成 skipped 批次（代码不可能产出该形状），因此 `RESOLVED_DEFERRED` 只对合成形状成立；**真实 skipped 批次永远不可恢复**，且无 override 入口。

### 2.3 记录被外部清掉 / 状态被改 —— **P1（当前字节未闭环）**

```
purge     : PURGE_DEFERRED
resolve   : {"ok":false,"code":"DEFERRED_RECORD_CHANGED"}
reconcile : {"ok":false,"code":"RECONCILE_DEFERRED"}
retry     : {"ok":false,"code":"DEFERRED_RECORD_CHANGED"}   // 同码，退避重试无效
```

全仓检索 `force|abandon|override|UNRECOVERABLE|terminal|waive`（`cloudfunctions/retention/index.js`）：**0 命中** → 该 DEFERRED 批次永久留在历史里，`completeAuditReconcile` 的每批 `RESOLVED_DEFERRED` 断言使**全局清理永久阻断**，只能人工改库。这是"运营/外部清理"这一常见场景的硬阻断。

### 2.4 混合批次（成功 + 待补审计）—— PASS

```
purge: PURGE_DEFERRED(purged=1, deferredAudit=1) → recover OK → resolve RESOLVED_DEFERRED
     → reconcile OK(closed=1) → nextPurge 不因闸门阻断
```

## 3. 六项判定（对 T3.6.5 声明）

| # | 声明 | 判定 | 说明 |
|---|---|---|---|
| 1 | skipped → 恢复 → 对账 → 清理 | **PENDING** | 交付缺失；当前字节上真实 skipped 反而不可恢复（§2.2） |
| 2 | audit.pending → 恢复后不再阻断 | **PENDING** | 交付缺失；当前字节行为 PASS（§2.1），但无本轮证据 |
| 3 | 原有日志字节不变、只追加恢复事件 | **PENDING** | 交付缺失，未取得本轮字节 |
| 4 | RESOLVED_DEFERRED 证据可从历史派生 | **PENDING** | 交付缺失 |
| 5 | rev 漂移/部分失败/锁释放失败安全失败 | **PENDING** | 交付缺失；当前字节 `DEFERRED_RECORD_CHANGED` 永久阻断（§2.3） |
| 6 | 生产入口关闭、幂等与回归保持 | **PENDING** | 交付缺失；当前字节回归全绿（T3.6.3 验收记录） |

**整体 T3.6.5：PENDING（交付缺失）。** 按"任何一项 P1 即不得整体 PASS"的验收纪律，即使后续交付到位，也需先关闭 §2.2、§2.3 两类不可恢复路径。

## 4. 需要 Codex 补交的最小证据包

1. 上述 7 个路径的文件（含字节大小与 SHA-256），以及改前备份目录的 manifest。
2. 三条命令的原始输出（完整 stdout + exit code）：`test_retention_t365_skipped_recovery.js`、`test_retention_t365_unrecoverable.js`、`test_retention_t365_repair_regression.js`；以及 T3.6.3 既有 26 个脚本的全量回归输出。
3. 反事实目录：撤销"skipped 恢复"与"不可恢复放行"修复后的失败清单（含 FAIL 行原文）。
4. 设计文档中"RESOLVED_DEFERRED 证据派生"的字段级说明（manifest → resolution.stats → seal 的逐字段来源）。

## 5. 副作用与状态

- 项目文件：**零修改**（本轮只读；临时脚本在 `%TEMP%`）。
- Git：`HEAD 274ebd6`、分支 `main`、暂存 0、工作区 101 行（15 tracked + 86 untracked）、`-uall` 346 行；未执行任何 Git 写。
- 云端：0 调用 / 0 写入 / 0 部署 / 0 索引或权限变更。
- 正式产物：`records.json`、`records_blockers.json`、`gen-manifest.json` 仍不存在；`id-map.json` 未变。

**结论一句话**：T3.6.5 未交付（7 个应到文件 0 命中），本轮只能给出 PENDING；在当前 T3.6.3 字节上，§2.2 真实 skipped 与 §2.3 外部清理两类 P1 仍无恢复路径，必须随 T3.6.5 一并关闭。
