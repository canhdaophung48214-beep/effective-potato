# R08 未转录菜单局部 · 独立验收报告

**验收人**：DSH　**时间**：2026-11-02 00:05　**对象**：`报告/R08_未转录菜单局部_20261101/`（分批候选交付第 8 批）
**方式**：只读；自写脚本复算（未复用交付方代码）；不改任何项目文件与交付物。

## 一、结论

| 层 | 裁决 |
|---|---|
| **本地证据抽取（10 图 OCR）** | **PASS** |
| **组件/加料关系生成** | **PASS**（2 主食组件 + 5 加料关系，独立菜品 0） |
| **独立菜品恢复** | **PENDING**（本轮未生成任何独立菜） |
| **正式准入** | **PENDING**（正式导入 0） |
| **整体** | **PASS（本地抽取层，0 P1 / 0 P2 / 3 P3）** |

## 二、独立复算（逐项）

| 项 | 声称 | 我复算 | 结果 |
|---|---|---|---|
| 源照片 | 10 | 10 张 `source_assets/*.jpg`，OCR 10/10 `OCR_COMPLETED` | 一致 |
| 主食组件候选 | 2 | 2（`recordKind=meal_component`、`independentDish=false`） | 一致 |
| 新增独立菜品 | 0 | 7 条记录中 `recordKind='dish'` 为 0、`independentDish=true` 为 0 | 一致 |
| 加料关系 | 5 | 5（加面 2/份、火腿片 2/份、酥油饼 2/份、忆米嘉火腿片 2、肥牛卷 5） | 一致 |
| 责任组 | 15 = 2+5+8 | `source_groups` 15：meal_component 2 / optional_surcharge 5 / unresolved_material_group 8 | 一致 |
| 台账 | NEW 7 / PENDING 8 | `source_ledger` 15 行，NEW 7、PENDING 8 | 一致 |
| 待核验材料组 | 8 | `unresolved.csv` 8 行，`blocked=true` 恰 8 | 一致 |
| 测试 | 19 | `test_r08.py` 19 PASS / 0 FAIL，exit 0 | 一致 |
| 清单哈希 | 37 | `manifest.sha256` 37/37，0 缺失 | 一致 |
| 项目保护 | 未改 | `project_before` 377/377；`closed_before` 227/227；`git_before == git_after`（`HEAD 274ebd6`、`main`、暂存 0、104/350） | 一致 |

## 三、证据链逐条（7 条记录全查）

对 2 条组件 + 5 条加料逐条核对 `evidence`：

- **照片哈希**：7/7 `photoSHA256` 与 `source_assets` 实际文件一致（如 `c03_t01_menu.jpg` `9b18a285…`、`c05_t01_menu.jpg` `24de8474…`）。
- **OCR 行号与引文**：7/7 声明的 `ocrLine` 与 `ocr_raw.json` 中该照片的 1-based 行号**完全对应**（如 `R08-C03-RICE-V1` 行 26、`R08-C05-HAM-ADD-V1` 行 27、`R08-C06-BEEF-ADD-V1` 行 28），`sourceQuote` 与该行文本逐字一致，`matchedText` 均能在 `sourceQuote` 内定位。
- **单位**：单县三项 `unitRaw="份"`（OCR 明写"2 元 / 份"）；忆米嘉两项 `unitRaw=null`（OCR 未给单位）——与报告"单位未明则为 null"一致。
- **隔离字段**：7/7 `formalDishId=null`、`floorRef=null`、`collector=null`、`captureDate=null`、`verifyStatus=unverified`、`verifiedAt=null`、`currentPriceValidity=UNKNOWN`、`transactionQuoteAllowed=false`、`tastes=[]`、`recordKind≠dish`。
- **计价一致**：5 条加料的 `amount` 与 `additionalPriceYuan` 逐条相等，无双重计价。

## 四、边界与不变量

- **不冒充主菜**：`candidates.json` 仅 2 条 `meal_component`，无 `dish`；台账"改写/替换/作废"0/0/0；`formalImports=0`。
- **不继承身份**：`stallRef` 全部为 `R08-UNLOCATED-c*_t01`（本地名称关联），未使用 `c03`/`c10` 冻结映射。
- **不硬绑基础菜**：加料 `baseCandidateRef=null`、`selectionConstraints=null`（报告所述"特定基础菜/多选/组合 UNKNOWN"成立）。
- **OCR 不冒充人工**：7 条 `recognitionMethod="Windows.Media.Ocr local; no cloud"`、`visualReconfirmation=false`；未发现按常识纠字替换原文的动作。
- **R03–R07 不变**：`closed_before` 227 条文件逐条哈希全等；R07 的 P3 未被返工修改。
- **正式文件**：`id-map`/契约/审批/`data/` 未变；未触云、未部署、未导入。

## 五、P3 观察项（不影响本轮关闭）

1. **同名组件无同名字段**：两条候选均名「米饭」，`stallRef` 分别为 `c03_t01`/`c10_t01`，但记录无 `sameNameGroup`/`differentStalls` 标记（R05/R06 有 crosscheck 表），下游若按名称合并会误并两个档口的米饭。
2. **OCR 原始文本保留误字但无逐行标记**：`ocr_raw.json` 中可见 `L77 元 /50g`（应为 1.77）、`米 饭 1 元 兔 费 续` 等识别错误；本批未据此生成价格（正确），但 `ocr_raw.json` 没有 confidence/异常行标注，后续复用需人工先筛查。
3. **`photo_coverage.json` 为数组下标映射**（键 `0`–`9`），非按照片键的对象；与交付物其余"按 photoKey 命名"的习惯不一致，机器消费需按顺序推断。

## 六、边界声明

- 只读验收：未修改 `项目/` 与 `报告/R08…/` 任何文件；未 Git 写；未触云。
- 复算脚本仅写入 `%TEMP%\r08v\verify.js`。
- 本报告哈希见交付消息。

## 七、答复

1. **R08 本地抽取 PASS？** 是：10 图 OCR、2 组件、5 加料、8 待核验、19 测试、37 哈希全部可复算。
2. **独立菜品恢复？** PENDING：本轮 0 条独立菜，报告未冒充。
3. **正式准入？** 不具备：需负责人先定组件/加料是否入正式菜谱、未定位档口命名、OCR 局部补证。
4. **可关闭 R08？** 可关闭本地抽取层；独立菜品恢复与正式准入保留 PENDING。