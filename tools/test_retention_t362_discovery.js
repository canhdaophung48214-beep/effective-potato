'use strict';
const { createHarness }=require('./ugc_fake_cloud');
const h=createHarness(),fn=h.loadFunction('cloudfunctions/retention/index.js'),T=fn.__test__;
const now=new Date('2026-10-30T12:00:00Z');let pass=0,fail=0;
function check(n,x){console.log((x?'PASS ':'FAIL ')+n);x?pass++:fail++;}
function setup(){h.reset();Object.assign(process.env,{UGC_RETENTION_POLICY_STATUS:'confirmed',
  UGC_RETENTION_MARK_AFTER_DAYS:'29',UGC_RETENTION_BATCH_LIMIT:'10',
  UGC_RETENTION_CONFIRMED_BY:'offline-test',UGC_RETENTION_TRIGGER_TOKEN:'offline-secret'});
  h.seed('submissions',{_id:'private-row',status:'approved',rev:1,
    createdAt:new Date(now.getTime()-31*86400000),payload:{text:'private-body'},
    retention:{purge:{retryAfter:new Date(now.getTime()+60000)}}});}
async function run(){setup();await T.purgePayload({now,requestId:'discover-batch'});
  const rec=await T.reconcileBatches({eventType:'retention_purge'});
  const ref=rec.batches.find(x=>x.outcome==='DEFERRED_RETRYABLE').batchRef;
  const before=h.touchedCollections().length;
  const forbidden=await fn.main({action:'discoverPurgeBatches',batchRef:ref},{});
  check('F1 无令牌在查询前拒绝',forbidden.code==='FORBIDDEN'&&h.touchedCollections().length===before);
  const found=await fn.main({action:'discoverPurgeBatches',batchRef:ref,
    maintenanceToken:'offline-secret'},{});
  check('F2 对账 batchRef 定位原 batchId 和可修复状态',found.ok&&found.batches.length===1&&
    found.batches[0].batchId==='discover-batch'&&found.batches[0].repairable&&
    found.batches[0].outcome==='DEFERRED_RETRYABLE');
  check('F3 返回不含正文、投稿 ID、令牌',!JSON.stringify(found).includes('private-body')&&
    !JSON.stringify(found).includes('private-row')&&!JSON.stringify(found).includes('offline-secret'));
  const page1=await fn.main({action:'discoverPurgeBatches',batchRef:ref,limit:1,
    maintenanceToken:'offline-secret'},{});
  const page2=await fn.main({action:'discoverPurgeBatches',batchRef:ref,limit:1,
    cursor:page1.nextCursor,maintenanceToken:'offline-secret'},{});
  check('F4 有界 _id 游标分页可继续发现',page1.truncated&&page1.nextCursor&&
    [page1,page2].some(p=>p.batches.some(x=>x.batchId==='discover-batch'))&&
    page2.scanned===1);
  check('F5 发现过程不修改审计或正文',h.state.removeCalls===0&&
    h.docs('submissions')[0].payload.text==='private-body');
  console.log('T3.6.2 discovery: '+pass+' PASS / '+fail+' FAIL');if(fail)process.exitCode=1;
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
