import assert from "node:assert/strict";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
export function workstationBrowserMenuDriver(options) {
	const { click } = options;
	const { evaluate, until } = agentUiDriver(options);
	const open = async () => {
		await until(
			() => evaluate("!document.querySelector('[role=menu]')"),
			"previous menu exit animation completed before the next user open",
		);
		await click(
			'[data-workstation-browser-pane] button[aria-label="More options"]',
		);
		await until(
			() =>
				evaluate(
					"(()=>{const m=document.querySelector('[role=menu][data-state=open]'),trigger=document.querySelector('[data-workstation-browser-pane] button[aria-label=\"More options\"]');return m&&trigger?.getAttribute('aria-expanded')==='true'&&m.getAnimations().every(a=>a.playState==='finished');})()",
				),
			"original browser menu opens",
		);
	};
	const menu = async (label) => {
		assert.equal(
			await evaluate(
				`[...document.querySelectorAll('[role=menuitem]')].some(e=>e.textContent.trim()===${JSON.stringify(label)})`,
			),
			true,
			`Original browser item ${label}`,
		);
		await click("menu:" + label);
	};
	return { open, select: menu };
}
