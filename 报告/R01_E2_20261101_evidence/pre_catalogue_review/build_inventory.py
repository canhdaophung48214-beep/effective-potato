import csv,json,hashlib,re,datetime,pathlib,collections
ROOT=pathlib.Path.cwd(); P=ROOT/'项目'; OUT=ROOT/'报告'; E=OUT/'R01_E2_20261101_evidence'
def read(p):return pathlib.Path(p).read_text(encoding='utf-8-sig')
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def dump(p,x):
 p=pathlib.Path(p)
 if p.exists():raise RuntimeError('Refuse overwrite: '+str(p))
 p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def csvwrite(p,rows,fields):
 p=pathlib.Path(p)
 if p.exists():raise RuntimeError('Refuse overwrite: '+str(p))
 with p.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(rows)
def rel(p):return pathlib.Path(p).relative_to(ROOT).as_posix()
records=json.loads(read(E/'current_records.json'))['records']; blockers=json.loads(read(E/'current_blockers.json'))['entries']
TX={f:read(P/'tools/pilot'/f).splitlines() for f in ['TRANSCRIPTION_2F.md','TRANSCRIPTION_3F.md']}
contract=read(P/'docs/RECORD_GENERATOR_CONTRACT_20261023.md').splitlines();stalls={}
for n,l in enumerate(contract,1):
 cells=[x.strip().strip('`') for x in l.split('|')]
 if len(cells)>4 and re.fullmatch(r'c01_t\d+',cells[3]):stalls[cells[3]]={'name':cells[2],'line':n}
def key(r):return '|'.join([r['stallId'],r['gen']['groupKey'],r['gen']['specLabel'],r['gen'].get('disambiguator','')])
bykey={key(r):r for r in records}
assert len(bykey)==len(records)
coverage=[]
for b in blockers:
 r=bykey.get(b['recordKey']);f=('TRANSCRIPTION_3F.md' if '|f3/' in b['recordKey'] else 'TRANSCRIPTION_2F.md');ln=b['sourceLine']
 coverage.append({'recordKey':b['recordKey'],'dishId':r['id'] if r else '', 'dishName':b['name'],'shopId':'c01','shopName':'服务楼','stallId':b['stallId'],'stallName':stalls[b['stallId']]['name'],'sourceFile':rel(P/'tools/pilot'/f),'sourceLine':ln,'sourceQuote':TX[f][ln-1],'generationTier':b['tier'],'generationStatus':'generated' if r else 'not_generated','tastes':json.dumps(r['tastes']) if r else 'NOT_GENERATED','foodType':json.dumps(r['foodType']) if r else 'NOT_GENERATED','classificationScope':'eligible_field_inventory' if r else 'excluded_not_generated','reason':';'.join(b['reasons'])})
assert len(coverage)==525
csvwrite(E/'record_coverage_525.csv',coverage,list(coverage[0]))
# Category headings provide partial evidence only: no dish-name-to-enum inference.
food_heads={'TRANSCRIPTION_2F.md':{91,161,293,312,385,434,446,485,504,519,581,590,635,647,667,678,719},'TRANSCRIPTION_3F.md':{97,112,307,318,328,364}}
rows=[]
for r in records:
 f=r['source']['ref'].split('#')[0];lines=TX[f];ln=r['gen']['sourceLine'];q=lines[ln-1]
 hi=ln-1
 while hi>0 and not re.match(r'^#{2,4} |^\*\*|^[^|]+：$',lines[hi-1]):hi-=1
 heading=lines[hi-1] if hi else ''
 for field in ['tastes','foodType']:
  missing=(r[field]==[] if field=='tastes' else r[field] in (None,''))
  if not missing:continue
  x={'recordKey':key(r),'dishId':r['id'],'dishName':r['name'],'shopId':r['shopId'],'shopName':'服务楼','stallId':r['stallId'],'stallName':stalls[r['stallId']]['name'],'specLabel':r['gen']['specLabel'],'fieldName':field,'originalValue':json.dumps(r[field],ensure_ascii=False,separators=(',',':')),'proposedValue':'','classification':'C','evidenceFile':rel(P/'tools/pilot'/f),'evidenceLocation':str(ln),'evidenceDescription':'已定位原始转录行，但无可靠的字段级枚举证据；不从菜名推断。','confidence':'none','conflictStatus':'NO_RELIABLE_FIELD_EVIDENCE','evidenceQuote':q,'contextLocation':str(hi) if hi else '', 'contextQuote':heading,'originalSource':r['source']['ref'],'sourceSHA256':sha(P/'tools/pilot'/f),'evidenceLevel':'L2_REPOSITORY_TRANSCRIPT_NOT_IMAGE_REVERIFIED','admissionStatus':'NO_FORMAL_WRITE_AUTHORIZATION'}
  compound=' / ' in r['name']
  if compound:x['conflictStatus']='COMPOUND_ROW_SCOPE_UNRESOLVED'
  if field=='tastes':
   inline=re.search(r'[（(](微辣|不辣|香而不辣|辣度适中|辣|原味)[）)]',q)
   if inline:
    word=inline.group(1)
    if word=='微辣' and not compound:
     x.update(classification='A',proposedValue='["mild_spicy"]',confidence='high_for_transcribed_literal',conflictStatus='NONE',evidenceDescription='该菜行独立括注“微辣”；当前 data/index.js:40 标签 mild_spicy=微辣。双规格分别保留；仅报告候选，未获正式写入授权。')
    else:x.update(classification='B',confidence='partial',conflictStatus='COMPOUND_ROW_SCOPE_UNRESOLVED' if compound else 'ENUM_MAPPING_UNCONFIRMED',evidenceDescription='原文明确括注“'+word+'”，但'+('只覆盖组合行部分变体' if compound else '与当前口味枚举并非严格同义')+'；不提出填充值。')
   option=None
   if r['stallId']=='c01_t37':option=(426,'段末口味选项存在，但究竟适用单品、套餐或仅“招牌必点”未确认；不得给全档口填 choice。')
   if f=='TRANSCRIPTION_3F.md' and 310<=ln<=314:option=(316,'烧饼口味六选一属于风味选择，不等于可选辣度；需确认字段语义。')
   if f=='TRANSCRIPTION_3F.md' and 368<=ln<=371:option=(364,'火锅有锅底三选一，不能未经确认等同可选辣度；保留原文线索。')
   if option:
    on,desc=option;x.update(classification='B',confidence='partial',conflictStatus='OPTION_SCOPE_OR_ENUM_UNCONFIRMED',evidenceDescription=desc,contextLocation=str(on),contextQuote=lines[on-1])
  else:
   if hi in food_heads[f]:x.update(classification='B',confidence='partial',conflictStatus='CATEGORY_MAPPING_UNAUTHORIZED',evidenceDescription='所属菜单分组明确，但尚无覆盖此分组的 foodType 枚举映射裁决；分组信息不直接写成类型。现行列映射/套餐例外未覆盖本条。')
   if compound:x['conflictStatus']='COMPOUND_ROW_SCOPE_UNRESOLVED'
  rows.append(x)
fields=list(rows[0]);t=[x for x in rows if x['fieldName']=='tastes'];ft=[x for x in rows if x['fieldName']=='foodType'];cand=[x for x in rows if x['proposedValue']];unresolved=[x for x in rows if not x['proposedValue']]
for name,items in [('R01_E2_tastes_inventory.csv',t),('R01_E2_foodType_inventory.csv',ft),('R01_E2_recovery_candidates.csv',cand),('R01_E2_unresolved.csv',unresolved)]:csvwrite(OUT/name,items,fields)
ts={x['dishId'] for x in t};fts={x['dishId'] for x in ft}
intersection=[x for x in coverage if x['dishId'] in ts&fts];csvwrite(E/'missing_intersection.csv',intersection,list(coverage[0]))
# Inventory every available historical CSV; identifiers alone never establish identity.
csvsources=[];matches=[];collisions=[]
for base in [P,ROOT/'备份',OUT/'R01_20261031']:
 for f in base.rglob('*.csv'):
  if '.git' in f.parts or 'node_modules' in f.parts:continue
  with f.open(encoding='utf-8-sig',newline='') as h:
   cr=csv.DictReader(h);crs=[]
   for rr in cr:crs.append((cr.line_num,rr))
  sourceclass='derived_report_not_independent' if OUT in f.parents else ('historical_backup' if ROOT/'备份' in f.parents else 'repository_csv')
  entry={'path':rel(f),'bytes':f.stat().st_size,'sha256':sha(f),'rows':len(crs),'columns':cr.fieldnames,'role':sourceclass,'strictMatches':0,'idOnlyConflicts':0}
  for n,rr in crs:
   rid=rr.get('dish_id') or rr.get('dishId');targets=[r for r in records if r['id']==rid]
   for r in targets:
    identity=(rr.get('dish_name')==r['name'] and rr.get('shop_id')==r['shopId'] and rr.get('stall_id')==r['stallId'])
    item={'path':rel(f),'line':n,'dishId':rid,'sourceName':rr.get('dish_name'),'currentName':r['name'],'sourceStall':rr.get('stall_id'),'currentStall':r['stallId'],'sourceTastes':rr.get('tastes'),'sourceFoodType':rr.get('food_type'),'role':sourceclass}
    if identity:entry['strictMatches']+=1;matches.append(item)
    else:entry['idOnlyConflicts']+=1;collisions.append(item)
  csvsources.append(entry)
dump(E/'csv_source_catalogue.json',csvsources);dump(E/'csv_identity_matches.json',matches);dump(E/'csv_id_collisions.json',collisions)
# Homonyms are retained separately, never a recovery mapping.
ng=collections.defaultdict(list)
for r in records:ng[r['name']].append({'dishId':r['id'],'stallId':r['stallId'],'spec':r['gen']['specLabel'],'price':r['price'],'source':r['source']['ref']})
dump(E/'same_name_groups.json',[{'name':k,'records':v,'differentStalls':len({i['stallId'] for i in v})>1} for k,v in ng.items() if len(v)>1])
photos=[]
with (P/'evidence/PHOTO_MANIFEST_20261025.csv').open(encoding='utf-8-sig',newline='') as h:
 for n,rr in enumerate(csv.DictReader(h),2):
  p=P/rr['archive_path'];photos.append({'manifestLine':n,'photoId':rr['photo_id'],'path':rel(p),'exists':p.exists(),'hashMatches':p.exists() and sha(p)==rr['sha256'],'mappingStatus':rr['mapping_status'],'imageReview':'PENDING_NO_REGISTERED_VISION_TOOL'})
dump(E/'photo_checks.json',photos)
stat={'scope':{'formalDemo':45,'generatedCandidates':len(records),'sourceItems':len(coverage),'notGenerated':len(coverage)-len(records)},'tastesEmpty':len(t),'foodTypeMissing':len(ft),'intersection':len(ts&fts),'onlyTastes':len(ts-fts),'onlyFoodType':len(fts-ts),'union':len(ts|fts),'classifications':{f:dict(collections.Counter(x['classification'] for x in rows if x['fieldName']==f)) for f in ['tastes','foodType']},'candidateFields':len(cand),'candidateDishes':len({x['dishId'] for x in cand}),'remainUnknownTastes':len(t)-sum(x['classification']=='A' for x in t),'remainUnknownFoodType':len(ft)-sum(x['classification']=='A' for x in ft),'completeTwoFieldCandidates':sum(all(r[f] not in ([],None,'') or any(x['dishId']==r['id'] and x['fieldName']==f for x in cand) for f in ['tastes','foodType']) for r in records),'needsConfirmationUniqueDishes':len({x['dishId'] for x in rows if x['classification']=='B'}),'structuredCompoundRows':len({x['dishId'] for x in rows if x['conflictStatus']=='COMPOUND_ROW_SCOPE_UNRESOLVED'}),'sameNameGroups':sum(len(v)>1 for v in ng.values()),'crossStallSameNameGroups':sum(len({x['stallId'] for x in v})>1 for v in ng.values()),'csvFiles':len(csvsources),'csvStrictMatches':len(matches),'csvIdOnlyConflicts':len(collisions),'photoEntries':len(photos),'photoUnique':len({x['path'] for x in photos})}
dump(E/'statistics.json',stat)
print(json.dumps(stat,ensure_ascii=False,indent=2))
print('candidates',[(x['dishId'],x['proposedValue']) for x in cand])
print('csv independent matches',sum(x['role']!='derived_report_not_independent' for x in matches))
