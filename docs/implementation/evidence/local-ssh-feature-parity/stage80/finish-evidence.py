import json,hashlib,gzip,shutil,stat,sqlite3
from pathlib import Path
scratch=Path('/workspace/scratch/parity-80');root=Path('/workspace/superset');dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage80'
manifest=json.loads((scratch/'product-snapshot.json').read_text());dist=root/'apps/desktop/dist'
assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in manifest['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
(scratch/'post-native-integrity.json').write_text(json.dumps({'sourceCommit':manifest['sourceCommit'],'filesMatched':len(manifest['files']),'cliSha256':cli},indent=2)+'\n')
summary={'source':manifest['sourceCommit'],'browser':{},'clipboard':{},'wheel':{},'databaseMetadata':[]}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-ca791';cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 d=json.loads((case/'app/browser-preferences-ui.json').read_text());assert d['errors']==[]
 summary['browser'][kind]={'homepage':d['homepage']['url'],'split':d['split']['url'],'port':d['port']['url'],'saved':d['saved'],'pidBefore':d['beforeTerminal']['pid'],'pidAfter':d['retained']['pid'],'executionBefore':d['beforeTerminal']['executionId'],'executionAfter':d['retained']['executionId'],'cwdPreserved':d['beforeTerminal']['cwd']==d['retained']['cwd'],'errors':d['errors'],'cleanup':cleanup}
 dbs=list((case/'config').rglob('browser-preferences.db'));assert len(dbs)==1
 db=dbs[0];mode=stat.S_IMODE(db.stat().st_mode);assert mode==0o600
 with sqlite3.connect(f'file:{db}?mode=ro',uri=True) as con:
  tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")];assert tables==['workstation_browser_preferences']
  row=con.execute('SELECT schemaVersion,revision FROM workstation_browser_preferences WHERE id=1').fetchone();assert row==(1,3)
 summary['databaseMetadata'].append({'case':kind,'fileMode':oct(mode),'tables':tables,'schemaVersion':row[0],'revision':row[1]})
for suite,key in [('terminal-regression-final','clipboard'),('wheel-modes-final','wheel')]:
 base=scratch/suite;results=json.loads((base/'native-results.json').read_text());assert len(results)==2 and all(r['exitCode']==0 for r in results)
 cleanup=json.loads((base/'native-cleanup.json').read_text());assert cleanup['ownedXorgExit']==0
 for kind in ['local','ssh']:
  case=base/f'verified-{kind}'
  if key=='clipboard':
   d=json.loads((case/'terminal-agent-clipboard-ui.json').read_text());a=json.loads((case/'workstation-clipboard-ui.json').read_text());assert d['errors']==[] and a['textExact'] and a['fileExact']
   summary[key][kind]={'vendorAgentVerified':d['vendorAgentVerified'],'errors':d['errors'],'textExact':a['textExact'],'fileExact':a['fileExact'],'fileBytes':a['fileBytes'],'cleanup':cleanup}
  else:
   d=json.loads((case/'wheel-acceptance.json').read_text());assert d['errors']==[]
   summary[key][kind]={'errors':d['errors'],'transitions':json.loads((case/'wheel-mode-transitions.json').read_text()),'cleanup':cleanup}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert not dest.exists();dest.mkdir(parents=True)
def copyfile(source,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 if source.suffix=='.log' or source.name.endswith('-log.txt'):
  target=target.with_name(target.name+'.gz');target.write_bytes(gzip.compress(source.read_bytes(),mtime=0))
 else:shutil.copyfile(source,target)
for p in scratch.iterdir():
 if p.is_file() and p.suffix in ['.log','.json','.py','.mjs','.txt']:copyfile(p,dest/p.name)
for name in ['baseline-048155','verified-local-dad926','verified-local-input-dad926','verified-ssh-dad926','verified-local-ca791','verified-ssh-ca791']:
 case=scratch/name
 for p in case.iterdir():
  if p.is_file() and p.suffix in ['.log','.json']:copyfile(p,dest/name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.log','.txt','.json','.png']:copyfile(p,dest/name/'app'/p.name)
for suite in ['terminal-regression-final','wheel-modes-final']:
 base=scratch/suite
 for p in base.iterdir():
  if p.is_file() and p.suffix in ['.log','.json']:copyfile(p,dest/suite/p.name)
 for name in ['verified-local','verified-ssh']:
  for p in (base/name).iterdir():
   if p.is_file() and p.suffix in ['.log','.txt','.json','.png']:copyfile(p,dest/suite/name/p.name)
print(json.dumps({'source':manifest['sourceCommit'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'manifestSha256':hashlib.sha256((scratch/'product-snapshot.json').read_bytes()).hexdigest()},indent=2))
