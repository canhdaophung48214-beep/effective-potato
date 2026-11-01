# 审计记录：契约同步 + WSL 环境准备轮（2026-10-25）

> 本记录由 A′ 下一轮授权产生（授权范围：契约同步、计划修订、WSL2 环境准备）。本轮**未创建运行时映射、未执行初始化、未签发审批、零 Git 写操作、零云端操作**。

## 一、本轮变更清单

### 1. 契约 `docs/RECORD_GENERATOR_CONTRACT_20261023.md`

改前 2070 行 / 238,216 B / `80c657ab…` → 改后 **2076 行 / 242,437 B / `0e35bd6c…`**（5 处修改）：

| 位置 | 变更 |
|---|---|
| §5.6.5.10 步骤 7 | 由「目录项持久性：见『持久性要求』」改写为**两阶段实际调用规范**（`linkSync` 成功后 `afterLink` 目录 fsync、`unlinkSync` 成功后 `afterUnlink` 目录 fsync；任一失败 → `INIT_DURABILITY_UNCONFIRMED` 不得继续不得报成功）+ **三层区分**（能力探测成功 ≠ 实际调用成功 ≠ 持久性已确认）+ 实现锚点（`fsyncDirNow`、T242/T242b） |
| §5.6.5.10 失败分类表 | 新增行：目录 fsync 实际调用失败（afterLink/afterUnlink）→ `INIT_DURABILITY_UNCONFIRMED`、退出码 3、`wrote:true`、phase 标识、保留目标与残留证据、不自动删除、不自动重试、不得宣称断电持久性 |
| §5.6.5.10 持久性要求（Q-4） | 追加第 5 条：A′ 裁决记录（WSL ext4 执行；`/mnt/c` 为 9p 不得用作执行环境；补丁已落地待审批+实施授权） |
| §9.1 测试表 | T242 行随补丁改写重新登记（断言链含两次目录 fsync、调用序断言；原断言保留于历史登记注记）；**新增 T242b 行**（七场景故障注入矩阵，全部隔离目录+替身注入、不依赖本机目录 fsync、不触碰正式映射） |
| §9.1 实测计数 | 新增「A′ 持久性补丁与 T242b 落地后：**285/0/11，总数 296**」行（284/295 行保留为历史） |
| 附录变更登记 | 追加「A′ 持久性补丁与契约同步（2026-10-25）」条目 |

### 2. 初始化计划 `tools/pilot/init-plans/ip-20261025-01.md`

改前 `4b9a4f59…` → 改后 **`20cb7a25…`**（3 处可追溯增补，无规则实质变更）：
- §一追加「同日更新记录」：契约同步后实测 2076 行 / 242,437 B / `0e35bd6c…`（同步内容即本计划 §四 所述补丁的规范化，不触发重新立项）；
- §六 `status` 行强化语义边界：`assigned_unverified` 是**分配/核实域**状态；运行时 `active` **若最终被批准，仅表示映射条目处于生成器可用状态——不表示菜品已核实、来源可信或可以发布**；**该转换仍是待负责人批准的设计决策**；
- §七第 2 项同步强化「未经批准不得执行转换」。
- 附件核对：冻结映射 `bytes: 37741` / sha256 `40642870a2c5cb512e8b5dbc5725ac2754c13b39057a83978dce01c57e54e491` 与实测一致（冻结映射本轮零改动）。

### 3. WSL2 环境准备（Windows 项目零改动）

| 项 | 结果 |
|---|---|
| 发行版 / 内核 | Ubuntu 26.04 LTS / 6.18.33.2-microsoft-standard-WSL2 |
| 根文件系统 | `/dev/sdd` **ext4**（df -T 实测）；`/mnt/c` = **9p**（区分明确，后者不得用作执行环境） |
| 项目副本 | `~/shishen-a-prime-copy`（WSL ext4 内，27 MB，`cp -a` 全量复制含 .git 与全部未跟踪文件；目标原不存在，未覆盖任何既有目录） |
| 副本一致性 | 9 个关键文件（生成器/测试/契约/冻结映射/计划/两转录稿/dishes.js/app.js）两侧 sha256 **9/9 完全一致**（唯一差异为 sha256sum 输出分隔符格式 `*` vs 空格，内容零差异） |
| Node.js | **v22.22.1**（apt 安装，Ubuntu 仓库 `nodejs` 包，仅 WSL 内，Windows Node 环境未动；首次安装失败因 apt update 被超时截断，完整 update 后成功） |

### 4. WSL 副本内验证（全部只读/隔离，未执行正式 initIdMap）

- `node --check` 生成器与测试均 OK；
- 只读探针（路径适配版）**ALL PASS**：525/490/35/0/0、t49 27×d437–463、t48 77×d464–d540、上限 d540、冻结映射 104/104 一致；
- 主套件 **280 通过 / 3 失败 / 13 PENDING**：
  - **A′ 链路全部 PASS**：**T233 在真实 ext4 上走 `INIT_OK` 全链路**（wx→写入→文件级 fsync→linkSync→目录 fsync(afterLink) 真实成功→unlink→目录 fsync(afterUnlink) 成功→读回一致）——**A′ 补丁在目标环境的首次完整真实验证**；T241/T242/T242b/T243 均 PASS；
  - 3 个失败（T136/T137/T232）＝**测试的平台特定假设**：T136/T137 断言锚定 Windows 分支诊断文案「路径不可达」，Linux 上 ENOTDIR 走契约同样允许的 IO 分支（实得 `MAP_IO_ERROR`/exit 3，行为合规）；T232 因 ext4 大小写敏感使构造场景变为 E_ATTACH_MISSING（同为合法 fail-closed）。**均非 A′ 链路缺陷**；测试适配（文案断言兼容两平台）留待未来测试轮，本轮不改测试；
  - 2 个额外 PENDING（T140/T238）＝测试内建的平台降级（`mklink /J` 联接点无法在 Linux 构造，文案明示「本机无法创建联接点」）。
- Windows 侧为正式回归基线（见 §二）。

## 二、测试结果汇总

| 环境 | 套件 | 结果 | 退出码 |
|---|---|---|---|
| Windows（正式基线） | test_records_spec | **285 / 0 / 11 PENDING**（RESULT: OK） | 0 |
| Windows | regression 122/0/3、test_check_eol 57/0、import_data、verify_data、cloudrepo 102/0、seed_auth、index_state 203/0、pages 106/0、seed_pilot、seed_s21 | 全部通过 | 全 0 |
| Windows | check_eol | 27 文件 0 违规 | 0 |
| WSL ext4 副本 | test_records_spec | 280 / 3 / 13（3 失败均为测试平台假设，见 §一.4） | 1 |

## 三、备份

`C:\Users\25975\Documents\shishen-dev-archive\contract-wsl-prep-20261025\`（契约 `80c657ab…`、计划 `4b9a4f59…`，源/备逐字节一致；不与既有 24 个备份目录重名）。

## 四、边界确认

未创建 `tools/pilot/id-map.json`（两侧均不存在）；未执行 `initIdMap` 正式流程（WSL 内 T233 为合成目录+合成 payload 的测试通道）；未新增 CLI 入口/生产调用点（T243 两侧 PASS）；未创建 `approvals/`（两侧均不存在）；未修改冻结映射（`40642870…` 未变）；未改任何 dishId/verifyStatus/业务数据；零云端操作；**零 Git 写操作**（HEAD `274ebd6` 全程未变，暂存区 0）；未删除/覆盖任何备份、临时文件、探针输出；WSL 副本未同步回 Windows 项目。
