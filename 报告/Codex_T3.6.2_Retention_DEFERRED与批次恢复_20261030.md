# Codex｜T3.6.2 Retention DEFERRED 与批次恢复本地验收

日期：2026-10-30。执行人 Codex；独立验收 DSH。**仅本地实现；云端调用、部署、索引、触发器、真实数据写入均为 0。生产 `main purge` 仍返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。**

## 1. 逐项判定

| 项 | 结果 | 证据与限制 |
|---|---|---|
| A 可证明的非 LOCK_BUSY 延期 | **PASS（限定子类）** | `needsMark` 仅报告，不再使无关已审记录的批次 DEFERRED；未来 retryAfter 与 CAS 明确零更新且复读未变的记录写 `DEFERRED_RETRYABLE`，记录逐项原因与到期时间。到期后验证并追加修复，重新完整对账。 |
| A 其他 DEFERRED | **PENDING** | `audit.pending`、异常 skipped、写入回执不确定、部分已写入的混合 LOCK_BUSY 继续阻断；没有可证明的通用零写入清单与恢复事件，未降格处理。 |
| B 批次修复 | **PASS（新 purge 可证明批次）/ PENDING（旧证据不足批次）** | `repairPurgeBatch` 接受有完整证据的 `DEFERRED_RETRYABLE`，沿用 PARTIAL/FAILED 修复；未清记录 rev/status/正文 HMAC、审计与 held 锁逐条复核，rev 漂移拒绝。原始日志只追加；修复后再次完整对账。 |
| C 运维发现 | **PASS（本地）** | 新维护令牌保护的 `discoverPurgeBatches` 按 `_id` 有界分页，`batchRef` 定位 batchId，返回操作、结果、原因、时间和可修复提示，不返回正文、投稿 ID、令牌。真实数据库查询能力 PENDING。 |
| D T3.5 原 24 断言 | **PENDING** | 原文件和逐条断言清单未找到；不能声称 24 条已继承。按可见证据新建 4 条独立扫描测试，保留既有 T3.4/T3.6 扫描测试。 |
| E/F/G/H 既有保护 | **PASS（离线）** | T3.6/T3.6.1 全部回归通过；生产清理继续失败关闭。真实 CloudBase 并发和全局 TOCTOU 仍 PENDING。 |

## 2. 基线、备份与差异

开工实测 `main`、HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、暂存 0；`git status --porcelain=v1 --untracked-files=all` 336 条（15 个原有已跟踪修改、321 个未跟踪）。已读取 DSH T3.6.1 独立验收、当前 Retention 源码及测试。根目录的 `.baton/task.md`、`.baton/handoff/current.md`、`.baton/PROTOCOL.md` 未存在，本报告作为交接。

仓库外备份：`C:\Users\25975\Desktop\食神寻味小程序开发\备份\T3_6_2_retention_20261030_233702_886\`。四份原文件在修改前复制；`manifest.txt` 中的大小、SHA-256 与备份字节一致。新增 discovery 测试的 `intermediate` 副本是编写中的中间快照，非开工原件。

| 文件 | 原大小 / SHA-256 | 当前大小 / SHA-256 |
|---|---|---|
| `cloudfunctions/retention/index.js` | 72,452 / `C9BE61A1B030614A3A25F545E57B94ED26B6ABC644E2343D0C60408464424E74` | 80,795 / `1B227760DA40B068698D84468F48E6A6903F4451688CA8C2DCE653CCA03271E6` |
| `config/cloud/schema.upload_logs.json` | 4,269 / `F381B6F7A7FB259B861A4B421B59BE1B91049A7C2E11D1FA89E26AEF68DC2E16` | 4,311 / `0461BC5EE745452871C839D69438A11A683EFCCB8081A6BE020D6FD6A42A62AE` |
| `tools/ugc_fake_cloud.js` | 11,319 / `A98A9C1F85122464EC15B22AF8AB08F29CF9D2A7A6359906EFACA2D7E735E163` | 11,387 / `DBD4D02F19EC1175B8A23E06BFD242FE04ADEB53C11CD0EB53C83E0EF8AF6404` |
| `tools/test_retention_purge.js` | 9,335 / `4B1D6059F93DB01BE3171209A8F006CCD7C5212A621425313CA7564F402EFCE1` | 9,365 / `F06FBC82C92FDBEECD6040404C7D3CF626971413D32DB899B03D1AAEA775C787` |

新建：`test_retention_t362_deferred.js` 4,424 B `8B4C5CBF0E01D5EB5532B080DAF001E0A17D8A5609554908A327CFCA539AB583`；`test_retention_t362_repair.js` 2,684 B `5ED0C7BC7A83A61EDD6A1BC3DE8CD92F0DE41CF00189A33D180CDC972D1ED2BE`；`test_retention_t362_discovery.js` 2,559 B `52E1E36A9B65600055953281CEDD944AB41C7603EEFEF3407D68F8FFD018AA89`；`test_retention_t362_scan_queue.js` 2,543 B `28F9FD071730008E0A7EB79014835FAB130D62D498DA6B767219126F682419DC`；`docs/RETENTION_T362_DESIGN_20261030.md` 3,833 B `C69FBDCBCEBA406DDE9DEE0D9090933A665CFD43FA03F62B3D334881BEEE0714`。

完整 9 文件 unified diff：`报告/Codex_T3.6.2_精确差异_20261030.patch`，47,229 B，SHA-256 `9ABDD71E2D0A9F913A8E7DA6026A03DA29EDC8F2ACD5A7A860E945A8BCACB750`。用改前外部备份逐项比对；新增文件从空文件比对。P5 原断言曾将 `needsMark` 等同“清理批次失败”，本轮按已确定的独立 T-1 语义改成同时断言 `needsMark=1`、pending 正文/状态不变、已审候选批次成功完成，并未放宽正文保护。

## 3. T3.5 文件查找与覆盖映射

已搜索当前工作区与 `备份/`、可见 Git 历史 `git log --all -- tools/test_retention_scan_queue.js`、报告及文档，均无原文件或 24 条断言的逐项清单；DSH T3.6.1 报告仅记载“24 项、扫描队列/截断/空扫描”类别。故**原 24 项逐项等价性 PENDING**。可证实的映射：空扫描→新 Q1 与既有 T3.4 空窗口；501 截断/续扫→新 Q2 与 T3.4/T3.6 499/500/501/1001；扫描中插入→新 Q3 与 T3.6 S1/S2；损坏游标→新 Q4 与 T3.6 S4。其余原断言内容不可恢复，未编造名称或结果。

## 4. 测试、失败修复与反事实

首次完整回归原始输出：`报告/Codex_T3.6.2_回归原始输出_20261030.txt`。其中 T3.4 续扫 **20 PASS/1 FAIL**：修改签名末字符时非规范 Base64URL 仍可能解出原字节，导致损坏凭据测试偶发失败。代码增加 Base64URL 规范回写校验，保持原断言不变。最终完整回归原始输出：`报告/Codex_T3.6.2_最终回归原始输出_20261030.txt`，SHA-256 `FAB6D2EB64E44B129FAB74081F6DC6051280CA8910C5524740A22ABE8DE831ED`。

最终所有命令退出码 **0**：T3.6.2 四套件分别 **7/0、4/0、5/0、4/0**；T3.6.1 三套件 **9/0、12/0、8/0**；T3.6 并发/修复/续扫 **15/0、7/0、15/0**；T3.4 续扫 **21/0**；reconcile 30/0、mark 71/0、purge 18/0、recoverPending 13/0、审计闸门 16/0、review 86/0、submit 110/0、客户端契约 90/0、首页 205/0、页面 106/0；EOL 65 文件/0 违规、文档引用 51/0；冻结主套件 **290 PASS/0 FAIL/11 PENDING**；`git diff --check` 退出 0。源码、fake DB、四份新测试的 `node --check` 与 schema JSON 解析也均退出 0。

仓库外 `counterfactual/` 四项独立变异均 exit 1、各有 1 项 FAIL：移除未清记录 rev 比较→R1 红；重新让 needsMark 毒化批次→D1 红；移除维护令牌检查→F1 红；移除扫描末尾基数复核→Q3 红。变异只改隔离副本。正文未改与错误结果保持阻断的证据见 D1/D2/D4/D6/D7、R1/R2/R3、F5；原日志未更新或删除。

## 5. Git、副作用与剩余风险

收工仍为同一 HEAD、`main`、暂存 0，`status --porcelain=v1 --untracked-files=all` 341 条（原有 15 个已跟踪修改、326 个未跟踪；本轮新增四份测试和一份设计文档）。既有脏文件与未跟踪文件均保留；未执行 Git 写操作。无云端调用、部署、索引或触发器；未修改真实投稿、`verifyStatus`、ID 映射、审批文件、冻结生成器/主套件或正式产物。

**仍 PENDING：** audit.pending 的批次级延期恢复、混合 LOCK_BUSY 和无法证明零写入的 skipped/冲突；旧无清单批次的正向修复；T3.5 原 24 项逐项覆盖；真实 CloudBase 条件更新、排序、索引和全局审计/正文 TOCTOU。发现接口按页返回，未扫描全页时不保证全局唯一性；操作者为共享令牌下的 system，不能区分个人。以上均不得据本地测试宣布上线闭环。交 DSH 只读复核，本轮停止。
