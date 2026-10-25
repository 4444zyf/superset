import hashlib,json,subprocess,sys
from pathlib import Path
root=Path('/workspace/superset');dist=root/'apps/desktop/dist';out=Path('/workspace/scratch/parity-85')
source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
rows=[]
for folder in ['main','preload','renderer']:
 for p in sorted((dist/folder).rglob('*')):
  if p.is_file():rows.append({'path':str(p.relative_to(dist)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
assert len(rows)>2000
cli=hashlib.sha256((dist/'resources/bin/superset').read_bytes()).hexdigest()
assert cli=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
manifest=json.dumps({'sourceCommit':source,'files':rows},indent=2)+'\n'
(out/'product-snapshot.json').write_text(manifest)
summary={'source':source,'fileCount':len(rows),'manifestSha256':hashlib.sha256(manifest.encode()).hexdigest(),'cliSha256':cli}
(out/'product-snapshot-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps(summary))
