import pathlib,json,csv,hashlib,subprocess,collections,datetime,difflib
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R03_3F_R2_20261101';F=E/'F1_evidence'
def J(p):return json.loads(pathlib.Path(p).read_text(encoding='utf-8-sig'))
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
outputs=[];results=[]
for script in ['test_r03.py','test_r03_f1.py']:
 cmd=['python','-X','utf8',str(E/script)];r=subprocess.run(cmd,capture_output=True,text=True,encoding='utf-8');outputs.append('COMMAND: '+str(cmd)+'\n'+r.stdout+r.stderr+'\nEXIT='+str(r.returncode)+'\n');results.append({'script':script,'exitCode':r.returncode});assert r.returncode==0,r.stdout+r.stderr
(E/'R03_F1_test_output.txt').write_text('\n'.join(outputs),encoding='utf-8')
git=lambda a:subprocess.run(['git','-c','core.quotepath=false','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
before=J(F/'git_before.json');after={k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('staged',['diff','--cached','--name-status']),('short',['status','--short']),('status',['status','--porcelain=v1','-uall'])]}
m=J(F/'migration_manifest.json');removed={x['sourceRelativeToProject'] for x in m['files']};expected=''.join(l+'\n' for l in before['status'].splitlines() if l[3:] not in removed);assert after['status']==expected,(after['status'],expected);assert all(before[k]==after[k] for k in ['HEAD','branch','staged']);(F/'git_status_short.txt').write_text(after['short'],encoding='utf-8');(F/'git_status_uall.txt').write_text(after['status'],encoding='utf-8');(F/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
r=git(['diff','--check']);assert r.returncode==0;(F/'git_diff_check.txt').write_text(r.stdout+r.stderr+'\nEXIT='+str(r.returncode),encoding='utf-8')
# Independent current-project set comparison: precisely nineteen files absent, no added/changed formal files.
base=J(F/'project_before.json');old={x['path']:x for x in base};actual={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts};missing=set(old)-set(actual);assert missing=={x['source'] for x in m['files']};assert not(set(actual)-set(old));assert all(actual[p]==old[p]['sha256'] for p in actual)
# CSV migration list is explicit, not a claim that git diff shows untracked-file moves.
with (F/'migration_files.csv').open('w',encoding='utf-8-sig',newline='') as f:
 fields=['sourceRelativeToProject','destination','bytes','sha256','byteIdentical','backup'];w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(m['files'])
ledger=J(E/'replacement_ledger.json');c=J(E/'candidates.json');src=J(E/'new_source_records.json');oldactions=collections.Counter(x['action'] for x in ledger if x['oldRecordKey']);assert oldactions=={'RETAIN':12,'REPLACE':48,'VOID':32,'PENDING':51};assert len(ledger)==375 and sum(x['action']=='NEW' for x in ledger)==232
back=J(F/'backup_manifest.json');B=pathlib.Path(back['deliveryBackup']);backupCandidates=J(B/'candidates.json')
# Verify that F1 changed no candidate business value, not merely the final record count.
def normalize(v):
 if isinstance(v,str):
  if v==str(P/'tools/pilot/TRANSCRIPTION_3F_R2.md'):return 'source_assets/TRANSCRIPTION_3F_R2.md'
  prefix=str(P/'tools/_crop3f')
  if v.startswith(prefix+'\\') or v.startswith(prefix+'/'):return 'source_assets/crops/'+v[len(prefix)+1:].replace('\\','/')
  n=v.replace('\\','/')
  for a,b in [('项目/tools/_crop3f2.py','source_assets/tools/_crop3f2.py'),('项目/tools/_crop3f.py','source_assets/tools/_crop3f.py')]:
   if n.startswith(a+' JOBS '):return b+n[len(a):]
  return v
 if isinstance(v,list):return [normalize(x) for x in v]
 if isinstance(v,dict):return {k:normalize(x) for k,x in v.items()}
 return v
assert normalize(backupCandidates)==c
stats=J(E/'statistics.json');stats.update(ledgerRows=375,newLedgerRows=232,uniqueNewSourceGroups=292,sourceAssetsFiles=19,verifiedCandidatePhotoHashes=266);(E/'statistics.json').write_text(json.dumps(stats,ensure_ascii=False,indent=2),encoding='utf-8')
(E/'README_F1_复现.md').write_text('''# R03-F1复现与审查入口

源转录稿：source_assets/TRANSCRIPTION_3F_R2.md；16张裁剪图：source_assets/crops/；原裁剪脚本：source_assets/tools/，这些19文件与迁移前字节完全相同。脚本只作为原始JOBS/裁剪框来源由构建器AST读取，不直接运行其历史OUT设置。原照片仍在原归档位置，没有移动或删除。

根目录执行：python -X utf8 报告/R03_3F_R2_20261101/test_r03.py；python -X utf8 报告/R03_3F_R2_20261101/test_r03_f1.py。后者在系统临时目录复制source_assets并调用build_r03.py --out-dir <隔离输出>，与133条当前候选逐对象一致，临时结果不覆盖正式交付。

活动记录sourceFile与cropPath使用本目录相对路径。OCR原始path保留实际执行时的历史路径，currentEvidencePath给出当前文件；OCR文字未修改。project_before.json/git_before.json及stage1快照也是历史证据，不是迁移后的可执行路径。历史R03报告中的原保护表述以F1当前结论为准。

当前NEW232，旧143动作不变，台账375行，292源组，133候选。manifest.sha256不自引用；file_manifest.json在SHA清单中被覆盖，所有正式输出及source_assets均列入。F1_evidence含外部备份清单、逐文件迁移、前后Git和测试原始输出；无Git写操作。
''',encoding='utf-8')
rows='\n'.join('| '+x['sourceRelativeToProject']+' | '+x['destination']+' | '+str(x['bytes'])+' | `'+x['sha256']+'` |' for x in m['files'])
report=f'''# R03-F1 两项P2修复报告

日期2026-11-01，Codex执行，交DSH独立验收。**P2-1 PASS；P2-2 PASS；无新增准入授权。**

## P2-1 源组主归属

修复前台账376行=143旧行+233 NEW，R03-T13-L0368-103同时有REPLACE与NEW。删除唯一重复NEW登记，保留c01_t41|f3/小炒腊肠（肉）||的REPLACE；对应实际候选仍恰1条，没有删除实际菜品。

修复后375行=143旧行+232 NEW。143旧行仍RETAIN12/REPLACE48/VOID32/PENDING51；SPLIT0，未机械修改其他动作。292个源组不变，NEW源组与旧映射源组交集为空，其他同类型双重NEW登记0。133 candidateId唯一、候选业务值逐字段与备份一致，仅sourceFile/cropPath/mappingBasis更新为迁移后相对路径。

## P2-2 19文件迁移

先完整备份原R03交付到`{B}`，另对19项目输入单独备份；再复制到source_assets，逐字节比较及SHA一致。原14测试和新增7测试、133候选隔离重建完全一致通过后，才逐个从项目树移除以下19个未跟踪文件；没有递归清理、没有删除原始照片或其他未跟踪项。空_crop3f目录仅在确认无内容后移除。

| 原项目相对路径 | 新交付相对路径 | 字节 | SHA-256（前后相同） |
|---|---|---:|---|
{rows}

16个PNG为派生裁剪图，原始照片对象不动；转录稿及2脚本原始字节均保留。当前builder读source_assets转录与脚本AST，支持--out-dir，输出相对sourceFile/cropPath；OCR工具也按脚本所在目录解析本地相对输入。裁剪脚本保持原字节，不改原始业务裁决/契约。原图绝对路径保留，不假装已打包外部原始照片。

## 完整验证与执行顺序

| 阶段 | 命令/检查 | 实际结果 |
|---|---|---|
| 移除前 | 原test_r03.py | 14 PASS，退出0 |
| 移除前 | 新test_r03_f1.py | 7 PASS，退出0；含临时副本重建133候选逐对象一致 |
| 移除前 | 19文件原件/副本/备份逐字节与SHA | 全同；完整交付清单独立重算通过 |
| 移除后 | 原test_r03.py | 14 PASS，退出0 |
| 移除后 | 新test_r03_f1.py | 7 PASS，退出0 |
| 移除后 | candidate照片original/crop哈希 | 266/266有效 |
| 移除后 | 133源行 | 全部定位新source_assets转录，原文一致 |
| 移除后 | 候选业务值与备份 | 路径规范化后逐对象相同 |
| 移除后 | git diff --check | 退出0，保留既有CRLF提示 |
| 移除后 | 项目文件集合 | 仅指定19文件缺席，其余{len(actual)}个开工文件字节不变，无新增项目文件 |

新增可复现性测试曾发现旧Windows反斜杠mappingBasis路径未更新，初次6通过/1失败，完整失败日志pre_move_repro_path_failure.txt保留；修正的是引用路径而非断言。随后两套测试全部通过才移除原件。原14测试的业务断言保留，保护检查针对授权迁移验证新目的地同SHA，新增测试另保证其他项目文件不变，不是放宽文件保护。未重复无关数据套件。

最终原始输出R03_F1_test_output.txt（14+7），迁移前输出F1_evidence/pre_move_*.txt。新增测试覆盖唯一主归属、无其他NEW/旧映射交集、CSV/JSON一致、266哈希与源行、19迁移精确范围、其他项目保护、隔离构建可复现。W01/W10全作废、小笼包独立、NG03裁决及未知构成、T04推定价隔离、T19未核内容、T20仅12主菜单的旧断言均通过。

## Git、差异与副作用

HEAD `{after['HEAD'].strip()}`，branch `{after['branch'].strip()}`，暂存区不变。status -uall行数由{len(before['status'].splitlines())}变为{len(after['status'].splitlines())}，精确减少这19个未跟踪文件；其余状态逐行一致。git status --short、-uall原始结果各自存档，不能以“整个工作区未变”掩盖迁移。

未跟踪文件移动不会形成Git tracked diff，所以精确变更由migration_files.csv、备份SHA、F1_changes.patch和交付前后文件列表共同证明。正式data/id-map/业务裁决/契约、原始照片、其它未跟踪工作均保持字节不变；没有Git add/commit/reset/checkout等写操作，没有正式导入、签发、云端操作、部署或索引变更。

## 清单与判定

manifest.sha256和file_manifest.json重新覆盖全部正式交付、源转录、16裁剪图及2脚本；相对路径用于解析，绝对路径仅辅助本机定位。manifest.sha256不自引用，覆盖file_manifest.json；独立复核每个文件字节数与哈希。历史快照中的旧路径是历史执行位置，活动数据路径均已迁移。

PASS：两项P2、375/232/143/292/133统计、19文件迁移、266哈希、21测试、其他项目保护。FAIL：最终检查0。PENDING：沿用原R03的业务/照片/正式ID及准入缺口，本轮没有扩大候选可用性或解除正式导入限制。完成后停止等待DSH。
'''
(E/'R03_F1_修复报告.md').write_text(report,encoding='utf-8')
p=E/'R03_执行报告.md';s=p.read_text(encoding='utf-8');s='''# F1最终交付结论

两项P2已完成：唯一重复NEW删除，台账375行（旧143+NEW232），292源组、133候选及原业务信息不变。19个工作文件已移至source_assets并从项目树精确移除；其他文件保持字节不变。原14项及新增7项测试移除后全部通过。当前详细证据见R03_F1_修复报告.md与R03_F1_test_output.txt。

---
'''+s;p.write_text(s,encoding='utf-8')
(F/'post_move_checks.json').write_text(json.dumps({'tests':results,'originalSuitePass':14,'F1SuitePass':7,'candidateRecords':133,'ledgerRows':375,'newRows':232,'oldRows':143,'sourceGroups':292,'photoHashesVerified':266,'migratedFiles':19,'otherProjectFilesUnchanged':len(actual),'GitExpectedRemovalOnly':True,'exitCode':0},ensure_ascii=False,indent=2),encoding='utf-8')
print('POST MOVE PASS 14+7; 266 photos; exactly19 removed; other project unchanged')
