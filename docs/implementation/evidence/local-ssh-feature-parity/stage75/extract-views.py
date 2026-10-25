from pathlib import Path
import posixpath,json,hashlib,subprocess,re,os
root=Path('/workspace/superset');base=root/'apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane'
proof={}
def original(p):return subprocess.check_output(['git','show','2be16ac12:'+str(p.relative_to(root))],text=True)
def relocate(s,old,new):
 def replace(m):
  target=posixpath.normpath(str(old.parent/m.group(1)));path=os.path.relpath(target,new.parent).replace('\\','/')
  if not path.startswith('.'):path='./'+path
  return 'from "'+path+'"'
 return re.sub(r'from "(\.[^"]+)"',replace,s)
def write(p,s):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s)
toolbar=base/'components/BrowserToolbar/BrowserToolbar.tsx';old=original(toolbar);view=toolbar.parent/'components/BrowserToolbarView/BrowserToolbarView.tsx';s=relocate(old,toolbar,view)
s=s.replace('import { browserRuntimeRegistry } from "../../../../browserRuntimeRegistry";', 'import type { BrowserRuntimeRegistryCore } from "../../../../browserRuntimeRegistryCore";')
s=s.replace('import { useUrlAutocomplete } from "../../hooks/useUrlAutocomplete";', 'import { type BrowserHistoryLoader, useUrlAutocompleteCore } from "../../hooks/useUrlAutocomplete/useUrlAutocompleteCore";')
s=s.replace('interface BrowserToolbarProps {','export interface BrowserToolbarProps {')
s=s.replace('export function BrowserToolbar({', '''interface BrowserToolbarViewProps extends BrowserToolbarProps {
	registry: Pick<BrowserRuntimeRegistryCore, "getOverlayContainer">;
	loadHistory: BrowserHistoryLoader;
}

export function BrowserToolbarView({
	registry,
	loadHistory,''')
s=s.replace('}: BrowserToolbarProps)', '}: BrowserToolbarViewProps)').replace('const autocomplete = useUrlAutocomplete({', 'const autocomplete = useUrlAutocompleteCore({\n\t\tloadHistory,').replace('browserRuntimeRegistry.getOverlayContainer', 'registry.getOverlayContainer').replace('[suggestionsOpen, paneId]', '[suggestionsOpen, paneId, registry]')
assert 'browserRuntimeRegistry.' not in s and 'BrowserRuntimeRegistryCore' in s
write(view,s);write(view.parent/'index.ts','export { BrowserToolbarView, type BrowserToolbarProps } from "./BrowserToolbarView";\n')
write(toolbar,'''import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { BrowserToolbarView, type BrowserToolbarProps } from "./components/BrowserToolbarView";
import { loadDefaultBrowserHistory } from "./hooks/useUrlAutocomplete/useUrlAutocomplete";

export function BrowserToolbar(props: BrowserToolbarProps) {
	return <BrowserToolbarView {...props} registry={browserRuntimeRegistry} loadHistory={loadDefaultBrowserHistory} />;
}
''')
proof['toolbar']={'beforeSHA256':hashlib.sha256(old.encode()).hexdigest(),'change':'Original view/layout and event handlers; registry and history loader injected. Default wrapper retains original singleton and query.'}
find=base/'components/BrowserFindBar/BrowserFindBar.tsx';old=original(find);view=find.parent/'components/BrowserFindBarView/BrowserFindBarView.tsx';s=relocate(old,find,view)
s=s.replace('import { browserRuntimeRegistry } from "../../../../browserRuntimeRegistry";', 'import type { BrowserRuntimeRegistryCore } from "../../../../browserRuntimeRegistryCore";')
s=s.replace('interface BrowserFindBarProps {','export interface BrowserFindBarProps {')
s=s.replace('/** Chrome-style find-in-page bar, floating over the page like the real thing. */', '''interface BrowserFindBarViewProps extends BrowserFindBarProps {
	registry: Pick<BrowserRuntimeRegistryCore, "onFoundInPage" | "stopFindInPage" | "findInPage">;
}

/** Chrome-style find-in-page bar, floating over the page like the real thing. */''')
s=s.replace('export function BrowserFindBar({ paneId, onClose }: BrowserFindBarProps)', 'export function BrowserFindBarView({ paneId, onClose, registry }: BrowserFindBarViewProps)').replace('browserRuntimeRegistry.', 'registry.').replace('}, [paneId]);', '}, [paneId, registry]);')
assert 'browserRuntimeRegistry.' not in s
write(view,s);write(view.parent/'index.ts','export { BrowserFindBarView, type BrowserFindBarProps } from "./BrowserFindBarView";\n')
write(find,'''import { browserRuntimeRegistry } from "../../browserRuntimeRegistry";
import { BrowserFindBarView, type BrowserFindBarProps } from "./components/BrowserFindBarView";

export function BrowserFindBar(props: BrowserFindBarProps) {
	return <BrowserFindBarView {...props} registry={browserRuntimeRegistry} />;
}
''')
proof['find']={'beforeSHA256':hashlib.sha256(old.encode()).hexdigest(),'change':'Original JSX/search/match count/keyboard behavior, injected registry; effects also track registry identity.'}
state=base/'hooks/useBrowserState/useBrowserState.ts';old=original(state);core=state.with_name('useBrowserStateCore.ts')
s=old.replace('browserRuntimeRegistry,','type BrowserRuntimeRegistryCore,').replace('from "../../browserRuntimeRegistry"', 'from "../../browserRuntimeRegistryCore"').replace('export function useBrowserState(paneId: string)', 'export function useBrowserStateCore(paneId: string, registry: Pick<BrowserRuntimeRegistryCore, "onStateChange" | "getState">)').replace('browserRuntimeRegistry.', 'registry.').replace('[paneId]', '[paneId, registry]')
write(core,s)
write(state,'''import { browserRuntimeRegistry, type BrowserRuntimeState } from "../../browserRuntimeRegistry";
import { useBrowserStateCore } from "./useBrowserStateCore";

export function useBrowserState(paneId: string): BrowserRuntimeState {
	return useBrowserStateCore(paneId, browserRuntimeRegistry);
}
''')
proof['state']={'beforeSHA256':hashlib.sha256(old.encode()).hexdigest(),'change':'Original useSyncExternalStore wiring with injected registry; default singleton remains unchanged.'}
Path('/workspace/scratch/parity-75/extraction.json').write_text(json.dumps(proof,indent=2)+'\n')
