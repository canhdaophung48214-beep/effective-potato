import unittest,pathlib,json,csv,collections,re,hashlib,copy
E=pathlib.Path(__file__).parent;R=E.parent.parent
J=lambda n:json.loads((E/n).read_text(encoding='utf-8-sig'))
def readcsv(p):
 with p.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))
def asset(p):
 p=pathlib.Path(p);return p if p.is_absolute() else E/p
C=J('candidates.json');N=J('new_source_records.json');L=J('replacement_ledger.json');NM={r['sourceRecordRef']:r for r in N};LM={l['oldRecordKey']:l for l in L if l['oldRecordKey']}
def validate(cs):
 assert len({c['candidateId'] for c in cs})==len(cs)
 for c in cs:
  n=NM[c['sourceRecordRef']]
  assert c['formalDishId'] is None
  assert c['name']==n['name']
  assert c['rawPriceExpression'] in n['rawPriceExpressions']
  if n['specLabels']:assert c['specification'] in n['specLabels']
  else:assert c['specification'] is None
  assert c['stallRef']==n['stallRef'] and c['sourceLine']==n['sourceLine'] and c['sourceQuote']==n['sourceQuote']
  assert c['amount']==float(re.match(r'^(\d+(?:\.\d+)?)',c['rawPriceExpression'])[1])
  assert not (c['stallRef']=='T04' and '鲜椒鸡' in c['name'])
  assert c['sourceFile'].endswith('TRANSCRIPTION_3F_R2.md')
  if '小笼包' in c['name']:assert c['stallRef']=='T17'
  if c['stallRef']=='T13':
   b=c['businessRules'];assert b['mode']=='self_select_double_combination' and b['riceRefill']=='unlimited' and b['allDishRefill']=='unlimited' and b['composition'] is None and b['choiceCount'] is None and b['slideEggRiceSameStall'] is False
  for old in c['oldRecordKeys']:assert LM[old]['action']!='VOID' and c['sourceRecordRef'] in LM[old]['newSourceRefs']
class R03Tests(unittest.TestCase):
 def test_old_all143_covered_exactly_once(self):
  old=readcsv(R/'报告/R01_E2_20261101_evidence/record_coverage_525.csv');old={r['recordKey'] for r in old if r['sourceFile'].endswith('TRANSCRIPTION_3F.md')};self.assertEqual(len(LM),143);self.assertEqual(set(LM),old)
 def test_actions_and_bidirectional_links(self):
  self.assertTrue(all(l['action'] in ['RETAIN','REPLACE','SPLIT','VOID','NEW','PENDING'] for l in L))
  for l in L:
   for ref in l['newSourceRefs']:
    self.assertIn(ref,NM)
    if l['oldRecordKey']:self.assertIn(l['oldRecordKey'],NM[ref]['oldRecordKeys'])
  for n in N:
   for k in n['oldRecordKeys']:self.assertIn(n['sourceRecordRef'],LM[k]['newSourceRefs'])
 def test_133_candidates_one_per_local_key(self):self.assertEqual(len(C),133);validate(C)
 def test_void_w01_w10_never_inherit_ids(self):
  old=[l for l in L if l['oldStallId'] in ['c01_t38','c01_t47']];self.assertEqual(len(old),27);self.assertTrue(all(l['action']=='VOID' and not l['newSourceRefs'] for l in old));self.assertTrue(all(c['formalDishId'] is None for c in C))
 def test_independent_xiaolongbao_stall(self):
  buns=[c for c in C if '小笼包' in c['name']];self.assertEqual(len(buns),6);self.assertTrue(all(c['stallRef']=='T17' for c in buns));self.assertTrue(any(l['newStallRef']=='T17' for l in L if '小笼包' in l['oldName']))
 def test_ng03_existing_decisions_and_prices(self):
  cs=[c for c in C if c['stallRef']=='T13'];self.assertEqual(len(cs),10);self.assertEqual(collections.Counter(c['amount'] for c in cs),{12:8,14:1,16:1});validate(cs)
 def test_t04_inference_and_t19_uncertainty(self):
  self.assertFalse(any(c['stallRef']=='T04' and '鲜椒鸡' in c['name'] for c in C));u=readcsv(E/'unresolved.csv');self.assertTrue(any(r['recordRef']=='T19-CORN-BANNER' for r in u));ocr=J('t19_ocr_actual.json');self.assertEqual(len(ocr),2);self.assertTrue(all(x['status']=='OCR_COMPLETED' for x in ocr))
 def test_t20_exact12_scope(self):
  retained=[l for l in L if l['action']=='RETAIN'];self.assertEqual(len(retained),12);self.assertTrue(all(l['oldStallId']=='c01_t44' for l in retained));self.assertEqual(len([c for c in C if c['stallRef']=='T20']),12);self.assertTrue(any(r['stallRef']=='T20' and r['countScope']=='supplementary' for r in N))
 def test_source_groups_reconcile_293(self):
  counts=readcsv(E/'count_reconciliation.csv');self.assertEqual(sum(int(x['declaredGroups']) for x in counts),293);self.assertEqual(sum(int(x['enumeratedCoreGroups']) for x in counts),287);self.assertEqual(sum(int(x['supplementaryGroups']) for x in counts),5);self.assertEqual(len(N),292);self.assertEqual(next(x for x in counts if x['stallRef']=='T14')['enumeratedCoreGroups'],'42')
 def test_every_source_group_candidate_or_pending(self):
  u=readcsv(E/'unresolved.csv');pending={r['recordRef'] for r in u};eligible={c['sourceRecordRef'] for c in C};self.assertEqual(eligible|({n['sourceRecordRef'] for n in N}&pending),set(NM));self.assertFalse(eligible&pending);self.assertEqual(len(eligible),118)
 def test_source_lines_and_photo_files_match(self):
  for n in N:self.assertEqual(asset(n['sourceFile']).read_text(encoding='utf-8-sig').splitlines()[n['sourceLine']-1],n['sourceQuote'])
  for c in C:
   p=asset(c['photoEvidence']['originalPath']);self.assertTrue(p.exists());self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),c['photoEvidence']['originalPathSHA256'])
 def test_no_duplicate_source_spec_or_fabricated_current_values(self):
  self.assertEqual(len({(c['sourceRecordRef'],c['specification']) for c in C}),len(C));self.assertTrue(all(c['currentPriceValidity']=='UNKNOWN' and not c['transactionQuoteAllowed'] and c['verifyStatus']=='unverified' and c['verifiedAt'] is None and c['foodType'] is None for c in C))
 def test_negative_price_parent_id_composition(self):
  cases=[]
  x=copy.deepcopy(C);x[0]['amount']=999;cases.append(x)
  x=copy.deepcopy(C);x[0]['name']='无来源的错菜名';cases.append(x)
  x=copy.deepcopy(C);x[0]['formalDishId']='c01_d422';cases.append(x)
  x=copy.deepcopy(C);next(c for c in x if '小笼包' in c['name'])['stallRef']='T42';cases.append(x)
  x=copy.deepcopy(C);next(c for c in x if c['stallRef']=='T13')['businessRules']['composition']=['rice','chicken'];cases.append(x)
  for case in cases:
   with self.assertRaises(AssertionError):validate(case)
 def test_project_and_git_protection(self):
  migrations={x['source']:x for x in J('F1_evidence/migration_manifest.json')['files']}
  for f in J('project_before.json'):
   p=asset(migrations[f['path']]['destination']) if f['path'] in migrations else pathlib.Path(f['path'])
   self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),f['sha256'])
  self.assertEqual(J('git_before.json'),J('git_after.json'))
if __name__=='__main__':unittest.main(verbosity=2)
