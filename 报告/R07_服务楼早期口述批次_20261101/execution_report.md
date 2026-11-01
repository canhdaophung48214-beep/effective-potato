# R07 服务楼早期口述批次执行报告

本地隔离整理 PASS；正式准入 PENDING；本轮待DSH独立验收。证据等级明确为口述历史候选，不能等同照片直接核验。

## 实际来源与范围

没有找到既有R07执行计划，采用真实文件TRANSCRIPTION_DRAFT.md §1.1—1.3的服务楼三个窗口，batch1/dishes.csv交叉核对39条旧记录。源稿明确服务楼为“用户口述整理”；三张对应菜单照在既有待补照片清单中尚缺，本轮不借用其他档口照片。c01_service_2f只有空CSV与采集模板，不是新实采数据。

复用gen_records.js __test__.parseDoc只读解析器。新建隔离生成脚本，不改正式生成器/数据/契约。source_assets保留原始字节及可定位行，before备份位于项目外，详见backup_manifest.json。

## 数量复算

| 指标 | 数量 |
|---|---:|
| 物理源行 |43|
| 菜品表格源行 |39|
| 加料物理源行 / 展开选项 |3 / 24|
| 未标价物理行 / 展开项 |1 / 4|
| 主批源组 |67|
| 菜品候选 / 候选源组 |38 / 38|
| 加料关系 |24|
| 阻断源组 |5|
| 已生成候选的非阻断证据缺口 |38|
| unresolved.csv行数 |43|
| 旧责任：保留 / 待核验 |38 / 1|
| 旧记录替换 / 作废 |0 / 0|
| 新增责任源组 |28|
| 显式规格变体 |0|
| 正式ID分配 / 正式导入 |0 / 0|

67=38候选源组+24加料源组+5阻断源组。新增28责任是24加料+4无价项，不是28道新菜。43物理行不是43道菜。台账必须合并newSourceRefs与optionRefs，后者覆盖24选项。月亮馍的加蛋白名称是源文本既有整份商品表达，不是推导新规格；没有生成虚构基础价或选择组。

候选按三档口分布8/7/23。1条“月亮馍（+辣条）”在源稿待确认清单被明确质疑，未生成；朱家小馆筋头巴脑/卤鸡腿/兰花干/卤干豆腐4条无价，不以同名面品价格补齐。

## 数据与身份保护

每条候选保留USER_ORAL_TRANSCRIPT、sourceQuote、sourceLine、oldRecordKeys；photoEvidence=null且photoStatus=NOT_ARCHIVED_FOR_THIS_STALL。价格是来源口述历史标价，不是当前报价；currentPriceValidity=UNKNOWN，transactionQuoteAllowed=false。tastes=[]，collector/captureDate/unitRaw/specification/composition未知为null。

正式ID不继承。早期c01_t01/t02/t03仅追溯，不按后来W2/T编号直接嫁接。新旧名称只在同一旧档口及同价前提下对照“加”和“+”书写差异，源名不改，旧CSV原字节不改。same_name_crosscheck.csv记录其他已关闭批次同名碰撞，名称相同不等于同一物理档口。38是新增来源责任候选数，不能称为38道已证明与全校绝对不同的独立菜。

加料按源“各1/各2.5”等明确价组展开24项，保留源行；仅关联档口，baseCandidateRef=null，组合选择规则未知，不生成24道独立菜。卤蛋/猪排等元/个或元/片只在源文明确时保留，其他单位未知。

## 连续推进与材料去向

完成R07主批后继续整理剩余采集说明7项材料责任，见remaining_source_pool.json、remaining_materials.md。额外保存1条“炸金针菇1元”加料文本关系预览于supplemental_relationships.json；这是另一来源的补充关系，不混入主批67源组或38菜品。2类称重规则、遮挡推荐区、不完整加料清单不能直接生成固定价菜品。兰州重复牌行已由旧采集去重，不重复生成。

R03—R06已有416条与本轮38条来源候选合计454条；其中R07尚待独立验收，454不是正式准入数，也不是跨全校物理菜品去重承诺。现有明确转录/CSV输入均已标明批次去向；尚不能宣称照片全部像素中的潜在未转录条目已经穷尽。剩余问题是具体证据缺口，不通过空建R08冒充进展。区域划分冻结，已延期元数据不再询问。

## 实际测试与技术修复

node capture.js：exit0。首次build_r07.py因旧CSV“加”与源“+”书写不同出现StopIteration，未产生候选；修正仅限同档口、价格一致的名称对照后重跑exit0，完整成功输出见build_output.txt。失败未改变正式项目；失败时的来源副本另存项目外，未覆旧备份。

python -X utf8 test_r07.py：24 PASS / 0 FAIL / 0 SKIP，exit0，完整test_output.txt。包含10种负向变异：改价、旧ID继承、伪造日期、伪造照片、猜口味、开放报价、重复、加料独立菜、猜组成、跨档口。其余检查源行、数量守恒、加料统计、未标价隔离、同名不合并。连续整理补充3项断言通过，continuation_test_output.txt保存结果（来源行7项、补充关系价义、称重/残缺不虚构菜品）。

git diff --check exit0，仅既有project.config.json CRLF提示。未重跑无关历史测试。project_before/closed_before逐文件核对正式项目与R03-R06字节未变；git_before==git_after，分支/HEAD/暂存/工作区状态一致。没有正式导入器或严格准入PASS主张。

## 交付与边界

candidates.json、source_groups.json、source_ledger.csv/json、unresolved.csv、optional_surcharges.json、stall_crosswalk.csv、same_name_crosscheck.csv、补充材料池、工具、原始输出、before备份索引与SHA清单均落盘。diff.patch只覆盖明确列出的新建文本产物，不含源证据副本、也不作为git apply补丁；完整file_manifest与manifest.sha256覆盖交付。没有被改写的生产文件，不伪造“修改前生产差异”。

PASS：38候选实际生成；39旧责任完整；24关系不冒充菜；5阻断不造价；正文源可定位；已验收批次及正式项目未改。

PENDING：口述候选独立菜单照片、1条既有业务疑问、4条无价项、剩余照片局部/不完整列表、正式准入。采集元数据继续延期。已正式导入=0。

未触云、未部署、未建索引、未Git写操作、未修改区域字段/正式ID/审批/契约。请DSH重点审口述证据等级、同档口名称对照、24选项各价映射及累计454的来源口径。
