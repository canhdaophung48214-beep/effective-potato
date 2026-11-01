import pathlib,json,hashlib,datetime,shutil,subprocess,difflib
R=pathlib.Path.cwd();P=R/'项目';E=R/'报告/R02_M3_4_20261101';F=E/'M342_evidence';B=R/'备份'/('R02_M342_after_login_'+datetime.datetime.now().strftime('%Y%m%d_%H%M%S'));B.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
back=[]
for name in ['执行报告.md','delivery_manifest.json','README_验收入口.md','checks.json']:
 p=E/name;q=B/name;shutil.copyfile(p,q);back.append({'path':str(p),'backup':str(q),'bytes':p.stat().st_size,'sha256':sha(p)})
(F/'after_login_report_backup.json').write_text(json.dumps(back,ensure_ascii=False,indent=2),encoding='utf-8')
for script in ['test_adapter.js','test_m342.js']:
 t=subprocess.run(['node',str(E/script)],capture_output=True,text=True,encoding='utf-8');(F/(script+'.after_login.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');assert t.returncode==0
real=json.loads((F/'wechat_after_login_results.json').read_text());assert real['status']=='PASS_PAGE_DATA39_AND_ACTUAL_SCREENSHOTS';assert len(real['data'][0]['records'])==39
bottom=(F/'wechat_runtime_bottom_ocr.txt').read_text(encoding='utf-8-sig');assert '15' in bottom and '红' in bottom
project=json.loads((F/'project_before.json').read_text());assert all(sha(pathlib.Path(x['path']))==x['sha256'] for x in project)
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
g=git(['status','--porcelain=v1','-uall']);old=json.loads((F/'git_before.json').read_text());assert g.returncode==0 and g.stdout==old['status'];(F/'git_after_login_status.txt').write_text(g.stdout,encoding='utf-8')
(E/'登录后实际渲染补验.md').write_text('''# M3.4.2 登录后实际渲染补验

负责人确认已登录后，工程open成功，不再是认证阻塞。实际页曾启动失败/旧自动化端口返回旧页栈，进行了仅隔离配置与页面数据模块修复：移除硬编码libVersion，使用工具默认基础库；页面改为require('../../history-data.js') CommonJS，保留JSON为规范数据输出；绑定新端口9435。多个因素同时调整，不能将单一因素虚构为唯一根因。

已通过真实微信验收：App.getCurrentPage返回pages/history/index；App.callFunction实际页data.records为39，39个记录值保存在wechat_after_login_results.json；getSystemInfoSync返回devtools、SDK3.17.5、390×753视口。App.captureScreenshot取得真实模拟器截图，调用wx.pageScrollTo后取得底部截图。离线系统OCR确认首屏青椒蛋卡片，底部红烧牛肉蛋炒饼/炒面/炒饭、15元、当前未核实和历史标识。截图不是HTML，也不是仅项目列表。

PASS：实际微信工程启动与页面显示、39运行时数据、可滚动到尾部卡片，证据wechat_runtime_top.png/wechat_runtime_bottom.png及对应OCR，原始结构化运行结果wechat_after_login_results.json。没有声称通过DOM遍历证明39卡片节点。

PENDING：Page.getData/Element节点查询及更深组件自动化仍出现page node not found或超时；test_wechat_runtime.js/test_wechat_render.js的诊断失败保留，未删断言或改成通过。微信320/375实际窄屏和微信长文本布局未取得稳定自动化证据，仍PENDING；此前HTML320/375六张截图只证明HTML。真机PENDING。没有把基本渲染成功扩展为全部布局闭环。

本轮复跑受页面模块变化直接影响的10项回归与6语义组/4变异检查，均退出0。未重复其它数据盘点或照片检查。原始诊断命令退出1属于真实未通过的扩展检查，明确保留，不纳入成功总数。运行脚本test_wechat_screen.js最终一次成功退出0，对应保存的结果；更早失败诊断不替换为成功描述。

正式项目文件SHA及Git状态不变，仅报告隔离工程修改，未触云函数、数据库、上传、部署或正式导入。微信工具在open/auto过程中会执行平台AppID权限/基础库元信息请求，这些是本地IDE正常准备流程，不宣称全程无网络；没有执行项目业务云操作。当前无需再次要求负责人登录，后续阻塞是自动化DOM/布局验收而非认证。
''',encoding='utf-8')
p=E/'执行报告.md';s=p.read_text(encoding='utf-8');s='''# 当前补验结论（负责人登录后）

微信登录阻塞已解除，真实历史页已显示，运行时39条数据与顶部/底部微信截图已取得。实际390px视口基础渲染与滚动PASS；微信320/375窄屏、微信长文本/DOM全项验收及真机仍PENDING。详见《登录后实际渲染补验.md》。新增mini/history-data.js为实际运行必需CommonJS数据模块，不是为满足旧清单制造lib/menu-data架构。39适配值未变。

以下为登录前阶段报告，保留历史时间上下文；其中“需要重新登录”已被本节状态取代，不是当前待办。

---
'''+s;p.write_text(s,encoding='utf-8')
p=E/'README_验收入口.md';s=p.read_text(encoding='utf-8');s+='''

## 登录后更新

工程已实际显示；默认基础库不再硬编码，页面使用mini/history-data.js。新自动化端口9435，test_wechat_screen.js为已成功取得页数据39和截图的脚本（需工具auto绑定当前工程）。节点级诊断仍不稳定，不把test_wechat_render.js失败隐藏。最终状态以登录后实际渲染补验.md为准。HTML窄屏通过不能代替微信320/375布局检查。
''';p.write_text(s,encoding='utf-8')
checks=json.loads((E/'checks.json').read_text());checks.update(realWeChatBasicRender='PASS_390PX',realRuntimeRecords=39,realTopBottomScreenshots=True,weChatNarrow320375='PENDING',weChatLongText='PENDING',weChatDOMAutomation='PENDING',realDevice='PENDING');(E/'checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2),encoding='utf-8')
# Supplement exact changes against original verified outside-repository byte backups.
original=json.loads((F/'backup_manifest.json').read_text());omap={pathlib.Path(x['path']).relative_to(E).as_posix():x for x in original};patch=[]
for p in E.rglob('*'):
 if not p.is_file() or p.name in ['delivery_manifest.json','after_login_changes.patch']:continue
 rel=p.relative_to(E).as_posix();prev=pathlib.Path(omap[rel]['backup']).read_bytes() if rel in omap else b'';b=p.read_bytes()
 if prev==b:continue
 try:patch.extend(difflib.unified_diff(prev.decode('utf-8-sig').splitlines(True),b.decode('utf-8-sig').splitlines(True),fromfile='before/'+rel,tofile='after/'+rel))
 except UnicodeDecodeError:patch.append('Binary '+rel+' SHA256='+sha(p)+'\n')
(F/'after_login_changes.patch').write_text(''.join(patch),encoding='utf-8')
files=[p for p in E.rglob('*') if p.is_file() and p!=E/'delivery_manifest.json'];m=[{'path':str(p),'relativePath':p.relative_to(E).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)} for p in files];(E/'delivery_manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf-8');assert all(sha(pathlib.Path(x['path']))==x['sha256'] for x in m)
print('PASS real WeChat39/top-bottom evidenced; manifest',len(m),'files; narrow/DOM still PENDING; project unchanged')
