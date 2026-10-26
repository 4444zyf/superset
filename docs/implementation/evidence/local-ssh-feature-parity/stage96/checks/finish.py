import gzip,hashlib,json,os,re,subprocess
from pathlib import Path

root=Path('/workspace/superset'); scratch=Path('/workspace/scratch/parity-96')
dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage96'
assert not dest.exists()
snapshot=json.loads((scratch/'product-snapshot.json').read_text())
fixtures=json.loads((scratch/'choice-fixture-snapshot.json').read_text())
assert len(snapshot['files'])==2205 and len(fixtures)==74
for row in snapshot['files']:
 assert hashlib.sha256((root/'apps/desktop/dist'/row['path']).read_bytes()).hexdigest()==row['sha256'],row['path']
for name,digest in fixtures.items():assert hashlib.sha256((root/name).read_bytes()).hexdigest()==digest,name
cli=hashlib.sha256((root/'apps/desktop/dist/resources/bin/superset').read_bytes()).hexdigest()
assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
assert not Path('/tmp/.X11-unix/X163').exists()

def exists(pid):
 try:os.kill(pid,0);return True
 except ProcessLookupError:return False

def write(name,value):
 p=dest/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')

cases=[];verified=[]
for case in sorted(scratch.iterdir()):
 if not case.is_dir() or not (case/'owned-cleanup.json').exists():continue
 cleanup=json.loads((case/'owned-cleanup.json').read_text())
 identity=json.loads((case/'app/observed-identity.json').read_text())
 assert cleanup['ownedXorgExit']==0 and not exists(cleanup['ownedXorgPid'])
 assert not exists(identity['pid'])
 entry={'case':case.name,'cleanup':cleanup,'appPid':identity['pid'],'ownedAppAndXorgAbsent':True}
 if cleanup['appExit']==0:
  report=json.loads((case/'app/browser-design-ui.json').read_text())
  reopened=json.loads((case/'app/browser-design-reopened.json').read_text())
  browser=json.loads((case/'app/browser-ui.json').read_text())
  assert not report.get('error') and report['errors']==[] and reopened['errors']==[]
  assert len(report['existingAgent']['feedbacks'])==2 and reopened['feedbacks']==2 and reopened['stoppedByActualCtrlC']
  assert not browser['cleanup']['running']
  assert browser['rendererBeforeReopen']==[] and browser['rendererAfterReopen']==[]
  for field in ['pid','executionId','cwd']:
   assert report['agentBefore'][field]==report['agentAfter'][field]==reopened['agent'][field]
   assert browser['terminalBefore'][field]==browser['terminalAfter'][field]
  assert not exists(report['newAgent']['pid']) and not exists(report['agentBefore']['pid']) and not exists(browser['cleanup']['pid'])
  feedback=report['existingAgent']['feedbacks'][1]
  import base64
  assert base64.b64decode(feedback['rawBase64']).decode()=='\x1b[200~'+feedback['prompt']+'\x1b[201~'
  entry.update(agentPid=report['agentBefore']['pid'],programPid=report['newAgent']['pid'],agentExecutionId=report['agentExecutionId'],httpPid=browser['terminalBefore']['pid'],httpExecutionId=browser['terminalBefore']['executionId'],inspectPorts=identity['inspectPorts'],rendererUrl=identity['rendererUrl'],feedbacks=2,normalReopen=True,syntheticTuiNotVendorAuthentication=True)
  verified.append(entry)
 else:
  entry['failure']=json.loads((case/'app/browser-design-ui.json').read_text()).get('error','old build missing the new design entry')
 cases.append(entry)
assert {x['case'] for x in verified}=={'choice-local-fe715','verified-ssh-fe715'}

def copy(file,target):
 data=file.read_bytes();target=dest/target;target.parent.mkdir(parents=True,exist_ok=True)
 if file.suffix!='.png':
  data=re.sub(rb'/agent-hook/[a-f0-9]{64}',b'/agent-hook/[REDACTED-CALLBACK-CAPABILITY]',data)
 if file.suffix in ['.log','.txt','.ndjson'] or file.name.startswith('product-snapshot'):
  target=Path(str(target)+'.gz');data=gzip.compress(data,mtime=0)
 target.write_bytes(data)

for file in sorted(scratch.iterdir()):
 if file.is_file() and file.suffix in ['.log','.json','.mjs','.py'] and file.name!='finish.py':copy(file,Path('checks')/file.name)
for case in cases:
 folder=scratch/case['case']
 for file in sorted(folder.iterdir()):
  if file.is_file() and file.suffix in ['.json','.log']:copy(file,Path(case['case'])/file.name)
 for file in sorted((folder/'app').iterdir()):
  if file.is_file() and file.suffix in ['.json','.png','.txt','.ndjson']:copy(file,Path(case['case'])/'app'/file.name)
write('cases.json',cases)
write('source-summary.json',{'source':snapshot['sourceCommit'],'fixtureCommit':json.loads((scratch/'choice-fixture-commit.json').read_text())['commit'],'scope':'original design feedback UI, target-machine attachments, original new-agent launch, scoped durable existing-agent send, and capability-limited direct callback relay','compiled':json.loads((scratch/'product-snapshot-summary.json').read_text()),'fixtures':len(fixtures),'cliSha256':cli,'checks':{'desktopBeforeNativeFix':{'tests':271,'assertions':4272,'files':36},'browserAfterClickFix':{'tests':154,'assertions':395,'files':20},'hostAfterRelayFix':{'tests':96,'assertions':282,'files':8},'desktopTypesExit':0,'hostTypesExit':0,'strictLocales':17,'pluginsExit':0},'verified':verified,'oldAuthenticationAndNotificationRpcByteUnchanged':True,'failuresRetained':len(cases)-len(verified),'lastFullTerminalFourScenarios':'stage89 product5dcb36689, not rerun here','limits':['synthetic TUI and owned loopback SSH only; no actual vendor authentication, external SSH, or physical Mac acceptance','CLI browser bridge, right pane and remaining parity work continue','no Actions, CLI rebuild, installer or sealed backend archive']})
review=json.loads((scratch/'visual-review.json').read_text());write('visual-review.json',review)
hashes={str(p.relative_to(dest)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.rglob('*')) if p.is_file()}
(dest/'SHA256SUMS').write_text(''.join(f'{h}  {p}\n' for p,h in hashes.items()))
print(json.dumps({'evidenceFiles':len(hashes)+1,'verified':[x['case'] for x in verified],'failureCases':len(cases)-len(verified),'allOwnedProcessesAbsent':True}))
