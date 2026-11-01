# 审计记录：初始化实施方案落地轮（2026-10-25）

> 授权范围：初始化基础设施（CLI 入口+预检链+转换器）与审批材料准备。本轮**未创建正式运行时映射、未执行正式初始化、未签发审批、零 Git 写操作、零云端操作**。技术决策记录见 `docs/decisions/TECH_DECISION_INIT_IMPLEMENTATION_20261025.md`（技术负责人决策 ≠ 产品负责人审批）。

## 一、代码变更（tools/pilot/gen_records.js）

改前 `4fe91651…`（121,100 B）→ 改后 **`984bdf6f…`**。备份 `Documents\shishen-dev-archive\init-impl-20261025\`（源/备一致）。

| 变更 | 内容 |
|---|---|
| 常量区 | 新增 `INIT_SUBCOMMAND='init'`、`INIT_OPTION_WHITELIST={'--approval'}`（与 gen 白名单互斥） |
| `parseArgv` | 子命令槽接受 gen（可省略）/init；白名单按子命令选取；`--approval` 必填且格式 `ap-YYYYMMDD-NN`（第 3 步域内，五步框架不变）；gen 的 --write/--dry-run/--out 互斥逻辑仅 gen 域 |
| `buildInitPayloadFromFrozen` | 冻结映射→运行时 payload 确定性转换器（104 条；`assigned_unverified`→`active` 首版语义+防混淆注释；assignedAt/generatedAt=审批 approvedAt 单一时间源；approvedBy='user:负责人审批 <planRef>'；键按 UTF-8 字节序、entries 按 key 字节序；name/price/tier 不进映射） |
| `canonicalJsonStringify` | `JSON.stringify(v,null,2)+'\n'`（键序由构造保证） |
| `runInit` | 九步预检链（见 TDR §五）：目标防覆盖→执行环境（A′）→审批存在+字段（G-4=C/E26，草案 result≠approved 无效）→planDigest 复算（E25）→冻结映射哈希绑定→对账+基线（525/490/35/0+27×437-463+77×464-540+orphan 证明+C 档保护）→转换+validateMapStructure（E13/E14/E15）→唯一写盘点 initIdMap（A′ 两阶段 fsync+读回）。测试注入面（approvalDir/targetPath/frozenMapPath/planText/records/__test*）全部 CLI 不可达 |
| `main` | init 子命令分派 runInit；导出面扩为 `{run, runInit, __test__}` 三键 |

**门控实测**：`init`（无参）→E27/2；`init --approval ap-20261025-01` 在 Windows 正式路径→**INIT_FSYNC_UNAVAILABLE/3 零写入**；在 WSL ext4 副本→**APPROVAL_MISSING/1 零写入**（G-4=C 真实行为）；`gen --approval`→E27/2。正式 `tools/pilot/id-map.json` 与 `approvals/` 全程不存在。

## 二、测试变更（tools/test_records_spec.js）

改前 `38945c8e…`（298,332 B）→ 改后 **`1e1a82e9…`**：

| 测试 | 变更 | 结果 |
|---|---|---|
| T236 | 改写：gen 域三开关仍不可达+gen 拒收 --approval；init 域参数校验（缺参/缺值/格式/空值/白名单外/位置参数→E27/2）；门控平台自适应断言（Windows=FSYNC/3、ext4=APPROVAL_MISSING/1）+正式映射未被创建 | PASS |
| T108 | 导出面断言同步三键+runInit 函数校验 | PASS |
| T243 | 改写：run/main/publishOutputs 零引用 initIdMap/verifyPlanDigest（无隐式初始化）；runInit 为唯一生产调用点（各恰 1 处）；三键导出；__test__ 仍 9 名 | PASS |
| T279 | 新增：T100⑧ 迁移预演（映射存在→mapLoaded→SKELETON_NOT_IMPLEMENTED/1 无 E12、outDir 零写入；T100⑧ 本体 E12 断言保留） | PASS |
| T280 | 新增：runInit 预检链 15 场景矩阵（审批缺失→APPROVAL_MISSING/1｜草案→E26｜字段缺失→E26｜E25｜冻结映射哈希不符｜105 条/C 档误纳入/重复 dishId/伪键→RECONCILE（orphan 证明 fail-closed）｜基线不符｜目标已存在/3｜环境不可用/3｜afterLink 失败透传→DURABILITY/3（目标+tmp 保留）｜全链成功→INIT_OK+104 条 status 全 active+approvedBy 规则+initialization 三元组+orphans 空｜**35 条 C 档无一键进入 payload**）。全部 mkdtemp 隔离+合成材料 | PASS |
| T242/T242b/T100/T45b/T33/T34/T124 | 未改，全部保持 PASS（A′ fsync 顺序与故障注入覆盖保留） | PASS |

## 三、验证结果

| 环境 | 内容 | 结果 |
|---|---|---|
| Windows | test_records_spec | **287/0/11 PENDING**（RESULT: OK，exit 0） |
| Windows | 其余 10 套件（regression 122/0/3、test_check_eol 57/0、import_data、verify_data、cloudrepo 102/0、seed_auth、index_state 203/0、pages 106/0、seed_pilot、seed_s21） | 全部通过（exit 0） |
| Windows | check_eol 29 文件 0 违规；git diff --check 干净；只读 ID 基线探针 ALL PASS（525/490/35/0/0+104/104） | ✓ |
| WSL ext4 副本 | 副本单向更新本轮 4 文件（哈希与 Windows 一致）；语法检查 OK；CLI 门控 `init --approval`→**APPROVAL_MISSING/1**（node spawnSync status 实测；wsl.exe 的 `$?` 传递有假象已绕开）；主套件 **282/3/13**——3 失败（T136/T137/T232）与上轮完全相同（测试的平台特定假设：Windows 诊断文案锚定/NTFS 大小写不敏感，非 A′ 链路缺陷，生成器行为两侧均契约合规）；2 额外 PENDING（T140/T238=mklink /J 联接点测试内建平台降级）；**本轮新增 T236/T108/T243/T279/T280 在 ext4 全部 PASS**；只读探针 ALL PASS | ✓ |

## 四、审批材料

- 技术决策记录 `docs/decisions/TECH_DECISION_INIT_IMPLEMENTATION_20261025.md`（`54cc92e0…`）：技术负责人六项决策+实现位置、绑定哈希（冻结映射 `40642870…`/37,741 B、计划 `20CB7A25…`/15,445 B、生成器/测试）、payload 规范化规则与摘要算法、mapVersion 查证（契约 :817/:823 已有规则，取值 `1#1` 按规则推导、确认仍列 T-5 待批准）、执行环境与回滚限制、失败人工处置、技术决策与负责人审批的区别。
- 未签署审批草案 `docs/decisions/APPROVAL_DRAFT_ap-20261025-01.json`（`a8e2e732…`）：`result:"draft-unsigned"`、`approvedAt:null`、`planDigest:null`（签发前对定稿计划计算填入）、签发栏空——位于 docs/decisions/（非正式审批目录），复制进 tools/pilot/approvals/ 也会被 E26 拒绝（T280 场景 2 实测）。

## 五、边界确认

未创建 `tools/pilot/id-map.json`（Windows 与 WSL 副本均不存在）；未对正式路径执行 `initIdMap`（runInit 的正式路径预检仅只读探测且在写入前拒绝）；未在 Windows 项目目录或 WSL 副本执行正式初始化（全部初始化测试在 mkdtemp 隔离目录）；未伪造审批（草案明确标注未签署+程序性无效）；冻结映射 `40642870…` 与全部 dishId 未动；verifyStatus 未动；零云端操作；**零 Git 写操作**（HEAD `274ebd6` 全程未变，暂存区 0，工作区 62 行同构）；未删除/覆盖任何备份、历史计划、临时文件、探针结果；WSL 副本仅单向更新（Windows→WSL），未同步回 Windows 原项目。

## 六、遗留事项（待下轮）

① 契约 §9.1 需登记 T279/T280+T236/T108/T243 改写+实测计数行 287/0/11（总数 298）；② 契约 §10.6.4 G-7/O-1 导出面规则需同步三键；③ 计划 `ip-20261025-01` 载荷 records 仍为附件绑定声明，正式审批前需按 TDR §三 规则定稿并计算 planDigest；④ WSL 平台差异三测试的适配（文案断言兼容两平台）留待未来测试轮。
