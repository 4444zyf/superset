import { createRouter } from "@tanstack/react-router";
import { electronQueryClient } from "../providers/ElectronTRPCProvider";
import { routeTree } from "../routeTree.gen";

export const cloudRouter = createRouter({
	routeTree,
	context: { queryClient: electronQueryClient },
});
