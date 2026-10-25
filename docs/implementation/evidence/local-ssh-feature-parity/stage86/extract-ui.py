from pathlib import Path
r=Path('/workspace/superset'); browser=r/'apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane';d=browser/'components/ScreenshotsDialog';old=(d/'ScreenshotsDialog.tsx').read_text();v=d/'components/ScreenshotsDialogView';v.mkdir(parents=True,exist_ok=True)
s=old.replace('from "@superset/local-db"','from "@superset/local-db/screenshots"').replace('useEffect, useState','useEffect, useRef, useState');s=s.replace('import { useCopyToClipboard } from "renderer/hooks/useCopyToClipboard";\n','').replace('import { electronTrpcClient } from "renderer/lib/trpc-client";\n','');s=s.replace('interface ScreenshotsDialogProps {','''export type ScreenshotRow=Pick<SelectScreenshot,"id"|"filename"|"savePath"|"width"|"height"|"thumbnail"|"capturedAt">;
export interface ScreenshotsSource{
 subscribe(onData:(rows:ScreenshotRow[])=>void,onError:()=>void):()=>void;
 open(id:string):Promise<{success:boolean}>;
 showInFolder(id:string):Promise<{success:boolean}>;
 clear():Promise<{success:boolean}>;
 copyPath(savePath:string):Promise<void>;
}
interface ScreenshotsDialogProps {
 source:ScreenshotsSource;''').replace('export function ScreenshotsDialog({\n','export function ScreenshotsDialogView({\n source,\n',1).replace('useState<SelectScreenshot[]>','useState<ScreenshotRow[]>')
start=s.index('\tconst { copyToClipboard }');end=s.index('\n\tconst handleCopyPath',start)
s=s[:start]+'''
 const [failed,setFailed]=useState(false),revision=useRef(0);
 useEffect(()=>{
 if(!open)return;
 let active=true;const current=++revision.current;setFailed(false);
 const stop=source.subscribe(rows=>{if(active&&revision.current===current){setRows(rows);setFailed(false);}},()=>{if(active&&revision.current===current)setFailed(true);});
 return ()=>{active=false;revision.current++;stop();};
 },[open,source]);
 const run=(operation:Promise<{success:boolean}>)=>{setFailed(false);const current=revision.current;void operation.then(result=>{if(current===revision.current&&!result.success)setFailed(true);},()=>{if(current===revision.current)setFailed(true);});};
 const handleOpen=(id:string)=>run(source.open(id));
 const handleShowInFolder=(id:string)=>run(source.showInFolder(id));
'''+s[end:];s=s.replace('copyToClipboard(savePath)','source.copyPath(savePath)');s=s.replace('const handleCopyPath = (savePath: string) => {','const handleCopyPath = (savePath: string) => {\nconst current=revision.current;');s=s.replace('.then(() => {\n\t\t\t\ttoast.success(','.then(() => {\nif(current!==revision.current)return;\n\t\t\t\ttoast.success(',1).replace('.catch(() => {\n\t\t\t\ttoast.error(','.catch(() => {\nif(current!==revision.current)return;\n\t\t\t\ttoast.error(',1);s=s.replace('electronTrpcClient.screenshots.clear.mutate().catch(() => {});','run(source.clear());')
s=s.replace('\t\t\t\t<ScrollArea','{failed&&<output role="alert" className="text-sm text-destructive"><Trans>An error occurred</Trans></output>}\n\t\t\t\t<ScrollArea',1).replace('rows.length === 0 ? (\n\t\t\t\t\t\t<p','rows.length === 0 ? (failed?null:(\n\t\t\t\t\t\t<p',1).replace('\t\t\t\t\t\t</p>\n\t\t\t\t\t) :','\t\t\t\t\t\t</p>)\n\t\t\t\t\t) :',1)
(v/'ScreenshotsDialogView.tsx').write_text(s);(v/'index.ts').write_text('export * from "./ScreenshotsDialogView";\n')
(d/'ScreenshotsDialog.tsx').write_text('''import {useMemo} from "react";
import {useCopyToClipboard} from "renderer/hooks/useCopyToClipboard";
import {electronTrpcClient} from "renderer/lib/trpc-client";
import {ScreenshotsDialogView,type ScreenshotsSource} from "./components/ScreenshotsDialogView";
export function ScreenshotsDialog(props:{open:boolean;onOpenChange(open:boolean):void}){
 const {copyToClipboard}=useCopyToClipboard();
 const source=useMemo<ScreenshotsSource>(()=>({
 subscribe:(onData,onError)=>{const sub=electronTrpcClient.screenshots.onChanged.subscribe(undefined,{onData,onError});return ()=>sub.unsubscribe();},
 open:id=>electronTrpcClient.screenshots.openFile.mutate({id}),showInFolder:id=>electronTrpcClient.screenshots.showInFolder.mutate({id}),clear:()=>electronTrpcClient.screenshots.clear.mutate(),copyPath:copyToClipboard,
 }),[copyToClipboard]);
 return <ScreenshotsDialogView {...props} source={source}/>;
}
''')
p=browser/'components/BrowserOverflowMenu/BrowserOverflowMenu.tsx';s=p.read_text();start=s.index('\t\t\t\ttoast.success(',s.index('const handleScreenshot'));end=s.index('\n\t\t\t})\n\t\t\t.catch',start);success=s[start:end].replace('onClick: openAfterClose(setIsScreenshotsOpen)','onClick: onViewAll');success=success.replace('''							// Same Radix dismissable-layer race as the menu items below:
							// opening the Dialog synchronously from this click lets Radix's
							// newly-mounted outside-click detector see the tail of that same
							// click and immediately close it.
''','');start2=s.index('\t\t\t\ttoast.error(',end);end2=s.index('\n\t\t\t});',start2);error=s[start2:end2]
h=browser/'hooks/useScreenshotToast';h.mkdir(parents=True,exist_ok=True);(h/'useScreenshotToast.tsx').write_text('''import {useLingui} from "@lingui/react/macro";
import {toast} from "@superset/ui/sonner";
export function useScreenshotToast(onViewAll:()=>void){
 const {t}=useLingui();
 return {success:(base64:string)=>{
'''+success+'''
 },error:()=>{
'''+error+'''
 }};
}
''');start=s.index('\tconst handleScreenshot = ');end=s.index('\n\tconst handleHardReload',start);s=s[:start]+'''
 const screenshotToast=useScreenshotToast(openAfterClose(setIsScreenshotsOpen));
 const handleScreenshot=()=>{void electronTrpcClient.browser.screenshot.mutate({paneId}).then(({base64})=>screenshotToast.success(base64),screenshotToast.error);};
'''+s[end:];s=s.replace('import { useLingui } from "@lingui/react/macro";','import {useScreenshotToast} from "../../hooks/useScreenshotToast/useScreenshotToast";').replace('import { toast } from "@superset/ui/sonner";\n','').replace('\tconst { t } = useLingui();\n','');p.write_text(s)
b=r/'apps/desktop/src/renderer/workstation/Workstation/components/WorkspaceWindow/components/WorkspaceBrowserPane';u=b/'utils/browser-snapshot';u.mkdir(parents=True,exist_ok=True);(u/'browser-snapshot.ts').write_text('''export function subscribeBrowserSnapshot<TRow>(api:{getSnapshot():Promise<{revision:number;rows:TRow[]}>;onChanged(listener:(snapshot:{revision:number;rows:TRow[]})=>void):()=>void},onData:(rows:TRow[])=>void,onError:()=>void):()=>void{
 let active=true,revision=-1;
 const accept=(snapshot:{revision:number;rows:TRow[]})=>{if(!active||snapshot.revision<revision)return;revision=snapshot.revision;onData(snapshot.rows);};
 const stop=api.onChanged(accept);
 void api.getSnapshot().then(accept,()=>{if(active&&revision<0)onError();});
 return ()=>{active=false;stop();};
}
''');p=b/'utils/downloads-source/downloads-source.ts';s=p.read_text().replace('\n\tWorkstationDownloadsSnapshot,','');start=s.index('\t\tsubscribe(onData, onError) {');end=s.index('\n\t\tcancel:',start);s=s[:start]+'\t\tsubscribe:(onData,onError)=>subscribeBrowserSnapshot(api,onData,onError),'+s[end:];s='import {subscribeBrowserSnapshot} from "../browser-snapshot/browser-snapshot";\n'+s;p.write_text(s)
u=b/'utils/screenshots-source';u.mkdir(parents=True,exist_ok=True);(u/'screenshots-source.ts').write_text('''import type {ScreenshotsSource} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/ScreenshotsDialog/components/ScreenshotsDialogView";
import type {WorkstationScreenshotsApi} from "shared/workstation-browser";
import {subscribeBrowserSnapshot} from "../browser-snapshot/browser-snapshot";
export function screenshotsSource(api:WorkstationScreenshotsApi,copyText:(text:string)=>Promise<void>):ScreenshotsSource{
 return {subscribe:(onData,onError)=>subscribeBrowserSnapshot(api,onData,onError),open:id=>api.open({id}),showInFolder:id=>api.showInFolder({id}),clear:()=>api.clear(),copyPath:copyText};
}
''')
p=b/'WorkspaceBrowserPane.tsx';s=p.read_text();s='''import {ScreenshotsDialogView} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/components/ScreenshotsDialog/components/ScreenshotsDialogView";
import {useScreenshotToast} from "renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/hooks/useScreenshotToast/useScreenshotToast";
import {screenshotsSource} from "./utils/screenshots-source/screenshots-source";
'''+s;s=s.replace('const [downloadsPane, setDownloadsPane]', 'const [screenshotsPane,setScreenshotsPane]=useState<string|null>(null);\nconst [downloadsPane, setDownloadsPane]',1);point='\n\tconst [displayIcon,';s=s.replace(point,'''
 const screenshotToast=useScreenshotToast(()=>openBrowserDialog(()=>setScreenshotsPane(id)));
 const captureScreenshot=()=>{
 const registration=runtime.registration(id);if(!registration||!api.browser?.captureScreenshot)return;
 void api.browser.captureScreenshot({pane:registration}).then(result=>{if(runtime.registration(id)?.registrationId!==registration.registrationId)return;if(result.status==="saved")screenshotToast.success(result.base64);else screenshotToast.error();},()=>{if(runtime.registration(id)?.registrationId===registration.registrationId)screenshotToast.error();});
 };
 const screenshots=useMemo(()=>api.browser?.screenshots&&api.copyText?screenshotsSource(api.browser.screenshots,text=>api.copyText!(text)):null,[api]);
'''+point,1);point='\n\t\t\t\t\tonDownloads={';s=s.replace(point,'''
 handleScreenshot={api.browser?.captureScreenshot?captureScreenshot:undefined}
 onScreenshots={screenshots?()=>openBrowserDialog(()=>setScreenshotsPane(id)):undefined}
'''+point,1);point='\n\t\t\t<BrowserViewportView';s=s.replace(point,'''
 {screenshots&&<ScreenshotsDialogView key={id} source={screenshots} open={screenshotsPane===id} onOpenChange={open=>setScreenshotsPane(current=>open?id:current===id?null:current)}/>}
'''+point,1);p.write_text(s)
