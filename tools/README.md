# tools/ — 测试与校验脚本

本目录不属于小程序运行代码，**不会被编译进小程序**（`project.config.json` 未把它们加入 `packOptions.ignore`，但小程序只编译 `app.json` 里 `pages` 引用的文件与它们的依赖，`tools/` 不在依赖图里）。

## 运行环境

- Node.js（本机实测 v26.5.1）
- **零 npm 依赖**：只用 Node 内置的 `path` / `fs`
- 不需要微信开发者工具即可运行

## 当前有效的三套测试

### 0. `verify_provenance.js` —— 阶段 2 数据可信度专项（64 项）

```bash
node tools/verify_provenance.js
```

- 当前实测：**通过 64 项 / 失败 0 项**
- 覆盖：字段完整性（45 菜 / 12 店 / 7 楼层 / 24 窗口 = 88 条，逐条 source·verifyStatus·verifiedAt）、标记规则（全 demo、无伪造时间）、四层关联透传、最弱一环合成（含 expired 优先）、7 组边界用例（verified 缺时间降级、非法状态、demo 带时间清空等）、统计与摘要一致、页面绑定（WXML/WXSS/JS）、业务护栏（加字段前后筛选排序结果一致）。

### 1. `regression.js` —— 唯一质量门禁

```bash
node tools/regression.js
```

- 成功：退出码 `0`，末行 `全部通过（SKIP 项是尚未实现的功能，不代表已通过）`
- 失败：退出码 `1`，并打印失败清单
- 当前实测：**通过 101 项 / 失败 0 项 / 跳过 3 项**

覆盖范围：

| 组 | 内容 |
|---|---|
| R1 | 数据基线：45 菜 / 12 店 / id 唯一 / 每菜 1 个口味 / 8 类型非空 / 无孤儿菜品 |
| R2 | 筛选 AND 逻辑：**8784 种**条件组合与一份独立实现逐条比对，0 处不一致；7 个条件单独都真实生效；「校内+米线类+15 元」「校内+微辣+饭类」两道回归题 |
| R3 | 地点级联：区域→餐厅→楼层→窗口；换上级后下级重置；s05 无楼层时给提示；s12 档口不串店 |
| R4 | 随机选店：200 次全部落在合法店铺池内，店内菜品全属于匹配集合 |
| R5 | 随机选菜：3000 次无一次越界，池内每道菜都被抽到过（无偏） |
| R6 | 再抽一次：固定随机下能抽回同一家 / 同一道；真随机 400 次出现连续重复 |
| R7 | 换一家：300 次无一次返回当前店铺；只剩一家时 toast 且状态不变 |
| R8 | 三档排序：单调性、同集合、不污染 `this.matched`、改筛选后仍生效 |
| R9 | 条件摘要：区域/餐厅/楼层/预算/口味/类型逐段与真实状态一致 |
| R10 | 重置：8 个状态字段 + 计数 + 三级候选清空 |
| R11 | 空结果：构造 0 结果组合，三个按钮都只 toast、`mode` 不变、空态文案存在 |
| R12 | **未实现功能只登记 SKIP，绝不报 PASS**（清真 / 图片 / 评价 / 可信度字段） |
| R13 | 演示标识：12 家 location 全带「（演示位置）」、卡片与页脚声明、bindtap 全有实现 |

### 2. `verify_stage2.js` —— 阶段 2 专项套件

```bash
node tools/verify_stage2.js
```

- 当前实测：**通过 76 项 / 失败 0 项**
- 内容：数据规约、`applySort` 内核、四道回归题、排序不污染、演示标识全覆盖、WXML class 与 bindtap 一致性
- 与 `regression.js` 有部分重叠，保留它是因为它记录的是阶段 2 当时的验收口径，可作历史对照

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

## 这套脚本覆盖不到什么

- **不检查渲染**：换行、点击热区、首屏可见性、图片加载失败——必须用微信开发者工具或真机看
- **不模拟小程序运行时**：`Page` / `wx.showToast` 都是脚本里的替身，不覆盖真机的生命周期、setData 渲染时序、滚动行为
- **不覆盖未实现功能**：清真、图片、评价一律 SKIP
