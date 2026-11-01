import pathlib,json,csv,hashlib,subprocess,collections,datetime
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R03_3F_R2_20261101'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
s=J('statistics.json');raw=J('new_source_records.json');c=J('candidates.json');ledger=J('replacement_ledger.json')
cmd=['python','-X','utf8',str(E/'test_r03.py')];t=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8');(E/'test_output.txt').write_text('COMMAND: '+str(cmd)+'\n'+t.stdout+t.stderr+'\nEXIT='+str(t.returncode)+'\n',encoding='utf-8');assert t.returncode==0
r=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'diff','--check'],cwd=P,capture_output=True,text=True,encoding='utf-8');(E/'git_diff_check.txt').write_text(r.stdout+r.stderr+'\nEXIT='+str(r.returncode),encoding='utf-8');assert r.returncode==0
new14=['T01','T02','T03','T04','T05','T06','T08','T09','T10','T11','T12','T14','T16','T17'];cross=list(csv.DictReader((E/'stall_crosswalk.csv').open(encoding='utf-8-sig')));crossmap={x['newStallRef']:x for x in cross}
newNames=[{'newStallRef':i,'name':crossmap[i]['newSignText'],'independentFormalIdentity':'NOT_ASSIGNED','aliasCaution':'稻米香/楚味鸭脖王两品牌同框；是否独立经营主体未证明' if i=='T03' else '局部候选身份，不与旧正式档口号类推'} for i in new14]
with (E/'new_stalls_14.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(newNames[0]));w.writeheader();w.writerows(newNames)
report=f'''# R03 三楼R2独立替换与候选生成

日期2026-11-01。执行Codex；待DSH独立审查。**133条隔离历史菜单候选实际落盘，正式ID分配0、正式准入0、正式可导入0。** foodType映射未在新档口扩源，仍未知；候选不是通过正式导入器的普通菜品。当前有证据的名称、菜单标价、规格与来源被保存，不假造正式字段。

## 1. 基线与交付范围

直接读取TRANSCRIPTION_3F_R2.md（26981字节，SHA见manifest）、旧coverage_525及旧候选、契约、已确认NG03材料、现有裁剪脚本和实际原图。没有执行正式生成器--write，没有改旧转录。R2稿的业务建议与已签裁决分别保存，文字“可入库”不等于本轮正式准入。

旧三楼实际为143条源条目（含不生成条目），不是只看两个文档中的口头小计。143条全部唯一映射：RETAIN12、REPLACE48、SPLIT0、VOID32、PENDING51=143。另有NEW为无旧行逐项关联的新源行，不将NEW数加到旧143的去向守恒式。replacement_ledger.csv/json含旧recordKey/旧dishId/源位置/新源局部ref/动作/理由；new_source_records.json提供新源行的旧键反查；candidates.json提供旧键及源组ref。旧ID只追溯，所有formalDishId=null。

## 2. 六项具体结果

| 项目 | 本轮结果 |
|---|---|
| W01/W10 | 旧c01_t38的12条、c01_t47的15条均VOID，不仅照抄R2“首轮6条”的表述；T18/T21独立新建局部身份，不继承旧ID。T18新7套餐仍待结构/准入，T21产生15新候选。 |
| 小笼包 | T17作为独立候选档口，6条小笼包及4条云吞形成10候选。旧W05的6小笼包中同名3条可关联新源，其余名称不符保留PENDING；其余W05条目不因本轮未拍就宣称停业。 |
| NG03/T13 | 10条全部进入候选，12×8/14×1/16×1；自选双拼、米饭和所有菜无限续、独立整份标价、滑蛋非同档口/体系，均引用已确认裁决；composition/choiceCount=null。历史原图作辅助，未假称已找到本轮P17原对象，索引待补但不重新打开业务裁决。 |
| T04 | 鲜椒鸡14.9为推定价，未进直接证据候选；该条与缺图索引问题进入待核验池。 |
| T19 | 实际对原图c246…及gigi局部运行本机Windows中文OCR，两份均完成；主表“鱼蛋15”“烤肉16”可读，但香酥玉米名称-价签配对仍不可靠，保持PENDING。鱼蛋因主表15/摘要图条16仍单独隔离，未按文字强行选择；12个无该冲突的单品形成历史候选，3拼款继续待结构/准入。 |
| T20 | 仅12项主菜单RETAIN且形成12候选；旧5卤味VOID（源历史保留，R2明确不录）；2临时贴纸在补充源组/待核验池，不称整档19条零差异。鸭腿旧“元/柜”与新“元/根”不能静默视为单位无变化。 |

legacy_reference_audit.json证明旧R01/E2/R02快照仍保留VOID ID引用，这是历史留痕不是新候选。正式gen_records.js仍读首轮TRANSCRIPTION_3F.md，本轮没有授权改正式路径，所以不能再次把原生成器三楼输出当R2结果。新候选的源文件统一R2，旧W01/W10不会以旧身份复活。

## 3. 293与候选数的不同口径

| 口径 | 本轮可复算数量 | 说明 |
|---|---:|---|
| 原文逐档口小计相加 |293|算术成立，不是记录生成结果 |
| 逐项可枚举核心菜单条目 |287|T14文字只可列42而不是48，差6；其它21组与其小计相符 |
| 小计之外的明确补充价目 |5|T11热狗棒1、T16秘制套餐1、T20红纸2、T22煎蛋培根红纸1；另存待核验，不悄悄计入293 |
| 新源条目总组 |292|287+5；其中118组形成候选，174组待核验 |
| 表格式价目原始物理行 |230|仅本次可枚举独立价目行，不含T09“9种馅等”无法逐项定价的合并描述行 |
| 核心价目对应不同源行 |241|行内并列项目也按原物理行回指；再加补充5行=246；不是原文件总行数 |
| 单品/小吃形态条目主体 |197|dish167+snack30；包含缺证据项目，不是197可入库商品 |
| 明确标为套餐形态 |13核心+1补充|T11六套餐、T18七套餐、T16补充一；不自动改成普通菜品 |
| 组合结构待定条目 |26|T07整组23（含滑蛋归属/形态需要细化）及T19拼款3；不据此宣称26项已确认套餐 |
| 已裁决自选双拼整份标价 |10|T13单列经营关系，不把未知组成展开 |
| 明确饮品分组 |41|T14奶茶/果茶/茶等；另T14小吃1使42。T17粥汤/豆浆/鸡蛋5为混合辅助组，单列，不伪称41是全项目最终饮品SKU数 |
| 原文存在规格的价位槽 |66|T02双规格30槽、T05三规格36槽；标签5种（小份/大份/小中大碗） |
| 最终历史候选记录 |133|118源组，T02 15行拆双规格增加15，118+15=133；其单一价13元只生成1条，不补另一档 |
| 待核验事项 |176|174未产生候选的源组+T19图条、T09九馅2个额外问题；不是176道菜 |

count_reconciliation.csv逐档口对照，new_source_records.json逐价目组定位，auxiliary_source_statements.json保留加料、起价、称重、组合与不录规则段落。293-9-1=283的旧算法混合源组、规格与业务类别，且T14本身差6，故283不能作为最终候选数量。主清单之外的辅助条目不因数量目标被删除或转成菜品。

双规格：T02明确小/大价分别形成30条，另单价1；5条“米线/面”同价多基底先隔离，不据名称暗扩记录。三规格：T05保留12组/36价位槽，未替负责人选中碗或分配正式多规格ID。套餐、组合和饮品均保留原始描述，不当作普通菜品平铺后假称准入。所有候选价格是原菜单标价，不是核实现价，不报价。

## 4. 新档口14个及别名

原文写“+12家”但逐一列出14个，本轮new_stalls_14.csv列全T01/T02/T03/T04/T05/T06/T08/T09/T10/T11/T12/T14/T16/T17。没有证据证明为什么原文少算2，按计数不一致登记，不编造“某两家应合并”的原因。

22个T段全部留在stall_crosswalk.csv。T03两品牌同框是否独立经营主体仍未知，不为凑12而合并或拆正式档口；T17是明确纠正的独立小笼包档口。跨轮段落对应不等于同一经营主体已核实；尤其作废的W01/W10不按数字或同名直接继承ID。所有新候选只用R03-Txx-L行号-V局部标识。

## 5. 实际候选及证据边界

候选分布：T02=31、T09=1、T10=10、T12=9、T13=10、T15=15、T16=8、T17=10、T19=12、T20=12、T21=15，共133、11个临时档口。每条包括新局部标识、名称、档口、原价表达/金额、规格、源文件/行/原文、P标签与可用原图/局部路径及SHA/裁剪框、已有裁决引用、旧键、准入状态和阻塞原因。

**证据强度不是133条均重新逐像素人工核实。** 候选以用户R2可信转录为行级证据并挂接可用本地照片；本轮独立OCR仅专门复核T19两图。裁剪脚本标签建立照片定位，P号与对象仍有待完整核对的边界，NG03特别使用已确认历史证据辅助。没有本机图片路径且无已有裁决证据的条目先隔离。来源/价格可追溯不等于正式可导入；foodType未在新档口猜测补值，tastes继续[]合法，核实状态全部unverified/null，正式准入0。

## 6. 测试与保护

独立test_r03.py本轮运行14项全部通过，退出0，完整输出test_output.txt。包括143旧键全覆盖、双向引用、27个W01/W10全VOID、独立小笼包、NG03规则与原价、T04/T19隔离、T20范围、293→287→292账本、所有源组有去向、133唯一候选及未知保留、源行/照片文件哈希、项目保护。负向数据5类（错价、错名、擅填正式ID、小笼包错档口、虚构NG03组成）均触发失败，不为通过而放宽标准。

git diff --check退出0；正式项目{len(J('project_before.json'))}个文件及原图/转录/生成器/契约/正式data/映射/审批SHA未变，Git HEAD/branch/staged/status前后一致。已有旧快照不覆盖，R2文件不改，所有输出仅新R03目录。没有云端操作、部署、正式导入或正式ID分配。没有修改原源码，故无伪造修改前字节备份；project_before.json是哈希基线，stage1_before_ng03_link是明确的本轮中间快照而非原始数据备份。

交付八项全部落盘，另附原文组、口径对账、14档口表、原图索引、OCR原始输出、旧引用审计、测试和脚本。manifest.sha256记录全部文件SHA（不自引用），file_manifest.json给出字节数及绝对/相对路径。最终自检逐项重算。

## 7. 最终判定

PASS：133历史候选真实生成、143旧记录全去向、六项问题已明确处理或隔离、293口径纠偏、14档口不丢失、14测试及负向保护、正式工作区不变。
PENDING：T19香酥玉米图条/鱼蛋图文对应、T04遮挡价、T09馅价配对、T05三规格规则、套餐/饮品范围、新照片完整P号索引与正式身份/类型/ID/准入。
正式技术导入候选0、正式授权0、正式导入0；不得把133当作可直接上传菜品。证据不足池不阻塞已生成历史候选。完成后停止，交DSH审查，不进入正式数据导入。
'''
(E/'R03_执行报告.md').write_text(report,encoding='utf-8')
# Extra stats clarify form/units instead of conflating menu groups with formal SKUs.
s.update({'singleDishOrSnackFormCoreGroups':197,'packageCoreGroups':13,'packageSupplementaryGroups':1,'unresolvedCombinationFormGroups':26,'ownerConfirmedSelfSelectGroupRecords':10,'candidateUnderlyingSourceGroups':118,'rawSpecLabelCount':5,'sourceScopeCaveat':'Counts are scoped menu groups / price slots, not approved independent product identities.'});(E/'statistics.json').write_text(json.dumps(s,ensure_ascii=False,indent=2),encoding='utf-8')
files=sorted(p for p in E.rglob('*') if p.is_file() and p.name not in ['manifest.sha256','file_manifest.json']);meta=[{'path':str(p.resolve()),'relativePath':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files];(E/'file_manifest.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8');files.append(E/'file_manifest.json');(E/'manifest.sha256').write_text(''.join(sha(p)+'  '+p.relative_to(E).as_posix()+'\n' for p in sorted(files)),encoding='utf-8')
for l in (E/'manifest.sha256').read_text().splitlines():h,n=l.split('  ',1);assert sha(E/n)==h
print('DELIVERED133; OLD143; TESTS14 exit0; manifest files',len(files))
