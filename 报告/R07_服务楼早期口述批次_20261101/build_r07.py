import pathlib,json,csv,hashlib,shutil,subprocess,datetime,re,collections
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目';B=R/'备份'/('R07_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def J(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def read(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()} for r in rs)
def git(*a):
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;return r.stdout
dump('git_before.json',{k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()})
dump('project_before.json',[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts])
batches=['R03_3F_R2_20261101','R04_2F_20261101','R05_三餐2F_20261101','R06_四餐与楼层未定批次_20261101'];dump('closed_before.json',[{'path':str(p),'sha256':sha(p)} for d in batches for p in (R/'报告'/d).rglob('*') if p.is_file()])
inputs=[(P/'tools/pilot/TRANSCRIPTION_DRAFT.md','TRANSCRIPTION_DRAFT.md'),(P/'tools/pilot/batch1/dishes.csv','old_dishes.csv'),(P/'tools/pilot/batch1/stalls.csv','old_stalls.csv'),(P/'tools/pilot/batch1/shops.csv','old_shops.csv'),(P/'tools/pilot/batch1/待补照片清单.md','old_photo_status.md'),(P/'tools/pilot/c01_service_2f/采集卡.md','blank_collection_card.md'),(P/'tools/pilot/c03_offsite_batch2/采集说明.md','remaining_collection_notes.md')];M=[]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();M.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('backup_manifest.json',M);(B/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding='utf8')
lines=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();old=[o for o in read(E/'source_assets/old_dishes.csv') if o['shop_id']=='c01'];assert len(old)==39
C=[];G=[];L=[];U=[];O=[];cross=[];collisions=[];previous=[(b,c) for b in batches for c in J(R/'报告'/b/'candidates.json')]
for t in J(E/'parsed_source.json')['tables']:
 m=re.match(r'1\.([123]) 窗口',t['section'])
 if not m or t['header'][0]!='菜名':continue
 no=int(m[1]);sid=f'c01_t0{no}';stall=f'R07-EARLY-S{no:02d}'
 for row in t['rows']:
  cells=row['cells'];name=cells[0];ln=row['line'];ref=f'R07-EARLY-L{ln:04d}';o=next(o for o in old if o['stall_id']==sid and o['dish_name'].replace('加','').replace('+','')==name.replace('加','').replace('+',''));assert float(o['price'])==float(cells[1]);blocked=name=='月亮馍（+辣条）'
  g={'sourceRecordRef':ref,'kind':'dish','name':name,'stallRef':stall,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'oldRecordKeys':['early_batch1:'+o['dish_id']],'sourceEvidenceType':'USER_ORAL_TRANSCRIPT','originalTastes':o['tastes']};G.append(g)
  if blocked:U.append({'sourceRecordRef':ref,'name':name,'blocksCandidate':True,'reason':'原转录待确认清单第9项明确质疑该窗口是否有辣条选项','nextAction':'业务证据核验；不按同类商品推断'})
  else:C.append({**g,'candidateId':ref+'-V1','formalDishId':None,'amount':float(cells[1]),'rawPriceExpression':cells[1],'currency':'CNY','unitRaw':None,'specification':None,'composition':None,'foodType':cells[2],'tastes':[],'photoEvidence':None,'photoStatus':'NOT_ARCHIVED_FOR_THIS_STALL','parentVerificationStatus':'ORAL_SOURCE_NOT_FORMALLY_SIGNED','collector':None,'captureDate':None,'currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_ORAL_HISTORY_NOT_FORMALLY_AUTHORIZED'})
  L.append({'sourceRecordRef':ref,'oldRecordKeys':g['oldRecordKeys'],'action':'PENDING' if blocked else 'RETAIN','newSourceRefs':[ref],'optionRefs':[],'candidateRefs':[] if blocked else [ref+'-V1'],'name':name,'sourceLine':ln})
  for b,c in previous:
   if c.get('name',c.get('dishName'))==name:collisions.append({'sourceRecordRef':ref,'name':name,'otherBatch':b,'otherCandidateId':c['candidateId'],'decision':'KEEP_SEPARATE_SOURCE_IDENTITY_UNKNOWN; matching name is not same dish/stall'})
  if not blocked:U.append({'sourceRecordRef':ref,'name':name,'blocksCandidate':False,'reason':'口述历史证据已保存，独立照片尚缺；采集元数据延期/当前售价未知','nextAction':'保留隔离候选，未来补菜单证据，不重复询问延期元数据'})
# Itemized relation extraction from explicitly priced oral source lines only.
def option(no,ln,name,price,unit=None):
 i=sum(o['sourceLine']==ln for o in O)+1;ref=f'R07-EARLY-L{ln:04d}-O{i}';o={'sourceRecordRef':ref,'optionRef':ref,'name':name,'additionalPriceYuan':price,'unitRaw':unit,'stallRef':f'R07-EARLY-S{no:02d}','baseCandidateRef':None,'associationScope':'stall_only_unknown_specific_base','selectionConstraints':None,'independentDish':False,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'sourceEvidenceType':'USER_ORAL_TRANSCRIPT'};O.append(o);G.append({**o,'kind':'optional_surcharge','oldRecordKeys':[]});L.append({'sourceRecordRef':ref,'oldRecordKeys':[],'action':'NEW','newSourceRefs':[],'optionRefs':[ref],'candidateRefs':[],'name':name,'sourceLine':ln})
ln=next(i+1 for i,l in enumerate(lines) if l.startswith('加料（不录）：卤蛋 1.5'))
for p in lines[ln-1].split('：',1)[1].split('。')[0].split(' / '):
 m=re.fullmatch(r'(.+?)\s+(\d+(?:\.\d+)?)',p);assert m;option(1,ln,m[1],float(m[2]))
ln=next(i+1 for i,l in enumerate(lines) if l.startswith('另加（不录）：'))
for p in lines[ln-1].split('：',1)[1].rstrip('。').split('；'):
 m=re.fullmatch(r'(.+?)\s+(?:各\s+)?(\d+(?:\.\d+)?)',p);assert m
 for name in m[1].split('/'):option(2,ln,name,float(m[2]))
ln=next(i+1 for i,l in enumerate(lines) if l.startswith('卤味/加料（不录）：'))
for p in lines[ln-1].split('：',1)[1].rstrip('。').split(' / '):
 m=re.fullmatch(r'(.+?)\s+(\d+(?:\.\d+)?)(?:/(个|片))?',p);assert m;option(3,ln,m[1],float(m[2]),m[3])
ln=next(i+1 for i,l in enumerate(lines) if '筋头巴脑、卤鸡腿、兰花干、卤干豆腐' in l)
for i,name in enumerate(['筋头巴脑','卤鸡腿','兰花干','卤干豆腐'],1):
 ref=f'R07-EARLY-L{ln:04d}-UNPRICED{i}';G.append({'sourceRecordRef':ref,'kind':'unpriced_item','name':name,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'oldRecordKeys':[]});U.append({'sourceRecordRef':ref,'name':name,'blocksCandidate':True,'reason':'原文明确未标清价格；不与含同名片段的面品混淆','nextAction':'补充直接价格证据，金额保持UNKNOWN'});L.append({'sourceRecordRef':ref,'oldRecordKeys':[],'action':'NEW','newSourceRefs':[ref],'optionRefs':[],'candidateRefs':[],'name':name,'sourceLine':ln})
assert len(C)==38 and len(O)==24 and len(G)==67 and len(L)==67
for no in range(1,4):
 o=next(o for o in read(E/'source_assets/old_stalls.csv') if o['stall_id']==f'c01_t0{no}');cross.append({'stallRef':f'R07-EARLY-S{no:02d}','oldStallIdForTrace':'early_batch1:'+o['stall_id'],'name':o['stall_name'],'formalStallIdAssigned':False,'photoStatus':'NOT_ARCHIVED','identityStatus':'early oral source only; no merge with later W2/T namespaces'})
dump('candidates.json',C);dump('source_groups.json',G);dump('source_ledger.json',L);wc('source_ledger.csv',L);wc('unresolved.csv',U);dump('optional_surcharges.json',O);wc('stall_crosswalk.csv',cross);wc('same_name_crosscheck.csv',collisions)
dump('statistics.json',{'sourceGroups':67,'physicalSourceLines':len({g['sourceLine'] for g in G}),'dishTableRows':39,'candidateRecords':38,'candidateSourceGroups':38,'optionSourceGroups':24,'unpricedSourceGroups':4,'blockingUnresolved':5,'nonblockingCandidateEvidenceIssues':38,'unresolvedRows':43,'oldRecords':39,'oldRetained':38,'oldPending':1,'newResponsibilities':28,'explicitSpecifications':0,'formalImports':0,'formalIdsAssigned':0,'candidateStallDistribution':dict(collections.Counter(c['stallRef'] for c in C))})
print(json.dumps(J(E/'statistics.json'),ensure_ascii=False,indent=2));print('build exit=0')
