# tools/ — 测试与校验脚本

本目录不属于小程序运行代码，**不会被编译进小程序**（`project.config.json` 未把它们加入 `packOptions.ignore`，但小程序只编译 `app.json` 里 `pages` 引用的文件与它们的依赖，`tools/` 不在依赖图里）。

## 运行环境

- Node.js（本机实测 v26.5.1）
- **零 npm 依赖**：只用 Node 内置的 `path` / `fs`
- 不需要微信开发者工具即可运行

## 当前有效的测试脚本

### 0. `verify_provenance.js` —— 阶段 2 数据可信度专项（116 项）

```bash
node tools/verify_provenance.js
```

- 当前实测：**通过 116 项 / 失败 0 项**（此前的 115 是 README 少记了一项，断言本身没动）
- 覆盖：字段完整性（45 菜 / 12 店 / 7 楼层 / 24 窗口 = 88 条，逐条 source·verifyStatus·verifiedAt）、标记规则（全 demo、无伪造时间）、四层关联透传、合成优先级（**demo > expired > 最弱一环**，含打乱层级顺序结果不变）、14 组边界用例（verified 缺时间降级、非法状态、demo 带时间清空等）、统计与摘要一致、页面绑定（WXML/WXSS/JS）、业务护栏（加字段前后筛选排序结果一致）。

### 1. `regression.js` —— 唯一质量门禁

```bash
node tools/regression.js
```

- 成功：退出码 `0`，末行 `全部通过（SKIP 项是尚未实现的功能，不代表已通过）`
- 失败：退出码 `1`，并打印失败清单
- 当前实测：**通过 122 项 / 失败 0 项 / 跳过 3 项**（2026-10-28 复跑）

覆盖范围：

| 组 | 内容 |
|---|---|
| R1 | 数据基线：45 菜 / 12 店 / id 唯一 / 每菜 1 个口味 / 8 类型非空 / 无孤儿菜品 |
| R2 | 筛选 AND 逻辑：**8784 种**条件组合与一份独立实现（`refFilter`，阶段 3 未改动一行）逐条比对，0 处不一致；7 个条件单独都真实生效；「校内+米线类+15 元」「校内+微辣+饭类」两道回归题 |
| R3 | 餐厅多选与每店独立条件：选中默认折叠、楼层/店铺只进自己的条件槽、新选餐厅不继承、取消一家另一家逐字节不变、s05 无楼层、s12 候选不串店、换区域全清 |
| R4 | 随机选店：200 次全部落在合法店铺池内，店内菜品全属于匹配集合 |
| R5 | 随机选菜：3000 次无一次越界，池内每道菜都被抽到过（无偏） |
| R6 | 再抽一次：固定随机下能抽回同一家 / 同一道；真随机 400 次出现连续重复 |
| R7 | 换一家：300 次无一次返回当前店铺；只剩一家时 toast 且状态不变 |
| R8 | 三档排序：单调性、同集合、不污染 `this.matched`、改筛选后仍生效 |
| R9 | 条件摘要：区域/餐厅/楼层/预算/口味/类型逐段与真实状态一致 |
| R10 | 重置：多个状态字段 + 计数 + 每店条件与折叠状态清空 |
| R11 | 空结果：构造 0 结果组合，三个按钮都只 toast、`mode` 不变、空态文案存在 |
| R12 | **未实现功能只登记 SKIP，绝不报 PASS**（清真 / 图片 / 评价 / 可信度字段） |
| R13 | 演示标识：12 家 location 全带「（演示位置）」、卡片与页脚声明、bindtap 全有实现 |
| R14 | **旧单值口径经新 API 等价复现**：8 组旧条件用多选 API 驱动，结果与未改动的 `refFilter` 完全一致；两道旧回归题的 id 集合逐字相同 |

### 2. `verify_stage2.js` —— 阶段 2 专项套件

```bash
node tools/verify_stage2.js
```

- 当前实测：**通过 76 项 / 失败 0 项**
- 内容：数据规约、`applySort` 内核、四道回归题、排序不污染、演示标识全覆盖、WXML class 与 bindtap 一致性
- 与 `regression.js` 有部分重叠，保留它是因为它记录的是阶段 2 当时的验收口径，可作历史对照
- **阶段 3 只做了「口径翻译」，没有删断言**：C/D/J 段把 `onSelectFoodType` / `onSelectTaste` 换成 `onToggleFoodType` / `onToggleTaste`（单选 → 多选，选中数量仍按原断言检查）；E 段（换餐厅后下级重置）与 K 段（重置后的状态字段）在多选模型下没有对应物，逐条改写成新模型的等价保证——「新选餐厅的条件槽为空」对应旧「换店即重置」，「s01 的条件原样保留」是旧版没有的更强保证。**筛选内核与排序内核的断言一处没动。**

### 3. `verify_multiselect.js` —— 阶段 3 多选筛选专项（168 项）

```bash
node tools/verify_multiselect.js
```

- 当前实测：**通过 168 项 / 失败 0 项 / 跳过 0 项**
- 覆盖：
  - **G1 窗口编号三态**：`has` / `none`（确认无编号）/ `unverified`（尚未核实）互不混用；说 `has` 却不给编号 → 降级 `unverified`，绝不补默认号
  - **G2 真实数据**：45 道菜 `side` 全空、12 家店 `stallSideOptions` 全空、没有任何一条凭空生成的「N 号窗口」、24 个窗口全部是 `unverified`（不是「确认无编号」）
  - **G3 结构**：`stallList` 与 `stalls` 等长、s05 无楼层仍有店铺记录、`location` 不出现 `undefined`
  - **G4 多选内核**：单店 / 两店 OR = 并集 / 两店各自楼层不串用 / 跨店串用必为空集 / 组内 OR / 组间 AND / 空数组 = 不限
  - **G5**：「不限」只有一种写法；`shops: [{shopId:'all'}]`、`[null,{},'']` 一律退化为不限
  - **G6**：类型与口味多选 = 各自单选之并；与预算 AND；四组条件交叉对账
  - **G7 穷举**：每店 × 楼层集 × 店铺集 × 区域 × 预算 × 类型/口味，与独立实现逐条比对（数千组）
  - **G8 旧口径护栏**：104 组单值组合 + 300 组随机组合，与 `refLegacy` 完全一致
  - **G9 方位**：用合成夹具（写在测试里，**不进 data/**）验证方位组内 OR、无方位数据的店按方位筛必为空
  - **G10–G12 页面**：默认折叠、每店独立、取消不串、展开不重算、换区域全清、s05 无楼层 chip、摘要带 `+` 与各自楼层
  - **G13**：随机选店/选菜 100/200 次全部落在多选池内；排序仍单调；空结果只 toast
  - **G14 模板**：渲染代码里没有任何写死的「N 号窗口」；方位/楼层/店铺三块分别由 `hasSide` / `floorChips.length` / `stallChips.length` 控制显隐；bindtap 全部有实现；预算仍是单值；八个主食枚举一个不少

### 4. `verify_data.js` —— 只读数据校验（29 条规则）

```bash
node tools/verify_data.js          # 只查数据文件
node tools/verify_data.js --all    # 显示全部错误/警告（默认每类只列前 20 条；join 校验始终开启）
```

- 当前实测：**0 错误 / 0 警告，退出码 0**（12 店铺 / 7 楼层 / 24 窗口 / 45 菜品）
- 规则分四组：结构（S1-S3）、楼层窗口（F1-F3、T1-T6）、菜品（D1-D8）、可信度（P1-P6）+ join（J1、J3、J4）
- **`checkJoin` 的语义边界**：J1 拿**仓库当前数据层**（`data/index.js` 的 `ALL_DISHES`）去 join，不是拿传进来的 `dataset`。它只回答「仓库里现存的数据 join 后字段齐不齐」。若把**只有新增记录、还没合并进 `data/`** 的数据传进来再开 `checkJoin`，每条新增菜品都会报 `J1 join 后找不到该菜品`——那是用法错误，不是数据有问题。校验新增记录请用 `checkJoin: false`（`import_data.js` 内部就是这么用的）。
- 退出码：`0` 无错误 / `1` 有错误 / `2` 用法错误。**只读，不写任何文件。**

### 5. `test_verify_data.js` —— 校验器专项（122 项）

```bash
node tools/test_verify_data.js
```

- 当前实测：**通过 122 项 / 失败 0 项**（2026-10-28 复跑）
- 每组规则都有对应用例（29/29），另有只读性守卫：跑完 8 个数据/页面文件 sha256 不变

### 6. `test_import_data.js` —— CSV 导入专项（243 项）

```bash
node tools/test_import_data.js
```

- 当前实测：**通过 243 项 / 失败 0 项**（2026-10-28 复跑）
- 覆盖 A1–A13 十三条要求，外加 A14 安全边界：增量补菜、证据文件必须存在、`--out` 护栏、写入失败真回滚、拒绝项带真实行号
- A15 是 `--require-evidence` 的逐项校验：三件套齐全可过、单独缺 `collector` / `collect_date` / `evidence_file` 各自被拒且提示点名该字段、五种非法日期格式被拒、普通预览模式仍允许留空、模板示例行在严格模式下不误报
- 全部夹具写在 `os.tmpdir()` 的临时目录里，不碰真实项目文件

## 新增于 2026-10-25 之后：静态检查、专项回归与离线套件

> 以下脚本都在**项目根目录**运行（`node tools/xxx.js`）。"只读"指不写项目文件；需要临时文件的脚本只写 `os.tmpdir()`。章节 0–6 的 7 个旧脚本仍然有效，这里不重复列。

### 7. 静态检查与文档校验（只读）

| 脚本 | 用途 | 命令 | 备注 |
|---|---|---|---|
| `check_eol.js` | 行尾/BOM/空文件检查，扫描 `docs/` 与 `tools/` 下的 Markdown | `node tools/check_eol.js` | 只报告不修复（无 `--fix`）；`0` 通过 / `1` 强制范围违规 / `2` 扫描错误 |
| `check_doc_refs.js` | 章节锚点（`§X.Y`）与行号引用（`:NNN`）检查 | `node tools/check_doc_refs.js`（`--json`、`--self-test`） | 只读；白名单见 `tools/doc_ref_whitelist.json` |
| `check_id_admission.js` | 命名空间、重复 ID、与冻结映射/批准登记的冲突检查 | `node tools/check_id_admission.js` | 只读；发现未批准命名空间时退出码 `1`（符合预期不等于脚本失败） |

### 8. 校验器自测（离线）

| 脚本 | 用途 | 命令 |
|---|---|---|
| `test_check_eol.js` | `check_eol.js` 的夹具自测 | `node tools/test_check_eol.js` |
| `test_check_doc_refs.js` | `check_doc_refs.js` 的夹具自测（当前 47 项） | `node tools/test_check_doc_refs.js` |
| `test_check_id_admission.js` | `check_id_admission.js` 的夹具自测 | `node tools/test_check_id_admission.js` |

### 9. 数据、云函数与页面的离线套件

| 脚本 | 用途 | 命令 |
|---|---|---|
| `verify_seed.js` | `cloudfunctions/seed` 写死的期望数据与 `data/*.js` 的漂移自检 | `node tools/verify_seed.js` |
| `test_seed_auth.js` | `seed` 入口鉴权（管理员名单、fail-closed）离线测试 | `node tools/test_seed_auth.js` |
| `test_seed_pilot.js` | `seed` 真实批次（S2）离线测试，内存假数据库 | `node tools/test_seed_pilot.js` |
| `test_seed_s21.js` | S2.1 回滚安全（N1–N5）回归锁 | `node tools/test_seed_s21.js` |
| `test_cloudrepo.js` | `utils/cloudRepo.js` 的离线测试（假取数函数，不连云） | `node tools/test_cloudrepo.js` |
| `test_index_state.js` | 首页加载状态机的离线测试（假 `Page`/`setData`） | `node tools/test_index_state.js` |
| `test_pages.js` | 页面配置与关键结构检查 | `node tools/test_pages.js` |

### 10. UGC 投稿/审核（本地模拟，不连云、不写云端）

| 脚本 | 用途 | 命令 |
|---|---|---|
| `test_ugc_submit.js` | `submit` 云函数契约测试（保留字段、限流、去重、幂等、内容安全四态） | `node tools/test_ugc_submit.js` |
| `test_ugc_review.js` | `review` 云函数契约测试（鉴权、列表、通过/驳回/删除、日志） | `node tools/test_ugc_review.js` |
| `test_ugc_client_contract.js` | 投稿/审核页与云函数契约的静态一致性测试 | `node tools/test_ugc_client_contract.js` |
| `ugc_fake_cloud.js` | **共享替身库**：离线版 `wx-server-sdk` 与假数据库，被上面三个测试 require | 不单独运行 |

> 这三个测试是**本地模拟**，不能替代云端真实联调；云端写/调用/审核一律不在脚本内发生。

### 11. 真实数据适配与首页数据源

| 脚本 | 用途 | 命令 |
|---|---|---|
| `test_b1_adapter.js` | B1 真实数据 → 页面视图的适配层测试（含演示数据拒收、方位未核实） | `node tools/test_b1_adapter.js` |
| `test_home_datasource.js` | 首页数据源状态机（cloud/local/回退提示）测试 | `node tools/test_home_datasource.js` |

### 12. 冻结主套件

| 脚本 | 用途 | 命令 | 备注 |
|---|---|---|---|
| `test_records_spec.js` | 生成器契约与记录的完整规格套件（当前 290 通过 / 0 失败 / 11 待实现） | `node tools/test_records_spec.js` | **冻结测试**：修改需单独授权；不得为让套件变绿而删断言或改夹具 |

> 未收录：`check_unused_exports.js` 在仓库中**不存在**（此前报告提及但未落地）；`tools/pilot/*.js`（生成器、构建、校验脚本）见各自目录说明，不属本清单。

## 数据导入：CSV 模板与 `tools/import_data.js`

用于把**采集来的真实数据**以标准格式进入项目。**本项目目前没有任何真实校园数据**，`data/` 下 88 条记录仍全是演示数据。

### 四张表

| 文件 | 字段 | 关联 |
|---|---|---|
| `tools/templates/shops.csv` | `shop_id` · `shop_name` · `area` · `building` · `location` · `source_kind` · `source_detail` · `source_ref` · `collector` · `collect_date` · `evidence_file` | 主表 |
| `tools/templates/floors.csv` | `shop_id` · `floor_id` · `floor_label` · `source_*` · `collector` · `collect_date` · `evidence_file` | `shop_id` → shops |
| `tools/templates/stalls.csv` | `shop_id` · `floor_id` · `stall_id` · `stall_name` · `side` · `no_status` · `no` · `source_*` · `collector` · `collect_date` · `evidence_file` | `shop_id` → shops；`floor_id` → floors（无楼层时留空） |
| `tools/templates/dishes.csv` | `dish_id` · `dish_name` · `record_type` · `shop_id` · `stall_id` · `price` · `food_type` · `tastes` · `source_*` · `collector` · `collect_date` · `evidence_file` | `shop_id` → shops；`stall_id` → 该店 stalls |

- 关联全部走**稳定 ID**，不依赖行序
- `area`：`campus` / `offsite`；`side`：`east` / `south` / `west` / `north`（可空）；`no_status`：`has` / `none` / `unverified`
- `food_type`：`rice` / `noodle` / `rice_noodle` / `rice_vermicelli` / `dumpling` / `malatang` / `snack` / `other`
- `tastes`：`light` / `mild_spicy` / `spicy`，**只允许一个值**（辣度互斥）
- `price`：有限正数、最多一位小数、**不设固定最高价**；超过 100 元会出 D5「需人工复核」警告（不判错，不阻断导入）；**价格不同必须拆行**
- `record_type`：目前只支持 `菜品`；`套餐` / `加料` / `店铺规则` 会被**明确拒绝**，不会偷偷当普通菜品导入
- `source_kind`：`official` / `merchant` / `user` / `web` / `field`（`demo` 与 `unknown` 不接受）；`web` 来源必须填 `source_ref`
- 模板里的 `ex_` 前缀行是格式示例，导入时自动跳过，**不会被当成数据**

### 用法

```bash
node tools/import_data.js                                  # 预览模板，什么都不写
node tools/import_data.js --dir D:\采集\一号食堂            # 预览真实 CSV
node tools/import_data.js --dir D:\采集\一号食堂 --write --out D:\采集\out   # 真正写入
node tools/import_data.js --dir D:\采集\一号食堂 --require-evidence   # 采集验收：每条都必须有证据照片
```

- **不带 `--write` 一律 dry-run**：只读文件、校验、打印，不创建目录、不写文件
- 采集三件套（`collector` / `collect_date` / `evidence_file`）在两种模式下要求不同：
  - **普通预览**：三列可以留空；一旦填了 `evidence_file`（或三件套任意一项），就按「相对 CSV 目录」或绝对路径检查文件真实存在，不存在即拒绝
  - **`--require-evidence`（采集验收）**：**每条记录逐项必填**——`collector` 非空、`collect_date` 非空且是真实的 `YYYY-MM-DD`（不晚于今天）、`evidence_file` 非空且文件存在；缺哪项就点名哪项，例如 `缺少证据字段：collector（采集人）`
  - 只有通过检查的记录才会写进 `manifest.json` 的 `evidence`，被拒记录不污染证据清单
- 退出码：`0` 正常 / `1` 数据有错误或被拒绝（不写入）/ `2` 用法错误（含 `--out` 指向受保护目录）/ `3` 写入失败（含目标已存在）

### 安全保证

| 保证 | 怎么做到 |
|---|---|
| 不覆盖现有记录 | 与 `data/` 里已有 id 冲突 → 该条被拒绝；输出目录已有同名文件 → 整次写入失败（`EEXIST_TARGET`） |
| 不改演示数据 | 给已有店铺只允许**补菜品**（窗口必须是该店已有窗口）；补楼层/窗口需要 patch 格式，本轮显式拒绝 |
| 写不进受保护目录 | `--out` 经 realpath 校验后拒绝：项目根、项目上级目录、`data/` `pages/` `utils/` `cloudfunctions/` `tools/` `assets/` `config/` `design/` `docs/` 及其子目录、CSV 输入目录 |
| 证据不能编造 | 填了 `evidence_file` 就必须真实存在；`--require-evidence` 要求每条都有 |
| 不会被标记成已核验 | `verify_status` / `verified_at` 列被整表拒收；状态由程序强制写 `unverified`、`verifiedAt` 写 `null` |
| 写失败不留残骸 | 先写 `.import-tmp-<pid>-<ts>` 临时目录，全部成功后再逐个 rename；任一步失败会**反向删除已落地文件**并删掉本次新建的空目录，报告里如实区分「已完整回滚」与「回滚不完整」 |
| 写前写后都校验 | 复用 `verify_data.js` 的 `validateDataset`，写入前验、写完后读回再验 |

### 已知边界

- `collector` / `collect_date` / `evidence_file` 三个字段**现有数据模型表达不了**（88 条记录没有这些字段），导入时只写进输出目录的 `manifest.json` 的 `evidence` 数组，不写进 `shops.js` / `dishes.js` 结构里
- 输出是 `shops.json` / `dishes.json` / `manifest.json`，**不是** `data/*.js`：合并进正式数据文件需要额外一步人工确认，本轮没有做自动合并
- 不支持给已有店铺补楼层/窗口（需要 patch 格式），也不支持 `--update` 改已有记录；补价格/换位置仍需人工处理
- `collector` / `collect_date` / `evidence_file` 现在四张表都能填，但仍然只进 `manifest.json` 的 `evidence` 数组（数据模型里没有字段存它们）

### 回滚这一步

```powershell
Remove-Item tools\import_data.js      -Force
Remove-Item tools\test_import_data.js -Force
Remove-Item tools\templates -Recurse  -Force
# data/、pages/、utils/ 一步都没动过，无需回滚
```

## `legacy/` —— 基线已过期的历史脚本

这三个脚本写于 36 道 / 44 道菜品的年代，记录的是**当时的期望值**。对当前 45 道菜的数据运行必然出现失败，**失败是预期内的基线过期，不是产品缺陷**：

| 脚本 | 当前实测 | 失败原因 |
|---|---|---|
| `legacy/verify_sl.js` | 通过若干 / **失败 55** | 它用旧的 4 位置参数调用 `filterDishes(dishes, area, budget, taste)`。现在签名是 `filterDishes(dishes, cond)`，传入字符串时所有条件都退化成「不限」，所以 48 组合交叉校验全部对不上；另有 36 道基线、双口味标签（现按规约已统一为单口味）等过期断言。**修它等于重写**，其覆盖已被 `regression.js` 的 8784 组合穷举完全取代 |
| `legacy/verify_cascade.js` | 通过若干 / **失败 14** | 36→45 道的计数基线（校内 18→24、一号食堂 3→4 等）、旧条件文案（缺「不限类型」段）、以及「校外·10 元·麻辣 为空」这条已被后来的 `d40 酸辣粉 8 元` 打破 |
| `legacy/verify_foodtype.js` | 通过若干 / **失败 4** | 44→45 道的计数基线；点击处理函数从 11 个增到 14 个（新增排序与两个抽取按钮） |

**结论：这三个脚本的 73 项失败全部是基线过期，没有一项指向当前产品缺陷。** 保留它们是为了可追溯，**不要用它们判断项目是否健康**。

## `_backup/` —— 原始副本

| 文件 | 是什么 |
|---|---|
| `index.wxss.orig` | 阶段 1 修改前的 `pages/index/index.wxss`（7900 B） |
| `verify_sl.js.orig` 等 4 个 | 从系统临时目录复制过来的**未改动原始版本**（保持绝对路径写法），用于对照「我只改了 ROOT 一行」 |
| `stage2\shops.js.orig` | 阶段 2 修改前的 `data/shops.js`（88 条记录全无可信度字段） |
| `stage2\dishes.js.orig` | 阶段 2 修改前的 `data/dishes.js` |
| `stage2\data-index.js.orig` | 阶段 2 修改前的 `data/index.js` |
| `stage2\index.wxml.orig` | 阶段 2 修改前的 `pages/index/index.wxml`（含旧的 `tag-demo` / `shop-demo`） |
| `stage2\index.wxss.orig` | 阶段 2 修改前的 `pages/index/index.wxss` |
| `stage2b\provenance.js.orig` / `stage2b\verify_provenance.js.orig` 等 5 个 | 阶段 2「四个缺陷加固」修改前的版本 |
| `stage2c\provenance.js.orig` | 阶段 2「演示优先于过期」修改前的 `data/provenance.js`（当时 expired 优先于 demo） |
| `stage2c\verify_provenance.js.orig` | 该轮修改前的 `tools/verify_provenance.js`（102 项） |
| `stage2c\README.md.orig` | 该轮修改前的本文件 |
| `stage3\utils_matcher.js.orig` | 阶段 3（多选筛选）修改前的 `utils/matcher.js`（4395 B） |
| `stage3\data_index.js.orig` | 阶段 3 修改前的 `data/index.js`（7821 B） |
| `stage3\pages_index_index.js.orig` / `.wxml.orig` / `.wxss.orig` | 阶段 3 修改前的页面三件 |
| `stage3\data_shops.js.orig` | 阶段 3 开工前的 `data/shops.js`（**本轮没有改这个文件**，纯备份，用于对照「演示数据一行没动」） |
| `stage3\tools_regression.js.orig` / `tools_verify_stage2.js.orig` / `tools_verify_provenance.js.orig` / `tools_README.md.orig` | 阶段 3 修改前的测试与说明（`verify_provenance.js` 最终未被本次改动，仍是原件） |

## 回滚

```powershell
# 只回滚样式（阶段 1 之前）
Copy-Item "tools\_backup\index.wxss.orig" "pages\index\index.wxss" -Force

# 回滚阶段 2（可信度体系）——五个文件全部还原
Copy-Item "tools\_backup\stage2\shops.js.orig"      "data\shops.js"        -Force
Copy-Item "tools\_backup\stage2\dishes.js.orig"     "data\dishes.js"       -Force
Copy-Item "tools\_backup\stage2\data-index.js.orig" "data\index.js"        -Force
Copy-Item "tools\_backup\stage2\index.wxml.orig"    "pages\index\index.wxml" -Force
Copy-Item "tools\_backup\stage2\index.wxss.orig"    "pages\index\index.wxss" -Force
Remove-Item "data\provenance.js" -Force
Remove-Item "tools\verify_provenance.js" -Force
# 注意：data/provenance.js 是新增文件，其余五个是覆盖；回滚后 regression.js 的
# 「菜品全部带 source / verifyStatus / verifiedAt」一项会失败，这属于预期的越界检查
```

只回滚「演示优先于过期」这一条规则（保留四个缺陷的加固）：

```powershell
Copy-Item "tools\_backup\stage2c\provenance.js.orig"        "data\provenance.js"         -Force
Copy-Item "tools\_backup\stage2c\verify_provenance.js.orig" "tools\verify_provenance.js" -Force
Copy-Item "tools\_backup\stage2c\README.md.orig"            "tools\README.md"            -Force
# 回滚后 verify_provenance.js 应回到 102 项，且不再有 G10 组
```

只回滚四个缺陷的加固（保留「演示优先于过期」需要手工合并，不推荐）：

```powershell
Copy-Item "tools\_backup\stage2b\provenance.js.orig"        "data\provenance.js"         -Force
Copy-Item "tools\_backup\stage2b\verify_provenance.js.orig" "tools\verify_provenance.js" -Force
```

只回滚阶段 3（多选筛选、每店独立条件、方位字段）：

```powershell
Copy-Item "tools\_backup\stage3\utils_matcher.js.orig"        "utils\matcher.js"        -Force
Copy-Item "tools\_backup\stage3\data_index.js.orig"           "data\index.js"           -Force
Copy-Item "tools\_backup\stage3\pages_index_index.js.orig"    "pages\index\index.js"    -Force
Copy-Item "tools\_backup\stage3\pages_index_index.wxml.orig"  "pages\index\index.wxml"  -Force
Copy-Item "tools\_backup\stage3\pages_index_index.wxss.orig"  "pages\index\index.wxss"  -Force
Copy-Item "tools\_backup\stage3\tools_regression.js.orig"     "tools\regression.js"     -Force
Copy-Item "tools\_backup\stage3\tools_verify_stage2.js.orig"  "tools\verify_stage2.js"  -Force
Copy-Item "tools\_backup\stage3\tools_README.md.orig"         "tools\README.md"         -Force
Remove-Item "tools\verify_multiselect.js" -Force
# 回滚后 regression.js 应回到 101 项，verify_stage2.js 回到 76 项，多选专项脚本消失
```

## 这套脚本覆盖不到什么

- **不检查渲染**：换行、点击热区、首屏可见性、图片加载失败——必须用微信开发者工具或真机看
- **不模拟小程序运行时**：`Page` / `wx.showToast` 都是脚本里的替身，不覆盖真机的生命周期、setData 渲染时序、滚动行为
- **不覆盖横向滚动**：预算与主食类型的 `scroll-view` 在小屏上能否滑动、多选餐厅展开后页面会不会抖动，脚本测不了，只能真机看
- **不覆盖未实现功能**：清真、图片、评价一律 SKIP
