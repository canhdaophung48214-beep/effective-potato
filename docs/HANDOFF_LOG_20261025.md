# 交接日志（食神寻味 · 记录生成器项目）

> 用途：把本对话到 2026-10-25 13:18（Asia/Shanghai）为止的全部上下文交给另一个 agent 接手。
> 读法建议：先读 §1–§5（红线、现状、文件地图），再看 §9（未决事项）和 §10（下一步）。
> 本文件只新增，未修改任何既有文件；未执行任何 Git 写操作、未触碰云端。

---

## 1. 接手须知的五条硬约束

以下来自用户（项目负责人）多轮明确裁决，**任何一条都不要自行放宽**：

1. **不得执行 Git 写操作**（`add/commit/reset/clean/restore/checkout/revert/stash` 全部禁止）。只允许 `git status/log/diff/rev-parse` 这类只读命令。仓库至今 `HEAD = 274ebd6`，全部工作都在工作区。
2. **不得触碰云端**：不部署云函数、不调用线上函数（除用户明确要求的只读检查）、不写云数据库、不改集合权限。云环境 `shishen-dev-d2g4t8rgj7d0bd1e7`。
3. **不得创建这五类正式产物**：`tools/pilot/id-map.json`、`tools/pilot/approvals/`、`records.json`、`records_blockers.json`、`gen-manifest.json`。
4. **不得启动正式初始化**（ID 映射初始化），该项当前为 **BLOCKED**，原因是 D7（Windows 目录 `fsync` 返回 `EPERM`，契约要求目录持久性必须由平台提供，不支持时"默认停止"）。
5. **不得为通过测试而放宽断言**，也不得把「静态文本断言通过」说成「运行时行为已验证」。测试状态必须如实区分 `PASS / FAIL / PENDING / BLOCKED`。

补充：每轮只改用户授权的文件；发现必须改授权范围外文件时，先停止并报告，不得擅自扩大范围。

---

## 2. 项目是什么

微信原生小程序「食神寻味」（山东理工大学校园美食指南），历经三阶段演化：

1. **产品阶段**：筛选/随机推荐/四栏导航（首页、评分、社区、我的），数据为本地演示数据。
2. **云端阶段**：接入云开发（`cloudRepo` 适配层、首页三态、seed 云函数受控批次）。
3. **当前阶段（主线）**：为「记录生成器」建立可审计的契约与代码，把真实采集数据（三份 Markdown 转述稿）转成**结构化的候选记录计划**，并逐步实现 ID 映射、发布协议、初始化机制。**生成器目前仍是"只读计划产物"阶段，未生成任何正式数据。**

---

## 3. 环境与常用命令

- 工作目录：`C:\Users\25975\Desktop\文件all\微信小程序`（含中文路径，PowerShell 下注意编码）。
- Node：`v26.5.1`；Windows NT 10.0.26100。
- 关键命令（均在项目根执行）：

```bash
node --check tools/pilot/gen_records.js
node --check tools/test_records_spec.js
node tools/test_records_spec.js      # 当前基线：281 通过 / 0 失败 / 11 待实现（总 292）
node tools/check_eol.js              # 行尾/BOM 规范检查，当前 21 文件 0 违规
git status --short                   # 只读；当前 61 行
```

- 备份习惯：每次改文件前把原件复制到 `%TEMP%\stage-<主题>-<时间戳>\`，并用 SHA-256 逐字节核验。最近一次：`%TEMP%\stage-r5-20261025-131256\`。

---

## 4. 当前状态快照（2026-10-25 13:18 实测）

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `docs/RECORD_GENERATOR_CONTRACT_20261023.md` | 212,401 | `f226f7b7d4f0053f50471ffa12d5d8ece9373dcb9c73aec9fa00989bdcd02ea2` |
| `tools/pilot/gen_records.js` | 112,981 | `5fadcbce2c3ccb5458af56415fe30de1a2165cb4fef9635c25b89ec05bcb810d` |
| `tools/test_records_spec.js` | 283,696 | `4d02d27e291522225251cccb20e4ab2163b4cddcbed22fb3a0686d1cab98d6e7` |

- 测试：`281 PASS / 0 FAIL / 11 PENDING`（总 292，exit 0）。
- Git：`HEAD 274ebd6`、分支 `main`、暂存区 0 项、`git status --short` 61 行。
- 五类禁止产物：全部 `Test-Path = False`。
- 生成器只读计划产物（`buildInitPlanRecords({})`）实测：
  - `counts = { total: 537, withId: 384, nullId: 153, dupKeys: 6, dupIds: 0 }`
  - `perKind = { 2F: 394, 3F: 143 }`；`addons = 8`；`collisions = 0`
  - 分档 `A/B/C` 仍按契约规划值为 `463/39/62`（与实测 total 537 并存，见 §9-①）

---

## 5. 文件地图（按用途）

### 5.1 契约与计划（文档层，全部只读参考；只有用户授权才能改契约）

- `docs/RECORD_GENERATOR_CONTRACT_20261023.md`（**唯一规则来源**，约 1,970 行）：
  - §1–§2：目标、非目标、输入形态（四类表 S1/S2/S3/S4/S5_COMBO/EXCL）、价格六形态、跳过段清单。
  - §3：数据模型——`run(opts)` 唯一生产入口、记录结构（含 `gen` 内部块）、`meta.counts` 语义、退出码 0/1/2/3/4。
  - §4：三判定（生成/证据/导入资格）互不推导；A/B/C 三档；C17–C20 断言。
  - §5：ID 映射（`schemaVersion/keyFormat/entries[]/orphans[]`）、键合成 R1–R8、五步校验顺序、`pending_review` 规则（PK-1）、`NEW_KEY` 规则（NK-R1–R4）、审批与初始化机制（§5.6.5.8）、摘要 `planDigest` 口径（§5.6.5.8.3）。
  - §6：判据矩阵、展开规则 R1–R8、`R6` 唯一例外（§6.1.1 西雅苏套餐白名单）、候选编号冲突 `RANGE_COLLISION`（§6.1.0）、**§6.1.2 W2-03 计数口径说明（新增）**、§6.2 预期条数（**仍是旧值 419/145/564，未同步**）。
  - §7：发布协议 P1（八阶段 S1–S10、`PUBLISHING`/`COMMITTED` 标记、失败分类、退出码、修复路径）。
  - §9：测试矩阵（T1–T275）与分层 L-A/L-B/L-C；§10：决策登记（G-4…G-8、D1–D4、A1–A5、Q6/Q7/Q8/Q9-P、D-EXIT）；§11：边界声明。
- `docs/RECORD_LEVEL_GENERATION_PLAN_20261023.md`：记录级生成方案（含 W2-03 47 条的历史口径出处 `:40`）。
- `docs/RAW_DATA_BLOCKERS_20261023.md`：数据阻塞报告（含 47/40 的口径沿革 `:90`/`:94`/`:322`）。
- `docs/SERVICE_2F_3F_REVIEW_20261023.md`、`docs/COLLECTION_STATUS_REPORT_20261023.md`：采集阶段评审与状态报告。
- 其他历史文档：`docs/CLOUD_LINK_TEST_PLAN_12.md`、`docs/DECISION_*`、`docs/OWNER_DECISION_SHEET_*`、`docs/decisions/` 等。

### 5.2 生成器与测试（代码层）

- `tools/pilot/gen_records.js`（112,981 B）：**只读计划生成器**。
  - 导出面冻结为 `{ run, __test__ }`（`__test__` 恰 9 名：`parseDoc/classifyTable/expandTable/buildSourceDetail/judgeGeneration/judgeEvidence/judgeEligibility/summarize/assertContract`）。
  - `run(opts)` 支持 `mode`、`outDir`、`mapPath`（仅内部注入）、`records`（仅内部注入）、`testBaseline`、`faults` 等测试通道；CLI 只认 `--write/--dry-run/--out`（白名单，其余 → `E27_CLI_USAGE` / 2）。
  - 关键常量：`PROD_BASELINE = { total: 545, A: 463, B: 39, C: 62, f2: {402,347,39,33}, f3: {143,116,0,29} }`（**未改，见 §9-①**）、`R5_SPEC_STALLS = ['c01_t28','c01_t32']`（2026-10-25 新增）。
  - 已实现：解析→分类→展开（R1–R8、S5 双拼、加料 `addons[]`）→三判定→汇总→断言→ID 映射校验（五步）→`resolveRecords`（`assigned_from_map/KEY_COLLISION/PENDING_REVIEW/NEW_KEY` + `ORPHAN_IN_MAP`）→内存构建产物（L8）→P1 发布（S1–S10 + `PUBLISHING`/`COMMITTED`）→故障注入。
  - **未实现/未接线**：初始化写入 `initIdMap` 与三处 `verifyPlanDigest` 无生产调用点（被测试锁定为"定义存在、生产路径不调用"）；真实目录 `fsync` 走不通（D7）。
- `tools/test_records_spec.js`（283,696 B）：T1–T275 规格测试，三层结构（文档静态 L-A / 纯函数内存夹具 L-B / 隔离文件系统集成 L-C/L-D）。混合使用真实子进程、真实 `fs`、以及 `REF` 参考实现做交叉验证。
- `tools/check_eol.js` + `tools/test_check_eol.js`：行尾/BOM 规范检查器（`docs/**` 强制、`tools/**` 报告模式），支持 `--json`，无 `--fix`。
- `tools/pilot/TRANSCRIPTION_2F.md`（46,551 B）与 `TRANSCRIPTION_3F.md`：**真实数据的唯一来源**（现场抄录，含待确认项与裁决记录）。生成器只读它们，不得手改生成结果。
- `tools/pilot/batch1*/`、`tools/templates/`、`tools/import_data.js`、`tools/verify_data.js`：早期 CSV 导入链路（已被记录生成器方案取代，仍是历史资产）。

---

## 6. 已完成的工作阶段（时间线，压缩版）

1. **产品与云端**（早期）：小程序筛选/随机/四栏导航；云开发接入与 `cloudRepo`；首页三态；seed 云函数受控批次（8 条演示数据）；A0 云端安全闭环（删除 `dbCheck`、`seed` 加 `ADMIN_OPENIDS` 鉴权并部署）。
2. **采集与口径**（中期）：服务楼 2F/3F 价目表转述成 Markdown（2F 16 档口 316 表格行 / 3F 10 档口 145 行）；建立 A/B/C 档与条数口径。
3. **CSV 导入链路**（中期）：`import_data.js` + `verify_data.js`，实现证据校验、`--out` 护栏、原子写入与回滚。
4. **契约工程**（近期，主线）：
   - Q6 发布协议审查 → 冻结 S1–S10、`PUBLISHING`/`COMMITTED`、失败分类与修复路径。
   - G-4…G-8、D1–D4、A1–A5、NK/PK 规则落盘；`E1–E30` 错误码登记（E16 空缺）。
   - P1/P2/L8 实现：解析、展开、三判定、汇总、断言、内存产物、发布协议（含 S10 读侧校验与 `COMMITTED`）。
   - ID 映射 M1–M4：五步校验、`makeKey` 与 `REF` 对齐、`resolveRecords` 四分支 + 孤儿诊断。
   - M5/M5C：初始化机制、审批载荷、`planDigest` 三阶段口径（§5.6.5.8.3）。
   - W2-03 双拼与加料：`S5_COMBO` 8 条、`addons[]` 8 项、`RANGE_COLLISION` 三类诊断。
   - **本轮（最后）**：R5 规格拆条收紧（只对契约授权档口生效）+ W2-03 历史口径说明入契约 §6.1.2。

---

## 7. 关键口径（接手必背）

- **两个 R1–R8 不要混淆**：§6.1 的 R1–R8 是**展开规则**；§5.6.5.5.4.1 的 R1–R8 是**键归一化规则**。
- **记录 vs 行**：一条记录＝一个可单独下单、单独定价的售卖单元。加料/套餐/自选组合不产生记录。
- **档口映射**：东①–⑫ → `c01_t01`–`c01_t12`；西①–㉕ → `c01_t13`–`c01_t37`；3F 十档口为候选 `c01_t38`–`c01_t47`（候选≠已分配）。常用：W2-03 来一碗肉肉饭 `c01_t11`；W2-04 黄焖鸡店（暂定，名册无对应）`stallId=null`；W2-05 炒粉炒面炒饼（暂定）`stallId=null`；W2-07 四有青年面馆 `c01_t28`；W2-09 博山水饺 `c01_t32`；W2-08 西雅苏 `c01_t37`。
- **编号**：菜品 ID 按店连续（2F `c01_d040`–`c01_d318`、3F `c01_d319`–`c01_d434`），`c01_d001`–`d039` 由 `batch1` 历史占用，`d092`–`d098` 是合法空洞（不得自动补号）。
- **三判定互不推导**：`generation_status` / `evidence_status` / `import_eligibility` 相互独立；`candidate_only` 当前计入数为 **0**。
- **没核实就不能升级**：全部记录 `verifyStatus = unverified`、`verifiedAt = null`；"已裁决"≠"已现场核实"。

---

## 8. 数据现状（各档口实测条数）

| 档口 | stallId | 条数 | 备注 |
|---|---|---|---|
| W2-01 见面就好 | `c01_t07` | 8 | |
| W2-02 元气补给粥 | `c01_t09` | 4 | |
| W2-03 来一碗肉肉饭 | `c01_t11` | 40 | 8+8+14+2 + 8 双拼（历史口径 47，见契约 §6.1.2） |
| W2-04 黄焖鸡店（暂定） | `null` | 89 | 14 条套餐表 `E2_UNKNOWN_TABLE`、4 条米线套餐 R6 排除 |
| W2-05 炒粉炒面炒饼（暂定） | `null` | **27** | 12 炒类（R5 未授权，不拆）+ 15 剁椒面 |
| W2-07 四有青年面馆 | `c01_t28` | 30 | 15 行 × 小碗/大碗 |
| W2-09 博山水饺 | `c01_t32` | 18 | 9 行 × 小份/大份 |
| W2-08 西雅苏 | `c01_t37` | 22 | §6.1.1 白名单，`c01_d297`–`c01_d318` |
| W2-11 板面砂锅米线 | `c01_t16` | 63 | 三基底展开 33 + 其余 |
| 3F W01–W10 | `c01_t38`–`c01_t47` | 143 | 12/13/19/10/15/10/19/21/9/15 |

其他：`addons[] = 8`（鸡腿/狮子头/甜辣鸭腿/烤肠/虎皮卷/卤水豆腐/虎皮蛋/煎蛋）；`dupKeys = 6`；`dupIds = 0`；`nullId = 153`。

---

## 9. 未决事项（按优先级）

**① `PROD_BASELINE` 与实测不一致（最高优先，阻塞正式发布）**
- 现状：`PROD_BASELINE` 仍是 `545 / 402 / 143`，而 R5 收紧后实测为 `537 / 394 / 143`。
- 后果：契约 §7.2.1 S3 第 6 项会把差异判为 `E9_SUM`，**正式发布路径会被阻断**。
- 需要用户裁决：是否把 `PROD_BASELINE`（及契约 §6.2 期望表 419/145/564）同步为实测值。本轮明确未授权，故保持原值。

**② W2-04 米线原表 12 条与三基底展开 36 条的结构性重复**（仅登记，需裁决如何处理）。

**③ 14 条套餐表（W2-04 `:193-206`）与 4 条米线套餐**：当前按「不是单品」排除；若要支持套餐，应按 §6.1.1 白名单机制单独立表，不得放宽 R6。

**④ D7 持久性 BLOCKED**：Windows 目录 `fsync` = `EPERM`；契约要求平台提供，不支持时停止。替代路径（WSL/Linux 验证、`FlushFileBuffers`、契约降级）均需用户裁决。

**⑤ 6 条重复键**与**153 条 `dishId=null`** 未处理；初始化一旦解锁才能分配正式 ID。

**⑥ 待裁决的历史项**：`Q9-P`（是否允许测试注入 `mapPath`）、`M7`、`__testFsyncProbe` 合规性、审批文件缺失专用错误码。

---

## 10. 下一步建议（给接手的 agent）

1. **先复核、再动手**：跑 §3 的四条命令 + 三个文件哈希，确认与 §4 一致；不一致先报告差异。
2. **等用户对 §9-① 的裁决**：这是唯一一个"不裁决就无法继续正式化"的阻断项，且只需一次口头授权即可同步两处数字。
3. 若用户要求继续推进，建议顺序：①裁决并同步基准 → ②D7 替代路径裁决 → ③初始化机制的最终验收（目前代码已定义、生产未接线）→ ④首次初始化的最小可审计流程（三阶段摘要 + 审批记录 + 单文件写入）。
4. **执行风格**（用户反复要求）：一次闭环完成「检查上下文→最小方案→全部授权修改→真实测试→副作用核验→六段报告」，不要在步骤之间反复索要确认；对非关键歧义取风险最低默认值并声明；PASS/FAIL/PENDING 严格分开。

---

## 11. 环境与工具教训（踩过的坑，避免重复）

- **PowerShell 引号/反引号/中文**：`node -e "..."` 里含中文、反引号、`$`、正则转义极易被吞或触发 `ParserError`。**一律把脚本写成 UTF-8 的 `.js` 文件再 `node` 执行**；PowerShell 脚本本身只用 ASCII。
- **编码**：改文件用 `[System.IO.File]::ReadAllText/WriteAllText` 显式 `UTF8Encoding($false)`（无 BOM）；`Get-Content` 默认按 GBK 读 UTF-8 会误报。
- **行尾**：契约/生成器/测试均为纯 LF；`fs.readFileSync(...).split('\n')` 会因末尾 `\n` 多出一个空元素（曾导致行数断言失败）。
- **大文件不要整体重写**：百万字节级文档用 `edit` 或"按行号替换 + 命中次数断言"的补丁脚本，禁止 `write` 覆盖。
- **备份先行**：每次改动前复制到 `%TEMP%\stage-*` 并核验 SHA-256；误改可整文件回滚。
- **测试自证**：新增断言要用变异测试证明"删掉实现就会 FAIL"，否则只是字符串存在性检查。
- **不要用 `git checkout --` 回滚**（会抹掉未提交的工作），也不要用 `git stash`。

---

## 12. 术语速查

| 术语 | 含义 |
|---|---|
| S1/S2/S3/S4/S5_COMBO/EXCL | 表形态：单列价 / 双规格 / 一行多做法 / 一口味多基底 / 双拼组合 / 排除表 |
| R1–R8（§6.1） | 展开规则：一行一条 / 阶梯价拆条 / 多基底拆条 / 多做法拆条 / 双规格拆条 / 自选不录 / 免费只录主品 / 加料不录 |
| R1–R8（§5.6.5.5.4.1） | 键归一化：NFKC、空白折叠、trim、去首尾标点等 |
| A/B/C 档 | 记录资格：A 可直接生成、B 待补证据、C 阻塞 |
| `addons[]` | 加料清单（无 `dishId`、不占编号、不计入 `counts`） |
| `blockers` | 阻塞项清单，一条记录一条 entry，`reasons` 保留全部原因码 |
| E1–E30 | 错误码（E16 空缺；E24–E28 为 CLI/发布相关；E29/E30 为参数冲突与写入失败） |
| PK-1 / NK-R1–R4 | `pending_review` 规则 / `NEW_KEY` 规则 |
| G-4…G-8 | 初始化相关的五项裁决（审批门禁、扩展审批、碰撞处理、导出面、计划载体） |
| P1 / S1–S10 | 发布协议与八阶段（S8 校验、S9 清除标记、S10 复核并写 `COMMITTED`） |

---

_日志结束。如需逐条追溯某一决策的原始依据，可在工作区搜索契约对应章节号（如 `§5.6.5.8.3`、`§6.1.0`、`§7.2.5`），每项裁决都带出处与日期。_
