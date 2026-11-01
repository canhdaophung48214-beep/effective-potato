# 生成产物消费边界审计 + 用户上传 MVP 方案（2026-10-25）

> 性质：**只读审计 + 设计建议**。本轮零代码改动、零正式数据写入、零云端操作。
> 标注纪律：`[实测]` = 本机命令/文件核对结果；`[建议]` = 设计方案，未实现、未验证。

## 一、消费路径清单 [实测]

对全仓 `*.js / *.json / *.wxml / *.mjs`（排除 node_modules）检索 `records.json`、`records_blockers.json`、`gen-manifest.json`：

| 消费方 | 是否读取三产物 | 说明 |
|---|---|---|
| `tools/test_records_spec.js` | 引用路径（仅 PENDING/断言） | 唯一出现处；`P.records`/`P.blockers`/`P.manifest` 用于「不得存在」检查与产物层 PENDING，不导入数据 |
| `tools/import_data.js` | **否** | 只读 CSV（batch1/*.csv），不读三产物 |
| `tools/verify_data.js` | **否** | 只校验 `data/dishes.js` 与 CSV 合并集 |
| `data/index.js` / `data/dishes.js` | **否** | 业务数据源为手写 JS 数组（45 条 demo），零文件读取、零产物依赖 |
| `utils/matcher.js` / `pages/**` | **否** | 只消费 `data/index.js` 导出的内存结构 |
| `utils/cloudRepo.js` | **否** | 只处理云端集合文档，透传 `verifyStatus/verifiedAt/source` |
| `cloudfunctions/seed/*` | **否** | 其 `report.blockers` 是种子对账结果，与 `records_blockers.json` 无关（同名不同物） |

**结论 [实测]：当前不存在任何生产消费方读取三产物 → 无「误导入 / 误展示」路径。** 三产物目前只存在于临时目录（项目内 `tools/pilot/records*.json`、`gen-manifest.json` 均不存在）。

## 二、候选记录隔离结果 [实测]

以本轮之前的真实写出现场（临时目录）为准：

| 类别 | 条数 | `id_status` | `import_eligibility` | 现状 |
|---|---|---|---|---|
| 映射分配（t49 27 + t48 77） | 104 | `assigned_from_map` | 全部 `blocked` | 已有正式 ID，但**未核实**；不因 ID 非空而可导入（C20） |
| 契约名册规划候选 | 386 | `planned_from_roster` | 全部 `blocked` | 候选身份由名册区间证明，**非正式分配、非可发布** |
| 价格冲突（W2-03 三组） | 12 | `planned_from_roster`（已由组合 `disambiguator` 区分） | 全部 `blocked` | 组合消歧 ≠ 价格已核实；保留 blocker，待现场 |
| C 档未分配 | 35 | `unassigned` | `blocked` | 不生成、不占号、继续排除 |

`C19` 保证 `candidate_only = 0`；`C20` 保证 `id` 非空不推断资格。产物口径：records 490 = 104 + 386；blockers 525 条如实记录全部阻塞。

**判据「PUBLISH_OK ≠ 可发布」**：`PUBLISH_OK` 只表示 S1–S10 流水线与结构自洽通过，**不解除**任何证据阻塞。[实测] `records_blockers.json` 525 条与 `import_eligibility` 全 `blocked` 同时成立。

## 三、潜在风险与最小修复方案

| # | 风险 | 当前是否成立 | 最小修复 |
|---|---|---|---|
| R1 | 未来消费方把 `id_status` 非空当作可导入 | 否（无消费方） | 消费入口只认 `import_eligibility === 'candidate_only'` 且显式放行清单；`assigned_from_map`/`planned_from_roster` 一律视为候选 |
| R2 | 展示层把 `PUBLISH_OK` 当作可上线 | 否 | 上线判据独立为「阻塞解除裁决 + CSV 导入成功」，与 manifest 无关 |
| R3 | `planned_from_roster` 混入正式展示数据集 | 否 | 导入白名单显式排除该状态（与 C18 三类一致）；建议在 import 层加断言 |
| R4 | 12 条价格冲突被「组合消歧」误当作已核实 | 否（blockers 保留） | 价格裁决须独立 DR；`verifyStatus` 提升只由现场核实流程驱动 |
| R5 | 载入产物时未校验 manifest sha256 | 否 | 任何消费方读取两数据文件前必须比对 manifest 的 `recordsSha256`/`blockersSha256`，不一致即拒绝 |

> 本轮**未新增测试**：R1–R5 在当前代码中均无触发点，加测试只会锁定「尚不存在的消费逻辑」（无被测对象）。**建议在接入首个消费方的那一轮**同时补对应负例测试（届时才有可复现的失败路径）。

## 四、用户上传 MVP 最小方案 [建议，未实现]

### 4.0 前置合规（阻断级，必须先裁决）

个人主体小程序当前类目为「信息查询」，**UGC / 用户发布内容 / 社区留言受限**（项目已知约束）。用户上传菜品资料属于 UGC，上线前须：① 变更为允许 UGC 的类目（如生活服务-餐饮）或走内容开放平台审核；② 配置内容安全接口（`security.msgSecCheck` / `mediaCheckAsync`）；③ 用户协议与隐私政策更新（收集图片/位置）。**未完成前只能做内部灰度，不得对公众开放。**

### 4.1 数据模型（复用现有集合语义）

新增集合 `submissions`（提交）与 `upload_logs`（操作日志）：

| 字段 | 说明 |
|---|---|
| `_id` | 自动 |
| `kind` | `dish` / `price` / `photo` / `stall_info` |
| `payload` | `{ name, price?, stallId?, shopId?, foodType?, note? }`（字段与 `data/dishes.js` 对齐，禁止新增未定义业务字段） |
| `photos` | `fileID[]`（云存储），≤3 张，≤5MB/张 |
| `submitter` | `openid`（仅服务端写入，不存昵称/手机号） |
| `status` | `pending` → `approved` / `rejected`（见 4.3） |
| `review` | `{ by, at, reason?, edits? }` |
| `dedupe` | `{ key, dupOf? }`（见 4.5） |
| `createdAt` / `updatedAt` | 服务端时间（`db.serverDate()`） |

### 4.2 上传页字段与校验

- 必填：`kind`、菜名（1–20 字符，NFKC + 折叠空白）、档口（从现有名册下拉，不接受自由输入 stallId）、价格（可选；正数 ≤1 位小数 ≤100）。
- 可选：图片 ≤3 张（客户端压缩到 1280px 长边）、备注 ≤100 字。
- 客户端校验 + **服务端复校**（同一规则函数复用 `tools/verify_data.js` 的 D5 语义，禁止只信任客户端）。
- 提交成功后立即返回 `pending`，**不得**提示「已上线」。

### 4.3 审核状态流转（服务端唯一可写）

```
pending ──approve──> approved ──(导出/导入轮)──> 进入正式数据集
   └────reject────> rejected（可附 reason，不可自行改回）
pending ──(72h 未审)──> 保持 pending（不自动通过）
```
- 状态只能由云函数（管理员白名单 `openid`）修改；客户端 `db` 权限设为「仅创建者可读自己记录，禁止写 status」。
- `approved` **不等于** `verifyStatus='verified'`：审核只确认「内容合规 + 信息完整」，来源可信度仍按 `data/provenance.js` 规则单独标记（建议 `source.kind='user'` + `verifyStatus='unverified'` 起步）。

### 4.4 管理审核入口与操作日志

- 隐藏入口（非 tabBar）：`pages/review/`，仅管理员 openid 可见（云函数返回 403 兜底）。
- 操作：列表（pending 优先）、逐条查看图片、通过/驳回（必填理由）、编辑后通过（保留原值）。
- 每次操作写 `upload_logs`：`{ action, submissionId, by, at, before, after }`，只追加不改写。

### 4.5 进入正式数据集的路径（不破坏本地数据）

- **离线导出**：管理员在审核页触发云函数 `exportApproved` → 生成 `submissions_approved.json`（CloudBase 存储），**不直接写** `data/dishes.js`。
- 本地走既有 `tools/import_data.js`（CSV 形态）或新增最小转换脚本 → 生成候选 CSV → 人工审核 → 合并进 `data/dishes.js`（保持 45 条 demo 与新增记录可分）。
- 该链路与 `records.json` 生成链路**不混用**：上传数据不进入 id-map 初始化范围，ID 由后续单独规划轮决定（避免污染已冻结映射）。

### 4.6 防重复 / 防恶意 / 防未审公开

| 措施 | 做法 |
|---|---|
| 重复记录 | 服务端算 `dedupe.key = stallId|norm(name)|price`；命中已存在或已提交 → 标记 `dupOf`，进 pending 并在审核页高亮 |
| 恶意内容 | 文本 `msgSecCheck`（同步）+ 图片 `mediaCheckAsync`（异步回调）；任一不通过 → 直接 `rejected`（理由 `security`），不进入人工队列 |
| 频率限制 | 每 openid 每日 ≤10 次提交；同 IP 5 分钟 ≤3 次（云函数内存计数 + 数据库兜底） |
| 未审不得公开 | 客户端查询只走云函数，**不直接读集合**；云函数只返回 `approved`；`pending/rejected` 仅提交者本人可见 |
| 图片 | 云存储路径 `uploads/{openid}/{yyyyMM}/{id}.jpg`，未审核文件不放 CDN 公开路径（使用临时链接） |

### 4.7 与现有本地数据的关系

- `data/dishes.js`（45 条 demo）与 `data/index.js` 枚举**保持不变**；上传数据仅作为候选来源，合并时走既有导入与校验工具。
- 不改变 `verifyStatus` 语义；不引入评分/评论（当前类目与合规约束下仍不可做）。
- 云端仅新增 `submissions`、`upload_logs` 两个集合与 3 个云函数（`submit`、`review`、`exportApproved`），复用现有 `shishen-dev-d2g4t8rgj7d0bd1e7` 环境。

## 五、本轮测试

只读审计轮，未改代码 → 主套件保持上轮基线 [实测]：Windows **290 / 0 / 11 PENDING**（RESULT: OK）；其余 10 套件全 0；`check_eol` 31 文件 0 违规；WSL 285/3/13（3 项既知平台差异）。

## 六、Git / 云端

HEAD `274ebd6`、main、工作区 62 行、暂存区 0——**零 Git 写操作**；零云端/部署/云函数/数据库/权限操作；未写正式输出目录；冻结映射、审批、菜品数据、核实状态均未动。

## 七、剩余待决策

1. **UGC 类目合规**（阻断级）：是否变更类目/走内容开放平台——需产品负责人决策，本方案不自行假设。
2. 上传数据与 id-map 的关系：建议**不进入**已冻结映射，另行规划（否则每批上传都要新审批 + 新 planDigest）。
3. 审核人力：谁担任审核员（openid 白名单）——需负责人指定。
4. R1–R5 负例测试：待首个消费入口落地时补。
