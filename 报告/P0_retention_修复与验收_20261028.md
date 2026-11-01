# Retention P0 修复与验收（2026-10-28）

## 结果

**F-1/F-2/F-6：PASS（本地离线）**。T-1 到期标记已不依赖 `payload`，查询先筛 `pending` 再限制批次，按 `createdAt, _id` 稳定升序，更新条件含 `_id/status/rev`。每次可执行批次有 `prepare` 与 `complete` 两条运行摘要；成功更新另有逐条八字段逻辑投影。单条更新失败继续处理后续记录，终态区分 `COMPLETE`、`PARTIAL`、`FAILED`。系统日志省略 `actor.openidHash`，人工审核接口拒绝 `expire` 动作和 `expired` 驳回理由。

**T-2 正文清理：PENDING。** 本轮未增加不可逆清理代码。已在本地契约写明严格 `< now-30d`、覆盖 approved/rejected/expired、仍 pending 时先安全补标 expired 再清正文的规则；待清理流程、审计恢复策略和云端资源独立审查后实施。没有把 T-1 的本地 PASS 宣称为保留期整体已生效。

## 变更与精确 diff

完整逐文件 unified diff：[P0_retention_精确diff_最终_20261028.patch](P0_retention_精确diff_最终_20261028.patch)，32,126 字节，SHA-256 `7F0DBDA6C88FD7D94577C02FEC2CECA09F39759E1627C4FE91EACF1DFEAC29AD`。该 diff 由修改前独立备份与当前文件逐对生成；无 Git 写操作。初版、v2、v3 diff 均保留，未覆盖。

| 文件（相对 `项目/`） | 主要变化 | 修改前字节 | 修改前 SHA-256 | 修改后 SHA-256 |
|---|---|---:|---|---|
| `cloudfunctions/retention/index.js` | F-1/F-2、分批状态和审计；prepare/complete 共享 batchId；逐条审计失败仍尝试写 PARTIAL 批次尾；配置说明固定 29 天 | 6670 | `16856EECE005AF36CBB11BF55CF48A3C33A0BBE77ECE56AC425B50D296569E94` | `0740D71E2FFA4D88055B0BCE8120683321BFC9375FA20AEB43E78EABB321B169` |
| `tools/test_retention_mark.js` | 空正文、饥饿、排序、并发、失败、审计和 batchId 断言 | 6648 | `07C32142C3C27C02C2DD4A71534C2A564F3A56A2FC009957514A7522F08F4101` | `5C353374C3D2D73C7EF70771D5DA62046EB026D627BD1F6156634EA615E38BF5` |
| `tools/ugc_fake_cloud.js` | 多字段排序、单次失败及并发注入 | 8849 | `11252864EA880E9168D6E8479280517649B4CC92BED99BC1478DD625AE290433` | `3228C92351E4BFD8DC837D33BC56C67A01DA8963081070A9D2F5C717D3E602DB` |
| `tools/test_ugc_review.js` | 人工接口不可 expire 的负向测试 | 14663 | `A0547C99780CA21DE190FEDF60531DB9F4C48D48A62CAF9817AEFBE62907817E` | `D1762814E4AFF04943445904C0F8376EC9CC931AA181BD30BBD1E9EF30678B36` |
| `config/cloud/schema.submissions.json` | nullable payload、expired/expire、本地索引建议 | 5129 | `8E574D9D0AD57C2FE6297DE034567111EF23881A82AEBE0AA9388494C06CFBC1` | `B5E5D8BC939ECC17AFB6636B6E0E879900D8B7852380B4B14418BE5F072E68D5` |
| `config/cloud/schema.upload_logs.json` | retention_mark 事件、系统 actor 字段说明 | 3124 | `9BAA4A06D08942596AFC9CC7F6BF8E3D32CA116B8351FAEFE3C12257AD09B545` | `0DD50781D718C93329BEF320E8BBAE18085A71C32B0F571C265456E6DF5C36DD` |
| `cloudfunctions/review/index.js` | 加 expired 状态、移除人工 expired 驳回理由 | 18463 | `4EC044244472D8C8CDA4534CFE2435B134249701FBF24421BE6C1393DB9F58B5` | `25EC19AFA6172ACEA9A17460C87BFCBB018EE8C2B73EF4EB563786D79ABBB6AE` |
| `docs/UGC_MVP_DESIGN_FINAL_20261026.md` | 同步状态机与已裁决保留期规则 | 49278 | `53C0C8149FE262C17B2B616F7E1C43115B08DB714276771E76048A69664E3D58` | `EF985AC02633129315E646058F82F9DE1A0EADF81B884B8F0367970DB8156B0E` |

修改前备份均位于 `C:\Users\25975\Desktop\食神寻味小程序开发\备份\retention-p0-20261028-2329\`，文件名为相对路径以 `__` 连接。每份备份在修改前与原件逐一比对 SHA-256，全部一致；没有覆盖旧备份。

## 测试与副作用

| 命令 | 实际输出摘要 | 退出码 |
|---|---|---:|
| `node tools/test_retention_mark.js` | `PASS 56 / FAIL 0`，包括空 payload、批次饥饿、同时间跨批排序、并发、部分失败、审计失败及 batchId 对应 | 0 |
| `node tools/test_ugc_review.js` | `PASS 86 / FAIL 0` | 0 |
| `node tools/test_ugc_submit.js` | `PASS 110 / FAIL 0` | 0 |
| `node --check` 三个修改的 JS 文件 | 无语法错误 | 0 |
| 两份 schema `JSON.parse` | `schema JSON OK` | 0 |
| `node tools/check_eol.js` | 61 文件、0 违规 | 0 |
| `git diff --check` | 无错误；既有 `project.config.json` CRLF 提示 | 0 |

Git 实测仍是 `main` / `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`；暂存区为空，`status --porcelain=v1 --untracked-files=all` 为 306 行。此次修改均落在原本未跟踪的项目文件中，仓库状态行数没有因为这些文件内容变化而增加。没有触云、部署、创建集合/索引/触发器或生成正式产物；两条真实 pending 投稿未处理。

## 未覆盖风险与上线阻塞

1. `createdAt,_id` 双重排序需要对应复合索引；本轮仅在本地 schema 写出 `ix_retention_mark_order` 建议，**云端未获建索引授权且未验证平台执行计划**。因此 T-1 不可据本地 PASS 直接部署。新增索引资源审查通过前停止云端实施。
2. 单条状态更新成功后若逐条审计写入失败，函数返回 `LOG_FAILED` 并报告已更新数，但无法在同一数据库事务中自动补齐日志。需要独立设计补偿/告警与恢复验收，不能声称审计零丢失。
3. 永久损坏的最老 pending 记录在很小批次下仍可能占位；本轮能证明已审核旧记录不会饥饿 pending，不能证明永久失败记录不会阻塞后续批次。需明确隔离/游标策略及其存储授权。
4. T-2 清理、90 天明细轮转、180 天摘要清理、真实定时触发器、时区、云端权限和日志保留均未实现或未验收，整体保留期仍 **PENDING**。
