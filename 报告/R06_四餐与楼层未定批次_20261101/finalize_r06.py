import pathlib,json,hashlib,difflib,collections
E=pathlib.Path(__file__).parent.resolve()
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
s=J('statistics.json');C=J('candidates.json')
report='''# R06 本地隔离候选生成与验收

状态：本地生成/来源覆盖/字段保护 PASS；正式准入 PENDING。本轮完成实际候选，不执行正式导入。

## 实际成果及分母

| 指标 | 数量 |
|---|---:|
| 本轮原始源记录 |142|
| 四餐二楼转录表行 |10|
| 楼层未定批次旧CSV行 |132|
| 成功生成候选 |140|
| 四餐候选 |8|
| 楼层未定候选 |132|
| 阻断候选的待核验源记录 |2|
| 不阻断候选的字段级待核验 |132|
| unresolved.csv行数 |134|
| 旧记录责任 |140|
| 旧记录保留 / 替换 / 作废 |140 / 0 / 0|
| 新增源责任 |2|
| 显式规格变体 |0|
| 新分配正式ID / 正式导入 |0 / 0|

142源记录=140候选+2姓名疑义待核验。134条unresolved并不表示134条记录不能生成：其中132是已经生成候选的字段级缺口，只有2条菜名疑字阻断生成。新责任2条是旧batch1没有生成的转录源行，不是新增2道正式菜。

本轮物理行分母为四餐10条转录菜单表行+未定位CSV132条数据行；不把整份转录其他楼层、9商家元数据行、加料/称重经营说明纳入142个菜品源记录。源组142，候选源组140、候选记录140；显式规格数0，没有将它们混为同一概念。

## 直接生成与证据链

复用正式gen_records.js的__test__.parseDoc读取TRANSCRIPTION_DRAFT.md，capture.js保留实际调用；只截取§3.1四餐表。10条原文保留，⚠泰式咖喱鸡及⚠春浓茄丁有名称疑义，留在unresolved，不凭同名菜补字。其余8条与batch1原名原价对照后生成。

楼层未定批次直接逐行读取c03_offsite_batch2/dishes.csv的132条既有采集记录，每条保留CSV原文、行号、旧ID（仅追溯）、价钱和其evidence_file对应菜单照片。采集说明§二提供店铺↔照片解释；本轮未重复OCR或宣称新完成逐图视觉审计。证据等级是已有采集记录与明确归档照片关联，不把SHA校验说成照片语义重新验真。

源文件、旧CSV、档口/商家/楼层元数据、采集说明与11张照片全部字节快照，见source_assets；backup_manifest记录项目外before备份及原始SHA。未改任何源材料。

## 不让未知字段拖住候选

132条floorRef=null，未全部归入四餐。它们的档口只按现有采集CSV明确关系保存，使用R06-UNLOCATED前缀。旧batch1:c03_t01为四餐卤大姨，offsite_batch2:c03_t01为味爱特，严格分批命名空间，未按c03字符串合并。

132条旧tastes有choice占位及按菜名推辣，原始值保存在source_groups.json，仅作为历史声明；候选tastes=[]，不把推断改写成事实。旧food_type也逐条保留为originalFoodType，候选foodType=null，未验证的技术类型映射不冒称照片明示。四餐原转录明确类型列仍保留。captureDate与collector继续null，原CSV声明值仅在源组保存，未默认继承为真实拍摄日期/人。

所有候选formalDishId=null、verifyStatus=unverified、verifiedAt=null，currentPriceValidity=UNKNOWN、transactionQuoteAllowed=false。未知单位、规格和套餐composition均为null。历史“套餐”源名保留并标recordKind=bundle，不由菜名推导组成；没有把未收录加料补成独立菜品。relationship_data.json明确本轮未转录加料、称重店及遮挡价项；这部分不是142个逐记录范围的已解决事项。

### 区域冻结

区域划分登记为后续待办，本轮不研究或更改区域命名/枚举/UI；旧源文字、旧区域列只在原字节快照保留，不按其措辞新建标准区域字段。不对R03/R04/R05做区域专项检查，不因区域未知拦截候选。

## 档口分布（不推断楼层）

'''
report+='\n| 本地档口 | 候选数 |\n|---|---:|\n'+''.join('|'+k+'|'+str(v)+'|\n' for k,v in s['candidateStallDistribution'].items())
report+='''
味爱特、航语佳两家源元数据存在，但旧批次没有固定单价菜品，本轮不创造候选。名称、旧档口及所属批次见stall_crosswalk.csv；父级身份仍PENDING。9家未定位商家不会因为素材量大就被视作同一楼层。

## 测试和实际命令

- node 报告/R06_四餐与楼层未定批次_20261101/capture.js：exit 0，复用解析器。
- python -X utf8 报告/R06_四餐与楼层未定批次_20261101/build_r06.py：exit 0，完整生成统计见build_output.txt。
- python -X utf8 报告/R06_四餐与楼层未定批次_20261101/test_r06.py：26 PASS / 0 FAIL / 0 SKIP，exit 0，完整输出test_output.txt。
- git diff --check：exit 0；仅既有project.config.json CRLF转换提示，没有为消提示改写文件。

测试独立读取输出与原始CSV/转录，校验候选ID、源记录守恒、价格/源行、照片SHA及档口映射、c03跨批次冲突、未知楼层保留、套餐与加料边界。10类负向篡改（改价、伪造菜名、旧ID继承、伪造日期、猜口味、开放报价、重复、强挂楼层、混用c03、编造组成）均被相同校验拒绝。

没有改正式代码，因此未重跑R03/R04/R05历史套件；以各文件字节指纹验证其成果未改。没有运行或声称通过正式导入器/严格准入，此批不是正式上传文件。

## 备份、差异与哈希

所有文件新建在本R06目录。backup_manifest.json列出项目外独立目录、原路径、快照路径、大小和SHA，逐字节验证。原项目没有被修改；不拿新候选冒充改前原件。diff.patch是明确列出的新工具、数据、台账、关系与报告相对空文件的unified diff，不代表整个证据包、不用于git apply。照片及源快照用完整file_manifest.json和manifest.sha256验证，不塞进文本差异。

project_before.json核验所有既有项目文件未变；closed_before.json核验R03/R04/R05所有既有交付未变（仅指纹比较，不重新审查内容）。git_before.json与git_after.json的HEAD、分支、暂存、完整工作区状态一致。未Git写操作，保留既有修改及未跟踪内容。

验收规范沿用verification-before-completion：本轮实际命令和输出为证据，不借用旧测试数字。交付清单覆盖工具、候选、台账、待核验、测试输出及源快照；file_manifest与manifest自身按无循环方式排除自引用。

## 最终自审

PASS：140隔离候选实际落盘；142源记录全覆盖；132未定位记录保留未知楼层而正常生成；2条疑字不造假；10类负向保护有效；备份和SHA完整；正式项目及已关闭批次未变。

PENDING：两条名称疑义；楼层未定132条的楼层/技术类型/口味；父级正式签发、延期采集元数据、当前价格及正式准入。原采集说明提及但未逐菜录入的称重品、遮挡价及加料仍是来源范围外的后续采集事项。

区域划分整体延期，不要求本轮负责人裁决。未正式导入、未分配正式ID、未审批写入、未触云/部署/建索引。完成交付后等待独立验收。
'''
(E/'execution_report.md').write_text(report,encoding='utf8')
ns=['capture.js','build_r06.py','test_r06.py','candidates.json','source_ledger.csv','source_ledger.json','source_groups.json','unresolved.csv','stall_crosswalk.csv','relationship_data.json','statistics.json','execution_report.md']
(E/'diff.patch').write_text(''.join(''.join(difflib.unified_diff([], (E/n).read_text(encoding='utf-8-sig').splitlines(True),fromfile='/dev/null',tofile='R06/'+n)) for n in ns),encoding='utf8')
entries=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(E.rglob('*')) if p.is_file() and p.name not in ['file_manifest.json','manifest.sha256','integrity_check.txt']]
(E/'file_manifest.json').write_text(json.dumps({'files':entries,'excludes':['file_manifest.json','manifest.sha256','integrity_check.txt']},ensure_ascii=False,indent=2)+'\n',encoding='utf8');entries.append({'path':'file_manifest.json','bytes':(E/'file_manifest.json').stat().st_size,'sha256':sha(E/'file_manifest.json')})
(E/'manifest.sha256').write_text(''.join(x['sha256']+'  '+x['path']+'\n' for x in entries),encoding='utf8')
assert all(sha(E/x['path'])==x['sha256'] for x in entries)
print('Final SHA-256 verification:',len(entries),'/',len(entries),'PASS; candidates=',len(C))
