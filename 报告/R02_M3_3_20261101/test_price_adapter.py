import unittest,copy,json
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
