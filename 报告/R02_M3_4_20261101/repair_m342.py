import pathlib,json,hashlib,datetime,shutil,difflib,subprocess
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R02_M3_4_20261101';F=E/'M342_evidence';B=R/'备份'/('R02_M342_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir();shutil.copytree(E,B/'delivery_before');F.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
manifest=[{'path':str(p),'backup':str(B/'delivery_before'/p.relative_to(E)),'bytes':p.stat().st_size,'sha256':sha(p),'modifiedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in E.rglob('*') if p.is_file()]
assert all(pathlib.Path(x['path']).read_bytes()==pathlib.Path(x['backup']).read_bytes() for x in manifest)
(F/'backup_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
project=[{'path':str(p),'sha256':sha(p)} for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts];(F/'project_before.json').write_text(json.dumps(project,ensure_ascii=False,indent=2),encoding='utf-8')
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
(F/'git_before.json').write_text(json.dumps({k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]},ensure_ascii=False,indent=2),encoding='utf-8')
changes=[]
def edit(p,s):
 old=p.read_text(encoding='utf-8-sig');p.write_text(s,encoding='utf-8');changes.append(''.join(difflib.unified_diff(old.splitlines(True),s.splitlines(True),fromfile=str(p.relative_to(E))+' before',tofile=str(p.relative_to(E))+' after')))
p=E/'adapter.js';s=p.read_text();s=s.replace(' const s=r.sourceMenuPrice,c=r.currentEffectivePrice;'," const s=r.sourceMenuPrice,c=r.currentEffectivePrice;\n if(typeof r.id!=='string'||typeof r.name!=='string'||!r.name.trim()||!r.legacyRecord||!r.legacyRecord.source||typeof r.legacyRecord.source.ref!=='string'||!r.legacyRecord.source.ref.trim()||!r.parentEvidence||!r.parentEvidence.stall)throw Error('INVALID_IDENTITY_OR_EVIDENCE');")
edit(p,s)
css='\n/* M3.4.2 narrow-screen safety: no clipping, fixed card widths or source truncation. */\n.history-list,.card,.notice{box-sizing:border-box;max-width:100%;min-width:0}.name,.source,.parent,.hint,.current,.history-price{white-space:normal;word-break:break-all;overflow-wrap:anywhere}.price-row{display:flex;flex-wrap:wrap;align-items:baseline;gap:10rpx}.history-price{flex:0 1 auto}.source{line-height:1.7}\n'
p=E/'mini/components/history-menu/index.wxss';edit(p,p.read_text()+css)
p=E/'historical_menu_preview.html';s=p.read_text();s=s.replace('</style>','*{box-sizing:border-box}html{overflow-x:hidden}body{width:100%;margin:0 auto}article{max-width:100%;min-width:0}h2,small,strong,p{overflow-wrap:anywhere;word-break:break-word}small{display:block}</style>');edit(p,s)
config={'description':'Isolated historical menu verification only','compileType':'miniprogram','appid':'touristappid','projectname':'shishen-history-m342','miniprogramRoot':'./','setting':{'urlCheck':False,'es6':True,'postcss':True,'minified':False},'libVersion':'3.7.12'}
(E/'mini/project.config.json').write_text(json.dumps(config,ensure_ascii=False,indent=2),encoding='utf-8')
(F/'changes.patch').write_text('\n'.join(changes),encoding='utf-8')
(F/'provenance.json').write_text(json.dumps({'baselineAdapter':next(x for x in manifest if pathlib.Path(x['path']).name=='adapter.js'),'searchedLocations':['workspace recursively excluding node_modules/.git','备份','R02_M3_4 directory and DSH report','Desktop targeted filenames'],'claimed6932AdapterFound':False,'claimedExtraArchitectureFound':False,'conclusion':'现有基线1452B适配器已复用；此前6932B及lib/menu-data/pages/home/prototype/demo描述与查得磁盘文件不符；没有伪造历史交付。','reusedArchitecture':'adapter.js + mini/pages/history + mini/components/history-menu'},ensure_ascii=False,indent=2),encoding='utf-8')
print('BACKUP',B,'files',len(manifest),'patched adapter/css/html; isolated devtools project ready')
