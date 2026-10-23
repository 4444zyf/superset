# Stage 56 — terminal link columns

2026-10-23. Product change `cf150bea0`; final native verifier and source compilation `92a4025fd`.
This stage generated no installer, sealed backend release archive, new CLI binary, or Actions run.
`scope.json` records both original/fork source references, failures, real cursor values, retained executions and limitations.
`fixed-product-snapshot.json` records the exact compiled JavaScript/CSS/HTML hashes used by both passing native runs.
The pre-existing CLI binary in this environment was unchanged (SHA256 `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`). It is not the CLI binary recorded by the historical stage 55 environment.

## Source checks

- `red.log.gz`: old product, 34 pass / 2 fail (column dropped by terminal callback and file viewer).
- `green.log.gz`: 36 pass after wiring column and repeatable position requests.
- `editor.log.gz`: original line-only behavior, repeated position, bounds and no document changes; included again in the regression suite, not an additional unique test.
- `regression.log.gz`: 151 pass / 0 fail, 738 assertions, 21 files.
- `accountless.log.gz`: startup import graph passed, 2554 assertions, 1 file.
- `typecheck.log.gz`: stale environment dependencies and old generated PTY declarations failed before environment repair; no product column type failure.
- `install.log.gz`, `pty-types.log.gz`, `pty-build.log.gz`: frozen lockfile install with lifecycle scripts disabled, regenerated PTY types and daemon JavaScript; shared native addons were not rebuilt.
- `typecheck-fixed-env.log.gz`: complete desktop types passed after environment repair.
- `format.log.gz`: 9 files checked, no errors, 11 pre-existing warnings; no unsafe fixes.
- `plugins.log.gz`: plugin consistency passed. `i18n-build.log.gz`: existing catalogs strictly compiled. No translatable product copy changed.
- `compile-baseline.log.gz`, `compile-fixed.log.gz`: local `electron-vite build` only, existing 8 GiB Node setting; not `compile:app`, CLI packaging or electron-builder.

## Real window evidence

Each run used fresh owned profiles and backends. The Electron executable used `--no-sandbox` in a Linux cloud Xorg display. The runner used Node with the existing `tsx` loader.

- `native-baseline.log.gz`: initial Bun invocation could not import the Node/tsx CommonJS interop verifier; failed before GUI startup. Not a product failure.
- `native-baseline-tsx/`: original first hover did not become ready. Failed before the column assertion.
- `native-baseline2/`: navigation reached the file, but the test read an empty DOM `getSelection()`. Invalid column observation, not proof of the product column defect.
- `native-baseline3/`: same-line hover readiness still failed. Kept separately.
- `native-baseline4/`: final verifier uses real mouse movement from the adjacent terminal row and a read-only selection observation from the visible original CodeMirror document. Exact old product `182af9548` selected line 3, column 1 for `terminal-link.txt:3:2`, then failed the column-2 assertion. Failure screenshot was visually inspected.
- `native-ssh/`: fixed source build, same verifier; exit 0. Actual Ctrl-click selected line 3, column 2; draft survived a terminal round trip, backend file stayed unchanged, explicit discard and normal close/reopen returned to the same linked position. Original SSH PTY PIDs 18317 / 18332 / 18340 and execution IDs/cwd stayed unchanged. Fixture terminal PID 21783 stayed unchanged during navigation. The existing restore journey, including 20 reconnect/reopen samples, also ran.
- `native-local/`: same compiled bytes on a separate Xorg display; exit 0. Independent local A/B namespace selection/restore and the same file-link flow passed. Original A PIDs 18143 / 18175 and fixture PID 18517 stayed unchanged during their checked journeys; inactive B PID 18325 and execution ID remained alive and unchanged after the link checks.

Both passing runs have empty renderer error arrays. Their retained-draft and window-reopen screenshots were visually inspected; other preserved screenshots were captured, not all individually inspected.
All original `.log`/`application-log.txt` bytes are losslessly gzipped. Native JSON is copied unchanged. Generic branding screenshots are left in the owned scratch output; the relevant link/failure screenshots are included here.

## Limits and cleanup

The test drives native CDP mouse/keyboard events; it does not set the editor selection, call an internal navigation action, or change product DOM. Position measurements read the actual visible CodeMirror state only. Reading that state is not a claim of native OS text selection or typing at an unclicked editor. Draft entry uses the original explicit editor click.
The existing 200-observation hover bound was kept. Moving to the next row and back avoids xterm's same-line provider cache; the stationary/first-hover freshness issue remains a separate limitation. No claim of that issue being repaired is made.

macOS, physical trackpad, authenticated vendor Agents, installers, directory links, external editors and URL/SSH port links remain unverified or pending as recorded in the main parity checklist.
Owned backend/SSH fixtures were closed by the existing runner finally blocks. Both exact owned Xorg processes exited 0 after SIGTERM, recorded in `display-cleanup.json`; no signal was sent to unknown resources. PID1 zombies were not claimed reaped.
