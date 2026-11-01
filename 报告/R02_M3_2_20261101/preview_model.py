import json,pathlib,copy
p=pathlib.Path(__file__).parent
x=json.loads((p/'updated_candidates.json').read_text(encoding='utf-8'))
def render(record,state):
 if state['price']['status']!='HISTORICAL_MENU_VALUE':raise ValueError('unsupported price status')
 return {'id':record['id'],'name':record['name'],'priceText':str(state['price']['amount'])+'元（历史菜单标价，现价及计价单位待核实）','stallText':'小吕哥黄焖鸡（暂定；门头及正式签发待核验）','currentPrice':None,'transactionQuote':None}
def quote(state):
 if not state['transactionQuoteAllowed']:raise ValueError('NOT_TRANSACTION_READY')
 raise ValueError('NOT_IMPLEMENTED')
views=[render(r,s) for r,s in zip(x['records'],x['businessAdmissionLayers'])]
assert len(views)==39 and all('历史菜单' in v['priceText'] and '单位待核实' in v['priceText'] and v['currentPrice'] is None for v in views)
assert all(s['businessPreviewAllowed'] and s['secondaryFlags']==['B_PARENT_SIGNOFF_PENDING'] for s in x['businessAdmissionLayers'])
try:quote(x['businessAdmissionLayers'][0])
except ValueError:pass
else:raise AssertionError('unverified transaction allowed')
assert all(r['verifyStatus']=='unverified' and r['verifiedAt'] is None for r in x['records'])
(p/'business_preview.json').write_text(json.dumps(views,ensure_ascii=False,indent=2),encoding='utf-8')
print('PASS preview39; parent pending does not erase dishes; historical disclaimer39; unverified quote rejected; verifyStatus unchanged; EXIT=0')
