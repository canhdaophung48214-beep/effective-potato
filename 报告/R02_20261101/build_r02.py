import pathlib,json,csv,hashlib,subprocess,collections,shutil,datetime
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_20261101';D=E/'candidates';D.mkdir();B=R/'备份'/('R02_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def jr(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rs,fields=None):
 with p.open('w',encoding='utf-8-sig',newline='') as h:
  w=csv.DictWriter(h,fieldnames=fields or list(rs[0]),extrasaction='ignore');w.writeheader();w.writerows(rs)
base=[{'path':str(p.relative_to(P)),'bytes':p.stat().st_size,'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];(E/'project_before.json').write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8')
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
state={k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]};(E/'git_before.json').write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8')
x=jr(E/'current_build.json');rs=x['records'];coverage=rr(O/'R01_E2_20261101_evidence/record_coverage_525.csv');assert len(rs)==490 and len(coverage)==525
# Only existing assigned IDs, source-confirmed egg preparation set; no formal ID allocation.
chosen=[r for r in rs if r['stallId']=='c01_t48' and 502<=int(r['id'].split('_d')[1])<=540];assert len(chosen)==39 and all(r['gen']['id_status']=='assigned_from_map' for r in chosen)
photo=P/'evidence/ds-session-1e2717cc/sha256_914957d83784f5a63ce44f2ced871320d61cf0a58897fc4e4ecaa7f39ad75915.jpg';assert photo.exists()
for f in ['shops','floors','stalls']:
 source=O/f'R01_20261031/preview/{f}.csv';allrows=rr(source)
 keep=allrows if f=='shops' else [r for r in allrows if r.get('floor_id')=='c01_f2' and (f!='stalls' or r.get('stall_id')=='c01_t48')]
 wc(D/(f+'.csv'),keep)
fields=list(csv.DictReader((O/'R01_20261031/preview/dishes.csv').open(encoding='utf-8-sig')).fieldnames)
csvrows=[]
for r in chosen:csvrows.append({'dish_id':r['id'],'dish_name':r['name'],'record_type':'菜品','shop_id':r['shopId'],'stall_id':r['stallId'],'price':r['price'],'food_type':r['foodType'],'tastes':'','source_kind':'field','source_detail':r['source']['detail'],'source_ref':r['source']['ref'],'collector':'','collect_date':'','evidence_file':str(photo)})
wc(D/'dishes.csv',csvrows,fields)
(E/'first_batch.json').write_text(json.dumps({'technicalPreviewOnly':True,'formalAdmissionAuthorized':False,'formalImportCompleted':False,'records':chosen,'evidenceNotes':'existing IDs reused; collector/date not invented; strict collection-metadata mode pending'},ensure_ascii=False,indent=2),encoding='utf-8')
trace=[]
for r in chosen:
 source=P/'tools/pilot/TRANSCRIPTION_2F.md';n=r['gen']['sourceLine'];line=source.read_text(encoding='utf-8-sig').splitlines()[n-1];trace.append({'dishId':r['id'],'sourceFile':str(source),'sourceLine':n,'sourceQuote':line,'sourceSHA256':sha(source),'photo':str(photo),'photoSHA256':sha(photo),'idStatus':r['gen']['id_status'],'price':r['price'],'foodType':r['foodType']})
wc(E/'candidate_traceability.csv',trace)
rm={r['id']:r for r in rs};ledger=[]
for r in coverage:
 actual=rm.get(r['dishId']);ng=r['generationStatus']=='not_generated';business=ng and r['stallId'] in ['c01_t20','c01_t41'];cat='E' if business else 'C' if ng else 'D' if actual['foodType'] is None else 'F'
 ledger.append({'recordKey':r['recordKey'],'originalId':r['dishId'],'dishName':r['dishName'],'shopId':r['shopId'],'stallId':r['stallId'],'price':actual['price'] if actual else r['sourceQuote'],'category':cat,'fieldCompleteness':'tastes=[]合法；foodType未知' if actual and actual['foodType'] is None else '核心菜品字段完整' if actual else '未生成；业务身份按最新裁决见候选结构','source':r['sourceFile']+':'+r['sourceLine'],'blocker':'关联结构及正式ID/准入未落地' if business else '双拼商品构成待裁决' if ng else '缺少foodType直接证据' if cat=='D' else '正式准入仍blocked；首批之外尚未实际导入器验证','recoveryMethod':'负责人NG01/NG03裁决已落实为结构预览' if business else '保留未知，补证/裁决' if cat in ['C','D'] else '保留原值及现有ID；隔离预览验证','status':'FIRST_BATCH_PENDING_TEST' if actual in chosen else 'BLOCKED','nextAction':'完成技术结构审查' if cat=='E' else '取证明确主食类型' if cat=='D' else '负责人裁决NG02' if cat=='C' else '验证批次并申请正式准入','formalAdmission':False})
wc(E/'recovery_ledger_525.csv',ledger)
crows=[]
for r in coverage:
 if r['generationStatus']=='not_generated':crows.append({**r,'R02Result':'已有裁决可解除业务身份阻塞，但技术结构/ID准入未解除' if r['stallId']!='c01_t40' else '仍需NG02业务裁决','candidateStructure':'NG01 1基础+5加价，NG03 10整份价关联组；非普通导入菜品' if r['stallId']!='c01_t40' else '无','formalIdAssigned':False})
wc(E/'C35_recovery_results.csv',crows)
# Apply only two exact taste literals to separate proposals, no formal source change.
exact=rr(O/'R01_E2_recovery_candidates.csv');assert len(exact)==2
(E/'field_recovery_proposals.json').write_text(json.dumps([{'dishId':r['dishId'],'field':'tastes','value':json.loads(r['proposedValue']),'evidence':r['evidenceFile']+':'+r['evidenceLocation'],'formalWrite':False} for r in exact],ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copyfile(O/'R01_E4_NG01_20261101/NG01_candidate_preview.json',E/'NG01_structure.json');shutil.copyfile(O/'R01_E4_consolidated_20261101/NG03_candidate_preview.json',E/'NG03_structure.json')
results=[]
for name,args in [('import_default',['node','tools/import_data.js','--dir',str(D)]),('import_strict',['node','tools/import_data.js','--dir',str(D),'--require-evidence']),('regression_verify',['node','tools/test_verify_data.js']),('regression_import',['node','tools/test_import_data.js']),('diff_check',['git','-c','safe.directory='+str(P).replace('\\','/'),'diff','--check'])]:
 t=subprocess.run(args,cwd=P,capture_output=True,text=True,encoding='utf-8');(E/(name+'.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');results.append({'name':name,'command':args,'exitCode':t.returncode});print(name,t.returncode,(t.stdout+t.stderr)[-400:])
(E/'test_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
(B/'manifest.json').write_text(json.dumps({'note':'No existing source modified; only new R02 scripts/artifacts. Project hash baseline is not byte backup.','projectBefore':str(E/'project_before.json')},indent=2),encoding='utf-8')
print('classes',collections.Counter(r['category'] for r in ledger))
