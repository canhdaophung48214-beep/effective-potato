import pathlib,json,csv,hashlib,copy,subprocess,collections
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def read(n):
 with (E/n).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');G=J('source_groups.json');L=J('source_ledger.json');U=read('unresolved.csv');old=read('source_assets/unlocated_dishes.csv');draft=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();N=0

def ok(x):assert x
def test(n,f):
 global N
 f();N+=1;print('PASS '+n)
def validate(cs):
 assert len(cs)==140 and len({c['candidateId'] for c in cs})==140
 assert len({(c['stallRef'],c['name'],c['specification']) for c in cs})==140
 for c in cs:
  assert c['formalDishId'] is None and c['verifyStatus']=='unverified' and c['verifiedAt'] is None
  assert c['captureDate'] is None and c['collector'] is None and c['unitRaw'] is None and c['specification'] is None and c['composition'] is None
  assert c['tastes']==[] and c['transactionQuoteAllowed'] is False and c['currentPriceValidity']=='UNKNOWN'
  assert sha(E/c['photoEvidence']['file'])==c['photoEvidence']['sha256']
  sl=(E/c['sourceFile']).read_text(encoding='utf-8-sig').splitlines();assert sl[c['sourceLine']-1]==c['sourceQuote']
  if c['sourceFile'].endswith('unlocated_dishes.csv'):
   o=old[c['sourceLine']-2];assert c['name']==o['dish_name'] and c['amount']==float(o['price']) and c['rawPriceExpression']==o['price']
   assert c['floorRef'] is None and c['foodType'] is None
   assert c['stallRef']=='R06-UNLOCATED-'+o['stall_id'] and pathlib.Path(c['photoEvidence']['file']).name==pathlib.Path(o['evidence_file']).name
   assert c['oldRecordKeys']==['offsite_batch2:'+o['dish_id']]
  else:
   cells=[v.strip() for v in c['sourceQuote'].strip('|').split('|')];assert c['name']==cells[0] and c['amount']==float(cells[1]) and '⚠' not in cells[0]
   assert c['stallRef']=='R06-FOURTH-S01'
test('140候选逐项价格/来源/证据哈希/未知字段校验',lambda:validate(C))
test('142源记录唯一且台账全覆盖',lambda:ok(len(G)==len(L)==142 and len({g['sourceRecordRef'] for g in G})==142 and {l['sourceRecordRef'] for l in L}=={g['sourceRecordRef'] for g in G}))
test('10四餐+132楼层未定分开',lambda:ok(sum(g['sourceBatch']=='FOURTH_2F' for g in G)==10 and sum(g['sourceBatch']=='UNLOCATED_COLLECTION' for g in G)==132))
test('候选140+阻断2=源记录142',lambda:ok({c['sourceRecordRef'] for c in C}|{u['sourceRecordRef'] for u in U if u['blockingCandidate']=='True'}=={g['sourceRecordRef'] for g in G} and sum(u['blockingCandidate']=='True' for u in U)==2))
test('未知楼层132记录仍生成候选',lambda:ok(sum(c['floorRef'] is None for c in C)==132))
test('2疑字源行不得作为候选',lambda:ok(all('⚠' not in c['name'] for c in C) and len([u for u in U if u['blockingCandidate']=='True'])==2))
test('132字段缺口非整条阻断，134待核验行不误报134丢失记录',lambda:ok(len(U)==134 and sum(u['blockingCandidate']=='False' for u in U)==132))
test('140旧记录唯一责任，新源责任2',lambda:ok(sum(bool(l['oldRecordKeys']) for l in L)==140 and len({k for l in L for k in l['oldRecordKeys']})==140 and sum(l['action']=='NEW' for l in L)==2))
test('c03同名空间不同批次不混档口',lambda:ok(any(x['oldStallIdForTrace']=='batch1:c03_t01' for x in read('stall_crosswalk.csv')) and any(x['oldStallIdForTrace']=='offsite_batch2:c03_t01' for x in read('stall_crosswalk.csv'))))
test('称重店没有伪造固定价候选',lambda:ok(not any(c['stallRef'] in ['R06-UNLOCATED-c03_t01','R06-UNLOCATED-c10_t01'] for c in C)))
test('未知组成不猜，未把加料新增成独立菜',lambda:ok(J('relationship_data.json')['optionalSurcharges']==[] and all(c['recordKind'] in ['dish','bundle'] for c in C)))
test('显式规格0与候选140分开',lambda:ok(J('statistics.json')['explicitSpecificationVariants']==0 and all(c['specification'] is None for c in C)))
for name,mut in [('改价',lambda c:c[0].update(amount=999)),('菜名伪造',lambda c:c[0].update(name='无源新菜')),('正式ID继承',lambda c:c[0].update(formalDishId='c03_d075')),('伪造日期',lambda c:c[0].update(captureDate='2026-10-27')),('猜口味',lambda c:c[0].update(tastes=['light'])),('当前报价开放',lambda c:c[0].update(transactionQuoteAllowed=True)),('重复候选',lambda c:c.__setitem__(1,copy.deepcopy(c[0]))),('楼层强挂',lambda c:c[-1].update(floorRef='FOURTH_2F_OWNER_REPORTED')),('旧c03批次混用',lambda c:c[8].update(stallRef='R06-FOURTH-S01')),('套餐组成猜测',lambda c:c[-1].update(composition=['米饭','菜']))]:
 def neg(mut=mut):
  cs=copy.deepcopy(C);mut(cs)
  try:validate(cs)
  except AssertionError:return
  raise AssertionError('负向数据未被发现')
 test('负向:'+name,neg)
test('来源快照与项目外备份字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==(E/x['snapshot']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in J('backup_manifest.json'))))
test('正式项目字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03/R04/R05所有交付字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git HEAD/分支/暂存/工作区一致',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check exit=',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
