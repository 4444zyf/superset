# Stage 57 — terminal identity and replay-safe XTVERSION

2026-10-23. Upstream references: `295bb0fc5` (#8456, terminal identity portion only) and `11e27fd12` (#8521).
Initial identity source `e637e6c8d`; final replay-safe product and verifier `42f7ac02d`.
No Actions run, installer, sealed backend archive or new CLI binary was generated.
The existing CLI SHA256 stayed `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`.

## Product scope

New terminal environments remove inherited TERM_PROGRAM and TERM_PROGRAM_VERSION instead of claiming kitty. TERM, true color, theme hints and shell metadata keep their existing contracts. The desktop's shared surface and original runtime use a branded XTVERSION reply, `Superset Remix (xterm.js)`, retaining OpenTUI's substring while avoiding Claude's stock-xterm prefix check.

The accountless raw restore path needed an additional repair: history contained old XTVERSION queries, and a restored renderer replied again into a live shell. The restore route now adds `replaying: true` to the existing attached message and emits `replay-complete` after the daemon checkpoint and queued history. No input schema, required field, error code, authentication or ownership check changed. Old clients ignore these additions. A client on an unmarked old host retains stock xterm reply behavior rather than assuming this feature is available.

The direct emulator consumes historical XTVERSION queries without sending their replies. It waits for both the replay boundary and actual queued xterm write callbacks before replying to live queries. Normal keyboard input is not queued or dropped by this gate. It is not a general repair for every terminal query family or for input typed before attach.

The obsolete `terminal-identity-coupling.test.ts` required a kitty-class TERM_PROGRAM. It was removed with the same rationale as upstream: that identity assumption is what this fix removes. Environment behavior, real headless parser replies and the existing 25 full-fidelity wheel tests protect the replacement behavior; wheel handling itself was not changed.

## Source checks

- `red-host.log.gz`: 45 pass / 2 genuine environment failures on old code.
- `red-desktop.log.gz`: 80 pass / 1 environment failure on old code.
- `red-version.log.gz`: helper module did not yet exist; recorded separately from behavioral evidence.
- `green-host.log.gz`, `green-desktop.log.gz`: initial identity tests passed (47 host; 84 desktop); these are subsets of later suites.
- `red-replay-route.log.gz`: 1 pass / 2 missing-boundary failures after adding only an injected daemon test seam, without global module mocks.
- `red-replay-client.log.gz`: 9 pass / 1 missing replay-routing failure.
- `red-replay-version.log.gz`: 3 pass / 2 old-host/replay response failures.
- `green-replay-route.log.gz`, `green-replay-client.log.gz`: fast/late checkpoints, late close, old host fallback, queued parser work, release after failed writes and live queries passed.
- `regression-replay-desktop.log.gz`: 143 pass / 1 unrelated script-editor test failed to open its catalog. The test clicked the entry without awaiting completion of initial loading. It was fixed to wait for the existing enabled control, without extending a timeout or changing product script behavior.
- `regression-replay-desktop-corrected.log.gz`: 144 pass / 0 fail, 2946 assertions, 14 files; includes the accountless startup import graph.
- `regression-replay-host.log.gz`: 50 pass / 0 fail, 133 assertions, 2 files.
- `regression-wheel.log.gz`: 25 pass / 0 fail, 52 assertions, 1 file. Final three-suite total: 219 tests, not a sum of all intermediate runs.
- `types-replay-host.log.gz`, `types-replay-desktop.log.gz`, `types-final-desktop.log.gz`: complete host/desktop types; final desktop check includes the corrected test precondition.
- `format.log.gz`, `format-replay.log.gz`: no lint errors. The latter has 6 existing warnings and 2 informational suggestions; no unsafe fixes.
- `plugins-final.log.gz`: plugin consistency passed after the final product commit. No translatable product copy changed.
- `compile-fixed.log.gz`: initial identity source compile. `compile-replay-fixed.log.gz`: final source compile. Both use the existing 8 GiB setting and only `electron-vite build`; no `compile:app`, CLI packaging or electron-builder.

## Real window evidence and failures

All tests used fresh owned namespaces/profiles, actual Linux Electron source builds and CDP mouse/keyboard input. The protocol fixture is a Python process on the real PTY: it sets raw mode, emits CSI > q, reads the actual reply and records only four public terminal environment values plus the protocol bytes. It is not an authenticated vendor Agent.

- `native-baseline/`: test harness failure before a protocol result: multiline Input.insertText collapsed the Python source. The screenshot and original error remain. The fixture was changed to a validated single-line base64 transport; shell text is not escaped with JSON.stringify.
- `native-baseline2/`: original frozen source `92a4025fd`, genuine baseline result: TERM_PROGRAM=kitty, version=0.42.0, XTVERSION=`xterm.js(6.1.0-beta.302)`. Failed the no-kitty assertion after recording the result.
- `native-local/`, `native-ssh/`: initial identity-only product `e637e6c8d`. First query passed, but the command after normal close/reopen failed. These runs are not called successful lifecycle acceptance.
- `native-local2/`: the same failure persisted after bringing the page forward and observing page focus, active pane, textarea focus and attached state, all true. This ruled out merely assuming missing focus as the cause.
- `native-local3/`: read-only bounded input-event observations and actual daemon output establish the cause. Both inserted commands reached the browser textarea, and the reopened PTY output begins the new command with a replayed `>|Superset Remix (xterm.js)` response. Input had arrived, but the old query reply contaminated the shell line. No product function was intercepted or changed by these observations.
- `native-replay-local/`: final frozen source `42f7ac02d`, exit 0. Initial and post-reopen queries both returned the exact branded response with no TERM_PROGRAM/version. The actual PTY output contains no replayed version response; both commands completed. Original A PIDs 31412 / 31432, probe PID 31756 and execution IDs remain; inactive B PID 31592 and execution ID were still alive after all checks.
- `native-replay-ssh/`: same compiled bytes and verifier on a separate Xorg display, exit 0. The original workspace/20-sample restore journey also ran. Original PIDs 31516 / 31545 / 31552 remain; probe PID 34859 and its execution ID remain across close/reopen. Both exact protocol replies were received without contaminating shell input.

Passing reopened screenshots for local and SSH were visually inspected. Other preserved screenshots were captured, not all individually inspected. Raw native JSON is copied unchanged. Logs are losslessly gzipped; generic branding screenshots stay in owned scratch output. `summary.json` independently checks baseline bytes, the real contamination record, corrected results and retained identities. Product snapshots include exact compiled byte hashes, rechecked unchanged after the passing runs.

## Limits and cleanup

This verifies real PTYs, the protocol and application restore, not physical macOS, authenticated Claude/Codex copy/scroll behavior or an installer. Existing PTY environments are not retroactively changed, no existing Agent is restarted and no command is replayed to apply identity settings. Old unmarked backends keep the prior stock path until updated. Native Cmd+C forwarding, attach-time input buffering and other parity groups remain pending.

Existing runner finally blocks closed all owned backend/SSH fixtures. The two Xorg processes were matched by UID and exclusive owned log paths, their start ticks recorded and only their positive PIDs sent TERM; both exited 0. No unknown resource was signalled, and PID1 zombies were not claimed reaped. Signal records are in `summary.json`.
