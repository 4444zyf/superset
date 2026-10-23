# Stage 63 — clipboard support in local and SSH terminals/TUIs

2026-10-23. Feature `ff69ca707`, accountless fallback `5cd4c9929`, final product/focus fix `cb3bb5ea7`, final verifier `5312cd31f`.

The user additionally requires clipboard support, especially in SSH coding agents. Existing remote image/file upload and text paste are retained; this stage fills missing terminal menu/copy integration and verifies the TUI path.

## Product changes and baseline

The stage-62 compiled product's actual SSH context menu has only split/close items. `baseline-ssh` exits 1 on the Copy/Paste requirement after completing the existing 20 restore samples. The menu screenshot was viewed.

- Terminal pane menus now offer Copy/Paste, keeping split/close. Mounted terminal controls supply selection and readiness; guarded cleanup removes them. Paste focuses the owning terminal and invokes its window's native paste event, preserving the existing text/image/file handler and bracketed-paste encoder. It does not read the remote machine's OS clipboard.
- The direct surface now uses the original normalized terminal copy handler. Ctrl+Shift+C copies a selection without leaking a key into the PTY. Copy in client history uses its browser selection. No selection means ordinary Ctrl+C/agent keys retain their original path.
- Clipboard permission/unavailability fallback uses the owning `DirectWorkstationApi.copyText`, without account services. The main-process paste action targets the IPC sender's webContents. No host/tRPC/schema/identity contract changes were needed.
- Actual first copy/paste runs exposed lost focus after menu Copy: copying succeeds, but the next keyboard paste leaves the raw TUI input empty. `verified-local` and `focus-failure-input.json` retain this product failure. The focused regression fails on exact `5cd4c9929` source (0 pass / 1 fail), then passes after focus restoration. Final UI waits for the menu to fully close and measures the same terminal's TEXTAREA focus before continuing. Closed terminals cannot steal focus; scheduled paste after unmount is also covered.

`native-local` records an earlier verifier selector mistake (`text:` searches buttons, while menu items require `menu:`). Only its selector changed before the lost-focus run. No assertion, timeout or retry limit was weakened. That failure is retained. Initial copy-test lint rejected a returned forEach value; the fixture now uses a for loop. The first draft compilation was superseded before native testing; final artifacts are frozen separately.

## Verification

Final focused suite: **103 pass / 0 fail**, 2813 assertions / 8 files, including the accountless startup graph, original copy/Unicode/wrap behavior, shortcut handling, image fallback, direct terminal/pane regressions, clipboard fallback and stale-target protection. Full desktop type checking, i18n consistency/strict catalog compilation and plugin checks pass. Format check has no errors; 2 existing warnings / 2 existing infos remain.

`focus-fixed-local` and `focus-fixed-ssh` both exit 0 in the actual compiled Electron renderer. Identity records confirm the source application path and file renderer; the SSH run uses the owned loopback fixture and completes 20 restore samples before clipboard checks.

On both connections:

- OS clipboard image paste uploads real image bytes; decoded pixels match. The target shell reads the file, and a second paste does not overwrite the first.
- **3474 bytes** of Chinese/emoji multiline text match the target file exactly.
- A native file-URI clipboard payload containing a **36-byte** file with Chinese and apostrophes in its name uploads correctly; the target shell reads it. This is not claimed to be a physical file-manager Copy action.
- A raw mouse-aware alternate-screen TUI enables 1000/1006/2004. Real Shift-drag selects `COPY SSH 中文 🙂 DONE`; both Ctrl+Shift+C and menu Copy place exactly that text in the local OS clipboard, with no PTY input. Focus returns to the same terminal after the menu closes.
- Native keyboard paste and menu Paste each deliver exactly one `ESC [200~` / `ESC [201~` pair containing the expected Unicode multiline text (terminal newlines are CR). The raw fixture records bytes rather than echoing pasted content, so screenshots alone are not the paste evidence.
- Menu image paste delivers a bracketed path in the target workspace. SSH's path contains `Superset Remix`/`Unified Project` spaces and arrives correctly quoted, instead of pointing at a local clipboard file.
- Files → Terminal remount retains the terminal; a subsequent TUI OSC 52 write copies `AGENT OSC52 中文 🙂` to the local clipboard. Input remains usable and the raw fixture exits normally. Renderer errors are empty.

Viewed screenshots: baseline SSH menu; first selector and lost-focus failures; final local keyboard-copy/menu-paste; final SSH keyboard-copy/remote-image-path-before-enter. Other captures are retained but not all claimed viewed.

## Artifacts and limits

Final product source is `cb3bb5ea7`; later changes affect only verifier/docs. All **2205** main/preload/renderer files were rechecked after both final runs against `product-snapshot.json`, SHA256 **c66141719826e5cfd2a72d4e791ddd25a8086a3a8b440f1ee6484cbfdfc9e86b**. Existing CLI SHA256 remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`. Builds used source-only electron-vite; no CLI packaging, installer, sealed backend archive or GitHub Actions ran.

Existing finally handlers clean only owned local/SSH fixtures. Final owned Xorg PID **69451** was terminated via its Popen handle and awaited, exit 0. Earlier failure cleanups are saved separately; no unknown resource was signalled.

This is Linux Electron with the OS clipboard, CDP and owned X11 keyboard input, using a controlled raw TUI over local/loopback SSH. It is not authenticated Claude/Codex/etc. vendor acceptance, physical macOS testing, or an external SSH-host test. Overall feature parity remains incomplete.
