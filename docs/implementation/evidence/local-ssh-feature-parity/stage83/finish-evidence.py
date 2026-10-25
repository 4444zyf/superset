from pathlib import Path
import json,hashlib,gzip,shutil,base64
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-83');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage83'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/'apps/desktop/scripts'/n).read_bytes()).hexdigest()==h for n,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-canonical';d=json.loads((case/'app/browser-ui.json').read_text());h=d['historyDialog'];t=d['tools'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert h['fixture']['recentCount']==500 and not h['fixture']['homeInRecents'] and not h['fixture']['nextInRecents'] and len(h['recents'])==500 and len(h['search'])==1 and h['search'][0]['url']==h['homeUrl'] and h['afterClear']==[] and len(h['afterRevisit'])==1 and h['afterRevisit'][0]['url']==h['nextUrl']
 assert d['historyReopened'] and any(r['url']==h['nextUrl'] for r in d['historyReopened']) and not any(r['url']==h['homeUrl'] or '/fixture-history-fill/' in r['url'] for r in d['historyReopened'])
 assert h['searchIcon']['width']==h['searchIcon']['height']==16 and d['marker'].encode() in base64.b64decode(h['searchIcon']['src'].split(',')[1])
 assert h['errors']==t['errors']==d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases'][kind]={'fixture':h['fixture'],'recentRows':len(h['recents']),'wholeTableSearch':h['search'],'historyIcon':{'width':h['searchIcon']['width'],'height':h['searchIcon']['height'],'containsOwnedMarker':True},'actualSelectedGuest':h['selected'],'afterClear':h['afterClear'],'afterRevisit':h['afterRevisit'],'afterNormalReopen':d['historyReopened'],'copiedUrl':t['copiedUrl'],'pageZoom':[t['beforeZoom']['state']['zoom'],t['zoomed']['state']['zoom'],t['resetZoom']['zoom']],'devToolsTreeItems':t['devToolsFrontend']['treeItems'],'devToolsContainsOwnedMarker':True,'settings':t['settings'],'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':h['errors'],'cleanup':cleanup}
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
