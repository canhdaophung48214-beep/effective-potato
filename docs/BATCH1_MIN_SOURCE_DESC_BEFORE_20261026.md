# batch1_min 来源描述修改前快照

- 记录日期：2026-10-26
- 用途：本轮获授权的"修正有证据冲突的来源描述"的**修改前备份**。
- 性质：只记录原文与哈希，不改动任何数据；本文件是新文件，不覆盖既有审计或备份。
- 授权边界：只改 `source_detail`（来源描述）列；不改菜品 ID、名称、价格、辣度、`（可拼）`口径、`shop/stall/floor` 结构字段，不改 `evidence_file`、`source_kind`、`collector`、`collect_date`。

## 1. 修改前哈希

| 文件 | 字节 | 行尾 | SHA-256 |
|---|---|---|---|
| `tools/pilot/batch1_min/shops.csv` | 373 | LF | `e35358c6e1ed14ce8ee98ff3649e40662223eaad9d9f8d0d8cfc6f4a9d601673` |
| `tools/pilot/batch1_min/floors.csv` | 293 | LF | `d098901936cf27a257da1fd31ea912edae0ccebe7a5bdc94661c4b19270d7f26` |
| `tools/pilot/batch1_min/stalls.csv` | 335 | LF | `0ffa613585d44b9bc65d399a36075f818cf982fabe4fd7187c8b66a1da50f4e3` |
| `tools/pilot/batch1_min/dishes.csv` | 1,964 | LF | `d4433e1fe3f24ebd66e8c0d53a0105a09f9d33e6227176a5fa2c15b2c08beac9` |

## 2. 修改前原文（逐字）

### 2.1 `shops.csv`

```csv
shop_id,shop_name,area,building,location,source_kind,source_detail,source_ref,collector,collect_date,evidence_file
c02,三餐,campus,第三餐厅,三餐 · 2 楼最西侧,field,2026-10-22 现场拍摄韩小面门头（招牌含「重庆风味」）与价目表；楼层由同一张照片可见，未单独拍楼层指引牌,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
```

### 2.2 `floors.csv`

```csv
shop_id,floor_id,floor_label,source_kind,source_detail,source_ref,collector,collect_date,evidence_file
c02,c02_f2,2 楼,field,楼层依据：窗口门头照可见该窗口位于三楼层的第二层（未单独拍指引牌，见待补清单）,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
```

### 2.3 `stalls.csv`

```csv
shop_id,floor_id,stall_id,stall_name,side,no_status,no,source_kind,source_detail,source_ref,collector,collect_date,evidence_file
c02,c02_f2,c02_t02,韩小面,west,unverified,,field,2026-10-22 现场拍摄韩小面价目表（含汤面 / 拌面 / 清汤 / 小吃四栏与店长提示）,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
```

### 2.4 `dishes.csv`（12 行菜品共用同一句描述）

```csv
dish_id,dish_name,record_type,shop_id,stall_id,price,food_type,tastes,source_kind,source_detail,source_ref,collector,collect_date,evidence_file
c02_d060,重庆小面（素）,菜品,c02,c02_t02,7,noodle,spicy,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d061,杂酱面（素）,菜品,c02,c02_t02,9,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d062,招牌豌杂面（素）,菜品,c02,c02_t02,11,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d063,酸菜面（素）,菜品,c02,c02_t02,8,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d064,牛肉面（荤）,菜品,c02,c02_t02,15,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d065,干拌小面（素）,菜品,c02,c02_t02,7,noodle,spicy,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d066,干拌杂酱面（素）,菜品,c02,c02_t02,9,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d067,干拌豌杂面（素）,菜品,c02,c02_t02,11,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d068,清汤小面,菜品,c02,c02_t02,7,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d069,清汤杂酱面,菜品,c02,c02_t02,9,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d070,清汤豌杂面,菜品,c02,c02_t02,11,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
c02_d071,麻酱凉面,菜品,c02,c02_t02,8,noodle,choice,field,2026-10-22 现场价目表抄录,,产品负责人,2026-10-22,img/c02_t02_menu.jpg
```

## 3. 证据实际支持什么（来自 `img/c02_t02_menu.jpg`）

| 维度 | 照片是否支持 | 本轮处置 |
|---|---|---|
| 菜品名称（12 条） | 支持（价目表逐条可见） | 不动 |
| 价格（12 条） | 支持 | 不动 |
| 招牌「韩小面」「重庆风味」 | 支持 | 写入 `source_detail` 的"可支持"部分 |
| 楼层（2 楼 / 第二层） | **不支持**（照片无楼层指引牌） | 只在 `source_detail` 标"未核实"，结构字段暂不动 |
| 餐厅名称（三餐 / 第三餐厅） | **不支持** | 同上 |
| 方位（最西侧 / west） | **不支持** | 同上（`stalls.no_status` 已为 `unverified`） |
| 辣度（spicy / choice） | **不支持**（价目表无辣度标识） | 不动 `tastes`，仅在 `source_detail` 标"辣度未核实（按品类推断）" |
| `（可拼）` | 照片有"（可拼）"，名称未写 | **不动名称**，口径问题留待负责人决定 |

## 4. 未解决的一项（需最小字段方案，本轮不实施）

`shop_name`、`building`、`location`、`floor_label`、`side` 这些**结构字段**仍在断言"三餐 / 第三餐厅 / 2 楼最西侧 / 2 楼 / west"，而证据不支持。现有字段无法表达"这个值是未核实占位"：

- `stalls.csv` 已有 `no_status`（档口号状态），但 `side` 没有对应状态列；
- `shops.csv`、`floors.csv` 完全没有状态列。

最小方案（待批准后实施）：沿用 `no_status` 的既有约定，在各表加一列 `<字段>_status`（取值 `unverified` / `verified` / `absent`），只覆盖上述 5 个字段，不新建表、不改 ID、不改导入契约。本轮不实施，避免自行扩大数据模型。
