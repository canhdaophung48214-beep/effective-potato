import pathlib,json,csv,hashlib,subprocess,collections
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R02_M3_1_20261101';E.mkdir();D=E/'candidates';D.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rows):
 with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
baseline={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
for p in (O/'R02_M3_20261101/pending_candidates').glob('*.csv'):(D/p.name).write_bytes(p.read_bytes())
rs=rr(D/'dishes.csv');orig=json.loads((O/'R02_20261101/first_batch.json').read_text())['records'];om={x['id']:x for x in orig};lines=(P/'tools/pilot/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();confirmed=[];pending=[]
mapcol={'炒饼':('snack',1),'炒面':('noodle',2),'炒饭':('rice',3)}
for r in rs:
 x=om[r['dish_id']];prep=x['gen']['specLabel'];ft,col=mapcol[prep];n=x['gen']['sourceLine'];cells=[c.strip() for c in lines[n-1].split('|')][1:-1]
 assert r['dish_name']==cells[0]+prep and float(r['price'])==float(cells[col].replace(' 元','')) and r['food_type']==ft
 assert r['tastes']=='' and r['stall_id']=='c01_t48' and r['shop_id']=='c01'
 confirmed.append({'dishId':r['dish_id'],'name':r['dish_name'],'source':f'项目/tools/pilot/TRANSCRIPTION_2F.md:{n}','sourceRaw':lines[n-1],'price':r['price'],'preparation':prep,'foodType':ft,'foodTypeBasis':'现有gen_records.js COL_FOODTYPE，不按常识猜测','dishIdentity':'13口味×3做法合法展开，各自保留ID','stallAssignment':'DR-2F09-VERIFY明确归属；契约t48既有分配','shopLocation':'服务楼，契约:1027建模裁决；不扩展成现场详细地址','floor':'c01_f2 / 2楼，既有契约及导览，未提升为独立现场核实','tastesStatus':'合法未知[]，不是缺陷','priceUnitStatus':'数字价格及做法明确；菜单此表未独立写份/张，不补造展示单位','verificationStatus':'unverified，verifiedAt=null','classification':'BUSINESS_CORE_SUPPORTED_METADATA_DEFERRED','formalAdmission':'NOT_AUTHORIZED'})
 pending.append({'dishId':r['dish_id'],'collector':'UNKNOWN','actualCaptureDate':'UNKNOWN','status':'DEFERRED_BY_OWNER','askOwnerNow':False,'inheritMenuFloorMetadata':False,'nextAction':'本阶段不索取；后续真实元数据确认另行安排'})
assert len(confirmed)==39 and len({r['dishId'] for r in confirmed})==39
wc(E/'confirmed_fields_39.csv',confirmed);wc(E/'deferred_metadata_39.csv',pending)
issues=[{'issue':'门头照与正式签发仍缺','scope':'c01_t48 / 39条共享','basis':'DR-2F09-VERIFY第三/四节明确不覆盖门头、整体核验或正式签发','impact':'不否认已确认菜名/原价/档口归属；阻止宣称全项核验或正式发布','status':'PENDING_EVIDENCE_AND_FORMAL_SIGNOFF','askMetadataNow':False},{'issue':'档口名保留暂定、窗口方位/号码未知','scope':'c01_t48','basis':'现有契约与原CSV，side/no不猜','impact':'建模关联可用，不宣称真实门头名及窗口号已核实','status':'UNKNOWN_PRESERVED','askMetadataNow':False},{'issue':'现行售价/份量单位的现场新确认','scope':'39条','basis':'仅有历史菜单原价，不能自动宣称现行价；源表未独立写每份单位','impact':'预览展示历史来源价格，不补单位、不承诺现价','status':'HISTORICAL_SOURCE_SUPPORTED_CURRENTNESS_UNVERIFIED','askMetadataNow':False}]
wc(E/'remaining_business_issues.csv',issues)
(E/'updated_candidates.json').write_text(json.dumps({'mode':'ISOLATED_BUSINESS_PREVIEW_NOT_FORMAL_ADMISSION','records':orig,'confirmedFields':confirmed,'deferredMetadata':pending,'parentMetadata':'also deferred independently; menu/floor capture identities and dates not inherited','groups':{'evidenceSupportedFields':39,'businessCoreSupportedButMetadataDeferred':39,'newDishSpecificCoreConflictsFound':0,'sharedSubstantiveEvidenceOrSignoffIssues':issues},'strictRulesUnchanged':True,'formalImportCompleted':False},ensure_ascii=False,indent=2),encoding='utf-8')
# Only necessary default business preview; do not repeat M1/M2 strict/negative suites.
t=subprocess.run(['node','tools/import_data.js','--dir',str(D)],cwd=P,capture_output=True,text=True,encoding='utf-8');assert t.returncode==0;(E/'business_preview.log').write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8')
assert all(sha(pathlib.Path(p))==h for p,h in baseline.items())
g=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert g.returncode==0;(E/'git_status.txt').write_text(g.stdout,encoding='utf-8')
(E/'验收报告.md').write_text('''# R02-M3.1 非采集元数据工作结果

负责人已决定延期实际采集人和拍摄日期。本轮39条保持UNKNOWN/PENDING，不再索取、不默认继承菜单与楼层同人同日。CSV保持空值以保留严格拒绝语义；业务预览JSON用UNKNOWN状态说明，绝不把UNKNOWN当作合法collector提交。

已独立逐条验证39条菜名=原表口味+对应做法；三列价逐格一致、foodType来自现有明确列映射；ID沿用既有assigned，39唯一；39来源行、档口归属确认和店楼层契约关联完整。tastes=[]合法，不作为错误、不按菜名猜口味。服务楼名称和location有契约:1027建模裁决支持，档口归属有DR-2F09确认，不扩大成现场正式门头或窗口号码已核实。

分层结果（不是互斥总数）：已有证据支持的核心字段覆盖39条；业务核心数据足以形成预览但采集元数据延期39条；新增单菜核心冲突0。共享实质限制仍有3类：门头/正式签发未齐；档口名暂定及方位号码未核实；历史价不等于当前价、源表未独立注明份量单位。不得宣称39条除了采集人日期已无任何剩余问题。各条均附这些共有的核验/发布限制，不能算作39条已正式准入。

必要测试：源表逐格断言、ID唯一及未知保留全部通过；当前原版导入器默认业务预览退出0，新增与合并均0错误0警告。没有重复M1/M2已通过的照片/负向测试，也不重跑525盘点。严格规则未改，采集字段延期不等于严格门槛豁免；沿用M3真实严格模式退出1，明确该结果是既有证据而非本轮新运行。严格通过仍0，不制造PASS。

交付：updated_candidates.json、四CSV、confirmed_fields_39.csv、remaining_business_issues.csv、deferred_metadata_39.csv、business_preview.log、Git状态和SHA清单。CSV与M3逐字相同是正确结果；实际新增是字段级核对、延期状态与业务预览分类。正式项目原文件SHA均未变，data/审批/ID映射没有改动，未上传、触云、部署或Git写。

PASS：本轮非采集字段核对和业务预览。PENDING：延期采集元数据、共享原始证据/正式签发、现时信息真实性。FAIL：针对性检查0；未声称严格通过。停止，不等待逐项确认。
''',encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'exitCode':0,'dishSourceCellsVerified':39,'uniqueIds':39,'businessPreviewExitCode':0,'metadataDeferred':39,'newCoreConflicts':0,'sharedIssues':3,'strictRuleModified':False,'projectFilesUnchanged':len(baseline)},indent=2),encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS 39 cell-level checks; default preview0; metadata deferred39; shared issues3')
