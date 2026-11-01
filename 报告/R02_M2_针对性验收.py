import pathlib,json,csv,hashlib,datetime,shutil,subprocess,tempfile
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_M2_20261101';E.mkdir();D=E/'candidates';D.mkdir();B=R/'备份'/('R02_M2_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rows):
 with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
backup=[]
for p in (O/'R02_M1_20261101/candidates').glob('*.csv'):
 shutil.copyfile(p,D/p.name);q=B/p.name;shutil.copyfile(p,q);assert p.read_bytes()==q.read_bytes();backup.append({'original':str(p),'backup':str(q),'bytes':p.stat().st_size,'sha256':sha(p)})
(B/'manifest.json').write_text(json.dumps(backup,ensure_ascii=False,indent=2),encoding='utf-8');shutil.copyfile(B/'manifest.json',E/'backup_manifest.json')
base={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
before={k:git(a).stdout for k,a in [('head',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]};(E/'git_before.json').write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf-8')
items=rr(D/'dishes.csv');assert len(items)==39 and all(pathlib.Path(r['evidence_file']).is_file() for r in items)
for r in items:assert not r['collector'] and not r['collect_date']
policy={'photoPurpose':'internal_evidence_only','uploadRequired':False,'displayImageRequired':False,'formalImageUrlRequired':False,'fileIDRequired':False,'localEvidencePathRequired':True,'collectorRequired':True,'actualCaptureDateRequired':True,'sourceAuthenticityRequired':True,'policySource':'负责人本轮R02-M2裁决','formalRuleChange':'NONE; current importer already checks local files only'}
(E/'evidence_policy.json').write_text(json.dumps(policy,ensure_ascii=False,indent=2),encoding='utf-8')
first=json.loads((O/'R02_M1_20261101/recovered_candidates.json').read_text());first['photoPolicy']=policy;first['M2Status']={'evidenceReferencesComplete':39,'photoUploadNotRequired':39,'collectorConfirmed':0,'actualDateConfirmed':0,'strictPassed':0,'pending':'collector/date and parent source metadata'};(E/'updated_candidates.json').write_text(json.dumps(first,ensure_ascii=False,indent=2),encoding='utf-8')
results=[]
def run(name,d,strict=True):
 args=['node','tools/import_data.js','--dir',str(d),'--all']+(['--require-evidence'] if strict else [])
 t=subprocess.run(args,cwd=P,capture_output=True,text=True,encoding='utf-8');(E/(name+'.log')).write_text('COMMAND '+str(args)+'\n'+t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');results.append({'name':name,'command':args,'exitCode':t.returncode});return t
assert run('real_default',D,False).returncode==0
assert run('real_strict',D).returncode==1
# Explicitly synthetic metadata confined to disposable test copies. Never used as candidate evidence.
for case in ['no_upload_positive','missing_date','missing_collector','invalid_evidence_path']:
 with tempfile.TemporaryDirectory(prefix='R02M2_SYNTHETIC_ONLY_') as td:
  td=pathlib.Path(td)
  for p in D.glob('*.csv'):
   rs=rr(p)
   for r in rs:
    r['collector']='SYNTHETIC_TEST_ACTOR_NOT_REAL_METADATA';r['collect_date']='2020-01-01'
    if not r['evidence_file']:r['evidence_file']=items[0]['evidence_file']
   if p.name=='dishes.csv':
    if case=='missing_date':rs[0]['collect_date']=''
    if case=='missing_collector':rs[0]['collector']=''
    if case=='invalid_evidence_path':rs[0]['evidence_file']=str(td/'absent.jpg')
   wc(td/p.name,rs)
  t=run('fixture_'+case,td);assert t.returncode==(0 if case=='no_upload_positive' else 1)
  if case=='missing_date':assert 'collect_date' in t.stdout
  if case=='missing_collector':assert 'collector' in t.stdout
  if case=='invalid_evidence_path':assert '证据文件不存在' in t.stdout
# Test fixtures did not leak into real CSVs.
assert all(p.read_bytes()==(O/'R02_M1_20261101/candidates'/p.name).read_bytes() for p in D.glob('*.csv'))
assert all(sha(pathlib.Path(p))==h for p,h in base.items());assert git(['status','--porcelain=v1','-uall']).stdout==before['status']
manual=rr(O/'R02_M1_20261101/minimal_manual_input.csv');wc(E/'minimal_manual_input.csv',manual)
(E/'manual_next_actions.md').write_text('''# 下一轮最小人工确认

不需要上传照片，不需要URL/fileID，不要求展示图片，不需再次提供39条已存在的照片路径。

1. 菜单2F-09批次一次确认：实际拍摄/采集人是谁、实际采集日期、是否同一批次覆盖39条。不知道的字段保持空，不以发送日2026-10-23或核验日2026-10-25代填。
2. 商家c01：补真实来源采集人、日期及可用原始证据引用。当前三项均空。
3. 楼层c01_f2、档口c01_t48：本地照片路径已经恢复；只补该来源真实采集人/日期与覆盖范围。若与菜单批次确实相同，可一次确认共同覆盖；不能自动继承。

收到部分真实确认即可生成已补齐子批次并重跑严格预览；父级依赖也需完整。严禁把本轮隔离测试中的SYNTHETIC字段用作真实元数据。
''',encoding='utf-8')
(E/'test_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
(E/'验收报告.md').write_text('''# R02-M2照片内部证据模式与39候选验收

结论：照片政策落实及针对性测试PASS；真实采集元数据仍PENDING，39条严格验收未通过。

| 指标 | 数量/结论 |
|---|---|
| 本地照片证据引用完整 |39条，全部路径真实存在 |
| 无需照片上传即可满足照片证据条件 |39条；仅照片条件，不表示整条严格通过 |
| 采集人已确认 |0条 |
| 实际采集日期已确认 |0条 |
| 真实候选严格模式通过 |0条 |
| 仍需补充 |39条采集人/日期；另3父级来源记录 |

检查当前import_data.js:430-474：严格模式检查collector、合法collect_date及本地evidence_file存在性，不检查展示图片、URL或云fileID。故没有需要放宽的上传门槛，也没有修改正式或专用校验器。照片策略用报告侧evidence_policy.json表达，复用evidence_file，不添加正式展示图字段。updated_candidates.json与CSV都保留真实未知值，未上传或引用云端。

本轮只复核M1定向结论，照片EXIF空、manifest记录发送日2026-10-23、亲验确认2026-10-25均不证明实际采集日；核验负责人身份不等于采集人。未重复盘点525，未重复索取已存在照片。

实际命令：真实默认预览退出0；真实严格预览退出1（采集与父级证据元数据缺失）。针对性隔离夹具4组：无上传字段且元数据齐全退出0；缺日期、缺采集人、无效本地照片路径各退出1并核对对应错误。夹具元数据显式SYNTHETIC、只在临时副本存在，不进入真实候选，且不是来源真实性证明。positive证明校验器不要求上传，不证明真实39条拥有采集元数据。原始日志与逐命令退出码在test_results.json及*.log。

文件：candidates四CSV、updated_candidates.json、evidence_policy.json、minimal_manual_input.csv、manual_next_actions.md、六份原始命令输出、备份manifest、Git与交付SHA清单。候选CSV与M1逐字节一致是正确结果：原规则已经支持本地证据，不能为显示差异改造数据。真实变化是新增照片角色策略、隔离验证及明确排除上传要求的人工清单。

保护：所有开工项目文件SHA不变，Git状态与暂存区不变；正式data、审批、ID映射、生成器/导入器/校验器均未改。备份位于仓库外并逐字节验证。未正式导入、Git写、触云、部署、照片上传。FAIL：真实严格命令仍退出1；这是真实门槛未满足，不是测试缺陷。PENDING：采集角色、日期及父级来源，下一轮按批次确认而不是要求39次填写。完成后停止。
''',encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'exitCode':0,'photoReferences':39,'collectorKnown':0,'captureDateKnown':0,'strictPassed':0,'projectFilesUnchanged':len(base),'candidateCsvByteIdenticalToM1':True,'fixtureTestsPassed':4},indent=2),encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS 4 policy tests; real default0 strict1; photo refs39; collector/date0; source unchanged')
