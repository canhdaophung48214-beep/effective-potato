# DSH 独立验收：R01-E2 菜品字段恢复

日期：2026-11-01。审查对象：`报告/Codex_R01_E2_数据溯源与恢复报告.md`（13,794 B，mtime 11-01 13:52）及 4 份 CSV、manifest、证据目录。
审查方式：只读；不复用执行人统计，全部数字由本端脚本从当前生成器源码与原始文件重算。

## 0. 结论

**PASS（有条件）**：原始统计、A 类证据、B/C 分类、CSV 完整性、正式数据保护均通过；**未发现需要 FAIL 的错误记录**。两条口味候选（`c01_d256`、`c01_d257`）证据链完整；foodType 候选 0 条属正确保守结论。整体"字段恢复"仍为**分析完成、正式写入未执行**，并受原图复核与业务裁决两道 PENDING 约束。

| 项目 | 结论 |
|---|---|
| 原始数据统计 | **PASS** |
| tastes 证据恢复 | **PASS**（2 条候选；正式写入 PENDING） |
| foodType 证据恢复 | **PASS**（0 条候选，全部保持 null） |
| A 类证据真实性 | **PASS**（2/2，100% 核对） |
| B/C 分类合理性 | **PASS** |
| CSV 完整性 | **PASS** |
| 正式数据保护 | **PASS** |
| 整体 R01-E2 | **PASS（有条件）** |

## 1. 独立复算（当前生成器内存构建，未写盘）

| 指标 | Codex | 本端重算 | 判定 |
|---|---:|---:|---|
| 生成记录 / 源条目 | 490 / 525 | 490 / 525 | 一致 |
| 未生成（not_generated） | 35 | 35（coverage CSV 35 行 `NOT_GENERATED`、dishId 空） | 一致 |
| tastes=[] | 490 | 490 | 一致 |
| foodType=null | 368 | 368 | 一致 |
| 交集 | 368 | 368 | 一致 |
| 仅 tastes 缺 | 122 | 122 | 一致 |
| 仅 foodType 缺 | 0 | 0 | 一致 |
| 并集 / 字段项 | 490 / 858 | 490 / 858 | 一致 |
| dishId 唯一 | 490 | 490（dup=0） | 一致 |
| tastes A/B/C | 2/40/448 | 2/40/448 | 一致 |
| foodType A/B/C | 0/163/205 | 0/163/205 | 一致 |
| B 项 / 涉及菜品 / 两字段均 B | 203/186/17 | 203/186/17 | 一致 |
| 同名组 / 跨档口 | 38/10 | 38/10（`differentStalls:true` 10 组） | 一致 |
| 组合/并列源行 | 73 | 73（名称含 `" / "`） | 一致 |

`data/index.js` 的 45 条演示菜品与 490/525 口径无交集；报告 §1 已把两者分开，未把 45 当正式 490。

## 2. A 类证据 100% 核对（2 条，无抽样）

| dishId | 生成记录 | 候选值 | 来源 | 本端核对 |
|---|---|---|---|---|
| `c01_d256` | 素椒炸酱面（微辣）· c01_t28 四有青年面馆 · 小碗 · price 11 · sourceLine 370 · tastes `[]` · foodType null | `["mild_spicy"]` | `tools/pilot/TRANSCRIPTION_2F.md:370` | 行存在、原文逐字 `\| 素椒炸酱面（微辣） \| 11 元 \| 11.9 元 \|`、recordKey `c01_t28\|f2/素椒炸酱面（微辣）\|小碗\|` 与运行期一致、`data/index.js:40` `mild_spicy:'微辣'`、同名检索 2F 仅 1 处 / 3F 0 处 → 证据直接支持候选值 |
| `c01_d257` | 同上 · 大碗 · price 11.9 | `["mild_spicy"]` | 同一源行不同规格列 | 同上；双规格各自独立 dishId，未合并 |

要点：
- 候选值来自**菜品行内括注**，不是菜名关键词、不是栏目、不是同店类推；`mild_spicy` 与「微辣」为项目枚举的同义直接对应。
- 两条的 `foodType` 仍为 null，故"两字段都有可信非空值"的完整候选为 **0**，与报告一致。
- 证据等级标注为 `L2_REPOSITORY_TRANSCRIPT_NOT_IMAGE_REVERIFIED`，未冒充"已看原图"。

## 3. B/C 分类审查

- **tastes 40 条 B**：8 条为「（辣）/（辣度适中）/（香而不辣）/（不辣）」等与枚举不同义的括注，32 条为 W2-08 段末选项作用域 22、组合行 1、烧饼六风味 4、原味 1、火锅锅底 4；细分 8+32 与报告一致，均 `proposedValue` 为空。
- **foodType 163 条 B**：全部是"菜单分组明确、但无覆盖该分组的 foodType 枚举映射裁决"，证据描述统一为"分组信息不直接写成类型"，未按菜名猜测。
- **C 类 653 项**（448+205）：`proposedValue` 全空，`unresolved.csv` 856 行 = 40+163+448+205，未把"无证据"写成"默认值"；C 的定义（本轮材料不足，非永久不可恢复）与报告 §9 一致。
- 未把「不辣」默认成 `light`、「香而不辣」默认成 `light`、把「（辣）」直接映射成 `spicy`——报告中这些均为 B 且无值，核对通过。

## 4. R03-D 规则一致性

- `verify_data.js` 与 `test_verify_data.js` 哈希与 R03-D 验收态一致（`74C1E521…`、`A87782ED…`），**本轮未改校验器或测试**。
- `TASTE_VALUES` 由 `data/index.js` 的 `TASTE_LABEL` 生成（`verify_data.js:63`），`mild_spicy` 在内；候选为单元素合法值。
- `tastes=[]` 继续合法（我实跑 `node tools/verify_data.js` → 45 菜品无错误，exit 0；`node tools/test_verify_data.js` → 122/0，exit 0）。
- 多元素拦截规则 `length > 1` 未变；候选不触发。

## 5. 数据完整性与交付物

| 文件 | 字节 | SHA-256（实测=报告） |
|---|---:|---|
| `R01_E2_tastes_inventory.csv` | 290,627 | `12b803cd…391ab4` |
| `R01_E2_foodType_inventory.csv` | 220,013 | `2a675fcb…a4f05b` |
| `R01_E2_recovery_candidates.csv` | 1,628 | `1e504a4c…226b21` |
| `R01_E2_unresolved.csv` | 509,012 | `afaa67eb…270ee7b` |
| `R01_E2_evidence_manifest.json` | 52,165 | `39dc7942…a55c26` |

- 4 份 CSV 均为 UTF-8 BOM + CRLF（实测 4/4）；行数 490/368/2/856，与声明一致。
- `record_coverage_525.csv` 525 行，含 `recordKey/dishId/sourceLine/generationStatus` 等 16 列；35 条 `NOT_GENERATED` 的 `dishId` 为空（未造号）。
- `missing_intersection.csv` 368 行；`same_name_groups.json` 38 组、10 组跨档口。
- 旧快照 `报告/R01_20261031/_raw/records.json`（490 条）与当前 `run({mode:'dry-run'})` 的 `records` **深比较完全一致**（JSON 逐字节相等）。
- manifest：33 份 CSV 来源中 8 份具备完整菜品身份字段、12 个严格匹配**全部**来自 `derived_report_not_independent`（7 份）、原始来源匹配 0、ID-only 冲突 0；照片 35 条、34 个唯一归档，`exists/hashMatches` 全 true，`imageReview` 全 `PENDING_NO_REGISTERED_VISION_TOOL`。

## 6. 反事实验证（本端选取）

| 场景 | 选取 | 结果 |
|---|---|---|
| 有明确口味证据 | `c01_d256/d257` | 仅此 2 条进 A，其余同段（（辣）等）均 B → 未过度外推 |
| 有明确 foodType 证据 | 米线段 `c01_d466/d469/d472/d475` | 均为 `rice_vermicelli`（列映射），报告已声明"米线不得按字面改 rice_noodle"，未把 163 条栏目线索升级 |
| 同名异菜 | 肉酱米线（c01_t48 / c01_t28）、百事可乐鸡（t11/t43）、小炒黄牛肉（3 档口） | 各自保留独立 dishId 与源行，未用菜名作连接键 |
| 只有菜名无其他证据 | `c01_d040` 山城麻辣小面（2F:71） | C，`proposedValue` 空 |
| 口味未知但 [] 合法 | 任一 C 行 | `verify_data` exit 0；D7 不把 [] 计错 |
| 原始证据冲突/作用域不明 | W2-08 段末口味选项 22 条 | B、无值；未把"可选辣度"当成该菜事实 |

## 7. 权限与副作用

- `data/` 四文件哈希与报告表逐项一致（`28a621e6…` / `818aed41…` / `f2d40f64…` / `3d370ad5…`），未变。
- `tools/pilot/id-map.json` `4478C976…`、`tools/pilot/approvals/ap-20261025-01.json` `F2B909B7…`、契约 `CA18C91E…` 未变。
- `project_before.json` 376 条基线：本端逐条重算 **0 缺失、0 哈希差异**；当前项目可见文件 377，多出的 `project.private.config.json`（mtime 2026-10-27 13:34）不在基线内，属计数口径差异，非本轮改动。
- Git：`HEAD 274ebd6`、分支 `main`、暂存 0、`status --short` 104、`-uall` 350、`git diff --check` 无空白错误（仅既有 CRLF 提示）。
- 无 Git 写、无线云调用/部署、无正式写入；本轮全部输出在项目外 `报告/`。

## 8. 问题清单（均为 P3，不影响结论）

1. **计数口径**：报告 §8 写"376 个项目文件"，实测可见 377；差异为 `project.private.config.json` 未被纳入基线。建议后续把该文件明确列入/排除基线并写清"可见文件"定义。
2. **candidateKey 与运行期键不完全同形**：CSV `recordKey` 用 `f2/素椒炸酱面（微辣）`（全角括号），`_adapterKey` 归一化为半角；两者可对应但不同字符串，建议在报告中注明归一化规则。
3. **§1 表并列 45/490/525** 易被读成"525 条正式数据"，建议在表头直接写"三个不同分母"。
4. **`evidenceLocation` 与 `contextLocation` 分列**（370 / 355），单看 CSV 需读两列；建议在表头注明"行号 / 上下文行号"。

## 9. 仍为 PENDING 的事项（不属本轮可判）

- 35 张照片的 OCR/视觉复核（无视觉工具，未看图）。
- 40 条 tastes B 与 163 条 foodType B 的业务语义/映射裁决（需负责人决定，不能由执行方或审查方代裁）。
- 448 tastes / 205 foodType 的补证（C 类，材料不足而非永久不可恢复）。
- 2 条候选的正式写入、ID 准入、上传/核对与 `verifyStatus` 变化（本轮明确未授权）。
- 35 条 `not_generated` 的补数与发布准入。

## 10. 结论

R01-E2 的**统计、证据分级、候选与正式数据隔离**均真实、可复算、无伪造；唯一的两条候选证据链完整，foodType 零候选属正确判定。可以作为"候选层"接收，但**不能据此宣称"字段已恢复"**；正式恢复需在负责人裁决 B 类 203 项与完成原图复核后另行授权。

本报告只读产出；未修改 Codex 交付物或项目文件。
