export interface WorkspaceProcedure {
	type: "query" | "mutation";
	capability: "workstationFilesV1" | "workstationGitV1";
}

export const workspaceProcedures: Record<string, WorkspaceProcedure> = {
	"filesystem.getMetadata": { type: "query", capability: "workstationFilesV1" },
	"filesystem.searchFiles": { type: "query", capability: "workstationFilesV1" },
	"filesystem.searchContent": {
		type: "query",
		capability: "workstationFilesV1",
	},
	"filesystem.createDirectory": {
		type: "mutation",
		capability: "workstationFilesV1",
	},
	"filesystem.createUniqueEntry": {
		type: "mutation",
		capability: "workstationFilesV1",
	},
	"filesystem.removeEmptyDirectory": {
		type: "mutation",
		capability: "workstationFilesV1",
	},
	"filesystem.removeFileIfUnchanged": {
		type: "mutation",
		capability: "workstationFilesV1",
	},
	"filesystem.movePath": { type: "mutation", capability: "workstationFilesV1" },
	"filesystem.copyPath": { type: "mutation", capability: "workstationFilesV1" },
	"filesystem.deletePath": {
		type: "mutation",
		capability: "workstationFilesV1",
	},
	"git.listBranches": { type: "query", capability: "workstationGitV1" },
	"git.listCommits": { type: "query", capability: "workstationGitV1" },
	"git.getCommitFiles": { type: "query", capability: "workstationGitV1" },
	"git.getBaseBranch": { type: "query", capability: "workstationGitV1" },
	"git.getBranchSyncStatus": { type: "query", capability: "workstationGitV1" },
	"git.readDiffSideFile": { type: "query", capability: "workstationGitV1" },
	"git.getDiffBulk": { type: "query", capability: "workstationGitV1" },
	"git.getDiffPatch": { type: "query", capability: "workstationGitV1" },
	"git.setBaseBranch": { type: "mutation", capability: "workstationGitV1" },
	"git.renameBranch": { type: "mutation", capability: "workstationGitV1" },
	"git.stageFile": { type: "mutation", capability: "workstationGitV1" },
	"git.unstageFile": { type: "mutation", capability: "workstationGitV1" },
	"git.stageAll": { type: "mutation", capability: "workstationGitV1" },
	"git.commit": { type: "mutation", capability: "workstationGitV1" },
	"git.push": { type: "mutation", capability: "workstationGitV1" },
	"git.unstageAll": { type: "mutation", capability: "workstationGitV1" },
	"git.discardChanges": { type: "mutation", capability: "workstationGitV1" },
	"git.discardAllUnstaged": {
		type: "mutation",
		capability: "workstationGitV1",
	},
	"git.discardAllStaged": { type: "mutation", capability: "workstationGitV1" },
};
