# Stage 64 — terminal directory links reveal the workspace file tree

2026-10-23. Feature `7fe1dd075`, one-shot request cleanup `0c51e5816`, final refresh-race fix and verifier `58cca08f6`.

The retained original TerminalPane handles directory links through folder click policy and reveal-in-sidebar. The direct adapter previously filtered all directory metadata out. This stage restores the default Ctrl/Cmd-click reveal gesture for workspace-internal directories, reusing the original link detector, folder policy defaults, Pierre file tree and remote directory reader. Plain click preserves terminal selection; Finder/external-editor tiers and configurable link settings remain pending.

## Product and safety of routing

Directory metadata travels through the existing scoped file-open request with an optional directory flag. RemoteFiles consumes that request as tree navigation, without opening/reading a directory as a document. The original editor, dirty draft and backend file remain unchanged.

The controller loads only the target's ancestors/children, expands and selects the folder, and scrolls it into view. Workspace-root boundaries and traversal checks run before new directory reads. Stop/replacement and a newer reveal cancel stale selection. Completion consumes the bounded one-shot request. No local Finder action is performed on an SSH path. Existing file line/column navigation and its connection/generation/workspace/execution guards remain.

There is no new host/tRPC/IPC/schema or account contract. Existing `filesystem.statPath`/file capability guards are retained. One new directory error is translated in all 17 locales.

## Red evidence and investigation

- `controller-red.log.gz`: the two new missing-feature controller cases fail before implementation (6 pass / 2 fail).
- The first native SSH fixture used query for the existing mutation-style statPath operation; `baseline-ssh` fails at fixture readiness. Only that call's method was corrected. `baseline-ssh-rpc` then confirms `isDirectory:true`, but the unchanged compiled stage-63 product cannot hover/activate the directory link. The directory-before screenshot was viewed. Both original runs are preserved.
- Intermediate component checks exposed a stale/sticky-row reference in the new test and an old assertion that folders never navigate. The test now reads the actual non-sticky row and checks directory metadata/navigation, preserving stale-owner and no-write assertions.
- An extra diagnostic incorrectly expected the tree to reset/collapse after Files/Changes and probed a virtualized ancestor. The tree is CSS-hidden rather than discarded. Its failed `reveal-consumption-*` logs are retained and are **not** claimed as a reproduced product defect. That newly added invalid expectation was removed; the final real-window journey checks that folder selection and draft remain across Files/Changes.
- Initial compiled `0c51e5816` passes the component path but fails in `native-local`: the link activates, the dirty editor remains, yet the folder is collapsed and the UI says Directory not found. The screenshot was viewed and the initial compiled manifest is retained.
- `refresh-race-red.log.gz` deterministically reproduces the watcher race on that source: initial directory loading is invalidated by a concurrent refresh, and reveal returns false. The final controller preserves the explicit read intent across same-workspace refresh, waits for the active refresh, and re-reads only a listing invalidated by the new snapshot. Stop/newer-request guards still cancel it. An intermediate implementation issued an extra unresolved root read; that default-timeout failure is retained. The fix observes a newly-started refresh before issuing the read. The stale-listing test now explicitly settles the microtasks that make its old listing genuinely in-flight; its selection assertions are unchanged. No test retries or timeout increases were added.

## Final checks and real windows

`tests-race-final.log.gz`: **75 pass / 0 fail**, 3026 assertions / 7 files, including the accountless graph, original editor/file-link behavior and scoped cancellation. Full desktop type checking, 17-locale i18n extraction/strict compilation and plugin checks pass. Format has no errors; the checked pre-existing fixtures retain 12 warnings / 2 infos. Initial lint dependency errors were fixed by giving the controller a stable memoized identity; the initial missing-translation and lint logs remain.

Both final runs use `/workspace/superset/apps/desktop` and its compiled file renderer, with identity records and actual CDP mouse/keyboard input:

- `final-local`: exit 0. Both first and reopened folder rows have expanded=true, selected=true and childPresent=true. Files/Changes retains the folder and dirty draft; the backend file stays unchanged. Existing file links still navigate to line 3, column 2. Original A PIDs **84554/84566** and executions/cwd remain; inactive B PID **84653** is verified alive and unchanged after the journey.
- `final-ssh`: exit 0, owned loopback fixture, after the original **20** restore samples. The same directory/editor/Files-Changes/reopen checks pass. Original PIDs **85429/85435/85441** and executions/cwd remain. Reopening then clicking the directory creates no editor for it.

Renderer errors are empty. The final local revealed-folder screenshot and final SSH revealed/reopened screenshots were viewed; other captures are retained without claiming all were viewed.

All **2205** compiled main/preload/renderer files were checked after both final runs against `product-snapshot.json`, SHA256 **87a47e018fb9925d148eeb2a80c3aef01fd9d814f1464c492c8276b161aca35f**. Compiled source is `58cca08f6`. The baseline's 2205 files were also verified against stage 63 before rebuilding. Existing CLI SHA256 remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`. Source-only electron-vite compilation ran, without CLI packaging, installers, sealed backend archives or GitHub Actions.

Existing finally handlers clean owned local namespaces and SSH fixtures. Final Xorg PID **84313** was terminated through its Popen handle and awaited, exit 0. Earlier failure cleanups are recorded separately. No unknown resource was signalled.

This verifies POSIX workspace-internal directories in Linux Electron and loopback SSH, not physical macOS, an external SSH host, external folders/Finder/editor actions, URL handling or all link settings. Overall parity remains incomplete.
