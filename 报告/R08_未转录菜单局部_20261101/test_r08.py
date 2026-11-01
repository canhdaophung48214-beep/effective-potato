import pathlib,json,hashlib,copy,re,subprocess
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');O=J('optional_surcharges.json');G=J('source_groups.json');L=J('source_ledger.json');ocr={pathlib.Path(r['path']).name:r for r in J('ocr_raw.json')};N=0
def ok(x):assert x
def test(n,f):
 global N
 f();N+=1;print('PASS '+n)
def validate(cs,os):
 assert len(cs)==2 and len(os)==5 and len({c['candidateId'] for c in cs+os})==7
 for c in cs+os:
  e=c['evidence'];line=ocr[e['ocrPhotoKey']]['lines'][e['ocrLine']-1];assert line==e['sourceQuote'];assert e['matchedText'] in re.sub(r'\s+','',line)
  assert sha(E/e['photoFile'])==e['photoSHA256']
  assert c['independentDish'] is False and c['formalDishId'] is None and c['composition'] is None and c['specification'] is None
  assert c['floorRef'] is None and c['captureDate'] is None and c['collector'] is None and c['tastes']==[]
  assert c['transactionQuoteAllowed'] is False and c['currentPriceValidity']=='UNKNOWN'
  assert c['amount']==(1 if c['recordKind']=='meal_component' else 5 if 'BEEF' in c['sourceRecordRef'] else 2)
  if c['recordKind']=='optional_surcharge':assert c['baseCandidateRef'] is None and c['selectionConstraints'] is None
  assert c['unitRaw']==('份' if '-C05-' in c['sourceRecordRef'] else None)
test('7项新增组件/关系逐条OCR行及照片哈希可复核',lambda:validate(C,O))
test('10图实际离线OCR成功',lambda:ok(len(ocr)==10 and all(r['status']=='OCR_COMPLETED' for r in ocr.values())))
test('主食组件2不冒充独立菜品',lambda:ok(len(C)==2 and all(c['recordKind']=='meal_component' and not c['independentDish'] for c in C)))
test('加料5不独立菜、不假定基础菜',lambda:ok(len(O)==5 and all(not o['independentDish'] and o['baseCandidateRef'] is None for o in O)))
test('15材料责任唯一完整',lambda:ok(len(G)==len(L)==15 and len({g['sourceRecordRef'] for g in G})==15 and {g['sourceRecordRef'] for g in G}=={l['sourceRecordRef'] for l in L}))
test('2候选+5关系+8待核验守恒',lambda:ok(sum(g['blocked'] for g in G)==8 and len(C)+len(O)+sum(g['blocked'] for g in G)==15))
test('不重新生成R07金针菇关系',lambda:ok(not any('金针菇' in c['name'] for c in C+O)))
for n,mut in [('伪造价格',lambda c,o:c[0].update(amount=99)),('改为独立菜品',lambda c,o:c[0].update(independentDish=True)),('未知楼层填充',lambda c,o:c[0].update(floorRef='fourth2')),('上传日期冒充采集',lambda c,o:c[0].update(captureDate='2026-10-27')),('当前报价',lambda c,o:c[0].update(transactionQuoteAllowed=True)),('伪造OCR引文',lambda c,o:c[0]['evidence'].update(sourceQuote='假照片证据')),('加料强绑基础菜',lambda c,o:o[0].update(baseCandidateRef='fake')),('未知单位填份',lambda c,o:c[0].update(unitRaw='份'))]:
 def neg(mut=mut):
  c=copy.deepcopy(C);o=copy.deepcopy(O);mut(c,o)
  try:validate(c,o)
  except AssertionError:return
  raise AssertionError('变异未检测')
 test('负向:'+n,neg)
test('原图快照与before备份逐字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==(E/x['snapshot']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in J('backup_manifest.json'))))
test('正式项目字节未改',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03-R07冻结成果全部字节不变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git状态未变',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check exit=',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
