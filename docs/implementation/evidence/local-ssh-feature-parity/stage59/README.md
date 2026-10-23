# Stage 59 — Mac copy for a TUI-owned selection

2026-10-23. Source: `b8fc5cd067ef57d63e02dfc75be151ec09d422ca`. Baseline: `da3e30d84`. Upstream: copy portion of `295bb0fc5` / #8456.

The original runtime and accountless direct terminal already use the same keyboard core. The shared clipboard decision now permits plain Mac Cmd+C to reach the existing xterm encoder only when xterm has no selection and the application both captures the mouse and enables kitty keyboard mode. A terminal selection still takes priority. Kitty-only applications, mouse-only applications, other Cmd modifiers, paste, Windows/Linux and registered application hotkeys retain their existing behavior. Releasing either mode takes effect immediately. No mode or vendor name is cached.

`appOwnsSelection` is optional and defaults to false, preserving older helper callers. The core uses public mouse mode and the same private kitty flag surface as upstream; missing private flags fall back to the old behavior. There is no backend, transport, identity, queue, persisted state or authentication change.

- `red-copy.log.gz`: 8 pass / 2 failures on the previous source. Both are behavioral failures, not missing imports: the shortcut classifier keeps bubbling the TUI copy chord, and the real parser's enabled modes still leave the core rejecting it.
- `green-copy.log.gz`: 10 pass / 51 assertions after implementation.
- `regression-copy.log.gz`: 153 pass / 306 assertions / 11 files. Covers existing whitespace/rectangular copying, clipboard fallback, line editing, app hotkeys and read-only history behavior as well as the new mode transitions. Intermediate runs are not added to this total.
- `types-desktop.log.gz`: complete desktop types passed.
- `format.log.gz`: four touched files checked/formatted without errors.
- `plugins.log.gz`: plugin consistency passed.

The new parser test enables the existing kitty extension through headless's raw options because its constructor sanitizer omits this option. Actual mouse/kitty mode transitions come from ANSI bytes, not fabricated mode flags. The selection is a test double and the KeyboardEvents are synthetic. This validates shared decision logic and its pinned xterm field compatibility; it does **not** prove native Mac keyboard dispatch, exact encoded CSI bytes, system clipboard delivery or authenticated vendor copy behavior.

No services, GUI, Xorg or SSH fixtures were started or stopped. No desktop/CLI source build, installer, sealed backend archive or Actions run was produced. The environment's last compiled desktop remains stage 58's `e3cb344a7`; it is not claimed as a native pass for this source change. Physical macOS/vendor acceptance, attach input buffering, the existing repaint failures and overall parity remain pending.
