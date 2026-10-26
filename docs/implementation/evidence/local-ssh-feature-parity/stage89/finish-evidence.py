from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3,subprocess,re
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-89');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage89'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'codeFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{},'terminal':{}}
for kind in ['local','ssh']:
 case=scratch/('verified-'+kind+'-5dcb3');app=case/'app';h=json.loads((app/'browser-import-settings-ui.json').read_text());d=json.loads((app/'browser-ui.json').read_text());r=json.loads((app/'browser-import-reopened.json').read_text());t=json.loads((app/'browser-tools-ui.json').read_text());c=json.loads((case/'owned-cleanup.json').read_text())
 assert c['appExit']==c['ownedXorgExit']==0
 assert h['settings']['importButtons']==1 and h['overSettings']['titles']==['Settings','Import settings from another browser'] and h['afterParentClose']['titles']==['Import settings from another browser'] and h['afterParentClose']['selected']==h['fixture']['defaultId']
 assert h['fromMenu']=={'titles':['Import settings from another browser'],'historyCheckboxes':1}
 assert len(h['imported'])==len(r['rows'])==202 and r['sourceFilesUnchanged'] and h['sourceFilesUnchanged']
 assert h['runtimeErrors']==t['errors']==d['rendererAfterReopen']==[] and not d['cleanup']['running']
 assert all(d['terminalBefore'][k]==d['terminalAfter'][k] for k in ['id','executionId','pid','cwd'])
 for file in h['fixture']['sourceFiles']:assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest()==file['sha256']
 identity=json.loads((app/'observed-identity.json').read_text());assert identity['appPath']==str(root/'apps/desktop') and identity['rendererUrl']=='file://'+str(dist/'renderer/index.html')
 profile=Path(identity['userData']);dbpath=profile/'direct-workstation/browser-history.db'
 with sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True) as db:count=db.execute('select count(*) from browser_history where url like ?',('%'+h['fixture']['marker']+'%',)).fetchone()[0]
 assert count==202
 restore=app/'workspace-restore-ui.json';samples=len(json.loads(restore.read_text())['samples']) if restore.exists() else None
 if kind=='ssh':assert samples==20
 summary['cases'][kind]={'settingsButtonCount':1,'oneGlobalImportForm':True,'realParentClosePreservesImport':True,'importedAndPersistedRows':count,'menuUsesSameForm':True,'sourceFilesUnchanged':True,'normalReopen':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'originalPtyAndCwdPreserved':True,'priorSshRestoreSamples':samples,'settingsMenuWheel':[t['settingsMenu']['before']['scrollTop'],t['settingsMenu']['after']['scrollTop']],'realSettingsScrollSamples':h['scrolls'],'runtimeExceptions':h['runtimeErrors'],'cleanup':c}
terminal=scratch/'terminal-verified';c=json.loads((terminal/'native-cleanup.json').read_text());assert c['ownedXorgExit']==0 and len(c['results'])==4 and all(row['exitCode']==0 for row in c['results'])
for kind in ['local','ssh']:
 case=terminal/('verified-'+kind+'-wheel');a=json.loads((case/'wheel-acceptance.json').read_text());c=json.loads((case/'wheel-review-clipboard.json').read_text());sel=json.loads((case/'wheel-history-selection.json').read_text());modes=json.loads((case/'wheel-mode-transitions.json').read_text());stock=json.loads((case/'wheel-saved-stock-preference.json').read_text());assert a['errors']==[] and c['filesBefore']==c['filesAfter']==[] and sel['selection']=='FIRST SCREEN 中文' and stock['before']['received']==stock['after']['received'];assert [r['stage'] for r in modes]==['legacy','pixels'];assert a['review']['scrollTop']<a['review']['scrollHeight']-a['review']['clientHeight']
 clip=terminal/('verified-'+kind+'-clipboard');agent=json.loads((clip/'terminal-agent-clipboard-ui.json').read_text());assert agent['errors']==[] and agent['keyboardCopy'] and agent['menuCopy'] and agent['afterRemount'] and agent['vendorAgentVerified'] is False
 summary['terminal'][kind]={'historyReview':{k:v for k,v in a['review'].items() if k!='text'},'copiedSelection':sel['selection'],'reviewImagePasteCreatesNoAttachments':True,'stockPreferenceInjectsNoArrowKeys':True,'nativeMouseModes':[r['stage'] for r in modes],'keyboardAndMenuCopy':True,'bracketedPasteAndFiles':True,'osc52AfterRemount':True,'copiedText':agent['selection'],'runtimeExceptions':agent['errors'],'vendorAgentVerified':False}
(scratch/'native-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
assert not (dest/"SHA256SUMS").exists();dest.mkdir(parents=True,exist_ok=True)
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

for directory in ['terminal-regression','terminal-diagnostic','terminal-verified']:
 t=scratch/directory
 for p in t.iterdir():
  if p.is_file() and p.suffix in ['.log','.json']:retain(p,dest/directory/p.name)
 for case in sorted(t.glob('verified-*')):
  if not case.is_dir():continue
  for p in case.iterdir():
   if p.is_file() and p.suffix in ['.json','.txt','.log','.png']:retain(p,dest/directory/case.name/p.name)

for p in dest.rglob('*'):
 if not p.is_file():continue
 data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes()
 assert not re.search(rb'-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END',data),p
manifest=''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(dest))+'\n' for p in sorted(dest.rglob('*')) if p.is_file());(dest/'SHA256SUMS').write_text(manifest)
print(json.dumps({'source':summary['source'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases']),'terminal':list(summary['terminal'])},indent=2))
