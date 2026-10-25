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

		const geometry = () =>
			evaluate(
				`(()=>{const m=document.querySelector('[role=menu][data-state=open]'),e=[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!m||!e)return null;const r=e.getBoundingClientRect(),mr=m.getBoundingClientRect(),top=Math.max(0,mr.top),bottom=Math.min(innerHeight,mr.bottom),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {scrollTop:m.scrollTop,itemTop:r.top,itemBottom:r.bottom,menuTop:top,menuBottom:bottom,x:mr.x+mr.width/2,y:(top+bottom)/2,deltaY:r.bottom>bottom?r.bottom-bottom+8:r.top<top?r.top-top-8:0,visible:r.top>=top&&r.bottom<=bottom&&(hit===e||e.contains(hit))};})()`,
			);
		const before = await geometry();
		assert.ok(before);
		if (!before.visible && before.deltaY !== 0) {
			await options
				.getPage()
				.call("Input.dispatchMouseEvent", {
					type: "mouseWheel",
					x: before.x,
					y: before.y,
					deltaX: 0,
					deltaY: before.deltaY,
				});
			await until(async () => {
				const g = await geometry();
				return g?.visible ? g : null;
			}, "real wheel exposes the clipped menu item");
		}
		const after = await geometry();
		await click("menu:" + label);
		return { before, after };
	};
	return { open, select: menu };
}
