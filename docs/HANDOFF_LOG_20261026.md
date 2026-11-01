# 交接日志（2026-10-26，ZCode → 下一位 agent）

> 用途：会话切换交接。先读本文件，再读 `MEMORY.md` 与项目记忆 `shishen-project-state.md`。
> 项目根：`C:\Users\25975\Desktop\文件all\微信小程序`｜AppID `wxcc28587e4d0254ad`｜云环境 `shishen-dev-d2g4t8rgj7d0bd1e7`
> 主体：个人主体；类目「工具-信息查询」。

## 一、当前基线（实测）

| 项 | 值 |
|---|---|
| Git | HEAD `274ebd6`，分支 `main`，工作区 62 行（14 M + 48 ??），暂存区 0；**全程零 Git 写操作**（无远程仓库） |
| 生成器 | `tools/pilot/gen_records.js` — `5b349419…`（121KB 级） |
| 测试 | `tools/test_records_spec.js` — `75760d4d…` |
| 契约 | `docs/RECORD_GENERATOR_CONTRACT_20261023.md` — `51b3110f…`（约 2090 行） |
| 运行时 ID 映射 | `tools/pilot/id-map.json` — `4478c976…`，104 条，`mapVersion=1#1`（**已创建，禁改**） |
| 冻结映射 | `docs/decisions/ID_MAP_T48_T49_20261025.json` — `40642870…`（**禁改**） |
| 审批 | `tools/pilot/approvals/ap-20261025-01.json` — `f2b909b7…`（负责人授权代写，已签署，**禁改**） |
| 初始化计划 | `tools/pilot/init-plans/ip-20261025-01.md` — `5b7aec94…`（定稿，planDigest `4ed23cb4…`） |
| 正式 records 产物 | **不存在**（仅临时目录验证过；项目内 `records.json`/`records_blockers.json`/`gen-manifest.json` 均无） |

**测试基线**：Windows 主套件 **290 通过 / 0 失败 / 11 PENDING**（RESULT: OK）；其余 10 套件全绿；`check_eol` 35 文件 0 违规。WSL ext4 副本（`~/shishen-a-prime-copy`，Node v22.22.1，ext4）主套件 **285/3/13**，3 个失败为**既知平台差异** T136/T137/T232（Windows 诊断文案/NTFS 大小写假设），**不得删改或弱化**。

## 二、数据口径（不得混淆）

| 口径 | 数值 |
|---|---|
| 候选记录总量 | 525（2F 382 / 3F 143） |
| withId / nullId | 490 / 35（35 = C 档：t20 6 + t40 19 + t41 10） |
| 映射分配 | 104（t49 27×d437–463、t48 77×d464–540），`id_status=assigned_from_map` |
| 契约名册规划 | 386，`id_status=planned_from_roster`（**候选，不得视为正式分配/可发布**） |
| 价格冲突 | t11 W2-03 三组 12 条，保留 blocker，待现场核实（组合 `disambiguator` ≠ 价格已核实） |
| verifyStatus | 全 `unverified`；`verifiedAt` 全 `null`（任何轮次不得提升） |
| import_eligibility | 全 `blocked`；C19 要求 `candidate_only=0` |

## 三、本轮会话完成的工作（按序）

1. **ID 生命周期闭环**：契约旧口径收敛（89→77、395→490 等）；D7/E12 审查；`initIdMap` 补 A′ 两阶段目录 fsync（`afterLink`/`afterUnlink`），新增 `INIT_DURABILITY_UNCONFIRMED`；测试 T242/T242b。
2. **WSL ext4 环境**：Ubuntu 26.04 / 内核 6.18.33.2 / 根 `/dev/sdd` ext4；副本 `~/shishen-a-prime-copy`；Node v22.22.1；`/mnt/c` 为 9p **不得**作执行环境。
3. **初始化实施**：`init` 子命令 + `runInit` 九步预检；`ip-20261025-01` 定稿（`planDigest=4ed23cb4532aa564bc57490a83f4dfb2da6073bbe3487ccd2bad02841f9981ce`）；负责人授权代写审批并**实际执行首次初始化**（WSL ext4）→ `INIT_OK`；`id-map.json` 回迁 Windows（哈希两侧一致 `4478c976…`）。
4. **tastes 契约修订（方案 A）**：`tastes` 改为 `string[0..1]`，`[]` = 「口味信息未提供」，禁 `choice` 作默认。
5. **C18 三分**：`unassigned` / `assigned_from_map` / `planned_from_roster`；名册区间证据 + 不占映射号段 + 全局唯一；`planned` 不获发布资格。
6. **适配器** `adaptPlanRecordsForL8`（不改 C 段源构建器）：tastes→[]、verify 不提升、groupKey 层前缀+T218、disambiguator 透传、blockers 如实。
7. **P1 正式写出链路**：非注入 `write` 走既有 `publishOutputs`（S1–S10）；两处对齐修正——`blockers.recordKey` 补第 4 段 `disambiguator`；S2/S4 同步 C18 三分。真实数据临时目录 `PUBLISH_OK`/0：records 490、blockers 525、counts A490/B0/C35、manifest sha 回读一致。测试 T283（12 项）。
8. **产物消费审计**：生产代码**零消费**三产物（仅测试引用）→ 无误导入/误展示路径。
9. **上传 MVP 合规调查**：
   - 官方原文：个人主体「工具-信息查询」存在且**不含用户原创内容的传播与公开访问**；UGC 类目仅非个人主体。
   - 运营规范 5.18/10.2/10.4/3.10/15.1——有 UGC 即须内容安全检测+人工审核+投诉机制+隐私告知。
   - `operation.html`：用户安全解决方案=`getuserriskrank`（与内容审核无关，开通入口在安全中心→用户风控）；内容安全解决方案强调「**不要完全依赖内容安全服务**」、REVIEW 须人工确认、PASS 须抽查。
   - 后台截图：AppSecret 已生成（负责人操作）；**「用户生成内容场景声明」= 未声明（表单未提交）**；内容风控「自定义关键词」页存在。
   - **接口权限实测**：`TOKEN_OK` + `msg_sec_check errcode=40003 invalid openid` → **文本内容安全接口权限已具备**（未授权会返 48001）。图片接口 `media_check_async` **未实测**。

## 四、当前阻塞与待决

| # | 事项 | 状态 |
|---|---|---|
| 1 | UGC 场景声明 | **未提交**。等 MVP 功能完成、提审前按实际勾选（图片+文本、平台内容安全API+人工审核）——**不得现在代填** |
| 2 | 隐私保护指引 | 已更新，但需补投稿数据条款（收集内容/图片、用途、保留期） |
| 3 | 图片内容安全接口 | 未实测（需素材 URL）；**MVP 首版建议只做文本纠错** |
| 4 | 逐接口日配额 | 后台未列明，仍待验证 |
| 5 | 正式 records 落项目目录 | 未授权；需单独决定目标目录与 `.gitignore` 策略 |
| 6 | 35 条 C 档、12 条价格冲突 | 保持排除/待现场核实 |
| 7 | WSL 平台差异 3 测 | 待未来测试适配轮（T136/T137/T232） |
| 8 | S6 失败时临时目录保留 | 契约未规定，登记待确认（未擅自改） |

## 五、绝对边界（延续执行）

1. 不创建/修改 `tools/pilot/id-map.json`、冻结映射、审批、菜品数据、`verifyStatus`。
2. 不分配剩余 35 条；不扩映射；不重编号；不清理 blocker。
3. 不做云集合/云函数/部署/权限/数据库操作（需逐项授权）。
4. 不做 Git 写操作（add/commit/reset/clean/restore/revert/stash/checkout）。
5. 不删除/覆盖任何备份与审计证据。备份目录：`C:\Users\25975\Documents\shishen-dev-archive\`（含 `records-write-20261025`、`c18-split-20261025`、`tastes-adapter-20261025`、`records-gen-20261025`、`init-impl-20261025`、`plan-finalize-20261025`、`contract-wsl-prep-20261025` 等）。
6. 修改前先备份 + 记录 SHA-256；多行替换前先读实际文本（本会话曾因 shell 反引号吞字符损坏文档，教训：含反引号的长文本用脚本文件写入，不用 `python -c` 内联）。
7. 所有验收以实测为准；平台差异如实报告，不得弱化断言。

## 六、建议的下一步（按优先级）

1. **MVP 设计定稿**（不写代码）：`submissions` 字段、服务端校验、状态机、管理员白名单、审核日志、去重键。
2. **云函数实现**（需授权）：`submit`（服务端校验+`msg_sec_check`）、`review`（服务端改状态+日志）。
3. **隐藏审核页** `pages/review/`（非 tabBar）。
4. **提审前**：隐私条款补充 + UGC 声明提交 + 投诉入口（客服/用户反馈已有）。
5. 若要图片 UGC：先补测 `media_check_async`。

## 七、关键文档索引

| 文档 | 用途 |
|---|---|
| `docs/RECORD_GENERATOR_CONTRACT_20261023.md` | 唯一契约（§3.3 记录结构、§4.3 C17–C20、§5.6.x ID 规则、§7.2 P1 十阶段、§9.1 测试登记） |
| `docs/decisions/TECH_DECISION_INIT_IMPLEMENTATION_20261025.md` | 初始化技术决策与回滚限制 |
| `docs/decisions/ADAPTER_MAP_C_TO_L8_20261025.md` | 源域→L8 字段映射表 + 阻塞项结论 |
| `docs/decisions/APPROVAL_DRAFT_ap-20261025-01.json` | 审批草案（已被正式审批取代，留档） |
| `docs/AUDIT_PRODUCT_BOUNDARY_AND_UPLOAD_MVP_20261025.md` | 消费边界 + 上传 MVP 初版方案 |
| `docs/COMPLIANCE_REPORT_UPLOAD_MVP_20261025.md` | 官方合规取证 |
| `docs/CHECKLIST_CONTENT_SECURITY_BACKEND_20261025.md` | 后台核查清单 |
| `docs/EVIDENCE_BACKEND_CHECK_20261026.md` | 后台截图证据 + 接口权限实测结论（`6e416982…`） |

## 八、交接时的一条注意

本会话中负责人已授权并完成：AppSecret 生成（密钥未入库）、一次内容安全接口权限实测。**下一位 agent 不要重复索取 AppSecret，也不要把它写入任何文件**；若需再次实测，沿用 `%TEMP%` 一次性探针模式并由负责人本机设置环境变量。
