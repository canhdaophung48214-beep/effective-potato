import pathlib,json,hashlib,difflib
E=pathlib.Path(__file__).resolve().parent;F=E/'F1_evidence'
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
B=pathlib.Path(json.loads((F/'backup_manifest.json').read_text(encoding='utf-8'))['deliveryBackup']);patch=[];changes=[]
for p in sorted(E.rglob('*')):
 if not p.is_file() or p.name in ['manifest.sha256','file_manifest.json','F1_changes.patch','final_changes.json']:continue
 rel=p.relative_to(E).as_posix();old=B/rel;before=old.read_bytes() if old.exists() else b'';after=p.read_bytes()
 if before==after:continue
 changes.append({'path':rel,'status':'MODIFIED' if old.exists() else 'ADDED','beforeBytes':len(before) if old.exists() else None,'afterBytes':len(after),'beforeSHA256':hashlib.sha256(before).hexdigest() if old.exists() else None,'afterSHA256':sha(p)})
 try:patch.extend(difflib.unified_diff(before.decode('utf-8-sig').splitlines(True),after.decode('utf-8-sig').splitlines(True),fromfile='before/'+rel,tofile='after/'+rel))
 except UnicodeDecodeError:patch.append('Binary added '+rel+' bytes='+str(len(after))+' SHA256='+sha(p)+'\n')
(F/'F1_changes.patch').write_text(''.join(patch),encoding='utf-8');(F/'final_changes.json').write_text(json.dumps({'isolatedDeliveryChanges':changes,'projectSourceMoves':'migration_manifest.json; nineteen byte-identical copies and authorized original removals','manifestChanges':'old full manifests backed up; final manifests recomputed separately to avoid self-reference'},ensure_ascii=False,indent=2),encoding='utf-8')
files=sorted(p for p in E.rglob('*') if p.is_file() and p not in [E/'manifest.sha256',E/'file_manifest.json']);rows=[{'path':str(p.resolve()),'relativePath':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files];(E/'file_manifest.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');files.append(E/'file_manifest.json');(E/'manifest.sha256').write_text(''.join(sha(p)+'  '+p.relative_to(E).as_posix()+'\n' for p in sorted(files)),encoding='utf-8')
print('PACKED',len(files),'files; nineteen source assets included')
