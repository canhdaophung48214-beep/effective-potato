import pathlib,subprocess,json
E=pathlib.Path('报告/R02_M3_4_20261101').resolve();F=E/'M342_evidence';mini=E/'mini';bin=pathlib.Path('D:/微信开发/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec')
commands=[('wxml_compile',[str(bin/'wcc.exe'),'pages/history/index.wxml','components/history-menu/index.wxml']),('wxss_compile',[str(bin/'wcsc.exe'),'pages/history/index.wxss','components/history-menu/index.wxss'])]
results=[]
for name,cmd in commands:
 r=subprocess.run(cmd,cwd=mini,capture_output=True);(F/(name+'.stdout.txt')).write_bytes(r.stdout);(F/(name+'.stderr.txt')).write_bytes(r.stderr);results.append({'name':name,'command':cmd,'cwd':str(mini),'exitCode':r.returncode,'stdoutBytes':len(r.stdout),'stderrBytes':len(r.stderr),'evidenceScope':'bundled WeChat offline compiler only; NOT full IDE runtime rendering'});print(name,r.returncode,len(r.stdout),len(r.stderr))
(F/'wechat_offline_compile_results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
for name in ['test_adapter.js','test_m342.js']:
 r=subprocess.run(['node',str(E/name)],capture_output=True);(F/(name+'.log')).write_bytes(r.stdout+r.stderr+b'\nEXIT='+str(r.returncode).encode());assert r.returncode==0;print(name,r.returncode)
