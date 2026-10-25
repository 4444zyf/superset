from pathlib import Path
base=Path('/workspace/superset/apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/BrowserOverflowMenu')
p=base/'BrowserOverflowMenu.tsx';s=p.read_text();start=s.index('\t\t\t<DropdownMenu open=');end=s.index('</DropdownMenu>',start)+len('</DropdownMenu>');jsx=s[start:end]
callbacks=['onOpenFindBar','handlePrint','handleOpenDevTools','onToggleDeviceToolbar','handleScreenshot','handleHardReload','handleCopyUrl','handleOpenExternal','handleOpenSettings']
for cb in callbacks:
 needle=f'<DropdownMenuItem onClick={{{cb}}}'
 # device callback is split over lines
 if needle not in jsx:needle=f'<DropdownMenuItem\n\t\t\t\t\t\tonClick={{{cb}}}'
 a=jsx.index(needle);b=jsx.index('</DropdownMenuItem>',a)+len('</DropdownMenuItem>')
 jsx=jsx[:a]+'{'+cb+' && ('+jsx[a:b]+')}'+jsx[b:]
for name,state in [('Import','setIsImportOpen'),('Downloads','setIsDownloadsOpen'),('Screenshots','setIsScreenshotsOpen'),('History','setIsHistoryOpen'),('ClearData','setIsClearDataOpen')]:
 cb='on'+name;a=jsx.index(f'<DropdownMenuItem onSelect={{openAfterClose({state})}}');b=jsx.index('</DropdownMenuItem>',a)+len('</DropdownMenuItem>')
 block=jsx[a:b].replace(f'openAfterClose({state})',cb);jsx=jsx[:a]+'{'+cb+' && ('+block+')}'+jsx[b:]
jsx=jsx.replace('<SignedInSitesSubmenu />','{signedInSites}')
# The zoom row is optional as one complete group.
a=jsx.index('\t\t\t\t\t{/* A plain row');b=jsx.index('</DropdownMenuItem>',a)+len('</DropdownMenuItem>')
jsx=jsx[:a]+'{handleZoomOut && handleZoomIn && handleZoomReset && ('+jsx[a:b]+')}'+jsx[b:]
# Keep separators at the same boundaries when every original action is supplied.
checks=['handleZoomOut && handleZoomIn && handleZoomReset','onToggleDeviceToolbar || handleScreenshot','(onToggleDeviceToolbar || handleScreenshot) && (handleHardReload || handleCopyUrl || handleOpenExternal)','onImport || signedInSites || onDownloads || onScreenshots || onHistory || onClearData','handleOpenSettings']
for check in checks:jsx=jsx.replace('<DropdownMenuSeparator />','{('+check+') && <DropdownMenuSeparator />}',1)
# Replacement loop above would repeatedly replace the first separator; rebuild its five slots explicitly.
import re
jsx=re.sub(r'\{\([^\n]*\) && (\{\([^\n]*\) && )*<DropdownMenuSeparator />\}*','<DropdownMenuSeparator />',jsx)
parts=jsx.split('<DropdownMenuSeparator />');assert len(parts)==6,len(parts)
jsx=parts[0]+''.join('{('+check+') && <DropdownMenuSeparator /> }'+part for check,part in zip(checks,parts[1:]))
jsx=jsx.replace('type="button"\n\t\t\t\t\t\tclassName=', 'type="button"\n\t\t\t\t\t\taria-label={t({message:"More options"})}\n\t\t\t\t\t\tclassName=',1)
# Preserve the original menu pointer passthrough effect, now next to its cloud-free view.
effectStart=s.index('\tuseEffect(() => {');effectEnd=s.index('\n\n\tconst handleOpenDevTools',effectStart);effect=s[effectStart:effectEnd]
head='''import { Trans, useLingui } from "@lingui/react/macro";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@superset/ui/dropdown-menu";
import { CheckIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { TbDots } from "react-icons/tb";
import { pointerPassthrough } from "renderer/lib/pointer-passthrough";
import { BROWSER_ZOOM } from "../../../../browserRuntimeRegistryCore";

export interface BrowserOverflowMenuViewProps {
 paneId: string;
 isMenuOpen: boolean;
 setIsMenuOpen(open: boolean): void;
 hasPage: boolean;
 zoomFactor: number;
 isDeviceToolbarOpen?: boolean;
 signedInSites?: ReactNode;
'''
allcb=callbacks+['handleZoomOut','handleZoomIn','handleZoomReset','onImport','onDownloads','onScreenshots','onHistory','onClearData']
head+=''.join(' '+cb+'?(): void;\n' for cb in allcb)+'}\n'
head+='export function BrowserOverflowMenuView({paneId,isMenuOpen,setIsMenuOpen,hasPage,zoomFactor,isDeviceToolbarOpen=false,signedInSites,'+','.join(allcb)+'}: BrowserOverflowMenuViewProps) {\n const {t}=useLingui();\n'+effect+'\n return ('
view=base/'components/BrowserOverflowMenuView';view.mkdir(parents=True,exist_ok=False)
(view/'BrowserOverflowMenuView.tsx').write_text(head+jsx+');\n}\n');(view/'index.ts').write_text('export {BrowserOverflowMenuView, type BrowserOverflowMenuViewProps} from "./BrowserOverflowMenuView";\n')
props=['paneId','isMenuOpen','setIsMenuOpen','hasPage','zoomFactor','isDeviceToolbarOpen']+callbacks+['handleZoomOut','handleZoomIn','handleZoomReset']
replacement='<BrowserOverflowMenuView\n'+''.join(f' {key}={{{key}}}\n' for key in props)+''.join(f' on{name}={{openAfterClose({state})}}\n' for name,state in [('Import','setIsImportOpen'),('Downloads','setIsDownloadsOpen'),('Screenshots','setIsScreenshotsOpen'),('History','setIsHistoryOpen'),('ClearData','setIsClearDataOpen')])+' signedInSites={<SignedInSitesSubmenu />} />'
s=s[:start]+replacement+s[end:];s=s.replace(effect,'');s=s.replace('import { Trans, useLingui }','import { useLingui }')
a=s.index('import {\n\tDropdownMenu,');b=s.index(';',a)+1;s=s[:a]+s[b:]
s=s.replace('import { CheckIcon, MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";\n','').replace('import { useEffect, useState }','import { useState }').replace('import { TbDots } from "react-icons/tb";\n','').replace('import { pointerPassthrough } from "renderer/lib/pointer-passthrough";\n','')
s=s.replace('import {\n\tBROWSER_ZOOM,\n\tbrowserRuntimeRegistry,\n}', 'import {browserRuntimeRegistry}')
s='import {BrowserOverflowMenuView} from "./components/BrowserOverflowMenuView";\n'+s;p.write_text(s)
