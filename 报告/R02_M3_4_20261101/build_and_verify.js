'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const ROOT=process.cwd(),P=path.join(ROOT,'项目'),E=path.join(ROOT,'报告/R02_M3_4_20261101');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>['.git','node_modules'].includes(x.name)?[]:x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);}
const before=walk(P).map(p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(fs.readFileSync(p))}));
const git=args=>cp.execFileSync('git',['-c','safe.directory='+P.replace(/\\/g,'/'),...args],{cwd:P,encoding:'utf8'});
const gs={head:git(['rev-parse','HEAD']),branch:git(['branch','--show-current']),status:git(['status','--porcelain=v1','-uall']),staged:git(['diff','--cached','--name-status'])};
const write=(n,s)=>{const p=path.join(E,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s,{flag:'wx'});};
write('project_before.json',JSON.stringify(before,null,2));write('git_before.json',JSON.stringify(gs,null,2));
write('adapter.js',`'use strict';
function adaptOne(r){
 if(!r||!r.id||!r.sourceMenuPrice||!r.currentEffectivePrice)throw Error('INVALID_SOURCE');
 const s=r.sourceMenuPrice,c=r.currentEffectivePrice;
 if(!Number.isFinite(s.amount)||s.amount<=0||typeof s.rawExpression!=='string'||!s.rawExpression)throw Error('INVALID_MENU_PRICE');
 if(c.validity!=='UNKNOWN'||c.amount!==null||s.unit!==null||s.sourceDate!==null)throw Error('UNEXPECTED_KNOWN_VALUE');
 return {id:r.id,name:r.name,historicalMenuPrice:{amount:s.amount,rawExpression:s.rawExpression,currency:s.currency,unit:null,sourceDate:null,sourceRef:s.sourceRef},currentEffectivePrice:{amount:null,validity:'UNKNOWN'},source:{...r.legacyRecord.source},parentEvidence:JSON.parse(JSON.stringify(r.parentEvidence)),display:{name:r.name,historicalPriceText:s.rawExpression,currentPriceText:'当前价格未核实',historyNotice:'历史菜单记录，仅供查阅，不用于购买或交易报价',sourceText:r.legacyRecord.source.detail+'；'+s.sourceRef,parentNotice:'档口名称暂定，门头及正式签发待核验'},permissions:{historicalDisplay:true,transactionQuote:false,formalImport:false}};
}
function adaptAll(rows){if(!Array.isArray(rows))throw Error('ARRAY_REQUIRED');const out=rows.map(adaptOne);if(new Set(out.map(r=>r.id)).size!==out.length)throw Error('DUPLICATE_ID');return out;}
function currentQuote(){throw Error('HISTORICAL_RECORD_NOT_QUOTABLE');}
module.exports={adaptOne,adaptAll,currentQuote};
`);
const input=JSON.parse(fs.readFileSync(path.join(ROOT,'报告/R02_M3_3_20261101/layered_candidates_39.json'),'utf8'));
const adapter=require(path.join(E,'adapter.js'));const out=adapter.adaptAll(input);write('adapted_records_39.json',JSON.stringify(out,null,2));
write('mini/components/history-menu/index.js',`Component({properties:{records:{type:Array,value:[]}}});\n`);
write('mini/components/history-menu/index.json',JSON.stringify({component:true},null,2));
write('mini/components/history-menu/index.wxml',`<view class="history-list"><view class="notice">历史菜单 · 仅供查阅</view><view wx:for="{{records}}" wx:key="id" class="card"><view class="name">{{item.display.name}}</view><view class="price-row"><text class="label">原菜单标价</text><text class="history-price">{{item.display.historicalPriceText}}</text></view><view class="current">{{item.display.currentPriceText}}</view><view class="hint">{{item.display.historyNotice}}</view><view class="source">来源：{{item.display.sourceText}}</view><view class="parent">{{item.display.parentNotice}}</view></view></view>\n`);
const css=`.history-list{padding:28rpx;background:#f5f3ee;color:#292a26}.notice{padding:20rpx;border-left:6rpx solid #9a6a28;background:#fff3d9;margin-bottom:24rpx}.card{padding:28rpx;margin-bottom:22rpx;border-radius:16rpx;background:white}.name{font-size:34rpx;font-weight:600}.price-row{margin-top:20rpx}.label{font-size:24rpx;color:#706957;margin-right:18rpx}.history-price{font-size:36rpx;color:#7a5c30}.current{margin-top:16rpx;font-size:28rpx;color:#555}.hint{margin-top:14rpx;font-size:24rpx;color:#89521c}.source,.parent{margin-top:14rpx;font-size:22rpx;color:#777;word-break:break-all}`;
write('mini/components/history-menu/index.wxss',css);
write('mini/pages/history/index.js',`const records=require('../../../adapted_records_39.json');Page({data:{records}});\n`);
// JSON is copied inside mini root to keep standalone package import paths valid.
write('mini/adapted_records_39.json',JSON.stringify(out,null,2));
// page relative path resolves mini/adapted_records_39.json (two levels up).
fs.writeFileSync(path.join(E,'mini/pages/history/index.js'),`const records=require('../../adapted_records_39.json');Page({data:{records}});\n`);
write('mini/pages/history/index.json',JSON.stringify({navigationBarTitleText:'历史菜单',usingComponents:{'history-menu':'../../components/history-menu/index'}},null,2));
write('mini/pages/history/index.wxml','<history-menu records="{{records}}" />\n');write('mini/pages/history/index.wxss','page{background:#f5f3ee}\n');
write('mini/app.js','App({});\n');write('mini/app.json',JSON.stringify({pages:['pages/history/index']},null,2));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cards=out.map(r=>`<article><h2>${esc(r.display.name)}</h2><div><span>原菜单标价</span> <strong>${esc(r.display.historicalPriceText)}</strong></div><p class="current">${esc(r.display.currentPriceText)}</p><p class="hint">${esc(r.display.historyNotice)}</p><small>来源：${esc(r.display.sourceText)}<br>${esc(r.display.parentNotice)}</small></article>`).join('');
write('historical_menu_preview.html',`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>历史菜单</title><style>body{font-family:system-ui;background:#f5f3ee;color:#292a26;max-width:780px;padding:24px;margin:auto}header{padding:20px;background:#fff3d9;border-left:4px solid #9a6a28}article{background:white;padding:22px;margin:18px 0;border-radius:12px}h2{font-size:20px}strong{font-size:25px;color:#7a5c30}span,small{color:#777}small{line-height:1.8}.hint{color:#89521c}.current{color:#555}</style><header><h1>历史菜单 · 仅供查阅</h1><p>当前售价、来源日期和计价单位未核实。没有购买或报价功能。</p></header>${cards}</html>`);
write('test_adapter.js',`'use strict';
const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');const a=require('./adapter');
const source=JSON.parse(fs.readFileSync(path.join(__dirname,'../../报告/R02_M3_3_20261101/layered_candidates_39.json'),'utf8'));const result=a.adaptAll(source);let n=0;function test(name,f){f();console.log('PASS '+name);n++;}
test('39 one-to-one unique',()=>{assert.equal(result.length,39);assert.deepStrictEqual(result.map(r=>r.id),source.map(r=>r.id));});
test('name amount expression source preserved',()=>result.forEach((r,i)=>{assert.equal(r.name,source[i].name);assert.equal(r.historicalMenuPrice.amount,source[i].sourceMenuPrice.amount);assert.equal(r.historicalMenuPrice.rawExpression,source[i].sourceMenuPrice.rawExpression);assert.deepStrictEqual(r.source,source[i].legacyRecord.source);}));
test('no formal price field anywhere in adapter outputs',()=>{function check(x){if(x&&typeof x==='object'){assert(!Object.hasOwn(x,'price'));Object.values(x).forEach(check);}}check(result);});
test('unknown current unit and date preserved',()=>result.forEach(r=>{assert.equal(r.currentEffectivePrice.validity,'UNKNOWN');assert.strictEqual(r.currentEffectivePrice.amount,null);assert.strictEqual(r.historicalMenuPrice.unit,null);assert.strictEqual(r.historicalMenuPrice.sourceDate,null);}));
test('no transaction quote even caller changes permissions',()=>{const r=structuredClone(result[0]);r.permissions.transactionQuote=true;assert.throws(()=>a.currentQuote(r),/NOT_QUOTABLE/);} );
test('parent pending retained and does not remove display',()=>result.forEach(r=>{assert.equal(r.parentEvidence.stall.formalSignoff,'PENDING');assert(r.permissions.historicalDisplay);assert(r.display.name);}));
test('duplicate ID and fabricated current price rejected',()=>{assert.throws(()=>a.adaptAll([source[0],source[0]]),/DUPLICATE/);let r=structuredClone(source[0]);r.currentEffectivePrice.amount=10;assert.throws(()=>a.adaptOne(r),/UNEXPECTED/);} );
test('actual mini page module loads39 through mocked Page',()=>{let page;const file=path.join(__dirname,'mini/pages/history/index.js');vm.runInNewContext(fs.readFileSync(file,'utf8'),{Page:x=>page=x,require:require('module').createRequire(file)});assert.equal(page.data.records.length,39);});
test('component property and WXML bindings',()=>{let component;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'mini/components/history-menu/index.js'),'utf8'),{Component:x=>component=x});assert(component.properties.records);const s=fs.readFileSync(path.join(__dirname,'mini/components/history-menu/index.wxml'),'utf8');for(const field of ['name','historicalPriceText','currentPriceText','historyNotice','sourceText']){assert(s.includes('item.display.'+field));assert(result.every(r=>typeof r.display[field]==='string'));}assert(!s.includes('item.price'));});
test('source input unchanged by adapter',()=>{assert.deepStrictEqual(a.adaptAll(source),result);});
console.log('RESULT '+n+' PASS / 0 FAIL');
`);
let t=cp.spawnSync(process.execPath,[path.join(E,'test_adapter.js')],{encoding:'utf8'});write('test_adapter.log',t.stdout+t.stderr+'\nEXIT='+t.status);if(t.status!==0)throw Error(t.stdout+t.stderr);
// Compatibility probe uses original importer, without price column, never casts historical amount to formal price.
const compat=path.join(E,'compat_input');fs.mkdirSync(compat);
for(const f of ['shops.csv','floors.csv','stalls.csv'])fs.copyFileSync(path.join(ROOT,'报告/R02_M3_1_20261101/candidates',f),path.join(compat,f));
const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
const headers=['dish_id','dish_name','record_type','shop_id','stall_id','source_kind','source_detail','source_ref','collector','collect_date','evidence_file','historical_price','current_price_status'];
fs.writeFileSync(path.join(compat,'dishes.csv'),'\uFEFF'+headers.join(',')+'\r\n'+out.map(r=>[r.id,r.name,'历史菜单记录',r.parentEvidence.shop.id,r.parentEvidence.stall.id,'field',r.source.detail,r.source.ref,'','','',r.historicalMenuPrice.rawExpression,'UNKNOWN'].map(csv).join(',')).join('\r\n')+'\r\n');
t=cp.spawnSync(process.execPath,['tools/import_data.js','--dir',compat,'--all'],{cwd:P,encoding:'utf8'});write('original_importer_compatibility.log',t.stdout+t.stderr+'\nEXIT='+t.status);if(t.status!==1||!(t.stdout+t.stderr).includes('缺少必需列 price'))throw Error('compatibility must reject missing formal price');
write('新旧结构兼容性报告.md',`# 新旧结构兼容性\n\n正式页面pages/index/index.wxml:22直接展示dish.price，不能复用来显示历史价而只加标签。新组件只消费display.historicalPriceText/currentPriceText，不包含price字段，禁止把历史金额写回原菜品price。\n\n可复用：id/name、shopId/stallId关联、source.kind/detail/ref及组件循环机制。隔离保存：historicalMenuPrice、currentEffectivePrice UNKNOWN、parentEvidence、权限。原始单位/日期保持null，父级签发独立。\n\n原版import_data.js真实只读探测退出1：缺price等必需列，历史价/状态额外列不会成为受支持语义（未知列只警告并忽略）；因此不是正式可导入结构。没有补price或伪装record_type=菜品来制造兼容PASS。完整输出original_importer_compatibility.log。该预期拒绝被测试视为正确边界，不计针对性测试失败。\n\n报告内侧车+独立组件可以保留正式数据完全不变；若正式接入小程序、存储或导入，必须另行审查契约/schema和独立历史数据入口，不能静默复用现有交易价格读取路径。组件不要求正式交易资格，不会发云请求，也不挂接正式首页。\n\nmini目录是独立可加载原型：app入口、history页及history-menu组件完整。Page与Component通过Node隔离模拟加载/绑定检查，未运行微信开发者工具真实渲染、基础库或真机。HTML为同一适配JSON生成的静态预览，不等同WXML渲染截图。\n`);
write('执行报告.md',`# R02-M3.4历史展示适配交付\n\nPASS：adapter.js独立CommonJS适配器、adapted_records_39.json、小程序WXML/WXSS/JS组件及独立mini页面、HTML预览真实落盘。39/39一对一，保留原价/原表达/菜名/source，无正式price字段；当前价null/UNKNOWN，日期与单位null，不提供报价。父级待核验仍显示历史证据，verifyStatus不提升。\n\n针对性Node测试10项通过、0失败、退出0；包括保留值、无price键、未知字段、篡改权限仍拒报价、父级分离、重复ID/伪造当前价拒绝、真实Page脚本加载39及Component/WXML字段绑定。原始输出test_adapter.log。复用M3.3事实，不重复8项旧测试或全量审计。\n\n正式导入器只读兼容检查实际退出1，因历史结构缺少正式price等必需列，属于预期拒绝；不是历史数据已经正式可导入。新旧结构兼容性报告明确正式契约升级边界。\n\nPENDING：微信开发者工具/真机WXML视觉验收、正式历史存储与入口契约审查。HTML可打开，静态绑定测试不冒充微信渲染。无正式发布/导入授权、无交易能力。\n\n保护：仅新建隔离目录，项目开工文件全部哈希未变，Git状态未变；data、契约、审批、ID映射、正式页面和导入器未改。未云端/部署/正式导入/Git写。当前没有修改前源码备份需要，project_before.json为哈希基线而非字节备份。文件清单、大小/SHA见delivery_manifest.json。\n`);
for(const x of before){if(hash(fs.readFileSync(x.path))!==x.sha256)throw Error('project changed '+x.path);}
if(git(['status','--porcelain=v1','-uall'])!==gs.status)throw Error('git changed');
write('checks.json',JSON.stringify({adapted:39,testsPass:10,testsFail:0,testExitCode:0,originalImporterCompatibilityExitCode:1,compatibilityResult:'EXPECTED_REJECTION',projectFilesUnchanged:before.length,gitUnchanged:true,realWeChatRender:'PENDING'},null,2));
const files=walk(E);write('delivery_manifest.json',JSON.stringify(files.map(p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(fs.readFileSync(p))})),null,2));
console.log('PASS adapter39; tests10/0; importer expected rejection1; project unchanged');
