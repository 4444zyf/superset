from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-85');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage85'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/'apps/desktop/scripts'/n).read_bytes()).hexdigest()==h for n,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-paint-477c1';d=json.loads((case/'app/browser-ui.json').read_text());h=d['downloads'];t=d['tools'];r=d['downloadsReopened'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 active={x['id'] for x in h['concurrent']};assert len(active)==2 and len({x['filename'] for x in h['concurrent']})==2 and all(0<x['receivedBytes']<x['totalBytes'] and x['state']=='progressing' for x in h['concurrent'])
 assert h['cancelled']['id']==h['cancelTarget']['id'] and h['cancelled']['state']=='cancelled'
 for key in ['afterClearActive','afterPaneClose']:assert {x['id'] for x in h[key]}==active and all(x['state']=='progressing' for x in h[key])
 assert {x['id'] for x in h['completed']}==active and all(x['state']=='completed' and x['receivedBytes']==x['totalBytes'] for x in h['completed'])
 assert h['releaseAfter']['clicks']==1 and any(x['name']=='first-contentful-paint' for x in h['releaseReady']['paint']) and any(x.startswith('/release-downloads') for x in h['serverAtEnd']['requests'])
 assert any(x['id']==h['persisted']['id'] and x['state']=='completed' for x in r['rows']) and any(x['id']==h['beforeQuit']['id'] and x['state']=='interrupted' for x in r['rows']) and r['filesStillPresent']
 expected={hashlib.sha256(((h['marker']+'|'+k+'|')*4096).encode()).hexdigest() for k in ['a','b','finished']};assert {x['sha256'] for x in h['files']}==expected
 for file in h['files']:
  data=(case/'downloads'/file['filename']).read_bytes();assert len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
 assert (case/'downloads'/'report 中文.txt').read_text()=='pre-existing downloaded file\n'
 dbfiles=list((case/'config').rglob('browser-downloads.db'));assert len(dbfiles)==1
 with sqlite3.connect('file:'+str(dbfiles[0])+'?mode=ro',uri=True) as db:assert db.execute('select count(*) from downloads').fetchone()[0]==0
 assert all(set(row)=={'id','filename','receivedBytes','totalBytes','state'} for row in h['concurrent'])
 assert h['errors']==t['errors']==d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases'][kind]={'directory':h['directory'],'concurrent':h['concurrent'],'cancelled':h['cancelled'],'activeIdsPreservedAfterClearAndOriginClose':True,'releaseBefore':h['releaseBefore'],'releaseReady':h['releaseReady'],'releaseClickCount':h['releaseAfter']['clicks'],'files':h['files'],'existingFileUnchanged':True,'partialBeforeQuit':h['beforeQuit'],'afterNormalReopen':r['rows'],'allFilesRetainedAfterMetadataClear':True,'metadataRowsAfterFinalClear':0,'displaySnapshotFields':['id','filename','receivedBytes','totalBytes','state'],'copiedUrl':t['copiedUrl'],'pageZoom':[t['beforeZoom']['state']['zoom'],t['zoomed']['state']['zoom'],t['resetZoom']['zoom']],'devToolsContainsOwnedMarker':True,'actualOsOpenOrRevealVerified':False,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':h['errors'],'guestConsoleWarningsObserved':len(h['hostAtEnd']['console']),'cleanup':cleanup}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
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
print(json.dumps({'source':m['sourceCommit'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases'])},indent=2))
