import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { agentUiDriver } from "./verify-workstation-agent-ui-driver.mjs";
import { workstationBrowserMenuDriver } from "./verify-workstation-browser-menu-driver.mjs";
const label = "Signed-in sites";
function driver(options) {
	const { evaluate, until } = agentUiDriver(options),
		menu = workstationBrowserMenuDriver(options);
	const key = async (key, code, virtualKey) => {
		for (const type of ["keyDown", "keyUp"])
			await options.getPage().call("Input.dispatchKeyEvent", {
				type,
				key,
				code,
				windowsVirtualKeyCode: virtualKey,
			});
	};
	const close = async () => {
		for (let i = 0; i < 2; i++) {
			if (!(await evaluate("Boolean(document.querySelector('[role=menu]'))")))
				return;
			await key("Escape", "Escape", 27);
			await until(
				() =>
					evaluate("!document.querySelector('[role=menu][data-state=closed]')"),
				"menu closing animation completed",
			);
		}
		assert.equal(
			await evaluate("Boolean(document.querySelector('[role=menu]'))"),
			false,
		);
	};
	const open = async () => {
		await menu.open();
		const items = await evaluate(
			"[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent.trim())",
		);
		assert.ok(
			items.includes(label),
			"original Signed-in sites submenu is available",
		);
		await menu.select(label);
		await until(
			() =>
				evaluate(
					"(()=>{const e=document.querySelector('input[placeholder^=\"Search \"][placeholder$=\"sites…\"]');return e&&document.querySelectorAll('button[aria-label^=\"Forget \"]').length>0&&e.closest('[role=menu]').getAnimations().every(a=>a.playState==='finished');})()",
				),
			"native cookie domain rows loaded",
		);
		return items;
	};

	let enteredSubmenu = false;
	const liveInput = () =>
		evaluate(
			`(()=>{const e=document.querySelector('input[placeholder^="Search "][placeholder$="sites…"]');if(!e)return null;const m=e.closest('[role=menu]'),r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {x:r.x+r.width/2,y:r.y+r.height/2,state:m?.dataset.state,ready:m?.dataset.state==='open'&&m.getAnimations().every(a=>a.playState==='finished')&&(hit===e||e.contains(hit))};})()`,
		);
	const search = async (text) => {
		const selector = 'input[placeholder^="Search "][placeholder$="sites…"]';
		const point = await until(async () => {
			const v = await liveInput();
			return v?.ready ? v : null;
		}, "live site search input receives pointer");

		if (!enteredSubmenu) {
			const route = await evaluate(
				`(()=>{const t=[...document.querySelectorAll('[data-slot=dropdown-menu-sub-trigger]')].find(e=>e.textContent.trim()==='Signed-in sites'),e=document.querySelector('input[placeholder^="Search "][placeholder$="sites…"]'),r=t.getBoundingClientRect(),m=e.closest('[role=menu]').getBoundingClientRect();return [{x:r.x+r.width/2,y:r.y+r.height/2},{x:r.x+r.width/2-12,y:r.y+r.height/2},{x:${point.x},y:Math.max(m.top+12,Math.min(m.bottom-12,r.y+r.height/2))},{x:${point.x},y:${point.y}}];})()`,
			);
			for (const position of route)
				await options
					.getPage()
					.call("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						...position,
						button: "none",
					});
			enteredSubmenu = true;
		} else
			await options
				.getPage()
				.call("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					x: point.x,
					y: point.y,
					button: "none",
				});

		await until(async () => {
			const v = await liveInput();
			return v?.ready ? v : null;
		}, "site search remains live after real pointer hover");
		await options.click(selector);
		for (const type of ["keyDown", "keyUp"])
			await options.getPage().call("Input.dispatchKeyEvent", {
				type,
				key: "a",
				code: "KeyA",
				windowsVirtualKeyCode: 65,
				modifiers: process.platform === "darwin" ? 4 : 2,
				commands: ["selectAll"],
			});
		await options.getPage().call("Input.insertText", { text });
		await until(
			() =>
				evaluate(
					`document.querySelector(${JSON.stringify(selector)})?.value===${JSON.stringify(text)}&&document.querySelector(${JSON.stringify(selector)})?.closest('[role=menu]')?.dataset.state==='open'`,
				),
			"real search remains in an open submenu",
		);
	};

	return { evaluate, until, menu, key, close, open, search };
}
export async function verifyWorkstationBrowserSitesUi(options, context) {
	const { evaluate, until, key, close, open, search } = driver(options),
		report = {};
	const save = () =>
		writeFileSync(
			join(options.output, "browser-sites-ui.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
	try {
		await evaluate(
			`(()=>{const trace=[];window.__ownedSitesTrace=trace;const item=e=>({tag:e?.tagName,role:e?.getAttribute?.('role'),slot:e?.getAttribute?.('data-slot'),text:e?.getAttribute?.('role')==='menuitem'?e.textContent.slice(0,120):null});const snapshot=()=>({menus:[...document.querySelectorAll('[role=menu]')].map(e=>({slot:e.getAttribute('data-slot'),state:e.dataset.state})),active:item(document.activeElement)});const push=value=>{trace.push({time:performance.now(),...value});if(trace.length>300)trace.shift();};for(const type of ['pointermove','pointerdown','pointerup','click','focusin','focusout','keydown','keyup'])document.addEventListener(type,e=>{if(e.target?.closest?.('[role=menu]'))push({type,key:e.key,x:e.clientX,y:e.clientY,target:item(e.target),...snapshot()});},true);let previous='';new MutationObserver(()=>{const value=snapshot(),current=JSON.stringify(value);if(current!==previous){previous=current;push({type:'state',...value});}}).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-state','aria-expanded']});return true;})()`,
		);
		report.primaryHost = await context.guestRead("location.hostname");
		report.guestSetup = await context.guestRead(
			"(()=>{document.cookie='owned_cookie_root=fixture; path=/; SameSite=Lax; max-age=3600';document.cookie='owned_cookie_path=fixture; path=/protected; SameSite=Lax; max-age=3600';return {host:location.hostname,visibleCookieNames:document.cookie.split(';').map(c=>c.split('=')[0].trim())};})()",
		);
		report.setup = await options.prepareBrowserSiteCookies(report.primaryHost);
		assert.deepEqual(report.setup, {
			cookieCount: 28,
			primaryCount: 2,
			foreignCount: 1,
		});
		report.capability = await evaluate(
			"Boolean(window.directWorkstation.browser?.siteCookies)",
		);
		save();
		await options.screenshot("browser-sites-before");
		report.menu = await open();
		assert.equal(report.capability, true);
		report.initial = await evaluate(
			"({rows:[...document.querySelectorAll('button[aria-label^=\"Forget \"]')].map(b=>({name:b.getAttribute('aria-label'),title:b.title})),placeholder:document.querySelector('input[placeholder^=\"Search \"][placeholder$=\"sites…\"]').placeholder})",
		);
		assert.equal(report.initial.rows.length, 20);
		assert.equal(report.initial.placeholder, "Search 27 sites…");
		await options.screenshot("browser-sites-capped");
		await search("SITE-24-OWNED");
		await until(
			() =>
				evaluate(
					"document.querySelectorAll('button[aria-label^=\"Forget \"]').length===1",
				),
			"substring search finds a domain outside the first twenty",
		);
		await key("ArrowDown", "ArrowDown", 40);
		report.keyboardFocus = await evaluate(
			"({role:document.activeElement?.getAttribute('role'),text:document.activeElement?.textContent})",
		);
		assert.equal(report.keyboardFocus.role, "menuitem");
		assert.ok(report.keyboardFocus.text.includes("site-24-owned.invalid"));
		await options.screenshot("browser-sites-keyboard-target");
		report.beforeEnter = await evaluate(
			"({state:document.activeElement?.closest('[role=menu]')?.dataset.state,role:document.activeElement?.getAttribute('role'),text:document.activeElement?.textContent})",
		);
		assert.equal(
			report.beforeEnter.state,
			"open",
			"selected cookie row remains in a live submenu after capture",
		);
		assert.equal(report.beforeEnter.role, "menuitem");
		await key("Enter", "Enter", 13);
		await until(
			() =>
				evaluate(
					"[...document.querySelectorAll('[role=menu]')].some(m=>m.textContent.includes('No matches'))",
				),
			"keyboard Forget removes the selected owned cookie domain",
		);
		report.afterKeyboard = await options.readBrowserSiteCookies();
		assert.equal(
			report.afterKeyboard.some((c) => c.domain === "site-24-owned.invalid"),
			false,
		);
		assert.equal(
			report.afterKeyboard.filter((c) => c.domain === "other-owned.invalid")
				.length,
			1,
		);
		await search(report.primaryHost);
		await until(
			() =>
				evaluate(
					`Boolean(document.querySelector('button[aria-label=${JSON.stringify("Forget " + report.primaryHost)}]'))`,
				),
			"primary page cookie domain visible",
		);
		report.primaryTitle = await evaluate(
			`document.querySelector('button[aria-label=${JSON.stringify("Forget " + report.primaryHost)}]').title`,
		);
		assert.equal(report.primaryTitle, "2 cookies — forget this site");
		await options.click(
			`button[aria-label=${JSON.stringify("Forget " + report.primaryHost)}]`,
		);
		await until(
			() =>
				evaluate(
					"[...document.querySelectorAll('[role=menu]')].some(m=>m.textContent.includes('No matches'))",
				),
			"mouse Forget removes both paths for primary domain",
		);
		report.after = await options.readBrowserSiteCookies();
		assert.equal(
			report.after.filter((c) => c.domain === report.primaryHost).length,
			0,
		);
		assert.equal(
			report.after.filter((c) => c.domain === "other-owned.invalid").length,
			1,
		);
		assert.equal(report.after.length, 25);
		report.currentGuest = await context.guestRead("document.cookie");
		assert.equal(report.currentGuest.includes("owned_cookie_root="), false);
		report.invalidEmpty = await evaluate(
			"window.directWorkstation.browser.siteCookies.forget({domain:''}).then(()=>({rejected:false}),()=>({rejected:true}))",
		);
		assert.deepEqual(report.invalidEmpty, { rejected: true });
		assert.deepEqual(await options.readBrowserSiteCookies(), report.after);
		await options.screenshot("browser-sites-after");
		await close();
		report.errors = options.getPage().errors;
		assert.deepEqual(report.errors, []);
		return report;
	} catch (error) {
		report.failure = { message: error.message, stack: error.stack };
		await options.screenshot("browser-sites-incomplete");
		throw error;
	} finally {
		report.trace = await evaluate("window.__ownedSitesTrace??[]");
		save();
		await close();
	}
}
export async function verifyWorkstationBrowserSitesReopened(options, expected) {
	const { evaluate, until, open, close, search } = driver(options),
		report = {};
	try {
		report.cookies = await options.readBrowserSiteCookies();
		assert.equal(report.cookies.length, 25);
		assert.equal(
			report.cookies.some(
				(c) =>
					c.domain === expected.primaryHost ||
					c.domain === "site-24-owned.invalid",
			),
			false,
		);
		assert.equal(
			report.cookies.filter((c) => c.domain === "other-owned.invalid").length,
			1,
		);
		await open();
		await search(expected.primaryHost);
		await until(
			() =>
				evaluate(
					"[...document.querySelectorAll('[role=menu]')].some(m=>m.textContent.includes('No matches'))",
				),
			"forgotten site stays absent after normal reopen",
		);
		await options.screenshot("browser-sites-reopened");
		await close();
		return report;
	} finally {
		writeFileSync(
			join(options.output, "browser-sites-reopened.json"),
			JSON.stringify(report, null, 2) + "\n",
		);
		await close();
	}
}
