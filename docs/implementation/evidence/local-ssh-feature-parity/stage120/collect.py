from pathlib import Path
import json,gzip,shutil,hashlib,re
root=Path('/workspace/superset');src=Path('/workspace/scratch/parity-120');out=root/'docs/implementation/evidence/local-ssh-feature-parity/stage120';out.mkdir(exist_ok=False)
def copy(a,b):
 b.parent.mkdir(parents=True,exist_ok=True)
 if a.suffix in ['.log','.txt','.ndjson']:
  b=Path(str(b)+'.gz')
  with gzip.GzipFile(filename=str(b),mode='wb',mtime=0) as f:f.write(a.read_bytes())
 else:shutil.copyfile(a,b)
for p in src.iterdir():
 if p.is_file() and p.suffix in ['.log','.json','.py','.mjs']:copy(p,out/p.name)
for name in ['local-import-sources-0b7b38','ssh-import-sources-0b7b38']:
 case=src/name
 for p in case.iterdir():
  if p.is_file() and p.name in ['native.log','owned-cleanup.json','xorg.log','xorg-launch.log']:copy(p,out/name/p.name)
 for p in (case/'app').iterdir():
  if p.is_file() and p.suffix in ['.json','.png','.txt','.ndjson','.log']:copy(p,out/name/'app'/p.name)
patterns=[rb'-----BEGIN (?:OPENSSH |RSA |EC |DSA )?PRIVATE KEY-----',rb'gh[pousr]_[A-Za-z0-9_]{20,}',rb'github_pat_[A-Za-z0-9_]{20,}',rb'Bearer\s+[A-Za-z0-9._\-]{24,}',rb'(?i)(?:token|secret|password|authorization)["\x27]?\s*[:=]\s*["\x27][A-Za-z0-9+/=_\-]{24,}["\x27]']
for p in out.rglob('*'):
 if not p.is_file() or p.suffix=='.png':continue
 body=gzip.decompress(p.read_bytes()) if p.suffix=='.gz' else p.read_bytes()
 assert not any(re.search(pattern,body) for pattern in patterns),str(p)
print(json.dumps({'files':sum(p.is_file() for p in out.rglob('*')),'bytes':sum(p.stat().st_size for p in out.rglob('*') if p.is_file()),'secretPatternScanPassed':True}))
