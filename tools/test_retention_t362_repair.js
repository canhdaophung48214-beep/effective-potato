'use strict';
const { createHarness } = require('./ugc_fake_cloud');
const h=createHarness(), T=h.loadFunction('cloudfunctions/retention/index.js').__test__;
const now=new Date('2026-10-30T12:00:00Z'); let pass=0,fail=0;
function check(n,x){console.log((x?'PASS ':'FAIL ')+n);x?pass++:fail++;}
function reset(){h.reset();Object.assign(process.env,{UGC_RETENTION_POLICY_STATUS:'confirmed',
  UGC_RETENTION_MARK_AFTER_DAYS:'29',UGC_RETENTION_BATCH_LIMIT:'10',
  UGC_RETENTION_CONFIRMED_BY:'offline-test',UGC_RETENTION_TRIGGER_TOKEN:'offline-secret'});}
function seed(){h.seed('submissions',{_id:'row',status:'approved',rev:1,
  createdAt:new Date(now.getTime()-31*86400000),payload:{text:'private'},
  retention:{purge:{retryAfter:new Date(now.getTime()+60000)}}});}
function repairLogs(){return h.docs('upload_logs').filter(x=>x.result.code==='REPAIR_CONFIRMED');}
async function run(){
  reset();seed();await T.purgePayload({now,requestId:'rev-drift'});
  h.state.docs.submissions[0].rev=2;
  const drift=await T.repairPurgeBatch({batchId:'rev-drift',now:new Date(now.getTime()+61000)});
  check('R1 未清记录 rev 漂移拒绝自动修复',drift.code==='REPAIR_EVIDENCE_INCOMPLETE'&&
    repairLogs().length===0&&h.docs('submissions')[0].payload.text==='private');
  reset();seed();await T.purgePayload({now,requestId:'status-drift'});
  h.state.docs.submissions[0].status='rejected';
  const changed=await T.repairPurgeBatch({batchId:'status-drift',now:new Date(now.getTime()+61000)});
  check('R2 状态变化不能用旧清单冒充恢复',changed.code==='REPAIR_EVIDENCE_INCOMPLETE'&&repairLogs().length===0);
  reset();seed();await T.purgePayload({now,requestId:'tampered'});
  h.state.docs.upload_logs.find(x=>x.result.stats&&x.result.stats.phase==='prepare')
    .result.stats.selectedEvidence[0].rev=99;
  const forged=await T.repairPurgeBatch({batchId:'tampered',now:new Date(now.getTime()+61000)});
  check('R3 清单被改动后 HMAC 摘要不符，不追加修复事件',forged.code==='REPAIR_EVIDENCE_INVALID'&&repairLogs().length===0);
  reset();seed();await T.purgePayload({now,requestId:'repeat'});
  const fixed=await T.repairPurgeBatch({batchId:'repeat',now:new Date(now.getTime()+61000)});
  const again=await T.repairPurgeBatch({batchId:'repeat',now:new Date(now.getTime()+62000)});
  check('R4 到期修复事件幂等，原始 DEFERRED_RETRYABLE 保留',fixed.ok&&
    again.code==='ALREADY_REPAIRED'&&repairLogs().length===1&&
    h.docs('upload_logs').some(x=>x.result.code==='DEFERRED_RETRYABLE'));
  console.log('T3.6.2 repair: '+pass+' PASS / '+fail+' FAIL');if(fail)process.exitCode=1;
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
