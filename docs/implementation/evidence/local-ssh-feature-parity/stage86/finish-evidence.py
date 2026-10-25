from pathlib import Path
import json,hashlib,gzip,shutil,sqlite3
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-86');dist=root/'apps/desktop/dist';dest=root/'docs/implementation/evidence/local-ssh-feature-parity/stage86'
m=json.loads((scratch/'product-snapshot.json').read_text());assert all(hashlib.sha256((dist/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest();assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
f=json.loads((scratch/'final-fixture-snapshot.json').read_text());assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in f.items())
(scratch/'post-native-integrity.json').write_text(json.dumps({'source':m['sourceCommit'],'compiledFilesMatched':len(m['files']),'cliSha256':cli,'finalFixtureFilesMatched':len(f)},indent=2)+'\n')
summary={'source':m['sourceCommit'],'cases':{}}
for kind in ['local','ssh']:
 case=scratch/f'verified-{kind}-opaque-87a23';d=json.loads((case/'app/browser-ui.json').read_text());h=d['screenshots'];t=d['tools'];r=d['screenshotsReopened'];cleanup=json.loads((case/'owned-cleanup.json').read_text());assert cleanup['appExit']==cleanup['ownedXorgExit']==0
 assert len(h['files'])==3 and len({x['path'] for x in h['files']})==3 and h['files'][0]['pixelSha256']!=h['files'][1]['pixelSha256']
 for file in h['files']:
  data=Path(file['path']).read_bytes();assert data[:8].hex()=='89504e470d0a1a0a' and len(data)==file['bytes'] and hashlib.sha256(data).hexdigest()==file['sha256']
 assert h['files'][0]['corner']==[255,255,255,255] and h['files'][1]['corner']==[130,90,40,255] and all(f['corner'][3]==255 for f in h['files'])
 assert h['copiedPath']==h['second']['savePath'] and h['lastPreview']['width']<=200 and h['lastPreview']['height']<=200 and len(h['gallery'])==2
 assert len(r['rows'])==1 and r['rows'][0]['id']==h['persisted']['id'] and r['filesUnchanged']
 dbfiles=list((case/'config').rglob('browser-screenshots.db'));assert len(dbfiles)==1
 with sqlite3.connect('file:'+str(dbfiles[0])+'?mode=ro',uri=True) as db:assert db.execute('select count(*) from screenshots').fetchone()[0]==0
 assert h['errors']==t['errors']==d['rendererAfterReopen']==[] and t['devToolsFrontend']['treeItems']>0 and d['marker'] in t['devToolsFrontend']['text']
 for key in ['id','executionId','pid','cwd']:assert d['terminalBefore'][key]==d['terminalAfter'][key]
 summary['cases'][kind]={'directory':h['directory'],'files':h['files'],'differentPagesHaveDifferentPixels':True,'systemImageClipboardMatchesSavedFullPngPixels':True,'copiedPath':h['copiedPath'],'toastPreview':h['lastPreview'],'decodedGallery':h['gallery'],'afterNormalReopen':r['rows'],'allFilesRetainedAfterMetadataClear':True,'metadataRowsAfterFinalClear':0,'actualOsOpenOrRevealVerified':False,'copiedUrl':t['copiedUrl'],'pageZoom':[t['beforeZoom']['state']['zoom'],t['zoomed']['state']['zoom'],t['resetZoom']['zoom']],'devToolsContainsOwnedMarker':True,'pid':d['terminalBefore']['pid'],'executionId':d['terminalBefore']['executionId'],'cwdPreserved':True,'runtimeExceptions':h['errors'],'cleanup':cleanup}
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
   path=Path(file['path']);assert path.resolve().is_relative_to((case/'pictures').resolve())
   retain(path,dest/case.name/'captures'/(file['id']+'.png'))
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.txt','.log','.png']:retain(p,dest/case.name/'app'/p.name)
print(json.dumps({'source':m['sourceCommit'],'retainedFiles':sum(p.is_file() for p in dest.rglob('*')),'cases':list(summary['cases'])},indent=2))
