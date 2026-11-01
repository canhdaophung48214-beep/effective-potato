import json,pathlib,html
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
