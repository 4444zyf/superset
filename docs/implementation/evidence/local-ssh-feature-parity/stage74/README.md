# Stage 74 evidence

Source: 7221fa2e84b4a4cabd52b7efc5f7d78ad6674fa9, then browser registration-token fix 601b85d1408a31b67246fc5cb34c909e96c886c6. Logs are compressed without timestamp variation. No profiles, keys, sessions or compiled test binaries are included.

- `browser-token-final-tests.log.gz`: 57 tests, 2869 assertions across 6 files. `cleanup-failure-red`, `partition-policy-red` and `reload-unregister-red` retain actual failures preceding fixes. Type and format failures are also retained.
- `native-owned-final-token/result.json`: real Electron 41.10.7 guest ownership, sandbox/preferences, actual session identity, denied file and arbitrary partition attachment, cleanup. Workspace verification/description in this isolated fixture are injected; this is not a workstation-browser UI or SSH-browser acceptance test. Its host screenshot does not establish the full embedded browser product UI.
- `native-owned*` before the final run preserve incorrect fixture argv, top-level ready wait, and partition observation failures. Partition is checked using actual Electron Session identity and storagePath in the final fixture.
- `terminal-regression`: stale compiled catalogs prevented navigation. `terminal-regression-catalog-restored` and `product-snapshot-raced-build.json` are invalid acceptance evidence because the source build was still running. They are retained as failures, not product regressions or successful runs.
- `terminal-regression-verified`: successful native local/owned-loopback-SSH clipboard and raw PTY input at source 7221fa2e8, including 20 SSH restores.
- `wheel-regression-verified`: successful default native wheel at source 7221fa2e8.
- `wheel-modes-final`: successful local/owned-loopback-SSH normal/alternate/stock/SGR/legacy/pixel wheel at final source 601b85d14, including 20 SSH restores. `verification-summary.json` records measured offsets and bytes.
- `renderer-preload-unchanged.json`: all 2071 renderer/preload files are identical between those two source builds; the token change only affects browser registration in main and its type contract. Final `product-snapshot.json` has all 2205 main/preload/renderer files and was rechecked after native runs.

The SSH clipboard keyboard-copy screenshot, final local pixel-mouse screenshot, and final SSH stock-wheel screenshot were viewed. Other screenshots were captured; they are not all claimed as viewed. Real vendor agents, external SSH targets and physical macOS/trackpads were not tested. The browser pane UI, history and persisted page layout remain unfinished. No CLI rebuild, installers, sealed backend release archives or GitHub Actions were run.
