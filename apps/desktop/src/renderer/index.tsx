import "./globals.css";
import "./styles/bundled-fonts.css";
import "@xterm/xterm/css/xterm.css";
import {
	createHashHistory,
	createRootRoute,
	createRouter,
} from "@tanstack/react-router";
import ReactDom from "react-dom/client";
import { RendererRouter } from "./components/RendererRouter";
import {
	initBootErrorHandling,
	isBootErrorReported,
	markBootMounted,
	reportBootError,
} from "./lib/boot-errors";
import type { cloudRouter } from "./lib/cloud-router";
import { NotFound } from "./routes/not-found";
import { Workstation } from "./workstation/Workstation/Workstation";

const rootElement = document.querySelector("app");
performance.mark("workspace-renderer-ready");
initBootErrorHandling(rootElement);
const router = createRouter({
	routeTree: createRootRoute({ component: Workstation }),
	history: createHashHistory(),
	defaultNotFoundComponent: NotFound,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof cloudRouter;
	}
}

if (!rootElement) reportBootError("Missing <app> root element");
else if (!window.directWorkstation)
	reportBootError("Workstation preload is unavailable");
else if (!isBootErrorReported()) {
	ReactDom.createRoot(rootElement).render(<RendererRouter router={router} />);
	markBootMounted();
}
