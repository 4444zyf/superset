import assert from "node:assert/strict";
import {agentUiDriver} from "./verify-workstation-agent-ui-driver.mjs";
export async function verifyWorkstationPaneTabsUi({getPage,click,screenshot,output}) {
 const {evaluate,until}=agentUiDriver({getPage,click,screenshot,output});
 const active=()=>evaluate(`(async()=>{const {snapshot}=await window.directWorkstation.getWorkspaceView();const target=snapshot.targets.find(t=>t.connectionId===snapshot.activeConnectionId);return target.workspaces.find(w=>w.tabId===target.activeTabId);})()`);
 const before=await active();assert.ok(before.panes.length>=3);
 await screenshot('pane-tabs-original-workspace-before-new-terminal');
 await click('text:New terminal');
 const after=await until(async()=>{const w=await active();return w.panes.length===before.panes.length+1&&w;},'new terminal resource saved');
 await screenshot('pane-tabs-new-terminal-opens-separate-original-tab');
 assert.equal(after.paneTabs?.length,2,'New terminal preserves the existing layout and opens a separate terminal tab');
}
