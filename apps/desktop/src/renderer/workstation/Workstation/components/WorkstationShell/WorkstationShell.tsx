import { Trans, useLingui } from "@lingui/react/macro";
import { PRODUCT_BRAND } from "@superset/shared/product-brand";
import { Button } from "@superset/ui/button";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarMenuAction,
	SidebarProvider,
	SidebarTrigger,
} from "@superset/ui/sidebar";
import { TooltipProvider } from "@superset/ui/tooltip";
import {
	Folder,
	Grid2X2,
	Info,
	Laptop,
	Monitor,
	Settings,
	ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { BrandMark } from "../../../../components/BrandMark";
import type { RemoteProject } from "../../types";
import { AboutDialog } from "../AboutDialog";

export function WorkstationShell({
	page,
	projects,
	children,
	settings,
	workspaceOpen,
	onSettings,
	onNavigate,
	onProject,
	onProjectSettings,
}: {
	page: "machines" | "workspaces";
	projects: RemoteProject[];
	children: ReactNode;
	settings?: ReactNode;
	workspaceOpen?: boolean;
	onSettings?(): void;
	onNavigate(page: "machines" | "workspaces"): void;
	onProject(id: string): void;
	onProjectSettings?(id: string): void;
}) {
	const { t } = useLingui();
	const [aboutOpen, setAboutOpen] = useState(false);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	return (
		<DndProvider backend={HTML5Backend}>
			<TooltipProvider>
				<div className="ssh-workstation">
					<div className="ws-titlebar">
						<span>{PRODUCT_BRAND.displayName}</span>
						<span>
							<ShieldCheck size={12} />
							<Trans>Direct SSH</Trans>
						</span>
					</div>
					<SidebarProvider
						open={sidebarOpen}
						onOpenChange={setSidebarOpen}
						className="ws-shell"
						style={{ minHeight: 0 }}
					>
						<Sidebar
							collapsible="icon"
							className="ws-native-sidebar"
							variant="sidebar"
						>
							<SidebarHeader>
								<div className="ws-native-brand flex h-9 items-center gap-2 overflow-hidden px-2 text-sm font-medium">
									<BrandMark />
									<span className="truncate group-data-[collapsible=icon]:hidden">
										{PRODUCT_BRAND.displayName}
									</span>
								</div>
							</SidebarHeader>
							<SidebarContent>
								<SidebarGroup>
									<SidebarGroupContent>
										<nav>
											<SidebarMenu>
												<SidebarMenuItem>
													<SidebarMenuButton
														isActive={page === "workspaces"}
														tooltip={t({ message: "Workspaces" })}
														aria-label={t({ message: "Workspaces" })}
														aria-current={
															page === "workspaces" ? "page" : undefined
														}
														onClick={() => onNavigate("workspaces")}
													>
														<Grid2X2 />
														<span>
															<Trans>Workspaces</Trans>
														</span>
													</SidebarMenuButton>
												</SidebarMenuItem>
												<SidebarMenuItem>
													<SidebarMenuButton
														isActive={page === "machines"}
														tooltip={t({ message: "SSH machines" })}
														aria-label={t({ message: "SSH machines" })}
														aria-current={
															page === "machines" ? "page" : undefined
														}
														onClick={() => onNavigate("machines")}
													>
														<Monitor />
														<span>
															<Trans>SSH machines</Trans>
														</span>
													</SidebarMenuButton>
												</SidebarMenuItem>
											</SidebarMenu>
										</nav>
									</SidebarGroupContent>
								</SidebarGroup>
								<SidebarGroup>
									<SidebarGroupLabel>
										<Trans>Projects</Trans>
									</SidebarGroupLabel>
									<SidebarGroupContent>
										<SidebarMenu>
											{projects.map((p) => (
												<SidebarMenuItem key={p.id}>
													<SidebarMenuButton
														tooltip={p.name}
														onClick={() => onProject(p.id)}
													>
														<Folder />
														<span>{p.name}</span>
													</SidebarMenuButton>
													{onProjectSettings && (
														<SidebarMenuAction
															aria-label={t({ message: "Project Settings" })}
															title={p.name}
															onClick={() => onProjectSettings(p.id)}
														>
															<Settings />
														</SidebarMenuAction>
													)}
												</SidebarMenuItem>
											))}
										</SidebarMenu>
									</SidebarGroupContent>
								</SidebarGroup>
							</SidebarContent>
							<SidebarFooter>
								<div className="group-data-[collapsible=icon]:hidden text-xs text-muted-foreground">
									{settings}
								</div>
								<SidebarMenu>
									{onSettings && (
										<SidebarMenuItem>
											<SidebarMenuButton
												tooltip={t({ message: "Settings" })}
												aria-label={t({ message: "Settings" })}
												onClick={onSettings}
											>
												<Settings />
												<span>
													<Trans>Settings</Trans>
												</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									)}
									<SidebarMenuItem>
										<SidebarMenuButton
											tooltip={t({ message: "Local Device" })}
											onClick={() => onNavigate("machines")}
										>
											<Laptop />
											<span>
												<Trans>Local Device</Trans>
											</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
									<SidebarMenuItem>
										<SidebarMenuButton
											className="ws-about-button"
											tooltip={t({ message: "About" })}
											onClick={() => setAboutOpen(true)}
										>
											<Info />
											<span>
												<Trans>About</Trans>
											</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarFooter>
						</Sidebar>
						<main
							className={`ws-main ${workspaceOpen ? "ws-main-workspace" : ""}`}
						>
							<div className="ws-native-topbar">
								<SidebarTrigger aria-label={t({ message: "Toggle sidebar" })} />
								<span>
									{page === "machines" ? (
										<Trans>SSH machines</Trans>
									) : (
										<Trans>Workspaces</Trans>
									)}
								</span>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={t({ message: "About" })}
									onClick={() => setAboutOpen(true)}
								>
									<Info size={14} />
								</Button>
							</div>
							<div className="ws-main-body">{children}</div>
						</main>
					</SidebarProvider>
					<AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
				</div>
			</TooltipProvider>
		</DndProvider>
	);
}
