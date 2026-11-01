import pathlib,json,csv,re,hashlib,copy,subprocess
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');G=J('source_groups.json');L=J('source_ledger.json');ocr=J('photo_ocr.json');lines=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();N=0
def ok(x):assert x
def test(n,f):
 global N
 f();N+=1;print('PASS '+n)
def validate(cs):
 assert len(cs)==11 and len({c['candidateId'] for c in cs})==11 and len({c['name'] for c in cs})==11
 for c in cs:
  ev=c['evidence'];nq=ocr['lines'][ev['ocrNameLine']-1];pq=ocr['lines'][ev['ocrPriceLine']-1];assert nq==ev['ocrNameQuote'] and pq==ev['ocrPriceQuote']
  assert c['name'] in re.sub(r'\s+','',nq)
  assert re.search(r'(?<!\d)'+str(c['amount'])+'元',re.sub(r'\s+','',pq))
  assert ev['ocrPriceLine']-ev['ocrNameLine'] in [0,1]
  assert ev['sourceQuote']==lines[ev['sourceLine']-1] and str(c['amount'])+' 元' in ev['sourceQuote']
  assert sha(E/ev['photoFile'])==ev['photoSHA256'] and c['rawPriceExpression']==pq
  assert c['formalDishId'] is None and c['collector'] is None and c['captureDate'] is None and c['unitRaw'] is None
  assert c['transactionQuoteAllowed'] is False and c['currentPriceValidity']=='UNKNOWN' and c['tastes']==[]
  assert c['specification'] is None and c['composition'] is None and c['recordKind']=='dish' and c['independentDish'] is True
  assert c['stallRef']=='R09-PHOTO-2F18' and c['floorRef'] is None
test('11独立饭团名称/金额/同行或相邻行/原图SHA核验',lambda:validate(C))
test('源组16=候选11+待核验材料组5',lambda:ok(len(G)==16 and sum(g['blocked'] for g in G)==5 and len({g['sourceRecordRef'] for g in G})==16))
test('源台账完整且唯一，不把原父组数量当子项数',lambda:ok(len(L)==16 and {l['sourceRecordRef'] for l in L}=={g['sourceRecordRef'] for g in G} and len({c['priorPendingSourceRef'] for c in C})==8))
old=json.loads((R/'报告/R04_2F_20261101/new_source_records.json').read_text(encoding='utf8'))
test('11子项全部追溯R04待核验父组，不冒充旧正式ID',lambda:ok(all(any(s['sourceRecordRef']==c['priorPendingSourceRef'] and s['oldRecordKeys']==c['oldRecordKeys'] for s in old) for c in C)))
test('不生成组件/加料/套餐',lambda:ok(J('optional_surcharges.json')==[] and J('bundle_relations.json')==[] and all(c['name'].endswith('饭团') for c in C)))
test('无猜测的培根/铁板里脊/鸡蛋仔价',lambda:ok(all(not any(t in c['name'] for t in ['培根','里脊','鸡蛋仔']) for c in C)))
test('原始OCR快照逐项相同',lambda:ok(ocr==next(x for x in J('source_assets/prior_ocr_raw.json') if '44d50356' in x['path'])))
for n,mut in [('改价',lambda c:c[0].update(amount=99)),('改名',lambda c:c[0].update(name='未知新菜饭团')),('误配价行',lambda c:c[0]['evidence'].update(ocrPriceLine=64)),('伪造采集日期',lambda c:c[0].update(captureDate='2026-10-23')),('复制正式ID',lambda c:c[0].update(formalDishId='c01_d999')),('推断口味',lambda c:c[0].update(tastes=['mild_spicy'])),('开放报价',lambda c:c[0].update(transactionQuoteAllowed=True)),('候选重复',lambda c:c.__setitem__(1,copy.deepcopy(c[0]))),('假定套餐成分',lambda c:c[0].update(composition=['米饭','馅料']))]:
 def neg(mut=mut):
  cs=copy.deepcopy(C);mut(cs)
  try:validate(cs)
  except AssertionError:return
  raise AssertionError('变异未捕获')
 test('负向:'+n,neg)
test('所有原始来源/备份/快照逐字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==(E/x['snapshot']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in J('backup_manifest.json'))))
test('正式项目字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03-R08全部冻结成果字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git HEAD/分支/暂存/工作区一致',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check exit=',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
