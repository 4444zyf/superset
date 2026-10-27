from pathlib import Path
import gzip,hashlib,json,re,shutil
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-116');out=root/'docs/implementation/evidence/local-ssh-feature-parity/stage116';out.mkdir(parents=True,exist_ok=True)
report=json.load(open(scratch/'final-verification.json'));assert len(report['native'])==2
for case in report['native']:assert case['browserOpenApi']['reopened']['noReplayOrRecreation']
def copy(p,d):
 d.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix in ['.log','.txt','.ndjson']:d.with_name(d.name+'.gz').write_bytes(gzip.compress(p.read_bytes(),mtime=0))
 else:shutil.copyfile(p,d)
for p in scratch.iterdir():
 if p.is_file() and p.name!='NEXT.txt' and p.suffix in ['.json','.log','.mjs','.py']:copy(p,out/p.name)
for name in ['local-cli-open-314a6a','local-cli-open-314a6a-f1','local-cli-open-314a6a-f2','local-cli-open-314a6a-f3','ssh-cli-open-314a6a-f3']:
 case=scratch/name
 for p in [case/'owned-cleanup.json',case/'native.log']:copy(p,out/name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.png','.txt','.ndjson']:copy(p,out/name/'app'/p.name)
scope={'sourceCommit':'314a6a30015d6aacf5b2d9b1e9921e935e8f3478','fixtureCommit':'3d74917dc74090da6104c29dcc3a7466f05064e3','feature':'Protected durable browser-open API now consumes the real renderer and original browser runtime; CLI open namespace command remains pending','tests':{'cases':142,'assertions':681,'files':17,'desktopTypesExit':0},'native':{'cases':2,'newOpenCalls':28,'originalBrowserCalls':130,'totalCalls':158,'sshRestores':20,'projectlessWorkspaceSetup':'Original existing durable workspaces.createSession API, zero terminal creation; browser opens use actual protected backend RPC','newOpenStatusesEach':[200,200,409,404,400,400,200,200,200,200,200,200,200,200],'verified':['background selection and terminal focus','projectless browser-only workspace','default/explicit equivalent dedupe','intent conflict and invalid input rejection','new-tab and unpinned current-tab replacement','explicit show','actual owned HTTP navigation including SSH forwarding','original terminal execution/cwd/clipboard preserved','normal reopen receipts with no recreation even for closed browser pane']},'fixtureFailuresRetained':[{'case':'local-cli-open-314a6a','fixtureCommit':'314a6a300','cause':'Local setup scope.w does not contain tabId; return tab must come from the actual V2 workspace view.'},{'case':'local-cli-open-314a6a-f1','fixtureCommit':'da67b2467','cause':'Original Close tab button has pointer-events:none before real hover; add mouseMoved then read-only visibility/hit checks and exactly one click.'},{'case':'local-cli-open-314a6a-f2','fixtureCommit':'331eb4274','cause':'Legacy popup cleanup asserts one global guest; move only the new multi-workspace case after that assertion, retaining every old action/assertion/deadline.'}],'sameCompiledProductForAllRuns':True,'runtimeSourceUnchangedAfterBuild':True,'compiledFiles':2205,'fixtureCount':80,'productManifestSha256':'d2b6cbb17d2835fb42d6d002c02209b24d65605ff934581550a79c71cd9fcca8','bundledCliRebuilt':False,'noActions':True,'screenshotsViewed':['local-cli-open-314a6a/app/failure.png','local-cli-open-314a6a-f1/app/failure.png','local-cli-open-314a6a-f2/app/failure.png']+[case+'/app/'+name for case in ['local-cli-open-314a6a-f3','ssh-cli-open-314a6a-f3'] for name in ['browser-open-background-terminal.png','browser-open-explicit-show.png','browser-open-http-background-terminal.png']]+['ssh-cli-open-314a6a-f3/app/browser-reopened.png'],'limitations':['Native pin UI and restart pin persistence not restored by this stage; actual store pins covered in unit tests','Cross-connection background scope covered by unit tests; native cases open another workspace on the same owned connection','Physical macOS, external SSH, actual vendor agents and browser open namespace CLI not tested in this stage']}
(out/'scope.json').write_text(json.dumps(scope,indent=2)+'\n')
for p in out.rglob('*'):
 if not p.is_file() or p.suffix=='.png':continue
 data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes()
 assert not re.search(rb'-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{25,}',data),p
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(out))+'\n' for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'))
print({'files':sum(p.is_file() for p in out.rglob('*')),'bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file())})
