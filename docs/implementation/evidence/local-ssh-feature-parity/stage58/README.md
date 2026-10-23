# Stage 58 — version replies across old renderers and raw replay transports

2026-10-23. Product and existing native verifier: `e3cb344a73745a6b47ff1777e088bb04ce8f0308`.
Baseline product: `3199d6664`. No Actions, installer, sealed backend archive or new CLI binary.

Stage 57's direct renderer gate did not protect an old renderer, and its original runtime still installed the new reply unconditionally. Ignoring new replay markers does not stop old xterm from responding to raw historical queries. `released-callers.txt` records actual forwarding callsites from published `ssh-preview-v1.37.1` (`7d309a8ac`) and `ssh-preview-v1.37.2` (`8da8d2901`).

The host now observes live version queries and allows their standalone protocol response events per socket. Historical FIFO/seq sends do not grant replies; disconnect releases the socket state. The direct restore route uses the daemon's actual replay checkpoint. Query parsing reuses the existing bounded byte scanner and its checkpoint state. Historical bytes, byte counts, anchors, message types, scopes and ownership checks remain intact. Ordinary input and other query families keep their existing paths.

| Client / host | Behavior |
| --- | --- |
| Old renderer / new host | Existing raw replay and input messages work; the host rejects unsolicited XTVERSION response events before the PTY. No new client API is required. |
| New original runtime / new host | Custom reply is enabled only by this attach's optional `versionRepliesGuarded: true`. The host protects replay replies. |
| New original runtime / old unmarked host | Stock behavior remains; custom replies are disabled. This is compatibility fallback, not a claim that the old host's historical replay is safe. |
| Current direct renderer / new host | Existing replay gate plus host protection; ownership and execution checks remain. |

## Reproduction and checks

- `red-restore.log.gz`: an old stock headless renderer sends a historical response through the real isolated restore handler into the daemon input stub.
- `red-legacy.log.gz`: real Electron ABI 145, an owned in-process daemon/PTY, real WebSocket and stock headless renderer. Legacy FIFO, seq tail and seq exact each fail on baseline `terminal.ts`, with the extra protocol response ahead of ordinary Chinese input.
- `green-legacy-final.log.gz`: all three pass on the committed product; the historical query bytes are still present unchanged, ordinary input passes and a new live query still receives a response. These tests observe writes at the PTY adapter; they do not claim to run an old installer.
- `red-transport.log.gz`: old transport fails to enable the custom reply on a guarded host.
- `regression-desktop.log.gz`: 64 pass, 2762 assertions, 6 files. Includes real parser behavior on guarded/unmarked reattachments, transport/seq behavior, write coalescing, direct renderer and accountless startup graph.
- `regression-host.log.gz`: 32 pass, 78 assertions, 4 files. Includes restore lifecycle, old renderer, parser boundaries, input isolation and existing mode/resource behavior.
- `regression-scanner.log.gz`: original TerminalModes tests, 7 pass, 324 assertions. Final focused total including the 3 real PTY/WS tests is 106 distinct tests; intermediate runs are not added again.
- `regression-seq.log.gz`: broader existing suite is **8 pass / 2 fail**. Both failures await `FULL-REDRAW`, after beyond-ring reanchor and after resize. `baseline-seq-repaint.log.gz` restores exact baseline `terminal.ts` bytes and runs those same two unchanged tests: **0 pass / 2 same timeouts**. The cause remains unresolved; neither result is called passing. No retries, increased timeout or weaker old assertion was introduced.
- `diagnostic.log.gz`: a first implementation draft accidentally scoped restore reply state inside `onOpen`; the live response assertion caught the resulting cleanup. State was moved to the shared connection closure. The first lint attempt rejected a control-character regex; explicit delimiter/character checks replaced it.
- `types-host.log.gz`, `types-desktop.log.gz`, `pty-types.log.gz`: complete type checks/declarations passed. `format-final.log.gz` and `format-guard.log.gz`: no errors, 4 existing warnings remain in the old route. `plugins.log.gz`: plugin consistency passed.

## Current source window regression

`compile.log.gz` is an 8 GiB `electron-vite build`, with no CLI packaging or electron-builder. `product-snapshot.json` hashes all 2205 compiled main/preload/renderer files; SHA256 `f14e28f1876ee886459b45ee3d2bbad094ced696964c0177d7287d8b29035321`. Every file was rechecked after both native runs. Existing CLI SHA256 remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`.

Both native runs use the current direct renderer and real CDP mouse/keyboard input, with source identity and renderer URL recorded in `observed-identity.json`. The PTY fixture emits a version query and reads the actual reply in raw mode. It is not an authenticated vendor Agent.

- `native-local`: exit 0. First and normal-close/reopen queries receive the branded response with no TERM_PROGRAM/version. Original A PIDs 37531/37543 and probe PID 37756 retain their execution IDs. Inactive B PID 37632 and execution ID are verified alive after the identity journey in `local-parity-final.json`.
- `native-ssh`: exit 0, owned loopback SSH fixture. Original 20-sample workspace restore runs, then first/reopen protocol checks pass. Original PIDs 38182/38188/38194 and probe PID 41303 retain execution IDs.

Both PTY output records contain no replayed version response; renderer errors are empty. Each reopened screenshot was viewed. First-query screenshots were captured, not all viewed. `summary.json` independently checks protocol bytes, execution continuity, compiled identity and the inactive local B session.

Runner `finally` cleanup disposes only owned local/SSH fixtures. The one new Xorg process is terminated through its owning process handle and waited to exit 0 (`native-cleanup.json`). No unknown resource was signalled. Physical macOS, vendor copy/scroll behavior, other query families, installers and the two original repaint failures remain outside this passing result. Overall parity remains incomplete.
