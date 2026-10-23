# Stage 60 — keep user input until the owned terminal attaches

2026-10-23. Initial feature source `4d4bb9456`; final explicit timestamp reads and fixture guards `d921789da`. Upstream input-buffering reference: `295bb0fc5` / #8456. Source baseline for unit reproduction: `01d81bf30`. Native baseline: frozen `e3cb344a7` output from stage 58.

## Behavior and compatibility

The original transport and direct workstation terminal share a private in-memory queue. It holds at most 8192 UTF-16 code units and expires five seconds after the first input. It is consumed once, after the original `attached` message and metadata announcements. Overflow invalidates the entire burst, including later Enter keys, instead of sending a truncated command. A first oversized paste is bounded too. Close, park, explicit reconnect, errors, exit, scope changes and component teardown clear it.

The queue intentionally does not accept every `onData`: xterm combines user data and parser responses there. Its pinned private core emits `onUserInput` synchronously before the corresponding data event. The shared listener uses that provenance, not escape-string matching. Parser responses keep their old live path and are not queued. A core without provenance keeps live-only delivery. Both pinned browser and headless xterm are exercised, including disposal, Unicode and user control characters.

Attachment uploads retain their existing readiness and explicit-operation checks. This queue holds emitted terminal data, not files.

The old direct path used WebSocket `open` as readiness, before the host completed attach. It now waits for the existing `attached` message and matching terminal ID. Strict restoration retains its workspace/execution identity checks. Published `ssh-preview-v1.37.1` and `ssh-preview-v1.37.2` host sources already emit `{ type: "attached", terminalId }`; no new host message, field, version floor or tRPC procedure is needed. Old clients retain their behavior because no host source changes. No org/user context or ownership shortcut is introduced. This client queue does not claim that an old host's raw history is generally safe.

## Red/green and source checks

- `red-attach-input.log.gz`: both new behavioral tests fail on the old source: typed bytes disappear before attach in the original transport and the strict direct renderer.
- `initial-integration.log.gz`: first integration has 44 pass / 1 fail. The old typography test declared the socket open without emitting the host's actual attached message. Its fixture now sends that existing message; the typography assertion and timeout are unchanged.
- `green-attach-input.log.gz`: 63 pass across the new helper and two integrations. Covers protocol-response exclusion, metadata ordering, exactly-once delivery, expiry/overflow and cancellation/scope boundaries.
- `regression-final-desktop.log.gz`: 99 pass, 2904 assertions, 11 files. Includes parser provenance and fallback, original transport, direct renderer, replay/version protection, clipboard shortcuts, pending resources/panes and the accountless startup graph. Intermediate runs are not added again.
- `types-clean-desktop.log.gz`: complete desktop types passed. Earlier type logs remain.
- `format-clean.log.gz`: no errors; 2 old warnings and 2 old infos remain. New destructured timestamp/fixture assertion warnings were corrected by explicit reads and fixture checks, without unsafe fixes.
- React's existing unwrapped-act notices remain in the original identity tests; this is not described as warning-free.

## Real input while waiting for the backend

The existing owned-fixture pause control checks the backend lock, UID and command line before signalling only that backend PID. The journey switches Files → Terminal, waits for `pending`, clicks the xterm screen, verifies active/focused textarea state, inserts the fixed Unicode command and presses Enter. The backend resumes in `finally`, with a strict <4500 ms assertion on the pause. No app action or DOM value is substituted for native input.

`native-baseline` uses actual stage-58 compiled bytes; all 2205 files were matched to `baseline-product-snapshot.json` before reproduction. The terminal is pending/active/focused, its real PTY remains alive, but the command never arrives and the file is absent: exit 1. Both pending and post-resume failure screenshots were viewed. The baseline's `pausedElapsedMs` includes the later file wait, not only the pause; the pause assertion passed. The final verifier records the pause separately as `backendPausedMs`, without changing the input or file assertions.

The native fixture uses an owned file and a fixed `printf` command. Its shell quoting was checked separately to produce the exact UTF-8 line, including LF. Each passing run repeats the pending-input journey after a normal close/reopen. The first append must appear once; the second makes exactly two lines. Each following normal reopen must leave the file unchanged. The original PTYs and the probe must retain PID, execution ID and cwd. The local runner additionally checks the inactive B namespace at the end. SSH uses the owned loopback fixture and the original workspace/20-sample restore journey.

`native-local`/`native-ssh` are the first passing `4d4bb9456` product. `native-final-local`/`native-final-ssh` are the frozen final `d921789da` checks after the small lint/fixture cleanup; their source identity, renderer URL, numeric evidence and raw output are recorded. Passing runs are not counted as extra unit tests. The final summary records the exact manifest and retained identities.

## Limits

Only source `electron-vite` compilation was used, with the existing 8 GiB setting. No CLI rebuild, installer, sealed backend archive or Actions run. Existing CLI SHA256 remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`. Native vendor Agent behavior and physical macOS remain unverified. The two existing repaint timeouts documented in stage 58 are not rerun or claimed fixed here. Overall parity is incomplete.
