'use strict';
const fs=require('fs'), path=require('path'), cp=require('child_process');
const root=path.resolve(__dirname,'../../项目');
const scripts=['test_retention_t365_skipped_recovery','test_retention_t365_unrecoverable','test_retention_t365_repair_regression',
'test_retention_t363_deferred_resolution','test_retention_t363_audit_recovery','test_retention_t363_batch_integrity',
'test_retention_mark','test_retention_recover_pending','test_retention_purge','test_retention_reconcile','test_retention_audit_gate',
'test_retention_t34_resume','test_retention_t36_concurrency','test_retention_t36_repair','test_retention_t36_resume',
'test_retention_t361_deferred','test_retention_t361_repair','test_retention_t361_lock_recovery',
'test_retention_t362_deferred','test_retention_t362_repair','test_retention_t362_discovery','test_retention_t362_scan_queue',
'test_ugc_review','test_ugc_submit','test_ugc_client_contract','test_index_state','test_pages','check_eol','test_check_doc_refs','test_records_spec',
'test_verify_data','verify_data'];
const rows=[]; let raw='T3.6.5 actual local execution '+new Date().toISOString()+'\n';
function record(command,r){const output=(r.stdout||'')+(r.stderr||'');
 const matches=[...output.matchAll(/PASS\s+(\d+)\s*\/\s*FAIL\s+(\d+)/g),...output.matchAll(/(\d+)\s+PASS\s*[,/]\s*(\d+)\s+FAIL/g),...output.matchAll(/通过\s*(\d+)\s*(?:项[，,]?|[，,\/])\s*失败\s*(\d+)/g)].sort((a,b)=>a.index-b.index);
 const m=matches.at(-1);const row={command,exitCode:r.status,pass:m?+m[1]:null,fail:m?+m[2]:null,summary:output.split(/\r?\n/).filter(x=>/汇总|PASS.*FAIL|通过.*失败|合计|PENDING|待实现|RESULT/.test(x)).slice(-5)};
 rows.push(row);raw+='\nCOMMAND: '+command+'\n'+output+'\nEXIT_CODE: '+r.status+'\n';console.log(JSON.stringify(row));}
for(const s of scripts) record('node tools/'+s+'.js',cp.spawnSync(process.execPath,['tools/'+s+'.js'],{cwd:root,encoding:'utf8',maxBuffer:16e6}));
record('schema JSON parse',cp.spawnSync(process.execPath,['-e',"for(const p of ['config/cloud/schema.submissions.json','config/cloud/schema.upload_logs.json']){JSON.parse(require('fs').readFileSync(p,'utf8'));console.log('PASS '+p)}"],{cwd:root,encoding:'utf8'}));
record('git diff --check',cp.spawnSync('git',['-c','safe.directory='+root,'diff','--check'],{cwd:root,encoding:'utf8'}));
fs.writeFileSync(path.resolve(__dirname,'../Codex_T3.6.5_最终回归原始输出_20261031.txt'),raw);
fs.writeFileSync(path.join(__dirname,'test_results.json'),JSON.stringify(rows,null,2));
if(rows.some(x=>x.exitCode!==0))process.exitCode=1;
