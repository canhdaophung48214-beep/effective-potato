import pathlib,json,csv,re,hashlib,datetime,shutil,subprocess,collections
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R01_E4_consolidated_20261101';E.mkdir();B=R/'备份'/('R01_E4_consolidated_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rows(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
material=O/'R01_E4_NG03_双拼与套餐业务裁决材料_20261101.md';old=material.read_text(encoding='utf-8');shutil.copyfile(material,B/material.name)
protected={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
header='''# NG03 当前负责人裁决（2026-11-01）

D1已确认：整组自选双拼，米饭及所有菜品无限续。
D2：双拼具体构成未知，选择数量、限制、组件身份不得补造。
D3原问题逐字：“14元辣椒炒肉、16元红烧排骨饭是否独立整份价；若是组合选项，请给出实际选项差额或价目规则，不能从差价推定。”负责人答“是”，并在本轮澄清确认14/16元为各自独立整份标价，不建立加价差额模型。
D4原问题逐字：“滑蛋饭菜单与W04是否同档口/同售卖体系；如不是，明确分开，不能把相邻区域资料套给NG03。”负责人答“不是”，本轮澄清确认不同档口且不共用售卖体系。
D5：全项目补拍需求见本轮照片报告。

10条原始源行与12元×8、14元×1、16元×1不变。以下旧分析保留作历史，不再将D1/D3/D4列为待裁决；D2仍未知。负责人裁决是业务依据，不伪称照片新识别结果。

---
'''
material.write_text(header+old,encoding='utf-8')
ng=[r for r in rows(O/'R01_E3_not_generated_triage.csv') if r['stallId']=='c01_t41'];items=[]
for r in ng:items.append({'previewRef':r['recordKey'],'dishId':None,'name':r['dishName'],'sourceFile':r['sourceFile'],'sourceLine':int(r['sourceLine']),'sourceQuote':r['sourceQuote'],'priceYuan':int(r['sourceQuote'].split('|')[-2].strip().split()[0]),'saleUnit':{'status':'known_by_owner','value':'份'},'priceMeaning':'independent_whole_serving_label','businessGroupRef':'NG03','composition':{'status':'unknown','value':None},'choiceConstraints':{'status':'unknown','value':None}})
preview={'version':'isolated-proposal-1','groupRef':'NG03','mode':'self_select_double_combination','rules':{'riceRefill':'unlimited','allDishRefill':'unlimited','evidence':'owner_D1'},'composition':{'status':'unknown','value':None},'slideEggRiceSameStall':False,'slideEggRiceSameSalesSystem':False,'D3':'14/16 independent whole-serving prices','items':items,'formalImportAllowed':False}
(E/'NG03_candidate_preview.json').write_text(json.dumps(preview,ensure_ascii=False,indent=2),encoding='utf-8')
# Full source-file screening; explicit unresolved photo statements remain evidence tasks, not proven visual defects.
files=[P/'tools/pilot/TRANSCRIPTION_2F.md',P/'tools/pilot/TRANSCRIPTION_3F.md',P/'tools/pilot/TRANSCRIPTION_DRAFT.md',P/'tools/pilot/batch1/待补照片清单.md',P/'tools/pilot/c03_offsite_batch2/辣度待确认清单.md',P/'docs/RAW_DATA_BLOCKERS_20261023.md',P/'evidence/EVIDENCE_INDEX_20261025.md']
photos=rows(P/'evidence/PHOTO_MANIFEST_20261025.csv');coverage=rows(O/'R01_E2_20261101_evidence/record_coverage_525.csv');req=[]
for f in files:
 lines=f.read_text(encoding='utf-8-sig').splitlines();section='文件级'
 for n,l in enumerate(lines,1):
  if re.match(r'^#{2,4} ',l):section=l
  if not re.search('没看清|未标清|被挡|略糊|字太小|反光|待补图|缺.*照|补拍|未拍|待确认名称|价格.*待确认',l):continue
  if len(l)>900:continue
  # Retain historical conflict markers; never silently call every historical request current.
  cls='A' if re.search('没看清|未标清|被挡|略糊|字太小|待补图|待确认名称',l) else 'B'
  shot=re.search(r'W2-\d+|W\d{2}',section);s=shot.group() if shot else None
  linked=[x for x in coverage if s and s in x['sourceFile']+' '+section and x['sourceFile'].endswith(f.name) and abs(int(x['sourceLine'])-n)<35]
  # Do not claim shot-based record linkage without exact section verification.
  linked=[]
  if f.name in ['TRANSCRIPTION_2F.md','TRANSCRIPTION_3F.md']:
   for x in coverage:
    if not x['sourceFile'].endswith(f.name):continue
    k=int(x['sourceLine'])-1;heading=''
    for h in lines[:k+1]:
     if h.startswith('### '):heading=h
    if heading==section:linked.append(x)
  req.append({'requestId':'PHOTO-'+str(len(req)+1).zfill(3),'classification':cls,'source':str(f.relative_to(R)).replace('\\','/'),'line':n,'quote':l,'section':section,'shopAndStalls':sorted(set(x['shopId']+'/'+x['stallId'] for x in linked)),'recordRefs':[x['dishId'] or x['recordKey'] for x in linked],'names':[x['dishName'] for x in linked],'originalPhotoCandidates':[x['archive_path'] for x in photos if s and s in x.get('stall_or_window','')],'photoMapping':'PENDING unless explicit archive mapping exists; do not invent','confirmedContent':'现有转录/OCR有文字线索，未新增视觉确认','unknownField':l,'reason':'源材料明确存在可读性或独立照片证据缺口；历史项须现场前复核是否已由后续证据解除','captureScope':'同档口合并：门头与菜单定位全景一张；相关名称-价签-单位/规则同框近照，避免反光遮挡','mustBeLegible':'完整菜名、对应价格、计价单位、组合/续添限定文字；不得只拍孤立价签','priority':'高' if cls=='A' else '中','otherPhotoCanResolve':'PENDING；先查34唯一归档及相关试点照片，不默认必须重拍','captureGroup':f.name+'|'+section,'status':'SOURCE_SCREENED_PENDING_VISUAL_DEDUP_AND_HISTORY_REVIEW'})
# Explicit owner-confirmed items are C only for business evidence needs, not a claim that an image is clear.
cs=[{'id':'C-NG01','classification':'C','scope':'NG01基础含蛋4元/份及加料业务身份','basis':'负责人D1/D2已确认，不因这些已裁决事实再次要求拍摄；未确认选择规则另留待证。'},{'id':'C-NG03','classification':'C','scope':'NG03经营规则、14/16元独立整份价、滑蛋归属','basis':'负责人D1/D3/D4及本轮澄清；不能描述为照片已清晰核验。'}]
(E/'photo_requirements.json').write_text(json.dumps({'requests':req,'noRepeatBusinessEvidence':cs,'scopeFiles':[{'path':str(f.relative_to(R)),'sha256':sha(f)} for f in files],'limitations':'全项目源材料筛查，不是逐图视觉充分性验收；现有图片尚未证明不能解决前，实际必须补拍数PENDING。'},ensure_ascii=False,indent=2),encoding='utf-8')
groups=sorted(set(x['captureGroup'] for x in req));ac=collections.Counter(x['classification'] for x in req);stalls=sorted({s for x in req for s in x['shopAndStalls']});dishrefs={d for x in req for d in x['recordRefs']}
photoReport=f'''# 全项目照片补拍清单（2026-11-01）

范围：2F/3F转录、早期转录草案、batch1缺图表、c03辣度表、历史阻塞及照片证据索引；35附件记录/34唯一归档和各试点照片仅作现存资源，不重复计算同字节照片。已完成源材料筛查；逐图确认哪些旧问题已解决仍PENDING，故下列A/B是源证据缺口分类，不声称每一项现在都必须重拍。

汇总：源问题{len(req)}项，A={ac['A']}、B={ac['B']}；C=2项已由业务裁决解决、不再为该事实重复索证（不是照片清晰度认证）。已能关联的档口{len(stalls)}个、记录引用去重{len(dishrefs)}条；文件级未关联项另存，以上是下限而非全项目最终数。候选合拍组{len(groups)}组，不等于建议立刻拍{len(groups)}张。**实际建议补拍照片数量PENDING**：需要先完成现有图的局部视觉复核与历史解除对照；不能把问题条数当照片数。

最优先：3F W03五项小字价格及双拼售卖关系；W05三项小笼包名称/价格；W06屏幕五项价目；W08五项米线及三项小食；NG03豆腐/豆角名称；2F胖丞相两项价目、重庆小牌被挡价格。NG01单位与身份已裁，不重复提问；NG03米饭/菜无限续与价档身份已裁，不以OCR差继续阻塞这些事实。

所有条目完整结构化字段见photo_requirements.json：原文文件/行、店档口/源ID（无法唯一定位则明确未关联）、照片候选路径（缺映射则空、不是伪造路径）、能确认内容、未知字段、理由、拍摄范围、应清楚文字、优先级、其它图可否解决及合拍组。未明确归档映射的项目须先定位照片，不能直接要求现场盲拍。补拍不能替代双拼数量或身份等业务裁决。

'''
for x in req:photoReport+='\n## '+x['requestId']+' '+x['classification']+' / '+x['section']+'\n\n依据：'+x['source']+':'+str(x['line'])+'\n\n原文：'+x['quote']+'\n\n对象：'+('；'.join(x['shopAndStalls']) or '待依据源段落确认档口')+'；源记录：'+('；'.join(x['recordRefs']) or '未与正式/候选ID唯一关联，保留源行定位')+'。\n\n原图：'+('；'.join(x['originalPhotoCandidates']) or '归档映射尚待确认，见35条PHOTO_MANIFEST；不捏造一对一关系')+'。\n\n'+x['captureScope']+'；清晰要求：'+x['mustBeLegible']+'；优先级'+x['priority']+'；其它图解决：'+x['otherPhotoCanResolve']+'。\n'
(O/'R01_E4_全项目照片补拍清单_20261101.md').write_text(photoReport,encoding='utf-8')
design='''# NG01/NG03统一结构设计与隔离原型

授权范围：报告内隔离原型，不修改正式任何模块。比较方案：统一所有价格为base+addon会错误解释NG03；为每类业务硬建独立模型会重复扩展；采用小型通用关系信封、区分关系与价格策略。

共同字段：previewRef（非dishId）、源证据、业务组、显示名、原始价格、明确known/unknown状态。实体：sellable（基础/整份售卖项）、surcharge（非独立菜品）、choice/component（只有确认才建立）、businessRule（组范围续添规则）。关系通过typed relation连接；NG01 optional_surcharge关联；NG03 composition未知，绝不生成两个组件。

NG01 fixed base=4、eggIncluded=true、五源行加价关联，unknown选择限制。NG03保留十条固定整份标价及组规则，自选双拼；D3价档独立、D4排除滑蛋共享体系；具体构成/选择数量未知。固定标价查询可以返回，但求组合最终价必须拒绝，不能把固定价当组合算法。

未知用{status:unknown,value:null}，不能用空列表代表已知没有组件。证据记录owner_decision与transcript/OCR分离。旧数据无关系时保持原dish与price逻辑，缺relation不是“允许任意选择”。不推导foodType/tastes。

最小后续调整：契约明确组经营规则和关系信封，扩展现有限定c01_t11的只读addons范围及有证据的parent关联；生成器单独解析诊断预览，不扩大ID准入；导入器新增经过审查的选项/规则通道并验证父引用、独立身份及禁止未知报价。旧dishes.csv不混入加价行；旧菜品模块无需改变price语义。迁移和前端能力另行批准。本轮均未实施。

原型prototype.py仅验证信封、标签价和失败关闭报价；不声称支持真实销售或全项目组合模型。测试包含缺组件、变价、错误独立加料、未知规则。生产兼容性仍待正式实现与审查。
'''
(E/'UNIFIED_DESIGN.md').write_text(design,encoding='utf-8')
(E/'prototype.py').write_text('''import json,pathlib,copy
root=pathlib.Path(__file__).parent
ng03=json.loads((root/'NG03_candidate_preview.json').read_text(encoding='utf-8'))
ng01=json.loads((root.parent/'R01_E4_NG01_20261101/NG01_candidate_preview.json').read_text(encoding='utf-8'))
def validate(a,b):
 assert len(b['items'])==10
 assert sorted(i['priceYuan'] for i in b['items'])==[12]*8+[14,16]
 assert b['composition']=={'status':'unknown','value':None}
 assert b['rules']['riceRefill']=='unlimited' and b['rules']['allDishRefill']=='unlimited'
 assert b['slideEggRiceSameStall'] is False and b['slideEggRiceSameSalesSystem'] is False
 assert a['baseDish']['priceYuan']==4 and a['baseDish']['eggIncluded']
 assert len(a['optionalSurchargeRows'])==5
 assert all(not o['independentDish'] and o['basePreviewRef']==a['baseDish']['previewRef'] for o in a['optionalSurchargeRows'])
def quote_combination(group):
 if group['composition']['status']!='known':raise ValueError('COMPOSITION_UNKNOWN')
 raise ValueError('PRICE_RULE_NOT_IMPLEMENTED')
validate(ng01,ng03)
checks=1
try:quote_combination(ng03);raise AssertionError('unknown composition accepted')
except ValueError:checks+=1
for change in ['price','independent','known']:
 a,b=copy.deepcopy(ng01),copy.deepcopy(ng03)
 if change=='price':b['items'][0]['priceYuan']=99
 if change=='independent':a['optionalSurchargeRows'][0]['independentDish']=True
 if change=='known':b['composition']={'status':'known','value':[]}
 try:validate(a,b)
 except AssertionError:checks+=1
 else:raise AssertionError(change+' incorrectly accepted')
print('PASS',checks,'targeted checks; EXIT=0')
''',encoding='utf-8')
t=subprocess.run(['python','-X','utf8',str(E/'prototype.py')],capture_output=True,text=True,encoding='utf-8');(E/'prototype_output.txt').write_text(t.stdout+t.stderr+'EXIT='+str(t.returncode),encoding='utf-8');assert t.returncode==0
assert len(items)==10 and len({i['previewRef'] for i in items})==10
assert all(sha(pathlib.Path(p))==h for p,h in protected.items())
for x in req:assert (R/x['source']).read_text(encoding='utf-8-sig').splitlines()[x['line']-1]==x['quote']
g=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert g.returncode==0;(E/'git_status.txt').write_text(g.stdout,encoding='utf-8')
(E/'backup_manifest.json').write_text(json.dumps({'path':str(B/material.name),'bytes':(B/material.name).stat().st_size,'sha256':sha(B/material.name)},indent=2),encoding='utf-8')
(E/'NG03_material.diff').write_text(''.join(__import__('difflib').unified_diff(old.splitlines(True),(header+old).splitlines(True))),encoding='utf-8')
(O/'Codex_R01_E4_集中执行报告_20261101.md').write_text(f'''# R01-E4集中执行报告

PASS：NG03 D1/D3/D4已按原问题逐字记录，并有负责人本轮“你说的对”澄清；10条完整、价格12×8/14×1/16×1，D2组成及数量未知。NG01 D1/D2保持已确认，五加价源行非独立菜品。原材料前置更新当前裁决，旧分析标为历史。

PASS：报告内统一结构设计、候选JSON和可运行Python隔离原型落盘；原型5项针对性检查通过，退出0，包括拒绝错误价格、独立加料、伪造已知组成及未知组合报价。源码/契约/导入器未改。

PENDING：照片报告是全项目已有材料源行筛查，{len(req)}项（A{ac['A']}/B{ac['B']}），C两项是已决业务无需重复索证，不是视觉清晰度认证。合拍候选{len(groups)}组；未完成全量逐图局部视觉与历史解除复核，故实际必须补拍照片数、全量档口菜品总数不能宣称已最终确定。已关联档口{len(stalls)}、源记录{len(dishrefs)}为下限。每项原文定位通过，但存在照片/记录尚未唯一映射项，明确标记而不编造。该子任务未达到全量最终补拍验收标准，不能用源材料行扫描代替图像证据复核。

PASS：全部既有项目文件{len(protected)}个逐字节SHA未变，原图、OCR、转录、正式data、ID映射及审批未改。仅NG03报告按授权更新并备份；新增输出位于报告目录。Git只读状态保存，未Git写、正式导入、分配ID、云端调用或部署。

FAIL：针对性自动检查0。PENDING：照片最终必要性/最小张数及未确认组合规则；正式兼容实现未授权。文件大小/SHA见delivery_manifest.json；备份manifest、精确diff及原始测试输出在证据目录。完成可独立工作后停止，交负责人/DSH；没有把未完成照片语义验收标为PASS。
''',encoding='utf-8')
files=[material,O/'R01_E4_全项目照片补拍清单_20261101.md',O/'Codex_R01_E4_集中执行报告_20261101.md']+[p for p in E.iterdir() if p.is_file()]
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS NG03 / prototype exit0; photo final review PENDING; sources unchanged')
