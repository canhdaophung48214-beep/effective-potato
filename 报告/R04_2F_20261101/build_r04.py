import pathlib,json,csv,hashlib,subprocess,collections,shutil,re
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R04_2F_20261101'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def J(p):return json.loads(pathlib.Path(p).read_text(encoding='utf-8-sig'))
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader()
  for r in rs:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})
def readcsv(p):
 with pathlib.Path(p).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
project=[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];dump('project_before.json',project)
closedManifest=R/'报告/R03_3F_R2_20261101/manifest.sha256';dump('R03_closed_fingerprint.json',{'path':str(closedManifest),'sha256':sha(closedManifest)})
git=lambda a:subprocess.run(['git','-c','core.quotepath=false','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
gbefore={k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('staged',['diff','--cached','--name-status']),('status',['status','--porcelain=v1','-uall'])]};dump('git_before.json',gbefore)
sources=[(P/'tools/pilot/TRANSCRIPTION_2F.md','TRANSCRIPTION_2F.md'),(P/'evidence/PHOTO_MANIFEST_20261025.csv','PHOTO_MANIFEST_20261025.csv'),(P/'evidence/EVIDENCE_INDEX_20261025.md','EVIDENCE_INDEX_20261025.md'),(P/'docs/decisions/DECISION_RECORD_SET_R2_20261024.md','DECISION_RECORD_SET_R2_20261024.md'),(R/'报告/R01_E4_NG01_手抓饼业务裁决材料.md','NG01_owner_material.md'),(R/'报告/R01_E4_NG01_20261101/NG01_candidate_preview.json','NG01_approved_preview.json')]
sourceMeta=[]
for p,name in sources:
 q=E/'source_assets'/name;shutil.copyfile(p,q) if not q.exists() else None;assert p.read_bytes()==q.read_bytes();sourceMeta.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('source_inputs.json',sourceMeta)
text=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig');lines=text.splitlines();capture=J(E/'current_2f_capture.json');records=capture['records'];assert len(records)==376
coverage=[r for r in readcsv(R/'报告/R01_E2_20261101_evidence/record_coverage_525.csv') if r['sourceFile'].endswith('TRANSCRIPTION_2F.md')];assert len(coverage)==382
stallshots=dict(zip(['c01_t07','c01_t09','c01_t11','c01_t48','c01_t49','c01_t20','c01_t28','c01_t37','c01_t32','c01_t17','c01_t16','c01_t14','c01_t15','c01_t19','c01_t35','c01_t21'],['W2-%02d'%i for i in range(1,17)]))
for r in coverage:r['shot']=stallshots[r['stallId']];r['name']=r['dishName']
covbyid={r['dishId']:r for r in coverage if r['dishId']};photos=readcsv(E/'source_assets/PHOTO_MANIFEST_20261025.csv');pm={r['photo_id']:r for r in photos}
for p in photos:p['fullPath']=str(P/p['archive_path'])
# Explicit confirmed archive mappings; unresolved W2 shoot order is never equated with photo sequence.
def photo_for(r):
 if r['stallId']=='c01_t48':p=pm['2F-09'] if 262<=r['gen']['sourceLine']<=274 else pm['2F-05'];basis='PHOTO_MANIFEST confirmed mapping + source menu section'
 elif r['stallId']=='c01_t49':p=pm['2F-07'];basis='PHOTO_MANIFEST confirmed W2-05 archive mapping'
 else:return None
 assert p['mapping_status']=='confirmed';return {'originalPath':p['fullPath'],'originalPathSHA256':sha(p['fullPath']),'photoId':p['photo_id'],'mappingBasis':basis,'localCropRegion':None,'fieldReaudit':'existing confirmed archive; no new full-image audit claim'}
def rowmeta(line):
 matches=[(t,row) for t in capture['tables'] for row in t['rows'] if row['line']==line];return matches[0] if matches else (None,None)
ng=J(E/'source_assets/NG01_approved_preview.json');candidates=[];unresolved=[];raw=[];ledger=[];options=[]
for idx,r in enumerate(records,1):
 o=covbyid[r['id']];line=r['gen']['sourceLine'];quote=lines[line-1];ref=f"R04-{o['shot']}-L{line:04d}-S{idx:03d}";photo=photo_for(r)
 source={'sourceRecordRef':ref,'name':r['name'],'stallRef':o['shot'],'oldStallIdForTrace':r['stallId'],'stallName':o['stallName'],'sourceFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':line,'sourceQuote':quote,'oldRecordKeys':[o['recordKey']],'oldDishIdForTrace':r['id'],'photoEvidence':photo,'generationBasis':'reused existing gen_records.run dry-run 2F subset + parseDoc table metadata'};raw.append(source)
 reasons=[]
 if ' / ' in r['name']:reasons.append('一行并列多品种/变体，未获逐菜实体拆分，不把整行当单一道菜')
 if '待确认' in quote:reasons.append('源行价格明确标待确认，不能把旧解析数值当已解决')
 if not photo:reasons.append('源文字可定位，但对应照片与档口未唯一映射，保留待核验')
 t,row=rowmeta(line);variants=[]
 if r['stallId']=='c01_t49' and 297<=line<=308:
  assert row and t['header'][1:3]==['小份','大份']
  for j,spec in enumerate(['小份','大份'],1):
   expr=row['cells'][j]
   if expr=='—':continue
   match=re.search(r'(\d+(?:\.\d+)?)',expr);assert match;variants.append({'amount':float(match[1]),'expression':expr,'spec':spec,'evidence':'明确小份/大份表头及同一源行价签；恢复旧工具漏掉的大份价'})
 else:
  spec=r['gen']['specLabel'] or None;expr=None
  if row:
   col=next((j for j,h in enumerate(t['header']) if spec and h==spec),None)
   if col is None:col=next((j for j,h in enumerate(t['header']) if h=='价格'),1)
   if col<len(row['cells']):expr=row['cells'][col]
  if not expr:expr=str(r['price'])+'（原生成器解析值；对应源行见sourceQuote）'
  variants=[{'amount':r['price'],'expression':expr,'spec':spec,'evidence':'既有解析结果回指原表；未改数值'}]
 refs=[ref];pendingExtra=None
 if r['id']=='c01_d185':
  decisionLine=next(i+1 for i,l in enumerate(lines) if '14.9 = 辣椒炒肉' in l)
  source['decisionRefs']=[f'source_assets/TRANSCRIPTION_2F.md:{decisionLine}'];source['priceMeaning']='已记录裁决区分14.9辣椒炒肉/17.9肥肠，不按份量推断'
  pendingExtra=ref+'-DECLARED-FEICHANG';refs.append(pendingExtra)
  raw.append({**source,'sourceRecordRef':pendingExtra,'name':'辣椒炒肥肠','derivation':'转录记载的负责人裁决，非牌面原文新识别','decisionSourceLine':decisionLine})
  unresolved.append({'recordRef':pendingExtra,'oldRecordKeys':[o['recordKey']],'name':'辣椒炒肥肠','stallRef':o['shot'],'sourceLine':decisionLine,'sourceQuote':lines[decisionLine-1],'reasons':['业务口径已记载，不重开；正确签署材料定位及对应照片待补','被引用DR-SET-R2实际仅约束W2-03八款双拼，不可冒称其签署W2-10'],'nextAction':'只补正确裁决引用和原图定位，不重新询问已记录价义','status':'PENDING_EVIDENCE_LINK'})
 if reasons:
  unresolved.append({'recordRef':ref,'oldRecordKeys':[o['recordKey']],'name':r['name'],'stallRef':o['shot'],'sourceLine':line,'sourceQuote':quote,'reasons':reasons,'nextAction':'按缺口补唯一照片索引/明确实体范围，元数据继续延期','status':'PENDING'})
 else:
  for j,v in enumerate(variants,1):
   candidates.append({'candidateId':ref+'-V'+str(j),'formalDishId':None,'sourceRecordRef':ref,'name':r['name'],'stallRef':o['shot'],'stallName':o['stallName'],'shopRef':'c01_MODEL_ONLY','floorRef':'c01_f2_MODEL_ONLY','amount':v['amount'],'rawPriceExpression':v['expression'],'specification':v['spec'],'specificationEvidence':v['evidence'],'currency':'CNY','unitRaw':None,'sourceFile':source['sourceFile'],'sourceLine':line,'sourceQuote':quote,'photoEvidence':photo,'businessDecisionRefs':['source_assets/TRANSCRIPTION_2F.md已裁决三做法/三基底/双规格'] if spec else [],'oldRecordKeys':[o['recordKey']],'currentPriceValidity':'UNKNOWN','captureDate':None,'collector':None,'tastes':r['tastes'],'foodType':r['foodType'],'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_HISTORICAL_CANDIDATE_NOT_FORMALLY_IMPORTABLE','transactionQuoteAllowed':False,'blockers':['正式ID/准入未授权','采集元数据延期','父级正式核验/当前时效未知'],'reusedPrior39':r['id'] in {f'c01_d{i}' for i in range(502,541)}})
 action='SPLIT' if len(variants)>1 or pendingExtra else 'PENDING' if reasons else 'RETAIN'
 ledger.append({'oldRecordKey':o['recordKey'],'oldDishId':o['dishId'],'oldName':o['name'],'oldStallId':o['stallId'],'oldSource':o['sourceFile']+':'+o['sourceLine'],'newSourceRefs':refs,'action':action,'reason':'明确规格列拆分/已记录独立菜品裁决拆分，不继承旧ID' if action=='SPLIT' else ';'.join(reasons) if reasons else '原菜名/原价源项保留，仅用新批次局部ID'})
# Six NG01 source responsibilities: one base, five surcharge groups; never six independent dishes.
ngold=[r for r in coverage if r['generationStatus']=='not_generated'];assert len(ngold)==6
ngphoto=pathlib.Path(R/'项目/evidence/ds-session-1e2717cc/sha256_5a4feb479cd48e43c1ac30fab10800417d55dca87519f98119ae5624232d8fcf.jpg');assert ngphoto.exists()
for o in ngold:
 line=int(o['sourceLine']);ref=f'R04-NG01-L{line:04d}';raw.append({'sourceRecordRef':ref,'name':o['name'],'stallRef':'W2-06','sourceFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':line,'sourceQuote':lines[line-1],'oldRecordKeys':[o['recordKey']],'relationKind':'base' if line==340 else 'optional_surcharge'})
 if line==340:
  candidates.append({'candidateId':ref+'-V1','formalDishId':None,'sourceRecordRef':ref,'name':'含蛋基础手抓饼','stallRef':'W2-06','stallName':o['stallName'],'shopRef':'c01_MODEL_ONLY','floorRef':'c01_f2_MODEL_ONLY','amount':4,'rawPriceExpression':'4 元','specification':None,'currency':'CNY','unitRaw':'份','unitEvidence':'负责人NG01 D1；非从照片推断','eggIncluded':True,'sourceFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':340,'sourceQuote':lines[339],'photoEvidence':{'originalPath':str(ngphoto),'originalPathSHA256':sha(ngphoto),'mappingBasis':'已批准NG01材料+既有OCR加料单价/基础含蛋文字，不提升整体核实'},'businessDecisionRefs':['source_assets/NG01_owner_material.md 当前D1/D2'],'oldRecordKeys':[o['recordKey']],'currentPriceValidity':'UNKNOWN','captureDate':None,'collector':None,'foodType':None,'tastes':[],'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_HISTORICAL_CANDIDATE_NOT_FORMALLY_IMPORTABLE','transactionQuoteAllowed':False,'blockers':['结构/正式ID及准入待审','采集元数据延期'],'reusedPrior39':False})
 else:
  source=next(x for x in ng['optionalSurchargeRows'] if x['sourceLine']==line);options.append({'optionRef':ref,'baseCandidateRef':'R04-NG01-L0340-V1','name':source['name'],'members':source['members'],'additionalPriceYuan':source['additionalPriceYuan'],'priceAppliesTo':'each_named_member_not_whole_slash_group','selectionConstraints':None,'repeatQuantityAllowed':None,'independentDish':False,'sourceFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':line,'sourceQuote':lines[line-1],'decisionRef':'source_assets/NG01_owner_material.md D2','oldRecordKeys':[o['recordKey']]})
 ledger.append({'oldRecordKey':o['recordKey'],'oldDishId':'','oldName':o['name'],'oldStallId':o['stallId'],'oldSource':o['sourceFile']+':'+o['sourceLine'],'newSourceRefs':[ref],'action':'REPLACE','reason':'负责人D1/D2已确认：基础菜品或关联加价组，不作五道独立菜'})
# Candidate-owned groups plus relation-owned groups plus unresolved groups must cover all new source refs.
assert len(ledger)==382 and len({l['oldRecordKey'] for l in ledger})==382
assert len(candidates)==113 and len(options)==5
assert len({c['candidateId'] for c in candidates})==113
cross=[]
for stall in sorted({r['stallId'] for r in coverage}):
 os=[r for r in coverage if r['stallId']==stall];cross.append({'sourceStallRef':os[0]['shot'],'sourceName':os[0]['stallName'],'oldStallIdForTrace':stall,'oldSourceRecords':len(os),'identityStatus':'source/owner-model association, not formal signoff','formalStallIdAssigned':False,'mergeDecision':'W2-04/W2-05继续独立，不因相同做法合并' if stall in ['c01_t48','c01_t49'] else 'no new merge'})
wc('replacement_ledger.csv',ledger);dump('replacement_ledger.json',ledger);dump('new_source_records.json',raw);dump('candidates.json',candidates);dump('optional_surcharges.json',options);wc('unresolved.csv',unresolved);wc('stall_crosswalk.csv',cross)
stats={'selectedFloor':'服务楼2F','oldRecords':382,'oldGenerated':376,'oldNotGenerated':6,'newSourceGroups':len(raw),'oldActions':dict(collections.Counter(l['action'] for l in ledger)),'candidateRecords':len(candidates),'candidateUnderlyingGroups':len({c['sourceRecordRef'] for c in candidates}),'candidateStalls':len({c['stallRef'] for c in candidates}),'prior39Reused':sum(c['reusedPrior39'] for c in candidates),'additionalCandidatesBeyondPrior39':sum(not c['reusedPrior39'] for c in candidates),'surchargeGroups':5,'unresolvedItems':len(unresolved),'restoredLargePortions':sum(c['specification']=='大份' and c['stallRef']=='W2-05' for c in candidates),'formalIdsAssigned':0,'formallyImportable':0};dump('statistics.json',stats)
assert all(sha(x['path'])==x['sha256'] for x in project)
dump('git_after.json',{k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('staged',['diff','--cached','--name-status']),('status',['status','--porcelain=v1','-uall'])]});assert J(E/'git_after.json')==gbefore
print(json.dumps(stats,ensure_ascii=False,indent=2))
