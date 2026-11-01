import pathlib,json,hashlib,datetime,collections
E=pathlib.Path('报告/R04_2F_20261101');J=lambda n:json.loads((E/n).read_text(encoding='utf-8-sig'))
s=J('statistics.json');cs=J('candidates.json');counts=collections.Counter(c['stallRef'] for c in cs)
report=f'''# R04 二楼历史菜单恢复与候选生成

状态：本地隔离候选生成 PASS；正式准入、严格证据模式及当前价格核验 PENDING。未正式导入。

## 选层依据与范围

本轮选择服务楼二楼。当前 E2 覆盖表可独立复算二楼382条旧源记录（376条已有生成结果、6条NG01未生成），源转录稿为 `source_assets/TRANSCRIPTION_2F.md`。三楼R03已关闭，本轮不重做；早期 TRANSCRIPTION_DRAFT 为跨位置抽样且档口身份关联不完整，未优先于二楼。二楼16个档口均进入对应表，不因缺图忽略旧记录。

复用正式生成器 `gen_records.run({{mode:'dry-run'}})` 和其 `__test__.parseDoc`，仅截取2F源结果。`capture_2f.js`保留调用，`current_2f_capture.json`保留实际输出。没有调用 --write。隔离的 `build_r04.py`只在旧结果上恢复明确规格列及已裁决NG01关系，不改变正式生成器、契约和准入。

## 可独立复算的数量

| 指标 | 数量 |
|---|---:|
| 旧源记录责任数 |382|
| 原已有生成结果 |376|
| 原未生成NG01源行 |6|
| 新源组数（包括一项待核验价义拆分）|383|
| 隔离菜品/规格候选 |113|
| 候选对应源组 |105|
| 既有39条复用 |39|
| 超出既有39条的候选 |74|
| 独立加料关系组（不计菜品）|5|
| 待核验源项 |273|
| 新分配正式ID / 正式导入 |0 / 0|

台账动作：RETAIN=96、SPLIT=9、REPLACE=6、PENDING=271；合计382。VOID、MERGE、NEW均为0：本轮没有证据支持新增档口合并或旧记录作废，不为凑齐动作类型编造变更。REPLACE的6条对应1基础菜品与5加料组，不是六道菜。

源组互斥守恒：105候选源组 + 5关联加料组 + 273待核验源组 = 383。候选记录数113高于105，是8行明确大份价恢复，不是重复源组登记。这里的382是既有源记录/生成项数量，不冒称382个物理菜单行或独立菜品。

## 实际恢复

候选分布：{dict(counts)}。

- W2-04：77条，其中既有39条蛋炒组合保留；依据已确认照片2F-05及2F-09、源转录稿对应段落。未重新宣称逐图视觉审计。
- W2-05：35条。转录稿297—308行的12条炒面源行有8条明确小/大两价、4条只有小份；恢复20条规格记录，另保留15条剁椒面。大份空横线不生成价格。原27条变35条，净恢复8条明确大份。
- W2-06 / NG01：1条含蛋基础手抓饼，4元/份。五组加价记录单独放 `optional_surcharges.json`，逐个名称及价格来自已批准NG01预览；多选、重复数量和组合限制仍未知。每组中的斜线名称是加料成员，不是新增独立菜品。原五行与成员列表同时保留。

旧ID只存于追溯字段；全部 `formalDishId=null`，candidateId为R04局部标识，不继承正式ID资格。历史价格与当前有效售价分离，`currentPriceValidity=UNKNOWN`、`transactionQuoteAllowed=false`。tastes空数组保留合法未知，不推断口味；采集人和采集日期继续延期，不重复询问。

## 待核验与证据等级

273项见 unresolved.csv。其他档口的源行存在，但尚未唯一关联归档照片；并列多品种行暂不强行当一道独立菜，源行明确“待确认”的价格继续隔离。此处对照片关联采用保守门槛，不表示文字来源丢失。

W2-10 / c01_d185：转录稿记录了14.9辣椒炒肉、17.9辣椒炒肥肠的既有口径，因此保留双源组拆分；未把两价当小/大份。但被引用DR-SET-R2的实际签署范围只涵盖W2-03八款双拼，不能冒称它签署W2-10。两项暂留待核验，补正确证据引用而不重新要求负责人裁决已记录价义。

证据等级：源文及明确价列属于本地直接可复核文本；照片SHA与已有 confirmed 映射是档案关联证据；本轮没有进行新一轮OCR/视觉重识别，不能据此称照片字段已重新逐字验真。每条候选保留照片绝对路径及SHA、源行及原文。目录快照逐字节核验，原图不搬动。

## 测试与反例

实际命令：`python -X utf8 报告/R04_2F_20261101/test_r04.py`。
结果：22 PASS / 0 FAIL / 0 SKIP，退出码0，完整输出见 test_output.txt。包括覆盖守恒、唯一ID、双向追溯、明确大小份、39条复用、NG01关联及未知字段保护。六种负向篡改（改价、复制正式ID、开启报价、伪造日期、重复候选、错误来源）均被同一校验拒绝。

`git diff --check`退出码0；存在既有 project.config.json 的CRLF转换提示，不是本轮修改。未运行无关全套回归；没有宣称通过正式导入器、严格模式或正式准入。严格元数据与正式资格仍待后续阶段。

## 文件、备份及边界

所有新增内容在本独立报告批次；未覆盖任何已有正式文件，因此没有需备份的被修改生产文件。`source_inputs.json`记录只读来源快照、大小、SHA，快照是原始字节副本；`project_before.json`记录项目现有文件SHA。`git_before.json`、`git_after.json`保留真实分支、HEAD、暂存及完整未跟踪状态，二者一致。R03闭环清单指纹保持不变。

交付包括replacement_ledger.csv/json、candidates.json、optional_surcharges.json、new_source_records.json、unresolved.csv、stall_crosswalk.csv、statistics.json、生成/捕获/测试工具、源快照和原始输出。完整文件大小及SHA见file_manifest.json、manifest.sha256；清单自身不自引用。

## 只读自审与独立验收入口

PASS：382条旧责任全部有去向；113候选无重复；8条大份有明确源格；NG01五加料未作为菜；来源可追溯；原始项目字节、Git状态、R03成果未改；无正式ID分配、无导入、无云端操作。

PENDING：273待核验源项、父级正式身份签发、严格采集元数据、当前价格、正式准入与导入。不存在把本地历史候选扩大成当前可交易菜单的授权。

请DSH重点复核W2-05明确大小份源列、NG01五组加料成员语义、W2-10裁决引用范围，以及105+5+273的唯一归属。完成本轮后停止，等待独立验收。
'''
(E/'R04_执行报告.md').write_text(report,encoding='utf-8')
files=[p for p in E.rglob('*') if p.is_file() and p.name not in ['file_manifest.json','manifest.sha256']]
entries=[{'path':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(files)]
(E/'file_manifest.json').write_text(json.dumps({'algorithm':'SHA-256','excludesSelf':True,'files':entries},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=E/'file_manifest.json';entries.append({'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(E/'manifest.sha256').write_text(''.join(x['sha256']+'  '+x['path']+'\n' for x in entries),encoding='utf-8')
for x in entries:assert hashlib.sha256((E/x['path']).read_bytes()).hexdigest()==x['sha256']
print('Manifest verification PASS:',len(entries),'files; report and all deliverables exist')
