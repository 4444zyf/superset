# Stage 62 — wheel input safety and complete TUI mouse transport

2026-10-23. Product changes: `fff6135d9`, `a288df1df`; final verifier: `9a4c24187`.

The existing stage-60 compiled desktop was used for the baseline. With the saved stock-wheel preference enabled, actual CDP wheel input in the raw alternate-screen TUI appended `1b5b41` (ESC [ A) to its PTY input. `baseline-local` exits 1. The screenshot does not echo raw input; the byte record supplies that evidence. The real parser test also fails before the fix because RIS leaves the SGR tracker active.

The first fix makes normal viewport scrolling explicit, keeps alternate-screen review input-free even with the stock preference, and tracks reset/pixel encoding changes. Its native run then exposes a second product defect: legacy mouse input is absent because xterm emits `onBinary`, while both transports only subscribed to `onData`. `fixed-local`, `initial-fixed-legacy-input.json`, and the initial product manifest retain that failure.

The final product adds negotiated `attached.binaryInput` and base64 `input-binary` messages to both terminal routes. Decoded Buffer bytes reach the existing daemon without UTF-8 conversion. Ordinary input, old attached fields, authentication and workspace/execution validation remain. The existing replay version-reply guard also applies to binary input. New clients use client history for legacy mouse modes on an unmarked host; old clients keep their existing input contract. Binary input is live-only and subscriptions are disposed with the text listener. No tRPC/schema change or mandatory host version bump is needed.

## Checks

- Final focused tests: **108 pass / 0 fail**, 363 assertions, 10 files (shared 26, desktop 74, host 8). Both complete type checks and plugin consistency pass. Format check has no errors; 6 existing warnings / 2 existing infos remain.
- `binary-typecheck.log.gz` retains the initial draft's scoping/partial-emulator errors. `desktop-fixed.log.gz` retains the old normal-wheel return-value assertion; the final test still requires no PTY input.
- One intermediate remount run (`final-local`) counted an explicit click's legitimate SGR press/release as injected input. The verifier moves its no-input assertion before that click and consumes mouse releases without scrolling content. No product change, retry/timeout increase or weaker wheel assertion was used. That failure and raw input are retained.

## Real windows

`verified-local` and `verified-ssh` both exit 0, using the compiled direct renderer. Identity records confirm `/workspace/superset/apps/desktop` and its file renderer. SSH uses the owned loopback fixture and first completes the existing 20 restore samples.

On both connections:

- Normal scrollbar position goes **420 → 414 → 420**, without terminal input.
- Alternate-screen review retains earlier redraws and shell history; mixed small/reversing wheel events emit no input. Saved stock preference still opens history without arrow bytes. Escape returns to the TUI.
- SGR TUI content offset goes **100 → 95 → 100**.
- Files → Terminal reattaches the same terminal without injected input. Legacy and pixel modes then each move **100 → 99 → 100**.
- Legacy reports contain raw high-coordinate byte **0x8d**, without UTF-8 expansion. Pixel reports contain **462;60**, rather than cell coordinates.
- Renderer errors are empty. JSON records keep the actual PTY input and measured positions.

The baseline saved-preference screenshot, final local saved-preference/legacy-up screenshots, and final SSH legacy-up/pixels-mouse screenshots were actually viewed. Other screenshots were captured; they are not all claimed viewed.

The 2205 compiled main/preload/renderer files were checked after both final runs against `product-snapshot.json`, SHA256 `228be337a3188528c223a4c6ef306ebd66a7386dc1db67402af2b089fab7579d`. Compiled product source is `a288df1df`; later commits change only verifier/docs. The existing CLI hash remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`. Source-only electron-vite builds ran; no CLI packaging, installer, sealed backend archive or GitHub Actions ran.

Native fixture cleanup uses its existing finally handlers. The owned final Xorg PID 57888 was terminated through its Popen handle and awaited, exit 0; initial failure cleanups are retained separately. No unknown resource was signalled.

This verifies Linux Electron CDP wheel input and a controlled raw protocol TUI, not a physical macOS trackpad or authenticated vendor agent. Unmarked-host fallback is covered by focused tests, not an old installer GUI. Overall feature parity remains incomplete; the user's new clipboard requirement continues separately.
