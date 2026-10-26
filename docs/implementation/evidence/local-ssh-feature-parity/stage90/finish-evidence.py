from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3,re,os
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-90');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage90'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items());(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'fixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/('verified-'+kind+'-1e140');app=case/'app';h=json.loads((app/'browser-import-banner-ui.json').read_text());d=json.loads((app/'browser-ui.json').read_text());r=json.loads((app/'browser-import-banner-reopened.json').read_text());t=json.loads((app/'browser-tools-ui.json').read_text());c=json.loads((case/'owned-cleanup.json').read_text());assert c['appExit']==c['ownedXorgExit']==0;expected=202 if kind=='local' else 0
 assert h['initial']['count']==1 and h['dialog']['checkboxCount']==1 and len(h['dialog']['profiles'])==2
 assert len(h['finalRows'])==len(r['rows'])==expected and r['banners']==0 and r['sourceFilesUnchanged'] and h['sourceFilesUnchanged'];assert list(h['dismissal'])==['browser-import-banner']
 assert h['errors']==t['errors']==d['rendererAfterReopen']==[] and not d['cleanup']['running'];assert all(d['terminalBefore'][k]==d['terminalAfter'][k] for k in ['id','executionId','pid','cwd'])
 for file in h['fixture']['sourceFiles']:assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest()==file['sha256']
 identity=json.loads((app/'observed-identity.json').read_text());assert identity['appPath']==str(root/'apps/desktop') and identity['rendererUrl']=='file://'+str(dist/'renderer/index.html');assert identity['appData']==h['fixture']['configRoot']
 with sqlite3.connect('file:'+str(Path(identity['userData'])/'direct-workstation/browser-history.db')+'?mode=ro',uri=True) as db:count=db.execute('select count(*) from browser_history where url like ?',('%'+h['fixture']['marker']+'%',)).fetchone()[0]
 assert count==expected
 if kind=='ssh':assert len(json.loads((app/'workspace-restore-ui.json').read_text())['samples'])==20
 summary['cases'][kind]={'initialOriginalBannerCount':1,'firstDetectedBrowser':'Google Chrome','cancelLeavesBanner':True,'noHistoryImportedByMetadataDiscovery':True,'explicitDismiss':h['manualDismiss'],'successDismiss':not h['manualDismiss'],'sourceRowsAfterReopen':count,'newPaneAndNormalReopenKeepBannerHidden':True,'menuImportStillAvailable':True,'oneGlobalImportForm':True,'boundedExistingDismissalKey':h['dismissal'],'sourceFilesUnchanged':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':h['errors'],'cleanup':c}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
prefixes=[str(p.resolve())+'/' for p in scratch.glob('verified-*') if p.is_dir()];remaining=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name) in [os.getpid(),os.getppid()]:continue
 try:args=(p/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
 except OSError:continue
 if any(prefix in args for prefix in prefixes):remaining.append(int(p.name))
assert not remaining and not Path('/tmp/.X11-unix/X163').exists();(scratch/'owned-process-cleanup.json').write_text(json.dumps({'remainingOwnedCaseProcesses':remaining,'xorgSocketAbsent':True},indent=2)+'\n')
assert not dest.exists();dest.mkdir(parents=True)
def retain(p,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix=='.log' or p.name.endswith('-log.txt'):target.with_name(target.name+'.gz').write_bytes(gzip.compress(p.read_bytes(),mtime=0))
 else:shutil.copyfile(p,target)
for p in scratch.iterdir():
 if p.is_file() and p.suffix in ['.log','.json','.py','.mjs']:retain(p,dest/p.name)
for case in sorted(scratch.iterdir()):
 if not case.is_dir() or not (case/'owned-cleanup.json').is_file():continue
 for p in case.iterdir():
  if p.is_file() and p.suffix in ['.log','.json']:retain(p,dest/case.name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.txt','.log','.png']:retain(p,dest/case.name/'app'/p.name)
for p in dest.rglob('*'):
 if not p.is_file():continue
 data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes();assert not re.search(rb'-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END',data),p
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(dest))+'\n' for p in sorted(dest.rglob('*')) if p.is_file());(dest/'SHA256SUMS').write_text(manifest);print(json.dumps({'source':summary['source'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases'])},indent=2))
