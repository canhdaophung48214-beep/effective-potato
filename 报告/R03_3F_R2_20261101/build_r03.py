import pathlib,json,csv,re,hashlib,collections,ast,subprocess,datetime
import sys
R=pathlib.Path.cwd();P=R/'项目';E=pathlib.Path(sys.argv[sys.argv.index('--out-dir')+1]).resolve() if '--out-dir' in sys.argv else R/'报告/R03_3F_R2_20261101';SRC=E/'source_assets/TRANSCRIPTION_3F_R2.md'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def dump(n,x): (E/n).write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def wc(n,rows,fields=None):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields or list(rows[0]),extrasaction='ignore');w.writeheader()
  for r in rows:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()})
before=[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];dump('project_before.json',before)
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
gbefore={k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]};dump('git_before.json',gbefore)
lines=SRC.read_text(encoding='utf-8-sig').splitlines();starts=[(i,re.match(r'### (T\d+) (.*)',l)) for i,l in enumerate(lines) if re.match(r'### T\d+ ',l)];sections={}
for j,(start,m) in enumerate(starts):
 end=starts[j+1][0] if j+1<len(starts) else next(i for i in range(start+1,len(lines)) if lines[i].startswith('## 三'))
 sections[m[1]]={'title':m[2],'start':start,'end':end,'photoLabels':re.findall(r'P\d+',m[2])}
# Actual original/crop paths come from existing crop scripts; never assign a permanent stall ID.
jobs={}
for script in [E/'source_assets/tools/_crop3f.py',E/'source_assets/tools/_crop3f2.py']:
 tree=ast.parse(script.read_text(encoding='utf-8-sig'))
 for node in tree.body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='JOBS' for t in node.targets):
   for name,rel,box in ast.literal_eval(node.value):jobs[name]={'originalPath':str(pathlib.Path('C:/Users/25975/.dsh/attachments/v1/objects')/rel),'cropPath':'source_assets/crops/'+name+'.png','relativeCropBox':box,'mappingBasis':script.relative_to(E).as_posix()+' JOBS '+name}
photoBy={'T02':'haiyuan','T05':'wangji','T07':'chapao','T09':'shuijiao','T10':'liuwan','T12':'laisuo','T13':'ng03_prior','T14':'xiangshu','T15':'lafanqie','T16':'baoye','T17':'xiaolongbao','T18':'jiangdao','T19':'gigi','T20':'lirou','T21':'wukexin'}
jobs['ng03_prior']={'originalPath':str(P/'evidence/ds-session-1e2717cc/sha256_f57786adfa9c14525683250af226fb430962a85643cdc10b4007d497e337fe1d.jpg'),'cropPath':str(P/'evidence/ds-session-1e2717cc/sha256_f57786adfa9c14525683250af226fb430962a85643cdc10b4007d497e337fe1d.jpg'),'relativeCropBox':None,'mappingBasis':'既有NG03已裁决材料的历史原图支持；不是声称找到本轮P17对象，P17路径仍待索引','R2PhotoObjectLinked':False}
for key,v in jobs.items():
 for field in ['originalPath','cropPath']:
  p=pathlib.Path(v[field]);p=p if p.is_absolute() else E/p;v[field+'Exists']=p.exists()
  if p.exists():v[field+'SHA256']=sha(p)
dump('photo_source_index.json',{'scriptMappings':jobs,'stallCropAssociations':photoBy,'note':'T/P编号对应由R2转录标题和现有裁剪脚本标签关联；不等于逐图全部文字再次人工核实。没有对应原图路径的条目隔离。'})
raw=[]
def add(t,name,prices,line,kind='dish',specs=None,countScope='core',decision=None):
 key=f'R03-{t}-L{line:04d}-{len(raw)+1:03d}'
 raw.append({'sourceRecordRef':key,'stallRef':t,'stallName':sections[t]['title'],'name':name.strip(),'rawPriceExpressions':prices,'specLabels':specs or [],'menuKind':kind,'countScope':countScope,'sourceFile':'source_assets/TRANSCRIPTION_3F_R2.md','sourceLine':line,'sourceQuote':lines[line-1],'photoLabels':sections[t]['photoLabels'],'photoEvidence':jobs.get(photoBy.get(t,'')),'businessDecision':decision,'oldRecordKeys':[]})
for t,s in sections.items():
 context=''
 for i in range(s['start']+1,s['end']):
  l=lines[i]
  if l.startswith('**'):context=l
  if not l.startswith('|'):continue
  c=[v.strip() for v in l.split('|')][1:-1]
  if len(c)<2 or c[0] in ['菜品','项目'] or re.match(r'^[-:]+$',c[0]) or not re.search(r'\d', ''.join(c[1:])):continue
  if t=='T09' and '等 9' in c[0]:continue
  kind='drink' if t=='T14' else 'package' if t=='T18' or (t=='T11' and '套餐' in c[0]) else 'combination' if t=='T07' or (t=='T19' and '拼' in c[0]) else 'dish'
  specs=['小碗','中碗','大碗'] if t=='T05' else ['小份','大份'] if t=='T02' and len(c)>=3 and c[2]!='—' else []
  pricecells=c[1:4] if t=='T05' else c[1:3] if t=='T02' else c[1:2]
  if t=='T02' and pricecells[-1]=='—':pricecells=pricecells[:1]
  add(t,c[0],pricecells,i+1,kind,specs,decision='NG03 D1自选双拼/米饭与所有菜品无限续；D3独立整份价；D4滑蛋非同档口同体系；具体组成未知' if t=='T13' else None)
# Explicit non-table menu rows which form the claimed subtotals; no name inference.
def findline(t,needle):return next(i+1 for i in range(sections[t]['start'],sections[t]['end']) if needle in lines[i])
def inline_prices(t,needle,kind='dish',scope='core'):
 n=findline(t,needle);s=lines[n-1];body=s.split('：',1)[-1].replace('**','')
 for part in re.split('[、，]',body):
  m=re.match(r'\s*(.*?)\s+(\d+(?:\.\d+)?)(.*)$',part.strip())
  if m:add(t,m[1],[m[2]+m[3]],n,kind,countScope=scope)
n=findline('T02','黄番茄米线/面 12')
for name in ['黄番茄米线/面','熔岩火锅米线/面','紫苏麻酱米线/面','酸萝卜老鸭汤米线/面','黄番茄鸡丁米线/面']:add('T02',name,['12'],n,'multi_base')
n=findline('T03','土豆片 / 海带')
for name in lines[n-1].split(' / '):add('T03',name,['1 元/串'],n,'snack')
n=findline('T08','原味五谷鱼粉 /')
for name in lines[n-1].split(' / '):add('T08',name,['14.5 元'],n)
for price,needle in [(1,'菜花串 /'),(2,'豆蔻串 /'),(3,'鸡心串 /')]:
 n=findline('T11',needle)
 for name in lines[n-1].split(' / '):add('T11',name,[f'{price} 元/串'],n,'snack')
for needle,kind in [('花香奶白','drink'),('甄选好茶','drink'),('特色小吃','snack')]:inline_prices('T14',needle,kind)
for needle,kind in [('**粥汤**','soup_or_drink'),('**爽滑小云吞**','dish')]:inline_prices('T17',needle,kind)
# Items omitted from original stall subtotals remain separate, not silently absorbed into 293.
inline_prices('T22','红纸：铁板煎蛋培根拌饭',scope='supplementary')
# parse the prefixed red-paper pair without pretending units agree with old transcription
n=findline('T20','红纸：猪脚面')
for name,price in [('猪脚面','16 元'),('风味鸭腿','4 元/根')]:add('T20',name,[price],n,'dish',countScope='supplementary')
n=findline('T16','招牌套餐：');add('T16','秘制把子肉饭',['12.9 元/份'],n,'package',countScope='supplementary')
n=findline('T11','拉丝芝士热狗棒');add('T11','拉丝芝士热狗棒',['5 元'],n,'snack',countScope='supplementary')
# Ancillary ambiguous/excluded statements preserved as unresolved evidence, not executable dish records.
ancillary=[]
for t,s in sections.items():
 for i in range(s['start']+1,s['end']):
  l=lines[i]
  if re.search('加料|不录|无固定价|无单品价|元起|待补证|待裁决|对应关系不明',l):ancillary.append({'stallRef':t,'sourceLine':i+1,'sourceQuote':l,'disposition':'PRESERVE_AS_AUXILIARY_OR_UNRESOLVED_NOT_AUTO_DISH'})
dump('auxiliary_source_statements.json',ancillary)
old=[r for r in list(csv.DictReader((R/'报告/R01_E2_20261101_evidence/record_coverage_525.csv').open(encoding='utf-8-sig'))) if r['sourceFile'].endswith('TRANSCRIPTION_3F.md')]
bynew=collections.defaultdict(list)
for r in raw:bynew[r['stallRef']].append(r)
# Explicit lineage from named old/new source sections, not shared numeric suffixes.
oldToNew={'c01_t38':'T18','c01_t39':'T19','c01_t40':'T07','c01_t41':'T13','c01_t44':'T20','c01_t45':'T15','c01_t46':'T22','c01_t47':'T21'}
normalize=lambda s:re.sub(r'[\s·（）()]','',s)
ledger=[]
for o in old:
 t=oldToNew.get(o['stallId']);reason=''
 if o['stallId']=='c01_t42' and '小笼包' in o['dishName']:t='T17';reason='R2明确小笼包为T17独立档口，不能继续挂W05；仅关联证据，不继承旧ID。'
 matches=[r for r in bynew.get(t,[]) if normalize(r['name'])==normalize(o['dishName'])]
 if o['stallId']=='c01_t41' and o['dishName']=='小炒腊肠（肉）':
  matches=[r for r in bynew['T13'] if r['name']=='小炒腊肠'];reason='R2 T13逐行列表及同组一致说明对应，保留旧名括注，不重新裁决业务。'
 if o['stallId'] in ['c01_t38','c01_t47']:action='VOID';reason='R2明确旧W01/W10整段作废，不能以同名重合继承旧ID；新段独立重建。'
 elif not t:action='PENDING';reason='W05未拍/旧W06无完整新菜单，不能跨档口挪用。'
 elif not matches:
  action='VOID' if o['stallId']=='c01_t44' and int(o['sourceLine']) in range(283,293) else 'PENDING';reason=reason or ('T20卤味明确不录，旧历史留存' if action=='VOID' else '新段未找到一对一同名来源，保留旧来源待核对；不得猜替换目标。')
 else:
  action='REPLACE'
  if t=='T20' and int(o['sourceLine'])<=281:action='RETAIN';reason='仅12项主菜单范围允许原文保留；旧ID仅追溯，候选使用新局部ID。'
  elif t=='T13':reason='既有NG03裁决已落实；小炒腊肠（肉）与小炒腊肠文字不同不自动视作精确相同。'
  reason=reason or '同名源行可追溯，新价格及归属按R2；REPLACE不表示正式改库。'
 for r in matches:
  if action!='VOID':r['oldRecordKeys'].append(o['recordKey'])
 ledger.append({'oldRecordKey':o['recordKey'],'oldDishId':o['dishId'],'oldName':o['dishName'],'oldStallId':o['stallId'],'oldSource':o['sourceFile']+':'+o['sourceLine'],'newStallRef':t or '', 'newSourceRefs':[r['sourceRecordRef'] for r in matches] if action!='VOID' else [],'action':action,'reason':reason})
# Conservative eligibility: no speculative price, no implicit new business rules or unlinked photo.
candidates=[];unresolved=[]
for r in raw:
 why=[];t=r['stallRef']
 if not r['photoEvidence'] or not r['photoEvidence'].get('originalPathExists'):why.append('原始照片P编号到本机对象路径未唯一链接')
 if t=='T04' and '鲜椒鸡' in r['name']:why.append('14.9来自同款推定，原价签遮挡，禁止直接证据')
 if t=='T05':why.append('三规格记录表示待裁决；保存三档原价不擅自取中碗或正式拆ID')
 if r['menuKind'] in ['package','combination']:why.append('套餐/组合结构未获此档口新准入；不能套用NG03裁决')
 if t=='T14':why.append('饮品/推荐池范围待裁决，48与42计数不符')
 if r['menuKind']=='multi_base':why.append('同价米线/面需明确拆分规则与局部身份，先隔离')
 if r['menuKind']=='soup_or_drink':why.append('粥汤/豆浆/鸡蛋混合组用途需明确，不自动作为主菜')
 if t=='T19' and '鱼蛋咖喱' in r['name']:why.append('主表OCR15明确但R2图条摘要16，图文对应仍待复核')
 if r['countScope']=='supplementary':why.append('未纳R2小计的补充价目，单独保存待明确纳入规则')
 vals=[]
 for p in r['rawPriceExpressions']:
  m=re.match(r'^(\d+(?:\.\d+)?)',p)
  if not m:why.append('价格不可独立解析')
  else:vals.append(float(m[1]))
 if why:
  unresolved.append({'recordRef':r['sourceRecordRef'],'stallRef':t,'name':r['name'],'sourceLine':r['sourceLine'],'sourceQuote':r['sourceQuote'],'priceExpressions':r['rawPriceExpressions'],'reason':';'.join(why),'status':'PENDING','nextAction':'按具体问题补原图/业务裁决/照片索引，不阻塞其他候选'})
  continue
 specs=r['specLabels'] or [None]
 for i,spec in enumerate(specs):
  c={'candidateId':r['sourceRecordRef']+'-V'+str(i+1),'formalDishId':None,'name':r['name'],'stallRef':t,'stallName':r['stallName'],'shopRef':'c01_OWNER_MODEL_ONLY','floorRef':'c01_f3_OWNER_MODEL_ONLY','rawPriceExpression':r['rawPriceExpressions'][i if len(specs)>1 else 0],'amount':vals[i if len(specs)>1 else 0],'currency':'CNY','specification':spec,'unitRaw':('250g' if '250g' in r['rawPriceExpressions'][0] else '个' if '/个' in r['rawPriceExpressions'][0] else '笼' if '/笼' in r['rawPriceExpressions'][0] else '串' if '/串' in r['rawPriceExpressions'][0] else None),'sourceFile':r['sourceFile'],'sourceLine':r['sourceLine'],'sourceQuote':r['sourceQuote'],'photoLabels':r['photoLabels'],'photoEvidence':r['photoEvidence'],'businessDecisionRefs':[r['businessDecision']] if r['businessDecision'] else [],'oldRecordKeys':r['oldRecordKeys'],'sourceRecordRef':r['sourceRecordRef'],'admissionStatus':'ISOLATED_HISTORICAL_CANDIDATE_NOT_FORMALLY_IMPORTABLE','blockers':['正式ID/准入未授权','档口与楼层正式核验未完成','类型映射未扩源，不按菜名推测'],'tastes':[],'foodType':None,'currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'verifyStatus':'unverified','verifiedAt':None}
  if t=='T13':c['businessRules']={'mode':'self_select_double_combination','riceRefill':'unlimited','allDishRefill':'unlimited','composition':None,'choiceCount':None,'slideEggRiceSameStall':False,'independentWholeServingPrice':True}
  c['sourceEvidenceLevel']='R2_TRANSCRIPTION_WITH_LOCAL_PHOTO_REFERENCE_NOT_FULL_INDEPENDENT_IMAGE_REAUDIT'
  c['supersedesOldSegments']=['c01_t47/W10_VOID'] if t=='T21' else []
  if t=='T13':c['blockers'].append('R2 P17原始对象路径待索引，现用既有裁决及历史原图作辅助')
  candidates.append(c)
# NG03 has explicit owner business rules; missing original path remains a source indexing blocker, not a reopened decision.
for r in raw:
 if r['stallRef']=='T13':r['resolvedOwnerRules']={'mode':'self_select_double_combination','riceRefill':'unlimited','allDishRefill':'unlimited','composition':None,'choiceCount':None,'independentWholeServingPrice':True,'slideEggRiceSameStall':False}
unresolved.append({'recordRef':'T19-CORN-BANNER','stallRef':'T19','name':'香酥玉米图条','sourceLine':597,'sourceQuote':lines[596],'priceExpressions':['14?','16?'],'reason':'已对原图与局部实际OCR，但香酥玉米名称-价签配对不可靠；不得仅按文字判定','status':'PENDING_ORIGINAL_IMAGE_PAIRING','nextAction':'保留原图c246…和gigi裁剪；明确图条局部对应后再裁定'})
unresolved.append({'recordRef':'T09-FILLINGS-9','stallRef':'T09','name':'九种水饺馅料','sourceLine':findline('T09','副牌「捏一顿水饺」'),'sourceQuote':lines[findline('T09','副牌「捏一顿水饺」')-1],'priceExpressions':['12/15/12（配对未知）'],'reason':'9馅与价格及个数对应不明，不展开27条','status':'PENDING','nextAction':'原牌行列配对或真实经营方明确说明'})
# Add NEW entries for raw records without old lineage; VOID old identities cannot be resurrected.
linked={ref for l in ledger for ref in l['newSourceRefs']}
for r in raw:
 if r['sourceRecordRef'] not in linked:ledger.append({'oldRecordKey':'','oldDishId':'','oldName':'','oldStallId':'','oldSource':'','newStallRef':r['stallRef'],'newSourceRefs':[r['sourceRecordRef']],'action':'NEW','reason':'新源行独立建局部标识；无旧ID继承'})
# count source groups, not variants and not headlines
core=collections.Counter(r['stallRef'] for r in raw if r['countScope']=='core');supp=collections.Counter(r['stallRef'] for r in raw if r['countScope']=='supplementary');claimed=[0,21,15,4,12,0,23,15,1,10,28,9,10,48,15,8,15,7,16,12,15,9]
countTable=[{'stallRef':f'T{i+1:02d}','declaredGroups':v,'enumeratedCoreGroups':core[f'T{i+1:02d}'],'delta':core[f'T{i+1:02d}']-v,'supplementaryGroups':supp[f'T{i+1:02d}']} for i,v in enumerate(claimed)]
# old stall crosswalk documents identity evidence separately from row mapping
cross=[]
for t,s in sections.items():
 oldstalls=[k for k,v in oldToNew.items() if v==t]
 if t=='T17':oldstalls=['c01_t42 (只限错误挂靠的小笼包，不是整体W05)']
 cross.append({'newStallRef':t,'newSignText':s['title'],'oldStallRefs':oldstalls,'relationship':'OLD_SEGMENT_VOID_NEW_SOURCE' if t in ['T18','T21'] else 'CORRECTED_INDEPENDENT_STALL' if t=='T17' else 'NAMED_SOURCE_CROSSWALK_ONLY' if oldstalls else 'NEW_OR_UNMAPPED_STALL','formalIdAssigned':False,'photoLabels':s['photoLabels'],'originalPhotoLinked':bool(t in photoBy),'identityCaveat':'T03稻米香/楚味鸭脖王为同框双品牌，经营主体是否独立不自动合并/拆正式档口' if t=='T03' else '临时T编号不是正式档口ID'})
wc('replacement_ledger.csv',ledger);dump('replacement_ledger.json',ledger);dump('new_source_records.json',raw);dump('candidates.json',candidates);wc('unresolved.csv',unresolved);wc('stall_crosswalk.csv',cross);wc('count_reconciliation.csv',countTable)
stats={'oldRecords':len(old),'oldDisposition':dict(collections.Counter(l['action'] for l in ledger if l['oldRecordKey'])),'newSourceGroups':len(raw),'declared293':sum(claimed),'enumeratedCoreGroups':sum(core.values()),'supplementaryGroups':sum(supp.values()),'physicalMenuTableRows':sum(1 for r in raw if r['sourceQuote'].startswith('|')),'distinctCoreSourceLines':len({r['sourceLine'] for r in raw if r['countScope']=='core'}),'candidateRecords':len(candidates),'candidateStalls':len({c['stallRef'] for c in candidates}),'candidateSpecRecords':sum(c['specification'] is not None for c in candidates),'rawSpecOptions':sum(len(r['specLabels']) for r in raw),'packagesAndCombinationsCore':sum(r['menuKind'] in ['package','combination'] for r in raw if r['countScope']=='core'),'drinkCoreGroups':sum(r['menuKind']=='drink' for r in raw if r['countScope']=='core'),'unresolvedItems':len(unresolved),'formalIdsAssigned':0,'formallyImportable':0}
dump('statistics.json',stats)
# Protected source hashes after all analysis; no generator --write or formal modifications.
assert all(sha(x['path'])==x['sha256'] for x in before)
assert git(['status','--porcelain=v1','-uall']).stdout==gbefore['status'];dump('git_after.json',{k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]})
print(json.dumps(stats,ensure_ascii=False,indent=2));print('count deltas',[r for r in countTable if r['delta']])
