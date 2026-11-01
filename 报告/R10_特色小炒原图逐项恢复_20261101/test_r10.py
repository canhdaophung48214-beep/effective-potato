import pathlib,json,re,hashlib,copy,subprocess
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');G=J('source_groups.json');L=J('source_ledger.json');ocr=J('photo_ocr.json');lines=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();N=0
def ok(x):assert x
def test(n,f):
 global N
 f();N+=1;print('PASS '+n)
def validate(cs):
 assert len(cs)==15 and len({c['candidateId'] for c in cs})==15 and len({c['name'] for c in cs})==15
 for c in cs:
  e=c['evidence'];q=ocr['lines'][e['ocrLine']-1];assert q==e['ocrQuote'] and e['matchedText'] in re.sub(r'\s+','',q) and e['matchedText']==c['name']+str(c['amount'])+'元'
  assert e['sourceQuote']==lines[e['sourceLine']-1];cells=[v.strip() for v in e['sourceQuote'].strip('|').split('|')];assert c['name'] in cells[0].split(' / ') and cells[1]==str(c['amount'])+' 元'
  assert sha(E/e['photoFile'])==e['photoSHA256']
  assert c['formalDishId'] is None and c['collector'] is None and c['captureDate'] is None and c['floorRef'] is None and c['unitRaw'] is None and c['tastes']==[]
  assert c['composition'] is None and c['specification'] is None and c['transactionQuoteAllowed'] is False and c['currentPriceValidity']=='UNKNOWN'
  assert c['recordKind']=='dish' and c['independentDish'] is True
test('15主菜源文精确成员与OCR同行价一致',lambda:validate(C))
test('37展开源项=15候选+22待核验',lambda:ok(len(G)==37 and sum(g['blocked'] for g in G)==22 and len({g['sourceRecordRef'] for g in G})==37))
test('37台账责任唯一完整',lambda:ok(len(L)==37 and {l['sourceRecordRef'] for l in L}=={g['sourceRecordRef'] for g in G}))
expected=[]
for ln in range(613,626):expected.extend([x.strip() for x in lines[ln-1].strip('|').split('|')[0].split(' / ')])
test('主表13物理行37成员全覆盖无尾行漏项',lambda:ok({g['name'] for g in G}==set(expected) and len(expected)==37))
test('0组件0加料0套餐',lambda:ok(J('optional_surcharges.json')==[] and J('bundle_relations.json')==[]))
for n,mut in [('改价',lambda c:c[0].update(amount=99)),('改名',lambda c:c[0].update(name='无来源新菜')),('伪造日期',lambda c:c[0].update(captureDate='2026-10-23')),('正式ID',lambda c:c[0].update(formalDishId='c01_d001')),('猜辣',lambda c:c[0].update(tastes=['spicy'])),('报价',lambda c:c[0].update(transactionQuoteAllowed=True)),('重复',lambda c:c.__setitem__(1,copy.deepcopy(c[0]))),('猜组合',lambda c:c[0].update(composition=['米饭']))]:
 def neg(mut=mut):
  cs=copy.deepcopy(C);mut(cs)
  try:validate(cs)
  except AssertionError:return
  raise AssertionError('变异未发现')
 test('负向:'+n,neg)
test('备份逐字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==(E/x['snapshot']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in J('backup_manifest.json'))))
test('正式项目字节不变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03-R09交付字节不变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git状态不变',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check exit=',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
