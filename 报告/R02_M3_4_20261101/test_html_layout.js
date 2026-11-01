'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process'),assert=require('assert'),{pathToFileURL}=require('url');
const E=__dirname,F=path.join(E,'M342_evidence'),port=9533;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'m342-edge-'));
const browser=cp.spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-sync','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
let socket,id=0,waiting=new Map();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function call(method,params={}){return new Promise((resolve,reject)=>{let n=++id;const timer=setTimeout(()=>{waiting.delete(n);reject(Error('CDP timeout '+method));},15000);waiting.set(n,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});socket.send(JSON.stringify({id:n,method,params}));});}
(async()=>{
 let target;
 for(let i=0;i<40;i++){try{target=await (await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();break;}catch{await delay(250);}}
 if(!target)throw Error('EDGE_CDP_START_FAILED');
 socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});socket.onmessage=e=>{const x=JSON.parse(e.data);if(x.id&&waiting.has(x.id)){const p=waiting.get(x.id);waiting.delete(x.id);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}};
 await call('Page.enable');await call('Runtime.enable');let results=[];
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 for(const width of [320,375]){
  await call('Emulation.setDeviceMetricsOverride',{width,height:740,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:pathToFileURL(path.join(E,'historical_menu_preview.html')).href});
  for(let i=0;i<50;i++){if(await evaluate('document.readyState')==='complete')break;await delay(100);}
  await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const check=await evaluate(`(()=>{const cards=[...document.querySelectorAll('article')];return {width:innerWidth,cards:cards.length,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:innerHeight,overflow:cards.some(e=>e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().left< -1),contentComplete:cards.every(e=>e.textContent.includes('历史菜单')&&e.textContent.includes('当前价格'))}})()`);
  assert.equal(check.cards,39);assert(check.scrollWidth<=width);assert(!check.overflow);assert(check.contentComplete);assert(check.scrollHeight>check.clientHeight);
  fs.writeFileSync(path.join(F,'html_'+width+'_top.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const bottom=await evaluate('(()=>{window.scrollTo(0,document.documentElement.scrollHeight);return new Promise(r=>requestAnimationFrame(()=>{const e=document.querySelectorAll("article")[38].getBoundingClientRect();r({scrollY:scrollY,lastBottom:e.bottom,lastTop:e.top,height:innerHeight})}))})()');assert(bottom.scrollY>0);assert(bottom.lastBottom<=bottom.height+1);assert(bottom.lastBottom>0);
  fs.writeFileSync(path.join(F,'html_'+width+'_bottom.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate(`(()=>{window.scrollTo(0,0);document.querySelector('h2').textContent='长菜名测试'.repeat(40);document.querySelector('small').textContent='长来源文字与不换行路径测试'+('SOURCE_'.repeat(200));return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))})()`);
  const long=await evaluate('(()=>{const e=document.querySelector("article"),h=e.querySelector("h2"),s=e.querySelector("small");return {scrollWidth:document.documentElement.scrollWidth,cardHeight:e.offsetHeight,nameHeight:h.offsetHeight,sourceHeight:s.offsetHeight,contentFits:[h,s].every(x=>x.scrollWidth<=x.clientWidth+1&&x.scrollHeight<=x.clientHeight+1),noOverlap:h.getBoundingClientRect().bottom<=s.getBoundingClientRect().top}})()');assert(long.scrollWidth<=width);assert(long.contentFits);assert(long.noOverlap);assert(long.nameHeight>40&&long.sourceHeight>40);
  fs.writeFileSync(path.join(F,'html_'+width+'_long.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  results.push({environment:'Microsoft Edge HTML renderer; NOT WeChat WXML',width,normal:check,scroll:bottom,longText:long,status:'PASS'});
 }
 fs.writeFileSync(path.join(F,'html_layout_results.json'),JSON.stringify(results,null,2));console.log('PASS HTML320/375 normal/long/scroll; six screenshots; no WeChat claim');
})().catch(e=>{fs.writeFileSync(path.join(F,'html_layout_error.log'),e.stack);console.error(e);process.exitCode=1;}).finally(async()=>{try{if(socket)await call('Browser.close');}catch{}try{socket?.close();browser.kill();}catch{}});
