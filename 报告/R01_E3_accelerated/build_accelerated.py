import pathlib,csv,json,collections,hashlib,shutil,subprocess
R=pathlib.Path.cwd();O=R/'报告';E=O/'R01_E3_accelerated';E.mkdir();B=E/'before';B.mkdir()
names=['R01_E3_not_generated_triage.csv','R01_E3_business_decisions.csv','R01_E3_image_review.csv','R01_E3_new_candidates.csv','R01_E3_blocker_summary.md']
for n in names:shutil.copyfile(O/n,B/n)
def rows(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rs):
 with p.open('w',encoding='utf-8-sig',newline='') as h:
  w=csv.DictWriter(h,fieldnames=list(rs[0]));w.writeheader();w.writerows(rs)
tri=rows(O/names[0]);rules={'c01_t20':('NG01',6,'1146','保留跳过；或明确元/张与元/套、基础套餐含项及加料是否独立录入。','需要确认基础4元计价单位与5条加料是否允许成为菜品，不得推导组合价。'),'c01_t40':('NG02',19,'1148','保留C档；或确认是独立双拼套餐还是可选拼菜并给出记录形态和价格绑定。','2F双拼裁决不能跨档口套用；需要明确19行各自的售卖单位和组件。'),'c01_t41':('NG03',10,'1149','保留C档；或明确12元/份究竟是单菜、一饭一菜还是双拼规则。','不得把统一12元自动分摊到单菜；需要确认10行与价格适用关系。')}
for x in tri:
 g,n,line,options,question=rules[x['stallId']];x.update(blockerGroup=g,contractEvidence='项目/docs/RECORD_GENERATOR_CONTRACT_20261023.md:'+line,requiredQuestion=question,availableChoices=options,existingMaterialConclusion='来源行存在；现有OCR不证明业务规则，不能直接恢复。',recoverableCandidate=False)
wc(O/names[0],tri)
b=rows(O/names[1]);groups=collections.defaultdict(list)
for x in b:
 if x['fieldName']=='tastes':
  q=x['evidenceQuote'];ctx=x['contextQuote']
  k=('T01' if x['stallId']=='c01_t37' else 'T02' if '六选一' in ctx else 'T03' if '锅底免费' in ctx else 'T04' if x['conflictStatus']=='COMPOUND_ROW_SCOPE_UNRESOLVED' else 'T05' if '不辣' in q else 'T06' if '辣度适中' in q else 'T07' if '（辣）' in q else 'T08')
 else:k='F_COMPOUND' if x['conflictStatus']=='COMPOUND_ROW_SCOPE_UNRESOLVED' else 'F_CATEGORY'
 groups[k].append(x)
opts={'T01':('段末口味适用范围','保留未知；或逐项确认适用菜品后分别确定辣度，不将全档口设为choice。'),'T02':('风味与辣度不同','保留未知；或另建风味概念（需另行设计），不可把六种风味直接设choice。'),'T03':('锅底与辣度不同','保留未知；或确认每锅是否支持辣度选择及对应值。'),'T04':('组合行仅部分变体有微辣','保持单行未知；或另行裁决变体建模，不自动拆条。'),'T05':('不辣不等于清淡','保持[]；若负责人重新定义light语义才可能映射，须独立契约裁决。'),'T06':('适中不等于微辣','保持[]；或明确适中对应哪一档，不预设mild_spicy。'),'T07':('辣不等于麻辣','保持[]；或确认spicy产品语义及本菜实际味型。'),'T08':('原味不能确定辣度','保持[]；或补充明确的辣度确认。'),'F_COMPOUND':('并列单行的主食/菜品范围不明确','保持null；确认每个变体主食及单条表示方式，不自动拆分、不推断枚举。'),'F_CATEGORY':('栏目标题不能证明具体菜品类型','保持null；按栏目集中核对，但必须明确每道菜的主食依据与枚举，不能整栏自动填充。')}
summary=[]
for k,items in sorted(groups.items()):
 reason,option=opts[k];summary.append({'groupId':k,'fieldName':items[0]['fieldName'],'count':len(items),'dishes':[{'dishId':x['dishId'],'name':x['dishName'],'stallId':x['stallId'],'source':x['evidenceFile']+':'+x['evidenceLocation']} for x in items],'reason':reason,'choices':option,'evidenceContexts':sorted(set(x['contextQuote'] for x in items))})
 for x in items:x.update(decisionGroup=k,groupCount=len(items),groupReason=reason,availableChoices=option,specificDecisionQuestion=reason+'；'+option+' 请明确适用范围及是否维持未知。')
wc(O/names[1],b);(E/'decision_groups.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
ocr=json.loads((O/'R01_E3_evidence/ocr_raw.json').read_text(encoding='utf-8-sig'));om={x['path']:x for x in ocr};images=rows(O/names[2]);inv=rows(O/'R01_E2_tastes_inventory.csv')+rows(O/'R01_E2_foodType_inventory.csv')
for x in images:
 raw=om[x['archivePath']];compact=''.join(raw['text'].split());matches=[]
 for y in inv:
  name=y['dishName'];needle=''.join(name.split())
  if len(needle)>=4 and needle in compact:matches.append({'dishId':y['dishId'],'name':name,'field':y['fieldName'],'match':'OCR_EXACT_NAME_ONLY_NOT_FIELD_PROOF','source':y['evidenceFile']+':'+y['evidenceLocation']})
 x.update(ocrEvidenceLocation='报告/R01_E3_evidence/ocr_raw.json path='+x['archivePath'],exactNameLinks=json.dumps(matches,ensure_ascii=False),exactNameLinkCount=len(matches),itemFieldProof='NOT_ESTABLISHED_NAME_MATCH_IS_NOT_TASTE_OR_TYPE_PROOF')
wc(O/names[2],images)
lines=['# R01-E3 阻塞与合并决策清单','', '未生成：35条，直接恢复0；业务裁决35（NG01=6、NG02=19、NG03=10），并有次级契约准入要求。每条source行与源码位置保留。','', '203个B字段合并为以下10个问题组，组内全部菜品与证据在decision_groups.json及CSV中列全。','']
for g in summary:lines+=['## '+g['groupId']+' / '+g['reason']+' / '+str(g['count'])+'项','',g['choices'],'', '涉及菜品：'+'；'.join(x['dishId']+' '+x['name'] for x in g['dishes']),'']
(O/names[4]).write_text('\n'.join(lines),encoding='utf-8')
assert len(tri)==35 and len(b)==203 and sum(g['count'] for g in summary)==203 and len(images)==35
P=R/'项目';baseline=json.loads((O/'R01_E2_20261101_evidence/project_before.json').read_text());assert all(hashlib.sha256((P/x['path']).read_bytes()).hexdigest()==x['sha256'] for x in baseline)
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
s=git(['status','--porcelain=v1','-uall']);assert s.returncode==0
old=json.loads((O/'R01_E2_20261101_evidence/git_before.json').read_text());assert s.stdout==old['status']
(E/'git_status.txt').write_text(s.stdout,encoding='utf-8');(E/'validation.txt').write_text('PASS 35 triage / 203 fields / '+str(len(groups))+' groups / 35 images / 376 project hashes unchanged / Git unchanged\nEXIT=0\n',encoding='utf-8')
report='''# R01-E3 加速执行报告

本轮将203项重复业务问题合并为10组，并细化35条未生成阻塞及照片OCR对应线索。分析交付PASS；业务恢复与原图逐字段确认仍PENDING。

未生成35条：可直接恢复0、需要业务裁决35（手抓饼6、茶泡饭双拼19、12元/份双拼10），缺材料主分类0、契约准入主分类0；35条均有次级契约/准入要求。未将主要业务规则缺口伪装成可用OCR补齐。NG01/02/03的明确问题和可选方案见triage表。当前C档不下发dishId的源码为gen_records.js:2661；契约1146/1148/1149与1874保留不生成规则，不能单独修改C19放行。

B字段40 tastes+163 foodType=203，合并为10组：
'''
for g in summary:report+='\n- '+g['groupId']+' '+g['reason']+'：'+str(g['count'])+'项。'
report+='''

foodType分两大问题组；各组内栏目标题已列全，可按栏目集中询证，但不因同栏目统一填值。全部涉及菜品及精确源行在decision_groups.json，简明决策方案在blocker_summary.md。

照片35条对应34对象。复用本轮前段刚完成的Windows离线中文OCR原始结果；34对象均成功解码识别。新增逐图exactNameLinks：仅在OCR去除空格后完整出现菜名时建立可检索线索，每项带dishId及转录行；这不是菜品口味/类型的证明，也不是已经确认档口归属。无匹配或范围不明均待人工复核。原图文字仍需结合视觉确认，不能根据OCR顺序或同名菜跨档口放行。新增A候选0、B升级0、C补证完成0，候选表保持空；照片语义复核35项PENDING。

与E2相比：完成真实离线OCR（见既有ocr_raw.json）、35条逐项业务阻塞定位、203字段压缩成10个可裁决组及逐图精确菜名检索链接；未改变E2原始数据、缺失数、分类或两个微辣候选。本轮关闭的是重复解释和定位不明确的问题；35条录入裁决、203项字段决策及35项照片语义确认仍待处理。这些维度重叠，不相加为菜品总数。

验证：独立build_accelerated.py退出0；35/203/35行数、分组守恒及376个项目文件SHA检查通过。Git status与E2基线完全一致，暂存区保持基线；未再次执行无关套件，复用E3此前E2独立15组PASS/0FAIL证据（报告/R01_E3_evidence/e2_reused_test.log）。本轮结果validation.txt退出0。所有改前E3交付物已保存before副本，不覆盖原始项目。

6件指定交付及辅助文件字节数、SHA-256在R01_E3_accelerated/artifacts_manifest.json；前版备份亦列入。未修改data、正式CSV、生成器、契约、映射或审批；未重新生成数据，未分配ID、正式导入、云端调用、部署或Git写。执行停止，交DSH独立验收。
'''
(O/'Codex_R01_E3_执行报告.md').write_text(report,encoding='utf-8')
files=[O/n for n in names]+[O/'Codex_R01_E3_执行报告.md']+[p for p in E.rglob('*') if p.is_file()]
(E/'artifacts_manifest.json').write_text(json.dumps([{'path':str(p.resolve()),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'groups':{g['groupId']:g['count'] for g in summary},'photoNameLinks':sum(int(x['exactNameLinkCount']) for x in images),'exitCode':0}))
