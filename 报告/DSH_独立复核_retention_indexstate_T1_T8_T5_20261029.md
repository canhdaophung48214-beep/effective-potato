# DSH 独立复核：retention / test_index_state / T1 / T8 / T5 / T7（2026-10-29）

审查对象：Codex 本轮交付（T1 提案、T8 测试、T2/T5 计划、T1/T2/T5/T8 验收记录）与 `cloudfunctions/retention/index.js` 现状。
审查方式：只读源码、测试、契约与报告；在项目内仅运行只读命令与既有测试；**未修改任何项目文件**。
报告路径：`C:\Users\25975\Desktop\食神寻味小程序开发\报告\DSH_独立复核_retention_indexstate_T1_T8_T5_20261029.md`（新建，未覆盖旧报告）。

## 0. 结论摘要

| 项目 | 基线（23:10 前） | 当前（15:29:32 修复后） | 判定 |
|---|---|---|---|
| F-1 空 payload 的 pending 不被标记 | FAIL（`:134` 跳过 `payload===null`） | 代码已修（`:143` 只查 status/rev） | **代码 PASS；测试 FAIL（B8 仍锁旧行为）** |
| F-2 老的非 pending 记录挤占批次 | FAIL（`:119-123` 无 status 过滤） | 已修（`:118` 增加 `status: pending`、`:120` 加 `_id` 次序） | **PASS** |
| F-6 `expired`/`retention_mark` 未登记 | FAIL | **未修** | **FAIL**（见 A4） |
| T-2 30 天清理 / 90 天摘要 / 180 天摘要保留 | 未实现 | 未实现 | **PENDING（T2 后续）** |
| `tools/test_index_state.js` | 3 项失败 | 仍 3 项失败 | **陈旧断言（非代码回归），需单独改测试** |
| T1 提案 | 无 | 已提交，未应用 | **PENDING（方向正确，需第二版 diff）** |
| T8 | 无 | 已提交并实测 5 PASS / 0 FAIL / 1 PENDING | **可接受（范围声明清楚）** |
| T5 | 无 | 方案已提交 | **PENDING（需补 4 项后实施）** |
| T7 表述 | 报告称"运行时必然报错" | 核实为死代码 | **需收窄表述** |

一句话：**retention 的 F-1/F-2 已在代码层修好，但测试还在断言旧缺陷（2 红）；F-6 未修；`test_index_state` 三红是 G1-c 之后的测试漂移，不是产品回归；T1/T5 仍需第二版/补充后再实施。**

## 1. 边界与执行声明

- 只读：`cloudfunctions/retention/index.js`、`tools/test_retention_mark.js`、`tools/test_index_state.js`、`pages/index/index.js`、`pages/index/index.wxml`、`tools/test_records_spec_t8.js`、`config/cloud/*.json`、`docs/RECORD_GENERATOR_*`、`报告/T1_*`、`报告/T2_*`、`报告/T5_*`、`报告/T1_T8_T2_T5_执行验收记录_20261028.md`。
- 允许范围内仅新增本报告；未改项目文件、未 Git 写、未调用云端、未创建资源、未生成正式产物。
- 时间线注意：本次复核开始时 retention 仍是 6,670 B `16856EEC…`；复核过程中 Codex 已把它更新为 **7,306 B `2F1B71EF52A4CF3A…`（mtime 2026-10-28 15:29:32Z）**。本报告把两者分别作为"基线/当前"记录。

## 2. A. retention 逐项审查（10 项）

### A1 空 payload 的 pending 是否仍被正确标记 —— **代码 PASS / 测试 FAIL**
- 现状：`cloudfunctions/retention/index.js:141-146` 的循环只拒绝 `status!==pending`、`rev` 非正整数；**不再跳过 `payload===null`**；`:149-161` 以 `{_id, status:'pending', rev}` 条件更新为 `expired`。
- 基线问题（已修）：旧版 `:134` 写的是 `... || row.payload === null || ...`，空正文记录永远不会过期。
- 测试仍锁旧行为：`tools/test_retention_mark.js:143` 断言 `docById('already_redacted').status === 'pending'`；实跑 `node tools/test_retention_mark.js` → **PASS 22 / FAIL 2**，失败之一即 `B8 已匿名化记录不被覆盖 :: expected="pending" actual="expired"`。
- 结论：代码正确，测试需按新语义改为"应被标记为 expired，并保留 payload 为空这一事实"。

### A2 批次是否先过滤 pending 再限量、是否还有饥饿 —— **PASS**
- 现状：`:117-122` 查询为 `where({ status: STATUS.PENDING, createdAt: _.lt(cutoff) }).orderBy('createdAt','asc').orderBy('_id','asc').limit(batchLimit)`。
- 基线问题（已修）：旧查询只有 `createdAt < cutoff`，较早的 approved/rejected 记录按 `createdAt` 升序占满 `batchLimit`，pending 记录被"饿死"。
- 残余：单次仍只处理 `batchLimit` 条；靠重复运行推进（`:141` 顺序处理，`:120` 的 `_id` 次序保证稳定游标）。未实现跨批次续跑（无 cursor），但不再饥饿于非 pending 记录。

### A3 并发覆盖 / 重复日志 / 部分成功误报 —— **PASS（有两点观察）**
- 并发：每条更新都带 `{_id, status, rev}` 条件（`:150`），`updated!==1` 记为 `conflicts`（`:176`），不会覆盖并发审核结果。
- 部分成功：`:129-131` 新增 `failed` 计数；`:163-166` 单条 DB 异常 `failed++; continue`；结束时 `:180` 以 `failed===0 ? COMPLETE : (marked>0 ? PARTIAL : FAILED)` 写 complete 行；返回值 `ok: failed===0`、`code: failed===0 ? 'OK' : 'DATABASE_ERROR'`（`:193-201`）——**不会把部分失败报成完整成功**。
- 观察①：每次运行写 **prepare + 每条 marked 一条 record + complete = N+2 行**（`:135`、`:170`、`:182`）；量大时日志成本随标记条数线性增长，需在上线前评估。
- 观察②：record 行写失败时直接返回 `LOG_FAILED`（`:172-174`），此时状态已改、complete 未写；返回值带 `logged:false` 与计数，属诚实失败，但"complete 缺失"只能靠 prepare/record 行反推，恢复脚本需知道这一点。

### A4 `expired` / `expire` / `retention_mark` 在 schema、契约、代码中是否一致 —— **FAIL**
| 位置 | 现状 | 问题 |
|---|---|---|
| `config/cloud/schema.submissions.json:49` | `status` 枚举仅 `["pending","approved","rejected"]` | 缺 `expired` |
| 同文件 `:9` | 保留期说明仍写"待负责人确认，默认不承诺 90 天" | 与已裁决的 30/90/180 天不一致（旧说明） |
| 同文件全文 | 无 `retention` 字段定义 | 代码 `:154-157` 已写入 `retention:{markedAt,policyConfirmedBy}` |
| `config/cloud/schema.upload_logs.json:13` | event 枚举 8 类 | 缺 `retention_mark` |
| `cloudfunctions/review/index.js:44-48,63` | `STATUS` 仅 3 值、`STATUS_VALUES` 同 | 缺 `EXPIRED`；因 `approve` 要求 `status==='pending'`，`expired` 会被 409 拒绝（安全），但枚举不全 |
| `cloudfunctions/retention/index.js:85` | 写 `event:'retention_mark'` | 与 A4 的枚举不一致 |

### A5 普通审核接口是否允许人工触发 expire —— **PASS**
- `review/index.js:42` `ACTIONS` 仅 session/list/detail/approve/reject/delete；`:493-506` 动作白名单在鉴权后分发；全仓无 `expire` 动作（`expired` 仅作为 reject 理由码 `:57`）。人工无法触发到期标记。

### A6 系统 actor 是否写 `openidHash: null` —— **PASS（已修）**
- 现状 `:88`：`actor: { role: 'system' }`，不再写 `openidHash:null`；`schema.upload_logs.json:18-19` 中 `openidHash` 非必填、`role` 枚举已含 `system`（`:19`）→ 语义一致。

### A7 29 天标记 / 30 天清理 / pending 补救 —— **部分 PASS**
- 29 天标记：`:114` `cutoff = now - markAfterDays*24h`，`:118` 只选 pending；`:153` 置 `expired` —— PASS。
- 30 天清理（清正文）、90 天日志摘要、180 天摘要保留：**未实现**（全文件无 purge/rotate/summary；`grep` 0 命中）→ PENDING（T2 后续）。
- pending 补救：若 T-1 曾漏跑，当前没有"补跑标记"的显式入口，只能靠再次执行 mark；可接受但需在 T2 计划里写明。

### A8 审计摘要是否严格 8 字段、是否泄漏正文 —— **PENDING（未实现）**
- 当前只有 `retention_mark` 运行日志（`:81-105`），无"90 天摘要化"逻辑；`:91-99` 的 stats 只含计数，无正文/身份 —— 现状不泄漏，但"8 字段摘要"未落地。

### A9 prepare/complete 是否能识别未完成或部分失败 —— **PASS（新增）**
- `:135` 写 prepare；`:180-182` 写 complete 并区分 COMPLETE/PARTIAL/FAILED；返回值同样区分（`:193-201`）。prepare 写失败则立即失败且不改数据（`:137-139`）——fail-closed。

### A10 测试是否覆盖失败路径 —— **FAIL（当前）**
- 现有覆盖：数据库错误、冲突、重跑幂等、边界 29 天、B10 不含 openid（`tools/test_retention_mark.js:*`）。
- 缺口：①B8 仍在断言旧缺陷（必须改）；②无"空 payload 被标记"的正向用例；③无"非 pending 老记录不占批次"的饥饿回归用例；④无 PARTIAL/FAILED 分支用例；⑤无 record 行写失败后的状态与审计一致性用例。
- 实跑：`node tools/test_retention_mark.js` → PASS 22 / FAIL 2（B2、B8），exit 1。

## 3. B. `test_index_state.js` 三项失败根因 —— 陈旧断言，不是代码回归

| 失败 | 断言位置 | 现实现证据 | 判定 |
|---|---|---|---|
| S1 `dataSource 初始为 local` | `tools/test_index_state.js:197`（期望 `local`，实际 `unknown`） | `pages/index/index.js:267-272` 初始 `dataState:'loading', dataSource:'unknown', dataNoticeText:''`；`:595` 加载完成后 `dataSource: self.raw.source` | **陈旧断言**：G1-c 起初始值改为 unknown（加载前不冒充 local） |
| S8 `本阶段没有引入云端调用点` | `tools/test_index_state.js:429`（`js.indexOf('loadCloudDataset')<0 && js.indexOf('wx.cloud')<0`） | `pages/index/index.js:394-402` 定义 `fetchCloudDataset()` 调 `loadCloudDataset({db: wx.cloud.database()})`，`canUseCloud()` 守卫 | **陈旧断言**：S8 属"仅本地阶段"口径，与 G1-c 目标（接真实数据）直接冲突 |
| S13 `WXML 的演示横幅带条件` | `tools/test_index_state.js:656`（要求字面量 `dataSource !== 'unknown'`） | `pages/index/index.wxml:42-47` 改为 `wx:if="{{dataState === 'ready'}}"` + 三分支（cloud/local/else），unknown 分支文案 `:45` "数据来源未知 · 请勿当作真实信息" | **陈旧断言**：横幅改为状态机驱动；S13 另一条"有来源未知的告示"仍通过 |

- 实跑：`node tools/test_index_state.js` → 通过 200 / 失败 3，exit 1；失败明细与上表一致。
- 设计一致性证明（不是"因为改了测试所以通过"）：
  1. 初始 `unknown` → 加载后才出现数据源标签（`wxml:42`），避免加载前误示"演示"；
  2. 本地路径 `loadRawDataset()` 返回 `source:'local'`，S2 断言"加载后 local"通过；
  3. 云端读取只在 `canUseCloud()` 为真时（`:399-402`），并带 6s 超时与回退（G1-c 实现），不裸调 `wx.cloud`；
  4. unknown 文案仍在（`:45`），并未删除"未知"提示。
- 结论：三项是测试未跟上 G1-c 的**漂移**，修法是改测试期望（S1→`unknown`；S8→"存在云端调用且被守卫"；S13→`dataState` 门控 + unknown 分支文案）。此修改**未获本轮授权**，本报告只给方案。

## 4. C. T1 提案审查 —— 方向正确，PENDING

**兼容性**
- `assertSafeOutDir`（`tools/pilot/gen_records.js:1560-1582`）禁止项目根与 `data/pages/utils/cloudfunctions/config/tools`；项目外目录不在禁止项 → **兼容**。但生成器**不强制"必须在项目外"**；若有人直接 `--write --out 项目/发布`，生成器会接受（"发布"不在保护清单）。测试侧 `RECORDS_PUBLISH_DIR` 校验能挡住，但命令行没有同等护栏 → 建议在契约或使用说明里写清"外部目录由操作者保证"。

**`RECORDS_PUBLISH_DIR` 是否可靠**
- 校验逻辑（提案 `:42-48`）：绝对路径 + `path.relative` 不以 `..` 开头则抛错 → 词法层面 fail-closed，PASS。
- 缺口 1（**必须补**）：没有读侧校验。只要目录里有 `records.json`/`records_blockers.json`/`gen-manifest.json`，后续条件断言就可能读取；`COMMITTED` 缺失、manifest 与哈希不一致、S10 未完成都无法被识别 → 可能把半成品当 PASS。提案 `:69` 已承认"需 inspectPublished"，但 diff 未包含。
- 缺口 2（应补）：没有 `realpath`。外部目录做成 junction/symlink 指回项目内时，词法判断通过（读风险，非写风险）。
- 缺口 3（必须证明）：提案 `:82` 说"不存在/不完整目录 → PENDING/E17"，但当前测试的 PENDING 是无条件登记，条件读取的点位（`:249/290/1114/1190/1828/1842`）在目录缺失时可能直接抛错而非 PENDING，需逐条核对后才能claim。
- 缺口 4（建议）：运行时把解析后的发布目录打印出来，避免环境变量残留导致"以为读了 A 目录、实际读 B"。

**冻结测试修改范围**
- diff 只改 `:42-48` 的载入校验与两处路径常量（`P.records`、`P.products`），未改任何断言语义 → **范围合格**。需在应用时保存改前哈希并在逐条运行时断言落地后再转 PASS。

**其他审查点**
- 是否引入不必要的指针/脚本：**没有**（不建指针、不建 `write_publish_pointer.js`）→ 合格。
- 是否把测试修复与正式 `--write` 混成一次授权：**没有**（未运行 write，PENDING 未转）→ 合格。
- 结论：**PENDING**，接受方向；应用前需第二版 diff 补"读侧 gate + realpath + PENDING 逐点确认 + 打印目录"，并单独授权。

## 5. D. T8 / T5 提案审查

### T8（新增 `tools/test_records_spec_t8.js`，7,566 B `BE0114E3…`）
- 实测：`node tools/test_records_spec_t8.js` → **PASS 5 / FAIL 0 / PENDING 1**，exit 0。
- T230-A：输入真实 `evidence/PHOTO_MANIFEST_20261025.csv`（35 行→排序去重 34 件，16,118,613 B），断言 `validateAttachments().ok===true`、errors 0；缺证据时（`:48-66`）降 PENDING，不误报 → **可验证输入、预期结果、失败路径均有**。
- T230-B/C：原序拒绝（18 错：17 `E_ATTACH_ORDER` + 1 `E_ATTACH_DUPLICATE`）、排序未去重同时报 ORDER/DUPLICATE（重复件 `3F-06/3F-07`）→ 行为断言成立。
- T243-A：注入空合成记录并代理 fs，断言 `L8_IN_MEMORY_ONLY`、写调用 0、`id-map.json` 字节与 mtime 未变 → 成立；**未覆盖 write 模式**，已在报告中声明。
- T233-A：目录 fsync 代理 no-op，仅证控制流与真实文件链路，**不证 NTFS 持久性**，已声明。
- T242：PENDING（掉电恢复本机无法证明），理由成立。
- Windows 离线：纯 `fs`/`path`/`child_process`（本地），无网络 → 成立。
- 结论：**可接受**。建议把"34 件/16118613 B"这两个硬编码值注明"对应 2026-10-25 版清单"，避免证据更新后误判。

### T5（`报告/T5_审核轮询与删除请求逐文件计划_20261028.md`）
- 轮询语义：计划要求复用 `refresh()`、先过 `session`、`onHide/onUnload` 清计时器、不重叠、退避 —— 齐备；**缺**"最大轮询次数/可见性 API 选择"细节。
- 三段语义（请求已提交 / 审核完成 / 实际删除）分离清楚，明确不越级显示"已删除" —— PASS。
- 身份/幂等/并发/审计：服务端 OPENID、`_id+submitter.openid` 归属、404 统一、请求 ID 幂等、rev 条件更新、审计最小化 —— 齐备。
- 未擅自引入 webhook/云资源：**PASS**（明确不接企业微信、`ugc_self` 仅方案、未创建）。
- 补充建议（实施前必须决定）：
  1. 与 retention 的关系：用户请求删除 vs 30 天到期清理的优先级（建议"用户请求优先，立即执行"），以及已 purge 记录的 `deleteStatus` 返回什么；
  2. `requestDelete` 的限流/防滥用（否则可被刷）；
  3. 自助删除后审核队列必须不可见正文（现有 `review.doDelete` 置 `payload:null`，`ugc_self` 需同语义）；
  4. 是否需要人工审核删除请求（合规取舍），若无需审核也须记录明确"审核事件"。
- 结论：**PENDING（方案合格，实施前补 4 项）**。

## 6. E. T7 表述修正

- 原报告称"`qual` 未定义 → 运行时必然报错"。核实：`qual` 定义在 `tools/check_doc_refs.js:347`，而 `cls` 在 `:336-343` 的两个分支里必然被赋值，因此 `:347` 的 `if (!cls)` 分支是**不可达死代码**，不会产生运行时错误。
- `qualifierTarget`（`:293`）与 `titleHint`（`:320`）已定义并导出（`:593`），但 `scanAnchors` 未调用 —— 有代码证据表明它们是未接线的辅助函数；**没有证据**表明必须立即修复（接线会改变分类结果，需另测）。
- 建议表述改为："`check_doc_refs.js:336-350` 含一处不可达分支（`cls` 两分支全覆盖）；`qualifierTarget/titleHint` 已实现但未接线，属未使用代码，非当前运行时缺陷。"

## 7. 必须修复的问题与最小 diff 建议

1. **测试锁死旧缺陷（当前 2 红）** — `tools/test_retention_mark.js:143`：把 B8 改为断言 `status==='expired'` 且 `payload` 仍为空（新语义），并新增"空 payload 被标记"用例；B2 期望值应与新行为一致（当前 2 条被标记：overdue + already_redacted），或把夹具改为不冲突的两条。**修改测试需明确授权。**
2. **schema 与代码不一致（F-6）**：
   - `config/cloud/schema.submissions.json:49` 加 `"expired"`；
   - 同文件补 `retention` 字段（`markedAt`/`policyConfirmedBy`），并把 `:9` 的旧说明改为"30/90/180 天（负责人 2026-10-26 裁决）"；
   - `config/cloud/schema.upload_logs.json:13` 加 `"retention_mark"`；
   - `cloudfunctions/review/index.js:44-48` 加 `EXPIRED: 'expired'`，`:63` 一并加入 `STATUS_VALUES`（仅枚举，不改动作语义）。
3. **T-2/T-3 未实现**：30 天清正文、90 天日志摘要、180 天摘要保留、8 字段摘要、PARTIAL/FAILED 的补跑策略 —— 属 T2 后续授权，不在本轮。
4. **`test_index_state` 三项**：按 §3 方案改测试（S1→`unknown`、S8→"`loadCloudDataset` 调用存在且受 `canUseCloud` 守卫"、S13→`dataState` 门控 + unknown 文案），改后必须实跑并证明 S2/S26 仍通过。
5. **T1 第二版**：加 `inspectPublished(PUBLISHED_DIR)`（`COMMITTED`、三文件、manifest 计数、哈希）+ `realpath` 项目外检查 + 打印解析目录；先不转 PASS。
6. **T5 实施前补充**：见 §5 的 4 项。

## 8. 风险

- **越权**：`review` 仍是唯一管理员入口（`ACTIONS` 无 expire），`ugc_self` 若实施必须独立鉴权；当前无自助删除接口，风险为 0（也未实现）。
- **隐私**：正文清理尚未实现（T-2），30 天后数据仍完整保留 → 与"30 天"承诺不符；P0。
- **并发**：retention 的 rev 条件更新正确；但 prepare/complete 与 record 行的多行日志意味着"同一批次多行"，审计查询需按 `day + event + result.stats.phase` 聚合，否则会重复计数。
- **恢复**：record 行写失败会留下"已改状态但无 complete"的批次；恢复需以 `prepare` 行 + 投稿 `rev` 推断。

## 9. 未覆盖 / 需额外授权

- 未验证真实云端触发器、真实集合权限、真实 `db.serverDate()` 行为（离线替身）。
- 未验证 T1 应用后的主套件行为（提案未应用）。
- 未验证 T5 的轮询实机行为（未实现）。
- 未验证 T8 的 T242 掉电恢复（本机不可证）。
- 需要授权：修改冻结主套件（T1）、修改 `test_retention_mark.js`、修改 schema 配置、实现 T-2/T-3、实施 T5、云端部署。

## 10. 复现命令与实测结果

| 命令 | 结果 | 退出码 |
|---|---|---:|
| `node tools/test_records_spec_t8.js` | PASS 5 / FAIL 0 / PENDING 1 | 0 |
| `node tools/test_retention_mark.js` | PASS 22 / FAIL 2（B2、B8） | 1 |
| `node tools/test_index_state.js` | 通过 200 / 失败 3（S1、S8、S13） | 1 |
| `node tools/test_records_spec.js` | 290 PASS / 0 FAIL / 11 PENDING，`RESULT: OK` | 0 |
| `node tools/check_doc_refs.js` | `ANCHOR_OK 1642 / ANCHOR_AMBIGUOUS 77`；`LINE_OK 1 / UNVERIFIED 51 / TARGET_UNCERTAIN 266 / UNRESOLVED 27 / HISTORICAL 4 / SEMANTIC_REVIEW 3 / IGNORED 62` | 0 |
| `node tools/check_eol.js` | 61 文件，0 违规 | 0 |
| `git diff --check` | 无差异错误（仅 `project.config.json` CRLF 提示，属既有） | 0 |

Git：`HEAD 274ebd6`、分支 `main`、暂存 0、`git status --porcelain -uall` 306 行（既有未提交改动，本轮未变）。
关键文件哈希（前 16 位）：`cloudfunctions/retention/index.js` 7,306 B `2F1B71EF52A4CF3A`；`tools/test_retention_mark.js` `07C32142C3C27C02`；`tools/test_index_state.js` `70F88F4B2E73FC2E`；`tools/test_records_spec_t8.js` `BE0114E3…`。

**声明**：本报告所有"通过/失败"均来自上述实跑；未执行 `gen_records.js --write`、未生成 `records.json`/`records_blockers.json`/`gen-manifest.json`/`COMMITTED`，未调用云端、未部署、未创建集合/触发器/环境变量，未执行 Git 写操作。
