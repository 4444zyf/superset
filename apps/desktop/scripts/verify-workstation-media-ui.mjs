import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export async function verifyWorkstationMediaUi({
	getPage,
	click,
	screenshot,
	closeReopen,
	controls,
	output,
}) {
	const evaluate = (e) => getPage().evaluate(e);
	const until = async (read) => {
		for (let i = 0; i < 200; i++) {
			const v = await read();
			if (v) return v;
			await delay(50);
		}
		throw new Error(
			`Media preview not ready: ${await evaluate("document.body.innerText.slice(-1500)")}`,
		);
	};
	const scope = await evaluate(
		`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;const v=(await window.directWorkstation.getWorkspaceView()).snapshot;const t=v.targets.find(t=>t.connectionId===d.connectionId),w=t.workspaces.find(w=>w.tabId===t.activeTabId);return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'workspace.get',type:'query',input:{id:w.workspaceId}});})()`,
	);
	const fixture = controls.prepareMediaPreviews(scope.worktreePath);
	const panel = "[role=tabpanel]:not([hidden])";
	const read = async (name) => {
		const r = await evaluate(
			`(async()=>{const d=(await window.directWorkstation.getWorkspaceRestore()).descriptor;return window.directWorkstation.rpc({connectionId:d.connectionId,generation:d.generation,path:'filesystem.readFile',type:'query',input:{workspaceId:${JSON.stringify(scope.id)},absolutePath:${JSON.stringify(scope.worktreePath)}+'/'+${JSON.stringify(name)},maxBytes:1048576}});})()`,
		);
		assert.equal(r.kind, "bytes");
		assert.equal(r.exceededLimit, false);
		const bytes = Buffer.from(r.content, "base64");
		return {
			bytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		};
	};
	const open = async (name) => {
		await until(() =>
			evaluate(
				`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path="${name}"]')`,
			),
		);
		await click(`tree:${name}`);
	};
	const physical = async (p) => {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
			await getPage().call("Input.dispatchMouseEvent", {
				type,
				button: type === "mouseMoved" ? "none" : "left",
				clickCount: type === "mouseMoved" ? 0 : 1,
				...p,
			});
	};
	await click("text:Files");
	await click("text:Refresh files and Git");
	await evaluate(
		`(()=>{window.ownedPdfLoad=false;document.addEventListener('load',e=>{if(e.target instanceof HTMLIFrameElement&&e.target.title==='report.pdf')window.ownedPdfLoad=e.isTrusted;},true);return true;})()`,
	);
	await open("report.pdf");
	const pdf = await until(() =>
		evaluate(
			`(()=>{const e=document.querySelector('${panel} iframe');return e?.src.startsWith('blob:')?{src:e.src,title:e.title,width:e.clientWidth,height:e.clientHeight}:null;})()`,
		),
	);
	assert.equal(pdf.title, "report.pdf");
	assert.ok(pdf.width > 200 && pdf.height > 100);
	await until(() => evaluate("window.ownedPdfLoad===true"));
	const frames = await getPage().call("Page.getFrameTree");
	const flat = [];
	const visit = (tree) => {
		flat.push(tree.frame);
		for (const child of tree.childFrames ?? []) visit(child);
	};
	visit(frames.frameTree);
	const names = [];
	for (const frame of flat.filter(
		(f) => f.url === pdf.src || f.url.startsWith("chrome-extension:"),
	)) {
		try {
			const ax = await getPage().call("Accessibility.getFullAXTree", {
				frameId: frame.id,
			});
			names.push(
				...ax.nodes
					.map((n) => n.name?.value)
					.filter((v) => typeof v === "string"),
			);
		} catch {}
	}
	const axText = names.join("\n").slice(0, 16384);
	writeFileSync(
		join(output, "media-pdf-frame-diagnostic.json"),
		JSON.stringify(
			{
				pdf,
				frames: flat.map((f) => ({
					id: f.id,
					url: f.url,
					mimeType: f.mimeType,
				})),
				axText,
				loaded: true,
			},
			null,
			2,
		) + "\n",
	);
	assert.equal(
		/could(?:n.t| not) load plug.?in|plug.?in (?:is )?not supported/i.test(
			axText,
		),
		false,
	);
	assert.deepEqual(await read(fixture.pdf.name), {
		bytes: fixture.pdf.bytes,
		sha256: fixture.pdf.sha256,
	});
	await screenshot("media-original-pdf-page");
	const videos = [];
	for (const item of fixture.videos) {
		await open(item.name);
		const state = () =>
			evaluate(
				`(()=>{const e=document.querySelector('${panel} video');return e?{src:e.src,duration:Number.isFinite(e.duration)?e.duration:null,width:e.videoWidth,height:e.videoHeight,paused:e.paused,time:e.currentTime,autoplay:e.autoplay,controls:e.controls,ready:e.readyState,error:e.error?.message??null}:null;})()`,
			);
		const before = await until(async () => {
			const v = await state();
			return v && (v.error || (v.ready >= 1 && v.duration > 0)) ? v : null;
		});
		assert.equal(before.error, null);
		assert.ok(before.src.startsWith("blob:"));
		assert.deepEqual([before.width, before.height], fixture.dimensions);
		assert.ok(Math.abs(before.duration - fixture.duration) < 0.2);
		assert.equal(before.autoplay, false);
		assert.equal(before.paused, true);
		assert.equal(before.controls, true);
		assert.equal(before.time, 0);
		assert.deepEqual(await read(item.name), {
			bytes: item.bytes,
			sha256: item.sha256,
		});
		await screenshot(`media-${item.name}-before-play`);
		const point = await evaluate(
			`(()=>{const e=document.querySelector('${panel} video'),r=e.getBoundingClientRect(),x=r.x+28,y=r.bottom-20;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Media controls are covered');return{x,y};})()`,
		);
		await physical(point);
		const playing = await until(async () => {
			const v = await state();
			return v?.time > 0.2 && !v.paused ? v : null;
		});
		await physical(point);
		const paused = await until(async () => {
			const v = await state();
			return v?.paused && v.time > 0.2 ? v : null;
		});
		videos.push({ file: item.name, before, playing, paused });
		await screenshot(`media-${item.name}-played-and-paused`);
	}
	await open("oversized-clip.webm");
	await until(() =>
		evaluate(
			`document.querySelector('${panel}')?.innerText.includes('This preview is truncated. Saving is disabled.')`,
		),
	);
	assert.equal(
		await evaluate(
			`!!document.querySelector('${panel} video, ${panel} iframe')`,
		),
		false,
	);
	await screenshot("media-size-limit-read-only");
	await closeReopen();
	await until(() =>
		evaluate(
			"window.directWorkstation.getWorkspaceRestore().then(v=>v.status==='ready')",
		),
	);
	await click("text:Files");
	await open("clip.webm");
	const restored = await until(() =>
		evaluate(
			`(()=>{const e=document.querySelector('${panel} video');return e?.readyState>=1?{paused:e.paused,time:e.currentTime,duration:e.duration,error:e.error?.message??null}:null;})()`,
		),
	);
	assert.equal(restored.error, null);
	assert.equal(restored.paused, true);
	assert.equal(restored.time, 0);
	await screenshot("media-reopened-without-autoplay");
	await click("text:Terminal");
	assert.deepEqual(getPage().errors, []);
	writeFileSync(
		join(output, "workstation-media-ui.json"),
		JSON.stringify(
			{
				sourceRevision: process.env.GITHUB_SHA,
				physicalInput: true,
				originalPdfView: true,
				originalVideoView: true,
				pdfFrameLoaded: true,
				pdfAccessibilityTextObserved: axText.includes("Superset Remix SSH PDF"),
				pdfManualVisualReviewRequired: true,
				fixture,
				pdf,
				videos,
				sizeLimitEnforced: true,
				windowReopenNoAutoplay: true,
				macOSVerified: false,
			},
			null,
			2,
		) + "\n",
	);
}
