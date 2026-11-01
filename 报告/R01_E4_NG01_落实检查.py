import pathlib,json,csv,hashlib,datetime,shutil,subprocess,difflib
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R01_E4_NG01_20261101';E.mkdir();B=R/'备份'/('R01_E4_NG01_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
protected={str(p):sha(p) for p in O.glob('R01_E[23]*') if p.is_file()}
material=O/'R01_E4_NG01_手抓饼业务裁决材料.md';shutil.copyfile(material,B/material.name);old=material.read_text(encoding='utf-8');new='''# NG01 业务裁决：负责人已确认

日期：2026-11-01。依据：本轮负责人明确指令D1/D2。

- D1已确认：含蛋基础手抓饼套餐，4元/份，鸡蛋已包含，性质为基础菜品。价格单位不再待裁决；该单位来源是负责人本轮裁决，不伪称原图识别结果。
- D2已确认：原五条为基础菜品的可选加价项，必须关联主品，不作五道独立菜品。
- 尚未确认：可否多选、每种重复数量、选择上限、加价项之间互斥、额外鸡蛋与默认鸡蛋的具体处理。不能从D2推导这些规则。

源条目与原价见TRANSCRIPTION_2F.md:340-345；结构预览和兼容性分析见R01_E4_NG01_裁决落实与候选结构_20261101.md。当前正式生成器/契约未修改，技术准入仍未实施。本轮不分配dishId、不正式导入。

以下为裁决前分析历史，已被上述D1/D2取代；其中“单位待确认”“加料身份待负责人确认”等只描述裁决前状态，不再作为当前待决事项。

---
'''+old
material.write_text(new,encoding='utf-8')
rs=list(csv.DictReader((O/'R01_E3_not_generated_triage.csv').open(encoding='utf-8-sig')));ng=[x for x in rs if x['stallId']=='c01_t20'];assert len(ng)==6
source=(P/'tools/pilot/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines();opts=[]
for i,(row,price) in enumerate(zip(ng[1:],[1,1.5,2,3,1]),1):
 assert source[int(row['sourceLine'])-1]==row['sourceQuote']
 opts.append({'previewRef':'NG01-option-'+str(i),'basePreviewRef':'NG01-base','sourceRecordKey':row['recordKey'],'name':row['dishName'],'members':[x.strip() for x in row['dishName'].split(' / ')],'additionalPriceYuan':price,'priceAppliesTo':'each_named_item_not_entire_slash_group','unit':'份' if i==5 else None,'selectionMode':None,'repeatQuantityAllowed':None,'independentDish':False,'sourceFile':'项目/tools/pilot/TRANSCRIPTION_2F.md','sourceLine':int(row['sourceLine']),'rawRow':row['sourceQuote']})
preview={'status':'REPORT_PREVIEW_ONLY_NOT_IMPORTABLE','decisionSource':'负责人2026-11-01本轮指令D1/D2','baseDish':{'previewRef':'NG01-base','dishId':None,'sourceRecordKey':ng[0]['recordKey'],'shopId':'c01','stallId':'c01_t20','name':'含蛋基础手抓饼','description':'含蛋基础手抓饼套餐','priceYuan':4,'priceUnit':'份','eggIncluded':True,'businessNature':'基础菜品','tastes':[],'foodType':None,'sourceLine':340,'priceUnitEvidence':'负责人D1，不是OCR推断'},'optionalSurchargeRows':opts,'pricing':{'formula':'4 + sum(已确认所选具体配料单价 × 已确认数量)','executable':False,'selectionCombinationRules':None,'quantityRules':None,'roundingRules':None,'unknownHandling':'任何选择规则/数量/价格未确认则返回无法报价，不能默认零加价或默认数量1','baseOnly':4},'formalImportAuthorized':False}
(E/'NG01_candidate_preview.json').write_text(json.dumps(preview,ensure_ascii=False,indent=2),encoding='utf-8')
table='\n'.join('| '+str(x['sourceLine'])+' | '+x['name']+' | '+str(x['additionalPriceYuan'])+' |' for x in opts)
report='''# NG01 裁决落实与候选结构

D1/D2落实PASS；正式契约/导入能力PENDING。负责人已确认基础含蛋手抓饼4元/份、性质为基础菜品；五条加料为关联可选加价项。两项不再列为待裁决。正式代码和数据未改。

## 六条去向与价格

原始CSV六条按sourceRecordKey一一映射：340→NG01-base；341-345→NG01-option-1至5。previewRef仅为报告内部关联键，不是正式dishId。基础菜品含蛋，4元/份，原文4元在转录:340，单位与基础菜品性质由本轮D1确认。

| 源行 | 原文加料分组 | 每个所列配料的加价（元） |
|---|---|---:|
'''+table+'''

证据：项目/tools/pilot/TRANSCRIPTION_2F.md:341-345；各1元/1.5元/各2元/各3元/土豆丝1元每份。斜杠名称表示同价配料列表，不能理解成整组一起加的套餐价。保留五条源行与成员名称，不另建五道菜；也不擅自将成员转为多个正式SKU。除土豆丝外未补造单位。照片OCR的“加料单价”和“基础套餐默认有鸡蛋”仅作为已有辅助证据；未修改OCR或以其补造价格。

基础字段及五项结构见R01_E4_NG01_20261101/NG01_candidate_preview.json。foodType未知、tastes=[]，不按菜名猜测。不分配正式ID，不提升verifyStatus或审批状态。

## 关联和价格规则

五条均用basePreviewRef关联NG01-base。数学价格表达为4元 + 已确认选中的具体配料单价×已确认数量之和。基础鸡蛋不再次收费；额外选择“鸡蛋”的含义仍需明确，不能重复计基础鸡蛋。数学表达不是授权多选或数量规则：多选/互斥/数量/上限均null，pricing.executable=false；有任何规则或价格未知就不能报最终价，不能默认为1份或0元。当前仅基础不加料的4元/份已确定。是否允许用户选择空加料以外的具体组合尚未确认。

## 契约和导入兼容性

1. 契约并非完全没有加料结构：RECORD_GENERATOR_CONTRACT_20261023.md:172-195已有addons[]，但限定c01_t11/W2-03，只读诊断、不进records、不分配dishId，appliesTo固定null、appliesToStatus=unknown。不能直接用于已确认关联的c01_t20。
2. 契约:39、249、444、1146仍保留NG01 C档不生成；本轮业务裁决已经解决身份与基础单位问题，但未同步修改这些正式技术条款。不得直接运行旧生成器期望自动改变结果。
3. 导入器import_data.js:54明确套餐/加料/店铺规则不支持；:575-583拒绝这些record_type。:623-636创建的dish字段没有选项关联。正确标成“加料”会拒绝；若错误标成“菜品”，普通导入路径没有足够语义识别来保证不会作为独立菜品，因此本预览不能送入正式CSV。
4. 名称中的“套餐”不应自动推导record_type=套餐；D1裁定其业务性质为基础菜品。基础含蛋内容属于说明，是否需要组件结构另行审查。
5. 最小后续建议：单独审查NG01生成准入规则；在不改变旧菜品字段含义的前提下，扩展独立选项/选项组承载结构，显式parent关联、源行、配料价格及未确定的选择约束；CSV若要支持，使用明确选项通道，不能混入dishes.csv。现有addons诊断结构可作为迁移参考，但不能假装已经支持可选加价和父子关联。
6. 兼容性影响：既有菜品默认无选项，保留现有price；price继续是基础价，不能改成含所有加料总价。后续需测试旧数据展示/导入不变、加料不计入独立菜品数量、非法父关联拒绝、未知规则不计算报价。这里只建议，未实施契约或导入器调整。

## 针对性验收

PASS：6条唯一源键全部映射为1基础+5关联选项；基础含蛋4元/份；加料价格与转录逐行一致；正式dishId为null；五项independentDish=false；组合规则保持未知。PASS：裁决材料已更新并保留旧分析的历史属性说明。PASS：E2/E3交付字节未改，正式项目文件哈希与基线一致。PENDING：选择组合、数量、额外鸡蛋规则及正式结构兼容实现。未执行正式导入、ID分配、Git写、部署或云端调用。

修改前备份、精确diff、针对性检查输出、Git状态和全部文件SHA-256见同目录证据；测试只检查本次结构与不变性，不运行无关完整套件。停止等待下一阶段指令。
'''
(O/'R01_E4_NG01_裁决落实与候选结构_20261101.md').write_text(report,encoding='utf-8')
assert len(opts)==5 and all(not x['independentDish'] and x['basePreviewRef']=='NG01-base' for x in opts)
assert len({ng[0]['recordKey']}|{x['sourceRecordKey'] for x in opts})==6
assert all(sha(pathlib.Path(p))==h for p,h in protected.items())
base=json.loads((O/'R01_E2_20261101_evidence/project_before.json').read_text());assert all(sha(P/x['path'])==x['sha256'] for x in base)
git=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert git.returncode==0
(E/'git_status.txt').write_text(git.stdout,encoding='utf-8');(E/'material.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True))),encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'exitCode':0,'sixSourceRowsMapped':True,'baseDishes':1,'surchargeRows':5,'formalIDsAssigned':0,'E2E3FilesUnchanged':len(protected),'projectHashesUnchanged':len(base),'backup':str(B/material.name),'backupBytes':(B/material.name).stat().st_size,'backupSHA256':sha(B/material.name)},ensure_ascii=False,indent=2),encoding='utf-8')
# Prior manifest referring to the editable NG01 document is intentionally retained as a historical snapshot; current hashes supplied below.
files=[material,O/'R01_E4_NG01_裁决落实与候选结构_20261101.md']+[p for p in E.iterdir() if p.is_file()]
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files],ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS 6 source rows -> 1 base + 5 surcharge rows; E2/E3/project unchanged; EXIT=0')
