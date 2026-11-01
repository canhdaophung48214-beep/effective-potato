import pathlib,subprocess,json
E=pathlib.Path('报告/R02_M3_4_20261101').resolve();cli='D:/微信开发/微信web开发者工具/cli.bat'
for name,args in [('devtools_open',['open','--project',str(E/'mini'),'--debug']),('devtools_agent_help',['agent','--help']),('devtools_auto_help',['auto','--help'])]:
 try:
  r=subprocess.run([cli,*args],capture_output=True,timeout=45);data={'command':[cli,*args],'exitCode':r.returncode,'stdout':r.stdout.decode('utf-8',errors='replace'),'stderr':r.stderr.decode('utf-8',errors='replace')}
 except subprocess.TimeoutExpired as e:data={'command':[cli,*args],'exitCode':None,'error':'TIMEOUT_45_SECONDS','stdout':(e.stdout or b'').decode('utf-8',errors='replace'),'stderr':(e.stderr or b'').decode('utf-8',errors='replace')}
 (E/'M342_evidence'/f'{name}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8');print(name,data['exitCode'],str(data.get('stdout','')+data.get('stderr',''))[-1200:])
