from pathlib import Path
import json,hashlib,gzip,shutil
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-82');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage82'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/'apps/desktop/scripts'/n).read_bytes()).hexdigest()==h for n,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'sweeps-{kind}-c1a0f';d=json.loads((case/'app/browser-ui.json').read_text());t=d['devices'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert t['errors']==[] and d['rendererAfterReopen']==[] and len(t['presets'])==6 and len(t['scrollSweeps'])==5 and t['scrolledFind']['hit']
 assert t['defaultGeometry']['frame']['top']>=t['defaultGeometry']['area']['top']-1 and t['pinch']['transform'] and not t['pinchReset']['transform'] and t['pinchReset']['clip']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases']['device-'+kind]={'defaultMetrics':t['default'],'rotated':t['rotated'],'presets':[{'id':r['id'],'width':r['metrics']['width'],'height':r['metrics']['height']} for r in t['presets']],'defaultGeometry':t['defaultGeometry'],'pinchOutside':t['pinchOutside'],'pinchResetClip':t['pinchReset']['clip'],'scroll':[t['beforeScroll']['scrollTop'],t['afterScroll']['scrollTop']],'scrollSweeps':[{'deltaY':r['deltaY'],'actual':r['geometry']['scrollTop'],'expected':r['expected'],'frameTop':r['geometry']['frame']['top'],'guestTop':r['geometry']['guest']['top']} for r in t['scrollSweeps']],'find':t['scrolledFind'],'returnedDesktop':t['afterSwitch'],'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':t['errors'],'cleanup':cleanup}
 case=scratch/f'tools-{kind}-c1a0f';d=json.loads((case/'app/browser-ui.json').read_text());t=d['tools'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert t['errors']==[] and d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases']['tools-'+kind]={'copiedUrl':t['copiedUrl'],'guestUrl':t['devTools']['url'],'zoom':[t['beforeZoom']['state']['zoom'],t['zoomed']['state']['zoom'],t['resetZoom']['zoom']],'viewportBefore':t['beforeZoom']['viewport'],'viewportAfter':t['zoomed']['viewport'],'frontendTreeItems':t['devToolsFrontend']['treeItems'],'frontendContainsOwnedMarker':True,'settings':t['settings'],'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':t['errors'],'cleanup':cleanup}
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
