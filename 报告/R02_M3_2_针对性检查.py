import pathlib,json,csv,hashlib,subprocess,copy,collections
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_M3_2_20261101';E.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
input=O/'R02_M3_1_20261101/updated_candidates.json';x=json.loads(input.read_text());before={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
gbefore={k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]}
parent={'shop':{'id':'c01','name':'服务楼','location':'服务楼','identityStatus':'KNOWN_BY_OWNER_MODEL_DECISION','evidence':'RECORD_GENERATOR_CONTRACT_20261023.md:1023-1028','fieldVerified':False},'floor':{'id':'c01_f2','label':'2 楼','status':'KNOWN_MODEL_ASSOCIATION','evidence':'existing contract and archived floor guide','fieldVerified':False},'stall':{'id':'c01_t48','name':'小吕哥黄焖鸡（暂定）','imageToStallRelation':'CONFIRMED_BY_OWNER','evidence':'DR-2F09-VERIFY-20261025 section2','side':None,'windowNumber':None,'formalNameStatus':'PENDING_HEAD_SIGN_EVIDENCE','formalSignoff':'PENDING','overallVerification':'NOT_GRANTED'}}
status=[];layers=[]
for r in x['records']:
 layer={'dishId':r['id'],'primaryClass':'C','secondaryFlags':['B_PARENT_SIGNOFF_PENDING'],'dishCoreStatus':'SOURCE_SUPPORTED','price':{'amount':r['price'],'currency':'CNY','status':'HISTORICAL_MENU_VALUE','sourceRef':r['source']['ref'],'currentValidity':'UNKNOWN','captureDate':None,'unit':None,'unitStatus':'NOT_EXPLICIT_IN_TABLE','conflictFound':False},'serving':{'size':None,'quantity':None,'status':'UNKNOWN','specificCompetingUnitsFound':False},'parentRef':'c01_t48','metadataStatus':'DEFERRED_BY_OWNER','businessPreviewAllowed':True,'readinessForNextReview':True,'formalAdmissionAuthorized':False,'strictEvidencePassed':False,'transactionQuoteAllowed':False}
 layers.append(layer);status.append({'dishId':r['id'],'name':r['name'],'primaryClass':'C','reason':'原菜单标价完整可追溯；当前时效未知，允许历史业务预览','B_parentFlag':True,'D_substantiveUnitAmbiguity':False,'unitKnown':False,'unitRisk':'不能据此报价/比较单位价格；历史菜单预览使用元、不补每份每张','E_otherConflictFound':False,'dishIdentity':'来源支持，未提升verifyStatus','parentIdentity':'菜单归属已确认、正式门头/签发待核验','nextReview':True,'strictEvidencePassed':False,'formalAdmissionAuthorized':False})
with (E/'business_admission_status_39.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(status[0]));w.writeheader();w.writerows(status)
updated={'baseline':str(input),'baselineSHA256':sha(input),'records':x['records'],'parentEvidenceLayer':parent,'businessAdmissionLayers':layers,'classificationPriority':'E actual unexplained conflict > D concrete competing unit/serving meanings > C historical currentness unknown > B parent pending only > A complete; missing unit alone is not proof of a conflict','metadataPolicy':'collector/captureDate deferred; do not ask or inherit; strict validation unchanged','formalImportCompleted':False}
(E/'updated_candidates.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2),encoding='utf-8')
(E/'preview_model.py').write_text('''import json,pathlib,copy
p=pathlib.Path(__file__).parent
x=json.loads((p/'updated_candidates.json').read_text(encoding='utf-8'))
def render(record,state):
 if state['price']['status']!='HISTORICAL_MENU_VALUE':raise ValueError('unsupported price status')
 return {'id':record['id'],'name':record['name'],'priceText':str(state['price']['amount'])+'元（历史菜单标价，现价及计价单位待核实）','stallText':'小吕哥黄焖鸡（暂定；门头及正式签发待核验）','currentPrice':None,'transactionQuote':None}
def quote(state):
 if not state['transactionQuoteAllowed']:raise ValueError('NOT_TRANSACTION_READY')
 raise ValueError('NOT_IMPLEMENTED')
views=[render(r,s) for r,s in zip(x['records'],x['businessAdmissionLayers'])]
assert len(views)==39 and all('历史菜单' in v['priceText'] and '单位待核实' in v['priceText'] and v['currentPrice'] is None for v in views)
assert all(s['businessPreviewAllowed'] and s['secondaryFlags']==['B_PARENT_SIGNOFF_PENDING'] for s in x['businessAdmissionLayers'])
try:quote(x['businessAdmissionLayers'][0])
except ValueError:pass
else:raise AssertionError('unverified transaction allowed')
assert all(r['verifyStatus']=='unverified' and r['verifiedAt'] is None for r in x['records'])
(p/'business_preview.json').write_text(json.dumps(views,ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS preview39; parent pending does not erase dishes; historical disclaimer39; unverified quote rejected; verifyStatus unchanged; EXIT=0')
''',encoding='utf-8')
t=subprocess.run(['python','-X','utf8',str(E/'preview_model.py')],capture_output=True,text=True,encoding='utf-8');assert t.returncode==0;(E/'test_output.txt').write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8')
assert len(status)==39 and len({s['dishId'] for s in status})==39 and updated['records']==x['records']
assert all(sha(pathlib.Path(p))==h for p,h in before.items());assert git(['status','--porcelain=v1','-uall']).stdout==gbefore['status']
(E/'git_before_after.json').write_text(json.dumps({'before':gbefore,'afterStatus':git(['status','--porcelain=v1','-uall']).stdout},ensure_ascii=False,indent=2),encoding='utf-8')
(E/'最小裁决清单.md').write_text('''# 剩余决策范围

本轮内部隔离历史菜单预览已经可用，不需要为每道菜重新裁决。采集人/实际日期延期，不再询问。以下仅在拟升级实际用途时需要处理：

1. 正式对外发布/正式准入时，负责人决定是否签发该档口；当前缺门头及整体核验依据，保持父级待核验，不改菜品源信息。
2. 若需要实时价格或交易报价，按13个原菜单行（各含3做法）补现行价、售卖单位/份量的真实依据。未发现单价本身冲突；不提出39个重复问题，也不把缺单位等同已有张/套冲突。
3. 如后续明确允许历史菜单说明性展示，沿用已生成业务预览文案；本轮仅授权隔离预览，不扩大为对外展示授权。

当前39条没有新发现必须立即由负责人选择的单菜业务矛盾。不得为得到A类或严格PASS而授权自动豁免；原严格规则、verifyStatus及审批状态保持原样。
''',encoding='utf-8')
(E/'执行报告.md').write_text('''# R02-M3.2 业务阻塞分层落实

实际完成：39条隔离候选增加可执行的证据分层与39条业务预览，不改原records业务值。价格从未分层的数字变为外层HISTORICAL_MENU_VALUE状态，当前有效性UNKNOWN、单位null；父级身份和签发独立标记。preview_model.py真实生成business_preview.json，标明历史价格/单位待核实/档口暂定，拒绝交易报价。不是仅写分析意见。

主分类 A0/B0/C39/D0/E0，合计39。每条另有B父级待核验标签39项，不与主分类相加。分类判定：实质冲突优先、具体单位竞争解释其次、价格时效未知其次，最后才父级待核验。暂无不同单位相互冲突的具体证据，所以单位未写明不自动归D；金额的语义范围需说明，交易报价必须阻断。历史标价来源明确不等于已证明当今真实售价，不将“历史价格有效”写成已核实现价。

四类问题处理：
1. 身份：DR-2F09确认菜单照片归小吕哥黄焖鸡；契约确认c01服务楼建模及t48关联。属于“有明确限定身份证据、整体未正式签发”，不是完全无法确认，也不是全项已核实。门头/正式签发归父级，不擦除39条菜品证据；正式发布/准入限制仍保留，不能借分层绕开。
2. 档口：服务楼、2楼、t48关联有依据；详细方位/号码null、正式门头名待核验，显示暂定。缺方位不记成菜品名称错误，不编造西侧号位。
3. 价格：全部保留原数字和源ref；没有本轮新发现的原价冲突。现价UNKNOWN，用历史价状态和明确说明实现隔离预览，不删除历史数据。现行售价承诺及交易仍不允许。
4. 单位：源表仅元数/做法，不补元每份/张/套；份量未知。说明性历史预览可显示原元数及未知提示；单位比价、下单报价与计量理解需要真实单位，不能靠文案替代证据。

成果统计：历史业务预览可用39，进入后续准入审查材料准备39，不等于A类业务完全无未知；新发现单菜实质冲突0，严格通过仍0，正式准入授权0、正式导入0。当前正式签发及严格证据缺口没有消失，采集字段延期不再索取。严格模式沿用已有效失败结果，没有重复测试已完成M3.1的源表/ID/默认导入器。

本轮针对性检查：预览39条、历史文案39条、父级待核验不阻止历史预览、交易报价失败关闭、verifyStatus保持unverified，全部通过，原始输出test_output.txt，退出0。隔离原型不修改正式界面或导入规则。

保护：正式项目所有开工文件SHA不变，Git前后状态一致；旧M3.1输入不覆盖，基线SHA记录于新JSON；实际差异仅新增R02_M3_2目录。data/审批/ID映射未改，无云端/上传/部署/Git写。文件大小及SHA见delivery_manifest.json。源记录未改，因此无伪造修改前备份。

PASS：分层结构、实际历史预览、针对性测试和保护。PENDING：父级正式签发、现价和交易所需单位、延期采集信息。FAIL：本轮针对性检查0；没有宣称严格模式通过。最小裁决清单只列后续用途升级所需事项，不向负责人重复索取已延期字段。交付后停止。
''',encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'exitCode':0,'records':39,'classifications':{'A':0,'B':0,'C':39,'D':0,'E':0},'parentSecondaryFlags':39,'sourceRecordsUnchanged':True,'projectFilesUnchanged':len(before),'businessPreviewsGenerated':39,'strictRulesChanged':False},indent=2),encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS actual previews39; C39 + B secondary39; tests0; project unchanged')
