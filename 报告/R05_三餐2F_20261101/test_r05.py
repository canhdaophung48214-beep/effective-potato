import pathlib,json,csv,hashlib,copy,subprocess,re,collections
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def read(n):
 with (E/n).open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
C=J('candidates.json');G=J('source_groups.json');L=J('replacement_ledger.json');O=J('optional_surcharges.json');U=read('unresolved.csv');old={o['dish_id']:o for o in read('source_assets/old_dishes.csv') if o['shop_id']=='c02'};lines=(E/'source_assets/TRANSCRIPTION_DRAFT.md').read_text(encoding='utf-8-sig').splitlines();N=0

def ok(x):assert x
def test(name,f):
 global N
 f();N+=1;print('PASS '+name)
def validate(cs,os):
 assert len(cs)==30 and len({c['candidateId'] for c in cs})==30
 assert len({(c['stallRef'],c['name'],c['specification']) for c in cs})==30
 for c in cs:
  assert c['sourceQuote']==lines[c['sourceLine']-1]
  cells=[x.strip() for x in c['sourceQuote'].strip('|').split('|')]
  assert c['name']==cells[0] and c['rawPriceExpression']==cells[1] and c['amount']==float(cells[1]) and c['foodType']==cells[2]
  assert '⚠' not in cells[0] and '小苏肉' not in c['name']
  assert c['formalDishId'] is None and c['captureDate'] is None and c['collector'] is None and c['unitRaw'] is None
  assert c['currentPriceValidity']=='UNKNOWN' and c['transactionQuoteAllowed'] is False and c['tastes']==[]
  assert c['specification'] is None and c['composition'] is None
  assert sha(E/c['photoEvidence']['file'])==c['photoEvidence']['sha256']
  assert len(c['oldRecordKeys'])==1
  o=old[c['oldRecordKeys'][0]];assert o['dish_name']==c['name'] and float(o['price'])==c['amount']
  st=next(x for x in read('source_assets/old_stalls.csv') if x['stall_id']==o['stall_id']);assert pathlib.Path(st['evidence_file']).name==pathlib.Path(c['photoEvidence']['file']).name
 for o in os:
  assert o['independentDish'] is False and o['selectionConstraints'] is None and o['baseCandidateRef'] is None
  assert o['sourceQuote']==lines[o['sourceLine']-1]
  assert re.search(re.escape(o['name'])+r'\s+'+re.escape(str(o['additionalPriceYuan']).removesuffix('.0'))+r'(?![\d.])',o['sourceQuote'])
test('30候选逐项原名原价/源行/照片映射校验',lambda:validate(C,O))
test('35旧记录责任唯一完整',lambda:ok(len([l for l in L if l['oldRecordKey']])==35 and {l['oldRecordKey'] for l in L if l['oldRecordKey']}==set(old)))
test('47源组唯一',lambda:ok(len(G)==47 and len({g['sourceRecordRef'] for g in G})==47))
test('39物理源行与47展开源组分别复算',lambda:ok(len({g['sourceLine'] for g in G})==39 and collections.Counter(g['kind'] for g in G)=={'dish':36,'optional_surcharge':8,'bundle':3}))
test('台账须合并newSourceRefs和optionRefs才能完整覆盖',lambda:ok({r for l in L for r in l['newSourceRefs']+l['optionRefs']}=={g['sourceRecordRef'] for g in G} and len([r for l in L for r in l['newSourceRefs']+l['optionRefs']])==47))
test('候选30+加料8+待核验9互斥守恒',lambda:ok(len(C)+len(O)+len(U)==47 and {c['sourceRecordRef'] for c in C}|{o['sourceRecordRef'] for o in O}|{u['sourceRecordRef'] for u in U}=={g['sourceRecordRef'] for g in G}))
test('不把候选数冒充规格数：显式规格0',lambda:ok(all(c['specification'] is None for c in C) and J('statistics.json')['explicitSpecificationVariants']==0))
test('旧5项疑问+新1疑问+3套餐留待核验',lambda:ok(len(U)==9 and sum(u['kind']=='dish' for u in U)==6 and sum(u['kind']=='bundle' for u in U)==3))
test('双拼菜名不推导具体组成',lambda:ok(next(c for c in C if c['name']=='双拼炸酱面')['composition'] is None))
test('加料8项独立关系、不变独立菜品',lambda:ok(len(O)==8 and not {o['optionRef'] for o in O}&{c['candidateId'] for c in C}))
test('三套餐保留源成分文字但不强推组件ID',lambda:ok(len(J('bundle_relations.json'))==3 and all(r['componentCandidateRefs'] is None for r in J('bundle_relations.json'))))
test('三档口独立无合并',lambda:ok(len(read('stall_crosswalk.csv'))==3 and len({c['stallRef'] for c in C})==3))
for name,fn in [('改价',lambda cs,os:cs[0].update(amount=99)),('旧正式ID继承',lambda cs,os:cs[0].update(formalDishId=cs[0]['oldRecordKeys'][0])),('伪造采集日期',lambda cs,os:cs[0].update(captureDate='2026-11-01')),('伪造计价单位',lambda cs,os:cs[0].update(unitRaw='份')),('启用当前报价',lambda cs,os:cs[0].update(transactionQuoteAllowed=True)),('候选重复',lambda cs,os:cs.__setitem__(1,copy.deepcopy(cs[0]))),('照片映射错误',lambda cs,os:cs[0]['photoEvidence'].update(file='source_assets/c02_t02_menu.jpg')),('加料误作独立菜',lambda cs,os:os[0].update(independentDish=True)),('编造口味',lambda cs,os:cs[0].update(tastes=['light'])),('编造双拼组成',lambda cs,os:next(c for c in cs if c['name']=='双拼炸酱面').update(composition=['鸡蛋','肉酱']))]:
 def neg(fn=fn):
  cs=copy.deepcopy(C);os=copy.deepcopy(O);fn(cs,os)
  try:validate(cs,os)
  except AssertionError:return
  raise AssertionError('负向数据未被发现')
 test('负向:'+name,neg)
test('所有快照及外部备份逐字节一致',lambda:ok(all(pathlib.Path(x['original']).read_bytes()==pathlib.Path(x['snapshot']).read_bytes() and (not x['backup'].startswith(str(R/'备份')) or pathlib.Path(x['backup']).read_bytes()==pathlib.Path(x['original']).read_bytes()) for x in J('backup_manifest.json'))))
test('正式项目所有既有文件字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('project_before.json'))))
test('R03/R04已关闭成果全部字节未变',lambda:ok(all(sha(x['path'])==x['sha256'] for x in J('closed_batches_before.json'))))
after={}
for k,a in {'head':['rev-parse','HEAD'],'branch':['branch','--show-current'],'staged':['diff','--cached','--name-status'],'status':['status','--porcelain=v1','-uall']}.items():
 r=subprocess.run(['git','-c','core.quotepath=false',*a],cwd=P,capture_output=True,text=True,encoding='utf8');assert r.returncode==0;after[k]=r.stdout
(E/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf8');test('Git HEAD/分支/暂存/工作区状态不变',lambda:ok(after==J('git_before.json')))
r=subprocess.run(['git','diff','--check'],cwd=P,capture_output=True,text=True);print('COMMAND git diff --check EXIT',r.returncode);print(r.stdout+r.stderr);assert r.returncode==0
print(f'RESULT {N} PASS / 0 FAIL / 0 SKIP; exit=0')
