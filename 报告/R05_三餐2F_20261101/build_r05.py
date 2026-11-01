import pathlib,json,csv,hashlib,shutil,subprocess,re,collections,datetime
R=pathlib.Path.cwd();P=R/'项目';E=pathlib.Path(__file__).parent.resolve();B=R/'备份'/('R05_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def J(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def read(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def wc(n,rows):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in x.items()} for x in rows)
def git(*a):
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;return r.stdout
state={k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()};dump('git_before.json',state)
project=[{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];dump('project_before.json',project)
closed=[{'path':str(p),'sha256':sha(p)} for d in ['R03_3F_R2_20261101','R04_2F_20261101'] for p in (R/'报告'/d).rglob('*') if p.is_file()];dump('closed_batches_before.json',closed)
inputs=[(P/'tools/pilot/TRANSCRIPTION_DRAFT.md','TRANSCRIPTION_DRAFT.md'),(P/'tools/pilot/batch1/dishes.csv','old_dishes.csv'),(P/'tools/pilot/batch1/stalls.csv','old_stalls.csv'),(P/'tools/pilot/batch1/shops.csv','old_shops.csv'),(P/'tools/pilot/batch1/待补照片清单.md','old_photo_status.md'),(P/'tools/pilot/batch1_min/dishes.csv','batch1_min_dishes.csv'),(P/'tools/pilot/batch1_min/shops.csv','batch1_min_shops.csv'),(P/'docs/decisions/C02_NAMESPACE_CONDITIONAL_APPROVAL_20261026.json','c02_conditional_approval.json')]
manifest=[]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();manifest.append({'original':str(p),'snapshot':str(q),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
for i in range(1,4):
 p=P/f'tools/pilot/batch1/img/c02_t0{i}_menu.jpg';q=E/'source_assets'/p.name;shutil.copyfile(p,q);assert p.read_bytes()==q.read_bytes();manifest.append({'original':str(p),'snapshot':str(q),'bytes':p.stat().st_size,'sha256':sha(p),'backup':'unmodified original retained; snapshot verified'})
dump('backup_manifest.json',manifest);(B/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
lines=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();parsed=J(E/'parsed_source.json');old=[r for r in read(E/'source_assets/old_dishes.csv') if r['shop_id']=='c02'];assert len(old)==35
stalls={r['stall_id']:r for r in read(E/'source_assets/old_stalls.csv') if r['shop_id']=='c02'}
raw=[];C=[];U=[];O=[];ledger=[];relations=[]
for t in parsed['tables']:
 m=re.match(r'2\.([123]) 窗口',t['section'])
 if not m or t['header'][0]!='菜名':continue
 no=int(m[1]);stall=f'R05-SC2F-S{no:02d}';oldstall=f'c02_t0{no}'
 for row in t['rows']:
  cells=row['cells'];name=cells[0].replace('⚠','').strip();ln=row['line'];ref=f'R05-SC2F-L{ln:04d}';matches=[o for o in old if o['stall_id']==oldstall and o['dish_name']==name];assert len(matches)<=1
  reasons=[]
  if '⚠' in cells[0]:reasons.append('转录稿明确标注疑字或括号语义待确认')
  if '小苏肉' in name:reasons.append('转录稿待确认清单第6项保留小苏/小酥字义疑问')
  r={'sourceRecordRef':ref,'name':name,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'stallRef':stall,'kind':'dish','oldRecordKeys':[o['dish_id'] for o in matches]};raw.append(r)
  if reasons:U.append({**r,'reasons':reasons,'classification':'BUSINESS_EVIDENCE_NEEDS_VERIFICATION','nextAction':'只核对疑字/括号，不推测；其他候选继续'})
  else:
   photo=E/'source_assets'/f'c02_t0{no}_menu.jpg'
   C.append({**r,'candidateId':ref+'-V1','formalDishId':None,'amount':float(cells[1]),'rawPriceExpression':cells[1],'specification':None,'currency':'CNY','unitRaw':None,'foodType':cells[2],'tastes':[],'tastesEvidenceStatus':'UNKNOWN;旧choice或按菜名猜辣不继承','shopRef':'R05-SC_MODEL_ONLY','floorRef':'R05-SC2F_MODEL_ONLY','parentVerificationStatus':'OWNER_REPORTED_LOCATION_NOT_FORMALLY_SIGNED','photoEvidence':{'file':photo.relative_to(E).as_posix(),'sha256':sha(photo),'mappingSource':'source_assets/old_stalls.csv','oldStallRefForTrace':oldstall,'strength':'existing explicit batch mapping; archive PHOTO_MANIFEST sample mapping unresolved; no fresh visual claim'},'currentPriceValidity':'UNKNOWN','collector':None,'captureDate':None,'transactionQuoteAllowed':False,'admissionStatus':'ISOLATED_HISTORY_ONLY_NOT_FORMALLY_AUTHORIZED','businessDecisionRefs':['source_assets/c02_conditional_approval.json:scope candidate namespace only'],'composition':None})
  if matches:ledger.append({'oldRecordKey':matches[0]['dish_id'],'oldStallId':oldstall,'oldName':matches[0]['dish_name'],'action':'PENDING' if reasons else 'RETAIN','newSourceRefs':[ref],'optionRefs':[],'candidateRefs':[ref+'-V1'] if not reasons else [],'reason':';'.join(reasons) if reasons else '原名原价源行一致；不继承旧正式ID'})
  else:ledger.append({'oldRecordKey':'','oldStallId':oldstall,'oldName':name,'action':'NEW','newSourceRefs':[ref],'optionRefs':[],'candidateRefs':[],'reason':'源文存在但旧CSV未生成；疑字继续待核验'})
# Auxiliary source rows: add-ons stay attached to stall, not fabricated to a specific dish.
for no,pattern in [(1,'卤味（不录）：卤蛋 1 / 卤肉 6 / 狮子头 2'),(2,'加料（不录）：卤蛋 1 / 卤肠 1.5 / 煎蛋 2 / 辣椒 2 / 豆干 1.5')]:
 ln=next(i+1 for i,l in enumerate(lines) if pattern in l);text=lines[ln-1].split('：',1)[1].split('。')[0]
 for i,part in enumerate(text.split(' / '),1):
  m=re.fullmatch(r'(.+?)\s+(\d+(?:\.\d+)?)',part.strip());assert m
  ref=f'R05-SC2F-L{ln:04d}-O{i}';o={'optionRef':ref,'sourceRecordRef':ref,'name':m[1],'additionalPriceYuan':float(m[2]),'stallRef':f'R05-SC2F-S{no:02d}','baseCandidateRef':None,'associationScope':'stall_only_specific_base_unknown','independentDish':False,'selectionConstraints':None,'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1]};O.append(o);raw.append({**o,'kind':'optional_surcharge','oldRecordKeys':[]});ledger.append({'oldRecordKey':'','oldStallId':f'c02_t0{no}','oldName':m[1],'action':'NEW','newSourceRefs':[],'optionRefs':[ref],'candidateRefs':[],'reason':'源文加料明确，关系独立计数不作菜品'})
ln=next(i+1 for i,l in enumerate(lines) if l.startswith('套餐（不录）：西冷牛排套餐'))
for i,part in enumerate(lines[ln-1].split('：',1)[1].split('（')[0].split(' / '),1):
 m=re.fullmatch(r'(.+?)\s+(\d+(?:\.\d+)?)',part.strip());assert m;ref=f'R05-SC2F-L{ln:04d}-B{i}';r={'sourceRecordRef':ref,'name':m[1],'sourceFile':'source_assets/TRANSCRIPTION_DRAFT.md','sourceLine':ln,'sourceQuote':lines[ln-1],'stallRef':'R05-SC2F-S03','kind':'bundle','oldRecordKeys':[]};raw.append(r)
 # Explicitly excluded by old source/contract; preserve evidence but do not auto-admit a bundle.
 U.append({**r,'reasons':['原文明确套餐不录；当前批次无套餐准入授权，组合成分只保留原句'],'classification':'BUSINESS_EVIDENCE_TECHNICAL_ADMISSION_PENDING','nextAction':'复用组合关系做后续隔离适配；不生成正式菜品'})
 relations.append({'bundleSourceRef':ref,'compositionSourceText':'含意面、煎蛋、西蓝花','componentCandidateRefs':None,'selectionRules':None,'sourceLine':ln})
 ledger.append({'oldRecordKey':'','oldStallId':'c02_t03','oldName':m[1],'action':'NEW','newSourceRefs':[ref],'optionRefs':[],'candidateRefs':[],'reason':'套餐证据单列待适配，不作为普通菜导入'})
assert len(raw)==47 and len(C)==30 and len(O)==8 and len(U)==9
assert {r['oldRecordKey'] for r in ledger if r['oldRecordKey']}=={o['dish_id'] for o in old}
dump('replacement_ledger.json',ledger);wc('replacement_ledger.csv',ledger);dump('candidates.json',C);dump('source_groups.json',raw);dump('optional_surcharges.json',O);dump('bundle_relations.json',relations);wc('unresolved.csv',U)
cross=[{'stallRef':f'R05-SC2F-S{i:02d}','oldStallIdForTrace':f'c02_t0{i}','name':stalls[f'c02_t0{i}']['stall_name'],'photo':f'source_assets/c02_t0{i}_menu.jpg','parentLocation':'三餐二楼最西侧，负责人信息/非正式签发','formalStallIdAssigned':False} for i in range(1,4)];wc('stall_crosswalk.csv',cross)
stats={'physicalSourceLines':len({r['sourceLine'] for r in raw}),'dishTableRows':36,'auxiliaryPhysicalLines':3,'sourceGroups':47,'dishSourceGroups':36,'optionSourceGroups':8,'bundleSourceGroups':3,'explicitSpecificationVariants':0,'candidateRecords':30,'candidateSourceGroups':30,'unresolvedSourceGroups':9,'oldRecords':35,'oldActionCounts':dict(collections.Counter(r['action'] for r in ledger if r['oldRecordKey'])),'newSourceGroups':12,'optionRelations':8,'formalIdsAssigned':0,'formalImports':0};dump('statistics.json',stats)
print(json.dumps(stats,ensure_ascii=False,indent=2));print('build exit=0')
