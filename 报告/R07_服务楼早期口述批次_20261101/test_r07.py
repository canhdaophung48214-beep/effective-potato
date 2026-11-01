import pathlib,json,csv,hashlib,copy,re,subprocess
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def read(n):
 with (E/n).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');G=J('source_groups.json');L=J('source_ledger.json');O=J('optional_surcharges.json');U=read('unresolved.csv');old={o['dish_id']:o for o in read('source_assets/old_dishes.csv') if o['shop_id']=='c01'};lines=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();N=0

def ok(x):assert x
def test(n,f):
 global N
 f();N+=1;print('PASS '+n)
def norm(s):return s.replace('加','').replace('+','')
def validate(cs,os):
 assert len(cs)==38 and len({c['candidateId'] for c in cs})==38
 assert len({(c['stallRef'],c['name']) for c in cs})==38
 for c in cs:
  assert c['sourceQuote']==lines[c['sourceLine']-1]
  cells=[v.strip() for v in c['sourceQuote'].strip('|').split('|')];assert c['name']==cells[0] and c['amount']==float(cells[1]) and c['rawPriceExpression']==cells[1]
  o=old[c['oldRecordKeys'][0].split(':')[1]];assert norm(o['dish_name'])==norm(c['name']) and float(o['price'])==c['amount']
  assert c['stallRef']=='R07-EARLY-S'+o['stall_id'][-2:]
  assert c['formalDishId'] is None and c['collector'] is None and c['captureDate'] is None and c['unitRaw'] is None
  assert c['specification'] is None and c['composition'] is None and c['tastes']==[] and c['currentPriceValidity']=='UNKNOWN' and c['transactionQuoteAllowed'] is False
  assert c['photoEvidence'] is None and c['sourceEvidenceType']=='USER_ORAL_TRANSCRIPT' and c['photoStatus']=='NOT_ARCHIVED_FOR_THIS_STALL'
  assert c['name']!='月亮馍（+辣条）'
 for o in os:
  assert o['sourceQuote']==lines[o['sourceLine']-1] and o['independentDish'] is False and o['baseCandidateRef'] is None and o['selectionConstraints'] is None
  assert o['name'] in o['sourceQuote'] and str(o['additionalPriceYuan']).removesuffix('.0') in o['sourceQuote']
  assert o['unitRaw'] in [None,'个','片']
test('38候选原名原价原行及口述证据不伪装照片',lambda:validate(C,O))
test('39旧责任唯一完整',lambda:ok(len([l for l in L if l['oldRecordKeys']])==39 and {k for l in L for k in l['oldRecordKeys']}=={'early_batch1:'+k for k in old}))
test('43物理行/67源组独立统计',lambda:ok(len({g['sourceLine'] for g in G})==43 and len(G)==67 and len({g['sourceRecordRef'] for g in G})==67))
test('候选38+加料24+阻断5互斥覆盖',lambda:ok(len(C)+len(O)+sum(u['blocksCandidate']=='True' for u in U)==67 and {c['sourceRecordRef'] for c in C}|{o['sourceRecordRef'] for o in O}|{u['sourceRecordRef'] for u in U if u['blocksCandidate']=='True'}=={g['sourceRecordRef'] for g in G}))
test('台账包含optionRefs不遗漏24加料',lambda:ok({r for l in L for r in l['newSourceRefs']+l['optionRefs']}=={g['sourceRecordRef'] for g in G}))
test('加料分布5/12/7，按各字与价格组展开',lambda:ok([sum(o['stallRef']==f'R07-EARLY-S{i:02d}' for o in O) for i in [1,2,3]]==[5,12,7]))
test('月亮馍辣条疑问留待核验',lambda:ok(any(u['name']=='月亮馍（+辣条）' and u['blocksCandidate']=='True' for u in U)))
test('四项无价不生成候选',lambda:ok(sum(g['kind']=='unpriced_item' for g in G)==4 and not any(c['sourceRecordRef'].find('UNPRICED')>=0 for c in C)))
test('同名不同档口不自动合并',lambda:ok(len(read('same_name_crosscheck.csv'))>0 and len({c['candidateId'] for c in C})==38))
test('38照片缺口不伪装成38条完全无证据',lambda:ok(sum(u['blocksCandidate']=='False' for u in U)==38 and all(c['sourceQuote'] for c in C)))
for name,mut in [('改价',lambda c,o:c[0].update(amount=999)),('旧ID继承',lambda c,o:c[0].update(formalDishId='c01_d001')),('伪造日期',lambda c,o:c[0].update(captureDate='2026-10-22')),('伪造照片',lambda c,o:c[0].update(photoEvidence={'file':'other.jpg'})),('推断口味',lambda c,o:c[0].update(tastes=['light'])),('交易报价',lambda c,o:c[0].update(transactionQuoteAllowed=True)),('重复记录',lambda c,o:c.__setitem__(1,copy.deepcopy(c[0]))),('加料独立菜',lambda c,o:o[0].update(independentDish=True)),('猜组合',lambda c,o:c[0].update(composition=['肉卷'])),('跨档口映射',lambda c,o:c[0].update(stallRef='R07-EARLY-S02'))]:
 def neg(mut=mut):
  cs=copy.deepcopy(C);os=copy.deepcopy(O);mut(cs,os)
  try:validate(cs,os)
  except AssertionError:return
  raise AssertionError('变异未被检测')
 test('负向:'+name,neg)
test('before备份与快照逐字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==(E/x['snapshot']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in J('backup_manifest.json'))))
test('正式项目所有字节不变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03-R06所有成果字节不变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git状态及暂存HEAD保持一致',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('git diff --check exit=',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
