from pathlib import Path
import gzip,hashlib,json,re,shutil
root=Path('/workspace/superset');scratch=Path('/workspace/scratch/parity-114');out=root/'docs/implementation/evidence/local-ssh-feature-parity/stage114';out.mkdir(parents=True,exist_ok=True)
def copy(p,d):
 d.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix in ['.log','.txt','.ndjson']:
  d=d.with_name(d.name+'.gz');d.write_bytes(gzip.compress(p.read_bytes(),mtime=0))
 else:shutil.copyfile(p,d)
for p in scratch.iterdir():
 if p.is_file() and p.name!='NEXT.txt' and p.suffix in ['.json','.log','.mjs','.py']:copy(p,out/p.name)
for name in ['local-cli-eval-fd01cb','local-cli-eval-da67b8','ssh-cli-eval-da67b8']:
 case=scratch/name
 for p in [case/'owned-cleanup.json',case/'native.log']:copy(p,out/name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.png','.txt','.ndjson']:copy(p,out/name/'app'/p.name)
scope={'sourceCommit':'da67b81551f8a03cb6a363e0311c0b5211f9ee61','mainPreloadCommit':'fd01cbd638e13ba0d6657f96e221d15b3eba7458','mainPreloadBound':True,'rendererOpenHandler':False,'openFeatureRestored':False,'firstNativeFailure':'fd01 sandbox preload imported schema module and required unavailable zod; failure retained','fix':'da67 keeps preload channel strings in a runtime-dependency-free module; compiled preload requires electron only','regression':{'tests':79,'assertions':332,'files':7},'native':'Original browser/API/CLI regression only, not browser-open acceptance','screenshotsViewed':['local-cli-eval-fd01cb/app/failure.png','local-cli-eval-da67b8/app/browser-evaluation-cli-background-terminal.png','ssh-cli-eval-da67b8/app/browser-evaluation-cli-background-terminal.png','ssh-cli-eval-da67b8/app/browser-reopened.png'],'notCovered':['physical macOS','external SSH target','actual vendor agent TUI','browser open renderer']}
(out/'scope.json').write_text(json.dumps(scope,indent=2)+'\n')
for p in out.rglob('*'):
 if not p.is_file() or p.suffix=='.png':continue
 data=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes();text=data.decode(errors='replace')
 assert not re.search(r'-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{25,}',text),p
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(out))+'\n' for p in sorted(out.rglob('*')) if p.is_file() and p.name!='SHA256SUMS'))
print({'files':sum(p.is_file() for p in out.rglob('*')),'bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file())})
