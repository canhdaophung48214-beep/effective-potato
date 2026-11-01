import pathlib,json,hashlib,subprocess,difflib,datetime
R=pathlib.Path.cwd();E=R/'报告/R02_M3_4_20261101';F=E/'M342_evidence';P=R/'项目'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base=json.loads((F/'project_before.json').read_text());assert all(sha(pathlib.Path(x['path']))==x['sha256'] for x in base)
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
before=json.loads((F/'git_before.json').read_text());after={k:git(a).stdout for k,a in [('HEAD',['rev-parse','HEAD']),('branch',['branch','--show-current']),('status',['status','--porcelain=v1','-uall']),('staged',['diff','--cached','--name-status'])]};assert before==after;(F/'git_after.json').write_text(json.dumps(after,ensure_ascii=False,indent=2),encoding='utf-8')
r=git(['diff','--check']);(F/'git_diff_check.log').write_text(r.stdout+r.stderr+'\nEXIT='+str(r.returncode),encoding='utf-8');assert r.returncode==0
(E/'README_验收入口.md').write_text('''# M3.4.2实际验收入口

当前架构：adapter.js → adapted_records_39.json；mini/app.json → mini/pages/history/index → mini/components/history-menu/index。文件名按磁盘真实架构，不存在lib/menu-data.js/pages/home/prototype/demo.html，不需要这些旧描述路径。

运行：node test_adapter.js；node test_m342.js；node test_html_layout.js（需要本机Edge，会启动独立无头临时profile并关闭自己启动的浏览器）。微信离线编译及记录：python run_final_checks.py（内部仍为原版wcc/wcsc及数据测试）；组件WXSS单独编译命令见M342_evidence/wechat_offline_compile_results.json。不要运行历史build_and_verify.js/repair_m342.py覆盖当前交付；它们只是过程来源快照。

微信工具打开工程：mini/（project.config.json无BOM，隔离工程，使用本机已有项目AppID）。当前CLI要求重新登录；登录完成后用工具打开本工程，确认pages/history/index，编译并检查首屏/底部39卡、320/375px、长名称和长来源。工具日志在M342_evidence/devtools_open.json；CLI进程退出0但API错误code10，不能计成功。无需上传/预览二维码/云端部署。真机另行授权。

HTML查看historical_menu_preview.html，仅证明HTML效果；六张截图及DOM几何测量位于M342_evidence，不是微信截图。最终执行报告、最终manifest为本轮权威交付，旧报告/manifest完整备份在仓库外目录（见backup_manifest）。
''',encoding='utf-8')
metadata=[]
for p in [E/'adapter.js',E/'adapted_records_39.json',E/'mini/components/history-menu/index.wxml',E/'mini/components/history-menu/index.wxss',E/'mini/pages/history/index.js']:
 metadata.append({'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p),'modifiedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat()})
(F/'final_core_files.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
report=f'''# R02-M3.4.2 历史菜单展示交付修复

日期2026-11-01；执行Codex，待DSH独立验收。

## 真实交付来源与实际修复

开工adapter.js确为1452字节，修改时间2026-11-01 15:34:03。本轮工作区/备份递归及桌面目标文件检索未找到6932字节适配器或lib/menu-data.js、pages/home、prototype/demo.html等旧描述架构。不能证明那些历史文件曾落盘；此前描述与实际查得文件不符。现有M3.4.1文件已复用，不为了旧清单制造重复模块。来源、改前哈希/mtime与备份见M342_evidence/provenance.json及backup_manifest.json。

实际修改：adapter增加输入身份/来源结构验证；WXSS增加盒模型、长文本换行及价格行折行；HTML窄屏盒模型修复；增加可由开发者工具打开的mini/project.config.json。39数据和组件架构复用，适配结果与既有JSON一致，未重新建数据模型。旧adapter原始字节保存在仓库外；当前adapter {metadata[0]['bytes']}字节，SHA `{metadata[0]['sha256']}`。

实际页面：mini/pages/history/index.{{js,json,wxml,wxss}}；实际组件mini/components/history-menu/index.{{js,json,wxml,wxss}}，为独立custom component；它们不在正式小程序路由里。mini/app.js/app.json及mini/adapted_records_39.json组成独立工程。最终适配器、39完整适配数据、HTML、两个独立测试、布局测试均真实落盘。

## 验收矩阵与真实退出码

| 项目 | 实际结果 | 证据 |
|---|---|---|
| 39/39一对一、原价/表达/来源保留 | PASS | test_adapter.js.log，10 PASS/0 FAIL，退出0 |
| 身份/来源输入、历史提示、当前价null、未知单位日期、父级PENDING、无交易入口 | PASS | test_m342.js.log，6语义组PASS，退出0 |
| 四类反事实 | PASS 4/4被捕获 | mutation_results.json，隔离临时副本，AssertionError记录 |
| 320px/375px正常文本、长名称/连续长来源、滚动到底 | PASS（仅HTML） | html_layout_results.json及6张html_*.png，test_html_layout.js本轮退出0 |
| WXML离线编译 | PASS（安装包自带编译器） | wxml_compile stdout41638字节、stderr0、退出0 |
| 页面WXSS离线编译 | PASS | wxss_compile stdout26字节、stderr0、退出0 |
| 组件WXSS离线编译 | PASS | wxss_component stdout1365字节、stderr0、退出0，含history-list实际规则 |
| 开发者工具IDE完整编译/模拟器实际渲染 | PENDING | devtools_open.json返回需要重新登录code10，不能计成功 |
| 微信模拟器320/375、微信运行时滚动/长文本 | PENDING | 不能拿Edge或静态绑定替代 |
| 真机 | PENDING | 未授权真机/二维码，不做云端操作 |
| git diff --check | PASS 退出0 | git_diff_check.log，仅既有CRLF提示 |

每项新测试原始输出均在M342_evidence。HTML布局测试通过CDP测量scrollWidth、不越界、长文本完整、最后一张可见且可滚动，并保存320/375顶部、底部、长文本共6截图；这是Edge真实HTML渲染，不是截图伪装微信。微信离线编译用已安装版本的wcc.exe/wcsc.exe，不是编造编译器，也不等价微信IDE启动与全工程编译。页面WXSS首次命令只产出页面规则，随后单独编译组件并核对输出，未把26字节页面样式误作整个组件成功。

## 微信工具实际尝试与阻塞

已定位D:/微信开发/微信web开发者工具/cli.bat。实际调用open --project mini --debug：初次隔离touristappid被本机版本拒绝“不存在此AppID”；保留配置中间快照后，仅在隔离project.config复用正式项目已有AppID，正式配置不改。重试返回“需要重新登录(code10)”。CLI进程本身退出0，但stderr/响应明确×preparing与API错误，故IDE编译渲染不计PASS。工具窗口仍为“项目列表”，未假称已绑定历史菜单窗口。

本轮已通过异步消息请负责人在本机工具登录；截至交付未收到已登录确认，不能替用户认证或把登录视作完成。自动化/实际UI编译均受这项真实认证前置条件阻塞。已完成所有不依赖登录的交付、编译与测试，登录后可按README直接验收，不需重建架构。初次错误诊断记录于来源说明及配置中间快照，最终完整open原始输出为重试日志，不伪称首试原始日志仍存在。

## 精确diff、备份与交付清单

外部原字节备份及逐字节验证：M342_evidence/backup_manifest.json。最终changes.patch记录相对该备份全部文本变化；新增文件列在change_inventory.json。备份包含现有29文件，既有工作未清理。repair/构建旧脚本保留作历史，不是当前重建入口，见README。

实际交付核心：adapter.js、adapted_records_39.json、mini/、historical_menu_preview.html、test_adapter.js、test_m342.js、test_html_layout.js、run_final_checks.py、README_验收入口.md、执行报告.md及M342_evidence/。delivery_manifest.json逐文件记录真实相对/绝对路径、字节数、SHA及mtime；它不自引用。旧manifest已外部备份，新manifest为当前权威。

正式项目{len(base)}个开工文件逐字节哈希不变；HEAD `{after['HEAD'].strip()}`，分支`{after['branch'].strip()}`，暂存区为空，status -uall前后一致。未改正式data、契约、审批、ID映射、导入器或正式页面。未上传照片、未正式导入、未云端读写/部署/建索引、未Git写。开发者工具进程被本轮CLI本地启动；Edge独立无头实例已关闭，临时profile留在系统临时目录，未改现用浏览器会话。一次工具发现调用的自动审批超时，随后换成更小的只读路径检查成功，不存在因拒绝而要求扩大权限的操作。

## 最终状态

本地交付一致性、数据/价格安全、HTML窄屏布局及微信离线源码编译PASS；IDE实际运行渲染和真机PENDING。没有完整微信渲染证据前，本阶段不能称为全项闭环。DSH可以立即从本目录独立复算全部文件和测试；当前唯一运行环境前置阻塞为开发者工具重新登录，正式导入不在本轮。停止等待独立验收，不进入正式数据导入。
'''
(E/'执行报告.md').write_text(report,encoding='utf-8')
# Final exact text patch vs verified outside-repository byte backup, plus explicit added-file inventory.
backup=json.loads((F/'backup_manifest.json').read_text());oldmap={pathlib.Path(x['path']).relative_to(E).as_posix():x for x in backup};patch=[];inventory=[]
for p in sorted(E.rglob('*')):
 if not p.is_file() or p.name in ['delivery_manifest.json','changes.patch','change_inventory.json']:continue
 rel=p.relative_to(E).as_posix();b=p.read_bytes();old=oldmap.get(rel)
 if old:
  prev=pathlib.Path(old['backup']).read_bytes()
  if prev==b:continue
  status='MODIFIED'
 else:prev=b'';status='ADDED'
 inventory.append({'path':rel,'status':status,'beforeSHA256':hashlib.sha256(prev).hexdigest() if old else None,'afterSHA256':sha(p)})
 try:
  a=prev.decode('utf-8-sig');z=b.decode('utf-8-sig');patch.extend(difflib.unified_diff(a.splitlines(True),z.splitlines(True),fromfile='before/'+rel,tofile='after/'+rel))
 except UnicodeDecodeError:patch.append('Binary file '+rel+' '+status+' SHA256='+sha(p)+'\n')
(F/'changes.patch').write_text(''.join(patch),encoding='utf-8');(F/'change_inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
files=[p for p in E.rglob('*') if p.is_file() and p!=E/'delivery_manifest.json'];manifest=[{'path':str(p),'relativePath':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p),'modifiedAt':datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat()} for p in files];(E/'delivery_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
assert all(pathlib.Path(x['path']).stat().st_size==x['bytes'] and sha(pathlib.Path(x['path']))==x['sha256'] for x in manifest)
print('PASS final manifest',len(manifest),'files; backup/diff ready; IDE rendering PENDING login')
