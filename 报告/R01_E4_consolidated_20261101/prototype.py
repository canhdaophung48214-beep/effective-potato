import json,pathlib,copy
root=pathlib.Path(__file__).parent
ng03=json.loads((root/'NG03_candidate_preview.json').read_text(encoding='utf-8'))
ng01=json.loads((root.parent/'R01_E4_NG01_20261101/NG01_candidate_preview.json').read_text(encoding='utf-8'))
def validate(a,b):
 assert len(b['items'])==10
 assert sorted(i['priceYuan'] for i in b['items'])==[12]*8+[14,16]
 assert b['composition']=={'status':'unknown','value':None}
 assert b['rules']['riceRefill']=='unlimited' and b['rules']['allDishRefill']=='unlimited'
 assert b['slideEggRiceSameStall'] is False and b['slideEggRiceSameSalesSystem'] is False
 assert a['baseDish']['priceYuan']==4 and a['baseDish']['eggIncluded']
 assert len(a['optionalSurchargeRows'])==5
 assert all(not o['independentDish'] and o['basePreviewRef']==a['baseDish']['previewRef'] for o in a['optionalSurchargeRows'])
def quote_combination(group):
 if group['composition']['status']!='known':raise ValueError('COMPOSITION_UNKNOWN')
 raise ValueError('PRICE_RULE_NOT_IMPLEMENTED')
validate(ng01,ng03)
checks=1
try:quote_combination(ng03);raise AssertionError('unknown composition accepted')
except ValueError:checks+=1
for change in ['price','independent','known']:
 a,b=copy.deepcopy(ng01),copy.deepcopy(ng03)
 if change=='price':b['items'][0]['priceYuan']=99
 if change=='independent':a['optionalSurchargeRows'][0]['independentDish']=True
 if change=='known':b['composition']={'status':'known','value':[]}
 try:validate(a,b)
 except AssertionError:checks+=1
 else:raise AssertionError(change+' incorrectly accepted')
print('PASS',checks,'targeted checks; EXIT=0')
