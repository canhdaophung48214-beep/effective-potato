# 真实校园数据采集规范（A3）

> 版本：A3 初版 · 2026-10-22
> 适用阶段：**本地采集与导入准备**。本轮不导入任何真实数据、不连接云端写入通道。
> 本文档的每条规则都标注了源码依据（`文件:行号`）。凡源码里**还没有**的东西，一律写成「建议字段 / 待实现」，不得当成已有能力使用。

---

## 0. 一句话

先采准一家食堂，再谈全校。**宁可少录一条，也不要写一条猜出来的数据。**

---

## 1. 本轮边界（先看清能做什么、不能做什么）

| 事项 | 现在能不能做 | 说明 |
|---|---|---|
| 写 CSV、拍照、填证据 | 能 | 模板在 `tools/templates/` |
| `node tools/import_data.js --dir <目录>` 预览校验 | 能 | 默认 dry-run，不写任何文件 |
| `--write --out <目录>` 生成本地 JSON | 能 | 只写到项目外的目录，写不进 `data/` `pages/`（`tools/import_data.js` 的 `assertSafeOutDir`，`:1050`） |
| 合并进 `data/shops.js` / `data/dishes.js` | **不能自动做** | 需要人工确认，见第 12 节 |
| 写入云数据库 | **不能** | 本地 JSON → 云端目前没有通道（A1 报告的 M4） |
| 套餐 / 加料 / 店铺规则 | **不能导入** | `record_type` 只接受 `菜品`，其余被显式拒绝（`RECORD_TYPE_DISH` / `RECORD_TYPES_UNSUPPORTED`；`buildImport` 的 `record_type` 拒绝分支）。套餐模型见 `tools/COMBO_SET_MODEL_PROPOSAL.md` |
| 把新数据标成「已核实」 | **不能，也不允许** | 导入器强制 `unverified` + `verifiedAt: null`（`metaOf` 强制 `unverified` + `verifiedAt:null`，`:353-360`），且 `verify_status` / `verified_at` 列整表拒收（`:114`） |

---

## 2. 采集顺序

**食堂 → 楼层 → 窗口 → 菜品 → 套餐（待实现）**

理由：后一层永远靠前一层的 id 挂靠，顺序反了就只能瞎猜归属。

1. **食堂**：先确认名称、校区、大致位置（`buildings` / `location`）。名称用现场看到的**正式全称**，不缩写。
2. **楼层**：只有现场确实分层、且窗口归属楼层明确时才建楼层记录。整个食堂没有楼层划分 → `floors.csv` 里不写这家店，窗口的 `floor_id` 留空（`verify_data.js:235` 会断言「无楼层店铺窗口 floorId 必须为空」）。
3. **窗口**：一个招牌 = 一个窗口。**「3 号窗口」这种编号只有在现场确实这么叫时才写**，否则写招牌上的名字（如「兰州拉面」「猪脚饭」）。
4. **菜品**：先采每个窗口的**招牌 2–4 道**，不要一上来抄全表。
5. **套餐**：等 `record_type` 支持套餐之后再采（见套餐设计文档），现在遇到套餐**先记在备注里**，不要当成普通菜品录入 —— 否则套餐总价会污染单品的预算筛选。

---

## 3. ID 命名约定

> 导入器**不校验** id 的格式，只要求「非空字符串 + 不与现有 id 冲突 + 本次不重复」（`verify_data.js:163`、`:175`、`:293-295`）。所以命名规范靠人守，不靠工具拦。

| 对象 | 格式 | 示例 | 说明 |
|---|---|---|---|
| 食堂 | `c` + 两位序号 | `c01` | `c` = campus，与演示数据的 `s01`、`s07` 区分开 |
| 楼层 | `<食堂 id>_f<序号>` | `c01_f1` | 楼层序号按现场习惯，1 楼写 `f1` |
| 窗口 | `<食堂 id>_t<两位序号>` | `c01_t01` | 用两位，`t01` 而不是 `t1`，排序才不会乱 |
| 菜品 | `<食堂 id>_d<三位序号>` | `c01_d001` | 三位，跨窗口统一编号 |
| 套餐 | 待定 | — | 见套餐设计文档（建议 `c01_m001`） |

- **一旦写入，永远不要改 id**。id 变了等于换了一条记录，历史证据和云端 `_id` 都对不上。
- 序号允许跳号：删掉中间一条不用重新编号。

---

## 4. 四张表的字段规则

字段以 `tools/templates/*.csv` 与 `tools/import_data.js` 的 `SCHEMAS`（`:68`）为准。**列顺序无关**，靠表头名字取值（`rowsToRecords`，`:240`）；缺必需列直接报错，多余列只警告并忽略（`rowsToRecords` 的缺列报错与多余列警告）。

> **「可空」的含义（F2）**：`可空` 只表示**单元格**可以留空，**不表示可以删掉这一列的表头**。
> 四张表的列头必须原样保留——包括 `building`、`location`、`source_ref`、`side`、`no_status`、`no`、`record_type` 这些「可空」字段。
> 删列不会「按默认值处理」，而是整表读取失败并报「缺少必需列」，退出码 1（实测：删 7 列报 9 条错误）。

### 4.1 `shops.csv`（食堂 / 商家）

| 字段 | 必填 | 允许值 / 格式 | 常见错误 |
|---|---|---|---|
| `shop_id` | 是 | 见第 3 节 | 用了演示数据的 `s01` → 与现有 id 冲突被拒 |
| `shop_name` | 是 | 现场正式名称 | 写成「一餐」「二食」这种只有本校人懂的简称 |
| `area` | 是 | `campus` / `offsite`（`verify_data.js:62` 的 `AREA_VALUES`） | 写成「校内」「校外」 |
| `building` | 否 | 楼群 / 区域，如「西区食堂群」 | 把楼层写进来（楼层归 `floors.csv`） |
| `location` | 否 | 「西校区 · 一号食堂」这种可读位置 | **不要写「演示位置」**，那是演示数据的标记 |
| `source_kind` | 是 | `official` / `merchant` / `user` / `web` / `field` | 写 `demo` 或 `unknown` → 被拒（`buildSource` 的来源白名单） |
| `source_detail` | 是 | 一句话说明「凭什么」：如「现场拍摄的价目表 + 窗口招牌」 | 写「网上查的」（要写清哪个网站 / 哪条链接） |
| `source_ref` | `web` 必填，其余可空 | 链接或可复现指引 | `web` 来源留空 → 被拒 |
| `collector` | 普通预览可空；`--require-evidence` 必填 | 采集人代号（真名/昵称自定，**不要写学号、手机号**） | 用真人隐私信息；严格模式下留空 → 该条被拒 |
| `collect_date` | 普通预览可空；`--require-evidence` 必填 | `YYYY-MM-DD`，采当天日期 | 写 Excel 日期序列号；写 `2026-02-30` 这类不存在的日期 → 被拒 |
| `evidence_file` | 普通预览：填了就必须存在；`--require-evidence` 必填 | 照片文件名，见第 9 节 | 填空（严格模式）/写不存在的文件名（任何模式）→ 被拒（`checkEvidence` 的证据存在性校验） |

### 4.2 `floors.csv`（楼层，可整张表为空）

| 字段 | 必填 | 允许值 / 格式 | 说明 |
|---|---|---|---|
| `shop_id` | 是 | 本次新增的食堂 id | **只能挂本次新增的店铺**；给已有店铺补楼层需要 patch 格式，当前显式拒绝（`buildImport` 的 floors 段拒绝（只能挂本次新增店铺）） |
| `floor_id` | 是 | `c01_f1` | |
| `floor_label` | 是 | 「1 楼」「二楼」「负一层」 | 用现场说法 |
| `source_*` / `collector` / `collect_date` / `evidence_file` | 同 4.1 | | 楼层牌的现场照片最有力 |

### 4.3 `stalls.csv`（窗口 / 档口）

| 字段 | 必填 | 允许值 / 格式 | 说明 |
|---|---|---|---|
| `shop_id` | 是 | 本次新增的食堂 id | 同上，给已有店铺补窗口也被拒绝（`buildImport` 的 stalls 段拒绝（只能挂本次新增/现有店铺）） |
| `floor_id` | 有楼层时必填 | 该店 `floors.csv` 里的 `floor_id` | 无楼层店铺**必须留空** |
| `stall_id` | 是 | `c01_t01` | |
| `stall_name` | 是 | 招牌名 / 现场叫法 | 不要为了整齐编「A 档」「B 档」 |
| `side` | 否 | `east` / `south` / `west` / `north` | 只有现场确实按方位标（如「东侧」）才填 |
| `no_status` | 否 | `has` / `none` / `unverified` | 窗口号**核实过**= `has`；确认没号= `none`；不确定= `unverified` |
| `no` | 否 | 窗口号，字符串 | `no_status=has` 时必须填 |
| `source_*` / 采集三件套 | 同 4.1 | | 窗口招牌照是关键证据 |

### 4.4 `dishes.csv`（菜品）

| 字段 | 必填 | 允许值 / 格式 | 说明 |
|---|---|---|---|
| `dish_id` | 是 | `c01_d001` | |
| `dish_name` | 是 | 价目表上的原名 | 不要自己润色成「招牌红烧肉盖饭」 |
| `record_type` | 否（默认 `菜品`） | **目前只接受 `菜品`** | 写 `套餐` / `加料` / `店铺规则` → 被拒（`RECORD_TYPE_DISH`/`RECORD_TYPES_UNSUPPORTED`；`buildImport` 的 `record_type` 拒绝分支） |
| `shop_id` | 是 | 新增店铺或**已有店铺** | 给已有店铺补菜品是允许的（`buildImport` 的 dishes 补录段） |
| `stall_id` | 是 | 该店已有窗口（`existing.stallShop[stallId] === shopId`，`:603`（`existing.stallShop` 校验）） | 窗口串店会被拒 |
| `price` | 是 | 有限正数、最多一位小数、**无固定上限**（见第 7 节） | 写「12元」「12-15」「12.5/两」全部被拒 |
| `food_type` | 是 | `rice` `noodle` `rice_noodle` `rice_vermicelli` `dumpling` `malatang` `snack` `other` | 写 `all` 或中文 → 被拒（`verify_data.js:335-338`） |
| `tastes` | 是 | `light` `mild_spicy` `spicy`，**只填一个** | 写「微辣、麻辣」→ 被拒（`buildImport` 的 `tastes` 单值校验） |
| `source_*` / 采集三件套 | 同 4.1 | | 价目表照片是最强证据 |

**`food_type` 归类的三个约定**（`data/dishes.js:15-23`）：米线与粉分开、不合并；饺子/馄饨归 `dumpling`；麻辣烫与冒菜同归 `malatang`。

**必须拆行的情况**（`data/dishes.js:35-40`，`verify_data.js:351-357` 的 D8 自然键 `shopId+stallId+name+price`）：

- 价格不同 → 拆成两条（大份 12 元、小份 10 元 = 两条记录）；
- 加了料另收钱 → 拆成两条或记在备注；
- 同一道菜不同辣度可点（如「微辣/麻辣可选」）→ 见第 8 节，**不要**拆成两条同名同价记录（D8 会判重复）。

---

## 5. 来源、证据与采集三件套

### 5.1 `source_kind` 的五个可用值

| 值 | 什么时候用 | `source_detail` 写什么 |
|---|---|---|
| `official` | 食堂管理方公示、校方文件 | 文件名称 + 发布单位 + 日期 |
| `merchant` | 商家自己给的菜单 / 说的价 | 店家名称 + 谁说的 + 日期 |
| `field` | **现场看/拍到的**（首选） | 拍到了什么：「3 号窗口上方价目表」「收银台贴纸」 |
| `user` | 同学提供、且有截图/照片佐证 | 提供者代号 + 佐证是什么 |
| `web` | 网络来源 | **必须填 `source_ref`**，写完整链接 |

`demo` 与 `unknown` 不接受（`buildSource` 的来源白名单）：真实数据不允许用「不知道哪来的」当来源。

### 5.2 采集三件套（`collector` / `collect_date` / `evidence_file`）

- 三列在**四张表里都有**（`EVIDENCE_COLUMNS`（`:59`） 的 `EVIDENCE_COLUMNS`）。
- **两种模式的要求不同（F1 后已按字段逐项强制）**：

  | | 普通预览（默认） | `--require-evidence`（采集验收） |
  |---|---|---|
  | `collector` | 可空 | **必填**，空 → 拒绝 |
  | `collect_date` | 可空；填了就必须是合法 `YYYY-MM-DD` | **必填**，空或非法 → 拒绝 |
  | `evidence_file` | 可空；填了就必须真实存在 | **必填**，空或文件不存在 → 拒绝 |

- 拒绝信息会**点名缺的是哪一项**，例如
  `缺少证据字段：collector（采集人）（--require-evidence 要求三项逐项填写，缺一不可）`、
  `collect_date 格式非法："2026-02-30"（必须是 YYYY-MM-DD，且是真实存在的日期、不晚于今天）`。
- 日期校验**复用数据层同一套实现**（`data/provenance.js` 的 `isValidDateString`）：
  格式、真实日历日、不晚于今天三项一起判，不存在「导入器放行、数据层拒绝」的口径差。
- **只有通过检查的记录才进证据清单**：被拒的记录不会出现在 `manifest.json` 的 `evidence` 数组里，避免清单被脏数据污染。
- 这三项目前**存不进数据模型**，只写进输出目录的 `manifest.json` 的 `evidence` 数组（`import_data.js` 的 `buildPayload`）。也就是说：它们服务于「人工复核」，不构成 `verified` 依据。

---

## 6. 可信度：新数据一律 `unverified`

- 导入器强制 `verifyStatus: 'unverified'`、`verifiedAt: null`（`metaOf` 强制 `unverified`）。
- CSV 里写 `verify_status` / `verified_at` 列 → 整张表被拒（`FORBIDDEN_COLUMNS`（`:114`） 的 `FORBIDDEN_COLUMNS`）。
- 「已核实」只能由后续的核验流程产生（现在没有这个流程），**采集阶段永远不要考虑「这条算核实了吗」**，只管把证据留全。
- 页面上 `demo`（演示）与 `unverified`（未核实）是两种不同标签，采集数据不会被显示成已核实（`data/provenance.js` 的 `VERIFY_LABEL`）。

---

## 7. 价格规则（A3 已按产品决策调整）

### 7.1 现在校验什么

| 检查 | 结果 | 依据 |
|---|---|---|
| 不是数字（`"12元"`、`"12-15"`、空） | **错误**，拒绝该条 | `verify_data.js:320-321` |
| 非有限数 / ≤ 0（`0`、`-5`、`NaN`） | **错误**，拒绝该条 | `verify_data.js:322-323` |
| 超过一位小数（`12.55`） | **错误**，拒绝该条 | `verify_data.js:325-327` |
| **高于 ¥100** | **警告**，仍可导入，进入人工复核 | `verify_data.js:328-331`（D5 已从「判错」改为「复核警告」） |

- 固定的「最高 100 元」上限**已取消**（产品决策 1）。`PRICE_MAX = 100` 现在只是**复核阈值**，不再是硬上限。
- 两次检查都会跑：`101.55` 既报「最多一位小数」错误，也报「需人工复核」警告。

### 7.2 异常价格的人工复核流程（规范，不是自动化）

导入输出里会把警告逐条打出来，形如：

```
新增记录单独校验：0 错误 / 1 警告
  ! [D5] dish c01_d001 → price = 101　价格高于 ¥100，属异常价格，需人工复核（不自动判错）
```

复核动作（**必须留痕，不能只在脑子里过一遍**）：

1. 打开该条的 `evidence_file` 原图，确认价目表上确实是这个数字；
2. 若确认是**该菜单价** → 在采集表备注里写「已复核：价目表原图第 X 张，单价成立」，正常导入；
3. 若其实是**套餐/整桌/按时段计价** → 不能当单品价录，按第 2 节第 5 条处理（先记备注，等套餐模型）；
4. 若照片看不清或价目表已换 → 标 `unverified` 并记「价格待复核」，**不要凭记忆填**。

> 系统**没有**自动异常检测，"异常" 目前只有这一条阈值警告。

---

## 8. 辣度规则

### 8.1 现行规则（已实现）

- 一道菜**恰好一个**辣度标签，取值 `light` 清淡 / `mild_spicy` 微辣 / `spicy` 麻辣 / `choice` 可选辣度（`verify_data.js:341-349` 的 D7；`data/dishes.js:29-40` 规约 1）。
- CSV 里用分隔符拼多个值（`|`、`,`、`、`）会被直接拒绝（`buildImport` 的 `tastes` 单值校验）。
- 原因：三个档位是**同一维度的互斥档位**，同时挂两个会让「选微辣」弹出偏辣的菜，筛选结果不可信。

### 8.1b 第四个值 `choice`：辣度可自选（A7 决策，已实现）

价目表不标辣度、店家说「辣度可以自己选 / 都能做」时，用这个值，**不要**猜一个档位填进去。

| 项目 | 规则 |
|---|---|
| 何时填 | 店家明确表示辣度可调，或现场看到「微辣 / 麻辣 可选」这类说明 |
| 何时不填 | 价目表什么都没写、你也没问到 → 留空不写，先在采集备注记「辣度待确认」 |
| 筛选语义 | 用户选「清淡 / 微辣 / 麻辣」时，`choice` 的菜**都算命中**（因为都点得出来）；选「不限」也命中 |
| 为什么不是「多挂两个值」 | 多值会被 D7 拒绝；而且「可自选」不是「同时是微辣和麻辣」，语义不同 |
| 实现位置 | 枚举 `data/index.js:38-44`；筛选通配 `utils/matcher.js` 的 `hasAnyTaste` |

> 一句话：`choice` 描述的是「这道菜的辣度不固定」，不是第四个辣度档位。它仍然只能单独出现。

### 8.2 可选的第二个辣度（**建议字段，未实现**）

上一节解决的是「辣度完全可自选」。如果遇到**只固定两档**（默认微辣、另可做麻辣）的情况，仍需要独立的第二档字段，当前代码没有：

- **现在怎么记**：`tastes` 填**默认提供的那个**（店家默认做的档位），并在采集表备注写「另可做：麻辣」。备注不进数据、不参与筛选，只供人工参考。
- **不能怎么记**：不要把两个值拼成一个字符串、不要塞进 `tastes` 数组、不要新开一列 `tastes_extra` 就以为能导入 —— 未知列只会被**忽略并警告**（`rowsToRecords` 的未知列警告），数据会静默丢失。
- **建议字段方案**（待实现，需改模型/校验/页面/导入器，本轮不实施）：

  | 项目 | 建议 |
  |---|---|
  | 字段名 | `extraTastes`（数组，0 或 1 个元素，枚举与 `TASTE_VALUES` 相同但不得为 `choice`） |
  | 与 `tastes` 的关系 | `tastes` 仍是**唯一参与筛选**的字段；`extraTastes` 只用于展示「另可做麻辣」 |
  | 校验 | `extraTastes.length <= 1`；值必须在枚举内；不得等于 `tastes[0]`（避免同义重复） |
  | CSV 列名 | `tastes_extra`（**待实现**，现在加了也不会被读取） |
  | 页面 | 菜品卡标签区加一个浅色标签，标注「可选」，不参与筛选与排序 |

---

## 9. 证据照片与记录的对应规则

1. **一个对象至少一张**：食堂拍门头 + 价目表全景；楼层拍楼层牌；窗口拍招牌 + 窗口号；菜品以**价目表**为主证据。
2. **命名**：`<对象 id>_<类型>.jpg`，类型从 `menu`（价目表）/ `sign`（招牌）/ `storefront`（门头）/ `price`（价格贴纸）里选。
   - 例：`c01_menu.jpg`、`c01_f1.jpg`、`c01_t01.jpg`、`c01_d001.jpg`。
3. **相对路径**：`evidence_file` 可以只写文件名（相对 CSV 目录），也可以写绝对路径（`resolveEvidencePath`（`:374`） 的 `resolveEvidencePath`）。
4. **一张照片覆盖多条记录**：同窗口的多道菜可以共用同一张价目表照 —— 每条记录的 `evidence_file` 都写这一张的文件名。**不要**只给第一条填。
5. **拍不全时**：宁可不录。缺证据的记录在 `--require-evidence` 模式下会被整体拒绝。
6. **不要 P 图、不要用别人的图**：`source_kind=web` 必须留链接，转载图必须写清来源。

---

## 10. 单食堂试点验收清单

试点范围建议：**一家食堂、至少 1 层、至少 5 个窗口、至少 25 道菜**。逐条打勾才算过。

- [ ] 1. `shops.csv` 只有 1 条，`shop_id` 形如 `c01`，`area` = `campus`，`source_kind` ≠ `demo`/`unknown`
- [ ] 2. 楼层：有楼层就都录了；无楼层则 `floors.csv` 空、窗口 `floor_id` 留空
- [ ] 3. 窗口 ≥ 5 条，`stall_name` 与现场招牌一致（不是「A 档/B 档」自编名）
- [ ] 4. 菜品 ≥ 25 条，`food_type` 全部落在八种枚举内，`tastes` 全部单值（`choice` 也算单值）
- [ ] 5. 每个窗口至少 1 张价目表照片，文件名能被 `evidence_file` 解析到真实文件
- [ ] 6. 每条记录都有 `collector` / `collect_date` / `evidence_file`
- [ ] 7. 价格全部通过格式校验；高于 ¥100 的条目都已按 7.2 复核并留痕
- [ ] 8. `node tools/import_data.js --dir <目录> --require-evidence` 退出码 **0**，`拒绝 0 条`
- [ ] 9. 输出里 `警告` 逐条看过，没有「未知列」这种低级问题
- [ ] 10. 人工抽查 3 条记录，与原图逐字核对菜名、价格、窗口，全部一致
- [ ] 11. 没有把套餐/加料当普通菜品录入
- [ ] 12. 全表搜索确认没有把「演示」「猜的」「大概」写进 `source_detail`

---

## 11. 不能确认的信息怎么办

| 情况 | 做法 |
|---|---|
| 价格看不清 | 不录这条，或录了但在备注写「价格待复核」，`tastes`/`price` 不许凭印象填 |
| 窗口归属不确定 | 不录，先去问；宁可少一个窗口 |
| 招牌字看不清 | 记成「招牌照片见 `c01_t03.jpg`，名称待确认」，**不要**音译乱猜 |
| 营业时间 / 是否搬迁 | 本轮数据模型**没有**营业时间字段，写进备注即可，不要硬塞进 `location` |
| 听说要涨价但还没涨 | 只录当前价；传闻不是数据 |
| 门店临时停业 | 不录菜品，或全部标 `unverified` 并在备注注明「X 月 X 日拟停业，待核实」 |

**通用原则**：模型里没有的字段 → 写备注；模型里有的字段但不确定 → 宁可留空/不录，也不要猜。

---

## 12. 命令与检查

```bash
# 1) 模板自检（应输出「没有可导入的新记录」）
node tools/import_data.js

# 2) 采集数据预览（dry-run，不写任何文件）
node tools/import_data.js --dir D:\采集\一号食堂

# 3) 采集验收（强制每条都有证据三件套）
node tools/import_data.js --dir D:\采集\一号食堂 --require-evidence

# 4) 真正生成本地 JSON（写到你指定的、项目外的目录）
node tools/import_data.js --dir D:\采集\一号食堂 --write --out D:\采集\out

# 5) 数据基线校验（确认现有 45 道演示数据没被破坏）
node tools/verify_data.js
```

- 退出码：`0` 通过 / `1` 有错误或被拒（不写入）/ `2` 用法错误（含 `--out` 指向受保护目录）/ `3` 写入失败。
- **合并进 `data/` 仍然是人工步骤**：导入器只产出 `shops.json` / `dishes.json` / `manifest.json`，不直接改 `data/*.js`。
- 云数据库这一环目前**完全没有通道**，任何"导完就上线"的想法都不成立。

---

## 13. 规则来源索引（自查用）

| 结论 | 源码依据 |
|---|---|
| `record_type` 只接受「菜品」 | `RECORD_TYPE_DISH`/`RECORD_TYPES_UNSUPPORTED`；`buildImport` 的 `record_type` 拒绝分支 |
| 价格：数字 / 有限正数 / 一位小数 = 错误 | `tools/verify_data.js:320-327` |
| 价格 >100 = 警告（不再是上限） | `tools/verify_data.js:328-331` |
| 自然键 `shopId+stallId+name+price` 去重 | `tools/verify_data.js:351-357` |
| `tastes` 单值 + 四枚举（含 choice） | `tools/verify_data.js:341-349`、`buildImport` 的 `tastes` 校验 |
| `food_type` 八枚举、无 `all` | `tools/verify_data.js:335-338` |
| `area` / `side` / `no_status` 枚举 | `tools/verify_data.js:62` 的 `AREA_VALUES`、`:65` 的 `SIDE_VALUES`、`:66` 的 `NO_STATUS_VALUES` + `tools/import_data.js` 的 `SCHEMAS` |
| 来源白名单与 `web` 必须带 `ref` | `buildSource`（来源白名单） |
| 强制 `unverified` + `verifiedAt: null` | `metaOf`（强制 `unverified`） |
| `verify_status` / `verified_at` 列禁收 | `FORBIDDEN_COLUMNS` |
| 证据文件必须真实存在 | `resolveEvidencePath`；`checkEvidence` |
| `--require-evidence` | `parseArgs` 的 `--require-evidence`（`:1085` 默认 false） |
| 只能补菜品、不能补楼层/窗口 | `buildImport`（floors/stalls 拒绝、dishes 补录） |
| `--out` 写不进受保护目录 | `assertSafeOutDir`（`:1050`） |
| 未知列只警告并忽略 | `rowsToRecords`（未知列只警告） |
| 无楼层店铺窗口 `floorId` 必须为空 | `tools/verify_data.js:235` |
| 只填一个辣度的理由 | `data/dishes.js:29-40` |
| 价格不同必须拆行 | `data/dishes.js:35-40` |
