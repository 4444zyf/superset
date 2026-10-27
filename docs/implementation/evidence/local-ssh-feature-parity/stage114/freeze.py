from pathlib import Path
import hashlib,json,subprocess,re
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-114');dist=root/'apps/desktop/dist';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
files=[{'path':str(p.relative_to(dist)),'sha256':sha(p)} for directory in ['main','preload','renderer'] for p in sorted((dist/directory).rglob('*')) if p.is_file()];product={'sourceCommit':source,'files':files};(out/'product-snapshot.json').write_text(json.dumps(product,indent=2)+'\n')
fixtures={p:sha(root/p) for p in json.load(open('/workspace/scratch/parity-108/fixture-snapshot.json'))};assert fixtures==json.load(open('/workspace/scratch/parity-108/fixture-snapshot.json'))
(out/'fixture-snapshot.json').write_text(json.dumps(fixtures,indent=2)+'\n');(out/'fixture-source.json').write_text(json.dumps({'source':source,'count':len(fixtures)},indent=2)+'\n')
assert sha(dist/'resources/bin/superset')=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
requires=re.findall(r'\brequire\(["\x27]([^"\x27]+)["\x27]\)',(dist/'preload/index.js').read_text());assert requires==['electron'],requires
proof={'source':source,'compiledFiles':len(files),'fixtureCount':len(fixtures),'manifestSha256':sha(out/'product-snapshot.json'),'preloadRequires':requires}
(out/'preload-bundle-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(proof)
s=Path('/workspace/scratch/parity-108/verify.py').read_text().replace('/workspace/scratch/parity-108','/workspace/scratch/parity-114').replace('local-cli-eval-58b108','local-cli-eval-da67b8').replace('ssh-cli-eval-58b108','ssh-cli-eval-da67b8');(out/'verify.py').write_text(s)
