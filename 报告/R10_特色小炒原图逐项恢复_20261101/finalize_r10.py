import pathlib,json,hashlib,difflib,csv
E=pathlib.Path(__file__).parent.resolve();R=E.parent.parent;P=R/'项目'
def J(n):return json.loads((E/n).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
C=J('candidates.json');s=J('statistics.json');cross=[]
for d in (R/'报告').iterdir():
 if d.is_dir() and d!=E and __import__('re').match(r'R0[3-9]_',d.name) and (d/'candidates.json').exists():
  for pc in json.loads((d/'candidates.json').read_text(encoding='utf-8-sig')):
   for c in C:
    if pc.get('name',pc.get('dishName'))==c['name']:
     assert '6c425a9df62764c447df8841579c01b4eb86abd715b5527824c777061cd26c9f' not in json.dumps(pc,ensure_ascii=False),'same photo/name already generated'
     cross.append({'name':c['name'],'otherBatch':d.name,'otherCandidateId':pc['candidateId'],'disposition':'same name different source; no identity merge'})
(E/'same_name_crosscheck.json').write_text(json.dumps(cross,ensure_ascii=False,indent=2),encoding='utf8')
report='''# R10 连续执行：特色小炒原图逐项恢复

由R09工单“完成后继续检查下一批”的授权连续执行。本地独立菜品生成PASS，待DSH复核，正式准入PENDING。

来源：PHOTO_MANIFEST 2F-16原图sha256_6c425a9d…26c9f.jpg、既有Windows本地OCR、TRANSCRIPTION_2F.md 613—625主表。源档口历史称W2-13重庆名小吃，但不继承旧正式档口ID，使用R10-PHOTO-2F16。对未生成的待核验聚合组增添新逐菜证据，不改写R04。

13个物理菜单表行明确列37个成员，本轮15个成员有菜名和价格同一OCR行且与原文精确同价，形成15条独立菜品候选；其余22项进入unresolved。源组/台账37，不把价列顺序推定为同价证据。新增子项15、PENDING22，旧记录替换/作废/写入0；组件0、加料0、套餐0，正式ID分配/导入0。

15条实际记录：肉末茄子11、香辣火腿11、火腿鸡蛋12、鱼香茄子11、西红柿炒鸡蛋11、酸菜肉丝12、肉末豆角12、土豆鸡丁13、辣子鸡丁13、辣椒炒肉14、泡椒猪肝13、红烧牛肉18、鱼香肉丝15、甘兰回锅肉15、孜然土豆11。名称按源文与OCR一致保留，不自动加“饭”或确定份量，不猜口味。它们是原菜单特色小炒项，不是从加料或套餐拆出。

同名跨批次检查保存same_name_crosscheck.json；没有同照片同名已生成记录，其他照片同名不证明同店，身份未知不合并。父级正式名称、楼层未知，采集日期/人延期。当前价格UNKNOWN且不准交易。正式dishId=null、verifyStatus=unverified。原图/既有OCR/源转录字节快照及外部before备份一致，未宣称新人工视觉验真。

主表之外627小牌、629价挡疑问未混入本轮37分母，仍为原材料后续核验范围；未通过遗漏辅助材料冒充“全菜单恢复”。本批不重做既有判定或改变区域。

实际python -X utf8 build_r10.py：exit0；python -X utf8 test_r10.py：17 PASS / 0 FAIL / 0 SKIP，exit0，见test_output.txt。8项负向：改价、改名、伪造日期、正式ID、猜辣、报价、重复、猜组合。13行37成员覆盖、OCR同行精确匹配、原图SHA、before、项目/已关闭交付不变均通过。git diff --check exit0，既有project.config.json CRLF提示不修改。

相同照片同名的跨批检查在finalize_r10.py中再次实际执行通过。Git分支/HEAD/暂存/工作区状态前后一致。R03-R09全部字节未变（R09为本轮先行交付，亦不在R10中修改）。没有正式数据/审批/契约/ID映射/Git写操作，也无云端/部署/索引。

PASS：15独立候选、37责任完整、17测试、备份/哈希、边界保护。PENDING：22项未获同行精确OCR证据、辅助小牌、父级身份、元数据与正式准入。累计独立候选480=454已验收+R09 11+R10 15；后26待DSH，正式导入0。R08组件2、加料5绝不加入480。

完整文件清单见file_manifest.json/manifest.sha256；diff.patch为明确工作文本的新建差异，不含证据二进制，也不声称可git apply。项目进度另存batch_progress.md不覆盖历史。下一材料核对见next_material_status.md，不声称全部原图像素已经穷尽识别。
'''
(E/'execution_report.md').write_text(report,encoding='utf8')
(E/'batch_progress.md').write_text('''# 全项目批次进度：连续执行快照

| 批次 | 独立菜品候选 | 其他 | 状态 |
|---|---:|---|---|
| R03 |133|来源关系见原冻结报告|已验收冻结|
| R04 |113|5加料组|已验收冻结|
| R05 |30|8加料/3待适配套餐|已验收冻结|
| R06 |140|楼层未定132不强挂|已验收冻结，沿用负责人统计口径|
| R07 |38|24加料+1补充；5阻断|已验收冻结|
| R08 |0|2组件、5加料、8待核验组|已验收冻结|
| R09 |11|5待核验材料组|本地通过，待DSH|
| R10 |15|22待核验逐菜源项|本地通过，待DSH|

独立菜品累计480。正式准入依然PENDING，正式导入0。候选数是来源记录口径，不是全校不同物理商品的已签署唯一性结论。后26条是从原待核验父源组新增逐菜证据，不重复既有候选，也不把原父组改为PASS。
''',encoding='utf8')
(E/'next_material_status.md').write_text('''# 继续核对下一批

已实际继续R09→R10，新增独立菜品11+15，而非停在推荐报告。

剩余原图2F-02粥/饼、2F-13猪肚鸡/小炒、2F-15拌饭/小锅等仍有可能补充独立菜品，但其部分名称或价列OCR错字/分离，不能直接按数组顺序配价。它们已有R04原文责任，但尚非新独立候选；后续应逐项原图定位，不重写冻结批次。R09本图剩余5材料组、R10主表22项及辅助小牌也继续保留。

本轮未宣称全部现有材料已经完成语义核验。明确来源转录与照片均已有责任去向，但“材料有去向”不等于“全部菜品已恢复”。照片内容无法确认不因区域划分/延期采集人而停摆；无需重新裁决已批准NG01/NG03。
''',encoding='utf8')
ns=['build_r10.py','test_r10.py','candidates.json','source_groups.json','source_ledger.csv','source_ledger.json','unresolved.csv','optional_surcharges.json','bundle_relations.json','statistics.json','execution_report.md','batch_progress.md','next_material_status.md']
(E/'diff.patch').write_text(''.join(''.join(difflib.unified_diff([], (E/n).read_text(encoding='utf-8-sig').splitlines(True),fromfile='/dev/null',tofile='R10/'+n)) for n in ns),encoding='utf8')
entries=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(E.rglob('*')) if p.is_file() and p.name not in ['file_manifest.json','manifest.sha256']];(E/'file_manifest.json').write_text(json.dumps({'files':entries,'excludesSelf':True},ensure_ascii=False,indent=2),encoding='utf8');entries.append({'path':'file_manifest.json','sha256':sha(E/'file_manifest.json')});(E/'manifest.sha256').write_text(''.join(x['sha256']+'  '+x['path']+'\n' for x in entries),encoding='utf8');assert all(sha(E/x['path'])==x['sha256'] for x in entries);print('R10 manifest:',len(entries),'PASS; prior-photo/name duplicate check PASS; candidates 15')
