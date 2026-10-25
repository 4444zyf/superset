from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3
from urllib.parse import urlsplit
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-88');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage88'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-hover-6faad';d=json.loads((case/'app/browser-ui.json').read_text());h=d['importData'];t=d['tools'];s=d['screenshots'];r=d['importReopened'];sr=d['screenshotsReopened'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0 and d['cleanup']['running']==False
 fixture=h['fixture'];assert h['capability'] and fixture['entryCount']==202 and len(h['sources']['sources'])==2 and h['sources']['needsFullDiskAccess']==False and h['controls']=={'history':'checked','cookies':'unchecked','cookiesDisabled':True}
 assert not any(fixture['marker'] in row['url'] for row in h['before']) and h['imported']==h['reimported'] and len(h['imported'])==202
 merged=next(row for row in h['imported'] if row['url']==fixture['url']);assert merged['id']==h['live']['id'] and merged['title']==h['live']['title'] and merged['lastVisitedAt']==h['beforeLiveMerge']['lastVisitedAt'] and merged['visitCount']==99
 assert h['rejected']['rejected'] and h['afterSelection']['id']==merged['id'] and h['afterSelection']['visitCount']>99 and len(r['rows'])==202
 selected=next(row for row in r['rows'] if row['url']==fixture['url']);assert selected['id']==h['afterSelection']['id'] and selected['visitCount']==h['afterSelection']['visitCount']
 assert h['sourceFilesUnchanged'] and r['sourceFilesUnchanged'] and h['domAtEnd']['dialogs']==[] and h['runtimeErrorsAtEnd']==[]
 canonical=urlsplit(fixture['url']);guest=urlsplit(h['selectedGuest']['url']);assert (canonical.scheme,canonical.path,canonical.query,canonical.fragment)==(guest.scheme,guest.path,guest.query,guest.fragment)
 if kind=='ssh':assert canonical.netloc!=guest.netloc
 assert sum(fixture['marker'] in path for path in h['sourceHttpProof']['requests'])>=2
 assert merged['faviconUrl']==h['live']['faviconUrl']
 assert s['viewAllClicks']==1 and s['viewAllReady']['front']=='true' and s['viewAllAtEnd']['dialogs']==[]
 for file in fixture['sourceFiles']:assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest()==file['sha256']
 histories=list((case/'config').rglob('browser-history.db'));assert len(histories)==1
 with sqlite3.connect('file:'+str(histories[0])+'?mode=ro',uri=True) as db:
  persisted=db.execute('select count(*) from browser_history where instr(url,?)>0',(fixture['marker'],)).fetchone()[0];assert persisted==202
 assert len(s['files'])==3 and len({x['path'] for x in s['files']})==3 and s['files'][0]['corner']==[255,255,255,255] and s['files'][1]['corner']==[130,90,40,255]
 for file in s['files']:assert hashlib.sha256(Path(file['path']).read_bytes()).hexdigest()==file['sha256']
 assert s['copiedPath']==s['second']['savePath'] and sr['rows'][0]['id']==s['persisted']['id'] and sr['filesUnchanged']
 screenshots=list((case/'config').rglob('browser-screenshots.db'));assert len(screenshots)==1
 with sqlite3.connect('file:'+str(screenshots[0])+'?mode=ro',uri=True) as db:assert db.execute('select count(*) from screenshots').fetchone()[0]==0
 assert h['errors']==s['errors']==t['errors']==d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases'][kind]={'profileCount':2,'defaultHistorySelection':True,'cookiesDisabledOnLinux':True,'sourceRowCount':202,'noAutomaticImport':True,'cancelPreservesHistory':True,'emptySourceReportsNoImport':True,'allImportedIdsAndCountersPreservedOnRepeat':True,'mergedLiveRecord':merged,'selectedImportedRecord':h['afterSelection'],'selectedGuest':h['selectedGuest'],'sourceSetupBeforeUiRead':True,'actualOwnedHttpSourceRequests':h['sourceHttpProof']['requests'],'historyRowsAfterNormalReopen':persisted,'sourceFileHashesUnchanged':True,'arbitrarySourceRejected':h['rejected'],'noOrphanDialogAfterSelection':True,'screenshotFiles':s['files'],'systemImageClipboardMatchesSavedPng':True,'viewAllClicks':s['viewAllClicks'],'viewAllReady':s['viewAllReady'],'copiedScreenshotPath':s['copiedPath'],'screenshotNormalReopenRecord':sr['rows'][0],'screenshotMetadataAfterFinalClear':0,'actualMacKeychainFullDiskAccessOrPasswordsVerified':False,'copiedUrl':t['copiedUrl'],'menuWheel':[t['settingsMenu']['before']['scrollTop'],t['settingsMenu']['after']['scrollTop']],'devToolsContainsOwnedMarker':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':h['errors'],'cleanup':cleanup}
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
 report=case/'app/browser-screenshots-ui.json'
 if report.exists():
  for file in json.loads(report.read_text()).get('files',[]):
   path=Path(file['path']);assert path.resolve().is_relative_to((case/'pictures').resolve());retain(path,dest/case.name/'captures'/(file['id']+'.png'))
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.txt','.log','.png']:retain(p,dest/case.name/'app'/p.name)
print(json.dumps({'source':m['sourceCommit'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases'])},indent=2))
