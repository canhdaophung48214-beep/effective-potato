from pathlib import Path
import json,hashlib,datetime,csv,collections
R=Path.cwd();P=R/'项目';O=R/'报告';E=O/'R01_E2_20261101_evidence'
def rd(p):return Path(p).read_text(encoding='utf-8-sig')
def j(p):return json.loads(rd(p))
def meta(p):
 p=Path(p);b=p.read_bytes();s=p.stat();return {'path':str(p.resolve()),'relativePath':p.relative_to(R).as_posix(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'createdAt':datetime.datetime.fromtimestamp(s.st_ctime,datetime.timezone(datetime.timedelta(hours=8))).isoformat(),'modifiedAt':datetime.datetime.fromtimestamp(s.st_mtime,datetime.timezone(datetime.timedelta(hours=8))).isoformat()}
def write(p,text):
 with Path(p).open('x',encoding='utf-8',newline='\n') as f:f.write(text)
st=j(E/'statistics.json');before=j(E/'git_before.json');after=j(E/'git_after.json');ro=j(E/'readonly_check.json');tests=j(E/'test_results_final.json')
used=[('项目/tools/pilot/TRANSCRIPTION_2F.md','L2','逐条原文定位；153/158/368-372/426/683；类别栏目详见逐条CSV'),('项目/tools/pilot/TRANSCRIPTION_3F.md','L2','19-23证据边界；316风味选项；364锅底选项；逐条源行'),('项目/tools/pilot/TRANSCRIPTION_DRAFT.md','L2','1-5草案、用户概括性口述；不外推至525源条目'),('项目/docs/RECORD_GENERATOR_CONTRACT_20261023.md','L1_RULE','332、387、408、431-506、1042、1081-1088'),('项目/tools/pilot/gen_records.js','L3','612-744内存只读构建；968-970套餐；1042-1045列映射；2300-2360字段适配'),('项目/data/index.js','L3','38-45口味标签；53-62类型标签；ALL_DISHES运行时45'),('项目/data/dishes.js','L3','正式45条演示数据，模块直接读取'),('项目/data/provenance.js','L3','normalizeMeta/decorate来源与核实状态，非菜品类型/口味原始证据'),('项目/tools/verify_data.js','L3','343-358 D6/D7；validateDataset离线边界实测'),('项目/tools/import_data.js','L3','617-630 CSV字段映射，未执行正式导入'),('项目/tools/pilot/build_pilot_dataset.js','L3','144-158口味解析与0..1验证，未执行--write'),('项目/tools/verify_provenance.js','L3','本轮116项只读来源校验'),('项目/docs/B1_OWNER_CONFIRMATION_SUPPLEMENT_20261026.md','L1_RECORDED_USER','65-96 c02韩小面确认；身份不属于本轮c01记录'),('项目/docs/B1_COMPLETE_REPORT_20261027.md','L4','81用户确认的记录汇总；不跨店搬用'),('项目/docs/decisions/DECISION_RECORD_2F09_VERIFY_20261025.md','L1_RECORDED_USER','蛋字/档口确认，不等于tastes辣度确认'),('项目/evidence/PHOTO_MANIFEST_20261025.csv','L2_INDEX','35项/34唯一照片，逐文件存在性与哈希复算'),('项目/evidence/EVIDENCE_INDEX_20261025.md','L4','照片编号与3F偏移歧义；不是本轮视觉复核'),('报告/R01_20261031/R02_裁定与注记_20261101.md','L1_RULE','12/27-32维持不授权正式写入；此次候选报告不改变裁决'),('报告/R01_20261031/R03_D_tastes校验对齐_20261101.md','L4','历史改动描述，以当前verify_data.js实测为准'),('报告/DSH_R03-D_独立验收_20261101.md','L4','历史独立审查，以本轮结果为准'),('报告/DSH_R01_E2R1_独立验收_20261031.md','L4','纠正楼层按ID号段推断；不沿用旧分类计数'),('报告/R01_20261031/Codex_R01_E2_证据恢复分析_20261031.md','L4','历史A10/B120/D30口径对比，未作为字段赋值来源')]
for f,_,_ in used:assert (R/f).exists(),f
sources=[dict(meta(R/f),evidenceLevel=l,inspectionLocation=n) for f,l,n in used]
outs=['R01_E2_tastes_inventory.csv','R01_E2_foodType_inventory.csv','R01_E2_recovery_candidates.csv','R01_E2_unresolved.csv']
manifest={'task':'R01-E2','reportDate':'2026-11-01','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':st['scope'],'method':'Current generator run({mode:dry-run}) only; 490 generated records + 35 not_generated blocker rows. No --write. Report snapshots are not publication products.','statistics':st,'evidenceLevels':{'L1_RULE':'已记录的项目契约/负责人裁决，不是本轮新授权','L1_RECORDED_USER':'文件中保留的用户确认，不跨菜品身份复用','L2':'仓库转录稿直接文本证据，未重看原图','L3':'本轮当前字节/离线执行证明','L4':'历史辅助材料，不能替代源证据'},'classificationPolicy':{'A':'明确字段证据与当前枚举精确对应；仅可提出候选，不等于正式写入/准入','B':'有原始括注/选项/分组线索，但语义、适用范围或映射未确认，proposedValue为空','C':'无可靠字段证据；不按菜名、常识或同名记录猜测'},'sources':sources,'csvSources':j(E/'csv_source_catalogue.json'),'photoEvidence':j(E/'photo_checks.json'),'projectBaseline':{'path':str((E/'project_before.json').resolve()),'sha256':meta(E/'project_before.json')['sha256'],'count':376},'outputCsvFiles':[meta(O/n) for n in outs],'checks':{'independentTest':'15 PASS / 0 FAIL','commands':tests,'readonly':ro,'sameNameGroups':'R01_E2_20261101_evidence/same_name_groups.json','missingIntersection':'R01_E2_20261101_evidence/missing_intersection.csv','coverage':'R01_E2_20261101_evidence/record_coverage_525.csv'},'limitations':['照片OCR/视觉复核PENDING：无注册视觉工具，照片仅哈希核验。','35项not_generated没有正式dishId或生成字段，不能假装为35条有效数据。','当前foodType候选值0；菜单分组仍需明确映射依据，不把缺授权误写为用户拒绝此类数据。','所有490条正式tastes保持[]；2条仅候选。','来源与字段证据不构成准入、发布、核实状态提升。'],'selfHashLocation':'R01_E2_20261101_evidence/final_artifacts_manifest.json'}
write(O/'R01_E2_evidence_manifest.json',json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
meta_rows='\n'.join('| '+m['relativePath']+' | '+str(m['bytes'])+' | `'+m['sha256']+'` |' for m in [meta(O/n) for n in outs+['R01_E2_evidence_manifest.json']])
cmdrows='\n'.join('| '+(x['command'].replace(str(E),'报告/R01_E2_20261101_evidence'))+' | '+str(x['exitCode'])+' | '+['15 PASS / 0 FAIL（检查组）','122 PASS / 0 FAIL','243 PASS / 0 FAIL','45菜品无错误（校验命令非测试计数）','116 PASS / 0 FAIL','无空白差异错误；既有CRLF提示'][i]+' | '+x['log']+' |' for i,x in enumerate(tests))
datahash='\n'.join('| '+x['path']+' | '+str(x['bytes'])+' | `'+x['sha256']+'` | 相同 |' for x in ro['protectedData'])
report=f'''# R01-E2 菜品数据溯源与缺失字段恢复

日期：2026-11-01（Asia/Shanghai）。执行：Codex；待 DSH 独立审查。

**本地盘点与候选文件验收 PASS；完整原图复核与缺失字段业务恢复 PENDING。** 未改正式数据。当前可靠的字段候选仅两条 tastes；没有可靠的 foodType 填充值。不能把“清单生成成功”解释为缺失数据已经恢复。

## 1. 先纠正统计对象

当前实际源码在 `项目/tools/pilot/gen_records.js:612-744` 通过 `run({{mode:'dry-run'}})` 只读构建，退出 0。未运行 --write/init/import。

| 层次 | 本轮数量 | 含义 |
|---|---:|---|
| `data/index.js` 的 ALL_DISHES | 45 | 全部演示菜品；tastes空数组0、foodType缺失0 |
| 生成器 recordsDoc.records | 490 | 实际生成的候选记录；全部仍 blocked |
| blockers 中 not_generated | 35 | 未生成源条目，dishId 未分配，字段不可伪装成 []/null |
| 源条目总口径 | 525 | 490+35，而非525条正式 data 菜品 |

本轮490条与旧 `_raw/records.json` 按对象深比较一致；统计由当前生成器重算，旧报告仅用于对照。`record_coverage_525.csv` 覆盖全部525源条目，35条明确标记 NOT_GENERATED，使用原始 recordKey 定位，不捏造 dishId。字段库存只统计490条有生成字段的记录。

## 2. 缺失集合与分类

| 集合 | 数量 |
|---|---:|
| tastes=[] | 490 |
| foodType=null/缺失 | 368 |
| 两字段交集 | 368 |
| 仅 tastes 缺失 | 122 |
| 仅 foodType 缺失 | 0 |
| 去重并集 | 490 |
| 待判断字段总项 | 858 |

交集逐条保存在 `R01_E2_20261101_evidence/missing_intersection.csv`。现有122条非空 foodType 保留；不据ID号段推断楼层。

| 字段 | A：可提出精确候选 | B：有部分证据待确认 | C：无可靠字段证据 | 总计 |
|---|---:|---:|---:|---:|
| tastes | 2 | 40 | 448 | 490 |
| foodType | 0 | 163 | 205 | 368 |

分类 A/B/C 是**本轮字段证据等级**，不同于生成器的 tier A/C。冲突用 conflictStatus 表达，不增加第四个分类。

直接回答：

- 原490条空 tastes 中，**2条**有精确转录文字可提出 `["mild_spicy"]`。剩余 **488条**继续未知（40待确认、448无可靠字段证据）。本轮没有正式写入，所以正式候选源的490个数组仍全部为[]。
- 原368条缺 foodType 中，**0条**达到本轮可靠直接恢复标准；163条有菜单栏目线索，205条无足够字段证据，均保持null。163条不是凭菜名做的词法推测，具体标题和行号逐条存于CSV；菜单栏目到枚举的适用范围/映射尚待确认。
- 两字段需确认的B项 **203项**，涉及 **186道菜品**，两字段都为B的17条。另有 **73条组合/并列源行**需区分变体范围，可能包含B或C，不与203重复相加，也不把并列品种自动认定为“辣/不辣冲突”。
- **0道菜品**能在本轮候选应用后形成“两字段都有可信非空值”的完整候选：两条有口味证据的菜品，其foodType仍未知。若“完整”还包含正式ID准入、照片、verifyStatus等，亦不满足，未作任何放行。

## 3. 两条可提出的口味候选

| dishId | 店/档口 | 菜名 | 规格 | 原值 | 候选值 | 证据 |
|---|---|---|---|---|---|---|
| c01_d256 | c01 服务楼 / c01_t28 四有青年面馆 | 素椒炸酱面（微辣） | 小碗 | [] | ["mild_spicy"] | `项目/tools/pilot/TRANSCRIPTION_2F.md:370` |
| c01_d257 | 同上 | 同上 | 大碗 | [] | ["mild_spicy"] | 同一源行的不同规格列 |

源行：`| 素椒炸酱面（微辣） | 11 元 | 11.9 元 |`。字段枚举证据 `项目/data/index.js:38-45` 的 mild_spicy 标签为“微辣”。身份关联来自当前生成器 sourceLine、specLabel、dishId 和契约名册 c01_t28；不合并双规格。

A 表示可信转录字面与枚举一致，**不表示本轮重新看过原图，更不表示已核实或已授权正式写入**。当前负责人文档 `报告/R01_20261031/R02_裁定与注记_20261101.md:12,27-32` 仍不授权扩源落盘；本轮新授权只允许候选报告。

## 4. 为什么不沿用旧“10条可恢复”

旧分析 `报告/R01_20261031/Codex_R01_E2_证据恢复分析_20261031.md` 把8条非等价映射也列为A。当前任务要求不得推测，故重新分类而不修改历史报告：

| 原文 | 涉及记录 | 结论 |
|---|---|---|
| （辣） | c01_d075 / d080，2F:153/158 | “辣”不严格等于spicy标签“麻辣”，B，无候选值 |
| （辣度适中） | c01_d252 / d253，2F:368 | 不严格等于“微辣”，B，无候选值 |
| （香而不辣） | c01_d254 / d255，2F:369 | 不辣不等于清淡，B，无候选值 |
| （不辣） | c01_d260 / d261，2F:372 | 同上，B，无候选值 |
| （微辣） | c01_d256 / d257，2F:370 | 精确对应，A，两条候选 |

其余32条 tastes B：W2-08段末口味选项作用域不明22条（2F:426）；组合行部分变体括注微辣1条（2F:683）；烧饼六种风味不等于可选辣度4条（3F:316）；“原味”无对应辣度枚举1条（3F:322）；火锅三种锅底不直接等于可选辣度4条（3F:364）。8+32=40。

旧报告的菜名关键词、同名类推、把风味选项变成choice等推测均不作为候选值。本轮未批准任何新词法映射。B/C proposedValue 一律空，C 的证据位置说明“已检查该源行但未发现可靠字段证据”，不伪装成值的支持证据。

## 5. 来源核查范围与证据等级

- **L1：已记录的负责人确认/契约。** 检查2F/3F转录稿用户决策、W2-04确认、B1用户确认补充、R02裁定。B1中c02韩小面的确认不能移植到c01同名菜；W2-04“蛋”字确认不是辣度确认。
- **L2：现有可信转录稿。** 两份转录稿每条源行及相关栏目逐项定位；全部858字段项均带原文、文件SHA、行号、dishId、店/档口、规格。
- **原始照片：** 35清单项、34唯一归档文件，存在性与SHA全部相符。本轮无注册视觉工具，未进行OCR/视觉复核，**PENDING**。照片归档的存在不能证明转录百分百正确；3F导览/门头/映射歧义仍保留，见3F:19-23及证据索引。
- **CSV：** 枚举33份当前/历史/模板/报告CSV，记录表头、条数、SHA。只有8份具备完整菜品身份字段可参与严格身份比对，25份为其它结构（商家/档口/楼层表或分析报告），未拿来强行做菜品匹配。12个完整匹配均来自历史预览派生件，独立原始来源匹配0。未发现实际同ID身份冲突。
- **同名异菜：** 38个同名组，其中10组跨档口，保留每个dishId、规格、价格和源行，详情 `same_name_groups.json`。名称绝不是恢复连接键。
- **工具：** 检查生成器内存路径、列类型映射 `gen_records.js:1042-1045` 与套餐例外 `:968-970`、适配器 `:2300-2360`；正式校验 D6/D7 `verify_data.js:343-358`；CSV解析 `import_data.js:617-630`；构建校验 `build_pilot_dataset.js:144-158`；provenance 的来源/核实状态逻辑。provenance 装饰器不提供缺失口味或类型事实。

现有非空foodType来源的授权范围不能被默默扩展：契约列映射及 `§6.1.1:1081-1088` 套餐例外保持不变。尤其“米线”的现有列映射为rice_vermicelli，不能简单按字面用rice_noodle替代。163条菜单分组线索只进入B，保留具体原文等待映射/范围确认。

## 6. 自动验收与真实输出

使用 verification-before-completion 流程；测试日志均为本轮新运行。未修改/削弱任何现有测试。

| 命令 | 退出码 | 结果 | 原始日志（证据目录） |
|---|---:|---|---|
{cmdrows}

独立15组检查覆盖：525源条目全覆盖、490非空dishId唯一、35未分配不造号、两个缺失集合及交集、858字段唯一与原值一致、A/B/C守恒、文件存在/行号/原文/哈希、候选枚举、B/C无填值、不辣等未被默认赋值、当前R03-D空数组/合法单值通过与多值/未知值/null拒绝、内存应用只改2个tastes字段、同名分离、照片文件哈希、全部376个项目文件字节不变。

**R03-D口径 PASS：** `tastes=[]`合法；两个候选为合法单元素数组。当前校验器非数组错误消息仍写“单元素”（verify_data.js:352）是既有文案问题，本轮未改，也不把490个空数组列为490个错误。

运行过程中先读导出接口时曾尝试不存在的内部buildInitPlanRecords，得到TypeError，随后改用公开run(dry-run)，未改源码；一次辅助统计使用Python默认GBK读UTF-8失败，改用显式UTF-8重读。均为探测命令错误，不计为测试通过。

首版CSV目录盘点把分析报告缺少身份列误计成冲突，自检后已修正。旧输出/脚本保留在 `pre_catalogue_review/`，最终 `csv_id_collisions.json=[]`。正式结果只用 `test_results_final.json` / `test_1_final.log`。其余5项测试未受该报告脚本修正影响，原输出保留。

## 7. 交付与哈希

4份CSV为UTF-8 BOM + CRLF，JSON/Markdown为UTF-8；CSV值使用JSON字符串保持[]/null区别。candidate只有2条、unresolved856字段项，B/C不制造候选值。

| 文件 | 字节数 | SHA-256 |
|---|---:|---|
{meta_rows}

本报告自身及全部新增证据文件的绝对路径、大小、SHA-256、创建/修改时间，在 `R01_E2_20261101_evidence/final_artifacts_manifest.json` 最终记录，避免报告自引用哈希。证据清单自身哈希也在那里。`R01_E2_evidence_manifest.json` 包含输入源文件哈希、CSV目录、照片检查、规则、统计与验收结果。

额外文件包括：525覆盖表、368交集表、当前490记录/525 blockers的报告快照、同名组、CSV身份比对、检查脚本与原始日志、Git前后状态、376文件基线。报告快照不是正式发布产物，未生成COMMITTED标记或正式CSV。

## 8. 只读自审与副作用

HEAD `{before['head'].strip()}`，分支 `{before['branch'].strip()}`。前后暂存区均空；status -uall均350条（15已跟踪修改、335未跟踪），逐字一致。376个可见项目文件前后字节/SHA一致；项目新增0、修改0。本轮输出全部位于仓库外报告目录。

- 本轮项目精确diff：**空**。`project_existing_diff.patch` 是既有未提交工作，不是本轮改动；其边界由全文件哈希及git前后状态证明。
- 无Git写操作；无云端调用/部署；无正式数据导入；未改id-map、审批、verifyStatus、契约、生成器或冻结测试。
- 项目原文件无需回滚；如不采纳候选，保留正式数据即可。没有原文件被覆盖，故没有伪造“修改前备份”；`project_before.json` 是哈希基线，不是原始字节备份。自检前草稿副本有明确中间版本目录。
- 根及项目目录未找到 `.baton/task.md`、`handoff/current.md`、`PROTOCOL.md`；本报告承担本轮交付说明，未创建或覆盖未知接力状态。

| 正式数据文件 | 字节 | 修改前SHA-256 | 修改后 |
|---|---:|---|---|
{datahash}

## 9. 最终状态与DSH复核点

| 项目 | 状态 | 范围 |
|---|---|---|
| 当前数量/交集/525覆盖 | PASS | 当前源码内存构建，35未生成单列 |
| 490已生成ID唯一 | PASS | 35未分配ID仍PENDING，不伪造ID |
| A/B/C证据清单与候选文件 | PASS | A2、B203、C653，858项守恒 |
| R03-D合法性与正式数据不变 | PASS | 6条最终验证命令退出0；原始日志可查 |
| 全量原图视觉复核 | PENDING | 当前无视觉工具；有归档及哈希不能替代看图 |
| 40 tastes /163 foodType的语义或范围确认 | PENDING | 不自行裁决，不生成无依据值 |
| 448 tastes /205 foodType的补证 | PENDING | C不是永远无法恢复，只是本轮可用材料不足 |
| 35未生成条目及发布准入 | PENDING | 不属于本轮授权，保持既有阻塞 |
| 正式恢复/导入 | 未执行 | 用户明确禁止 |

请DSH重点复核：两条微辣候选原文及规格关联；B的栏目作用域是否足够；未把菜名关键词计为证据；35未生成与490有效候选的分母；CSV不同表头不产生假冲突；全部正式文件哈希未变。完成交付后停止，等待独立审查。
'''
write(O/'Codex_R01_E2_数据溯源与恢复报告.md',report)
files=[O/n for n in outs+['R01_E2_evidence_manifest.json','Codex_R01_E2_数据溯源与恢复报告.md']]+sorted(x for x in E.rglob('*') if x.is_file())
write(E/'final_artifacts_manifest.json',json.dumps({'reportDate':'2026-11-01','files':[meta(x) for x in files],'note':'Manifest自身不自引用；项目原文件0修改。'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'reportBytes':(O/'Codex_R01_E2_数据溯源与恢复报告.md').stat().st_size,'artifactCount':len(files),'requiredFiles':6}))
