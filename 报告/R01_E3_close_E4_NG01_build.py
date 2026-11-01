import pathlib,json,csv,hashlib,datetime,shutil,difflib,subprocess
R=pathlib.Path.cwd();O=R/'报告';P=R/'项目';E=O/'R01_E3_close_E4_NG01';E.mkdir();B=R/'备份'/('R01_E3_close_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
report=O/'Codex_R01_E3_执行报告.md';manifest=O/'R01_E3_accelerated/artifacts_manifest.json'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
backup=[]
for p in [report,manifest]:
 q=B/p.name;shutil.copyfile(p,q);assert p.read_bytes()==q.read_bytes();backup.append({'original':str(p),'backup':str(q),'bytes':p.stat().st_size,'sha256':sha(p)})
(B/'manifest.json').write_text(json.dumps(backup,ensure_ascii=False,indent=2),encoding='utf-8')
protected={str(p):sha(p) for p in O.glob('R01_E2_*') if p.is_file()}
for p in [O/'R01_E3_not_generated_triage.csv',O/'R01_E3_business_decisions.csv']:protected[str(p)]=sha(p)
old=report.read_text(encoding='utf-8');new=old.replace('12元/份双拼10','双拼·滑蛋饭组合10条（12/14/16元；12元×8、14元×1、16元×1）');assert old!=new;report.write_text(new,encoding='utf-8')
m=json.loads(manifest.read_text(encoding='utf-8'))
for x in m:
 if pathlib.Path(x['path'])==report:x['bytes']=report.stat().st_size;x['sha256']=sha(report)
manifest.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf-8')
(E/'E3_description_only.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='before/Codex_R01_E3_执行报告.md',tofile='after/Codex_R01_E3_执行报告.md')),encoding='utf-8')
rs=list(csv.DictReader((O/'R01_E3_not_generated_triage.csv').open(encoding='utf-8-sig')));ng=[x for x in rs if x['stallId']=='c01_t20'];assert len(ng)==6
lines=(P/'tools/pilot/TRANSCRIPTION_2F.md').read_text(encoding='utf-8-sig').splitlines()
assert all(lines[int(x['sourceLine'])-1]==x['sourceQuote'] for x in ng)
photo='项目/evidence/ds-session-1e2717cc/sha256_5a4feb479cd48e43c1ac30fab10800417d55dca87519f98119ae5624232d8fcf.jpg'
ocr=json.loads((O/'R01_E3_evidence/ocr_raw.json').read_text(encoding='utf-8-sig'));v=next(x for x in ocr if photo.endswith(x['path']));assert '加 料 单 价' in v['lines'][6] and '基 础 套 餐' in v['lines'][30]
table='\n'.join('| '+x['sourceLine']+' | '+x['dishName']+' | '+x['sourceQuote'].split('|')[-2].strip()+' |' for x in ng)
text='''# E4 第一组：NG01 手抓饼业务裁决材料

状态：PENDING负责人裁决。这里只提出建议，不解除C档、不分配ID、不授权正式导入。

## 原始证据与六条范围

店铺c01服务楼，档口c01_t20“这里有个摊儿”；6条是1条基础套餐与5条加料分组，并非6个已确认独立商品。转录原文：项目/tools/pilot/TRANSCRIPTION_2F.md:336-351。每组中多个名称不能自动拆成独立菜品。

| 源行 | 条目 | 价格原文 |
|---|---|---|
'''+table+'''

照片归档：'''+photo+'''。本轮沿用已生成离线OCR，未改原图或OCR：报告/R01_E3_evidence/ocr_raw.json，匹配path后，lines第7项为“加 料 单 价”，第31项为“注：基础套餐默认有鸡蛋，不吃请提前告知”（此处去除OCR空格供阅读；JSON原文保留）。OCR未可靠识别“4元/张”或“4元/套”，因此不能用其确认单位。归档文件与转录稿、OCR的可信范围必须分开。

契约项目/docs/RECORD_GENERATOR_CONTRACT_20261023.md:39、249、444、1146：用户裁定先跳过；B5·2F-W2-06计价口径未决；C档不下发dishId。生成器:2661 C档candidate=null。现有CSV的NOT_GENERATED只是源条目，不是商品身份批准。

## 问题一：4元是元/张还是元/套？

**现有证据不能确定。** 转录:340写“手抓饼基础套餐（默认含鸡蛋）|4元”，没有单位后缀。:351说明“基础4元+加料累加，不是固定单品价，入库方式要定”；这是采集整理文字，不等于新增商家确认。OCR第31行支持基础套餐含蛋，不能证明“张/套”二选一。

| 选项 | 支持 | 反对或不足 | 对数据结构的影响 |
|---|---|---|---|
| 元/张 | 商品为手抓饼，可能按一个饼售卖 | 当前原文没有“张”，仅凭品类不足以确认 | 需明确张包含鸡蛋及基础配料；不能把4元当裸饼价；单位/规格字段是否承载须后续审查 |
| 元/套 | 原文“基础套餐”及含蛋提示支持一种基础组合 | “套餐”不证明计价单位正式为套，也未列全默认内容 | 若选择套，需明确套餐定义；不能直接套用现有单菜price，亦不得自动启用未授权套餐组件模型 |
| 暂不确定单位 | 忠实保留原文4元与基础套餐提示 | 暂时不能形成可导入的商品规格 | 保持NOT_GENERATED/C档 |

**推荐：当前选择“单位待确认，继续阻塞”**，而不是替商家判定张或套。若负责人取得真实确认，可优先按“含蛋基础套餐4元/份（实际售卖单位另确认）”讨论，但“份”也不是本轮已证实单位，不能写入正式字段。尚缺：清晰的4元附近单位标注，或商家明确说明“一份4元包含什么、包含几个饼、是否加蛋另付费”。

**负责人需决定：** 是否已有可引用的真实确认支持张或套？若没有，维持未知；确认后还需明确默认含项和去蛋是否减价，不能从“不吃请告知”推断减价。

## 问题二：五条加料是独立菜品还是可选配料？

原图OCR明确读到“加料单价”，转录:341-345按价位列油条等、双黄蛋、鸡柳等、纯肉肠等、土豆丝；:351说明加料累加。它们支持**加料分组**，没有证明可以脱离手抓饼单独购买。个别项目“元/份”仅表明某加料的计价单位，不证明独立售卖资格。

| 选项 | 支持 | 反对或不足 | 对数据结构的影响 |
|---|---|---|---|
| 作为5条独立菜品 | 有单独价格和名称分组 | “加料单价”及累加说明反对直接独立商品解释；多名称同行也不是单一SKU | 会使配料参与菜品筛选、推荐与计数，并可能需拆分多个名称；当前没有授权 |
| 作为手抓饼可选配料 | 加料单价标题、基础套餐含蛋、加料累加三项一致 | 尚未确认是否可单买、可选数量/重复次数、默认蛋与额外蛋区别 | 应关联基础商品的选项/加价信息，不生成5个独立dish；现有模型是否支持须单独设计批准，不能本轮自动实现 |
| 保持未知、继续阻塞 | 不新增未经证实的售卖关系 | 暂无结构化可导入数据 | 继续保留6条源条目 |

**推荐：业务解释采用“可选配料”为优先待确认方案**，有“加料单价”直接文字支持；在确认独立售卖能力及选项模型之前，不把5条加料注册成菜品。推荐解释不是负责人裁决，也不等于已有技术模型获批。

尚缺：商家是否允许独立购买；各名称对应的单价/单位及份量；基础含蛋与额外蛋关系；可否多选/重复；哪些酱料免费；选项模型的正式授权。无需猜测口味或foodType。

**负责人需决定：** 是否确认5条是基础手抓饼的可选加价组？如果有部分可单买，请逐项提供真实依据并单独批准记录形态，不能一组全部升级。

## 裁决边界

待裁决两项：单位（张/套/暂不确定），加料角色（可选配料/有证据的独立售卖部分/暂不确定）。两项即使裁决完成，正式ID、契约准入及可能的套餐/加料结构仍需独立批准。本轮6条完整保留，未改变35条总数或203项归组。
'''
(O/'R01_E4_NG01_手抓饼业务裁决材料.md').write_text(text,encoding='utf-8')
assert all(sha(pathlib.Path(p))==h for p,h in protected.items())
base=json.loads((O/'R01_E2_20261101_evidence/project_before.json').read_text());assert all(sha(P/x['path'])==x['sha256'] for x in base)
assert all(sha(pathlib.Path(x['path']))==x['sha256'] and pathlib.Path(x['path']).stat().st_size==x['bytes'] for x in m)
git=subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),'status','--porcelain=v1','-uall'],cwd=P,capture_output=True,text=True,encoding='utf-8');assert git.returncode==0
(E/'git_status.txt').write_text(git.stdout,encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'descriptionReplacements':1,'NG01':6,'triageCSVUnchanged':True,'businessCSVUnchanged':True,'E2ProtectedFiles':protected,'projectFilesUnchanged':len(base),'allManifestHashesValid':True,'exitCode':0,'backups':backup},ensure_ascii=False,indent=2),encoding='utf-8')
(O/'Codex_R01_E3收尾_E4_NG01_执行报告.md').write_text('''# E3收尾与E4 NG01执行报告

PASS：仅更正E3执行报告中的第三组摘要为“双拼·滑蛋饭组合10条（12/14/16元；12元×8、14元×1、16元×1）”；CSV行未改，35条NOT_GENERATED及203项归组未变。前后精确diff在R01_E3_close_E4_NG01/E3_description_only.patch。E3原manifest更新该报告字节与SHA，其他条目不改，逐条哈希验证通过。

PASS：NG01六条完整、源行340-345逐字一致；提取照片OCR第7项“加料单价”及第31项基础套餐默认含蛋，未从OCR确认张/套。4元的单位仍PENDING；加料作为可选配料是推荐解释，尚待负责人确认与模型批准。详细正反证据及结构影响见R01_E4_NG01_手抓饼业务裁决材料.md。

PASS：针对性检查脚本退出0；E2交付物与376个项目文件SHA不变，正式data、生成器、契约、id-map、审批及照片/OCR/转录未变。Git只读状态在git_status.txt；未Git写、正式导入、分配ID、部署或触云。未运行无关完整套件。

备份路径、原字节数及SHA在checks.json，外部备份均逐字节验证。全部本轮文件大小与SHA在delivery_manifest.json。PENDING：NG01价格单位和加料身份业务裁决；未解除任何准入阻塞。FAIL：0（针对性检查）。停止等待负责人裁决。
''',encoding='utf-8')
files=[report,manifest,O/'R01_E4_NG01_手抓饼业务裁决材料.md',O/'Codex_R01_E3收尾_E4_NG01_执行报告.md']+list(E.glob('*'))
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS description-only diff; manifests valid; NG01 six source rows verified; CSV/E2/project unchanged; EXIT=0')
