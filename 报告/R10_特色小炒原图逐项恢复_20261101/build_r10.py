import pathlib,json,csv,re,hashlib,shutil,datetime,subprocess
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目';B=R/'备份'/('R10_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def J(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def dump(n,v):(E/n).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def wc(n,rs):
 with (E/n).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in r.items()} for r in rs)
closed=[p for p in (R/'报告').iterdir() if p.is_dir() and re.match(r'R0[3-9]_',p.name)];dump('closed_before.json',[{'path':str(p),'sha256':sha(p)} for d in closed for p in d.rglob('*') if p.is_file()])
dump('project_before.json',[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts])
def git(*a):
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;return r.stdout
dump('git_before.json',{k:git(*a) for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items()})
photo=P/'evidence/ds-session-1e2717cc/sha256_6c425a9df62764c447df8841579c01b4eb86abd715b5527824c777061cd26c9f.jpg';inputs=[(photo,'photo_2F16.jpg'),(R/'报告/R01_E3_evidence/ocr_raw.json','prior_ocr_raw.json'),(P/'tools/pilot/TRANSCRIPTION_2F.md','TRANSCRIPTION_2F.md')];M=[]
for p,n in inputs:
 q=E/'source_assets'/n;b=B/n;shutil.copyfile(p,q);shutil.copyfile(p,b);assert p.read_bytes()==q.read_bytes()==b.read_bytes();M.append({'original':str(p),'snapshot':q.relative_to(E).as_posix(),'backup':str(b),'bytes':p.stat().st_size,'sha256':sha(p)})
dump('backup_manifest.json',M);(B/'manifest.json').write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding='utf8')
ocr=next(x for x in J(E/'source_assets/prior_ocr_raw.json') if photo.name in x['path']);assert ocr['status']=='OCR_COMPLETED';dump('photo_ocr.json',ocr);lines=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();old=J(R/'报告/R04_2F_20261101/new_source_records.json');source={}
for ln in range(613,626):
 q=lines[ln-1]
 if not q.startswith('|') or not re.search(r'\d+ 元',q):continue
 cells=[x.strip() for x in q.strip('|').split('|')];price=int(re.search(r'\d+',cells[1])[0])
 for name in cells[0].split(' / '):source[name]=(ln,price,q)
C=[];G=[];L=[];U=[];seen=set()
for ol,q in enumerate(ocr['lines'],1):
 compact=re.sub(r'\s+','',q)
 for m in re.finditer(r'([\u4e00-\u9fff]{2,20})(\d{1,2})元',compact):
  name=m[1];price=int(m[2])
  if name not in source or name in seen:continue
  ln,expected,quote=source[name]
  if price!=expected:continue
  prior=next(x for x in old if x.get('oldStallIdForTrace')=='c01_t15' and x['sourceLine']==ln);ref=f'R10-2F16-D{len(C)+1:02d}';ev={'photoFile':'source_assets/photo_2F16.jpg','photoSHA256':sha(photo),'ocrLine':ol,'ocrQuote':q,'matchedText':m[0],'sourceFile':'source_assets/TRANSCRIPTION_2F.md','sourceLine':ln,'sourceQuote':quote,'evidenceLevel':'same-line OCR + exact source item and price; no human signoff'}
  c={'candidateId':ref+'-V1','sourceRecordRef':ref,'name':name,'recordKind':'dish','independentDish':True,'formalDishId':None,'amount':price,'rawPriceExpression':m[2]+'元','unitRaw':None,'specification':None,'composition':None,'tastes':[],'foodType':None,'collector':None,'captureDate':None,'floorRef':None,'stallRef':'R10-PHOTO-2F16','currentPriceValidity':'UNKNOWN','transactionQuoteAllowed':False,'verifyStatus':'unverified','verifiedAt':None,'admissionStatus':'ISOLATED_HISTORY_NOT_FORMALLY_AUTHORIZED','priorPendingSourceRef':prior['sourceRecordRef'],'oldRecordKeys':prior['oldRecordKeys'],'evidence':ev};C.append(c);seen.add(name);G.append({'sourceRecordRef':ref,'name':name,'blocked':False,'disposition':'CANDIDATE','evidence':ev});L.append({'sourceRecordRef':ref,'action':'NEW','priorPendingSourceRef':prior['sourceRecordRef'],'candidateRefs':[c['candidateId']],'name':name,'reason':'new child OCR evidence; frozen parent unchanged'})
for name,(ln,price,quote) in source.items():
 if name in seen:continue
 ref=f'R10-PENDING-L{ln}-{len(U)+1:02d}';U.append({'sourceRecordRef':ref,'name':name,'reason':'未获得菜名同OCR行准确价格；不按价列位置/相似字纠正','sourceLine':ln,'sourceQuote':quote});G.append({'sourceRecordRef':ref,'name':name,'blocked':True,'disposition':'PENDING'});L.append({'sourceRecordRef':ref,'action':'PENDING','priorPendingSourceRef':None,'candidateRefs':[],'name':name,'reason':'source text retained; OCR inline evidence insufficient'})
assert C;dump('candidates.json',C);dump('source_groups.json',G);dump('source_ledger.json',L);wc('source_ledger.csv',L);wc('unresolved.csv',U);dump('optional_surcharges.json',[]);dump('bundle_relations.json',[]);dump('statistics.json',{'sourcePhotos':1,'transcriptionDishItems':len(source),'independentDishCandidates':len(C),'mealComponents':0,'optionalSurcharges':0,'bundleRelations':0,'pendingDishItems':len(U),'sourceGroups':len(G),'oldRecordsChanged':0,'formalImports':0});print(json.dumps(J(E/'statistics.json'),ensure_ascii=False,indent=2));print('build exit=0')
