from pathlib import Path
root=Path('/workspace/superset');base=next(root.glob('apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/*/hooks/usePaneRegistry/components/BrowserPane'))
p=base/'components/BrowserPaneToolbar/BrowserPaneToolbar.tsx';s=p.read_text();Path('/workspace/scratch/parity-96/original-BrowserPaneToolbar.tsx').write_text(s)
a=s.index('\t\t\t\t<Tooltip disableHoverableContent>');b=s.index('\n\t\t\t\t</Tooltip>',a)+len('\n\t\t\t\t</Tooltip>');markup=s[a:b].replace('handleToggleDesignMode','onToggle').replace('isBlankPage','disabled').replace('designMode.phase !== "idle"','active')
markup=markup.replace('type="button"','type="button"\n aria-label={t({message: "Design"})}\n title={unavailableReason}',1).replace('{active ? (','{unavailableReason ? unavailableReason : active ? (')
v=base/'components/BrowserPaneToolbar/components/DesignModeButton';v.mkdir(parents=True);(v/'DesignModeButton.tsx').write_text('''import { Trans, useLingui } from "@lingui/react/macro";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { SquareDashedMousePointer } from "lucide-react";
export function DesignModeButton({active, disabled, onToggle, unavailableReason}: {active: boolean; disabled: boolean; onToggle(): void; unavailableReason?: string}) {
 const { t } = useLingui();
 return ('''+markup+''');
}
''');(v/'index.ts').write_text('export { DesignModeButton } from "./DesignModeButton";\n')
s=s[:a]+'''<DesignModeButton active={designMode.phase !== "idle"} disabled={isBlankPage} onToggle={handleToggleDesignMode} />'''+s[b:]
for line in ['import { Trans } from "@lingui/react/macro";\n','import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";\n','import { cn } from "@superset/ui/utils";\n','import { SquareDashedMousePointer } from "lucide-react";\n']:s=s.replace(line,'')
p.write_text('import { DesignModeButton } from "./components/DesignModeButton";\n'+s)
p=base/'BrowserPane.tsx';s=p.read_text();Path('/workspace/scratch/parity-96/original-BrowserPane.tsx').write_text(s)
start=s.index('\t\t\t{designMode.phase !== "idle" && (');end=s.index('\n\t\t\t{importSource',start);block=s[start:end];a=block.index('<div className="flex shrink-0');b=block.rindex('</div>')+len('</div>');banner=block[a:b].replace('designMode.phase','phase').replace('() => designModeStore.exit(paneId)','onExit')
v=base/'components/DesignModeBanner';v.mkdir(parents=True);(v/'DesignModeBanner.tsx').write_text('''import { Trans, useLingui } from "@lingui/react/macro";
import { SquareDashedMousePointer, XIcon } from "lucide-react";
export function DesignModeBanner({phase, onExit}: {phase: "selecting" | "confirming"; onExit(): void}) {
 const { t } = useLingui();
 return ('''+banner+''');
}
''');(v/'index.ts').write_text('export { DesignModeBanner } from "./DesignModeBanner";\n');s=s[:start]+'''{designMode.phase !== "idle" && <DesignModeBanner phase={designMode.phase} onExit={() => designModeStore.exit(paneId)} />}'''+s[end:]
# The common hook retains the original Escape, navigation and anchor bodies.
a=s.index('\t// Esc while');b=s.index('\n\tconst isBlankPage',a);effects=s[a:b];s=s[:a]+s[b:]
a=s.index('\t// Anchor the composer');b=s.index('\n\t// Offer importing',a);anchor=s[a:b];s=s[:a]+s[b:]
cleanup='''\t\t\tif (designModeStore.getState(paneId).phase !== "idle") {
\t\t\t\tdesignModeStore.exit(paneId);
\t\t\t}
''';assert cleanup in s;s=s.replace(cleanup,'',1)
s=s.replace('const designMode = useDesignModeState(paneId);','').replace('const rootRef = useRef<HTMLDivElement | null>(null);','''const rootRef = useRef<HTMLDivElement | null>(null);
 const {designMode, popoverStyle} = useDesignModePane({paneId, store: designModeStore, isLoading: state.isLoading, rootRef, placeholderRef, overlayContainer});''')
s=s.replace('useEffect, useLayoutEffect, useRef, useState','useEffect, useRef, useState').replace('GlobeIcon, SquareDashedMousePointer, XIcon','GlobeIcon').replace('designModeStore, useDesignModeState','designModeStore')
s='import { DesignModeBanner } from "./components/DesignModeBanner";\nimport { useDesignModePane } from "./hooks/useDesignModePane/useDesignModePane";\n'+s;p.write_text(s)
effects=effects.replace('designModeStore.','store.').replace('state.isLoading','isLoading').replace('[designMode.phase, paneId, overlayContainer]','[designMode.phase, paneId, overlayContainer, store]').replace('[designMode.phase, isLoading, paneId]','[designMode.phase, isLoading, paneId, store]')
v=base/'hooks/useDesignModePane';v.mkdir(parents=True);(v/'useDesignModePane.ts').write_text('''import { useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { useDesignModeStateCore, type DesignModeStoreCore } from "../../designModeStoreCore";
export function useDesignModePane({paneId, store, isLoading, rootRef, placeholderRef, overlayContainer}: {
 paneId: string; store: DesignModeStoreCore; isLoading: boolean;
 rootRef: RefObject<HTMLElement | null>; placeholderRef: RefObject<HTMLElement | null>; overlayContainer: HTMLElement | null;
}) {
 const designMode = useDesignModeStateCore(paneId, store);
 useEffect(() => () => {if (store.getState(paneId).phase !== "idle") store.exit(paneId);}, [paneId, store]);
'''+effects+'\n'+anchor+'\n return {designMode, popoverStyle};\n}\n')
