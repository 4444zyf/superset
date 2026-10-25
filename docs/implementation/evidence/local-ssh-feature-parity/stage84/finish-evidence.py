from pathlib import Path
import json,hashlib,gzip,shutil
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-84');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage84'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/'apps/desktop/scripts'/n).read_bytes()).hexdigest()==h for n,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-b47ca';d=json.loads((case/'app/browser-ui.json').read_text());c=d['clearData'];t=d['tools'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert c['capability'] and c['firstCache']==c['secondCache']==1 and c['cancelled']==c['before'] and c['invalidRejected'] and c['history']['history']==[] and c['history']['cookie']==c['before']['cookie'] and c['history']['cacheRequests']==1
 assert not c['cookies']['cookie'] and c['cookies']['history']==c['reloaded']['history'] and c['cookies']['cacheRequests']==1
 assert c['cache']['cookie']==c['before']['cookie'] and c['cache']['history']==c['reloaded']['history'] and c['final']['cacheRequests']==2 and c['noneDisabled']
 assert all(any('Browsing data cleared' in item for item in c[k]) for k in ['historyToasts','cookiesToasts','cacheToasts'])
 assert c['errors']==t['errors']==d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases'][kind]={'cacheBeforeClear':[c['firstCache'],c['secondCache']],'cancelPreservesAllData':True,'invalidAllInputRejectedWithoutMutation':True,'historyOnly':{'rows':len(c['history']['history']),'cookiePreserved':True,'cacheRequests':c['history']['cacheRequests']},'cookiesOnly':{'cookie':c['cookies']['cookie'],'historyPreserved':True,'cacheRequests':c['cookies']['cacheRequests']},'cacheOnly':{'cookiePreserved':True,'historyPreserved':True,'requestsAfterRealFetch':c['final']['cacheRequests']},'noSelectionDisablesClear':c['noneDisabled'],'visibleSuccessMessages':c['cacheToasts'],'copiedUrl':t['copiedUrl'],'pageZoom':[t['beforeZoom']['state']['zoom'],t['zoomed']['state']['zoom'],t['resetZoom']['zoom']],'devToolsTreeItems':t['devToolsFrontend']['treeItems'],'devToolsContainsOwnedMarker':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':c['errors'],'cleanup':cleanup}
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
