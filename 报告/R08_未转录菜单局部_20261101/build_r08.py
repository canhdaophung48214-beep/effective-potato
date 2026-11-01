import pathlib,json,csv,hashlib,shutil,subprocess,datetime,re
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目';B=R/'备份'/('R08_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir();(E/'source_assets').mkdir(exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in r.items()} for r in rs)
def git(*a):
 x=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert x.returncode==0;return x.stdout
dump('git_before.json',{k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()})
dump('project_before.json',[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts])
closed=['R03_3F_R2_20261101','R04_2F_20261101','R05_三餐2F_20261101','R06_四餐与楼层未定批次_20261101','R07_服务楼早期口述批次_20261101'];dump('closed_before.json',[{'path':str(p),'sha256':sha(p)} for d in closed for p in (R/'报告'/d).rglob('*') if p.is_file()])
M=[]
inputs=[(p,p.name) for p in (P/'tools/pilot/c03_offsite_batch2/img').glob('*.jpg')]+[(P/'tools/pilot/c03_offsite_batch2/采集说明.md','collection_notes.md'),(R/'报告/DSH_R07_服务楼早期口述批次_独立验收_20261101.md','R07_review.md')]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();M.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('backup_manifest.json',M);(B/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding='utf8')
ocr=json.loads((E/'ocr_raw.json').read_text(encoding='utf-8-sig'));assert len(ocr)==10 and all(r['status']=='OCR_COMPLETED' for r in ocr)
lookup={pathlib.Path(r['path']).name:r for r in ocr};G=[];C=[];O=[];U=[];L=[]
def evidence(photo,needle):
 r=lookup[photo];hits=[(i+1,s) for i,s in enumerate(r['lines']) if needle in re.sub(r'\s+','',s)];assert hits,(photo,needle)
 i,s=hits[-1];return {'photoFile':'source_assets/'+photo,'photoSHA256':sha(E/'source_assets'/photo),'ocrFile':'ocr_raw.json','ocrPhotoKey':photo,'ocrLine':i,'sourceQuote':s,'matchedText':needle,'recognitionMethod':'Windows.Media.Ocr local; no cloud','visualReconfirmation':False}
def add(ref,name,photo,needle,price,kind,unit=None):
 ev=evidence(photo,needle);g={'sourceRecordRef':ref,'name':name,'recordKind':kind,'disposition':'CANDIDATE' if kind=='meal_component' else 'OPTION_RELATION','blocked':False,'evidence':ev};G.append(g)
 c={'candidateId':ref+'-V1','sourceRecordRef':ref,'name':name,'amount':price,'rawPriceExpression':ev['sourceQuote'],'unitRaw':unit,'specification':None,'composition':None,'recordKind':kind,'formalDishId':None,'stallRef':'R08-UNLOCATED-'+photo.split('_')[0]+'_t01','floorRef':None,'collector':None,'captureDate':None,'tastes':[],'currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'independentDish':False,'admissionStatus':'ISOLATED_COMPONENT_NOT_STANDALONE_DISH','verifyStatus':'unverified','verifiedAt':None,'evidence':ev}
 if kind=='meal_component':C.append(c)
 else:O.append({**c,'optionRef':ref,'additionalPriceYuan':price,'baseCandidateRef':None,'selectionConstraints':None})
 L.append({'sourceRecordRef':ref,'action':'NEW','oldRecordRefs':[],'candidateRefs':[c['candidateId']] if kind=='meal_component' else [],'optionRefs':[ref] if kind!='meal_component' else [],'disposition':g['disposition'],'name':name})
add('R08-C03-RICE','米饭','c03_t01_menu.jpg','米饭1元',1,'meal_component')
add('R08-C10-RICE','米饭','c10_t01_menu.jpg','米饭一元',1,'meal_component')
add('R08-C05-NOODLE-ADD','加面','c05_t01_menu.jpg','加面2元/份',2,'optional_surcharge','份')
add('R08-C05-HAM-ADD','火腿片','c05_t01_menu.jpg','火腿片2元/份',2,'optional_surcharge','份')
add('R08-C05-CAKE-ADD','酥油饼','c05_t01_menu.jpg','酥油饼2元/份',2,'optional_surcharge','份')
add('R08-C06-HAM-ADD','火腿片','c06_t01_menu.jpg','火腿片2元',2,'optional_surcharge')
add('R08-C06-BEEF-ADD','肥牛卷','c06_t01_menu.jpg','肥牛卷5元',5,'optional_surcharge')
for ref,name,photo,reason in [('R08-C05-EGGS','煎蛋/卤蛋两项','c05_t01_menu.jpg','OCR仅辨蛋，1.5/7.5混淆，不按常识纠价'),('R08-C05-ONION-CAKE','葱花酥油饼','c05_t01_menu.jpg','同OCR行出现7元/斤与2元/份，价目对应不确定'),('R08-C06-REMAINING','忆米嘉其余加料组','c06_t01_menu.jpg','原说明16项，扣除本批两项，其余14项不完整具名；不虚构展开清单'),('R08-C09-FRIED','赣五爷其余炸货组','c09_t01_menu.jpg','6项中炸金针菇1元已归R07补充，余5项无完整可核对名称价格，禁止重复生成旧关系'),('R08-C08-RECOMMEND','土耳其烤鸡推荐区6项','c08_t01_menu.jpg','OCR无法一一匹配菜名价格，不以5元碎片推价'),('R08-C03-WEIGHT','味爱特称重计价','c03_t01_menu.jpg','OCR为L77元/50g，虽旧说明1.77，但不是固定价独立菜品；保留经营线索不生成菜'),('R08-C10-WEIGHT','航语佳称重计价','c10_t01_menu.jpg','人均价格不是单菜价格，称重范围不可推定'),('R08-PHOTO-TAIL','其他照片未收录碎片','c04_t01_menu.jpg','其余已有菜名价大部分R06覆盖；无法明确匹配新实体者不重复或推断')]:
 ev={'photoFile':'source_assets/'+photo,'photoSHA256':sha(E/'source_assets'/photo),'ocrFile':'ocr_raw.json','ocrPhotoKey':photo};G.append({'sourceRecordRef':ref,'name':name,'recordKind':'unresolved_material_group','disposition':'PENDING','blocked':True,'evidence':ev});U.append({'sourceRecordRef':ref,'name':name,'reason':reason,'sourcePhoto':ev['photoFile'],'disposition':'PENDING','nextAction':'原图局部核对/清晰材料；不重开区域及延期元数据'});L.append({'sourceRecordRef':ref,'action':'PENDING','oldRecordRefs':[],'candidateRefs':[],'optionRefs':[],'disposition':'PENDING','name':name})
dump('candidates.json',C);dump('optional_surcharges.json',O);dump('source_groups.json',G);dump('source_ledger.json',L);wc('source_ledger.csv',L);wc('unresolved.csv',U)
dump('photo_coverage.json',[{'photoFile':'source_assets/'+n,'sha256':sha(E/'source_assets'/n),'ocrStatus':r['status'],'ocrLines':len(r['lines']),'disposition':'R06 old CSV preserved; only new price-bearing components extracted in R08; uncertain fragments pending'} for n,r in lookup.items()])
dump('statistics.json',{'photosProcessed':10,'materialResponsibilityGroups':len(G),'candidateRecords':len(C),'standaloneDishCandidates':0,'mealComponentCandidates':len(C),'optionalSurcharges':len(O),'pendingMaterialGroups':len(U),'oldRecordsChanged':0,'newCandidateOrRelationGroups':7,'formalImports':0})
(E/'technical_debt.md').write_text('R07本地整理已关闭；其文件不修改。DSH三个P3沿用：源组缺独立阻断字段；缺照原因无逐条引用；选项仅整行引文。详见source_assets/R07_review.md §四。五条业务阻断及正式准入继续保留。本轮新源组显式blocked/disposition，不反向重写R07。',encoding='utf8')
print('BUILD: 2 meal components / 0 standalone dishes / 5 options / 8 pending material groups; exit=0')
