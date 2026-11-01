# B1 证据字段核对报告

- 日期：2026-10-26
- 对象：`tools/pilot/batch1_min/`（`c02` / `c02_f2` / `c02_t02` / `c02_d060`–`c02_d071`，共 12 条菜品）
- 性质：**只读核对 + 模板与待办输出**。未改 CSV、未调云端、未部署、未 Git 写。
- 依据：`docs/REAL_DATA_CANDIDATE_SELECTION_20261026.md`（D3 优先推进 B1）、`data/provenance.js`、`tools/import_data.js`、`tools/verify_data.js`、`cloudfunctions/seed/index.js`、`docs/RECORD_GENERATOR_CONTRACT_20261023.md`。

## §0 结论

1. **B1 今天就能通过导入器**：`import_data --dir batch1_min --require-evidence` → exit 0，1 店 / 1 层 / 1 档 / 12 菜，新增校验 0 错误 0 警告。导入通过**不等于**字段已核实，只说明形状合法、证据文件存在。
2. **照片能证明的只有"这家窗口叫什么、卖什么、卖多少钱"**：门头「韩小面」+「重庆风味」小牌 + 四栏价目表；**不能**证明餐厅名、楼层、方位、档口编号。
3. **照片覆盖 11/12 条菜品**；「麻酱凉面 8 元」在当前可读画面中未见价签，需补拍或确认（第 §3.4 行 D12）。
4. **书面确认不是现有来源类型之一**：`source_kind` 只有 `demo/official/merchant/user/web/field/unknown` 七类，没有"负责人确认"。它**不能**替代照片，只能在既有 `field` 语义下补充文字，且**不会**改变 `verifyStatus`。
5. **不需要为了导入改任何规则**；如果要把"确认"变成可审计字段，有一份最小改动草案（§4.3 方案 B），本轮只记录、不实施。

## §1 检查动作与真实退出码

| # | 动作 | 命令 | 退出码 | 结果 |
|---|---|---|---|---|
| 1 | 严格模式导入预演 | `node tools/import_data.js --dir tools/pilot/batch1_min --require-evidence` | **0** | 1/1/1/12，新增与合并校验均 0 错误 0 警告 |
| 2 | 数据一致性 | `node tools/verify_data.js` | 0 | 12 店铺 / 7 楼层 / 24 窗口 / 45 菜品，0 错误 |
| 3 | ID 准入 | `node tools/check_id_admission.js` | **1** | 唯一冲突 `c03`（`NS_UNAPPROVED`），`c02` 为条件批准 note |
| 4 | 行尾/编码 | `node tools/check_eol.js` | 0 | 见 §7（新增两文件后复核） |
| 5 | 冻结哈希 | `Get-FileHash` 七个文件 | — | 全部与基线一致 |
| 6 | 三产物 | `Test-Path` | — | `records.json` / `records_blockers.json` / `gen-manifest.json` 均不存在 |

`batch1_min` 原始文件哈希（核对前后未变，见 §7）：

| 文件 | 字节 | SHA-256 |
|---|---|---|
| `shops.csv` | 526 | `28a00b63ddf9b2da8a82753cca5a5387b7cb11200e33be3daf7b7b0aa8083763` |
| `floors.csv` | 323 | `2251f865d7fb211b48df9b94a84524dc4c58ab33d0ac76b25fd7fcfa66a0b024` |
| `stalls.csv` | 428 | `5c11e7215d7fa43ad9d16fbb4741147d5a2f171093cedddbc7d76714f71fc8e8` |
| `dishes.csv` | 2,828 | `92be5a30453eacdf2fa93e2fc00ab1b857d17e87883aed07bfd860cb8de5353b` |
| `img/c02_t02_menu.jpg` | 603,818 | `7e603d57d3d65432fabb38ee69cd30bee7a5987141d2e0962cf02f91e87a1ec0` |

## §2 原始材料核对

### §2.1 四张表的骨架

| 表 | 行数 | 关键字段 | 证据三件套 |
|---|---|---|---|
| `shops.csv` | 1 | `shop_id, shop_name, area, building, location` | `collector=产品负责人`、`collect_date=2026-10-22`、`evidence_file=img/c02_t02_menu.jpg` |
| `floors.csv` | 1 | `shop_id, floor_id, floor_label` | 同上 |
| `stalls.csv` | 1 | `shop_id, floor_id, stall_id, stall_name, side, no_status, no` | 同上；`side=west`、`no_status=unverified`、`no` 为空 |
| `dishes.csv` | 12 | `dish_id, dish_name, record_type, shop_id, stall_id, price, food_type, tastes` | 同上，12 行指向同一张照片 |

四张表的 `source_kind` 全部为 `field`，`source_detail` 已在 R2 轮改为"可支持 / 未核实 / 占位"的表述，未再声称楼层、餐厅名、方位。

### §2.2 照片实际内容（`img/c02_t02_menu.jpg`，1,864×2,249）

- **门头**：红底黄字「韩小面」，右上角小牌「重庆风味」，下方并排「招牌豌杂面 / 豌豆面 / 牛肉面」等示例图。
- **价目表**标题「韩小面价格表」，四栏：

| 汤面 | 价 | 拌面 | 价 | 清汤 | 价 | 小吃 | 价 |
|---|---|---|---|---|---|---|---|
| 重庆小面（素） | 7 | 干拌小面（素） | 7 | 清汤小面（可拼） | 7 | 卤蛋 | 1 |
| 杂酱面（素） | 9 | 干拌杂酱面（素） | 9 | 清汤杂酱面（可拼） | 9 | 卤肠 | 1.5 |
| 招牌豌杂面（素） | 11 | 干拌豌杂面（素） | 11 | 清汤豌杂面（可拼） | 11 | 煎蛋 | 2 |
| 酸菜面（素） | 8 | | | | | 辣椒 | 2 |
| 牛肉面（荤） | 15 | | | | | 豆干 | 1.5 |

- **店长提醒**：「加面免费」「点餐前提前说」。
- **EXIF 水印**：`2026.10.22 18:00`、`山东省淄博市张店区`。
- **画面中没有**：餐厅名称、楼层、楼层指引、档口编号、档口方位标识、辣度标识、「麻酱凉面」条目。

## §3 字段级证据矩阵

图例：**P** = 照片直接支持；**A** = 负责人书面确认可解决；**U** = 必须保持未知；**C** = 存在口径冲突，需先裁决。

### §3.1 `shops.csv`（`c02`）

| 字段 | 当前值 | 证据判定 | 能靠确认解决吗 | 备注 |
|---|---|---|---|---|
| `shop_id` | `c02` | 结构字段，非事实 | — | 命名空间已条件批准（`ap-20261026-01-c02`） |
| `shop_name` | 三餐 | **A** | 可以 | 照片只出现「韩小面」，未出现"三餐/第三餐厅" |
| `area` | `campus` | **A** | 可以 | 属常识性归纳，仍应登记为确认结果 |
| `building` | 第三餐厅 | **A** | 可以 | 同上；与 `shop_name` 需一致口径 |
| `location` | 三餐 · 2 楼最西侧 | **A** + **P（部分）** | 可以 | 照片能证明"这是食堂里的一个窗口"，不能证明哪一层、哪一侧 |
| `source_kind` | `field` | 合规（属枚举内） | — | 书面确认**不是**独立 kind |
| `source_detail` | 已写"可支持 / 未核实 / 占位" | 合规 | — | 建议追加确认件引用（§4.3） |
| `collector` / `collect_date` | 产品负责人 / 2026-10-22 | 合规 | — | 与 `--require-evidence` 要求一致 |
| `evidence_file` | `img/c02_t02_menu.jpg` | 存在 ✓ | — | 照片内容不含楼层/餐厅证据 |

### §3.2 `floors.csv`（`c02_f2`）

| 字段 | 当前值 | 证据判定 | 备注 |
|---|---|---|---|
| `floor_id` | `c02_f2` | 结构字段 | 与命名空间条件批准一致 |
| `floor_label` | 2 楼 | **A** | 照片无楼层指引；可确认，或保持未知 |
| `source_detail` | "楼层未核实…待核实占位" | 合规（如实） | 若确认，改为"负责人书面确认（日期）" |
| `evidence_file` | 同一张照片 | 存在但不支持该字段 | 不建议用"存在"暗示"已证明" |

### §3.3 `stalls.csv`（`c02_t02`）

| 字段 | 当前值 | 证据判定 | 备注 |
|---|---|---|---|
| `stall_id` | `c02_t02` | 结构字段 | — |
| `stall_name` | 韩小面 | **P** | 门头大字，证据充分 |
| `floor_id` | `c02_f2` | 依赖 §3.2 | — |
| `side` | `west` | **A** 或 **U** | 照片不含方位；`no_status=unverified` 已如实 |
| `no_status` / `no` | `unverified` / 空 | **U** | 不得为了让数据"看起来完整"而编造编号 |

### §3.4 `dishes.csv`（12 条）

| 记录 | 菜名 | 价格 | 判定 | 说明 |
|---|---|---|---|---|
| `c02_d060` | 重庆小面（素） | 7 | **P** | 汤面栏 |
| `c02_d061` | 杂酱面（素） | 9 | **P** | 汤面栏 |
| `c02_d062` | 招牌豌杂面（素） | 11 | **P** | 汤面栏 |
| `c02_d063` | 酸菜面（素） | 8 | **P** | 汤面栏 |
| `c02_d064` | 牛肉面（荤） | 15 | **P** | 汤面栏 |
| `c02_d065` | 干拌小面（素） | 7 | **P** | 拌面栏 |
| `c02_d066` | 干拌杂酱面（素） | 9 | **P** | 拌面栏 |
| `c02_d067` | 干拌豌杂面（素） | 11 | **P** | 拌面栏 |
| `c02_d068` | 清汤小面 | 7 | **P**（名称口径 **C**） | 牌面写「清汤小面（可拼）」 |
| `c02_d069` | 清汤杂酱面 | 9 | **P**（名称口径 **C**） | 同上 |
| `c02_d070` | 清汤豌杂面 | 11 | **P**（名称口径 **C**） | 同上 |
| `c02_d071` | 麻酱凉面 | 8 | **A** / 需补拍 | **当前画面未见该条目与 8 元价签**；若牌面另有侧栏，请补拍确认 |

其余字段：

| 字段 | 判定 | 说明 |
|---|---|---|
| `food_type=noodle` | **P（间接）** | 均为面条类，牌面可读 |
| `tastes`（spicy / choice） | **A 或 U** | 牌面无辣度/可选标识；`spicy` 属按品类推断，证据不足 |
| `record_type=菜品` | 结构 | — |
| `shop_id` / `stall_id` | 结构 | — |
| 素 / 荤 | **P** | 牌面在 8 条上标注（素）/（荤），其余未标 |

## §4 书面确认的规则适配检查

### §4.1 现有规则是什么

| 规则 | 出处 | 内容 |
|---|---|---|
| 来源类型枚举 | `data/provenance.js:115-117` | `demo / official / merchant / user / web / field / unknown`，共 7 个 |
| 证据型来源 | `data/provenance.js:120` | `official / merchant / user / web / field` |
| 必须带 ref | `data/provenance.js:123` | 仅 `web` |
| 导入来源校验 | `tools/import_data.js:339-349` | `source_kind` 不在枚举内直接拒 |
| 证据三件套 | `tools/import_data.js:431-472` | 填了就查：`collect_date` 合法、`evidence_file` **真实存在**；`--require-evidence` 逐项要求三项非空 |
| 证据语义 | `tools/import_data.js:15-17`、`:446`、`:461-462` | 注释与错误文案都称 `evidence_file` 为"证据照片" |
| 数据层 P2/P4 | `tools/verify_data.js:382-411` | `verified/expired` 必须有证据型来源 + `source.detail`；`web` 必须有 `ref` |
| 云端准入 | `cloudfunctions/seed/index.js:299-306` | 真实批次固定 `dataClass=field_unverified`、`verifyStatus=unverified`、`verifiedAt=null` |
| 云端拒写空来源 | `cloudfunctions/seed/index.js:311-330` | 真实批次 `source.kind` 或 `source.detail` 为空 → 整批拒写 |
| 契约口径 | `docs/RECORD_GENERATOR_CONTRACT_20261023.md:183-184`、`:956` | `sourceKind` 固定 `field`、`verifyStatus` 固定 `unverified`；可追溯要求"指到第 N 张照片或档主口述原始记录" |

### §4.2 逐项回答

| 问题 | 结论 |
|---|---|
| 书面确认是现有允许的 `source.kind` 吗？ | **不是**。7 个枚举里没有"负责人确认/书面证明"；`official` 指官方主体（校方/餐厅），`merchant` 指商家，`user` 指用户投稿，`field` 指现场采集行为本身 |
| 能满足 `--require-evidence` 吗？ | **能"通过"，但不该这么用**。它只要求 `collector / collect_date / evidence_file` 非空且文件存在，**不检查文件类型**；把 `.md` 填进 `evidence_file` 会通过，但与"证据照片"的语义冲突，属利用规则宽松而非满足规则 |
| 能满足 `field_unverified` 准入吗？ | **准入本身不依赖确认**：云端只要 `source.kind`/`source.detail` 非空即可写入；确认影响的是"字段事实是否成立"，不是准入机制 |
| 能替代照片吗？ | **不能**。D1 明确"不得默认它能替代所有照片"；本报告 §3 中所有 **P** 字段均已有照片支持，确认只对 **A** 字段有意义 |

### §4.3 最小规则差异草案（本轮不实施）

| 方案 | 改动面 | 优点 | 风险 |
|---|---|---|---|
| **A. 零代码（推荐先用）** | 无代码改动；确认件存 `tools/pilot/batch1_min/attestations/`，在 `source_detail` 末尾加固定句式"负责人书面确认（YYYY-MM-DD，见 attestations/xxx.md）：F1/F2/F3" | 不动校验、不新增字段、可立即执行 | 无法机器校验"确认覆盖了哪些字段" |
| **B. 小改（要批准才做）** | `import_data.js` 增两列 `attestation_ref` / `attestation_fields` 并写入 manifest；`verify_data.js` 增 1 条规则：`attestation_fields` 非空时 `attestation_ref` 必须存在且文件真实；**禁止**确认覆盖 `dish_name` / `price` / `tastes` | 确认可审计、可被规则挡住越界 | 动 2 个工具 + 测试 + 契约 1 节；需要单独批准 |
| **C. 新 kind `attestation`（不建议）** | 动 `provenance` / `verify_data` / 契约 / 生成器 / seed | 语义最干净 | 会为"未核实"数据引入更弱来源；改动面大、回归风险高 |

**推荐**：本轮用 **A** 推进 B1；若负责人希望确认件进入可审计数据链路，再单独批准 **B**。

## §5 B1 最小待办清单

### §5.1 负责人确认即可解决（不需要再拍照）

| # | 事项 | 解决后字段状态 |
|---|---|---|
| T1 | 餐厅名 = 三餐 / 第三餐厅（口径统一） | `shop_name`、`building` 可登记为确认值 |
| T2 | 楼层 = 2 楼 | `floor_label` 可登记 |
| T3 | 方位 = 最西侧（`side=west`） | `side` 可登记；`no_status` 仍为 `unverified` |
| T4 | `c02_t02` 就是「韩小面」这一窗口 | 档口归属确认 |
| T5 | 「麻酱凉面 8 元」是否在售、价签在哪 | 决定 D12 是 P 还是补拍 |
| T6 | 三款清汤面的「（可拼）」是名称一部分还是可选加料 | 关闭 §3.4 的 **C** |
| T7 | `tastes` 取值依据（重庆小面/干拌小面为何是 `spicy`） | 要么确认、要么降为 `choice` 并写明依据 |

### §5.2 必须现场补拍（照片不可替代）

| # | 拍摄对象 | 为什么 | 建议画面 |
|---|---|---|---|
| P1 | 档口正面 + 可辨认的窗口编号/参照物 | 现照片只有招牌与价目表，无法定位到具体窗口 | 含相邻窗口、通道、门牌 |
| P2 | 楼层指引牌 / 楼层号（与档口同框） | 楼层目前零证据 | 楼层牌 + 走廊可见 |
| P3 | 「麻酱凉面」价签（若在售） | 现画面未见 | 单独近拍 |
| P4 | （可选）餐厅门头/楼栋名 | 目前"三餐 = 第三餐厅"无照片 | 建筑外立面或入口标识 |

### §5.3 可以保持未知，不阻塞试点

| 字段 | 理由 |
|---|---|
| `side`（若负责人不确认） | 已有 `no_status=unverified`，如实标注即可 |
| `no`（档口编号） | 编号可能不存在；编造比缺失更糟 |
| 营业时间、是否每日供应 | 对"展示一家窗口的菜与价"不是必需 |
| 小吃五项（卤蛋/卤肠/煎蛋/辣椒/豆干） | 不在 12 条菜品内；未录入，也不需要为试点补 |
| 菜品营养/过敏原信息 | 无来源，保持没有 |

## §6 下一阶段放行条件

1. **确认件已签署**（或负责人明确"不确认，保持未知"），并满足模板字段要求。
2. 若采用方案 B：规则改动单独批准、测试全绿、契约同步；**未批准前不得把确认件塞进 `evidence_file`**。
3. `node tools/import_data.js --dir tools/pilot/batch1_min --require-evidence` 仍为 exit 0（现状已满足，改动后再复核一次）。
4. `c02` 命名空间条件批准（`ap-20261026-01-c02`）仍有效，且 `check_id_admission` 对 `c02` 只出 note、不出冲突。
5. 云端写入前另需四件事，缺一不可：**线上 seed 版本确认**（当前 UNKNOWN）、**写入前快照方案**、**回滚边界**、**单独授权**。
6. 试点写入只能是 `dataClass=field_unverified`、`verifyStatus=unverified`、`verifiedAt=null`；不得写 `data/`、不得标 `verified`、不得进正式产物。

## §7 本轮副作用与仓库状态

| 项 | 结果 |
|---|---|
| 新增文件 | `docs/OWNER_ATTESTATION_TEMPLATE_B1_20261026.md`、本报告 |
| 修改文件 | 无（CSV、JSON、配置、代码均未改） |
| `batch1_min` 哈希 | 核对前后一致，见 §1 表 |
| 云端 | 0 次调用、0 次部署、0 次写入 |
| Git | `HEAD 274ebd6`、分支 `main`、暂存 0、`status --short` 70 行、`--untracked-files=all` 271 行（+2 = 本轮两个 md）、`git diff --check` exit 0 |
| 冻结七文件 | SHA-256 前 16 位全部与基线一致（见 §1 第 5 行） |
| 正式产物 | 仍不存在 |
| 行尾与编码 | `node tools/check_eol.js` → 55 文件（docs 43 + tools 12）违规 0，exit 0；两份新文档均 UTF-8 无 BOM、0 CRLF、单尾 LF |
| 表格完整性 | 模板 4 个表、审计报告 17 个表，列数错配 0 |
| 复核（写入后） | `verify_data` exit 0（12/7/24/45）；`check_id_admission` exit 1（唯一 `c03` 冲突，`c02` 三条 `NS_CONDITIONAL` note）；`import_data --require-evidence` 仍 exit 0 |

## §8 待决问题

| # | 问题 | 需要谁 |
|---|---|---|
| Q1 | 方案 A 还是方案 B？（确认件要不要进可审计链路） | 负责人 |
| Q2 | 「麻酱凉面 8 元」是否在售？ | 负责人 / 补拍 |
| Q3 | 三款清汤面「（可拼）」如何入名？ | 负责人 |
| Q4 | 楼层/方位若始终无照片，是否接受"确认值 + `no_status=unverified`"？ | 负责人 |
