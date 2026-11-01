import pathlib,csv,json,hashlib,collections,subprocess
R=pathlib.Path.cwd();O=R/'报告';E=O/'R01_E3_evidence';P=R/'项目'
def j(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def rows(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def writecsv(n,rs,fields=None):
 with (O/n).open('x',encoding='utf-8-sig',newline='') as h:
  w=csv.DictWriter(h,fieldnames=fields or list(rs[0]));w.writeheader();w.writerows(rs)
manifest=j(O/'R01_E2_evidence_manifest.json');ocr=j(E/'ocr_raw.json');om={x['path']:x for x in ocr};photos=rows(P/'evidence/PHOTO_MANIFEST_20261025.csv');reviews=[];texts=[]
for x in photos:
 p=P/x['archive_path'];v=om[x['archive_path']];compact=''.join(v['text'].split());reviews.append({'photoId':x['photo_id'],'archivePath':x['archive_path'],'exists':p.exists(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'hashMatches':hashlib.sha256(p.read_bytes()).hexdigest()==x['sha256'],'openStatus':v['status'],'knownMapping':x['stall_or_window'],'mappingStatus':x['mapping_status'],'ocrShopHint':compact[:100],'fieldReview':'PENDING_ITEM_LEVEL_VISUAL_CONFIRMATION','upgradeCount':0,'conflictStatus':'UNCONFIRMED_OCR_NOISE','reason':'已完成离线OCR；文字顺序和菜品作用域未能可靠确认，未升级字段。'})
 texts.append({'photoId':x['photo_id'],'archivePath':x['archive_path'],'engine':'Windows.Media.Ocr zh-Hans-CN offline','status':v['status'],'ocrText':v['text'],'lineCount':len(v['lines']),'error':v['error'],'interpretationStatus':'RAW_MACHINE_OUTPUT_NOT_VERIFIED_FACT'})
writecsv('R01_E3_image_review.csv',reviews);writecsv('R01_E3_image_ocr_results.csv',texts)
writecsv('R01_E3_new_candidates.csv',[],['dishId','fieldName','originalValue','proposedValue','classification','photoId','evidenceLocation','evidenceDescription','confidence','conflictStatus'])
coverage=rows(O/'R01_E2_20261101_evidence/record_coverage_525.csv');tri=[]
for x in coverage:
 if x['generationStatus']!='not_generated':continue
 stall=x['stallId'];reason={'c01_t20':'手抓饼基础与加料计价口径尚未裁定，C档不占号。','c01_t40':'双拼是拼菜还是套餐及组件录入方式未裁定，C档不生成。','c01_t41':'双拼/滑蛋饭组合与口味/价格关系未裁定，C档不生成。'}[stall]
 q=next((i+1 for i,l in enumerate((P/'docs/RECORD_GENERATOR_CONTRACT_20261023.md').read_text(encoding='utf-8-sig').splitlines()) if 'C 档' in l and (('W03' in l if stall=='c01_t40' else 'W04' in l if stall=='c01_t41' else '手抓饼' in l))),None)
 tri.append({**x,'sourceExists':True,'sourceLineVerified':(R/x['sourceFile']).read_text(encoding='utf-8-sig').splitlines()[int(x['sourceLine'])-1]==x['sourceQuote'],'primaryClassification':'需要业务裁决','secondaryBlocker':'契约或准入阻塞','missingRequirements':'录入形态/组合或计价规则；正式dishId；后续准入审批；不将未生成字段伪称缺失数据','whyNoDishId':reason,'generatorEvidence':'项目/tools/pilot/gen_records.js:2661 st.tier===C 时 candidate=null','contractEvidence':'项目/docs/RECORD_GENERATOR_CONTRACT_20261023.md:'+str(q),'C19Impact':'C19约束candidate_only数量恒0；本条直接原因是C档与ID未分配，不是单独修改C19即可解除。','needsNewAdmissionDecision':True,'canResolveWithExistingMaterials':'不能直接恢复；已有菜单/OCR可供裁决参考，不替代裁决','requiredQuestion':reason+' 请裁定是否录入、记录形态及所需审批，不在本轮分配ID。'})
writecsv('R01_E3_not_generated_triage.csv',tri)
b=[]
for field in ['tastes','foodType']:
 for x in rows(O/f'R01_E2_{field}_inventory.csv'):
  if x['classification']!='B':continue
  b.append({**x,'candidateInterpretation':('保留括注或选项原文；可能是辣度、风味或可选项，尚不映射为枚举' if field=='tastes' else '菜单分组可能描述此类菜品，但不等同该菜品foodType；需明确逐项映射'),'specificDecisionQuestion':('是否确认该原文适用于本条菜品及规格？若确认，请明确对应枚举；不辣不能直接等同清淡。' if field=='tastes' else '是否有此菜品主食构成的直接依据，并明确foodType枚举？仅栏目标题不能批准填值。'),'E3Status':'PENDING_BUSINESS_DECISION'})
writecsv('R01_E3_business_decisions.csv',b)
assert len(tri)==35 and len(b)==203 and len(photos)==35 and len(ocr)==34
assert collections.Counter(x['fieldName'] for x in b)=={'tastes':40,'foodType':163}
assert all(x['status']=='OCR_COMPLETED' for x in ocr)
assert all(x['sourceLineVerified'] for x in tri)
base=j(O/'R01_E2_20261101_evidence/project_before.json')
assert all(hashlib.sha256((P/x['path']).read_bytes()).hexdigest()==x['sha256'] for x in base)
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
state={k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('staged',['diff','--cached','--name-status']),('status',['status','--porcelain=v1','-uall'])]};(E/'git_state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
t=subprocess.run(['node',str(O/'R01_E2_20261101_evidence/test_inventory.js')],capture_output=True,text=True,encoding='utf-8');(E/'e2_reused_test.log').write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');assert t.returncode==0
(E/'validation.log').write_text('PASS 35 photo rows / 34 unique; 34 offline OCR completed\nPASS 35 source lines verified\nPASS 203 decisions =40 tastes +163 foodType\nPASS 376 project hashes unchanged\nPASS E2 independent 15 groups, exit0\nEXIT=0\n',encoding='utf-8')
(O/'R01_E3_blocker_summary.md').write_text('# 未生成记录阻塞汇总\n\n35条均需业务裁决：c01_t20手抓饼6、c01_t40双拼茶泡饭19、c01_t41辣椒炒肉双拼饭10。\n\n互斥主分类：可直接恢复0；需要业务裁决35；需要补充材料0；契约或准入阻塞0。35条另均带次级契约/准入阻塞，不能与主分类重复相加。补充材料0只表示当前主要阻塞不归此类，不保证未来裁决无需补证。C19不是单独放行开关。\n',encoding='utf-8')
(O/'Codex_R01_E3_证据复核与未生成记录处理.md').write_text('''# R01-E3 证据复核与未生成记录处理

本地OCR提取与阻塞清单 PASS；逐菜视觉判读及字段升级 PENDING。日期2026-11-01。

35条照片记录、34唯一对象均存在、可解码且完成Windows.Media.Ocr离线中文识别。逐张保留原始OCR文本和归档映射；机器识别存在小字、反光、顺序及作用域错误，未将OCR文字当作事实。没有调用外部识别服务。首次PowerShell脚本编码导致路径读取失败，改成UTF-8 BOM后重跑34个对象全部完成；初次不算成功。

新增A候选0、B升级0、C补证完成0。照片语义复核仍35项PENDING：本轮完成真实离线识别，但尚未完成足够可靠的逐菜对应与视觉确认，不能宣称任务A全量通过。image_review中的knownMapping来自既有归档清单；ocrShopHint只是机器摘要，不是新确认的店铺身份。new_candidates保留空表，未填无依据字段。与E2相比，实际进展是从仅哈希核对推进至34对象真实OCR，未改变E2分类与候选。

35条NOT_GENERATED逐源行复核通过，均为C档：手抓饼6、双拼茶泡饭19、辣椒炒肉双拼饭10。直接ID缺失来自gen_records.js:2661的C档candidate=null；C19是candidate_only恒0守卫，不是本轮35条的单独直接原因。现有材料不足以代替录入形态、计价或组合规则裁决。主分类业务裁决35、直接恢复0、材料补充0、契约准入0；35条均另有次级契约/准入要求，尚未解决35。逐项问题在triage表，不自动分配ID。

203项B决策材料完整保留原记录、证据、未恢复原因、可能解释及具体问题：tastes40、foodType163，全部待负责人裁决。菜单分组不等同foodType，风味不等同辣度。

验证：build_e3.py退出0；本轮独立检查源行35、照片35/34、B分类203守恒、376项目文件哈希不变。复用E2 test_inventory.js，15组PASS、0FAIL，退出0；完整日志在R01_E3_evidence/e2_reused_test.log与validation.log。未运行无关完整套件。

项目源码、data、正式CSV、映射、审批、契约、生成器、准入状态均未改。未重新生成已有数据，未正式分配ID、导入、触云或Git写。Git当前完整状态见git_state.json；HEAD/branch/staged/status与E2基线逐项对照。输出仅报告目录。所有交付物字节数、SHA-256见R01_E3_evidence/artifacts_manifest.json。报告自身不自引用哈希。

本轮交付：R01_E3_image_review.csv、R01_E3_image_ocr_results.csv、R01_E3_new_candidates.csv、R01_E3_not_generated_triage.csv、R01_E3_blocker_summary.md、R01_E3_business_decisions.csv及本报告。附OCR脚本、逐图原始JSON、独立验证脚本和日志。任务A尚未完整关闭，不以OCR执行成功冒充证据恢复完成。停止等待DSH独立验收。
''',encoding='utf-8')
old=j(O/'R01_E2_20261101_evidence/git_before.json');assert state['HEAD']==old['head'] and state['branch']==old['branch'] and state['staged']==old['staged'] and state['status']==old['status']
files=list(O.glob('R01_E3_*.*'))+[O/'Codex_R01_E3_证据复核与未生成记录处理.md']+list(E.glob('*'))
(E/'artifacts_manifest.json').write_text(json.dumps([{'path':str(p.resolve()),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS E3 deliverables; OCR34; triage35; decisions203; project376 unchanged; E2 tests exit0')
