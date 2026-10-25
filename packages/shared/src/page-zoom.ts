export const PAGE_PINCH_ZOOM_LIMITS = Object.freeze({ min: 1, max: 5 });

export interface PageViewportZoom {
	scale: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PageViewportClip {
	top: number;
	right: number;
	bottom: number;
	left: number;
}
export function isValidPageViewportZoom(viewport: PageViewportZoom): boolean {
	const { scale, x, y, width, height } = viewport;
	return !(
		![scale, x, y, width, height].every(Number.isFinite) ||
		scale < PAGE_PINCH_ZOOM_LIMITS.min ||
		scale > PAGE_PINCH_ZOOM_LIMITS.max ||
		width <= 0 ||
		height <= 0
	);
}

export function applyPageViewportZoom(
	element: {
		style: { transform: string; transformOrigin: string; clipPath: string };
	},
	viewport: PageViewportZoom,
	clip?: PageViewportClip,
): void {
	const { scale, x, y, width, height } = viewport;
	if (!isValidPageViewportZoom(viewport)) return;
	const host =
		clip &&
		[clip.top, clip.right, clip.bottom, clip.left].every(
			(value) => Number.isFinite(value) && value >= 0,
		)
			? clip
			: { top: 0, right: 0, bottom: 0, left: 0 };
	if (scale === 1) {
		element.style.transform = "";
		element.style.transformOrigin = "";
		element.style.clipPath = clip
			? `inset(${host.top}px ${host.right}px ${host.bottom}px ${host.left}px)`
			: "";
		return;
	}
	const left = Math.max(0, Math.min(x, width * (scale - 1)));
	const top = Math.max(0, Math.min(y, height * (scale - 1)));
	element.style.transformOrigin = "0 0";
	element.style.transform = `translate(${-left}px, ${-top}px) scale(${scale})`;
	element.style.clipPath = `inset(${top / scale + host.top / scale}px ${width - (left + width) / scale + host.right / scale}px ${height - (top + height) / scale + host.bottom / scale}px ${left / scale + host.left / scale}px)`;
}

export const PAGE_PINCH_ZOOM_RUNTIME_SOURCE = `(onZoom = () => {}, isLocked = () => false) => {
	let enabled = false;
	let scale = 1;
	let x = 0;
	let y = 0;
	const clamp = () => {
		x = Math.max(0, Math.min(x, innerWidth * (scale - 1)));
		y = Math.max(0, Math.min(y, innerHeight * (scale - 1)));
	};
	const report = () => onZoom({ scale, x, y, width: innerWidth, height: innerHeight });
	addEventListener("resize", () => { clamp(); if (enabled) report(); });
	addEventListener("wheel", (event) => {
		if (!enabled || event.defaultPrevented || isLocked()) return;
		if (!event.ctrlKey && scale === 1) return;
		event.preventDefault();
		const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
		if (event.ctrlKey) {
			const next = Math.min(${PAGE_PINCH_ZOOM_LIMITS.max}, Math.max(
				${PAGE_PINCH_ZOOM_LIMITS.min}, scale * Math.exp(-event.deltaY * unit * 0.01),
			));
			if (!Number.isFinite(next)) return;
			x += event.clientX * (next - scale);
			y += event.clientY * (next - scale);
			scale = next;
			clamp();
		} else {
			const nextX = x + event.deltaX * unit;
			const nextY = y + event.deltaY * unit;
			x = nextX;
			y = nextY;
			clamp();
			if (nextX !== x || nextY !== y) {
				scrollBy({ left: (nextX - x) / scale, top: (nextY - y) / scale, behavior: "instant" });
			}
		}
		report();
	}, { passive: false });
	return { enable: () => { enabled = true; report(); } };
}`;

export const NEXT_PAGE_VIEWPORT_ZOOM_SCRIPT = `(() => {
	const key = Symbol.for("superset.viewport-zoom");
	if (!globalThis[key]) {
		let latest = null;
		let resolve = null;
		const controller = (${PAGE_PINCH_ZOOM_RUNTIME_SOURCE})((viewport) => {
			if (resolve) { const notify = resolve; resolve = null; notify(viewport); }
			else latest = viewport;
		});
		globalThis[key] = () => new Promise((notify) => {
			if (latest) { const viewport = latest; latest = null; notify(viewport); }
			else resolve = notify;
		});
		controller.enable();
	}
	return globalThis[key]();
})();`;
