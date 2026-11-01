# Codex｜T3.6.1 Retention 活性与批次恢复：本地实施验收

日期：2026-10-30；执行人：Codex；独立验收：DSH。仅本地代码、schema 草案、离线假数据库、测试和文档发生变更。**未访问云端、未部署、未创建索引或触发器，生产 purge 仍在读库前失败关闭。**

## 1. 分项结果

| 目标 | 本地结论 | 限制 |
|---|---|---|
| 纯 `LOCK_BUSY` 活性 | **PASS**：零业务写入批次追加 `DEFERRED_NOT_STARTED`，独立计数；释放锁后再次运行可清正文，旧事件保留。 | 只有全部选中项均在获取锁前返回 `LOCK_BUSY`、前置恢复未选中记录、所有其他结果计数为零，才使用非阻断语义。混合批次继续阻断。 |
| FAILED/PARTIAL 批次正向修复 | **部分 PASS / 部分 PENDING**：新 purge 批次有不可变 prepare 清单和稳定日志 ID；逐条审计或安全未处理状态得到证明后追加稳定修复事件，再完整对账。PARTIAL 实际故障注入和 FAILED 合成历史样例均本地通过。 | **旧日志缺清单/稳定 ID、mark/recover 批次及无法证明的行状态仍 PENDING**，不会补造证据或解除阻断。 |
| 锁释放失败恢复 | **PASS（离线）**：更新前失败保留 PARTIAL；已写入但回执丢失时按同一 owner/token 点读确认；到期租约按 rev/fencing 条件释放；接管后旧持有者不能恢复写权限。 | CloudBase 实际 CAS、服务器时钟、真实网络回执与两实例并发 **PENDING**。 |
| T3.6 回归 | **PASS（离线）**：rev/fencing、分页、对账、安全闸门及 UGC 套件均通过。 | 全局日志与正文更新之间的跨文档原子屏障 **PENDING**；生产 purge 继续返回 `PURGE_GLOBAL_FENCE_UNVERIFIED`。 |

## 2. 开工基线与备份

开工实测 `main`，HEAD `274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`，暂存 0，`status --porcelain=v1 --untracked-files=all` 332 条（15 个原有已跟踪修改、317 个未跟踪）。Retention 目标文件本来已是未跟踪文件，未用旧报告覆盖当前版本。已读取 DSH 第二轮独立验收、T3.6 源码和相关测试；根目录 `.baton/task.md`、`.baton/handoff/current.md`、`.baton/PROTOCOL.md` 均不存在，故本报告承担交接记录。

仓库外新备份：`C:\Users\25975\Desktop\食神寻味小程序开发\备份\T3_6_1_retention_20261030_230621_860\`。三份目标文件在**各自修改前**复制并逐字节用大小、SHA-256 验证；`manifest.txt` 记录原始字节。`tools__test_retention_t361_repair.before_debug.js` 是新测试编写中间快照，不冒充开工前原始文件。

| 修改前目标 | 原大小 | 原 SHA-256 | 当前大小 | 当前 SHA-256 |
|---|---:|---|---:|---|
| `cloudfunctions/retention/index.js` | 56,114 | `255686A5077214D1B85A23EEFBF8A2B54F2AC31F96A0A289912BB29B56C1CF7D` | 72,452 | `C9BE61A1B030614A3A25F545E57B94ED26B6ABC644E2343D0C60408464424E74` |
| `config/cloud/schema.upload_logs.json` | 4,071 | `88EFFEA26E95997F4197772F630154E79276DDFA89E6B0D338C2FE7CCEB0985F` | 4,269 | `F381B6F7A7FB259B861A4B421B59BE1B91049A7C2E11D1FA89E26AEF68DC2E16` |
| `tools/ugc_fake_cloud.js` | 10,656 | `B8A4F2A28A99E8A397BC41182D28B17DBE25C55A311CA48E8444E99299B6E13B` | 11,319 | `A98A9C1F85122464EC15B22AF8AB08F29CF9D2A7A6359906EFACA2D7E735E163` |

新建文件：`tools/test_retention_t361_deferred.js`（5,054 B，SHA-256 `816E632337A132D52243561E99FDBE81042A1A9474C59134881085113A18E98D`）、`tools/test_retention_t361_repair.js`（8,247 B，`754F56E4A71C8B524C6A7678D417BC964064F8C5193ECD34A67CA2B6142D6540`）、`tools/test_retention_t361_lock_recovery.js`（6,370 B，`41D65AE8CCF599C36C3118702472A329F8EAE5CDC1DC3D6B448EEA4EFB2B0724`）、`docs/RETENTION_T361_DESIGN_20261030.md`（5,971 B，`257768D6C32BD2BE723227CEEF870D770566EE4367CE6B729AC747C4F5AA23DD`）。

## 3. 实际差异与状态语义

完整 **7 文件 unified diff** 在 `报告/Codex_T3.6.1_精确差异_20261030.patch`，62,825 B，SHA-256 `FF834E9F65427AD1AA8987FCE6634BC1D403CB905673159DB3EA4A68343E62E5`。这份补丁由仓库外原始备份与当前文件逐项 `git diff --no-index` 生成；新增文件从空文件比较。未改冻结主套件。

`index.js` 的变更：新增纯 LOCK_BUSY 批次的完整零写入判定；对账器验证后单列 `DEFERRED_NOT_STARTED`，仍保留 `DEFERRED/PARTIAL/FAILED` 异常语义。新增 prepare 选中证据清单与稳定 batch 日志 ID；修复动作只验证、点读与追加 `REPAIR_CONFIRMED`，原日志只追加不更新/删除。对账器同时保留原始 outcome 和 `repairStatus/counts.repaired`；修复事件存在也必须再次完成对账。新增释放状态确认与过期租约条件恢复。续扫凭据只投影证据摘要/数量，不带原始投稿 ID。所有 Retention 投稿更新仍含旧 rev 条件并写 `rev+1`。

`schema.upload_logs.json` 的结果码与 stats 说明同步增加未开始和修复事件；仅本地声明。假数据库新增实例级“写入已发生、回执丢失”故障注入，默认行为不变。详细边界见 `项目/docs/RETENTION_T361_DESIGN_20261030.md`。

## 4. 三份专项测试与反事实证据

最终原始输出：`报告/Codex_T3.6.1_回归原始输出_20261030.txt`，119,227 B，SHA-256 `5FA874ABAD2F39B62DD8B936173201DE60E2DC0F5700BF9C528582E046343908`。每个命令前有命令名和实际退出码，最后追加文档最终状态复查。

| 命令 | 结果 | 退出码 | 证据重点 |
|---|---|---:|---|
| `node tools/test_retention_t361_deferred.js` | 9 PASS / 0 FAIL | 0 | 零写入、释放后重试、原事件保留、混合批次继续阻断、矛盾计数拒绝。 |
| `node tools/test_retention_t361_repair.js` | 12 PASS / 0 FAIL | 0 | PARTIAL 实际故障注入、FAILED 合成样例、证据不足拒绝、日志写入失败与丢回执、重复修复、跨页凭据无 ID、修复后可继续本地清理。 |
| `node tools/test_retention_t361_lock_recovery.js` | 8 PASS / 0 FAIL | 0 | 正常与重复释放、过期/接管、旧 token 失效、释放前失败、写入成功但回执丢失、进程中断。 |

三组变异均在备份目录下 `counterfactual_final/` 隔离副本运行，未触碰项目源码；完整输出各存对应 `.txt`：把未开始结果改回普通 `DEFERRED` → **exit 1、4 项 FAIL**；忽略修复事件 → **exit 1、8 项 FAIL**；移除已释放锁的幂等确认 → **exit 1、2 项 FAIL**。所以新断言能检出各自目标缺陷。

正文保护：D1/D6/D7/D8、H1/H7、L2/L3/L4/L7 等异常路径分别断言 payload 原样或已清后维持 null、rev 与事件结果正确；未开始批次仅两条批次日志，逐条成功日志为零。写入失败场景保留原 PARTIAL，修复事件只在证据闭合后追加。FAILED 用例是在隔离假库**构造历史失败日志**，不代表真实旧日志已经具备修复证据。

## 5. 完整回归

以下命令均以最终源码执行且退出码 **0**：T3.6 并发 15/0、旧修复专项 7/0、续扫 15/0；T3.4 续扫 21/0；reconcile 30/0、mark 71/0、purge 18/0、recoverPending 13/0、审计闸门 16/0；review 86/0、submit 110/0、客户端契约 90/0、首页状态 205/0、页面 106/0；T8 独立测试 5 PASS/0 FAIL/**1 PENDING**；`check_eol.js` 64 文件合规/0 违规；文档引用 51/0；冻结 `test_records_spec.js` **290 PASS/0 FAIL/11 PENDING**。源码、fake DB 与三份新测试的 `node --check` 均退出 0，schema JSON 解析退出 0，`git diff --check` 退出 0（仅原有 `project.config.json` 的 CRLF 提示）。新增文档后再次运行 EOL、文档引用和 diff 检查，均退出 0。旧 T3.6 修复套件仍打印历史正向修复 PENDING；其含义是旧无证据日志仍不可修复，本轮没有把这类 PENDING 改成 PASS。

## 6. Git、副作用与未解决风险

最终 Git 仍为 `main`、同一 HEAD、暂存 0；`status --porcelain=v1 --untracked-files=all` 336 条（原有 15 个已跟踪修改，321 个未跟踪；本轮新增三份测试和一份设计文档）。既有脏文件保留，无 Git add/commit/reset/checkout/stash。没有正式产物、真实投稿、`verifyStatus`、ID 映射或审批文件变更；没有云端调用、部署、索引、触发器或环境变量变更。

**PENDING：** 生产 purge 仍关闭；真实 CloudBase 的 CAS、租约时钟、回执不确定与多实例行为未验；全局日志与正文写入的跨文档 TOCTOU 未解决。历史无稳定 prepare/complete ID 或选中清单的失败批次、非 purge 批次无法安全正向修复。批次证据 HMAC 使用维护令牌派生密钥，轮换令牌前需要专门迁移方案；共享令牌只识别系统操作者，不识别具体自然人。修复后完整扫描最多 20 页，超过上限继续阻断；真实日志索引、权限及大数据量仍待隔离云环境验收。提交 DSH 按各项分别独立判定，本轮到此停止。
