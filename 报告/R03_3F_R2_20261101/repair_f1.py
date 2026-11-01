import pathlib,json,hashlib,datetime,shutil,csv,subprocess,collections
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R03_3F_R2_20261101';F=E/'F1_evidence';B=R/'备份'/('R03_F1_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir();shutil.copytree(E,B/'delivery_before');F.mkdir()
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def dump(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
git=lambda a:subprocess.run(['git','-c','core.quotepath=false','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
state={k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('staged',['diff','--cached','--name-status']),('short',['status','--short']),('status',['status','--porcelain=v1','-uall'])]};dump(F/'git_before.json',state)
baseline=[{'path':str(p),'relativePath':p.relative_to(P).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];dump(F/'project_before.json',baseline)
srcs=[P/'tools/_crop3f.py',P/'tools/_crop3f2.py',P/'tools/pilot/TRANSCRIPTION_3F_R2.md']+sorted((P/'tools/_crop3f').glob('*.png'));assert len(srcs)==19
migration=[]
for p in srcs:
 p=p.resolve();assert p.is_relative_to(P.resolve());tracked=git(['ls-files','--error-unmatch',p.relative_to(P).as_posix()]);assert tracked.returncode==1,'target tracked: '+str(p)
 dest=E/'source_assets'/('TRANSCRIPTION_3F_R2.md' if p.name=='TRANSCRIPTION_3F_R2.md' else ('tools/'+p.name if p.suffix=='.py' else 'crops/'+p.name))
 assert not dest.exists();dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest);assert p.read_bytes()==dest.read_bytes()
 migration.append({'source':str(p),'sourceRelativeToProject':p.relative_to(P).as_posix(),'destination':dest.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p),'byteIdentical':True,'tracked':False})
dump(F/'migration_manifest.json',{'status':'COPIED_VERIFIED','files':migration})
# Before-change byte backup for the 19 input files, in addition to the entire isolated delivery.
for x in migration:
 p=pathlib.Path(x['source']);q=B/'source_inputs'/x['sourceRelativeToProject'];q.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,q);assert sha(q)==x['sha256'];x['backup']=str(q)
dump(F/'migration_manifest.json',{'status':'COPIED_VERIFIED','files':migration})
dump(F/'backup_manifest.json',{'deliveryBackup':str(B/'delivery_before'),'sourceFilesBackup':migration,'note':'All original bytes copied and verified before mutation/removal.'})
led=json.loads((E/'replacement_ledger.json').read_text());target='R03-T13-L0368-103';oldactions=collections.Counter(l['action'] for l in led if l['oldRecordKey']);nrefs={r for l in led if l['action']=='NEW' for r in l['newSourceRefs']};orefs={r for l in led if l['oldRecordKey'] for r in l['newSourceRefs']};assert nrefs&orefs=={target}
removed=[l for l in led if l['action']=='NEW' and l['newSourceRefs']==[target]];assert len(removed)==1;led=[l for l in led if l not in removed];assert collections.Counter(l['action'] for l in led if l['oldRecordKey'])==oldactions;assert sum(l['action']=='NEW' for l in led)==232
# Change only live paths, never business data. Snapshot evidence is explicitly historical.
replacements={str(P/'tools/pilot/TRANSCRIPTION_3F_R2.md'):'source_assets/TRANSCRIPTION_3F_R2.md',str(P/'tools/_crop3f'):'source_assets/crops','项目/tools/pilot/TRANSCRIPTION_3F_R2.md':'source_assets/TRANSCRIPTION_3F_R2.md','项目/tools/_crop3f.py':'source_assets/tools/_crop3f.py','项目/tools/_crop3f2.py':'source_assets/tools/_crop3f2.py'}
def fix(v):
 if isinstance(v,str):
  for a,b in replacements.items():
   if v==a:return b
   if v.startswith(a+'\\') or v.startswith(a+'/'):return b+'/'+v[len(a)+1:].replace('\\','/')
   if v.startswith(a+' JOBS '):return b+v[len(a):]
  return v
 if isinstance(v,list):return [fix(x) for x in v]
 if isinstance(v,dict):return {k:fix(x) for k,x in v.items()}
 return v
led=fix(led);dump(E/'replacement_ledger.json',led)
def writecsv(p,rs):
 with p.open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader()
  for row in rs:w.writerow({k:json.dumps(v,ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
writecsv(E/'replacement_ledger.csv',led)
for n in ['candidates.json','new_source_records.json','photo_source_index.json','t19_ocr_inputs.json']:
 p=E/n;dump(p,fix(json.loads(p.read_text(encoding='utf-8-sig'))))
for n in ['unresolved.csv','stall_crosswalk.csv']:
 p=E/n
 with p.open(encoding='utf-8-sig',newline='') as f:rs=list(csv.DictReader(f))
 writecsv(p,[fix(r) for r in rs])
p=E/'statistics.json';s=json.loads(p.read_text());s.update(ledgerRows=375,newLedgerRows=232,uniqueNewSourceGroups=292,oldDisposition=dict(oldactions));dump(p,s)
# Update builder: read preserved source scripts as AST only; never execute their old output directories.
p=E/'build_r03.py';s=p.read_text(encoding='utf-8-sig').replace("SRC=P/'tools/pilot/TRANSCRIPTION_3F_R2.md'","SRC=E/'source_assets/TRANSCRIPTION_3F_R2.md'")
s=s.replace("[P/'tools/_crop3f.py',P/'tools/_crop3f2.py']","[E/'source_assets/tools/_crop3f.py',E/'source_assets/tools/_crop3f2.py']").replace("str(P/'tools/_crop3f'/(name+'.png'))","'source_assets/crops/'+name+'.png'").replace("str(script.relative_to(R))+' JOBS '+name","script.relative_to(E).as_posix()+' JOBS '+name")
s=s.replace("p=pathlib.Path(v[field]);v[field+'Exists']=p.exists()","p=pathlib.Path(v[field]);p=p if p.is_absolute() else E/p;v[field+'Exists']=p.exists()")
s=s.replace("'sourceFile':str(SRC)","'sourceFile':'source_assets/TRANSCRIPTION_3F_R2.md'")
p.write_text(s,encoding='utf-8')
# Existing fourteen assertions keep their intent; authorized source migration is explicitly verified.
p=E/'test_r03.py';s=p.read_text(encoding='utf-8-sig');s=s.replace("C=J('candidates.json');", "def asset(p):\n p=pathlib.Path(p);return p if p.is_absolute() else E/p\nC=J('candidates.json');")
s=s.replace("pathlib.Path(n['sourceFile']).read_text", "asset(n['sourceFile']).read_text").replace("p=pathlib.Path(c['photoEvidence']['originalPath'])", "p=asset(c['photoEvidence']['originalPath'])")
s=s.replace("  for f in J('project_before.json'):self.assertEqual(hashlib.sha256(pathlib.Path(f['path']).read_bytes()).hexdigest(),f['sha256'])", "  migrations={x['source']:x for x in J('F1_evidence/migration_manifest.json')['files']}\n  for f in J('project_before.json'):\n   p=asset(migrations[f['path']]['destination']) if f['path'] in migrations else pathlib.Path(f['path'])\n   self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(),f['sha256'])")
p.write_text(s,encoding='utf-8')
# Report current paths; source_assets scripts remain byte-identical historical inputs, not executable migration tools.
p=E/'R03_执行报告.md';s=p.read_text(encoding='utf-8');s='''# R03-F1当前修复状态

替换台账375行=143旧行+232 NEW；删除腊肠源组重复NEW，实际133候选不变。源组292不变；143旧行分类不变。19个指定源文件迁至source_assets，原始字节/SHA均保留；正文历史路径以source_assets对应文件解析。原裁剪脚本仅供AST读取/来源留痕，不执行其历史OUT目录。正式项目的19条移除为本轮明确授权动作，其他文件保持不变。

以下为初次R03报告；原保护结论描述当时状态，本轮F1授权迁移以F1报告为准。

---
'''+s.replace('项目/tools/pilot/TRANSCRIPTION_3F_R2.md','source_assets/TRANSCRIPTION_3F_R2.md')
p.write_text(s,encoding='utf-8')
dump(F/'removed_duplicate_new.json',removed)
print('PREPARED ledger375 NEW232 candidate133; copies19 verified; originals still present')
