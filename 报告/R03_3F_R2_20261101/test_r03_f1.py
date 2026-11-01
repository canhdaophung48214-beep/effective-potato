import unittest,pathlib,json,hashlib,collections,subprocess,tempfile,shutil,csv
E=pathlib.Path(__file__).parent;R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def asset(p):p=pathlib.Path(p);return p if p.is_absolute() else E/p
def digest(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
class F1Tests(unittest.TestCase):
 def test_counts_and_unique_replace_owner(self):
  l=J('replacement_ledger.json');self.assertEqual(len(l),375);self.assertEqual(sum(x['action']=='NEW' for x in l),232)
  rows=[x for x in l if 'R03-T13-L0368-103' in x['newSourceRefs']];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['action'],'REPLACE')
  c=J('candidates.json');self.assertEqual(len(c),133);self.assertEqual(len({x['candidateId'] for x in c}),133);self.assertEqual(sum(x['sourceRecordRef']=='R03-T13-L0368-103' for x in c),1)
 def test_no_other_new_old_double_registration(self):
  l=J('replacement_ledger.json');new=[r for x in l if x['action']=='NEW' for r in x['newSourceRefs']];old={r for x in l if x['oldRecordKey'] for r in x['newSourceRefs']};self.assertEqual(len(new),len(set(new)));self.assertFalse(set(new)&old);self.assertEqual(len(set(new)|old),292)
  actions=collections.Counter(x['action'] for x in l if x['oldRecordKey']);self.assertEqual(actions,{'RETAIN':12,'REPLACE':48,'VOID':32,'PENDING':51})
 def test_csv_json_ledger_agree(self):
  with (E/'replacement_ledger.csv').open(encoding='utf-8-sig',newline='') as f:c=list(csv.DictReader(f))
  l=J('replacement_ledger.json');self.assertEqual(len(c),len(l))
  for a,b in zip(c,l):
   for k,v in b.items():self.assertEqual(json.loads(a[k]) if isinstance(v,list) else a[k],v)
 def test_266_photo_hashes_and_source_lines(self):
  n=0
  for c in J('candidates.json'):
   for key in ['originalPath','cropPath']:
    self.assertEqual(digest(asset(c['photoEvidence'][key])),c['photoEvidence'][key+'SHA256']);n+=1
   self.assertEqual(asset(c['sourceFile']).read_text(encoding='utf-8-sig').splitlines()[c['sourceLine']-1],c['sourceQuote']);self.assertEqual(c['sourceFile'],'source_assets/TRANSCRIPTION_3F_R2.md')
  self.assertEqual(n,266)
 def test_19_copies_byte_verified_and_exact_scope(self):
  m=J('F1_evidence/migration_manifest.json');self.assertEqual(len(m['files']),19);self.assertEqual(sum(x['destination'].endswith('.png') for x in m['files']),16)
  for x in m['files']:
   dest=asset(x['destination']);self.assertEqual(dest.stat().st_size,x['bytes']);self.assertEqual(digest(dest),x['sha256']);self.assertEqual(digest(x['backup']),x['sha256'])
   if m['status']=='MOVED_VERIFIED':self.assertFalse(pathlib.Path(x['source']).exists())
   else:self.assertEqual(digest(x['source']),x['sha256'])
 def test_no_other_project_changes(self):
  moved={x['source'] for x in J('F1_evidence/migration_manifest.json')['files']};baseline=J('F1_evidence/project_before.json');expected={x['path'] for x in baseline}-moved
  for x in baseline:
   if x['path'] not in moved:self.assertEqual(digest(x['path']),x['sha256'])
  actual={str(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
  self.assertFalse(actual-{x['path'] for x in baseline});self.assertTrue(expected.issubset(actual))
 def test_reproducible_isolated_build(self):
  with tempfile.TemporaryDirectory(prefix='R03F1_rebuild_') as td:
   out=pathlib.Path(td)/'batch';out.mkdir();shutil.copytree(E/'source_assets',out/'source_assets')
   r=subprocess.run(['python','-X','utf8',str(E/'build_r03.py'),'--out-dir',str(out)],cwd=R,capture_output=True,text=True,encoding='utf-8');self.assertEqual(r.returncode,0,r.stdout+r.stderr)
   c=json.loads((out/'candidates.json').read_text());self.assertEqual(c,J('candidates.json'))
   l=json.loads((out/'replacement_ledger.json').read_text());self.assertEqual(len(l),375);self.assertEqual(sum(x['action']=='NEW' for x in l),232)
if __name__=='__main__':unittest.main(verbosity=2)
