from pathlib import Path
import hashlib,json,subprocess,re
root=Path('/workspace/superset');out=Path('/workspace/scratch/parity-117');dist=root/'apps/desktop/dist';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
files=[{'path':str(p.relative_to(dist)),'sha256':sha(p)} for directory in ['main','preload','renderer'] for p in sorted((dist/directory).rglob('*')) if p.is_file()];product={'sourceCommit':source,'files':files};(out/'product-snapshot.json').write_text(json.dumps(product,indent=2)+'\n')
old=json.load(open('/workspace/scratch/parity-116/fixture-snapshot.json'));fixtures={p:sha(root/p) for p in old};changed=[p for p,h in old.items() if fixtures[p]!=h];assert changed==['apps/desktop/scripts/verify-workstation-browser-ui.mjs'],changed
new='apps/desktop/scripts/verify-workstation-browser-open-cli-ui.mjs';fixtures[new]=sha(root/new);assert len(fixtures)==81
(out/'fixture-snapshot.json').write_text(json.dumps(fixtures,indent=2)+'\n');(out/'fixture-source.json').write_text(json.dumps({'source':source,'count':len(fixtures)},indent=2)+'\n')
cliPaths=subprocess.check_output(['git','ls-files','packages','lingui.config.ts','bun.lock'],cwd=root,text=True).splitlines();cliGraph={p:sha(root/p) for p in cliPaths if (root/p).is_file()}
(out/'source-cli-snapshot.json').write_text(json.dumps(cliGraph,indent=2)+'\n')
assert sha(dist/'resources/bin/superset')=='f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb'
requires=re.findall(r'\brequire\(["\x27]([^"\x27]+)["\x27]\)',(dist/'preload/index.js').read_text());assert requires==['electron'],requires
proof={'source':source,'compiledFiles':len(files),'fixtureCount':len(fixtures),'manifestSha256':sha(out/'product-snapshot.json'),'preloadRequires':requires}
(out/'preload-bundle-proof.json').write_text(json.dumps(proof,indent=2)+'\n');print(proof)
