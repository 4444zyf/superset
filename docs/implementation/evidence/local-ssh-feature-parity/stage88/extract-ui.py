from pathlib import Path
r=Path('/workspace/superset');d=r/'apps/desktop/src/renderer/components/ImportHistoryDialog';p=d/'ImportHistoryDialog.tsx';s=p.read_text();v=d/'components/ImportHistoryDialogView';v.mkdir(parents=True,exist_ok=True)
s=s.replace('useCallback, useEffect, useState','useCallback, useEffect, useRef, useState');start=s.index('import { electronTrpcClient');end=s.index('/**\n * Fallback glyph',start);s=s[:start]+'''import type {BrowserImportApi,BrowserImportProfile} from "shared/browser-import";
import {PRODUCT_BRAND} from "@superset/shared/product-brand";
'''+s[end:];s=s.replace('interface ImportHistoryDialogProps {','''export interface BrowserImportDataSource extends BrowserImportApi {onImported?():void;}
interface ImportHistoryDialogProps {
 source:BrowserImportDataSource;
 productName?:string;
 canImportLogins?:boolean;''',1).replace('sources: ImportSource[]','sources: BrowserImportProfile[]').replace('| { status: "ready"; sources: BrowserImportProfile[] };','| { status: "ready"; sources: BrowserImportProfile[] }\n| {status:"failed"};',1)
s=s.replace('export function ImportHistoryDialog({\n','export function ImportHistoryDialogView({\n source,productName=PRODUCT_BRAND.displayName,canImportLogins=isMac,\n',1).replace('useState(isMac)','useState(canImportLogins)',1)
start=s.index('\t// This dialog is opened from');end=s.index('\n\tconst handleImport',start)
s=s[:start]+'''
 const revision=useRef(0);
 const loadSources=useCallback(()=>{
 const current=++revision.current;setLoadState({status:"loading"});setSelectedId(null);
 void source.getSources().then(result=>{
 if(current!==revision.current)return;
 if(result.needsFullDiskAccess){setLoadState({status:"needs-full-disk-access"});return;}
 setLoadState({status:"ready",sources:result.sources});setSelectedId(result.sources[0]?.id??null);
 },()=>{if(current===revision.current)setLoadState({status:"failed"});});
 },[source]);
 useEffect(()=>{if(open)loadSources();return ()=>{revision.current++;};},[open,loadSources]);
 const handleOpenSettings=()=>{void source.requestFullDiskAccess().catch(()=>{if(open)setLoadState({status:"failed"});});};
'''+s[end:]
s=s.replace('if (!selectedId) return;','if (!selectedId) return;\nconst current=revision.current;',1)
s=s.replace('await electronTrpcClient.browserHistory.importFromSource.mutate({','await source.importHistory({',1);s=s.replace('await electronTrpcClient.browserHistory.importCookiesFromSource.mutate(','await source.importCookies(',1)
s=s.replace('dismissImportBanner(BROWSER_IMPORT_BANNER_ID);','source.onImported?.();')
s=s.replace('\t\t\tconst joinedMessages = messages.join(','if(importedSomething)source.onImported?.();\nif(current!==revision.current)return;\n\t\t\tconst joinedMessages = messages.join(',1)
# onImported is now notified once before active UI feedback; preserve the original partial-success catch path.
s=s.replace('\n\t\t\t\tsource.onImported?.();\n\t\t\t} else {','\n\t\t\t} else {',1)
s=s.replace('if (importedSomething) source.onImported?.();\n\t\t\ttoast.error(', 'if (importedSomething) source.onImported?.();\nif(current!==revision.current)return;\n\t\t\ttoast.error(',1)
s=s.replace('\t\t\tsetIsImporting(false);','if(current===revision.current)setIsImporting(false);',1)
s=s.replace('into\n\t\t\t\t\t\t\tSuperset.','into\n\t\t\t\t\t\t\t{productName}.',1).replace('Superset needs Full Disk Access','{productName} needs Full Disk Access',1)
s=s.replace('{isMac ? (','{canImportLogins ? (',1).replace('disabled={!isMac}','disabled={!canImportLogins}',1)
s=s.replace('\n\t\t\t\t{loadState.status === "loading"','\n{loadState.status==="failed"&&<output role="alert" className="text-sm text-destructive"><Trans>An error occurred</Trans></output>}\n\t\t\t\t{loadState.status === "loading"',1)
(v/'ImportHistoryDialogView.tsx').write_text(s);(v/'index.ts').write_text('export * from "./ImportHistoryDialogView";\n')
p.write_text('''import {useMemo} from "react";
import {electronTrpcClient} from "renderer/lib/trpc-client";
import {BROWSER_IMPORT_BANNER_ID,useBrowserImportBannerDismissalsStore} from "renderer/stores/browser-import-banner-dismissals";
import {ImportHistoryDialogView,type BrowserImportDataSource} from "./components/ImportHistoryDialogView";
export function ImportHistoryDialog(props:{open:boolean;onOpenChange(open:boolean):void}){
 const dismiss=useBrowserImportBannerDismissalsStore(s=>s.dismiss);
 const source=useMemo<BrowserImportDataSource>(()=>({getSources:()=>electronTrpcClient.browserHistory.getImportSources.query(),importHistory:input=>electronTrpcClient.browserHistory.importFromSource.mutate(input),importCookies:input=>electronTrpcClient.browserHistory.importCookiesFromSource.mutate(input),requestFullDiskAccess:()=>electronTrpcClient.permissions.requestFullDiskAccess.mutate(),onImported:()=>dismiss(BROWSER_IMPORT_BANNER_ID)}),[dismiss]);
 return <ImportHistoryDialogView {...props} source={source}/>;
}
''')
