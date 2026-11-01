import pathlib,json,csv,hashlib,shutil,subprocess,datetime,collections
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目';B=R/'备份'/('R06_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def read(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()} for r in rs)
def git(*a):
 x=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert x.returncode==0;return x.stdout
dump('git_before.json',{k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()})
dump('project_before.json',[{'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts])
dump('closed_before.json',[{'path':str(p),'sha256':sha(p)} for d in ['R03_3F_R2_20261101','R04_2F_20261101','R05_三餐2F_20261101'] for p in (R/'报告'/d).rglob('*') if p.is_file()])
inputs=[(P/'tools/pilot/TRANSCRIPTION_DRAFT.md','TRANSCRIPTION_DRAFT.md'),(P/'tools/pilot/batch1/dishes.csv','batch1_dishes.csv'),(P/'tools/pilot/batch1/stalls.csv','batch1_stalls.csv'),(P/'tools/pilot/c03_offsite_batch2/dishes.csv','unlocated_dishes.csv'),(P/'tools/pilot/c03_offsite_batch2/stalls.csv','unlocated_stalls.csv'),(P/'tools/pilot/c03_offsite_batch2/shops.csv','unlocated_shops.csv'),(P/'tools/pilot/c03_offsite_batch2/floors.csv','unlocated_floors.csv'),(P/'tools/pilot/c03_offsite_batch2/采集说明.md','collection_notes.md')]
inputs += [(p,'unlocated_images/'+p.name) for p in (P/'tools/pilot/c03_offsite_batch2/img').glob('*.jpg')]
inputs += [(P/'tools/pilot/batch1/img/c03_t01_menu.jpg','fourth_menu.jpg')]
man=[]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;q.parent.mkdir(parents=True,exist_ok=True);b.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();man.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('backup_manifest.json',man);(B/'manifest.json').write_text(json.dumps(man,ensure_ascii=False,indent=2),encoding='utf8')
lines=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();old=[r for r in read(E/'source_assets/batch1_dishes.csv') if r['shop_id']=='c03'];assert len(old)==8
rows=read(E/'source_assets/unlocated_dishes.csv');assert len(rows)==132
stalls={r['stall_id']:r for r in read(E/'source_assets/unlocated_stalls.csv')};C=[];U=[];L=[];G=[];cross=[]
def candidate(ref,name,amount,raw,source,ln,quote,stall,photo,keys,kind='dish',floor=None,food=None):
 return {'candidateId':ref+'-V1','formalDishId':None,'sourceRecordRef':ref,'name':name,'amount':amount,'rawPriceExpression':raw,'currency':'CNY','unitRaw':None,'specification':None,'composition':None,'recordKind':kind,'stallRef':stall,'floorRef':floor,'sourceFile':source,'sourceLine':ln,'sourceQuote':quote,'oldRecordKeys':keys,'photoEvidence':{'file':photo.relative_to(E).as_posix(),'sha256':sha(photo),'strength':'existing collection CSV mapping; no new visual audit'},'foodType':food,'tastes':[],'collector':None,'captureDate':None,'currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_HISTORY_ONLY_NOT_FORMALLY_AUTHORIZED','parentVerificationStatus':'PENDING'}
parsed=json.loads((E/'parsed_source.json').read_text(encoding='utf8'))
for t in parsed['tables']:
 if not t['section'].startswith('3.1 窗口') or t['header'][0]!='菜名':continue
 for r in t['rows']:
  cells=r['cells'];ln=r['line'];ref=f'R06-FOURTH-L{ln:04d}';name=cells[0].replace('⚠','').strip();matches=[o for o in old if o['dish_name']==name];assert len(matches)<=1;keys=['batch1:'+o['dish_id'] for o in matches];blocked='⚠' in cells[0]
  g={'sourceRecordRef':ref,'sourceBatch':'FOURTH_2F','name':name,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'oldRecordKeys':keys};G.append(g)
  if blocked:U.append({'sourceRecordRef':ref,'name':name,'blockingCandidate':True,'reason':'原转录明确标记名称疑字','unknownFields':['name'],'nextAction':'核对原菜单疑字，不以相似菜名补齐'})
  else:C.append(candidate(ref,name,float(cells[1]),cells[1],g['sourceFile'],ln,g['sourceQuote'],'R06-FOURTH-S01',E/'source_assets/fourth_menu.jpg',keys,floor='FOURTH_2F_OWNER_REPORTED',food=cells[2]))
  L.append({'sourceRecordRef':ref,'sourceBatch':'FOURTH_2F','oldRecordKeys':keys,'action':'RETAIN' if matches else 'NEW','candidateRef':ref+'-V1' if not blocked else None,'result':'PENDING_NAME' if blocked else 'CANDIDATE','name':name,'sourceFile':g['sourceFile'],'sourceLine':ln})
for i,o in enumerate(rows,2):
 ref=f'R06-UNLOCATED-R{i:04d}';source='source_assets/unlocated_dishes.csv';ln=i;quote=(E/source).read_text(encoding='utf-8-sig').splitlines()[i-1];photo=E/'source_assets/unlocated_images'/pathlib.Path(o['evidence_file']).name;assert photo.exists();stall='R06-UNLOCATED-'+o['stall_id'];keys=['offsite_batch2:'+o['dish_id']]
 g={'sourceRecordRef':ref,'sourceBatch':'UNLOCATED_COLLECTION','name':o['dish_name'],'sourceFile':source,'sourceLine':ln,'sourceQuote':quote,'oldRecordKeys':keys,'originalFoodType':o['food_type'],'originalTastes':o['tastes'],'originalCollector':o['collector'],'originalCollectDate':o['collect_date'],'originalSourceDetail':o['source_detail']};G.append(g)
 c=candidate(ref,o['dish_name'],float(o['price']),o['price'],source,ln,quote,stall,photo,keys,kind='bundle' if '套餐' in o['dish_name'] else 'dish');c['sourceBatch']='UNLOCATED_COLLECTION';C.append(c)
 U.append({'sourceRecordRef':ref,'name':o['dish_name'],'blockingCandidate':False,'reason':'楼层未定；旧口味含choice占位/菜名推断不作直接事实；类型为旧映射未视为原图明示','unknownFields':['floorRef','tastes','foodType'],'nextAction':'保留已证实菜名历史标价；字段级后续核验，不要求区域裁决'})
 L.append({'sourceRecordRef':ref,'sourceBatch':'UNLOCATED_COLLECTION','oldRecordKeys':keys,'action':'RETAIN','candidateRef':ref+'-V1','result':'CANDIDATE_WITH_UNKNOWN_FIELDS','name':o['dish_name'],'sourceFile':source,'sourceLine':ln})
cross.append({'stallRef':'R06-FOURTH-S01','sourceBatch':'FOURTH_2F','oldStallIdForTrace':'batch1:c03_t01','name':'卤大姨 · 泰卤干饭局','floorStatus':'历史负责人四餐二楼陈述；正式父级核验待补','candidateCount':8})
for sid,s in stalls.items():cross.append({'stallRef':'R06-UNLOCATED-'+sid,'sourceBatch':'UNLOCATED_COLLECTION','oldStallIdForTrace':'offsite_batch2:'+sid,'name':s['stall_name'],'floorStatus':'UNKNOWN','candidateCount':sum(c['stallRef']=='R06-UNLOCATED-'+sid for c in C)})
assert len(C)==140 and len(G)==142 and len(L)==142 and len(U)==134
assert len({(c['stallRef'],c['name'],c['specification']) for c in C})==140
wc('source_ledger.csv',L);dump('source_ledger.json',L);dump('source_groups.json',G);dump('candidates.json',C);wc('unresolved.csv',U);wc('stall_crosswalk.csv',cross)
dump('relationship_data.json',{'optionalSurcharges':[],'note':'132旧CSV未收录加料，本轮未转录照片新增加料，不虚构；套餐只按源名标记bundle，composition=null；不改NG01/NG03既有关系','unrepresentedSourceMaterial':'collection_notes.md §四记录称重店、加料和遮挡项，本批142逐记录范围不冒称覆盖这些未逐行采集项'})
stats={'originalRecords':142,'fourthMenuRows':10,'unlocatedCsvRows':132,'oldRecords':140,'candidates':140,'candidateSourceGroups':140,'blockingUnresolved':2,'nonBlockingFieldIssues':132,'unresolvedCsvRows':134,'oldRetained':140,'oldReplaced':0,'oldVoided':0,'newSourceResponsibilities':2,'explicitSpecificationVariants':0,'formalIdsAssigned':0,'formalImports':0,'candidateStallDistribution':dict(collections.Counter(c['stallRef'] for c in C))};dump('statistics.json',stats);print(json.dumps(stats,ensure_ascii=False,indent=2));print('build exit=0')
