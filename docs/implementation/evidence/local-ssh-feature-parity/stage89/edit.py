from pathlib import Path
r=Path('/workspace/superset');base=r/'apps/desktop/src/renderer';settings=base/'routes/_authenticated/settings/browser/components/BrowserSettings';p=settings/'BrowserSettings.tsx';s=p.read_text();start=s.index('\t\t\t\t{showImportHistory && (');end=s.index('\n\t\t\t\t{[SETTING_ITEM_ID.LINKS_URL',start);row=s[start:end];inner=row[row.index('<div className='):row.rindex('\n\t\t\t\t)}')];inner=inner.replace('onClick={() => setIsImportOpen(true)}','onClick={onImport}').replace('another Chromium browser into Superset.','another Chromium browser into{" "}\n{productName}.');newdir=settings/'components/BrowserImportSettingView';newdir.mkdir();(newdir/'BrowserImportSettingView.tsx').write_text('''import { Trans, useLingui } from "@lingui/react/macro";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import { Button } from "@superset/ui/button";
import { Label } from "@superset/ui/label";
import { TbDownload } from "react-icons/tb";
import { HighlightText } from "renderer/routes/_authenticated/settings/components/HighlightText";

export function BrowserImportSettingView({
 onImport,
 searchQuery = "",
 productName = PRODUCT_BRAND.displayName,
}: {
 onImport(): void;
 searchQuery?: string;
 productName?: string;
}) {
 const { t } = useLingui();
 return (
'''+inner+'''\n );
}
''');(newdir/'index.ts').write_text('export { BrowserImportSettingView } from "./BrowserImportSettingView";\n');s=s[:start]+'''\t\t\t\t{showImportHistory && (
 <BrowserImportSettingView searchQuery={searchQuery} onImport={() => setIsImportOpen(true)} />
 )}'''+s[end:];s=s.replace('import { Button } from "@superset/ui/button";\n','').replace('import { TbDownload } from "react-icons/tb";\n','');s='import { BrowserImportSettingView } from "./components/BrowserImportSettingView";\n'+s;p.write_text(s)
provider=base/'workstation/Workstation/providers/WorkstationBrowserImport';provider.mkdir();(provider/'WorkstationBrowserImport.tsx').write_text('''import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ImportHistoryDialogView } from "renderer/components/ImportHistoryDialog/components/ImportHistoryDialogView";
import type { BrowserImportApi } from "shared/browser-import";

const BrowserImportContext = createContext<(() => void) | null>(null);
export function useWorkstationBrowserImport() {
 return useContext(BrowserImportContext);
}
export function WorkstationBrowserImport({ source, children }: { source?: BrowserImportApi; children: ReactNode }) {
 const [open, setOpen] = useState(false);
 const show = useCallback(() => setOpen(true), []);
 useEffect(() => setOpen(false), [source]);
 return (
  <BrowserImportContext value={source ? show : null}>
   {children}
   {source && <ImportHistoryDialogView source={source} open={open} onOpenChange={setOpen} />}
  </BrowserImportContext>
 );
}
''');(provider/'index.ts').write_text('export { WorkstationBrowserImport, useWorkstationBrowserImport } from "./WorkstationBrowserImport";\n')
p=base/'workstation/Workstation/Workstation.tsx';s=p.read_text();s='import { WorkstationBrowserImport } from "./providers/WorkstationBrowserImport";\n'+s;s=s.replace('<WorkstationPreferencesContext value={preferences.snapshot}>','<WorkstationBrowserImport source={api.browser?.importData}>\n<WorkstationPreferencesContext value={preferences.snapshot}>').replace('</WorkstationPreferencesContext>','</WorkstationPreferencesContext>\n</WorkstationBrowserImport>');p.write_text(s)
p=base/'workstation/Workstation/components/WorkspaceWindow/components/WorkspaceBrowserPane/WorkspaceBrowserPane.tsx';s=p.read_text().replace('import { ImportHistoryDialogView } from "renderer/components/ImportHistoryDialog/components/ImportHistoryDialogView";','import { useWorkstationBrowserImport } from "../../../../providers/WorkstationBrowserImport";').replace('const [importPane, setImportPane] = useState<string | null>(null);','const openImport = useWorkstationBrowserImport();').replace('api.browser?.importData\n\t\t\t\t\t\t\t? () => openBrowserDialog(() => setImportPane(id))','openImport\n\t\t\t\t\t\t\t? () => openBrowserDialog(openImport)');start=s.index('\n\t\t\t{api.browser?.importData && (');end=s.index('\n\n\t\t\t<BrowserViewportView',start);s=s[:start]+s[end:];p.write_text(s)
p=base/'workstation/Workstation/components/WorkstationSettings/components/WorkstationBrowserSettings/WorkstationBrowserSettings.tsx';s=p.read_text();s='''import { BrowserImportSettingView } from "renderer/routes/_authenticated/settings/browser/components/BrowserSettings/components/BrowserImportSettingView";
import { useWorkstationBrowserImport } from "../../../../providers/WorkstationBrowserImport";
'''+s;s=s.replace('const { t } = useLingui();','const { t } = useLingui();\n const openImport = useWorkstationBrowserImport();');s=s.replace('\n\t\t\t\t{values && (','\n {openImport && <BrowserImportSettingView onImport={openImport} />}\n\t\t\t\t{values && (');p.write_text(s)
p=base/'workstation/Workstation/components/WorkspaceWindow/components/WorkspaceBrowserPane/WorkspaceBrowserPane.test.tsx';s=p.read_text();start=s.index('\tconst profile = {');end=s.index('\n\t\trow = {',start);s=s[:start]+'\tconst row = {'+s[end+len('\n\t\trow = {'):];start=s.index('\n\t\t\t\timportData: {');end=s.index('\n\t\t\t},\n\t\t},',start);s=s[:start]+'''
 screenshots: {
 getSnapshot: async () => ({ revision: 0, screenshots: [] }),
 onChanged: () => () => {},
 clear: async () => ({ success: true }),
 open: async () => ({ success: true }),
 showInFolder: async () => ({ success: true }),
 },'''+s[end:];s=s.replace('api: {\n\t\t\tbrowser:', 'api: {\n copyText: async () => {},\n\t\t\tbrowser:');p.write_text(s)
