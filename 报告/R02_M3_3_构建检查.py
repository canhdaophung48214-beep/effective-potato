import pathlib,json,hashlib,subprocess
R=pathlib.Path.cwd();P=R/'项目';O=R/'报告';E=O/'R02_M3_3_20261101';E.mkdir()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
base={str(p):sha(p) for p in P.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts}
(E/'project_before.json').write_text(json.dumps(base,ensure_ascii=False,indent=2),encoding='utf-8')
git=lambda a:subprocess.run(['git','-c','safe.directory='+str(P).replace('\\','/'),*a],cwd=P,capture_output=True,text=True,encoding='utf-8')
gbefore=git(['status','--porcelain=v1','-uall']);assert gbefore.returncode==0;(E/'git_before.txt').write_text(gbefore.stdout,encoding='utf-8')
(E/'price_adapter.py').write_text('''import json,pathlib,html
ROOT=pathlib.Path(__file__).resolve().parents[2]
BASE=ROOT/'报告/R02_M3_2_20261101/updated_candidates.json'
CONFIRMED=ROOT/'报告/R02_M3_1_20261101/confirmed_fields_39.csv'
def build():
 import csv
 x=json.loads(BASE.read_text(encoding='utf-8'))
 with CONFIRMED.open(encoding='utf-8-sig') as f:proof={r['dishId']:r for r in csv.DictReader(f)}
 col={'炒饼':1,'炒面':2,'炒饭':3};out=[]
 for r in x['records']:
  p=proof[r['id']];cells=[c.strip() for c in p['sourceRaw'].split('|')][1:-1]
  expression=cells[col[r['gen']['specLabel']]]
  out.append({'id':r['id'],'name':r['name'],'legacyRecord':r,'sourceMenuPrice':{'amount':r['price'],'rawExpression':expression,'currency':'CNY','unit':None,'unitStatus':'UNKNOWN','sourceDate':None,'sourceDateStatus':'UNKNOWN','sourceRef':r['source']['ref'],'sourceRawRow':p['sourceRaw'],'evidenceStatus':'SOURCE_SUPPORTED_NOT_CURRENT_VERIFIED'},'currentEffectivePrice':{'amount':None,'currency':'CNY','unit':None,'validity':'UNKNOWN','verifiedAt':None,'verificationEvidence':None},'parentRefs':{'shopId':r['shopId'],'stallId':r['stallId']},'parentEvidence':x['parentEvidenceLayer'],'permissions':{'isolatedHistoricalPreview':True,'formalPublication':False,'transactionQuote':False,'formalAdmission':False},'usability':{'historicalMenu':'READY_FOR_ISOLATED_NON_TRANSACTION_PREVIEW','currentPrice':'UNKNOWN','parentSignoff':'PENDING','collectorAndCaptureDate':'DEFERRED'}})
 return out

def validate(rows):
 assert len(rows)==39 and len({r['id'] for r in rows})==39
 for r in rows:
  s,c=r['sourceMenuPrice'],r['currentEffectivePrice']
  assert s['amount']==r['legacyRecord']['price']
  assert s['rawExpression'].replace(' 元','')==str(s['amount'])
  assert s['unit'] is None and s['sourceDate'] is None
  assert c['validity']=='UNKNOWN' and c['amount'] is None and c['verifiedAt'] is None
  assert r['permissions']['transactionQuote'] is False
  assert r['legacyRecord']['verifyStatus']=='unverified'

def current_quote(record):
 # No verified-current-price ingestion path has been implemented/authorized.
 # Never consume legacy/source price, even if caller flips a permission flag.
 raise ValueError('CURRENT_PRICE_NOT_VERIFIED')

def render(record):
 s=record['sourceMenuPrice']
 return {'id':record['id'],'name':record['name'],'sourceMenuPriceText':s['rawExpression'],'priceNotice':'原菜单记录；现价、来源日期和计价单位未知；不可用于交易报价','currentPriceText':'未知','stallText':'小吕哥黄焖鸡（暂定；门头及正式签发待核验）','transactionQuote':None,'formalPublicationAuthorized':False}

if __name__=='__main__':
 here=pathlib.Path(__file__).parent;rows=build();validate(rows)
 (here/'layered_candidates_39.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
 views=[render(r) for r in rows]
 (here/'historical_menu_preview.json').write_text(json.dumps(views,ensure_ascii=False,indent=2),encoding='utf-8')
 body=''.join('<tr><td>'+html.escape(v['name'])+'</td><td>'+html.escape(v['sourceMenuPriceText'])+'</td><td>未知</td></tr>' for v in views)
 (here/'historical_menu_preview.html').write_text('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>历史菜单隔离预览</title><style>body{font-family:system-ui;max-width:900px;margin:36px auto;padding:16px}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}</style><h1>历史菜单记录 · 隔离预览</h1><p>小吕哥黄焖鸡（暂定）｜服务楼2楼；门头与正式签发待核验</p><p>以下为原菜单标价，现价、来源日期、计价单位未知。不用于交易报价，不代表正式发布授权。</p><table><tr><th>菜名</th><th>原菜单标价</th><th>当前有效价格</th></tr>'+body+'</table></html>',encoding='utf-8')
 print('Generated 39 isolated historical-menu views; no current price assigned')
''',encoding='utf-8')
(E/'test_price_adapter.py').write_text('''import unittest,copy,json
import price_adapter as a
class PriceTests(unittest.TestCase):
 def setUp(self):self.rows=a.build()
 def test_original_price_and_records_preserved(self):
  source=json.loads(a.BASE.read_text(encoding='utf-8'))['records']
  self.assertEqual([r['legacyRecord'] for r in self.rows],source)
  self.assertTrue(all(r['sourceMenuPrice']['amount']==r['legacyRecord']['price'] for r in self.rows))
 def test_raw_expressions_preserved(self):
  for r in self.rows:self.assertIn('| '+r['sourceMenuPrice']['rawExpression']+' |',r['sourceMenuPrice']['sourceRawRow'])
 def test_unit_unknown(self):self.assertTrue(all(r['sourceMenuPrice']['unit'] is None and r['currentEffectivePrice']['unit'] is None for r in self.rows))
 def test_dates_unknown(self):self.assertTrue(all(r['sourceMenuPrice']['sourceDate'] is None and r['currentEffectivePrice']['verifiedAt'] is None for r in self.rows))
 def test_quote_fails_even_with_false_permission_override(self):
  for r in self.rows:
   r=copy.deepcopy(r);r['permissions']['transactionQuote']=True
   with self.assertRaisesRegex(ValueError,'NOT_VERIFIED'):a.current_quote(r)
 def test_parent_pending_does_not_erase_evidence(self):
  for r in self.rows:
   self.assertEqual(r['parentEvidence']['stall']['formalSignoff'],'PENDING')
   self.assertTrue(a.render(r)['name']);self.assertTrue(r['sourceMenuPrice']['sourceRef'])
 def test_no_real_time_price_in_render(self):
  for r in self.rows:
   v=a.render(r);self.assertEqual(v['currentPriceText'],'未知');self.assertIsNone(v['transactionQuote']);self.assertIn('不可用于交易',v['priceNotice'])
 def test_invalid_current_price_and_unit_rejected(self):
  for field,value in [('unit','份'),('sourceDate','2026-10-23')]:
   rs=copy.deepcopy(self.rows);rs[0]['sourceMenuPrice'][field]=value
   with self.assertRaises(AssertionError):a.validate(rs)
  rs=copy.deepcopy(self.rows);rs[0]['currentEffectivePrice']['amount']=10
  with self.assertRaises(AssertionError):a.validate(rs)
if __name__=='__main__':unittest.main(verbosity=2)
''',encoding='utf-8')
results=[]
for script in ['price_adapter.py','test_price_adapter.py']:
 t=subprocess.run(['python','-X','utf8',str(E/script)],capture_output=True,text=True,encoding='utf-8');assert t.returncode==0;(E/(script+'.log')).write_text(t.stdout+t.stderr+'\nEXIT='+str(t.returncode),encoding='utf-8');results.append({'script':script,'exitCode':t.returncode});print(t.stdout+t.stderr)
assert all(sha(pathlib.Path(p))==h for p,h in base.items());assert git(['status','--porcelain=v1','-uall']).stdout==gbefore.stdout
(E/'导入器兼容性与最小差异.md').write_text('''# 价格分层兼容性与最小建议

当前正式契约§5.1:328仅规定price为有限正数，未定义sourceMenuPrice/currentEffectivePrice。import_data.js:104-109 CSV白名单只有price；:623-636构造dish只有单个price，没有状态/日期/独立有效价格。不能把扩展JSON送进原CSV后宣称语义被保留：当前通道不能可靠承载这些状态。

本轮选择报告侧隔离适配层，legacyRecord完整保留，另行并列sourceMenuPrice与currentEffectivePrice，不改变正式price含义。正式原数据结构可保持不变，隔离历史展示读取新适配层；这不意味着正式小程序已支持历史菜单。不能把适配层结果扁平化写回price后用于当前价展示。

能独立显示：来源支持的菜名、原菜单原价表达、历史说明和现价未知。父级可显示模型名称及暂定标签，但不能显示门头已核实、正式签发或详细方位/窗口号。交易报价、实时现价、正式核实标签及正式发布必须等待相应事实/授权，不以分层豁免严格元数据规则。

若未来正式采用此能力，需要另行审查最小契约增量（以下仅提案，不实施）：
```diff
+ 历史价格侧车按已有dishId关联，不分配新ID；保留原price兼容旧数据。
+ sourceMenuPrice: amount, rawExpression, unit|null, sourceDate|null, sourceRef。
+ currentEffectivePrice: amount|null, validity(UNKNOWN/VERIFIED), unit|null,
+   verifiedAt|null, verificationEvidence|null。VERIFIED必须有独立有效核验依据。
+ 父级签发/门头状态不写入dish.verifyStatus；历史来源不等同核实现价。
+ 未知日期/单位不得由发送日、整理日、菜名推断；UNKNOWN不可报价。
+ 新读取路径显式选择历史或当前语义，禁止默认从来源价格回退当前价。
```

不需要为了本轮隔离验证修改正式契约。若仅在独立报告中展示，使用侧车适配足够；若正式存储、导入、API或小程序消费，必须相应审查契约/schema/导入与读取路径后才实施，不能仅改CSS/文案就认为兼容。本轮没有正式导入适配，也没有VERIFIED价格写入入口。原型current_quote始终失败关闭是当前能力边界，未来有效核验价格通道另行实现。
''',encoding='utf-8')
(E/'执行报告.md').write_text('''# R02-M3.3 历史价格分层实际交付

完成39条隔离价格分层、JSON及可打开HTML历史菜单预览。来源价格保留原数字、原始“10 元”等单元格表达与源行；legacyRecord与M3.2逐对象相等。当前有效价格amount=null、validity=UNKNOWN，单位/来源日期null，交易报价禁止。未重新核对39条菜单，原表达来自M3.1已核验sourceRaw，不重跑全量审计。

候选不再用一个C标签表示不可用，而是两个独立用途状态：历史菜单READY_FOR_ISOLATED_NON_TRANSACTION_PREVIEW=39；当前有效价格UNKNOWN=39。原M3.2 C分类不改写或假装已解决现价；父级签发PENDING=39，仍保存菜品与原价。正式准入及严格通过仍0。39条可进入报告内非交易历史展示，不等于已获正式小程序对外发布授权。

真正新增文件：price_adapter.py可运行适配；layered_candidates_39.json、historical_menu_preview.json及historical_menu_preview.html实际生成；test_price_adapter.py八项单元测试及原始输出。包含原价/原表达保留、未知单位、未知日期、报价拒绝（即使调用者篡改permission）、父级待核验不丢证据、预览无现价、非法日期/单位/当前价填充被拒。八项全部通过、退出0。适配生成退出0。无需运行已通过M3.1导入预览或M1/M2照片测试。

兼容性分析与最小契约提案已落盘；没有修改正式契约、CSV导入器或数据。原始price单值通道不支持价格语义分层，不能误报“正式兼容已完成”。原型只开放历史预览，没有当前已核验价格的接入能力，也不授权交易。source日期未知继续未知、采集人日期仍延期不再索取。

正式项目所有开工文件哈希保持不变，Git状态前后一致；M3.1/M3.2原文件未覆盖，本轮新增目录。源头/核验/整理日期未混同。未正式导入、ID分配、审批变更、上传、云端调用、部署或Git写。备份要求：无原文件修改，无需伪造修改前备份；project_before.json保留哈希基线而非字节备份。

PASS：39隔离候选、39非交易预览、8测试、来源值保留、父级分离、正式项目保护。PENDING：真实现价/单位/来源日期核验、父级正式签发、正式侧车契约与读取路径准入；不将这些PENDING计成现价已恢复。文件大小/SHA见delivery_manifest.json。实际diff为本目录新增工具、候选与报告；正式项目diff增量为空。已完成隔离可执行工作，停止等待后续授权。
''',encoding='utf-8')
(E/'checks.json').write_text(json.dumps({'commands':results,'testsPassed':8,'layeredRecords':39,'historicalPreviews':39,'currentPriceVerified':0,'formalAdmission':0,'projectFilesUnchanged':len(base),'exitCode':0},indent=2),encoding='utf-8')
(E/'delivery_manifest.json').write_text(json.dumps([{'path':str(p),'bytes':p.stat().st_size,'sha256':sha(p)} for p in E.rglob('*') if p.is_file()],ensure_ascii=False,indent=2),encoding='utf-8');print('PASS 39 layered candidates / 39 HTML rows / tests8 / no formal changes')
