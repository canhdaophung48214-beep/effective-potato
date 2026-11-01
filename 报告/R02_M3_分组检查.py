import pathlib,json,csv,hashlib,subprocess
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_M3_20261101';E.mkdir();D=E/'pending_candidates';D.mkdir()
def j(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rs,fields=None):
 with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields or list(rs[0]));w.writeheader();w.writerows(rs)
x=j(O/'R02_M2_20261101/updated_candidates.json');rs=rr(O/'R02_M2_20261101/candidates/dishes.csv');assert len(rs)==39
for p in (O/'R02_M2_20261101/candidates').glob('*.csv'):(D/p.name).write_bytes(p.read_bytes())
ids=[r['dish_id'] for r in rs];groups=[{'groupId':'G1_MENU_2F09','recordCount':39,'recordIds':';'.join(ids),'dishes':';'.join(r['dish_name'] for r in rs),'source':'2F-09归档照片914957…，同一菜单13口味×3做法展开','collector':'UNKNOWN','actualCaptureDate':'UNKNOWN','verificationDate':'2026-10-25（仅后续核验）','organizationDate':'既有2026-10-23转录整理，不代表拍摄日期；后续候选生成另有各自时间','sentDate':'2026-10-23（发送，不等于采集）','batchCoverage':'39条同一照片来源已证明；同一实际采集人/日期尚须确认','question':'该照片实际由谁拍摄/采集、哪天拍摄？确认该事实覆盖这39条；有多个来源时请指出范围。'},{'groupId':'G2_FLOOR','recordCount':1,'recordIds':'c01_f2','dishes':'楼层关联（父级）','source':'楼层导览归档照片209590…','collector':'UNKNOWN','actualCaptureDate':'UNKNOWN','verificationDate':'不挪用菜单核验日','organizationDate':'建模/整理日期不代替采集日','sentDate':'不自动继承G1','batchCoverage':'与G1不同照片；不能默认同人同日，可由负责人真实确认合并','question':'导览照片实际采集人/日期，是否与G1同人同日？'},{'groupId':'G3_STALL','recordCount':1,'recordIds':'c01_t48','dishes':'档口关联（父级）','source':'2F-09菜单及归属确认记录DR-2F09','collector':'UNKNOWN','actualCaptureDate':'UNKNOWN','verificationDate':'2026-10-25归属核验，非采集','organizationDate':'不代替实际采集日','sentDate':'2026-10-23照片发送','batchCoverage':'同一菜单照片，可在G1确认中明确覆盖档口来源；核验者不是默认采集者','question':'G1确认是否同时覆盖档口来源？如另有来源，请另列采集人日期。'},{'groupId':'G4_SHOP','recordCount':1,'recordIds':'c01','dishes':'商家（父级）','source':'现有契约建模名称/位置；原始证据三件套待补','collector':'UNKNOWN','actualCaptureDate':'UNKNOWN','verificationDate':'不以契约决策日期替代','organizationDate':'模型整理非现场采集','sentDate':'UNKNOWN','batchCoverage':'不能由菜单或楼层批次自动覆盖','question':'商家名称/位置的真实采集人、实际日期及本地证据引用是什么？如已有材料请明确哪份及范围。'}]
wc(E/'group_confirmation.csv',groups)
backfill=[{'dishId':r['dish_id'],'dishName':r['dish_name'],'groupId':'G1_MENU_2F09','collectorBefore':r['collector'],'collectorAfter':r['collector'],'actualDateBefore':r['collect_date'],'actualDateAfter':r['collect_date'],'displayCollector':'UNKNOWN','displayActualDate':'UNKNOWN','evidenceFile':r['evidence_file'],'status':'PENDING_OWNER_BATCH_CONFIRMATION','reason':'尚无本轮负责人真实采集事实确认；不代填'} for r in rs];wc(E/'backfill_comparison_39.csv',backfill)
(E/'admissible_candidates.json').write_text(json.dumps({'technicalStrictEligible':[],'count':0,'formalAdmissionAuthorized':False,'formalImportCompleted':False,'reason':'awaiting truthful batch confirmation and parent evidence metadata; no real candidate newly tested as passed'},ensure_ascii=False,indent=2),encoding='utf-8')
(E/'pending_candidates.json').write_text(json.dumps({'count':39,'records':x['records'],'metadata':backfill,'parentGroups':groups[1:],'photoPolicy':x['photoPolicy']},ensure_ascii=False,indent=2),encoding='utf-8')
t=subprocess.run(['node','tools/import_data.js','--dir',str(D),'--require-evidence','--all'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert t.returncode==1;(E/'strict_actual.log').write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8')
assert len(set(ids))==39 and all(not r['collectorAfter'] and not r['actualDateAfter'] for r in backfill)
(E/'remaining_confirmation.md').write_text('''# 一次性批次确认

请集中回复以下事实，未知可写UNKNOWN，无需上传照片：

1. G1菜单2F-09：真实采集人____，实际拍摄日期____，是否覆盖c01_d502–c01_d540全部39条____。39条是同一原图展开，不需要逐菜回答。
2. G2楼层导览：真实采集人____，实际日期____，是否与G1同人同日____。不同照片不能自动合并；若属实可直接写“同G1”。
3. G3档口：G1确认是否同时覆盖该菜单对应的档口来源____；若有其它来源请注明。2026-10-25是归属核验日，不能当拍摄日。
4. G4商家：真实采集人____，实际日期____，证明商家名称/位置的本地材料____。已有契约建模不是采集三件套。

实际采集日、后续核验日、整理/录入日分开。2026-10-23目前只证明发送/部分整理，不能当实际采集日。负责人若确认不同记录来源不同，请列例外范围，其余可批量覆盖。收到确认后按已确认子组回填，保留证据和确认文本；父级也完整的子批次先严格检查，不等待其它批次。正式准入授权仍独立，不因严格预览通过自动获得。
''',encoding='utf-8')
(E/'M3_验收报告.md').write_text('''# R02-M3分组确认与严格准入结果

PASS：39条菜单来源归为G1一组，真实责任人/实际日期未知，不能声称已按确定采集人完成事实分组；另列G2楼层不同原图、G3档口同菜单来源责任、G4商家，避免假设父级同批。G1/G3可以在真实确认后一次覆盖。group_confirmation.csv含全部39条ID与菜名，backfill_comparison_39.csv逐项保留原值，字段没有证据则不新增。

已完成现有材料可支持的整理，未重新执行M1/M2或重复审图。照片路径、EXIF和已核验内容复用M2。真实采集日期UNKNOWN，2026-10-25为核验日期，2026-10-23发送/转录整理不是采集日。没有新的批次确认，所以自动回填0、严格通过0、待确认39；另3条父级记录待补元数据。

本轮仅一次真实严格模式--all，退出1，完整输出strict_actual.log。不是重复大规模套件；检查39唯一ID、G1覆盖39、回填不造值通过。admissible_candidates.json为空；pending_candidates.json完整保留39，按通过/未通过分开交付，没有以合成测试结果冒充真实通过。当前没有满足全部条件的子组，收到部分确认后可按父级依赖完整的子组先检。

所有输出新增于M3目录，旧M1/M2不改。无需修改原源码，也不改data/审批/ID映射。不正式导入、触云、部署、上传或Git写。原始严格输出、文件SHA见delivery_manifest.json。PENDING：仅真实批次事实及父级来源确认，按remaining_confirmation.md一次性回复；本轮结束，等待负责人确认。
''',encoding='utf-8')
g=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert g.returncode==0;(E/'git_status.txt').write_text(g.stdout,encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'exitCode':0,'uniqueDishIds':39,'menuGroups':1,'parentSourceGroups':3,'newMetadataBackfilled':0,'strictExitCode':1,'strictPassed':0,'pendingDishes':39},indent=2),encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS grouped39; metadata0; strict1 expected; eligible0; pending39')
