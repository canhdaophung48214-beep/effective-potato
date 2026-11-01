'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const base=path.resolve(__dirname,'../..'),project=path.join(base,'项目'),reports=path.join(base,'报告');
const backup=path.join(base,'备份/T365_impl_20261031_144505_614');
const changed=['cloudfunctions/retention/index.js','config/cloud/schema.upload_logs.json','config/cloud/schema.submissions.json',
'tools/test_retention_t365_skipped_recovery.js','tools/test_retention_t365_unrecoverable.js','tools/test_retention_t365_repair_regression.js','docs/RETENTION_T365_DESIGN_20261031.md'];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const empty=path.join(__dirname,'empty');fs.writeFileSync(empty,'');
let patch='';const changes=[];
for(const file of changed){const target=path.join(project,file),old=path.join(backup,file);if(!fs.existsSync(target))throw Error('Missing '+file);
 const before=fs.existsSync(old)?fs.readFileSync(old):null,after=fs.readFileSync(target);
 const r=cp.spawnSync('git',['diff','--no-index','--',before?old:empty,target],{encoding:'utf8',maxBuffer:16e6});if(![0,1].includes(r.status))throw Error(r.stderr);
 patch+=r.stdout;changes.push({file,beforeBytes:before?.length??null,beforeSHA256:before?hash(before):null,afterBytes:after.length,afterSHA256:hash(after)});}
fs.writeFileSync(path.join(reports,'Codex_T3.6.5_精确差异_20261031.patch'),patch);
fs.writeFileSync(path.join(__dirname,'change_manifest.json'),JSON.stringify(changes,null,2));
const git=args=>cp.spawnSync('git',['-c','safe.directory='+project,...args],{cwd:project,encoding:'utf8'}).stdout;
fs.writeFileSync(path.join(__dirname,'git_after.txt'),git(['status','--porcelain=v1','-uall']));
fs.writeFileSync(path.join(__dirname,'git_metadata.json'),JSON.stringify({head:git(['rev-parse','HEAD']).trim(),branch:git(['branch','--show-current']).trim(),staged:git(['diff','--cached','--name-only']).trim(),stat:git(['diff','--stat'])},null,2));
const artifacts=[path.join(reports,'Codex_T3.6.5_Retention_最终闭环_20261031.md'),path.join(reports,'Codex_T3.6.5_精确差异_20261031.patch'),path.join(reports,'Codex_T3.6.5_最终回归原始输出_20261031.txt'),...changed.slice(3).map(x=>path.join(project,x))];
if(artifacts.every(x=>fs.existsSync(x))){const manifest=artifacts.map(p=>{const s=fs.statSync(p);return{path:p,bytes:s.size,SHA256:hash(fs.readFileSync(p)),createdAt:s.birthtime.toISOString()};});fs.writeFileSync(path.join(__dirname,'seven_artifacts_manifest.json'),JSON.stringify(manifest,null,2));console.log('Seven artifacts verified: '+manifest.length);}
console.log(JSON.stringify(changes,null,2));
