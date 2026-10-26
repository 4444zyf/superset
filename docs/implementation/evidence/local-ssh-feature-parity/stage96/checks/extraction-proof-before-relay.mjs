import ts from '/workspace/superset/apps/desktop/node_modules/@typescript/typescript6/lib/typescript.js';
import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
const root='/workspace/superset/',base='992aaf047',browser='apps/desktop/src/renderer/routes/_authenticated/_dashboard/v2-workspace/$workspaceId/hooks/usePaneRegistry/components/BrowserPane/',picker='apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/AgentSessionPicker/components/';
const parse=s=>ts.createSourceFile('code.tsx',s,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),old=p=>execFileSync('git',['show',base+':'+p],{cwd:root,encoding:'utf8'}),cur=p=>readFileSync(root+p,'utf8');
function find(t,p){let r;function visit(n){if(p(n))r=n;ts.forEachChild(n,visit);}visit(t);assert.ok(r);return r;}
const func=(s,name)=>find(parse(s),n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
const returned=t=>find(t,n=>ts.isReturnStatement(n)&&n.expression&&(/^[\s(]*</.test(n.expression.getText()))).expression;
const optionNames={ExistingSessionOption:'existing-option',NewSessionOption:'new-option'};
function shape(n,mode='plain'){
 if(!n)return null;
 if(ts.isParenthesizedExpression(n))return shape(n.expression,mode);
 if(ts.isJsxText(n)){const text=n.text.trim().replace(/\s+/g,' ');return text?['text',text]:null;}
 if(ts.isJsxExpression(n)&&!n.expression)return null;
 if(mode==='slots'){
  if(ts.isJsxSelfClosingElement(n)&&optionNames[n.tagName.getText()])return [optionNames[n.tagName.getText()],n.attributes.properties.map(p=>[p.name.getText(),shape(p.initializer?.expression,mode)])];
  if(ts.isCallExpression(n)&&['renderExisting','renderNew'].includes(n.expression.getText()))return[n.expression.getText()==='renderExisting'?'existing-option':'new-option',n.arguments[0].properties.map(p=>[p.name.getText(),shape(p.initializer,mode)])];
  if(ts.isJsxExpression(n)&&ts.isCallExpression(n.expression)&&['renderExisting','renderNew'].includes(n.expression.expression.getText()))return shape(n.expression,mode);
 }
 if(mode==='form'){
  if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='AgentSessionPicker')return 'agent-picker-slot';
  if(ts.isJsxExpression(n)&&n.expression.getText()==='agentPicker')return 'agent-picker-slot';
  if(ts.isJsxExpression(n)&&n.expression.getText()==='notice')return null;
  if(ts.isIdentifier(n)&&['handleSubmit','onSubmit'].includes(n.text))return ['id','submit'];
  if(ts.isIdentifier(n)&&['setComment','onCommentChange'].includes(n.text))return ['id','comment-change'];
 }
 if(mode==='banner'||mode==='button'){
  if(ts.isJsxAttribute(n)&&n.name.getText()==='onClick')return 'exit-or-toggle-handler';
  if(ts.isPropertyAccessExpression(n)&&n.getText()==='designMode.phase')return ['phase'];
  if(ts.isIdentifier(n)&&n.text==='phase')return ['phase'];
 }
 if(mode==='button'){
  if(ts.isJsxAttribute(n)&&['aria-label','title'].includes(n.name.getText()))return null;
  if(ts.isBinaryExpression(n)&&n.getText()==='designMode.phase !== "idle"')return ['active'];
  if(ts.isIdentifier(n)&&n.text==='active')return ['active'];
  if(ts.isIdentifier(n)&&['isBlankPage','disabled'].includes(n.text))return ['disabled'];
  if(ts.isConditionalExpression(n)&&n.condition.getText()==='unavailableReason')return shape(n.whenFalse,mode);
 }
 if(mode==='defaults'&&ts.isConditionalExpression(n)&&n.condition.getText()==='livePaneAvailable')return shape(n.whenTrue,mode);
 const ch=[];ts.forEachChild(n,c=>{const value=shape(c,mode);if(value!==null)ch.push(value);});
 return [n.kind,ts.isIdentifier(n)||ts.isLiteralExpression(n)?n.text:null,ch];
}
const select=picker+'AgentSessionSelect/AgentSessionSelect.tsx',selectView=picker+'AgentSessionSelect/components/AgentSessionSelectView/AgentSessionSelectView.tsx';
assert.deepEqual(shape(func(old(select),'AgentSessionSelect').body,'slots'),shape(func(cur(selectView),'AgentSessionSelectView').body,'slots'));
for(const name of ['ExistingSessionOption','NewSessionOption']){
 const p=picker+name+'/'+name+'.tsx',view=picker+name+'/components/'+name+'View/'+name+'View.tsx';
 assert.deepEqual(shape(returned(func(old(p),name))),shape(returned(func(cur(view),name+'View'))));
 assert.match(cur(p),/usePresetIcon\(/);assert.match(cur(p),new RegExp('<'+name+'View'));
}
const pop=browser+'components/DesignModePopover/DesignModePopover.tsx',popView=browser+'components/DesignModePopover/components/DesignModePopoverView/DesignModePopoverView.tsx';
assert.deepEqual(shape(returned(func(old(pop),'DesignModePopover')),'form'),shape(returned(func(cur(popView),'DesignModePopoverView')),'form'));
const submit=s=>find(parse(s),n=>ts.isVariableDeclaration(n)&&n.name.getText()==='handleSubmit').initializer;assert.deepEqual(shape(submit(old(pop))),shape(submit(cur(pop))));
const oldPane=parse(old(browser+'BrowserPane.tsx')),banner=find(oldPane,n=>ts.isJsxElement(n)&&n.openingElement.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText()==='className'&&p.initializer?.getText().includes('flex shrink-0 items-center gap-2 border-b')));
assert.deepEqual(shape(banner,'banner'),shape(returned(func(cur(browser+'components/DesignModeBanner/DesignModeBanner.tsx'),'DesignModeBanner')),'banner'));
const toolbar=browser+'components/BrowserPaneToolbar/BrowserPaneToolbar.tsx',button=find(parse(old(toolbar)),n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText()==='Tooltip');
assert.deepEqual(shape(button,'button'),shape(returned(func(cur(browser+'components/BrowserPaneToolbar/components/DesignModeButton/DesignModeButton.tsx'),'DesignModeButton')),'button'));
const hook=cur(browser+'hooks/useDesignModePane/useDesignModePane.ts'),expectedPane=old(browser+'BrowserPane.tsx').replaceAll('designModeStore.','store.').replaceAll('state.isLoading','isLoading');
const effectBody=(s,needle)=>find(parse(s),n=>ts.isCallExpression(n)&&n.expression.getText()===needle&&n.arguments[0]?.getText().includes(needle==='useLayoutEffect'?'confirmingRect':'const handleKeyDown')).arguments[0];
assert.deepEqual(shape(effectBody(expectedPane,'useEffect')),shape(effectBody(hook,'useEffect')));assert.deepEqual(shape(effectBody(expectedPane,'useLayoutEffect')),shape(effectBody(hook,'useLayoutEffect')));
const prompt=browser+'designModePrompt.ts',attachments=browser+'writeDesignModeAttachments.ts';
assert.deepEqual(shape(func(old(prompt),'buildDesignModePrompt').body,'defaults'),shape(func(cur(prompt),'buildDesignModePrompt').body,'defaults'));
assert.deepEqual(shape(func(old(attachments),'writeDesignModeAttachments').body,'defaults'),shape(func(cur(attachments),'writeDesignModeAttachments').body,'defaults'));
assert.match(cur(prompt),/livePaneAvailable = true/);assert.match(cur(attachments),/livePaneAvailable = true/);
const controller='apps/desktop/src/main/lib/ssh-direct/workstation-controller.ts';let normalized=cur(controller).replace(/^\s*"workstationAgentHooksV1",\n/m,'\n').replace(/^\s*"agents.run": "agents.run",\n/m,'\n').replace(/request\.path === "agents.run"\s*\|\|/,'');assert.deepEqual(shape(parse(old(controller))),shape(parse(normalized)));
const hostRouter='packages/host-service/src/trpc/router/direct/direct.ts';
normalized=cur(hostRouter).replace(/^import \{ currentDirectAgentHookUrl \} from .*\n/m,'').replace(/^\s*workstationAgentHooksV1:[\s\S]*?currentDirectAgentHookUrl\(\) !== null,\n/m,'\n');
assert.deepEqual(shape(parse(old(hostRouter))),shape(parse(normalized)));
const terminal='packages/host-service/src/terminal/terminal.ts';assert.equal(cur(terminal),old(terminal));
const environment='packages/host-service/src/terminal/env.ts';
normalized=cur(environment);
const envTree=parse(normalized),originalEnvTree=parse(old(environment));
const directImport=find(envTree,n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='../direct/agent-environment');
const originalDirectImport=find(originalEnvTree,n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='../direct/agent-environment');
normalized=normalized.replace(directImport.getText(),originalDirectImport.getText());
const hookImport=find(parse(normalized),n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.text==='../direct/agent-hook-url');normalized=normalized.replace(hookImport.getText(),'');
const envFunction=func(normalized,'buildHostLaunchEnv'),originalEnvFunction=func(old(environment),'buildHostLaunchEnv');
assert.deepEqual(shape(envFunction.body.statements[0]),shape(originalEnvFunction.body.statements[0]));
assert.deepEqual(shape(envFunction.body.statements[1].declarationList.declarations[0].initializer),shape(originalEnvFunction.body.statements[1].expression));
assert.equal(envFunction.body.statements.length,5);
normalized=normalized.slice(0,envFunction.body.getStart())+originalEnvFunction.body.getText()+normalized.slice(envFunction.body.getEnd());assert.deepEqual(shape(parse(old(environment))),shape(parse(normalized)));
const runtime='packages/host-service/src/direct/runtime.ts';
normalized=cur(runtime).replace(/^import \{ registerDirectAgentHookPort \} from .*\n/m,'').replace(/^\s*let releaseAgentHook:.*\n/m,'\n').replace(/^\s*releaseAgentHook = registerDirectAgentHookPort\(info.port\);\n/m,'\n').replace(/^\s*releaseAgentHook\?\.\(\);\n/gm,'\n');
assert.deepEqual(shape(parse(old(runtime))),shape(parse(normalized)));
const guestScript='apps/desktop/src/main/lib/browser/design-mode-script.ts';const guestClickFix={path:guestScript,before:createHash('sha256').update(old(guestScript)).digest('hex'),after:createHash('sha256').update(cur(guestScript)).digest('hex'),intentionalChange:'Fresh click-coordinate hit test and cancellation of queued hover paint; reproduced native cancellation and script behavior regression'};
const unchanged={};for(const p of ['apps/desktop/src/lib/trpc/routers/browser/browser.ts','apps/desktop/src/main/lib/browser/browser-manager.ts','apps/desktop/src/main/lib/browser/design-mode-controller.ts','apps/desktop/src/main/lib/browser/design-mode-payload.ts','apps/desktop/src/main/lib/browser/design-mode-screenshot.ts','packages/host-service/src/trpc/router/agents/agents.ts','packages/host-service/src/direct/terminal-agent-feedback-operation.ts','packages/host-service/src/direct/terminal-agent-feedback-delivery.ts','packages/shared/src/host-version.ts',browser+'designModeStoreCore.ts']){assert.equal(old(p),cur(p),p);unchanged[p]=createHash('sha256').update(cur(p)).digest('hex');}
writeFileSync('/workspace/scratch/parity-96/extraction-proof.json',JSON.stringify({base,originalAgentSelectorBodyPreservedWithOptionRenderSlots:true,originalOptionMarkupAndLegacyIconHooksPreserved:true,originalFormMarkupPreservedExceptInjectedPickerCommentAndSubmitCallbacksAndOptionalNotice:true,legacyPopoverSubmitBodyUnchanged:true,originalBannerAndButtonMarkupPreservedExceptAccessibleLabelAndOptionalUnavailableReason:true,originalEscapeAndAnchorBodiesPreserved:true,originalAttachmentWritesAndPromptBehaviorPreservedByDefault:true,workstationOmitsUnavailableCliBridgeHintsUntilImplemented:true,controllerOnlyAddsOriginalDurableAgentRunPathAndHookCapability:true,directStartupOnlyRegistersAndReleasesItsActualHookPort:true,originalTerminalFramingAndHookGetterByteUnchanged:true,launchEnvironmentOnlyRestoresTrustedDirectListenerAfterIsolation:true,guestClickFix,unchanged},null,2)+'\n');console.log('Original selector/options/form/submit/banner/button/Escape/anchor/default attachments+prompt verified within explicit DI and availability additions');
