# C 段源域 → L8 记录域适配器映射表（设计 · 2026-10-25）

> 状态：**设计完成，实施停止**——`tastes` 字段无合法映射来源（见 §二阻塞项），按授权「若契约不允许缺失信息使用合法占位值，立即停止，不绕过校验」停止实施。本文件不含任何「建议值伪装契约原文」——所有契约依据均标注原位置。

## 一、逐字段映射表（源域=buildInitPlanRecords 输出；目标域=契约 §3.3 L8 记录结构）

| # | 目标字段 | 来源字段 | 转换规则 | 契约依据 | 默认值允许性 | 失败码 | 信息丢失 |
|---|---|---|---|---|---|---|---|
| 1 | `id` | 源 `dishId` | 逐字；null 保持 null | §5.6.4/C18 | 不适用 | 键在映射且 dishId 不一致→S4 域失败 | 无 |
| 2 | `shopId` | 常量 `c01` | 2F/3F 同店 | §3.3 表 :327 | 常量有据 | — | 无 |
| 3 | `stallId` | 源 `stallId` | 逐字 | §3.3 :326（名册冻结） | — | — | 无 |
| 4 | `name` | 源 `name` | 逐字 | §3.3 | — | — | 无 |
| 5 | `price` | 源 `price` | 逐字（D5 校验由 L8 复核） | §3.3/D5 | — | — | 无 |
| 6 | `foodType` | 源 `foodType` | 逐字（枚举 8 值已由源域映射） | §3.3 :325 | — | E3 | 无 |
| 7 | **`tastes`** | **无来源** | **见 §二：无合法映射，阻塞** | §3.3 :328「恰好 1 个，取自 light/mild_spicy/spicy/choice」 | **空数组不合法；枚举无『不适用』值** | — | — |
| 8 | `source.kind` | 常量 `'field'` | 全部记录源自价目表现场转录 | §5.2 :331「恒 field」+ C1 | 常量有据 | — | 无 |
| 9 | `source.detail` | 源 `source_detail` | 逐字（null→`'现场采集 · 未核实'`？**不允许**——契约 §5.4 要求 detail 含牌面原文；源域 null 的 498 条无牌面原文（2026-10-27 校正：按 525 − 39 = **486** 条，见契约 T277；498 为当时口径，原文保留） → 见 §二附注） | §5.4 | **待核** | — | — |
| 10 | `source.ref` | 源 `sourceRef` | 逐字（如 `TRANSCRIPTION_2F.md#W2-05 第 297 行`） | §3.3 | — | — | 无 |
| 11 | `verifyStatus` | 常量 `'unverified'` | **只此一个值**，不从映射 active 推导可信度 | 授权规则+§5.2（field+unverified 合法组合 :340） | 显式设置 | — | 无 |
| 12 | `verifiedAt` | 常量 `null` | 同上 | 同上 | 显式设置 | — | 无 |
| 13 | `note` | 常量 `''` | 空串=无备注（如实） | §3.3 | 合法 | — | 无 |
| 14 | `gen.tier` | 源 `tier` | 逐字（A/C；C 档 not_generated 由 L8 判定） | 授权规则+§4.1 | — | E3 | 无 |
| 15 | `gen.groupKey` | 源 `groupKey`（牌面原文）+层前缀 | **层前缀规则**：`f2/`/`f3/`+原文（T218：gen.groupKey=层前缀+原文；rawGroupKey=原文）——**映射用的四段 key 不变**（源 key 逐字进映射解析） | T218/§5.6.5.2 | — | — | 无（原文在 rawGroupKey 位保留） |
| 16 | `gen.rawGroupKey` | 源 `groupKey` | 逐字（原文） | T218 | — | — | 无 |
| 17 | `gen.specLabel` | 源 `specLabel` | 逐字 | §5.6.5.2 R3 | — | — | 无 |
| 18 | `gen.rawRow` | 源无对应物 | **契约 §3.3 :187 标注非必填（否）**→ 省略 | :187「原始行文本，便于复核」 | 省略合法（非必填） | — | **有**：行原文不在源域（源域以 sourceFile/Section/Line/Ref 保留位置证据）——如实标注，不伪造 |
| 19 | `gen.sourceLine` | 源 `sourceLine` | 逐字 | §3.3 | — | — | 无 |
| 20 | `gen.generation_status` | 由 tier 推导 | A→`generated`；C→`not_generated` | §4.1 | 推导规则=契约定义 | — | 无 |
| 21 | `gen.evidence_status` | 由源域来源推导 | 价目表转录=traceable（§4.2 A 档标准）；C 档 unclear_source | §4.2 | 推导规则=契约定义 | — | 无 |
| 22 | `gen.import_eligibility` | 常量 `'blocked'` | 当前 0 条可入 CSV（C19） | §4.3 C19 | 有据 | — | 无 |
| 23 | `gen.id_status` | 由 id 推导 | id≠null→`assigned_from_map`（须命中运行时映射，S4）；null→`unassigned` | §4.3/C18 | — | S4 失败码 | 无 |
| 24 | `gen.blockers` | 源域 problems 对应 | **如实**（不清空）；源域 problems 按 stallId/key 关联 | §6.3 | — | — | 待实施时核对粒度 |

## 二、阻塞项（实施停止原因）

**`tastes`（契约 :328：`string[1]`，必填，「恰好 1 个，取自 light/mild_spicy/spicy/choice」）**：
- 源域（buildInitPlanRecords）记录**无口味信息**（价目表牌面不含口味列）；
- **空数组不合法**（恰好 1 个）；
- 枚举四值中 `choice` 的语义=「菜品本身不固定辣度，点单时由顾客选」（`data/index.js:38-45` 注释原文）——**与「牌面未标注口味」语义不符**，用作默认值=编造口味信息；
- 授权规则：「tastes 没有可靠来源时，先按契约判断空数组是否合法；不合法则**停止并报告，不得编造口味**」→ **停止**。

**附注（次要待核项，不单独阻塞）**：`source.detail`——§5.4 要求含牌面原文，源域仅蛋炒 39 条有 source_detail（白名单），其余 486 条无牌面原文可入 detail；若 detail 允许为位置证据描述（sourceRef 形式）则可映射，实施轮需按 §5.4 原文核定。

## 三、负责人裁决选项（tastes）

| 选项 | 内容 | 代价 |
|---|---|---|
| A | 契约修订：`tastes` 允许空数组（`string[0..1]`），语义=「牌面未标注口味」 | 改契约 §3.3+下游枚举校验（verify_data/matcher 的 tastes 假设需评估） |
| B | 契约新增枚举值（如 `unspecified`） | 同上+`data/index.js` TASTE_LABEL+筛选语义（matcher）改动面更大 |
| C | 业务裁决：牌面无口味信息的菜品**如实**取 `choice`（「现场定」业务口径，类比暂定名先例） | 零代码改动，但 choice 被赋双重语义（需契约注记明示，防止筛选层误命中） |
| D | 暂停 records 生成链路，待现场补录口味后实施 | 链路延后 |

裁决后适配器实施约一轮可完成（映射表其余 23 项均已确定）。

## 四、边界确认

本轮零代码改动（gen_records.js 保持 `984bdf6f`、测试 `3466f535` 未动）；本文件为唯一新增；未触碰冻结映射/菜品数据/核验状态/审批/云端；零 Git 写操作；既有备份未动。

## 五、后续裁决与落地（2026-10-25 同日）

- **tastes 阻塞已关闭**：负责人裁决方案 A——`tastes` 由「恰好 1 个」修订为 `string[0..1]`，`[]` 唯一语义=「口味信息未提供」（不是口味；不得解释为不辣/可选辣度；不加 unspecified 枚举）。适配器据此输出 `tastes: []`，禁止 `choice` 作未知默认。契约 §3.3 :328 已改，历史规则保留于注记。
- **C18 结构性冲突已解决（三分）**：386 条 ID 经核实为**契约名册区间确定性派生**（§5.6.1/§5.6.3 表；§5.6.3 明文「候选映射规则，不是本轮已分配的正式 ID」），既非映射分配、亦非其它流程的正式分配。§4.3 C18 修订为三类：`unassigned` ⇔ id null｜`assigned_from_map` 必须与获批映射逐条一致（篡改 fail-closed）｜`planned_from_roster` 仅凭名册区间证据成立，且不得占用映射号段、不获发布资格。适配器经 `parseRosterRows` 校验区间成员后预置该状态；碰撞/待审按 G-6=B 置 null。
- **实测（Windows）**：dry-run → `L8_IN_MEMORY_ONLY` / exit 0 / 零违规；104 映射 + 374 名册规划 + 12 碰撞 null = 490 条；35 条 C 档排除不变；`verifyStatus`/`verifiedAt` 未提升；零写盘。测试 T281/T282 新增，实测 289/0/11。
- **write 写出/发布（P1 十阶段）：已实现（2026-10-25 起）**——`publishOutputs` 写出四件产物，T283 覆盖 S6/重复运行/E9_SUM/E30/写临时失败；原文「继续 fail-closed 落 `SKELETON_NOT_IMPLEMENTED`」为 2026-10-25 时点状态，该分支现不可达（保留为历史）。**映射未扩容、35 条 C 档未处理**仍为现状。
