'use strict';
const fs=require('fs'),path=require('path');
const results=JSON.parse(fs.readFileSync(path.join(__dirname,'test_results.json'),'utf8'));
const changes=JSON.parse(fs.readFileSync(path.join(__dirname,'change_manifest.json'),'utf8'));
const git=JSON.parse(fs.readFileSync(path.join(__dirname,'git_metadata.json'),'utf8'));
const count=p=>fs.readFileSync(path.join(__dirname,p),'utf8').trim().split(/\r?\n/).length;
const rows=results.map(r=>'| `'+r.command+'` | '+(r.exitCode===0?'PASS':'FAIL')+' | '+r.exitCode+' | '+(r.pass===null?'脚本无统一断言计数；见原始输出':r.pass+' / '+r.fail)+' |').join('\n');
const hashes=changes.map(r=>'| `'+r.file+'` | '+(r.beforeBytes??'新建')+' | '+(r.beforeSHA256??'不适用')+' | '+r.afterBytes+' | '+r.afterSHA256+' |').join('\n');
const content=`# T3.6.5 最终交付与双 P1 修复

执行日期：2026-10-31；执行与集成：Codex，实施子任务 Sol；独立验收：待 DSH。

## 判定

| 项目 | 状态 | 证据 |
|---|---|---|
| 真实 rev=0 skipped → 延期0→1 → resolution → reconcile → 新 purge | PASS（本地） | t365_skipped_recovery 调用实际 purgePayload 产生全部日志，无手造 rev2 |
| 外部删除、已清空、变 pending 的终态处置 | PASS（本地） | t365_unrecoverable 对精确文档读取的四种结果逐项验证 |
| pending 后恢复可清状态重新入队 | PASS（本地） | 同一投稿状态恢复后由普通候选查询清理，无永久排除标记 |
| rev 漂移后的新尝试 | PASS（本地） | 独立稳定 batchId、签名 attempt、重读与候选扫描双重版本核验、完整闸门 |
| 不确定读取/写入、缺 manifest、伪造日志 | PASS（继续阻断） | 新专项及六项隔离变异 |
| 原始 outcome / 历史日志不可变 | PASS（本地） | 新专项逐字节比较原 prepare/complete；只追加新事件 |
| 既有 audit.pending / LOCK_BUSY / repair / fencing / 分页 | PASS（本地） | 下表逐脚本退出码 |
| 生产清理与重试入口继续关闭 | PASS | 两入口均 PURGE_GLOBAL_FENCE_UNVERIFIED |
| 真实 CloudBase、跨文档全局原子性、索引与调度 | PENDING | 本轮零云端操作；未把模拟结果提升为生产保证 |
| 无证据历史批次及 T3.5 原24项逐项覆盖 | PENDING | 缺清单保持阻断；原24项未恢复，不宣称继承 |

## 实现与证据位置

根因是当前查询可选中 rev=0，而 skipped 条件要求 rev>=1。deferPurge 的条件更新实际将0递增为1，旧 resolver 又拒绝原清单的0。现在保留真实 skipped 路径，清单保存读取时的0，延期原因写 revBefore=0、revAfter=1；恢复接受明确的非负整数版本，缺失/null/负数/非整数不当作0。创建投稿仍为1，schema 明确兼容历史0。

源码 cloudfunctions/retention/index.js:736 的 exactDocumentAbsent 只识别精确 notfound 组合；:837 的 resolver 保留旧严格路径；:831 的维护令牌处置入口派生 RECORD_ABSENT、ALREADY_CLEARED、NO_LONGER_ELIGIBLE、REQUEUED_CURRENT_REV。读取异常返回 BLOCKED_UNCERTAIN。不存在记录仅记当前观察事实，不推断删除者。AUDIT_PENDING 仍需完整逐条标记日志，已清成功项仍需原有清理审计。

重试凭证由原 batchId+submissionId 生成独立稳定事件与新 batchId；:786 对账重新核验引用、签名及事件身份字段；:802 重试验证最新 rev/status/正文摘要，:1216 候选扫描再次核验，之后沿用完整审计闸门、租约和 CAS。生产调用继续失败关闭。新处置针对有完整证据的 DEFERRED；PARTIAL/FAILED 保留既有证据型 repair，不把不确定写入强行终结。

## 七件交付与备份

七件指定文件已落盘。每件的绝对路径、字节数、SHA-256、实际创建时间（UTC）统一记录在 [seven_artifacts_manifest.json](T365_evidence_20261031/seven_artifacts_manifest.json)。报告自身的哈希也在该独立清单中，避免自引用哈希。精确 unified diff 为 [Codex_T3.6.5_精确差异_20261031.patch](Codex_T3.6.5_精确差异_20261031.patch)，完整测试输出为 [Codex_T3.6.5_最终回归原始输出_20261031.txt](Codex_T3.6.5_最终回归原始输出_20261031.txt)。设计位于 项目/docs/RETENTION_T365_DESIGN_20261031.md。

原始备份：备份/T365_impl_20261031_144505_614/SHA256_MANIFEST.json，三个已有文件逐字节校验并记录大小。中途日志身份校验与 EOL 调整的快照明确放在 intermediate_before_attempt_metadata_fix 和 intermediate_before_eol，不冒充开工原始备份。新增三个测试和设计文档开工前不存在。

| 项目内文件 | 改前字节 | 改前 SHA-256 | 改后字节 | 改后 SHA-256 |
|---|---:|---|---:|---|
${hashes}

## 实际回归

本轮执行32个脚本，加 schema JSON解析与 git diff --check，共34项命令。旧基线实际27个脚本全部运行，覆盖工单所指26个相关脚本，未减少范围。三个新脚本使用 assert，中途任一失败即非零退出；未伪造统一断言数量。schema 检查是本地 JSON 与相关行为契约验证，不代表云端 schema 已应用。

| 实际命令 | 状态 | 退出码 | 汇总 PASS / FAIL |
|---|---|---:|---|
${rows}

冻结主套件维持290 PASS / 0 FAIL / 11 PENDING。T3.6旧repair套件仍打印其历史正向修复 PENDING，未改写旧套件口径。数据校验退出0；EOL最终检查67个文件、0违规。首轮只有新文档 E_CRLF 失败，原始输出保存在 T365_evidence_20261031/first_regression_with_eol_failure.txt；修正后重新检测通过。git diff --check退出0，既有project.config.json换行提示保留。

## 反事实与只读自审

备份目录 counterfactuals/SUMMARY.json 含5项绿色基线及6项断言失败变异：拒绝rev0、禁用缺失处置、把一般读错当缺失、去除resolution签名、去除attempt签名、删除候选扫描版本复核。每项原始日志附退出码；绿色均0，变异均1并实际抛AssertionError。隔离baseline采用LF，已与当前源码仅规范化换行后逐字比对相同，未在工作区撤销校验。

独立竞态探针在重试精确点读后、候选扫描前改变rev，原代码保持正文，移除扫描版本检查才变红。新专项还覆盖身份/action篡改、原日志不变、重复处置、pending重入、缺清单和写入不确定。只读自审确认：改动限定为Retenion源码、两份schema、三个测试及设计文档；正式入口关闭；日志追加；所有七件均有元数据。当前完整历史证据足够的两条核心本地链路已闭合；没有伪称真实数据库并发安全。

## Git 与剩余风险

HEAD ${git.head}，分支 ${git.branch}，暂存区${git.staged?'非空，详见附件':'为空'}。开工-uall ${count('git_before.txt')}行，结束${count('git_after.txt')}行；原15个tracked修改保留，新增3个测试和1个设计文档。目标已有源码/schema原为未跟踪文件，精确差异因此用外部备份比较，而非只靠普通git diff。完整前后清单与stat见T365_evidence_20261031。

未触云、未部署、未建索引/触发器、未改真实数据、verifyStatus、ID映射、审批文件、冻结主套件，未执行Git写操作。真实SDK notfound错误形态目前仅按本地可验证的窄匹配处理，其他形态会保守阻断；全局审计与正文更新仍无已验收跨文档事务，因此生产入口保持关闭。令牌轮换对历史HMAC的影响仍待单独设计。完成后停止，交DSH独立审查，不进入T3.7。
`;
fs.writeFileSync(path.resolve(__dirname,'../Codex_T3.6.5_Retention_最终闭环_20261031.md'),content);
