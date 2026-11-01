'use strict';
const {createHarness}=require('./ugc_fake_cloud');
const h=createHarness(),T=h.loadFunction('cloudfunctions/retention/index.js').__test__;
const now=new Date('2026-10-30T12:00:00Z');let pass=0,fail=0;
function check(n,x){console.log((x?'PASS ':'FAIL ')+n);x?pass++:fail++;}
function setup(n){h.reset();Object.assign(process.env,{UGC_RETENTION_POLICY_STATUS:'confirmed',
  UGC_RETENTION_MARK_AFTER_DAYS:'29',UGC_RETENTION_BATCH_LIMIT:'10',
  UGC_RETENTION_CONFIRMED_BY:'offline-test',UGC_RETENTION_TRIGGER_TOKEN:'offline-secret'});
  for(let i=0;i<n;i++){const id=String(i).padStart(5,'0');h.seed('upload_logs',{
    _id:id,event:'retention_mark',action:'retention_mark',submissionId:'synthetic-'+id,
    at:new Date(now.getTime()-1000),result:{code:'OK'}});}}
async function run(){
  setup(0);const empty=await T.reconcileBatches({eventType:'retention_mark',resumable:true,now});
  check('Q1 空扫描闭合且无伪造批次',empty.ok&&empty.completeScan&&empty.scanned===0&&empty.batches.length===0);
  setup(501);const first=await T.reconcileBatches({eventType:'retention_mark',resumable:true,now});
  const second=await T.reconcileBatches({eventType:'retention_mark',continuation:first.nextContinuation});
  check('Q2 501 条首段截断，第二段原水位准确续扫',!first.ok&&!first.completeScan&&
    first.scanned===500&&second.ok&&second.completeScan&&second.scanned===501&&
    first.scanScope.scanId===second.scanScope.scanId);
  setup(501);const start=await T.reconcileBatches({eventType:'retention_mark',resumable:true,now});
  h.seed('upload_logs',{_id:'00000a',event:'retention_mark',action:'retention_mark',
    submissionId:'new',at:now,result:{code:'OK'}});
  const changed=await T.reconcileBatches({eventType:'retention_mark',continuation:start.nextContinuation});
  check('Q3 扫描期间插入水位内日志作废原扫描',changed.code==='SCAN_CHANGED'&&
    !changed.completeScan&&changed.nextContinuation===null);
  setup(501);const stable=await T.reconcileBatches({eventType:'retention_mark',resumable:true,now});
  const bad=stable.nextContinuation.slice(0,-1)+'X';const reads=h.calls('upload_logs').length;
  const invalid=await T.reconcileBatches({eventType:'retention_mark',continuation:bad});
  check('Q4 损坏续扫凭据在读库前拒绝',invalid.code==='INVALID_SCAN_CONTINUATION'&&
    h.calls('upload_logs').length===reads);
  console.log('T3.6.2 scan queue: '+pass+' PASS / '+fail+' FAIL');if(fail)process.exitCode=1;
}
run().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
