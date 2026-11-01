import pathlib,json,csv,hashlib,shutil,subprocess,datetime,re,collections
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目';B=R/'备份'/('R09_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def J(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def read(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in x.items()} for x in rs)
def git(*a):
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;return r.stdout
dump('git_before.json',{k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()})
dump('project_before.json',[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts])
closed=['R03_3F_R2_20261101','R04_2F_20261101','R05_三餐2F_20261101','R06_四餐与楼层未定批次_20261101','R07_服务楼早期口述批次_20261101','R08_未转录菜单局部_20261101'];dump('closed_before.json',[{'path':str(p),'sha256':sha(p)} for d in closed for p in (R/'报告'/d).rglob('*') if p.is_file()])
photo=P/'evidence/ds-session-1e2717cc/sha256_44d50356def22dafc1474cb8c853e5fd4d4e86ec44b87f3cd4afef205e10c528.jpg'
inputs=[(photo,'photo_2F18.jpg'),(R/'报告/R01_E3_evidence/ocr_raw.json','prior_ocr_raw.json'),(P/'tools/pilot/TRANSCRIPTION_2F.md','TRANSCRIPTION_2F.md'),(P/'evidence/PHOTO_MANIFEST_20261025.csv','PHOTO_MANIFEST.csv'),(R/'报告/DSH_R08_未转录菜单局部_独立验收_20261101.md','R08_review.md')];M=[]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();M.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('backup_manifest.json',M);(B/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding='utf8')
ocr=next(x for x in J(E/'source_assets/prior_ocr_raw.json') if photo.name in x['path']);assert ocr['status']=='OCR_COMPLETED';dump('photo_ocr.json',ocr)
lines=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();oldraw=J(R/'报告/R04_2F_20261101/new_source_records.json');oldpending=read(R/'报告/R04_2F_20261101/unresolved.csv');prevc=[(b,c) for b in closed for c in J(R/'报告'/b/'candidates.json')];C=[];G=[];L=[];U=[];cross=[]
# Name and price line numbers are explicit. No global OCR list-to-price alignment.
choices=[('金针菇饭团',42,42,7,'金针菇'),('鲜香卤蛋饭团',43,44,8,'鲜香卤蛋'),('和风蟹柳饭团',45,46,8,'和风蟹柳'),('咸蛋黄肉松饭团',49,50,8,'咸蛋黄肉松'),('拉丝芝士饭团',51,52,10,'拉丝芝士'),('纯肉烤肠饭团',53,54,10,'纯肉烤肠'),('香酥鸡排饭团',55,56,11,'香酥鸡排'),('香煎猪排饭团',57,58,12,'香煎猪排'),('黑椒牛排饭团',59,60,13,'黑椒牛排'),('金枪鱼饭团',61,62,14,'金枪鱼'),('日式鳗鱼饭团',63,64,15,'日式鳗鱼')]
for i,(name,nl,pl,price,token) in enumerate(choices,1):
 ntext=ocr['lines'][nl-1];ptext=ocr['lines'][pl-1];assert name in re.sub(r'\s+','',ntext) and str(price)+'元' in re.sub(r'\s+','',ptext)
 sourceLine=next(j+1 for j,l in enumerate(lines) if 680<=j+1<=690 and token in l);quote=lines[sourceLine-1];assert str(price)+' 元' in quote
 prior=next(x for x in oldraw if x['oldStallIdForTrace']=='c01_t35' and x['sourceLine']==sourceLine);assert any(u['recordRef']==prior['sourceRecordRef'] for u in oldpending)
 ref=f'R09-2F18-RICEBALL-{i:02d}';oldkeys=prior['oldRecordKeys'];ev={'photoFile':'source_assets/photo_2F18.jpg','photoSHA256':sha(photo),'ocrFile':'photo_ocr.json','ocrNameLine':nl,'ocrPriceLine':pl,'ocrNameQuote':ntext,'ocrPriceQuote':ptext,'transcriptionFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':sourceLine,'sourceQuote':quote,'evidenceLevel':'OCR + same-item transcription price crosscheck; no new human visual signoff'}
 g={'sourceRecordRef':ref,'name':name,'kind':'dish','blocked':False,'disposition':'CANDIDATE','priorPendingSourceRef':prior['sourceRecordRef'],'oldRecordKeys':oldkeys,'evidence':ev};G.append(g)
 c={'candidateId':ref+'-V1','sourceRecordRef':ref,'name':name,'recordKind':'dish','independentDish':True,'formalDishId':None,'amount':price,'rawPriceExpression':ptext,'unitRaw':None,'specification':None,'composition':None,'stallRef':'R09-PHOTO-2F18','stallNameClaim':'W2-15 半亩良田（历史转录关联，正式身份待核验）','floorRef':None,'tastes':[],'foodType':None,'collector':None,'captureDate':None,'currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_HISTORY_NOT_FORMALLY_AUTHORIZED','priorPendingSourceRef':prior['sourceRecordRef'],'oldRecordKeys':oldkeys,'evidence':ev};C.append(c)
 L.append({'sourceRecordRef':ref,'action':'NEW','priorDisposition':'R04_PENDING_SOURCE_GROUP','priorPendingSourceRef':prior['sourceRecordRef'],'oldRecordKeys':oldkeys,'candidateRefs':[c['candidateId']],'optionRefs':[],'name':name,'reason':'原图逐项OCR与转录同价交叉；新增子项，不改写R04原责任'})
 for b,pc in prevc:
  if pc.get('name',pc.get('dishName'))==name:cross.append({'name':name,'otherBatch':b,'otherCandidateId':pc['candidateId'],'relation':'same name only; no automatic identity merge'})
# Remaining items are source responsibilities, never synthetic menu rows.
for ref,name,reason,nl in [('R09-2F18-UNRESOLVED-SUSHI','寿司价格列组','原OCR将16菜名与价列分开，不按数组位置强配价',1),('R09-2F18-UNRESOLVED-LOWER','原味/红豆/玉米沙拉/泡菜饭团组','菜名与多个价位排列仍需局部位置确认',35),('R09-2F18-UNRESOLVED-BACON','培根饭团','OCR缺烟字与旧转录烟重/烟熏矛盾，名称不纠造',47),('R09-2F18-UNRESOLVED-TWO','辣条/铁板里脊饭团','同一行价签两项且OCR缺铁字，不推断纠字',65),('R09-2F18-UNRESOLVED-EGGWAFFLE','鸡蛋仔及口味','OCR为100份，原转录10元/份，不假装原图金额已确认',17)]:
 G.append({'sourceRecordRef':ref,'name':name,'kind':'unresolved_material_group','blocked':True,'disposition':'PENDING','evidence':{'photoFile':'source_assets/photo_2F18.jpg','ocrLine':nl,'ocrQuote':ocr['lines'][nl-1]}});U.append({'sourceRecordRef':ref,'name':name,'reason':reason,'photoFile':'source_assets/photo_2F18.jpg','ocrLine':nl,'nextAction':'原图局部定位或清晰材料；不要求延期元数据/区域裁决'});L.append({'sourceRecordRef':ref,'action':'PENDING','priorDisposition':'not individually admitted','priorPendingSourceRef':None,'oldRecordKeys':[],'candidateRefs':[],'optionRefs':[],'name':name,'reason':reason})
assert len(C)==11 and len(G)==16
# No candidate of this photo/name identity was already generated.
assert not any(pc.get('name')==c['name'] and ('44d50356' in json.dumps(pc,ensure_ascii=False)) for c in C for b,pc in prevc)
dump('candidates.json',C);dump('source_groups.json',G);dump('source_ledger.json',L);wc('source_ledger.csv',L);wc('unresolved.csv',U);dump('optional_surcharges.json',[]);dump('bundle_relations.json',[]);dump('same_name_crosscheck.json',cross)
dump('statistics.json',{'sourcePhotos':1,'extractedDishRows':11,'materialResponsibilityGroups':16,'independentDishCandidates':11,'mealComponents':0,'optionalSurcharges':0,'bundleRelations':0,'pendingMaterialGroups':5,'newChildResponsibilities':11,'oldRecordsRewritten':0,'oldRecordsVoided':0,'formalImports':0,'priorPendingParentGroups':len({c['priorPendingSourceRef'] for c in C})})
print(json.dumps(J(E/'statistics.json'),ensure_ascii=False,indent=2));print('build exit=0')
