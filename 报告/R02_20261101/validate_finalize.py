import pathlib,json,csv,hashlib,subprocess,tempfile,shutil,collections
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R02_20261101';D=E/'candidates'
def rr(p):return list(csv.DictReader(p.open(encoding='utf-8-sig')))
def wc(p,rs):
 with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=list(rs[0]));w.writeheader();w.writerows(rs)
rows=rr(E/'recovery_ledger_525.csv');chosen={r['dish_id'] for r in rr(D/'dishes.csv')}
for r in rows:
 if r['category']=='F' and r['originalId'] not in chosen:r['category']='A';r['status']='EVIDENCE_READY_NOT_BATCH_TESTED';r['blocker']='首批之外未逐批运行导入器；正式准入仍blocked'
 if r['originalId'] in chosen:r['status']='DEFAULT_IMPORT_PREVIEW_PASS_STRICT_EVIDENCE_PENDING';r['blocker']='默认模式技术预览通过；严格采集元数据缺失及正式准入未授权'
wc(E/'recovery_ledger_525.csv',rows)
# Negative tests invoke actual importer on external isolated temporary CSV copies.
negative=[]
for case in ['unknown_taste','duplicate_id','missing_photo']:
 with tempfile.TemporaryDirectory(prefix='R02_negative_') as td:
  td=pathlib.Path(td)
  for p in D.iterdir():shutil.copyfile(p,td/p.name)
  rs=rr(td/'dishes.csv')
  if case=='unknown_taste':rs[0]['tastes']='invented'
  elif case=='duplicate_id':rs[1]['dish_id']=rs[0]['dish_id']
  else:rs[0]['evidence_file']=str(td/'absent.jpg')
  wc(td/'dishes.csv',rs)
  t=subprocess.run(['node','tools/import_data.js','--dir',str(td)],cwd=P,capture_output=True,text=True,encoding='utf-8');(E/('negative_'+case+'.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');assert t.returncode==1;negative.append({'case':case,'exitCode':t.returncode,'expected':'reject invalid candidate'})
(E/'negative_tests.json').write_text(json.dumps(negative,indent=2),encoding='utf-8')
base=json.loads((E/'project_before.json').read_text());assert all(hashlib.sha256((P/x['path']).read_bytes()).hexdigest()==x['sha256'] for x in base)
state=json.loads((E/'git_before.json').read_text());g=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert g.stdout==state['status'];(E/'git_after_status.txt').write_text(g.stdout,encoding='utf-8')
(E/'photo_followup.md').write_text('''# R02照片必要性复核结果

复用R01_E4_全项目照片补拍清单_20261101.md及其photo_requirements.json。34个归档对象已有离线OCR，不重新安装环境。当前未完成逐图局部视觉确认，不能据文本源行扫描给出可信最小补拍张数，因此该任务PENDING。既有已证实照片914957…用于39条来源追溯，不因其它档口缺图阻塞此批默认预览。

建议先核查同档口现有所有图再合拍名称-价签-单位；3F小笼包、W06屏幕、W08小字、NG03豆腐/豆角等仍为重点。已由负责人裁决的NG01身份单位、NG03续添及独立价档不重复索证。实际最小照片数未知，不把合拍组数伪装成已核定张数。
''',encoding='utf-8')
(E/'structure_compatibility.md').write_text('''# R02结构适配结果

本轮没有必要修改正式源码，现行R03-D校验已允许[]。39条按既有普通菜品结构直接通过。NG01及NG03复用已批准隔离结构，单独JSON存储，不混入dishes.csv；NG01五条加价保持非独立菜品，NG03十条价格及未知组成不变，D3独立整份价、D4滑蛋异档口已落实。

正式契约172-195的addons仅c01_t11诊断、appliesTo=null，当前导入器54/575-583拒绝加料及套餐，不具备父关联导入。最小方案仍为类型化关系信封+独立选项/规则通道，未知选择规则禁止报价，旧菜品price保持基础/整份价语义。R01_E4_consolidated_20261101/prototype.py已隔离验证，不将其当成正式工具已适配。本轮无需复制正式生成器并放宽准入；不修改契约C19，不分配NG01/NG03 ID。技术适配实施仍PENDING，不能把16条业务裁决完成说成普通导入候选。
''',encoding='utf-8')
count=collections.Counter(r['category'] for r in rows)
(E/'R02_执行报告.md').write_text(f'''# R02批量恢复与首批候选结果

核心成果：39条真实候选JSON/CSV落盘，当前原版导入器默认只读预览退出0，新增及合并数据均0错误/0警告。全部使用既有assigned_from_map ID（c01_d502–d540），来自39条蛋炒三做法展开；每条有转录行/原文/照片/哈希追溯。没有新分配正式ID。首批不是正式准入或上传授权。

## 当前基线与全量台账

当前公开run(dry-run)内存构建：490已生成+35未生成=525；foodType缺失368、tastes=[]490。[]为合法未知状态，不作为错误。当前ID来源由current_build.json保留，非空ID490。台账覆盖525唯一recordKey。主分类 A={count['A']}、B=0、C={count['C']}、D={count['D']}、E={count['E']}、F={count['F']}，总525。分类主因按技术现状而不是历史生成tier：A83已有字段证据但未纳首批实际验证；C19仍需NG02决定；D368缺foodType可靠证据；E16已有NG01/NG03裁决但关系结构/ID/准入未适配；F39默认技术预览通过但正式准入未授权，且严格采集三件套仍缺。F并不意味着仅剩授权一个问题。

## 实际恢复与未解决事项

正式数据恢复/导入0；技术候选39；严格采集元数据模式合格0；正式准入已授权0；只差正式授权0。已有两条精确微辣证据作为单独字段候选落盘（未写源生成器，foodType仍缺，不凑入首批）。16条NG01/NG03源责任已映射成1基础+5加价及10整份价结构预览，业务身份已落实但不是16道可导入普通菜品。其余19条C档仍需双拼茶泡饭业务裁决。35条不再一律写“无裁决”，详见C35_recovery_results.csv。

525条尚无任何正式准入，技术默认预览通过39、尚未达到本轮技术候选验证486；这些统计含重叠维度，不能相加。恢复成果不得计为39条正式恢复或16条新增菜品。首批39仍缺采集人/采集日期等三件套，未填写虚构身份或把照片发送日期当采集日。

## 实际检查结果

import_default.log：原版import_data.js --dir candidates退出0，39菜品+1商家+1楼层+1档口；新增/合并均0错误0警告。
import_strict.log：同一目录 --require-evidence退出1，采集元数据不足（含父级证据三件套缺口）；这是实际未通过，不能隐藏。
regression_verify.log：test_verify_data.js 122通过0失败，退出0。
regression_import.log：test_import_data.js 243通过0失败，退出0。
diff_check.log：git diff --check退出0，只有既有CRLF提示。
三项独立负向测试均调用原版导入器：未知口味、重复ID、证据文件缺失，均退出1且符合拒绝预期，原始输出negative_*.log。验证不是只检查文件存在。

价格来源是明确表列，foodType按既有列映射保留，tastes保持[]；没有依据菜名猜测。candidate_traceability.csv覆盖39/39。未补造collector/date，严格模式FAIL保留为待补证。正式数据字段和verifyStatus没有改动。

## 照片与结构任务边界

照片最小补拍清单仍PENDING：当前能力只提供OCR，未能可靠完成逐图局部视觉必要性核验。沿用已落盘清单，详photo_followup.md，不编造最小张数。其它档口缺图没有阻止39条已有来源候选。

结构适配报告structure_compatibility.md与NG01/NG03隔离JSON已提供；现有正式工具不支持这些关系，未伪造通用组合导入。未修改正式契约、生成器、导入器，源码差异为空；本轮仅新建R02专用分析/负向测试和输出。

## 交付与保护

recovery_ledger_525.csv；first_batch.json；candidates四份CSV；candidate_traceability.csv；C35_recovery_results.csv；field_recovery_proposals.json；NG01_structure.json/NG03_structure.json；photo_followup.md；structure_compatibility.md；全部日志/test_results.json/negative_tests.json；project_before.json与Git前后状态；备份manifest及最终delivery_manifest.json。

没有既有源码被修改，因此备份manifest声明无修改前字节文件，而非伪造备份。正式项目所有{len(base)}个开工文件SHA不变，Git状态前后一致、暂存区未变。没有正式CSV导入、ID分配、Git写或云端调用。候选仅报告目录。

下一轮可直接执行：补首批真实采集人/日期及父级证据；拿到后重跑严格模式；把另外83条有foodType的记录按真实来源分批验证；单独审查NG01/NG03关系模型与ID授权。负责人需决定正式准入、NG02售卖构成及不能从证据确定的映射。缺foodType记录继续取证，不默认填值。完成后停止等待正式导入决定。
''',encoding='utf-8')
# Recompute actual current ID category counts, don't rely on old 386/104.
idcounts=collections.Counter(r['gen']['id_status'] for r in json.loads((E/'current_build.json').read_text())['records']);(E/'id_counts.json').write_text(json.dumps(dict(idcounts),indent=2),encoding='utf-8')
files=[p for p in E.rglob('*') if p.is_file()];(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files],ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS targeted negative tests 3; classes',dict(count),'ID',dict(idcounts),'strict metadata PENDING')
