import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { attachmentsRouter } from "@superset/host-service/attachments";
import { router } from "@superset/host-service/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const hostPackage = createRequire(import.meta.url).resolve(
	"@superset/host-service/package.json",
);
const { Hono } = await import(createRequire(hostPackage).resolve("hono"));
const { registerDirectAttachmentRoute } = await import(
	pathToFileURL(join(dirname(hostPackage), "src/direct/attachments.ts")).href
);
const app = new Hono();
registerDirectAttachmentRoute(app, process.env.HOST_MANIFEST_DIR);
const attachmentRouter = router({ attachments: attachmentsRouter });
const server = Bun.serve({
	port: 0,
	fetch: async (request) => {
		if (
			request.headers.get("Authorization") !==
			"Bearer attachment-test-credential"
		)
			return Response.json({ error: "Unauthorized" }, { status: 401 });
		if (new URL(request.url).pathname.startsWith("/trpc/"))
			return fetchRequestHandler({
				endpoint: "/trpc",
				req: request,
				router: attachmentRouter,
				createContext: () => ({ isAuthenticated: true, direct: true }) as never,
			});
		return app.fetch(request);
	},
});
process.stdout.write(`${JSON.stringify({ url: server.url.href })}\n`);
process.on("SIGTERM", () => {
	server.stop(true);
	process.exit(0);
});
