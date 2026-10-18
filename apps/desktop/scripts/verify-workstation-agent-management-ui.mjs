import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
export async function verifyWorkstationAgentManagementUi({getPage,click,screenshot}) {
 await click('button[aria-label="Agent settings"]');
 for(let i=0;i<200;i++){
  const found=await getPage().evaluate(`Boolean([...document.querySelectorAll('[data-workstation-agent-settings] button')].find(e=>e.textContent.trim()==='Add agent'))`);
  if(found)return;
  await delay(50);
 }
 await screenshot("agent-management-missing-original-add-control");
 assert.fail("Original agent management Add agent control unavailable");
}
