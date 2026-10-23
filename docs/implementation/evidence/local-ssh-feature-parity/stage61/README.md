# Stage 61 — resolve the two Linux repaint test timeouts

2026-10-23. Base checkout `786990c86`. This is a test-fixture correction; product source and compiled output remain stage 60's `d921789da`.

Stage 58 recorded two `FULL-REDRAW` timeouts, and the unchanged pre-fix product also failed them. This investigation first read the entire resize path. `terminal.ts` and `Pty.ts` still match stage 58 byte-for-byte; `summary.json` records those hashes.

## Independent real PTY observation

`resize-probe-before.mjs` creates isolated Bash and Python terminals using the actual Electron ABI 145 node-pty binding. It resizes each from 80×24 to 100×30, records process group/foreground group and signal masks, then observes output before and after explicit input. It prints no environment or credential values.

- Bash has its own foreground process group and a registered, unblocked WINCH handler. After resize it prints only READY. Once `probe` is explicitly entered it prints WINCH and INPUT probe.
- Python's handler prints WINCH immediately after the same resize, before any input.
- `resize-probe.mjs` adds a third control with a bounded Bash read. It also prints WINCH before input. No product method is intercepted or rewritten.

The kernel resize and signal delivery work. The original non-interactive Linux Bash fixture defers its trap while blocked in `read`, which cannot model an event-driven TUI's immediate redraw.

## Minimal repair and checks

Only the fixture's Linux read loop uses `read -t 0.05`; macOS retains the original read. The same ANSI frames and command bodies remain. No stdin is injected to force a repaint, and no assertion, byte comparison, screen-preservation requirement, timeout or retry is changed.

`seq-fixed.log.gz`: **10 pass / 0 fail**, 53.8 seconds, real in-process daemon/PTY/WS/headless suite. The formerly failing beyond-ring and resize cases pass, along with restart-spanning restore, exact byte catch-up, legacy clients, focus, smallest visible dimensions, liveness, hidden clients and replay version-reply protection. Diagnostic probes are not counted as additional test cases.

`format.log.gz`, `plugins.log.gz`: passed. No product/API/schema/dependency changes or build artifacts were produced. No GUI, user service or SSH configuration was changed. Probe children are terminated through their owning node-pty objects and awaited; the suite uses its existing after/finally cleanup. Physical macOS was not verified here. The old stage-58 failure evidence remains intact, and overall feature parity remains incomplete.
