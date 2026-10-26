from pathlib import Path
import json,hashlib,gzip,shutil,subprocess,os,re,collections
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-92');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage92'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items())
a=(scratch/'add-cdp-trace.py').read_text().split("\np=Path('/workspace/scratch")[0].replace('s=p.read_text()','s=subprocess.check_output(["git","show","10db7ce02:apps/desktop/scripts/verify-brand-ui.mjs"],cwd=r).decode()').replace('p.write_text(s)',"(scratch/'local-fixture-verify-brand-ui.mjs').write_text(s)")
exec(a,{'subprocess':subprocess,'scratch':scratch})
b=json.loads((scratch/'baseline-fixture-snapshot.json').read_text());assert hashlib.sha256((scratch/'local-fixture-verify-brand-ui.mjs').read_bytes()).hexdigest()==b['apps/desktop/scripts/verify-brand-ui.mjs']
assert [p for p in f if f[p]!=b[p]]==['apps/desktop/scripts/verify-brand-ui.mjs']
shutil.copyfile(root/'apps/desktop/scripts/verify-brand-ui.mjs',scratch/'final-fixture-verify-brand-ui.mjs')
summary={'productSource':m['sourceCommit'],'fixtureCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip(),'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f),'localVsSshFixtureDifference':'same diagnostic instrumentation, flag lookup factored and formatting only; exact snapshots retained','historicalStage91TimeoutReproduced':False,'historicalTimeoutRootCause':'unresolved; instrumentation may affect timing; no timeout/retry/close logic changes','cases':{}}
for kind,name in {'local':'tools-local-sync-609f6','ssh':'tools-ssh-sync-609f6'}.items():
 case=scratch/name;app=case/'app';t=json.loads((app/'browser-tools-ui.json').read_text());d=json.loads((app/'browser-ui.json').read_text());c=json.loads((case/'owned-cleanup.json').read_text());i=json.loads((app/'observed-identity.json').read_text());brand=json.loads((app/'brand-ui.json').read_text());rs=[json.loads(line) for line in (app/'cdp-diagnostic.ndjson').read_text().splitlines()]
 assert c['appExit']==c['ownedXorgExit']==0 and brand['singleInstance'] and brand['reopen']
 assert i['appPath']==str(root/'apps/desktop') and i['rendererUrl']=='file://'+str(dist/'renderer/index.html')
 assert all(d['terminalBefore'][k]==d['terminalAfter'][k] for k in ['id','executionId','pid','cwd'])
 assert d['rendererBeforeReopen']==d['rendererAfterReopen']==t['errors']==[] and not d['cleanup']['running']
 assert not t['after']['devToolsOpened'] and t['devTools']['devToolsOpened'] and d['marker'] in t['devToolsFrontend']['text'] and t['devToolsFrontend']['treeItems']>0
 assert t['settingsMenu']['after']['visible'] and t['settings']['focused']=='browser-homepage'
 assert not any(r['phase']=='timeout' or r.get('protocolError') for r in rs)
 requests={(r['connection'],r['id']) for r in rs if r['phase']=='request'};replies={(r['connection'],r['id']) for r in rs if r['phase']=='reply'};assert requests==replies
 expected={'time','scope','connection','id','method','caller','phase','elapsed','protocolError','evaluationException'};assert all(set(r)<=expected for r in rs)
 failures=[r for r in rs if r.get('evaluationException')];assert len(failures)==1 and 'readProof' in failures[0]['caller']
 timings={}
 for method in ['inspectBrowserDevTools','captureBrowserDevTools','closeBrowserDevTools']:
  calls=[r for r in rs if r['phase']=='reply' and method in r.get('caller','')];assert calls and all(not r['evaluationException'] for r in calls)
  timings[method]=[r['elapsed'] for r in calls]
 if kind=='ssh':assert len(json.loads((app/'workspace-restore-ui.json').read_text())['samples'])==20
 summary['cases'][kind]={'case':name,'ports':i['inspectPorts'],'renderer':i['rendererUrl'],'pty':{k:d['terminalBefore'][k] for k in ['id','executionId','pid','cwd']},'originalPtyAndCwdPreserved':True,'traceRecords':len(rs),'pairedRequests':len(requests),'timeouts':0,'protocolErrors':0,'evaluationExceptions':{'count':1,'caller':'readProof','scope':'renderer','context':'existing caught poll before owned HTTP fixture creates browser-proof.json; exception payload intentionally not recorded'},'devToolsTimingsMs':timings,'devToolsAfterClose':t['after']['devToolsOpened'],'rendererRuntimeExceptions':t['errors'],'normalReopen':brand['reopen'],'cleanup':c}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
prefixes=[str((scratch/x['case']).resolve())+'/' for x in summary['cases'].values()];remaining=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name) in [os.getpid(),os.getppid()]:continue
 try:args=(p/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
 except OSError:continue
 if any(prefix in args for prefix in prefixes):remaining.append(int(p.name))
assert not remaining and not Path('/tmp/.X11-unix/X163').exists();(scratch/'owned-process-cleanup.json').write_text(json.dumps({'remainingOwnedCaseProcesses':remaining,'xorgSocketAbsent':True},indent=2)+'\n')
(scratch/'visual-review.json').write_text(json.dumps({'actuallyViewed':['tools-local-sync-609f6/app/browser-tools-detached-devtools.png','tools-ssh-sync-609f6/app/browser-tools-detached-devtools.png'],'observations':'Both current captures visibly show expanded body, owned unique h1 marker and Elements DOM tree. One warning badge is visible. Other images were captured only. Historical stage91 collapsed screenshot remains distinct.'},indent=2)+'\n')
assert not dest.exists();dest.mkdir(parents=True)
def retain(p,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix in ['.log','.ndjson'] or p.name.endswith('-log.txt'):target.with_name(target.name+'.gz').write_bytes(gzip.compress(p.read_bytes(),mtime=0))
 else:shutil.copyfile(p,target)
for p in scratch.iterdir():
 if p.is_file() and p.suffix in ['.log','.json','.py','.mjs']:retain(p,dest/p.name)
for x in summary['cases'].values():
 case=scratch/x['case']
 for p in case.iterdir():
  if p.is_file() and p.suffix in ['.json','.log']:retain(p,dest/case.name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.txt','.log','.png','.ndjson']:retain(p,dest/case.name/'app'/p.name)
for p in dest.rglob('*'):
 if p.is_file():
  data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes();assert not re.search(rb'-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END',data),p
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(dest))+'\n' for p in sorted(dest.rglob('*')) if p.is_file());(dest/'SHA256SUMS').write_text(manifest)
print(json.dumps({'source':summary['productSource'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases']),'timeouts':0},indent=2))
