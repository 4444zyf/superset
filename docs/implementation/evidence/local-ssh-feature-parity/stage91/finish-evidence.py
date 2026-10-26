from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3,re,os,subprocess
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-91');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage91'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files']);cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items());(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f),'localFixtureCommit':'3230bd16b','sshFixtureCommit':'181fc037a','onlySshBridgeForwardingChangedAfterLocal':True},indent=2)+'\n')
local={p:hashlib.sha256(subprocess.check_output(['git','show','3230bd16b:'+p],cwd=root)).hexdigest() for p in f};(scratch/'local-fixture-snapshot.json').write_text(json.dumps(local,indent=2)+'\n');assert [p for p in f if f[p]!=local[p]]==['apps/desktop/scripts/verify-workspace-restore-ui.mjs']
summary={'source':m['sourceCommit'],'cases':{}}
for kind,name in {'local':'diagnostic-local-path-609f6','ssh':'verified-ssh-bridge-609f6'}.items():
 case=scratch/name;app=case/'app';h=json.loads((app/'browser-sites-ui.json').read_text());d=json.loads((app/'browser-ui.json').read_text());r=json.loads((app/'browser-sites-reopened.json').read_text());c=json.loads((case/'owned-cleanup.json').read_text());assert c['appExit']==c['ownedXorgExit']==0
 assert h['capability'] and h['setup']=={'cookieCount':28,'primaryCount':2,'foreignCount':1} and len(h['initial']['rows'])==20 and h['initial']['placeholder']=='Search 27 sites…'
 assert h['beforeEnter']=={'state':'open','role':'menuitem','text':'site-24-owned.invalid'} and h['primaryTitle']=='2 cookies — forget this site';assert len(h['after'])==len(r['cookies'])==25
 for rows in [h['after'],r['cookies']]:assert not any(row['domain'] in [h['primaryHost'],'site-24-owned.invalid'] for row in rows) and sum(row['domain']=='other-owned.invalid' for row in rows)==1
 assert h['invalidEmpty']=={'rejected':True} and h['errors']==d['rendererAfterReopen']==[] and not d['cleanup']['running'];assert all(d['terminalBefore'][k]==d['terminalAfter'][k] for k in ['id','executionId','pid','cwd'])
 i=json.loads((app/'observed-identity.json').read_text());assert i['appPath']==str(root/'apps/desktop') and i['rendererUrl']=='file://'+str(dist/'renderer/index.html');counts=[]
 for p in Path(i['userData']).rglob('Cookies'):
  with sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True) as db:total=db.execute('select count(*) from cookies').fetchone()[0]
  if total:counts.append(total)
 assert counts==[25],counts
 if kind=='ssh':assert len(json.loads((app/'workspace-restore-ui.json').read_text())['samples'])==20
 summary['cases'][kind]={'case':name,'fixtureSetup':'guest JS primary cookies and owned main native SDK synthetic secure HttpOnly cookies','initialCookies':28,'initialDomains':27,'visibleRowsCappedAt':20,'searchBeyondFirstTwenty':True,'keyboardDeleteSecureHttpOnlyCookie':True,'nativeKeyboardFocus':h['beforeEnter'],'mouseDeletesBothPrimaryPaths':True,'unrelatedDomainPreserved':True,'cookiesAfterNormalReopen':25,'privateEmptyDomainDiagnosticRejected':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'originalPtyAndCwdPreserved':True,'runtimeExceptions':h['errors'],'cleanup':c}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n');prefixes=[str(p.resolve())+'/' for p in scratch.iterdir() if p.is_dir() and (p/'owned-cleanup.json').is_file()];remaining=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name) in [os.getpid(),os.getppid()]:continue
 try:args=(p/'cmdline').read_bytes().replace(b'\x00',b' ').decode(errors='replace')
 except OSError:continue
 if any(prefix in args for prefix in prefixes):remaining.append(int(p.name))
assert not remaining and not Path('/tmp/.X11-unix/X163').exists();(scratch/'owned-process-cleanup.json').write_text(json.dumps({'remainingOwnedCaseProcesses':remaining,'xorgSocketAbsent':True},indent=2)+'\n');assert not dest.exists();dest.mkdir(parents=True)
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
 if p.is_file():
  data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes();assert not re.search(rb'-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END',data),p
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(dest))+'\n' for p in sorted(dest.rglob('*')) if p.is_file());(dest/'SHA256SUMS').write_text(manifest);print(json.dumps({'source':summary['source'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases'])},indent=2))
