# DSH 独立复核：Retention P0 闭环（2026-10-29）

复核对象：`报告/Codex_Retention_P0_闭环验收_20261029.md`（18,602 B / 243 行）、`cloudfunctions/retention/index.js`（7,831 B）、`tools/test_retention_mark.js`（15,929 B）、两份 schema、`cloudfunctions/review/index.js`、`docs/UGC_MVP_DESIGN_FINAL_20261026.md`。
方式：全部只读。复跑 7 条命令、解析 3 份 JSON、逐行读关键实现与测试、用假 DB 复现一个边界场景。未改任何项目文件、未做 Git 写、未触云。

## 0. 结论

- **P0 的目标缺陷（两处）确已修复**，测试预期已与修复后语义对齐，**可判本地 P0 验收 PASS**。
- 但"P0 闭环"报告**有 4 项需保留**：备份不是真"修改前"快照（P1）、审计中断时计数不闭合（P2）、retention 写入行与日志 schema 的 `at`/`rev` 声明不一致（P2）、设计稿"已裁决"与 5 处"待决策"并存（P2）。
- **P0 PASS 不等于 Retention 完成**：T-2（正文清理）、复合索引实际创建、真实云端行为、逐条审计失败后的自动恢复，均维持 PENDING。

## 1. 五项重点逐一

### 1.1 两处测试预期修正 + 四个新用例 —— **PASS**

- B2 改为 `r.marked === 2`（`tools/test_retention_mark.js:141`）、B8 改为空 payload 仍 `expired`（`:147`），与修复后代码一致（`retention/index.js:147-182` 不再跳过 `payload===null`，查询按 `status:'pending'` 过滤）。
- E1（`:268-276`）：空正文单独到期仍标记、`rev` 7→8、`payload` 保持 `null`、该 ID 的逐条事件恰 1 条 —— 直接锁住旧缺陷。
- E2（`:278-297`）：劫持 `db.collection().where` 抓取条件，断言 `status==='pending'`、`createdAt.__op==='lt'`、`marked===1` 且老 approved 未被选中 —— 对 P0-2 有效。
- E3（`:299-310`）：`setBeforeUpdate` 把存储行 `rev` 改成 2 模拟并发写者；第一次 `conflicts===1/marked===0`，重跑 `marked===1`、`rev===3`、恰 1 条逐条事件 —— 语义成立。
- E4（`:312-325`）：`setFail({collection:'submissions',op:'update',atCall:1})` 使首条失败 → `DATABASE_ERROR`、`marked=1/failed=1`；`clearFail` 后重跑补标剩余；两条 ID 各恰 1 条逐条事件 —— 部分失败与重试有效。
- 修改性质核对：与备份对比 **0 删除 / 45 新增**，没有删断言或放宽阈值。

### 1.2 三处语义一致性 —— **PASS（有一处例外，见 1.3-b）**

- `config/cloud/schema.submissions.json`：`status` 枚举含 `expired`；新增 `retention {markedAt, policyConfirmedBy}`（`:61`）；`_meta.writtenBy` 已列入 retention。
- `config/cloud/schema.upload_logs.json`：`event` 含 `retention_mark`（9 值）；`actor.openidHash.pattern=^[0-9a-f]{32}$`、`role` 含 `system`；`action` 键只有 1 个（备份时点有 2 个，去重成立）；新增 `submissionId`。
- `cloudfunctions/review/index.js:44-49,63`：`EXPIRED` 已在 `STATUS_VALUES`；`doApprove/doReject` 仍只接受 `pending`（`:276`、`:364`），`expired` 会得到 409，不会被误通过。
- 报告"`expired` 与 `retention_mark` 本轮前已存在"经备份核对**属实**（备份内已有 expired 与 retention_mark；`retention` 字段、pattern、单 action 键是本轮新增）。

### 1.3 测试变绿但实现仍有缺陷 —— **部分 FAIL**

**(a) 审计中断时计数不闭合（P2）**
`retention/index.js:176-180`：逐条审计写失败即 `break`，后续行不再处理、不计入任何计数，但 `attempts=rows.length` 已固定（`:137-139`）。
实测（假 DB，2 条到期，令第 2 次 `upload_logs.add` 失败）：

```
code= LOG_FAILED marked= 1 skipped= 0 conflicts= 0 failed= 0 logged= false
docs= a:expired, b:pending        ← b 既未标记、也未计入 skipped/conflicts/failed
```

影响：批次报告低估剩余工作量；`a` 的逐条审计永久缺失（下次只会处理 pending，不会补记 `a`）。报告已把"逐条审计失败自动恢复"列为 PENDING，但未把**计数不闭合**本身列为缺陷。

**(b) retention 写入行与日志 schema 的 `at`/`rev` 声明不一致（P2）**
`writeRunLog`（`:82-108`）对 **record** 事件不写 `at`，对**所有** retention 行都不写 `rev`；而 `schema.upload_logs.json:42-43` 声明 `at: date`、`rev: integer value 1`，submit/review 的 `writeLog`（`submit:210-243`、`review:160-193`）都写 `at` + `requestId` + `rev:1`、且带 `target`。
后果：按 `ix_at` 的时间倒查不会命中 retention 的逐条摘要；schema 与实现的"八字段摘要"约定没有在 schema 里写成例外。

**(c) 备份不是真"修改前"快照（P1，报告表述失准）**
报告称备份目录为"修改前版本、可回滚"。实测备份内 `test_retention_mark.js` **已包含** B2=2、B8=expired 的新预期（备份 `:141/:147` 与当前一致），只是缺 E 段。也就是说它是"改到一半的快照"，不是本轮修改前的状态；按它回滚无法恢复"2 红"的原始测试。

**(d) 设计稿内部矛盾（P2）**
`docs/UGC_MVP_DESIGN_FINAL_20261026.md:263` 标题已写"保留期（2026-10-28 已裁决）"，但同一文件仍有 5 处旧口径：
`:150`（B6 未定）、`:220`（保留期"待负责人决策"）、`:409`（P7 "未定/[待确认]/上线阻塞"）、`:433`（对用户文案"待负责人决策"）、`:594`（未决项第 3 条"保留期选哪一档"）。
这与"三处语义一致性已更新"的结论冲突：文档仍在让负责人重新裁决已裁决的事项。

**(e) 次要**：读失败分支（`:129-130`）返回缺 `failed` 字段，与其它分支结构不一致（不影响判定）。

### 1.4 并发 / 重复 / 部分失败 / 数据完整性 —— **PASS（有覆盖空白）**

- 并发：E3 覆盖"读取后 rev 变化"的冲突路径；**未覆盖**两个实例同时启动的交叉（同一文档两实例都读到 rev=1，一成一败，行为可接受，但无显式用例）。
- 重复：靠 `status:'pending'` 过滤实现幂等（已标记为 expired 的不会被再次选中），逻辑成立，**无显式"连续两次运行"用例**（E1 只跑一次）。
- 部分失败：E4 + D10–D12 覆盖，返回 `DATABASE_ERROR` 并保留计数，诚实。
- 完整性：未断言 `marked+skipped+conflicts+failed === attempts`，因此 (a) 的缺口未被测试发现。

### 1.5 报告结果可否复现 —— **PASS**

| 命令 | 结果 |
|---|---|
| `node tools/test_retention_mark.js` | PASS 60 / FAIL 0，exit 0 |
| `node tools/test_ugc_review.js` | 86 / 0，exit 0 |
| `node tools/test_ugc_submit.js` | 110 / 0，exit 0 |
| `node tools/test_ugc_client_contract.js` | 90 项全 PASS，exit 0 |
| `node tools/check_eol.js` | 61 文件、违规 0，exit 0 |
| `node tools/check_doc_refs.js` | `ANCHOR_OK 1642 / AMBIGUOUS 77`；套件 51/0 |
| `git diff --check` | exit 0 |

Git：`HEAD 274ebd6bc35da21394e5e04b0abd7e02b4ce0fad`、`main`、暂存 0、`status --porcelain -uall` 310 行、tracked 修改 15 —— 与报告一致。
备份 4 文件大小/哈希与报告表一致（test `5C353374…`、submissions `B5E5D8BC…`、upload_logs `0DD50781…`、设计稿 `EF985AC0…`）。

## 2. 关键证据位置

| 主题 | 位置 |
|---|---|
| 到期标记主流程 | `cloudfunctions/retention/index.js:111-214` |
| 查询按 pending + createdAt | `:121-126` |
| 并发条件含 rev | `:156` |
| 逐条审计中断 break | `:176-180` |
| 批次审计字段 | `:82-108` |
| 日志 schema at/rev | `config/cloud/schema.upload_logs.json:42-43` |
| 其它函数 writeLog | `cloudfunctions/submit/index.js:210-243`、`review/index.js:160-193` |
| 测试 B2/B8/E1-E4 | `tools/test_retention_mark.js:141,147,268-325` |
| 设计稿矛盾 | `docs/UGC_MVP_DESIGN_FINAL_20261026.md:150,220,263,409,433,594` |
| 备份目录 | `项目/tools/_backup/retention-p0-close-20261029-20261029T0554421214165Z/` |

## 3. 本地验收结论与剩余阻塞

**P0（两处目标缺陷）：PASS。** 空正文跳过与状态过滤两个缺陷已由代码 + 四个新用例 + 两个修正预期锁住，且未削弱任何旧断言。

**P0 之外的剩余阻塞（不得因 P0 PASS 自动转 PASS）**：
1. **T-2 正文清理**：尚未实现（`retention` 只有 mark）；30 天期限到后正文仍在。
2. **复合索引**：`schema.submissions.json:112` 已声明 `ix_retention_mark_order`，但云端未建（本地无法验证）。
3. **真实云端行为**：未部署、未调用；`UGC_RETENTION_*` 环境变量与触发器均未配置。
4. **逐条审计失败的自动恢复**：无补偿任务（本次复核确认 (a) 的计数缺口正是这条链的一部分）。
5. **设计稿口径统一**：5 处旧"待决策"需与 `§3.5.2 已裁决` 对齐（正文 30 / 审计 90 / 摘要 180 天）。

## 4. 建议（按优先级，均未执行）

- P1：把备份改名为"中间快照（含 B2/B8 修正、缺 E 段）"，并另存真正的修改前测试；报告中"可回滚"表述收窄。
- P2：`writeRunLog` 统一写 `at` 与 `rev:1`（或在 schema 中为 record 事件写例外说明）；`break` 前把剩余行计入 `skipped`（或新增 `unprocessed`），并加断言 `marked+skipped+conflicts+failed===attempts`。
- P2：设计稿 5 处旧口径改为引用 §3.5.2。
- P3：读失败分支补 `failed: 0`。

---

复核人：DSH｜方式：只读命令 + 代码行级核对 + 假 DB 边界复现｜未修改项目文件、未执行 Git 写、未触云。
