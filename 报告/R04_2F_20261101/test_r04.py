import pathlib,json,csv,hashlib,copy,subprocess
E=pathlib.Path(__file__).parent;R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def csvread(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
C=J('candidates.json');L=J('replacement_ledger.json');S=J('new_source_records.json');O=J('optional_surcharges.json');U=csvread(E/'unresolved.csv');lines=(E/'source_assets/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();N=0

def test(label,fn):
 global N
 fn();N+=1;print('PASS',label)
def check(x):assert x

def validate(cs):
 assert len(cs)==113 and len({c['candidateId'] for c in cs})==113
 for c in cs:
  assert c['formalDishId'] is None and c['transactionQuoteAllowed'] is False
  assert c['currentPriceValidity']=='UNKNOWN' and c['collector'] is None and c['captureDate'] is None
  assert c['sourceQuote']==lines[c['sourceLine']-1]
  assert sha(c['photoEvidence']['originalPath'])==c['photoEvidence']['originalPathSHA256']
  assert ' / ' not in c['name']
  assert float(c['amount']) in [float(v) for v in __import__('re').findall(r'\d+(?:\.\d+)?',c['rawPriceExpression'])]
  if c['stallRef']=='W2-05' and 297<=c['sourceLine']<=308:
   cells=[v.strip() for v in c['sourceQuote'].strip().strip('|').split('|')];idx={'小份':1,'大份':2}[c['specification']]
   assert cells[idx]==c['rawPriceExpression'] and cells[idx]!='—'

test('113条候选字段、源行、照片哈希及价格直接对应',lambda:validate(C))
coverage=[r for r in csvread(R/'报告/R01_E2_20261101_evidence/record_coverage_525.csv') if r['sourceFile'].endswith('TRANSCRIPTION_2F.md')]
test('382条旧记录唯一且全部有去向',lambda:check(len(L)==382 and {x['oldRecordKey'] for x in L}=={x['recordKey'] for x in coverage}))
test('383源组唯一',lambda:check(len(S)==383 and len({x['sourceRecordRef'] for x in S})==383))
test('源组候选/选项/待核验互斥守恒',lambda:check(len({c['sourceRecordRef'] for c in C})==105 and len(U)==273 and {c['sourceRecordRef'] for c in C}|{o['optionRef'] for o in O}|{u['recordRef'] for u in U}=={s['sourceRecordRef'] for s in S} and 105+5+273==383))
test('双向追溯无遗漏',lambda:check({r for l in L for r in l['newSourceRefs']}=={s['sourceRecordRef'] for s in S} and all(any(c['sourceRecordRef'] in l['newSourceRefs'] and l['oldRecordKey'] in c['oldRecordKeys'] for l in L) for c in C)))
test('明确规格12源行变20条，恢复8条大份',lambda:check(len([c for c in C if c['stallRef']=='W2-05' and 297<=c['sourceLine']<=308])==20 and sum(c['specification']=='大份' for c in C)==8))
test('既有39复用但不重复计入新增',lambda:check(sum(c['reusedPrior39'] for c in C)==39 and sum(not c['reusedPrior39'] for c in C)==74))
base=next(c for c in C if c['stallRef']=='W2-06')
test('NG01基础含蛋4元份',lambda:check(base['amount']==4 and base['unitRaw']=='份' and base['eggIncluded']))
test('五组加料不是五道菜且不编造组合规则',lambda:check(len(O)==5 and all(o['baseCandidateRef']==base['candidateId'] and o['independentDish'] is False and o['selectionConstraints'] is None and o['repeatQuantityAllowed'] is None for o in O)))
test('价格待确认行不进入候选',lambda:check(all('待确认' not in c['sourceQuote'] for c in C)))
test('W2-10价义拆分但证据链未全时继续隔离',lambda:check(len(next(l for l in L if l['oldDishId']=='c01_d185')['newSourceRefs'])==2 and not any('c01_d185' in c['candidateId'] for c in C) and any('FEICHANG' in u['recordRef'] for u in U)))
test('16档口保留对应、不擅自合并',lambda:check(len(csvread(E/'stall_crosswalk.csv'))==16))
for label,mut in [('改价',lambda c:c[0].update(amount=9999)),('复制正式ID',lambda c:c[0].update(formalDishId='c01_d001')),('开启报价',lambda c:c[0].update(transactionQuoteAllowed=True)),('伪造日期',lambda c:c[0].update(captureDate='2026-11-01')),('重复候选',lambda c:c.__setitem__(1,copy.deepcopy(c[0]))),('错误源行',lambda c:c[0].update(sourceQuote='伪造来源'))]:
 def negative(mut=mut):
  c=copy.deepcopy(C);mut(c)
  try:validate(c)
  except AssertionError:return
  raise AssertionError('未检测到负向数据')
 test('负向:'+label,negative)
test('原始材料快照逐字节一致',lambda:check(all((E/x['snapshot']).read_bytes()==pathlib.Path(x['original']).read_bytes() for x in J('source_inputs.json'))))
test('正式项目全部文件哈希保持不变',lambda:check(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03已关闭交付未修改',lambda:check(sha(J('R03_closed_fingerprint.json')['path'])==J('R03_closed_fingerprint.json')['sha256']))
test('Git前后状态、HEAD和暂存区一致',lambda:check(J('git_before.json')==J('git_after.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check:',r.returncode,r.stdout,r.stderr);assert r.returncode==0
print(f'RESULT: {N} PASS / 0 FAIL / 0 SKIP; exit=0')
