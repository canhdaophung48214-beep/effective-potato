import pathlib,json,csv,hashlib,datetime,shutil,subprocess,tempfile
from PIL import Image
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_M1_20261101';E.mkdir();D=E/'candidates';D.mkdir();B=R/'备份'/('R02_M1_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rs):
 with p.open('w',encoding='utf-8-sig',newline='') as h:w=csv.DictWriter(h,fieldnames=list(rs[0]));w.writeheader();w.writerows(rs)
backup=[]
for p in [*(O/'R02_20261101/candidates').glob('*.csv'),O/'R02_20261101/first_batch.json']:
 q=B/p.name;shutil.copyfile(p,q);assert p.read_bytes()==q.read_bytes();backup.append({'original':str(p),'backup':str(q),'bytes':p.stat().st_size,'sha256':sha(p)})
(B/'manifest.json').write_text(json.dumps(backup,ensure_ascii=False,indent=2),encoding='utf-8');shutil.copyfile(B/'manifest.json',E/'backup_manifest.json')
project={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
before={k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]};(E/'git_before.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf-8')
photo=P/'evidence/ds-session-1e2717cc/sha256_914957d83784f5a63ce44f2ced871320d61cf0a58897fc4e4ecaa7f39ad75915.jpg';guide=P/'evidence/ds-session-1e2717cc/sha256_2095909874cccb7179604d9e899bee67a1b801d830e374084e442302c7e4b630.jpg'
assert guide.exists();changes=[];allrows={}
for name in ['shops','floors','stalls','dishes']:
 rows=rr(B/(name+'.csv'));allrows[name]=rows
 if name in ['floors','stalls']:
  rows[0]['evidence_file']=str(guide if name=='floors' else photo);changes.append({'table':name,'field':'evidence_file','before':'','after':rows[0]['evidence_file'],'classification':'A','basis':'2F楼层导览图/负责人DR-2F09档口归属确认；仅支持现有建模关联，不替代缺失门头照'})
 wc(D/(name+'.csv'),rows)
comparison=[]
for r in allrows['dishes']:
 comparison.append({'dishId':r['dish_id'],'dishName':r['dish_name'],'batchRef':'2F-09-39','collectorBefore':r['collector'],'collectorAfter':'','collectorClass':'C','collectorEvidence':'负责人是核验确认人，不能推定为原始拍摄采集人；历史其它批次collector不能套用','collectDateBefore':r['collect_date'],'collectDateAfter':'','collectDateClass':'B','dateEvidence':'PHOTO_MANIFEST:2F-09 send_date=2026-10-23；EXIF空；确认日2026-10-25不是采集日；capture_date文字含未知且时间方向描述不可作为日期依据','evidenceFileBefore':r['evidence_file'],'evidenceFileAfter':r['evidence_file'],'evidenceClass':'A_ALREADY_PRESENT','evidenceSHA256':sha(photo),'missingFields':'collector;collect_date','canAutoComplete':False,'minimumAction':'批次确认真实采集人及实际拍摄日期；无法确定时继续保留空值','needsUserInput':True})
assert len(comparison)==39;wc(E/'metadata_comparison_39.csv',comparison)
parent=[]
for name in ['shops','floors','stalls']:
 for r in allrows[name]:parent.append({'table':name,'id':r.get('shop_id') if name=='shops' else r.get('floor_id') if name=='floors' else r.get('stall_id'),'missingFields':';'.join(k for k in ['collector','collect_date','evidence_file'] if not r[k]),'existingEvidence':r['evidence_file'],'reason':'父级独立采集元数据不可由39条菜品的批次统一继承；归档或建模日期不是采集日期'})
wc(E/'parent_metadata_gaps.csv',parent)
first=json.loads((B/'first_batch.json').read_text(encoding='utf-8'));first['metadataRecovery']={'dishes':comparison,'parents':parent,'automaticRecoveredFields':changes,'strictModePassed':0};(E/'recovered_candidates.json').write_text(json.dumps(first,ensure_ascii=False,indent=2),encoding='utf-8')
(E/'exif_evidence.json').write_text(json.dumps({'photo':str(photo),'sha256':sha(photo),'exif':dict(Image.open(photo).getexif()),'sendDate':'2026-10-23','captureDate':None,'confirmedBy':'项目负责人（核验角色，不等于采集角色）','confirmationDate':'2026-10-25'},ensure_ascii=False,indent=2),encoding='utf-8')
manual=[{'batch':'2F-09蛋炒39条','records':39,'alreadyProven':'照片2F-09归属、证据文件存在、发送日期2026-10-23；不必重填照片','required':'谁实际拍摄/采集？实际拍摄日期是哪天？是否能说明同一批次覆盖39条？','minimalAction':'一次批次真实确认，注明无法确定的字段；不要求39次重复填写'},{'batch':'c01商家','records':1,'alreadyProven':'既有契约模型名称/位置','required':'商家来源的实际采集人、采集日期、适用原始照片/证据；三字段当前空','minimalAction':'提供一次店铺来源确认，不以建模日期充当采集日'},{'batch':'c01_f2楼层与c01_t48档口','records':2,'alreadyProven':'已补楼层导览与菜单归属照片路径','required':'分别明确该来源实际采集人/日期，是否与2F-09同批不能自动假设','minimalAction':'若真实同人同日可一次确认覆盖范围，否则分别说明'}]
wc(E/'minimal_manual_input.csv',manual)
results=[]
for name,args in [('default',['node','tools/import_data.js','--dir',str(D)]),('strict',['node','tools/import_data.js','--dir',str(D),'--require-evidence','--all'])]:
 t=subprocess.run(args,cwd=P,capture_output=True,text=True,encoding='utf-8');(E/(name+'.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');results.append({'name':name,'exitCode':t.returncode});assert t.returncode==(0 if name=='default' else 1)
for case in ['missing_evidence','future_date']:
 with tempfile.TemporaryDirectory(prefix='R02M1_') as td:
  td=pathlib.Path(td)
  for p in D.iterdir():shutil.copyfile(p,td/p.name)
  rs=rr(td/'dishes.csv')
  if case=='missing_evidence':rs[0]['evidence_file']=str(td/'missing.jpg')
  else:rs[0]['collect_date']='2099-01-01'
  wc(td/'dishes.csv',rs);t=subprocess.run(['node','tools/import_data.js','--dir',str(td)],cwd=P,capture_output=True,text=True,encoding='utf-8');assert t.returncode==1;(E/(case+'.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');results.append({'name':case,'exitCode':1,'expectedReject':True})
ids=[r['dish_id'] for r in allrows['dishes']];assert len(set(ids))==39
for r in allrows['dishes']:
 assert r['price'] and r['food_type'] and r['stall_id'] and r['shop_id'];assert pathlib.Path(r['evidence_file']).exists();assert not r['collector'] and not r['collect_date']
assert all(sha(pathlib.Path(p))==s for p,s in project.items());assert git(['status','--porcelain=v1','-uall']).stdout==before['status']
(E/'checks.json').write_text(json.dumps({'commands':results,'sourceIntegrity':'39/39 existing evidence files','uniqueIds':39,'requiredCoreFields':'39/39 complete','dishMetadataFieldsNewlyRecovered':0,'parentEvidencePathsRecovered':2,'strictPassed':0,'manualDishCount':39,'projectFilesUnchanged':len(project),'exitCode':0},ensure_ascii=False,indent=2),encoding='utf-8')
(E/'严格模式验收报告.md').write_text('''# R02-M1严格模式验收报告

原始候选39；菜品元数据自动恢复0条（0个新增字段）；额外恢复父级evidence_file路径2项（楼层/档口），不计成菜品恢复。严格模式通过0；仍需人工补充39条菜品，另有3条父级记录。当前材料无法自动补齐39条，尚无记录能确定为永久无法恢复，故永久无法恢复数量未知，不以39填入该指标。

已逐条确认：菜品只缺collector/collect_date，照片证据39/39原本存在。日期B类：已知发送日，不知道拍摄日；EXIF空。collector C类：材料只证明发送者/核验者角色，不证明拍摄者身份。evidence A类已存在39个值，本轮不重复计为恢复。父级商家缺三件套；楼层/档口补照片路径后各缺collector/date。strict日志中父级依赖拒绝并不等于其它元数据已检查通过，独立缺口表逐字段列全。

原图manifest capture_date写未知且有“不早于发送日”历史描述，逻辑方向不能当日期证据；没有据此编造时间范围或把发送日当拍摄日。2026-10-25为后续亲验确认日，不是采集日。其它批次的2026-10-22水印及“产品负责人”不能套用到2F-09。

默认实际预览退出0；严格实际预览退出1，继续拒绝缺失元数据。来源文件存在、39ID唯一、必需核心字段检查通过。负向缺照片/未来采集日期均退出1，符合预期，未放宽规则。不重复运行无关回归。

最小人工清单合并3组：39条菜单批次真实采集人及实际日期；商家证据三件套；楼层/档口采集角色与日期。可以一次真实确认同人同日及覆盖范围，不需要重复39行；不知道就保持未知。已证明的照片路径和核验事实不再要求人工重填。收到部分确认后可分批验证，不等全量。

备份原R02四CSV与JSON均逐字节一致；原件不覆盖，新候选在本目录。所有原项目文件哈希及Git状态不变，正式data/审批/映射未改，未正式导入、云端操作或Git写。实际diff是新目录候选的两个父级照片路径，其余菜品CSV值不变。备份manifest、checks.json、四条命令原始日志与文件SHA在本目录。

PASS：逐字段缺口、EXIF及来源检查、负向验证、项目保护。PENDING：39条采集身份/日期与父级来源确认。严格门槛FAIL（实际退出1），不宣称已闭环。下一轮直接依据minimal_manual_input.csv收集批次确认，恢复有证据的字段后重跑相同严格命令。
''',encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS targeted checks; default0 strict1; dishes recovered0; parent evidence paths2; manual39')
