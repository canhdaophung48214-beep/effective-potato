# 技术决策记录：初始化实施方案落地（2026-10-25）

> **决策来源**：本项目技术负责人（ChatGPT，经产品负责人转达的 2026-10-25 授权书）。
> **实际执行人**：ZCode（执行 agent，负责代码修改、命令执行、测试与审计）。
> **性质**：技术决策记录（TDR）。**技术负责人的技术决策 ≠ 产品负责人的正式审批**——
> 后者必须由产品负责人本人签发 `tools/pilot/approvals/ap-YYYYMMDD-NN.json`（见 §六），
> 在那之前一切初始化执行均被 runInit 预检链拒绝（G-4=C，T280 场景 1/2 实测）。

## 一、已确定的技术决策（技术负责人 2026-10-25）

| # | 决策 | 实现位置 |
|---|---|---|
| 1 | `assigned_unverified` → 运行时 `active` **批准为首版设计语义**；`active` 仅表示 ID 映射条目处于生成器可用状态，**不代表菜品已核实、来源可信或允许发布** | `buildInitPayloadFromFrozen`（gen_records.js，函数头注释声明两状态域不得互相推导）；T280 场景 14 断言 104 条 status 全 active；records 层 verifyStatus 全量 unverified 不变 |
| 2 | 首版只处理冻结映射的 104 条（t49 27×`c01_d437`–`c01_d463`、t48 77×`c01_d464`–`c01_d540`）；不得重新分配、插入、删除或重编号 | runInit 预检 6（对账+区间断言 437/463、464/540；转换器逐字复制 dishId）；T280 场景 6-9 |
| 3 | 不得给其余 35 条缺失 ID 的记录自动补号；不得改任何 `verifyStatus`/`verifiedAt`/来源状态 | 转换域仅限冻结映射条目（预检 6 foreign 检查：t48/t49 之外条目拒绝）；T280 场景 7（C 档误纳入拒绝）+场景 14（35 条 C 档无一键进入 payload）；生成器 records 构建路径零改动 |
| 4 | 首版 `orphans=[]` 必须由源数据、冻结映射和生成器输出的实际对账证明；无法匹配/重复/多余即 fail-closed | runInit 预检 6 键集双向对账（缺/多/异均 RECONCILE_MISMATCH）；T280 场景 9（伪键→orphan 证明失败） |
| 5 | `schemaVersion` 与 `mapVersion` 为不同字段：前者=结构版本（=1，硬校验）；后者=映射版本（`schemaVersion + 生成序号`，**契约 §5.6.5.8.1 表 :817 已有此规则、:823 示例 `1#1`**，:833 明确运行时不校验格式、由审批一致性核对承担）。首版取值 `1#1` 按 :817 规则推导（结构 v1+首次生成序号 1）——**取值确认仍列计划 T-5 待负责人批准，不自行视为已批准** | 转换器 `initialization.mapVersion` 取自审批记录字段（runInit 预检 3 必填校验）；payload 不硬编码 |
| 6 | 审批材料如实标识决策来源/真实执行人/批准时间；不得虚构个人、签名、审批时间或哈希。技术负责人决策记录可由本轮生成，但不得伪装成系统审批或他人签署 | 本文件（TDR）+ 未签署审批草案（§六）；runInit 预检 3：`result!=='approved'` 或 `approvedAt` 缺失即 E26 拒绝——草案放进正式目录也无效（T280 场景 2/3 实测） |

## 二、绑定哈希（2026-10-25 实测）

| 对象 | SHA-256 | 字节 |
|---|---|---|
| 冻结映射 `docs/decisions/ID_MAP_T48_T49_20261025.json` | `40642870A2C5CB512E8B5DBC5725AC2754C13B39057A83978DCE01C57E54E491` | 37,741 |
| 初始化计划 `tools/pilot/init-plans/ip-20261025-01.md`（草案） | `20CB7A250FA385E1BF6ED8B2BB8DB1541F939FB31C01197F574BF28CC940B1F5` | 15,445 |
| 生成器（本轮实施后）`tools/pilot/gen_records.js` | `984BDF6FE2ABD5BB7C432E2B0CFBE8A6A02AFE4868C41B2A6AB424F6FFB3DFB2` | — |
| 测试（本轮实施后）`tools/test_records_spec.js` | `1E1A82E9824581DBDD19E027510319827F785AF546CD068D86542A3F748A5F9A` | — |

## 三、payload 规范化序列化规则与摘要算法

- **转换器**：`buildInitPayloadFromFrozen(frozen, approval, approvalId)`——纯函数，同输入必得同字节（时间字段单一来源=审批 `approvedAt`，不取执行机器时钟）。
- **键序**：对象键按 UTF-8 字节序升序书写（与契约 §5.6.5.8.3 规范化算法一致）；`entries` 按 `key` 的 UTF-8 字节序排序（`Buffer.compare`）。
- **序列化**：`JSON.stringify(value, null, 2) + '\n'`（UTF-8、LF、无 BOM）。
- **摘要**：payload 字节 sha256（小写 64 位 hex）——由 runInit 结果 `summary.payloadSha256` 报告（执行审计），**不写入 payload 自身**；计划侧摘要（`planDigest`）按契约 §5.6.5.8.3 对计划载荷块计算（`computePlanDigest`），审批记录绑定 `planDigest`，runInit 预检 4 用 `verifyPlanDigest` 复算比对（E25）。
- **条目字段来源**：`key`/`stallId`/`groupKey`/`specLabel`/`disambiguator`/`dishId`/`sourceRef` 逐字复制冻结映射；`status='active'`（决策 1 语义）；`assignedAt`/`generatedAt`=审批 `approvedAt`；`approvedBy='user:负责人审批 <planRef>'`；`name`/`price`/`tier` **不进入映射**。

## 四、执行环境与回滚限制

- **执行环境（A′）**：WSL2 Ubuntu（ext4 根文件系统 `/dev/sdd`）项目副本 `~/shishen-a-prime-copy`（9 个关键文件与 Windows 源 9/9 哈希一致）+ Node v22.22.1（WSL 内 apt 安装）。`/mnt/c`（9p）不得用作执行环境；Windows 正式路径在预检 2 被 `INIT_FSYNC_UNAVAILABLE` 挡下（实测 exit 3、零写入）。
- **回滚限制**：`id-map.json` 一旦真实创建即为持久化映射（追加-only、永不重编、退役不复用），**没有自动回滚**；回滚=人工删除+重新走全流程审批。因此写入前九步预检全部 fail-closed（T280 矩阵覆盖）。
- **失败人工处置**：`INIT_DURABILITY_UNCONFIRMED`（afterLink）→ 保留目标+tmp（同 inode 可比对），人工核验内容一致后删除 tmp、重跑初始化（目标已存在则先人工裁决）；（afterUnlink）→ 目标有效、tmp 可能残留，人工清理；`INIT_RECHECK_MISMATCH` → 目标保留交人工；其余预检失败 → 零写入、修正根因后重跑。

## 五、runInit 预检链（实现位置：gen_records.js `runInit`）

目标防覆盖（lstat）→ 执行环境（checkDirFsync，A′）→ 审批存在+字段（G-4=C / E26）→ planDigest 复算（E25）→ 冻结映射哈希绑定 → 对账+基线（525/490/35/0 + 27×437-463 + 77×464-540 + orphan 证明 + C 档保护）→ 转换+validateMapStructure（E13/E14/E15）→ **唯一写盘点 initIdMap**（A′ 两阶段目录 fsync+读回）。CLI：`init --approval ap-YYYYMMDD-NN`（唯一选项）；gen 域与 init 域白名单互斥；测试注入面（approvalDir/targetPath/frozenMapPath/planText/records/__test*）全部 CLI 不可达。

## 六、审批草案状态（2026-10-25 定稿轮更新）

`docs/decisions/APPROVAL_DRAFT_ap-20261025-01.json` 为**未签署草案**：
- **未签署字段**：`approvedAt: null`（批准时间）、签署确认（`result: "draft-unsigned"`）——产品负责人签发时须本人填写批准时间并将 `result` 改为 `"approved"`，复制为 `tools/pilot/approvals/ap-20261025-01.json`；
- **`planDigest` 已定稿**：`4ed23cb4532aa564bc57490a83f4dfb2da6073bbe3487ccd2bad02841f9981ce`（对定稿计划 `ip-20261025-01` 的载荷计算；计划已于同日定稿——三项技术决策（active 语义、mapVersion `1#1`、首版仅 104 条排除 35 条）已获技术负责人批准并写入计划 §六/§七，`planDigest` 是计划摘要而非签署信息，填入不构成审批）；
- **防循环设计已落地**：`assignedAt`/`generatedAt` 依审批记录产生、以计划载荷 `recordsRules` 规则绑定、**不进入摘要**；审批记录携带 `approvedAt` 与 `planDigest` 两个独立字段，签署不改变摘要；
- 草案位于 `docs/decisions/`（非正式审批目录），runInit 只认 `tools/pilot/approvals/`——草案复制进去也会因 `result≠approved` 被 E26 拒绝（T280 场景 2 实测）。
- **技术负责人决策与实际执行人审批的区别**：本 TDR 记录的是技术方案决策（ChatGPT）；`approvedBy`/`approvedAt`/`approvalRef` 的真值只能来自产品负责人的签发动作（§5.6.5.8.2 A1：唯一批准人=项目负责人）。

## 七、本轮验证状态

Windows 主套件 **287/0/11**（T236/T108/T243 改写、T279/T280 新增全部 PASS）；其余套件与 WSL ext4 验证见本轮审计报告。**测试全绿与代码入口就绪不构成正式初始化授权**。
