# 食神寻味｜新会话交接包（2026-10-26，交接方：上一任执行代理）

> 用法：把本文件整份交给新会话，或让新会话按「§二 读取顺序」自行读仓库。
> 本文件中的基线数字、哈希、测试计数**均由交接方在 2026-10-26 实测复核**，不是转录旧报告。

---

## 一、你是谁、怎么干活（执行协议摘要）

1. **身份**：执行代理，不是顾问。给定范围后**一次闭环**：只读核对 → 最小方案 → 全部授权内的修改 → 真实测试 → 副作用核验 → 报告 → 停止等下一步授权。
2. **不推活**：不得把能做的工作退回给用户；范围内能定的技术细节自己定，并在报告里声明「取了哪个默认值、为什么」。
3. **状态严格**：`PASS` / `FAIL` / `PENDING` 三个词有严格含义；`PENDING` 不计入通过；总数必须等于各状态之和；共享夹具导致批量失败时按用例逐条登记，不得整批标记。
4. **测试真实性**：不得为了让测试变绿而放宽断言、跳过用例或改测试期望；断言只能加强，削弱必须单独说明并获授权。
5. **改动纪律**：只改用户授权的文件；改前备份到 `%TEMP%` 并做字节+哈希核验；改后给前后 SHA-256；**禁止任何 Git 写操作**（不 commit / 不 stash / 不 reset / 不 checkout）；禁止未授权删除文件。
6. **报告六段**：结论 → 修改点（含前后哈希）→ 实测命令与退出码 → PASS/FAIL/PENDING 与总数 → 副作用与边界核验 → 剩余风险与阻塞项。结尾不要追加「可选下一步清单」，除非用户要求。
7. **禁止替代证据**：不得用模拟、替身、文档声称来代替真实运行结果；做不到就写 `BLOCKED` 并说明缺什么。

---

## 二、读取顺序（新会话开工必读）

| 顺序 | 文件 | 作用 |
|---|---|---|
| 1 | `docs/HANDOFF_LOG_20261026.md` | 上一任交接日志（详细过程与决策） |
| 2 | `docs/RECORD_GENERATOR_CONTRACT_20261023.md`（253,824 B） | **唯一规则来源**：生成器/映射/发布/初始化全部契约条款 |
| 3 | `tools/pilot/gen_records.js`（144,262 B） | 生成器实现（L1–L8 + ID 映射 + P1 发布 + 初始化工具） |
| 4 | `tools/test_records_spec.js`（335,953 B） | 主套件 301 条（290 PASS / 11 PENDING） |
| 5 | `tools/pilot/id-map.json`（42,990 B） | 现行正式映射，104 条全部 `active` |
| 6 | `docs/decisions/ID_MAP_T48_T49_20261025.json` | 映射冻结副本（审计用） |
| 7 | `tools/pilot/approvals/ap-20261025-01.json` + `tools/pilot/init-plans/ip-20261025-01.md` | 审批记录 + 初始化计划（planDigest 三者互绑） |

---

## 三、实测基线（2026-10-26 交接方复核，全部为真）

### 3.1 Git
- `HEAD = 274ebd6`，分支 `main`
- `git status --short`：**62 行 = 14 个已跟踪修改 + 48 个未跟踪**；`git diff --cached` 为空（无暂存）
- **自始至终没有任何提交**：全部为工作区改动

### 3.2 关键文件指纹

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `tools/pilot/gen_records.js` | 144,262 | `5b3494191a2b3edc09764b83a24be2df780bca0049b9bc4730e7df1317941b2d` |
| `tools/test_records_spec.js` | 335,953 | `75760d4d67ea512895d7f2a988aafc55e65893d481122707140389f383a8105e` |
| `docs/RECORD_GENERATOR_CONTRACT_20261023.md` | 253,824 | `51b3110f09ee8c763ba5a020187bf96167a9d14ee87dae41a1ef005dd912cb1c` |
| `tools/pilot/id-map.json` | 42,990 | `4478c976dcb68ef683d712e48ebd98db123f0dbfde272035e4d9c9e3bada210e` |
| `docs/decisions/ID_MAP_T48_T49_20261025.json` | 37,741 | `40642870a2c5cb512e8b5dbc5725ac2754c13b39057a83978dce01c57e54e491` |
| `tools/pilot/approvals/ap-20261025-01.json` | 1,894 | `f2b909b7aad3080512bbd1472512389df3b9d24086430cdb07e6ce5dcc44b7e0` |
| `tools/pilot/init-plans/ip-20261025-01.md` | 20,597 | `5b7aec94dc9eeecaaeb0634cc2bdf998b0202c3ba5f4afe4bf8d68693df86730` |

### 3.3 测试与规范检查（实测）
- `node tools/test_records_spec.js` → **通过 290 / 失败 0 / 待实现 11**，`RESULT: OK`，exit 0（总 301）
- `node tools/check_eol.js` → `docs` 25 文件 + `tools` 12 文件 = **37 文件，违规 0**，exit 0
  - ⚠️ 文件数会随 `docs/*.md` 增加而 +1（本交接包自身也算一个）。判据是**「违规 0」**，不是某个固定数字。
  - ⚠️ 上一份交接文档写「35 文件」，交接方核对时为 36（含上一份日志），加入本文件后为 37。以**实际跑出来的违规数**为准。
- 11 条 PENDING（全部为运行时/产物层，需真实写出实现后才可启用）：
  `T9b`、`T12c`、`T39b`、`T63b`、`T64b`、`G2`、`T68b`、`T75`、`T84`、`T113`、`T114b`

### 3.4 正式产物状态（必须保持不存在）
`tools/pilot/records.json`、`records_blockers.json`、`gen-manifest.json` —— **三者均不存在**（实测 False）。

### 3.5 id-map 实际内容（易踩坑）
- 顶层键：`entries` / `generatedAt` / `initialization` / `keyFormat` / `orphans` / `schemaVersion`
- `mapVersion` **不在顶层**，在 `initialization.mapVersion = "1#1"`
- `initialization = { approvalRef: "ap-20261025-01", planDigest: "4ed23cb4…9981ce", mapVersion: "1#1" }`
- `entries = 104` 条，全部 `status=active`、全部有 `dishId`；`orphans = 0`
- `dishId` 前缀分布：`c01_d4*` 63 条 + `c01_d5*` 41 条（对应 t49 的 27 条 `d437–d463` 与 t48 的 77 条 `d464–d540`）

---

## 四、项目走到哪了（阶段脉络）

1. **小程序本体**：四栏导航（首页/评分/社区/我的）、多功能筛选（区域/预算/口味/主食类型/多选餐厅楼层档口）、随机选店/随机选菜/查看全部、三档排序、加载三态与重试。
2. **云开发**：环境 `shishen-dev-d2g4t8rgj7d0bd1e7`，AppID `wxcc28587e4d0254ad`；`healthCheck`/`seed` 两个云函数（`seed` 已加 `ADMIN_OPENIDS` 入口鉴权并部署）；`dbCheck` 已从云端删除。
3. **数据**：本地演示数据 12 店 / 7 楼层 / 24 窗口 / 45 菜（全 `demo`）；真实采集转述稿 `tools/pilot/TRANSCRIPTION_2F.md`（316 行）与 `_3F.md`（145 行）；`tools/pilot/batch1/` 有 82 条真实数据 CSV（`c02`/`c03` 有实拍图，`c01` 缺 3 张）。
4. **生成器契约体系**：错误码 `E1–E30`、退出码 0/1/2/3/4、P 阶段 `S1–S10`（同卷原子 rename + `PUBLISHING` 标记 + 读侧拒绝不完整发布）、ID 映射五步校验与 `NEW_KEY`/`KEY_COLLISION`/`PENDING_REVIEW`/`ORPHAN_IN_MAP` 诊断、`R1–R8` 展开规则、`PK-1` 审批留痕。
5. **ID 映射（已冻结）**：t48 ×77、t49 ×27，共 104 条正式 `dishId`；审批 `ap-20261025-01` 与 planDigest 互绑。
6. **UGC MVP 规划**：`submit`/`review` + `submissions` 集合 + 隐藏审核页 + 图片内容安全，**尚未实现**。

---

## 五、红线（不能做，除非逐项书面授权）

- ❌ 任何 Git 写操作（commit / stash / reset / checkout / clean）
- ❌ 正式初始化映射、重新分配 `dishId`、删除或覆盖 `id-map.json` / `approvals/` / 冻结副本
- ❌ 生成正式产物（`records.json`、`records_blockers.json`、`gen-manifest.json`）、运行正式生成或导入
- ❌ 绕过 D7（目录持久性）：Windows NTFS 目录 `fsync` 实测 `EPERM`，初始化仅在 WSL ext4 下完成；**不得把 WSL 成功当成 Windows 成功**
- ❌ 改云函数、云数据库、云端权限；部署；写云端数据
- ❌ 为让测试变绿而削弱断言、跳过用例、改期望
- ❌ 用模拟/替身/文档声称代替真实运行证据

---

## 六、已知坑与未验证项（新会话最容易被绊倒的地方）

1. **`mapVersion` 不在顶层**：按顶层读取会得到 `undefined`，必须读 `initialization.mapVersion`。
2. **测试数量以实测为准**：`check_eol` 现在是 36 文件（不是 35）；主套件现在是 290/0/11（不是旧文档里的 281、249 等）。
3. **Windows 与 WSL 的测试差异是已知平台差异**：据 2026-10-26 交接日志记载，`T136`/`T137`/`T232` 在 WSL 上失败（交接方未在 WSL 侧复核），属平台能力差异，**不得为通过而放宽断言**。
4. **A/B/C 与实测总数存在口径张力**：`545 = 463+39+62` 与 `402+143 = 545` 成立，但 `402 ≠ 347+39+33`。这是「规划分档 vs 实测汇总」并存，未经授权不得擅自统一。
5. **W2-03 的 40 与历史 47**：47 是历史规划口径（`docs/RECORD_LEVEL_GENERATION_PLAN_20261023.md:40` 等），当前实现一律按 40；契约已加说明。
6. **W2-04 的 89 与 107**：差额 −18 为「14 条套餐表 + 4 条米线套餐」，属已裁决排除；米线原表 12 与三基底展开 36 的潜在重复**仍未裁决**。
7. **未验证项**：WSL 侧 `~/shishen-a-prime-copy` 未在 Windows 侧复核；上一任在 `%TEMP%` 做过的临时目录验证未保留，无法复核。

---

## 七、首个动作（建议，按风险从低到高）

1. **（纯文档，零风险）UGC MVP 设计定稿**：`submissions` 字段、服务端校验、状态机、管理员白名单、审核日志、去重键 → 产出 `docs/UGC_MVP_DESIGN_*.md`。
2. **（模板填写）合规面**：隐私条款补充 + 小程序后台 UGC 场景声明口径（按真实勾选项写，不代填）。
3. **（代码，需授权）** `submit` 云函数（服务端校验 + `msg_sec_check`）＋ `review` 云函数 ＋ `pages/review/` 隐藏审核页。
4. **（代码，需授权）** 正式 `records` 落项目目录（需先解 D7 + 生成器接生产链路 + 负责人签字）。

---

## 八、基线复核命令（新会话开工先跑这三条）

```bash
git rev-parse --short HEAD && git status --short | Measure-Object -Line
node tools/test_records_spec.js   # 期望：290 / 0 / 11，RESULT: OK
node tools/check_eol.js           # 期望：违规 0（文件数随 docs/*.md 增长，当前 37）
```

若结果与 §三 不符 → **先报告差异，不要继续动手**。
